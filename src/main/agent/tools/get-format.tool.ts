// ============================================================
// get-format.tool.ts — Agent 工具：查询赛制模板（Week 2 Task 12.1）
//
// 提供给 LLM 的 function calling 工具：
//   - 传入 formatId 时按 ID 查询指定赛制
//   - 不传 formatId 时返回默认赛制
//
// 说明：formatRepo 未提供 getDefault 方法，默认赛制取
//   listAll() 排序（is_preset DESC, name ASC）后的首条记录，
//   即首个内置预设，符合"默认"语义。
// ============================================================

import { formatRepo } from '../../db/repository/format.repo'
import type { ToolDefinition } from '@shared/agent-types'

export const getFormatTool: ToolDefinition = {
  name: 'get_format',
  description: '查询赛制模板。不传 formatId 时返回默认赛制。',
  parameters: {
    type: 'object',
    properties: {
      formatId: { type: 'string', description: '赛制 ID（可选，不传返回默认）' }
    }
  },
  riskLevel: 'low',
  async execute(args) {
    // 1. 如 args.formatId 为非空字符串，按 ID 查询指定赛制
    const formatId = args.formatId
    if (typeof formatId === 'string' && formatId.length > 0) {
      const fmt = formatRepo.getById(formatId)
      if (!fmt) {
        return { found: false, message: `未找到 ID 为 ${formatId} 的赛制` }
      }
      return fmt
    }

    // 2. 不传 formatId：返回默认赛制（首个预设）
    const all = formatRepo.listAll()
    if (all.length === 0) {
      return { found: false, message: '当前数据库中无任何赛制模板' }
    }
    return all[0]
  }
}
