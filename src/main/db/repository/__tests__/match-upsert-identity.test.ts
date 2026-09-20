// ============================================================
// match-upsert-identity.test.ts — P5-007 upsertFromDraw identity 回归
// （真 SQLite roundtrip，FK ON）
//
// Match 业务身份 = (event_id, round_id, 无序 {teamA, teamB})；
// team_a/team_b 列语义 = 正方/反方角色分配（team_a_id=Aff），stance 是
// 可更新属性；status 限定 planned（resulted 已计赛果不被申领覆盖）。
//
// 覆盖：
//   1. 基础创建：A vs B → 1 Match
//   2. 重复 confirm 幂等：同 identity 两次 → 仍 1 Match（SQL COUNT 断言）
//   3. side swap：A/B → B/A → 不产生 duplicate，换边归位（team/stance/name）
//   4. 不同 Round 同队对阵 → 2 Match（不误合并）
//   5. resulted（已计赛果）不被申领覆盖 → 新建为合法新对阵
//   6. 旧数据保护：已有两条不同 identity 合法 Match，upsert 后数量不变
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
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT, round_number INTEGER, is_round_robin INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE ON UPDATE CASCADE,
    match_number INTEGER,
    team_a_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    team_b_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL ON UPDATE CASCADE,
    stance_a TEXT, stance_b TEXT, draw_item_id TEXT, session_id TEXT, recording_ref TEXT,
    status TEXT NOT NULL DEFAULT 'planned', winner TEXT,
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
    judge_system TEXT NOT NULL DEFAULT 'three_votes', created_at TEXT NOT NULL
  );
`

const EVT = 'evt-1'
const T_A = 'team-A'
const T_B = 'team-B'
const TOPIC = 'topic-1'

beforeEach(() => {
  mockDb.exec(DDL)
  // 模块级单例连接：先清数据再种子化（FK 顺序：子表在前）
  mockDb.exec(
    'DELETE FROM match_judge_votes; DELETE FROM match_judges; DELETE FROM matches; DELETE FROM teams; DELETE FROM rounds; DELETE FROM topics; DELETE FROM events;'
  )
  mockDb.prepare('INSERT INTO events (id, name) VALUES (?, ?)').run(EVT, '赛事')
  mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run(TOPIC, '辩题')
  mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run(T_A, 'A 队', EVT)
  mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run(T_B, 'B 队', EVT)
})

/** upsert 输入构造（正方=aff，反方=neg） */
function upsert(aff: string, neg: string, roundId: string | null = 'round-1', drawItemId = 'di-1', stanceAff = '正方', stanceNeg = '反方') {
  return matchRepo.upsertFromDraw({
    eventId: EVT,
    roundId,
    teamAffId: aff,
    teamNegId: neg,
    topicId: TOPIC,
    drawItemId,
    stanceAff,
    stanceNeg
  })
}

/** 直接查库：无序双队 + planned 的行数（幽灵检查） */
function countPlannedPair(roundId: string | null): number {
  return (
    mockDb
      .prepare(
        "SELECT COUNT(*) AS n FROM matches WHERE event_id = ? AND round_id IS ? AND status = 'planned' AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))"
      )
      .get(EVT, roundId, T_A, T_B, T_B, T_A) as { n: number }
  ).n
}

beforeEach(() => {
  mockDb
    .prepare('INSERT INTO rounds (id, event_id, name, round_number) VALUES (?, ?, ?, 1)')
    .run('round-1', EVT, '初赛')
})

describe('P5-007 upsertFromDraw identity（真 SQLite）', () => {
  it('基础创建：A vs B → 1 Match', () => {
    const m = upsert(T_A, T_B)
    expect(m.id).toBeTruthy()
    expect(countPlannedPair('round-1')).toBe(1)
  })

  it('重复 confirm 幂等：同 identity 两次 → 仍 1 Match（SQL COUNT 断言）', () => {
    const first = upsert(T_A, T_B)
    const second = upsert(T_A, T_B, 'round-1', 'di-2')
    expect(second.id).toBe(first.id)
    expect(countPlannedPair('round-1')).toBe(1)
  })

  it('side swap：A/B → B/A 再 confirm → 不产生 duplicate，换边归位（team/stance/name）', () => {
    const first = upsert(T_A, T_B, 'round-1', 'di-1', '正方', '反方')
    // 重抽换边：B 成为正方（aff），A 成为反方
    const swapped = upsert(T_B, T_A, 'round-1', 'di-2', '正方', '反方')

    expect(swapped.id).toBe(first.id)
    expect(countPlannedPair('round-1')).toBe(1)
    // 换边归位：team_a 列 = 新正方 B，team_b 列 = 新反方 A
    const row = mockDb.prepare('SELECT * FROM matches WHERE id = ?').get(first.id) as Record<
      string,
      unknown
    >
    expect(row.team_a_id).toBe(T_B)
    expect(row.team_b_id).toBe(T_A)
    expect(row.stance_a).toBe('正方')
    expect(row.stance_b).toBe('反方')
    expect(row.team_a_name).toBe('B 队')
    expect(row.team_b_name).toBe('A 队')
    expect(row.draw_item_id).toBe('di-2')
  })

  it('不同 Round 同队对阵 → 2 Match（不按无序 pair 误合并）', () => {
    mockDb
      .prepare('INSERT INTO rounds (id, event_id, name, round_number) VALUES (?, ?, ?, 2)')
      .run('round-2', EVT, '复赛')
    upsert(T_A, T_B, 'round-1')
    upsert(T_A, T_B, 'round-2')
    const total = (
      mockDb.prepare('SELECT COUNT(*) AS n FROM matches WHERE event_id = ?').get(EVT) as { n: number }
    ).n
    expect(total).toBe(2)
  })

  it('resulted（已计赛果）不被申领覆盖：换边 confirm 新建为合法新对阵', () => {
    const m = upsert(T_A, T_B)
    // 模拟已计赛果
    mockDb.prepare("UPDATE matches SET status = 'resulted' WHERE id = ?").run(m.id)
    const again = upsert(T_A, T_B)
    // resulted 不被覆盖 → 新建（现状语义）
    expect(again.id).not.toBe(m.id)
    expect(countPlannedPair('round-1')).toBe(1)
  })

  it('旧数据保护：已有两条不同 identity 合法 Match，upsert 后数量与内容不变', () => {
    mockDb
      .prepare('INSERT INTO rounds (id, event_id, name, round_number) VALUES (?, ?, ?, 2)')
      .run('round-2', EVT, '复赛')
    const m1 = upsert(T_A, T_B, 'round-1')
    const m2 = upsert(T_B, T_A, 'round-2')
    // 无关 identity 的 upsert（同 event/round 不同队——用第三队）
    mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run('team-C', 'C 队', EVT)
    upsert('team-C', T_A, 'round-1', 'di-9')

    const total = (
      mockDb.prepare('SELECT COUNT(*) AS n FROM matches WHERE event_id = ?').get(EVT) as { n: number }
    ).n
    expect(total).toBe(3)
    // 原两条内容不变（关键归属字段）
    const r1 = mockDb.prepare('SELECT team_a_id, team_b_id, round_id FROM matches WHERE id = ?').get(m1.id) as Record<string, unknown>
    expect(r1.team_a_id).toBe(T_A)
    expect(r1.team_b_id).toBe(T_B)
    expect(r1.round_id).toBe('round-1')
    const r2 = mockDb.prepare('SELECT team_a_id, team_b_id, round_id FROM matches WHERE id = ?').get(m2.id) as Record<string, unknown>
    expect(r2.team_a_id).toBe(T_B)
    expect(r2.team_b_id).toBe(T_A)
    expect(r2.round_id).toBe('round-2')
  })
})
