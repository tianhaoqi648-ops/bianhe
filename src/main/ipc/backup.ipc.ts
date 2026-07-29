// ============================================================
// ipc/backup.ipc.ts — 数据备份 IPC handlers
//
// 通道：
//   backup:run             立即备份（DB 文件级，覆盖当前 .db 文件）
//   backup:list            列出所有 DB 文件级备份
//   backup:restore         恢复指定 DB 文件级备份
//   backup:delete          删除指定 DB 文件级备份
//   backup:export          全量数据导出为 JSON（按类别勾选）
//   backup:previewImport   预览导入 JSON 备份文件（不写库）
//   backup:import          执行全量导入（按策略 clear/skip/overwrite）
//   backup:stats           获取各类别本地数据条数统计（用于备份弹窗展示）
//
// 全部返回 ApiResponse<T>，与既有 IPC 风格一致。
// ============================================================

import { ipcMain, dialog } from 'electron'
import { extname } from 'path'
import { IPC_CHANNELS, type ApiResponse } from '../../shared/types'
import type {
  BackupParams,
  BackupImportParams,
  BackupExportResult,
  BackupPreviewResult,
  BackupImportResult
} from '../../shared/types'
import {
  backupDatabase,
  listBackups,
  restoreBackup,
  deleteBackup,
  type BackupInfo
} from '../backup'
import {
  exportBackup,
  previewImport,
  importBackup,
  writeBackupFile,
  getBackupStats
} from '../services/backup-service'

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

export function registerBackupIpc(): void {
  ipcMain.handle(IPC_CHANNELS.BACKUP_RUN, async (): Promise<ApiResponse<{ ok: true }>> => {
    try {
      await backupDatabase()
      return { success: true, data: { ok: true } }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BACKUP_LIST, async (): Promise<ApiResponse<BackupInfo[]>> => {
    try {
      const list = await listBackups()
      return { success: true, data: list }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_RESTORE,
    async (_e, filename: string): Promise<ApiResponse<{ ok: true }>> => {
      try {
        assertNonEmptyString(filename, 'filename')
        await restoreBackup(filename)
        return { success: true, data: { ok: true } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_DELETE,
    async (_e, filename: string): Promise<ApiResponse<{ ok: true }>> => {
      try {
        assertNonEmptyString(filename, 'filename')
        await deleteBackup(filename)
        return { success: true, data: { ok: true } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 全量数据导出：弹出保存对话框 → 生成 BackupPackage → 写入 JSON 文件
  ipcMain.handle(
    IPC_CHANNELS.BACKUP_EXPORT,
    async (_e, params: BackupParams): Promise<ApiResponse<BackupExportResult>> => {
      try {
        assertParam(params && typeof params === 'object', '参数 params 必须为对象')
        // 1. 弹出保存对话框
        const defaultName = `bianhe-backup-${new Date().toISOString().slice(0, 10)}.json`
        const result = await dialog.showSaveDialog({
          title: '选择备份文件保存位置',
          defaultPath: defaultName,
          filters: [{ name: '辩盒备份文件', extensions: ['json'] }]
        })
        if (result.canceled || !result.filePath) {
          // P3-2: 用户取消保存不是错误，返回 success:true + data:null 让前端区分取消与失败
          return { success: true, data: null } as unknown as ApiResponse<BackupExportResult>
        }
        let filePath = result.filePath
        if (extname(filePath) !== '.json') {
          filePath = `${filePath}.json`
        }

        // 2. 生成备份内容
        const pkg = exportBackup(params)

        // 3. 写文件
        writeBackupFile(filePath, pkg)

        // 4. 统计
        let totalRecords = 0
        let bellFilesCount = 0
        for (const [key, value] of Object.entries(pkg.tables)) {
          if (key === 'bell_files') {
            bellFilesCount = Object.keys(value as Record<string, string>).length
          } else if (Array.isArray(value)) {
            totalRecords += value.length
          }
        }

        return { success: true, data: { filePath, totalRecords, bellFilesCount } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 预览导入：读取 JSON 文件并返回摘要信息，不写库
  ipcMain.handle(
    IPC_CHANNELS.BACKUP_PREVIEW_IMPORT,
    async (_e, filePath: string): Promise<ApiResponse<BackupPreviewResult>> => {
      try {
        assertNonEmptyString(filePath, 'filePath')
        const data = previewImport(filePath)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 执行全量导入：按 strategy + categories 写库（事务包裹）
  ipcMain.handle(
    IPC_CHANNELS.BACKUP_IMPORT,
    async (_e, params: BackupImportParams): Promise<ApiResponse<BackupImportResult>> => {
      try {
        assertParam(params && typeof params === 'object', '参数 params 必须为对象')
        const result = importBackup(params)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 获取各类别本地数据条数统计（用于备份弹窗展示，不写库）
  ipcMain.handle(
    IPC_CHANNELS.BACKUP_STATS,
    async (): Promise<ApiResponse<Record<string, number>>> => {
      try {
        const stats = getBackupStats()
        return { success: true, data: stats }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  console.log('[main] Backup IPC handlers registered')
}
