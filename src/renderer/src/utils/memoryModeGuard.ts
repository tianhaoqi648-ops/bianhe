// ============================================================
// memoryModeGuard.ts — 内存（临时）模式纯逻辑工具
//
// gov4.1 / gov4.2：
//   - 常驻警告文案（矩阵警告条）
//   - 写/破坏性操作的提示文案与判定
// 全部为纯函数，无 electron / react 依赖，便于单测。
// ============================================================

import type { DbMode } from '../../../shared/types'

/** gov4.1：常驻警告文案（MemoryModeBanner） */
export const MEMORY_PERSISTENT_WARNING =
  '当前为临时内存模式，数据无法持久保存，关闭程序将丢失'

/** gov4.2：写/破坏性操作警示文案（toast） */
export const MEMORY_WRITE_WARNING = '当前数据无法持久保存'

/** 是否处于内存（临时）模式 */
export function isMemoryMode(mode: DbMode): boolean {
  return mode === 'memory'
}

/**
 * gov4.1：返回应展示的常驻警告文案；非 memory 模式返回 null。
 * 供 MemoryModeBanner 决定是否渲染。
 */
export function memoryPersistentWarning(mode: DbMode): string | null {
  return isMemoryMode(mode) ? MEMORY_PERSISTENT_WARNING : null
}

/**
 * gov4.2：内存模式下写/破坏性操作是否应提示。
 * 返回 true 表示需要在执行前给一次警示。
 */
export function shouldWarnMemoryWrite(mode: DbMode): boolean {
  return isMemoryMode(mode)
}

/**
 * gov4.2：返回写操作警示文案；非 memory 模式返回 null。
 * 供调用方在 memory 模式下展示 toast/modal。
 */
export function memoryWriteWarning(mode: DbMode): string | null {
  return shouldWarnMemoryWrite(mode) ? MEMORY_WRITE_WARNING : null
}