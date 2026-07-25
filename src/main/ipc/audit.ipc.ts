// ============================================================
// audit.ipc.ts — 审计日志 + 系统设置 IPC handler
//
// 注册通道：
//   audit:listLogs / audit:addLog / audit:deleteLog / audit:clearLogs / audit:exportLogs
//   settings:get / settings:set / settings:getAll / settings:delete
//
// 导出日志使用 dialog.showSaveDialog 让用户选保存位置，主进程写文件。
// ============================================================

import { ipcMain, dialog } from 'electron'
import { writeFileSync } from 'fs'
import { auditRepo } from '../db/repository/audit.repo'
import type { AuditLogFilter, AuditLogCreateInput } from '../db/repository/audit.repo'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ExportLogsRequest,
  type ExportLogsResult
} from '../../shared/types'
import { getActiveWindow } from './utils'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 把 audit_log 记录数组转 CSV 字符串（含表头）。
 * - detail 字段 JSON.stringify 后写入
 * - 含逗号/引号/换行的字段用双引号包裹，内部双引号转义为两个
 */
function logsToCsv(logs: Array<Record<string, any>>): string {
  const headers = [
    'id',
    'action',
    'target_type',
    'target_id',
    'operator',
    'detail',
    'created_at'
  ]
  if (logs.length === 0) {
    return headers.join(',') + '\n'
  }
  const rows = logs.map((l) =>
    headers
      .map((h) => {
        const v = l[h]
        const s = h === 'detail' && v ? JSON.stringify(v) : v == null ? '' : String(v)
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
        return s
      })
      .join(',')
  )
  return [headers.join(','), ...rows].join('\n') + '\n'
}

export function registerAuditIpc(): void {
  // ---------- audit_log ----------
  ipcMain.handle(IPC_CHANNELS.AUDIT_LIST_LOGS, (_e, filter?: AuditLogFilter) =>
    wrap(() => auditRepo.listLogs(filter))
  )
  ipcMain.handle(IPC_CHANNELS.AUDIT_ADD_LOG, (_e, input: AuditLogCreateInput) =>
    wrap(() => auditRepo.addLog(input))
  )
  ipcMain.handle(IPC_CHANNELS.AUDIT_DELETE_LOG, (_e, id: string) =>
    wrap(() => auditRepo.deleteLog(id))
  )
  ipcMain.handle(IPC_CHANNELS.AUDIT_CLEAR_LOGS, (_e, beforeDate?: string) =>
    wrap(() => auditRepo.clearLogs(beforeDate))
  )

  // 导出日志（大 pageSize 一次拉取，主进程写文件）
  ipcMain.handle(
    IPC_CHANNELS.AUDIT_EXPORT_LOGS,
    async (_e, req: ExportLogsRequest): Promise<ApiResponse<ExportLogsResult>> => {
      try {
        // 拉取全部匹配日志（pageSize=100000 避免分页）
        const { items } = auditRepo.listLogs({ ...req.filter, page: 1, pageSize: 100000 })
        const win = getActiveWindow()
        if (!win) {
          return { success: false, error: '无可用窗口' }
        }
        const defaultName = `audit-logs-${new Date().toISOString().slice(0, 10)}.${req.format}`
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: '导出审计日志',
          defaultPath: defaultName,
          filters:
            req.format === 'csv'
              ? [{ name: 'CSV', extensions: ['csv'] }]
              : [{ name: 'JSON', extensions: ['json'] }]
        })
        if (canceled || !filePath) {
          return { success: false, error: '用户取消保存' }
        }
        const content =
          req.format === 'csv' ? logsToCsv(items) : JSON.stringify(items, null, 2)
        writeFileSync(filePath, content, 'utf-8')
        return { success: true, data: { filePath, count: items.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // ---------- settings ----------
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_e, key: string) =>
    wrap(() => auditRepo.getSetting(key))
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_e, key: string, value: any) =>
    wrap(() => {
      auditRepo.setSetting(key, value)
      return true
    })
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () =>
    wrap(() => auditRepo.getAllSettings())
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_DELETE, (_e, key: string) =>
    wrap(() => auditRepo.deleteSetting(key))
  )
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_DELETE_BATCH,
    async (_e, keys: string[]): Promise<ApiResponse<number>> => {
      const deleted = auditRepo.deleteSettingsByKeys(keys);
      // 写审计日志留痕
      try {
        auditRepo.addLog({
          action: 'system',
          target_type: 'settings',
          target_id: 'reset',
          operator: 'user',
          detail: { action: 'reset_settings', keys, deletedCount: deleted }
        });
      } catch {
        // 审计日志失败不影响主流程
      }
      return { success: true, data: deleted };
    }
  )
}
