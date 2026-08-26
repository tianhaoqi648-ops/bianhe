// Cross-End Golden: draw（随 sync-core 同步到小程序仓，两端运行同一文件）
// 随机 case 均以 withSeed(seed) 注入同一 mulberry32 序列；期望值由桌面种子生成后固化。
import { describe, it, expect } from 'vitest'
import {
  weightedRandomSelect,
  weightedRandomSelectWithReplacement,
  applyDifficultyDistribution
} from '../../rules/draw/probability'
import {
  applySourceMixRatio,
  applyExclusionsByIds,
  drawFromPool,
  InsufficientTopicsError
} from '../../rules/draw/draw'
import { normalizeDrawResult } from './normalize'
import { withSeed } from './rng'
import fixture from './fixtures/draw.json'

/** 按 case.fn 执行并返回「与 fixture 期望同形」的结果 */
function runCase(c: any): unknown {
  const { fn, input } = c
  switch (fn) {
    case 'weightedRandomSelect':
      return weightedRandomSelect(input.items, input.count).map((x: any) => x.id)
    case 'weightedRandomSelectWithReplacement':
      return weightedRandomSelectWithReplacement(input.pool, input.count).map((x: any) => x.id)
    case 'applySourceMixRatio': {
      const r = applySourceMixRatio(input.candidates, input.ratio, input.count, input.allowRepeat)
      return { picked: r.picked.map((x: any) => x.id), actualRatio: r.actualRatio }
    }
    case 'applyDifficultyDistribution':
      return applyDifficultyDistribution(input.candidates, input.distribution, input.count).map((x: any) => x.id)
    case 'applyExclusionsByIds':
      return applyExclusionsByIds(
        input.candidates,
        new Set<string>(input.drawnIds),
        new Set<string>(input.teamHistoryIds)
      ).map((x: any) => x.id)
    case 'drawFromPool': {
      const options: any = { ...(input.options || {}) }
      if (options.teamsByGroup) {
        options.teamsByGroup = new Map<string, unknown>(Object.entries(options.teamsByGroup))
      }
      const r = drawFromPool(input.candidates, input.params, options)
      return normalizeDrawResult(r)
    }
    default:
      throw new Error(`golden: 未知 fn ${fn}`)
  }
}

describe('Cross-End Golden: draw', () => {
  const f = fixture as any
  for (const c of f.cases) {
    it(c.name, () => {
      if (c.expected && c.expected.throws) {
        let err: any
        try {
          withSeed(f.seed, () => runCase(c))
        } catch (e) {
          err = e
        }
        expect(err).toBeDefined()
        if (typeof c.expected.throws === 'string') {
          expect(err.message).toContain(c.expected.throws)
        } else {
          expect(err.name).toBe(c.expected.throws.name)
          if (c.expected.throws.name === 'InsufficientTopicsError') {
            expect(err).toBeInstanceOf(InsufficientTopicsError)
            expect(err.candidateCount).toBe(c.expected.throws.candidateCount)
            expect(err.requiredCount).toBe(c.expected.throws.requiredCount)
          }
        }
      } else {
        const out = withSeed(f.seed, () => runCase(c))
        expect(out).toEqual(c.expected)
      }
    })
  }
})
