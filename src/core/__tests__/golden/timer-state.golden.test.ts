// Cross-End Golden: timer-state（随 sync-core 同步到小程序仓，两端运行同一文件）
// 仅测纯状态机 canTransition/isTerminal；tick/runtime/lifecycle 不在 Core。
import { describe, it, expect } from 'vitest'
import { canTransition, isTerminal } from '../../rules/timer-state'
import fixture from './fixtures/timer-state.json'

describe('Cross-End Golden: timer-state', () => {
  const f = fixture as any
  for (const c of f.cases) {
    it(c.name, () => {
      const out =
        c.fn === 'canTransition' ? canTransition(c.input.from, c.input.to) : isTerminal(c.input)
      expect(out).toBe(c.expected)
    })
  }
})
