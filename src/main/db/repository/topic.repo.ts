import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type { BatchEditFieldAction, CustomFieldValue, BackupImportStrategy } from '../../../shared/types'
import { AppError } from '../../../shared/app-error'
import { validateTopicCustomData } from '../../../shared/config-validator'
import { bulkInsert } from './utils'

/**
 * 转义 SQL LIKE 模式中的特殊字符（%、_、\），使其作为字面量匹配。
 * 配合 SQL 末尾的 `ESCAPE '\\'` 使用。
 */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}

/**
 * 校验并序列化 topic.custom_data（governance 12：写路径守卫，非法不入库）。
 * - 缺省 / 空对象（旧、无自定义字段）→ 返回 null（写 NULL，兼容旧结构）；
 * - 合法 string / string[] → 校验通过后 JSON.stringify；
 * - 非法（原始类型值、数组内非字符串等）→ 抛 AppError('VALIDATION') 拒绝写入。
 */
function serializeCustomData(cd: Record<string, CustomFieldValue> | null | undefined): string | null {
  if (!cd || Object.keys(cd).length === 0) return null
  const v = validateTopicCustomData(cd)
  if (!v.ok) throw new AppError('VALIDATION', v.error, v.error)
  return JSON.stringify(v.value)
}

/**
 * 校验字段名是否为合法标识符（防 SQL 注入）。
 * 允许：英文/数字/下划线，以及中文（Unicode 范围 \u4e00-\u9fa5）。
 * 必须通过此校验才能拼入 SQL（如 countByDimension、listDistinctValues）。
 */
export function isValidIdentifier(name: string): boolean {
  if (!name || typeof name !== 'string') return false
  // 英文/数字/下划线，或中文字符
  return /^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(name)
}

/** 系统字段 key 集合（与 shared/field-definitions.ts 对齐） */
const SYSTEM_COUNTABLE_DIMENSIONS = new Set<string>([
  'type',
  'domain',
  'difficulty',
  'source',
  'source_type',
  'status',
  'batch_id'
])

/**
 * Bug 4.16: 用于 filter 中表示"未设置"语义的魔法值，翻译为 IS NULL。
 * 抽为常量并加注释，避免散落在代码各处。
 */
export const UNSET_VALUE = '__unset__'

// ============================================================
// 类型定义
// ============================================================

export interface Topic {
  id: string
  title: string
  type: string | null
  domain: string | null
  difficulty: string | null
  source: string | null
  source_type: string | null
  tags: string[] | null // 应用层用数组，DB 存 JSON 字符串
  weight: number
  status: string
  batch_id: string | null // 导入批次 id（手动导入的题才有，seed 的为 null）
  created_at: string
  updated_at: string
  /** 自定义字段值（来自 custom_data JSON 列） */
  custom_data?: Record<string, CustomFieldValue> | null
}

/** DB topics 表的原始行类型（tags / custom_data 为 JSON 字符串，未反序列化） */
export interface TopicRow {
  id: string
  title: string
  type: string | null
  domain: string | null
  difficulty: string | null
  source: string | null
  source_type: string | null
  tags: string | null // DB 存 JSON 字符串
  weight: number
  status: string
  batch_id: string | null
  created_at: string
  updated_at: string
  custom_data: string | null // DB 存 JSON 字符串
}

export interface TopicFilter {
  type?: string
  domain?: string
  difficulty?: string
  source?: string
  source_type?: string
  status?: string
  tags?: string[] // 任一标签匹配
  keyword?: string // title LIKE 模糊搜索
  page?: number // 1-based
  pageSize?: number
  batch_id?: string // 按批次筛选
  // 多选字段（与上面单值字段二选一使用，数组优先）
  types?: string[]
  domains?: string[]
  difficulties?: string[]
  /** 自定义字段筛选：fieldKey → 目标值（仅 string 类型字段；tags 类型用 listCustomFieldTags 聚合） */
  custom_filters?: Record<string, string>
}

export type TopicCreateInput = Omit<
  Topic,
  'id' | 'created_at' | 'updated_at' | 'weight' | 'status' | 'batch_id'
> & {
  weight?: number
  status?: string
  batch_id?: string | null
}

export type TopicUpdateInput = Partial<Omit<Topic, 'id' | 'created_at' | 'updated_at'>>

// ============================================================
// 辅助函数
// ============================================================

/**
 * 反序列化：DB row -> Topic
 * - tags: JSON 字符串 -> 数组
 * - custom_data: JSON 字符串 -> 对象
 * - weight / status: 兜底默认值
 */
function rowToTopic(row: TopicRow): Topic {
  let customData: Record<string, CustomFieldValue> | null = null
  if (row.custom_data) {
    try {
      const parsed = JSON.parse(row.custom_data) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        customData = parsed as Record<string, CustomFieldValue>
      }
    } catch {
      // 损坏 JSON 留空，不影响其他字段读取
    }
  }
  return {
    ...row,
    // Bug 2.6: tags 解析添加 try-catch，损坏的 JSON 不会导致列表加载失败
    tags: (() => {
      if (!row.tags) return null
      try {
        return JSON.parse(row.tags)
      } catch {
        return null
      }
    })(),
    custom_data: customData,
    weight: row.weight ?? 1.0,
    status: row.status ?? 'active',
    batch_id: row.batch_id ?? null
  }
}

/**
 * 根据 TopicFilter 动态构建 WHERE 子句与参数列表。
 * - 标量字段：`AND column = ?`
 * - tags：任一匹配，`AND (tags LIKE ? OR tags LIKE ? ...)`
 * - keyword：`AND title LIKE ?`
 * - custom_filters：`AND json_extract(custom_data, '$.fieldKey') = ?`
 *   - fieldKey 必须通过 isValidIdentifier 校验，否则跳过（防注入）
 *   - 值 '__unset__' 翻译为 IS NULL
 *
 * 返回的 where 字符串以 'WHERE 1=1' 开头，便于拼接。
 *
 * 导出供单元测试直接验证 SQL 拼接逻辑。
 */
export function buildWhereClause(filter?: TopicFilter): { where: string; params: any[] } {
  if (!filter) {
    return { where: 'WHERE 1=1', params: [] }
  }

  const conditions: string[] = []
  const params: any[] = []

  // 多选数组字段优先（types/domains/difficulties）
  const arrayFields: Array<{ key: keyof TopicFilter; column: string }> = [
    { key: 'types', column: 'type' },
    { key: 'domains', column: 'domain' },
    { key: 'difficulties', column: 'difficulty' }
  ]
  for (const { key, column } of arrayFields) {
    const arr = filter[key] as string[] | undefined
    if (arr && arr.length > 0) {
      const placeholders = arr.map(() => '?').join(', ')
      conditions.push(`${column} IN (${placeholders})`)
      params.push(...arr)
    }
  }

  // 单值标量字段（仅当对应数组字段未设置时生效）
  const scalarFields: Array<{ key: keyof TopicFilter; column: string }> = [
    { key: 'type', column: 'type' },
    { key: 'domain', column: 'domain' },
    { key: 'difficulty', column: 'difficulty' },
    { key: 'source', column: 'source' },
    { key: 'source_type', column: 'source_type' },
    { key: 'status', column: 'status' },
    { key: 'batch_id', column: 'batch_id' }
  ]
  for (const { key, column } of scalarFields) {
    // type/domain/difficulty 单值仅在对应数组未设置时生效
    if (column === 'type' && filter.types?.length) continue
    if (column === 'domain' && filter.domains?.length) continue
    if (column === 'difficulty' && filter.difficulties?.length) continue
    const value = filter[key]
    // Bug 4.17: null 时跳过，避免静默返回空结果
    if (value === undefined || value === null) continue
    // Bug 4.16: 使用 UNSET_VALUE 常量替代魔法字符串
    if (value === UNSET_VALUE) {
      conditions.push(`${column} IS NULL`)
    } else {
      conditions.push(`${column} = ?`)
      params.push(value)
    }
  }

  // Bug 4.15: 改用 json_each 精确匹配标签，避免 LIKE 对含双引号标签失效
  if (filter.tags && filter.tags.length > 0) {
    const placeholders = filter.tags.map(() => '?').join(',')
    conditions.push(
      `EXISTS (SELECT 1 FROM json_each(topics.tags) WHERE value IN (${placeholders}))`
    )
    params.push(...filter.tags)
  }

  if (filter.keyword !== undefined && filter.keyword !== '') {
    conditions.push("title LIKE ? ESCAPE '\\'")
    const escapedKeyword = escapeLike(filter.keyword)
    params.push(`%${escapedKeyword}%`)
  }

  // 自定义字段筛选：json_extract(custom_data, '$.fieldKey') = ?
  // fieldKey 必须为合法标识符；非法值跳过（不拼入 SQL）
  if (filter.custom_filters) {
    for (const [key, value] of Object.entries(filter.custom_filters)) {
      if (!isValidIdentifier(key)) continue
      if (value === '__unset__') {
        conditions.push(`(json_extract(custom_data, '$.${key}') IS NULL)`)
      } else {
        conditions.push(`(json_extract(custom_data, '$.${key}') = ?)`)
        params.push(value)
      }
    }
  }

  const where = `WHERE 1=1${conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : ''}`
  return { where, params }
}

// ============================================================
// CRUD 方法
// ============================================================

/**
 * 创建辩题。
 * - v4 生成 id
 * - 自动生成 ISO 8601 时间戳
 * - tags 数组 JSON.stringify 后存储
 * - custom_data 对象 JSON.stringify 后存储
 * - weight 默认 1.0，status 默认 'active'
 */
function createTopic(data: TopicCreateInput): Topic {
  const db = getDb()
  const now = new Date().toISOString()
  const id = uuidv4()
  const weight = data.weight ?? 1.0
  const status = data.status ?? 'active'
  const tagsJson = data.tags ? JSON.stringify(data.tags) : null
  // governance 12：写前校验 custom_data，非法不入库
  const customDataJson = serializeCustomData(data.custom_data)

  const stmt = db.prepare(`
    INSERT INTO topics (
      id, title, type, domain, difficulty, source, source_type,
      tags, weight, status, batch_id, created_at, updated_at, custom_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.title,
    data.type ?? null,
    data.domain ?? null,
    data.difficulty ?? null,
    data.source ?? null,
    data.source_type ?? null,
    tagsJson,
    weight,
    status,
    data.batch_id ?? null,
    now,
    now,
    customDataJson
  )

  const created = getTopicById(id)
  if (!created) {
    throw new Error(`[topicRepo] createTopic: insert succeeded but row not found, id=${id}`)
  }
  return created
}

/**
 * 批量创建辩题，使用事务包装。
 * - 单条失败整批回滚，不会部分入库
 * - 所有题使用同一个 created_at/updated_at 时间戳
 * - 返回成功插入的 Topic 列表（与入参顺序一致）
 *
 * Bug 4.21: 直接用 data + 生成的 id + now 拼装返回的 Topic 对象，
 * 避免 N+1 查询（原实现每条插入后都 getTopicById 一次）。
 *
 * 性能：相比逐条 createTopic，减少 N-1 次 prepare + 事务边界开销。
 */
function createMany(items: TopicCreateInput[]): Topic[] {
  if (items.length === 0) return []
  const db = getDb()
  const now = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO topics (
      id, title, type, domain, difficulty, source, source_type,
      tags, weight, status, batch_id, created_at, updated_at, custom_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction((its: TopicCreateInput[]): Topic[] => {
    const results: Topic[] = []
    for (const data of its) {
      const id = uuidv4()
      const weight = data.weight ?? 1.0
      const status = data.status ?? 'active'
      const batchId = data.batch_id ?? null
      const tagsJson = data.tags ? JSON.stringify(data.tags) : null
      // governance 12：写前校验每项 custom_data，任一项非法则整批拒绝（不入库）
      const customDataJson = serializeCustomData(data.custom_data)
      stmt.run(
        id,
        data.title,
        data.type ?? null,
        data.domain ?? null,
        data.difficulty ?? null,
        data.source ?? null,
        data.source_type ?? null,
        tagsJson,
        weight,
        status,
        batchId,
        now,
        now,
        customDataJson
      )
      // Bug 4.21: 直接拼装返回对象，避免 N+1 查询
      results.push({
        id,
        title: data.title,
        type: data.type ?? null,
        domain: data.domain ?? null,
        difficulty: data.difficulty ?? null,
        source: data.source ?? null,
        source_type: data.source_type ?? null,
        tags: data.tags ? [...data.tags] : null,
        weight,
        status,
        batch_id: batchId,
        created_at: now,
        updated_at: now,
        custom_data: data.custom_data ? { ...data.custom_data } : null
      })
    }
    return results
  })

  return insertMany(items)
}

/**
 * 按 id 查询辩题，反序列化 tags。
 */
function getTopicById(id: string): Topic | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM topics WHERE id = ?')
  const row = stmt.get(id) as TopicRow | undefined
  return row ? rowToTopic(row) : undefined
}

/**
 * 列表查询：动态 WHERE + 分页 + COUNT。
 * 默认 page=1, pageSize=20。
 */
function listTopics(filter?: TopicFilter): { items: Topic[]; total: number } {
  const db = getDb()
  const { where, params } = buildWhereClause(filter)

  const page = filter?.page && filter.page > 0 ? filter.page : 1
  // Bug 4.20: pageSize 增加硬上限，避免无限制查询
  const rawPageSize = filter?.pageSize && filter.pageSize > 0 ? filter.pageSize : 20
  const pageSize = Math.min(rawPageSize, 100000)
  const offset = (page - 1) * pageSize

  const listStmt = db.prepare(`
    SELECT * FROM topics
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `)
  const rows = listStmt.all(...params, pageSize, offset) as TopicRow[]
  const items = rows.map(rowToTopic)

  const countStmt = db.prepare(`SELECT COUNT(*) AS total FROM topics ${where}`)
  const countRow = countStmt.get(...params) as { total: number } | undefined
  const total = countRow ? Number(countRow.total) : 0

  return { items, total }
}

/**
 * 按 id 更新辩题，仅更新 data 中非 undefined 的字段。
 * tags 数组会 JSON.stringify。
 * custom_data 对象会 JSON.stringify（空对象视为 null）。
 * 自动更新 updated_at。
 */
function updateTopic(id: string, data: TopicUpdateInput): Topic | undefined {
  const db = getDb()

  const setColumns: string[] = []
  const params: any[] = []

  const scalarKeys: Array<keyof TopicUpdateInput> = [
    'title',
    'type',
    'domain',
    'difficulty',
    'source',
    'source_type',
    'weight',
    'status',
    // Bug 4.22: 支持 batch_id 更新（用于批次撤销后迁移辩题等场景）
    'batch_id'
  ]

  for (const key of scalarKeys) {
    const value = data[key]
    if (value !== undefined) {
      setColumns.push(`${key} = ?`)
      params.push(value)
    }
  }

  if (data.tags !== undefined) {
    setColumns.push('tags = ?')
    params.push(data.tags ? JSON.stringify(data.tags) : null)
  }

  if (data.custom_data !== undefined) {
    setColumns.push('custom_data = ?')
    // governance 12：写前校验 custom_data，非法不入库
    params.push(serializeCustomData(data.custom_data))
  }

  if (setColumns.length === 0) {
    // 没有字段需要更新，直接返回当前对象
    return getTopicById(id)
  }

  setColumns.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(id)

  const stmt = db.prepare(`UPDATE topics SET ${setColumns.join(', ')} WHERE id = ?`)
  stmt.run(...params)

  return getTopicById(id)
}

/**
 * 按 id 删除辩题，返回是否删除成功。
 */
function deleteTopic(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM topics WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

/**
 * 批量删除辩题，使用事务包装。
 * 返回实际删除的条数（changes 总和）。
 */
function batchDeleteTopics(ids: string[]): number {
  if (ids.length === 0) return 0

  const db = getDb()
  const stmt = db.prepare('DELETE FROM topics WHERE id = ?')

  const deleteMany = db.transaction((idsToDelete: string[]): number => {
    let total = 0
    for (const id of idsToDelete) {
      const result = stmt.run(id)
      total += result.changes
    }
    return total
  })

  return deleteMany(ids)
}

/**
 * 按批次删除辩题，使用事务包装。
 * 用于「撤销整批导入」功能。
 * 返回实际删除的条数。
 */
function deleteByBatch(batchId: string): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM topics WHERE batch_id = ?')
  const deleteMany = db.transaction((bid: string): number => {
    return stmt.run(bid).changes
  })
  return deleteMany(batchId)
}

/**
 * 单字段更新 status，自动更新 updated_at。
 */
function updateStatus(id: string, status: string): Topic | undefined {
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare('UPDATE topics SET status = ?, updated_at = ? WHERE id = ?')
  stmt.run(status, now, id)
  return getTopicById(id)
}

/**
 * 单字段更新 weight，自动更新 updated_at。
 */
function updateWeight(id: string, weight: number): Topic | undefined {
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare('UPDATE topics SET weight = ?, updated_at = ? WHERE id = ?')
  stmt.run(weight, now, id)
  return getTopicById(id)
}

/**
 * 按 filter 统计数量，复用 listTopics 的 WHERE 构建逻辑。
 */
function countByFilter(filter?: TopicFilter): number {
  const db = getDb()
  const { where, params } = buildWhereClause(filter)
  const stmt = db.prepare(`SELECT COUNT(*) AS total FROM topics ${where}`)
  const row = stmt.get(...params) as { total: number } | undefined
  return row ? Number(row.total) : 0
}

/**
 * 支持的分类维度。
 * - 系统字段：type/domain/difficulty/source/source_type/status/batch_id
 * - 自定义字段：任意通过 isValidIdentifier 校验的 fieldKey（走 json_extract 路径）
 * - tags 维度不能用此方法（数组字段需拆 JSON），由 listAllTags 单独处理
 */
export type CountableDimension = string

/**
 * 按指定维度分组统计全库分布。
 * - 系统字段（type/domain/difficulty/source/source_type/status/batch_id）走列查询
 * - 其他字符串视为自定义字段 key，走 json_extract(custom_data, '$.key')
 * - fieldKey 必须通过 isValidIdentifier 校验，否则抛错（防 SQL 注入）
 *
 * 返回示例：[{ value: '价值辩', count: 234 }, { value: '政策辩', count: 156 }, ...]
 * 仅统计 status='active' 的题（与默认筛选一致）。
 * NULL 值聚合为 '(未设置)'。
 */
function countByDimension(
  dimension: CountableDimension
): Array<{ value: string; count: number }> {
  if (!isValidIdentifier(dimension)) {
    throw new Error(`[topicRepo] countByDimension: 非法字段名 "${dimension}"`)
  }
  // Bug 4.18: tags 维度不能用此方法（数组字段需拆 JSON），重定向到 listAllTags
  // Bug 5.32: weight 维度同样不适合（数值字段无意义分组）
  if (dimension === 'tags' || dimension === 'weight') {
    throw new Error(
      `[topicRepo] countByDimension 不支持 '${dimension}'，请使用 ${
        dimension === 'tags' ? 'listAllTags()' : '其他统计方式'
      }`
    )
  }
  const db = getDb()

  let rows: Array<{ value: string | null; count: number }>
  if (SYSTEM_COUNTABLE_DIMENSIONS.has(dimension)) {
    // 系统字段：直接列查询（dimension 已校验为合法标识符，可安全拼接）
    rows = db.prepare(`
      SELECT ${dimension} AS value, COUNT(*) AS count
      FROM topics
      WHERE status = 'active'
      GROUP BY ${dimension}
      ORDER BY count DESC
    `).all() as Array<{ value: string | null; count: number }>
  } else {
    // 自定义字段：走 json_extract 路径
    rows = db.prepare(`
      SELECT json_extract(custom_data, '$.${dimension}') AS value, COUNT(*) AS count
      FROM topics
      WHERE status = 'active'
      GROUP BY value
      ORDER BY count DESC
    `).all() as Array<{ value: string | null; count: number }>
  }
  return rows.map((r) => ({
    value: r.value ?? '(未设置)',
    count: Number(r.count)
  }))
}

/**
 * 聚合所有 active 题的 tags，返回每个标签的出现次数（降序）。
 * 仅统计 status='active' 且 tags IS NOT NULL 的行。
 * JS 层 JSON.parse 聚合，损坏的 JSON 行跳过（不影响其他行）。
 *
 * 返回示例：[{ value: '经典', count: 120 }, { value: '哲学', count: 45 }, ...]
 */
function listAllTags(): Array<{ value: string; count: number }> {
  const db = getDb()
  const rows = db
    .prepare(`SELECT tags FROM topics WHERE status = 'active' AND tags IS NOT NULL`)
    .all() as Array<{ tags: string | null }>

  const counter = new Map<string, number>()
  for (const row of rows) {
    if (!row.tags) continue
    try {
      const parsed = JSON.parse(row.tags) as unknown
      if (!Array.isArray(parsed)) continue
      for (const tag of parsed) {
        if (typeof tag !== 'string' || tag.length === 0) continue
        counter.set(tag, (counter.get(tag) ?? 0) + 1)
      }
    } catch {
      // 损坏 JSON 跳过，不影响其他行
    }
  }

  return Array.from(counter.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
}

// ============================================================
// 批量编辑（多字段 + 事务 + 快照采集）
// ============================================================

/**
 * 系统字段白名单：允许批量编辑的系统字段。
 * 其他字段（id/title/created_at/updated_at/batch_id）不允许批量改。
 */
const SYSTEM_BATCH_FIELDS = new Set([
  'type',
  'domain',
  'difficulty',
  'source',
  'source_type',
  'status',
  'weight',
  'tags'
])

/**
 * 对单个 topic 应用一组字段动作，返回 before/after 快照。
 * - before: 该 topic 在这些字段上的原始值
 * - after: 应用动作后的新值
 *
 * 注意：本函数仅计算新值，不写库。写库由 batchUpdateTopics 在事务内统一执行。
 *
 * 快照 key 约定：
 * - 系统字段：直接字段名（'type'、'tags' 等）
 * - 自定义字段：'custom_data.<fieldKey>'
 */
function computeBatchSnapshot(
  topic: Topic,
  actions: BatchEditFieldAction[]
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}

  for (const action of actions) {
    const isSystem = SYSTEM_BATCH_FIELDS.has(action.field)
    const snapshotKey = isSystem ? action.field : `custom_data.${action.field}`

    if (isSystem) {
      // 系统字段
      before[snapshotKey] = (topic as unknown as Record<string, unknown>)[action.field] ?? null

      if (action.mode === 'clear') {
        after[snapshotKey] = null
      } else if (action.field === 'tags') {
        // tags 字段：append 模式追加去重，replace 模式替换
        const currentTags = topic.tags ?? []
        if (action.mode === 'append') {
          const newTags = Array.isArray(action.value)
            ? action.value
            : action.value !== undefined
              ? [String(action.value)]
              : []
          after[snapshotKey] = Array.from(new Set([...currentTags, ...newTags]))
        } else {
          // replace
          after[snapshotKey] = Array.isArray(action.value)
            ? action.value
            : action.value !== undefined
              ? [String(action.value)]
              : []
        }
      } else if (action.field === 'weight') {
        after[snapshotKey] = action.mode === 'replace' ? Number(action.value) : null
      } else {
        // 标量字符串字段
        after[snapshotKey] =
          action.mode === 'replace'
            ? action.value === undefined
              ? ''
              : String(action.value)
            : null
      }
    } else {
      // 自定义字段：从 custom_data 取原值
      const customData = topic.custom_data ?? {}
      before[snapshotKey] = (customData as Record<string, unknown>)[action.field] ?? null

      if (action.mode === 'clear') {
        after[snapshotKey] = null
      } else if (action.mode === 'append') {
        // append 仅对 tags 类型自定义字段有意义；对 string 类型退化为 replace
        const oldVal = (customData as Record<string, unknown>)[action.field]
        const oldArr = Array.isArray(oldVal)
          ? oldVal
          : oldVal !== null && oldVal !== undefined
            ? [String(oldVal)]
            : []
        const newArr = Array.isArray(action.value)
          ? action.value
          : action.value !== undefined
            ? [String(action.value)]
            : []
        after[snapshotKey] = Array.from(new Set([...oldArr, ...newArr]))
      } else {
        // replace
        if (Array.isArray(action.value)) {
          after[snapshotKey] = action.value
        } else if (action.value !== undefined) {
          after[snapshotKey] = action.value
        } else {
          after[snapshotKey] = null
        }
      }
    }
  }

  return { before, after }
}

/**
 * 将 after 快照应用到 topic，生成 TopicUpdateInput。
 * 系统字段直接映射；custom_data 字段需合并到现有 custom_data（避免整体覆盖）。
 */
function applySnapshotToUpdate(
  topic: Topic,
  after: Record<string, unknown>
): TopicUpdateInput {
  const update: TopicUpdateInput = {}
  const customDataPatch: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(after)) {
    if (key.startsWith('custom_data.')) {
      const fieldKey = key.slice('custom_data.'.length)
      if (value === null) {
        // 清空自定义字段：标记为 undefined 在合并时剔除
        customDataPatch[fieldKey] = undefined
      } else {
        customDataPatch[fieldKey] = value
      }
    } else if (SYSTEM_BATCH_FIELDS.has(key)) {
      // 系统字段
      if (key === 'tags') {
        update.tags = (value as string[] | null) ?? null
      } else if (key === 'weight') {
        update.weight = value as number
      } else if (key === 'type') {
        update.type = value as string | null
      } else if (key === 'domain') {
        update.domain = value as string | null
      } else if (key === 'difficulty') {
        update.difficulty = value as string | null
      } else if (key === 'source') {
        update.source = value as string | null
      } else if (key === 'source_type') {
        update.source_type = value as string | null
      } else if (key === 'status') {
        update.status = value as string
      }
    }
  }

  // 合并 custom_data：保留原 custom_data 中未变更的字段
  if (Object.keys(customDataPatch).length > 0) {
    const merged: Record<string, CustomFieldValue> = { ...(topic.custom_data ?? {}) }
    for (const [k, v] of Object.entries(customDataPatch)) {
      if (v === undefined) {
        delete merged[k]
      } else {
        merged[k] = v as CustomFieldValue
      }
    }
    update.custom_data = Object.keys(merged).length > 0 ? merged : null
  }

  return update
}

/**
 * 批量更新辩题，使用事务包装。
 * - 逐条应用 actions，采集 before/after 快照
 * - 单条失败整批回滚
 * - 返回每条 topic 的快照（用于撤销）
 *
 * @param ids 目标 topic id 列表
 * @param actions 字段动作列表
 * @returns { affectedCount, fieldCount, snapshots }
 *          snapshots[topicId] = { before, after }
 */
function batchUpdateTopics(
  ids: string[],
  actions: BatchEditFieldAction[]
): {
  affectedCount: number
  fieldCount: number
  snapshots: Array<{
    topicId: string
    before: Record<string, unknown>
    after: Record<string, unknown>
  }>
} {
  if (ids.length === 0 || actions.length === 0) {
    return { affectedCount: 0, fieldCount: 0, snapshots: [] }
  }

  const db = getDb()
  const now = new Date().toISOString()

  // 预编译 update 语句（一次性更新所有可批量编辑列）
  const updateScalarStmt = db.prepare(`
    UPDATE topics
    SET type = ?, domain = ?, difficulty = ?, source = ?, source_type = ?,
        status = ?, weight = ?, tags = ?, custom_data = ?, updated_at = ?
    WHERE id = ?
  `)

  const getByIdStmt = db.prepare('SELECT * FROM topics WHERE id = ?')

  const fn = db.transaction(() => {
    const snapshots: Array<{
      topicId: string
      before: Record<string, unknown>
      after: Record<string, unknown>
    }> = []
    let affected = 0

    for (const id of ids) {
      const row = getByIdStmt.get(id) as TopicRow | undefined
      if (!row) continue // topic 已删除，跳过

      const topic = rowToTopic(row)
      const { before, after } = computeBatchSnapshot(topic, actions)

      // 若所有 after 值与 before 相同，跳过（无变化）
      const hasChange = Object.keys(after).some((k) => {
        const b = JSON.stringify(before[k] ?? null)
        const a = JSON.stringify(after[k] ?? null)
        return b !== a
      })
      if (!hasChange) continue

      const update = applySnapshotToUpdate(topic, after)

      // 构造 UPDATE 参数：未在 update 中的字段保留原值
      const tagsJson =
        update.tags !== undefined
          ? update.tags
            ? JSON.stringify(update.tags)
            : null
          : topic.tags
            ? JSON.stringify(topic.tags)
            : null
      const customDataJson =
        update.custom_data !== undefined
          ? // governance 12：批量编辑合并后的 custom_data 写前校验，非法不入库
            serializeCustomData(update.custom_data)
          : serializeCustomData(topic.custom_data)

      updateScalarStmt.run(
        update.type !== undefined ? update.type : topic.type,
        update.domain !== undefined ? update.domain : topic.domain,
        update.difficulty !== undefined ? update.difficulty : topic.difficulty,
        update.source !== undefined ? update.source : topic.source,
        update.source_type !== undefined ? update.source_type : topic.source_type,
        update.status !== undefined ? update.status : topic.status,
        update.weight !== undefined ? update.weight : topic.weight,
        tagsJson,
        customDataJson,
        now,
        id
      )

      snapshots.push({ topicId: id, before, after })
      affected++
    }

    return { affected, snapshots }
  })

  const result = fn()
  return {
    affectedCount: result.affected,
    fieldCount: actions.length,
    snapshots: result.snapshots
  }
}

/**
 * 清空题库表。
 * @param options.keepOfficial true=仅删除 source_type != '官方' 的题；false=清空全部
 * @returns 删除行数
 */
function clearAll(options: { keepOfficial: boolean }): number {
  const db = getDb()
  if (options.keepOfficial) {
    const r = db.prepare(`DELETE FROM topics WHERE source_type != '官方'`).run()
    return r.changes
  }
  const r = db.prepare(`DELETE FROM topics`).run()
  return r.changes
}

/**
 * 批量拉取系统字段的 distinct 值与出现次数。
 * - 仅支持系统字段（type/domain/difficulty/source/source_type/status/batch_id）
 * - 字段名必须通过 isValidIdentifier 校验，否则跳过（防注入）
 * - 仅统计 status='active' 且字段非空（IS NOT NULL AND != ''）的行
 *
 * 用途：FilterPanel 候选值合并（系统候选 ∪ DB 实际值）。
 *
 * 返回示例：{ type: [{ value: '价值辩', count: 234 }, ...], difficulty: [...] }
 */
function listDistinctValues(
  fields: string[]
): Record<string, Array<{ value: string; count: number }>> {
  const db = getDb()
  const result: Record<string, Array<{ value: string; count: number }>> = {}

  for (const f of fields) {
    if (!isValidIdentifier(f)) continue
    if (!SYSTEM_COUNTABLE_DIMENSIONS.has(f)) continue
    // f 已校验为合法标识符 + 系统字段，可安全拼接
    const rows = db
      .prepare(
        `SELECT ${f} AS value, COUNT(*) AS count
         FROM topics
         WHERE status = 'active' AND ${f} IS NOT NULL AND ${f} != ''
         GROUP BY ${f}
         ORDER BY count DESC`
      )
      .all() as Array<{ value: string | null; count: number }>
    // Bug 4.19: SQL 已过滤 NULL 和空字符串，r.value 不会为 null，移除 ?? '' 死代码
    result[f] = rows.map((r) => ({ value: r.value as string, count: Number(r.count) }))
  }
  return result
}

/**
 * 聚合某个 tags 类型自定义字段的全部 tag 值与出现次数（降序）。
 * - 走 json_extract(custom_data, '$.fieldKey') 路径
 * - fieldKey 必须通过 isValidIdentifier 校验，否则抛错（防注入）
 * - 仅统计 status='active' 且 custom_data 非空的行
 * - JS 层 JSON.parse 聚合，损坏 JSON 行跳过（不影响其他行）
 *
 * 用途：TopicLibrary 分类树的「自定义 tags 字段」维度计数。
 *
 * 返回示例：[{ value: '初赛', count: 12 }, { value: '复赛', count: 8 }, ...]
 */
function listCustomFieldTags(
  fieldKey: string
): Array<{ value: string; count: number }> {
  if (!isValidIdentifier(fieldKey)) {
    throw new Error(`[topicRepo] listCustomFieldTags: 非法字段名 "${fieldKey}"`)
  }
  const db = getDb()
  // fieldKey 已校验，可安全拼入 SQL
  const rows = db
    .prepare(
      `SELECT json_extract(custom_data, '$.${fieldKey}') AS raw
       FROM topics
       WHERE status = 'active' AND custom_data IS NOT NULL`
    )
    .all() as Array<{ raw: string | null }>

  const counter = new Map<string, number>()
  for (const row of rows) {
    if (!row.raw) continue
    try {
      const parsed = JSON.parse(row.raw) as unknown
      // tags 类型期望数组；如果是字符串则视为单值
      if (Array.isArray(parsed)) {
        for (const tag of parsed) {
          if (typeof tag !== 'string' || tag.length === 0) continue
          counter.set(tag, (counter.get(tag) ?? 0) + 1)
        }
      } else if (typeof parsed === 'string' && parsed.length > 0) {
        counter.set(parsed, (counter.get(parsed) ?? 0) + 1)
      }
    } catch {
      // 损坏 JSON 跳过
    }
  }

  return Array.from(counter.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
}

// ============================================================
// 备份与恢复（全量数据导入导出）
// ============================================================

/**
 * 备份用：返回所有 topics 行（DB 原始格式，含 blacklisted，tags/custom_data 为 JSON 字符串）。
 * 与 rowToTopic 反序列化结果不同，此处保留 DB 原始字符串以便导出后还原。
 */
function findAllForBackup(): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM topics').all() as Record<string, unknown>[]
}

/**
 * 备份用：返回所有 topic_custom_fields 行（DB 原始格式）。
 */
function findAllCustomFieldsForBackup(): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM topic_custom_fields').all() as Record<string, unknown>[]
}

/**
 * 批量恢复 topics（按 strategy 走 INSERT OR IGNORE / REPLACE / INSERT）。
 * 调用方需在外层事务内执行。
 * @returns 受影响行数
 */
function bulkRestoreTopics(
  rows: Array<Record<string, unknown>>,
  strategy: BackupImportStrategy
): number {
  return bulkInsert('topics', rows, strategy)
}

/**
 * 批量恢复 topic_custom_fields。
 */
function bulkRestoreCustomFields(
  rows: Array<Record<string, unknown>>,
  strategy: BackupImportStrategy
): number {
  return bulkInsert('topic_custom_fields', rows, strategy)
}

// ============================================================
// 导出
// ============================================================

export const topicRepo = {
  createTopic,
  createMany,
  getTopicById,
  listTopics,
  updateTopic,
  deleteTopic,
  batchDeleteTopics,
  deleteByBatch,
  updateStatus,
  updateWeight,
  countByFilter,
  countByDimension,
  listAllTags,
  listDistinctValues,
  listCustomFieldTags,
  clearAll,
  batchUpdateTopics,
  // 备份与恢复
  findAllForBackup,
  findAllCustomFieldsForBackup,
  bulkRestoreTopics,
  bulkRestoreCustomFields
}
