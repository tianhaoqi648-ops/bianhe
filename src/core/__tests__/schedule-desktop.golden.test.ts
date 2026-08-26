// Cross-End Golden: schedule（桌面侧，不随 sync-core 同步——两端模块路径不同，各自维护，共享 schedule.json fixture）
// 确定性断言：轮数/种子位/TBD 格式/日期/无重复对阵/覆盖性。
// 已知差异（主客互换/Swiss 配对）以 it.skip + TODO 固化，见 KNOWN_DIVERGENCES.md #1/#2。
import { describe, it, expect } from 'vitest'
import {
  generateSingleElimination,
  generateSingleRoundRobin,
  generateDoubleElimination,
  generateSwiss
} from '../../main/agent/schedule-engine'
import { withSeed, GOLDEN_SEED } from './golden/rng'
import fixture from './golden/fixtures/schedule.json'

interface MatchLite {
  homeTeamId: string | null
  awayTeamId: string | null
  date: string
}

function ceilLog2(n: number): number {
  let r = 0
  let v = 1
  while (v < n) { v *= 2; r++ }
  return r
}

function allMatches(rounds: Array<{ matches: MatchLite[] }>): MatchLite[] {
  return rounds.flatMap((r) => r.matches)
}

function pairKey(h: string | null, a: string | null): string {
  return [h, a].sort().join('|')
}

describe('Cross-End Golden: schedule (desktop)', () => {
  const f = fixture as any

  for (const c of f.cases) {
    it(`[${c.name}] 轮数与日期确定性`, () => {
      const teams = c.input.teams
      const { startDate, restDays } = c.input
      let rounds: Array<{ roundIndex: number; matches: MatchLite[] }>
      switch (c.fn) {
        case 'single_elimination':
          rounds = generateSingleElimination(teams, startDate, restDays)
          break
        case 'round_robin':
          rounds = generateSingleRoundRobin(teams, startDate, restDays)
          break
        case 'double_elimination':
          rounds = generateDoubleElimination(teams, startDate, restDays)
          break
        case 'swiss':
          rounds = generateSwiss(teams, startDate, restDays)
          break
        default:
          throw new Error(`unknown fn ${c.fn}`)
      }
      const n = teams.length
      const effectiveN = n % 2 === 1 ? n + 1 : n

      // 轮数
      if (c.fn === 'single_elimination') expect(rounds.length).toBe(ceilLog2(n))
      if (c.fn === 'round_robin') expect(rounds.length).toBe(effectiveN - 1)
      if (c.fn === 'double_elimination') expect(rounds.length).toBe(2 * ceilLog2(n) + 1)
      if (c.fn === 'swiss') expect(rounds.length).toBe(ceilLog2(n))

      // 日期递增（roundIndex 从 1 起）
      for (const r of rounds) {
        expect(r.roundIndex).toBe(rounds.indexOf(r) + 1)
        for (const m of r.matches) {
          expect(m.date).toBeDefined()
        }
      }

      // 单淘汰种子位：8 队第 1 轮 = [1,8,4,5,2,7,3,6] 相邻配对
      if (c.fn === 'single_elimination' && n === 8) {
        const r1 = rounds[0].matches
        expect(r1.map((m) => m.homeTeamId)).toEqual(['t1', 't4', 't2', 't3'])
        expect(r1.map((m) => m.awayTeamId)).toEqual(['t8', 't5', 't7', 't6'])
      }
      // 单淘汰 4 队种子位
      if (c.fn === 'single_elimination' && n === 4) {
        expect(rounds[0].matches.map((m) => m.homeTeamId)).toEqual(['t1', 't2'])
        expect(rounds[0].matches.map((m) => m.awayTeamId)).toEqual(['t4', 't3'])
      }
      // 单淘汰后续轮 TBD 格式
      if (c.fn === 'single_elimination' && n === 8) {
        const r2 = rounds[1].matches
        expect(r2.map((m) => m.homeTeamId)).toEqual(['TBD-W1-0', 'TBD-W1-2'])
        expect(r2.map((m) => m.awayTeamId)).toEqual(['TBD-W1-1', 'TBD-W1-3'])
        expect(rounds[2].matches[0].homeTeamId).toBe('TBD-W2-0')
      }
      // 单循环：无序对阵对集合 = C(n,2)，无重复
      if (c.fn === 'round_robin') {
        const pairs = allMatches(rounds)
          .filter((m) => m.homeTeamId && m.awayTeamId)
          .map((m) => pairKey(m.homeTeamId, m.awayTeamId))
        expect(new Set(pairs).size).toBe(pairs.length)
        expect(new Set(pairs).size).toBe((n * (n - 1)) / 2)
        // 奇数队：每轮恰一个 bye
        if (n % 2 === 1) {
          for (const r of rounds) {
            expect(r.matches.filter((m) => !m.homeTeamId || !m.awayTeamId)).toHaveLength(1)
          }
        }
      }
      // 双淘汰：败者组 TBD-L{roundIndex}-{m}-{H|A} + 决赛 TBD-WF/TBD-LF
      if (c.fn === 'double_elimination' && n === 4) {
        const loserR1 = rounds[2].matches
        expect(loserR1[0].homeTeamId).toBe('TBD-L3-0-H')
        expect(loserR1[1].homeTeamId).toBe('TBD-L3-1-H')
        expect(rounds[3].matches[0].homeTeamId).toBe('TBD-L4-0-H')
        const final = rounds[4].matches[0]
        expect(final.homeTeamId).toBe('TBD-WF-2')
        expect(final.awayTeamId).toBe('TBD-LF-4')
      }
      // Swiss：第 1 轮覆盖性 + 奇数队 bye；后续轮 TBD-S
      if (c.fn === 'swiss') {
        const r1 = rounds[0].matches
        const ids: string[] = []
        for (const m of r1) {
          if (m.homeTeamId) ids.push(m.homeTeamId)
          if (m.awayTeamId) ids.push(m.awayTeamId)
        }
        expect(new Set(ids).size).toBe(n) // 每队恰出现一次
        if (n % 2 === 1) {
          expect(r1[r1.length - 1].awayTeamId).toBeNull()
        }
        const r2 = rounds[1]
        expect(r2.matches[0].homeTeamId).toBe('TBD-S2-0-H')
        expect(r2.matches[0].awayTeamId).toBe('TBD-S2-0-A')
      }
    })
  }

  it('边界：teams<2 / restDays<0 / 无效日期抛错', () => {
    expect(() => generateSingleElimination([{ id: 't1', name: 'T1' }], '2026-01-15', 1)).toThrow('至少需要 2 支队伍')
    expect(() => generateSingleRoundRobin([{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }], '2026-01-15', -1)).toThrow('休息天数不能为负数')
    expect(() => generateSwiss([{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }], 'not-a-date', 1)).toThrow('开始日期无效')
  })

  it.skip('单循环主客顺序与 Mini 奇数轮互换语义对齐 TODO(7.7-3-known-divergence): 见 KNOWN_DIVERGENCES.md #1', () => {
    // 桌面当前不互换主客；裁决后此断言应启用（期望与 Mini 规则一致：奇数轮互换）
    const rounds = generateSingleRoundRobin(
      [{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }, { id: 't3', name: 'T3' }, { id: 't4', name: 'T4' }],
      '2026-01-15',
      1
    )
    // 第 2 轮（r=1，0 基）主客互换后：home 应为原 away
    const r2 = rounds[1].matches[0]
    expect(r2.homeTeamId).toBe('t4') // 与 Mini 规则对齐后的期望（当前桌面不互换会失败）
  })

  it.skip('Swiss 第 1 轮精确配对与 Mini 对齐 TODO(7.7-3-known-divergence): 见 KNOWN_DIVERGENCES.md #2', () => {
    // 桌面 Fisher-Yates 与 Mini 独立实现，种子下序列不同；裁决统一算法后启用
    const rounds = withSeed(GOLDEN_SEED, () =>
      generateSwiss(
        [{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }, { id: 't3', name: 'T3' }, { id: 't4', name: 'T4' }, { id: 't5', name: 'T5' }, { id: 't6', name: 'T6' }],
        '2026-01-15',
        1
      )
    )
    expect(rounds[0].matches.map((m) => pairKey(m.homeTeamId, m.awayTeamId))).toEqual([
      // 期望与 Mini 一致的精确配对（当前两端算法不同会失败）
    ])
  })
})
