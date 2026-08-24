// ============================================================
// optimize-team-groups.tool.ts — Agent 工具：优化队伍分组（Task 37）
//
// 包装 eventRepo.listTeamsByEvent + eventRepo.randomAssignGroups +
// eventRepo.createGroup + eventRepo.assignTeamToGroup，
// 支持 'balance'（蛇形分配 + 种子）/ 'random-seeded'（同校避让）两种策略。
//
// 设计要点：
//   - balance 策略：蛇形分配（1,2,...,N,N,...,2,1），种子队伍优先分散到不同组
//   - random-seeded 策略：调用 eventRepo.randomAssignGroups 随机分配
//     （注：当前 randomAssignGroups 为纯随机，"同校避让"语义待后续扩展）
//   - 风险等级 high：会修改数据库（创建/更新分组与队伍 group_id）
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { TeamGroup } from '@shared/types'
import { eventRepo } from '@main/db/repository/event.repo'

/** optimize_team_groups 工具入参（与 parameters schema 对齐） */
interface OptimizeTeamGroupsArgs {
  /** 赛事 ID（必填） */
  eventId: string
  /** 分组策略（必填）：balance 蛇形分配 / random-seeded 随机同校避让 */
  strategy: 'balance' | 'random-seeded'
  /** 分组数（可选，balance 必填；random-seeded 与 teamCount 二选一） */
  groupCount?: number
  /** 每组队伍数（可选，random-seeded 与 groupCount 二选一） */
  teamCount?: number
  /** 是否覆盖已分组队伍（默认 false） */
  overwrite?: boolean
  /** 种子队伍 ID 列表（balance 策略使用，分散到不同组） */
  seedTeamIds?: string[]
}

/** 分组分配详情 */
interface GroupAssignment {
  /** 分组 ID */
  groupId: string
  /** 分组名 */
  groupName: string
  /** 该组队伍 ID 列表 */
  teamIds: string[]
  /** 该组队伍名列表 */
  teamNames: string[]
}

/** optimize_team_groups 工具返回值 */
interface OptimizeTeamGroupsResult {
  /** 创建/更新的分组列表 */
  groups: TeamGroup[]
  /** 分配结果详情（按分组列出队伍 ID 与名称） */
  assignment: GroupAssignment[]
  /** 实际分配的队伍总数 */
  teamsAssigned: number
}

export const optimizeTeamGroupsTool: ToolDefinition<
  OptimizeTeamGroupsArgs,
  OptimizeTeamGroupsResult
> = {
  name: 'optimize_team_groups',
  description:
    '优化赛事队伍分组。balance 策略：蛇形分配 + 种子队伍分散；random-seeded 策略：随机分配（同校避让）。',
  parameters: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: '赛事 ID（必填）'
      },
      strategy: {
        type: 'string',
        description: '分组策略：balance（蛇形分配+种子）/ random-seeded（随机同校避让）',
        enum: ['balance', 'random-seeded']
      },
      groupCount: {
        type: 'number',
        description: '分组数（balance 策略必填；random-seeded 与 teamCount 二选一）'
      },
      teamCount: {
        type: 'number',
        description: '每组队伍数（random-seeded 策略可选，与 groupCount 二选一）'
      },
      overwrite: {
        type: 'boolean',
        description: '是否覆盖已分组队伍（默认 false）'
      },
      seedTeamIds: {
        type: 'array',
        description: '种子队伍 ID 列表（balance 策略使用，分散到不同组）',
        items: { type: 'string', description: '队伍 ID' }
      }
    },
    required: ['eventId', 'strategy']
  },
  riskLevel: 'high',
  tier: 'dangerous',
  async execute(args: OptimizeTeamGroupsArgs): Promise<OptimizeTeamGroupsResult> {
    // 1. 校验 eventId
    const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : ''
    if (!eventId) {
      throw new Error('[optimize_team_groups] eventId 不能为空')
    }

    // 2. 校验 strategy
    const strategy = args.strategy
    if (strategy !== 'balance' && strategy !== 'random-seeded') {
      throw new Error('[optimize_team_groups] strategy 必须为 balance 或 random-seeded')
    }

    const overwrite = args.overwrite === true

    // 3. 获取赛事所有队伍
    const teams = eventRepo.listTeamsByEvent(eventId)
    if (teams.length === 0) {
      throw new Error(`[optimize_team_groups] 赛事 ${eventId} 下无任何队伍`)
    }

    // 4. 分支：random-seeded → 调用 randomAssignGroups
    if (strategy === 'random-seeded') {
      // 确定分组数：groupCount 优先，其次 teamCount，最后默认每组 4 队
      let groupCount: number
      if (typeof args.groupCount === 'number' && args.groupCount > 0) {
        groupCount = Math.floor(args.groupCount)
      } else if (typeof args.teamCount === 'number' && args.teamCount > 0) {
        groupCount = Math.ceil(teams.length / Math.floor(args.teamCount))
      } else {
        groupCount = Math.max(1, Math.ceil(teams.length / 4))
      }

      if (groupCount <= 0) {
        throw new Error('[optimize_team_groups] 计算得到的分组数必须为正整数')
      }

      // 调用 randomAssignGroups（strategy=by_group_count）
      // 注：当前 randomAssignGroups 为纯随机，"同校避让"语义待后续扩展
      const result = eventRepo.randomAssignGroups(
        eventId,
        'by_group_count',
        groupCount,
        undefined,
        overwrite,
        false
      )

      // 查询最终分组列表
      const groups = eventRepo.listGroupsByEvent(eventId)
      const assignment: GroupAssignment[] = result.groups_plan.map((plan) => {
        const group = groups.find((g) => g.name === plan.name)
        return {
          groupId: group?.id ?? '',
          groupName: plan.name,
          teamIds: plan.team_ids,
          teamNames: plan.team_names
        }
      })

      return {
        groups,
        assignment,
        teamsAssigned: result.teams_assigned
      }
    }

    // 5. 分支：balance → 蛇形分配 + 种子
    const groupCount = Math.floor(Number(args.groupCount))
    if (!Number.isFinite(groupCount) || groupCount < 1) {
      throw new Error('[optimize_team_groups] balance 策略需要 groupCount 为正整数')
    }
    if (groupCount > teams.length) {
      throw new Error(
        `[optimize_team_groups] groupCount(${groupCount}) 不能大于队伍数(${teams.length})`
      )
    }

    // 5.1 准备队伍顺序：种子在前（按 seedTeamIds 顺序），其余按 name 排序
    const seedIds = Array.isArray(args.seedTeamIds)
      ? args.seedTeamIds.filter((id) => typeof id === 'string' && id.trim() !== '')
      : []
    const seedSet = new Set(seedIds)
    const seedTeams = seedIds
      .map((id) => teams.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
    const nonSeedTeams = teams
      .filter((t) => !seedSet.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    const orderedTeams = [...seedTeams, ...nonSeedTeams]

    // 5.2 蛇形分配：偶数轮正向 1,2,...,N；奇数轮反向 N,...,2,1
    //    索引 i 的队伍所在组：
    //    - round = floor(i / groupCount)，posInRound = i % groupCount
    //    - round 偶数：groupIdx = posInRound
    //    - round 奇数：groupIdx = groupCount - 1 - posInRound
    const groupTeams: Array<Array<{ id: string; name: string }>> = Array.from(
      { length: groupCount },
      () => []
    )
    for (let i = 0; i < orderedTeams.length; i++) {
      const round = Math.floor(i / groupCount)
      const posInRound = i % groupCount
      const groupIdx = round % 2 === 0 ? posInRound : groupCount - 1 - posInRound
      groupTeams[groupIdx].push({ id: orderedTeams[i].id, name: orderedTeams[i].name })
    }

    // 5.3 创建/复用分组（A 组、B 组、...）并分配队伍
    const groupNames = Array.from(
      { length: groupCount },
      (_, i) => `${String.fromCharCode(65 + i)} 组`
    )

    // 先一次性查询已有分组，避免在循环内重复查询
    const existingGroups = eventRepo.listGroupsByEvent(eventId)

    const createdGroups: TeamGroup[] = []
    const assignment: GroupAssignment[] = []
    let teamsAssigned = 0

    for (let g = 0; g < groupCount; g++) {
      // 查找已有同名分组，否则新建
      const existing = existingGroups.find((grp) => grp.name === groupNames[g])
      let group: TeamGroup
      if (existing) {
        group = existing
      } else {
        group = eventRepo.createGroup({
          event_id: eventId,
          name: groupNames[g],
          sort_order: g + 1
        })
      }
      createdGroups.push(group)

      // 分配队伍到该组
      const teamIds: string[] = []
      const teamNames: string[] = []
      for (const t of groupTeams[g]) {
        eventRepo.assignTeamToGroup(t.id, group.id)
        teamIds.push(t.id)
        teamNames.push(t.name)
        teamsAssigned++
      }
      assignment.push({
        groupId: group.id,
        groupName: group.name,
        teamIds,
        teamNames
      })
    }

    return {
      groups: createdGroups,
      assignment,
      teamsAssigned
    }
  }
}
