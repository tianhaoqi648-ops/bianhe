// ============================================================
// topic-group.repo.ts — 题组（题库）CRUD / 成员 / 赛事绑定 / 默认题库
//
// 背景：为支持「赛事级题库」（Event Topic Bank），引入三个全局概念：
//   - 题组（topic_groups）：可复用、可绑多个赛事的题库，含默认标记 is_default
//   - 题组成员（topic_group_items）：题组 ↔ 辩题 多对多
//   - 赛事绑定（event_topic_groups）：赛事 ↔ 题组 多对多
//
// 接口：
//   - 题组 CRUD：list / createGroup / rename / delete / getDefault
//   - 成员：addTopicsToGroup / removeTopicsFromGroup / listTopicIdsByGroup / listTopicsByGroup
//   - 赛事绑定：bindEventGroups / unbindEventGroup / listGroupsByEvent / listEventIdsByGroup
//   - 备份：findAllForBackup（三表原始行）
//   - 默认归入：ensureTopicInDefaultGroup / ensureTopicsInDefaultGroup
//
// 风格与 judge-history.repo / match.repo 对齐：getDb() 取库、row 类型、async 风格同步执行。
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import { validateBankConfig } from '../../../shared/config-validator'

/** 默认题库固定 id（与 migration 20260913 种子共用，保证幂等）。 */
export const DEFAULT_TOPIC_GROUP_ID = 'default-group'
export const DEFAULT_TOPIC_GROUP_NAME = '默认题库'

// ============================================================
// 类型 & 映射
// ============================================================

export interface TopicGroup {
  id: string
  name: string
  isDefault: boolean
  createdAt: string | null
}

interface TopicGroupRow {
  id: string
  name: string
  is_default: number
  created_at: string | null
}

function rowToGroup(row: TopicGroupRow): TopicGroup {
  return {
    id: row.id,
    name: row.name,
    isDefault: !!row.is_default,
    createdAt: row.created_at ?? null
  }
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** topics 行的应用层形态（与 topic.repo 的 Topic 对齐的关键字段）。 */
export interface GroupTopic {
  id: string
  title: string
  type: string | null
  domain: string | null
  difficulty: string | null
  source: string | null
  source_type: string | null
  tags: string[] | null
  status: string
  created_at: string
}

function rowToGroupTopic(row: Record<string, unknown>): GroupTopic {
  return {
    id: String(row.id),
    title: String(row.title),
    type: row.type == null ? null : String(row.type),
    domain: row.domain == null ? null : String(row.domain),
    difficulty: row.difficulty == null ? null : String(row.difficulty),
    source: row.source == null ? null : String(row.source),
    source_type: row.source_type == null ? null : String(row.source_type),
    tags: safeJsonParse<string[] | null>(row.tags as string | null, null),
    status: row.status == null ? 'active' : String(row.status),
    created_at: row.created_at == null ? '' : String(row.created_at)
  }
}

function getGroupRow(id: string): TopicGroupRow | undefined {
  return getDb()
    .prepare('SELECT * FROM topic_groups WHERE id = ?')
    .get(id) as TopicGroupRow | undefined
}

// ============================================================
// 赛事选题模式配置（events.bank_config JSON）
//
// 结构：{ mode, priorityOrder?, roundBanks? }
//   - mode: single | union | priority | by_round
//   - priorityOrder: 题库优先级/顺序列表（single 取首库，priority 全序）
//   - roundBanks: by_round 模式 roundId -> 该轮使用的题库 id 列表
// 统一存于 events.bank_config 单列，避免改动 event_topic_groups 结构；
// 列不存在/为空时回退到默认 single 模式，保证与既有单一库行为兼容。
// ============================================================

export type DrawBankMode = 'single' | 'union' | 'priority' | 'by_round'

export interface EventBankConfig {
  mode: DrawBankMode
  /** 题库优先级/顺序（single 取首库，priority 全序）。 */
  priorityOrder?: string[]
  /** by_round 模式：roundId -> 该轮使用的题库 id 列表。 */
  roundBanks?: Record<string, string[]>
}

/** bank_config 缺失/非法时回退的默认选题模式（最不破坏现状的单一库行为）。 */
export const DEFAULT_DRAW_BANK_MODE: DrawBankMode = 'single'

// ============================================================
// 默认题库（幂等种子 + 归入）
// ============================================================

/**
 * 幂等保证「默认题库」存在（is_default=1）。
 * 若不存在则按固定 id 创建；已存在则直接返回。
 * 用于：首次建库种子、getDefault、默认归入新题。
 */
function ensureDefaultGroup(): TopicGroup {
  const db = getDb()
  const existing = getGroupRow(DEFAULT_TOPIC_GROUP_ID)
  if (existing) return rowToGroup(existing)
  db.prepare(
    `INSERT OR IGNORE INTO topic_groups (id, name, is_default, created_at) VALUES (?, ?, 1, ?)`
  ).run(DEFAULT_TOPIC_GROUP_ID, DEFAULT_TOPIC_GROUP_NAME, new Date().toISOString())
  const row = getGroupRow(DEFAULT_TOPIC_GROUP_ID)
  if (!row) throw new Error(`[topicGroupRepo] ensureDefaultGroup: 默认题库创建失败`)
  return rowToGroup(row)
}

// ============================================================
// 题组 CRUD
// ============================================================

/** 列出全部题组（默认题库排最前，其余按创建时间升序）。 */
function list(): TopicGroup[] {
  const rows = getDb()
    .prepare('SELECT * FROM topic_groups ORDER BY is_default DESC, created_at ASC, id ASC')
    .all() as TopicGroupRow[]
  return rows.map(rowToGroup)
}

/** 新建题组（非默认题库）。返回创建后的题组。 */
function createGroup(name: string): TopicGroup {
  const id = uuidv4()
  const now = new Date().toISOString()
  getDb()
    .prepare('INSERT INTO topic_groups (id, name, is_default, created_at) VALUES (?, ?, 0, ?)')
    .run(id, name, now)
  const row = getGroupRow(id)
  if (!row) throw new Error(`[topicGroupRepo] createGroup: 创建失败, id=${id}`)
  return rowToGroup(row)
}

/**
 * 按指定 id 幂等创建题组（T7：赛事包导入还原被引用题库）。
 * - 已存在：直接返回既有题组，不覆盖 name/is_default（保持目标库权威）。
 * - 不存在：用包内定义（id/name/is_default/created_at）插入。
 * 用于导入时把包内「被引用但缺失」的题库按原 id 恢复，保证绑定外键可用。
 */
function ensureGroupById(
  id: string,
  name: string,
  isDefault?: boolean,
  createdAt?: string | null
): TopicGroup {
  const db = getDb()
  const existing = getGroupRow(id)
  if (existing) return rowToGroup(existing)
  db.prepare(
    'INSERT INTO topic_groups (id, name, is_default, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, name, isDefault ? 1 : 0, createdAt ?? new Date().toISOString())
  const row = getGroupRow(id)
  if (!row) throw new Error(`[topicGroupRepo] ensureGroupById: 创建失败, id=${id}`)
  return rowToGroup(row)
}

/** 重命名题组。成功返回更新后对象，不存在返回 undefined。 */
function rename(id: string, name: string): TopicGroup | undefined {
  const result = getDb().prepare('UPDATE topic_groups SET name = ? WHERE id = ?').run(name, id)
  if (result.changes === 0) return undefined
  const row = getGroupRow(id)
  return row ? rowToGroup(row) : undefined
}

/**
 * 删除题组（级联删除成员与赛事绑定）。
 * 默认题库不允许删除（防止破坏「默认归入」语义）。
 * 返回是否删除成功。
 */
function deleteGroup(id: string): boolean {
  if (id === DEFAULT_TOPIC_GROUP_ID) {
    throw new Error('[topicGroupRepo] delete: 不能删除默认题库')
  }
  const result = getDb().prepare('DELETE FROM topic_groups WHERE id = ?').run(id)
  return result.changes > 0
}

/** 获取默认题库（幂等保证存在）。 */
function getDefault(): TopicGroup {
  return ensureDefaultGroup()
}

// ============================================================
// 题组成员
// ============================================================

/**
 * 把若干辩题加入题组（INSERT OR IGNORE，重复自动跳过）。
 * 在同一事务内逐条写入，任一条失败整批回滚（不留前 N-1）。
 * @returns 实际新增的成员数
 */
function addTopicsToGroup(groupId: string, topicIds: string[]): number {
  if (topicIds.length === 0) return 0
  const db = getDb()
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO topic_group_items (group_id, topic_id) VALUES (?, ?)'
  )
  let added = 0
  const run = db.transaction(() => {
    for (const tid of topicIds) {
      added += stmt.run(groupId, tid).changes
    }
  })
  run()
  return added
}

/**
 * 从题组移除若干辩题。
 * 在同一事务内逐条写入，任一条失败整批回滚（不留前 N-1）。
 * @returns 实际移除的成员数
 */
function removeTopicsFromGroup(groupId: string, topicIds: string[]): number {
  if (topicIds.length === 0) return 0
  const db = getDb()
  const stmt = db.prepare('DELETE FROM topic_group_items WHERE group_id = ? AND topic_id = ?')
  let removed = 0
  const run = db.transaction(() => {
    for (const tid of topicIds) {
      removed += stmt.run(groupId, tid).changes
    }
  })
  run()
  return removed
}

/**
 * 取某题组内的辩题 id。activeOnly=true 时仅返回 status='active' 的题。
 */
function listTopicIdsByGroup(
  groupId: string,
  opts?: { activeOnly?: boolean }
): string[] {
  const activeOnly = opts?.activeOnly
  const sql = activeOnly
    ? `SELECT tgi.topic_id AS topic_id
       FROM topic_group_items tgi
       JOIN topics t ON t.id = tgi.topic_id
       WHERE tgi.group_id = ? AND t.status = 'active'`
    : `SELECT topic_id FROM topic_group_items WHERE group_id = ?`
  const rows = getDb().prepare(sql).all(groupId) as Array<{ topic_id: string }>
  return rows.map((r) => r.topic_id)
}

/** 取某题组内的完整辩题信息（join topics，含标题/tags 等）。 */
function listTopicsByGroup(groupId: string): GroupTopic[] {
  const rows = getDb()
    .prepare(
      `SELECT t.*
       FROM topic_group_items tgi
       JOIN topics t ON t.id = tgi.topic_id
       WHERE tgi.group_id = ?
       ORDER BY t.created_at DESC`
    )
    .all(groupId) as Record<string, unknown>[]
  return rows.map(rowToGroupTopic)
}

// ============================================================
// 赛事绑定
// ============================================================

/**
 * 给赛事绑定若干题组（INSERT OR IGNORE，重复自动跳过）。
 * 在同一事务内逐条写入，任一条失败整批回滚（不留前 N-1）。
 * @returns 实际新增的绑定数
 */
function bindEventGroups(eventId: string, groupIds: string[]): number {
  if (groupIds.length === 0) return 0
  const db = getDb()
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO event_topic_groups (event_id, group_id) VALUES (?, ?)'
  )
  let added = 0
  const run = db.transaction(() => {
    for (const gid of groupIds) {
      added += stmt.run(eventId, gid).changes
    }
  })
  run()
  return added
}

/** 解绑赛事与某个题组的关联。返回是否解绑成功。 */
function unbindEventGroup(eventId: string, groupId: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM event_topic_groups WHERE event_id = ? AND group_id = ?')
    .run(eventId, groupId)
  return result.changes > 0
}

/** 取某赛事绑定的题组列表。 */
function listGroupsByEvent(eventId: string): TopicGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT tg.*
       FROM event_topic_groups etg
       JOIN topic_groups tg ON tg.id = etg.group_id
       WHERE etg.event_id = ?
       ORDER BY tg.is_default DESC, tg.created_at ASC`
    )
    .all(eventId) as TopicGroupRow[]
  return rows.map(rowToGroup)
}

/** 取绑定到某题组的所有赛事 id。 */
function listEventIdsByGroup(groupId: string): string[] {
  const rows = getDb()
    .prepare('SELECT event_id FROM event_topic_groups WHERE group_id = ?')
    .all(groupId) as Array<{ event_id: string }>
  return rows.map((r) => r.event_id)
}

// ============================================================
// 轮次库绑定（round_topic_groups）
// ============================================================

/**
 * 给轮次绑定若干题组（INSERT OR IGNORE，重复自动跳过）。
 * 在同一事务内逐条写入，任一条失败整批回滚（不留前 N-1）。
 * @returns 实际新增的绑定数
 */
function bindRoundGroups(roundId: string, groupIds: string[]): number {
  if (!groupIds || groupIds.length === 0) return 0
  const db = getDb()
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO round_topic_groups (round_id, group_id) VALUES (?, ?)'
  )
  let added = 0
  const run = db.transaction(() => {
    for (const gid of groupIds) {
      added += stmt.run(roundId, gid).changes
    }
  })
  run()
  return added
}

/** 解绑轮次与某个题组的关联。返回是否解绑成功。 */
function unbindRoundGroup(roundId: string, groupId: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM round_topic_groups WHERE round_id = ? AND group_id = ?')
    .run(roundId, groupId)
  return result.changes > 0
}

/** 取某轮次绑定的题组列表（默认题库在前，其余按创建时间升序）。 */
function listGroupsByRound(roundId: string): TopicGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT tg.*
       FROM round_topic_groups rtg
       JOIN topic_groups tg ON tg.id = rtg.group_id
       WHERE rtg.round_id = ?
       ORDER BY tg.is_default DESC, tg.created_at ASC`
    )
    .all(roundId) as TopicGroupRow[]
  return rows.map(rowToGroup)
}

/** 取绑定到某题组的所有轮次 id。 */
function listRoundsByGroup(groupId: string): string[] {
  const rows = getDb()
    .prepare('SELECT round_id FROM round_topic_groups WHERE group_id = ?')
    .all(groupId) as Array<{ round_id: string }>
  return rows.map((r) => r.round_id)
}

// ============================================================
// 赛事选题模式配置读写（events.bank_config）
// ============================================================

/**
 * 读某赛事的选题模式配置。
 * bank_config 缺失/非法时回退到默认 single 模式（既有单一库行为；governance 12 降级兼容）。
 */
function getEventBankConfig(eventId: string): EventBankConfig {
  const row = getDb()
    .prepare('SELECT bank_config FROM events WHERE id = ?')
    .get(eventId) as { bank_config?: string | null } | undefined
  const parsed = safeJsonParse<unknown>(row?.bank_config ?? null, null)
  const result = validateBankConfig(parsed)
  // 缺失→默认 single；存在但非法→降级默认 single（读路径不做静默放行，仍给出语义化默认）
  return result.ok ? result.value : { mode: DEFAULT_DRAW_BANK_MODE }
}

/**
 * 写某赛事的选题模式配置（序列化到 events.bank_config）。
 * 写路径经 validateBankConfig 校验：非法结构抛出明确错误（governance 12 拒绝），
 * 缺失 mode → 合理默认 single。事件不存在返回 undefined；成功返回写入后的配置。
 */
function setEventBankConfig(
  eventId: string,
  config: EventBankConfig
): EventBankConfig | undefined {
  const result = validateBankConfig(config)
  if (!result.ok) throw new Error(result.error)
  const payload = result.value
  const dbResult = getDb()
    .prepare('UPDATE events SET bank_config = ? WHERE id = ?')
    .run(JSON.stringify(payload), eventId)
  if (dbResult.changes === 0) return undefined
  return payload
}

// ============================================================
// 备份
// ============================================================

/**
 * 备份用：返回题组相关四张表的 DB 原始行（含轮次库绑定表）。
 * 风格与其它 repo 的 findAllForBackup 对齐，便于导入时直接 bulkInsert 还原。
 */
function findAllForBackup(): {
  topic_groups: Array<Record<string, unknown>>
  topic_group_items: Array<Record<string, unknown>>
  event_topic_groups: Array<Record<string, unknown>>
  round_topic_groups: Array<Record<string, unknown>>
} {
  const db = getDb()
  return {
    topic_groups: db.prepare('SELECT * FROM topic_groups').all() as Array<Record<string, unknown>>,
    topic_group_items: db.prepare('SELECT * FROM topic_group_items').all() as Array<
      Record<string, unknown>
    >,
    event_topic_groups: db.prepare('SELECT * FROM event_topic_groups').all() as Array<
      Record<string, unknown>
    >,
    round_topic_groups: db.prepare('SELECT * FROM round_topic_groups').all() as Array<
      Record<string, unknown>
    >
  }
}

// ============================================================
// 默认归入
// ============================================================

/** 把未指定题组的若干新辩题写入默认题库（幂等）。@returns 新增成员数。 */
function ensureTopicsInDefaultGroup(topicIds: string[]): number {
  const def = getDefault()
  return addTopicsToGroup(def.id, topicIds)
}

/** ensureTopicsInDefaultGroup 的单题便捷封装。 */
function ensureTopicInDefaultGroup(topicId: string): number {
  return ensureTopicsInDefaultGroup([topicId])
}

// ============================================================
// 批量增减  & 整体复制/移动（T1：赛事题库 UX 后端操作 helper）
// 复用 topic_group_items，不加新表；所有批量方法均在事务内执行；
// 复制/移动在目标库去重；同库目标跳过。
// ============================================================

/** 库间复制/移动结果：每个目标题库实际新增的成员数。 */
export interface GroupCopyResult {
  groupId: string
  added: number
}

/**
 * 把一组题加入多个目标题库（INSERT OR IGNORE 去重，忽略已存在成员）。
 * @returns 实际新增的成员总数
 */
function batchAddToGroups(topicIds: string[], groupIds: string[]): number {
  if (topicIds.length === 0 || groupIds.length === 0) return 0
  const db = getDb()
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO topic_group_items (group_id, topic_id) VALUES (?, ?)'
  )
  let added = 0
  const run = db.transaction(() => {
    for (const gid of groupIds) {
      for (const tid of topicIds) {
        added += stmt.run(gid, tid).changes
      }
    }
  })
  run()
  return added
}

/**
 * 从某个题库批量移除一组题。
 * @returns 实际移除的成员数
 */
function batchRemoveFromGroup(groupId: string, topicIds: string[]): number {
  if (topicIds.length === 0) return 0
  const db = getDb()
  const stmt = db.prepare('DELETE FROM topic_group_items WHERE group_id = ? AND topic_id = ?')
  let removed = 0
  const run = db.transaction(() => {
    for (const tid of topicIds) {
      removed += stmt.run(groupId, tid).changes
    }
  })
  run()
  return removed
}

/**
 * 把源题库的全部题复制到目标题库（去重，已存在则跳过）；同库目标跳过。
 * @returns 每个目标题库实际新增的成员数
 */
function copyGroupToGroup(srcGroupId: string, targetGroupIds: string[]): GroupCopyResult[] {
  const targets = (targetGroupIds ?? []).filter((gid) => gid && gid !== srcGroupId)
  if (targets.length === 0) return []
  const db = getDb()
  const sourceIds = listTopicIdsByGroup(srcGroupId)
  if (sourceIds.length === 0) return targets.map((groupId) => ({ groupId, added: 0 }))

  const stmt = db.prepare(
    'INSERT OR IGNORE INTO topic_group_items (group_id, topic_id) VALUES (?, ?)'
  )
  const result: GroupCopyResult[] = []
  const run = db.transaction(() => {
    for (const gid of targets) {
      let added = 0
      for (const tid of sourceIds) {
        added += stmt.run(gid, tid).changes
      }
      result.push({ groupId: gid, added })
    }
  })
  run()
  return result
}

/**
 * 把源题库的全部题移动到目标题库：先复制到目标（去重），再从源移除全部题；同库目标跳过。
 * @returns 每个目标题库实际新增的成员数（全部目标加入后，源被清空）
 */
function moveGroupToGroup(srcGroupId: string, targetGroupIds: string[]): GroupCopyResult[] {
  const targets = (targetGroupIds ?? []).filter((gid) => gid && gid !== srcGroupId)
  if (targets.length === 0) return []
  const db = getDb()
  const sourceIds = listTopicIdsByGroup(srcGroupId)

  const insert = db.prepare(
    'INSERT OR IGNORE INTO topic_group_items (group_id, topic_id) VALUES (?, ?)'
  )
  const del = db.prepare('DELETE FROM topic_group_items WHERE group_id = ? AND topic_id = ?')
  const result: GroupCopyResult[] = []
  const run = db.transaction(() => {
    for (const gid of targets) {
      let added = 0
      for (const tid of sourceIds) {
        added += insert.run(gid, tid).changes
      }
      result.push({ groupId: gid, added })
    }
    // 全部加入目标后，从源移除全部题
    for (const tid of sourceIds) {
      del.run(srcGroupId, tid)
    }
  })
  run()
  return result
}

// ============================================================
// 导出
// ============================================================

export const topicGroupRepo = {
  list,
  createGroup,
  ensureGroupById,
  rename,
  delete: deleteGroup,
  getDefault,
  ensureDefaultGroup,
  addTopicsToGroup,
  removeTopicsFromGroup,
  listTopicIdsByGroup,
  listTopicsByGroup,
  bindEventGroups,
  unbindEventGroup,
  listGroupsByEvent,
  listEventIdsByGroup,
  bindRoundGroups,
  unbindRoundGroup,
  listGroupsByRound,
  listRoundsByGroup,
  getEventBankConfig,
  setEventBankConfig,
  findAllForBackup,
  ensureTopicInDefaultGroup,
  ensureTopicsInDefaultGroup,
  batchAddToGroups,
  batchRemoveFromGroup,
  copyGroupToGroup,
  moveGroupToGroup
}