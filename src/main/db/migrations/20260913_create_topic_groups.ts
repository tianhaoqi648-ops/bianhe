// ============================================================
// 20260913_create_topic_groups.ts
//   赛事题库（Event Topic Bank）三张表 + 默认题库种子
//
// 背景：辩题是全局的、题库里没有赛事标签，而「已抽/未抽」是事件级概念。
//   为支持「赛事级题库」，新增三个实体：
//   - topic_groups：全局可复用的题组（题库），支持 is_default 默认标记
//   - topic_group_items：题组 ↔ 辩题 多对多
//   - event_topic_groups：赛事 ↔ 题组 多对多（赛事选题组）
//
// 幂等性：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS，
//   默认题库种子用 INSERT OR IGNORE 按固定 id 写入，已存在则跳过。
//   旧库直接加表，不改任何旧表结构。
// ============================================================

import type { Database } from 'better-sqlite3'

/**
 * 默认题库的固定 id。seed 与 repo 层（ensureDefaultGroup）共用，
 * 保证「默认题库」在任意时间点都可被幂等保证存在。
 */
export const DEFAULT_TOPIC_GROUP_ID = 'default-group'
export const DEFAULT_TOPIC_GROUP_NAME = '默认题库'

/**
 * 建三张题组相关表 + 索引，并预置「默认题库」（幂等）。
 * 调用方：migrations/index.ts 的 MIGRATIONS 数组（按 id 排序执行）。
 */
export function createTopicGroupsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topic_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_topic_groups_is_default ON topic_groups(is_default);

    CREATE TABLE IF NOT EXISTS topic_group_items (
      group_id  TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE,
      topic_id  TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, topic_id)
    );
    CREATE INDEX IF NOT EXISTS idx_topic_group_items_topic_id ON topic_group_items(topic_id);

    CREATE TABLE IF NOT EXISTS event_topic_groups (
      event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      group_id  TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (event_id, group_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_topic_groups_group_id ON event_topic_groups(group_id);
  `)

  // 预置「默认题库」（is_default=1），按固定 id 幂等写入
  db.prepare(
    `INSERT OR IGNORE INTO topic_groups (id, name, is_default, created_at) VALUES (?, ?, 1, ?)`
  ).run(DEFAULT_TOPIC_GROUP_ID, DEFAULT_TOPIC_GROUP_NAME, new Date().toISOString())
}