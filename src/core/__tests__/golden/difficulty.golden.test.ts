// Cross-End Golden: difficulty（随 sync-core 同步到小程序仓，两端运行同一文件）
import { describe, it, expect } from 'vitest'
import {
  normalizeDifficulty,
  roundNameToDifficulty,
  getDifficultyDistribution,
  DIFFICULTY_ROUND_PRESETS
} from '../../rules/difficulty'
import { normalizeDifficultyPreset } from './normalize'
import fixture from './fixtures/difficulty.json'

describe('Cross-End Golden: difficulty', () => {
  const f = fixture as any
  for (const c of f.cases) {
    it(c.name, () => {
      let out: unknown
      if (c.fn === 'normalizeDifficulty') {
        out = normalizeDifficulty(c.input)
      } else if (c.fn === 'roundNameToDifficulty') {
        out = roundNameToDifficulty(c.input.name, c.input.presetKey)
      } else {
        out = getDifficultyDistribution(c.input)
      }
      expect(out).toEqual(c.expected)
    })
  }

  it('presets semantic projection (standard/compact/extended)', () => {
    expect(normalizeDifficultyPreset(DIFFICULTY_ROUND_PRESETS)).toEqual(f.presets)
  })
})
