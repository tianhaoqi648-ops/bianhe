// ============================================================
// judge-match.tool.ts — Agent 工具：AI 裁判整场评审（赛事实景深化 T3.1，2026-08-19）
//
// 与 judge_debate 的区别：judge_debate 要求把正反方辩词拆分粘贴；
// 本工具 judge_match 以「整场时间线」为输入（环节/发言人/时间点 + 该段文本，
// 来自录音环节/发言人标记 + 逐段文本），绝不按正反方聚合。无时间线时退化为
// transcript 全文。
//
// 流程（复用 judge_debate 模式）：
//   1. 校验必填参数（topic 必填；timeline 须每项 content 非空）
//   2. 按 judgeId 取评委人设（未知 id 回落默认胡渐彪）
//   3. buildJudgeSystemPrompt + buildMatchUserPrompt 构造 system/user
//   4. 调 llm-client.chat（非流式，透传 ctx.config / ctx.signal）
//   5. parseJsonResult 解析 + 结构校验 + 兜底（bestSpeaker）与过滤（stageVerdicts）
//
// 纯函数抽离（便于测试）：
//   - validateTimeline        ：时间线结构校验（content 空拒绝）
//   - normalizeBestSpeaker    ：bestSpeaker 缺省给 null
//   - filterStageVerdicts     ：stageVerdicts 过滤非法项
//   - 时间线格式化见 judge-common.formatMatchTimeline / buildMatchUserPrompt
// ============================================================

import type { ToolDefinition, LLMConfig } from '@shared/agent-types'
import { FIVE_DIMENSIONS, getJudgeAnonLabel, getJudgeById, type DimensionKey } from '@shared/ai-judges'
import { getStageDefinition, type DebateStageType } from '@shared/debate-stages'
import { chat, LLMError } from '../llm-client'
import { judgeHistoryRepo } from '../../db/repository/judge-history.repo'
import {
  buildMatchUserPrompt,
  buildJudgeSystemPrompt,
  parseJsonResult,
  type MatchTimelineSegment
} from './judge-common'

/** judge_match 工具入参（与 parameters schema 对齐） */
export interface JudgeMatchArgs {
  /** 辩题（必填） */
  topic: string
  /** 赛制提示（可选，如"新国辩制"） */
  formatHint?: string
  /** 整场时间线（可选；提供时优先于 transcript） */
  timeline?: MatchTimelineSegment[]
  /** 整场转录全文（可选，无 timeline 时的退化输入） */
  transcript?: string
  /** 评委人设 id（可选，内置 5 位，默认 hu-jianbiao） */
  judgeId?: string
}

/** 单个维度的双方评分 */
export interface JudgeMatchDimensionScore {
  /** 维度 key（对应 FIVE_DIMENSIONS） */
  key: DimensionKey
  /** 维度展示名 */
  name: string
  /** 正方得分 0-10 */
  affScore: number
  /** 反方得分 0-10 */
  negScore: number
  /** 该维度评语（一句话） */
  comment: string
}

/** judge_match 工具返回值（成功态） */
export interface JudgeMatchResult {
  success: true
  /** 评委 id 与姓名（实际使用的人设，含回落） */
  judgeId: string
  judgeName: string
  /** 辩题 */
  topic: string
  /** 胜负判定；素材不足以判定时为 null（并附带 insufficientReason） */
  verdict: {
    /** 胜方：aff（正方）/ neg（反方） */
    winner: 'aff' | 'neg'
    /** 置信度 0-1 */
    confidence: number
    /** 判定理由（一句话） */
    reason: string
  } | null
  /** 素材不足时的如实说明（verdict 为 null 时必填；说明缺什么素材、建议补充什么） */
  insufficientReason?: string
  /** 五维双方评分 */
  dimensions: JudgeMatchDimensionScore[]
  /** 按环节逐段判定（可选） */
  stageVerdicts?: Array<{
    stage: DebateStageType
    winner: 'aff' | 'neg'
    confidence: number
    comment: string
  }>
  /** 全场最佳辩手（发言人或辩位）；缺省给 null */
  bestSpeaker: string | null
  /** 总评（模仿该评委的点评风格） */
  summary: string
}

/** judge_match 工具返回值（失败态） */
export interface JudgeMatchFailure {
  success: false
  error: string
}

/** 默认评委：胡渐彪（攻防流） */
const DEFAULT_JUDGE_ID = 'hu-jianbiao'

/** 素材不足以judge_match判定时的标记码（不足态：success:true + verdict:null） */
export const JUDGE_MATCH_INSUFFICIENT_CODE = 'insufficient_material'

/**
 * 校验整场时间线结构：须为数组，且每项 content 非空。
 * timeline 未提供/空数组视为通过（会走 transcript 退化）。
 * 纯函数，供测试。
 */
export function validateTimeline(
  timeline: MatchTimelineSegment[] | undefined
): { ok: true } | { ok: false; error: string } {
  if (timeline === undefined || timeline.length === 0) return { ok: true }
  if (!Array.isArray(timeline)) return { ok: false, error: 'timeline 结构非法：须为数组' }
  for (let i = 0; i < timeline.length; i++) {
    const seg = timeline[i]
    if (!seg || typeof seg !== 'object') {
      return { ok: false, error: `timeline 第 ${i + 1} 项非法：须为对象` }
    }
    if (typeof seg.content !== 'string' || seg.content.trim() === '') {
      return { ok: false, error: `timeline 第 ${i + 1} 项 content 缺失或为空` }
    }
  }
  return { ok: true }
}

/**
 * bestSpeaker 兜底：非法/空串/缺失统一归 null。
 * 纯函数，供测试。
 */
export function normalizeBestSpeaker(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

/**
 * stageVerdicts 过滤：逐项校验 stage 合法性 / winner / confidence / comment，
 * 非法项跳过；无合法项返回 undefined。
 * 纯函数，供测试。
 */
export function filterStageVerdicts(
  value: unknown
): NonNullable<JudgeMatchResult['stageVerdicts']> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const list: NonNullable<JudgeMatchResult['stageVerdicts']> = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const s = item as {
      stage?: unknown
      winner?: unknown
      confidence?: unknown
      comment?: unknown
    }
    const stage = s.stage
    if (typeof stage !== 'string' || !getStageDefinition(stage as DebateStageType)) continue
    if (s.winner !== 'aff' && s.winner !== 'neg') continue
    const confidence = Number(s.confidence)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue
    const comment =
      typeof s.comment === 'string' && s.comment.trim() !== '' ? s.comment.trim() : ''
    if (comment === '') continue
    list.push({ stage: stage as DebateStageType, winner: s.winner, confidence, comment })
  }
  return list.length > 0 ? list : undefined
}

/**
 * 解析 LLM 返回的 content 为 JudgeMatchResult 主体（结构校验）。
 * JSON 围栏/提取由 judge-common.parseJsonResult 处理；失败抛错。
 *
 * 不足态：当 verdict 为 null（或缺失且存在 insufficientReason）时，跳过五维/verdict
 * 强制校验，返回 `{ verdict: null, insufficientReason, dimensions: [], ... }` 的不足态
 * （可由调用方按 verdict === null 与 JUDGE_MATCH_INSUFFICIENT_CODE 识别），而非抛错。
 */
export function parseJudgeMatchResult(
  raw: string
): Omit<JudgeMatchResult, 'success' | 'judgeId' | 'judgeName' | 'topic'> {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as {
    verdict?: { winner?: unknown; confidence?: unknown; reason?: unknown } | null
    dimensions?: unknown
    summary?: unknown
    stageVerdicts?: unknown
    bestSpeaker?: unknown
    insufficientReason?: unknown
  }

  // 不足态判定：verdict === null，或 verdict 缺失但声明了 insufficientReason。
  const reasoning =
    typeof obj.insufficientReason === 'string' && obj.insufficientReason.trim() !== ''
      ? obj.insufficientReason.trim()
      : ''
  if (obj.verdict === null || (obj.verdict === undefined && reasoning !== '')) {
    const insufficient: Omit<
      JudgeMatchResult,
      'success' | 'judgeId' | 'judgeName' | 'topic'
    > = {
      verdict: null as JudgeMatchResult['verdict'],
      insufficientReason: reasoning || '素材不足，无法进行有效判定',
      dimensions: [],
      stageVerdicts: undefined,
      bestSpeaker: null,
      summary: ''
    }
    return insufficient
  }

  // 校验 verdict
  const winner = obj.verdict?.winner
  if (winner !== 'aff' && winner !== 'neg') {
    throw new Error('verdict.winner 缺失或非法')
  }
  const confidence = Number(obj.verdict?.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('verdict.confidence 缺失或非法')
  }
  const reason =
    typeof obj.verdict?.reason === 'string' && obj.verdict.reason.trim() !== ''
      ? obj.verdict.reason.trim()
      : ''

  // 校验 dimensions：须覆盖 FIVE_DIMENSIONS 全部 key，分数 0-10
  if (!Array.isArray(obj.dimensions)) {
    throw new Error('dimensions 缺失或非数组')
  }
  const dimByKey = new Map<string, { affScore?: unknown; negScore?: unknown; comment?: unknown }>()
  for (const item of obj.dimensions) {
    if (item && typeof item === 'object') {
      const d = item as { key?: unknown; affScore?: unknown; negScore?: unknown; comment?: unknown }
      if (typeof d.key === 'string') {
        dimByKey.set(d.key, d)
      }
    }
  }
  const dimensions: JudgeMatchDimensionScore[] = []
  for (const dim of FIVE_DIMENSIONS) {
    const d = dimByKey.get(dim.key)
    const affScore = d ? Number(d.affScore) : NaN
    const negScore = d ? Number(d.negScore) : NaN
    if (!Number.isFinite(affScore) || affScore < 0 || affScore > 10) {
      throw new Error(`维度 ${dim.key} affScore 缺失或非法`)
    }
    if (!Number.isFinite(negScore) || negScore < 0 || negScore > 10) {
      throw new Error(`维度 ${dim.key} negScore 缺失或非法`)
    }
    const comment =
      d && typeof d.comment === 'string' && d.comment.trim() !== '' ? d.comment.trim() : ''
    dimensions.push({
      key: dim.key,
      name: dim.name,
      affScore,
      negScore,
      comment
    })
  }

  const summary =
    typeof obj.summary === 'string' && obj.summary.trim() !== '' ? obj.summary.trim() : ''

  // 校验 stageVerdicts（可选）：逐项过滤非法项
  const stageVerdicts = filterStageVerdicts(obj.stageVerdicts)

  // bestSpeaker 兜底：缺省给 null
  const bestSpeaker = normalizeBestSpeaker(obj.bestSpeaker)

  return { verdict: { winner, confidence, reason }, dimensions, stageVerdicts, bestSpeaker, summary }
}

/**
 * judge_match 工具定义。
 *
 * 执行流程：
 *   1. 校验必填参数（topic 非空；timeline 每项 content 非空）
 *   2. 按 judgeId 取人设（未知 id 回落默认胡渐彪）
 *   3. buildJudgeSystemPrompt + buildMatchUserPrompt 构造 system+user
 *   4. 调 llm-client.chat（非流式，透传 ctx.config / ctx.signal）
 *   5. parseJsonResult 解析 + 结构校验 + bestSpeaker 兜底 + stageVerdicts 过滤
 */
export const judgeMatchTool: ToolDefinition<JudgeMatchArgs, JudgeMatchResult | JudgeMatchFailure> =
  {
    name: 'judge_match',
    description:
      '按评委人设整场评审一场辩论：输入辩题与整场时间线（环节/发言人/时间点+各段文本，或整场转录全文），由内置知名评委给出胜负判定、五维双方评分、最佳辩手与点评。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '辩题（必填）'
        },
        formatHint: {
          type: 'string',
          description: '赛制提示（可选，如"新国辩制"）'
        },
        timeline: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              stage: {
                type: 'string',
                description: '环节类型（可选，六类之一）'
              },
              stageName: {
                type: 'string',
                description: '环节名（可选，优先于 stage 展示）'
              },
              side: {
                type: 'string',
                description: '阵营（可选，如"正方"/"反方"）'
              },
              speaker: {
                type: 'string',
                description: '发言人（可选，可为人名或辩位编号）'
              },
              tsMs: {
                type: 'number',
                description: '时间点（毫秒，可选）'
              },
              content: {
                type: 'string',
                description: '该段文本（必填非空）'
              }
            },
            required: ['content']
          },
          description: '整场时间线（可选，环节/发言人/时间点+该段文本；提供时优先于 transcript）'
        },
        transcript: {
          type: 'string',
          description: '整场转录全文（可选，无 timeline 时的退化输入）'
        },
        judgeId: {
          type: 'string',
          description: '评委人设 id（可选，默认 hu-jianbiao 胡渐彪）'
        }
      },
      required: ['topic']
    },
    riskLevel: 'low',
    tier: 'dangerous',
    async execute(
      args: JudgeMatchArgs,
      ctx?: { config?: LLMConfig; signal?: AbortSignal }
    ): Promise<JudgeMatchResult | JudgeMatchFailure> {
      // 1. 校验必填参数
      const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
      if (topic === '') {
        return { success: false, error: '参数缺失：topic 必填' }
      }

      // 1.1 校验时间线结构（content 非空）
      const timelineCheck = validateTimeline(args.timeline)
      if (!timelineCheck.ok) {
        return { success: false, error: timelineCheck.error }
      }

      // 无 timeline 时必须提供 transcript 退化
      const hasBody =
        (Array.isArray(args.timeline) && args.timeline.length > 0) ||
        (typeof args.transcript === 'string' && args.transcript.trim() !== '')
      if (!hasBody) {
        return { success: false, error: '参数缺失：timeline 与 transcript 至少提供其一' }
      }

      // 2. 取评委人设（未知 id 回落默认）
      const judge = getJudgeById(args.judgeId) ?? getJudgeById(DEFAULT_JUDGE_ID)
      if (!judge) {
        return { success: false, error: '评委人设数据缺失' }
      }

      // 3. 构造评审 prompt（整场：system 人设 + user 时间线/转录）
      const systemPrompt = buildJudgeSystemPrompt(
        judge,
        [
          '现在请你作为这位评委，对下面的一整场辩论进行整场评判。',
          '请客观评分，但让分数与评语自然体现你的审美侧重。'
        ].join('\n')
      )
      const userPrompt = buildMatchUserPrompt({
        topic,
        timeline: args.timeline,
        transcript: args.transcript,
        formatHint: args.formatHint
      })

      // 4. 调 LLM（非流式；无 config 时失败）
      const config = ctx?.config
      if (!config) {
        return { success: false, error: '缺少 LLM 配置（请先在设置中配置 AI 助手）' }
      }
      let content: string | null
      try {
        const assistantMessage = await chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          config,
          undefined,
          ctx?.signal
        )
        content = assistantMessage.content
      } catch (err) {
        const msg =
          err instanceof LLMError
            ? `LLM 调用失败（${err.code}）：${err.message}`
            : err instanceof Error
              ? err.message
              : String(err)
        return { success: false, error: msg }
      }
      if (!content || content.trim() === '') {
        return { success: false, error: '评委返回内容为空' }
      }

      // 5. 解析评分结果
      try {
        const parsed = parseJudgeMatchResult(content)
        const result: JudgeMatchResult = {
          success: true,
          judgeId: judge.id,
          judgeName: getJudgeAnonLabel(judge.id),
          topic,
          ...parsed
        }
        // 成功即写评审历史（失败静默忽略，不打断工具返回）
        try {
          judgeHistoryRepo.create({
            judgeId: judge.id,
            toolName: 'judge_match',
            topic,
            resultJson: result as unknown as Record<string, unknown>
          })
        } catch {
          // 忽略历史写入失败
        }
        return result
      } catch (e) {
        return {
          success: false,
          error: `评委输出格式异常：${e instanceof Error ? e.message : String(e)}`
        }
      }
    }
  }