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
import { writeFileSync } from 'fs'
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
 */
function writeTopicsFile(
  filePath: string,
  format: ExportFormat,
  topics: Array<Record<string, any>>
): void {
  if (format === 'json') {
    writeFileSync(filePath, JSON.stringify(topics, null, 2), 'utf-8')
  } else if (format === 'csv') {
    writeFileSync(filePath, objectsToCsv(topics), 'utf-8')
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
 */
function writeSessionsFile(
  filePath: string,
  format: ExportFormat,
  rows: Array<Record<string, any>>
): void {
  if (format === 'json') {
    writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf-8')
  } else if (format === 'csv') {
    writeFileSync(filePath, objectsToCsv(rows), 'utf-8')
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
        // 拉取全部匹配辩题（pageSize=100000 避免分页）
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
          return { success: false, error: '用户取消保存' }
        }
        writeTopicsFile(filePath, req.format, rows)
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
        // 拉取全部匹配会话（含 items，pageSize=100000）
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
              team_a: it.team_a_id ? (teamMap.get(it.team_a_id) ?? it.team_a_id) : '',
              team_b: it.team_b_id ? (teamMap.get(it.team_b_id) ?? it.team_b_id) : '',
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
          return { success: false, error: '用户取消保存' }
        }
        writeSessionsFile(filePath, req.format, rows)
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
        const event = eventRepo.getEventById(req.eventId)
        if (!event) {
          return { success: false, error: '赛事不存在' }
        }
        const rounds = eventRepo.listRoundsByEvent(req.eventId)
        const teams = eventRepo.listTeamsByEvent(req.eventId)
        const teamHistory = eventRepo.listTeamHistoryByEvent(req.eventId)
        const { items: sessions } = drawRepo.listSessions({
          event_id: req.eventId,
          page: 1,
          pageSize: 100000
        })
        const pkg = {
          event,
          rounds,
          teams,
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
          return { success: false, error: '用户取消保存' }
        }
        writeFileSync(filePath, JSON.stringify(pkg, null, 2), 'utf-8')
        return {
          success: true,
          data: {
            filePath,
            count: 1 + rounds.length + teams.length + teamHistory.length + sessions.length
          }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 通用占位（dedup 通道在 dedup.ipc.ts 中实现）
}
