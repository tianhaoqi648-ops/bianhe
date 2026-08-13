// ============================================================
// schedule-engine.test.ts — 赛程排表算法单元测试（Task 51.1）
//
// 覆盖 schedule-engine.ts 的 4 个 generate 函数：
//   - generateSingleElimination：8/6/2 队 + 边界
//   - generateSingleRoundRobin：4/5/3 队
//   - generateDoubleElimination：8/4 队总轮数
//   - generateSwiss：8/16 队轮数与第 1 轮配对
//
// 公共校验：日期递增（restDays）、matchIndex 从 0 开始、roundIndex 从 1 开始。
// 纯函数测试，无需 mock。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  generateSingleElimination,
  generateSingleRoundRobin,
  generateDoubleElimination,
  generateSwiss
} from '../schedule-engine'

// ============================================================
// 工具函数
// ============================================================

/** 构造 n 支队伍 */
function makeTeams(n: number): Array<{ id: string; name: string }> {
  return Array.from({ length: n }, (_, i) => ({
    id: `T${i + 1}`,
    name: `Team ${i + 1}`
  }))
}

/** 计算 YYYY-MM-DD 加 days 天后的日期 */
function addDays(startDate: string, days: number): string {
  const d = new Date(startDate)
  d.setDate(d.getDate() + days)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const START_DATE = '2026-01-15'

// ============================================================
// generateSingleElimination
// ============================================================

describe('generateSingleElimination', () => {
  it('8 队：轮数=3，第 1 轮 4 场，含种子位排列', () => {
    const teams = makeTeams(8)
    const rounds = generateSingleElimination(teams, START_DATE, 1)

    expect(rounds).toHaveLength(3)
    expect(rounds[0].roundIndex).toBe(1)
    expect(rounds[0].matches).toHaveLength(4)

    // 8 队种子位 [1,8,4,5,2,7,3,6] → 配对 (1,8)(4,5)(2,7)(3,6)
    // team 索引 = seed-1，所以 T1 vs T8, T4 vs T5, T2 vs T7, T3 vs T6
    const m = rounds[0].matches
    expect(m[0].homeTeamId).toBe('T1')
    expect(m[0].awayTeamId).toBe('T8')
    expect(m[1].homeTeamId).toBe('T4')
    expect(m[1].awayTeamId).toBe('T5')
    expect(m[2].homeTeamId).toBe('T2')
    expect(m[2].awayTeamId).toBe('T7')
    expect(m[3].homeTeamId).toBe('T3')
    expect(m[3].awayTeamId).toBe('T6')

    // 第 2 轮 2 场，全部 TBD
    expect(rounds[1].roundIndex).toBe(2)
    expect(rounds[1].matches).toHaveLength(2)
    expect(rounds[1].matches[0].homeTeamId).toBe('TBD-W1-0')
    expect(rounds[1].matches[0].awayTeamId).toBe('TBD-W1-1')

    // 第 3 轮 1 场（决赛）
    expect(rounds[2].roundIndex).toBe(3)
    expect(rounds[2].matches).toHaveLength(1)
    expect(rounds[2].matches[0].homeTeamId).toBe('TBD-W2-0')
    expect(rounds[2].matches[0].awayTeamId).toBe('TBD-W2-1')
  })

  it('6 队：补 bye 到 8，轮数=3，第 1 轮 4 场（含 bye）', () => {
    const teams = makeTeams(6)
    const rounds = generateSingleElimination(teams, START_DATE, 1)

    expect(rounds).toHaveLength(3)
    expect(rounds[0].matches).toHaveLength(4)

    // 8 队种子位 [1,8,4,5,2,7,3,6]，seed > 6 的位置为 bye(null)
    // 配对 (1,8)(4,5)(2,7)(3,6)
    // seed 7 → team 不存在 → null；seed 8 → null
    const m = rounds[0].matches
    // T1 vs bye(8)
    expect(m[0].homeTeamId).toBe('T1')
    expect(m[0].awayTeamId).toBeNull()
    // T4 vs T5
    expect(m[1].homeTeamId).toBe('T4')
    expect(m[1].awayTeamId).toBe('T5')
    // T2 vs bye(7)
    expect(m[2].homeTeamId).toBe('T2')
    expect(m[2].awayTeamId).toBeNull()
    // T3 vs T6
    expect(m[3].homeTeamId).toBe('T3')
    expect(m[3].awayTeamId).toBe('T6')

    // 至少有 1 场含 bye
    const byeMatches = m.filter(
      (x) => x.homeTeamId === null || x.awayTeamId === null
    )
    expect(byeMatches.length).toBeGreaterThanOrEqual(1)
  })

  it('2 队：轮数=1，1 场', () => {
    const teams = makeTeams(2)
    const rounds = generateSingleElimination(teams, START_DATE, 1)

    expect(rounds).toHaveLength(1)
    expect(rounds[0].matches).toHaveLength(1)
    expect(rounds[0].matches[0].homeTeamId).toBe('T1')
    expect(rounds[0].matches[0].awayTeamId).toBe('T2')
  })

  it('边界：teams < 2 抛错', () => {
    expect(() => generateSingleElimination([], START_DATE, 1)).toThrow(
      '至少需要 2 支队伍'
    )
    expect(() =>
      generateSingleElimination(makeTeams(1), START_DATE, 1)
    ).toThrow('至少需要 2 支队伍')
  })

  it('边界：restDays < 0 抛错', () => {
    expect(() => generateSingleElimination(makeTeams(4), START_DATE, -1)).toThrow(
      '休息天数不能为负数'
    )
  })

  it('边界：startDate 无效抛错', () => {
    expect(() => generateSingleElimination(makeTeams(4), 'invalid-date', 1)).toThrow(
      '开始日期无效'
    )
  })
})

// ============================================================
// generateSingleRoundRobin
// ============================================================

describe('generateSingleRoundRobin', () => {
  it('4 队：3 轮，每轮 2 场，共 6 场（C(4,2)=6）', () => {
    const teams = makeTeams(4)
    const rounds = generateSingleRoundRobin(teams, START_DATE, 1)

    expect(rounds).toHaveLength(3)
    const totalMatches = rounds.reduce((sum, r) => sum + r.matches.length, 0)
    expect(totalMatches).toBe(6)

    for (const r of rounds) {
      expect(r.matches).toHaveLength(2)
      // 不应出现 bye（无 null）
      for (const m of r.matches) {
        expect(m.homeTeamId).not.toBeNull()
        expect(m.awayTeamId).not.toBeNull()
      }
    }
  })

  it('5 队：补 bye，5 轮，每轮 2 场（其中 1 场 bye）', () => {
    const teams = makeTeams(5)
    const rounds = generateSingleRoundRobin(teams, START_DATE, 1)

    // 5 队补 dummy → effectiveN=6 → 5 轮
    expect(rounds).toHaveLength(5)
    for (const r of rounds) {
      expect(r.matches).toHaveLength(3) // 6/2 = 3 场
      // 每轮至少有 1 场 bye（奇数队补 dummy 后每轮有 1 个 null）
      const byeMatches = r.matches.filter(
        (m) => m.homeTeamId === null || m.awayTeamId === null
      )
      expect(byeMatches.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('3 队：3 轮，每轮 1 场 + 1 bye', () => {
    const teams = makeTeams(3)
    const rounds = generateSingleRoundRobin(teams, START_DATE, 1)

    // 3 队补 dummy → effectiveN=4 → 3 轮
    expect(rounds).toHaveLength(3)
    for (const r of rounds) {
      expect(r.matches).toHaveLength(2) // 4/2 = 2 场
      // 每轮 1 场正常 + 1 场 bye
      const byeMatches = r.matches.filter(
        (m) => m.homeTeamId === null || m.awayTeamId === null
      )
      expect(byeMatches).toHaveLength(1)
    }
  })

  it('边界：teams < 2 抛错', () => {
    expect(() => generateSingleRoundRobin([], START_DATE, 1)).toThrow(
      '至少需要 2 支队伍'
    )
  })
})

// ============================================================
// generateDoubleElimination
// ============================================================

describe('generateDoubleElimination', () => {
  it('8 队：总轮数=2*3+1=7', () => {
    const teams = makeTeams(8)
    const rounds = generateDoubleElimination(teams, START_DATE, 1)

    expect(rounds).toHaveLength(7)

    // 胜者组 3 轮（roundIndex 1-3）
    expect(rounds[0].roundIndex).toBe(1)
    expect(rounds[2].roundIndex).toBe(3)
    // 第 1 轮 4 场
    expect(rounds[0].matches).toHaveLength(4)

    // 败者组 3 轮（roundIndex 4-6）
    expect(rounds[3].roundIndex).toBe(4)
    expect(rounds[5].roundIndex).toBe(6)

    // 决赛轮（roundIndex 7）：1 场
    expect(rounds[6].roundIndex).toBe(7)
    expect(rounds[6].matches).toHaveLength(1)
    expect(rounds[6].matches[0].homeTeamId).toContain('TBD-WF')
    expect(rounds[6].matches[0].awayTeamId).toContain('TBD-LF')
  })

  it('4 队：总轮数=2*2+1=5', () => {
    const teams = makeTeams(4)
    const rounds = generateDoubleElimination(teams, START_DATE, 1)

    expect(rounds).toHaveLength(5)

    // 胜者组 2 轮
    expect(rounds[0].roundIndex).toBe(1)
    expect(rounds[1].roundIndex).toBe(2)
    // 第 1 轮 2 场
    expect(rounds[0].matches).toHaveLength(2)

    // 败者组 2 轮
    expect(rounds[2].roundIndex).toBe(3)
    expect(rounds[3].roundIndex).toBe(4)

    // 决赛轮
    expect(rounds[4].roundIndex).toBe(5)
    expect(rounds[4].matches).toHaveLength(1)
  })

  it('边界：teams < 2 抛错', () => {
    expect(() => generateDoubleElimination([], START_DATE, 1)).toThrow(
      '至少需要 2 支队伍'
    )
  })
})

// ============================================================
// generateSwiss
// ============================================================

describe('generateSwiss', () => {
  it('8 队：轮数=3，第 1 轮 4 场（随机配对）', () => {
    const teams = makeTeams(8)
    const rounds = generateSwiss(teams, START_DATE, 1)

    expect(rounds).toHaveLength(3)
    expect(rounds[0].roundIndex).toBe(1)
    expect(rounds[0].matches).toHaveLength(4)

    // 第 1 轮所有队伍都被配对（无 bye，8 为偶数）
    const allTeamIds = new Set<string>()
    for (const m of rounds[0].matches) {
      expect(m.homeTeamId).not.toBeNull()
      expect(m.awayTeamId).not.toBeNull()
      allTeamIds.add(m.homeTeamId!)
      allTeamIds.add(m.awayTeamId!)
    }
    expect(allTeamIds.size).toBe(8)

    // 后续轮次为 TBD 空框架
    expect(rounds[1].matches).toHaveLength(4)
    expect(rounds[1].matches[0].homeTeamId).toContain('TBD')
    expect(rounds[1].matches[0].awayTeamId).toContain('TBD')
  })

  it('16 队：轮数=4，第 1 轮 8 场', () => {
    const teams = makeTeams(16)
    const rounds = generateSwiss(teams, START_DATE, 1)

    expect(rounds).toHaveLength(4)
    expect(rounds[0].matches).toHaveLength(8)
  })

  it('奇数队（7 队）：最后一支队伍 bye', () => {
    const teams = makeTeams(7)
    const rounds = generateSwiss(teams, START_DATE, 1)

    // ceil(log2(7)) = 3
    expect(rounds).toHaveLength(3)
    // 第 1 轮 floor(7/2)=3 场 + 1 场 bye = 4 场
    expect(rounds[0].matches).toHaveLength(4)
    // 最后 1 场含 bye（awayTeamId=null）
    const byeMatch = rounds[0].matches[3]
    expect(byeMatch.homeTeamId).not.toBeNull()
    expect(byeMatch.awayTeamId).toBeNull()
  })

  it('边界：teams < 2 抛错', () => {
    expect(() => generateSwiss([], START_DATE, 1)).toThrow('至少需要 2 支队伍')
  })
})

// ============================================================
// 公共校验
// ============================================================

describe('公共校验', () => {
  it('日期递增：每轮间隔 restDays 天', () => {
    const teams = makeTeams(8)
    const restDays = 3
    const rounds = generateSingleElimination(teams, START_DATE, restDays)

    for (const r of rounds) {
      const expectedDate = addDays(START_DATE, (r.roundIndex - 1) * restDays)
      for (const m of r.matches) {
        expect(m.date).toBe(expectedDate)
      }
    }
  })

  it('restDays=0：每轮同一天', () => {
    const teams = makeTeams(4)
    const rounds = generateSingleRoundRobin(teams, START_DATE, 0)

    for (const r of rounds) {
      for (const m of r.matches) {
        expect(m.date).toBe(START_DATE)
      }
    }
  })

  it('matchIndex 从 0 开始', () => {
    const teams = makeTeams(8)
    const rounds = generateSingleElimination(teams, START_DATE, 1)

    for (const r of rounds) {
      for (let i = 0; i < r.matches.length; i++) {
        expect(r.matches[i].matchIndex).toBe(i)
      }
    }
  })

  it('roundIndex 从 1 开始', () => {
    const teams = makeTeams(8)
    const rounds = generateSingleElimination(teams, START_DATE, 1)

    for (let i = 0; i < rounds.length; i++) {
      expect(rounds[i].roundIndex).toBe(i + 1)
    }
  })

  it('roundIndex 连续递增（双淘汰）', () => {
    const teams = makeTeams(8)
    const rounds = generateDoubleElimination(teams, START_DATE, 1)

    for (let i = 0; i < rounds.length; i++) {
      expect(rounds[i].roundIndex).toBe(i + 1)
    }
  })
})
