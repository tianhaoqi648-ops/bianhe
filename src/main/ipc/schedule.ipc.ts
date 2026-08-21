// ============================================================
// schedule.ipc.ts — 赛程 Excel 导入导出 IPC handlers（P1-6）
//
// 通道：
//   schedule:export        导出当前赛程为 xlsx（保存对话框由主进程弹出）
//   schedule:importParse   解析 xlsx → 「新增/更新/删除」变更预览（不写库）
//   schedule:importApply   确认后按 preview 应用到比赛
//
// 数据编排在 IPC 层，纯逻辑（解析/对比/应用）委托 services/schedule-io.ts。
// ============================================================

import { ipcMain, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { IPC_CHANNELS } from '../../shared/types'
import type {
  ApiResponse,
  ExportResult,
  ScheduleApplyResult,
  ScheduleDiffPreview,
  ScheduleRow
} from '../../shared/types'
import { eventRepo } from '../db/repository/event.repo'
import { matchRepo } from '../db/repository/match.repo'
import { topicRepo } from '../db/repository/topic.repo'
import {
  applyScheduleDiff,
  buildScheduleRows,
  buildScheduleWorkbookBuffer,
  computeScheduleDiff,
  parseScheduleXlsx,
  scheduleKey
} from '../services/schedule-io'
import type { ScheduleResolveCtx } from '../services/schedule-io'
import { getActiveWindow, wrap } from './utils'

function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

/** 汇总某事件当前赛程行（比赛 → ScheduleRow） */
function currentRows(eventId: string): ScheduleRow[] {
  const matches = matchRepo.listByEvent(eventId)
  return buildScheduleRows(matches)
}

/** 汇总应用的解析上下文（队伍/辩题/轮次名映射） */
function resolveCtx(eventId: string): ScheduleResolveCtx {
  const teams = eventRepo.listTeamsByEvent(eventId).map((t) => ({ id: t.id, name: t.name }))
  const topics = topicRepo
    .listTopics({ page: 1, pageSize: 100000 })
    .items.map((t) => ({ id: t.id, title: t.title }))
  const rounds = eventRepo.listRoundsByEvent(eventId)
  const byName = new Map<string, string>()
  for (const r of rounds) {
    const key = (r.name ?? '').trim()
    if (key && !byName.has(key)) byName.set(key, r.id)
  }
  return {
    teams,
    topics,
    roundNameToId: (name) => {
      const key = (name ?? '').trim()
      return key ? (byName.get(key) ?? null) : null
    }
  }
}

/** key → matchId */
function matchIdsByKey(eventId: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of matchRepo.listByEvent(eventId)) {
    const k = scheduleKey({ roundName: m.roundName, matchNumber: m.matchNumber })
    if (!map.has(k)) map.set(k, m.id)
  }
  return map
}

export function registerScheduleIpc(): void {
  // ---------- 导出当前赛程为 xlsx ----------
  ipcMain.handle(
    IPC_CHANNELS.SCHEDULE_EXPORT,
    async (_e, req: { eventId: string }): Promise<ApiResponse<ExportResult>> => {
      try {
        assertParam(req && typeof req === 'object', '参数 req 必须为对象')
        assertNonEmptyString(req.eventId, 'req.eventId')
        const event = eventRepo.getEventById(req.eventId)
        if (!event) return { success: false, error: '赛事不存在' }
        const rows = currentRows(req.eventId)
        const buffer = buildScheduleWorkbookBuffer(rows)
        const win = getActiveWindow()
        if (!win) return { success: false, error: '无可用窗口' }
        const defaultName = `${event.name}-赛程-${new Date().toISOString().slice(0, 10)}.xlsx`
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: '导出赛程（Excel）',
          defaultPath: defaultName,
          filters: [{ name: 'Excel', extensions: ['xlsx'] }]
        })
        if (canceled || !filePath) {
          // P3-2：取消保存非错误
          return { success: true, data: null } as unknown as ApiResponse<ExportResult>
        }
        await writeFile(filePath, buffer)
        return { success: true, data: { filePath, count: rows.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // ---------- 解析导入 xlsx → 变更预览（不写库） ----------
  ipcMain.handle(
    IPC_CHANNELS.SCHEDULE_IMPORT_PARSE,
    (_e, req: { eventId: string; filePath: string }): ApiResponse<ScheduleDiffPreview> =>
      wrap(() => {
        assertParam(req && typeof req === 'object', '参数 req 必须为对象')
        assertNonEmptyString(req.eventId, 'req.eventId')
        assertNonEmptyString(req.filePath, 'req.filePath')
        if (!eventRepo.getEventById(req.eventId)) throw new Error('赛事不存在')
        const { rows, warnings } = parseScheduleXlsx(req.filePath)
        const preview = computeScheduleDiff(currentRows(req.eventId), rows)
        return { ...preview, warnings: [...warnings, ...preview.warnings] }
      })
  )

  // ---------- 确认后应用变更 ----------
  ipcMain.handle(
    IPC_CHANNELS.SCHEDULE_IMPORT_APPLY,
    (_e, req: { eventId: string; preview: ScheduleDiffPreview }): ApiResponse<ScheduleApplyResult> =>
      wrap(() => {
        assertParam(req && typeof req === 'object', '参数 req 必须为对象')
        assertNonEmptyString(req.eventId, 'req.eventId')
        assertParam(req.preview && typeof req.preview === 'object', '参数 req.preview 必须为对象')
        if (!eventRepo.getEventById(req.eventId)) throw new Error('赛事不存在')
        const ctx = resolveCtx(req.eventId)
        const idsByKey = matchIdsByKey(req.eventId)
        const result = applyScheduleDiff(req.preview, {
          eventId: req.eventId,
          ctx,
          matchIdsByKey: idsByKey,
          ops: {
            create: (d) => {
              matchRepo.create({
                eventId: d.eventId,
                roundId: d.roundId,
                matchNumber: d.matchNumber,
                teamAffId: d.teamAffId,
                teamNegId: d.teamNegId,
                topicId: d.topicId,
                stanceAff: '正方',
                stanceNeg: '反方'
              })
            },
            update: (matchId, d) => {
              matchRepo.update(matchId, {
                teamAffId: d.teamAffId,
                teamNegId: d.teamNegId,
                topicId: d.topicId
              })
            },
            remove: (matchId) => matchRepo.delete(matchId)
          }
        })
        return result
      })
  )
}