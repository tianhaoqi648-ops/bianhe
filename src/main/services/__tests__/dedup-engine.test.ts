import { describe, it, expect } from 'vitest'
import {
  findDuplicates,
  levenshteinDistance,
  extractKeywords,
  type DedupOptions
} from '../dedup-engine'
import type { Topic } from '../../db/repository/topic.repo'

// ============================================================
// 辅助：构造 Topic
// ============================================================

function makeTopic(id: string, title: string): Topic {
  return {
    id,
    title,
    type: null,
    domain: null,
    difficulty: null,
    source: null,
    source_type: null,
    tags: null,
    weight: 1,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

// ============================================================
// levenshteinDistance
// ============================================================

describe('levenshteinDistance', () => {
  it('相同字符串距离为 0', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0)
  })

  it('空字符串', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3)
    expect(levenshteinDistance('abc', '')).toBe(3)
    expect(levenshteinDistance('', '')).toBe(0)
  })

  it('已知距离', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
    expect(levenshteinDistance('flaw', 'lawn')).toBe(2)
    expect(levenshteinDistance('abc', 'abd')).toBe(1)
  })
})

// ============================================================
// extractKeywords
// ============================================================

describe('extractKeywords', () => {
  it('空字符串返回空', () => {
    expect(extractKeywords('')).toEqual([])
  })

  it('提取中文 2-gram', () => {
    const kws = extractKeywords('人工智能伦理')
    // 应包含 ai-、工-智、智-能、能-伦、伦-理 等 bigram
    expect(kws.length).toBeGreaterThan(0)
    expect(kws).toContain('人工')
    expect(kws).toContain('智能')
  })

  it('英文 token 保留（小写化）', () => {
    const kws = extractKeywords('AI 技术伦理')
    expect(kws).toContain('ai')
  })

  it('去重', () => {
    const kws = extractKeywords('人工智能 人工智能')
    const set = new Set(kws)
    expect(kws.length).toBe(set.size)
  })
})

// ============================================================
// findDuplicates
// ============================================================

describe('findDuplicates', () => {
  it('空数组返回空', async () => {
    expect(await findDuplicates([])).toEqual([])
  })

  it('单条辩题返回空', async () => {
    expect(await findDuplicates([makeTopic('1', '唯一辩题')])).toEqual([])
  })

  it('完全相同检测', async () => {
    const topics = [
      makeTopic('1', '人工智能是否应该被禁止'),
      makeTopic('2', '人工智能是否应该被禁止'),
      makeTopic('3', '完全无关的另一道辩题')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(1)
    expect(groups[0].topics).toHaveLength(2)
    expect(groups[0].similarity).toBe(1.0)
    expect(groups[0].reason).toBe('exact')
  })

  it('完全相同 - 首尾空格不影响', async () => {
    const topics = [
      makeTopic('1', '  人工智能是否应该被禁止  '),
      makeTopic('2', '人工智能是否应该被禁止')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(1)
    expect(groups[0].reason).toBe('exact')
  })

  it('编辑距离检测 - 改动 < 阈值', async () => {
    // 距离 1
    const topics = [
      makeTopic('1', '人工智能是否应该被禁止'),
      makeTopic('2', '人工智能是否应该被禁止的')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(1)
    expect(groups[0].reason).toBe('levenshtein')
    expect(groups[0].similarity).toBeGreaterThan(0.9)
  })

  it('编辑距离检测 - 距离 >= 阈值不归组', async () => {
    // 距离 > 5
    const topics = [
      makeTopic('1', '人工智能是否应该被完全禁止使用'),
      makeTopic('2', '人类是否应该探索火星殖民地')
    ]
    const groups = await findDuplicates(topics, { levenshteinThreshold: 5 })
    // 编辑距离检测应不命中，可能命中关键词检测
    const levenshteinGroups = groups.filter((g) => g.reason === 'levenshtein')
    expect(levenshteinGroups).toHaveLength(0)
  })

  it('关键词重合检测', async () => {
    // 高度重合关键词但编辑距离较大
    // 1 的 bigram: 人工/工智/智能/能伦/伦理 = 5
    // 2 的 bigram: 人工/工智/智能/能伦/伦理/理研/研究 = 7
    // 交集 5，并集 7，重合度 = 5/7 ≈ 0.71
    const topics = [
      makeTopic('1', '人工智能伦理'),
      makeTopic('2', '人工智能伦理研究')
    ]
    const groups = await findDuplicates(topics, {
      levenshteinThreshold: 1, // 提高编辑距离门槛，强制走关键词层
      keywordThreshold: 0.5
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].topics).toHaveLength(2)
    // 编辑距离 = 2 (添加 "研究")，阈值 1 → 不命中 levenshtein
    // 关键词重合度 0.71 > 0.5 → 命中 keyword
    expect(groups[0].reason).toBe('keyword')
  })

  it('AI 语义层 - 提供 similarityFn', async () => {
    const topics = [
      makeTopic('1', 'AI 是否应该被禁止'),
      makeTopic('2', '机器智能是否应被限制'),
      makeTopic('3', '环保政策')
    ]
    const options: DedupOptions = {
      similarityFn: async (a, b) => {
        if (a.id === '1' && b.id === '2') return 0.92
        return 0.1
      }
    }
    const groups = await findDuplicates(topics, options)
    // 应有 1 个组包含 topic 1 和 2
    expect(groups).toHaveLength(1)
    expect(groups[0].topics.map((t) => t.id).sort()).toEqual(['1', '2'])
    expect(groups[0].reason).toBe('ai')
  })

  it('AI 相似度低于阈值不归组', async () => {
    const topics = [
      makeTopic('1', '辩题一'),
      makeTopic('2', '辩题二')
    ]
    const options: DedupOptions = {
      similarityFn: async () => 0.5,
      aiThreshold: 0.85
    }
    const groups = await findDuplicates(topics, options)
    // 文本层也未必命中，但 AI 层应不归组
    const aiGroups = groups.filter((g) => g.reason === 'ai')
    expect(aiGroups).toHaveLength(0)
  })

  it('同一辩题只出现在一个组（贪心合并）', async () => {
    // 三条互相相似：1=2, 2=3
    const topics = [
      makeTopic('1', '人工智能是否应该被禁止'),
      makeTopic('2', '人工智能是否应该被禁止的'),
      makeTopic('3', '人工智能是否应该被禁止了吗')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(1)
    expect(groups[0].topics).toHaveLength(3)
  })

  it('多个独立组', async () => {
    const topics = [
      makeTopic('1', '人工智能是否应该被禁止'),
      makeTopic('2', '人工智能是否应该被禁止'),
      makeTopic('3', '环保政策是否应该立即执行'),
      makeTopic('4', '环保政策是否应该立即执行'),
      makeTopic('5', '完全独立的一道辩题')
    ]
    const groups = await findDuplicates(topics)
    expect(groups).toHaveLength(2)
    const sizes = groups.map((g) => g.topics.length).sort()
    expect(sizes).toEqual([2, 2])
  })
})
