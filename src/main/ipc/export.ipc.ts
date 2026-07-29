// ============================================================
// export.ipc.ts — 数据导出 IPC handler
//
// 注册通道：
//   export:topics        导出题库（xlsx/csv/json）
//   export:drawSessions  导出抽取记录（xlsx/csv/json）
//   export:eventPackage  导出赛事数据包（json）
//
// 使用 dialog.showSaveDialog 让用户选保存位置，主进程写文件。
// ============================================================

import { ipcMain, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import * as XLSX from 'xlsx'
import { topicRepo } from '../db/repository/topic.repo'
import { drawRepo } from '../db/repository/draw.repo'
import { eventRepo } from '../db/repository/event.repo'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ExportTopicsRequest,
  type ExportDrawSessionsRequest,
  type ExportEventPackageRequest,
  type ExportResult,
  type ExportFormat
} from '../../shared/types'
import { getActiveWindow } from './utils'

/**
 * P2-23：参数校验辅助函数。
 * 校验失败时抛出友好错误，由 try-catch 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/** 校验非空字符串 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

/** 允许的导出格式 */
const ALLOWED_EXPORT_FORMATS: ExportFormat[] = ['xlsx', 'csv', 'json']

/**
 * 把对象数组转 CSV 字符串（含表头）。
 * - 嵌套对象/数组用 JSON.stringify 后写入
 * - 含逗号/引号/换行的字段用双引号包裹，内部双引号转义为两个
 */
function objectsToCsv(rows: Array<Record<string, any>>): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const row of rows) {
    const cells = headers.map((h) => {
      const v = row[h]
      const s =
        v == null
          ? ''
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v)
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    })
    lines.push(cells.join(','))
  }
  return lines.join('\n') + '\n'
}

/**
 * 把对象数组写入 Excel/CSV/JSON 文件。
 * P3-7：json/csv 路径改用 fs.promises.writeFile 异步写入，避免阻塞主进程。
 *      xlsx 路径仍用 XLSX.writeFile（第三方库同步 API，非 fs）。
 */
async function writeTopicsFile(
  filePath: string,
  format: ExportFormat,
  topics: Array<Record<string, any>>
): Promise<void> {
  if (format === 'json') {
    await writeFile(filePath, JSON.stringify(topics, null, 2), 'utf-8')
  } else if (format === 'csv') {
    await writeFile(filePath, objectsToCsv(topics), 'utf-8')
  } else {
    // xlsx
    const ws = XLSX.utils.json_to_sheet(topics)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Topics')
    XLSX.writeFile(wb, filePath)
  }
}

/**
 * 把抽取会话明细数组写入文件。
 * 每个 session 展开成多行（按 item）。
 * P3-7：json/csv 路径改用 fs.promises.writeFile 异步写入，避免阻塞主进程。
 *      xlsx 路径仍用 XLSX.writeFile（第三方库同步 API，非 fs）。
 */
async function writeSessionsFile(
  filePath: string,
  format: ExportFormat,
  rows: Array<Record<string, any>>
): Promise<void> {
  if (format === 'json') {
    await writeFile(filePath, JSON.stringify(rows, null, 2), 'utf-8')
  } else if (format === 'csv') {
    await writeFile(filePath, objectsToCsv(rows), 'utf-8')
  } else {
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'DrawSessions')
    XLSX.writeFile(wb, filePath)
  }
}

/**
 * 获取文件扩展名对应过滤器。
 */
function getFilter(format: ExportFormat): { name: string; extensions: string[] }[] {
  switch (format) {
    case 'xlsx':
      return [{ name: 'Excel', extensions: ['xlsx'] }]
    case 'csv':
      return [{ name: 'CSV', extensions: ['csv'] }]
    case 'json':
      return [{ name: 'JSON', extensions: ['json'] }]
  }
}

export function registerExportIpc(): void {
  // ---------- 导出题库 ----------
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_TOPICS,
    async (
      _e,
      req: ExportTopicsRequest
    ): Promise<ApiResponse<ExportResult>> => {
      try {
        assertParam(req && typeof req === 'object', '参数 req 必须为对象')
        if (req.format !== undefined) {
          assertParam(
            ALLOWED_EXPORT_FORMATS.includes(req.format),
            '参数 req.format 必须为 xlsx/csv/json 之一'
          )
        }
        // P3-5: pageSize=100000 作为全量拉取的 workaround（topicRepo 无 listAll 方法）
        const { items } = topicRepo.listTopics({
          ...req.filter,
          page: 1,
          pageSize: 100000
        })
        // 展平字段
        const rows = items.map((t) => ({
          id: t.id,
          title: t.title,
          type: t.type ?? '',
          domain: t.domain ?? '',
          difficulty: t.difficulty ?? '',
          source: t.source ?? '',
          source_type: t.source_type ?? '',
          tags: t.tags ? t.tags.join('|') : '',
          weight: t.weight,
          status: t.status,
          created_at: t.created_at,
          updated_at: t.updated_at
        }))
        const win = getActiveWindow()
        if (!win) {
          return { success: false, error: '无可用窗口' }
        }
        const defaultName = `topics-${new Date().toISOString().slice(0, 10)}.${req.format}`
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: '导出题库',
          defaultPath: defaultName,
          filters: getFilter(req.format)
        })
        if (canceled || !filePath) {
          // P3-2: 用户取消保存不是错误，返回 success:true + data:null 让前端区分取消与失败
          return { success: true, data: null } as unknown as ApiResponse<ExportResult>
        }
        await writeTopicsFile(filePath, req.format, rows)
        return { success: true, data: { filePath, count: items.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // ---------- 导出抽取记录 ----------
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_DRAW_SESSIONS,
    async (
      _e,
      req: ExportDrawSessionsRequest
    ): Promise<ApiResponse<ExportResult>> => {
      try {
        assertParam(req && typeof req === 'object', '参数 req 必须为对象')
        if (req.format !== undefined) {
          assertParam(
            ALLOWED_EXPORT_FORMATS.includes(req.format),
            '参数 req.format 必须为 xlsx/csv/json 之一'
          )
        }
        // P3-5: pageSize=100000 作为全量拉取的 workaround（drawRepo 无 listAll 方法）
        const { items } = drawRepo.listSessions({
          ...req.filter,
          page: 1,
          pageSize: 100000
        })
        // 预拉赛事/轮次/队伍映射
        const eventIds = Array.from(new Set(items.map((s) => s.event_id)))
        const eventMap = new Map<string, string>()
        for (const eid of eventIds) {
          const ev = eventRepo.getEventById(eid)
          if (ev) eventMap.set(eid, ev.name)
        }
        const teamIds = Array.from(
          new Set(
            items.flatMap((s) =>
              s.items.flatMap((it) => [it.team_a_id, it.team_b_id].filter(Boolean) as string[])
            )
          )
        )
        const teamMap = new Map<string, string>()
        for (const tid of teamIds) {
          const team = eventRepo.getTeamById(tid)
          if (team) teamMap.set(tid, team.name)
        }
        // 预拉辩题映射（用于 snapshot 缺失时 fallback）
        const topicIds = Array.from(
          new Set(
            items.flatMap((s) => s.items.map((it) => it.topic_id))
          )
        )
        const topicMap = new Map<string, string>()
        for (const tid of topicIds) {
          const topic = topicRepo.getTopicById(tid)
          if (topic) topicMap.set(tid, topic.title)
        }
        // 展平为每条 item 一行
        const rows: Array<Record<string, any>> = []
        for (const s of items) {
          for (const it of s.items) {
            rows.push({
              session_id: s.id,
              draw_time: s.draw_time ?? '',
              operator: s.operator ?? '',
              event_name: eventMap.get(s.event_id) ?? s.event_id,
              round_id: s.round_id ?? '',
              topic_id: it.topic_id,
              topic: it.topic_title ?? topicMap.get(it.topic_id) ?? '',
              team_a_id: it.team_a_id ?? '',
              team_a: it.team_a_name ?? (it.team_a_id ? (teamMap.get(it.team_a_id) ?? '') : ''),
              team_b_id: it.team_b_id ?? '',
              team_b: it.team_b_name ?? (it.team_b_id ? (teamMap.get(it.team_b_id) ?? '') : ''),
              stance_a: it.stance_a ?? '',
              stance_b: it.stance_b ?? ''
            })
          }
        }
        const win = getActiveWindow()
        if (!win) {
          return { success: false, error: '无可用窗口' }
        }
        const defaultName = `draw-sessions-${new Date().toISOString().slice(0, 10)}.${req.format}`
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: '导出抽取记录',
          defaultPath: defaultName,
          filters: getFilter(req.format)
        })
        if (canceled || !filePath) {
          // P3-2: 用户取消保存不是错误，返回 success:true + data:null 让前端区分取消与失败
          return { success: true, data: null } as unknown as ApiResponse<ExportResult>
        }
        await writeSessionsFile(filePath, req.format, rows)
        return { success: true, data: { filePath, count: rows.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // ---------- 导出赛事数据包 ----------
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_EVENT_PACKAGE,
    async (
      _e,
      req: ExportEventPackageRequest
    ): Promise<ApiResponse<ExportResult>> => {
      try {
        assertParam(req && typeof req === 'object', '参数 req 必须为对象')
        assertNonEmptyString(req.eventId, 'req.eventId')
        const event = eventRepo.getEventById(req.eventId)
        if (!event) {
          return { success: false, error: '赛事不存在' }
        }
        const rounds = eventRepo.listRoundsByEvent(req.eventId)
        const teams = eventRepo.listTeamsByEvent(req.eventId)
        const groups = eventRepo.listGroupsByEvent(req.eventId)
        const teamHistory = eventRepo.listTeamHistoryByEvent(req.eventId)
        const { items: sessions } = drawRepo.listSessions({
          event_id: req.eventId,
          // P3-5: pageSize=100000 作为全量拉取的 workaround（drawRepo 无 listAll 方法）
          page: 1,
          pageSize: 100000
        })
        const pkg = {
          event,
          rounds,
          teams,
          groups,
          teamHistory,
          drawSessions: sessions,
          exportedAt: new Date().toISOString()
        }
        const win = getActiveWindow()
        if (!win) {
          return { success: false, error: '无可用窗口' }
        }
        const defaultName = `event-${event.name}-${new Date().toISOString().slice(0, 10)}.json`
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: '导出赛事数据包',
          defaultPath: defaultName,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
        if (canceled || !filePath) {
          // P3-2: 用户取消保存不是错误，返回 success:true + data:null 让前端区分取消与失败
          return { success: true, data: null } as unknown as ApiResponse<ExportResult>
        }
        // P3-7: 改用 fs.promises.writeFile 异步写入，避免阻塞主进程
        await writeFile(filePath, JSON.stringify(pkg, null, 2), 'utf-8')
        return {
          success: true,
          data: {
            filePath,
            count:
              1 +
              rounds.length +
              teams.length +
              groups.length +
              teamHistory.length +
              sessions.length
          }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 通用占位（dedup 通道在 dedup.ipc.ts 中实现）
}
