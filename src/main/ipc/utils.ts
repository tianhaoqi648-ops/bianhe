// ============================================================
// ipc/utils.ts — IPC handler 公共工具
//
// 提供：
//   wrap            读操作用：捕获异常返回 ApiResponse
//   wrapWithUndo    写操作用：解构 WithUndoLogResult，附加 _undoLogId
//   getActiveWindow 获取当前活动 BrowserWindow（dialog 用）
//
// L3 修复：提取公共 wrap 函数，避免 6 个 IPC 文件重复定义。
// C1 修复：wrapWithUndo 透传 logId，渲染进程据 logId 决定是否入栈。
// Critical-1 修复：提取 getActiveWindow，避免 audit/system/export 三个
//                  IPC 文件各自实现或缺失导入。
// ============================================================

import { BrowserWindow } from 'electron'
import type { ApiResponse } from '../../shared/types'
import type { WithUndoLogResult } from '../services/undo-service'

/**
 * 读操作通用包装：捕获异常返回 ApiResponse。
 * 不附带 _undoLogId（读操作无副作用，无需撤销）。
 */
export function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    return { success: true, data: fn() }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 写操作通用包装：解构 WithUndoLogResult，附加 _undoLogId。
 *
 * @param fn 返回 WithUndoLogResult<T> 的函数（通常是 withUndoLog(...)）
 * @returns ApiResponse<T>，其中 _undoLogId 为：
 *   - string：成功创建 undo_log，可撤销
 *   - null：payload 超限未入栈，不可撤销
 */
export function wrapWithUndo<T>(
  fn: () => WithUndoLogResult<T>
): ApiResponse<T> {
  try {
    const { result, logId } = fn()
    return { success: true, data: result, _undoLogId: logId }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 获取当前活动窗口（用于 dialog.showOpenDialog / showSaveDialog 等）。
 *
 * 优先返回焦点窗口；若无焦点窗口，返回第一个可用窗口；都没有则返回 undefined。
 */
export function getActiveWindow(): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  const all = BrowserWindow.getAllWindows()
  return all.find((w) => !w.isDestroyed())
}
