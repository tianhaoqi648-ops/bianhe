// ============================================================
// draw-topics.tool.test.ts — draw_topics 工具入参校验测试
//
// 覆盖 draw-topics.tool.ts 的入参校验与参数透传：
//   - count 缺失 / 非整数 / < 1 / > 50 / NaN → 抛错
//   - eventId 缺失 / 空串 / 空白 → 抛错（引导 LLM 调用 list_events/create_event）
//   - 正常抽取 → 返回 DrawResult，drawTopics 透传正确 DrawParams
//   - avoidRepeat=false → allow_repeat=true
//   - draw-engine 抛错 → 工具抛错
//
// Mock 策略：mock @main/services/draw-engine 的 drawTopics，隔离工具层校验逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DrawResult } from '@shared/types'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockDrawTopics } = vi.hoisted(() => ({
  mockDrawTopics: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/services/draw-engine', () => ({
  drawTopics: mockDrawTopics
}))

// 导入被测模块（在 mock 之后）
import { drawTopicsTool } from '../draw-topics.tool'

// ============================================================
// Mock 数据
// ============================================================

/** 构造 DrawResult */
function makeDrawResult(): DrawResult {
  return {
    session: {
      id: 'session-1',
      event_id: 'event-1',
      round_id: null,
      draw_time: '2026-01-01T00:00:00.000Z',
      operator: null,
      settings: null,
      items: []
    },
    topics: [
      {
        id: 't1',
        title: '题A',
        type: null,
        domain: null,
        difficulty: null,
        source: null,
        source_type: null,
        tags: null,
        weight: 1.0,
        status: 'active',
        batch_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    ]
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockDrawTopics.mockReturnValue(makeDrawResult())
})

describe('draw_topics：count 校验', () => {
  it('count 缺失 → 抛错', async () => {
    await expect(
      drawTopicsTool.execute({ eventId: 'event-1' } as never)
    ).rejects.toThrow(/count 必须为 1-50 之间的整数/)
  })

  it('count=0 → 抛错', async () => {
    await expect(
      drawTopicsTool.execute({ eventId: 'event-1', count: 0 })
    ).rejects.toThrow(/count 必须为 1-50 之间的整数/)
  })

  it('count=51 → 抛错', async () => {
    await expect(
      drawTopicsTool.execute({ eventId: 'event-1', count: 51 })
    ).rejects.toThrow(/count 必须为 1-50 之间的整数/)
  })

  it('count 小数 → 抛错', async () => {
    await expect(
      drawTopicsTool.execute({ eventId: 'event-1', count: 2.5 })
    ).rejects.toThrow(/count 必须为 1-50 之间的整数/)
  })

  it('count=NaN → 抛错', async () => {
    await expect(
      drawTopicsTool.execute({ eventId: 'event-1', count: NaN })
    ).rejects.toThrow(/count 必须为 1-50 之间的整数/)
  })

  it('count 非数字 → 抛错', async () => {
    await expect(
      drawTopicsTool.execute({ eventId: 'event-1', count: 'abc' as never })
    ).rejects.toThrow(/count 必须为 1-50 之间的整数/)
  })

  it('count=1 与 count=50 合法（边界）', async () => {
    await drawTopicsTool.execute({ eventId: 'event-1', count: 1 })
    expect(mockDrawTopics).toHaveBeenCalledTimes(1)

    await drawTopicsTool.execute({ eventId: 'event-1', count: 50 })
    expect(mockDrawTopics).toHaveBeenCalledTimes(2)
  })
})

describe('draw_topics：eventId 校验', () => {
  it('eventId 缺失 → 抛错并提示调用 list_events/create_event', async () => {
    await expect(
      drawTopicsTool.execute({ count: 5 })
    ).rejects.toThrow(/缺少 eventId/)
  })

  it('eventId=空串 → 抛错', async () => {
    await expect(
      drawTopicsTool.execute({ count: 5, eventId: '' })
    ).rejects.toThrow(/缺少 eventId/)
  })

  it('eventId=纯空白 → 抛错', async () => {
    await expect(
      drawTopicsTool.execute({ count: 5, eventId: '   ' })
    ).rejects.toThrow(/缺少 eventId/)

    // 不应调用 draw-engine
    expect(mockDrawTopics).not.toHaveBeenCalled()
  })
})

describe('draw_topics：正常抽取', () => {
  it('合法入参 → 返回 DrawResult，透传 DrawParams（include_stance=false, allow_repeat=false）', async () => {
    const result = await drawTopicsTool.execute({
      eventId: 'event-1',
      count: 5
    })

    expect(result).toHaveProperty('session')
    expect(result).toHaveProperty('topics')
    expect(mockDrawTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'event-1',
        topic_count: 5,
        include_stance: false,
        allow_repeat: false
      })
    )
  })

  it('avoidRepeat 缺省 → allow_repeat=false', async () => {
    await drawTopicsTool.execute({ eventId: 'event-1', count: 3 })

    const params = mockDrawTopics.mock.calls[0][0]
    expect(params.allow_repeat).toBe(false)
  })

  it('avoidRepeat=false → allow_repeat=true', async () => {
    await drawTopicsTool.execute({
      eventId: 'event-1',
      count: 3,
      avoidRepeat: false
    })

    const params = mockDrawTopics.mock.calls[0][0]
    expect(params.allow_repeat).toBe(true)
  })

  it('avoidRepeat=true → allow_repeat=false', async () => {
    await drawTopicsTool.execute({
      eventId: 'event-1',
      count: 3,
      avoidRepeat: true
    })

    const params = mockDrawTopics.mock.calls[0][0]
    expect(params.allow_repeat).toBe(false)
  })

  it('filter 透传给 DrawParams.filters', async () => {
    const filter = { type: '价值', domain: '教育' }
    await drawTopicsTool.execute({
      eventId: 'event-1',
      count: 2,
      filter
    })

    const params = mockDrawTopics.mock.calls[0][0]
    expect(params.filters).toBe(filter)
  })
})

describe('draw_topics：draw-engine 错误透传', () => {
  it('drawTopics 抛错 → 工具抛出同一错误', async () => {
    mockDrawTopics.mockImplementation(() => {
      throw new Error('题库题量不足')
    })

    await expect(
      drawTopicsTool.execute({ eventId: 'event-1', count: 5 })
    ).rejects.toThrow(/题库题量不足/)
  })
})

describe('draw_topics：工具元数据', () => {
  it('name 应为 draw_topics', () => {
    expect(drawTopicsTool.name).toBe('draw_topics')
  })

  it('riskLevel 应为 medium', () => {
    expect(drawTopicsTool.riskLevel).toBe('medium')
  })

  it('parameters required 应含 count', () => {
    expect(drawTopicsTool.parameters.required).toContain('count')
  })
})
