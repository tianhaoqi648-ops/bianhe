// ============================================================
// create-event.tool.test.ts — create_event 工具入参校验测试
//
// 覆盖 create-event.tool.ts 的入参校验与参数透传：
//   - name 缺失 / 空串 / 空白 → 抛错
//   - teamCount 越界（< 2 / > 64 / 小数 / NaN）→ 抛错
//   - teamCount 边界（2 / 64）合法
//   - 正常创建 → createEvent 透传 name + null（format/teamCount 不传给 repo）
//   - repo 抛错 → 工具抛错
//
// Mock 策略：mock eventRepo.createEvent，隔离工具层校验逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Event } from '@main/db/repository/event.repo'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockCreateEvent } = vi.hoisted(() => ({
  mockCreateEvent: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/db/repository/event.repo', () => ({
  eventRepo: {
    createEvent: mockCreateEvent
  }
}))

// 导入被测模块（在 mock 之后）
import { createEventTool } from '../create-event.tool'

// ============================================================
// Mock 数据
// ============================================================

/** 构造一条已创建的 Event */
function makeCreatedEvent(name: string): Event {
  return {
    id: 'event-xyz',
    name,
    start_date: null,
    end_date: null,
    status: null,
    created_at: '2026-01-01T00:00:00.000Z',
    allow_repeat: 0
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateEvent.mockImplementation((input: { name: string }) =>
    makeCreatedEvent(input.name)
  )
})

describe('create_event：name 校验', () => {
  it('name 缺失 → 抛错', async () => {
    await expect(
      createEventTool.execute({} as never)
    ).rejects.toThrow(/\[create_event\] name 不能为空/)
  })

  it('name=空串 → 抛错', async () => {
    await expect(
      createEventTool.execute({ name: '' })
    ).rejects.toThrow(/\[create_event\] name 不能为空/)
  })

  it('name=纯空白 → 抛错且不调用 repo', async () => {
    await expect(
      createEventTool.execute({ name: '   ' })
    ).rejects.toThrow(/\[create_event\] name 不能为空/)
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })
})

describe('create_event：teamCount 校验', () => {
  it('teamCount=1 → 抛错', async () => {
    await expect(
      createEventTool.execute({ name: '测试赛', teamCount: 1 })
    ).rejects.toThrow(/\[create_event\] teamCount 必须为 2-64 之间的整数/)
  })

  it('teamCount=65 → 抛错', async () => {
    await expect(
      createEventTool.execute({ name: '测试赛', teamCount: 65 })
    ).rejects.toThrow(/\[create_event\] teamCount 必须为 2-64 之间的整数/)
  })

  it('teamCount 越界小数（1.5 / 64.5）→ 抛错', async () => {
    await expect(
      createEventTool.execute({ name: '测试赛', teamCount: 1.5 })
    ).rejects.toThrow(/\[create_event\] teamCount 必须为 2-64 之间的整数/)

    await expect(
      createEventTool.execute({ name: '测试赛', teamCount: 64.5 })
    ).rejects.toThrow(/\[create_event\] teamCount 必须为 2-64 之间的整数/)
  })

  it('teamCount 范围内小数（2.5）不抛错（工具仅校验范围，未强制整数）', async () => {
    await createEventTool.execute({ name: '测试赛', teamCount: 2.5 })

    expect(mockCreateEvent).toHaveBeenCalledTimes(1)
  })

  it('teamCount=NaN → 抛错', async () => {
    await expect(
      createEventTool.execute({ name: '测试赛', teamCount: NaN })
    ).rejects.toThrow(/\[create_event\] teamCount 必须为 2-64 之间的整数/)
  })

  it('teamCount 边界 2 与 64 合法', async () => {
    await createEventTool.execute({ name: '赛A', teamCount: 2 })
    expect(mockCreateEvent).toHaveBeenCalledTimes(1)

    await createEventTool.execute({ name: '赛B', teamCount: 64 })
    expect(mockCreateEvent).toHaveBeenCalledTimes(2)
  })

  it('teamCount=null 不触发校验（视同未传）', async () => {
    await createEventTool.execute({ name: '赛C', teamCount: null })

    expect(mockCreateEvent).toHaveBeenCalledTimes(1)
  })
})

describe('create_event：正常创建', () => {
  it('name trim 后透传，createEvent 收到 null 日期/状态', async () => {
    const created = makeCreatedEvent('春季赛')
    mockCreateEvent.mockReturnValue(created)

    const result = await createEventTool.execute({ name: '  春季赛  ' })

    expect(result).toEqual(created)
    expect(mockCreateEvent).toHaveBeenCalledWith({
      name: '春季赛',
      start_date: null,
      end_date: null,
      status: null
    })
  })

  it('format 与 teamCount 不传给 repo（语义化输入）', async () => {
    await createEventTool.execute({
      name: '春季赛',
      format: '英式辩论',
      teamCount: 8
    })

    const input = mockCreateEvent.mock.calls[0][0]
    expect(input).not.toHaveProperty('format')
    expect(input).not.toHaveProperty('teamCount')
    // 仅含 name + 三个 null
    expect(Object.keys(input).sort()).toEqual(
      ['end_date', 'name', 'start_date', 'status'].sort()
    )
  })

  it('仅 name → createEvent 收到全 null 的其余字段', async () => {
    await createEventTool.execute({ name: '最简赛事' })

    expect(mockCreateEvent).toHaveBeenCalledWith({
      name: '最简赛事',
      start_date: null,
      end_date: null,
      status: null
    })
  })
})

describe('create_event：repo 错误透传', () => {
  it('createEvent 抛错 → 工具抛出同一错误', async () => {
    mockCreateEvent.mockImplementation(() => {
      throw new Error('赛事名重复')
    })

    await expect(
      createEventTool.execute({ name: '重名赛事' })
    ).rejects.toThrow(/赛事名重复/)
  })
})

describe('create_event：工具元数据', () => {
  it('name 应为 create_event', () => {
    expect(createEventTool.name).toBe('create_event')
  })

  it('riskLevel 应为 high', () => {
    expect(createEventTool.riskLevel).toBe('high')
  })

  it('parameters required 应含 name', () => {
    expect(createEventTool.parameters.required).toContain('name')
  })
})
