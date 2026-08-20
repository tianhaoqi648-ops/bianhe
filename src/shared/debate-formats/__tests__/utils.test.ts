// ============================================================
// debate-formats/__tests__/utils.test.ts — 赛制工具函数测试（T1）
//
// 覆盖：normalizeStageWeights（全部缺省=等权、部分缺省=按1、自定义权重保留）
//      stageSpeakerLabel（有 speaker 直接返回、无 speaker 按 side 兜底）
// ============================================================

import { describe, it, expect } from 'vitest'
import { normalizeStageWeights, stageSpeakerLabel } from '../utils'

describe('normalizeStageWeights', () => {
  it('全部缺省 weight 时，每个环节权重均为 1（等权）', () => {
    const stages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(normalizeStageWeights(stages)).toEqual({ a: 1, b: 1, c: 1 })
  })

  it('全部缺省 weight 且为空数组时返回空对象', () => {
    expect(normalizeStageWeights([])).toEqual({})
  })

  it('部分环节缺省时，缺省按 1、有值的保留', () => {
    const stages = [
      { id: 'a', weight: 2 },
      { id: 'b' },
      { id: 'c', weight: 3 }
    ]
    expect(normalizeStageWeights(stages)).toEqual({ a: 2, b: 1, c: 3 })
  })

  it('全部提供自定义权重时保留原始数值（含小数）', () => {
    const stages = [
      { id: 'a', weight: 1.5 },
      { id: 'b', weight: 0.5 }
    ]
    expect(normalizeStageWeights(stages)).toEqual({ a: 1.5, b: 0.5 })
  })
})

describe('stageSpeakerLabel', () => {
  it('有 speaker 时直接返回该值', () => {
    expect(stageSpeakerLabel({ side: 'aff', speaker: '正方三辩', name: '立论' })).toBe('正方三辩')
    expect(stageSpeakerLabel({ side: 'neg', speaker: '双方', name: '自由辩论' })).toBe('双方')
    expect(stageSpeakerLabel({ side: 'og', speaker: '首相', name: 'PM' })).toBe('首相')
  })

  it('无 speaker 时按 side 兜底返回正方/反方/双方', () => {
    expect(stageSpeakerLabel({ side: 'aff', name: '正方立论' })).toBe('正方')
    expect(stageSpeakerLabel({ side: 'neg', name: '反方总结' })).toBe('反方')
    expect(stageSpeakerLabel({ side: 'both', name: '自由辩论' })).toBe('双方')
  })

  it('无 speaker 且 side 为 BP 四角色（og/oo/cg/co）时返回空串', () => {
    expect(stageSpeakerLabel({ side: 'og', name: '首相' })).toBe('')
    expect(stageSpeakerLabel({ side: 'oo', name: '领袖反对' })).toBe('')
    expect(stageSpeakerLabel({ side: 'cg', name: '副首相' })).toBe('')
    expect(stageSpeakerLabel({ side: 'co', name: '副领袖反对' })).toBe('')
  })

  it('空 speaker 视为缺省并走 side 兜底', () => {
    expect(stageSpeakerLabel({ side: 'neg', speaker: '', name: '反方' })).toBe('反方')
  })
})