import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type { DrawSessionSettings } from '../../../shared/types'

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
 */
function rowToSession(row: DrawRow): DrawSession {
  return {
    ...row,
    settings: row.settings ? JSON.parse(row.settings) : null
  }
}

/**
 * DB row -> DrawSessionItem（无转换需求，直接透传）
 */
function rowToItem(row: DrawItemRow): DrawSessionItem {
  return { ...row }
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
    INSERT INTO draw_session_items (id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b)
    VALUES (?, ?, ?, ?, ?, ?, ?)
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
      insertItem.run(
        item.id,
        item.session_id,
        item.topic_id,
        item.team_a_id ?? null,
        item.team_b_id ?? null,
        item.stance_a ?? null,
        item.stance_b ?? null
      )
    }
  })
  tx()

  // 返回完整详情（避免再查一次库）
  return {
    ...rowToSession({
      id: sessionId,
      event_id: input.event_id,
      round_id: input.round_id ?? null,
      draw_time: drawTime,
      operator: input.operator ?? null,
      settings: settingsStr
    }),
    items: itemsWithIds.map(rowToItem)
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
 * 按 id 删除抽取会话。
 * 依赖外键 ON DELETE CASCADE 自动级联删除 draw_session_items。
 * 返回是否删除成功。
 */
function deleteSession(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM draw_sessions WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

// ============================================================
// 抽取明细 CRUD
// ============================================================

/**
 * 创建单条抽取明细，v4 生成 id。
 */
function createSessionItem(data: SessionItemCreateInput): DrawSessionItem {
  const db = getDb()
  const id = uuidv4()

  const stmt = db.prepare(`
    INSERT INTO draw_session_items (id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.session_id,
    data.topic_id,
    data.team_a_id ?? null,
    data.team_b_id ?? null,
    data.stance_a ?? null,
    data.stance_b ?? null
  )

  return {
    id,
    session_id: data.session_id,
    topic_id: data.topic_id,
    team_a_id: data.team_a_id ?? null,
    team_b_id: data.team_b_id ?? null,
    stance_a: data.stance_a ?? null,
    stance_b: data.stance_b ?? null
  }
}

/**
 * 列出某会话下的所有明细，按 id ASC 排序（保持插入顺序）。
 */
function listItemsBySession(sessionId: string): DrawSessionItem[] {
  const db = getDb()
  const stmt = db.prepare(
    'SELECT * FROM draw_session_items WHERE session_id = ? ORDER BY id ASC'
  )
  return stmt.all(sessionId) as DrawSessionItem[]
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

// ============================================================
// 导出
// ============================================================

export const drawRepo = {
  // 会话 CRUD
  createSession,
  getSessionById,
  listSessions,
  deleteSession,
  // 明细 CRUD
  createSessionItem,
  listItemsBySession,
  deleteItem,
  // 已抽取辩题查询
  listDrawnTopicIdsByEvent
}
