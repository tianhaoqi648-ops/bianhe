// ============================================================
// 20260904_create_matches.ts
//   比赛（matches）多裁判模型 & 关联表
//
// 设计背景：以「比赛」为中心，重建为真实辩论赛的多裁判评决模型。
//   一场比赛 = 某一轮下的一场对阵（正方/反方 + 辩题 + 若干裁判），
//   承载 抽题→计时(录音)→赛果(多裁判评决)→亮牌(胜负+最佳辩手)→AI评审 的完整链路。
//
// 表：
//   - matches               比赛主表（原有，本文补充列/说明）
//   - match_judges          裁判（每场 N 名，可为 AI）
//   - match_judge_votes     评决（每裁判每场一条：三票制或百分制 + 环节分 + 最佳辩手）
//
// 评决制度（比赛/赛事维度可切换，用户决策）：
//   - three_votes 三轮投票制（真实新国辩/世锦赛）：
//        每位评委投 印象票 + 环节票(环节加权累计分高者得) + 决胜票，N 席×3 票汇总，得票多者胜；
//   - percentage 单张百分制：每位评委对双方给 0-100 分，取平均分高者胜。
//   环节权重可配置（来自赛事格式，缺省等权）。
//
// 幂等性：
//   - 各表 CREATE TABLE IF NOT EXISTS
//   - matches 补充列用 pragma_table_info 兜底（兼容先前已建表的 dev 库）
// ============================================================

import type { Database } from 'better-sqlite3'

/** 给 matches 补列（幂等：列已存在则跳过） */
function ensureMatchesColumns(db: Database, columns: string[]): void {
  const cols = new Set(
    (db.prepare("SELECT name FROM pragma_table_info('matches')").all() as Array<{ name: string }>).map((c) => c.name)
  )
  for (const def of columns) {
    const name = def.trim().split(/\s+/)[0]
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE matches ADD COLUMN ${def}`)
    }
  }
}

/**
 * 建 matches 表 + match_judges + match_judge_votes，并补 matches 新列。
 * 调用方：migrations/index.ts 的 MIGRATIONS 数组（按 id 排序执行）。
 */
export function createMatchesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id            TEXT PRIMARY KEY,
      event_id      TEXT NOT NULL,
      round_id      TEXT,
      match_number  INTEGER,
      team_a_id     TEXT,
      team_b_id     TEXT,
      topic_id      TEXT,
      stance_a      TEXT,
      stance_b      TEXT,
      draw_item_id  TEXT,
      session_id    TEXT,
      recording_ref TEXT,
      status        TEXT NOT NULL DEFAULT 'planned',
      winner        TEXT,
      aff_score     REAL,
      neg_score     REAL,
      best_speaker  TEXT,
      notes         TEXT,
      ai_review     TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      team_a_name   TEXT,
      team_b_name   TEXT,
      topic_title   TEXT,
      event_name    TEXT,
      round_name    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_id);
    CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round_id);

    -- 裁判（每场 N 名，可为 AI）
    CREATE TABLE IF NOT EXISTS match_judges (
      id          TEXT PRIMARY KEY,
      match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE ON UPDATE CASCADE,
      name        TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_ai       INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_match_judges_match ON match_judges(match_id);

    -- 评决（每裁判每场一条）
    CREATE TABLE IF NOT EXISTS match_judge_votes (
      id              TEXT PRIMARY KEY,
      match_id        TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE ON UPDATE CASCADE,
      judge_id        TEXT NOT NULL REFERENCES match_judges(id) ON DELETE CASCADE ON UPDATE CASCADE,
      judge_system    TEXT NOT NULL DEFAULT 'three_votes',  -- three_votes | percentage
      impression_vote TEXT,   -- 印象票：aff/neg/null（三票制）
      decision_vote   TEXT,   -- 决胜票：aff/neg/null（三票制）
      aff_total       REAL,   -- 正方得分：三票制=环节加权累计；百分制=直接分
      neg_total       REAL,   -- 反方得分
      stage_scores    TEXT,   -- JSON：[{stage_id,stage_name,weight,aff,neg}]（环节明细）
      best_speaker    TEXT,   -- 该裁判投出的最佳辩手（如 team_a_name:一辩 or 辩手名）
      comment         TEXT,   -- 该裁判点评/备注
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_judge_votes_match ON match_judge_votes(match_id);
  `)

  // 补充列（兼容先前已建 matches 表的 dev 库）
  ensureMatchesColumns(db, [
    'format_id TEXT',
    "judge_system TEXT NOT NULL DEFAULT 'three_votes'",
    'recording_meta TEXT'
  ])

  // timer_sessions 加 match_id（幂等：列已存在则跳过）
  const cols = db
    .prepare("SELECT name FROM pragma_table_info('timer_sessions')")
    .all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'match_id')) {
    db.exec('ALTER TABLE timer_sessions ADD COLUMN match_id TEXT')
  }
}