// ============================================================
// undoStore.ts — 撤销/重做 React 绑定层
//
// 通过订阅 undoManager 单例的状态变化，将状态同步到 Zustand store，
// 让 React 组件能响应式地更新 canUndo / canRedo / lastActionLabel 等。
//
// 同时提供 undo() / redo() 异步 action，封装执行状态与错误处理。
// ============================================================

import { create } from 'zustand'
import { undoManager } from '../utils/undo-manager'
import type { UndoResult } from '../../../shared/types'

interface UndoStoreState {
  // 状态镜像
  canUndo: boolean
  canRedo: boolean
  lastActionLabel: string | null
  // 执行态
  executing: boolean
  error: string | null
  lastUndoResult: UndoResult | null
  // 自增计数器，强制 React 重渲染（避免引用相同时不更新）
  tick: number

  // actions
  undo: () => Promise<void>
  redo: () => Promise<void>
  syncFromManager: () => void
  clearError: () => void
}

export const useUndoStore = create<UndoStoreState>((set, get) => ({
  canUndo: false,
  canRedo: false,
  lastActionLabel: null,
  executing: false,
  error: null,
  lastUndoResult: null,
  tick: 0,

  undo: async () => {
    if (get().executing) return // 防止重复触发
    set({ executing: true, error: null })
    try {
      const result = await undoManager.undo()
      if (result === null) {
        set({ executing: false, error: '无可撤销的操作' })
      } else {
        set({
          executing: false,
          lastUndoResult: result,
          error: null
        })
      }
      get().syncFromManager()
    } catch (e) {
      set({
        executing: false,
        error: e instanceof Error ? e.message : String(e)
      })
      get().syncFromManager()
    }
  },

  redo: async () => {
    if (get().executing) return
    set({ executing: true, error: null })
    try {
      const result = await undoManager.redo()
      if (result === null) {
        // Medium-1 修复：redo 已实现，错误信息应与 undo 一致
        set({ executing: false, error: '无可重做的操作' })
      } else {
        set({
          executing: false,
          lastUndoResult: result,
          error: null
        })
      }
      get().syncFromManager()
    } catch (e) {
      set({
        executing: false,
        error: e instanceof Error ? e.message : String(e)
      })
      get().syncFromManager()
    }
  },

  syncFromManager: () => {
    set({
      canUndo: undoManager.canUndo(),
      canRedo: undoManager.canRedo(),
      lastActionLabel: undoManager.getLastActionLabel(),
      tick: get().tick + 1
    })
  },

  clearError: () => set({ error: null })
}))

// 订阅 undoManager 状态变化，自动同步到 store
undoManager.subscribe(() => {
  useUndoStore.getState().syncFromManager()
})
