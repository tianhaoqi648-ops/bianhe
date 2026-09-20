// ============================================================
// useTimerEngine.autopause-actualms.test.ts — P5-015 暂停时长语义回归
// （真实 hook + 可控 rAF/clock，无真实 sleep）
//
// 语义：actualMs = Date.now() - stageStartedAtRef - pauseDurationRef
//       （扣除暂停后的有效计时）。所有「进入 paused 等待恢复」的路径
//       （手动 pause / tick 自动切换 / next-prev-finishStage）都应开启
//       暂停区间，使等待时间被 resume/结账扣除而非计入 actualMs。
//
// 覆盖（act 下同步可达的路径）：
//   1. manual pause → resume 扣除正确（回归）
//   2. 切环节开表（finishStage = E 键「时间到」，与 tick 自动切换同一
//      pauseStartRef 开表语句）→ 等待 50s → resume → actualMs 不含等待
//   3. 切环节后立即 resume：扣除 ≈ 0
//   4. long 等待：全额扣除
//   5. auto/manual 多段交替：每段独立累计互不污染
//   6. pause → nextStage：旧环节结账正确（paused 中切环节漏扣修复）
//
// React 调度说明：concurrent root 的 act 上下文会把 tick 的 setState updater
// 推迟到 flush 之后执行，导致 tick 同步段的副作用循环（pendingStageEnd/Start
// → handleStageEnd/Start）在测试中空跑——生产 rAF 回调走 eager 同步路径无此
// 问题。因此「环节切换」统一经 finishStage/nextStage（同步调用
// handleStageEnd/handleStageStart，与副作用循环等价）驱动验证；rAF 仅用于
// 驱动 running 期间的倒计时递减。
//
// Date.now 与 performance.now 统一挂到同一可控 clock；finishRecord spy 捕获
// 的 actualMs 即 timer_records.actual_ms 持久化入参，真库写入链由 main 层
// timer-persistence.test.ts 覆盖。
// ============================================================

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimerEngine } from '../useTimerEngine'
import type { TimerEngineCallbacks } from '../useTimerEngine'
import type { DebateFormatData } from '../../../../shared/types'

/** 三段普通倒计时赛制 */
function makeFormat(): DebateFormatData {
  return {
    stages: [
      { id: 'st0', name: '立论', side: 'aff', durationMs: 120000, bells: [] },
      { id: 'st1', name: '质询', side: 'neg', durationMs: 90000, bells: [] },
      { id: 'st2', name: '结辩', side: 'aff', durationMs: 60000, bells: [] }
    ],
    totalDurationMs: 270000
  }
}

type TimerCallbacksSpy = {
  onBell: ReturnType<typeof vi.fn>
  onStageEnd: ReturnType<typeof vi.fn>
  onFinish: ReturnType<typeof vi.fn>
  onStateChange: ReturnType<typeof vi.fn>
  onStageStart: ReturnType<typeof vi.fn>
}

function makeCallbacks(): TimerCallbacksSpy {
  return {
    onBell: vi.fn(),
    onStageEnd: vi.fn(),
    onFinish: vi.fn(),
    onStateChange: vi.fn(),
    onStageStart: vi.fn()
  }
}

/** 在 renderHook 回调之外创建稳定引用（避免 [format] effect 无限循环） */
function mount() {
  const format = makeFormat()
  const callbacks = makeCallbacks()
  const rendered = renderHook(() =>
    useTimerEngine({ format, callbacks: callbacks as unknown as TimerEngineCallbacks })
  )
  return {
    ...rendered,
    callbacks,
    timerAPI: (window as unknown as {
      timerAPI: { finishRecord: ReturnType<typeof vi.fn>; addRecord: ReturnType<typeof vi.fn> }
    }).timerAPI
  }
}

// ---- 可控 rAF / 时钟 ----
let rafCbs: Array<(now: number) => void> = []
let clock = 0

function tickFrame(ms: number) {
  clock += ms
  const cbs = rafCbs.splice(0)
  for (const cb of cbs) cb(clock)
}

/** 第 n 次 finishRecord 的 actualMs 参数（持久化入参） */
function actualMsAt(timerAPI: { finishRecord: ReturnType<typeof vi.fn> }, n: number): number {
  const call = timerAPI.finishRecord.mock.calls[n]
  expect(call, `finishRecord 第 ${n + 1} 次调用应存在`).toBeTruthy()
  return call![2] as number
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
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  ;(window as unknown as Record<string, unknown>).timerAPI = {
    addRecord: vi.fn().mockResolvedValue({ success: true, data: {} }),
    finishRecord: vi.fn().mockResolvedValue({ success: true })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('P5-015 暂停时长语义一致性（actualMs）', () => {
  it('manual pause → resume：等待正确扣除（回归）', async () => {
    const { result, timerAPI } = mount()
    await act(async () => {
      result.current.start('sess-1')
    })
    await act(async () => {
      tickFrame(10000) // running 10s
    })
    await act(async () => {
      result.current.pause()
    })
    clock += 30000 // paused 30s
    await act(async () => {
      result.current.resume()
    })
    await act(async () => {
      tickFrame(5000) // running 5s
    })
    await act(async () => {
      result.current.finishStage()
    })
    // 有效计时 = 10000 + 5000 = 15000（不含 paused 30000）
    expect(actualMsAt(timerAPI, 0)).toBe(15000)
  })

  it('切环节开表（时间到）→ 等待 50s → resume：actualMs 不含等待', async () => {
    const { result, timerAPI } = mount()
    await act(async () => {
      result.current.start('sess-1')
    })
    await act(async () => {
      tickFrame(10000) // stage0 running 10s
    })
    await act(async () => {
      result.current.finishStage() // 时间到 → stage1 paused（开表）
    })
    expect(result.current.state.status).toBe('paused')
    expect(result.current.state.currentStageIndex).toBe(1)

    clock += 50000 // 用户未恢复，等待 50s
    await act(async () => {
      result.current.resume()
    })
    await act(async () => {
      tickFrame(10000) // stage1 running 10s
    })
    await act(async () => {
      result.current.finishStage() // → stage2
    })
    // stage1 有效计时 = 10000（等待 50000 已被扣除，修复前为 60000）
    expect(actualMsAt(timerAPI, 1)).toBe(10000)
    // stage0 有效计时 = 10000（切换时刻写入，不含之后的一切等待）
    expect(actualMsAt(timerAPI, 0)).toBe(10000)
  })

  it('切环节后立即 resume：扣除 ≈ 0，无异常值', async () => {
    const { result, timerAPI } = mount()
    await act(async () => {
      result.current.start('sess-1')
    })
    await act(async () => {
      tickFrame(10000)
    })
    await act(async () => {
      result.current.finishStage() // → stage1 paused（开表）
    })
    await act(async () => {
      result.current.resume() // clock 未推进，暂停区间 ≈ 0
    })
    await act(async () => {
      result.current.finishStage() // → stage2
    })
    const ms = actualMsAt(timerAPI, 1)
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(ms).toBeLessThanOrEqual(1) // 精确可控时钟下应为 0
  })

  it('long 等待：全额扣除', async () => {
    const { result, timerAPI } = mount()
    await act(async () => {
      result.current.start('sess-1')
    })
    await act(async () => {
      tickFrame(10000)
    })
    await act(async () => {
      result.current.finishStage() // → stage1 paused（开表）
    })
    clock += 300000 // 等待 5 分钟
    await act(async () => {
      result.current.resume()
    })
    await act(async () => {
      tickFrame(5000)
    })
    await act(async () => {
      result.current.finishStage()
    })
    expect(actualMsAt(timerAPI, 1)).toBe(5000)
  })

  it('auto/manual 多段交替：每段独立累计互不污染', async () => {
    const { result, timerAPI } = mount()
    await act(async () => {
      result.current.start('sess-1')
    })
    await act(async () => {
      tickFrame(10000)
    })
    await act(async () => {
      result.current.finishStage() // → stage1 paused（开表）
    })
    clock += 30000 // 段1：等待 30s
    await act(async () => {
      result.current.resume() // 结账段1
    })
    await act(async () => {
      tickFrame(10000)
    })
    await act(async () => {
      result.current.pause() // 手动 pause 开表
    })
    clock += 20000 // 段2：等待 20s
    await act(async () => {
      result.current.resume() // 结账段2
    })
    await act(async () => {
      result.current.finishStage()
    })
    // stage1 有效计时 = 10000；30s + 20s 两段独立扣除
    expect(actualMsAt(timerAPI, 1)).toBe(10000)
  })

  it('pause → nextStage：paused 中切环节时旧环节正确结账', async () => {
    const { result, timerAPI } = mount()
    await act(async () => {
      result.current.start('sess-1')
    })
    await act(async () => {
      tickFrame(10000) // running 10s
    })
    await act(async () => {
      result.current.pause() // 手动 pause 开表
    })
    clock += 20000 // paused 20s（未 resume 直接切环节）
    await act(async () => {
      result.current.nextStage()
    })
    // stage0 有效计时 = 10000（pause 起至切换时刻的 20000 被结账扣除）
    expect(actualMsAt(timerAPI, 0)).toBe(10000)
  })
})
