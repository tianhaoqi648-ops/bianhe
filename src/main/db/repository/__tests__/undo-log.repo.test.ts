// ============================================================
// undo-log.repo.test.ts — undo_log 容量/生命周期保护（Governance-8.2）
//
// 覆盖：
//   1. total 字节超限 → 删最旧直至达标（总容量保护）
//   2. total 条数超限 → 删最旧（总条数保护）
//   3. retention 超期 → 删除过期日志（按时间保留策略）
//   4. createLog 写入后自动清理，总条数不超上限（自动清理）
//   5. 单条 payload 超限 → 抛错不入库（约束批量快照）
//
// better-sqlite3 为 Electron ABI 编译，vitest(Node ABI) 无法加载，
// 因此 mock getDb() 返回内存桩（与 event.repo.test.ts 相同策略）。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { undoLogRepo, UNDO_CONFIG } from '../undo-log.repo'

type Row = { id: string; created_at: string; payload_size: number }

// 共享可变状态：rows 可由测试直接填充/复位，模拟 undo_log 表
const h = vi.hoisted(() => {
  const rows: Row[] = []
  const prepare = (sql: string) => {
    const s = sql.trim()
    return {
      run: (...args: unknown[]) => {
        if (/^INSERT\s+INTO\s+undo_log/i.test(s)) {
          // args: [id, created_at, store_name, action, target_type, target_id, before, after, payload_size, label]
          rows.push({ id: args[0] as string, created_at: args[1] as string, payload_size: args[8] as number })
          return { changes: 1 }
        }
        if (/DELETE\s+FROM\s+undo_log\s+WHERE\s+created_at/i.test(s)) {
          const cutoff = args[0] as string
          const before = rows.length
          const kept: Row[] = []
          for (const r of rows) if (r.created_at >= cutoff) kept.push(r)
          rows.length = 0
          rows.push(...kept)
          return { changes: before - kept.length }
        }
        if (/DELETE\s+FROM\s+undo_log\s+WHERE\s+id/i.test(s)) {
          const id = args[0] as string
          const before = rows.length
          const kept: Row[] = []
          for (const r of rows) if (r.id !== id) kept.push(r)
          rows.length = 0
          rows.push(...kept)
          return { changes: before - kept.length }
        }
        if (/^DELETE\s+FROM\s+undo_log$/i.test(s)) {
          const n = rows.length
          rows.length = 0
          return { changes: n }
        }
        return { changes: 0 }
      },
      get: () => {
        if (/SELECT\s+COUNT\(\*\)/i.test(s)) return { total: rows.length }
        if (/COALESCE\s*\(\s*SUM\(payload_size\)/i.test(s)) {
          return { total: rows.reduce((sum, r) => sum + r.payload_size, 0) }
        }
        if (/ORDER\s+BY\s+created_at\s+ASC/i.test(s)) {
          const oldest = [...rows].sort(
            (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
          )[0]
          return oldest ?? undefined
        }
        return undefined
      },
      all: () => []
    }
  }
  return {
    rows,
    prepare,
    transaction<T = void>(fn: () => T): () => T {
      return fn
    }
  }
})

vi.mock('../../index', () => ({
  getDb: () => ({
    prepare: (sql: string) => h.prepare(sql),
    transaction: (fn: () => unknown) => h.transaction(fn)
  })
}))

beforeEach(() => {
  h.rows.length = 0
})

/** 批量填充固定行，便于断言「删最旧」的顺序。 */
function seed(rows: Row[]) {
  h.rows.push(...rows)
}

/** 小阈值覆盖：关闭 retention 与无关维度，仅测条数保护。 */
const COUNT_CFG = { MAX_LOGS: 2, MAX_TOTAL_BYTES: 1e12, RETENTION_MS: 1e12 }
/** 小阈值覆盖：仅测总字节保护。 */
const BYTES_CFG = { MAX_LOGS: 1e6, MAX_TOTAL_BYTES: 150, RETENTION_MS: 1e12 }

describe('undo_log 容量/生命周期保护', () => {
  it('总条数超限时自动删除最旧日志', () => {
    seed([
      { id: 'a', created_at: '2024-01-01T00:00:00.000Z', payload_size: 10 },
      { id: 'b', created_at: '2024-01-02T00:00:00.000Z', payload_size: 10 },
      { id: 'c', created_at: '2024-01-03T00:00:00.000Z', payload_size: 10 },
      { id: 'd', created_at: '2024-01-04T00:00:00.000Z', payload_size: 10 }
    ])

    const deleted = undoLogRepo.enforceCapacity(COUNT_CFG)

    expect(deleted).toBe(2)
    expect(undoLogRepo.getStats()).toEqual({ count: 2, totalBytes: 20 })
    expect(h.rows.map((r) => r.id).sort()).toEqual(['c', 'd'])
  })

  it('总 payload 字节超限时删除最旧直至达标（总容量保护）', () => {
    seed([
      { id: 'a', created_at: '2024-01-01T00:00:00.000Z', payload_size: 100 },
      { id: 'b', created_at: '2024-01-02T00:00:00.000Z', payload_size: 100 },
      { id: 'c', created_at: '2024-01-03T00:00:00.000Z', payload_size: 100 }
    ])

    undoLogRepo.enforceCapacity(BYTES_CFG)

    // 300 > 150 → 删 a(100) → 200 > 150 → 删 b(100) → 100 ≤ 150 停止
    expect(h.rows.map((r) => r.id)).toEqual(['c'])
    expect(undoLogRepo.getStats()).toEqual({ count: 1, totalBytes: 100 })
  })

  it('retention 超期日志按时间清理（时间保留策略）', () => {
    const now = new Date().toISOString()
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    seed([
      { id: 'old', created_at: twoDaysAgo, payload_size: 10 },
      { id: 'new', created_at: now, payload_size: 10 }
    ])

    undoLogRepo.enforceCapacity({ MAX_LOGS: 1e6, MAX_TOTAL_BYTES: 1e12, RETENTION_MS: 24 * 60 * 60 * 1000 })

    expect(h.rows.map((r) => r.id)).toEqual(['new'])
  })

  it('createLog 每次写入后自动清理，总条数不超上限', () => {
    // 用真实 createLog 连续写入（每次触发 enforceCapacity）
    for (let i = 0; i < UNDO_CONFIG.MAX_LOGS + 7; i++) {
      undoLogRepo.createLog({
        store_name: 'topic',
        action: 'update',
        target_type: 'topic',
        target_id: `t${i}`,
        before_data: { a: 1 },
        after_data: { a: 2 },
        label: `写 ${i}`
      })
    }
    const stats = undoLogRepo.getStats()
    expect(stats.count).toBe(UNDO_CONFIG.MAX_LOGS)
    expect(stats.count).toBeLessThanOrEqual(UNDO_CONFIG.MAX_LOGS)
  })

  it('单条 payload 超过上限时抛错且不入库（约束批量快照）', () => {
    const big = 'x'.repeat(UNDO_CONFIG.MAX_PAYLOAD_BYTES)
    expect(() =>
      undoLogRepo.createLog({
        store_name: 'topic',
        action: 'batchUpdate',
        target_type: 'topic',
        target_id: null,
        before_data: { topics: [big] },
        after_data: { topics: [big] },
        label: '超限批量'
      })
    ).toThrow(/payload too large/)

    expect(undoLogRepo.countAll()).toBe(0)
  })

  it('getStats/countAll/sumPayload 正常汇总', () => {
    seed([
      { id: 'x', created_at: '2024-01-01T00:00:00.000Z', payload_size: 100 },
      { id: 'y', created_at: '2024-01-02T00:00:00.000Z', payload_size: 50 }
    ])
    expect(undoLogRepo.countAll()).toBe(2)
    expect(undoLogRepo.sumPayload()).toBe(150)
    expect(undoLogRepo.getStats()).toEqual({ count: 2, totalBytes: 150 })
  })
})

// ============================================================
// governance Task 12：undo payload 写路径（非法不入库/宽容降级）
// ============================================================
describe('undo payload 写路径校验（governance 12）', () => {
  it('原始类型快照（非法）→ createLog 抛错，不入库（由 withUndoLog 降级为不可撤销）', () => {
    expect(() =>
      undoLogRepo.createLog({
        store_name: 'topic',
        action: 'update',
        target_type: 'topic',
        target_id: 't1',
        before_data: 42, // 原始类型，非法快照
        after_data: null,
        label: '非法快照'
      })
    ).toThrow(/invalid undo payload/)
    expect(undoLogRepo.countAll()).toBe(0)
  })

  it('合法旧格式快照（bindEvent 结构 / 缺省）→ 兼容并通过', () => {
    // before/after 为 null —— 纯新增场景的合理旧格式，宽容放行
    const id = undoLogRepo.createLog({
      store_name: 'topic',
      action: 'create',
      target_type: 'topic',
      target_id: 't2',
      before_data: null,
      after_data: { id: 't2', title: '新题' },
      label: '合法新建'
    })
    expect(typeof id).toBe('string')

    // topicGroup bindEvent 快照 { id, group_ids } —— 旧合法格式，宽容放行
    undoLogRepo.createLog({
      store_name: 'topicGroup',
      action: 'bindEvent',
      target_type: 'event',
      target_id: 'e1',
      before_data: { id: 'e1', group_ids: [] },
      after_data: { id: 'e1', group_ids: ['g1', 'g2'] },
      label: '绑定题库'
    })
    expect(undoLogRepo.countAll()).toBe(2)
  })
})