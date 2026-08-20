// ============================================================
// 20260905_add_team_history_topic_title.ts
//   team_history 增加 topic_title 冗余快照列，并回填存量。
//
// 背景 Bug：队伍历史辩题页在辩题被删除（尤其导入后会删）后显示「(已删除辩题)」，
//   因为 team_history 未保存标题快照（对齐 draw_session_items.topic_title 做法）。
// 同时保留 topic_id → 若辩题被删除，历史仍能显示原标题。
// 幂等：pragma_table_info 检查列是否存在；回填 UPDATE 用 IS NULL AND topic_id IS NOT NULL 限定。
// ============================================================

import type { Database } from 'better-sqlite3'

export function addTeamHistoryTopicTitle(db: Database): void {
  const cols = db
    .prepare("SELECT name FROM pragma_table_info('team_history')")
    .all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'topic_title')) {
    db.exec('ALTER TABLE team_history ADD COLUMN topic_title TEXT')
  }
  // 回填存量：从 topics 表取标题仅对仍存在的辩题补一次；已删除的辩题标题无法补（历史不丢失，仅无法还原已删标题）
  db.exec(`
    UPDATE team_history
    SET topic_title = (SELECT title FROM topics WHERE id = team_history.topic_id)
    WHERE topic_title IS NULL AND topic_id IS NOT NULL
  `)
}