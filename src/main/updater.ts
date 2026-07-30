// ============================================================
// updater.ts — 应用内自动更新（electron-updater）主进程封装
//
// 设计要点：
// 1. autoUpdater.autoDownload = false —— 发现新版本后由用户确认下载
// 2. autoUpdater.autoInstallOnAppQuit = true —— 已下载则退出时自动安装
// 3. macOS 未签名，downloadUpdate 走 shell.openExternal 降级（在 IPC 层处理）
// 4. 通过 webContents.send 广播状态变更，渲染进程通过 updaterAPI.onStatusChange 订阅
// 5. 启动后延迟 15 秒自动检查（可通过 settings.auto_update_check 关闭）
//
// 设置项持久化在 settings 表 key='auto_update_check'，默认 true。
// ============================================================

import { app, BrowserWindow } from 'electron'
import { getDb } from './db'
import type { UpdateStatusPayload, UpdateInfo } from '../shared/types'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater')

/** GitHub Release 页面基础 URL（用于 macOS 降级跳转） */
const RELEASE_URL_BASE = 'https://github.com/tianhaoqi648-ops/bianhe/releases'
/** 设置项 key */
const SETTING_KEY = 'auto_update_check'
/** 启动后自动检查延迟（毫秒） */
const AUTO_CHECK_DELAY_MS = 15_000

/** 是否 macOS 平台 */
export const isMacos = process.platform === 'darwin'

/** 是否已初始化（避免重复绑定事件） */
let initialized = false

/**
 * 读取 auto_update_check 设置项。
 * 无记录时默认 true（首次启动自动检查）。
 */
export function getAutoCheckSetting(): boolean {
  try {
    const row = getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(SETTING_KEY) as { value: string } | undefined
    if (!row) return true
    return JSON.parse(row.value) === true
  } catch {
    return true
  }
}

/**
 * 写入 auto_update_check 设置项。
 */
export function setAutoCheckSetting(value: boolean): void {
  const db = getDb()
  const existing = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(SETTING_KEY)
  if (existing) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      JSON.stringify(value),
      SETTING_KEY
    )
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      SETTING_KEY,
      JSON.stringify(value)
    )
  }
}

/**
 * 向所有 BrowserWindow 广播状态变更。
 */
function broadcast(payload: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:statusChange', payload)
    }
  }
}

/**
 * 构造 GitHub Release URL（指定版本号则跳转该版本，否则跳转 latest）。
 */
function buildReleaseUrl(version?: string): string {
  return version ? `${RELEASE_URL_BASE}/tag/v${version}` : `${RELEASE_URL_BASE}/latest`
}

/**
 * 初始化自动更新模块。
 * 必须在数据库初始化成功 + IPC 注册完成之后调用。
 *
 * 行为：
 * 1. 配置 autoUpdater 参数
 * 2. 绑定事件监听器
 * 3. 读取 auto_update_check 设置，若为 true 则延迟 15 秒自动检查
 */
export function initUpdater(): void {
  if (initialized) {
    console.warn('[updater] Already initialized, skip')
    return
  }
  initialized = true

  // 配置 autoUpdater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  // 开发环境强制不下载（避免误触发）
  if (!app.isPackaged) {
    console.log('[updater] Dev mode, auto-update disabled')
    return
  }

  // 日志
  autoUpdater.logger = console

  // 事件监听
  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for update...')
    broadcast({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version)
    const updateInfo: UpdateInfo = {
      version: info.version ?? '',
      releaseNotes:
        typeof info.releaseNotes === 'string' ? info.releaseNotes : JSON.stringify(info.releaseNotes ?? ''),
      releaseUrl: buildReleaseUrl(info.version)
    }
    broadcast({ status: 'available', info: updateInfo })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] Up to date')
    broadcast({ status: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(
      `[updater] Downloading: ${progress.percent.toFixed(1)}% (${progress.transferred}/${progress.total})`
    )
    broadcast({
      status: 'downloading',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      }
    })
  })

  autoUpdater.on('update-downloaded', () => {
    console.log('[updater] Update downloaded')
    broadcast({ status: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err)
    broadcast({ status: 'error', error: err?.message ?? String(err) })
  })

  // 启动后自动检查
  const autoCheck = getAutoCheckSetting()
  if (autoCheck) {
    console.log('[updater] Auto-check enabled, will check in 15s')
    setTimeout(() => {
      checkForUpdates().catch((e) => {
        console.warn('[updater] Auto-check failed:', e)
      })
    }, AUTO_CHECK_DELAY_MS)
  } else {
    console.log('[updater] Auto-check disabled by user')
  }
}

/**
 * 手动触发检查更新。
 * macOS 也能正常检查（仅查询是否有新版本），下载走降级路径。
 */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    console.log('[updater] Dev mode, skip checkForUpdates')
    broadcast({ status: 'not-available' })
    return
  }
  await autoUpdater.checkForUpdates()
}

/**
 * 下载更新（Windows / Linux）。
 * macOS 不应调用此函数，由 IPC 层走 shell.openExternal 降级。
 */
export async function downloadUpdate(): Promise<void> {
  if (isMacos) {
    console.warn('[updater] macOS should not call downloadUpdate, use shell.openExternal instead')
    return
  }
  await autoUpdater.downloadUpdate()
}

/**
 * 退出并安装更新（Windows / Linux）。
 */
export function installUpdate(): void {
  if (isMacos) {
    console.warn('[updater] macOS does not support installUpdate')
    return
  }
  autoUpdater.quitAndInstall()
}
