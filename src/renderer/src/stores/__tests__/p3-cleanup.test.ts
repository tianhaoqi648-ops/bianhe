// ============================================================
// p3-cleanup.test.ts — P3 Cleanup：renderer store 回归
// （jsdom + zustand store 直调）
//
// 覆盖：
//   P5-020：formatStore.fetchAll 保留「内容未变化」项的对象引用
//           （IPC 全量替换不再使 formatData 引用全部翻新，
//            useTimerEngine 的 [format] 重置 effect 不被误触发）
//   P5-016：timerStore.finishSession 接线链路（IPC 参数与 store 状态更新）
// ============================================================

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useFormatStore } from '../formatStore'
import { useTimerStore } from '../timerStore'
import type { DebateFormat } from '../../../../shared/types'

function makeFormat(id: string, name: string): DebateFormat {
  return {
    id,
    name,
    description: '',
    isPreset: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    formatData: {
      stages: [
        { id: `${id}-st0`, name: '立论', side: 'aff', durationMs: 60000, bells: [] }
      ],
      totalDurationMs: 60000
    }
  }
}

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).formatAPI = {
    list: vi.fn()
  }
  ;(window as unknown as Record<string, unknown>).timerAPI = {
    finishSession: vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'sess-1', status: 'finished', endedAt: '2026-01-01T10:00:00Z' }
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('P5-020 formatStore.fetchAll 引用稳定化', () => {
  it('内容未变化的赛制刷新后保持同一对象引用', async () => {
    const original = makeFormat('f1', '新国辩')
    // 第一次加载：建立基线引用
    ;(window as unknown as { formatAPI: { list: ReturnType<typeof vi.fn> } }).formatAPI.list
      .mockResolvedValue({ success: true, data: [original] })
    await useFormatStore.getState().fetchAll()
    const baseline = useFormatStore.getState().formats[0]
    expect(baseline.id).toBe('f1')

    // 第二次加载：IPC 返回「内容相同但引用全新」的对象（生产中即全量重建场景）
    const refreshed = makeFormat('f1', '新国辩')
    ;(window as unknown as { formatAPI: { list: ReturnType<typeof vi.fn> } }).formatAPI.list
      .mockResolvedValue({ success: true, data: [refreshed] })
    await useFormatStore.getState().fetchAll()

    const after = useFormatStore.getState().formats[0]
    expect(after).toBe(baseline) // 引用保持 → engine [format] effect 不触发
  })

  it('内容变化（改名/改赛制）的赛制使用新引用；新增项正常出现', async () => {
    const original = makeFormat('f1', '新国辩')
    ;(window as unknown as { formatAPI: { list: ReturnType<typeof vi.fn> } }).formatAPI.list
      .mockResolvedValue({ success: true, data: [original] })
    await useFormatStore.getState().fetchAll()
    const baseline = useFormatStore.getState().formats[0]

    const renamed = makeFormat('f1', '新国辩（修订）')
    const added = makeFormat('f2', '自定义')
    ;(window as unknown as { formatAPI: { list: ReturnType<typeof vi.fn> } }).formatAPI.list
      .mockResolvedValue({ success: true, data: [renamed, added] })
    await useFormatStore.getState().fetchAll()

    const formats = useFormatStore.getState().formats
    expect(formats.length).toBe(2)
    expect(formats[0]).not.toBe(baseline) // 内容变化 → 新引用
    expect(formats[0].name).toBe('新国辩（修订）')
    expect(formats[1].id).toBe('f2')
  })
})

describe('P5-016 timerStore.finishSession 接线链路', () => {
  it('调用 finishSession → IPC 以 (id, endedAt) 透传 → store.currentSession 更新', async () => {
    const ts = '2026-01-01T10:00:00Z'
    const returned = await useTimerStore.getState().finishSession('sess-1', ts)
    const timerAPI = (window as unknown as {
      timerAPI: { finishSession: ReturnType<typeof vi.fn> }
    }).timerAPI
    expect(timerAPI.finishSession).toHaveBeenCalledWith('sess-1', ts)
    expect(returned).not.toBeNull()
    expect(useTimerStore.getState().currentSession?.status).toBe('finished')
    expect(
      (useTimerStore.getState().currentSession as unknown as { endedAt: string }).endedAt
    ).toBe('2026-01-01T10:00:00Z')
  })
})
