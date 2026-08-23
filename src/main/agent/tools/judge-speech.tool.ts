// ============================================================
// judge-speech.tool.ts — Agent 工具：单方稿评估 / 教练复盘（AI 裁判工作台三角色 2026-08-23）
//
// 复盘场景：辩手粘贴单方稿子（或某环节稿），由「教练」人设给出成长向诊断——
// 不判分、不排名，聚焦立论/反驳/表达/攻防四维短板、可练方向与示范改写。
//
// 语义沿革：
//   - 2026-08-18 初版：按评委人设给五维评分 + 漏洞清单 + 改进建议（judge_speech）
//   - 2026-08-23：重构为「教练复盘」语义（buildCoachPrompt），输出改为
//     shortboards（四维短板 + 训练方向）/ practiceDirections（可练方向）/
//     rewriteExample（示范改写）/ summary（成长向总评），不再判分。
//
// 与 judge_debate 的区别：
//   - judge_debate：双方完整辩论 → 整场裁决（裁判角色，三角色中的「裁判」）
//   - judge_speech：单方单环节稿 → 教练诊断（三角色中的「复盘」）
//
// 环节标注：stage 为六类环节类型之一（可省略，也可由 detect_stage 识别）。
// 风险等级 low：只读评估，不修改数据库。
// ============================================================

import type { ToolDefinition, LLMConfig } from '@shared/agent-types'
import { JUDGE_IDS, getJudgeAnonLabel, getJudgeById } from '@shared/ai-judges'
import type { DebateStageType } from '@shared/debate-stages'
import { chat, LLMError } from '../llm-client'
import { judgeHistoryRepo } from '../../db/repository/judge-history.repo'
import {
  buildCoachPrompt,
  buildCoachReviewUserPrompt,
  parseCoachResultJson,
  type CoachShortboard
} from './judge-common'

/** judge_speech 工具入参 */
export interface JudgeSpeechArgs {
  /** 辩题（必填） */
  topic: string
  /** 环节类型（可选，六类之一；可由 detect_stage 识别，辅助背景） */
  stage?: DebateStageType
  /** 己方立场（必填） */
  side: 'aff' | 'neg'
  /** 该环节/整份稿子的全文（必填，手动粘贴） */
  speech: string
  /** 教练人设 id（可选，默认 hu-jianbiao） */
  judgeId?: string
  /** 赛制提示（可选） */
  formatHint?: string
}

/** judge_speech 工具返回值（成功态，教练复盘） */
export interface JudgeCoachResult {
  success: true
  /** 教练人设 id（复用 JudgeProfile） */
  judgeId: string
  /** 教练人设名（复用 JudgeProfile） */
  judgeName: string
  topic: string
  stage: DebateStageType | null
  side: 'aff' | 'neg'
  /** 四维短板 + 训练方向 */
  shortboards: CoachShortboard[]
  /** 可练方向（建议清单） */
  practiceDirections: string[]
  /** 示范改写（对原文的成长向改写样例） */
  rewriteExample: string
  /** 教练总评（成长向） */
  summary: string
}

/** judge_speech 工具返回值（失败态） */
export interface JudgeCoachFailure {
  success: false
  error: string
}

/** 环节类型白名单（供 parameters enum 使用） */
const STAGE_ENUM: DebateStageType[] = [
  'opening',
  'rebuttal',
  'cross_exam',
  'cross_summary',
  'free_debate',
  'closing'
]

/**
 * 解析并校验 LLM 返回的教练复盘 JSON。
 * 委托 judge-common.parseCoachResultJson（judge_speech 与 coach_match 共用）。
 */
function parseCoachResult(
  raw: string
): Omit<JudgeCoachResult, 'success' | 'judgeId' | 'judgeName' | 'topic' | 'stage' | 'side'> {
  return parseCoachResultJson(raw)
}

/**
 * judge_speech 工具定义（教练复盘）。
 *
 * 执行流程：
 *   1. 校验必填参数（topic / side / speech；stage 可选）
 *   2. 取教练人设（未知 id 回落默认）
 *   3. 构造 prompt：system=教练复盘定位（buildCoachPrompt）；user=辩题+立场+环节+稿子+JSON 样例
 *   4. 调 llm-client.chat → 解析四维短板/可练方向/示范改写/总评
 *   5. 任一环节失败 → { success:false, error }
 */
export const judgeSpeechTool: ToolDefinition<JudgeSpeechArgs, JudgeCoachResult | JudgeCoachFailure> =
  {
    name: 'judge_speech',
    description:
      '教练复盘：粘贴单方稿子（或某一环节的稿），由教练人设给出成长向诊断——立论/反驳/表达/攻防四维短板、可练方向与示范改写。不判分、不排名，用于备赛打磨稿子。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '辩题（必填）'
        },
        stage: {
          type: 'string',
          enum: STAGE_ENUM,
          description: '环节类型（可选，辅助背景）：opening 立论 / rebuttal 驳论 / cross_exam 质询 / cross_summary 质询小结 / free_debate 自由辩论 / closing 总结陈词'
        },
        side: {
          type: 'string',
          enum: ['aff', 'neg'],
          description: '己方立场（必填）：aff 正方 / neg 反方'
        },
        speech: {
          type: 'string',
          description: '单方稿子全文（必填，手动粘贴）'
        },
        judgeId: {
          type: 'string',
          enum: JUDGE_IDS,
          description: '教练人设 id（可选，默认 hu-jianbiao 胡渐彪）'
        },
        formatHint: {
          type: 'string',
          description: '赛制提示（可选）'
        }
      },
      required: ['topic', 'side', 'speech']
    },
    riskLevel: 'low',
    async execute(
      args: JudgeSpeechArgs,
      ctx?: { config?: LLMConfig; signal?: AbortSignal }
    ): Promise<JudgeCoachResult | JudgeCoachFailure> {
      // 1. 校验必填参数
      const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
      const speech = typeof args.speech === 'string' ? args.speech.trim() : ''
      const side = args.side === 'neg' ? 'neg' : 'aff'
      const stage: DebateStageType | undefined = STAGE_ENUM.includes(args.stage as DebateStageType)
        ? (args.stage as DebateStageType)
        : undefined
      if (topic === '' || speech === '') {
        return { success: false, error: '参数缺失：topic / speech 必填' }
      }
      if (args.stage !== undefined && !stage) {
        return { success: false, error: '参数非法：stage 必须是六类环节之一' }
      }

      // 2. 取教练人设
      const coach = getJudgeById(args.judgeId) ?? getJudgeById('hu-jianbiao')
      if (!coach) {
        return { success: false, error: '教练人设数据缺失' }
      }

      // 3. 构造 prompt（教练复盘定位，非判分；user 复用 judge-common 的教练复盘 user prompt）
      const systemPrompt = buildCoachPrompt({
        profile: coach,
        debateTopic: topic
      })
      const userPrompt = buildCoachReviewUserPrompt({
        topic,
        side,
        stage,
        speech,
        formatHint: args.formatHint
      })

      // 4. 调 LLM
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
        return { success: false, error: '教练返回内容为空' }
      }

      // 5. 解析教练复盘结果
      try {
        const parsed = parseCoachResult(content)
        const result: JudgeCoachResult = {
          success: true,
          judgeId: coach.id,
          judgeName: getJudgeAnonLabel(coach.id),
          topic,
          stage: stage ?? null,
          side,
          ...parsed
        }
        // 成功即写评审历史（失败静默忽略，不打断工具返回）
        try {
          judgeHistoryRepo.create({
            judgeId: coach.id,
            toolName: 'judge_speech',
            stage: stage ?? undefined,
            side,
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
          error: `教练复盘输出格式异常：${e instanceof Error ? e.message : String(e)}`
        }
      }
    }
  }