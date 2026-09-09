// ============================================================
// system.ipc.ts — 系统级 IPC handler
//
// 注册通道：
//   system:pickFile       调用主进程 dialog.showOpenDialog 选择单个文件
//   system:getCandidates  返回合并后的系统候选值（系统候选 + 用户扩展）
//   system:resetData      统一数据重置入口（配置类 + 数据类）
//
// 供渲染进程 fileAPI.pickFile / settingsAPI.getCandidates / systemAPI.resetData 调用。
// ============================================================

import { ipcMain, dialog } from 'electron'
import { getActiveWindow } from './utils'
import { IPC_CHANNELS } from '../../shared/types'
import { assertNotSensitivePath } from '../../shared/security/pathGuard'
import type { ApiResponse, ResetDataRequest, ResetDataResponse } from '../../shared/types'
import { getMergedCandidatesWithDB } from '../services/candidate-service'
import { resetData } from '../services/reset-service'
import { readTextFileContent } from '../services/text-file-service'
import type { CandidateField } from '../../shared/constants'

export function registerSystemIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_PICK_FILE,
    async (
      _e,
      filters?: Array<{ name: string; extensions: string[] }>
    ): Promise<ApiResponse<string | null>> => {
      try {
        const win = getActiveWindow()
        if (!win) {
          // P3-9: 统一无窗口处理策略，返回 success:false + 明确错误信息
          return { success: false, error: 'No window available' }
        }
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
          title: '选择文件',
          properties: ['openFile'],
          filters: filters ?? [
            { name: 'Excel/CSV/Word', extensions: ['xlsx', 'xls', 'csv', 'docx'] }
          ]
        })
        if (canceled || filePaths.length === 0) {
          return { success: true, data: null }
        }
        return { success: true, data: filePaths[0] }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  // 读取稿子文本文件内容（AI 裁判工作台 2026-08-18）
  // 支持 txt/md（utf-8）与 docx（mammoth 提取纯文本），限制 2MB
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_READ_TEXT_FILE,
    async (_e, filePath: string): Promise<ApiResponse<string>> => {
      if (typeof filePath !== 'string' || filePath === '') {
        return { success: false, error: '文件路径无效' }
      }
      // 安全加固：该通道会把文件内容回吐渲染进程，必须拒绝系统敏感目录
      assertNotSensitivePath(filePath)
      const res = await readTextFileContent(filePath)
      if (!res.ok) {
        return { success: false, error: res.message ?? `读取失败（${res.code ?? 'unknown'}）` }
      }
      return { success: true, data: res.content ?? '' }
    }
  )

  // 返回合并后的系统候选值：系统候选 + 用户扩展（持久化在 settings 表）
  // 用于导入预览页 ValueMappingPanel 显示已有候选值
  // 按项目约定包装为 ApiResponse，与 preload/index.d.ts 类型声明对齐
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_GET_CANDIDATES,
    (): ApiResponse<Record<CandidateField, string[]>> => {
      try {
        const data = getMergedCandidatesWithDB()
        return { success: true, data }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  // 统一数据重置入口：配置类（settings keys）+ 数据类（业务表清空）
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_RESET_DATA,
    async (_e, req: ResetDataRequest): Promise<ApiResponse<ResetDataResponse>> => {
      try {
        const result = resetData(req)
        return { success: true, data: result }
      } catch (e) {
        return {
          success: false,
          // P3-8: 保留原始错误信息，避免 '重置失败' 覆盖真实错误原因
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )
}
