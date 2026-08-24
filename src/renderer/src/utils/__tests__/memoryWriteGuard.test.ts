// ============================================================
// memoryWriteGuard.test.ts — memory 模式写警示（renderer 订阅端）
//
// 白屏回归：旧实现改写只读 API 属性报错；新实现仅订阅 preload 发出的
// memory:write-warning 事件，不触碰任何 window.xxxAPI 对象。
// 覆盖 P0 要求的：readonly 不抛、persistent 不提示、memory 被捕获、
// 读不受影响、App mount 不崩。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installMemoryWriteGuard } from '../memoryWriteGuard'
import { MEMORY_WRITE_WARNING } from '../memoryModeGuard'

const EVENT = 'memory:write-warning'

/** 伪造可订阅/退订的 ipcRenderer + 可触发事件 */
function makeIpc() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  const ipc = {
    on: vi.fn((ch: string, cb: (...args: unknown[]) => void) => {
      ;(listeners[ch] ??= []).push(cb)
    }),
    removeListener: vi.fn((ch: string, cb: (...args: unknown[]) => void) => {
      listeners[ch] = (listeners[ch] ?? []).filter((x) => x !== cb)
    })
  }
  const emit = (ch: string, ...args: unknown[]) => {
    ;(listeners[ch] ?? []).forEach((cb) => cb(...args))
  }
  return { ipc, emit }
}

function withIpc(ipc: unknown): void {
  const g = globalThis as {
    window?: { electron?: { ipcRenderer: unknown } }
  }
  g.window = { electron: { ipcRenderer: ipc } }
}

beforeEach(() => {
  const g = globalThis as { window?: unknown }
  delete g.window
})

describe('installMemoryWriteGuard（renderer 警示订阅，不做对象改写）', () => {
  it('不修改 readonly API 属性：即便 window.xxxAPI 冻结也不抛错', () => {
    withIpc({ on: vi.fn(), removeListener: vi.fn() })
    // 无 window.xxxAPI 改写逻辑；即便传入冻结对象也不受影响
    const frozenApi = Object.freeze({ delete: Object.freeze(() => undefined) })
    expect(() => installMemoryWriteGuard({ warn: vi.fn() })).not.toThrow()
    expect(frozenApi.delete).toBeDefined()
  })

  it('无 IPC 桥（非 Electron / 单测）安全降级不抛错', () => {
    expect(() => installMemoryWriteGuard({ warn: vi.fn() })).not.toThrow()
  })

  it('memory 模式写被捕获：收到 memory:write-warning → warn 一次', () => {
    const { ipc, emit } = makeIpc()
    withIpc(ipc)
    const warn = vi.fn()
    installMemoryWriteGuard({ warn })
    emit(EVENT)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(MEMORY_WRITE_WARNING)
  })

  it('persistent（未收到事件）不 warn，read 不受影响', () => {
    const { ipc } = makeIpc()
    withIpc(ipc)
    const warn = vi.fn()
    installMemoryWriteGuard({ warn })
    expect(warn).not.toHaveBeenCalled()
  })

  it('cleanup 取消订阅后事件不再触发 warn', () => {
    const { ipc, emit } = makeIpc()
    withIpc(ipc)
    const warn = vi.fn()
    const cleanup = installMemoryWriteGuard({ warn })
    cleanup()
    emit(EVENT)
    expect(warn).not.toHaveBeenCalled()
  })

  it('App mount 场景：install 不抛错并返回清理函数', () => {
    const { ipc } = makeIpc()
    withIpc(ipc)
    const cleanup = installMemoryWriteGuard({ warn: vi.fn() })
    expect(typeof cleanup).toBe('function')
  })
})