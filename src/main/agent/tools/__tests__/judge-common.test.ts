// ============================================================
// judge-common.test.ts — AI 裁判公共模块：实时对辩分环节 prompt（Task 4 2026-08-23）
//
// 覆盖：buildLiveDebatePrompt 各环节语气注入 / 持方对立立场 / 缺省环节推进 nextLivePhase。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  LIVE_PHASE_ORDER,
  buildLiveDebatePrompt,
  buildSparringPrompt,
  groupTimelineByStage,
  nextLivePhase,
  type LiveDebatePhase
} from '../judge-common'
import { JUDGES } from '@shared/ai-judges'

const profile = JUDGES[0]

function build(phase: LiveDebatePhase, opts: { side?: 'aff' | 'neg'; context?: string } = {}): string {
  return buildLiveDebatePrompt({
    profile,
    difficulty: 'intermediate',
    side: opts.side ?? 'aff',
    phase,
    debateTopic: '网络让人更亲近还是更疏远',
    context: opts.context
  })
}

describe('buildLiveDebatePrompt：环节语气分档', () => {
  it('申论环节含立论展开与完整陈述语气', () => {
    const s = build('constructive')
    expect(s).toContain('申论')
    expect(s).toContain('立论展开')
  })
  it('质询环节含连珠质问语气', () => {
    expect(build('crossfire')).toContain('连珠质问')
  })
  it('自由辩论环节含快速攻防语气', () => {
    expect(build('free')).toContain('快速攻防')
  })
  it('总结环节含收束语气', () => {
    expect(build('summary')).toContain('收束')
  })
})

describe('buildLiveDebatePrompt：立场与上下文', () => {
  it('side=aff 时对手扮反方', () => {
    expect(build('free', { side: 'aff' })).toContain('反方陪练对手')
  })
  it('side=neg 时对手扮正方', () => {
    expect(build('free', { side: 'neg' })).toContain('正方陪练对手')
  })
  it('提供 context 时提示紧扣上下文漏洞', () => {
    expect(build('constructive', { context: '这是一段整场转写' })).toContain('整稿/整场上下文')
  })
})

describe('nextLivePhase：环节推进', () => {
  it('按 申论→质询→自由辩论→总结 顺序推进', () => {
    expect(nextLivePhase('constructive')).toBe('crossfire')
    expect(nextLivePhase('crossfire')).toBe('free')
    expect(nextLivePhase('free')).toBe('summary')
  })
  it('已是总结则收敛保持总结', () => {
    expect(nextLivePhase('summary')).toBe('summary')
    expect(nextLivePhase(LIVE_PHASE_ORDER[LIVE_PHASE_ORDER.length - 1])).toBe('summary')
  })
})

describe('buildSparringPrompt：环节范围（scope/Task 3）', () => {
  it('指定 stage → 注入环节名与"只在该环节内应对"约束', () => {
    const s = buildSparringPrompt({
      profile,
      difficulty: 'intermediate',
      side: 'aff',
      debateTopic: '网络让人更亲近还是更疏远',
      stage: 'crossfire'
    })
    expect(s).toContain('质询')
    expect(s).toContain('不要跳到其他环节')
  })
  it('未指定 stage → 不含环节范围约束', () => {
    const s = buildSparringPrompt({
      profile,
      difficulty: 'intermediate',
      side: 'aff',
      debateTopic: '网络让人更亲近还是更疏远'
    })
    expect(s).not.toContain('不要跳到其他环节')
  })
})

describe('buildLiveDebatePrompt：环节范围（scope/Task 3）', () => {
  it('指定 scope 时锁定为该环节语气并注入"不跳到其他环节"', () => {
    const s = buildLiveDebatePrompt({
      profile,
      difficulty: 'intermediate',
      side: 'aff',
      phase: 'constructive', // phase 与 scope 不同，scope 应覆盖
      debateTopic: '网络让人更亲近还是更疏远',
      scope: 'crossfire'
    })
    expect(s).toContain('连珠质问')
    expect(s).toContain('不要跳到其他环节')
    expect(s).toContain('限定在「质询」')
  })
  it('scope=full 或缺省 → 用 phase 语气，无锁定约束', () => {
    const s = buildLiveDebatePrompt({
      profile,
      difficulty: 'intermediate',
      side: 'aff',
      phase: 'constructive',
      debateTopic: '网络让人更亲近还是更疏远',
      scope: 'full'
    })
    expect(s).toContain('立论展开')
    expect(s).not.toContain('不要跳到其他环节')
  })
})

describe('groupTimelineByStage：时间线按环节分组', () => {
  it('按环节聚合段内容并保留顺序，识别环节类型', () => {
    const groups = groupTimelineByStage([
      { stage: 'opening', stageName: '立论', speaker: '一辩', content: '第一论点' },
      { stage: 'cross_exam', stageName: '质询', speaker: '三辩', content: '第一问' },
      { stage: null as never, stageName: '立论', speaker: '二辩', content: '第二论点' }
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].key).toBe('立论')
    expect(groups[0].stage).toBe('opening')
    expect(groups[0].content).toContain('第一论点')
    expect(groups[0].content).toContain('第二论点')
    expect(groups[1].key).toBe('质询')
    expect(groups[1].stage).toBe('cross_exam')
  })
  it('空 content 段跳过；无 stage 标注归入"未标注"', () => {
    const groups = groupTimelineByStage([
      { stageName: '立论', content: '有内容' },
      { stageName: '立论', content: '   ' }
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].content).toContain('有内容')
    const unnamed = groupTimelineByStage([{ content: '只有内容没有环节' }])
    expect(unnamed[0].key).toBe('未标注')
    expect(unnamed[0].content).toContain('只有内容没有环节')
  })
  it('undefined/空数组 → 空数组', () => {
    expect(groupTimelineByStage(undefined)).toEqual([])
    expect(groupTimelineByStage([])).toEqual([])
  })
})