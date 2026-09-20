// ============================================================
// weighted-gate.test.ts — P5-009 weight 合法域与有效候选 gate 回归
// （真 SQLite：topics 行含真实 weight 数据，assertSufficientTopics /
//  updateWeight 为生产函数本体）
//
// 覆盖：
//   1. all positive（effective = requested）→ 正常
//   2. partial zero（effective < requested）→ InsufficientTopicsError 且
//      candidateCount 为有效数（2），错误信息不误导
//   3. all zero → effective=0，判定无有效候选
//   4. effective = requested 边界 → 正常完成
//   5. negative → gate 忽略（weight<=0 不参与选择）
//   6. unweighted（weight 缺省）→ 全部计入，行为不变
//   7. updateWeight 写入校验：负数 / NaN / Infinity 拒绝不落库；0 与正常值写入
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

vi.mock('../../db', () => ({ getDb: () => mockDb }))

// 被测模块（mock 之后导入）——assertSufficientTopics 与 updateWeight 均为生产函数
import { assertSufficientTopics, InsufficientTopicsError } from '../draw-engine'
import { topicRepo } from '../../db/repository/topic.repo'
import type { Topic } from '../../../shared/types'

const DDL = `
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT, domain TEXT, difficulty TEXT,
    source TEXT, source_type TEXT, tags TEXT, weight REAL DEFAULT 1.0,
    status TEXT DEFAULT 'active', created_at TEXT, updated_at TEXT,
    custom_data TEXT, batch_id TEXT
  );
`

const EVT = 'evt-1'

/** 真库种子 N 道题（weight 缺省 1.0），返回 SELECT * 的真实行形态 */
function seedTopicsSimple(weights: Array<number | null>): Topic[] {
  const stmt = mockDb.prepare(
    'INSERT INTO topics (id, title, weight, status, created_at) VALUES (?, ?, ?, ?, ?)'
  )
  for (let i = 0; i < weights.length; i++) {
    stmt.run(`t-${i + 1}`, `题目${i + 1}`, weights[i], 'active', '2026-01-01T00:00:00.000Z')
  }
  return mockDb.prepare('SELECT * FROM topics ORDER BY id').all() as unknown as Topic[]
}

beforeEach(() => {
  mockDb.exec(DDL)
  mockDb.exec('DELETE FROM topics;')
  void EVT
})

describe('P5-009 有效候选 gate（assertSufficientTopics，真库数据）', () => {
  it('all positive：5×weight=1，requested=5（effective=requested 边界）→ 不抛', () => {
    const rows = seedTopicsSimple([1, 1, 1, 1, 1])
    expect(() => assertSufficientTopics(rows, 5)).not.toThrow()
  })

  it('partial zero：[1,0,0,1,0]（effective=2 < requested=3）→ 抛错且 candidateCount=2，信息准确', () => {
    const rows = seedTopicsSimple([1, 0, 0, 1, 0])
    try {
      assertSufficientTopics(rows, 3)
      expect.unreachable('应当抛出 InsufficientTopicsError')
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientTopicsError)
      const err = e as InsufficientTopicsError
      expect(err.candidateCount).toBe(2)
      expect(err.requiredCount).toBe(3)
      expect(err.message).toContain('有效候选')
      // 错误信息不得误导为「没有候选」
      expect(err.message).not.toContain('候选池为空')
    }
  })

  it('all zero：5×weight=0 → effective=0，判定无有效候选', () => {
    const rows = seedTopicsSimple([0, 0, 0, 0, 0])
    try {
      assertSufficientTopics(rows, 1)
      expect.unreachable('应当抛出 InsufficientTopicsError')
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientTopicsError)
      expect((e as InsufficientTopicsError).candidateCount).toBe(0)
    }
  })

  it('negative：gate 忽略（[1,-1,1] → effective=2），不参与选择口径', () => {
    const rows = seedTopicsSimple([1, -1, 1])
    expect(() => assertSufficientTopics(rows, 2)).not.toThrow()
    expect(() => assertSufficientTopics(rows, 3)).toThrow(InsufficientTopicsError)
  })

  it('unweighted：weight 缺省（NULL）→ 全部计入，行为不变', () => {
    const rows = seedTopicsSimple([null, null, null])
    expect(() => assertSufficientTopics(rows, 3)).not.toThrow()
    expect(() => assertSufficientTopics(rows, 4)).toThrow(InsufficientTopicsError)
  })

  it('allow_repeat=true → 跳过 gate（有放回可凑够，现状语义）', () => {
    const rows = seedTopicsSimple([0, 0])
    expect(() => assertSufficientTopics(rows, 5, true)).not.toThrow()
  })
})

describe('P5-009 weight 写入校验（updateWeight，真库）', () => {
  beforeEach(() => {
    mockDb.prepare(
      "INSERT INTO topics (id, title, weight, status, created_at) VALUES ('tw-1', '题目', 1.0, 'active', '2026-01-01T00:00:00.000Z')"
    ).run()
  })

  it('负数 → 拒绝且不落库', () => {
    expect(() => topicRepo.updateWeight('tw-1', -1)).toThrow('不小于 0 的有限数值')
    const row = mockDb.prepare('SELECT weight FROM topics WHERE id = ?').get('tw-1') as { weight: number }
    expect(row.weight).toBe(1.0)
  })

  it('NaN / Infinity → 拒绝不落库', () => {
    expect(() => topicRepo.updateWeight('tw-1', NaN)).toThrow('不小于 0 的有限数值')
    expect(() => topicRepo.updateWeight('tw-1', Infinity)).toThrow('不小于 0 的有限数值')
    expect(() => topicRepo.updateWeight('tw-1', -Infinity)).toThrow('不小于 0 的有限数值')
    expect((mockDb.prepare('SELECT weight FROM topics WHERE id = ?').get('tw-1') as { weight: number }).weight).toBe(1.0)
  })

  it('weight=0（停用语义）与正常值 → 写入成功', () => {
    expect(() => topicRepo.updateWeight('tw-1', 0)).not.toThrow()
    expect((mockDb.prepare('SELECT weight FROM topics WHERE id = ?').get('tw-1') as { weight: number }).weight).toBe(0)
    expect(() => topicRepo.updateWeight('tw-1', 3.5)).not.toThrow()
    expect((mockDb.prepare('SELECT weight FROM topics WHERE id = ?').get('tw-1') as { weight: number }).weight).toBe(3.5)
  })
})
