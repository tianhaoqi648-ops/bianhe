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
import { writeFile } from 'fs/promises'
import { auditRepo } from '../db/repository/audit.repo'
import type { AuditLogFilter, AuditLogCreateInput } from '../db/repository/audit.repo'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ExportLogsRequest,
  type ExportLogsResult
} from '../../shared/types'
import { getActiveWindow, wrap, wrapWithUndo } from './utils'
import { withUndoLog } from '../services/undo-service'

/**
 * P2-23：参数校验辅助函数。
 * 校验失败时抛出友好错误，由 wrap/wrapWithUndo 捕获并转为 ApiResponse.error 返回前端。
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
    wrap(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      return auditRepo.addLog(input)
    })
  )
  ipcMain.handle(IPC_CHANNELS.AUDIT_DELETE_LOG, (_e, id: string) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      return auditRepo.deleteLog(id)
    })
  )
  ipcMain.handle(IPC_CHANNELS.AUDIT_CLEAR_LOGS, (_e, beforeDate?: string) =>
    wrap(() => auditRepo.clearLogs(beforeDate))
  )

  // 导出日志（大 pageSize 一次拉取，主进程写文件）
  ipcMain.handle(
    IPC_CHANNELS.AUDIT_EXPORT_LOGS,
    async (_e, req: ExportLogsRequest): Promise<ApiResponse<ExportLogsResult>> => {
      try {
        // P3-5: pageSize=100000 作为全量拉取的 workaround（auditRepo 无 listAll 方法）
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
          // P3-2: 用户取消保存不是错误，返回 success:true + data:null 让前端区分取消与失败
          return { success: true, data: null } as unknown as ApiResponse<ExportLogsResult>
        }
        const content =
          req.format === 'csv' ? logsToCsv(items) : JSON.stringify(items, null, 2)
        // P3-7: 改用 fs.promises.writeFile 异步写入，避免阻塞主进程
        await writeFile(filePath, content, 'utf-8')
        return { success: true, data: { filePath, count: items.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // ---------- settings ----------
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_e, key: string) =>
    wrap(() => {
      assertNonEmptyString(key, 'key')
      return auditRepo.getSetting(key)
    })
  )
  // SETTINGS_SET：before = 旧值或 null，after = 新值
  // P3-11: value 类型从 any 改为 unknown，避免类型逃逸
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_e, key: string, value: unknown) =>
    wrapWithUndo(() => {
      assertNonEmptyString(key, 'key')
      assertParam(value !== undefined, '参数 value 不能为 undefined')
      return withUndoLog({
        storeName: 'settings',
        action: 'set',
        targetType: 'setting',
        targetId: key,
        label: `修改设置 ${key}`,
        getBefore: () => {
          const old = auditRepo.getSetting(key)
          return old === undefined ? null : { key, value: old }
        },
        execute: () => {
          auditRepo.setSetting(key, value)
          return true
        },
        getAfter: () => ({ key, value })
      })
    })
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () =>
    wrap(() => auditRepo.getAllSettings())
  )
  // SETTINGS_DELETE：before = 旧值，after = { key }（key 已删除，但记录 key 名供 redo 使用）
  ipcMain.handle(IPC_CHANNELS.SETTINGS_DELETE, (_e, key: string) =>
    wrapWithUndo(() => {
      assertNonEmptyString(key, 'key')
      return withUndoLog({
        storeName: 'settings',
        action: 'deleteKey',
        targetType: 'setting',
        targetId: key,
        label: `删除设置 ${key}`,
        getBefore: () => {
          const old = auditRepo.getSetting(key)
          return old === undefined ? null : { key, value: old }
        },
        execute: () => auditRepo.deleteSetting(key),
        getAfter: () => ({ key })
      })
    })
  )
  // SETTINGS_DELETE_BATCH：before = { entries: [{key, value}] }，after = { keys: string[] }
  // 注意：保留原有审计日志写入逻辑
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_DELETE_BATCH,
    (_e, keys: string[]): ApiResponse<number> => {
      // P1: 校验 + entries 采集均放入 wrapWithUndo，确保校验失败时返回统一 ApiResponse 格式
      const response = wrapWithUndo(() => {
        assertParam(Array.isArray(keys), '参数 keys 必须为数组')
        // 采集 before 快照
        const entries = keys
          .map((k) => {
            const v = auditRepo.getSetting(k)
            return v === undefined ? null : { key: k, value: v }
          })
          .filter((e): e is { key: string; value: unknown } => e !== null)

        return withUndoLog<number>({
          storeName: 'settings',
          action: 'deleteBatch',
          targetType: 'setting',
          targetId: null,
          label: `批量删除 ${keys.length} 项设置`,
          getBefore: () => ({ entries }),
          execute: () => auditRepo.deleteSettingsByKeys(keys),
          getAfter: () => ({ keys })
        })
      })

      // 保留原有审计日志逻辑（仅在成功时写入）
      if (response.success && response.data !== undefined) {
        try {
          auditRepo.addLog({
            action: 'system',
            target_type: 'settings',
            target_id: 'reset',
            operator: 'user',
            detail: { action: 'reset_settings', keys, deletedCount: response.data }
          })
        } catch {
          /* 审计日志失败不影响主流程 */
        }
      }
      return response
    }
  )
}
