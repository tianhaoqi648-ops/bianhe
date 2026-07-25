import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'

// ============================================================
// 类型定义
// ============================================================

export interface Event {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  status: string | null
  created_at: string | null
}

export interface Round {
  id: string
  event_id: string
  name: string | null
  round_number: number | null
  difficulty_override: string | null
  topic_count: number | null
}

export interface Team {
  id: string
  name: string
  event_id: string
}

export interface TeamHistory {
  id: string
  team_id: string
  topic_id: string
  event_id: string
  played_at: string | null
}

// 输入类型
export type EventCreateInput = Omit<Event, 'id' | 'created_at'>
export type EventUpdateInput = Partial<Omit<Event, 'id' | 'created_at'>>
export type RoundCreateInput = Omit<Round, 'id'>
export type RoundUpdateInput = Partial<Omit<Round, 'id' | 'event_id'>>
export type TeamCreateInput = Omit<Team, 'id'>
export type TeamUpdateInput = Partial<Omit<Team, 'id' | 'event_id'>>
export type TeamHistoryCreateInput = Omit<TeamHistory, 'id'>

// 过滤类型
export interface EventFilter {
  status?: string
  page?: number
  pageSize?: number
}

// ============================================================
// 赛事 CRUD
// ============================================================

/**
 * 创建赛事。
 * - v4 生成 id
 * - 自动写入 created_at（ISO 8601）
 */
function createEvent(data: EventCreateInput): Event {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO events (id, name, start_date, end_date, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmt.run(id, data.name, data.start_date ?? null, data.end_date ?? null, data.status ?? null, now)

  const created = getEventById(id)
  if (!created) {
    throw new Error(`[eventRepo] createEvent: insert succeeded but row not found, id=${id}`)
  }
  return created
}

/**
 * 按 id 查询赛事。
 */
function getEventById(id: string): Event | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM events WHERE id = ?')
  const row = stmt.get(id) as Event | undefined
  return row
}

/**
 * 列表查询赛事。
 * - 可按 status 过滤
 * - 分页（默认 page=1, pageSize=20）
 * - 按 created_at DESC 排序
 */
function listEvents(filter?: EventFilter): { items: Event[]; total: number } {
  const db = getDb()

  const conditions: string[] = []
  const params: any[] = []

  if (filter?.status !== undefined) {
    conditions.push('status = ?')
    params.push(filter.status)
  }

  const where = `WHERE 1=1${conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : ''}`

  const page = filter?.page && filter.page > 0 ? filter.page : 1
  const pageSize = filter?.pageSize && filter.pageSize > 0 ? filter.pageSize : 20
  const offset = (page - 1) * pageSize

  const listStmt = db.prepare(`
    SELECT * FROM events
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `)
  const items = listStmt.all(...params, pageSize, offset) as Event[]

  const countStmt = db.prepare(`SELECT COUNT(*) AS total FROM events ${where}`)
  const countRow = countStmt.get(...params) as any
  const total = countRow ? Number(countRow.total) : 0

  return { items, total }
}

/**
 * 按 id 更新赛事，仅更新 data 中非 undefined 的字段。
 * 列名走白名单，值走 ? 占位符。
 */
function updateEvent(id: string, data: EventUpdateInput): Event | undefined {
  const db = getDb()

  const allowedKeys: Array<keyof EventUpdateInput> = ['name', 'start_date', 'end_date', 'status']

  const setColumns: string[] = []
  const params: any[] = []

  for (const key of allowedKeys) {
    const value = data[key]
    if (value !== undefined) {
      setColumns.push(`${key} = ?`)
      params.push(value)
    }
  }

  if (setColumns.length === 0) {
    return getEventById(id)
  }

  params.push(id)
  const stmt = db.prepare(`UPDATE events SET ${setColumns.join(', ')} WHERE id = ?`)
  stmt.run(...params)

  return getEventById(id)
}

/**
 * 按 id 删除赛事。
 * 依赖外键 ON DELETE CASCADE 自动级联删除 rounds/teams/team_history。
 */
function deleteEvent(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM events WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

// ============================================================
// 轮次 CRUD
// ============================================================

/**
 * 创建轮次，v4 生成 id。
 */
function createRound(data: RoundCreateInput): Round {
  const db = getDb()
  const id = uuidv4()

  const stmt = db.prepare(`
    INSERT INTO rounds (id, event_id, name, round_number, difficulty_override, topic_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.event_id,
    data.name ?? null,
    data.round_number ?? null,
    data.difficulty_override ?? null,
    data.topic_count ?? null
  )

  const created = getRoundById(id)
  if (!created) {
    throw new Error(`[eventRepo] createRound: insert succeeded but row not found, id=${id}`)
  }
  return created
}

/**
 * 按 id 查询轮次。
 */
function getRoundById(id: string): Round | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM rounds WHERE id = ?')
  const row = stmt.get(id) as Round | undefined
  return row
}

/**
 * 按赛事列出所有轮次，按 round_number ASC 排序。
 */
function listRoundsByEvent(eventId: string): Round[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM rounds WHERE event_id = ? ORDER BY round_number ASC')
  return stmt.all(eventId) as Round[]
}

/**
 * 按 id 更新轮次。
 * 不允许修改 event_id（按类型定义约束），其余字段走白名单动态 SET。
 */
function updateRound(id: string, data: RoundUpdateInput): Round | undefined {
  const db = getDb()

  const allowedKeys: Array<keyof RoundUpdateInput> = [
    'name',
    'round_number',
    'difficulty_override',
    'topic_count'
  ]

  const setColumns: string[] = []
  const params: any[] = []

  for (const key of allowedKeys) {
    const value = data[key]
    if (value !== undefined) {
      setColumns.push(`${key} = ?`)
      params.push(value)
    }
  }

  if (setColumns.length === 0) {
    return getRoundById(id)
  }

  params.push(id)
  const stmt = db.prepare(`UPDATE rounds SET ${setColumns.join(', ')} WHERE id = ?`)
  stmt.run(...params)

  return getRoundById(id)
}

/**
 * 按 id 删除轮次。
 */
function deleteRound(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM rounds WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

// ============================================================
// 队伍 CRUD
// ============================================================

/**
 * 创建队伍，v4 生成 id。
 */
function createTeam(data: TeamCreateInput): Team {
  const db = getDb()
  const id = uuidv4()

  const stmt = db.prepare(`
    INSERT INTO teams (id, name, event_id)
    VALUES (?, ?, ?)
  `)

  stmt.run(id, data.name, data.event_id)

  const created = getTeamById(id)
  if (!created) {
    throw new Error(`[eventRepo] createTeam: insert succeeded but row not found, id=${id}`)
  }
  return created
}

/**
 * 按 id 查询队伍。
 */
function getTeamById(id: string): Team | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM teams WHERE id = ?')
  const row = stmt.get(id) as Team | undefined
  return row
}

/**
 * 按赛事列出所有队伍，按 name ASC 排序。
 */
function listTeamsByEvent(eventId: string): Team[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM teams WHERE event_id = ? ORDER BY name ASC')
  return stmt.all(eventId) as Team[]
}

/**
 * 按 id 更新队伍。
 * 不允许修改 event_id（按类型定义约束），仅允许修改 name。
 */
function updateTeam(id: string, data: TeamUpdateInput): Team | undefined {
  const db = getDb()

  const allowedKeys: Array<keyof TeamUpdateInput> = ['name']

  const setColumns: string[] = []
  const params: any[] = []

  for (const key of allowedKeys) {
    const value = data[key]
    if (value !== undefined) {
      setColumns.push(`${key} = ?`)
      params.push(value)
    }
  }

  if (setColumns.length === 0) {
    return getTeamById(id)
  }

  params.push(id)
  const stmt = db.prepare(`UPDATE teams SET ${setColumns.join(', ')} WHERE id = ?`)
  stmt.run(...params)

  return getTeamById(id)
}

/**
 * 按 id 删除队伍。
 */
function deleteTeam(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM teams WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

// ============================================================
// 队伍历史 CRUD
// ============================================================

/**
 * 记录一条队伍历史（已抽过的辩题），v4 生成 id。
 */
function addTeamHistory(data: TeamHistoryCreateInput): TeamHistory {
  const db = getDb()
  const id = uuidv4()

  const stmt = db.prepare(`
    INSERT INTO team_history (id, team_id, topic_id, event_id, played_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  stmt.run(id, data.team_id, data.topic_id, data.event_id, data.played_at ?? null)

  const created = getTeamHistoryById(id)
  if (!created) {
    throw new Error(`[eventRepo] addTeamHistory: insert succeeded but row not found, id=${id}`)
  }
  return created
}

/**
 * 按 id 查询队伍历史（内部辅助）。
 */
function getTeamHistoryById(id: string): TeamHistory | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM team_history WHERE id = ?')
  const row = stmt.get(id) as TeamHistory | undefined
  return row
}

/**
 * 列出某队伍的全部历史辩题（跨赛事累积），按 played_at DESC 排序。
 *
 * SQL: SELECT * FROM team_history WHERE team_id = ? ORDER BY played_at DESC
 *
 * 说明：team_history.event_id 仅用于标识记录产生的赛事，本查询不限制 event_id，
 * 因此可跨赛事累积返回该队伍的所有历史辩题记录。
 */
function listTeamHistory(teamId: string): TeamHistory[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM team_history WHERE team_id = ? ORDER BY played_at DESC')
  return stmt.all(teamId) as TeamHistory[]
}

/**
 * 列出某赛事下所有队伍的历史记录，按 played_at DESC 排序。
 */
function listTeamHistoryByEvent(eventId: string): TeamHistory[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM team_history WHERE event_id = ? ORDER BY played_at DESC')
  return stmt.all(eventId) as TeamHistory[]
}

/**
 * 按 id 删除一条队伍历史记录。
 */
function deleteTeamHistory(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM team_history WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

// ============================================================
// 导出
// ============================================================

export const eventRepo = {
  // 赛事
  createEvent,
  getEventById,
  listEvents,
  updateEvent,
  deleteEvent,
  // 轮次
  createRound,
  getRoundById,
  listRoundsByEvent,
  updateRound,
  deleteRound,
  // 队伍
  createTeam,
  getTeamById,
  listTeamsByEvent,
  updateTeam,
  deleteTeam,
  // 队伍历史
  addTeamHistory,
  listTeamHistory,
  listTeamHistoryByEvent,
  deleteTeamHistory
}
