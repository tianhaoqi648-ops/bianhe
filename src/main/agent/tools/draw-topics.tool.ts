// ============================================================
// draw-topics.tool.ts — Agent 工具：抽取辩题（AI Agent v1.3.0 Week 2 Task 10）
//
// 包装 draw-engine 的 drawTopics 能力，供 LLM 通过 function calling 调用。
// 仅返回 DrawResult，不在工具内部发送 IPC 事件（抽取成功后通过事件通知
// 渲染进程触发 drawStore 更新的联动逻辑在 Week 4 Task 24 实现，保持工具纯粹）。
//
// 设计要点：
//   1. event_id 为 draw-engine 必填字段，工具入参 eventId 缺失时抛错，
//      引导 LLM 先调用 list_events 或 create_event 获取赛事上下文
//   2. include_stance 固定为 false：Agent 工具仅负责抽题，不分配持方
//      （持方分配依赖队伍配对，由后续业务流程处理）
//   3. avoidRepeat 默认 true（不允许重复）；仅当显式传 false 时才启用
//      draw-engine 的 allow_repeat（有放回抽样）
// ============================================================

import { drawTopics } from '@main/services/draw-engine'
import type { DrawParams, DrawResult, TopicFilter } from '@shared/types'
import type { ToolDefinition } from '@shared/agent-types'

/** draw_topics 工具入参（来自 LLM function call arguments 解析） */
interface DrawTopicsArgs {
  /** 筛选条件（同 search_topics 的参数，不含 limit） */
  filter?: TopicFilter
  /** 抽取数量（1-50） */
  count: number
  /** 是否避免重复（默认 true） */
  avoidRepeat?: boolean
  /** 赛事 ID（draw-engine 必填；缺失时抛错引导 LLM 先建立赛事上下文） */
  eventId?: string
}

/**
 * draw_topics 工具定义。
 *
 * 执行流程：
 *   1. 校验 count 范围 1-50
 *   2. 校验 eventId（缺失时抛错引导 LLM 调用 list_events / create_event）
 *   3. 构造 DrawParams（include_stance=false，allow_repeat 由 avoidRepeat 反转）
 *   4. 调用 draw-engine.drawTopics 并返回 DrawResult
 *
 * 错误处理：所有错误透传给 agent-loop，由其作为 tool_result(success=false)
 * 反馈给 LLM。draw-engine 抛出的 InsufficientTopicsError 等业务异常同样透传。
 */
export const drawTopicsTool: ToolDefinition<DrawTopicsArgs, DrawResult> = {
  name: 'draw_topics',
  description: '从题库抽取辩题。支持按维度筛选、控制数量、避免重复。',
  parameters: {
    type: 'object',
    properties: {
      filter: { type: 'object', description: '筛选条件（同 search_topics 的参数，不含 limit）' },
      count: { type: 'number', description: '抽取数量（1-50）' },
      avoidRepeat: { type: 'boolean', description: '是否避免重复（默认 true）' },
      eventId: { type: 'string', description: '赛事 ID（如未指定，需先创建赛事）' }
    },
    required: ['count']
  },
  riskLevel: 'medium',
  tier: 'write',

  async execute(args) {
    // 1. 校验 count 范围 1-50
    const count = args.count
    if (
      typeof count !== 'number' ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 50
    ) {
      throw new Error('count 必须为 1-50 之间的整数')
    }

    // 2. 校验 eventId（draw-engine 的 DrawParams.event_id 必填）
    const eventId = args.eventId
    if (typeof eventId !== 'string' || eventId.trim() === '') {
      throw new Error(
        '缺少 eventId：抽取辩题需要赛事上下文。请先调用 list_events 查询已有赛事，' +
          '或调用 create_event 创建新赛事，获取 event_id 后再调用 draw_topics。'
      )
    }

    // 3. 构造 DrawParams
    // - include_stance=false：工具仅抽题，不分配持方
    // - allow_repeat：avoidRepeat 默认 true（不允许重复）；仅当显式传 false 时才允许重复
    const params: DrawParams = {
      event_id: eventId,
      topic_count: count,
      include_stance: false,
      filters: args.filter,
      allow_repeat: args.avoidRepeat === false
    }

    // 4. 调用 draw-engine 抽取（错误透传给 agent-loop 处理）
    // 5. 返回 DrawResult
    return drawTopics(params)
  }
}
