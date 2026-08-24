// ============================================================
// useTimerEngine.interactions.test.ts — 计时引擎 hook 级交互测试
//
// 戴钩于 React hook（jsdom 环境）：
//   - start / pause / resume
//   - nextStage / prevStage
//   - reset（全场重置）/ finishStage / switchSide（自由辩论切方）
//   - 状态持久化（onStateChange callback 触发）
//   - rAF 驱动倒计时递减
//
// 与同目录 timer-bells.test.ts（纯函数）互补：后者覆盖 checkBells/formatTime
// 的铃声触发语义，本文件挂载真实 hook 断言交互后的 state 与回调时机。
//
// 说明：
//   - 使用 per-file `// @vitest-environment jsdom`（vitest 全局为 node）。
//   - 计时器依赖 rAF 循环与 performance.now，此处拦截 requestAnimationFrame
//     捕捉回调、用可控 clock 手动推进，避免用例挂起。
//   - window.timerAPI（preload 注入）在运行时被引用，于用例中 stubbed。
//   - 重要：format / callbacks 必须在 renderHook 回调之外创建（稳定引用）。
//     useTimerEngine 有 `useEffect(…, [format])`，format 引用每次变了会触发
//     setState→重渲染→新引用 的无限循环（生产环境 format 来自稳定 store）。
// ============================================================

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimerEngine } from '../useTimerEngine'
import type { TimerEngineCallbacks } from '../useTimerEngine'
import type { DebateFormatData } from '../../../../shared/types'

/** 三段式赛制：普通倒计时 + 自由辩论 + 普通倒计时 */
function makeFormat(): DebateFormatData {
  return {
    stages: [
      { id: 'st0', name: '立论', side: 'aff', durationMs: 120000, bells: [{ atMs: 60000, sound: 'beep' }] },
      { id: 'st1', name: '自由辩论', side: 'both', durationMs: 180000, isFreeDebate: true, bells: [] },
      { id: 'st2', name: '结辩', side: 'neg', durationMs: 90000, bells: [] }
    ],
    totalDurationMs: 390000
  }
}

/** 与 TimerEngineCallbacks 同键、但字段为 vi.fn 的类型（可访问 .mock 断言） */
type TimerCallbacksSpy = {
  onBell: ReturnType<typeof vi.fn>
  onStageEnd: ReturnType<typeof vi.fn>
  onFinish: ReturnType<typeof vi.fn>
  onStateChange: ReturnType<typeof vi.fn>
  onStageStart: ReturnType<typeof vi.fn>
}

/** 构造空回调集合，供各用例断言触发时机 */
function makeCallbacks(): TimerCallbacksSpy {
  return {
    onBell: vi.fn(),
    onStageEnd: vi.fn(),
    onFinish: vi.fn(),
    onStateChange: vi.fn(),
    onStageStart: vi.fn()
  }
}

/** 在 renderHook 回调外创建一套稳定引用（避免 [format] 重置 effect 触发无限循环） */
function mount(opts?: { format?: DebateFormatData; callbacks?: TimerCallbacksSpy }) {
  const format = opts?.format ?? makeFormat()
  const callbacks = opts?.callbacks ?? makeCallbacks()
  const rendered = renderHook(() => useTimerEngine({ format, callbacks: callbacks as unknown as TimerEngineCallbacks }))
  return { ...rendered, callbacks }
}

// ---- 可控的 rAF / 时钟（手动推进倒计时） ----
let rafCbs: Array<(now: number) => void> = []
let clock = 0

/** 推进 clock 并执行本帧待跑的 rAF 回调（模拟一次浏览器帧） */
function tickFrame(ms: number) {
  clock += ms
  const cbs = rafCbs.splice(0)
  for (const cb of cbs) cb(clock)
}

beforeEach(() => {
  rafCbs = []
  clock = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(((cb: FrameRequestCallback) => {
    rafCbs.push(cb)
    return rafCbs.length
  }) as unknown as typeof window.requestAnimationFrame)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  // preload 注入的 timerAPI：仅 hook 运行时引用的 addRecord / finishRecord
  ;(window as unknown as Record<string, unknown>).timerAPI = {
    addRecord: vi.fn().mockResolvedValue({ success: true, data: {} }),
    finishRecord: vi.fn().mockResolvedValue({ success: true })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTimerEngine 交互', () => {
  it('初始状态：idle、第 0 环节、空 sessionId，且不触发持久化', () => {
    const { result, callbacks } = mount()
    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.currentStageIndex).toBe(0)
    expect(result.current.state.sessionId).toBe('')
    expect(result.current.state.currentSide).toBe('aff')
    expect(callbacks.onStateChange).not.toHaveBeenCalled()
  })

  it('start：置 running、写入 sessionId、落在第 0 环节', async () => {
    const { result, callbacks } = mount()
    await act(async () => {
      result.current.start('sess-1')
    })
    expect(result.current.state.status).toBe('running')
    expect(result.current.state.sessionId).toBe('sess-1')
    expect(result.current.state.currentStageIndex).toBe(0)
    expect(result.current.state.currentSide).toBe('aff')
    expect(callbacks.onStageStart).toHaveBeenCalled()
  })

  it('pause / resume：running → paused → running', async () => {
    const { result } = mount()
    await act(async () => {
      result.current.start('s')
    })
    await act(async () => {
      result.current.pause()
    })
    expect(result.current.state.status).toBe('paused')
    await act(async () => {
      result.current.resume()
    })
    expect(result.current.state.status).toBe('running')
  })

  it('nextStage：进入下一环节并置 paused；prevStage：回到上一环节', async () => {
    const { result } = mount()
    await act(async () => {
      result.current.start('s')
    })
    await act(async () => {
      result.current.nextStage()
    })
    expect(result.current.state.currentStageIndex).toBe(1)
    // 自由辩论环节 side=both → resolveInitialSide 兜底 aff
    expect(result.current.state.currentSide).toBe('aff')
    await act(async () => {
      result.current.prevStage()
    })
    expect(result.current.state.currentStageIndex).toBe(0)
    expect(result.current.state.status).toBe('paused')
  })

  it('reset：清空 sessionId、回到第 0 环节 idle', async () => {
    const { result } = mount()
    await act(async () => {
      result.current.start('s')
      result.current.nextStage()
    })
    expect(result.current.state.currentStageIndex).toBe(1)
    await act(async () => {
      result.current.reset()
    })
    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.sessionId).toBe('')
    expect(result.current.state.currentStageIndex).toBe(0)
  })

  it('finishStage 于最后一环节 → finished', async () => {
    const { result, callbacks } = mount()
    await act(async () => {
      result.current.start('s')
    })
    await act(async () => {
      result.current.nextStage() // → st1
    })
    await act(async () => {
      result.current.nextStage() // → st2（最后一环）
    })
    await act(async () => {
      result.current.finishStage()
    })
    expect(result.current.state.status).toBe('finished')
    expect(callbacks.onFinish).toHaveBeenCalledTimes(1)
  })

  it('switchSide：自由辩论切方 aff → neg，并累计发言次数', async () => {
    const { result } = mount()
    await act(async () => {
      result.current.start('s')
    })
    await act(async () => {
      result.current.nextStage() // 进入自由辩论（paused）
    })
    expect(result.current.state.currentStageIndex).toBe(1)
    expect(result.current.state.currentSide).toBe('aff')
    expect(result.current.state.negSpeechCount).toBe(0)
    await act(async () => {
      result.current.switchSide()
    })
    expect(result.current.state.currentSide).toBe('neg')
    expect(result.current.state.negSpeechCount).toBe(1)
    await act(async () => {
      result.current.switchSide()
    })
    expect(result.current.state.currentSide).toBe('aff')
    expect(result.current.state.affSpeechCount).toBe(1)
  })

  it('状态持久化：state 变更且带 sessionId 时触发 onStateChange', async () => {
    const { result, callbacks } = mount()
    await act(async () => {
      result.current.start('sess-9')
    })
    expect(callbacks.onStateChange).toHaveBeenCalled()
    const seen = callbacks.onStateChange.mock.calls.some(
      ([s]) => s && (s as { sessionId?: string }).sessionId === 'sess-9'
    )
    expect(seen).toBe(true)
  })

  it('rAF 驱动倒计时：推进一帧后 remainingMs 递减 delta', async () => {
    const { result } = mount()
    await act(async () => {
      result.current.start('s')
    })
    const before = result.current.state.remainingMs
    expect(result.current.state.status).toBe('running')
    await act(async () => {
      tickFrame(1000)
    })
    expect(result.current.state.remainingMs).toBe(before - 1000)
  })
})