// ============================================================
// report.ipc.ts — 复盘报告导出 IPC handler（P0-3 录音一键复盘导出）
//
// 渲染进程在 JudgeArena 组装好 markdown 报告字符串，通过
// IPC 传入本 handler：主进程弹 showSaveDialog 让用户选保存路径，
// 再用 fs/promises.writeFile 写为 .md 文件。
//
// 采用与 audit.ipc.ts AUDIT_EXPORT_LOGS 一致的本地化约定：仅传
// markdown 字符串 + 默认文件名到主进程，选路径/写文件都在主进程完成，
// 不把用户任意文件内容经渲染端滥用。
// ============================================================

import { ipcMain, dialog, type BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ExportJudgeReportRequest,
  type ExportJudgeReportResult
} from '../../shared/types'
import { getActiveWindow } from './utils'

/**
 * 通用「选保存路径 + 写文件」逻辑：弹 saveDialog 让用户选路径，再 writeFile。
 * 用户取消时返回 success:true + data:null（前端据此区分取消与失败）。
 * P0-3 Markdown 与 P2-9 HTML 两个通道共用，仅文件名/过滤条件不同。
 */
async function writeReportViaDialog(
  win: BrowserWindow,
  req: ExportJudgeReportRequest,
  opts: { title: string; filterName: string; extension: string }
): Promise<ApiResponse<ExportJudgeReportResult>> {
  const safeName = String(req.defaultName || 'debate-review').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
  const defaultPath = join(app.getPath('documents'), `${safeName}.${opts.extension}`)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: opts.title,
    defaultPath,
    filters: [{ name: opts.filterName, extensions: [opts.extension] }]
  })
  if (canceled || !filePath) {
    return { success: true, data: null } as unknown as ApiResponse<ExportJudgeReportResult>
  }
  await writeFile(filePath, req.content, 'utf-8')
  return { success: true, data: { filePath } }
}

/** 校验 ExportJudgeReportRequest（内容非空）+ 取活动窗口 */
async function validateReq(
  req: ExportJudgeReportRequest
): Promise<{ win: BrowserWindow } | { error: string }> {
  if (!req || typeof req !== 'object') {
    return { error: '参数 req 必须为对象' }
  }
  if (!req.content || typeof req.content !== 'string' || req.content.length === 0) {
    return { error: '报告内容为空' }
  }
  const win = getActiveWindow()
  if (!win) {
    return { error: '无可用窗口' }
  }
  return { win }
}

export function registerReportIpc(): void {
  // 导出复盘报告为 Markdown 文件（P0-3，用户取消保存时返回 success:true + data:null）
  ipcMain.handle(
    IPC_CHANNELS.REPORT_EXPORT_JUDGE,
    async (_e, req: ExportJudgeReportRequest): Promise<ApiResponse<ExportJudgeReportResult>> => {
      try {
        const check = await validateReq(req)
        if ('error' in check) {
          return { success: false, error: check.error }
        }
        return await writeReportViaDialog(check.win, req, {
          title: '导出复盘报告',
          filterName: 'Markdown',
          extension: 'md'
        })
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 导出复盘为自包含 HTML 文件（P2-9，含内联雷达图；用户取消保存返回 success:true + data:null）
  ipcMain.handle(
    IPC_CHANNELS.REPORT_EXPORT_JUDGE_HTML,
    async (_e, req: ExportJudgeReportRequest): Promise<ApiResponse<ExportJudgeReportResult>> => {
      try {
        const check = await validateReq(req)
        if ('error' in check) {
          return { success: false, error: check.error }
        }
        return await writeReportViaDialog(check.win, req, {
          title: '导出 HTML 复盘',
          filterName: 'HTML',
          extension: 'html'
        })
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}