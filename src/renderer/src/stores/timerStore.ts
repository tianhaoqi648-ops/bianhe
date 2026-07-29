// ============================================================
// timerStore.ts — 计时会话 Zustand store
//
// 职责：
// 1. 管理当前计时会话（create/load/clear）
// 2. 持久化状态到 DB（防抖 500ms）
// 3. 加载历史会话列表
// 4. 维护对阵信息（队名展示用，队 ID 已在 session 中）
// 5. 计时记录的写入与导出
// ============================================================

import { create } from 'zustand'
import type { DebateFormatData, TimerSession, TimerRecord } from '../../../shared/types'
import type { StageSide } from '../../../shared/debate-formats/types'

/** 对阵展示信息（队名 + 可选 logo data URL） */
export interface TimerMatchup {
  affTeamId: string | null
  negTeamId: string | null
  affTeamName: string
  negTeamName: string
  /** 队徽 data URL（可选，无则用首字头像 fallback） */
  affLogo?: string | null
  negLogo?: string | null
}

interface TimerStoreState {
  currentSession: TimerSession | null
  sessions: TimerSession[]
  /** 当前对阵展示信息 */
  matchup: TimerMatchup | null
  loading: boolean
  error: string | null

  createSession: (opts: {
    formatId: string
    formatSnapshot: DebateFormatData
    label?: string
    eventId?: string
    roundId?: string
    teamAffId?: string
    teamNegId?: string
    topicId?: string
    eventName?: string
    teamAffName?: string
    teamNegName?: string
    topicTitle?: string
  }) => Promise<TimerSession | null>
  loadSession: (id: string) => Promise<TimerSession | null>
  fetchSessions: () => Promise<void>
  /** 同步更新内存中的 currentSession 状态（不写 DB） */
  updateSessionState: (opts: Partial<Pick<TimerSession, 'status' | 'startedAt' | 'endedAt' | 'currentStageIndex' | 'currentSide' | 'remainingMs' | 'stageRemainingCache' | 'affRemainingMs' | 'negRemainingMs'>>) => void
  /** 持久化会话状态到 DB（防抖由调用方负责） */
  persistSessionState: (id: string, opts: Partial<Pick<TimerSession, 'status' | 'startedAt' | 'endedAt' | 'currentStageIndex' | 'currentSide' | 'remainingMs' | 'stageRemainingCache' | 'affRemainingMs' | 'negRemainingMs'>>) => Promise<void>
  deleteSession: (id: string) => Promise<boolean>
  clearCurrent: () => void
  /** 设置对阵展示信息 */
  setMatchup: (m: TimerMatchup | null) => void
  /** 结束会话（状态置为 finished + 写 endedAt） */
  finishSession: (id: string, endedAt: string) => Promise<TimerSession | null>
  /** 新增计时记录 */
  addRecord: (opts: {
    sessionId: string
    stageIndex: number
    stageName: string
    side: StageSide
    durationMs: number
    startedAt: string
  }) => Promise<TimerRecord | null>
  /** 完成计时记录 */
  finishRecord: (
    sessionId: string,
    stageIndex: number,
    actualMs: number,
    endedAt: string,
    pauseCount: number
  ) => Promise<boolean>
  /** 导出会话的所有计时记录 */
  exportRecords: (sessionId: string) => Promise<TimerRecord[]>
}

export const useTimerStore = create<TimerStoreState>((set, get) => ({
  currentSession: null,
  sessions: [],
  matchup: null,
  loading: false,
  error: null,

  createSession: async (opts) => {
    try {
      const res = await window.timerAPI.createSession(opts)
      if (res.success && res.data) {
        set({ currentSession: res.data })
        return res.data
      }
      set({ error: res.error ?? '创建会话失败' })
      return null
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '创建会话失败' })
      return null
    }
  },

  loadSession: async (id) => {
    try {
      const res = await window.timerAPI.getSession(id)
      if (res.success && res.data) {
        set({ currentSession: res.data })
        return res.data
      }
      return null
    } catch {
      return null
    }
  },

  fetchSessions: async () => {
    set({ loading: true })
    try {
      const res = await window.timerAPI.listSessions(50)
      if (res.success && res.data) {
        set({ sessions: res.data, loading: false })
      } else {
        set({ loading: false })
      }
    } catch {
      set({ loading: false })
    }
  },

  // 同步更新内存中的 currentSession 状态（不写 DB，防抖由调用方负责）
  updateSessionState: (opts) => {
    const current = get().currentSession
    if (current) {
      set({ currentSession: { ...current, ...opts } })
    }
  },

  // 持久化会话状态到 DB
  persistSessionState: async (id, opts) => {
    try {
      await window.timerAPI.updateSession(id, opts)
    } catch {
      // 持久化失败不影响计时主流程
    }
  },

  deleteSession: async (id) => {
    try {
      const res = await window.timerAPI.deleteSession(id)
      if (res.success && res.data) {
        set((s) => ({
          sessions: s.sessions.filter((x) => x.id !== id),
          currentSession: s.currentSession?.id === id ? null : s.currentSession,
          matchup: s.currentSession?.id === id ? null : s.matchup
        }))
        return true
      }
      return false
    } catch {
      return false
    }
  },

  clearCurrent: () => set({ currentSession: null, matchup: null }),

  setMatchup: (m) => set({ matchup: m }),

  finishSession: async (id, endedAt) => {
    try {
      const res = await window.timerAPI.finishSession(id, endedAt)
      if (res.success && res.data) {
        set({ currentSession: res.data })
        return res.data
      }
      return null
    } catch {
      return null
    }
  },

  addRecord: async (opts) => {
    try {
      const res = await window.timerAPI.addRecord(opts)
      if (res.success && res.data) return res.data
      return null
    } catch {
      return null
    }
  },

  finishRecord: async (sessionId, stageIndex, actualMs, endedAt, pauseCount) => {
    try {
      const res = await window.timerAPI.finishRecord(sessionId, stageIndex, actualMs, endedAt, pauseCount)
      return res.success
    } catch {
      return false
    }
  },

  exportRecords: async (sessionId) => {
    try {
      const res = await window.timerAPI.exportRecords(sessionId)
      if (res.success && res.data) return res.data
      return []
    } catch {
      return []
    }
  }
}))
