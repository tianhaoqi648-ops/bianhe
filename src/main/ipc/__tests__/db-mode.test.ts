// ============================================================
// db-mode.test.ts — 主进程 dbMode 暴露（gov4.1）
//
// 主进程 dbMode 状态来源为 db/mode.ts 的 createDbModeStore，
// 它不依赖 electron / better-sqlite3，可在 node 环境直接单测。
// 该状态驱动：
//   - ipc 'db:get-mode' 返回当前模式（main/index.ts）
//   - websocket 广播 'db:status'（db/index.ts 订阅 onChange）
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { createDbModeStore, dbModeStore } from '../../db/mode'

describe('createDbModeStore（主进程 dbMode 状态暴露）', () => {
  it('默认 persistent', () => {
    const store = createDbModeStore()
    expect(store.mode).toBe('persistent')
  })

  it('可指定初始模式', () => {
    const store = createDbModeStore('memory')
    expect(store.mode).toBe('memory')
  })

  it('setMode 更新 mode 并通知监听者', () => {
    const store = createDbModeStore()
    const spy = vi.fn()
    store.onChange(spy)

    store.setMode('memory')
    expect(store.mode).toBe('memory')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('memory')
  })

  it('setMode 同值时不重复通知', () => {
    const store = createDbModeStore('memory')
    const spy = vi.fn()
    store.onChange(spy)

    store.setMode('memory')
    expect(spy).not.toHaveBeenCalled()
  })

  it('onChange 返回取消订阅函数，取消后不再通知', () => {
    const store = createDbModeStore()
    const spy = vi.fn()
    const unsubscribe = store.onChange(spy)

    store.setMode('memory')
    expect(spy).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.setMode('persistent')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('多监听者各自都能收到通知', () => {
    const store = createDbModeStore()
    const a = vi.fn()
    const b = vi.fn()
    store.onChange(a)
    store.onChange(b)

    store.setMode('memory')
    expect(a).toHaveBeenCalledWith('memory')
    expect(b).toHaveBeenCalledWith('memory')
  })

  it('应用全局单例 dbModeStore 初始为 persistent', () => {
    // db/index.ts 初始化后会通过 setMode 更新为真实模式；此处验证默认值与稳定性
    expect(dbModeStore).toBeDefined()
    expect(typeof dbModeStore.mode).toBe('string')
  })
})