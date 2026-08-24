// ============================================================
// 20260914_create_round_topic_groups.ts
//   轮次→题库绑定表 + 事件选题模式配置列
//
// 背景：赛事题库深化（T1·数据层）。
//   - round_topic_groups：轮次 ↔ 题组 多对多，用于「按轮次指定题库」（by_round）
//   - events.bank_config：JSON 列，存赛事「选题模式」配置
//     （{ mode: single|union|priority|by_round, priorityOrder?, roundBanks? }），
//     覆盖优先级顺序与轮次库映射，避免改动 event_topic_groups 结构。
//
// 幂等性：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS；
//   events.bank_config 用 try/catch 包裹 ALTER TABLE（SQLite 无 ADD COLUMN IF NOT EXISTS）。
// 不修改任何旧表结构（event_topic_groups 保持 (event_id, group_id) 不变）。
// ============================================================

import type { Database } from 'better-sqlite3'
import { ensureColumn } from './helpers'

/**
 * 建 round_topic_groups 表 + 索引，并给 events 加 bank_config 列。
 * 调用方：migrations/index.ts 的 MIGRATIONS 数组（按 id 排序执行）。
 */
export function createRoundTopicGroupsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS round_topic_groups (
      round_id  TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      group_id  TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (round_id, group_id)
    );
    CREATE INDEX IF NOT EXISTS idx_round_topic_groups_group_id ON round_topic_groups(group_id);
  `)

  // events 加 bank_config 列（JSON：选题模式配置），旧库无该列时补齐（幂等，缺失且失败则真实抛错）
  ensureColumn(db, 'events', 'bank_config', 'bank_config TEXT')
}