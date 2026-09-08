import { describe, it, expect } from 'vitest'
import { TIMER_STATUSES, canTransition, isTerminal } from '../rules/timer-state'

describe('core timer-state: canTransition', () => {
  it('合法链 idle→running→paused→running→finished', () => {
    expect(canTransition('idle', 'running')).toBe(true)
    expect(canTransition('running', 'paused')).toBe(true)
    expect(canTransition('paused', 'running')).toBe(true)
    expect(canTransition('running', 'finished')).toBe(true)
    expect(canTransition('paused', 'finished')).toBe(true)
  })

  it('非法迁移拒绝', () => {
    expect(canTransition('idle', 'paused')).toBe(false)
    expect(canTransition('idle', 'finished')).toBe(false)
    expect(canTransition('paused', 'paused')).toBe(false)
    expect(canTransition('running', 'idle')).toBe(false)
  })

  it('finished 为终态；from 缺失按 idle', () => {
    expect(canTransition('finished', 'running')).toBe(false)
    expect(canTransition(undefined, 'running')).toBe(true)
    expect(canTransition(null, 'running')).toBe(true)
  })

  it('TIMER_STATUSES 枚举', () => {
    expect(TIMER_STATUSES).toEqual(['idle', 'running', 'paused', 'finished'])
  })
})

describe('core timer-state: isTerminal', () => {
  it('仅 finished 为终态', () => {
    expect(isTerminal('finished')).toBe(true)
    expect(isTerminal('running')).toBe(false)
    expect(isTerminal(null)).toBe(false)
  })
})
