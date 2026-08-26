// Cross-End Golden: match-result（随 sync-core 同步到小程序仓，两端运行同一文件）
import { describe, it, expect } from 'vitest'
import { computeMatchResult } from '../../rules/match-result'
import { normalizeMatchResult } from './normalize'
import cases from './fixtures/match-result.json'

describe('Cross-End Golden: match-result', () => {
  for (const c of (cases as any).cases) {
    it(c.name, () => {
      const out = computeMatchResult(c.input.system, c.input.votes)
      expect(normalizeMatchResult(out)).toEqual(normalizeMatchResult(c.expected))
    })
  }
})
