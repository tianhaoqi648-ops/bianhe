// ============================================================
// undo-manager.ts — 渲染进程全局撤销/重做协调器（单例）
//
// 职责：
//   1. 维护 pastStack（可撤销）和 futureStack（可重做），栈深 50
//   2. pushEntry: 写操作完成后入栈（5 个业务 store 调用）
//   3. undo: 调用 window.undoAPI.undo 触发主进程反向操作，成功后
//      调用对应 store 的 refresher 刷新数据，并将该条目推入 futureStack
//   4. redo: 调用 window.undoAPI.redo 触发主进程正向操作，成功后
//      从 futureStack 弹出并推入 pastStack
//   5. subscribe: 供 undoStore 订阅状态变化
//   6. registerStoreRefresher: 5 个 store 注册各自的刷新函数
//
// 注意：本模块不持有任何 React state，仅维护纯 JS 数据结构与回调列表。
//       React 组件通过 undoStore 订阅本单例的状态变化。
// ============================================================

import type {
  UndoStackEntry,
  UndoResult,
  UndoLogEntry
} from '../../../shared/types'

type StoreName = UndoLogEntry['store_name']

const MAX_STACK_SIZE = 50

// pastStack: 可撤销操作（栈顶为最近一次操作）
// futureStack: 撤销后可重做的操作（栈顶为最近撤销的操作）
const pastStack: UndoStackEntry[] = []
const futureStack: UndoStackEntry[] = []

// store 刷新函数注册表（undo 成功后调用，确保渲染层数据与 DB 一致）
const storeRefreshers = new Map<StoreName, () => void>()

// 订阅者列表（state 变化时通知）
const listeners = new Set<() => void>()

function notifyListeners(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch (e) {
      console.error('[undoManager] listener error:', e)
    }
  }
}

function trimStack(stack: UndoStackEntry[]): void {
  while (stack.length > MAX_STACK_SIZE) {
    stack.shift() // 移除最旧条目
  }
}

export const undoManager = {
  // ---------- 入栈 ----------
  /**
   * 写操作完成后调用，将条目推入 pastStack。
   *
   * C1 修复：logId 为 null/undefined 时表示主进程未入栈（payload 超限等），
   * 此时跳过本地入栈避免与 DB 失同步，但仍清空 futureStack（新操作覆盖重做语义）。
   * 任何新的写操作都会清空 futureStack（标准 undo/redo 语义）。
   */
  pushEntry(entry: UndoStackEntry): void {
    // 新操作总是清空重做栈（即使本条不入 pastStack，也无法重做之前撤销的操作）
    if (futureStack.length > 0) {
      futureStack.length = 0
    }
    // logId 为空表示主进程未创建 undo_log，跳过入栈
    if (!entry.logId) {
      notifyListeners()
      return
    }
    pastStack.push(entry)
    trimStack(pastStack)
    notifyListeners()
  },

  // ---------- 撤销 ----------
  /**
   * 触发撤销：调用主进程 system:undo，成功后从 pastStack 弹出并推入 futureStack，
   * 然后调用对应 store 的 refresher 刷新数据。
   * @returns UndoResult 或 null（无可撤销）
   */
  async undo(): Promise<UndoResult | null> {
    if (pastStack.length === 0) {
      return null
    }

    const entry = pastStack[pastStack.length - 1]
    const response = await window.undoAPI.undo(
      entry.logId ? { logId: entry.logId } : undefined
    )

    if (!response.success || response.data === undefined) {
      throw new Error(response.error ?? '撤销失败')
    }

    const result = response.data

    // 主进程标记 log 为 undone（不删除），此处从 pastStack 弹出
    pastStack.pop()
    // 推入 futureStack 供 redo 使用
    futureStack.push(entry)
    trimStack(futureStack)

    // 调用对应 store 的 refresher 刷新数据
    const refresher = storeRefreshers.get(result.storeName)
    if (refresher) {
      try {
        refresher()
      } catch (e) {
        console.error(
          `[undoManager] refresher error for ${result.storeName}:`,
          e
        )
      }
    }

    notifyListeners()
    return result
  },

  // ---------- 重做 ----------
  /**
   * 触发重做：调用主进程 system:redo，成功后从 futureStack 弹出并推入 pastStack。
   *
   * Medium-1 修复：传 entry.logId 给主进程，确保操作的是 futureStack 栈顶对应的 log，
   * 而非主进程 getLatestRedoable() 返回的 log（可能与栈顶不一致）。
   * @returns UndoResult 或 null（无可重做）
   */
  async redo(): Promise<UndoResult | null> {
    if (futureStack.length === 0) {
      return null
    }

    const entry = futureStack[futureStack.length - 1]
    const response = await window.undoAPI.redo(
      entry.logId ? { logId: entry.logId } : undefined
    )
    if (!response.success || response.data === undefined) {
      throw new Error(response.error ?? '重做失败')
    }

    const result = response.data
    futureStack.pop()
    pastStack.push(entry)
    trimStack(pastStack)

    // 调用对应 store 的 refresher
    const refresher = storeRefreshers.get(result.storeName)
    if (refresher) {
      try {
        refresher()
      } catch (e) {
        console.error(
          `[undoManager] refresher error for ${result.storeName}:`,
          e
        )
      }
    }

    notifyListeners()
    return result
  },

  // ---------- 查询 ----------
  canUndo(): boolean {
    return pastStack.length > 0
  },

  canRedo(): boolean {
    return futureStack.length > 0
  },

  /**
   * 返回栈顶操作的 label（用于 UI 提示"撤销：xxx"）
   */
  getLastActionLabel(): string | null {
    if (pastStack.length === 0) return null
    return pastStack[pastStack.length - 1].label
  },

  /**
   * 返回 pastStack 顶部 N 条 label（用于下拉列表展示撤销历史）
   */
  listRecentActions(limit = 10): Array<{ label: string; index: number }> {
    const start = Math.max(0, pastStack.length - limit)
    const result: Array<{ label: string; index: number }> = []
    for (let i = pastStack.length - 1; i >= start; i--) {
      result.push({ label: pastStack[i].label, index: i })
    }
    return result
  },

  // ---------- 订阅 ----------
  /**
   * 订阅状态变化。返回取消订阅函数。
   */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  // ---------- 栈管理 ----------
  /**
   * 清空 past + future（数据重置时调用）。
   */
  clearStack(): void {
    pastStack.length = 0
    futureStack.length = 0
    notifyListeners()
  },

  // ---------- store refresher 注册 ----------
  /**
   * 注册某 store 的刷新函数。undo 成功后调用对应刷新函数，确保渲染层与 DB 一致。
   */
  registerStoreRefresher(storeName: StoreName, fn: () => void): void {
    storeRefreshers.set(storeName, fn)
  },

  /**
   * 取消注册（store 卸载时调用，本应用中通常不需要）。
   */
  unregisterStoreRefresher(storeName: StoreName): void {
    storeRefreshers.delete(storeName)
  },

  // ---------- 调试用 ----------
  /** 返回 pastStack 浅拷贝（仅调试用） */
  _debugGetPastStack(): UndoStackEntry[] {
    return [...pastStack]
  },
  /** 返回 futureStack 浅拷贝（仅调试用） */
  _debugGetFutureStack(): UndoStackEntry[] {
    return [...futureStack]
  }
}

/**
 * 便捷导出：注册 store refresher。
 * 5 个业务 store 在模块加载时调用一次即可。
 */
export function registerStoreRefresher(
  storeName: StoreName,
  fn: () => void
): void {
  undoManager.registerStoreRefresher(storeName, fn)
}
