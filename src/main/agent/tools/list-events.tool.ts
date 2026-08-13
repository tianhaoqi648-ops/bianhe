// ============================================================
// list-events.tool.ts — Agent 工具：列出赛事（Task 11.1）
//
// 调用 eventRepo.listEvents 查询赛事列表，可按状态筛选。
// repo 返回 { items, total } 结构，原样返回以便 LLM 感知分页与总数。
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { EventFilter } from '@shared/types'
import { eventRepo } from '@main/db/repository/event.repo'

export const listEventsTool: ToolDefinition = {
  name: 'list_events',
  description: '列出赛事。可按状态筛选，默认按创建时间倒序返回。',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: '赛事状态筛选，如"筹备中"、"进行中"、"已结束"'
      }
    }
  },
  riskLevel: 'low',
  async execute(args) {
    // 构造过滤条件（status 可选）
    const filter: EventFilter = {}
    if (typeof args.status === 'string' && args.status.trim() !== '') {
      filter.status = args.status.trim()
    }

    // 调用 repo 列表查询，返回 { items: Event[], total: number }
    return eventRepo.listEvents(filter)
  }
}
