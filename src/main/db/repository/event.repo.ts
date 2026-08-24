import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type {
  RandomAssignGroupResult,
  BackupImportStrategy,
  EventStats
} from '../../../shared/types'
import { bulkInsert } from './utils'

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
  /** 是否允许辩题重复（0=不允许, 1=允许，对应有放回抽样） */
  allow_repeat: number
}

/** DB events 表的原始行类型 */
export interface EventRow {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  status: string | null
  created_at: string | null
  allow_repeat: number
}

export interface Round {
  id: string
  event_id: string
  name: string | null
  round_number: number | null
  difficulty_override: string | null
  topic_count: number | null
  /** 是否为循环赛轮次（DB 中存为 0/1，应用层使用 boolean） */
  is_round_robin?: boolean
}

/** DB rounds 表的原始行类型（is_round_robin 为 0/1 整数，未转换为 boolean） */
export interface RoundRow {
  id: string
  event_id: string
  name: string | null
  round_number: number | null
  difficulty_override: string | null
  topic_count: number | null
  is_round_robin: number
}

/**
 * DB row -> Round
 * - is_round_robin: 0/1 整数 -> boolean
 */
function rowToRound(row: RoundRow): Round {
  return {
    id: row.id,
    event_id: row.event_id,
    name: row.name,
    round_number: row.round_number,
    difficulty_override: row.difficulty_override,
    topic_count: row.topic_count,
    is_round_robin: !!row.is_round_robin
  }
}

export interface Team {
  id: string
  name: string
  event_id: string
  /** 所属分组 id（可空，未分组为 null） */
  group_id?: string | null
}

/** 队伍分组（赛事维度，多队同题抽取时使用） */
export interface TeamGroup {
  id: string
  event_id: string
  name: string
  sort_order: number
  created_at: string
}

export type TeamGroupCreateInput = Omit<TeamGroup, 'id' | 'created_at'>
export type TeamGroupUpdateInput = Partial<Omit<TeamGroup, 'id' | 'event_id' | 'created_at'>>

export interface TeamHistory {
  id: string
  team_id: string
  topic_id: string
  event_id: string
  played_at: string | null
  /** 关联抽取会话 id，用于确认结果时关联去重（重抽时先按 session_id 删旧再写新） */
  session_id?: string | null
  /** 持方快照：正方/反方（确认抽取结果时从 DrawSessionItem.stance_a/stance_b 复制） */
  stance?: string | null
  /** 冗余快照：辩题标题（辩题被删除后历史仍可显示原标题） */
  topic_title?: string | null
}

// 输入类型
// allow_repeat 在 Event 上为必填（DB NOT NULL DEFAULT 0），但创建入参允许省略：
//   省略时 createEvent 内部归一化为 0（不允许重复），避免破坏既有不传该字段的调用方
export type EventCreateInput = Omit<Event, 'id' | 'created_at' | 'allow_repeat'> & {
  allow_repeat?: number
}
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
 * 创建赛事（单库单动作）。
 * - v4 生成 id
 * - 自动写入 created_at（ISO 8601）
 * - 仅写入 events 表；「创建即绑定默认题库」的跨库编排见 services/event-service.ts
 */
function createEvent(data: EventCreateInput): Event {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()

  // allow_repeat：未传值时默认 0（不允许重复），传 boolean/number 时归一化为 0/1
  const allowRepeat = data.allow_repeat ? 1 : 0

  db.prepare(`
    INSERT INTO events (id, name, start_date, end_date, status, created_at, allow_repeat)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.start_date ?? null,
    data.end_date ?? null,
    data.status ?? null,
    now,
    allowRepeat
  )

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
  const countRow = countStmt.get(...params) as { total: number } | undefined
  const total = countRow ? Number(countRow.total) : 0

  return { items, total }
}

/**
 * 按 id 更新赛事，仅更新 data 中非 undefined 的字段。
 * 列名走白名单，值走 ? 占位符。
 * allow_repeat 在 DB 中存为 0/1 整数，此处从 boolean/number 归一化。
 */
function updateEvent(id: string, data: EventUpdateInput): Event | undefined {
  const db = getDb()

  const allowedKeys: Array<keyof EventUpdateInput> = [
    'name',
    'start_date',
    'end_date',
    'status',
    'allow_repeat'
  ]

  const setColumns: string[] = []
  const params: any[] = []

  for (const key of allowedKeys) {
    const value = data[key]
    if (value !== undefined) {
      if (key === 'allow_repeat') {
        // boolean / number -> 0/1 整数存储
        setColumns.push(`${key} = ?`)
        params.push(value ? 1 : 0)
      } else {
        setColumns.push(`${key} = ?`)
        params.push(value)
      }
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
    INSERT INTO rounds (id, event_id, name, round_number, difficulty_override, topic_count, is_round_robin)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.event_id,
    data.name ?? null,
    data.round_number ?? null,
    data.difficulty_override ?? null,
    data.topic_count ?? null,
    data.is_round_robin ? 1 : 0
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
  const row = stmt.get(id) as RoundRow | undefined
  return row ? rowToRound(row) : undefined
}

/**
 * 按赛事列出所有轮次，按 round_number ASC 排序。
 */
function listRoundsByEvent(eventId: string): Round[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM rounds WHERE event_id = ? ORDER BY round_number ASC')
  const rows = stmt.all(eventId) as RoundRow[]
  return rows.map(rowToRound)
}

/**
 * 按 id 更新轮次。
 * 不允许修改 event_id（按类型定义约束），其余字段走白名单动态 SET。
 * is_round_robin 在 DB 中存为 0/1 整数，此处从 boolean 转换。
 */
function updateRound(id: string, data: RoundUpdateInput): Round | undefined {
  const db = getDb()

  const allowedKeys: Array<keyof RoundUpdateInput> = [
    'name',
    'round_number',
    'difficulty_override',
    'topic_count',
    'is_round_robin'
  ]

  const setColumns: string[] = []
  const params: any[] = []

  for (const key of allowedKeys) {
    const value = data[key]
    if (value !== undefined) {
      if (key === 'is_round_robin') {
        // boolean -> 0/1 整数存储
        setColumns.push(`${key} = ?`)
        params.push(value ? 1 : 0)
      } else {
        setColumns.push(`${key} = ?`)
        params.push(value)
      }
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
// 赛事批量统计
// ============================================================

/**
 * 批量统计多个赛事的 轮次数 / 队伍数 / 已完成轮数。
 *
 * 用三条按 event_id 分组的聚合 SQL 一次完成，避免 N+1（原先前端对每个赛事 ×3 组 IPC）。
 * - rounds：COUNT(*) FROM rounds GROUP BY event_id
 * - teams：COUNT(*) FROM teams GROUP BY event_id
 * - 已完成轮数：COUNT(DISTINCT round_id) FROM draw_sessions
 *   与 EventManage 卡片进度环的语义一致（有抽取会话命中的去重轮次数）。
 *
 * @returns Map<eventId, EventStats>；包含全部入参 eventId（无数据则计数为 0）。
 */
function getEventStats(eventIds: string[]): Map<string, EventStats> {
  const db = getDb()
  const map = new Map<string, EventStats>()
  if (!eventIds || eventIds.length === 0) return map

  // 预置所有入参赛事，保证调用方读到每一项（缺数据时计数为 0，前端优雅降级）
  for (const id of eventIds) {
    map.set(id, { event_id: id, round_count: 0, team_count: 0, done_session_count: 0 })
  }

  const placeholders = eventIds.map(() => '?').join(',')

  // 1. 轮次数
  const roundRows = db
    .prepare(
      `SELECT event_id, COUNT(*) AS cnt FROM rounds WHERE event_id IN (${placeholders}) GROUP BY event_id`
    )
    .all(...eventIds) as Array<{ event_id: string; cnt: number }>
  for (const r of roundRows) {
    const row = map.get(r.event_id)
    if (row) row.round_count = Number(r.cnt)
  }

  // 2. 队伍数
  const teamRows = db
    .prepare(
      `SELECT event_id, COUNT(*) AS cnt FROM teams WHERE event_id IN (${placeholders}) GROUP BY event_id`
    )
    .all(...eventIds) as Array<{ event_id: string; cnt: number }>
  for (const r of teamRows) {
    const row = map.get(r.event_id)
    if (row) row.team_count = Number(r.cnt)
  }

  // 3. 已完成轮数 = 有抽取会话（round_id 命中）的去重轮次数
  const doneRows = db
    .prepare(
      `SELECT event_id, COUNT(DISTINCT round_id) AS cnt FROM draw_sessions WHERE event_id IN (${placeholders}) AND round_id IS NOT NULL GROUP BY event_id`
    )
    .all(...eventIds) as Array<{ event_id: string; cnt: number }>
  for (const r of doneRows) {
    const row = map.get(r.event_id)
    if (row) row.done_session_count = Number(r.cnt)
  }

  return map
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
    INSERT INTO teams (id, name, event_id, group_id)
    VALUES (?, ?, ?, ?)
  `)

  stmt.run(id, data.name, data.event_id, data.group_id ?? null)

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
 * 可选 group_id 过滤：
 *   - undefined：返回全部队伍
 *   - null：仅返回未分组（group_id IS NULL）的队伍
 *   - string：仅返回指定分组的队伍
 */
function listTeamsByEvent(eventId: string, filter?: { group_id?: string | null }): Team[] {
  const db = getDb()
  if (filter && filter.group_id !== undefined) {
    if (filter.group_id === null) {
      const stmt = db.prepare(
        'SELECT * FROM teams WHERE event_id = ? AND group_id IS NULL ORDER BY name ASC'
      )
      return stmt.all(eventId) as Team[]
    }
    const stmt = db.prepare(
      'SELECT * FROM teams WHERE event_id = ? AND group_id = ? ORDER BY name ASC'
    )
    return stmt.all(eventId, filter.group_id) as Team[]
  }
  const stmt = db.prepare('SELECT * FROM teams WHERE event_id = ? ORDER BY name ASC')
  return stmt.all(eventId) as Team[]
}

/**
 * 按 id 更新队伍。
 * 不允许修改 event_id（按类型定义约束），仅允许修改 name / group_id。
 * group_id 传 null 表示移出分组。
 */
function updateTeam(id: string, data: TeamUpdateInput): Team | undefined {
  const db = getDb()

  const allowedKeys: Array<keyof TeamUpdateInput> = ['name', 'group_id']

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
// 队伍分组 CRUD
// ============================================================

/**
 * 按 id 查询分组（内部辅助）。
 */
function getGroupById(id: string): TeamGroup | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM team_groups WHERE id = ?')
  return stmt.get(id) as TeamGroup | undefined
}

/**
 * 列出某赛事下的所有分组，按 sort_order ASC, created_at ASC 排序。
 */
function listGroupsByEvent(eventId: string): TeamGroup[] {
  const db = getDb()
  const stmt = db.prepare(
    'SELECT * FROM team_groups WHERE event_id = ? ORDER BY sort_order ASC, created_at ASC'
  )
  return stmt.all(eventId) as TeamGroup[]
}

/**
 * 创建分组，v4 生成 id。
 */
function createGroup(input: TeamGroupCreateInput): TeamGroup {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO team_groups (id, event_id, name, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(id, input.event_id, input.name, input.sort_order ?? 0, now)

  const created = getGroupById(id)
  if (!created) {
    throw new Error(`[eventRepo] createGroup: insert succeeded but row not found, id=${id}`)
  }
  return created
}

/**
 * 按 id 更新分组，仅更新 patch 中非 undefined 的字段（name / sort_order）。
 */
function updateGroup(id: string, patch: TeamGroupUpdateInput): TeamGroup | undefined {
  const db = getDb()
  const allowedKeys: Array<keyof TeamGroupUpdateInput> = ['name', 'sort_order']
  const setColumns: string[] = []
  const params: any[] = []

  for (const key of allowedKeys) {
    const value = patch[key]
    if (value !== undefined) {
      setColumns.push(`${key} = ?`)
      params.push(value)
    }
  }

  if (setColumns.length === 0) {
    return getGroupById(id)
  }

  params.push(id)
  db.prepare(`UPDATE team_groups SET ${setColumns.join(', ')} WHERE id = ?`).run(...params)

  return getGroupById(id)
}

/**
 * 按 id 删除分组。
 * teams.group_id 外键 ON DELETE SET NULL，相关队伍的 group_id 自动置空。
 */
function deleteGroup(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM team_groups WHERE id = ?').run(id)
}

/**
 * 将队伍分配到分组（或传 null 移出分组）。
 */
function assignTeamToGroup(teamId: string, groupId: string | null): void {
  const db = getDb()
  db.prepare('UPDATE teams SET group_id = ? WHERE id = ?').run(groupId, teamId)
}

// ============================================================
// 队伍历史 CRUD
// ============================================================

/**
 * 记录一条队伍历史（已抽过的辩题），v4 生成 id。
 *
 * 可选 session_id：当由"确定抽取结果"流程写入时传入，用于后续重抽时按 session_id
 * 关联删除旧历史（避免历史无限累积）。
 */
function addTeamHistory(data: TeamHistoryCreateInput): TeamHistory {
  const db = getDb()
  const id = uuidv4()

  // topic_title 未显式传入时从 topics 回填，保证辩题被删除后历史仍可显示原标题
  const topicTitle = data.topic_title ?? (
    db.prepare('SELECT title FROM topics WHERE id = ?').get(data.topic_id) as { title: string } | undefined
  )?.title ?? null

  const stmt = db.prepare(`
    INSERT INTO team_history (id, team_id, topic_id, event_id, played_at, session_id, stance, topic_title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.team_id,
    data.topic_id,
    data.event_id,
    data.played_at ?? null,
    data.session_id ?? null,
    data.stance ?? null,
    topicTitle
  )

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

/**
 * 按 session_id 删除该抽取会话关联的所有队伍历史记录。
 *
 * 用于"确定抽取结果"流程的重抽场景：先按 session_id 删旧历史，再写入新历史，
 * 避免同一 session 在历史表里累积多份记录。
 *
 * @returns 删除的行数
 */
function deleteTeamHistoryBySession(sessionId: string): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM team_history WHERE session_id = ?')
  const result = stmt.run(sessionId)
  return result.changes
}

// ============================================================
// 随机分组
// ============================================================

/**
 * 随机分组：将赛事下的队伍随机分配到多个分组。
 *
 * 逻辑：
 * 1. 查询所有队伍（如 overwrite=false 仅查 group_id IS NULL 的）
 * 2. Fisher-Yates 打乱队伍顺序
 * 3. 按 strategy 计算分组数：
 *    - by_group_count: 组数 = count
 *    - by_team_count: 组数 = Math.ceil(teams.length / count)
 * 4. 计算每组队伍数: base = Math.floor(teams.length / groupCount), extra = teams.length % groupCount
 *    - 前 extra 组分 base+1 队，其余组分 base 队
 * 5. 生成分组名：默认 A 组、B 组、C 组...（如 groupNames 提供则使用）
 * 6. 构建 groups_plan: [{ name, team_ids, team_names }]
 * 7. 如 dryRun=true: 直接返回 { groups_plan, groups_created: 0, teams_assigned: 0 }
 * 8. 如 dryRun=false: 事务内执行：
 *    - 对每个分组：如已有同名分组则复用 id；否则新建分组
 *    - 批量 UPDATE teams SET group_id = ? WHERE id = ?
 *    - 返回 { groups_plan, groups_created, teams_assigned }
 */
function randomAssignGroups(
  eventId: string,
  strategy: 'by_group_count' | 'by_team_count',
  count: number,
  groupNames: string[] | undefined,
  overwrite: boolean,
  dryRun: boolean = false
): RandomAssignGroupResult {
  const db = getDb()

  // 1. 查询队伍（overwrite=false 时仅查未分组的）
  const teams = overwrite
    ? listTeamsByEvent(eventId)
    : listTeamsByEvent(eventId, { group_id: null })

  // 2. Fisher-Yates 打乱队伍顺序
  // 注：此处刻意使用 Math.random 而非 probability.ts 中的工具，保持简单。
  //     未来如需统一随机源（如可种子化随机），可改用 probability.ts 提供的方法。
  const shuffled = [...teams]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // 3. 按 strategy 计算分组数
  let groupCount: number
  if (strategy === 'by_group_count') {
    groupCount = count
  } else {
    // by_team_count: 每组最多 count 队
    groupCount = Math.ceil(shuffled.length / count)
  }

  // 无队伍或无分组时返回空结果
  if (shuffled.length === 0 || groupCount <= 0) {
    return {
      groups_plan: [],
      groups_created: 0,
      teams_assigned: 0
    }
  }

  // 4. 计算每组队伍数
  const base = Math.floor(shuffled.length / groupCount)
  const extra = shuffled.length % groupCount

  // 5. 构建 groups_plan
  const groupsPlan: Array<{ name: string; team_ids: string[]; team_names: string[] }> = []
  let teamIndex = 0
  for (let g = 0; g < groupCount; g++) {
    const teamCountForGroup = g < extra ? base + 1 : base
    const groupTeams = shuffled.slice(teamIndex, teamIndex + teamCountForGroup)
    teamIndex += teamCountForGroup

    const name =
      groupNames && groupNames[g] ? groupNames[g] : `${String.fromCharCode(65 + g)} 组`
    groupsPlan.push({
      name,
      team_ids: groupTeams.map((t) => t.id),
      team_names: groupTeams.map((t) => t.name)
    })
  }

  // 7. dryRun 直接返回（teams_assigned 反映实际待分配队伍数，而非 0）
  if (dryRun) {
    return {
      groups_plan: groupsPlan,
      groups_created: 0,
      teams_assigned: shuffled.length
    }
  }

  // 8. 事务内执行
  let groupsCreated = 0
  let teamsAssigned = 0
  const updateStmt = db.prepare('UPDATE teams SET group_id = ? WHERE id = ?')

  const tx = db.transaction(() => {
    for (const plan of groupsPlan) {
      // 查找已有同名分组
      const existing = db
        .prepare('SELECT id FROM team_groups WHERE event_id = ? AND name = ?')
        .get(eventId, plan.name) as { id: string } | undefined

      let groupId: string
      if (existing) {
        groupId = existing.id
      } else {
        // 新建分组
        groupId = uuidv4()
        const now = new Date().toISOString()
        db.prepare(
          'INSERT INTO team_groups (id, event_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(groupId, eventId, plan.name, 0, now)
        groupsCreated++
      }

      // 批量更新队伍 group_id
      for (const teamId of plan.team_ids) {
        updateStmt.run(groupId, teamId)
        teamsAssigned++
      }
    }
  })
  tx()

  return {
    groups_plan: groupsPlan,
    groups_created: groupsCreated,
    teams_assigned: teamsAssigned
  }
}

/**
 * 清空所有赛事。
 * 依赖外键 ON DELETE CASCADE 自动级联删除 rounds/teams/team_history/draw_sessions/draw_session_items。
 * @returns 删除的赛事行数
 */
function clearAllEvents(): number {
  const db = getDb()
  const r = db.prepare(`DELETE FROM events`).run()
  return r.changes
}

// ============================================================
// 备份与恢复（全量数据导入导出）
// ============================================================

/**
 * 备份用：一次性返回 events / rounds / team_groups / teams 四张表的全部行（DB 原始格式）。
 * 注意：返回的 rounds/team_groups/teams 包含原始整数列（如 is_round_robin 0/1），
 * 导出/导入时保留原始格式以便还原。
 */
function findAllForBackup(): {
  events: Record<string, unknown>[]
  rounds: Record<string, unknown>[]
  team_groups: Record<string, unknown>[]
  teams: Record<string, unknown>[]
} {
  const db = getDb()
  return {
    events: db.prepare('SELECT * FROM events').all() as Record<string, unknown>[],
    rounds: db.prepare('SELECT * FROM rounds').all() as Record<string, unknown>[],
    team_groups: db.prepare('SELECT * FROM team_groups').all() as Record<string, unknown>[],
    teams: db.prepare('SELECT * FROM teams').all() as Record<string, unknown>[]
  }
}

/**
 * 批量恢复 events / rounds / team_groups / teams 表。
 * 调用方需在外层事务内执行。
 */
function bulkRestore(
  table: 'events' | 'rounds' | 'team_groups' | 'teams',
  rows: Array<Record<string, unknown>>,
  strategy: BackupImportStrategy
): number {
  return bulkInsert(table, rows, strategy)
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
  // 赛事批量统计
  getEventStats,
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
  // 队伍分组
  getGroupById,
  listGroupsByEvent,
  createGroup,
  updateGroup,
  deleteGroup,
  assignTeamToGroup,
  // 队伍历史
  addTeamHistory,
  listTeamHistory,
  listTeamHistoryByEvent,
  deleteTeamHistory,
  deleteTeamHistoryBySession,
  // 随机分组
  randomAssignGroups,
  // 清空
  clearAllEvents,
  // 备份与恢复
  findAllForBackup,
  bulkRestore
}
