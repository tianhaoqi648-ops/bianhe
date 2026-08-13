// ============================================================
// create-event.tool.ts — Agent 工具：创建赛事（Task 11.2）
//
// 调用 eventRepo.createEvent 写入赛事主体。
//
// 入参说明：
//   - name      赛事名称（必填），直接传给 EventCreateInput.name
//   - format    赛制（语义化输入，EventCreateInput 不含该字段）
//               赛制关联需在赛事创建后通过其他 API 单独配置，此处不传给 repo
//   - teamCount 期望队伍数量（语义化输入，EventCreateInput 不含该字段）
//               队伍为独立资源，需通过其他 API 单独创建，此处仅做范围校验
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import { eventRepo } from '@main/db/repository/event.repo'

export const createEventTool: ToolDefinition = {
  name: 'create_event',
  description: '创建赛事。仅写入赛事主体，赛制与队伍需后续单独配置。',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: '赛事名称（必填）'
      },
      format: {
        type: 'string',
        description: '赛制（如"英式辩论"、"中式辩论"）。语义化输入，赛事创建后需单独配置赛制关联。'
      },
      teamCount: {
        type: 'number',
        description: '期望队伍数量（2-64）。语义化输入，队伍需后续单独创建。'
      }
    },
    required: ['name']
  },
  riskLevel: 'high',
  async execute(args) {
    // 1. 校验 name 非空
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (!name) {
      throw new Error('[create_event] name 不能为空')
    }

    // 2. 校验 teamCount 范围 2-64（如传入）
    if (args.teamCount !== undefined && args.teamCount !== null) {
      const teamCount = Number(args.teamCount)
      if (!Number.isFinite(teamCount) || teamCount < 2 || teamCount > 64) {
        throw new Error('[create_event] teamCount 必须为 2-64 之间的整数')
      }
    }

    // 3. 构造 EventCreateInput（仅包含 repo 支持的字段）
    //    format / teamCount 为 Agent 语义化输入，不传给 repo
    //    显式传 null 以满足 repo 的严格类型（start_date/end_date/status 非可选）
    return eventRepo.createEvent({
      name,
      start_date: null,
      end_date: null,
      status: null
    })
  }
}
