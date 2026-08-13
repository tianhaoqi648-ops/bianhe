// ============================================================
// optimize-team-groups.tool.test.ts — optimize_team_groups 工具入参校验测试（Task 51.5）
//
// 覆盖 optimize-team-groups.tool.ts 的入参校验：
//   - eventId 缺失 / 空 → 抛错
//   - strategy 非法 → 抛错
//   - 赛事无队伍 → 抛错
//   - balance 策略 groupCount 缺失 / 非正整数 → 抛错
//   - balance 策略 groupCount > 队伍数 → 抛错
//   - 正常 balance 分组 → 返回 groups / assignment / teamsAssigned
//   - 正常 random-seeded 分组 → 返回 groups / assignment
//
// Mock 策略：mock eventRepo 的 5 个方法，隔离工具层校验逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Team, TeamGroup } from '@shared/types'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const {
  mockListTeamsByEvent,
  mockRandomAssignGroups,
  mockListGroupsByEvent,
  mockCreateGroup,
  mockAssignTeamToGroup
} = vi.hoisted(() => ({
  mockListTeamsByEvent: vi.fn(),
  mockRandomAssignGroups: vi.fn(),
  mockListGroupsByEvent: vi.fn(),
  mockCreateGroup: vi.fn(),
  mockAssignTeamToGroup: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/db/repository/event.repo', () => ({
  eventRepo: {
    listTeamsByEvent: mockListTeamsByEvent,
    randomAssignGroups: mockRandomAssignGroups,
    listGroupsByEvent: mockListGroupsByEvent,
    createGroup: mockCreateGroup,
    assignTeamToGroup: mockAssignTeamToGroup
  }
}))

// 导入被测模块（在 mock 之后）
import { optimizeTeamGroupsTool } from '../optimize-team-groups.tool'

// ============================================================
// Mock 数据
// ============================================================

/** 构造 n 支队伍 */
function makeTeams(n: number, eventId: string = 'event-1'): Team[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `T${i + 1}`,
    name: `队伍${i + 1}`,
    event_id: eventId
  }))
}

/** 构造分组 */
function makeGroup(id: string, eventId: string, name: string, sortOrder: number): TeamGroup {
  return {
    id,
    event_id: eventId,
    name,
    sort_order: sortOrder,
    created_at: '2026-01-01T00:00:00.000Z'
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockListGroupsByEvent.mockReturnValue([])
  mockCreateGroup.mockImplementation((_input: unknown) =>
    makeGroup('g-new', 'event-1', 'A 组', 1)
  )
  mockAssignTeamToGroup.mockImplementation(() => {})
})

describe('optimize_team_groups：eventId 校验', () => {
  it('eventId 缺失 → 抛错', async () => {
    await expect(
      optimizeTeamGroupsTool.execute({
        eventId: '',
        strategy: 'balance',
        groupCount: 2
      })
    ).rejects.toThrow(/eventId 不能为空/)
  })

  it('eventId 为空白 → 抛错', async () => {
    await expect(
      optimizeTeamGroupsTool.execute({
        eventId: '   ',
        strategy: 'balance',
        groupCount: 2
      })
    ).rejects.toThrow(/eventId 不能为空/)
  })
})

describe('optimize_team_groups：strategy 校验', () => {
  it('strategy 非法 → 抛错', async () => {
    await expect(
      optimizeTeamGroupsTool.execute({
        eventId: 'event-1',
        strategy: 'invalid' as never,
        groupCount: 2
      })
    ).rejects.toThrow(/strategy 必须为 balance 或 random-seeded/)
  })
})

describe('optimize_team_groups：赛事无队伍', () => {
  it('赛事无队伍 → 抛错', async () => {
    mockListTeamsByEvent.mockReturnValue([])

    await expect(
      optimizeTeamGroupsTool.execute({
        eventId: 'event-1',
        strategy: 'balance',
        groupCount: 2
      })
    ).rejects.toThrow(/无任何队伍/)
  })
})

describe('optimize_team_groups：balance 策略 groupCount 校验', () => {
  beforeEach(() => {
    mockListTeamsByEvent.mockReturnValue(makeTeams(8))
  })

  it('groupCount 缺失 → 抛错', async () => {
    await expect(
      optimizeTeamGroupsTool.execute({
        eventId: 'event-1',
        strategy: 'balance'
      } as never)
    ).rejects.toThrow(/groupCount 为正整数/)
  })

  it('groupCount=0 → 抛错', async () => {
    await expect(
      optimizeTeamGroupsTool.execute({
        eventId: 'event-1',
        strategy: 'balance',
        groupCount: 0
      })
    ).rejects.toThrow(/groupCount 为正整数/)
  })

  it('groupCount > 队伍数 → 抛错', async () => {
    await expect(
      optimizeTeamGroupsTool.execute({
        eventId: 'event-1',
        strategy: 'balance',
        groupCount: 10
      })
    ).rejects.toThrow(/不能大于队伍数/)
  })
})

describe('optimize_team_groups：balance 策略正常分组', () => {
  beforeEach(() => {
    mockListTeamsByEvent.mockReturnValue(makeTeams(8))
    // 模拟 createGroup 按组名返回不同 id
    let groupCounter = 0
    mockCreateGroup.mockImplementation((input: { name: string }) => {
      groupCounter++
      return makeGroup(`g-${groupCounter}`, 'event-1', input.name, groupCounter)
    })
  })

  it('8 队分 2 组 → teamsAssigned=8，assignment 长度=2', async () => {
    const result = await optimizeTeamGroupsTool.execute({
      eventId: 'event-1',
      strategy: 'balance',
      groupCount: 2
    })

    expect(result.teamsAssigned).toBe(8)
    expect(result.assignment).toHaveLength(2)
    expect(result.groups).toHaveLength(2)
    // 每组 4 队
    expect(result.assignment[0].teamIds).toHaveLength(4)
    expect(result.assignment[1].teamIds).toHaveLength(4)
    // createGroup 被调用 2 次
    expect(mockCreateGroup).toHaveBeenCalledTimes(2)
    // assignTeamToGroup 被调用 8 次
    expect(mockAssignTeamToGroup).toHaveBeenCalledTimes(8)
  })

  it('8 队分 4 组 → 每组 2 队', async () => {
    const result = await optimizeTeamGroupsTool.execute({
      eventId: 'event-1',
      strategy: 'balance',
      groupCount: 4
    })

    expect(result.teamsAssigned).toBe(8)
    expect(result.assignment).toHaveLength(4)
    for (const a of result.assignment) {
      expect(a.teamIds).toHaveLength(2)
    }
  })

  it('蛇形分配：种子队伍分散到不同组', async () => {
    // 4 队分 2 组，种子 T1 T2 → 应分到不同组
    mockListTeamsByEvent.mockReturnValue(makeTeams(4))

    const result = await optimizeTeamGroupsTool.execute({
      eventId: 'event-1',
      strategy: 'balance',
      groupCount: 2,
      seedTeamIds: ['T1', 'T2']
    })

    // 种子 T1 → 组1，种子 T2 → 组2
    expect(result.assignment[0].teamIds).toContain('T1')
    expect(result.assignment[1].teamIds).toContain('T2')
  })

  it('组名按 A组/B组/... 命名', async () => {
    const result = await optimizeTeamGroupsTool.execute({
      eventId: 'event-1',
      strategy: 'balance',
      groupCount: 3
    })

    expect(result.assignment[0].groupName).toBe('A 组')
    expect(result.assignment[1].groupName).toBe('B 组')
    expect(result.assignment[2].groupName).toBe('C 组')
  })
})

describe('optimize_team_groups：random-seeded 策略', () => {
  beforeEach(() => {
    mockListTeamsByEvent.mockReturnValue(makeTeams(8))
    mockRandomAssignGroups.mockReturnValue({
      groups_plan: [
        { name: 'A 组', team_ids: ['T1', 'T2', 'T3', 'T4'], team_names: ['队伍1', '队伍2', '队伍3', '队伍4'] },
        { name: 'B 组', team_ids: ['T5', 'T6', 'T7', 'T8'], team_names: ['队伍5', '队伍6', '队伍7', '队伍8'] }
      ],
      teams_assigned: 8
    })
    mockListGroupsByEvent.mockReturnValue([
      makeGroup('g-a', 'event-1', 'A 组', 1),
      makeGroup('g-b', 'event-1', 'B 组', 2)
    ])
  })

  it('groupCount=2 → 调用 randomAssignGroups(by_group_count, 2)', async () => {
    const result = await optimizeTeamGroupsTool.execute({
      eventId: 'event-1',
      strategy: 'random-seeded',
      groupCount: 2
    })

    expect(mockRandomAssignGroups).toHaveBeenCalledWith(
      'event-1',
      'by_group_count',
      2,
      undefined,
      false,
      false
    )
    expect(result.teamsAssigned).toBe(8)
    expect(result.assignment).toHaveLength(2)
  })

  it('teamCount=4 → 计算分组数=ceil(8/4)=2', async () => {
    await optimizeTeamGroupsTool.execute({
      eventId: 'event-1',
      strategy: 'random-seeded',
      teamCount: 4
    })

    // 8 队 / 每组 4 = 2 组
    expect(mockRandomAssignGroups).toHaveBeenCalledWith(
      'event-1',
      'by_group_count',
      2,
      undefined,
      false,
      false
    )
  })

  it('overwrite=true → 透传给 randomAssignGroups', async () => {
    await optimizeTeamGroupsTool.execute({
      eventId: 'event-1',
      strategy: 'random-seeded',
      groupCount: 2,
      overwrite: true
    })

    expect(mockRandomAssignGroups).toHaveBeenCalledWith(
      'event-1',
      'by_group_count',
      2,
      undefined,
      true,
      false
    )
  })
})

describe('optimize_team_groups：工具元数据', () => {
  it('name 应为 optimize_team_groups', () => {
    expect(optimizeTeamGroupsTool.name).toBe('optimize_team_groups')
  })

  it('riskLevel 应为 high', () => {
    expect(optimizeTeamGroupsTool.riskLevel).toBe('high')
  })

  it('parameters required 应含 eventId 与 strategy', () => {
    expect(optimizeTeamGroupsTool.parameters.required).toContain('eventId')
    expect(optimizeTeamGroupsTool.parameters.required).toContain('strategy')
  })
})
