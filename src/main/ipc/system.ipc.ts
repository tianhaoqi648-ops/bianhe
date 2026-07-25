// ============================================================
// system.ipc.ts — 系统级 IPC handler
//
// 注册通道：
//   system:pickFile  调用主进程 dialog.showOpenDialog 选择单个文件
//
// 供渲染进程 fileAPI.pickFile 调用。
// ============================================================

import { ipcMain, dialog } from 'electron'
import { getActiveWindow } from './utils'
import { IPC_CHANNELS } from '../../shared/types'

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
}
