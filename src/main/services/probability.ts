// ============================================================
// probability.ts — 概率控制模块
//
// 提供：
//   1. weightedRandomSelect：加权随机选择（不重复）
//   2. getDifficultyDistribution：按轮次名返回难度比例预设
//   3. applyDifficultyDistribution：按难度比例分层抽样
//
// 纯函数，无模块级可变状态，无内部依赖。
// ============================================================

/**
 * 可加权项。任何带 weight 字段的对象都可作为候选项。
 */
export interface WeightedItem {
  weight: number
  [key: string]: any
}

/**
 * 难度分布比例。三个字段之和应为 1。
 */
export interface DifficultyDistribution {
  入门级: number
  进阶级: number
  专业级: number
}

/**
 * 难度等级常量。
 */
export const DIFFICULTY_LEVELS = ['入门级', '进阶级', '专业级'] as const
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number]

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
 *
 * 用于持方分配等需要二选一随机决策的场景。集中管理随机源，便于：
 *   - 统一替换为更安全的随机数生成器（如需可测试性或加密强度）
 *   - 测试时通过 jest.mock 拦截单一入口，避免散落各处的 Math.random
 *
 * 与 weightedRandomSelect 等加权函数不同，coinFlip 不依赖 weight 字段，
 * 仅做无权重的二选一。
 */
export function coinFlip(): boolean {
  return Math.random() < 0.5
}

// ============================================================
// weightedRandomSelect
// ============================================================

/**
 * 加权随机选择——从 items 中不重复地抽取 count 个元素。
 *
 * 算法：
 *   1. 过滤掉 weight <= 0 的项（不参与抽取）
 *   2. 重复 count 次：
 *      a. 计算当前池总权重
 *      b. 生成 [0, totalWeight) 的随机数 r
 *      c. 累加权重找到第一项累加权重 > r 的元素（线性扫描，池小时足够）
 *      d. 从池中移除该元素，加入结果
 *
 * 边界：
 *   - items 为空 → 抛 Error('候选池为空')
 *   - count <= 0 → 返回 []
 *   - 过滤后池为空（所有 weight <= 0）→ 抛 Error('候选池为空')
 *   - count >= 池大小 → 返回打乱后的全部
 *   - 每个元素被抽中概率 = weight / 总权重
 *
 * @param items 候选项数组
 * @param count 要抽取的数量
 */
export function weightedRandomSelect<T extends WeightedItem>(items: T[], count: number): T[] {
  if (count <= 0) return []
  if (items.length === 0) {
    throw new Error('候选池为空')
  }

  // 过滤掉 weight <= 0 的项
  const pool = items.filter((it) => it.weight > 0)
  if (pool.length === 0) {
    throw new Error('候选池为空')
  }

  // count >= 池大小：直接返回打乱后的全部
  if (count >= pool.length) {
    return shuffle([...pool])
  }

  const result: T[] = []
  const workingPool = [...pool]

  for (let i = 0; i < count; i++) {
    const totalWeight = workingPool.reduce((sum, it) => sum + it.weight, 0)
    if (totalWeight <= 0) {
      // 极端兜底：剩余项权重全为 0，直接随机取
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
      // P1-12 修复：不再在 r >= 0 时更新 pickedIdx
      // 浮点减法累积误差可能导致 r 永不 < 0，此时 pickedIdx 保持 0（更安全的兜底）
    }

    result.push(workingPool.splice(pickedIdx, 1)[0])
  }

  return result
}

// ============================================================
// weightedRandomSelectWithReplacement
// ============================================================

/**
 * 有放回加权随机抽取：每次独立从 pool 按权重抽一个，允许重复。
 * 返回长度 = count 的数组（可能含重复元素）。
 *
 * 与 weightedRandomSelect 的区别：
 * - weightedRandomSelect: 不放回抽样，count <= pool.length
 * - weightedRandomSelectWithReplacement: 有放回抽样，count 可大于 pool.length
 *
 * 权重逻辑与 weightedRandomSelect 保持一致：按 item.weight 字段加权。
 * 由于泛型约束为 `{ weight?: number }`，未声明 weight 字段的对象视为权重 1，
 * 与 weightedRandomSelect（约束 WeightedItem.weight 必填）形成兼容兜底。
 *
 * 边界：
 *   - pool 为空或 count <= 0 → 返回 []
 *   - 浮点误差兜底：每次抽取后若未命中任何元素，取 pool 最后一项
 *
 * @param pool 候选项数组（不会被修改）
 * @param count 要抽取的数量（可大于 pool.length）
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
    // 兜底（浮点误差）
    if (result.length <= i) result.push(pool[pool.length - 1])
  }

  return result
}

// ============================================================
// getDifficultyDistribution
// ============================================================

/**
 * 难度梯度预设规则：
 *   - 小组赛 → { 入门 0.6, 进阶 0.4, 专业 0 }
 *   - 复赛   → { 入门 0,   进阶 0.6, 专业 0.4 }
 *   - 决赛   → { 入门 0,   进阶 0,   专业 1 }
 *   - 其他   → { 入门 0.34, 进阶 0.33, 专业 0.33 }
 *
 * 匹配规则：roundName 包含关键词即命中（如 "小组赛第一轮" 命中 "小组赛"）。
 * 大小写不敏感。
 *
 * @param roundName 轮次名（来自 rounds.name 或 rounds.difficulty_override）
 */
export function getDifficultyDistribution(roundName: string | null | undefined): DifficultyDistribution {
  if (!roundName) {
    return { 入门级: 0.34, 进阶级: 0.33, 专业级: 0.33 }
  }

  const name = roundName.toLowerCase()
  if (name.includes('小组') || name.includes('分组') || name.includes('初赛')) {
    return { 入门级: 0.6, 进阶级: 0.4, 专业级: 0 }
  }
  if (name.includes('复赛') || name.includes('淘汰') || name.includes('半决赛')) {
    return { 入门级: 0, 进阶级: 0.6, 专业级: 0.4 }
  }
  if (name.includes('决赛') || name.includes('总决赛') || name.includes('冠军')) {
    return { 入门级: 0, 进阶级: 0, 专业级: 1 }
  }

  return { 入门级: 0.34, 进阶级: 0.33, 专业级: 0.33 }
}

// ============================================================
// applyDifficultyDistribution
// ============================================================

/**
 * 按难度分布从候选池中分层抽样。
 *
 * 算法：
 *   1. 把候选按 difficulty 分成三个子池（入门/进阶/专业）
 *   2. 按 distribution 比例计算各子池应抽数量（向下取整）
 *   3. 各子池用 weightedRandomSelect 抽取
 *   4. 因取整产生的余数（count - 已抽数）从所有子池剩余项中加权抽取补足
 *
 * 不足时补足逻辑：
 *   - 若某子池数量不足预期，剩余配额从其他子池的剩余项中加权抽取
 *   - 若总剩余仍不足，返回实际能抽到的（不抛错，由上层判断）
 *
 * @param candidates 候选辩题（带 weight 与 difficulty 字段）
 * @param distribution 难度分布比例
 * @param count 要抽取的总数
 */
export function applyDifficultyDistribution<T extends WeightedItem & { difficulty: string | null }>(
  candidates: T[],
  distribution: DifficultyDistribution,
  count: number
): T[] {
  if (count <= 0) return []
  if (candidates.length === 0) return []

  // 分池
  const poolByLevel: Record<DifficultyLevel, T[]> = {
    入门级: candidates.filter((c) => c.difficulty === '入门级'),
    进阶级: candidates.filter((c) => c.difficulty === '进阶级'),
    专业级: candidates.filter((c) => c.difficulty === '专业级')
  }

  // 计算各池目标数量（向下取整）
  const targetEntry = Math.floor(count * distribution.入门级)
  const targetInter = Math.floor(count * distribution.进阶级)
  const targetPro = Math.floor(count * distribution.专业级)

  // 各池抽取
  const result: T[] = []
  const remaining: T[] = [] // 各池抽完后的剩余项，用于补足

  for (const level of DIFFICULTY_LEVELS) {
    const pool = poolByLevel[level]
    const target = level === '入门级' ? targetEntry : level === '进阶级' ? targetInter : targetPro

    if (pool.length === 0 || target === 0) {
      // 池空或配额为 0，全部进 remaining
      remaining.push(...pool)
      continue
    }

    const actualTarget = Math.min(target, pool.length)
    const picked = weightedRandomSelect(pool, actualTarget)
    result.push(...picked)

    // 未被抽中的进 remaining
    const pickedIds = new Set(picked.map((p) => p))
    for (const item of pool) {
      if (!pickedIds.has(item)) remaining.push(item)
    }
  }

  // 补足余数
  const deficit = count - result.length
  if (deficit > 0 && remaining.length > 0) {
    const supplement = weightedRandomSelect(remaining, Math.min(deficit, remaining.length))
    result.push(...supplement)
  }

  return result
}
