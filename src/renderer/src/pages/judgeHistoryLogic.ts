// ============================================================
// judgeHistoryLogic.ts — AI 裁判历史纯逻辑（T3）
//
// 纯函数模块（不依赖 jsdom / window），供 JudgeArena 页面与单测复用：
//   1. buildJudgeHistoryInput —— 裁判工具成功结果 → JudgeHistoryCreateInput（自动落库入参）
//   2. judgeMatchWinnerOf      —— 判断整场评审(judge_match)结果是否含可写回判定
//   3. judgeMatchCanWriteBack  —— 历史记录是否可「写回该场 AI 评审」
//   4. mapJudgeMatchToAiReview —— 整场评审结果 → MatchAiReview（写回映射口径，
//                                  与 JudgeArena.handleWriteBack 同源复用）
// 约定：仅成功结果落库；失败结果不入库（错误留在当次页面提示）。
// ============================================================

import type { JudgeHistoryCreateInput, MatchAiReview } from '../../../shared/types'

/** 组装 JudgeHistoryCreateInput 所需上下文（页面绑定信息 + 表单快照的投影） */
export interface JudgeHistoryInputParams {
  /** 裁判工具名（judge_speech/judge_debate/judge_match/simulate_opponent/detect_stage） */
  toolName: string
  /** 工具成功输出 */
  result: unknown
  /** 当前绑定赛事/轮次/场次（可空） */
  eventId?: string | null
  roundId?: string | null
  matchId?: string | null
  /** 当前选中评委 id */
  judgeId: string
  /** 环节快照（单方评审/模拟攻击用） */
  stage?: string | null
  /** 持方快照（面向单方稿的工具用） */
  side?: string | null
  /** 辩题快照 */
  topic?: string | null
}

/**
 * 把工具成功结果组装为 JudgeHistoryCreateInput 入参。
 * 只透传快照字段；resultJson 仅在 result 为对象时写入，非对象/空则置 null。
 */
export function buildJudgeHistoryInput(p: JudgeHistoryInputParams): JudgeHistoryCreateInput {
  const isObjectResult = p.result !== null && typeof p.result === 'object'
  return {
    eventId: p.eventId ?? null,
    roundId: p.roundId ?? null,
    matchId: p.matchId ?? null,
    judgeId: p.judgeId,
    toolName: p.toolName,
    stage: p.stage === undefined || p.stage === '' ? null : p.stage,
    side: p.side === undefined || p.side === '' ? null : p.side,
    topic: p.topic && p.topic.trim() !== '' ? p.topic.trim() : null,
    resultJson: isObjectResult ? (p.result as Record<string, unknown>) : null
  }
}

/**
 * 从 judge_match 整场评审结果中提取可写回判定（winner）。
 * 返回值约定：
 *   - 'aff'/'neg'：有判定，可写回
 *   - null：结果是对象但 verdict 缺失（含素材不足 verdict===null）
 *   - undefined：结果不可用（非对象）
 */
export type JudgeMatchWinner = 'aff' | 'neg' | null | undefined

export function judgeMatchWinnerOf(result: unknown): JudgeMatchWinner {
  if (!result || typeof result !== 'object') return undefined
  const data = result as Record<string, unknown>
  const verdict = data.verdict
  if (!verdict || typeof verdict !== 'object') return null
  const winner = (verdict as Record<string, unknown>).winner
  if (winner === 'aff' || winner === 'neg') return winner
  return null
}

/**
 * 判断一条历史记录是否为 judge_match 且含可写回判定。
 * 「写回该场 AI 评审」按钮依据此结果决定是否可用（外加场次绑定判断）。
 */
export function judgeMatchCanWriteBack(record: {
  toolName: string
  resultJson: Record<string, unknown> | null
}): boolean {
  if (record.toolName !== 'judge_match' || !record.resultJson) return false
  const winner = judgeMatchWinnerOf(record.resultJson)
  return winner === 'aff' || winner === 'neg'
}

/**
 * 把整场评审结果映射为 MatchAiReview（写回「该场 AI 评审」，不覆盖人工赛果）。
 * 与 JudgeArena.handleWriteBack 采用同一映射口径；result 不可用或无判定时返回 null。
 * @param source 写回来源：recording（录音转写时间线）或 transcript（文本/历史）
 */
export function mapJudgeMatchToMatchAiReview(
  result: unknown,
  source: MatchAiReview['source']
): MatchAiReview | null {
  if (judgeMatchWinnerOf(result) === null || judgeMatchWinnerOf(result) === undefined) return null
  const data = result as Record<string, unknown>
  const verdict = data.verdict as { winner?: 'aff' | 'neg'; reason?: string }
  const winner = verdict.winner
  if (winner !== 'aff' && winner !== 'neg') return null
  const summary = typeof data.summary === 'string' ? data.summary : ''
  const reason = typeof verdict.reason === 'string' ? verdict.reason : ''
  return {
    winner,
    explanation: reason || summary || '（AI 评审完成，无判定说明）',
    reviewedAt: new Date().toISOString(),
    judgeName: typeof data.judgeName === 'string' ? data.judgeName : undefined,
    bestSpeaker:
      typeof data.bestSpeaker === 'string' && data.bestSpeaker !== ''
        ? data.bestSpeaker
        : null,
    dimensions: Array.isArray(data.dimensions)
      ? (data.dimensions as MatchAiReview['dimensions'])
      : null,
    stageVerdicts: Array.isArray(data.stageVerdicts)
      ? (data.stageVerdicts as MatchAiReview['stageVerdicts'])
      : null,
    source
  }
}

/** 裁判工具名 → 中文展示（历史列表条目/卡片标题用） */
export const JUDGE_TOOL_LABELS: Record<string, string> = {
  judge_speech: '单方评审',
  judge_debate: '双方评审',
  judge_match: '整场评审',
  simulate_opponent: '模拟对方攻击',
  detect_stage: '环节识别'
}

export function judgeHistoryToolLabel(toolName: string): string {
  return JUDGE_TOOL_LABELS[toolName] ?? toolName
}