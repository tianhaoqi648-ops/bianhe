// ============================================================
// value-recommender.ts — 智能推荐算法
//
// 为导入时检测到的新值推荐最匹配的已有候选值。
// 三级匹配策略：
//   1. 精确匹配（小写化比较）→ score=1.0, reason='exact'
//   2. 包含关系（双向子串）→ score=0.9, reason='substring'
//   3. Levenshtein 相似度 ≥ 0.6 → score=相似度, reason='similar'
//   4. 相似度 < 0.6 → 不推荐，用户手动处理
// ============================================================

/** Levenshtein 距离（小写化比较） */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

/** 相似度评分（0-1，1 表示完全相同） */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

export type RecommendReason = 'exact' | 'substring' | 'similar'

export interface Recommendation {
  /** 原始新值 */
  originValue: string
  /** 推荐的目标候选值 */
  recommendedTarget: string
  /** 相似度评分 0-1 */
  score: number
  /** 匹配原因 */
  reason: RecommendReason
}

/**
 * 为一批新值推荐目标候选。
 * @param newValues 待推荐的新值数组
 * @param candidates 已有候选值数组
 * @returns 推荐结果数组（仅包含 score≥0.6 的项，未匹配的不返回）
 */
export function recommendMappings(
  newValues: string[],
  candidates: string[]
): Recommendation[] {
  const result: Recommendation[] = []
  for (const nv of newValues) {
    // 1. 精确匹配（小写化）
    const exact = candidates.find((c) => c.toLowerCase() === nv.toLowerCase())
    if (exact) {
      result.push({ originValue: nv, recommendedTarget: exact, score: 1, reason: 'exact' })
      continue
    }
    // 2. 包含关系（双向）
    const substr = candidates.find(
      (c) =>
        c.toLowerCase().includes(nv.toLowerCase()) ||
        nv.toLowerCase().includes(c.toLowerCase())
    )
    if (substr) {
      result.push({
        originValue: nv,
        recommendedTarget: substr,
        score: 0.9,
        reason: 'substring'
      })
      continue
    }
    // 3. Levenshtein 相似度
    let best = { target: '', score: 0 }
    for (const c of candidates) {
      const s = similarity(nv, c)
      if (s > best.score) best = { target: c, score: s }
    }
    if (best.score >= 0.6) {
      result.push({
        originValue: nv,
        recommendedTarget: best.target,
        score: best.score,
        reason: 'similar'
      })
    }
    // score < 0.6 不推荐
  }
  return result
}
