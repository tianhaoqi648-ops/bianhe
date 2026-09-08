// ============================================================
// core/rules/stance-utils.ts — 持方修正共享工具（Bianhe Core 单真源）
//
// 源：桌面抽辩题 src/shared/stance-utils.ts（零依赖，已单测）
// 铁律：零外部 import。
// ============================================================

/**
 * 翻转持方：'正方' => '反方'，'反方' => '正方'，其他原样返回。
 */
function flip(stance: string): string {
  if (stance === '正方') return '反方'
  if (stance === '反方') return '正方'
  return stance
}

/**
 * 修正 team_stances 数组中相邻同侧的持方。
 * - 遍历相邻两位（i=0&1, 2&3, ...），若同侧则将第二位翻转
 * - 奇数队最后一位保持不变；循环赛（全空字符串）与空数组原样返回
 */
export function normalizeStances(stances: string[]): string[] {
  if (stances.length === 0) return [...stances]
  if (stances.every((s) => !s)) return [...stances]

  const result = [...stances]
  for (let i = 0; i < result.length; i += 2) {
    if (i + 1 >= result.length) break
    if (result[i] && result[i] === result[i + 1]) {
      result[i + 1] = flip(result[i])
    }
  }
  return result
}

/**
 * 修正 versus 模式 stance_a/stance_b 同侧。
 * - 同侧时将 stance_b 翻转（保留 stance_a）；null 值原样返回
 */
export function normalizeStancePair(
  stanceA: string | null,
  stanceB: string | null
): [string | null, string | null] {
  if (stanceA && stanceB && stanceA === stanceB) {
    return [stanceA, flip(stanceA)]
  }
  return [stanceA, stanceB]
}
