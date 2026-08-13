// ============================================================
// list-events.tool.test.ts — list_events 工具入参校验测试
//
// 覆盖 list-events.tool.ts 的入参校验与参数透传：
//   - 无 status → filter 为空对象
//   - status 非空 → trim 后透传 filter.status
//   - status 空串 / 空白 → 不写入 filter
//   - 正常调用 → 返回 { items, total } 原样透传
//   - repo 抛错 → 工具抛错
//
// Mock 策略：mock eventRepo.listEvents，隔离工具层校验与透传逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Event } from '@main/db/repository/event.repo'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockListEvents } = vi.hoisted(() => ({
  mockListEvents: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/db/repository/event.repo', () => ({
  eventRepo: {
    listEvents: mockListEvents
  }
}))

// 导入被测模块（在 mock 之后）
import { listEventsTool as _listEventsTool } from '../list-events.tool'

// ToolDefinition.execute 默认返回 Promise<unknown>，测试中需断言为具体返回类型
interface EventListResult {
  items: Array<{ id: string; name: string; status: string }>
  total: number
}
interface EventListTool {
  name: string
  riskLevel: string
  parameters: { properties: Record<string, unknown>; required?: string[] }
  execute: (args: Record<string, unknown>) => Promise<EventListResult>
}
const listEventsTool = _listEventsTool as unknown as EventListTool

// ============================================================
// Mock 数据
// ============================================================

/** 构造一条 Event */
function makeEvent(id: string, name: string, status: string | null = null): Event {
  return {
    id,
    name,
    start_date: null,
    end_date: null,
    status,
    created_at: '2026-01-01T00:00:00.000Z',
    allow_repeat: 0
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockListEvents.mockReturnValue({ items: [], total: 0 })
})

describe('list_events：status 校验与透传', () => {
  it('无 status → listEvents 收到空 filter', async () => {
    await listEventsTool.execute({})

    expect(mockListEvents).toHaveBeenCalledWith({})
  })

  it('status 非空 → trim 后透传 filter.status', async () => {
    await listEventsTool.execute({ status: '  筹备中  ' })

    expect(mockListEvents).toHaveBeenCalledWith({ status: '筹备中' })
  })

  it('status=空串 → filter 不含 status', async () => {
    await listEventsTool.execute({ status: '' })

    const filter = mockListEvents.mock.calls[0][0]
    expect(filter).not.toHaveProperty('status')
  })

  it('status=纯空白 → filter 不含 status', async () => {
    await listEventsTool.execute({ status: '   ' })

    const filter = mockListEvents.mock.calls[0][0]
    expect(filter).not.toHaveProperty('status')
  })
})

describe('list_events：正常调用', () => {
  it('返回 { items, total } 原样透传', async () => {
    const e1 = makeEvent('e1', '春季赛', '筹备中')
    const e2 = makeEvent('e2', '秋季赛', '已结束')
    mockListEvents.mockReturnValue({ items: [e1, e2], total: 2 })

    const result = await listEventsTool.execute({ status: '筹备中' })

    expect(result).toEqual({ items: [e1, e2], total: 2 })
    expect(result.items).toHaveLength(2)
    expect(result.total).toBe(2)
  })

  it('无赛事 → 返回空 items 与 total=0', async () => {
    mockListEvents.mockReturnValue({ items: [], total: 0 })

    const result = await listEventsTool.execute({})

    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
  })
})

describe('list_events：repo 错误透传', () => {
  it('listEvents 抛错 → 工具抛出同一错误', async () => {
    mockListEvents.mockImplementation(() => {
      throw new Error('DB 查询失败')
    })

    await expect(
      listEventsTool.execute({ status: '进行中' })
    ).rejects.toThrow(/DB 查询失败/)
  })
})

describe('list_events：工具元数据', () => {
  it('name 应为 list_events', () => {
    expect(listEventsTool.name).toBe('list_events')
  })

  it('riskLevel 应为 low', () => {
    expect(listEventsTool.riskLevel).toBe('low')
  })

  it('parameters 无必填字段', () => {
    expect(listEventsTool.parameters.required ?? []).toEqual([])
  })
})
