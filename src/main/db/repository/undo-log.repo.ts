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
 * 自动计算 payload_size；超过 1MB 时不写入并抛错（调用方捕获后跳过入栈）。
 *
 * @returns log id
 * @throws Error 当 payload_size > 1MB 时
 */
function createLog(input: CreateLogInput): string {
  const db = getDb()
  const beforeJson = input.before_data === null ? null : JSON.stringify(input.before_data)
  const afterJson = input.after_data === null ? null : JSON.stringify(input.after_data)
  // P4: payload_size 使用字节长度而非字符长度，避免多字节字符导致 size 低估
  const payloadSize =
    (beforeJson ? Buffer.byteLength(beforeJson, 'utf8') : 0) +
    (afterJson ? Buffer.byteLength(afterJson, 'utf8') : 0)

  // 1MB = 1048576 字节
  if (payloadSize > 1048576) {
    throw new Error(`[undoLog] payload too large: ${payloadSize} bytes (limit 1048576)`)
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
  // 备份与恢复
  findAllForBackup,
  bulkRestore
}
