import { describe, it, expect } from 'vitest'
import {
  applyExclusionsByIds,
  applySourceMixRatio,
  applyDifficultyOverride,
  drawFromPool,
  InsufficientTopicsError,
  DrawCandidate
} from '../rules/draw/draw'
import { applyDifficultyDistribution, weightedRandomSelect } from '../rules/draw/probability'

function topic(id: string, difficulty: string | null = '入门'): DrawCandidate {
  return { id, title: `题-${id}`, difficulty, source_type: '自定义', weight: 1 }
}

describe('core draw: applyExclusionsByIds', () => {
  it('剔除已抽/队伍历史命中项', () => {
    const cands = [topic('t1'), topic('t2'), topic('t3')]
    const r = applyExclusionsByIds(cands, new Set(['t2']), new Set(['t3']))
    expect(r.map((t) => t.id)).toEqual(['t1'])
  })
})

describe('core draw: applySourceMixRatio', () => {
  it('按 official:custom 比例分层；空池返回 0 比例', () => {
    const cands = [
      { ...topic('o1'), source_type: '官方' },
      { ...topic('o2'), source_type: 'official' },
      { ...topic('c1'), source_type: '自定义' },
    ]
    const r = applySourceMixRatio(cands, { official: 0.5, custom: 0.5 }, 4, false)
    // 2 官 + 1 自 = 3 候选，无放回下最多抽 3（官方 2 + 自定义 1）
    expect(r.picked).toHaveLength(3)
    expect(r.actualRatio.official).toBeCloseTo(2 / 3)
    expect(applySourceMixRatio([], { official: 0.5, custom: 0.5 }, 3, false).picked).toEqual([])
  })
})

describe('core draw: applyDifficultyOverride + 兼容层', () => {
  it('round.difficulty_override 关键词 → 规范档分布；候选旧标签仍正确分池', () => {
    // 候选 difficulty 使用旧标签（'入门级'），验证 normalizeDifficulty 兼容分池
    const cands = [
      { ...topic('e1'), difficulty: '入门级' },
      { ...topic('e2'), difficulty: '入门级' },
      { ...topic('p1'), difficulty: '专业级' },
      { ...topic('p2'), difficulty: '专业级' },
    ]
    const r = applyDifficultyOverride(cands, { difficulty_override: '决赛' } as any, 2)
    expect(r).toHaveLength(2)
    // 决赛分布 {0,0,1} → 全部来自专业池（旧标签归一化匹配）
    for (const t of r) expect(t.id.startsWith('p')).toBe(true)
  })

  it('applyDifficultyDistribution 兼容读取标签键分布', () => {
    // 兼容层：distribution 为旧标签键时仍正确读取
    const cands = [topic('e1'), topic('e2')]
    const r = applyDifficultyDistribution(cands as any, { 入门级: 1, 进阶级: 0, 专业级: 0 } as any, 2)
    expect(r).toHaveLength(2)
  })
})

describe('core draw: drawFromPool（纯编排）', () => {
  it('versus 模式含持方；题池不足抛 InsufficientTopicsError', () => {
    const cands = [topic('t1'), topic('t2'), topic('t3'), topic('t4')]
    const r = drawFromPool(cands, {
      topic_count: 2,
      include_stance: true,
      teams: [{ id: 'a', name: '正方队' }, { id: 'b', name: '反方队' }]
    })
    expect(r.topics).toHaveLength(2)
    expect(r.items).toHaveLength(2)
    expect(r.effective_topic_count).toBe(2)
    expect(() =>
      drawFromPool(cands, { topic_count: 5, include_stance: false })
    ).toThrowError(InsufficientTopicsError)
  })

  it('group 模式 effective_topic_count 按分组数', () => {
    const cands = [topic('t1'), topic('t2')]
    const groups = [
      { id: 'g1', name: '组一' },
      { id: 'g2', name: '组二' },
    ]
    const r = drawFromPool(cands, { topic_count: 99, include_stance: false, draw_mode: 'group' }, {
      groups,
      teamsByGroup: new Map([['g1', [{ id: 'a', name: 'A' }]], ['g2', [{ id: 'b', name: 'B' }]]]),
    })
    expect(r.effective_topic_count).toBe(2)
  })

  it('weightedRandomSelect 基础行为', () => {
    expect(() => weightedRandomSelect([], 1)).toThrow('候选池为空')
    expect(weightedRandomSelect([{ weight: 1, id: 'a' }], 0)).toEqual([])
  })
})
