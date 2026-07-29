// ============================================================
// bell-play.ipc.ts — 铃声试听 IPC handlers
//
// 职责：仅返回铃声文件绝对路径，实际播放由渲染进程的 bell-player.ts
//      用 HTML5 Audio 完成（避免主进程引入音频播放依赖）。
// ============================================================

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { bellAssetRepo } from '../db/repository/bell-asset.repo'
import { getBellFullPath } from '../services/bell-storage'
import { wrap } from './utils'

export function registerBellPlayIpc(): void {
  // 查询铃声记录并返回绝对路径，供渲染进程 HTML5 Audio 播放
  ipcMain.handle(IPC_CHANNELS.BELL_PLAY, (_e: IpcMainInvokeEvent, bellId: string) =>
    wrap(() => {
      if (!bellId || typeof bellId !== 'string') {
        throw new Error('bellId 不能为空')
      }
      const asset = bellAssetRepo.getById(bellId)
      if (!asset) {
        throw new Error(`铃声不存在：${bellId}`)
      }
      const filePath = getBellFullPath(asset.filePath)
      return { filePath }
    })
  )

  // 停止播放：实际停止动作在渲染进程完成，主进程仅返回成功
  ipcMain.handle(IPC_CHANNELS.BELL_STOP, () => wrap(() => true))
}
