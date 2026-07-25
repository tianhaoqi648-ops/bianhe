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

  it('子串匹配 → score=0.9, reason=substring', () => {
    const result = recommendMappings(['入门'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('substring')
    expect(result[0].recommendedTarget).toBe('入门级')
    expect(result[0].score).toBe(0.9)
  })

  it('反向子串匹配（新值包含候选）', () => {
    const result = recommendMappings(['入门级别'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('substring')
    expect(result[0].recommendedTarget).toBe('入门级')
  })

  it('相似度匹配 → reason=similar, score≥0.6', () => {
    const result = recommendMappings(['进阶极'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('similar')
    expect(result[0].score).toBeGreaterThanOrEqual(0.6)
    expect(result[0].recommendedTarget).toBe('进阶级')
  })

  it('相似度 < 0.6 → 不推荐', () => {
    const result = recommendMappings(['xyz'], ['abc'])
    expect(result).toHaveLength(0)
  })

  it('批量推荐：混合多种匹配方式', () => {
    const newValues = ['入门级', '入门', '进阶极', 'xyz']
    const result = recommendMappings(newValues, candidates)
    expect(result).toHaveLength(3)
    const reasons = result.map((r) => r.reason)
    expect(reasons).toContain('exact')
    expect(reasons).toContain('substring')
    expect(reasons).toContain('similar')
  })

  it('空候选数组 → 返回空', () => {
    const result = recommendMappings(['abc'], [])
    expect(result).toHaveLength(0)
  })
})
