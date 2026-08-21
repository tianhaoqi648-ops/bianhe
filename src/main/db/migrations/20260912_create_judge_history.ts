// ============================================================
// 20260912_create_judge_history.ts
//   AI 裁判结果历史表
//
// 背景：AI 裁判页（judge_speech / judge_debate / judge_match /
//   simulate_opponent / detect_stage）的评审结果此前只存于组件内存，
//   切页或重启即丢失。新增 judge_history 表，每条工具执行成功的记录
//   持久化为一行，跨页面与重启保留，可按绑定（event/round/match）/工具筛选、重开与删除。
//
// 字段语义：
//   - event_id / round_id / match_id：可空绑定（当前绑定的赛事/轮次/场次）
//   - judge_id：评委（当前选中的评委）
//   - tool_name：裁判工具名（judge_match / judge_debate / judge_speech / detect_stage / simulate_opponent）
//   - stage / side / topic：环节 / 持方 / 辩题（快照，供列表展示与重开）
//   - result_json：工具成功输出（JSON 文本）
//   - error：失败信息（按 spec 仅存成功结果，此列备用保留）
//
// 幂等性：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS，旧库直接加表，不改旧表。
// ============================================================

import type { Database } from 'better-sqlite3'

/**
 * 建 judge_history 表 + 筛选/排序索引。
 * 调用方：migrations/index.ts 的 MIGRATIONS 数组（按 id 排序执行）。
 */
export function createJudgeHistoryTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS judge_history (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      event_id    TEXT,
      round_id    TEXT,
      match_id    TEXT,
      judge_id    TEXT NOT NULL,
      tool_name   TEXT NOT NULL,
      stage       TEXT,
      side        TEXT,
      topic       TEXT,
      result_json TEXT,
      error       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_judge_history_created ON judge_history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_judge_history_event ON judge_history(event_id);
    CREATE INDEX IF NOT EXISTS idx_judge_history_round ON judge_history(round_id);
    CREATE INDEX IF NOT EXISTS idx_judge_history_match ON judge_history(match_id);
    CREATE INDEX IF NOT EXISTS idx_judge_history_tool ON judge_history(tool_name);
  `)
}