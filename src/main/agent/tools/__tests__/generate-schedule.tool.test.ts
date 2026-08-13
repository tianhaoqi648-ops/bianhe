// ============================================================
// generate-schedule.tool.test.ts — generate_schedule 工具入参校验测试（Task 51.5）
//
// 覆盖 generate-schedule.tool.ts 的入参校验：
//   - format 缺失 / 非法 → 抛错
//   - startDate 缺失 / 无效 → 抛错
//   - teams 与 teamCount 均缺失 → 抛错
//   - teams 少于 2 支 → 抛错
//   - teamCount < 2 → 抛错
//   - 正常入参（teams / teamCount / 4 种赛制）→ 返回 rounds
//
// Mock 策略：使用真实 schedule-engine（纯函数，已在 schedule-engine.test.ts 覆盖），
// 仅校验工具层的入参校验与参数透传。
// ============================================================

import { describe, it, expect } from 'vitest'
import { generateScheduleTool } from '../generate-schedule.tool'

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

const VALID_ARGS = {
  format: 'single-elimination' as const,
  startDate: '2026-01-15',
  teamCount: 8
}

// ============================================================
// 测试用例
// ============================================================

describe('generate_schedule：format 校验', () => {
  it('format 缺失 → 抛错', async () => {
    await expect(
      generateScheduleTool.execute({
        startDate: '2026-01-15',
        teamCount: 8
      } as never)
    ).rejects.toThrow(/format 必须为/)
  })

  it('format 非法 → 抛错', async () => {
    await expect(
      generateScheduleTool.execute({
        format: 'triple-elimination' as never,
        startDate: '2026-01-15',
        teamCount: 8
      })
    ).rejects.toThrow(/format 必须为/)
  })
})

describe('generate_schedule：startDate 校验', () => {
  it('startDate 缺失 → 抛错', async () => {
    await expect(
      generateScheduleTool.execute({
        format: 'single-elimination',
        startDate: '',
        teamCount: 8
      })
    ).rejects.toThrow(/startDate 不能为空/)
  })

  it('startDate 无效 → 抛错', async () => {
    await expect(
      generateScheduleTool.execute({
        format: 'single-elimination',
        startDate: 'not-a-date',
        teamCount: 8
      })
    ).rejects.toThrow(/startDate 无效/)
  })
})

describe('generate_schedule：teams / teamCount 校验', () => {
  it('teams 与 teamCount 均缺失 → 抛错', async () => {
    await expect(
      generateScheduleTool.execute({
        format: 'single-elimination',
        startDate: '2026-01-15'
      } as never)
    ).rejects.toThrow(/需提供 teams|teamCount/)
  })

  it('teams 少于 2 支 → 抛错', async () => {
    await expect(
      generateScheduleTool.execute({
        format: 'single-elimination',
        startDate: '2026-01-15',
        teams: [{ id: 'T1', name: 'Team 1' }]
      })
    ).rejects.toThrow(/teams 至少需要 2 支队伍/)
  })

  it('teamCount < 2 → 抛错（落入 teams/teamCount 缺失分支）', async () => {
    await expect(
      generateScheduleTool.execute({
        format: 'single-elimination',
        startDate: '2026-01-15',
        teamCount: 1
      })
    ).rejects.toThrow(/需提供 teams|teamCount/)
  })
})

describe('generate_schedule：正常入参', () => {
  it('single-elimination + teamCount=8 → 返回 rounds', async () => {
    const result = await generateScheduleTool.execute({ ...VALID_ARGS })
    expect(result).toHaveProperty('rounds')
    expect(Array.isArray(result.rounds)).toBe(true)
    expect(result.rounds.length).toBeGreaterThan(0)
  })

  it('single-round-robin + teams=4 → 返回 rounds', async () => {
    const result = await generateScheduleTool.execute({
      format: 'single-round-robin',
      startDate: '2026-01-15',
      teams: makeTeams(4)
    })
    expect(result).toHaveProperty('rounds')
    expect(result.rounds.length).toBeGreaterThan(0)
  })

  it('double-elimination + teamCount=8 → 返回 rounds', async () => {
    const result = await generateScheduleTool.execute({
      format: 'double-elimination',
      startDate: '2026-01-15',
      teamCount: 8
    })
    expect(result).toHaveProperty('rounds')
    expect(result.rounds.length).toBeGreaterThan(0)
  })

  it('swiss + teamCount=8 → 返回 rounds', async () => {
    const result = await generateScheduleTool.execute({
      format: 'swiss',
      startDate: '2026-01-15',
      teamCount: 8
    })
    expect(result).toHaveProperty('rounds')
    expect(result.rounds.length).toBeGreaterThan(0)
  })

  it('teams 优先于 teamCount', async () => {
    // 同时提供 teams（4 队）与 teamCount=8，应使用 teams（4 队）
    const result = await generateScheduleTool.execute({
      format: 'single-elimination',
      startDate: '2026-01-15',
      teams: makeTeams(4),
      teamCount: 8
    })
    // 4 队单淘汰 = 2 轮（若用 8 队会是 3 轮）
    expect(result.rounds).toHaveLength(2)
  })

  it('restDays 默认为 1', async () => {
    const result = await generateScheduleTool.execute({
      format: 'single-elimination',
      startDate: '2026-01-15',
      teamCount: 4
    })
    // 4 队单淘汰 = 2 轮，restDays=1 → 第 2 轮日期 = 2026-01-16
    // date 字段在 ScheduleMatch 上，而非 ScheduleRound
    expect(result.rounds[0].matches[0].date).toBe('2026-01-15')
    expect(result.rounds[1].matches[0].date).toBe('2026-01-16')
  })

  it('restDays=0 → 同一天', async () => {
    const result = await generateScheduleTool.execute({
      format: 'single-elimination',
      startDate: '2026-01-15',
      teamCount: 4,
      restDays: 0
    })
    expect(result.rounds[0].matches[0].date).toBe('2026-01-15')
    expect(result.rounds[1].matches[0].date).toBe('2026-01-15')
  })
})

describe('generate_schedule：工具元数据', () => {
  it('name 应为 generate_schedule', () => {
    expect(generateScheduleTool.name).toBe('generate_schedule')
  })

  it('riskLevel 应为 high', () => {
    expect(generateScheduleTool.riskLevel).toBe('high')
  })

  it('parameters required 应含 format 与 startDate', () => {
    expect(generateScheduleTool.parameters.required).toContain('format')
    expect(generateScheduleTool.parameters.required).toContain('startDate')
  })
})
