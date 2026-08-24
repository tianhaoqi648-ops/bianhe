// ============================================================
// get-topic-detail.tool.ts — Agent 工具：获取辩题详情（AI Agent v1.3.0 Week 2 Task 8）
//
// 包装 topicRepo.getTopicById，按 id 查询辩题完整信息（含 custom_data）。
// 不存在时抛错，让 Agent 反馈给 LLM 触发重试或修正。
//
// 设计要点：
//   - topicId 必填，缺失或空串时抛错
//   - 仅返回 Topic（不含 total 等元数据）
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { Topic } from '@shared/types'
import { topicRepo } from '../../db/repository/topic.repo'

/** get_topic_detail 工具入参（与 parameters schema 对齐） */
interface GetTopicDetailArgs {
  topicId: string
}

/**
 * 获取辩题详情工具。
 * 按 id 返回辩题完整信息（含自定义字段 custom_data）。
 */
export const getTopicDetailTool: ToolDefinition<GetTopicDetailArgs, Topic> = {
  name: 'get_topic_detail',
  description: '获取辩题详情（含自定义字段）。',
  parameters: {
    type: 'object',
    properties: {
      topicId: {
        type: 'string',
        description: '辩题 ID'
      }
    },
    required: ['topicId']
  },
  riskLevel: 'low',
  tier: 'read',
  async execute(args: GetTopicDetailArgs): Promise<Topic> {
    // 1. 校验 topicId 非空
    if (args.topicId === undefined || args.topicId === null) {
      throw new Error('topicId 不能为空')
    }
    const topicId = String(args.topicId).trim()
    if (topicId === '') {
      throw new Error('topicId 不能为空')
    }

    // 2. 调用 repo 查询
    const topic = topicRepo.getTopicById(topicId)

    // 3. 不存在时抛错，让 Agent 反馈给 LLM
    if (!topic) {
      throw new Error(`辩题不存在：topicId=${topicId}`)
    }
    return topic
  }
}
