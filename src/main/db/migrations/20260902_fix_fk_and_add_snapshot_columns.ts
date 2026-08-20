// ============================================================
// 20260902_fix_fk_and_add_snapshot_columns.ts
//   修复 3 个 schema 相关 Bug：
//
//   P1-16: team_history.topic_id / draw_session_items.topic_id
//          ON DELETE CASCADE → ON DELETE SET NULL
//          （避免硬删除辩题时级联删除历史抽取记录）
//
//   P1-17: timer_sessions.format_id
//          NOT NULL → 可空 + ON DELETE SET NULL
//          （避免删除被引用赛制时外键约束失败）
//
//   P2-44: timer_sessions 添加冗余快照列
//          event_name / team_aff_name / team_neg_name / topic_title
//          （避免删除事件/队伍/辩题后计时器历史显示空名称）
//
// SQLite 不支持 ALTER FOREIGN KEY，需通过重建表实现。
// 数据迁移使用 INSERT INTO new SELECT ... FROM old，保证不丢失数据。
//
// 幂等性：先检查 schema 是否已修复，已修复则跳过对应表重建。
// 重建过程在事务内执行，失败则整体回滚。
// ============================================================

import type { Database } from 'better-sqlite3'

/** 查询表的列信息 */
function getTableColumns(
  db: Database,
  table: string
): Array<{ name: string; notnull: number }> {
  return db
    .prepare('SELECT name, "notnull" FROM pragma_table_info(?)')
    .all(table) as Array<{ name: string; notnull: number }>
}

/** 检查列是否存在 */
function hasColumn(db: Database, table: string, column: string): boolean {
  return getTableColumns(db, table).some((c) => c.name === column)
}

/** 检查列是否为 NOT NULL */
function isColumnNotNull(db: Database, table: string, column: string): boolean {
  const col = getTableColumns(db, table).find((c) => c.name === column)
  return col?.notnull === 1
}

/**
 * 重建 team_history 表：
 *   topic_id: NOT NULL + ON DELETE CASCADE → 可空 + ON DELETE SET NULL
 */
function rebuildTeamHistory(db: Database): void {
  // 幂等：topic_id 已可空说明已修复
  if (!isColumnNotNull(db, 'team_history', 'topic_id')) return

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE team_history_new (
        id          TEXT PRIMARY KEY,
        team_id     TEXT NOT NULL REFERENCES teams(id)  ON DELETE CASCADE   ON UPDATE CASCADE,
        topic_id    TEXT          REFERENCES topics(id) ON DELETE SET NULL  ON UPDATE CASCADE,
        event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE   ON UPDATE CASCADE,
        played_at   TEXT,
        session_id  TEXT,
        stance      TEXT
      );

      INSERT INTO team_history_new (id, team_id, topic_id, event_id, played_at, session_id, stance)
      SELECT id, team_id, topic_id, event_id, played_at, session_id, stance
      FROM team_history;

      DROP TABLE team_history;
      ALTER TABLE team_history_new RENAME TO team_history;

      CREATE INDEX IF NOT EXISTS idx_team_history_team_id    ON team_history(team_id);
      CREATE INDEX IF NOT EXISTS idx_team_history_event_id   ON team_history(event_id);
      CREATE INDEX IF NOT EXISTS idx_team_history_session_id ON team_history(session_id) WHERE session_id IS NOT NULL;
    `)
  })
  tx()
}

/**
 * 重建 draw_session_items 表：
 *   topic_id: NOT NULL + ON DELETE CASCADE → 可空 + ON DELETE SET NULL
 */
function rebuildDrawSessionItems(db: Database): void {
  // 幂等：topic_id 已可空说明已修复
  if (!isColumnNotNull(db, 'draw_session_items', 'topic_id')) return

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE draw_session_items_new (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES draw_sessions(id) ON DELETE CASCADE  ON UPDATE CASCADE,
        topic_id      TEXT          REFERENCES topics(id)       ON DELETE SET NULL  ON UPDATE CASCADE,
        team_a_id     TEXT REFERENCES teams(id)                 ON DELETE SET NULL  ON UPDATE CASCADE,
        team_b_id     TEXT REFERENCES teams(id)                 ON DELETE SET NULL  ON UPDATE CASCADE,
        stance_a      TEXT,
        stance_b      TEXT,
        topic_title   TEXT,
        team_a_name   TEXT,
        team_b_name   TEXT,
        team_ids      TEXT,
        team_stances  TEXT,
        team_names    TEXT,
        group_id      TEXT REFERENCES team_groups(id)           ON DELETE SET NULL  ON UPDATE CASCADE
      );

      INSERT INTO draw_session_items_new
        (id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b,
         topic_title, team_a_name, team_b_name, team_ids, team_stances, team_names, group_id)
      SELECT
        id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b,
        topic_title, team_a_name, team_b_name, team_ids, team_stances, team_names, group_id
      FROM draw_session_items;

      DROP TABLE draw_session_items;
      ALTER TABLE draw_session_items_new RENAME TO draw_session_items;

      CREATE INDEX IF NOT EXISTS idx_draw_session_items_session_id ON draw_session_items(session_id);
      CREATE INDEX IF NOT EXISTS idx_draw_session_items_topic_id   ON draw_session_items(topic_id);
      CREATE INDEX IF NOT EXISTS idx_draw_session_items_group_id   ON draw_session_items(group_id);
    `)
  })
  tx()
}

/**
 * 重建 timer_sessions 表：
 *   1. format_id: NOT NULL → 可空 + ON DELETE SET NULL（Bug P1-17）
 *   2. 新增 event_name / team_aff_name / team_neg_name / topic_title 快照列（Bug P2-44）
 *   3. 从关联表回填现有记录的快照值
 *
 * 防御性迁移（v1.2.2 引入）：旧表可能缺少 stage_remaining_cache / aff_remaining_ms /
 * neg_remaining_ms 列（即使相关迁移标记为已应用，ALTER TABLE 也可能因各种原因实际未生效，
 * 如迁移排序导致 ALTER 先于建表执行而失败被吞）。动态检查旧表列，缺失的列在 SELECT 中
 * 用 NULL 替代，避免"no such column"错误。
 */
function rebuildTimerSessions(db: Database): void {
  // 幂等：event_name 列已存在说明已修复
  if (hasColumn(db, 'timer_sessions', 'event_name')) return

  // 检查旧表有哪些新增列，缺失的列用 NULL 填充
  const baseColumns = [
    'id', 'event_id', 'round_id', 'team_aff_id', 'team_neg_id', 'topic_id',
    'format_id', 'format_snapshot', 'status', 'started_at', 'ended_at',
    'current_stage_index', 'current_side', 'remaining_ms', 'theme_snapshot',
    'label', 'created_at'
  ]
  const optionalColumns = [
    'stage_remaining_cache',
    'aff_remaining_ms',
    'neg_remaining_ms',
    'aff_pool_remaining_ms',
    'neg_pool_remaining_ms'
  ]

  const oldCols = new Set(getTableColumns(db, 'timer_sessions').map((c) => c.name))
  const selectColumns = [
    ...baseColumns,
    ...optionalColumns.map((c) => (oldCols.has(c) ? c : 'NULL AS ' + c))
  ]

  const newColumns = [...baseColumns, ...optionalColumns]

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE timer_sessions_new (
        id                   TEXT PRIMARY KEY,
        event_id             TEXT,
        round_id             TEXT,
        team_aff_id          TEXT,
        team_neg_id          TEXT,
        topic_id             TEXT,
        format_id            TEXT,
        format_snapshot      TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'idle',
        started_at           TEXT,
        ended_at             TEXT,
        current_stage_index  INTEGER NOT NULL DEFAULT 0,
        current_side         TEXT,
        remaining_ms         INTEGER,
        theme_snapshot       TEXT,
        label                TEXT,
        created_at           TEXT NOT NULL,
        stage_remaining_cache TEXT,
        aff_remaining_ms     INTEGER,
        neg_remaining_ms     INTEGER,
        aff_pool_remaining_ms INTEGER,
        neg_pool_remaining_ms INTEGER,
        event_name           TEXT,
        team_aff_name        TEXT,
        team_neg_name        TEXT,
        topic_title          TEXT,
        FOREIGN KEY (format_id) REFERENCES debate_formats(id) ON DELETE SET NULL ON UPDATE CASCADE
      );

      INSERT INTO timer_sessions_new (${newColumns.join(', ')})
      SELECT ${selectColumns.join(', ')}
      FROM timer_sessions;

      DROP TABLE timer_sessions;
      ALTER TABLE timer_sessions_new RENAME TO timer_sessions;

      -- 回填快照列：从关联表读取当前名称（已删除的关联记录则为 NULL）
      UPDATE timer_sessions
      SET event_name    = (SELECT name  FROM events WHERE id = timer_sessions.event_id),
          team_aff_name = (SELECT name  FROM teams  WHERE id = timer_sessions.team_aff_id),
          team_neg_name = (SELECT name  FROM teams  WHERE id = timer_sessions.team_neg_id),
          topic_title   = (SELECT title FROM topics WHERE id = timer_sessions.topic_id)
      WHERE event_name IS NULL
         OR team_aff_name IS NULL
         OR team_neg_name IS NULL
         OR topic_title IS NULL;

      CREATE INDEX IF NOT EXISTS idx_timer_sessions_event   ON timer_sessions(event_id);
      CREATE INDEX IF NOT EXISTS idx_timer_sessions_created ON timer_sessions(created_at DESC);
    `)
  })
  tx()
}

/**
 * 修复外键约束并添加快照列。
 *
 * 重建表期间临时关闭 foreign_keys pragma（SQLite 官方推荐做法），
 * 避免数据迁移时因孤立引用导致 INSERT 失败。
 * 重建完成后恢复 foreign_keys = ON。
 */
export function fixFkAndAddSnapshotColumns(db: Database): void {
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) as number
  if (fkWasOn) {
    db.pragma('foreign_keys = OFF')
  }
  try {
    rebuildTeamHistory(db)
    rebuildDrawSessionItems(db)
    rebuildTimerSessions(db)
  } finally {
    if (fkWasOn) {
      db.pragma('foreign_keys = ON')
    }
  }
}
