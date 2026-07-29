import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type { DrawSessionSettings, BackupImportStrategy } from '../../../shared/types'
import { bulkInsert } from './utils'

// ============================================================
// 类型定义
// ============================================================

export interface DrawSession {
  id: string
  event_id: string
  round_id: string | null
  draw_time: string | null
  operator: string | null
  settings: DrawSessionSettings | null // 应用层用对象，DB 存 JSON 字符串
}

export interface DrawSessionItem {
  id: string
  session_id: string
  topic_id: string
  team_a_id: string | null
  team_b_id: string | null
  stance_a: string | null
  stance_b: string | null
  /** 冗余快照：辩题标题（避免硬删除后显示 ID 片段） */
  topic_title?: string | null
  /** 冗余快照：A 方队伍名 */
  team_a_name?: string | null
  /** 冗余快照：B 方队伍名 */
  team_b_name?: string | null
  /** 多队同题模式下的队伍 id 列表（versus 模式为空，仍使用 team_a_id/team_b_id）。
   *  DB 中存为 JSON 字符串，应用层使用数组。 */
  team_ids?: string[] | null
  /** 多队持方快照（与 team_ids 一一对应）。DB 中存为 JSON 字符串，应用层使用数组。 */
  team_stances?: string[] | null
  /** 队伍名快照（与 team_ids 一一对应）。DB 中存为 JSON 字符串，应用层使用数组。 */
  team_names?: string[] | null
  /** 分组模式下的所属分组 id */
  group_id?: string | null
}

/** DB draw_sessions 表的原始行类型（settings 为 JSON 字符串，未反序列化） */
export interface DrawRow {
  id: string
  event_id: string
  round_id: string | null
  draw_time: string | null
  operator: string | null
  settings: string | null // DB 存 JSON 字符串
}

/** DB draw_session_items 表的原始行类型 */
export interface DrawItemRow {
  id: string
  session_id: string
  topic_id: string
  team_a_id: string | null
  team_b_id: string | null
  stance_a: string | null
  stance_b: string | null
  topic_title: string | null
  team_a_name: string | null
  team_b_name: string | null
  /** JSON 字符串：队伍 id 数组（未解析） */
  team_ids: string | null
  /** JSON 字符串：多队持方数组（未解析） */
  team_stances: string | null
  /** JSON 字符串：队伍名数组（未解析） */
  team_names: string | null
  group_id: string | null
}

// 创建会话时的输入（含 items 数组，一次创建会话及其明细）
export interface CreateSessionInput {
  event_id: string
  round_id?: string | null
  draw_time?: string // 可选，默认 new Date().toISOString()
  operator?: string
  settings?: Record<string, any>
  items: Array<Omit<DrawSessionItem, 'id' | 'session_id'>>
}

// 会话详情（含明细列表）
export interface DrawSessionDetail extends DrawSession {
  items: DrawSessionItem[]
}

// 列表过滤
export interface SessionFilter {
  event_id?: string
  round_id?: string
  operator?: string
  startTime?: string // ISO 8601，>=
  endTime?: string // ISO 8601，<=
  page?: number // 1-based
  pageSize?: number
}

// 单条明细创建输入
export type SessionItemCreateInput = Omit<DrawSessionItem, 'id'>

// ============================================================
// 辅助函数
// ============================================================

/**
 * 反序列化：DB row -> DrawSession
 * - settings: JSON 字符串 -> 对象
 *
 * 容错：settings 字段损坏时返回 null，避免单条坏数据导致整列查询失败。
 */
function rowToSession(row: DrawRow): DrawSession {
  let settings: DrawSessionSettings | null = null
  if (row.settings) {
    try {
      settings = JSON.parse(row.settings)
    } catch {
      settings = null
    }
  }
  return {
    ...row,
    settings
  }
}

/**
 * DB row -> DrawSessionItem
 * - team_ids: JSON 字符串 -> 数组（DB 存 JSON 字符串，应用层使用数组）
 * - team_stances: JSON 字符串 -> 数组（同 team_ids）
 * - team_names: JSON 字符串 -> 数组（同 team_ids）
 * - group_id: 直接透传
 *
 * 参数类型用 DrawItemRow（DB 原始行类型），team_ids/team_stances/team_names 为 JSON 字符串。
 * 解析后返回 DrawSessionItem（数组类型为 string[] | null）。
 *
 * 若 JSON 字符串为空或 null，返回 null（versus 模式兼容）。
 */
function rowToItem(row: DrawItemRow): DrawSessionItem {
  let teamIds: string[] | null = null
  if (row.team_ids) {
    try {
      const parsed = JSON.parse(row.team_ids)
      teamIds = Array.isArray(parsed) ? parsed : null
    } catch {
      teamIds = null
    }
  }
  let teamStances: string[] | null = null
  if (row.team_stances) {
    try {
      const parsed = JSON.parse(row.team_stances)
      teamStances = Array.isArray(parsed) ? parsed : null
    } catch {
      teamStances = null
    }
  }
  let teamNames: string[] | null = null
  if (row.team_names) {
    try {
      const parsed = JSON.parse(row.team_names)
      teamNames = Array.isArray(parsed) ? parsed : null
    } catch {
      teamNames = null
    }
  }
  return {
    id: row.id,
    session_id: row.session_id,
    topic_id: row.topic_id,
    team_a_id: row.team_a_id,
    team_b_id: row.team_b_id,
    stance_a: row.stance_a,
    stance_b: row.stance_b,
    topic_title: row.topic_title,
    team_a_name: row.team_a_name,
    team_b_name: row.team_b_name,
    team_ids: teamIds,
    team_stances: teamStances,
    team_names: teamNames,
    group_id: row.group_id
  }
}

/**
 * 根据 SessionFilter 动态构建 WHERE 子句与参数列表。
 * - event_id / round_id / operator：等值过滤
 * - startTime / endTime：draw_time BETWEEN 范围过滤
 *
 * 返回的 where 字符串以 'WHERE 1=1' 开头，便于拼接。
 */
function buildWhereClause(filter?: SessionFilter): { where: string; params: any[] } {
  if (!filter) {
    return { where: 'WHERE 1=1', params: [] }
  }

  const conditions: string[] = []
  const params: any[] = []

  if (filter.event_id !== undefined) {
    conditions.push('event_id = ?')
    params.push(filter.event_id)
  }
  if (filter.round_id !== undefined) {
    conditions.push('round_id = ?')
    params.push(filter.round_id)
  }
  if (filter.operator !== undefined) {
    conditions.push('operator = ?')
    params.push(filter.operator)
  }
  if (filter.startTime !== undefined && filter.endTime !== undefined) {
    conditions.push('draw_time BETWEEN ? AND ?')
    params.push(filter.startTime, filter.endTime)
  } else if (filter.startTime !== undefined) {
    conditions.push('draw_time >= ?')
    params.push(filter.startTime)
  } else if (filter.endTime !== undefined) {
    conditions.push('draw_time <= ?')
    params.push(filter.endTime)
  }

  const where = `WHERE 1=1${conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : ''}`
  return { where, params }
}

// ============================================================
// 抽取会话 CRUD
// ============================================================

/**
 * 创建抽取会话及其明细。
 *
 * 在**单个事务**中执行：
 *   1. 插入 draw_sessions 一行
 *   2. 批量插入 draw_session_items
 *
 * - session.id 与每个 item.id 均用 uuid v4 生成
 * - draw_time 默认 new Date().toISOString()
 * - settings 用 JSON.stringify 转字符串存储
 * - 返回创建的 session 及其所有 items（settings 反序列化回对象）
 */
function createSession(input: CreateSessionInput): DrawSessionDetail {
  const db = getDb()
  const sessionId = uuidv4()
  const drawTime = input.draw_time ?? new Date().toISOString()
  const settingsStr = input.settings ? JSON.stringify(input.settings) : null

  const insertSession = db.prepare(`
    INSERT INTO draw_sessions (id, event_id, round_id, draw_time, operator, settings)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const insertItem = db.prepare(`
    INSERT INTO draw_session_items (id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b, topic_title, team_a_name, team_b_name, team_ids, team_stances, team_names, group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const itemsWithIds = input.items.map((item) => ({
    ...item,
    id: uuidv4(),
    session_id: sessionId
  }))

  const tx = db.transaction(() => {
    insertSession.run(
      sessionId,
      input.event_id,
      input.round_id ?? null,
      drawTime,
      input.operator ?? null,
      settingsStr
    )
    for (const item of itemsWithIds) {
      // team_ids / team_stances / team_names 序列化为 JSON 字符串存储；
      // 为空（null/undefined/空数组）时存 null
      const teamIdsStr =
        item.team_ids && item.team_ids.length > 0 ? JSON.stringify(item.team_ids) : null
      const teamStancesStr =
        item.team_stances && item.team_stances.length > 0
          ? JSON.stringify(item.team_stances)
          : null
      const teamNamesStr =
        item.team_names && item.team_names.length > 0
          ? JSON.stringify(item.team_names)
          : null
      insertItem.run(
        item.id,
        item.session_id,
        item.topic_id,
        item.team_a_id ?? null,
        item.team_b_id ?? null,
        item.stance_a ?? null,
        item.stance_b ?? null,
        item.topic_title ?? null,
        item.team_a_name ?? null,
        item.team_b_name ?? null,
        teamIdsStr,
        teamStancesStr,
        teamNamesStr,
        item.group_id ?? null
      )
    }
  })
  tx()

  // 返回完整详情（避免再查一次库）
  // itemsWithIds 已经是 DrawSessionItem 形态（team_ids 为数组），无需再走 rowToItem
  return {
    ...rowToSession({
      id: sessionId,
      event_id: input.event_id,
      round_id: input.round_id ?? null,
      draw_time: drawTime,
      operator: input.operator ?? null,
      settings: settingsStr
    }),
    items: itemsWithIds
  }
}

/**
 * 按 id 查询会话并附上其所有 items（按 id ASC，保持插入顺序）。
 * settings 反序列化为对象。
 */
function getSessionById(id: string): DrawSessionDetail | undefined {
  const db = getDb()

  const sessionStmt = db.prepare('SELECT * FROM draw_sessions WHERE id = ?')
  const sessionRow = sessionStmt.get(id) as DrawRow | undefined
  if (!sessionRow) {
    return undefined
  }

  const itemsStmt = db.prepare(
    'SELECT * FROM draw_session_items WHERE session_id = ? ORDER BY id ASC'
  )
  const itemRows = itemsStmt.all(id) as DrawItemRow[]

  return {
    ...rowToSession(sessionRow),
    items: itemRows.map(rowToItem)
  }
}

/**
 * 列表查询抽取会话（含明细）。
 *
 * - 动态 WHERE：event_id / round_id / operator 等值过滤；draw_time 范围过滤
 * - 分页：默认 page=1, pageSize=20，按 draw_time DESC
 *
 * **N+1 优化**：
 *   1. 先查 sessions（分页）
 *   2. 同时执行 COUNT 查询
 *   3. 用 `WHERE session_id IN (...)` 一次性查所有 items
 *   4. 内存中按 session_id 分组组装
 *
 * 每个 session 的 settings 反序列化。
 */
function listSessions(
  filter?: SessionFilter
): { items: DrawSessionDetail[]; total: number } {
  const db = getDb()
  const { where, params } = buildWhereClause(filter)
  const page = filter?.page && filter.page > 0 ? filter.page : 1
  const pageSize = filter?.pageSize && filter.pageSize > 0 ? filter.pageSize : 20
  const offset = (page - 1) * pageSize

  // 1. 查 sessions（分页）
  const listSql = `SELECT * FROM draw_sessions ${where} ORDER BY draw_time DESC LIMIT ? OFFSET ?`
  const sessions = db.prepare(listSql).all(...params, pageSize, offset) as DrawRow[]

  // 2. 查总数
  const countSql = `SELECT COUNT(*) AS total FROM draw_sessions ${where}`
  const countRow = db.prepare(countSql).get(...params) as { total: number } | undefined
  const total = countRow ? Number(countRow.total) : 0

  if (sessions.length === 0) {
    return { items: [], total }
  }

  // 3. 一次性查所有 items（WHERE session_id IN (...)）
  const sessionIds = sessions.map((s) => s.id)
  const placeholders = sessionIds.map(() => '?').join(',')
  const itemsSql = `SELECT * FROM draw_session_items WHERE session_id IN (${placeholders}) ORDER BY id ASC`
  const allItems = db.prepare(itemsSql).all(...sessionIds) as DrawItemRow[]

  // 4. 内存中按 session_id 分组
  const itemsBySession = new Map<string, DrawSessionItem[]>()
  for (const item of allItems) {
    const sid = item.session_id as string
    if (!itemsBySession.has(sid)) {
      itemsBySession.set(sid, [])
    }
    itemsBySession.get(sid)!.push(rowToItem(item))
  }

  // 5. 组装结果（保持 sessions 的 DESC 顺序）
  const details = sessions.map((s) => ({
    ...rowToSession(s),
    items: itemsBySession.get(s.id) ?? []
  }))

  return { items: details, total }
}

/**
 * 按 id 删除抽取会话（CASCADE 删除关联数据）。
 *
 * 在**单个事务**中执行：
 *   1. 删除 team_history 表中 session_id = id 的所有记录
 *      （team_history.session_id 为普通 TEXT 列，无外键约束，必须手动删除）
 *   2. 删除 draw_sessions 表中 id = id 的记录
 *      （draw_session_items 通过 ON DELETE CASCADE 自动清理，无需显式删除）
 *
 * 返回 `{ success: true }`；若删除失败（如 session 不存在或数据库错误）抛错，
 * 由 IPC 层捕获并返回 `{ success: false, error }`。
 *
 * @param id 会话 id
 * @throws Error 当数据库操作失败时抛错
 */
function deleteSession(id: string): { success: true } {
  const db = getDb()

  const deleteHistoryStmt = db.prepare(
    'DELETE FROM team_history WHERE session_id = ?'
  )
  const deleteSessionStmt = db.prepare('DELETE FROM draw_sessions WHERE id = ?')

  const tx = db.transaction(() => {
    // 1. 删除该 session 关联的队伍历史（无外键约束，必须手动删除）
    deleteHistoryStmt.run(id)
    // 2. 删除 session 主记录（draw_session_items 通过 ON DELETE CASCADE 自动清理）
    const result = deleteSessionStmt.run(id)
    if (result.changes === 0) {
      throw new Error(`[deleteSession] 会话不存在：${id}`)
    }
  })

  tx()

  return { success: true }
}

/**
 * 按 id 更新抽取会话的 settings（合并 patch 后整体写回 JSON 字符串）。
 *
 * 用于"确定抽取结果"流程：把 confirmed=true 合并进 settings。
 * 若 session 不存在返回 undefined。
 *
 * @param id 会话 id
 * @param patch 要合并的 settings 片段（浅合并）
 */
function updateSessionSettings(
  id: string,
  patch: Partial<DrawSessionSettings>
): DrawSession | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM draw_sessions WHERE id = ?')
  const row = stmt.get(id) as DrawRow | undefined
  if (!row) return undefined

  const currentSettings: DrawSessionSettings | null = (() => {
    if (!row.settings) return null
    try {
      return JSON.parse(row.settings)
    } catch {
      return null
    }
  })()
  const nextSettings: DrawSessionSettings = { ...(currentSettings ?? {}), ...patch }
  const nextSettingsStr = JSON.stringify(nextSettings)

  db.prepare('UPDATE draw_sessions SET settings = ? WHERE id = ?').run(nextSettingsStr, id)

  return rowToSession({ ...row, settings: nextSettingsStr })
}

// ============================================================
// 抽取明细 CRUD
// ============================================================

/**
 * 创建单条抽取明细，v4 生成 id。
 * 支持 team_ids / team_stances / team_names（JSON 数组存储）/ group_id（分组模式）。
 *
 * P4-12: 同一会话内不允许同一 topic_id 重复。在代码层查重，
 *        而非添加 UNIQUE 索引（旧库可能存在重复数据导致建索引失败）。
 *        createSession 批量创建路径由调用方保证不重复。
 */
function createSessionItem(data: SessionItemCreateInput): DrawSessionItem {
  const db = getDb()
  const id = uuidv4()

  // P4-12: 查重 — 同一会话内同一辩题只能有一条明细
  const dupCheck = db
    .prepare('SELECT 1 FROM draw_session_items WHERE session_id = ? AND topic_id = ? LIMIT 1')
    .get(data.session_id, data.topic_id)
  if (dupCheck) {
    throw new Error(
      `[createSessionItem] 会话 ${data.session_id} 内辩题 ${data.topic_id} 已存在明细，不允许重复`
    )
  }

  const stmt = db.prepare(`
    INSERT INTO draw_session_items (id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b, topic_title, team_a_name, team_b_name, team_ids, team_stances, team_names, group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const teamIdsStr =
    data.team_ids && data.team_ids.length > 0 ? JSON.stringify(data.team_ids) : null
  const teamStancesStr =
    data.team_stances && data.team_stances.length > 0
      ? JSON.stringify(data.team_stances)
      : null
  const teamNamesStr =
    data.team_names && data.team_names.length > 0
      ? JSON.stringify(data.team_names)
      : null

  stmt.run(
    id,
    data.session_id,
    data.topic_id,
    data.team_a_id ?? null,
    data.team_b_id ?? null,
    data.stance_a ?? null,
    data.stance_b ?? null,
    data.topic_title ?? null,
    data.team_a_name ?? null,
    data.team_b_name ?? null,
    teamIdsStr,
    teamStancesStr,
    teamNamesStr,
    data.group_id ?? null
  )

  return {
    id,
    session_id: data.session_id,
    topic_id: data.topic_id,
    team_a_id: data.team_a_id ?? null,
    team_b_id: data.team_b_id ?? null,
    stance_a: data.stance_a ?? null,
    stance_b: data.stance_b ?? null,
    topic_title: data.topic_title ?? null,
    team_a_name: data.team_a_name ?? null,
    team_b_name: data.team_b_name ?? null,
    team_ids: data.team_ids ?? null,
    team_stances: data.team_stances ?? null,
    team_names: data.team_names ?? null,
    group_id: data.group_id ?? null
  }
}

/**
 * 列出某会话下的所有明细，按 id ASC 排序（保持插入顺序）。
 * team_ids JSON 字符串解析为数组返回。
 */
function listItemsBySession(sessionId: string): DrawSessionItem[] {
  const db = getDb()
  const stmt = db.prepare(
    'SELECT * FROM draw_session_items WHERE session_id = ? ORDER BY id ASC'
  )
  const rows = stmt.all(sessionId) as DrawItemRow[]
  return rows.map(rowToItem)
}

/**
 * Task 6.7：按 topic_id 查询最近一条多队模式（team_ids 非空）的抽取明细。
 *
 * 用于大屏多队渲染：当 timer session 关联了某辩题时，通过 topic_id 反查
 * 抽签明细，找到 team_ids 非空的 item 传给 BigScreenTimer。
 *
 * 排序策略：
 *   1. team_ids 非空（多队模式）优先
 *   2. 按 session 关联的 draw_time 倒序（取最新一次抽取）
 *
 * 返回 undefined 表示该辩题无任何抽取记录或无多队模式明细。
 */
function getItemByTopicId(topicId: string): DrawSessionItem | undefined {
  const db = getDb()
  // JOIN draw_sessions 取 draw_time 用于排序；team_ids 非空（JSON 字符串不为 NULL）优先
  const stmt = db.prepare(`
    SELECT dsi.*
    FROM draw_session_items dsi
    JOIN draw_sessions ds ON dsi.session_id = ds.id
    WHERE dsi.topic_id = ?
    ORDER BY (dsi.team_ids IS NULL) ASC, ds.draw_time DESC, dsi.id DESC
    LIMIT 1
  `)
  const row = stmt.get(topicId) as DrawItemRow | undefined
  return row ? rowToItem(row) : undefined
}

/**
 * 按 id 删除单条抽取明细。
 */
function deleteItem(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM draw_session_items WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

// ============================================================
// 已抽取辩题查询
// ============================================================

/**
 * 返回该赛事已抽取过的所有 topic_id（去重）。
 *
 * SQL:
 *   SELECT DISTINCT dsi.topic_id
 *   FROM draw_session_items dsi
 *   JOIN draw_sessions ds ON dsi.session_id = ds.id
 *   WHERE ds.event_id = ?
 *
 * 用于轮次不重复排除逻辑。
 */
function listDrawnTopicIdsByEvent(eventId: string): string[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT DISTINCT dsi.topic_id
    FROM draw_session_items dsi
    JOIN draw_sessions ds ON dsi.session_id = ds.id
    WHERE ds.event_id = ?
  `)
  const rows = stmt.all(eventId) as Array<{ topic_id: string }>
  return rows.map((r) => r.topic_id)
}

/**
 * 清空所有抽取会话。
 *
 * 在**单个事务**中执行：
 *   1. 先删除 team_history（无外键约束，必须手动清理，避免残留）
 *   2. 再删除 draw_sessions（schema 中已有 ON DELETE CASCADE，会自动级联删除 draw_session_items）
 *
 * @returns 删除的会话行数
 */
function clearAllSessions(): number {
  const db = getDb()
  const deleteHistoryStmt = db.prepare('DELETE FROM team_history')
  const deleteSessionsStmt = db.prepare('DELETE FROM draw_sessions')

  const tx = db.transaction(() => {
    // 1. 先删除 team_history（session_id 为普通 TEXT 列，无外键约束）
    deleteHistoryStmt.run()
    // 2. 再删除 sessions（CASCADE 自动清理 draw_session_items）
    const result = deleteSessionsStmt.run()
    return result.changes
  })

  return tx()
}

// ============================================================
// 备份与恢复（全量数据导入导出）
// ============================================================

/**
 * 备份用：一次性返回 draw_sessions / draw_session_items / team_history 三张表的全部行。
 * team_history 也归入 draw_records 类别（与抽取强关联）。
 * 返回 DB 原始格式（settings / team_ids 等为 JSON 字符串）。
 */
function findAllForBackup(): {
  draw_sessions: Record<string, unknown>[]
  draw_session_items: Record<string, unknown>[]
  team_history: Record<string, unknown>[]
} {
  const db = getDb()
  return {
    draw_sessions: db.prepare('SELECT * FROM draw_sessions').all() as Record<string, unknown>[],
    draw_session_items: db
      .prepare('SELECT * FROM draw_session_items')
      .all() as Record<string, unknown>[],
    team_history: db.prepare('SELECT * FROM team_history').all() as Record<string, unknown>[]
  }
}

/**
 * 批量恢复 draw_sessions / draw_session_items / team_history 表。
 * 调用方需在外层事务内执行。
 */
function bulkRestore(
  table: 'draw_sessions' | 'draw_session_items' | 'team_history',
  rows: Array<Record<string, unknown>>,
  strategy: BackupImportStrategy
): number {
  return bulkInsert(table, rows, strategy)
}

// ============================================================
// 导出
// ============================================================

export const drawRepo = {
  // 会话 CRUD
  createSession,
  getSessionById,
  listSessions,
  deleteSession,
  updateSessionSettings,
  // 明细 CRUD
  createSessionItem,
  listItemsBySession,
  getItemByTopicId,
  deleteItem,
  // 已抽取辩题查询
  listDrawnTopicIdsByEvent,
  // 清空
  clearAllSessions,
  // 备份与恢复
  findAllForBackup,
  bulkRestore
}
