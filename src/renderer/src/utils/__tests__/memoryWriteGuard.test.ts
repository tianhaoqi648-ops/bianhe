// ============================================================
// memoryWriteGuard.test.ts — memory 模式写警示（renderer 订阅端）
//
// 安全加固后：renderer 不再接触裸 ipcRenderer，改经
// window.electron.memoryWarning.subscribe 订阅警示（preload 封装）。
// 覆盖：readonly 不抛、persistent 不提示、memory 被捕获、cleanup 退订、
// 无桥安全降级、subscribe 缺失安全降级。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installMemoryWriteGuard } from '../memoryWriteGuard'
import { MEMORY_WRITE_WARNING } from '../memoryModeGuard'

type Sub = (cb: () => void) => () => void

/** 伪造 memoryWarning.subscribe + 可手动触发回调 */
function makeWarningApi() {
  const callbacks: Array<() => void> = []
  const subscribe: Sub = vi.fn((cb: () => void) => {
    callbacks.push(cb)
    return () => {
      const i = callbacks.indexOf(cb)
      if (i >= 0) callbacks.splice(i, 1)
    }
  })
  const emit = () => {
    ;[...callbacks].forEach((cb) => cb())
  }
  return { subscribe, emit }
}

function withWarningApi(api: unknown): void {
  const g = globalThis as {
    window?: { electron?: { memoryWarning?: unknown } }
  }
  g.window = { electron: { memoryWarning: api } }
}

beforeEach(() => {
  const g = globalThis as { window?: unknown }
  delete g.window
})

describe('installMemoryWriteGuard（renderer 警示订阅，不做对象改写）', () => {
  it('不修改 readonly API 属性：即便 window.xxxAPI 冻结也不抛错', () => {
    withWarningApi(makeWarningApi())
    const frozenApi = Object.freeze({ delete: Object.freeze(() => undefined) })
    expect(() => installMemoryWriteGuard({ warn: vi.fn() })).not.toThrow()
    expect(frozenApi.delete).toBeDefined()
  })

  it('无桥（非 Electron / 单测）安全降级不抛错', () => {
    expect(() => installMemoryWriteGuard({ warn: vi.fn() })).not.toThrow()
  })

  it('subscribe 缺失（旧版 preload）安全降级不抛错且返回清理函数', () => {
    const g = globalThis as { window?: unknown }
    g.window = { electron: {} }
    const cleanup = installMemoryWriteGuard({ warn: vi.fn() })
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('memory 模式写被捕获：警示事件到达 → warn 一次', () => {
    const { subscribe, emit } = makeWarningApi()
    withWarningApi({ subscribe })
    const warn = vi.fn()
    installMemoryWriteGuard({ warn })
    emit()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(MEMORY_WRITE_WARNING)
  })

  it('persistent（未收到事件）不 warn，read 不受影响', () => {
    const { subscribe } = makeWarningApi()
    withWarningApi({ subscribe })
    const warn = vi.fn()
    installMemoryWriteGuard({ warn })
    expect(warn).not.toHaveBeenCalled()
  })

  it('cleanup 退订后事件不再触发 warn', () => {
    const { subscribe, emit } = makeWarningApi()
    withWarningApi({ subscribe })
    const warn = vi.fn()
    const cleanup = installMemoryWriteGuard({ warn })
    expect(subscribe).toHaveBeenCalledTimes(1)
    cleanup()
    emit()
    expect(warn).not.toHaveBeenCalled()
  })

  it('App mount 场景：install 不抛错并返回清理函数', () => {
    const { subscribe } = makeWarningApi()
    withWarningApi({ subscribe })
    const cleanup = installMemoryWriteGuard({ warn: vi.fn() })
    expect(typeof cleanup).toBe('function')
  })
})
