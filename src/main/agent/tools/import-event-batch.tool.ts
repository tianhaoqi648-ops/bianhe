// ============================================================
// import-event-batch.tool.ts — Agent 工具：批量导入赛事与队伍（Task 35）
//
// 包装 import-engine.parseFile + eventRepo.createEvent + eventRepo.createTeam，
// 让 Agent 能从 Excel/CSV/DOCX 文件批量导入赛事与队伍。
//
// 设计要点：
//   - filePath / fileType 必填，fieldMapping 可选
//   - fieldMapping 缺失时返回解析到的列名列表，提示 LLM 下次调用时补充 fieldMapping
//   - fieldMapping 提供时，按映射从 rawTable.rows 提取队伍名
//   - 风险等级 high：会写入数据库（创建赛事 + 队伍）
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import path from 'path'
import type { ToolDefinition } from '@shared/agent-types'
import { parseFile } from '@main/services/import-engine'
import { eventRepo } from '@main/db/repository/event.repo'

/** import_event_batch 工具入参（与 parameters schema 对齐） */
interface ImportEventBatchArgs {
  /** 文件绝对路径（必填） */
  filePath: string
  /** 文件类型（必填）：xlsx / csv / docx */
  fileType: 'xlsx' | 'csv' | 'docx'
  /** 字段映射（可选）：声明队伍名等字段对应的列名 */
  fieldMapping?: {
    /** 队伍名列（在 rawTable.headers 中的列名） */
    teamName?: string
    /** 赛事名（可选，缺省从文件名推断） */
    eventName?: string
  }
}

/** import_event_batch 工具返回值 */
interface ImportEventBatchResult {
  /** 是否需要 LLM 补充 fieldMapping 后再次调用 */
  needFieldMapping?: boolean
  /** 解析到的列名列表（needFieldMapping=true 时返回，供 LLM 推断） */
  columns?: string[]
  /** 提示信息 */
  message?: string
  /** 创建的赛事 ID（成功导入时返回） */
  eventId?: string
  /** 创建的队伍数量 */
  teamCount?: number
  /** 创建的轮次数量（本工具不创建轮次，固定 0） */
  roundCount?: number
}

/**
 * import_event_batch 工具定义。
 *
 * 执行流程：
 *   1. 校验 filePath / fileType
 *   2. 调用 parseFile 解析文件得到 ParsedResult
 *   3. fieldMapping 缺失时返回列名列表，引导 LLM 下次调用补充 fieldMapping
 *   4. fieldMapping 提供时按 teamName 列从 rawTable.rows 提取队伍名
 *   5. 创建赛事（name 从 fieldMapping.eventName 或文件名推断）
 *   6. 批量创建队伍
 *   7. 返回 { eventId, teamCount, roundCount }
 *
 * 错误处理：文件不存在 / 解析失败 / 列名不匹配 / 创建赛事失败等
 * 均抛 Error，由 agent-loop 捕获作为 tool_result(success=false)。
 */
export const importEventBatchTool: ToolDefinition<
  ImportEventBatchArgs,
  ImportEventBatchResult
> = {
  name: 'import_event_batch',
  description: '从 Excel/CSV/DOCX 文件批量导入赛事与队伍。fieldMapping 缺失时返回列名提示，需 LLM 推断后再次调用。',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '文件绝对路径（必填）'
      },
      fileType: {
        type: 'string',
        description: '文件类型：xlsx / csv / docx',
        enum: ['xlsx', 'csv', 'docx']
      },
      fieldMapping: {
        type: 'object',
        description:
          '字段映射（可选）。缺失时返回列名列表，提示 LLM 推断后补充。' +
          '可用字段：teamName（队伍名列）、eventName（赛事名，可选）'
      }
    },
    required: ['filePath', 'fileType']
  },
  riskLevel: 'high',
  async execute(args: ImportEventBatchArgs): Promise<ImportEventBatchResult> {
    // 1. 校验 filePath
    const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : ''
    if (!filePath) {
      throw new Error('[import_event_batch] filePath 不能为空')
    }

    // 2. 校验 fileType
    const fileType = args.fileType
    if (fileType !== 'xlsx' && fileType !== 'csv' && fileType !== 'docx') {
      throw new Error('[import_event_batch] fileType 必须为 xlsx / csv / docx 之一')
    }

    // 3. 调用 parseFile 解析文件（文件不存在 / 解析失败时 parseFile 抛错，透传给 agent-loop）
    const parsed = await parseFile(filePath, fileType)

    // 4. fieldMapping 缺失时返回列名提示 LLM 推断
    const fieldMapping = args.fieldMapping
    if (!fieldMapping || typeof fieldMapping !== 'object') {
      const columns = parsed.rawTable?.headers ?? Object.keys(parsed.mapping)
      return {
        needFieldMapping: true,
        columns,
        message:
          '已解析文件，但未提供 fieldMapping。请根据上述列名推断队伍名列，' +
          '在下次调用时通过 fieldMapping.teamName 指定。'
      }
    }

    // 5. 校验 teamName 列名
    const teamNameCol =
      typeof fieldMapping.teamName === 'string' ? fieldMapping.teamName.trim() : ''
    if (!teamNameCol) {
      const columns = parsed.rawTable?.headers ?? Object.keys(parsed.mapping)
      return {
        needFieldMapping: true,
        columns,
        message: 'fieldMapping.teamName 为空，请根据上述列名指定队伍名列。'
      }
    }

    // 6. 从 rawTable 提取队伍名
    const headers = parsed.rawTable?.headers ?? []
    const rows = parsed.rawTable?.rows ?? []
    if (headers.length === 0) {
      throw new Error(
        '[import_event_batch] 文件未解析到表格结构（rawTable 为空）。' +
          '请确认文件为 Excel/CSV 或含表格的 DOCX。'
      )
    }
    const colIndex = headers.indexOf(teamNameCol)
    if (colIndex < 0) {
      throw new Error(
        `[import_event_batch] 队伍名列 "${teamNameCol}" 不在文件表头中。可用列：${headers.join(', ')}`
      )
    }

    // 提取队伍名（去重 + 过滤空值）
    const teamNames: string[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      const val = row[colIndex]
      if (val === null || val === undefined) continue
      const name = String(val).trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      teamNames.push(name)
    }

    if (teamNames.length === 0) {
      throw new Error(`[import_event_batch] 列 "${teamNameCol}" 中未提取到任何队伍名`)
    }

    // 7. 创建赛事（name 从 fieldMapping.eventName 或文件名推断）
    const eventName =
      (typeof fieldMapping.eventName === 'string' && fieldMapping.eventName.trim()) ||
      path.basename(filePath, path.extname(filePath))

    const event = eventRepo.createEvent({
      name: eventName,
      start_date: null,
      end_date: null,
      status: null
    })

    // 8. 批量创建队伍
    let created = 0
    for (const teamName of teamNames) {
      eventRepo.createTeam({
        name: teamName,
        event_id: event.id
      })
      created++
    }

    // 9. 返回结果（roundCount=0，本工具不创建轮次）
    return {
      eventId: event.id,
      teamCount: created,
      roundCount: 0
    }
  }
}
