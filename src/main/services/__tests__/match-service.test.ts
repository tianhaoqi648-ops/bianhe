// ============================================================
// match-service.test.ts — createMatch 事务边界测试（Governance Task 5）
//
// 背景：better-sqlite3 为 Electron ABI 编译，vitest(Node ABI) 无法直接加载
//（见 match.repo.test.ts 注释），故用 mock getDb 模拟 better-sqlite3 的
// transaction 语义（BEGIN → 回调成功 COMMIT / 抛错 ROLLBACK 并重抛）。
// 此处验证「一次用户动作」在 service/IPC 编排层以显式事务包住 matchRepo.create：
//   - 成功路径：事务提交、返回创建结果；
//   - 失败路径：matchRepo.create 抛错 → 事务回滚、错误向上传播（不被吞掉）。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => {
  const mockCreate = vi.fn()
  // 模拟 better-sqlite3 transaction 的状态机：begin→(commit|rollback)
  const state = { open: 0, committed: 0, rolledBack: 0 }
  // better-sqlite3：db.transaction(fn) 返回新函数，调用时开启事务；
  // 回调抛错 → ROLLBACK 并重抛；正常返回 → COMMIT 并返回回调值。
  const mockTransaction = (fn: (...args: unknown[]) => unknown) =>
    function (this: unknown, ...args: unknown[]): unknown {
      state.open++
      try {
        const result = fn.apply(this, args)
        state.committed++
        state.open--
        return result
      } catch (e) {
        state.rolledBack++
        state.open--
        throw e
      }
    }
  return { mockCreate, mockTransaction, state }
})

vi.mock('../../db/repository/match.repo', () => ({
  matchRepo: { create: m.mockCreate }
}))

vi.mock('../../db/index', () => ({
  getDb: () => ({ transaction: m.mockTransaction })
}))

import { createMatch } from '../match-service'

const INPUT = { eventId: 'evt1', roundId: 'r1', teamAffId: 'ta', teamNegId: 'tb' }
const MADE = {
  id: 'm1',
  eventId: 'evt1',
  roundId: 'r1',
  matchNumber: 1,
  teamAffId: 'ta',
  teamNegId: 'tb',
  topicId: null,
  stanceAff: null,
  stanceNeg: null,
  drawItemId: null,
  sessionId: null,
  status: 'planned',
  winner: null,
  affScore: null,
  negScore: null,
  bestSpeaker: null,
  notes: null,
  aiReview: null,
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
  teamAffName: '正方',
  teamNegName: '反方',
  topicTitle: null,
  eventName: '预赛',
  roundName: '第一轮',
  judges: [],
  votes: []
}

beforeEach(() => {
  vi.clearAllMocks()
  m.state.committed = 0
  m.state.rolledBack = 0
  m.state.open = 0
  m.mockCreate.mockReturnValue({ ...MADE })
})

describe('createMatch（service 层显式事务边界）', () => {
  it('成功：repo.create 在单个事务内被调用一次并提交，返回创建结果', () => {
    const result = createMatch(INPUT)
    // 编排层把 create 路由进 db.transaction
    expect(m.mockCreate).toHaveBeenCalledTimes(1)
    expect(m.mockCreate).toHaveBeenCalledWith(INPUT)
    // 事务已提交、未回滚
    expect(m.state.committed).toBe(1)
    expect(m.state.rolledBack).toBe(0)
    expect(m.state.open).toBe(0)
    expect(result).toEqual(MADE)
  })

  it('失败：repo.create 抛错 → 事务回滚，错误向上传播（一次用户动作不半提交）', () => {
    const boom = new Error('[matchRepo] createMatch: not found')
    m.mockCreate.mockImplementation(() => {
      throw boom
    })
    expect(() => createMatch(INPUT)).toThrow(boom)
    // 事务标记回滚、未提交；异常未被编排层吞掉
    expect(m.state.rolledBack).toBe(1)
    expect(m.state.committed).toBe(0)
    expect(m.state.open).toBe(0)
  })
})