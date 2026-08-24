// ============================================================
// batch-edit-history.repo.ts — 批量编辑历史仓库
//
// 存储每次批量编辑的字段级 before/after 快照，支持多级撤销。
// 撤销时按快照恢复字段值，历史记录保留并标记 reverted=true。
//
// 表结构：
//   batch_edit_history        主表：一次批量编辑操作（摘要 + 撤销状态）
//   batch_edit_history_item   明细：每条 topic 的字段 before/after 快照
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import { bulkInsert } from './utils'
import type {
  BatchEditHistory,
  BatchEditHistoryItem,
  BackupImportStrategy
} from '../../../shared/types'

/** DB batch_edit_history 表的原始行类型 */
export interface BatchEditHistoryRow {
  id: string
  executed_at: string
  topic_count: number
  field_count: number
  summary: string | null
  reverted: number // DB 存 0/1
  reverted_at: string | null
}

/** DB batch_edit_history_item 表的原始行类型 */
export interface BatchEditHistoryItemRow {
  id: string
  history_id: string
  topic_id: string
  before_values: string | null // JSON
  after_values: string | null // JSON
}

/** 反序列化：DB row -> BatchEditHistory */
function rowToHistory(row: BatchEditHistoryRow): BatchEditHistory {
  return {
    id: row.id,
    executed_at: row.executed_at,
    topic_count: row.topic_count,
    field_count: row.field_count,
    summary: row.summary,
    reverted: row.reverted === 1,
    reverted_at: row.reverted_at
  }
}

/**
 * 创建一条批量编辑历史记录 + 明细。
 * 在调用方事务内执行（与 batchUpdateTopics 同一事务）。
 *
 * @param snapshots 来自 topicRepo.batchUpdateTopics 的快照
 * @param summary 摘要文案
 * @returns historyId
 */
function createHistory(
  snapshots: Array<{
    topicId: string
    before: Record<string, unknown>
    after: Record<string, unknown>
  }>,
  summary: string
): string {
  const db = getDb()
  const historyId = uuidv4()
  const now = new Date().toISOString()

  // 计算字段数（取所有快照 after 的 key 并集）
  const fieldSet = new Set<string>()
  for (const s of snapshots) {
    for (const k of Object.keys(s.after)) fieldSet.add(k)
  }

  db.prepare(`
    INSERT INTO batch_edit_history
      (id, executed_at, topic_count, field_count, summary, reverted, reverted_at)
    VALUES (?, ?, ?, ?, ?, 0, NULL)
  `).run(historyId, now, snapshots.length, fieldSet.size, summary)

  const itemStmt = db.prepare(`
    INSERT INTO batch_edit_history_item
      (id, history_id, topic_id, before_values, after_values)
    VALUES (?, ?, ?, ?, ?)
  `)

  for (const s of snapshots) {
    itemStmt.run(
      uuidv4(),
      historyId,
      s.topicId,
      JSON.stringify(s.before),
      JSON.stringify(s.after)
    )
  }

  return historyId
}

/**
 * 列出批量编辑历史，按时间倒序，最多 limit 条（默认 20）。
 */
function listHistory(limit: number = 20): BatchEditHistory[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT * FROM batch_edit_history ORDER BY executed_at DESC LIMIT ?`
    )
    .all(limit) as BatchEditHistoryRow[]
  return rows.map(rowToHistory)
}

/**
 * 按 id 查询历史记录。
 */
function getHistoryById(id: string): BatchEditHistory | undefined {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM batch_edit_history WHERE id = ?')
    .get(id) as BatchEditHistoryRow | undefined
  return row ? rowToHistory(row) : undefined
}

/**
 * 按历史 id 查询明细项。
 *
 * 容错：before_values / after_values 损坏时回退 null，不影响其他明细项。
 */
function listItemsByHistory(historyId: string): BatchEditHistoryItem[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM batch_edit_history_item WHERE history_id = ?')
    .all(historyId) as BatchEditHistoryItemRow[]

  return rows.map((r) => {
    let beforeValues: Record<string, unknown> | null = null
    let afterValues: Record<string, unknown> | null = null
    if (r.before_values) {
      try {
        beforeValues = JSON.parse(r.before_values)
      } catch {
        // P2-5: before_values 损坏，回退 null
        beforeValues = null
      }
    }
    if (r.after_values) {
      try {
        afterValues = JSON.parse(r.after_values)
      } catch {
        // P2-5: after_values 损坏，回退 null
        afterValues = null
      }
    }
    return {
      id: r.id,
      history_id: r.history_id,
      topic_id: r.topic_id,
      before_values: beforeValues,
      after_values: afterValues
    }
  })
}

/**
 * 标记一条批量编辑历史为已撤销（单库单动作，仅改 batch_edit_history 表）。
 * topic 字段恢复逻辑已上移到 services/batch-edit-service.ts 编排（Governance Task 6），
 * 业务方应在恢复 topics 后调用本方法；事务由 Service 负责。
 */
function markReverted(historyId: string): void {
  getDb()
    .prepare('UPDATE batch_edit_history SET reverted = 1, reverted_at = ? WHERE id = ?')
    .run(new Date().toISOString(), historyId)
}

/**
 * 清空所有批量编辑历史（数据重置用）。
 * 明细表通过 CASCADE 自动清理，但显式删除更安全。
 */
function clearAll(): number {
  const db = getDb()
  db.prepare('DELETE FROM batch_edit_history_item').run()
  return db.prepare('DELETE FROM batch_edit_history').run().changes
}

// ============================================================
// 备份与恢复（全量数据导入导出）
// ============================================================

/**
 * 备份用：一次性返回 batch_edit_history + batch_edit_history_item 两张表的全部行（DB 原始格式）。
 */
function findAllForBackup(): {
  batch_edit_history: Record<string, unknown>[]
  batch_edit_history_item: Record<string, unknown>[]
} {
  const db = getDb()
  return {
    batch_edit_history: db
      .prepare('SELECT * FROM batch_edit_history')
      .all() as Record<string, unknown>[],
    batch_edit_history_item: db
      .prepare('SELECT * FROM batch_edit_history_item')
      .all() as Record<string, unknown>[]
  }
}

/**
 * 批量恢复 batch_edit_history / batch_edit_history_item 表。
 * 调用方需在外层事务内执行。
 */
function bulkRestore(
  table: 'batch_edit_history' | 'batch_edit_history_item',
  rows: Array<Record<string, unknown>>,
  strategy: BackupImportStrategy
): number {
  return bulkInsert(table, rows, strategy)
}

export const batchEditHistoryRepo = {
  createHistory,
  listHistory,
  getHistoryById,
  listItemsByHistory,
  markReverted,
  clearAll,
  // 备份与恢复
  findAllForBackup,
  bulkRestore
}
