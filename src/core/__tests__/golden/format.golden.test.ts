// Cross-End Golden: format（随 sync-core 同步到小程序仓，两端运行同一文件）
import { describe, it, expect } from 'vitest'
import {
  resolveInitialSide,
  normalizeStageWeights,
  stageSpeakerLabel,
  poolInitMs,
  DEFAULT_TIMER_THEME,
  mergeTheme
} from '../../rules/format-utils'
import { normalizeFormatData } from './normalize'
import fixture from './fixtures/format.json'

describe('Cross-End Golden: format', () => {
  const f = fixture as any
  for (const c of f.cases) {
    it(c.name, () => {
      let out: unknown
      switch (c.fn) {
        case 'resolveInitialSide':
          out = resolveInitialSide(c.input ?? undefined)
          break
        case 'normalizeStageWeights':
          out = normalizeStageWeights(c.input)
          break
        case 'stageSpeakerLabel':
          out = stageSpeakerLabel(c.input)
          break
        case 'poolInitMs':
          out = poolInitMs(c.input.format, c.input.team)
          break
        case 'defaultTimerTheme':
          out = DEFAULT_TIMER_THEME
          break
        case 'mergeTheme':
          out = mergeTheme(c.input ?? undefined)
          break
        case 'formatSnapshot':
          out = normalizeFormatData(c.input)
          break
        default:
          throw new Error(`golden: 未知 fn ${c.fn}`)
      }
      expect(out).toEqual(c.expected)
    })
  }
})
