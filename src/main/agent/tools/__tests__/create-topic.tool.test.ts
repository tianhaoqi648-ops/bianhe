// ============================================================
// create-topic.tool.test.ts — create_topic 工具入参校验测试
//
// 覆盖 create-topic.tool.ts 的入参校验与参数透传：
//   - title 缺失 / null / 空串 / 空白 → 抛错
//   - title 长度 > 200 → 抛错
//   - 可选字段空字符串 → 不写入 input（保持 null）
//   - tags 过滤非字符串与空串
//   - 正常创建 → 返回 Topic，createTopic 透传 trim 后的值
//   - repo 抛错 → 工具抛错
//
// Mock 策略：mock topicRepo.createTopic，隔离工具层校验逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Topic } from '@shared/types'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockCreateTopic, mockEnsureTopicInDefaultGroup } = vi.hoisted(() => ({
  mockCreateTopic: vi.fn(),
  mockEnsureTopicInDefaultGroup: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/db/repository/topic.repo', () => ({
  topicRepo: {
    createTopic: mockCreateTopic
  }
}))

vi.mock('@main/db/repository/topic-group.repo', () => ({
  topicGroupRepo: {
    ensureTopicInDefaultGroup: mockEnsureTopicInDefaultGroup
  }
}))

// 导入被测模块（在 mock 之后）
import { createTopicTool } from '../create-topic.tool'

// ============================================================
// Mock 数据
// ============================================================

/** 构造一条已创建的 Topic */
function makeCreatedTopic(title: string): Topic {
  return {
    id: 'new-id',
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
  mockCreateTopic.mockImplementation((input: { title: string }) =>
    makeCreatedTopic(input.title)
  )
  mockEnsureTopicInDefaultGroup.mockResolvedValue(1)
})

describe('create_topic：title 校验', () => {
  it('title 缺失 → 抛错', async () => {
    await expect(
      createTopicTool.execute({} as never)
    ).rejects.toThrow(/title 不能为空/)
  })

  it('title=null → 抛错', async () => {
    await expect(
      createTopicTool.execute({ title: null as never })
    ).rejects.toThrow(/title 不能为空/)
  })

  it('title=空串 → 抛错', async () => {
    await expect(
      createTopicTool.execute({ title: '' })
    ).rejects.toThrow(/title 不能为空/)
  })

  it('title=纯空白 → 抛错且不调用 repo', async () => {
    await expect(
      createTopicTool.execute({ title: '    ' })
    ).rejects.toThrow(/title 不能为空/)
    expect(mockCreateTopic).not.toHaveBeenCalled()
  })

  it('title 长度 > 200 → 抛错', async () => {
    const longTitle = '题'.repeat(201)
    await expect(
      createTopicTool.execute({ title: longTitle })
    ).rejects.toThrow(/title 长度超过 200 字/)
  })

  it('title 长度 = 200 合法', async () => {
    const title = '题'.repeat(200)
    await createTopicTool.execute({ title })

    expect(mockCreateTopic).toHaveBeenCalledWith(
      expect.objectContaining({ title })
    )
  })
})

describe('create_topic：可选字段空值保持 null', () => {
  it('可选字段为空字符串 → input 中对应字段为 null', async () => {
    await createTopicTool.execute({
      title: '新辩题',
      type: '',
      domain: '  ',
      difficulty: '',
      source: ''
    })

    const input = mockCreateTopic.mock.calls[0][0]
    expect(input.type).toBeNull()
    expect(input.domain).toBeNull()
    expect(input.difficulty).toBeNull()
    expect(input.source).toBeNull()
    expect(input.source_type).toBeNull()
  })

  it('tags 为空数组 → input.tags 为 null', async () => {
    await createTopicTool.execute({ title: '新辩题', tags: [] })

    const input = mockCreateTopic.mock.calls[0][0]
    expect(input.tags).toBeNull()
  })

  it('tags 含空串与非字符串 → 过滤后仅保留有效项', async () => {
    await createTopicTool.execute({
      title: '新辩题',
      tags: ['经典', '', '  ', 99 as unknown as string, '哲学']
    })

    const input = mockCreateTopic.mock.calls[0][0]
    expect(input.tags).toEqual(['经典', '哲学'])
  })
})

describe('create_topic：正常创建', () => {
  it('全字段传入 → trim 后透传 createTopic', async () => {
    const created = makeCreatedTopic('trimmed-title')
    mockCreateTopic.mockReturnValue(created)

    const result = await createTopicTool.execute({
      title: '  trimmed-title  ',
      type: '  价值  ',
      domain: '教育',
      difficulty: '进阶级',
      source: '测试',
      tags: ['  经典  ']
    })

    expect(result).toEqual(created)
    expect(mockCreateTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'trimmed-title',
        type: '价值',
        domain: '教育',
        difficulty: '进阶级',
        source: '测试',
        source_type: null,
        tags: ['经典']
      })
    )
  })

  it('仅 title → 其余字段为 null', async () => {
    await createTopicTool.execute({ title: '最简辩题' })

    const input = mockCreateTopic.mock.calls[0][0]
    expect(input).toEqual({
      title: '最简辩题',
      type: null,
      domain: null,
      difficulty: null,
      source: null,
      source_type: null,
      tags: null
    })
  })
})

describe('create_topic：默认归入默认题库（赛事题库 T2）', () => {
  it('创建成功后把新题 id 归入默认题库', async () => {
    const created = makeCreatedTopic('默认归入')
    created.id = 'topic-abc'
    mockCreateTopic.mockReturnValue(created)

    const result = await createTopicTool.execute({ title: '默认归入' })

    expect(result.id).toBe('topic-abc')
    expect(mockEnsureTopicInDefaultGroup).toHaveBeenCalledTimes(1)
    expect(mockEnsureTopicInDefaultGroup).toHaveBeenCalledWith('topic-abc')
  })

  it('createTopic 失败时不触发默认归入', async () => {
    mockCreateTopic.mockImplementation(() => {
      throw new Error('插入失败')
    })

    await expect(createTopicTool.execute({ title: '失败用例' })).rejects.toThrow(/插入失败/)
    expect(mockEnsureTopicInDefaultGroup).not.toHaveBeenCalled()
  })
})

describe('create_topic：repo 错误透传', () => {
  it('createTopic 抛错 → 工具抛出同一错误', async () => {
    mockCreateTopic.mockImplementation(() => {
      throw new Error('唯一约束冲突')
    })

    await expect(
      createTopicTool.execute({ title: '重复辩题' })
    ).rejects.toThrow(/唯一约束冲突/)
  })
})

describe('create_topic：工具元数据', () => {
  it('name 应为 create_topic', () => {
    expect(createTopicTool.name).toBe('create_topic')
  })

  it('riskLevel 应为 medium', () => {
    expect(createTopicTool.riskLevel).toBe('medium')
  })

  it('parameters required 应含 title', () => {
    expect(createTopicTool.parameters.required).toContain('title')
  })
})
