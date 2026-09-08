// ============================================================
// core/rules/timer-state.ts — 计时状态机（Bianhe Core 单真源）
//
// 源：小程序 cloud/functions/common/pure/timer-state.js（Phase 2 已建）
// 只含纯状态迁移规则；tick/runtime/lifecycle/persistence 不在 Core。
// 铁律：零外部 import。
// ============================================================

/** 计时会话状态 */
export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished'

export const TIMER_STATUSES: TimerStatus[] = ['idle', 'running', 'paused', 'finished']

/**
 * 状态迁移合法性：finished 终态；合法链 idle→running→paused→running→finished。
 * from 缺失按 idle 处理。
 */
export function canTransition(from: TimerStatus | null | undefined, to: TimerStatus): boolean {
  const f = from || 'idle'
  if (f === 'finished') return false
  if (to === 'finished') return f === 'running' || f === 'paused'
  if (to === 'running') return f === 'idle' || f === 'paused'
  if (to === 'paused') return f === 'running'
  if (to === 'idle') return false
  return false
}

/** 是否终态 */
export function isTerminal(status: TimerStatus | null | undefined): boolean {
  return status === 'finished'
}
