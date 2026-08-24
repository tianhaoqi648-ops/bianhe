// ============================================================
// memoryWriteGuard.ts — 内存（临时）模式写操作警示
//
// 白屏修复（P0）：
//   旧实现通过在 window.topicAPI.delete 等 **contextBridge 暴露后被冻结
//   （属性只读）** 的对象上做 `owner[key] = wrapped` 来拦截写调用，导致
//   App mount 时抛 "Cannot assign to read only property 'delete'" → 白屏。
//   现改为：不修改任何只读 API 对象，改由 preload 层在唯一的 invoke 出入口
//   判定「memory 模式 + 写通道」后发出 memory:write-warning 事件（经主进程中继），
//   本模块只负责订阅该事件并触发一次警示提示。
//   产品语义不变：memory 模式写操作依然执行，只是提示（不阻断）。
// ============================================================

import { MEMORY_WRITE_WARNING } from './memoryModeGuard'

export interface MemoryWriteGuardOptions {
  /** 兼容保留：内存判定已前移到 preload，本参数不再用于拦截决策 */
  isMemory?: () => boolean
  /** 警示回调（展示 toast/modal），收到 preload 写警示事件时触发 */
  warn?: (message: string) => void
}

const MEMORY_WRITE_WARNING_EVENT = 'memory:write-warning'

/**
 * 安装 memory 模式写警示：
 * 订阅 preload 发出的 memory:write-warning 事件，事件到达时调用 warn()。
 * 不做任何对象属性改写，因此不会触碰只读的 window.xxxAPI，也不会抛出。
 * @returns 取消订阅的清理函数（App 卸载时调用）
 */
export function installMemoryWriteGuard(options: MemoryWriteGuardOptions = {}): () => void {
  const { warn } = options
  const ipc =
    typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined
  if (!ipc || typeof ipc.on !== 'function' || typeof ipc.removeListener !== 'function') {
    // 非 Electron / 缺 IPC 桥（如单测、浏览器）时安全降级为 no-op
    return () => undefined
  }

  const listener = (): void => {
    if (warn) warn(MEMORY_WRITE_WARNING)
  }
  ipc.on(MEMORY_WRITE_WARNING_EVENT, listener)
  return () => {
    ipc.removeListener(MEMORY_WRITE_WARNING_EVENT, listener)
  }
}