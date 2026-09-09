// ============================================================
// setResult-transaction.test.ts — setResult 事务化（Phase 1.0-C）真 SQLite 验证
//
// 覆盖：
//   1. 成功路径：setResult 写 judges/votes + UPDATE matches 原子落库
//   2. 回滚路径：computeMatchResult 中途抛错 → replaceJudges 的
//      DELETE votes/judges + INSERT 全部回滚，matches 无半改状态
//
// 引擎：node:sqlite 的 DatabaseSync（真实 SQLite，Node 22+）。
// 架构：vi.mock('../../db') 返回 MigMock 风格适配实例；match.repo 的
//       真实 SQL 全部跑在该实例上；match_judges/match_judge_votes/matches
//       三表用与迁移 20260904 相同的 DDL 手工建表（避免跑全量迁移）。
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ---- 可控抛错标志（供回滚用例注入失败） ----
let forceThrow = false

// ---- mock computeMatchResult：包装真实现 + forceThrow 注入 ----
vi.mock('../../../../shared/match-result', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../shared/match-result')>()
  return {
    ...actual,
    computeMatchResult: (...args: unknown[]) => {
      if (forceThrow) throw new Error('boom: injected compute failure')
      return (
        actual.computeMatchResult as (...a: unknown[]) => unknown
      )(...args)
    }
  }
})

// ---- node:sqlite → better-sqlite3 兼容薄适配（与 migrations.test.ts 同模式） ----
class MockDb {
  private raw: DatabaseSync
  memory = false
  constructor() {
    this.raw = new DatabaseSync(':memory:')
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
  // better-sqlite3 的 db.transaction：返回包装函数，BEGIN/COMMIT/ROLLBACK
  // 与 better-sqlite3 一致：嵌套事务自动降级为 SAVEPOINT
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

// match.repo 通过 `import { getDb } from '../index'` 取连接
vi.mock('../../index', () => ({ getDb: () => mockDb }))

// 被测模块（mock 之后导入）
import { matchRepo } from '../match.repo'

const DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    event_id TEXT,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT
  );
  DROP TABLE IF EXISTS match_judge_votes;
  DROP TABLE IF EXISTS match_judges;
  DROP TABLE IF EXISTS matches;
  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    round_id TEXT,
    match_number INTEGER,
    team_a_id TEXT,
    team_b_id TEXT,
    topic_id TEXT,
    stance_a TEXT,
    stance_b TEXT,
    draw_item_id TEXT,
    session_id TEXT,
    recording_ref TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    winner TEXT,
    aff_score REAL,
    neg_score REAL,
    best_speaker TEXT,
    notes TEXT,
    ai_review TEXT,
    created_at TEXT,
    updated_at TEXT,
    team_a_name TEXT,
    team_b_name TEXT,
    topic_title TEXT,
    event_name TEXT,
    round_name TEXT,
    recording_meta TEXT,
    judge_system TEXT
  );
  CREATE TABLE match_judges (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_ai INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE match_judge_votes (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    judge_id TEXT NOT NULL,
    judge_system TEXT NOT NULL DEFAULT 'three_votes',
    impression_vote TEXT,
    decision_vote TEXT,
    aff_total REAL,
    neg_total REAL,
    stage_scores TEXT,
    best_speaker TEXT,
    comment TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`

function seedMatch(id: string): void {
  mockDb
    .prepare(
      "INSERT INTO matches (id, event_id, status, created_at, updated_at) VALUES (?, ?, 'planned', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z')"
    )
    .run(id, 'ev-1')
}

function count(table: string): number {
  return (mockDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
}

const vote = {
  judgeSystem: 'three_votes' as const,
  impressionVote: 'aff' as const,
  decisionVote: 'aff' as const
}

beforeEach(() => {
  mockDb.exec(DDL)
  seedMatch('m-1')
  forceThrow = false
})

describe('setResult 事务化（真实 SQLite 回滚验证）', () => {
  it('成功路径：judges/votes 各 1 行，matches 落 winner 与 status=resulted', () => {
    const r = matchRepo.setResult('m-1', {
      winner: 'aff',
      judges: [{ name: '裁判A', vote }]
    })
    expect(r).not.toBeNull()
    expect(r!.status).toBe('resulted')
    expect(r!.winner).toBe('aff')
    expect(count('match_judges')).toBe(1)
    expect(count('match_judge_votes')).toBe(1)
  })

  it('回滚路径：computeMatchResult 抛错 → judges/votes 全部回滚、matches 无半改', () => {
    // 先成功写入一次（提交态基线：1 裁判 1 票）
    matchRepo.setResult('m-1', {
      winner: 'aff',
      judges: [{ name: '裁判A', vote }]
    })
    expect(count('match_judges')).toBe(1)
    expect(count('match_judge_votes')).toBe(1)

    // 注入失败：第二次 setResult 在 replaceJudges（删旧插新）完成后的聚合阶段抛错
    forceThrow = true
    expect(() =>
      matchRepo.setResult('m-1', {
        winner: 'neg',
        judges: [
          { name: '裁判B', vote: { ...vote, decisionVote: 'neg' as const } },
          { name: '裁判C', vote: { ...vote, decisionVote: 'neg' as const } }
        ]
      })
    ).toThrow('boom')

    // 事务回滚：不留半成品——仍是首次提交的 1 裁判 1 票，matches 未被第二次触碰
    expect(count('match_judges')).toBe(1)
    expect(count('match_judge_votes')).toBe(1)
    const judgeName = (
      mockDb.prepare('SELECT name FROM match_judges').get() as { name: string }
    ).name
    expect(judgeName).toBe('裁判A')
    const row = mockDb
      .prepare('SELECT winner, status FROM matches WHERE id = ?')
      .get('m-1') as { winner: string; status: string }
    expect(row.status).toBe('resulted')
    expect(row.winner).toBe('aff')
  })

  it('match 不存在 → 返回 null 且不写任何表', () => {
    const r = matchRepo.setResult('m-not-exist', { winner: 'aff' })
    expect(r).toBeNull()
    expect(count('match_judges')).toBe(0)
  })
})
