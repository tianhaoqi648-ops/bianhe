-- ============================================================
-- Debate Topic Drawer - Database Schema
-- 共 9 张表，覆盖辩题、赛事、队伍、抽签、审计与设置
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ------------------------------------------------------------
-- 1. topics: 辩题库
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topics (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  type          TEXT,             -- 辩题类型：价值辩/政策辩/事实辩/哲理辩/娱乐辩
  domain        TEXT,             -- 主题领域
  difficulty    TEXT,             -- 难度等级
  source        TEXT,             -- 来源出处
  source_type   TEXT,             -- 来源类型：官方/自定义
  tags          TEXT,             -- JSON 数组
  weight        REAL DEFAULT 1.0,
  status        TEXT DEFAULT 'active',
  created_at    TEXT,
  updated_at    TEXT
);

-- ------------------------------------------------------------
-- 2. events: 赛事
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  start_date    TEXT,
  end_date      TEXT,
  status        TEXT,
  created_at    TEXT
);

-- ------------------------------------------------------------
-- 3. rounds: 轮次
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rounds (
  id                  TEXT PRIMARY KEY,
  event_id            TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name                TEXT,
  round_number        INTEGER,
  difficulty_override TEXT,
  topic_count         INTEGER
);

-- ------------------------------------------------------------
-- 4. teams: 队伍
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- ------------------------------------------------------------
-- 5. team_history: 队伍历史（已抽过的辩题）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_history (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id)  ON DELETE CASCADE ON UPDATE CASCADE,
  topic_id    TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE ON UPDATE CASCADE,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
  played_at   TEXT
);

-- ------------------------------------------------------------
-- 6. draw_sessions: 抽签会话
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS draw_sessions (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id)  ON DELETE CASCADE ON UPDATE CASCADE,
  round_id    TEXT REFERENCES rounds(id)           ON DELETE CASCADE ON UPDATE CASCADE,
  draw_time   TEXT,
  operator    TEXT,
  settings    TEXT                                  -- JSON
);

-- ------------------------------------------------------------
-- 7. draw_session_items: 抽签明细（每个辩题的对阵）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS draw_session_items (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES draw_sessions(id) ON DELETE CASCADE   ON UPDATE CASCADE,
  topic_id    TEXT NOT NULL REFERENCES topics(id)       ON DELETE CASCADE   ON UPDATE CASCADE,
  team_a_id   TEXT REFERENCES teams(id)                 ON DELETE SET NULL  ON UPDATE CASCADE,
  team_b_id   TEXT REFERENCES teams(id)                 ON DELETE SET NULL  ON UPDATE CASCADE,
  stance_a    TEXT,
  stance_b    TEXT
);

-- ------------------------------------------------------------
-- 8. audit_log: 审计日志
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  action        TEXT,
  target_type   TEXT,
  target_id     TEXT,
  operator      TEXT,
  detail        TEXT,                                -- JSON
  created_at    TEXT
);

-- ------------------------------------------------------------
-- 9. settings: 键值配置
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT                                 -- JSON
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_topics_type                  ON topics(type);
CREATE INDEX IF NOT EXISTS idx_topics_domain                ON topics(domain);
CREATE INDEX IF NOT EXISTS idx_topics_status                ON topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_source                ON topics(source);
CREATE INDEX IF NOT EXISTS idx_rounds_event_id              ON rounds(event_id);
CREATE INDEX IF NOT EXISTS idx_teams_event_id               ON teams(event_id);
CREATE INDEX IF NOT EXISTS idx_team_history_team_id         ON team_history(team_id);
CREATE INDEX IF NOT EXISTS idx_team_history_event_id        ON team_history(event_id);
CREATE INDEX IF NOT EXISTS idx_draw_sessions_event_id       ON draw_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_draw_sessions_round_id       ON draw_sessions(round_id);
CREATE INDEX IF NOT EXISTS idx_draw_session_items_session_id ON draw_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_draw_session_items_topic_id  ON draw_session_items(topic_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at         ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action             ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_type        ON audit_log(target_type);
