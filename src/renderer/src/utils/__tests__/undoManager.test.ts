// ============================================================
// undoManager.test.ts — 撤销/重做栈语义单测
//
// 验证 undo-manager 单例的 redo 行为：
//   1. undo → redo 恢复原状态（成对）
//   2. 新操作清空 redo 栈（撤销后新改动不能再重做旧快照）
// 通过 mock window.undoAPI 模拟主进程 undo/redo 响应。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UndoStackEntry, UndoResult } from '../../../../shared/types'
import { undoManager, UNDO_NOT_AVAILABLE_COPY } from '../undo-manager'

const mockUndo = vi.fn()
const mockRedo = vi.fn()

function okResult(logId: string): { success: true; data: UndoResult } {
  return {
    success: true,
    data: { logId, affectedCount: 1, storeName: 'topic', label: '修改辩题' }
  }
}

describe('undoManager redo 语义', () => {
  beforeEach(() => {
    // 每个用例重置单例栈
    undoManager.clearStack()
    // 模拟渲染进程 window.undoAPI（与 preload 暴露同名）
    mockUndo.mockReset().mockResolvedValue(okResult('log1'))
    mockRedo.mockReset().mockResolvedValue(okResult('log1'))
    ;(globalThis as unknown as { window: unknown }).window = {
      undoAPI: { undo: mockUndo, redo: mockRedo }
    }
  })

  it('undo 把状态压入 redo 栈，redo 恢复原状态并压回 undo 栈', async () => {
    const entry: UndoStackEntry = {
      storeName: 'topic',
      action: 'update',
      targetType: 'topic',
      targetId: 't1',
      label: '修改辩题',
      logId: 'log1'
    }
    undoManager.pushEntry(entry)
    expect(undoManager.canUndo()).toBe(true)
    expect(undoManager.canRedo()).toBe(false)

    const undoResult = await undoManager.undo()
    expect(undoResult).not.toBeNull()
    expect(mockUndo).toHaveBeenCalledWith({ logId: 'log1' })
    // undo 后进入 redo 可重做状态
    expect(undoManager.canUndo()).toBe(false)
    expect(undoManager.canRedo()).toBe(true)

    const redoResult = await undoManager.redo()
    expect(redoResult).not.toBeNull()
    expect(mockRedo).toHaveBeenCalledWith({ logId: 'log1' })
    // redo 后恢复为可撤销状态
    expect(undoManager.canRedo()).toBe(false)
    expect(undoManager.canUndo()).toBe(true)
  })

  it('新操作会清空 redo 栈，撤销后新改动不能再重做旧快照', async () => {
    const entry1: UndoStackEntry = {
      storeName: 'topic',
      action: 'create',
      targetType: 'topic',
      targetId: 't1',
      label: '新增辩题',
      logId: 'log1'
    }
    const entry2: UndoStackEntry = {
      storeName: 'topic',
      action: 'update',
      targetType: 'topic',
      targetId: 't2',
      label: '修改另一辩题',
      logId: 'log2'
    }

    // 先入栈一条并撤销 → 进入可重做状态
    undoManager.pushEntry(entry1)
    await undoManager.undo()
    expect(undoManager.canRedo()).toBe(true)

    // 新操作入栈 → 清空 redo 栈
    mockRedo.mockResolvedValue(okResult('log2'))
    undoManager.pushEntry(entry2)
    expect(undoManager.canRedo()).toBe(false)

    // 无法再重做旧快照
    expect(await undoManager.redo()).toBeNull()

    // 且 undo 栈中应只包含新操作（旧快照已不可达）
    expect(undoManager._debugGetPastStack().map((e) => e.logId)).toEqual(['log2'])
  })
})

describe('不可撤销信号（Governance-8.1 best-effort）', () => {
  beforeEach(() => {
    undoManager.clearStack()
  })

  it('pushEntry 缺 logId 时置位 notUndoable，不进入 undo 栈', () => {
    const entry: UndoStackEntry = {
      storeName: 'topic',
      action: 'update',
      targetType: 'topic',
      targetId: 't1',
      label: '修改辩题'
      // 无 logId：主进程未创建 undo_log
    }
    undoManager.pushEntry(entry)

    expect(undoManager.canUndo()).toBe(false)
    expect(undoManager.getLastNotUndoable()).toEqual(
      expect.objectContaining({ label: '修改辩题' })
    )
  })

  it('pushEntry 带 logId 时正常入栈，不置位 notUndoable', () => {
    const entry: UndoStackEntry = {
      storeName: 'topic',
      action: 'update',
      targetType: 'topic',
      targetId: 't1',
      label: '修改辩题',
      logId: 'log1'
    }
    undoManager.pushEntry(entry)

    expect(undoManager.canUndo()).toBe(true)
    expect(undoManager.getLastNotUndoable()).toBeNull()
  })

  it('clearNotUndoable 消费信号，供 UI 提示后复位', () => {
    undoManager.pushEntry({ storeName: 'topic', action: 'create', targetType: 'topic', targetId: 't1', label: '新增' })
    expect(undoManager.getLastNotUndoable()).not.toBeNull()
    undoManager.clearNotUndoable()
    expect(undoManager.getLastNotUndoable()).toBeNull()
  })

  it('暴露统一的不可撤销文案常量', () => {
    expect(UNDO_NOT_AVAILABLE_COPY).toBe('该操作无法撤销')
  })
})