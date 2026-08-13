// ============================================================
// get-topic-detail.tool.test.ts — get_topic_detail 工具入参校验测试
//
// 覆盖 get-topic-detail.tool.ts 的入参校验与查询逻辑：
//   - topicId 缺失 / null / 空串 / 空白 → 抛错
//   - topicId 被 trim 后透传
//   - 辩题不存在（repo 返回 undefined）→ 抛错
//   - 正常查询 → 返回 Topic
//   - repo 抛错 → 工具抛错
//
// Mock 策略：mock topicRepo.getTopicById，隔离工具层校验逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Topic } from '@shared/types'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockGetTopicById } = vi.hoisted(() => ({
  mockGetTopicById: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/db/repository/topic.repo', () => ({
  topicRepo: {
    getTopicById: mockGetTopicById
  }
}))

// 导入被测模块（在 mock 之后）
import { getTopicDetailTool } from '../get-topic-detail.tool'

// ============================================================
// Mock 数据
// ============================================================

/** 构造一条 Topic（含 custom_data，验证"详情含自定义字段"语义） */
function makeTopic(id: string): Topic {
  return {
    id,
    title: '大学生是否应该兼职',
    type: '价值',
    domain: '教育',
    difficulty: '进阶级',
    source: '测试',
    source_type: '自定义',
    tags: ['经典', '校园'],
    weight: 1.5,
    status: 'active',
    batch_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    custom_data: { source_year: '2026' }
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
})

describe('get_topic_detail：topicId 校验', () => {
  it('topicId 缺失 → 抛错', async () => {
    await expect(
      getTopicDetailTool.execute({} as never)
    ).rejects.toThrow(/topicId 不能为空/)
  })

  it('topicId=null → 抛错', async () => {
    await expect(
      getTopicDetailTool.execute({ topicId: null as never })
    ).rejects.toThrow(/topicId 不能为空/)
  })

  it('topicId=空串 → 抛错', async () => {
    await expect(
      getTopicDetailTool.execute({ topicId: '' })
    ).rejects.toThrow(/topicId 不能为空/)
  })

  it('topicId=纯空白 → 抛错', async () => {
    await expect(
      getTopicDetailTool.execute({ topicId: '   ' })
    ).rejects.toThrow(/topicId 不能为空/)
    // 不应调用 repo
    expect(mockGetTopicById).not.toHaveBeenCalled()
  })
})

describe('get_topic_detail：辩题不存在', () => {
  it('repo 返回 undefined → 抛错并附带 topicId', async () => {
    mockGetTopicById.mockReturnValue(undefined)

    await expect(
      getTopicDetailTool.execute({ topicId: 'no-such-id' })
    ).rejects.toThrow(/辩题不存在：topicId=no-such-id/)
  })
})

describe('get_topic_detail：正常查询', () => {
  it('合法 topicId → 返回完整 Topic（含 custom_data）', async () => {
    const topic = makeTopic('t-001')
    mockGetTopicById.mockReturnValue(topic)

    const result = await getTopicDetailTool.execute({ topicId: 't-001' })

    expect(result).toEqual(topic)
    expect(result.custom_data).toEqual({ source_year: '2026' })
    // trim 后透传
    expect(mockGetTopicById).toHaveBeenCalledWith('t-001')
  })

  it('topicId 带首尾空白 → trim 后透传 repo', async () => {
    mockGetTopicById.mockReturnValue(makeTopic('t-002'))

    await getTopicDetailTool.execute({ topicId: '  t-002  ' })

    expect(mockGetTopicById).toHaveBeenCalledWith('t-002')
  })
})

describe('get_topic_detail：repo 错误透传', () => {
  it('getTopicById 抛错 → 工具抛出同一错误', async () => {
    mockGetTopicById.mockImplementation(() => {
      throw new Error('DB 查询异常')
    })

    await expect(
      getTopicDetailTool.execute({ topicId: 't-003' })
    ).rejects.toThrow(/DB 查询异常/)
  })
})

describe('get_topic_detail：工具元数据', () => {
  it('name 应为 get_topic_detail', () => {
    expect(getTopicDetailTool.name).toBe('get_topic_detail')
  })

  it('riskLevel 应为 low', () => {
    expect(getTopicDetailTool.riskLevel).toBe('low')
  })

  it('parameters required 应含 topicId', () => {
    expect(getTopicDetailTool.parameters.required).toContain('topicId')
  })
})
