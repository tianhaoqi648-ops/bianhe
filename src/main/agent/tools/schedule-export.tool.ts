// ============================================================
// schedule-export.tool.ts — Agent 工具：导出赛事赛程为 Excel（T5）
//
// 复用 services/schedule-io 生成 xlsx，并落盘：
//   - outPath 缺省时写入 userData/exports/ 下默认文件名
//   - 返回绝对文件路径与行数，交用户自行取用
//
// 设计要点：
//   - 复用 matchRepo.listByEvent + buildScheduleRows + buildScheduleWorkbookBuffer
//   - 不依赖 electron dialog（Agent 工具不能弹窗），直接用 node fs 写文件
//   - 风险等级 low：仅读库 + 写 xlsx 文件，不改业务数据
//   - 工具内部抛错，由 agent-loop 捕获作为 tool_result(success=false)
// ============================================================

import { app } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import * as path from 'node:path'
import type { ToolDefinition } from '@shared/agent-types'
import { eventRepo } from '@main/db/repository/event.repo'
import { matchRepo } from '@main/db/repository/match.repo'
import { buildScheduleRows, buildScheduleWorkbookBuffer } from '../../services/schedule-io'

/** export_event_schedule 工具入参（与 parameters schema 对齐） */
export interface ScheduleExportArgs {
  /** 赛事 ID（必填） */
  eventId: string
  /** 导出文件路径（可选；缺省写入 userData/exports/ 下默认文件名） */
  outPath?: string
}

/** export_event_schedule 工具返回值 */
export interface ScheduleExportResult {
  /** 生成的 xlsx 绝对文件路径 */
  filePath: string
  /** 导出的赛程行数 */
  count: number
}

/** 默认导出目录：userData/exports */
export function defaultExportDir(): string {
  return path.join(app.getPath('userData'), 'exports')
}

/** 清洗文件名中不合法的路径字符 */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

export const scheduleExportTool: ToolDefinition<
  ScheduleExportArgs,
  ScheduleExportResult
> = {
  name: 'export_event_schedule',
  description: '导出赛事赛程为 Excel(.xlsx) 文件。传入 eventId（必填）；可传 outPath 指定保存路径，否则写入默认导出目录，返回文件绝对路径与行数。',
  parameters: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: '赛事 ID（必填）'
      },
      outPath: {
        type: 'string',
        description: '导出文件保存路径（可选；缺省写入 userData/exports/ 下默认文件名）'
      }
    },
    required: ['eventId']
  },
  riskLevel: 'low',
  async execute(args: ScheduleExportArgs): Promise<ScheduleExportResult> {
    // 1. 校验 eventId
    const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : ''
    if (!eventId) {
      throw new Error('[export_event_schedule] eventId 不能为空')
    }

    // 2. 校验赛事存在
    const event = eventRepo.getEventById(eventId)
    if (!event) {
      throw new Error(`[export_event_schedule] 赛事 ${eventId} 不存在`)
    }

    // 3. 汇总当前赛程行并构建 xlsx buffer
    const matches = matchRepo.listByEvent(eventId)
    const rows = buildScheduleRows(matches)
    const buffer = buildScheduleWorkbookBuffer(rows)

    // 4. 确定输出路径：outPath 优先，否则默认导出目录
    const outPath =
      typeof args.outPath === 'string' && args.outPath.trim() !== ''
        ? args.outPath.trim()
        : path.join(
            defaultExportDir(),
            `${safeFileName(event.name)}-赛程-${new Date().toISOString().slice(0, 10)}.xlsx`
          )

    // 5. 确保目录存在并写入文件
    await mkdir(path.dirname(outPath), { recursive: true })
    await writeFile(outPath, buffer)

    return { filePath: path.resolve(outPath), count: rows.length }
  }
}