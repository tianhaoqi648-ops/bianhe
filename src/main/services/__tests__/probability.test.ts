import { describe, it, expect } from 'vitest'
import {
  weightedRandomSelect,
  getDifficultyDistribution,
  applyDifficultyDistribution,
  type WeightedItem
} from '../probability'

// ============================================================
// weightedRandomSelect
// ============================================================

describe('weightedRandomSelect', () => {
  it('count <= 0 返回空数组', () => {
    const items: WeightedItem[] = [{ weight: 1, id: 'a' }]
    expect(weightedRandomSelect(items, 0)).toEqual([])
    expect(weightedRandomSelect(items, -1)).toEqual([])
  })

  it('items 为空抛错', () => {
    expect(() => weightedRandomSelect([], 3)).toThrow('候选池为空')
  })

  it('所有 weight <= 0 抛错', () => {
    const items: WeightedItem[] = [
      { weight: 0, id: 'a' },
      { weight: -1, id: 'b' }
    ]
    expect(() => weightedRandomSelect(items, 1)).toThrow('候选池为空')
  })

  it('count >= 池大小 返回打乱后的全部', () => {
    const items: WeightedItem[] = [
      { weight: 1, id: 'a' },
      { weight: 1, id: 'b' },
      { weight: 1, id: 'c' }
    ]
    const result = weightedRandomSelect(items, 5)
    expect(result).toHaveLength(3)
    const ids = result.map((r) => r.id).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('返回数量等于 count 且不重复', () => {
    const items: WeightedItem[] = Array.from({ length: 20 }, (_, i) => ({
      weight: 1,
      id: `item-${i}`
    }))
    const result = weightedRandomSelect(items, 5)
    expect(result).toHaveLength(5)
    const ids = result.map((r) => r.id)
    expect(new Set(ids).size).toBe(5)
  })

  it('weight=0 的项不参与抽取', () => {
    const items: WeightedItem[] = [
      { weight: 0, id: 'zero' },
      { weight: 1, id: 'a' },
      { weight: 1, id: 'b' }
    ]
    // 多次抽样，zero 永不应被抽到
    for (let i = 0; i < 50; i++) {
      const result = weightedRandomSelect(items, 2)
      expect(result.map((r) => r.id)).not.toContain('zero')
    }
  })

  it('加权概率近似正确（大规模抽样）', () => {
    // weight 1 vs weight 9 → 期望 1 出现 10%，9 出现 90%
    const items: WeightedItem[] = [
      { weight: 1, id: 'low' },
      { weight: 9, id: 'high' }
    ]
    const N = 2000
    let lowCount = 0
    let highCount = 0
    for (let i = 0; i < N; i++) {
      const r = weightedRandomSelect(items, 1)
      if (r[0].id === 'low') lowCount++
      else highCount++
    }
    const lowRatio = lowCount / N
    // 期望 0.10，容差 ±0.05
    expect(lowRatio).toBeGreaterThan(0.05)
    expect(lowRatio).toBeLessThan(0.15)
    expect(highCount + lowCount).toBe(N)
  })
})

// ============================================================
// getDifficultyDistribution
// ============================================================

describe('getDifficultyDistribution', () => {
  it('小组赛预设', () => {
    const d = getDifficultyDistribution('小组赛')
    expect(d.入门级).toBe(0.6)
    expect(d.进阶级).toBe(0.4)
    expect(d.专业级).toBe(0)
  })

  it('小组赛第一轮也命中', () => {
    const d = getDifficultyDistribution('小组赛第一轮')
    expect(d).toEqual({ 入门级: 0.6, 进阶级: 0.4, 专业级: 0 })
  })

  it('复赛预设', () => {
    const d = getDifficultyDistribution('复赛')
    expect(d).toEqual({ 入门级: 0, 进阶级: 0.6, 专业级: 0.4 })
  })

  it('半决赛命中复赛规则', () => {
    const d = getDifficultyDistribution('半决赛')
    expect(d).toEqual({ 入门级: 0, 进阶级: 0.6, 专业级: 0.4 })
  })

  it('决赛预设', () => {
    const d = getDifficultyDistribution('决赛')
    expect(d).toEqual({ 入门级: 0, 进阶级: 0, 专业级: 1 })
  })

  it('未匹配的轮次返回默认分布', () => {
    const d = getDifficultyDistribution('表演赛')
    expect(d.入门级).toBeCloseTo(0.34)
    expect(d.进阶级).toBeCloseTo(0.33)
    expect(d.专业级).toBeCloseTo(0.33)
  })

  it('null 返回默认分布', () => {
    const d = getDifficultyDistribution(null)
    expect(d.入门级).toBeCloseTo(0.34)
  })
})

// ============================================================
// applyDifficultyDistribution
// ============================================================

describe('applyDifficultyDistribution', () => {
  type MockTopic = WeightedItem & { difficulty: string | null; id: string }

  function makePool(): MockTopic[] {
    return [
      // 入门级 4 个
      ...Array.from({ length: 4 }, (_, i) => ({ id: `entry-${i}`, weight: 1, difficulty: '入门级' })),
      // 进阶级 4 个
      ...Array.from({ length: 4 }, (_, i) => ({ id: `inter-${i}`, weight: 1, difficulty: '进阶级' })),
      // 专业级 4 个
      ...Array.from({ length: 4 }, (_, i) => ({ id: `pro-${i}`, weight: 1, difficulty: '专业级' }))
    ]
  }

  it('count <= 0 返回空', () => {
    const result = applyDifficultyDistribution(makePool(), { 入门级: 1, 进阶级: 0, 专业级: 0 }, 0)
    expect(result).toEqual([])
  })

  it('candidates 为空返回空', () => {
    const result = applyDifficultyDistribution([], { 入门级: 1, 进阶级: 0, 专业级: 0 }, 3)
    expect(result).toEqual([])
  })

  it('按比例分层抽样 - 小组赛规则', () => {
    // 小组赛 {0.6, 0.4, 0}，count=10
    // 入门目标 = floor(10*0.6)=6，但入门池只有 4 个 → 全抽
    // 进阶目标 = floor(10*0.4)=4，进阶池 4 个 → 全抽
    // 专业目标 = 0，专业池全进 remaining
    // deficit = 10 - 8 = 2 → 从专业池补 2
    const pool = makePool()
    const dist = { 入门级: 0.6, 进阶级: 0.4, 专业级: 0 }
    const result = applyDifficultyDistribution(pool, dist, 10)
    expect(result).toHaveLength(10)
    const entryCount = result.filter((r) => r.difficulty === '入门级').length
    const interCount = result.filter((r) => r.difficulty === '进阶级').length
    const proCount = result.filter((r) => r.difficulty === '专业级').length
    expect(entryCount).toBe(4) // 入门池全部抽中
    expect(interCount).toBe(4) // 进阶池全部抽中
    expect(proCount).toBe(2) // 不足的 2 个从专业池补足
  })

  it('某子池不足时从其他子池补足', () => {
    // 入门池只有 4 个，但要求 8 个入门 → 不足的从其他池补
    const pool = makePool()
    const dist = { 入门级: 1, 进阶级: 0, 专业级: 0 }
    const result = applyDifficultyDistribution(pool, dist, 8)
    expect(result).toHaveLength(8)
    const entryCount = result.filter((r) => r.difficulty === '入门级').length
    expect(entryCount).toBe(4) // 入门池全部抽中
    // 其余 4 个来自其他池
    const others = result.filter((r) => r.difficulty !== '入门级')
    expect(others.length).toBe(4)
  })

  it('总数不足时不抛错，返回实际数量', () => {
    const pool: MockTopic[] = [{ id: 'only', weight: 1, difficulty: '入门级' }]
    const dist = { 入门级: 0.5, 进阶级: 0.5, 专业级: 0 }
    const result = applyDifficultyDistribution(pool, dist, 5)
    expect(result.length).toBeLessThanOrEqual(5)
    expect(result.length).toBe(1)
  })

  it('结果不重复', () => {
    const pool = makePool()
    const dist = { 入门级: 0.34, 进阶级: 0.33, 专业级: 0.33 }
    const result = applyDifficultyDistribution(pool, dist, 8)
    const ids = result.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
