// ============================================================
// repository/utils.ts — 备份恢复通用辅助
//
// 提供 buildUpsertSQL / clearTable / bulkInsert 三个通用方法，
// 供各 repo 的 bulkRestore 复用。所有方法同步执行（better-sqlite3 风格）。
// ============================================================

import { getDb } from '../index'
import type { BackupImportStrategy } from '../../../shared/types'

/**
 * 表名 → 允许的列名白名单。
 *
 * 用途：bulkInsert 校验 rows[0] 的 key 列表，防止恶意备份 JSON
 * 通过列名拼入 SQL 注入 payload（例如 "id) VALUES (1); DROP TABLE topics; --"）。
 *
 * 维护：新增表或字段时需同步更新此处与 schema.sql / migrations。
 */
export const TABLE_COLUMNS: Record<string, string[]> = {
  topics: [
    'id', 'title', 'type', 'domain', 'difficulty', 'source', 'source_type',
    'tags', 'weight', 'status', 'created_at', 'updated_at', 'custom_data', 'batch_id'
  ],
  events: ['id', 'name', 'start_date', 'end_date', 'status', 'created_at', 'allow_repeat'],
  rounds: [
    'id', 'event_id', 'name', 'round_number', 'difficulty_override',
    'topic_count', 'is_round_robin'
  ],
  team_groups: ['id', 'event_id', 'name', 'sort_order', 'created_at'],
  teams: ['id', 'name', 'event_id', 'group_id'],
  team_history: ['id', 'team_id', 'topic_id', 'event_id', 'played_at', 'session_id', 'stance'],
  draw_sessions: ['id', 'event_id', 'round_id', 'draw_time', 'operator', 'settings'],
  draw_session_items: [
    'id', 'session_id', 'topic_id', 'team_a_id', 'team_b_id', 'stance_a', 'stance_b',
    'topic_title', 'team_a_name', 'team_b_name', 'team_ids', 'team_stances',
    'team_names', 'group_id'
  ],
  audit_log: ['id', 'action', 'target_type', 'target_id', 'operator', 'detail', 'created_at'],
  settings: ['key', 'value'],
  topic_custom_fields: ['field_key', 'field_label', 'field_type', 'sort_order', 'created_at'],
  import_batch: [
    'id', 'file_name', 'total_count', 'imported_count', 'duplicates_count',
    'failed_count', 'imported_at', 'notes'
  ],
  batch_edit_history: [
    'id', 'executed_at', 'topic_count', 'field_count', 'summary',
    'reverted', 'reverted_at'
  ],
  batch_edit_history_item: ['id', 'history_id', 'topic_id', 'before_values', 'after_values'],
  undo_log: [
    'id', 'created_at', 'store_name', 'action', 'target_type', 'target_id',
    'before_data', 'after_data', 'payload_size', 'label', 'undone_at'
  ],
  debate_formats: [
    'id', 'name', 'description', 'is_preset', 'format_data', 'created_at', 'updated_at'
  ],
  timer_sessions: [
    'id', 'event_id', 'round_id', 'team_aff_id', 'team_neg_id', 'topic_id',
    'format_id', 'format_snapshot', 'status', 'started_at', 'ended_at',
    'current_stage_index', 'current_side', 'remaining_ms', 'theme_snapshot',
    'label', 'created_at', 'stage_remaining_cache', 'aff_remaining_ms',
    'neg_remaining_ms', 'event_name', 'team_aff_name', 'team_neg_name', 'topic_title'
  ],
  timer_records: [
    'id', 'session_id', 'stage_index', 'stage_name', 'side', 'duration_ms',
    'actual_ms', 'started_at', 'ended_at', 'pause_count'
  ],
  bell_assets: ['id', 'name', 'file_path', 'file_size', 'mime_type', 'duration_ms', 'created_at']
}

/**
 * 构造批量 upsert SQL。
 *
 * 策略映射：
 *   - skip_existing    → INSERT OR IGNORE
 *   - overwrite_existing → INSERT OR REPLACE
 *   - clear_rebuild    → INSERT（调用方已先清空表）
 *
 * 注意：调用方需确保 table/columns 来自可信来源（schema 内部常量），
 * 不直接接受用户输入，避免 SQL 注入。bulkInsert 会在调用前校验白名单。
 *
 * @param table 表名
 * @param columns 列名数组
 * @param strategy 导入策略
 * @returns SQL 字符串
 */
export function buildUpsertSQL(
  table: string,
  columns: string[],
  strategy: BackupImportStrategy
): string {
  const placeholders = columns.map(() => '?').join(', ')
  const colList = columns.join(', ')
  const prefix =
    strategy === 'skip_existing'
      ? 'INSERT OR IGNORE'
      : strategy === 'overwrite_existing'
        ? 'INSERT OR REPLACE'
        : 'INSERT'
  return `${prefix} INTO ${table} (${colList}) VALUES (${placeholders})`
}

/**
 * 清空指定表（用于 clear_rebuild 策略）。
 * 调用方需在外层事务内调用，确保与后续插入原子化。
 *
 * P4-6: 校验表名白名单 + 改用 prepare().run()。
 *   - exec 可执行多条语句，恶意表名可拼接第二条 SQL 造成注入；
 *     prepare 仅允许单条语句，从机制上杜绝多语句注入。
 *   - 白名单复用 TABLE_COLUMNS，与 bulkInsert 校验逻辑一致。
 */
export function clearTable(table: string): void {
  if (!TABLE_COLUMNS[table]) {
    throw new Error(`[clearTable] 不允许的表名: ${table}`)
  }
  getDb().prepare(`DELETE FROM ${table}`).run()
}

/**
 * 批量插入数据。
 *
 * - rows 为空直接返回 0
 * - 以 rows[0] 的 key 列表作为列名
 * - 按 strategy 走 INSERT OR IGNORE / INSERT OR REPLACE / INSERT
 * - 返回受影响行数（result.changes 累加）
 *
 * @param table 表名
 * @param rows 行数据数组（每行 key 必须一致）
 * @param strategy 导入策略
 * @returns 插入条数（受 changes 影响的行数）
 */
export function bulkInsert(
  table: string,
  rows: Array<Record<string, unknown>>,
  strategy: BackupImportStrategy
): number {
  if (rows.length === 0) return 0
  // Bug P1-1: 校验表名与列名白名单，防止备份 JSON 中混入恶意列名造成 SQL 注入。
  // 备份 JSON 来自外部文件，Object.keys(rows[0]) 直接拼入 SQL，必须做白名单校验。
  const allowedColumns = TABLE_COLUMNS[table]
  if (!allowedColumns) {
    throw new Error(`[bulkInsert] 不允许的表名: ${table}`)
  }
  // P2-30: 遍历所有行取 key 并集，避免仅用 rows[0] 的 key 导致后续行的额外字段被忽略
  const columnSet = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columnSet.add(key)
    }
  }
  const columns = Array.from(columnSet)
  const invalid = columns.filter((c) => !allowedColumns.includes(c))
  if (invalid.length > 0) {
    throw new Error(
      `[bulkInsert] 表 ${table} 包含不在白名单中的列名: ${invalid.join(', ')}`
    )
  }
  const sql = buildUpsertSQL(table, columns, strategy)
  const stmt = getDb().prepare(sql)
  let inserted = 0
  for (const row of rows) {
    const result = stmt.run(...columns.map((c) => (row[c] ?? null) as never))
    inserted += result.changes
  }
  return inserted
}
