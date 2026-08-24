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
//
// Task3 加固（在现有机制上增强，不推翻、不丢数据）：
//   3.1 引入数值 schema version：SCHEMA_VERSION = MIGRATIONS.length，
//       version 即迁移在排序后的序号（i+1），用 PRAGMA user_version 落盘。
//       getDbSchemaVersion() 在 __migrations 已应用 id 与 user_version 间取大者，
//       兼容「旧库只靠 __migrations 追踪、user_version 从未写入」的情况。
//   3.2 事务执行：每个迁移默认包在 db.transaction() 中（迁移 DDL + 写 __migrations
//       记录同事务，失败整体回滚且不记应用）；仅 20260902 因须临时切 foreign_keys
//       pragma（transaction 内为 no-op）标记 transactional:false。
//       关键迁移失败 → 抛错中止并提示（不静默标成功）；optional 迁移失败 → 明确日志跳过。
//   3.3 迁移前备份：由 db/index.ts 在检测到 schema 升级时调用 backup 快照（见 backup/index.ts）。
// ============================================================

import type { Database } from 'better-sqlite3'
import { fixStancePairing } from './20260801_fix_stance_pairing'
import { addAllowRepeatAndTestFlag } from './20260901_add_allow_repeat_and_test_flag'
import { fixFkAndAddSnapshotColumns } from './20260902_fix_fk_and_add_snapshot_columns'
import { addMissingIndexes } from './20260903_add_missing_indexes'
import { createMatchesTable } from './20260904_create_matches'
import { addTeamHistoryTopicTitle } from './20260905_add_team_history_topic_title'
import { createJudgeHistoryTable } from './20260912_create_judge_history'
import { createTopicGroupsTable } from './20260913_create_topic_groups'
import { createRoundTopicGroupsTable } from './20260914_create_round_topic_groups'
import { addForeignKeysToMatches } from './20260916_matches_add_fk'
import { ensureColumn, ensureIndex } from './helpers'

interface Migration {
  id: string
  up: (db: Database) => void
  /** 是否包在事务中执行（默认 true）。仅需临时切 pragma 的迁移设 false。 */
  transactional?: boolean
  /** 可选迁移：失败仅记录日志跳过，不阻断后续迁移。 */
  optional?: boolean
}

const MIGRATIONS: Migration[] = [
  {
    id: '20260726_add_batch_id_to_topics',
    up: (db) => {
      ensureColumn(db, 'topics', 'batch_id', 'batch_id TEXT')
      ensureIndex(db, 'CREATE INDEX IF NOT EXISTS idx_topics_batch_id ON topics(batch_id)')
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
      ensureColumn(db, 'topics', 'custom_data', 'custom_data TEXT')
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
          -- 以下三列必须在建表时一并定义：
          -- 迁移 20260727_add_stage_remaining_cache_to_timer_sessions 的 id 排序在
          -- 本迁移之前，会对尚不存在的 timer_sessions 执行 ALTER 并失败（被空 catch
          -- 吞掉后仍标记已应用），若此处不建列，全新安装的库将永久缺失这些列，
          -- 导致 20260902 重建表时 SELECT stage_remaining_cache 报 "no such column"。
          stage_remaining_cache TEXT,
          aff_remaining_ms      INTEGER,
          neg_remaining_ms      INTEGER,
          aff_pool_remaining_ms INTEGER,
          neg_pool_remaining_ms INTEGER,
          aff_speech_count      INTEGER DEFAULT 0,
          neg_speech_count      INTEGER DEFAULT 0,
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
  },
  {
    id: '20260727_add_stage_remaining_cache_to_timer_sessions',
    up: (db) => {
      // 为 timer_sessions 表添加 stage_remaining_cache JSON 列，存储各环节最近离开时的 remainingMs
      // 用于 prevStage 完全保留策略。
      // 注意：本迁移排序早于 20260728_create_timer_tables，全新库执行时表尚不存在，
      //       返回 'table-not-exists' 优雅跳过（后续建表会带该列）。
      ensureColumn(db, 'timer_sessions', 'stage_remaining_cache', 'stage_remaining_cache TEXT')
    }
  },
  {
    id: '20260730_add_free_debate_remaining_to_timer_sessions',
    up: (db) => {
      // 为 timer_sessions 表添加 aff_remaining_ms / neg_remaining_ms 字段
      // 用于持久化自由辩论环节双方独立计时器（全新库表尚不存在时由后续建表带列）
      ensureColumn(db, 'timer_sessions', 'aff_remaining_ms', 'aff_remaining_ms INTEGER')
      ensureColumn(db, 'timer_sessions', 'neg_remaining_ms', 'neg_remaining_ms INTEGER')
    }
  },
  {
    id: '20260731_add_undone_at_to_undo_log',
    up: (db) => {
      // 为 undo_log 表添加 undone_at 字段，用于实现 Redo 功能
      ensureColumn(db, 'undo_log', 'undone_at', 'undone_at TEXT')
      // 创建 redo 队列索引（仅 undone_at IS NOT NULL 的行）
      ensureIndex(db, 'CREATE INDEX IF NOT EXISTS idx_undo_log_undone_at ON undo_log(undone_at) WHERE undone_at IS NOT NULL')
    }
  },
  {
    id: '20260729_add_snapshot_columns_to_draw_session_items',
    up: (db) => {
      // 为 draw_session_items 表添加冗余快照列
      ensureColumn(db, 'draw_session_items', 'topic_title', 'topic_title TEXT')
      ensureColumn(db, 'draw_session_items', 'team_a_name', 'team_a_name TEXT')
      ensureColumn(db, 'draw_session_items', 'team_b_name', 'team_b_name TEXT')
    }
  },
  {
    id: '20260729_add_session_id_to_team_history',
    up: (db) => {
      // 为 team_history 表添加 session_id 列，用于确认抽取结果时关联去重
      ensureColumn(db, 'team_history', 'session_id', 'session_id TEXT')
      ensureIndex(db, 'CREATE INDEX IF NOT EXISTS idx_team_history_session_id ON team_history(session_id) WHERE session_id IS NOT NULL')
    }
  },
  {
    id: '20260730_add_stance_to_team_history',
    up: (db) => {
      // 为 team_history 表添加 stance 列，用于记录队伍持方（正方/反方）
      ensureColumn(db, 'team_history', 'stance', 'stance TEXT')
    }
  },
  {
    id: '20260729_create_team_groups_and_extend_teams',
    up: (db) => {
      // 1. 创建 team_groups 表（schema.sql 中也有 IF NOT EXISTS 定义，此处兜底）
      db.exec(`
        CREATE TABLE IF NOT EXISTS team_groups (
          id          TEXT PRIMARY KEY,
          event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
          name        TEXT NOT NULL,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_team_groups_event_id ON team_groups(event_id);
      `)
      // 2. 为 teams 表添加 group_id 列（可空，引用 team_groups.id）
      ensureColumn(db, 'teams', 'group_id', 'group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE')
      ensureIndex(db, 'CREATE INDEX IF NOT EXISTS idx_teams_group_id ON teams(group_id)')
    }
  },
  {
    id: '20260729_extend_draw_session_items_for_multi_team',
    up: (db) => {
      // 为 draw_session_items 表添加 team_ids（JSON 数组）和 group_id 列
      ensureColumn(db, 'draw_session_items', 'team_ids', 'team_ids TEXT')
      ensureColumn(db, 'draw_session_items', 'group_id', 'group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE')
      ensureIndex(db, 'CREATE INDEX IF NOT EXISTS idx_draw_session_items_group_id ON draw_session_items(group_id)')
    }
  },
  {
    id: '20260730_add_is_round_robin_to_rounds',
    up: (db) => {
      // 为 rounds 表添加 is_round_robin 列（循环赛标记）
      ensureColumn(db, 'rounds', 'is_round_robin', 'is_round_robin INTEGER NOT NULL DEFAULT 0')
    }
  },
  {
    id: '20260730_add_team_stances_and_names_to_draw_session_items',
    up: (db) => {
      // 为 draw_session_items 表添加 team_stances 和 team_names 列
      ensureColumn(db, 'draw_session_items', 'team_stances', 'team_stances TEXT')
      ensureColumn(db, 'draw_session_items', 'team_names', 'team_names TEXT')
    }
  },
  {
    id: '20260801_fix_stance_pairing_v4',
    up: (db) => {
      // 修正旧会话持方数据（数据修复类，可选：失败仅记录并跳过，不影响结构升级）
      const { fixed, skipped } = fixStancePairing(db)
      console.log('[migration] fix_stance_pairing_v4 done', { fixed, skipped })
    },
    optional: true
  },
  {
    id: '20260901_add_allow_repeat_and_test_flag',
    up: (db) => {
      // 为 events 表添加 allow_repeat 列（幂等：pragma_table_info 检查列已存在则跳过）
      addAllowRepeatAndTestFlag(db)
    }
  },
  {
    id: '20260902_fix_fk_and_add_snapshot_columns',
    up: (db) => {
      // 重建表修复外键 + 添加快照列。
      // 内部需临时关闭/恢复 foreign_keys pragma，故整个迁移不包事务（transaction 内 pragma 为 no-op）。
      // 内部三个 rebuild 各自包事务。
      fixFkAndAddSnapshotColumns(db)
    },
    transactional: false
  },
  {
    id: '20260903_add_missing_indexes',
    up: (db) => {
      addMissingIndexes(db)
    }
  },
  {
    id: '20260904_create_matches',
    up: (db) => {
      createMatchesTable(db)
    }
  },
  {
    id: '20260905_add_team_history_topic_title',
    up: (db) => {
      addTeamHistoryTopicTitle(db)
    }
  },
  {
    id: '20260906_ensure_match_multijudge_schema',
    up: (db) => {
      // 兼容旧库：20260904_create_matches 曾在部分用户库按旧 schema 建过 matches 并记为已应用。
      // 用新 id 幂等补齐（createMatchesTable 内部 CREATE IF NOT EXISTS + pragma 校验加列）。
      createMatchesTable(db)
    }
  },
  {
    id: '20260912_create_judge_history',
    up: (db) => {
      createJudgeHistoryTable(db)
    }
  },
  {
    id: '20260913_create_topic_groups',
    up: (db) => {
      createTopicGroupsTable(db)
    }
  },
  {
    id: '20260914_create_round_topic_groups',
    up: (db) => {
      createRoundTopicGroupsTable(db)
    }
  },
  {
    id: '20260916_matches_add_fk',
    up: (db) => {
      // matches 外键安全迁移（Task2）：先校验非法引用，无非法引用才重建带 FK 的 matches。
      // 内部需临时切 foreign_keys pragma（事务内为 no-op），故 transactional:false，
      // 内部重建各自包事务，非法引用直接抛错中止。
      addForeignKeysToMatches(db)
    },
    transactional: false
  },
  {
    id: '20260910_add_pool_remaining_to_timer_sessions',
    up: (db) => {
      // 为 timer_sessions 表添加每队总时长池剩余字段（正方/反方池，毫秒）
      ensureColumn(db, 'timer_sessions', 'aff_pool_remaining_ms', 'aff_pool_remaining_ms INTEGER')
      ensureColumn(db, 'timer_sessions', 'neg_pool_remaining_ms', 'neg_pool_remaining_ms INTEGER')
    }
  },
  {
    id: '20260911_add_speech_count_to_timer_sessions',
    up: (db) => {
      // 为 timer_sessions 表添加自由辩论发言次数字段（正方/反方）
      ensureColumn(db, 'timer_sessions', 'aff_speech_count', 'aff_speech_count INTEGER DEFAULT 0')
      ensureColumn(db, 'timer_sessions', 'neg_speech_count', 'neg_speech_count INTEGER DEFAULT 0')
    }
  }
].sort((a, b) => a.id.localeCompare(b.id))

/**
 * 数值 schema version：即迁移总数。
 * 迁移在其排序位置 i 的 version = i + 1。
 */
export const SCHEMA_VERSION: number = MIGRATIONS.length

/**
 * 只读迁移定义（排序后）。供迁移单测/调试构建任意历史 schema 状态。
 * 生产代码请通过 runMigrations / ensureMigrationTable / listAppliedMigrations 使用。
 */
export const MIGRATION_DEFS: ReadonlyArray<Migration> = MIGRATIONS

/** 迁移 id → 数值 version（排序后序位 +1） */
const idToVersion = new Map<string, number>()
MIGRATIONS.forEach((m, i) => {
  idToVersion.set(m.id, i + 1)
})

export interface MigrationResult {
  id: string
  status: 'applied' | 'skipped' | 'skipped_optional' | 'failed'
  error?: string
}

export interface RunMigrationsResult {
  fromVersion: number
  toVersion: number
  results: MigrationResult[]
}

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
 * 读取当前 schema 版本（数值）：
 *   max( 已应用迁移的最大 version , PRAGMA user_version )
 * 兼容旧库：多数旧库只靠 __migrations 追踪、user_version 始终为 0，
 * 故以 __migrations 已应用 id 推导的版本为准，user_version 取大者兜底。
 * 全新库：无已应用迁移、user_version=0 → 返回 0。
 */
export function getDbSchemaVersion(db: Database): number {
  ensureMigrationTable(db)
  let maxByMigrations = 0
  const rows = db.prepare('SELECT id FROM __migrations').all() as Array<{ id: string }>
  for (const r of rows) {
    const v = idToVersion.get(r.id)
    if (v && v > maxByMigrations) maxByMigrations = v
  }
  let pragmaVersion = 0
  try {
    pragmaVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0
  } catch {
    pragmaVersion = 0
  }
  return Math.max(maxByMigrations, pragmaVersion)
}

/**
 * 执行所有未应用的迁移。
 *
 * 事务策略：
 *   - 每个迁移默认包在 db.transaction() 中，迁移 DDL 与「写入 __migrations 已应用记录」
 *     同事务：迁移失败整体回滚且不记录，绝无「字段缺失但标记已应用」的半状态。
 *   - 例外：20260902（transactional:false）内部需临时切 foreign_keys pragma（事务内为 no-op），
 *     其内部三个 rebuild 各自包事务，已充分回滚边界。
 *
 * 失败策略：
 *   - optional 迁移失败 → 明确日志「(optional) skipped」，继续后续迁移。
 *   - 关键迁移失败 → 明确日志「FAILED (not applied)，abort」并重新抛出，
 *     中止整个迁移流程（由 initDatabase 降级处理），不静默标成功。
 *
 * @returns 本次迁移汇总（fromVersion、toVersion、每项状态）
 */
export function runMigrations(db: Database): RunMigrationsResult {
  const fromVersion = getDbSchemaVersion(db)
  ensureMigrationTable(db)
  const applied = new Set(
    db.prepare('SELECT id FROM __migrations').all().map((r: any) => r.id as string)
  )
  const results: MigrationResult[] = []

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) {
      results.push({ id: m.id, status: 'skipped' })
      continue
    }

    // 迁移 + 写已应用记录包在同一事务
    const apply = (): void => {
      m.up(db)
      db.prepare('INSERT INTO __migrations (id, applied_at) VALUES (?, ?)').run(
        m.id,
        new Date().toISOString()
      )
    }
    const run = (): void => {
      if (m.transactional !== false) {
        db.transaction(apply)()
      } else {
        apply()
      }
    }

    try {
      run()
      applied.add(m.id)
      results.push({ id: m.id, status: 'applied' })
      console.log(`[migrations] applied ${m.id}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (m.optional) {
        console.warn(`[migrations] (optional) ${m.id} skipped due to error: ${msg}`)
        results.push({ id: m.id, status: 'skipped_optional', error: msg })
        continue
      }
      console.error(`[migrations] ${m.id} FAILED (not applied); schema upgrade aborted: ${msg}`)
      results.push({ id: m.id, status: 'failed', error: msg })
      throw e
    }
  }

  return { fromVersion, toVersion: SCHEMA_VERSION, results }
}

/**
 * 查询已应用的迁移 id 列表（仅供测试/调试使用）。
 */
export function listAppliedMigrations(db: Database): string[] {
  ensureMigrationTable(db)
  const rows = db.prepare('SELECT id FROM __migrations').all() as Array<{ id: string }>
  return rows.map((r) => r.id)
}