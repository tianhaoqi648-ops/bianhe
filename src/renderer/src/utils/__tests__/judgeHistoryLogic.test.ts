// ============================================================
// judgeHistoryLogic.test.ts — AI 裁判历史纯逻辑（T3）
//
// 覆盖：buildJudgeHistoryInput 入参组装、judgeMatchWinnerOf /
// judgeMatchCanWriteBack 判定、mapJudgeMatchToMatchAiReview 写回映射复用。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  buildJudgeHistoryInput,
  judgeMatchWinnerOf,
  judgeMatchCanWriteBack,
  mapJudgeMatchToMatchAiReview,
  judgeHistoryToolLabel
} from '../../pages/judgeHistoryLogic'

describe('buildJudgeHistoryInput', () => {
  it('透传绑定信息 + 评委 + 工具 + 快照，并保留对象结果', () => {
    const result = { verdict: { winner: 'aff' }, summary: 'ok' }
    const input = buildJudgeHistoryInput({
      toolName: 'judge_match',
      result,
      eventId: 'evt1',
      roundId: 'r1',
      matchId: 'm1',
      judgeId: 'hu-jianbiao',
      stage: null,
      side: null,
      topic: '  辩题A  '
    })
    expect(input).toEqual({
      eventId: 'evt1',
      roundId: 'r1',
      matchId: 'm1',
      judgeId: 'hu-jianbiao',
      toolName: 'judge_match',
      stage: null,
      side: null,
      topic: '辩题A',
      resultJson: result
    })
  })

  it('绑定/快照为空时归一为 null，非对象结果归一为 null', () => {
    const input = buildJudgeHistoryInput({
      toolName: 'judge_speech',
      result: 'not-an-object',
      judgeId: 'judge-x',
      eventId: undefined,
      roundId: undefined,
      matchId: undefined,
      stage: undefined,
      side: undefined,
      topic: ''
    })
    expect(input.eventId).toBeNull()
    expect(input.roundId).toBeNull()
    expect(input.matchId).toBeNull()
    expect(input.stage).toBeNull()
    expect(input.side).toBeNull()
    expect(input.topic).toBeNull()
    expect(input.resultJson).toBeNull()
  })
})

describe('judgeMatchWinnerOf / judgeMatchCanWriteBack', () => {
  const withVerdict = { toolName: 'judge_match', resultJson: { verdict: { winner: 'aff' } } }
  const insufficient = { toolName: 'judge_match', resultJson: { verdict: null, insufficientReason: 'x' } }
  const debate = { toolName: 'judge_debate', resultJson: { verdict: { winner: 'neg' } } }
  const nullResult = { toolName: 'judge_match', resultJson: null }

  it('judgeMatchWinnerOf：有判定返回 winner，verdict 空返回 null，非对象返回 undefined', () => {
    expect(judgeMatchWinnerOf(withVerdict.resultJson)).toBe('aff')
    expect(judgeMatchWinnerOf(insufficient.resultJson)).toBeNull()
    expect(judgeMatchWinnerOf(undefined)).toBeUndefined()
    expect(judgeMatchWinnerOf('str')).toBeUndefined()
  })

  it('judgeMatchCanWriteBack：仅 judge_match 且含判定才为 true', () => {
    expect(judgeMatchCanWriteBack(withVerdict)).toBe(true)
    expect(judgeMatchCanWriteBack(insufficient)).toBe(false)
    expect(judgeMatchCanWriteBack(debate)).toBe(false)
    expect(judgeMatchCanWriteBack(nullResult)).toBe(false)
    expect(judgeMatchCanWriteBack({ ...withVerdict, resultJson: null })).toBe(false)
  })
})

describe('mapJudgeMatchToMatchAiReview', () => {
  it('把含判定的整场结果映射为 MatchAiReview（含可选字段与 source 透传）', () => {
    const result = {
      judgeId: 'hu-jianbiao',
      judgeName: '攻防流',
      topic: '辩题',
      verdict: { winner: 'neg', reason: '反驳到位' },
      summary: '总结',
      bestSpeaker: '反方二辩',
      dimensions: [{ key: 'arg', name: '论证', affScore: 7, negScore: 8, comment: '' }],
      stageVerdicts: [{ stage: 'rebuttal', winner: 'neg', confidence: 0.8, comment: '' }]
    }
    const review = mapJudgeMatchToMatchAiReview(result, 'transcript')
    expect(review).not.toBeNull()
    expect(review!.winner).toBe('neg')
    expect(review!.explanation).toBe('反驳到位')
    expect(review!.bestSpeaker).toBe('反方二辩')
    expect(review!.dimensions).toHaveLength(1)
    expect(review!.stageVerdicts).toHaveLength(1)
    expect(review!.source).toBe('transcript')
  })

  it('无判定 / 非对象 / 非 aff|neg → 返回 null', () => {
    expect(mapJudgeMatchToMatchAiReview({ verdict: null }, 'recording')).toBeNull()
    expect(mapJudgeMatchToMatchAiReview(undefined, 'recording')).toBeNull()
    expect(mapJudgeMatchToMatchAiReview({ judge_debate: true, verdict: { winner: 'draw' } }, 'recording')).toBeNull()
  })
})

describe('judgeHistoryToolLabel', () => {
  it('已知工具返回中文，未知回退原名', () => {
    expect(judgeHistoryToolLabel('judge_match')).toBe('整场评审')
    expect(judgeHistoryToolLabel('judge_speech')).toBe('单方评审')
    expect(judgeHistoryToolLabel('unknown_tool')).toBe('unknown_tool')
  })
})