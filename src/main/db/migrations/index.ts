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
import { fixStancePairing } from './20260801_fix_stance_pairing'
import { addAllowRepeatAndTestFlag } from './20260901_add_allow_repeat_and_test_flag'
import { fixFkAndAddSnapshotColumns } from './20260902_fix_fk_and_add_snapshot_columns'
import { addMissingIndexes } from './20260903_add_missing_indexes'
import { createMatchesTable } from './20260904_create_matches'
import { addTeamHistoryTopicTitle } from './20260905_add_team_history_topic_title'
import { createJudgeHistoryTable } from './20260912_create_judge_history'

interface Migration {
  id: string
  up: (db: Database) => void
  optional?: boolean
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
      // 用于 prevStage 完全保留策略
      try {
        db.exec('ALTER TABLE timer_sessions ADD COLUMN stage_remaining_cache TEXT')
      } catch {
        /* 字段已存在 */
      }
    }
  },
  {
    id: '20260730_add_free_debate_remaining_to_timer_sessions',
    up: (db) => {
      // 为 timer_sessions 表添加 aff_remaining_ms / neg_remaining_ms 字段
      // 用于持久化自由辩论环节双方独立计时器
      try {
        db.exec('ALTER TABLE timer_sessions ADD COLUMN aff_remaining_ms INTEGER')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('ALTER TABLE timer_sessions ADD COLUMN neg_remaining_ms INTEGER')
      } catch {
        /* 字段已存在 */
      }
    }
  },
  {
    id: '20260731_add_undone_at_to_undo_log',
    up: (db) => {
      // 为 undo_log 表添加 undone_at 字段，用于实现 Redo 功能
      // executeUndo 不再删除 log，而是标记 undone_at；executeRedo 清除 undone_at
      try {
        db.exec('ALTER TABLE undo_log ADD COLUMN undone_at TEXT')
      } catch {
        /* 字段已存在 */
      }
      // 创建 redo 队列索引（仅 undone_at IS NOT NULL 的行）
      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_undo_log_undone_at ON undo_log(undone_at) WHERE undone_at IS NOT NULL')
      } catch {
        /* 索引已存在 */
      }
    }
  },
  {
    id: '20260729_add_snapshot_columns_to_draw_session_items',
    up: (db) => {
      // 为 draw_session_items 表添加冗余快照列：
      //   topic_title / team_a_name / team_b_name
      // 用于辩题或队伍硬删除后仍能显示原始标题/名称，避免出现 ID 片段
      try {
        db.exec('ALTER TABLE draw_session_items ADD COLUMN topic_title TEXT')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('ALTER TABLE draw_session_items ADD COLUMN team_a_name TEXT')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('ALTER TABLE draw_session_items ADD COLUMN team_b_name TEXT')
      } catch {
        /* 字段已存在 */
      }
    }
  },
  {
    id: '20260729_add_session_id_to_team_history',
    up: (db) => {
      // 为 team_history 表添加 session_id 列，用于确认抽取结果时关联去重
      // （重抽时先用 session_id 删除旧历史再写入新历史）
      try {
        db.exec('ALTER TABLE team_history ADD COLUMN session_id TEXT')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_team_history_session_id ON team_history(session_id) WHERE session_id IS NOT NULL')
      } catch {
        /* 索引已存在 */
      }
    }
  },
  {
    id: '20260730_add_stance_to_team_history',
    up: (db) => {
      // 为 team_history 表添加 stance 列，用于记录队伍持方（正方/反方）
      try {
        db.exec('ALTER TABLE team_history ADD COLUMN stance TEXT')
      } catch {
        /* 字段已存在 */
      }
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
      try {
        db.exec('ALTER TABLE teams ADD COLUMN group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_teams_group_id ON teams(group_id)')
      } catch {
        /* 索引已存在 */
      }
    }
  },
  {
    id: '20260729_extend_draw_session_items_for_multi_team',
    up: (db) => {
      // 为 draw_session_items 表添加 team_ids（JSON 数组）和 group_id 列
      // team_ids：多队同题模式下的队伍 id 列表（versus 模式为空，仍用 team_a_id/team_b_id）
      // group_id：分组模式下记录所属分组
      try {
        db.exec('ALTER TABLE draw_session_items ADD COLUMN team_ids TEXT')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('ALTER TABLE draw_session_items ADD COLUMN group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_draw_session_items_group_id ON draw_session_items(group_id)')
      } catch {
        /* 索引已存在 */
      }
    }
  },
  {
    id: '20260730_add_is_round_robin_to_rounds',
    up: (db) => {
      // 为 rounds 表添加 is_round_robin 列（循环赛标记，0=普通轮次，1=循环赛）
      try {
        db.exec('ALTER TABLE rounds ADD COLUMN is_round_robin INTEGER NOT NULL DEFAULT 0')
      } catch {
        /* 字段已存在 */
      }
    }
  },
  {
    id: '20260730_add_team_stances_and_names_to_draw_session_items',
    up: (db) => {
      // 为 draw_session_items 表添加 team_stances 和 team_names 列
      // team_stances：JSON 数组，多队持方快照，与 team_ids 一一对应
      // team_names：JSON 数组，队伍名快照，与 team_ids 一一对应
      try {
        db.exec('ALTER TABLE draw_session_items ADD COLUMN team_stances TEXT')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('ALTER TABLE draw_session_items ADD COLUMN team_names TEXT')
      } catch {
        /* 字段已存在 */
      }
    }
  },
  {
    id: '20260801_fix_stance_pairing_v4',
    up: (db) => {
      // 修正旧会话持方数据：
      //   - team_stances 数组相邻同侧 → 翻转第二位
      //   - stance_a / stance_b 同侧 → 翻转 stance_b
      // 失败时记录错误日志，不阻塞应用启动（migration 仍标记为已应用）
      try {
        const { fixed, skipped } = fixStancePairing(db)
        console.log('[migration] fix_stance_pairing_v4 done', { fixed, skipped })
      } catch (e) {
        console.error('[migration] fix_stance_pairing_v4 failed:', e)
      }
    }
  },
  {
    id: '20260901_add_allow_repeat_and_test_flag',
    up: (db) => {
      // 为 events 表添加 allow_repeat 列（赛事级"允许辩题重复"配置，0=不允许，1=允许）
      // 幂等性：内部用 pragma_table_info 检查列是否已存在，已存在则跳过
      // 不修改 draw_sessions：settings 是 JSON 字段，已支持 is_test 子字段
      addAllowRepeatAndTestFlag(db)
    }
  },
  {
    id: '20260902_fix_fk_and_add_snapshot_columns',
    up: (db) => {
      // P1-16: team_history.topic_id / draw_session_items.topic_id
      //        ON DELETE CASCADE → ON DELETE SET NULL（避免删辩题级联删历史）
      // P1-17: timer_sessions.format_id NOT NULL → 可空 + ON DELETE SET NULL
      //        （避免删赛制外键约束失败）
      // P2-44: timer_sessions 添加 event_name / team_aff_name / team_neg_name / topic_title
      //        冗余快照列（避免删事件/队伍/辩题后显示空名称）
      // SQLite 不支持 ALTER FOREIGN KEY，通过重建表实现
      fixFkAndAddSnapshotColumns(db)
    }
  },
  {
    id: '20260903_add_missing_indexes',
    up: (db) => {
      // P4-1: topics.source_type 缺索引
      // P4-2: events.status 缺索引
      // P4-3: team_history.topic_id 缺索引
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
      // 兼容旧库：20260904_create_matches 曾在部分用户库按旧 schema 建过 matches 并记为已应用，
      // 其 id 不变导致改写后的多裁判模型（match_judges / match_judge_votes /
      // matches.format_id / judge_system / recording_meta / timer_sessions.match_id）不会重跑。
      // 用新 id 幂等补齐（createMatchesTable 内部 CREATE IF NOT EXISTS + pragma 校验加列）。
      createMatchesTable(db)
    }
  },
  {
    id: '20260912_create_judge_history',
    up: (db) => {
      // T1：AI 裁判历史表（judge_match / judge_debate / judge_speech /
      //     detect_stage / simulate_opponent 结果持久化，跨页/重启保留）。
      createJudgeHistoryTable(db)
    }
  },
  {
    id: '20260910_add_pool_remaining_to_timer_sessions',
    up: (db) => {
      // 为 timer_sessions 表添加每队总时长池剩余字段（正方/反方池，毫秒）。
      // 带 teamPoolMinutes 的赛制（如新国辩官方 17 分钟自由分配版）用于持久化池剩余。
      // 采用独立列，避免与自由辩论的 aff_remaining_ms / neg_remaining_ms 冲突。
      try {
        db.exec('ALTER TABLE timer_sessions ADD COLUMN aff_pool_remaining_ms INTEGER')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('ALTER TABLE timer_sessions ADD COLUMN neg_pool_remaining_ms INTEGER')
      } catch {
        /* 字段已存在 */
      }
    }
  },
  {
    id: '20260911_add_speech_count_to_timer_sessions',
    up: (db) => {
      // 为 timer_sessions 表添加自由辩论发言次数字段（正方/反方），
      // 用于持久化自由辩论环节按 Space 切换发言方时累计的发言次数。
      try {
        db.exec('ALTER TABLE timer_sessions ADD COLUMN aff_speech_count INTEGER DEFAULT 0')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('ALTER TABLE timer_sessions ADD COLUMN neg_speech_count INTEGER DEFAULT 0')
      } catch {
        /* 字段已存在 */
      }
    }
  }
].sort((a, b) => a.id.localeCompare(b.id))

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
    try {
      m.up(db)
    } catch (e) {
      console.error(`[migrations] Migration ${m.id} failed:`, e)
      if (m.optional) {
        // 可选迁移失败时仅记录日志，继续执行后续迁移
        continue
      }
      // 关键迁移失败时重新抛出，中止整个迁移流程（保留原有行为）
      throw e
    }
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
