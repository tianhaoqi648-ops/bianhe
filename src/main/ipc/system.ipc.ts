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
import type { ApiResponse, ResetDataRequest, ResetDataResponse } from '../../shared/types'
import { getMergedCandidates } from '../services/candidate-service'
import { resetData } from '../services/reset-service'
import type { CandidateField } from '../../shared/constants'

export function registerSystemIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_PICK_FILE,
    async (
      _e,
      filters?: Array<{ name: string; extensions: string[] }>
    ): Promise<string | null> => {
      const win = getActiveWindow()
      if (!win) {
        return null
      }
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: '选择文件',
        properties: ['openFile'],
        filters: filters ?? [
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (canceled || filePaths.length === 0) return null
      return filePaths[0]
    }
  )

  // 返回合并后的系统候选值：系统候选 + 用户扩展（持久化在 settings 表）
  // 用于导入预览页 ValueMappingPanel 显示已有候选值
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_GET_CANDIDATES,
    (): Record<CandidateField, string[]> => {
      return getMergedCandidates()
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
          error: e instanceof Error ? e.message : '重置失败'
        }
      }
    }
  )
}
