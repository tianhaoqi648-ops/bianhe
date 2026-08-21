// ============================================================
// judgePreBindLogic.test.ts — AI 裁判页路由预绑定纯逻辑（T4）
//
// 覆盖：从 state/query 规整出可用三元组的规则：
//   有效命中、marchId 缺失/不存在回退、roundId 不存在不选轮次、matchId 缺失回退。
// ============================================================

import { describe, it, expect } from 'vitest'
import { resolveJudgePreBind, type JudgePreBindSources } from '../../pages/judgePreBindLogic'

const rounds = [{ id: 'r1' }, { id: 'r2' }] as unknown as JudgePreBindSources['rounds']
const matches = [
  { id: 'm1', eventId: 'evt1' },
  { id: 'm2', eventId: 'evt1' }
] as unknown as JudgePreBindSources['matches']

describe('resolveJudgePreBind', () => {
  it('三元组均有效时完整选中事件-轮次-场次', () => {
    const resolved = resolveJudgePreBind(
      { eventId: 'evt1', roundId: 'r1', matchId: 'm1' },
      { rounds, matches }
    )
    expect(resolved.valid).toBe(true)
    expect(resolved.eventId).toBe('evt1')
    expect(resolved.roundId).toBe('r1')
    expect(resolved.matchId).toBe('m1')
    expect(resolved.boundMatch?.id).toBe('m1')
  })

  it('意图无轮次时仍可绑定事件-场次，roundId 置 undefined', () => {
    const resolved = resolveJudgePreBind(
      { eventId: 'evt1', matchId: 'm2' },
      { rounds, matches }
    )
    expect(resolved.valid).toBe(true)
    expect(resolved.eventId).toBe('evt1')
    expect(resolved.roundId).toBeUndefined()
    expect(resolved.matchId).toBe('m2')
  })

  it('roundId 在已加载轮次中不存在则不选轮次，但仍绑定场次', () => {
    const resolved = resolveJudgePreBind(
      { eventId: 'evt1', roundId: 'r-不存在', matchId: 'm1' },
      { rounds, matches }
    )
    expect(resolved.valid).toBe(true)
    expect(resolved.roundId).toBeUndefined()
    expect(resolved.matchId).toBe('m1')
  })

  it('matchId 在已加载场次中不存在 → 不可绑定（静默回退）', () => {
    const resolved = resolveJudgePreBind(
      { eventId: 'evt1', roundId: 'r1', matchId: 'm-不存在' },
      { rounds, matches }
    )
    expect(resolved.valid).toBe(false)
    expect(resolved.boundMatch).toBeNull()
    expect(resolved.matchId).toBeUndefined()
  })

  it('eventId 缺失 → 不可绑定（静默回退）', () => {
    const resolved = resolveJudgePreBind({ roundId: 'r1', matchId: 'm1' }, { rounds, matches })
    expect(resolved.valid).toBe(false)
  })
})