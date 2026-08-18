// ============================================================
// rewrite-speech.tool.ts — Agent 工具：稿子改写（AI 裁判演进 批2 2026-08-18）
//
// 备赛场景：基于单方稿评估（judge_speech）的漏洞与建议，按评委辩风
// 直接改写己方某一环节的稿子，保留原稿论证骨架，输出改写后全文与改动清单。
//
// 人设复用：以 {judge.name} 的辩风改写（黄执中重价值、胡渐彪重攻防逻辑，
// 由人设自动注入，不重复描述）；focus 参数可指定改写侧重。
//
// 换行约定：rewrittenSpeech 为字符串，prompt 与 JSON_SAMPLE 明确要求
// 换行用 \n 转义，前端 pre-wrap 直接渲染、可复制全文。
//
// 风险等级 low：只读改写，不修改数据库。
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { LLMConfig } from '@shared/agent-types'
import { JUDGE_IDS, getJudgeById } from '@shared/ai-judges'
import { getStageDefinition, type DebateStageType } from '@shared/debate-stages'
import { chat, LLMError } from '../llm-client'
import { buildJudgeSystemPrompt, parseJsonResult } from './judge-common'

/** 环节类型白名单 */
const STAGE_ENUM: DebateStageType[] = [
  'opening',
  'rebuttal',
  'cross_exam',
  'cross_summary',
  'free_debate',
  'closing'
]

/** rewrite_speech 工具入参 */
export interface RewriteSpeechArgs {
  /** 辩题（必填） */
  topic: string
  /** 环节类型（必填，六类之一） */
  stage: DebateStageType
  /** 己方立场（必填） */
  side: 'aff' | 'neg'
  /** 原稿全文（必填） */
  speech: string
  /** 改写侧重（可选，如"让立论更严密"/"增强价值升华"） */
  focus?: string
  /** 评委人设 id（可选，默认 hu-jianbiao）——以其辩风改写 */
  judgeId?: string
  /** 赛制提示（可选） */
  formatHint?: string
}

/** 改动条目 */
export interface RewriteChangeNote {
  /** 改动针对的稿子部分（如"第二段""判准"） */
  target: string
  /** 改了什么、为什么 */
  change: string
}

/** rewrite_speech 工具返回值（成功态） */
export interface RewriteSpeechResult {
  success: true
  judgeId: string
  judgeName: string
  topic: string
  stage: DebateStageType
  side: 'aff' | 'neg'
  /** 改写后全文（换行以 \n 转义） */
  rewrittenSpeech: string
  /** 改动清单 */
  changeNotes: RewriteChangeNote[]
}

/** rewrite_speech 工具返回值（失败态） */
export interface RewriteSpeechFailure {
  success: false
  error: string
}

/** 期望 LLM 输出的 JSON 结构样例（换行用 \n 转义） */
const JSON_SAMPLE = `{
  "rewrittenSpeech": "各位评委好，我方今天的立场是……\\n我方判准是……理由有三……\\n综上所述……",
  "changeNotes": [
    { "target": "第一段判准", "change": "补充了判准成立的论证，避免被对方攻击" },
    { "target": "第二论点", "change": "增加数据支撑，语言更精炼" }
  ]
}`

/**
 * 解析并校验改写结果。
 * rewrittenSpeech 非空校验；changeNotes 非法条目跳过。失败抛错。
 */
function parseRewriteResult(
  raw: string
): Omit<RewriteSpeechResult, 'success' | 'judgeId' | 'judgeName' | 'topic' | 'stage' | 'side'> {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as { rewrittenSpeech?: unknown; changeNotes?: unknown }

  if (typeof obj.rewrittenSpeech !== 'string' || obj.rewrittenSpeech.trim() === '') {
    throw new Error('rewrittenSpeech 缺失或为空')
  }

  const changeNotes: RewriteChangeNote[] = []
  if (obj.changeNotes !== undefined) {
    if (!Array.isArray(obj.changeNotes)) throw new Error('changeNotes 非数组')
    for (const item of obj.changeNotes) {
      if (!item || typeof item !== 'object') continue
      const n = item as { target?: unknown; change?: unknown }
      if (
        typeof n.target === 'string' &&
        n.target.trim() !== '' &&
        typeof n.change === 'string' &&
        n.change.trim() !== ''
      ) {
        changeNotes.push({ target: n.target.trim(), change: n.change.trim() })
      }
    }
  }

  return { rewrittenSpeech: obj.rewrittenSpeech.trim(), changeNotes }
}

/**
 * rewrite_speech 工具定义。
 *
 * 执行流程（与 judge_speech 同构）：
 *   1. 校验必填参数（topic / stage / side / speech）
 *   2. 取评委人设与环节定义
 *   3. 构造 prompt：system=评委人设 + 环节要点 + 改写指令；user=辩题+立场+环节+focus+原稿+JSON 样例（换行 \n 转义）
 *   4. 调 llm-client.chat → 解析改写稿
 *   5. 任一失败 → { success:false, error }
 */
export const rewriteSpeechTool: ToolDefinition<RewriteSpeechArgs, RewriteSpeechResult | RewriteSpeechFailure> =
  {
    name: 'rewrite_speech',
    description:
      '按评委辩风改写己方某一环节的稿子：保留原稿论证骨架，输出改写后全文与改动清单。适合在单方稿评估后优化稿子。',
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
          description: '环节类型（必填）：opening 立论 / rebuttal 驳论 / cross_exam 质询 / cross_summary 质询小结 / free_debate 自由辩论 / closing 总结陈词'
        },
        side: {
          type: 'string',
          enum: ['aff', 'neg'],
          description: '己方立场（必填）：aff 正方 / neg 反方'
        },
        speech: {
          type: 'string',
          description: '原稿全文（必填，手动粘贴）'
        },
        focus: {
          type: 'string',
          description: '改写侧重（可选，如"让立论更严密"/"增强价值升华"）'
        },
        judgeId: {
          type: 'string',
          enum: JUDGE_IDS,
          description: '评委人设 id（可选，默认 hu-jianbiao 胡渐彪）——以其辩风改写'
        },
        formatHint: {
          type: 'string',
          description: '赛制提示（可选）'
        }
      },
      required: ['topic', 'stage', 'side', 'speech']
    },
    riskLevel: 'low',
    async execute(
      args: RewriteSpeechArgs,
      ctx?: { config?: LLMConfig; signal?: AbortSignal }
    ): Promise<RewriteSpeechResult | RewriteSpeechFailure> {
      // 1. 校验必填参数
      const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
      const speech = typeof args.speech === 'string' ? args.speech.trim() : ''
      const side = args.side === 'neg' ? 'neg' : 'aff'
      const stage = STAGE_ENUM.includes(args.stage) ? args.stage : undefined
      if (topic === '' || speech === '') {
        return { success: false, error: '参数缺失：topic / speech 必填' }
      }
      if (!stage) {
        return { success: false, error: '参数非法：stage 必须为六类环节之一' }
      }

      // 2. 取评委人设与环节定义
      const judge = getJudgeById(args.judgeId) ?? getJudgeById('hu-jianbiao')
      if (!judge) {
        return { success: false, error: '评委人设数据缺失' }
      }
      const stageDef = getStageDefinition(stage)
      const stageKeyPoints = stageDef
        ? stageDef.keyPoints.map((p) => `- ${p}`).join('\n')
        : '- 综合质量'

      // 3. 构造 prompt
      const focusLine =
        typeof args.focus === 'string' && args.focus.trim() !== ''
          ? `\n本次改写侧重：${args.focus.trim()}`
          : ''
      const systemPrompt = buildJudgeSystemPrompt(
        judge,
        [
          `你正在改写${side === 'aff' ? '正方' : '反方'}在「${stageDef?.name ?? stage}」环节的稿子。`,
          `这一环节的评审要点是：\n${stageKeyPoints}`,
          '请保留原稿的论证骨架（核心观点与结构不变），用你的辩风优化语言、逻辑与表达。'
        ].join('\n')
      )

      const formatLine =
        typeof args.formatHint === 'string' && args.formatHint.trim() !== ''
          ? `\n赛制参考：${args.formatHint.trim()}`
          : ''
      const userPrompt = [
        `【辩题】${topic}${formatLine}`,
        `【立场】${side === 'aff' ? '正方' : '反方'}（${side}）`,
        `【环节】${stageDef?.name ?? stage}${focusLine}`,
        '',
        `【原稿】`,
        speech,
        '',
        '【输出要求】',
        '请输出：1) rewrittenSpeech：改写后的全文（保留原稿论证骨架，优化语言与逻辑；段落间用 \\n 转义换行）；',
        '2) changeNotes：改动清单（每条含 target 改的哪部分 + change 改了什么、为什么）。',
        '严格输出 JSON（不要包含 markdown 代码块围栏），结构如下：',
        JSON_SAMPLE
      ].join('\n')

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
        return { success: false, error: '改写结果为空' }
      }

      // 5. 解析
      try {
        const parsed = parseRewriteResult(content)
        return {
          success: true,
          judgeId: judge.id,
          judgeName: judge.name,
          topic,
          stage,
          side,
          ...parsed
        }
      } catch (e) {
        return {
          success: false,
          error: `改写输出格式异常：${e instanceof Error ? e.message : String(e)}`
        }
      }
    }
  }
