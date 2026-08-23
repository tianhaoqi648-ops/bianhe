// ============================================================
// create-topic.tool.ts — Agent 工具：创建辩题（AI Agent v1.3.0 Week 2 Task 9）
//
// 包装 topicRepo.createTopic，让 Agent 能根据用户意图新建辩题。
// 仅暴露给 LLM 必要的字段（title/type/domain/difficulty/tags/source），
// 不暴露 weight/status/batch_id/custom_data 等内部字段。
//
// 设计要点：
//   - title 必填、长度 ≤ 200
//   - tags 为数组类型，JSON Schema 使用 type:'array' + items
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { Topic } from '@shared/types'
// 注意：topic.repo.ts 的 TopicCreateInput 由 Omit<Topic,...> 派生，
// 字段为必填（string | null），比 shared/types.ts 的可选版本更严格。
// 此处直接引用 repo 的类型，确保与 createTopic 入参精确对齐。
import type { TopicCreateInput } from '../../db/repository/topic.repo'
import { topicRepo } from '../../db/repository/topic.repo'
import { topicGroupRepo } from '../../db/repository/topic-group.repo'

/** create_topic 工具入参（与 parameters schema 对齐） */
interface CreateTopicArgs {
  title: string
  type?: string
  domain?: string
  difficulty?: string
  tags?: string[]
  source?: string
}

/** 标题长度上限 */
const TITLE_MAX_LENGTH = 200

/**
 * 创建新辩题工具。
 * 必填 title；可选 type / domain / difficulty / tags / source。
 */
export const createTopicTool: ToolDefinition<CreateTopicArgs, Topic> = {
  name: 'create_topic',
  description: '创建新辩题。',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: '辩题标题（必填，≤200 字）'
      },
      type: {
        type: 'string',
        description: '辩题类型，如"事实"、"价值"、"政策"'
      },
      domain: {
        type: 'string',
        description: '辩题领域，如"科技"、"教育"'
      },
      difficulty: {
        type: 'string',
        description: '难度，如"入门级"、"进阶级"、"专业级"'
      },
      tags: {
        type: 'array',
        description: '标签列表',
        items: {
          type: 'string',
          description: '标签名'
        }
      },
      source: {
        type: 'string',
        description: '辩题来源'
      }
    },
    required: ['title']
  },
  riskLevel: 'medium',
  async execute(args: CreateTopicArgs): Promise<Topic> {
    // 1. 校验 title 非空
    if (args.title === undefined || args.title === null) {
      throw new Error('title 不能为空')
    }
    const title = String(args.title).trim()
    if (title === '') {
      throw new Error('title 不能为空')
    }
    // 1.1 校验 title 长度 ≤ 200
    if (title.length > TITLE_MAX_LENGTH) {
      throw new Error(`title 长度超过 ${TITLE_MAX_LENGTH} 字（当前 ${title.length} 字）`)
    }

    // 2. 构造 TopicCreateInput（repo 的类型要求所有可空字段显式给出 null）
    const input: TopicCreateInput = {
      title,
      type: null,
      domain: null,
      difficulty: null,
      source: null,
      source_type: null,
      tags: null
    }
    if (typeof args.type === 'string' && args.type.trim() !== '') {
      input.type = args.type.trim()
    }
    if (typeof args.domain === 'string' && args.domain.trim() !== '') {
      input.domain = args.domain.trim()
    }
    if (typeof args.difficulty === 'string' && args.difficulty.trim() !== '') {
      input.difficulty = args.difficulty.trim()
    }
    if (typeof args.source === 'string' && args.source.trim() !== '') {
      input.source = args.source.trim()
    }
    if (Array.isArray(args.tags) && args.tags.length > 0) {
      // 过滤掉非字符串与空串
      const cleanTags = args.tags
        .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        .map((t) => t.trim())
      if (cleanTags.length > 0) {
        input.tags = cleanTags
      }
    }

    // 3. 调用 repo 创建并返回
    const created = topicRepo.createTopic(input)

    // 4. 新辩题默认归入「默认题库」（赛事题库 T2：未指定题组的新题进默认题库）
    await topicGroupRepo.ensureTopicInDefaultGroup(created.id)

    return created
  }
}
