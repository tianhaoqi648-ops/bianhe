import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'

/**
 * 转义 SQL LIKE 模式中的特殊字符（%、_、\），使其作为字面量匹配。
 * 配合 SQL 末尾的 `ESCAPE '\\'` 使用。
 */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}

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
}

/** DB topics 表的原始行类型（tags 为 JSON 字符串，未反序列化） */
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
 * - weight / status: 兜底默认值
 */
function rowToTopic(row: TopicRow): Topic {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : null,
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
 *
 * 返回的 where 字符串以 'WHERE 1=1' 开头，便于拼接。
 */
function buildWhereClause(filter?: TopicFilter): { where: string; params: any[] } {
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
    if (value !== undefined) {
      // '__unset__' 翻译为 IS NULL，用于「(未设置)」节点筛选
      if (value === '__unset__') {
        conditions.push(`${column} IS NULL`)
      } else {
        conditions.push(`${column} = ?`)
        params.push(value)
      }
    }
  }

  if (filter.tags && filter.tags.length > 0) {
    const tagConditions = filter.tags.map(() => "tags LIKE ? ESCAPE '\\'")
    conditions.push(`(${tagConditions.join(' OR ')})`)
    for (const tag of filter.tags) {
      const escapedTag = escapeLike(tag)
      params.push(`%"${escapedTag}"%`)
    }
  }

  if (filter.keyword !== undefined && filter.keyword !== '') {
    conditions.push("title LIKE ? ESCAPE '\\'")
    const escapedKeyword = escapeLike(filter.keyword)
    params.push(`%${escapedKeyword}%`)
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
 * - weight 默认 1.0，status 默认 'active'
 */
function createTopic(data: TopicCreateInput): Topic {
  const db = getDb()
  const now = new Date().toISOString()
  const id = uuidv4()
  const weight = data.weight ?? 1.0
  const status = data.status ?? 'active'
  const tagsJson = data.tags ? JSON.stringify(data.tags) : null

  const stmt = db.prepare(`
    INSERT INTO topics (
      id, title, type, domain, difficulty, source, source_type,
      tags, weight, status, batch_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    now
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
 * 性能：相比逐条 createTopic，减少 N-1 次 prepare + 事务边界开销。
 */
function createMany(items: TopicCreateInput[]): Topic[] {
  if (items.length === 0) return []
  const db = getDb()
  const now = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO topics (
      id, title, type, domain, difficulty, source, source_type,
      tags, weight, status, batch_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction((its: TopicCreateInput[]): Topic[] => {
    const results: Topic[] = []
    for (const data of its) {
      const id = uuidv4()
      const weight = data.weight ?? 1.0
      const status = data.status ?? 'active'
      const tagsJson = data.tags ? JSON.stringify(data.tags) : null
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
        now
      )
      const created = getTopicById(id)
      if (created) results.push(created)
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
  const pageSize = filter?.pageSize && filter.pageSize > 0 ? filter.pageSize : 20
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
    'status'
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
 * - tags 维度不能用此方法（数组字段需拆 JSON），由调用方单独处理
 */
export type CountableDimension =
  | 'type'
  | 'domain'
  | 'difficulty'
  | 'source'
  | 'source_type'
  | 'status'
  | 'batch_id'

/**
 * 按指定维度分组统计全库分布。
 * 返回示例：[{ value: '价值辩', count: 234 }, { value: '政策辩', count: 156 }, ...]
 * 仅统计 status='active' 的题（与默认筛选一致）。
 * NULL 值聚合为 '(未设置)'。
 */
function countByDimension(
  dimension: CountableDimension
): Array<{ value: string; count: number }> {
  const db = getDb()
  // dimension 是受限联合类型，非用户输入，可安全拼接
  const rows = db.prepare(`
    SELECT ${dimension} AS value, COUNT(*) AS count
    FROM topics
    WHERE status = 'active'
    GROUP BY ${dimension}
    ORDER BY count DESC
  `).all() as Array<{ value: string | null; count: number }>
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
  listAllTags
}
