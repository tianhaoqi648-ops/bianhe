// ============================================================
// bind-team-badge.tool.ts — Agent 工具：绑定队伍 → 队徽（T6）
//
// 复用 badge-storage.setTeamBadge（写入 userData/badges/team-bindings.json）：
//   - 入参 teamId + badgeId，建立队伍与队徽的绑定关系
//
// 设计要点：
//   - 校验入参非空后调用 badge-storage 绑定
//   - 风险等级 high：会写入绑定文件，需人工确认
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import { setTeamBadge } from '../../services/badge-storage'

/** bind_team_badge 工具入参（与 parameters schema 对齐） */
export interface BindTeamBadgeArgs {
  /** 队伍 ID（必填） */
  teamId: string
  /** 队徽 ID（必填，可用 list_badges 查询） */
  badgeId: string
}

/** bind_team_badge 工具返回值 */
export interface BindTeamBadgeResult {
  /** 队伍 ID */
  teamId: string
  /** 已绑定的队徽 ID */
  badgeId: string
  /** 绑定成功标记 */
  bound: true
}

export const bindTeamBadgeTool: ToolDefinition<
  BindTeamBadgeArgs,
  BindTeamBadgeResult
> = {
  name: 'bind_team_badge',
  description:
    '为队伍绑定队徽。传入 teamId、badgeId（可用 list_badges 查询可用队徽）。该操作会写入队徽绑定文件，属于写操作，会请求你确认。',
  parameters: {
    type: 'object',
    properties: {
      teamId: {
        type: 'string',
        description: '队伍 ID（必填）'
      },
      badgeId: {
        type: 'string',
        description: '队徽 ID（必填，可用 list_badges 查询）'
      }
    },
    required: ['teamId', 'badgeId']
  },
  riskLevel: 'high',
  tier: 'dangerous',
  async execute(args: BindTeamBadgeArgs): Promise<BindTeamBadgeResult> {
    // 1. 校验入参
    const teamId = typeof args.teamId === 'string' ? args.teamId.trim() : ''
    if (!teamId) {
      throw new Error('[bind_team_badge] teamId 不能为空')
    }
    const badgeId = typeof args.badgeId === 'string' ? args.badgeId.trim() : ''
    if (!badgeId) {
      throw new Error('[bind_team_badge] badgeId 不能为空')
    }

    // 2. 绑定队伍 → 队徽
    setTeamBadge(teamId, badgeId)

    return { teamId, badgeId, bound: true }
  }
}