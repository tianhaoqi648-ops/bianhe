// ============================================================
// migrations/helpers.ts — 迁移工具函数
//
// 目标（Task3 加固）：消除「字段缺失但迁移标记已应用」的半状态。
//   - ensureColumn / ensureIndex：把过去的 `try{ ALTER } catch{}` 静默吞错改为
//     「先查列是否存在」的幂等写法；列一旦真的缺失且 ALTER 失败，会真实抛错，
//     由 runMigrations 判定为关键失败并中止，绝不静默标记已应用。
//   - 兼容前置建表顺序：若目标表尚未创建（表被后续迁移建），返回 'table-not-exists'
//     优雅跳过——该表稍后创建时会携带这些列（幂等前向兼容）。
// ============================================================

import type { Database } from 'better-sqlite3'

/** 表是否存在 */
export function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table)
  return !!row
}

/** ensureColumn 结果：'exists' 已存在（幂等跳过）| 'added' 新增 | 'table-not-exists' 表尚不存在 */
export type EnsureColumnResult = 'exists' | 'added' | 'table-not-exists'

/**
 * 确保某表存在某列（幂等）。
 * - 表不存在 → 返回 'table-not-exists'（后续迁移建表会带该列，优雅跳过）
 * - 列已存在 → 返回 'exists'
 * - 列缺失  → 执行 ALTER TABLE ADD COLUMN；失败则真实抛错（由 runMigrations 处理）
 *
 * @param column 列名（仅用于存在性检查）
 * @param columnSql 列定义（如 `custom_data TEXT`）
 */
export function ensureColumn(
  db: Database,
  table: string,
  column: string,
  columnSql: string
): EnsureColumnResult {
  if (!tableExists(db, table)) return 'table-not-exists'
  const cols = db
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table) as Array<{ name: string }>
  if (cols.some((c) => c.name === column)) return 'exists'
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`)
  return 'added'
}

/**
 * 确保索引存在。使用 CREATE INDEX IF NOT EXISTS（天然幂等）。
 * 调用方必须保证引用的列已存在（先 ensureColumn），否则会真实抛错。
 */
export function ensureIndex(db: Database, sql: string): void {
  db.exec(sql)
}