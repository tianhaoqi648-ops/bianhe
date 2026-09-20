// ============================================================
// set-result-notes.test.ts — P5-008 notes 保留语义回归（真 SQLite）
//
// 覆盖：
//   1. 已有 notes + notes omitted（renderer-equivalent payload）→ notes 保留
//   2. 显式新 notes → 更新为新值
//   3. 显式 null → 写 NULL（类型定义语义；renderer 从不传，无 UI 清空路径）
//   4. 重复 setResult（第二次不传 notes）→ 不被清空
//   5. 其他赛果字段（winner/status/identity）不因修复变化
//
// 引擎：node:sqlite DatabaseSync（FK ON）；matches/judges/votes 为精简列集，
// FK 语义与生产一致；setResult 事务经 MockDb.transaction 真实执行。
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
  private txDepth = 0
  private txSeq = 0
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: unknown[]) => {
      const sp = 'sp_' + ++this.txSeq
      if (this.txDepth === 0) this.raw.exec('BEGIN')
      else this.raw.exec('SAVEPOINT ' + sp)
      this.txDepth++
      try {
        const r = fn(...(args as never[]))
        this.txDepth--
        if (this.txDepth === 0) this.raw.exec('COMMIT')
        else this.raw.exec('RELEASE ' + sp)
        return r
      } catch (e) {
        this.txDepth--
        if (this.txDepth === 0) this.raw.exec('ROLLBACK')
        else {
          this.raw.exec('ROLLBACK TO ' + sp)
          this.raw.exec('RELEASE ' + sp)
        }
        throw e
      }
    }) as unknown as T
  }
}

const mockDb = new MockDb()

vi.mock('../../index', () => ({ getDb: () => mockDb }))

// 被测模块（mock 之后导入）
import { matchRepo } from '../match.repo'

const DDL = `
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT);
  CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, title TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY, event_id TEXT, name TEXT);
  CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, event_id TEXT);
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE ON UPDATE CASCADE,
    team_a_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    team_b_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL ON UPDATE CASCADE,
    stance_a TEXT, stance_b TEXT, draw_item_id TEXT, session_id TEXT, recording_ref TEXT,
    status TEXT NOT NULL DEFAULT 'planned', winner TEXT,
    aff_score REAL, neg_score REAL, best_speaker TEXT, notes TEXT,
    format_id TEXT, judge_system TEXT NOT NULL DEFAULT 'three_votes',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    team_a_name TEXT, team_b_name TEXT, topic_title TEXT, event_name TEXT, round_name TEXT
  );
  CREATE TABLE IF NOT EXISTS match_judges (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
    is_ai INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_judge_votes (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE ON UPDATE CASCADE,
    judge_id TEXT NOT NULL REFERENCES match_judges(id) ON DELETE CASCADE ON UPDATE CASCADE,
    judge_system TEXT NOT NULL DEFAULT 'three_votes',
    impression_vote TEXT, decision_vote TEXT,
    aff_total REAL, neg_total REAL, stage_scores TEXT,
    best_speaker TEXT, comment TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`

const EVT = 'evt-1'

function seedMatch(id: string, notes: string | null): void {
  mockDb.prepare('INSERT INTO events (id, name) VALUES (?, ?)').run(EVT, '赛事')
  mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run('topic-1', '辩题')
  mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run('t1', 'A 队', EVT)
  mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run('t2', 'B 队', EVT)
  mockDb
    .prepare(
      "INSERT INTO matches (id, event_id, team_a_id, team_b_id, topic_id, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'planned', ?, '2026-01-01', '2026-01-01')"
    )
    .run(id, EVT, 't1', 't2', 'topic-1', notes)
}

/** renderer-equivalent payload：与 MatchResultModal 一致（winner + judges，无 notes） */
function rendererPayload() {
  return {
    winner: 'aff' as const,
    judges: [
      {
        name: '裁判一',
        vote: {
          judgeSystem: 'three_votes' as const,
          impressionVote: 'aff' as const,
          decisionVote: null,
          affTotal: null,
          negTotal: null,
          bestSpeaker: null
        }
      }
    ]
  }
}

function getNotes(id: string): string | null {
  return (mockDb.prepare('SELECT notes FROM matches WHERE id = ?').get(id) as { notes: string | null }).notes
}

function getStatus(id: string): string {
  return (mockDb.prepare('SELECT status FROM matches WHERE id = ?').get(id) as { status: string }).status
}

beforeEach(() => {
  mockDb.exec(DDL)
  mockDb.exec('DELETE FROM match_judge_votes; DELETE FROM match_judges; DELETE FROM matches; DELETE FROM teams; DELETE FROM topics; DELETE FROM events;')
})

describe('P5-008 setResult notes 保留语义（真 SQLite）', () => {
  it('已有 notes + notes omitted（renderer-equivalent payload）→ notes 保留', () => {
    seedMatch('m-1', '原备注')
    matchRepo.setResult('m-1', rendererPayload())
    expect(getNotes('m-1')).toBe('原备注')
    expect(getStatus('m-1')).toBe('resulted')
  })

  it('显式新 notes → 更新为新值', () => {
    seedMatch('m-1', '原备注')
    matchRepo.setResult('m-1', { ...rendererPayload(), notes: '新备注' })
    expect(getNotes('m-1')).toBe('新备注')
  })

  it('显式 null → 写 NULL（类型定义语义；renderer 从不传，无 UI 清空路径）', () => {
    seedMatch('m-1', '原备注')
    matchRepo.setResult('m-1', { ...rendererPayload(), notes: null })
    expect(getNotes('m-1')).toBeNull()
  })

  it('重复 setResult：第二次不传 notes → 不被清空', () => {
    seedMatch('m-1', null)
    // 第一次：带 notes
    matchRepo.setResult('m-1', { ...rendererPayload(), notes: '重要备注' })
    expect(getNotes('m-1')).toBe('重要备注')
    // 第二次：renderer-equivalent（不传 notes）→ 保留
    matchRepo.setResult('m-1', rendererPayload())
    expect(getNotes('m-1')).toBe('重要备注')
  })

  it('其他赛果字段不因修复变化：winner/status/identity 保持', () => {
    seedMatch('m-1', '原备注')
    matchRepo.setResult('m-1', rendererPayload())
    const row = mockDb
      .prepare('SELECT winner, status, team_a_id, team_b_id, topic_id, event_id FROM matches WHERE id = ?')
      .get('m-1') as Record<string, unknown>
    expect(row.winner).toBe('aff')
    expect(row.status).toBe('resulted')
    expect(row.team_a_id).toBe('t1')
    expect(row.team_b_id).toBe('t2')
    expect(row.topic_id).toBe('topic-1')
    expect(row.event_id).toBe(EVT)
  })
})
