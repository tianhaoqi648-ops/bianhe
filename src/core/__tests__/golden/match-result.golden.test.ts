// Cross-End Golden: match-result（随 sync-core 同步到小程序仓，两端运行同一文件）
import { describe, it, expect } from 'vitest'
import { computeMatchResult } from '../../rules/match-result'
import { normalizeMatchResult } from './normalize'
import cases from './fixtures/match-result.json'

describe('Cross-End Golden: match-result', () => {
  for (const c of (cases as any).cases) {
    // 'abandoned' 为显式状态赛果（仓库层依「无评决透传」落地），非 computeMatchResult 聚合产物；由末尾对照用例覆盖
    if ((c.expected as any).winner === 'abandoned') continue
    it(c.name, () => {
      const out = computeMatchResult(c.input.system, c.input.votes)
      expect(normalizeMatchResult(out)).toEqual(normalizeMatchResult(c.expected))
    })
  }
})

// 'abandoned' 对照：弃赛为显式状态赛果（无裁判评决即采用显式 winner）。沿用仓库层口径——
// 对空评决聚合出分数/票型、仅将 winner 固定为 'abandoned'，锁死跨端同一位码。
it('abandoned', () => {
  const abandoned = (cases as any).cases.find((c: any) => (c.expected as any).winner === 'abandoned')
  expect(abandoned).toBeTruthy()
  const out = { ...computeMatchResult(abandoned.input.system, abandoned.input.votes), winner: 'abandoned' }
  expect(normalizeMatchResult(out)).toEqual(normalizeMatchResult(abandoned.expected))
})
