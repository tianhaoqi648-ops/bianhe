import { BrowserWindow } from 'electron'

/**
 * 获取当前活动窗口，若不存在返回 null。
 * 用于 IPC handler 中避免 getFocusedWindow()! 非空断言导致的运行时错误。
 */
export function getActiveWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}
