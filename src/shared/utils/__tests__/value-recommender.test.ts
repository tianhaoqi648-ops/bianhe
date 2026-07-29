import { describe, it, expect } from 'vitest'
import { recommendMappings, levenshtein } from '../value-recommender'

describe('levenshtein', () => {
  it('相同字符串距离为 0', () => {
    expect(levenshtein('abc', 'abc')).toBe(0)
  })

  it('大小写不敏感', () => {
    expect(levenshtein('ABC', 'abc')).toBe(0)
  })

  it('单个编辑操作距离为 1', () => {
    expect(levenshtein('abc', 'abd')).toBe(1)
    expect(levenshtein('abc', 'abcd')).toBe(1)
    expect(levenshtein('abc', 'ab')).toBe(1)
  })
})

describe('recommendMappings', () => {
  const candidates = ['入门级', '进阶级', '高阶级', '专家级']

  it('精确匹配 → score=1, reason=exact', () => {
    const result = recommendMappings(['入门级'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      originValue: '入门级',
      recommendedTarget: '入门级',
      score: 1,
      reason: 'exact'
    })
  })

  it('大小写不敏感精确匹配', () => {
    const result = recommendMappings(['BASIC'], ['basic', 'medium'])
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('exact')
    expect(result[0].recommendedTarget).toBe('basic')
  })

  it('核心词匹配 → score=0.88, reason=core-keyword', () => {
    const result = recommendMappings(['入门'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('core-keyword')
    expect(result[0].recommendedTarget).toBe('入门级')
    expect(result[0].score).toBe(0.88)
  })

  it('反向核心词匹配（新值包含候选）', () => {
    const result = recommendMappings(['入门级别'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('core-keyword')
    expect(result[0].recommendedTarget).toBe('入门级')
  })

  it('相似度匹配 → reason=similar, score≥0.6', () => {
    const result = recommendMappings(['进阶极'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('similar')
    expect(result[0].score).toBeGreaterThanOrEqual(0.6)
    expect(result[0].recommendedTarget).toBe('进阶级')
  })

  it('相似度 < 0.6 → 返回 no-match 记录', () => {
    const result = recommendMappings(['xyz'], ['abc'])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      originValue: 'xyz',
      recommendedTarget: '',
      score: 0,
      reason: 'no-match'
    })
  })

  it('批量推荐：混合多种匹配方式 + 未匹配项', () => {
    const newValues = ['入门级', '入门', '进阶极', 'xyz']
    const result = recommendMappings(newValues, candidates)
    expect(result).toHaveLength(4)
    const reasons = result.map((r) => r.reason)
    expect(reasons).toContain('exact')
    expect(reasons).toContain('core-keyword')
    expect(reasons).toContain('similar')
    expect(reasons).toContain('no-match')
    const noMatchItem = result.find((r) => r.reason === 'no-match')
    expect(noMatchItem).toBeDefined()
    expect(noMatchItem?.recommendedTarget).toBe('')
    expect(noMatchItem?.score).toBe(0)
  })

  it('空候选数组 → 返回 no-match 记录', () => {
    const result = recommendMappings(['abc'], [])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      originValue: 'abc',
      recommendedTarget: '',
      score: 0,
      reason: 'no-match'
    })
  })

  it('完全不相似的新值 → 返回 no-match 记录，长度等于 newValues 长度', () => {
    const newValues = ['完全不同的值XYZ']
    const candidates2 = ['入门级', '进阶级']
    const result = recommendMappings(newValues, candidates2)
    expect(result).toHaveLength(newValues.length)
    expect(result).toContainEqual({
      originValue: '完全不同的值XYZ',
      recommendedTarget: '',
      score: 0,
      reason: 'no-match'
    })
  })

  it('混合新值：匹配项 + 未匹配项，长度覆盖所有输入', () => {
    const newValues = ['入门', '完全不同的值XYZ']
    const candidates2 = ['入门级', '进阶级']
    const result = recommendMappings(newValues, candidates2, 'difficulty')
    expect(result).toHaveLength(2)
    const matched = result.find((r) => r.originValue === '入门')
    const unmatched = result.find((r) => r.originValue === '完全不同的值XYZ')
    expect(matched).toBeDefined()
    expect(matched?.reason).not.toBe('no-match')
    expect(matched?.recommendedTarget).toBe('入门级')
    expect(matched?.score).toBeGreaterThan(0)
    expect(unmatched).toBeDefined()
    expect(unmatched).toEqual({
      originValue: '完全不同的值XYZ',
      recommendedTarget: '',
      score: 0,
      reason: 'no-match'
    })
  })
})
