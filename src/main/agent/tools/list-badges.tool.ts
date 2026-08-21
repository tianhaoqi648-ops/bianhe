// ============================================================
// list-badges.tool.ts — Agent 工具：列出队徽库（T6）
//
// 复用 badge-storage.listBadges / searchBadges：
//   - keyword 缺省列出全部队徽，否则按名称包含匹配
//   - 返回条目（id/name/kind）供 LLM 了解可绑定哪些队徽
//
// 设计要点：
//   - 只读队徽索引，不触碰文件内容（避免大 base64 回流给 LLM）
//   - 风险等级 low：仅读，无副作用
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { BadgeItem } from '@shared/types'
import { searchBadges } from '../../services/badge-storage'

/** list_badges 工具入参（与 parameters schema 对齐） */
export interface ListBadgesArgs {
  /** 可选，按队徽名称（包含匹配）过滤 */
  keyword?: string
}

/** list_badges 工具返回的条目 */
export interface BadgeSummary {
  /** 队徽 ID */
  id: string
  /** 队徽名称 */
  name: string
  /** 类型：builtin=内置 / custom=用户上传 */
  kind: BadgeItem['kind']
}

/** list_badges 工具返回值 */
export interface ListBadgesResult {
  /** 队徽条目（仅 id/name/kind，不含文件内容） */
  badges: BadgeSummary[]
  /** 条目数 */
  count: number
}

export const listBadgesTool: ToolDefinition<ListBadgesArgs, ListBadgesResult> = {
  name: 'list_badges',
  description: '列出队徽库（内置 + 用户上传）。可传 keyword 按名称筛选，返回队徽的 id/name/kind，供后续绑定队伍使用。',
  parameters: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: '可选；按队徽名称（包含匹配）过滤'
      }
    }
  },
  riskLevel: 'low',
  async execute(args: ListBadgesArgs): Promise<ListBadgesResult> {
    const keyword = typeof args.keyword === 'string' ? args.keyword : ''
    const items = searchBadges(keyword)
    const badges: BadgeSummary[] = items.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind
    }))
    return { badges, count: badges.length }
  }
}