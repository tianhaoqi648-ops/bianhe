// ============================================================
// memoryModeGuard.test.ts — gov4.1/4.2 内存模式判定与提示逻辑（渲染端纯逻辑）
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  MEMORY_PERSISTENT_WARNING,
  MEMORY_WRITE_WARNING,
  isMemoryMode,
  memoryPersistentWarning,
  shouldWarnMemoryWrite,
  memoryWriteWarning
} from '../memoryModeGuard'

describe('memoryModeGuard 纯逻辑', () => {
  it('isMemoryMode：仅 memory 返回 true', () => {
    expect(isMemoryMode('memory')).toBe(true)
    expect(isMemoryMode('persistent')).toBe(false)
  })

  it('memoryPersistentWarning：memory 返回常驻文案，persistent 返回 null', () => {
    expect(memoryPersistentWarning('memory')).toBe(MEMORY_PERSISTENT_WARNING)
    expect(memoryPersistentWarning('persistent')).toBeNull()
  })

  it('常驻文案包含数据无法持久化与关闭丢失语义', () => {
    expect(MEMORY_PERSISTENT_WARNING).toContain('临时内存模式')
    expect(MEMORY_PERSISTENT_WARNING).toContain('无法持久保存')
    expect(MEMORY_PERSISTENT_WARNING).toContain('关闭程序将丢失')
  })

  it('shouldWarnMemoryWrite：memory true，persistent false（写操作判定）', () => {
    expect(shouldWarnMemoryWrite('memory')).toBe(true)
    expect(shouldWarnMemoryWrite('persistent')).toBe(false)
  })

  it('memoryWriteWarning：memory 返回写操作文案，persistent 返回 null', () => {
    expect(memoryWriteWarning('memory')).toBe(MEMORY_WRITE_WARNING)
    expect(memoryWriteWarning('persistent')).toBeNull()
  })

  it('写操作文案为"当前数据无法持久保存"', () => {
    expect(MEMORY_WRITE_WARNING).toBe('当前数据无法持久保存')
  })
})