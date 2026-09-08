// ============================================================
// core/rules/match-result.ts — 多裁判评决聚合（Bianhe Core 单真源）
//
// 源：桌面抽辩题 src/shared/match-result.ts（main/renderer 共用唯一口径）
// 铁律：零外部 import（仅 core 内部）。
// ============================================================

import type { MatchJudgeSystem, MatchWinner } from '../schema/match'

/** 参与聚合的最小评决数据结构 */
export interface MatchVoteLike {
  impressionVote?: 'aff' | 'neg' | null
  decisionVote?: 'aff' | 'neg' | null
  affTotal?: number | null
  negTotal?: number | null
  bestSpeaker?: string | null
}

/** 聚合结果（含三票制明细，供亮牌展示） */
export interface MatchResultSummary {
  winner: MatchWinner
  /** 各裁判 aff/neg 得分平均值 */
  affScore: number | null
  negScore: number | null
  bestSpeaker: string | null
  /** 三票制票型明细；百分制为 null */
  votes: {
    aff: number
    neg: number
    impression: { aff: number; neg: number }
    stage: { aff: number; neg: number }
    decision: { aff: number; neg: number }
  } | null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function numericAvg(votes: MatchVoteLike[], side: 'aff' | 'neg'): number | null {
  if (!votes.length) return null
  const sum = votes.reduce((s, v) => s + (side === 'aff' ? (v.affTotal ?? 0) : (v.negTotal ?? 0)), 0)
  return round1(sum / votes.length)
}

/**
 * 多裁判评决聚合（与桌面 computeMatchResult 口径一致）。
 * - three_votes：印象+环节(平各0.5)+决胜 → 总票多者胜；总票平→决胜票；仍平→draw
 * - percentage：每位裁判多数决；平→总分平均；仍平→draw
 */
export function computeMatchResult(system: MatchJudgeSystem, votes: MatchVoteLike[]): MatchResultSummary {
  const affScore = numericAvg(votes, 'aff')
  const negScore = numericAvg(votes, 'neg')

  // 最佳辩手：各裁判 best_speaker 票数众数
  const speakerCount = new Map<string, number>()
  for (const v of votes) {
    if (v.bestSpeaker) speakerCount.set(v.bestSpeaker, (speakerCount.get(v.bestSpeaker) ?? 0) + 1)
  }
  let bestSpeaker: string | null = null
  let bestCount = 0
  for (const [name, c] of speakerCount) {
    if (c > bestCount) {
      bestCount = c
      bestSpeaker = name
    }
  }

  if (system === 'percentage') {
    const affWin = votes.filter((v) => (v.affTotal ?? 0) > (v.negTotal ?? 0)).length
    const negWin = votes.filter((v) => (v.negTotal ?? 0) > (v.affTotal ?? 0)).length
    let winner: MatchWinner
    if (affWin > negWin) winner = 'aff'
    else if (negWin > affWin) winner = 'neg'
    else {
      const a = votes.reduce((s, v) => s + (v.affTotal ?? 0), 0)
      const n = votes.reduce((s, v) => s + (v.negTotal ?? 0), 0)
      winner = a > n ? 'aff' : n > a ? 'neg' : 'draw'
    }
    return { winner, affScore, negScore, bestSpeaker, votes: null }
  }

  let impA = 0, impN = 0, stgA = 0, stgN = 0, decA = 0, decN = 0
  for (const v of votes) {
    if (v.impressionVote === 'aff') impA++
    else if (v.impressionVote === 'neg') impN++
    const a = v.affTotal ?? 0
    const n = v.negTotal ?? 0
    if (a > n) stgA++
    else if (n > a) stgN++
    else { stgA += 0.5; stgN += 0.5 }
    if (v.decisionVote === 'aff') decA++
    else if (v.decisionVote === 'neg') decN++
  }
  const aff = impA + stgA + decA
  const neg = impN + stgN + decN
  let winner: MatchWinner
  if (aff !== neg) winner = aff > neg ? 'aff' : 'neg'
  else if (decA !== decN) winner = decA > decN ? 'aff' : 'neg'
  else winner = 'draw'

  return {
    winner,
    affScore,
    negScore,
    bestSpeaker,
    votes: {
      aff: round1(aff),
      neg: round1(neg),
      impression: { aff: impA, neg: impN },
      stage: { aff: stgA, neg: stgN },
      decision: { aff: decA, neg: decN }
    }
  }
}
