// ============================================================
// detect-stage.tool.ts — Agent 工具：环节类型识别（AI 裁判功能演进 批1 2026-08-18）
//
// 备赛场景：用户粘贴一段稿子但未指明环节（或想确认），
// 由 LLM 判断它属于六类环节中的哪一类，并给出置信度。
//
// 与 mapStageNameToType（纯函数关键词映射）配合构成三层标注策略：
//   1. 关键词映射（零成本，覆盖赛制预设环节名）
//   2. 本工具：LLM 识别（处理自由文本/未命中场景）
//   3. 前端：置信度 < 阈值时让用户确认
//
// 风险等级 low：只读识别。
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { LLMConfig } from '@shared/agent-types'
import { STAGE_DEFINITIONS, type DebateStageType } from '@shared/debate-stages'
import { chat, LLMError } from '../llm-client'
import { parseJsonResult } from './judge-common'

/** detect_stage 工具入参 */
export interface DetectStageArgs {
  /** 稿子全文（必填） */
  speech: string
  /** 候选环节名（可选：来自赛制 stages 的环节名，帮助 LLM 归类） */
  stagesNames?: string[]
  /** 辩题（可选，辅助语境判断） */
  topic?: string
}

/** detect_stage 工具返回值（成功态） */
export interface DetectStageResult {
  success: true
  /** 识别出的环节类型 */
  stage: DebateStageType
  /** 置信度 0-1（< 0.8 时前端应让用户确认） */
  confidence: number
  /** 识别依据（简短说明） */
  reasons: string
}

/** detect_stage 工具返回值（失败态） */
export interface DetectStageFailure {
  success: false
  error: string
}

/** 环节类型白名单 */
const STAGE_ENUM: DebateStageType[] = STAGE_DEFINITIONS.map((s) => s.type)

/** 环节类型与描述（给 LLM 参考） */
const STAGE_HINT = STAGE_DEFINITIONS.map(
  (s) => `- ${s.type}（${s.name}）：${s.description}`
).join('\n')

const JSON_SAMPLE = `{
  "stage": "opening",
  "confidence": 0.9,
  "reasons": "稿子以定义和判准开场，确立论点框架，符合立论环节特征"
}`

/**
 * 解析并校验识别结果。
 * 失败抛错（由调用方转失败结果）。
 */
function parseDetectResult(raw: string): Omit<DetectStageResult, 'success'> {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as { stage?: unknown; confidence?: unknown; reasons?: unknown }

  const stage = obj.stage
  if (typeof stage !== 'string' || !STAGE_ENUM.includes(stage as DebateStageType)) {
    throw new Error('stage 缺失或非法')
  }
  const confidence = Number(obj.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('confidence 缺失或非法')
  }
  const reasons =
    typeof obj.reasons === 'string' && obj.reasons.trim() !== '' ? obj.reasons.trim() : ''

  return { stage: stage as DebateStageType, confidence, reasons }
}

/**
 * detect_stage 工具定义。
 *
 * 执行流程：
 *   1. 校验 speech 非空
 *   2. 构造 prompt：让 LLM 判断稿子属于六类环节中的哪一类 + 置信度 + 理由
 *   3. 调 llm-client.chat → 解析 { stage, confidence, reasons }
 *   4. 失败 → { success:false, error }
 */
export const detectStageTool: ToolDefinition<DetectStageArgs, DetectStageResult | DetectStageFailure> =
  {
    name: 'detect_stage',
    description:
      '识别一段辩论稿属于哪个环节类型（立论/驳论/质询/质询小结/自由辩论/总结陈词），返回环节类型与置信度。',
    parameters: {
      type: 'object',
      properties: {
        speech: {
          type: 'string',
          description: '稿子全文（必填）'
        },
        stagesNames: {
          type: 'array',
          items: { type: 'string' },
          description: '候选环节名（可选，来自赛制的环节名，帮助归类）'
        },
        topic: {
          type: 'string',
          description: '辩题（可选，辅助语境判断）'
        }
      },
      required: ['speech']
    },
    riskLevel: 'low',
    async execute(
      args: DetectStageArgs,
      ctx?: { config?: LLMConfig; signal?: AbortSignal }
    ): Promise<DetectStageResult | DetectStageFailure> {
      const speech = typeof args.speech === 'string' ? args.speech.trim() : ''
      if (speech === '') {
        return { success: false, error: '参数缺失：speech 必填' }
      }

      const candidateLine =
        Array.isArray(args.stagesNames) && args.stagesNames.length > 0
          ? `\n候选环节名（供参考）：${args.stagesNames.join(' / ')}`
          : ''
      const topicLine =
        typeof args.topic === 'string' && args.topic.trim() !== ''
          ? `\n辩题：${args.topic.trim()}`
          : ''

      const systemPrompt = [
        '你是华语辩论的环节识别助手。根据稿子的内容特征，判断它属于哪一类辩论环节。',
        '环节类型说明：',
        STAGE_HINT
      ].join('\n')

      const userPrompt = [
        `请判断以下稿子属于哪个环节类型：${topicLine}${candidateLine}`,
        '',
        '【稿子】',
        speech,
        '',
        '【输出要求】',
        '给出：1) stage（六类之一：opening/rebuttal/cross_exam/cross_summary/free_debate/closing）；',
        '2) confidence（0-1，你对判断的确信程度，不确定时给保守值）；',
        '3) reasons（一句话说明判断依据）。',
        '严格输出 JSON（不要包含 markdown 代码块围栏），结构如下：',
        JSON_SAMPLE
      ].join('\n')

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
        return { success: false, error: '识别结果为空' }
      }

      try {
        return { success: true, ...parseDetectResult(content) }
      } catch (e) {
        return {
          success: false,
          error: `识别输出格式异常：${e instanceof Error ? e.message : String(e)}`
        }
      }
    }
  }
