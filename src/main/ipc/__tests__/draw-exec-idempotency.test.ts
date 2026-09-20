// ============================================================
// draw-exec-idempotency.test.ts — P5-024 DRAW_EXECUTE 幂等回归
// （真实 IPC handler + 指纹 TTL 缓存）
//
// 覆盖：
//   1. 同 params 3s 内重复 DRAW_EXECUTE → drawTopics 仅执行一次、
//      两次返回同一结果（同 session）→ 不产生第二 session/undo
//   2. 不同 params 两次 → 两次均真正执行（串行 ≠ 拒绝）
//   3. TTL 过期后同 params → 重新执行
//   4. 删除会话后缓存失效 → 同 params 可重新抽取
//   5. 失败响应不缓存（修正参数后立即重试可达）
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  handleCalls: new Map<string, unknown>(),
  drawTopics: vi.fn(),
  withUndoLog: vi.fn(),
  deleteSession: vi.fn(),
  assertSessionNotConfirmed: vi.fn(),
  addLog: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      h.handleCalls.set(channel, handler)
    })
  }
}))

vi.mock('../../services/draw-engine', () => ({
  drawTopics: h.drawTopics
}))
vi.mock('../../services/undo-service', () => ({
  withUndoLog: h.withUndoLog,
  logEventCreateSnapshot: vi.fn()
}))
vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: {
    deleteSession: h.deleteSession,
    assertSessionNotConfirmed: h.assertSessionNotConfirmed,
    listSessions: vi.fn(() => []),
    getSessionById: vi.fn(),
    listDrawnTopicIdsByEvent: vi.fn(() => []),
    getItemByTopicId: vi.fn(),
    clearAllSessions: vi.fn()
  }
}))
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: { addLog: h.addLog }
}))

import { registerDrawIpc } from '../draw.ipc'
import { IPC_CHANNELS } from '../../../shared/types'

function handler(channel: string): (e: unknown, args: unknown) => unknown {
  const fn = h.handleCalls.get(channel) as (e: unknown, args: unknown) => unknown
  expect(fn, `${channel} handler 未注册`).toBeTruthy()
  return fn
}

const PARAMS_A = { event_id: 'e1', round_id: 'r1', topic_count: 3, teams: [] }
const PARAMS_B = { event_id: 'e1', round_id: 'r2', topic_count: 3, teams: [] }

beforeEach(async () => {
  h.handleCalls.clear()
  h.drawTopics.mockReset()
  h.withUndoLog.mockReset()
  h.deleteSession.mockReset()
  h.assertSessionNotConfirmed.mockReset()
  h.addLog.mockReset()
  // withUndoLog 直通：执行 execute 并模拟返回 { result, logId }（wrapWithUndo 消费形状）
  h.withUndoLog.mockImplementation((opts: { execute: () => unknown }) => ({
    result: opts.execute(),
    logId: 'ulog-1'
  }))
  h.drawTopics.mockImplementation((p: { topic_count: number }) => ({
    sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`,
    params: p,
    items: []
  }))
  registerDrawIpc()
  // 经 DELETE handler 失效模块级幂等缓存（lastDrawExec 跨用例残留会串结果）
  const del = h.handleCalls.get(IPC_CHANNELS.DRAW_DELETE_SESSION) as (
    e: unknown,
    id: string
  ) => Promise<unknown>
  await del(null, '__cache-reset__')
  h.deleteSession.mockClear()
})

describe('P5-024 DRAW_EXECUTE 幂等', () => {
  it('同 params 重复执行 → drawTopics 仅 1 次、withUndoLog 仅 1 次、结果相同（单 session）', () => {
    const execute = handler(IPC_CHANNELS.DRAW_EXECUTE)
    const r1 = execute(null, PARAMS_A)
    const r2 = execute(null, PARAMS_A)

    expect(h.drawTopics).toHaveBeenCalledTimes(1)
    expect(h.withUndoLog).toHaveBeenCalledTimes(1) // undo 记录不重复
    expect((r1 as { data: { sessionId: string } }).data.sessionId).toBe(
      (r2 as { data: { sessionId: string } }).data.sessionId
    )
    expect((r2 as { success: boolean }).success).toBe(true)
  })

  it('不同 params 两次 → 两次均真正执行（合法抽取不受影响）', () => {
    const execute = handler(IPC_CHANNELS.DRAW_EXECUTE)
    const r1 = execute(null, PARAMS_A)
    const r2 = execute(null, PARAMS_B)

    expect(h.drawTopics).toHaveBeenCalledTimes(2)
    expect(h.withUndoLog).toHaveBeenCalledTimes(2)
    expect(
      (r1 as { data: { sessionId: string } }).data.sessionId
    ).not.toBe((r2 as { data: { sessionId: string } }).data.sessionId)
  })

  it('TTL 过期后同 params → 重新执行', () => {
    vi.useFakeTimers()
    try {
      const now = new Date('2026-01-01T00:00:00Z').getTime()
      vi.setSystemTime(now)
      const execute = handler(IPC_CHANNELS.DRAW_EXECUTE)
      execute(null, PARAMS_A)
      // 推进 4s（> TTL 3s）
      vi.setSystemTime(now + 4000)
      execute(null, PARAMS_A)
      expect(h.drawTopics).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('删除会话后缓存失效 → 同 params 可重新抽取', async () => {
    const execute = handler(IPC_CHANNELS.DRAW_EXECUTE)
    execute(null, PARAMS_A)
    expect(h.drawTopics).toHaveBeenCalledTimes(1)

    const del = handler(IPC_CHANNELS.DRAW_DELETE_SESSION) as (
      e: unknown,
      id: string
    ) => Promise<{ success: boolean }>
    await del(null, 'sess-old')
    expect(h.deleteSession).toHaveBeenCalledWith('sess-old')

    execute(null, PARAMS_A)
    expect(h.drawTopics).toHaveBeenCalledTimes(2) // 缓存已失效，重新执行
  })

  it('失败响应不缓存：首次失败后立即重试会真正执行', () => {
    h.drawTopics.mockImplementationOnce(() => {
      throw new Error('题数不足')
    })
    const execute = handler(IPC_CHANNELS.DRAW_EXECUTE)
    const r1 = execute(null, PARAMS_A) as { success: boolean }
    expect(r1.success).toBe(false)

    const r2 = execute(null, PARAMS_A) as { success: boolean }
    expect(r2.success).toBe(true) // 重试真正执行（未命中失败缓存）
    expect(h.drawTopics).toHaveBeenCalledTimes(2)
  })
})
