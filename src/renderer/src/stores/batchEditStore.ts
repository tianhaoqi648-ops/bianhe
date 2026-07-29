// ============================================================
// batchEditStore.ts — 批量编辑弹窗 + 历史 Zustand store
//
// 管理弹窗可见性、执行状态、历史列表，连接 UI 与 batchEditAPI。
// ============================================================

import { create } from 'zustand'
import type {
  BatchEditExecuteRequest,
  BatchEditExecuteResult,
  BatchEditHistory,
  BatchEditRevertResult
} from '../../../shared/types'

interface BatchEditState {
  // 弹窗可见
  modalOpen: boolean
  // 历史弹窗可见
  historyOpen: boolean
  // 执行中
  executing: boolean
  // 历史列表
  historyList: BatchEditHistory[]
  historyLoading: boolean

  // actions
  openModal: () => void
  closeModal: () => void
  openHistory: () => void
  closeHistory: () => void
  execute: (req: BatchEditExecuteRequest) => Promise<BatchEditExecuteResult | null>
  revert: (historyId: string) => Promise<BatchEditRevertResult | null>
  fetchHistory: () => Promise<void>
}

export const useBatchEditStore = create<BatchEditState>((set) => ({
  modalOpen: false,
  historyOpen: false,
  executing: false,
  historyList: [],
  historyLoading: false,

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
  openHistory: () => set({ historyOpen: true }),
  closeHistory: () => set({ historyOpen: false }),

  execute: async (req) => {
    set({ executing: true })
    try {
      const res = await window.batchEditAPI.execute(req)
      if (!res.success || !res.data) {
        throw new Error(res.error || '执行失败')
      }
      return res.data
    } finally {
      set({ executing: false })
    }
  },

  revert: async (historyId) => {
    const res = await window.batchEditAPI.revert(historyId)
    if (!res.success || !res.data) {
      throw new Error(res.error || '撤销失败')
    }
    return res.data
  },

  fetchHistory: async () => {
    set({ historyLoading: true })
    try {
      const res = await window.batchEditAPI.listHistory()
      if (res.success && res.data) {
        set({ historyList: res.data })
      }
    } finally {
      set({ historyLoading: false })
    }
  }
}))
