// ============================================================
// updater.ipc.ts — 应用内自动更新 IPC handlers
//
// 通道：
//   updater:check          手动触发检查更新
//   updater:download       下载更新（macOS 走 shell.openExternal 降级）
//   updater:install        退出并安装（仅 Windows/Linux）
//   updater:setAutoCheck   设置启动时自动检查开关
//   updater:statusChange   主进程 → 渲染进程状态广播（通过 webContents.send）
//
// macOS 降级：因未签名，无法后台替换应用。检测到新版本后点击「前往下载」
// 会调用 shell.openExternal 打开对应 GitHub Release 页面，由用户手动下载 dmg。
// ============================================================

import { app, ipcMain, shell } from 'electron'
import { IPC_CHANNELS, type ApiResponse } from '../../shared/types'
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  setAutoCheckSetting,
  isMacos
} from '../updater'

export function registerUpdaterIpc(): void {
  // 检查更新（手动触发）
  ipcMain.handle(
    IPC_CHANNELS.UPDATER_CHECK,
    async (): Promise<ApiResponse<void>> => {
      try {
        await checkForUpdates()
        return { success: true, data: undefined }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  // 下载更新
  // macOS：打开浏览器跳转 Release 页面（降级路径）
  // Windows/Linux：调用 autoUpdater.downloadUpdate() 后台下载
  ipcMain.handle(
    IPC_CHANNELS.UPDATER_DOWNLOAD,
    async (_e, releaseUrl?: string): Promise<ApiResponse<void>> => {
      try {
        if (isMacos) {
          // macOS 降级：打开浏览器
          const url = releaseUrl ?? 'https://github.com/tianhaoqi648-ops/bianhe/releases/latest'
          await shell.openExternal(url)
          return { success: true, data: undefined }
        }
        await downloadUpdate()
        return { success: true, data: undefined }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  // 安装更新（退出并重启）
  // 仅 Windows/Linux 有效；macOS 调用此通道不应发生（UI 不应展示此按钮）
  ipcMain.handle(
    IPC_CHANNELS.UPDATER_INSTALL,
    async (): Promise<ApiResponse<void>> => {
      try {
        if (isMacos) {
          return { success: false, error: 'macOS 不支持应用内安装，请手动下载 dmg' }
        }
        installUpdate()
        return { success: true, data: undefined }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  // 设置启动时自动检查开关
  ipcMain.handle(
    IPC_CHANNELS.UPDATER_SET_AUTO_CHECK,
    (_e, value: boolean): ApiResponse<{ ok: true }> => {
      try {
        setAutoCheckSetting(value)
        return { success: true, data: { ok: true } }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  // 获取应用运行元信息（是否打包环境，供渲染进程判断是否执行更新检查）
  ipcMain.handle(
    IPC_CHANNELS.UPDATER_GET_META,
    (): ApiResponse<{ isPackaged: boolean }> => ({
      success: true,
      data: { isPackaged: app.isPackaged }
    })
  )

  // 注：UPDATER_STATUS_CHANGE 通道无需注册 handler，
  // 主进程通过 webContents.send('updater:statusChange', payload) 主动推送，
  // 渲染进程通过 ipcRenderer.on('updater:statusChange', cb) 订阅。

  console.log('[main] Updater IPC registered')
}
