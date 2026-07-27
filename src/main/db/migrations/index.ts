// ============================================================
// migrations/index.ts — SQLite 数据库迁移机制
//
// 现状：schema.sql 用 CREATE TABLE IF NOT EXISTS 幂等建表，
//   但新增字段无法靠 IF NOT EXISTS 添加，旧库不会自动加列。
//
// 方案：
//   1. __migrations 表追踪已应用的迁移 id
//   2. 每个 Migration.up 用 try/catch 包裹 ALTER TABLE，
//      SQLite 不支持 ADD COLUMN IF NOT EXISTS，靠异常捕获双保险
//   3. initDatabase() 在 db.exec(schemaSql) 后调用 runMigrations(db)
// ============================================================

import type { Database } from 'better-sqlite3'

interface Migration {
  id: string
  up: (db: Database) => void
}

const MIGRATIONS: Migration[] = [
  {
    id: '20260726_add_batch_id_to_topics',
    up: (db) => {
      // SQLite 不支持 ADD COLUMN IF NOT EXISTS，用异常捕获
      try {
        db.exec('ALTER TABLE topics ADD COLUMN batch_id TEXT')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_topics_batch_id ON topics(batch_id)')
      } catch {
        /* 索引已存在 */
      }
    }
  },
  {
    id: '20260726_create_import_batch_table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS import_batch (
          id              TEXT PRIMARY KEY,
          file_name       TEXT NOT NULL,
          total_count     INTEGER NOT NULL,
          imported_count  INTEGER NOT NULL,
          duplicates_count INTEGER NOT NULL DEFAULT 0,
          failed_count    INTEGER NOT NULL DEFAULT 0,
          imported_at     TEXT NOT NULL,
          notes           TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_import_batch_imported_at
          ON import_batch(imported_at DESC);
      `)
    }
  },
  {
    id: '20260726_add_custom_data_to_topics',
    up: (db) => {
      // 为 topics 表添加 custom_data JSON 列，存储自定义字段值
      try {
        db.exec('ALTER TABLE topics ADD COLUMN custom_data TEXT')
      } catch {
        /* 字段已存在 */
      }
    }
  },
  {
    id: '20260726_create_topic_custom_fields_table',
    up: (db) => {
      // 自定义字段元数据表（schema.sql 中也有 IF NOT EXISTS 定义，此处兜底）
      db.exec(`
        CREATE TABLE IF NOT EXISTS topic_custom_fields (
          field_key   TEXT PRIMARY KEY,
          field_label TEXT NOT NULL,
          field_type  TEXT NOT NULL DEFAULT 'string',
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL
        )
      `)
    }
  },
  {
    id: '20260727_create_batch_edit_history',
    up: (db) => {
      // 批量编辑历史主表：一次批量编辑操作
      db.exec(`
        CREATE TABLE IF NOT EXISTS batch_edit_history (
          id              TEXT PRIMARY KEY,
          executed_at     TEXT NOT NULL,
          topic_count     INTEGER NOT NULL,
          field_count     INTEGER NOT NULL,
          summary         TEXT,
          reverted        INTEGER NOT NULL DEFAULT 0,
          reverted_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_batch_edit_history_executed_at
          ON batch_edit_history(executed_at DESC);

        CREATE TABLE IF NOT EXISTS batch_edit_history_item (
          id              TEXT PRIMARY KEY,
          history_id      TEXT NOT NULL REFERENCES batch_edit_history(id) ON DELETE CASCADE ON UPDATE CASCADE,
          topic_id        TEXT NOT NULL,
          before_values   TEXT,
          after_values    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_batch_edit_history_item_history_id
          ON batch_edit_history_item(history_id);
      `)
    }
  },
  {
    id: '20260727_create_undo_log',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS undo_log (
          id            TEXT PRIMARY KEY,
          created_at    TEXT NOT NULL,
          store_name    TEXT NOT NULL,
          action        TEXT NOT NULL,
          target_type   TEXT NOT NULL,
          target_id     TEXT,
          before_data   TEXT,
          after_data    TEXT,
          payload_size  INTEGER NOT NULL DEFAULT 0,
          label         TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_undo_log_created_at ON undo_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_undo_log_store_name ON undo_log(store_name);
      `)
    }
  },
  {
    id: '20260728_create_timer_tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS debate_formats (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT,
          is_preset   INTEGER NOT NULL DEFAULT 0,
          format_data TEXT NOT NULL,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS timer_sessions (
          id                  TEXT PRIMARY KEY,
          event_id            TEXT,
          round_id            TEXT,
          team_aff_id         TEXT,
          team_neg_id         TEXT,
          topic_id            TEXT,
          format_id           TEXT NOT NULL,
          format_snapshot     TEXT NOT NULL,
          status              TEXT NOT NULL DEFAULT 'idle',
          started_at          TEXT,
          ended_at            TEXT,
          current_stage_index INTEGER NOT NULL DEFAULT 0,
          current_side        TEXT,
          remaining_ms        INTEGER,
          theme_snapshot      TEXT,
          label               TEXT,
          created_at          TEXT NOT NULL,
          FOREIGN KEY (format_id) REFERENCES debate_formats(id)
        );

        CREATE TABLE IF NOT EXISTS timer_records (
          id           TEXT PRIMARY KEY,
          session_id   TEXT NOT NULL,
          stage_index  INTEGER NOT NULL,
          stage_name   TEXT NOT NULL,
          side         TEXT NOT NULL,
          duration_ms  INTEGER NOT NULL,
          actual_ms    INTEGER,
          started_at   TEXT NOT NULL,
          ended_at     TEXT,
          pause_count  INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (session_id) REFERENCES timer_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_timer_records_session ON timer_records(session_id);
        CREATE INDEX IF NOT EXISTS idx_timer_sessions_event ON timer_sessions(event_id);
        CREATE INDEX IF NOT EXISTS idx_timer_sessions_created ON timer_sessions(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_debate_formats_preset ON debate_formats(is_preset);
      `)
    }
  },
  {
    id: '20260729_create_bell_assets',
    up: (db) => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS bell_assets (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        file_path   TEXT NOT NULL,
        file_size   INTEGER NOT NULL,
        mime_type   TEXT NOT NULL,
        duration_ms INTEGER,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bell_assets_created ON bell_assets(created_at DESC);
    `)
    }
  }
]

/**
 * 确保 __migrations 表存在。
 * 该表追踪已应用的迁移 id，避免重复执行。
 */
export function ensureMigrationTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

/**
 * 执行所有未应用的迁移。
 * 每个迁移的 up 用 try/catch 包裹 ALTER TABLE，避免重复执行报错。
 * 应用成功后在 __migrations 表中记录 id。
 */
export function runMigrations(db: Database): void {
  ensureMigrationTable(db)
  const applied = new Set(
    db.prepare('SELECT id FROM __migrations').all().map((r: any) => r.id as string)
  )
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    m.up(db)
    db.prepare('INSERT INTO __migrations (id, applied_at) VALUES (?, ?)').run(
      m.id,
      new Date().toISOString()
    )
  }
}

/**
 * 查询已应用的迁移 id 列表（仅供测试/调试使用）。
 */
export function listAppliedMigrations(db: Database): string[] {
  ensureMigrationTable(db)
  const rows = db.prepare('SELECT id FROM __migrations').all() as Array<{ id: string }>
  return rows.map((r) => r.id)
}
