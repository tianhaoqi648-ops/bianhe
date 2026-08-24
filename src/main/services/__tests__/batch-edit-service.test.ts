// ============================================================
// batch-edit-service.test.ts — 批量编辑撤销编排服务单元测试
//
// Governance Task 6：撤销的跨库编排由 batch-edit-history.repo.revertHistory
// 上移到 services/batch-edit-service.ts。本测试验证编排行为：
//   1. 逐条恢复 topic 字段（含 custom_data 合并）+ 标记历史已撤销
//   2. topic 已删除的项跳过，不计入 restoredCount
//   3. 已撤销的历史不可再次撤销
// 依赖隔离：编排在 Service 层（topicRepo + batchEditHistoryRepo 在此被调用），
//           Repository 各自保持单库，不再互相 import。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- mock getDb：transaction 直接执行包装（不真正落库）----
vi.mock('../../db', () => {
  const transaction = (fn: () => unknown) => () => fn()
  return { getDb: () => ({ transaction }) }
})

// ---- 隔离两个 Repository：本测试关注 Service 编排，不真正读写 DB ----
vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: { getTopicById: vi.fn(), updateTopic: vi.fn() }
}))
vi.mock('../../db/repository/batch-edit-history.repo', () => ({
  batchEditHistoryRepo: {
    getHistoryById: vi.fn(),
    listItemsByHistory: vi.fn(),
    markReverted: vi.fn()
  }
}))

import { revertBatchEditHistory } from '../batch-edit-service'
import { topicRepo } from '../../db/repository/topic.repo'
import { batchEditHistoryRepo } from '../../db/repository/batch-edit-history.repo'

describe('revertBatchEditHistory（上移后的跨库编排）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('逐条恢复 topic 字段（含 custom_data 合并）并标记历史已撤销', () => {
    const historyId = 'h-1'
    vi.mocked(batchEditHistoryRepo.getHistoryById).mockReturnValue({
      id: historyId,
      executed_at: '2026-08-01T00:00:00.000Z',
      topic_count: 2,
      field_count: 1,
      summary: '批量编辑',
      reverted: false,
      reverted_at: null
    } as never)
    vi.mocked(batchEditHistoryRepo.listItemsByHistory).mockReturnValue([
      {
        id: 'i-1',
        history_id: historyId,
        topic_id: 't1',
        before_values: { title: '原始标题', 'custom_data.tag': 'A' },
        after_values: null
      },
      {
        id: 'i-2',
        history_id: historyId,
        topic_id: 't2',
        before_values: { difficulty: 'hard' },
        after_values: null
      }
    ] as never)
    vi.mocked(topicRepo.getTopicById).mockImplementation((id) =>
      id === 't1'
        ? ({ id: 't1', title: '当前标题', custom_data: { keep: 'x' } } as never)
        : ({ id: 't2', title: 't2标题', custom_data: null } as never)
    )
    vi.mocked(topicRepo.updateTopic).mockReturnValue(undefined)

    const restored = revertBatchEditHistory(historyId)

    expect(restored).toBe(2)
    expect(topicRepo.updateTopic).toHaveBeenCalledTimes(2)
    // t1：恢复 title，且 custom_data 只合并快照内的 tag，保留当前 keep 字段
    expect(topicRepo.updateTopic).toHaveBeenCalledWith('t1', {
      title: '原始标题',
      custom_data: { keep: 'x', tag: 'A' }
    })
    expect(topicRepo.updateTopic).toHaveBeenCalledWith('t2', { difficulty: 'hard' })
    expect(batchEditHistoryRepo.markReverted).toHaveBeenCalledWith(historyId)
  })

  it('topic 已删除的项跳过，不计入 restoredCount', () => {
    const historyId = 'h-2'
    vi.mocked(batchEditHistoryRepo.getHistoryById).mockReturnValue({
      id: historyId,
      executed_at: '',
      topic_count: 2,
      field_count: 1,
      summary: null,
      reverted: false,
      reverted_at: null
    } as never)
    vi.mocked(batchEditHistoryRepo.listItemsByHistory).mockReturnValue([
      {
        id: 'i-1',
        history_id: historyId,
        topic_id: 'gone',
        before_values: { title: 'x' },
        after_values: null
      },
      {
        id: 'i-2',
        history_id: historyId,
        topic_id: 't2',
        before_values: { title: 'y' },
        after_values: null
      }
    ] as never)
    vi.mocked(topicRepo.getTopicById).mockImplementation((id) =>
      id === 'gone' ? undefined : ({ id: 't2', title: 'y', custom_data: null } as never)
    )
    vi.mocked(topicRepo.updateTopic).mockReturnValue(undefined)

    const restored = revertBatchEditHistory(historyId)

    expect(restored).toBe(1)
    expect(topicRepo.updateTopic).toHaveBeenCalledTimes(1)
    expect(topicRepo.updateTopic).toHaveBeenCalledWith('t2', { title: 'y' })
    expect(batchEditHistoryRepo.markReverted).toHaveBeenCalledWith(historyId)
  })

  it('已撤销的历史不可再次撤销（抛错，不调用 markReverted）', () => {
    const historyId = 'h-3'
    vi.mocked(batchEditHistoryRepo.getHistoryById).mockReturnValue({
      id: historyId,
      reverted: true
    } as never)

    expect(() => revertBatchEditHistory(historyId)).toThrow(/already reverted/)
    expect(batchEditHistoryRepo.markReverted).not.toHaveBeenCalled()
  })

  it('历史不存在时抛错', () => {
    vi.mocked(batchEditHistoryRepo.getHistoryById).mockReturnValue(undefined)
    expect(() => revertBatchEditHistory('nope')).toThrow(/history not found/)
  })
})