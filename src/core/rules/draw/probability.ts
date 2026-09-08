// ============================================================
// core/rules/draw/probability.ts — 概率控制（Bianhe Core 单真源）
//
// 源：桌面抽辩题 src/main/services/probability.ts 移植（难度键统一为规范档）
// 提供：weightedRandomSelect / weightedRandomSelectWithReplacement /
//       applyDifficultyDistribution（分池归一化兼容层）/ coinFlip
// 铁律：零外部 import（仅 core 内部）。
// ============================================================

import {
  DIFFICULTY_LEVELS,
  DifficultyLevel,
  DifficultyDistribution,
  getDifficultyDistribution,
  normalizeDifficulty
} from '../difficulty'

export type { DifficultyDistribution, DifficultyLevel }
export { DIFFICULTY_LEVELS, getDifficultyDistribution }

/**
 * 可加权项。任何带 weight 字段的对象都可作为候选项。
 */
export interface WeightedItem {
  weight: number
  [key: string]: any
}

// ============================================================
// 内部工具
// ============================================================

/**
 * Fisher-Yates 洗牌，原地打乱。
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ============================================================
// coinFlip
// ============================================================

/**
 * 公平硬币翻转：返回 true/false，各约 50% 概率。
 */
export function coinFlip(): boolean {
  return Math.random() < 0.5
}

// ============================================================
// weightedRandomSelect
// ============================================================

/**
 * 加权随机选择——从 items 中不重复地抽取 count 个元素。
 * 边界：items 空/过滤后池空 → 抛 '候选池为空'；count<=0 → []；count>=池大小 → 打乱后全部。
 */
export function weightedRandomSelect<T extends WeightedItem>(items: T[], count: number): T[] {
  if (count <= 0) return []
  if (items.length === 0) {
    throw new Error('候选池为空')
  }

  const pool = items.filter((it) => it.weight > 0)
  if (pool.length === 0) {
    throw new Error('候选池为空')
  }

  if (count >= pool.length) {
    return shuffle([...pool])
  }

  const result: T[] = []
  const workingPool = [...pool]

  for (let i = 0; i < count; i++) {
    const totalWeight = workingPool.reduce((sum, it) => sum + it.weight, 0)
    if (totalWeight <= 0) {
      const idx = Math.floor(Math.random() * workingPool.length)
      result.push(workingPool.splice(idx, 1)[0])
      continue
    }

    let r = Math.random() * totalWeight
    let pickedIdx = 0
    for (let j = 0; j < workingPool.length; j++) {
      r -= workingPool[j].weight
      if (r < 0) {
        pickedIdx = j
        break
      }
    }

    result.push(workingPool.splice(pickedIdx, 1)[0])
  }

  return result
}

// ============================================================
// weightedRandomSelectWithReplacement
// ============================================================

/**
 * 有放回加权随机抽取：每次独立按权重抽一个，允许重复。
 * 边界：pool 空或 count<=0 → []；浮点误差兜底取 pool 最后一项。
 */
export function weightedRandomSelectWithReplacement<T extends { weight?: number }>(
  pool: T[],
  count: number
): T[] {
  if (pool.length === 0 || count <= 0) return []

  const result: T[] = []
  const totalWeight = pool.reduce((sum, item) => sum + (item.weight ?? 1), 0)

  for (let i = 0; i < count; i++) {
    let r = Math.random() * totalWeight
    for (const item of pool) {
      r -= (item.weight ?? 1)
      if (r < 0) {
        result.push(item)
        break
      }
    }
    if (result.length <= i) result.push(pool[pool.length - 1])
  }

  return result
}

// ============================================================
// applyDifficultyDistribution（分池归一化兼容层）
// ============================================================

/** 候选难度是否命中规范档（'入门级'/'大师级' 归一化后匹配） */
function matchesLevel(difficulty: string | null, level: DifficultyLevel): boolean {
  return normalizeDifficulty(difficulty) === level
}

/** 分布键兼容读取（distribution 可能来自旧桌面代码的标签键 '入门级' 等） */
function distValue(dist: DifficultyDistribution, level: DifficultyLevel): number {
  const labelKey = level === '入门' ? '入门级' : level === '进阶' ? '进阶级' : '专业级'
  return (dist as any)[level] ?? (dist as any)[labelKey] ?? 0
}

/**
 * 按难度分布从候选池中分层抽样（难度键归一化兼容：候选 '入门级' 正确进池）。
 * 算法与两端原实现一致：分池 → 按比例各池加权抽取 → 余数从剩余项补足。
 */
export function applyDifficultyDistribution<T extends WeightedItem & { difficulty: string | null }>(
  candidates: T[],
  distribution: DifficultyDistribution,
  count: number
): T[] {
  if (count <= 0) return []
  if (candidates.length === 0) return []

  const poolByLevel: Record<DifficultyLevel, T[]> = {
    入门: candidates.filter((c) => matchesLevel(c.difficulty, '入门')),
    进阶: candidates.filter((c) => matchesLevel(c.difficulty, '进阶')),
    专业: candidates.filter((c) => matchesLevel(c.difficulty, '专业'))
  }

  const targetEntry = Math.floor(count * distValue(distribution, '入门'))
  const targetInter = Math.floor(count * distValue(distribution, '进阶'))
  const targetPro = Math.floor(count * distValue(distribution, '专业'))

  const result: T[] = []
  const remaining: T[] = []

  for (const level of DIFFICULTY_LEVELS) {
    const pool = poolByLevel[level]
    const target = level === '入门' ? targetEntry : level === '进阶' ? targetInter : targetPro

    if (pool.length === 0 || target === 0) {
      remaining.push(...pool)
      continue
    }

    const actualTarget = Math.min(target, pool.length)
    const picked = weightedRandomSelect(pool, actualTarget)
    result.push(...picked)

    const pickedIds = new Set(picked.map((p) => p))
    for (const item of pool) {
      if (!pickedIds.has(item)) remaining.push(item)
    }
  }

  const deficit = count - result.length
  if (deficit > 0 && remaining.length > 0) {
    const supplement = weightedRandomSelect(remaining, Math.min(deficit, remaining.length))
    result.push(...supplement)
  }

  return result
}
