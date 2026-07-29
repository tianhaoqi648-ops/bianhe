// ============================================================
// useThemeMode.ts — 主题模式 hook
//
// 整合 settingsStore.themeMode（用户设置）与系统 prefers-color-scheme 监听，
// 输出当前实际生效的 resolvedMode，供 ConfigProvider / 自定义 CSS 使用。
// ============================================================

import { useEffect, useState, type CSSProperties } from 'react'
import { useSettingsStore, type ThemeMode } from '../stores/settingsStore'
import { stickyBgLight, stickyBgDark } from '../styles/tokens'

/** 实际渲染用的模式（不包含 'system'） */
export type ResolvedMode = 'light' | 'dark'

/**
 * 读取系统当前 prefers-color-scheme。
 * SSR / 非浏览器环境安全回退为 'light'。
 */
function getSystemMode(): ResolvedMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export interface UseThemeModeResult {
  /** 用户在设置中选择的模式（三态） */
  themeMode: ThemeMode
  /** 实际生效的模式（仅 'light' | 'dark'） */
  resolvedMode: ResolvedMode
  /** 更新主题模式（透传 store action，自动持久化） */
  setThemeMode: (mode: ThemeMode) => void
}

/**
 * 主题模式 hook：
 * - themeMode 来自 settingsStore（localStorage 持久化）
 * - 当 themeMode === 'system' 时，监听 OS prefers-color-scheme 变化实时切换
 * - resolvedMode 始终为 'light' | 'dark'，可直接传入 getThemeConfig
 */
export function useThemeMode(): UseThemeModeResult {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const [systemMode, setSystemMode] = useState<ResolvedMode>(getSystemMode)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => {
      setSystemMode(e.matches ? 'dark' : 'light')
    }
    // 现代浏览器 / Electron Chromium 支持 addEventListener
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
    // 兼容老版 Safari 回退
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }, [])

  const resolvedMode: ResolvedMode = themeMode === 'system' ? systemMode : themeMode

  return { themeMode, resolvedMode, setThemeMode }
}

/**
 * Sticky / Affix 浮层背景样式 hook。
 *
 * 根据当前 resolvedMode 返回对应的半透明背景色 + 12px 毛玻璃模糊，
 * 供 sticky header / affix toolbar 等浮层组件直接展开使用。
 */
export function useStickyBg(): CSSProperties {
  const { resolvedMode } = useThemeMode()
  return {
    background: resolvedMode === 'dark' ? stickyBgDark : stickyBgLight,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)'
  }
}
