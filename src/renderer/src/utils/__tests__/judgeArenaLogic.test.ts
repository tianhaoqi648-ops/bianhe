// ============================================================
// judgeArenaLogic.test.ts — AI 裁判工作台按钮启用矩阵（2026-08-18）
//
// 覆盖：getAvailableActions 的启用规则（apiKey/辩题/环节/稿子组合）与 currentSpeech。
// ============================================================

import { describe, it, expect } from 'vitest'
import { getAvailableActions, currentSpeech, roleOfAction, type JudgeArenaFormState } from '../../pages/judgeArenaLogic'

function makeState(overrides: Partial<JudgeArenaFormState> = {}): JudgeArenaFormState {
  return {
    topic: '',
    stage: undefined,
    side: 'aff',
    affSpeech: '',
    negSpeech: '',
    apiKeyConfigured: true,
    ...overrides
  }
}

describe('currentSpeech', () => {
  it('按 side 返回对应稿子', () => {
    const s = makeState({ side: 'neg', affSpeech: 'A', negSpeech: 'B' })
    expect(currentSpeech(s)).toBe('B')
    expect(currentSpeech({ ...s, side: 'aff' })).toBe('A')
  })
})

describe('getAvailableActions 启用矩阵', () => {
  it('未配置 apiKey → 全部禁用', () => {
    const s = makeState({
      topic: 't',
      stage: 'opening',
      affSpeech: 'A',
      negSpeech: 'B',
      apiKeyConfigured: false
    })
    expect(getAvailableActions(s)).toEqual([])
  })

  it('空表单 → 全部禁用', () => {
    expect(getAvailableActions(makeState())).toEqual([])
  })

  it('仅稿子 → 只有 detect_stage', () => {
    const s = makeState({ affSpeech: 'A' })
    expect(getAvailableActions(s)).toEqual(['detect_stage'])
  })

  it('辩题+稿子 → simulate_opponent + detect_stage', () => {
    const s = makeState({ topic: 't', affSpeech: 'A' })
    const actions = getAvailableActions(s)
    expect(actions).toContain('simulate_opponent')
    expect(actions).toContain('detect_stage')
    expect(actions).not.toContain('judge_speech')
    expect(actions).not.toContain('judge_debate')
  })

  it('辩题+环节+单稿 → 单方操作全可用（除双方评审）', () => {
    const s = makeState({ topic: 't', stage: 'opening', affSpeech: 'A' })
    const actions = getAvailableActions(s)
    expect(actions).toContain('judge_speech')
    expect(actions).toContain('simulate_opponent')
    expect(actions).toContain('detect_stage')
    expect(actions).not.toContain('judge_debate')
  })

  it('辩题+双稿 → judge_debate 可用', () => {
    const s = makeState({ topic: 't', affSpeech: 'A', negSpeech: 'B' })
    const actions = getAvailableActions(s)
    expect(actions).toContain('judge_debate')
    expect(actions).toContain('simulate_opponent')
  })

  it('全部齐备 → 四个操作全可用', () => {
    const s = makeState({ topic: 't', stage: 'rebuttal', affSpeech: 'A', negSpeech: 'B' })
    const actions = getAvailableActions(s)
    expect(actions).toHaveLength(4)
    expect(actions).toEqual(
      expect.arrayContaining(['judge_speech', 'simulate_opponent', 'judge_debate', 'detect_stage'])
    )
  })
})

describe('roleOfAction：action → 三角色映射（2026-08-23）', () => {
  it('judge_debate → judge（裁判）', () => {
    expect(roleOfAction('judge_debate')).toBe('judge')
  })
  it('simulate_opponent → sparring（陪练）', () => {
    expect(roleOfAction('simulate_opponent')).toBe('sparring')
  })
  it('judge_speech → coach（复盘）', () => {
    expect(roleOfAction('judge_speech')).toBe('coach')
  })
  it('detect_stage 为辅助工具，返回 undefined（不在三角色主流程）', () => {
    expect(roleOfAction('detect_stage')).toBeUndefined()
  })
})
