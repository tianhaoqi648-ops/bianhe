// ============================================================
// 20260901_add_allow_repeat_and_test_flag.ts
//   为 events 表添加 allow_repeat 列（赛事级"允许辩题重复"配置）
//
// 添加列：
//   events.allow_repeat INTEGER NOT NULL DEFAULT 0
//     0 = 不允许重复抽取同一辩题
//     1 = 允许重复抽取（小题库场景下用有放回抽样凑满）
//
// 不修改 draw_sessions 表：
//   settings 是 JSON 字段，已天然支持 is_test 子字段，无需 ALTER TABLE
//
// 调用方：migrations/index.ts 中的 MIGRATIONS 数组
// 幂等性：
//   1. __migrations 表追踪 id 保证每个迁移只执行一次
//   2. 本 up 内再用 pragma_table_info 兜底检查列是否已存在，
//      已存在则跳过 ALTER TABLE，避免人工/旧库场景下重复执行报错
// ============================================================

import type { Database } from 'better-sqlite3'

/**
 * 为 events 表添加 allow_repeat 列。
 *
 * 幂等策略：
 *   - 先用 pragma_table_info 查询 events 表现有列
 *   - 若 allow_repeat 列已存在，直接返回（跳过 ALTER TABLE）
 *   - 否则执行 ALTER TABLE events ADD COLUMN allow_repeat INTEGER NOT NULL DEFAULT 0
 */
export function addAllowRepeatAndTestFlag(db: Database): void {
  // 查询 events 表的所有列名
  const columns = db
    .prepare("SELECT name FROM pragma_table_info('events')")
    .all() as Array<{ name: string }>

  const hasAllowRepeat = columns.some((col) => col.name === 'allow_repeat')

  if (hasAllowRepeat) {
    // 列已存在，跳过 ALTER TABLE
    return
  }

  // 添加 allow_repeat 列（赛事级"允许辩题重复"配置）
  db.exec('ALTER TABLE events ADD COLUMN allow_repeat INTEGER NOT NULL DEFAULT 0')
}
