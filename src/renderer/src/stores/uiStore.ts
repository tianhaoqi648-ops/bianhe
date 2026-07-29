// ============================================================
// uiStore.ts — UI 状态管理（命令面板 + 最近访问页面 + 最近操作）
//
// 职责：
// 1. 命令面板开关状态（内存级，不持久化，每次启动默认关闭）
// 2. 最近访问页面列表（持久化到 localStorage，最多 5 条，新的在前，去重）
// 3. 最近操作列表（持久化到 localStorage，最多 5 条，新的在前，去重）
//    — 记录用户在命令面板中执行过的命令，便于快速再次执行
// ============================================================

import { create } from 'zustand'

/** localStorage 持久化 recentPages 的 key */
const RECENT_PAGES_LS_KEY = 'bianhe-ui-recent-pages'

/** localStorage 持久化 recentActions 的 key */
const RECENT_ACTIONS_LS_KEY = 'bianhe-ui-recent-actions'

/** 最近访问页面保留的最大条数 */
const MAX_RECENT_PAGES = 5

/** 最近操作保留的最大条数 */
const MAX_RECENT_ACTIONS = 5

/**
 * 从 localStorage 读取持久化的最近访问页面。
 * 在 node 测试环境 / 隐私模式 / 解析异常时安全回退到空数组。
 */
function loadRecentPages(): string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return []
    const raw = window.localStorage.getItem(RECENT_PAGES_LS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    // 仅保留字符串项，防止脏数据；并截断到上限
    return arr
      .filter((p): p is string => typeof p === 'string')
      .slice(0, MAX_RECENT_PAGES)
  } catch {
    return []
  }
}

/**
 * 最近操作条目。记录用户在命令面板中执行过的命令，
 * 用于在面板顶部"最近操作"区快速再次执行。
 */
export interface RecentActionEntry {
  /** 唯一 id（已规范化，用于去重。如 page-/timer、action-开始计时、topic-abc123） */
  id: string
  /** 显示标签 */
  label: string
  /** 所属分组名（用于显示，如"页面跳转"/"快速动作"/"题库"/"赛事"） */
  group: string
  /** 路由路径（用于再次执行 navigateTo） */
  path: string
  /** 图标类型标识（用于反序列化时恢复图标） */
  iconType: 'page' | 'topic' | 'event' | 'action'
}

/**
 * 从 localStorage 读取持久化的最近操作列表。
 * 安全回退到空数组。
 */
function loadRecentActions(): RecentActionEntry[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return []
    const raw = window.localStorage.getItem(RECENT_ACTIONS_LS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (x): x is RecentActionEntry =>
          x &&
          typeof x === 'object' &&
          typeof x.id === 'string' &&
          typeof x.label === 'string' &&
          typeof x.path === 'string' &&
          typeof x.iconType === 'string'
      )
      .slice(0, MAX_RECENT_ACTIONS)
  } catch {
    return []
  }
}

interface UIState {
  /** 命令面板是否打开 */
  commandPaletteOpen: boolean
  /** 最近访问的页面路径（最多 5 条，新的在前，去重） */
  recentPages: string[]
  /** 最近执行的命令（最多 5 条，新的在前，去重） */
  recentActions: RecentActionEntry[]

  /** Actions */
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  /** 添加最近访问页面（自动去重 + 截断到 5 条） */
  addRecentPage: (path: string) => void
  /** 添加最近操作（自动去重 + 截断到 5 条） */
  addRecentAction: (entry: RecentActionEntry) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  // 命令面板每次启动默认关闭（不持久化）
  commandPaletteOpen: false,
  // 启动时同步从 localStorage 读取，避免首屏闪烁
  recentPages: loadRecentPages(),
  recentActions: loadRecentActions(),

  setCommandPaletteOpen: (open) => {
    set({ commandPaletteOpen: open })
  },

  toggleCommandPalette: () => {
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen }))
  },

  addRecentPage: (path) => {
    const current = get().recentPages
    // 去重：如果已存在，先移除
    const filtered = current.filter((p) => p !== path)
    // 新的在前，截断到上限
    const next = [path, ...filtered].slice(0, MAX_RECENT_PAGES)
    set({ recentPages: next })
    // 持久化
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(RECENT_PAGES_LS_KEY, JSON.stringify(next))
      }
    } catch {
      // localStorage 不可用时静默失败（不影响内存中的状态）
    }
  },

  addRecentAction: (entry) => {
    const current = get().recentActions
    // 去重：如果已存在同 id，先移除
    const filtered = current.filter((x) => x.id !== entry.id)
    // 新的在前，截断到上限
    const next = [entry, ...filtered].slice(0, MAX_RECENT_ACTIONS)
    set({ recentActions: next })
    // 持久化
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(RECENT_ACTIONS_LS_KEY, JSON.stringify(next))
      }
    } catch {
      // localStorage 不可用时静默失败
    }
  }
}))
