// ============================================================
// undo-log.repo.ts — undo_log 表仓库
//
// 提供 undo_log 表的 CRUD 方法：
//   - createLog: 在事务中记录一条 undo log
//   - getLatest: 取最新一条未撤销 log（撤销用）
//   - getLatestRedoable: 取最新一条已撤销 log（重做用）
//   - getById: 按 id 查询
//   - listRecent: 按时间倒序列出最近 N 条
//   - markUndone: 标记 log 为已撤销（不删除，支持 redo）
//   - clearUndone: 清除 undone_at 标记（redo 后调用）
//   - deleteById / deleteByIds / clearAll / countAll
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import { bulkInsert } from './utils'
import type { UndoLogEntry, BackupImportStrategy } from '../../../shared/types'
import { validateUndoPayload } from '../../../shared/config-validator'

// ============================================================
// Governance-8.2：Undo 容量/生命周期保护（保留前先读 createLog 顶部注释）
//
// Undo 采用 best-effort（策略 B）：业务成功优先，undo_log 容量受限时自动清理，
// 绝不因日志产生或清理而阻塞业务，也不允许长期无限膨胀。
// 相关配置用于：
//   - 约束批量快照：单条 payload 超过 1MB 不入 undo（createLog 抛错，调用方跳过入栈并提示）
//   - 总条数上限 / 总字节上限：超限删最旧
//   - retention（按时间保留策略）：超过保留窗口的日志被清理
// ============================================================
export const UNDO_CONFIG = {
  /** 单条 payload 上限（字节）。超过则该次不可撤销（best-effort：业务仍成功）。 */
  MAX_PAYLOAD_BYTES: 1048576, // 1MB
  /** undo_log 总条数上限：超过则删除最旧日志 */
  MAX_LOGS: 200,
  /** undo_log 总 payload 字节上限：超过则删除最旧日志直至达标 */
  MAX_TOTAL_BYTES: 50 * 1024 * 1024, // 50MB
  /** 日志保留时长（毫秒）：超过保留窗口的最旧日志被清理 */
  RETENTION_MS: 30 * 24 * 60 * 60 * 1000 // 30 天
} as const

interface UndoLogRow {
  id: string
  created_at: string
  store_name: string
  action: string
  target_type: string
  target_id: string | null
  before_data: string | null
  after_data: string | null
  payload_size: number
  label: string | null
  undone_at: string | null
}

/**
 * 反序列化：DB row -> UndoLogEntry
 *
 * 容错：before_data / after_data 损坏时回退 null，避免单条坏数据导致整列查询失败。
 */
function rowToEntry(row: UndoLogRow): UndoLogEntry {
  let beforeData: unknown | null = null
  let afterData: unknown | null = null
  if (row.before_data) {
    try {
      beforeData = JSON.parse(row.before_data)
    } catch {
      // P2-6: before_data 损坏，回退 null
      beforeData = null
    }
  }
  if (row.after_data) {
    try {
      afterData = JSON.parse(row.after_data)
    } catch {
      // P2-6: after_data 损坏，回退 null
      afterData = null
    }
  }
  return {
    id: row.id,
    created_at: row.created_at,
    store_name: row.store_name as UndoLogEntry['store_name'],
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    before_data: beforeData,
    after_data: afterData,
    payload_size: row.payload_size,
    label: row.label,
    undone_at: row.undone_at ?? null
  }
}

interface CreateLogInput {
  store_name: UndoLogEntry['store_name']
  action: string
  target_type: string
  target_id: string | null
  before_data: unknown | null
  after_data: unknown | null
  label: string
}

/**
 * 创建一条 undo log。在调用方事务内执行。
 * 自动计算 payload_size；超过单条上限时不写入并抛错（调用方捕获后跳过入栈）。
 * 写入成功后执行容量/生命周期保护（Governance-8.2）：超期、超条数、超总字节时删最旧。
 *
 * @returns log id
 * @throws Error 当 payload_size > UNDO_CONFIG.MAX_PAYLOAD_BYTES 时
 */
function createLog(input: CreateLogInput): string {
  const db = getDb()
  // governance 12：undo 快照属「只读历史快照 / 恢复用」字段——不在此强校验具体业务字段
  //（避免破坏老版本写入的旧结构/合法旧格式），仅做轻量结构守卫：原始类型快照或
  // topicGroup setBankConfig 内嵌 config 非法时视为「不可撤销」。
  // 抛错后由 withUndoLog 捕获并降级（logId=null，业务已提交不阻断），非法日志不入库。
  const v = validateUndoPayload({
    storeName: input.store_name,
    before: input.before_data,
    after: input.after_data
  })
  if (!v.ok) throw new Error(`[undoLog] invalid undo payload: ${v.error}`)
  const beforeJson = input.before_data === null ? null : JSON.stringify(input.before_data)
  const afterJson = input.after_data === null ? null : JSON.stringify(input.after_data)
  // P4: payload_size 使用字节长度而非字符长度，避免多字节字符导致 size 低估
  const payloadSize =
    (beforeJson ? Buffer.byteLength(beforeJson, 'utf8') : 0) +
    (afterJson ? Buffer.byteLength(afterJson, 'utf8') : 0)

  // 超限批量快照不入 undo（best-effort：业务已成功，仅该次不可撤销）
  if (payloadSize > UNDO_CONFIG.MAX_PAYLOAD_BYTES) {
    throw new Error(
      `[undoLog] payload too large: ${payloadSize} bytes (limit ${UNDO_CONFIG.MAX_PAYLOAD_BYTES})`
    )
  }

  const id = uuidv4()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO undo_log
      (id, created_at, store_name, action, target_type, target_id,
       before_data, after_data, payload_size, label, undone_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    now,
    input.store_name,
    input.action,
    input.target_type,
    input.target_id,
    beforeJson,
    afterJson,
    payloadSize,
    input.label
  )

  // 容量/生命周期保护：太过频繁的新日志会被最旧日志淘汰，保证不无限膨胀。
  // 与写操作同事务（createLog 在调用方事务内执行）。
  enforceCapacity()

  return id
}

/** 取最新一条未撤销 log（撤销用） */
function getLatest(): UndoLogEntry | undefined {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM undo_log WHERE undone_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .get() as UndoLogRow | undefined
  return row ? rowToEntry(row) : undefined
}

/** 取最新一条已撤销 log（重做用） */
function getLatestRedoable(): UndoLogEntry | undefined {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM undo_log WHERE undone_at IS NOT NULL ORDER BY undone_at DESC LIMIT 1')
    .get() as UndoLogRow | undefined
  return row ? rowToEntry(row) : undefined
}

/** 按 id 查询 */
function getById(id: string): UndoLogEntry | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM undo_log WHERE id = ?').get(id) as
    | UndoLogRow
    | undefined
  return row ? rowToEntry(row) : undefined
}

/** 按时间倒序列出最近 N 条（默认 50，含已撤销的） */
function listRecent(limit: number = 50): UndoLogEntry[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM undo_log ORDER BY created_at DESC LIMIT ?')
    .all(limit) as UndoLogRow[]
  return rows.map(rowToEntry)
}

/**
 * 标记 log 为已撤销（设置 undone_at）。不删除 log，支持后续 redo。
 */
function markUndone(id: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare('UPDATE undo_log SET undone_at = ? WHERE id = ?').run(now, id)
}

/**
 * 清除 undone_at 标记（redo 后调用，使 log 重新变为可撤销状态）。
 */
function clearUndone(id: string): void {
  const db = getDb()
  db.prepare('UPDATE undo_log SET undone_at = NULL WHERE id = ?').run(id)
}

/** 按 id 删除单条 */
function deleteById(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM undo_log WHERE id = ?').run(id)
}

/** 按 id 列表批量删除 */
function deleteByIds(ids: string[]): void {
  if (ids.length === 0) return
  const db = getDb()
  const stmt = db.prepare('DELETE FROM undo_log WHERE id = ?')
  const delMany = db.transaction((its: string[]) => {
    for (const id of its) stmt.run(id)
  })
  delMany(ids)
}

/** 清空全表（应用启动 + 数据重置用） */
function clearAll(): number {
  const db = getDb()
  const result = db.prepare('DELETE FROM undo_log').run()
  return result.changes
}

/** 统计总条数 */
function countAll(): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) AS total FROM undo_log').get() as
    | { total: number }
    | undefined
  return row ? Number(row.total) : 0
}

/** 统计 undo_log 总 payload 字节数 */
function sumPayload(): number {
  const db = getDb()
  const row = db
    .prepare('SELECT COALESCE(SUM(payload_size), 0) AS total FROM undo_log')
    .get() as { total: number } | undefined
  return row ? Number(row.total) : 0
}

/** undo_log 容量/生命周期统计（测试与诊断用） */
function getStats(): { count: number; totalBytes: number } {
  return { count: countAll(), totalBytes: sumPayload() }
}

/**
 * 容量/生命周期保护（Governance-8.2）：删除超期、超条数、超总字节的最旧日志。
 *
 * 顺序：
 *   1. retention：删除超过保留窗口的最旧日志（无论是否已撤销）
 *   2. 总条数上限：超限则按 created_at 删最旧直至达标
 *   3. 总字节上限：超限则按 created_at 删最旧直至达标
 *
 * 调用时机：createLog 写入后（与写操作同事务）；也可在数据重置时显式调用。
 * best-effort：清理失败不影响业务结果（调用方事务内异常会被 withUndoLog 捕获为不可撤销）。
 *
 * @param configOverride 覆盖容量配置（测试用，可传较小阈值）
 * @returns 删除的日志行数
 */
function enforceCapacity(
  configOverride: Partial<Record<keyof typeof UNDO_CONFIG, number>> = {}
): number {
  const cfg = { ...UNDO_CONFIG, ...configOverride }
  const db = getDb()
  let deleted = 0

  // 1) retention：删除超过保留窗口的最旧日志
  const cutoff = new Date(Date.now() - cfg.RETENTION_MS).toISOString()
  const expired = db.prepare('DELETE FROM undo_log WHERE created_at < ?').run(cutoff)
  deleted += Number(expired.changes ?? 0)

  // 读取当前条数 / 总字节（于 retention 清理后读取）
  let count = 0
  let totalBytes = 0
  const countRow = db.prepare('SELECT COUNT(*) AS total FROM undo_log').get() as
    | { total: number }
    | undefined
  const sumRow = db
    .prepare('SELECT COALESCE(SUM(payload_size), 0) AS total FROM undo_log')
    .get() as { total: number } | undefined
  if (countRow) count = Number(countRow.total) || 0
  if (sumRow) totalBytes = Number(sumRow.total) || 0

  const oldestStmt = db.prepare(
    'SELECT id, payload_size FROM undo_log ORDER BY created_at ASC, id ASC LIMIT 1'
  )
  const delStmt = db.prepare('DELETE FROM undo_log WHERE id = ?')

  let guard = 0
  while (
    (count > cfg.MAX_LOGS || totalBytes > cfg.MAX_TOTAL_BYTES) &&
    (guard += 1) <= 100000
  ) {
    const oldest = oldestStmt.get() as { id: string; payload_size: number } | undefined
    if (!oldest) break
    delStmt.run(oldest.id)
    deleted++
    count--
    totalBytes -= Number(oldest.payload_size) || 0
  }

  return deleted
}

// ============================================================
// 备份与恢复（全量数据导入导出）
// ============================================================

/** 备份用：返回 undo_log 全部行（DB 原始格式） */
function findAllForBackup(): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM undo_log').all() as Record<string, unknown>[]
}

/** 批量恢复 undo_log 表。调用方需在外层事务内执行。 */
function bulkRestore(
  rows: Array<Record<string, unknown>>,
  strategy: BackupImportStrategy
): number {
  return bulkInsert('undo_log', rows, strategy)
}

export const undoLogRepo = {
  createLog,
  getLatest,
  getLatestRedoable,
  getById,
  listRecent,
  markUndone,
  clearUndone,
  deleteById,
  deleteByIds,
  clearAll,
  countAll,
  sumPayload,
  getStats,
  enforceCapacity,
  // 备份与恢复
  findAllForBackup,
  bulkRestore
}
