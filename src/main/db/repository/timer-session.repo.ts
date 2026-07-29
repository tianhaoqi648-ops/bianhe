// ============================================================
// timer-session.repo.ts — 计时会话与记录 CRUD
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type { DebateFormatData, StageSide, TimerRecord, TimerSession, TimerSessionStatus, BackupImportStrategy } from '../../../shared/types'
import type { StageCacheValue } from '../../../shared/types'
import { resolveInitialSide } from '../../../shared/debate-formats/utils'
import { bulkInsert } from './utils'

interface SessionRow {
  id: string
  event_id: string | null
  round_id: string | null
  team_aff_id: string | null
  team_neg_id: string | null
  topic_id: string | null
  format_id: string | null
  format_snapshot: string
  status: string
  started_at: string | null
  ended_at: string | null
  current_stage_index: number
  current_side: string | null
  remaining_ms: number | null
  theme_snapshot: string | null
  label: string | null
  created_at: string
  stage_remaining_cache: string | null
  aff_remaining_ms: number | null
  neg_remaining_ms: number | null
  event_name: string | null
  team_aff_name: string | null
  team_neg_name: string | null
  topic_title: string | null
}

interface RecordRow {
  id: string
  session_id: string
  stage_index: number
  stage_name: string
  side: string
  duration_ms: number
  actual_ms: number | null
  started_at: string
  ended_at: string | null
  pause_count: number
}

/**
 * 安全 JSON.parse：解析失败时返回 fallback（默认空对象 {}）。
 * 用于 rowToSession 中各 JSON 列的容错反序列化，避免单行坏数据导致整列查询失败。
 */
function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * P2-8: 确保 timer_records 表存在 (session_id, stage_index) 的 UNIQUE 索引。
 *
 * - 使用 IF NOT EXISTS 幂等创建，重复执行无副作用
 * - 用模块级布尔标志保证一次会话内只执行一次 CREATE 语句，避免每次 addRecord 都跑 DDL
 * - 创建失败时静默（旧库可能存在重复行导致建索引失败），不阻塞 addRecord 主流程
 */
let timerRecordsUniqueIndexEnsured = false
function ensureTimerRecordsUniqueIndex(): void {
  if (timerRecordsUniqueIndexEnsured) return
  try {
    getDb().exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_timer_records_session_stage ON timer_records(session_id, stage_index)'
    )
    // 仅在创建成功时置位，失败时保持 false 以允许下次调用重试
    timerRecordsUniqueIndexEnsured = true
  } catch (e) {
    // 旧库可能存在重复行导致建索引失败，记录警告但不抛错
    console.warn('[timer-session.repo] 创建 timer_records 唯一索引失败:', e)
  }
}

/**
 * 重置 timer_records 唯一索引的"已确保"标志为 false。
 *
 * 使用场景：数据库被重置或降级（如磁盘库降级为内存库）后，原标志可能已置位，
 * 但新库实例上索引尚未创建，需要重置标志以便 ensureTimerRecordsUniqueIndex
 * 在下次 addRecord 时重新尝试创建索引。
 */
export function resetTimerRecordsIndexFlag(): void {
  timerRecordsUniqueIndexEnsured = false
}

function rowToSession(row: SessionRow): TimerSession {
  return {
    id: row.id,
    eventId: row.event_id,
    roundId: row.round_id,
    teamAffId: row.team_aff_id,
    teamNegId: row.team_neg_id,
    topicId: row.topic_id,
    formatId: row.format_id,
    // P2-2: format_snapshot 损坏时回退空对象，避免抛错中断整列查询
    formatSnapshot: safeJsonParse<DebateFormatData>(row.format_snapshot, {} as DebateFormatData),
    status: row.status as TimerSessionStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    currentStageIndex: row.current_stage_index,
    currentSide: row.current_side as StageSide | null,
    remainingMs: row.remaining_ms,
    themeSnapshot: safeJsonParse(row.theme_snapshot, null),
    label: row.label,
    createdAt: row.created_at,
    stageRemainingCache: safeJsonParse(row.stage_remaining_cache, null),
    affRemainingMs: row.aff_remaining_ms,
    negRemainingMs: row.neg_remaining_ms,
    eventName: row.event_name,
    teamAffName: row.team_aff_name,
    teamNegName: row.team_neg_name,
    topicTitle: row.topic_title
  }
}

function rowToRecord(row: RecordRow): TimerRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    stageIndex: row.stage_index,
    stageName: row.stage_name,
    side: row.side as StageSide,
    durationMs: row.duration_ms,
    actualMs: row.actual_ms,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    pauseCount: row.pause_count
  }
}

export const timerSessionRepo = {
  create(opts: {
    formatId: string
    formatSnapshot: DebateFormatData
    label?: string
    eventId?: string
    roundId?: string
    teamAffId?: string
    teamNegId?: string
    topicId?: string
    eventName?: string
    teamAffName?: string
    teamNegName?: string
    topicTitle?: string
  }): TimerSession {
    const now = new Date().toISOString()
    const firstStage = opts.formatSnapshot.stages[0]
    const isFreeDebate = !!firstStage?.isFreeDebate
    // 使用 resolveInitialSide：自由辩论环节 side='both' 时强制为 'aff'，避免 12 分钟 bug
    const initialSide = resolveInitialSide(firstStage)
    // 初始化 stageRemainingCache：首环节写入初始时长，与会话恢复时的 cache 逻辑保持一致
    const stageRemainingCache: Record<number, StageCacheValue> | null = firstStage
      ? (isFreeDebate
          ? { 0: { aff: firstStage.durationMs, neg: firstStage.durationMs } }
          : { 0: firstStage.durationMs })
      : null
    const session: TimerSession = {
      id: uuidv4(),
      eventId: opts.eventId ?? null,
      roundId: opts.roundId ?? null,
      teamAffId: opts.teamAffId ?? null,
      teamNegId: opts.teamNegId ?? null,
      topicId: opts.topicId ?? null,
      formatId: opts.formatId,
      formatSnapshot: opts.formatSnapshot,
      status: 'idle',
      startedAt: null,
      endedAt: null,
      currentStageIndex: 0,
      currentSide: initialSide,
      remainingMs: firstStage?.durationMs ?? null,
      themeSnapshot: null,
      label: opts.label ?? null,
      createdAt: now,
      // 初始化自由辩论相关字段（修复 M4：原代码未写入，导致创建后立即关闭应用会丢失状态）
      stageRemainingCache,
      affRemainingMs: isFreeDebate ? (firstStage?.durationMs ?? null) : null,
      negRemainingMs: isFreeDebate ? (firstStage?.durationMs ?? null) : null,
      // 冗余快照：创建时捕获名称，删除关联记录后仍可显示
      eventName: opts.eventName ?? null,
      teamAffName: opts.teamAffName ?? null,
      teamNegName: opts.teamNegName ?? null,
      topicTitle: opts.topicTitle ?? null
    }
    getDb().prepare(`
      INSERT INTO timer_sessions
        (id, event_id, round_id, team_aff_id, team_neg_id, topic_id,
         format_id, format_snapshot, status, started_at, ended_at,
         current_stage_index, current_side, remaining_ms, theme_snapshot, label, created_at,
         stage_remaining_cache, aff_remaining_ms, neg_remaining_ms,
         event_name, team_aff_name, team_neg_name, topic_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id, session.eventId, session.roundId, session.teamAffId, session.teamNegId, session.topicId,
      session.formatId, JSON.stringify(session.formatSnapshot), session.status, session.startedAt, session.endedAt,
      session.currentStageIndex, session.currentSide, session.remainingMs, session.themeSnapshot, session.label, session.createdAt,
      session.stageRemainingCache ? JSON.stringify(session.stageRemainingCache) : null,
      session.affRemainingMs,
      session.negRemainingMs,
      session.eventName,
      session.teamAffName,
      session.teamNegName,
      session.topicTitle
    )
    return session
  },

  getById(id: string): TimerSession | null {
    const row = getDb().prepare('SELECT * FROM timer_sessions WHERE id = ?').get(id) as SessionRow | undefined
    return row ? rowToSession(row) : null
  },

  listRecent(limit = 50): TimerSession[] {
    const rows = getDb().prepare('SELECT * FROM timer_sessions ORDER BY created_at DESC LIMIT ?').all(limit) as SessionRow[]
    return rows.map(rowToSession)
  },

  update(id: string, opts: Partial<Pick<TimerSession, 'status' | 'startedAt' | 'endedAt' | 'currentStageIndex' | 'currentSide' | 'remainingMs' | 'stageRemainingCache' | 'affRemainingMs' | 'negRemainingMs'>>): TimerSession | null {
    const existing = this.getById(id)
    if (!existing) return null
    const updated = { ...existing, ...opts }
    getDb().prepare(`
      UPDATE timer_sessions
      SET status = ?, started_at = ?, ended_at = ?, current_stage_index = ?, current_side = ?, remaining_ms = ?, stage_remaining_cache = ?, aff_remaining_ms = ?, neg_remaining_ms = ?
      WHERE id = ?
    `).run(
      updated.status, updated.startedAt, updated.endedAt,
      updated.currentStageIndex, updated.currentSide, updated.remainingMs,
      updated.stageRemainingCache ? JSON.stringify(updated.stageRemainingCache) : null,
      updated.affRemainingMs ?? null,
      updated.negRemainingMs ?? null,
      id
    )
    return updated
  },

  delete(id: string): boolean {
    const result = getDb().prepare('DELETE FROM timer_sessions WHERE id = ?').run(id)
    return result.changes > 0
  },

  addRecord(opts: {
    sessionId: string
    stageIndex: number
    stageName: string
    side: StageSide
    durationMs: number
    startedAt: string
  }): TimerRecord {
    // P2-8: 首次调用时确保 timer_records 存在 (session_id, stage_index) 唯一索引
    ensureTimerRecordsUniqueIndex()
    const record: TimerRecord = {
      id: uuidv4(),
      sessionId: opts.sessionId,
      stageIndex: opts.stageIndex,
      stageName: opts.stageName,
      side: opts.side,
      durationMs: opts.durationMs,
      actualMs: null,
      startedAt: opts.startedAt,
      endedAt: null,
      pauseCount: 0
    }
    getDb().prepare(`
      INSERT INTO timer_records
        (id, session_id, stage_index, stage_name, side, duration_ms, actual_ms, started_at, ended_at, pause_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.sessionId, record.stageIndex, record.stageName, record.side,
      record.durationMs, record.actualMs, record.startedAt, record.endedAt, record.pauseCount
    )
    return record
  },

  finishRecord(sessionId: string, stageIndex: number, actualMs: number, endedAt: string, pauseCount: number): void {
    // P2: 仅更新最新一条匹配记录，避免旧库存在重复行时批量更新多行。
    // 通过子查询定位 rowid，按 started_at DESC 取最新一条。
    getDb().prepare(`
      UPDATE timer_records
      SET actual_ms = ?, ended_at = ?, pause_count = ?
      WHERE rowid = (
        SELECT rowid FROM timer_records
        WHERE session_id = ? AND stage_index = ?
        ORDER BY started_at DESC LIMIT 1
      )
    `).run(actualMs, endedAt, pauseCount, sessionId, stageIndex)
  },

  listRecords(sessionId: string): TimerRecord[] {
    const rows = getDb().prepare('SELECT * FROM timer_records WHERE session_id = ? ORDER BY stage_index ASC').all(sessionId) as RecordRow[]
    return rows.map(rowToRecord)
  },

  clearAll(): number {
    const result = getDb().prepare('DELETE FROM timer_sessions').run()
    return result.changes
  },

  clearAllRecords(): number {
    const result = getDb().prepare('DELETE FROM timer_records').run()
    return result.changes
  },

  exportRecords(sessionId: string): TimerRecord[] {
    return this.listRecords(sessionId)
  },

  /** 备份用：一次性返回 timer_sessions / timer_records 两张表的全部行（DB 原始格式） */
  findAllForBackup(): {
    timer_sessions: Record<string, unknown>[]
    timer_records: Record<string, unknown>[]
  } {
    const db = getDb()
    return {
      timer_sessions: db.prepare('SELECT * FROM timer_sessions').all() as Record<string, unknown>[],
      timer_records: db.prepare('SELECT * FROM timer_records').all() as Record<string, unknown>[]
    }
  },

  /** 批量恢复 timer_sessions / timer_records 表。调用方需在外层事务内执行。 */
  bulkRestore(
    table: 'timer_sessions' | 'timer_records',
    rows: Array<Record<string, unknown>>,
    strategy: BackupImportStrategy
  ): number {
    return bulkInsert(table, rows, strategy)
  }
}
