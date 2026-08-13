// ============================================================
// schedule-engine.ts — 赛程排表核心算法（AI Agent v1.3.0 - Week 6 Task 34）
//
// 提供 4 种赛制的赛程生成能力，供 Agent 工具调用：
//   1. generateSingleElimination  单淘汰（标准种子位 + bye 优先高种子）
//   2. generateSingleRoundRobin   单循环（圆圈法 Circle Method）
//   3. generateDoubleElimination  双淘汰（胜者组 + 败者组 + 决赛框架）
//   4. generateSwiss              瑞士轮（第 1 轮随机配对 + 后续空框架）
//
// 设计要点：
//   - 纯算法实现，不依赖任何外部库
//   - 使用 TypeScript 严格类型，避免 any
//   - 日期计算使用原生 Date 对象，返回 YYYY-MM-DD 格式
//   - 随机配对使用 Math.random（Fisher-Yates 洗牌，与 draw-engine 保持一致）
//   - 所有函数返回 ScheduleRound[]，roundIndex 从 1 开始，matchIndex 从 0 开始
//   - bye（轮空）用 null 表示；后续轮次未知队伍用 TBD-W{r}-{m} 占位
// ============================================================

import type { ScheduleRound, ScheduleMatch } from '@shared/agent-types'

/** 简化的队伍输入类型（仅需 id 与 name） */
interface ScheduleTeam {
  id: string
  name: string
}

// ---------- 边界校验与日期工具 ----------

/**
 * 校验公共入参。
 * - teams 长度 < 2：抛 Error('至少需要 2 支队伍')
 * - restDays < 0：抛 Error('休息天数不能为负数')
 * - startDate 无效：抛 Error('开始日期无效')
 */
function validateInputs(teams: ScheduleTeam[], startDate: string, restDays: number): void {
  if (!Array.isArray(teams) || teams.length < 2) {
    throw new Error('至少需要 2 支队伍')
  }
  if (typeof restDays !== 'number' || restDays < 0) {
    throw new Error('休息天数不能为负数')
  }
  const d = new Date(startDate)
  if (isNaN(d.getTime())) {
    throw new Error('开始日期无效')
  }
}

/**
 * 计算从 startDate 起经过 days 天后的日期（YYYY-MM-DD）。
 * 使用本地时间避免 UTC 偏移导致跨日。
 */
function addDays(startDate: string, days: number): string {
  const d = new Date(startDate)
  d.setDate(d.getDate() + days)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 计算第 roundIndex 轮（从 1 开始）的日期 */
function dateOfRound(startDate: string, restDays: number, roundIndex: number): string {
  return addDays(startDate, (roundIndex - 1) * restDays)
}

/** Fisher-Yates 洗牌（原地修改，与 draw-engine 保持一致） */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 计算 ceil(log2(n))，n >= 1 */
function ceilLog2(n: number): number {
  if (n <= 1) return 0
  let r = 0
  let v = 1
  while (v < n) {
    v *= 2
    r++
  }
  return r
}

/**
 * 生成标准种子位（bracket 顺序）。
 * 递归思路：seeds(2n) 由 seeds(n) 扩展，每个种子 s 后接 (2n+1-s)。
 *   - n=2 → [1, 2]
 *   - n=4 → [1, 4, 2, 3]
 *   - n=8 → [1, 8, 4, 5, 2, 7, 3, 6]
 */
function seedPositions(bracketSize: number): number[] {
  let positions = [1, 2]
  while (positions.length < bracketSize) {
    const total = positions.length * 2
    const next: number[] = []
    for (const p of positions) {
      next.push(p)
      next.push(total + 1 - p)
    }
    positions = next
  }
  return positions
}

// ---------- SubTask 34.1：单淘汰 ----------

/**
 * 生成单淘汰赛程。
 *
 * 算法：
 *   1. 轮数 rounds = ceil(log2(N))，bracketSize = 2^rounds
 *   2. 标准种子位排列，bye 优先分配给高种子（seed > N 的位置为 bye）
 *   3. 第 1 轮：实际队伍 + bye(null)
 *   4. 后续轮次：全部 TBD 占位（引用前一轮对应 matchIndex 的胜者）
 *
 * @param teams 队伍列表（按种子序排序，索引 0 为 1 号种子）
 * @param startDate 开始日期（YYYY-MM-DD 或 ISO）
 * @param restDays 每轮间隔天数
 */
export function generateSingleElimination(
  teams: ScheduleTeam[],
  startDate: string,
  restDays: number
): ScheduleRound[] {
  validateInputs(teams, startDate, restDays)

  const n = teams.length
  const rounds = ceilLog2(n)
  const bracketSize = Math.pow(2, rounds)
  const seeds = seedPositions(bracketSize)

  const roundsList: ScheduleRound[] = []

  // 第 1 轮：种子位排列，seed > N 的位置为 bye
  const firstRoundMatches: ScheduleMatch[] = []
  for (let i = 0; i < seeds.length; i += 2) {
    const seedA = seeds[i]
    const seedB = seeds[i + 1]
    const teamA = seedA <= n ? teams[seedA - 1].id : null
    const teamB = seedB <= n ? teams[seedB - 1].id : null
    firstRoundMatches.push({
      matchIndex: firstRoundMatches.length,
      homeTeamId: teamA,
      awayTeamId: teamB,
      date: dateOfRound(startDate, restDays, 1)
    })
  }
  roundsList.push({ roundIndex: 1, matches: firstRoundMatches })

  // 后续轮次：TBD 占位，引用前一轮对应 matchIndex 的胜者
  // 第 r 轮（r>=2）的 match m：home = 前一轮 match 2m 胜者，away = 前一轮 match 2m+1 胜者
  for (let r = 2; r <= rounds; r++) {
    const prevMatchCount = bracketSize / Math.pow(2, r - 1)
    const matches: ScheduleMatch[] = []
    for (let m = 0; m < prevMatchCount / 2; m++) {
      matches.push({
        matchIndex: m,
        homeTeamId: `TBD-W${r - 1}-${2 * m}`,
        awayTeamId: `TBD-W${r - 1}-${2 * m + 1}`,
        date: dateOfRound(startDate, restDays, r)
      })
    }
    roundsList.push({ roundIndex: r, matches })
  }

  return roundsList
}

// ---------- SubTask 34.2：单循环（圆圈法） ----------

/**
 * 生成单循环赛程（圆圈法 Circle Method）。
 *
 * 算法：
 *   - 奇数队补一个 dummy（bye），变成偶数
 *   - 固定 1 号位（workArr[0]），其余顺时针旋转
 *   - 每轮 effectiveN/2 场，遇到 dummy 的队伍对手为 null（bye）
 *   - 偶数队：N-1 轮；奇数队：N 轮（补 bye 后 effectiveN-1 = N）
 *
 * @param teams 队伍列表
 * @param startDate 开始日期
 * @param restDays 每轮间隔天数
 */
export function generateSingleRoundRobin(
  teams: ScheduleTeam[],
  startDate: string,
  restDays: number
): ScheduleRound[] {
  validateInputs(teams, startDate, restDays)

  const n = teams.length
  const isOdd = n % 2 === 1
  const effectiveN = isOdd ? n + 1 : n
  const totalRounds = effectiveN - 1

  // 工作数组：[team0, team1, ..., teamN-1, (dummy=null)]
  const workArr: (ScheduleTeam | null)[] = teams.map((t) => ({ ...t }))
  if (isOdd) {
    workArr.push(null) // dummy 队，对手为 null（bye）
  }

  const roundsList: ScheduleRound[] = []

  for (let r = 0; r < totalRounds; r++) {
    const matches: ScheduleMatch[] = []
    for (let i = 0; i < effectiveN / 2; i++) {
      const home = workArr[i]
      const away = workArr[effectiveN - 1 - i]
      matches.push({
        matchIndex: i,
        homeTeamId: home ? home.id : null,
        awayTeamId: away ? away.id : null,
        date: dateOfRound(startDate, restDays, r + 1)
      })
    }
    roundsList.push({ roundIndex: r + 1, matches })

    // 旋转：固定 workArr[0]，将末尾元素插入到位置 1
    // [a, b, c, d, e, f] → [a, f, b, c, d, e]
    const last = workArr.pop()
    if (last !== undefined) {
      workArr.splice(1, 0, last)
    }
  }

  return roundsList
}

// ---------- SubTask 34.3：双淘汰 ----------

/**
 * 生成双淘汰赛程框架（胜者组 + 败者组 + 决赛）。
 *
 * 简化实现：
 *   - 胜者组轮次（roundIndex 1~R）：复用单淘汰逻辑生成对阵
 *   - 败者组轮次（roundIndex R+1~2R）：生成空框架，match 数按理论败者数计算
 *     每轮 match 数 = max(1, floor(bracketSize / 2^j))，j 为败者组内轮次序号（1 起）
 *   - 决赛轮次（roundIndex 2R+1）：1 场 TBD vs TBD
 *
 * 总轮数 = 2R + 1，R = ceil(log2(N))。
 *
 * @param teams 队伍列表
 * @param startDate 开始日期
 * @param restDays 每轮间隔天数
 */
export function generateDoubleElimination(
  teams: ScheduleTeam[],
  startDate: string,
  restDays: number
): ScheduleRound[] {
  validateInputs(teams, startDate, restDays)

  const n = teams.length
  const R = ceilLog2(n)
  const bracketSize = Math.pow(2, R)

  // 胜者组：复用单淘汰逻辑（roundIndex 1~R）
  const winnerRounds = generateSingleElimination(teams, startDate, restDays)
  const roundsList: ScheduleRound[] = [...winnerRounds]

  // 败者组：R 轮空框架（roundIndex R+1 ~ 2R）
  for (let j = 1; j <= R; j++) {
    const matchCount = Math.max(1, Math.floor(bracketSize / Math.pow(2, j)))
    const roundIndex = R + j
    const matches: ScheduleMatch[] = []
    for (let m = 0; m < matchCount; m++) {
      matches.push({
        matchIndex: m,
        homeTeamId: `TBD-L${roundIndex}-${m}-H`,
        awayTeamId: `TBD-L${roundIndex}-${m}-A`,
        date: dateOfRound(startDate, restDays, roundIndex)
      })
    }
    roundsList.push({ roundIndex, matches })
  }

  // 决赛（roundIndex 2R+1）：1 场，胜者组冠军 vs 败者组冠军
  const finalRoundIndex = 2 * R + 1
  roundsList.push({
    roundIndex: finalRoundIndex,
    matches: [
      {
        matchIndex: 0,
        homeTeamId: `TBD-WF-${R}`, // 胜者组决赛（第 R 轮）冠军
        awayTeamId: `TBD-LF-${2 * R}`, // 败者组决赛（第 2R 轮）冠军
        date: dateOfRound(startDate, restDays, finalRoundIndex)
      }
    ]
  })

  return roundsList
}

// ---------- SubTask 34.4：瑞士轮 ----------

/**
 * 生成瑞士轮赛程框架。
 *
 * 简化实现：
 *   - 总轮数 = ceil(log2(N))（标准瑞士轮轮数）
 *   - 第 1 轮：随机配对（Fisher-Yates 洗牌），奇数队补 bye（最后一支队伍 awayTeamId=null）
 *   - 后续轮次：空框架（floor(N/2) 场，对阵 TBD）
 *
 * 实际比赛结果需用户录入，后续轮次按累计积分配对的逻辑不在工具内实现。
 *
 * @param teams 队伍列表
 * @param startDate 开始日期
 * @param restDays 每轮间隔天数
 */
export function generateSwiss(
  teams: ScheduleTeam[],
  startDate: string,
  restDays: number
): ScheduleRound[] {
  validateInputs(teams, startDate, restDays)

  const n = teams.length
  const totalRounds = ceilLog2(n)
  const matchesPerRound = Math.floor(n / 2)

  const roundsList: ScheduleRound[] = []

  // 第 1 轮：随机配对
  const shuffled = shuffle(teams.map((t) => ({ ...t })))
  const firstRoundMatches: ScheduleMatch[] = []
  for (let i = 0; i < matchesPerRound; i++) {
    const home = shuffled[2 * i]
    const away = shuffled[2 * i + 1]
    firstRoundMatches.push({
      matchIndex: i,
      homeTeamId: home.id,
      awayTeamId: away.id,
      date: dateOfRound(startDate, restDays, 1)
    })
  }
  // 奇数队：最后一支队伍 bye（home=队伍, away=null）
  if (n % 2 === 1) {
    const byeTeam = shuffled[n - 1]
    firstRoundMatches.push({
      matchIndex: matchesPerRound,
      homeTeamId: byeTeam.id,
      awayTeamId: null,
      date: dateOfRound(startDate, restDays, 1)
    })
  }
  roundsList.push({ roundIndex: 1, matches: firstRoundMatches })

  // 后续轮次：空框架（TBD vs TBD）
  for (let r = 2; r <= totalRounds; r++) {
    const matches: ScheduleMatch[] = []
    for (let m = 0; m < matchesPerRound; m++) {
      matches.push({
        matchIndex: m,
        homeTeamId: `TBD-S${r}-${m}-H`,
        awayTeamId: `TBD-S${r}-${m}-A`,
        date: dateOfRound(startDate, restDays, r)
      })
    }
    roundsList.push({ roundIndex: r, matches })
  }

  return roundsList
}
