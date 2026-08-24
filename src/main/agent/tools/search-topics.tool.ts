// ============================================================
// search-topics.tool.ts — Agent 工具：搜索辩题库（AI Agent v1.3.0 Week 2 Task 7）
//
// 包装 topicRepo.listTopics，支持关键词 + 维度筛选。
// Agent 通过此工具按用户意图检索辩题，返回 Topic[]。
//
// 设计要点：
//   - 入参 limit 默认 20、硬上限 50（防 LLM 拉爆库）
//   - tags 为数组类型，JSON Schema 使用 type:'array' + items
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { Topic, TopicFilter } from '@shared/types'
import { topicRepo } from '../../db/repository/topic.repo'

/** search_topics 工具入参（与 parameters schema 对齐） */
interface SearchTopicsArgs {
  keyword?: string
  type?: string
  domain?: string
  difficulty?: string
  tags?: string[]
  limit?: number
}

/** 返回上限默认值 */
const DEFAULT_LIMIT = 20
/** 返回上限硬上限（防 LLM 拉爆库） */
const MAX_LIMIT = 50

/**
 * 搜索辩题库工具。
 * 支持按关键词、类型、领域、难度、标签筛选，返回匹配的辩题列表。
 */
export const searchTopicsTool: ToolDefinition<SearchTopicsArgs, Topic[]> = {
  name: 'search_topics',
  description:
    '搜索辩题库。支持按关键词、类型、领域、难度、标签筛选。返回匹配的辩题列表。',
  parameters: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: '搜索关键词（匹配辩题标题，模糊匹配）'
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
        description: '标签列表（任一匹配即返回）',
        items: {
          type: 'string',
          description: '标签名'
        }
      },
      limit: {
        type: 'number',
        description: '返回上限，默认 20，最大 50'
      }
    }
  },
  riskLevel: 'low',
  tier: 'read',
  async execute(args: SearchTopicsArgs): Promise<Topic[]> {
    // 1. 校验并归一化 limit
    let limit = DEFAULT_LIMIT
    if (args.limit !== undefined) {
      if (typeof args.limit !== 'number' || !Number.isFinite(args.limit)) {
        throw new Error('limit 必须为数字')
      }
      if (args.limit < 1) {
        throw new Error('limit 必须 ≥ 1')
      }
      // 硬上限 50，防 LLM 拉爆库
      limit = Math.min(Math.floor(args.limit), MAX_LIMIT)
    }

    // 2. 构造 TopicFilter（仅填充非空字段，避免空字符串误触发筛选）
    const filter: TopicFilter = {
      pageSize: limit
    }
    if (typeof args.keyword === 'string' && args.keyword.trim() !== '') {
      filter.keyword = args.keyword.trim()
    }
    if (typeof args.type === 'string' && args.type.trim() !== '') {
      filter.type = args.type.trim()
    }
    if (typeof args.domain === 'string' && args.domain.trim() !== '') {
      filter.domain = args.domain.trim()
    }
    if (typeof args.difficulty === 'string' && args.difficulty.trim() !== '') {
      filter.difficulty = args.difficulty.trim()
    }
    if (Array.isArray(args.tags) && args.tags.length > 0) {
      // 过滤掉非字符串与空串
      const cleanTags = args.tags
        .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        .map((t) => t.trim())
      if (cleanTags.length > 0) {
        filter.tags = cleanTags
      }
    }

    // 3. 调用 repo（listTopics 返回 { items, total }，仅返回 items）
    const { items } = topicRepo.listTopics(filter)
    return items
  }
}
