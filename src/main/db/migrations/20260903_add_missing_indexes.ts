// ============================================================
// 20260903_add_missing_indexes.ts
//   补充三张表缺失的索引，提升查询性能：
//     P4-1: idx_topics_source_type ON topics(source_type)
//     P4-2: idx_events_status       ON events(status)
//     P4-3: idx_team_history_topic_id ON team_history(topic_id)
//
// 幂等性：使用 CREATE INDEX IF NOT EXISTS，重复执行无副作用。
// ============================================================

import type { Database } from 'better-sqlite3'

/**
 * 补充 topics.source_type / events.status / team_history.topic_id 缺失的索引。
 */
export function addMissingIndexes(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_topics_source_type ON topics(source_type);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_team_history_topic_id ON team_history(topic_id);
  `)
}
