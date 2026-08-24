// ============================================================
// dbModeStore.ts — 渲染进程数据库模式（persistent / memory）状态
//
// 单一来源：主进程通过 window.electron.dbStatus（getMode / onChange）暴露。
// 本 store 在 App 根 mount 时初始化一次（initDbMode），
// AppHeader / MemoryModeBanner 等组件统一订阅，避免各组件各自 getMode/onChange。
// ============================================================

import { create } from 'zustand'
import type { DbMode } from '../../../shared/types'

interface DbModeState {
  /** 当前数据库模式，默认 persistent */
  dbMode: DbMode
  /**
   * 初始化：拉取初始模式 + 订阅后续变化。
   * 返回取消订阅函数（用于 App 卸载时清理）。
   * 在非 Electron 环境（如单测 / 浏览器）安全降级为 no-op。
   */
  initDbMode: () => () => void
  /** 设置模式（测试 / 兜底用，正常流程由 onChange 驱动） */
  setDbMode: (mode: DbMode) => void
}

export const useDbModeStore = create<DbModeState>((set) => ({
  dbMode: 'persistent',

  initDbMode: () => {
    const api =
      typeof window !== 'undefined' ? window.electron?.dbStatus : undefined
    if (!api) return () => undefined
    void api
      .getMode()
      .then((mode) => set({ dbMode: mode }))
      .catch(() => {
        // 拉取失败保持默认，不打断首屏
      })
    return api.onChange((mode) => set({ dbMode: mode }))
  },

  setDbMode: (mode) => set({ dbMode: mode })
}))