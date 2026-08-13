// ============================================================
// search-topics.tool.test.ts — search_topics 工具入参校验测试
//
// 覆盖 search-topics.tool.ts 的入参校验与参数透传：
//   - limit 非数字 / < 1 / NaN → 抛错
//   - limit 硬上限 50（透传 pageSize 被 Math.min 截断）
//   - 空字符串字段不写入 filter（避免误触发筛选）
//   - tags 过滤非字符串与空串
//   - 正常调用 → 返回 items
//   - repo 抛错 → 工具抛错
//
// Mock 策略：mock topicRepo.listTopics，隔离工具层校验与透传逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Topic } from '@shared/types'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockListTopics } = vi.hoisted(() => ({
  mockListTopics: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/db/repository/topic.repo', () => ({
  topicRepo: {
    listTopics: mockListTopics
  }
}))

// 导入被测模块（在 mock 之后）
import { searchTopicsTool } from '../search-topics.tool'

// ============================================================
// Mock 数据
// ============================================================

/** 构造一条 Topic */
function makeTopic(id: string, title: string): Topic {
  return {
    id,
    title,
    type: '价值',
    domain: '教育',
    difficulty: '进阶级',
    source: '测试',
    source_type: '自定义',
    tags: ['经典'],
    weight: 1.0,
    status: 'active',
    batch_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockListTopics.mockReturnValue({ items: [], total: 0 })
})

describe('search_topics：limit 校验', () => {
  it('limit 缺失 → 默认 20 透传 pageSize', async () => {
    await searchTopicsTool.execute({})

    expect(mockListTopics).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 20 })
    )
  })

  it('limit 非数字 → 抛错', async () => {
    await expect(
      searchTopicsTool.execute({ limit: 'abc' as never })
    ).rejects.toThrow(/limit 必须为数字/)
  })

  it('limit=NaN → 抛错', async () => {
    await expect(
      searchTopicsTool.execute({ limit: NaN })
    ).rejects.toThrow(/limit 必须为数字/)
  })

  it('limit < 1 → 抛错', async () => {
    await expect(
      searchTopicsTool.execute({ limit: 0 })
    ).rejects.toThrow(/limit 必须 ≥ 1/)

    await expect(
      searchTopicsTool.execute({ limit: -3 })
    ).rejects.toThrow(/limit 必须 ≥ 1/)
  })

  it('limit > 50 → 硬上限截断为 50', async () => {
    await searchTopicsTool.execute({ limit: 100 })

    expect(mockListTopics).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 50 })
    )
  })

  it('limit=50 合法 → pageSize=50', async () => {
    await searchTopicsTool.execute({ limit: 50 })

    expect(mockListTopics).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 50 })
    )
  })
})

describe('search_topics：空字符串字段不写入 filter', () => {
  it('keyword 为空字符串 → filter 不含 keyword', async () => {
    await searchTopicsTool.execute({ keyword: '' })

    const filter = mockListTopics.mock.calls[0][0]
    expect(filter).not.toHaveProperty('keyword')
  })

  it('keyword 为空白 → filter 不含 keyword', async () => {
    await searchTopicsTool.execute({ keyword: '   ' })

    const filter = mockListTopics.mock.calls[0][0]
    expect(filter).not.toHaveProperty('keyword')
  })

  it('type/domain/difficulty 为空字符串 → 不写入 filter', async () => {
    await searchTopicsTool.execute({
      type: '',
      domain: '  ',
      difficulty: ''
    })

    const filter = mockListTopics.mock.calls[0][0]
    expect(filter).not.toHaveProperty('type')
    expect(filter).not.toHaveProperty('domain')
    expect(filter).not.toHaveProperty('difficulty')
  })

  it('tags 为空数组 → filter 不含 tags', async () => {
    await searchTopicsTool.execute({ tags: [] })

    const filter = mockListTopics.mock.calls[0][0]
    expect(filter).not.toHaveProperty('tags')
  })

  it('tags 含空串与非字符串 → 过滤后仅保留有效项', async () => {
    await searchTopicsTool.execute({
      tags: ['经典', '', '  ', 123 as unknown as string, '哲学']
    })

    const filter = mockListTopics.mock.calls[0][0]
    expect(filter.tags).toEqual(['经典', '哲学'])
  })
})

describe('search_topics：正常调用', () => {
  it('keyword + tags 筛选 → 返回 items（trim 后透传）', async () => {
    const t1 = makeTopic('t1', '题A')
    const t2 = makeTopic('t2', '题B')
    mockListTopics.mockReturnValue({ items: [t1, t2], total: 2 })

    const result = await searchTopicsTool.execute({
      keyword: '  教育  ',
      tags: ['  经典  '],
      limit: 10
    })

    expect(result).toEqual([t1, t2])
    expect(mockListTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: '教育',
        tags: ['经典'],
        pageSize: 10
      })
    )
  })

  it('type/domain/difficulty 非空 → trim 后透传', async () => {
    await searchTopicsTool.execute({
      type: '  事实  ',
      domain: '科技',
      difficulty: '入门级'
    })

    const filter = mockListTopics.mock.calls[0][0]
    expect(filter.type).toBe('事实')
    expect(filter.domain).toBe('科技')
    expect(filter.difficulty).toBe('入门级')
  })

  it('无任何筛选 → 仅含 pageSize', async () => {
    await searchTopicsTool.execute({})

    const filter = mockListTopics.mock.calls[0][0]
    expect(filter).toEqual({ pageSize: 20 })
  })
})

describe('search_topics：repo 错误透传', () => {
  it('listTopics 抛错 → 工具抛出同一错误', async () => {
    mockListTopics.mockImplementation(() => {
      throw new Error('DB 连接失败')
    })

    await expect(
      searchTopicsTool.execute({ keyword: 'test' })
    ).rejects.toThrow(/DB 连接失败/)
  })
})

describe('search_topics：工具元数据', () => {
  it('name 应为 search_topics', () => {
    expect(searchTopicsTool.name).toBe('search_topics')
  })

  it('riskLevel 应为 low', () => {
    expect(searchTopicsTool.riskLevel).toBe('low')
  })

  it('parameters 无必填字段', () => {
    expect(searchTopicsTool.parameters.required ?? []).toEqual([])
  })
})
