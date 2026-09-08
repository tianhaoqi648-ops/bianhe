import { describe, it, expect } from 'vitest'
import {
  resolveInitialSide,
  normalizeStageWeights,
  stageSpeakerLabel,
  poolInitMs,
  DEFAULT_TIMER_THEME,
  mergeTheme
} from '../rules/format-utils'
import type { DebateFormatData } from '../schema/debate-format'

const MINUTE = 60 * 1000

describe('core format-utils: resolveInitialSide', () => {
  it('自由辩论 both → aff；undefined → aff；普通环节透传', () => {
    expect(resolveInitialSide({ isFreeDebate: true, side: 'both' })).toBe('aff')
    expect(resolveInitialSide(undefined)).toBe('aff')
    expect(resolveInitialSide({ isFreeDebate: false, side: 'neg' })).toBe('neg')
  })
})

describe('core format-utils: normalizeStageWeights', () => {
  it('全部缺省 → 等权 1；部分有值 → 缺省 1、有值保留', () => {
    expect(normalizeStageWeights([{ id: 'a' }, { id: 'b' }])).toEqual({ a: 1, b: 1 })
    expect(normalizeStageWeights([{ id: 'a', weight: 2 }, { id: 'b' }])).toEqual({ a: 2, b: 1 })
    expect(normalizeStageWeights([])).toEqual({})
  })
})

describe('core format-utils: stageSpeakerLabel', () => {
  it('speaker 优先；side 兜底；BP 四角色空串', () => {
    expect(stageSpeakerLabel({ side: 'aff', speaker: '正方三辩' })).toBe('正方三辩')
    expect(stageSpeakerLabel({ side: 'neg' })).toBe('反方')
    expect(stageSpeakerLabel({ side: 'both' })).toBe('双方')
    expect(stageSpeakerLabel({ side: 'og' })).toBe('')
    expect(stageSpeakerLabel({ side: 'aff' })).toBe('正方')
  })
})

describe('core format-utils: poolInitMs', () => {
  it('teamPoolMinutes 优先；回退 poolSuggestedMs 之和；都无 → 0', () => {
    const withPool: DebateFormatData = {
      totalDurationMs: 21 * MINUTE,
      teamPoolMinutes: { aff: 17, neg: 17 },
      stages: []
    }
    expect(poolInitMs(withPool, 'aff')).toBe(17 * MINUTE)
    const fallback: DebateFormatData = {
      totalDurationMs: 0,
      stages: [
        { id: 'a', name: 'a', side: 'aff', durationMs: 3 * MINUTE, bells: [], poolTeam: 'aff', poolSuggestedMs: 3 * MINUTE },
        { id: 'b', name: 'b', side: 'aff', durationMs: 2 * MINUTE, bells: [], poolTeam: 'aff', poolSuggestedMs: 2 * MINUTE }
      ]
    }
    expect(poolInitMs(fallback, 'aff')).toBe(5 * MINUTE)
    expect(poolInitMs({ totalDurationMs: 0, stages: [] }, 'aff')).toBe(0)
  })
})

describe('core format-utils: 计时主题默认值', () => {
  it('DEFAULT_TIMER_THEME 与 mergeTheme 浅合并', () => {
    expect(DEFAULT_TIMER_THEME.affColor).toBe('#1677ff')
    expect(mergeTheme(null)).toEqual(DEFAULT_TIMER_THEME)
    expect(mergeTheme({ affLabel: '我方' }).affLabel).toBe('我方')
    expect(mergeTheme({ affLabel: '我方' }).negLabel).toBe('反方')
  })
})
