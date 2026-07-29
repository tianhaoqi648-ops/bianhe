// ============================================================
// value-recommender.ts — 智能推荐算法
//
// 为导入时检测到的新值推荐最匹配的已有候选值。
// 六级匹配策略（按优先级）：
//   1. numeric-prefix：数字前缀分级映射（如 "1-入门" → "入门级"）→ score=0.95
//   2. exact：精确匹配（小写化比较）→ score=1.0
//   3. synonym：同义词包含匹配（中英文、简写全称）→ score=0.92
//   4. core-keyword：核心词提取后双向子串匹配 → score=0.88
//   5. substring：原始值双向子串包含 → score=0.9
//   6. similar：Levenshtein 相似度 ≥ 0.6 → score=相似度
//   7. 相似度 < 0.6 → 返回 reason='no-match' 的未匹配记录（recommendedTarget='', score=0），UI 可显示「推荐保留」
//
// field 参数可选，传入时可启用 numeric-prefix、synonym 两层匹配，
// 否则仅使用 exact、core-keyword、substring、similar 四层。
// ============================================================

import type { CandidateField } from '../constants'

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

export type RecommendReason =
  | 'exact'
  | 'numeric-prefix'
  | 'synonym'
  | 'core-keyword'
  | 'substring'
  | 'similar'
  | 'no-match'

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

// ============================================================
// 字段级配置（仅 difficulty 内置；其他字段保留扩展点）
// ============================================================

/**
 * 字段级数字前缀映射配置。
 * 识别 "1-入门"、"2.基础"、"3、中等" 等格式时，按字段查表直接映射。
 * 用于 difficulty 等分级明确的字段。
 */
const FIELD_NUMERIC_PREFIX_MAP: Partial<Record<CandidateField, Record<number, string>>> = {
  difficulty: {
    1: '入门级',
    2: '进阶级',
    3: '专业级',
    4: '专业级',
    5: '专业级'
  }
}

/**
 * 字段级同义词配置：候选值 → 同义词数组（小写比较）。
 * 涵盖中文简称、英文译名、常见别名。
 * 新值若包含任一同义词即视为匹配该候选。
 */
const FIELD_SYNONYMS: Partial<Record<CandidateField, Record<string, string[]>>> = {
  difficulty: {
    入门级: ['入门', '初级', '简单', 'easy', 'beginner', '初阶', '基础入门'],
    进阶级: ['进阶', '基础', '中等', 'medium', 'intermediate', '中阶'],
    专业级: ['专业', '高级', '困难', '较难', 'hard', 'advanced', '高阶']
  }
  // type/domain/source/source_type 暂不配置，保留扩展空间
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 从值中提取核心关键词：
 *   - 去除前导数字 + 分隔符（如 "1-入门" → "入门"，"2.基础" → "基础"）
 *   - 去除括号后缀（如 "入门(初级)" → "入门"）
 *   - trim 空白
 *   - 转小写
 */
function extractCoreKeyword(value: string): string {
  let s = value.trim().toLowerCase()
  // 去除前导数字 + 分隔符（- . / _ : 、 空白 等）
  s = s.replace(/^\d+\s*[-./:_、\s]+/, '')
  // 去除括号后缀（中英文括号）
  s = s.replace(/\s*[（(].*?[)）]\s*$/, '')
  return s.trim()
}

/**
 * 识别 "数字-描述" 格式并提取数字前缀。
 * 匹配："1-入门"、"2.基础"、"3、中等"、"4 较难"
 * @returns 数字前缀；无匹配返回 null
 */
function extractNumericPrefix(value: string): number | null {
  const m = value.trim().match(/^(\d+)\s*[-./:_、\s]+/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

// ============================================================
// 主推荐函数
// ============================================================

/**
 * 为一批新值推荐目标候选。
 * @param newValues 待推荐的新值数组
 * @param candidates 已有候选值数组
 * @param field 字段 key（可选，启用 numeric-prefix、synonym 两层匹配）
 * @returns 推荐结果数组（包含匹配项 + 未匹配项，覆盖所有输入新值；
 *          未匹配项以 reason='no-match' 表示，recommendedTarget='', score=0）
 */
export function recommendMappings(
  newValues: string[],
  candidates: string[],
  field?: CandidateField
): Recommendation[] {
  const result: Recommendation[] = []
  for (const nv of newValues) {
    // 0. 数字前缀分级映射（最高优先级，明确规则）
    if (field) {
      const numPrefix = extractNumericPrefix(nv)
      const numMap = FIELD_NUMERIC_PREFIX_MAP[field]
      if (numPrefix !== null && numMap && numMap[numPrefix]) {
        const target = numMap[numPrefix]
        if (candidates.includes(target)) {
          result.push({
            originValue: nv,
            recommendedTarget: target,
            score: 0.95,
            reason: 'numeric-prefix'
          })
          continue
        }
      }
    }

    // 1. 精确匹配（小写化）
    const exact = candidates.find((c) => c.toLowerCase() === nv.toLowerCase())
    if (exact) {
      result.push({ originValue: nv, recommendedTarget: exact, score: 1, reason: 'exact' })
      continue
    }

    // 2. 同义词包含匹配（新增，在 substring 之前）
    if (field) {
      const synMap = FIELD_SYNONYMS[field]
      if (synMap) {
        const nvLower = nv.toLowerCase()
        let matched: string | null = null
        for (const cand of candidates) {
          const syns = synMap[cand]
          if (!syns) continue
          if (syns.some((s) => nvLower.includes(s.toLowerCase()))) {
            matched = cand
            break
          }
        }
        if (matched) {
          result.push({
            originValue: nv,
            recommendedTarget: matched,
            score: 0.92,
            reason: 'synonym'
          })
          continue
        }
      }
    }

    // 3. 核心词包含匹配（新增）
    const nvCore = extractCoreKeyword(nv)
    if (nvCore) {
      const coreMatch = candidates.find((c) => {
        const cCore = extractCoreKeyword(c)
        if (!cCore) return false
        return cCore.includes(nvCore) || nvCore.includes(cCore)
      })
      if (coreMatch) {
        result.push({
          originValue: nv,
          recommendedTarget: coreMatch,
          score: 0.88,
          reason: 'core-keyword'
        })
        continue
      }
    }

    // 4. 子串包含（双向）
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

    // 5. Levenshtein 相似度
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
    } else {
      // 未匹配项：返回 reason='no-match'，方便 UI 显示「推荐保留」
      result.push({
        originValue: nv,
        recommendedTarget: '',
        score: 0,
        reason: 'no-match'
      })
    }
  }
  return result
}
