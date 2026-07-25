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
