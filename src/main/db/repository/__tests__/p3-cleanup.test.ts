// ============================================================
// p3-cleanup.test.ts — Phase 5 P3 Cleanup 真库回归
// （真 SQLite node:sqlite + FK ON + 真 repo SQL）
//
// 覆盖：
//   P5-019：重跑同 (session, stage) → addRecord 唯一冲突显式重置既有记录
//           为「进行中」，finishRecord 更新同一行——单条记录、最新结果，
//           不再静默吞冲突后覆盖首跑历史
//   P5-021：listDrawnTopicIdsByEvent 排除 is_test 会话——test draw 不污染
//           正式排除集；formal→formal 排除保持
//   resolveNames：createMatch A vs B → team_a_name / team_b_name 双名解析
//           （collectIds 原每行仅收 team_a，team_b_name 恒 null）
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

class MockDb {
  private raw: DatabaseSync
  memory = false
  constructor() {
    this.raw = new DatabaseSync(':memory:')
    this.raw.exec('PRAGMA foreign_keys = ON')
  }
  exec(sql: string): void {
    this.raw.exec(sql)
  }
  prepare(sql: string) {
    const stmt = this.raw.prepare(sql)
    return {
      run: (...args: unknown[]) => stmt.run(...(args as never[])),
      get: (...args: unknown[]) => stmt.get(...(args as never[])),
      all: (...args: unknown[]) => stmt.all(...(args as never[]))
    }
  }
  pragma(sql: string): unknown[] {
    const s = sql.trim().toLowerCase()
    if (s.startsWith('foreign_keys') || s.startsWith('foreign_key_check')) return []
    return this.raw.prepare(sql).all() as unknown[]
  }
}

const mockDb = new MockDb()
vi.mock('../../index', () => ({ getDb: () => mockDb }))

// 被测模块（真 repo）
import { timerSessionRepo } from '../timer-session.repo'
import { drawRepo } from '../draw.repo'
import { matchRepo } from '../match.repo'

const DDL = `
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT);
  CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY, event_id TEXT, name TEXT);
  CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, title TEXT);
  CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, event_id TEXT REFERENCES events(id));
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    round_id TEXT, match_number INTEGER,
    team_a_id TEXT, team_b_id TEXT,
    topic_id TEXT REFERENCES topics(id),
    stance_a TEXT, stance_b TEXT, draw_item_id TEXT, session_id TEXT, recording_ref TEXT,
    status TEXT NOT NULL DEFAULT 'planned', winner TEXT,
    aff_score REAL, neg_score REAL, best_speaker TEXT, notes TEXT,
    format_id TEXT, judge_system TEXT NOT NULL DEFAULT 'three_votes',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    team_a_name TEXT, team_b_name TEXT, topic_title TEXT, event_name TEXT, round_name TEXT
  );
  CREATE TABLE IF NOT EXISTS match_judges (
    id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
    is_ai INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_judge_votes (
    id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    judge_id TEXT NOT NULL REFERENCES match_judges(id) ON DELETE CASCADE,
    judge_system TEXT NOT NULL DEFAULT 'three_votes', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS timer_sessions (
    id TEXT PRIMARY KEY, event_id TEXT, round_id TEXT, match_id TEXT,
    format_id TEXT, format_snapshot TEXT, status TEXT NOT NULL,
    started_at TEXT, ended_at TEXT, current_stage_index INTEGER,
    current_side TEXT, remaining_ms INTEGER, stage_remaining_cache TEXT
  );
  CREATE TABLE IF NOT EXISTS timer_records (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, stage_index INTEGER NOT NULL,
    stage_name TEXT, side TEXT, duration_ms INTEGER, actual_ms INTEGER,
    started_at TEXT, ended_at TEXT, pause_count INTEGER
  );
  CREATE TABLE IF NOT EXISTS draw_sessions (
    id TEXT PRIMARY KEY, event_id TEXT, round_id TEXT,
    draw_time TEXT, operator TEXT, settings TEXT
  );
  CREATE TABLE IF NOT EXISTS draw_session_items (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES draw_sessions(id) ON DELETE CASCADE,
    topic_id TEXT
  );
`

beforeEach(() => {
  mockDb.exec(DDL)
})

describe('P3 Cleanup 真库回归', () => {
  describe('P5-019 重跑环节记录（timer_records UNIQUE 冲突显式重置）', () => {
    it('重跑同 (session, stage) → 单条记录、首跑结果被重置、finishRecord 落最新结果', () => {
      mockDb.prepare(
        "INSERT INTO timer_sessions (id, status, started_at) VALUES ('ts1', 'running', '2026-01-01T00:00:00Z')"
      ).run()
      // 首跑
      timerSessionRepo.addRecord({
        sessionId: 'ts1', stageIndex: 0, stageName: '立论', side: 'aff',
        durationMs: 120000, startedAt: '2026-01-01T00:00:10Z'
      })
      timerSessionRepo.finishRecord('ts1', 0, 50000, '2026-01-01T00:01:00Z', 2)

      // 重跑（prevStage 回退后再次开始）→ 唯一冲突 → 显式重置为进行中
      const rerun = timerSessionRepo.addRecord({
        sessionId: 'ts1', stageIndex: 0, stageName: '立论', side: 'aff',
        durationMs: 120000, startedAt: '2026-01-01T00:05:00Z'
      })
      const records = timerSessionRepo.listRecords('ts1')
      expect(records.length).toBe(1) // 不产生第二行
      expect(records[0].actualMs).toBeNull() // 首跑结果已被重置为进行中
      expect(records[0].startedAt).toBe('2026-01-01T00:05:00Z')
      expect(records[0].pauseCount).toBe(0)

      // 重跑结束 → finishRecord 更新同一行
      timerSessionRepo.finishRecord('ts1', 0, 9999, '2026-01-01T00:06:00Z', 1)
      const after = timerSessionRepo.listRecords('ts1')
      expect(after.length).toBe(1)
      expect(after[0].actualMs).toBe(9999)
      expect(after[0].endedAt).toBe('2026-01-01T00:06:00Z')
      expect(after[0].pauseCount).toBe(1)
      expect(rerun).toBeDefined()
    })
  })

  describe('P5-021 test draw 不污染正式排除集', () => {
    it('is_test 会话的已抽题不进入 listDrawnTopicIdsByEvent；formal→formal 保持排除', () => {
      mockDb.prepare(
        "INSERT INTO draw_sessions (id, event_id, settings) VALUES ('s-formal', 'e1', '{}')"
      ).run()
      mockDb.prepare(
        "INSERT INTO draw_sessions (id, event_id, settings) VALUES ('s-test', 'e1', '{\"is_test\":true}')"
      ).run()
      const insertItem = mockDb.prepare('INSERT INTO draw_session_items (id, session_id, topic_id) VALUES (?, ?, ?)')
      insertItem.run('i1', 's-formal', 'topic-formal-1')
      insertItem.run('i2', 's-test', 'topic-test-1')
      insertItem.run('i3', 's-test', 'topic-test-2')

      const ids = drawRepo.listDrawnTopicIdsByEvent('e1')
      expect(ids).toContain('topic-formal-1') // formal→formal 排除保持
      expect(ids).not.toContain('topic-test-1') // test draw 不污染
      expect(ids).not.toContain('topic-test-2')
    })
  })

  describe('resolveNames team_b_name 双向解析', () => {
    it('createMatch A vs B → team_a_name 与 team_b_name 均正确', () => {
      mockDb.prepare("INSERT INTO events (id, name) VALUES ('e1', '赛事一')").run()
      mockDb.prepare("INSERT INTO teams (id, name, event_id) VALUES ('tA', '曙光队', 'e1')").run()
      mockDb.prepare("INSERT INTO teams (id, name, event_id) VALUES ('tB', '破晓队', 'e1')").run()
      mockDb.prepare("INSERT INTO topics (id, title) VALUES ('tp1', '人工智能伦理')").run()

      const match = matchRepo.create({
        eventId: 'e1',
        matchNumber: 1,
        teamAffId: 'tA',
        teamNegId: 'tB',
        topicId: 'tp1'
      })
      expect(match.teamAffName).toBe('曙光队')
      expect(match.teamNegName).toBe('破晓队') // 修复前恒为 null（rowToMatch 兜底 '反方'）
      expect(match.topicTitle).toBe('人工智能伦理')
    })
  })
})
