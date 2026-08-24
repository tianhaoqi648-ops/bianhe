// ============================================================
// event-service.test.ts — createEvent 跨库编排测试（Governance-6）
//
// 行为基线：创建赛事 + 自动绑定默认题库（同一事务）。
// 该编排原在 event.repo.createEvent 内部，Governance-6 上移到
// services/event-service.ts。此处验证编排逻辑（依赖隔离：mock 两个 repo）。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.hoisted：mock 函数提升
const m = vi.hoisted(() => ({
  mockCreateEvent: vi.fn(),
  mockGetDefault: vi.fn(),
  mockBindEventGroups: vi.fn()
}))

vi.mock('../../db/repository/event.repo', () => ({
  eventRepo: { createEvent: m.mockCreateEvent }
}))

vi.mock('../../db/repository/topic-group.repo', () => ({
  topicGroupRepo: {
    getDefault: m.mockGetDefault,
    bindEventGroups: m.mockBindEventGroups
  }
}))

vi.mock('../../db/index', () => {
  const transaction = (fn: () => unknown) => () => fn()
  return {
    getDb: () => ({ transaction })
  }
})

import { createEvent } from '../event-service'

const MADE_EVENT = {
  id: 'event-xyz',
  name: '测试赛',
  start_date: null,
  end_date: null,
  status: null,
  created_at: '2026-08-01T00:00:00.000Z',
  allow_repeat: 0
}

beforeEach(() => {
  vi.clearAllMocks()
  m.mockCreateEvent.mockReturnValue({ ...MADE_EVENT })
  m.mockGetDefault.mockReturnValue({ id: 'default-group', name: '默认题库', isDefault: true })
  m.mockBindEventGroups.mockReturnValue(1)
})

describe('createEvent：创建赛事并自动绑定默认题库', () => {
  it('先写 events，再 getDefault + bindEventGroups 绑定新赛事', () => {
    const created = createEvent({ name: '测试赛', start_date: null, end_date: null, status: null })

    // repo.createEvent 被调用一次
    expect(m.mockCreateEvent).toHaveBeenCalledTimes(1)
    // getDefault 幂等取默认题库
    expect(m.mockGetDefault).toHaveBeenCalledTimes(1)
    // 用创建出的赛事 id 绑定默认题库
    expect(m.mockBindEventGroups).toHaveBeenCalledWith('event-xyz', ['default-group'])
    // 返回创建的赛事
    expect(created).toMatchObject({ id: 'event-xyz', name: '测试赛' })
  })

  it('getDefault 抛错时向上抛出（事务回滚，不产生半态赛事）', () => {
    m.mockGetDefault.mockImplementation(() => {
      throw new Error('默认题库不可用')
    })

    expect(() =>
      createEvent({ name: '测试赛', start_date: null, end_date: null, status: null })
    ).toThrow(/默认题库不可用/)
  })
})