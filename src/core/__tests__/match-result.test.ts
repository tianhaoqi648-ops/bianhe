import { describe, it, expect } from 'vitest'
import { computeMatchResult } from '../rules/match-result'
import { MatchJudgeSystem, MatchWinner } from '../schema/match'

type Vote = Parameters<typeof computeMatchResult>[1][number]

const v = (partial: Partial<Vote>): Vote => ({
  impressionVote: null,
  decisionVote: null,
  affTotal: null,
  negTotal: null,
  bestSpeaker: null,
  ...partial,
})

describe('core match-result: three_votes（三票制）', () => {
  const THREE = MatchJudgeSystem.THREE_VOTES

  it('aff 胜 + votes 明细', () => {
    const votes = [
      v({ impressionVote: 'aff', decisionVote: 'aff', affTotal: 5, negTotal: 4, bestSpeaker: '甲' }),
      v({ impressionVote: 'aff', decisionVote: 'aff', affTotal: 5, negTotal: 4, bestSpeaker: '甲' }),
      v({ impressionVote: 'neg', decisionVote: 'neg', affTotal: 4, negTotal: 5, bestSpeaker: '乙' }),
    ]
    const r = computeMatchResult(THREE, votes)
    expect(r.winner).toBe(MatchWinner.AFF)
    expect(r.votes!.aff).toBe(6)
    expect(r.votes!.neg).toBe(3)
  })

  it('总票平 → 决胜票分胜负', () => {
    const votes = [
      v({ impressionVote: 'aff', decisionVote: 'aff', affTotal: 5, negTotal: 4 }),
      v({ impressionVote: 'neg', decisionVote: 'neg', affTotal: 4, negTotal: 5 }),
      v({ impressionVote: null, decisionVote: 'aff', affTotal: 4, negTotal: 5 }),
    ]
    const r = computeMatchResult(THREE, votes)
    // imp 1:1；stg 1:2；dec 2:1 → 总票 4:4 → 决胜 2:1 → aff
    expect(r.winner).toBe(MatchWinner.AFF)
  })

  it('仍平 → draw（环节平各 0.5）', () => {
    const votes = [
      v({ impressionVote: 'aff', decisionVote: 'aff', affTotal: 5, negTotal: 5 }),
      v({ impressionVote: 'neg', decisionVote: 'neg', affTotal: 5, negTotal: 5 }),
    ]
    expect(computeMatchResult(THREE, votes).winner).toBe(MatchWinner.DRAW)
  })

  it('bestSpeaker 众数；affScore/negScore 平均 round1', () => {
    const votes = [
      v({ affTotal: 5, negTotal: 4, bestSpeaker: '张三' }),
      v({ affTotal: 6, negTotal: 4.5, bestSpeaker: '张三' }),
      v({ affTotal: 7, negTotal: 5, bestSpeaker: '李四' }),
    ]
    const r = computeMatchResult(THREE, votes)
    expect(r.bestSpeaker).toBe('张三')
    expect(r.affScore).toBe(6)
    expect(r.negScore).toBe(4.5)
  })
})

describe('core match-result: percentage（百分制）', () => {
  const PCT = MatchJudgeSystem.PERCENTAGE

  it('多数决 aff 胜 → votes=null', () => {
    const votes = [
      v({ affTotal: 88, negTotal: 80 }),
      v({ affTotal: 90, negTotal: 85 }),
      v({ affTotal: 78, negTotal: 82 }),
    ]
    const r = computeMatchResult(PCT, votes)
    expect(r.winner).toBe(MatchWinner.AFF)
    expect(r.votes).toBeNull()
  })

  it('多数决平 → 总分平均分胜负', () => {
    const votes = [
      v({ affTotal: 95, negTotal: 90 }),
      v({ affTotal: 80, negTotal: 84 }),
    ]
    expect(computeMatchResult(PCT, votes).winner).toBe(MatchWinner.AFF) // 175 > 174
  })

  it('总分仍平 → draw；空 votes → draw', () => {
    const votes = [
      v({ affTotal: 95, negTotal: 90 }),
      v({ affTotal: 80, negTotal: 85 }),
    ]
    expect(computeMatchResult(PCT, votes).winner).toBe(MatchWinner.DRAW)
    expect(computeMatchResult(PCT, []).winner).toBe(MatchWinner.DRAW)
  })
})
