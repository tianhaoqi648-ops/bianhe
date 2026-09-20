// ============================================================
// useTimerEngine.p3-guard.test.ts — P3 Cleanup：Timer 引擎守卫与防空转
// （concurrent root + act，模式沿用 interactions 测试）
//
// 覆盖：
//   P5-017：format stages 为空（赛制被删）→ rAF 不注册下一帧（无空转），
//           running 状态不崩溃；正常 format 不受影响
//   P5-018：finished / idle → nextStage / prevStage 被拒绝（状态不变）
// ============================================================

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimerEngine } from '../useTimerEngine'
import type { TimerEngineCallbacks } from '../useTimerEngine'
import type { DebateFormatData } from '../../../../shared/types'

function makeCallbacks(): TimerCallbacksSpy {
  return {
    onBell: vi.fn(),
    onStageEnd: vi.fn(),
    onFinish: vi.fn(),
    onStateChange: vi.fn(),
    onStageStart: vi.fn()
  }
}

type TimerCallbacksSpy = {
  onBell: ReturnType<typeof vi.fn>
  onStageEnd: ReturnType<typeof vi.fn>
  onFinish: ReturnType<typeof vi.fn>
  onStateChange: ReturnType<typeof vi.fn>
  onStageStart: ReturnType<typeof vi.fn>
}

function mount(format: DebateFormatData) {
  const callbacks = makeCallbacks()
  const rendered = renderHook(() =>
    useTimerEngine({ format, callbacks: callbacks as unknown as TimerEngineCallbacks })
  )
  return { ...rendered, callbacks }
}

let rafCbs: Array<(now: number) => void> = []
let clock = 0

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
  ;(window as unknown as Record<string, unknown>).timerAPI = {
    addRecord: vi.fn().mockResolvedValue({ success: true, data: {} }),
    finishRecord: vi.fn().mockResolvedValue({ success: true })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('P5-017 空 format 防空转', () => {
  it('空赛制 start → rAF 不注册下一帧（无空转）且不崩溃', async () => {
    const emptyFormat: DebateFormatData = { stages: [], totalDurationMs: 0 }
    const { result } = mount(emptyFormat)
    await act(async () => {
      result.current.start('sess-x')
    })
    expect(result.current.state.status).toBe('running')
    // rAF 启动 effect 对 !stage 直接 stopRaf：不注册任何帧回调
    expect(rafCbs.length).toBe(0)
    // 手动注入一帧也不会续注册（tick 对 !stage 置 skipNextRaf）
    act(() => {
      tickFrame(1000)
    })
    expect(rafCbs.length).toBe(0)
  })
})

describe('P5-018 状态守卫（nextStage / prevStage）', () => {
  const format: DebateFormatData = {
    stages: [
      { id: 'st0', name: '立论', side: 'aff', durationMs: 60000, bells: [] },
      { id: 'st1', name: '质询', side: 'neg', durationMs: 60000, bells: [] }
    ],
    totalDurationMs: 120000
  }

  it('idle → nextStage / prevStage 被拒绝（状态不变）', () => {
    const { result } = mount(format)
    expect(result.current.state.status).toBe('idle')
    act(() => {
      result.current.nextStage()
    })
    expect(result.current.state.currentStageIndex).toBe(0)
    act(() => {
      result.current.prevStage()
    })
    expect(result.current.state.currentStageIndex).toBe(0)
  })

  it('finished → nextStage / prevStage 被拒绝（不复活已结束会话）', async () => {
    const { result } = mount(format)
    await act(async () => {
      result.current.start('sess-1')
    })
    await act(async () => {
      result.current.finish()
    })
    expect(result.current.state.status).toBe('finished')
    act(() => {
      result.current.nextStage()
    })
    expect(result.current.state.status).toBe('finished')
    expect(result.current.state.currentStageIndex).toBe(0)
    act(() => {
      result.current.prevStage()
    })
    expect(result.current.state.status).toBe('finished')
    expect(result.current.state.currentStageIndex).toBe(0)
  })

  it('running → nextStage 正常推进（守卫不误伤合法路径）', async () => {
    const { result } = mount(format)
    await act(async () => {
      result.current.start('sess-1')
    })
    await act(async () => {
      result.current.nextStage()
    })
    expect(result.current.state.currentStageIndex).toBe(1)
  })
})
