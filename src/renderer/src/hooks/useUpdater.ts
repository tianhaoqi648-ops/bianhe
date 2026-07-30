// ============================================================
// useUpdater.ts — 应用内自动更新 React Hook
//
// 封装 window.updaterAPI，管理更新状态，提供操作方法。
// 配合 Settings.tsx 关于 Tab 的「应用更新」Card 使用。
//
// 状态机：
//   idle → checking → available / not-available / error
//   available → downloading → downloaded / error
//   downloaded → install（退出重启）
// ============================================================

import { useEffect, useState, useCallback } from 'react'
import type {
  UpdateStatus,
  UpdateInfo,
  UpdateProgress,
  UpdateStatusPayload
} from '../../../shared/types'

/** useUpdater 返回值 */
export interface UseUpdaterResult {
  /** 当前状态 */
  status: UpdateStatus
  /** 新版本元信息（status='available' 时有效） */
  info: UpdateInfo | null
  /** 下载进度（status='downloading' 时有效） */
  progress: UpdateProgress | null
  /** 错误信息（status='error' 时有效） */
  error: string | null
  /** 是否 macOS 平台（用于 UI 调整按钮文案） */
  isMacos: boolean
  /** 检查更新 */
  checkForUpdates: () => Promise<void>
  /** 下载更新（macOS 会打开浏览器） */
  downloadUpdate: () => Promise<void>
  /** 退出并安装（仅 Windows/Linux） */
  installUpdate: () => Promise<void>
  /** 设置启动时自动检查开关 */
  setAutoCheck: (value: boolean) => Promise<void>
}

/** 通过 navigator.userAgent 判断 macOS 平台 */
function detectMacos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Macintosh|Mac OS X/i.test(navigator.userAgent)
}

/**
 * 应用内自动更新 Hook。
 *
 * 用法：
 * ```tsx
 * const { status, info, progress, checkForUpdates, downloadUpdate, installUpdate } = useUpdater()
 * ```
 */
export function useUpdater(): UseUpdaterResult {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 订阅状态变更
  useEffect(() => {
    if (!window.updaterAPI) {
      console.warn('[useUpdater] window.updaterAPI not available')
      return
    }
    const unsubscribe = window.updaterAPI.onStatusChange((payload: UpdateStatusPayload) => {
      setStatus(payload.status)
      setInfo(payload.info ?? null)
      setProgress(payload.progress ?? null)
      setError(payload.error ?? null)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const checkForUpdates = useCallback(async (): Promise<void> => {
    if (!window.updaterAPI) return
    setStatus('checking')
    setError(null)
    try {
      const res = await window.updaterAPI.check()
      if (!res.success) {
        setStatus('error')
        setError(res.error ?? '检查失败')
      }
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const downloadUpdate = useCallback(async (): Promise<void> => {
    if (!window.updaterAPI) return
    try {
      const res = await window.updaterAPI.download(info?.releaseUrl)
      if (!res.success) {
        setStatus('error')
        setError(res.error ?? '下载失败')
      }
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [info])

  const installUpdate = useCallback(async (): Promise<void> => {
    if (!window.updaterAPI) return
    try {
      const res = await window.updaterAPI.install()
      if (!res.success) {
        setStatus('error')
        setError(res.error ?? '安装失败')
      }
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const setAutoCheck = useCallback(async (value: boolean): Promise<void> => {
    if (!window.updaterAPI) return
    await window.updaterAPI.setAutoCheck(value)
  }, [])

  return {
    status,
    info,
    progress,
    error,
    isMacos: detectMacos(),
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    setAutoCheck
  }
}
