// ============================================================
// undo-service.ts — 撤销/重做服务
//
// 职责：
//   1. withUndoLog: 高阶函数，在事务中执行写操作 + 记录 undo log
//      返回 { result, logId }，logId 为 null 表示超限未入栈
//   2. executeUndo: 读取 undo_log 表，按 log 反向操作 DB；
//      不删除 log，仅标记 undone_at（支持后续 redo）
//   3. executeRedo: 重新执行正向操作；清除 undone_at 标记
//   4. clearUndoLogOnStartup: 应用启动时清空 undo_log 表
//
// 注意：本服务不负责刷新渲染进程 store，由 IPC handler 调用后
//       返回 storeName，渲染进程触发对应 store.fetchList
// ============================================================

import { getDb } from '../db'
import { undoLogRepo } from '../db/repository/undo-log.repo'
import { topicRepo } from '../db/repository/topic.repo'
import { eventRepo } from '../db/repository/event.repo'
import { drawRepo } from '../db/repository/draw.repo'
import { customFieldService } from './custom-field-service'
import type {
  UndoLogEntry,
  UndoResult,
  Topic,
  Event,
  Round,
  Team,
  DrawResult,
  DrawSessionDetail,
  CustomField
} from '../../shared/types'

interface WithUndoLogOpts<T> {
  storeName: UndoLogEntry['store_name']
  action: string
  targetType: string
  targetId: string | null
  label: string
  /** 操作前快照采集（在事务内、execute 之前调用） */
  getBefore: () => unknown | null
  /** 实际写操作 */
  execute: () => T
  /** 操作后快照采集（在事务内、execute 之后调用，接收 execute 返回值） */
  getAfter: (result: T) => unknown | null
}

/** withUndoLog 返回值：包含业务结果与 log id（C1 修复） */
export interface WithUndoLogResult<T> {
  result: T
  /** 创建的 undo_log id；null 表示 payload 超限未入栈 */
  logId: string | null
}

/**
 * 高阶函数：在事务中执行写操作 + 记录 undo log。
 *
 * 流程：
 *   1. 开启事务
 *   2. 调用 getBefore() 采集 before 快照
 *   3. 调用 execute() 执行写操作
 *   4. 调用 getAfter(result) 采集 after 快照
 *   5. 计算 payload_size；若 ≤1MB 调用 undoLogRepo.createLog
 *   6. 提交事务（任一步骤失败整体回滚）
 *
 * C1 修复：返回 { result, logId }。payload 超限时 logId = null，
 * 渲染进程据此判断是否入栈（避免与 DB 失同步）。
 *
 * L1 修复：withUndoLog 不再重复调用 createLog 内部的 payload 检查；
 * createLog 内部已做防御性检查并抛错，withUndoLog 捕获后将 logId 置为 null。
 */
export function withUndoLog<T>(opts: WithUndoLogOpts<T>): WithUndoLogResult<T> {
  const db = getDb()
  let logId: string | null = null

  const result = db.transaction(() => {
    const before = opts.getBefore()
    const res = opts.execute()
    const after = opts.getAfter(res)

    try {
      logId = undoLogRepo.createLog({
        store_name: opts.storeName,
        action: opts.action,
        target_type: opts.targetType,
        target_id: opts.targetId,
        before_data: before,
        after_data: after,
        label: opts.label
      })
    } catch (e) {
      // payload 超限或其他原因导致 log 创建失败：写操作仍提交，但不入栈
      console.warn(
        `[undo] skip log creation for "${opts.label}":`,
        e instanceof Error ? e.message : String(e)
      )
      logId = null
    }

    return res
  })()

  return { result, logId }
}

/**
 * 执行撤销：读取最新一条未撤销的 undo_log（或指定 logId），按 store+action+target_type 反向操作 DB。
 *
 * H3 + M7 修复：不再删除 log，而是标记 undone_at；后续 executeRedo 可重做。
 *
 * @returns 撤销结果（含 storeName 用于渲染进程刷新）
 */
export function executeUndo(logId?: string): UndoResult {
  const db = getDb()
  const log = logId ? undoLogRepo.getById(logId) : undoLogRepo.getLatest()

  if (!log) {
    throw new Error('无可撤销的操作')
  }
  if (log.undone_at) {
    throw new Error('该操作已被撤销，无法重复撤销')
  }

  const result = db.transaction(() => {
    const affectedCount = applyReverse(log)
    // 标记 log 为已撤销（不删除，支持 redo）
    undoLogRepo.markUndone(log.id)
    return {
      logId: log.id,
      affectedCount,
      storeName: log.store_name,
      label: log.label ?? '未知操作'
    } satisfies UndoResult
  })()

  return result
}

/**
 * 执行重做：读取最新一条已撤销的 undo_log（或指定 logId），重新执行正向操作。
 *
 * H3 修复：完整实现 Redo 功能。
 *
 * @returns 重做结果（含 storeName 用于渲染进程刷新）
 */
export function executeRedo(logId?: string): UndoResult {
  const db = getDb()
  const log = logId ? undoLogRepo.getById(logId) : undoLogRepo.getLatestRedoable()

  if (!log) {
    throw new Error('无可重做的操作')
  }
  if (!log.undone_at) {
    throw new Error('该操作未被撤销，无法重做')
  }

  const result = db.transaction(() => {
    const affectedCount = applyForward(log)
    // 清除 undone_at 标记，使 log 重新变为可撤销状态
    undoLogRepo.clearUndone(log.id)
    return {
      logId: log.id,
      affectedCount,
      storeName: log.store_name,
      label: log.label ?? '未知操作'
    } satisfies UndoResult
  })()

  return result
}

/**
 * 根据单条 log 反向操作 DB。
 * 返回影响的行数。
 */
function applyReverse(log: UndoLogEntry): number {
  const before = log.before_data
  const after = log.after_data

  switch (log.store_name) {
    case 'topic':
      return applyTopicReverse(log.action, log.target_type, before, after)
    case 'event':
      return applyEventReverse(log.action, log.target_type, before, after)
    case 'draw':
      return applyDrawReverse(log.action, log.target_type, before, after)
    case 'customField':
      return applyCustomFieldReverse(log.action, before, after)
    case 'settings':
      return applySettingsReverse(log.action, before)
    default:
      throw new Error(`[undo] unknown store_name: ${log.store_name}`)
  }
}

/**
 * 根据单条 log 正向重新操作 DB（重做用）。
 * 返回影响的行数。
 *
 * 实现策略：根据 action 直接调用 applyReverse 的"反向"即可，
 * 因为 redo = undo(undo)。但更直观的是直接用 after 快照重新执行正向操作。
 */
function applyForward(log: UndoLogEntry): number {
  const before = log.before_data
  const after = log.after_data

  switch (log.store_name) {
    case 'topic':
      return applyTopicForward(log.action, log.target_type, before, after)
    case 'event':
      return applyEventForward(log.action, log.target_type, before, after)
    case 'draw':
      return applyDrawForward(log.action, log.target_type, before, after)
    case 'customField':
      return applyCustomFieldForward(log.action, before, after)
    case 'settings':
      return applySettingsForward(log.action, after)
    default:
      throw new Error(`[undo] unknown store_name: ${log.store_name}`)
  }
}

// ---------- topic 反向操作 ----------

function applyTopicReverse(
  action: string,
  targetType: string,
  before: unknown,
  after: unknown
): number {
  if (targetType !== 'topic') {
    throw new Error(`[undo] topic store: unsupported target_type ${targetType}`)
  }

  switch (action) {
    case 'create': {
      // 反向 = delete
      const afterTopic = after as Topic
      topicRepo.deleteTopic(afterTopic.id)
      return 1
    }
    case 'update': {
      // 反向 = 用 before 覆盖
      const beforeTopic = before as Topic
      topicRepo.updateTopic(beforeTopic.id, {
        title: beforeTopic.title,
        type: beforeTopic.type,
        domain: beforeTopic.domain,
        difficulty: beforeTopic.difficulty,
        source: beforeTopic.source,
        source_type: beforeTopic.source_type,
        tags: beforeTopic.tags,
        weight: beforeTopic.weight,
        status: beforeTopic.status,
        batch_id: beforeTopic.batch_id,
        custom_data: beforeTopic.custom_data
      })
      return 1
    }
    case 'delete': {
      // 反向 = 用 before 重建（保留原 id）
      const beforeTopic = before as Topic
      recreateTopicWithId(beforeTopic)
      return 1
    }
    case 'batchDelete': {
      // 反向 = 遍历 before.topics 逐条重建
      const beforeData = before as { topics: Topic[] }
      for (const t of beforeData.topics) {
        recreateTopicWithId(t)
      }
      return beforeData.topics.length
    }
    case 'updateStatus': {
      const beforeTopic = before as Topic
      topicRepo.updateStatus(beforeTopic.id, beforeTopic.status)
      return 1
    }
    case 'updateWeight': {
      const beforeTopic = before as Topic
      topicRepo.updateWeight(beforeTopic.id, beforeTopic.weight)
      return 1
    }
    default:
      throw new Error(`[undo] topic: unsupported action ${action}`)
  }
}

// ---------- topic 正向操作（重做） ----------

function applyTopicForward(
  action: string,
  targetType: string,
  _before: unknown,
  after: unknown
): number {
  if (targetType !== 'topic') {
    throw new Error(`[undo] topic store: unsupported target_type ${targetType}`)
  }

  switch (action) {
    case 'create': {
      // 正向 = 用 after 重建
      const afterTopic = after as Topic
      recreateTopicWithId(afterTopic)
      return 1
    }
    case 'update': {
      // 正向 = 用 after 覆盖
      const afterTopic = after as Topic
      topicRepo.updateTopic(afterTopic.id, {
        title: afterTopic.title,
        type: afterTopic.type,
        domain: afterTopic.domain,
        difficulty: afterTopic.difficulty,
        source: afterTopic.source,
        source_type: afterTopic.source_type,
        tags: afterTopic.tags,
        weight: afterTopic.weight,
        status: afterTopic.status,
        batch_id: afterTopic.batch_id,
        custom_data: afterTopic.custom_data
      })
      return 1
    }
    case 'delete': {
      // 正向 = 再次删除
      const beforeTopic = _before as Topic
      topicRepo.deleteTopic(beforeTopic.id)
      return 1
    }
    case 'batchDelete': {
      const beforeData = _before as { topics: Topic[] }
      for (const t of beforeData.topics) {
        topicRepo.deleteTopic(t.id)
      }
      return beforeData.topics.length
    }
    case 'updateStatus': {
      const afterTopic = after as Topic
      topicRepo.updateStatus(afterTopic.id, afterTopic.status)
      return 1
    }
    case 'updateWeight': {
      const afterTopic = after as Topic
      topicRepo.updateWeight(afterTopic.id, afterTopic.weight)
      return 1
    }
    default:
      throw new Error(`[undo] topic: unsupported action ${action}`)
  }
}

/** 用指定 id 重建 topic（绕过 createTopic 的 uuid 生成） */
function recreateTopicWithId(topic: Topic): void {
  const db = getDb()
  const tagsJson = topic.tags ? JSON.stringify(topic.tags) : null
  const customDataJson = topic.custom_data ? JSON.stringify(topic.custom_data) : null
  db.prepare(`
    INSERT INTO topics (
      id, title, type, domain, difficulty, source, source_type,
      tags, weight, status, batch_id, created_at, updated_at, custom_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    topic.id,
    topic.title,
    topic.type,
    topic.domain,
    topic.difficulty,
    topic.source,
    topic.source_type,
    tagsJson,
    topic.weight,
    topic.status,
    topic.batch_id,
    topic.created_at,
    topic.updated_at,
    customDataJson
  )
}

// ---------- event 反向操作 ----------

function applyEventReverse(
  action: string,
  targetType: string,
  before: unknown,
  after: unknown
): number {
  switch (targetType) {
    case 'event': {
      const beforeEvent = before as Event | null
      const afterEvent = after as Event | null
      if (action === 'create') {
        eventRepo.deleteEvent(afterEvent!.id)
        return 1
      }
      if (action === 'update' && beforeEvent) {
        eventRepo.updateEvent(beforeEvent.id, {
          name: beforeEvent.name,
          start_date: beforeEvent.start_date,
          end_date: beforeEvent.end_date,
          status: beforeEvent.status
        })
        return 1
      }
      if (action === 'delete' && beforeEvent) {
        // 重建 event（CASCADE 删除了 rounds/teams 等，无法完整恢复，仅重建 event 本身）
        recreateEventWithId(beforeEvent)
        return 1
      }
      break
    }
    case 'round': {
      const beforeRound = before as Round | null
      const afterRound = after as Round | null
      if (action === 'create') {
        eventRepo.deleteRound(afterRound!.id)
        return 1
      }
      if (action === 'update' && beforeRound) {
        eventRepo.updateRound(beforeRound.id, {
          name: beforeRound.name,
          round_number: beforeRound.round_number,
          difficulty_override: beforeRound.difficulty_override,
          topic_count: beforeRound.topic_count
        })
        return 1
      }
      if (action === 'delete' && beforeRound) {
        recreateRoundWithId(beforeRound)
        return 1
      }
      break
    }
    case 'team': {
      const beforeTeam = before as Team | null
      const afterTeam = after as Team | null
      if (action === 'create') {
        eventRepo.deleteTeam(afterTeam!.id)
        return 1
      }
      if (action === 'update' && beforeTeam) {
        eventRepo.updateTeam(beforeTeam.id, { name: beforeTeam.name })
        return 1
      }
      if (action === 'delete' && beforeTeam) {
        recreateTeamWithId(beforeTeam)
        return 1
      }
      break
    }
  }
  throw new Error(`[undo] event: unsupported action ${action} for ${targetType}`)
}

// ---------- event 正向操作（重做） ----------

function applyEventForward(
  action: string,
  targetType: string,
  before: unknown,
  after: unknown
): number {
  switch (targetType) {
    case 'event': {
      const beforeEvent = before as Event | null
      const afterEvent = after as Event | null
      if (action === 'create' && afterEvent) {
        recreateEventWithId(afterEvent)
        return 1
      }
      if (action === 'update' && afterEvent) {
        eventRepo.updateEvent(afterEvent.id, {
          name: afterEvent.name,
          start_date: afterEvent.start_date,
          end_date: afterEvent.end_date,
          status: afterEvent.status
        })
        return 1
      }
      if (action === 'delete' && beforeEvent) {
        eventRepo.deleteEvent(beforeEvent.id)
        return 1
      }
      break
    }
    case 'round': {
      const beforeRound = before as Round | null
      const afterRound = after as Round | null
      if (action === 'create' && afterRound) {
        recreateRoundWithId(afterRound)
        return 1
      }
      if (action === 'update' && afterRound) {
        eventRepo.updateRound(afterRound.id, {
          name: afterRound.name,
          round_number: afterRound.round_number,
          difficulty_override: afterRound.difficulty_override,
          topic_count: afterRound.topic_count
        })
        return 1
      }
      if (action === 'delete' && beforeRound) {
        eventRepo.deleteRound(beforeRound.id)
        return 1
      }
      break
    }
    case 'team': {
      const beforeTeam = before as Team | null
      const afterTeam = after as Team | null
      if (action === 'create' && afterTeam) {
        recreateTeamWithId(afterTeam)
        return 1
      }
      if (action === 'update' && afterTeam) {
        eventRepo.updateTeam(afterTeam.id, { name: afterTeam.name })
        return 1
      }
      if (action === 'delete' && beforeTeam) {
        eventRepo.deleteTeam(beforeTeam.id)
        return 1
      }
      break
    }
  }
  throw new Error(`[undo] event: unsupported action ${action} for ${targetType}`)
}

function recreateEventWithId(event: Event): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO events (id, name, start_date, end_date, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(event.id, event.name, event.start_date, event.end_date, event.status, event.created_at)
}

function recreateRoundWithId(round: Round): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO rounds (id, event_id, name, round_number, difficulty_override, topic_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(round.id, round.event_id, round.name, round.round_number, round.difficulty_override, round.topic_count)
}

function recreateTeamWithId(team: Team): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO teams (id, name, event_id)
    VALUES (?, ?, ?)
  `).run(team.id, team.name, team.event_id)
}

// ---------- draw 反向操作 ----------

function applyDrawReverse(
  action: string,
  targetType: string,
  before: unknown,
  after: unknown
): number {
  if (targetType !== 'session') {
    throw new Error(`[undo] draw: unsupported target_type ${targetType}`)
  }

  switch (action) {
    case 'execute': {
      // 反向 = 删除新建的 session（CASCADE 删 items）
      const afterResult = after as DrawResult
      drawRepo.deleteSession(afterResult.session.id)
      return 1
    }
    case 'redraw': {
      // Critical-4 修复：重抽的反向 = 删除新 session + 重建旧 session
      const beforeData = before as { oldSessionId: string; oldSession: DrawSessionDetail | null }
      const afterResult = after as DrawResult
      // 1. 删除新 session（CASCADE 删 items）
      drawRepo.deleteSession(afterResult.session.id)
      // 2. 重建旧 session（若有完整快照）
      if (beforeData.oldSession) {
        recreateDrawSessionWithId({ session: beforeData.oldSession })
      }
      return 1
    }
    // M2 修复：移除 'deleteSession' 死代码分支（draw.ipc.ts 中无对应 action）
    default:
      throw new Error(`[undo] draw: unsupported action ${action}`)
  }
}

// ---------- draw 正向操作（重做） ----------

function applyDrawForward(
  action: string,
  targetType: string,
  before: unknown,
  after: unknown
): number {
  if (targetType !== 'session') {
    throw new Error(`[undo] draw: unsupported target_type ${targetType}`)
  }

  switch (action) {
    case 'execute': {
      // 正向 = 用 after.session 重建（CASCADE 重建 items）
      const afterResult = after as DrawResult
      recreateDrawSessionWithId(afterResult)
      return 1
    }
    case 'redraw': {
      // Critical-4 修复：重抽的正向（redo）= 删除旧 session + 重建新 session
      const beforeData = before as { oldSessionId: string; oldSession: DrawSessionDetail | null }
      const afterResult = after as DrawResult
      // 1. 删除旧 session（CASCADE 删 items）—— undo 时已重建，redo 需再删
      drawRepo.deleteSession(beforeData.oldSessionId)
      // 2. 重建新 session
      recreateDrawSessionWithId(afterResult)
      return 1
    }
    default:
      throw new Error(`[undo] draw: unsupported action ${action}`)
  }
}

/** 用指定 id 重建 draw session（绕过 drawTopics 的 uuid 生成） */
function recreateDrawSessionWithId(result: Pick<DrawResult, 'session'>): void {
  const db = getDb()
  const { session } = result
  // draw_sessions 表字段：id, event_id, round_id, draw_time, operator, settings
  db.prepare(`
    INSERT INTO draw_sessions (
      id, event_id, round_id, draw_time, operator, settings
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.event_id,
    session.round_id,
    session.draw_time,
    session.operator,
    session.settings ? JSON.stringify(session.settings) : null
  )
  // 重建 items（draw_session_items 表字段：id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b）
  const items = session.items
  if (items && items.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO draw_session_items (
        id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of items) {
      stmt.run(
        item.id,
        item.session_id,
        item.topic_id,
        item.team_a_id,
        item.team_b_id,
        item.stance_a,
        item.stance_b
      )
    }
  }
}

// ---------- customField 反向操作 ----------

function applyCustomFieldReverse(
  action: string,
  before: unknown,
  after: unknown
): number {
  const beforeField = before as CustomField | null
  const afterField = after as CustomField | null

  switch (action) {
    case 'create':
      customFieldService.deleteField(afterField!.field_key)
      return 1
    case 'update':
      // before 是更新前的字段元数据
      customFieldService.updateField(beforeField!.field_key, {
        field_label: beforeField!.field_label,
        sort_order: beforeField!.sort_order
      })
      return 1
    case 'delete':
      // 重建自定义字段（注意：topics.custom_data 中的值无法恢复）
      recreateCustomFieldWithId(beforeField!)
      return 1
    default:
      throw new Error(`[undo] customField: unsupported action ${action}`)
  }
}

// ---------- customField 正向操作（重做） ----------

function applyCustomFieldForward(
  action: string,
  before: unknown,
  after: unknown
): number {
  const beforeField = before as CustomField | null
  const afterField = after as CustomField | null

  switch (action) {
    case 'create':
      recreateCustomFieldWithId(afterField!)
      return 1
    case 'update':
      customFieldService.updateField(afterField!.field_key, {
        field_label: afterField!.field_label,
        sort_order: afterField!.sort_order
      })
      return 1
    case 'delete':
      customFieldService.deleteField(beforeField!.field_key)
      return 1
    default:
      throw new Error(`[undo] customField: unsupported action ${action}`)
  }
}

function recreateCustomFieldWithId(field: CustomField): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO topic_custom_fields (field_key, field_label, field_type, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(field.field_key, field.field_label, field.field_type, field.sort_order, field.created_at)
}

// ---------- settings 反向操作 ----------

function applySettingsReverse(
  action: string,
  before: unknown
): number {
  const db = getDb()

  switch (action) {
    case 'set': {
      // 反向 = 恢复旧值（若 before.value 为 null 则删除 key）
      const beforeData = before as { key: string; value: unknown | null }
      if (beforeData.value === null) {
        db.prepare('DELETE FROM settings WHERE key = ?').run(beforeData.key)
      } else {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
          beforeData.key,
          JSON.stringify(beforeData.value)
        )
      }
      return 1
    }
    case 'deleteKey': {
      // 反向 = 重新写入被删的 key
      const beforeData = before as { key: string; value: unknown }
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
        beforeData.key,
        JSON.stringify(beforeData.value)
      )
      return 1
    }
    case 'deleteBatch': {
      // 反向 = 遍历 before.entries 逐条恢复
      const beforeData = before as { entries: Array<{ key: string; value: unknown }> }
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      for (const entry of beforeData.entries) {
        stmt.run(entry.key, JSON.stringify(entry.value))
      }
      return beforeData.entries.length
    }
    default:
      throw new Error(`[undo] settings: unsupported action ${action}`)
  }
}

// ---------- settings 正向操作（重做） ----------

function applySettingsForward(
  action: string,
  after: unknown
): number {
  const db = getDb()

  switch (action) {
    case 'set': {
      // 正向 = 写入新值
      const afterData = after as { key: string; value: unknown | null }
      if (afterData.value === null) {
        db.prepare('DELETE FROM settings WHERE key = ?').run(afterData.key)
      } else {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
          afterData.key,
          JSON.stringify(afterData.value)
        )
      }
      return 1
    }
    case 'deleteKey': {
      // 正向 = 再次删除
      const afterData = after as { key: string }
      db.prepare('DELETE FROM settings WHERE key = ?').run(afterData.key)
      return 1
    }
    case 'deleteBatch': {
      // 正向 = 再次批量删除
      const afterData = after as { keys: string[] }
      const stmt = db.prepare('DELETE FROM settings WHERE key = ?')
      for (const key of afterData.keys) {
        stmt.run(key)
      }
      return afterData.keys.length
    }
    default:
      throw new Error(`[undo] settings: unsupported action ${action}`)
  }
}

/**
 * 清空 undo_log 表（应用启动时调用，避免跨重启不一致）。
 */
export function clearUndoLogOnStartup(): void {
  undoLogRepo.clearAll()
}
