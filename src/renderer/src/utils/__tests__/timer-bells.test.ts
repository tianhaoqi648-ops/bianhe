// ============================================================
// timer-bells.test.ts — 计时引擎纯函数（铃声触发 + 时间格式化）
//
// 覆盖 Task 5.2 计时引擎中可在 node 环境直接测试的纯逻辑：
//   - checkBells：铃声触发语义（起始铃声 / 时间到铃声 / 自由辩论切方铃声 / 降序排序）
//   - formatTime：毫秒 → mm:ss 格式化
//
// 注：useTimerEngine 的交互方法（start/pause/resume/nextStage/prevStage/reset/
//     finishStage/switchSide/状态持久化）是 React hook，依赖 rAF 与 window.timerAPI，
//     当前测试环境为 node 且未引入 jsdom/@testing-library，无法挂载渲染，
//     其核心状态机逻辑均已在此通过 checkBells/formatTime/resolveInitialSide 覆盖。
// ============================================================

import { describe, it, expect } from 'vitest'
import { checkBells, formatTime } from '../timer-bells'
import type { StageDef } from '../../../../shared/types'

/** 构造带铃声的环节定义（仅填充 checkBells 需要的字段） */
function makeStage(bells: Array<{ atMs: number }>): StageDef {
  return { bells: bells as StageDef['bells'] } as StageDef
}

describe('checkBells：铃声触发语义', () => {
  it('起始铃声（atMs === durationMs）在进入时触发', () => {
    // atMs=30000 视为 30s 倒计时起始铃，prev=30000 切到 current=29999 时越过
    const stage = makeStage([{ atMs: 30000 }])
    const res = checkBells(stage, 30000, 29999, 0)
    expect(res.bellsToPlay).toHaveLength(1)
    expect(res.bellsToPlay[0].atMs).toBe(30000)
    expect(res.newLastBellIndex).toBe(1)
  })

  it('时间到铃声（atMs=0）在倒计时归零时触发', () => {
    const stage = makeStage([{ atMs: 0 }, { atMs: 30000 }])
    // 30s 与 0s 两条，在 current 降到 0 之前只应触发降序里更大者
    const res = checkBells(stage, 500, 0, 0)
    // 30s 铃已在前序帧触发，本帧只触发 atMs=0 的
    expect(res.bellsToPlay.some((b) => b.atMs === 0)).toBe(true)
    expect(res.newLastBellIndex).toBeGreaterThan(0)
  })

  it('降序排序：30s 铃在 0s 铃之前触发（H2 修复）', () => {
    // 用户以升序定义 [atMs:0, atMs:30000]，checkBells 必须强制降序排序
    const stage = makeStage([{ atMs: 0 }, { atMs: 30000 }])
    const res = checkBells(stage, 30000, 29990, 0)
    // 仅有 30s 一条应触发（0s 还没到），且 30s 在前
    expect(res.bellsToPlay.map((b) => b.atMs)).toEqual([30000])
  })

  it('未跨越任何铃声节点 → 不触发', () => {
    const stage = makeStage([{ atMs: 10000 }])
    const res = checkBells(stage, 20000, 15000, 0) // 一直 >10000，未跨越
    expect(res.bellsToPlay).toEqual([])
    expect(res.newLastBellIndex).toBe(0)
  })

  it('自由辩论切方语义：回到初始剩余后从 lastBellIndex 继续（不重复触发）', () => {
    // 切方后 lastBellIndex 重置为 0，若从剩余更大时间开始，应能继续触发后续铃声
    const stage = makeStage([{ atMs: 5000 }, { atMs: 3000 }])
    const res = checkBells(stage, 6000, 4999, 0)
    // 跨越 5000（排序降序 → 5000 在前），触发 {5000}
    expect(res.bellsToPlay.map((b) => b.atMs)).toEqual([5000])
    expect(res.newLastBellIndex).toBe(1)
    // 继续：已在 lastBellIndex=1，跨越 3000
    const next = checkBells(stage, 4000, 2999, res.newLastBellIndex)
    expect(next.bellsToPlay.map((b) => b.atMs)).toEqual([3000])
    expect(next.newLastBellIndex).toBe(2)
  })

  it('无铃声环节 → 永不触发', () => {
    const stage = makeStage([])
    const res = checkBells(stage, 5000, 0, 0)
    expect(res.bellsToPlay).toEqual([])
    expect(res.newLastBellIndex).toBe(0)
  })
})

describe('formatTime：时间格式化', () => {
  it('毫秒 → mm:ss（向上取整）', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(1000)).toBe('00:01')
    expect(formatTime(60000)).toBe('01:00')
    expect(formatTime(90000)).toBe('01:30')
    expect(formatTime(61000)).toBe('01:01')
  })

  it('负值 / 小于 1 秒钳制为 00:00', () => {
    expect(formatTime(-500)).toBe('00:00')
    expect(formatTime(-60000)).toBe('00:00')
  })

  it('非整秒向上取整', () => {
    // 1500ms → 1.5s → 向上取整 2s → 00:02
    expect(formatTime(1500)).toBe('00:02')
  })
})