// ============================================================
// judge-speech.tool.ts — Agent 工具：单方稿评估（AI 裁判功能演进 批1 2026-08-18）
//
// 备赛核心场景：辩手只有己方某个环节的稿子（如一辩稿/质询清单/结辩稿），
// 需要 AI 按评委人设 + 该环节的评审要点，对稿子质量评分并给出漏洞与改进建议。
//
// 与 judge_debate 的区别：
//   - judge_debate：双方完整辩论 → 整场裁决
//   - judge_speech：单方单环节稿 → 环节级评估（评分 + 漏洞清单 + 改进建议）
//
// 环节标注：stage 为六类环节类型之一（DebateStageType）；
// 可由 detect_stage 工具自动识别，也可用户直接指定。
// 风险等级 low：只读评估，不修改数据库。
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { LLMConfig } from '@shared/agent-types'
import { FIVE_DIMENSIONS, JUDGE_IDS, getJudgeById, type DimensionKey } from '@shared/ai-judges'
import { getStageDefinition, type DebateStageType } from '@shared/debate-stages'
import { chat, LLMError } from '../llm-client'
import { buildJudgeSystemPrompt, parseJsonResult } from './judge-common'

/** 漏洞严重级别 */
export type GapSeverity = 'high' | 'medium' | 'low'

/** judge_speech 工具入参 */
export interface JudgeSpeechArgs {
  /** 辩题（必填） */
  topic: string
  /** 环节类型（必填，六类之一；可由 detect_stage 识别） */
  stage: DebateStageType
  /** 己方立场（必填） */
  side: 'aff' | 'neg'
  /** 该环节的稿子全文（必填，手动粘贴） */
  speech: string
  /** 评委人设 id（可选，默认 hu-jianbiao） */
  judgeId?: string
  /** 赛制提示（可选） */
  formatHint?: string
}

/** 单方单维评分 */
export interface JudgeSpeechDimension {
  key: DimensionKey
  name: string
  /** 己方得分 0-10 */
  score: number
  comment: string
}

/** 漏洞条目 */
export interface SpeechGap {
  severity: GapSeverity
  /** 漏洞描述 */
  description: string
  /** 稿中证据（原文片段，可选） */
  evidence?: string
}

/** 改进建议 */
export interface SpeechImprovement {
  /** 建议针对的稿子部分（如"第一段判准"） */
  target: string
  /** 具体建议 */
  suggestion: string
}

/** judge_speech 工具返回值（成功态） */
export interface JudgeSpeechResult {
  success: true
  judgeId: string
  judgeName: string
  topic: string
  stage: DebateStageType
  side: 'aff' | 'neg'
  dimensions: JudgeSpeechDimension[]
  /** 漏洞清单（按严重度排序） */
  gaps: SpeechGap[]
  improvements: SpeechImprovement[]
  /** 总评（评委风格） */
  summary: string
}

/** judge_speech 工具返回值（失败态） */
export interface JudgeSpeechFailure {
  success: false
  error: string
}

/** 环节类型白名单（供 parameters enum 与校验用） */
const STAGE_ENUM: DebateStageType[] = [
  'opening',
  'rebuttal',
  'cross_exam',
  'cross_summary',
  'free_debate',
  'closing'
]

/** 期望 LLM 输出的 JSON 结构样例（嵌入 prompt，约束输出格式） */
const JSON_SAMPLE = `{
  "dimensions": [
    { "key": "logicDepth", "score": 7, "comment": "立论框架清晰但判准稍显模糊" },
    { "key": "logicRigor", "score": 8, "comment": "论证链条完整" },
    { "key": "rebuttal", "score": 5, "comment": "未预判对方可能的反驳" },
    { "key": "expressiveness", "score": 6, "comment": "语言可更精炼" },
    { "key": "teamwork", "score": 7, "comment": "与后续环节衔接预留不足" }
  ],
  "gaps": [
    { "severity": "high", "description": "判准没有展开论证，易被对方攻击", "evidence": "第2段'……'" },
    { "severity": "medium", "description": "第二论点缺乏论据支撑" }
  ],
  "improvements": [
    { "target": "第一段判准", "suggestion": "补充一段判准成立的论证" },
    { "target": "第二论点", "suggestion": "加入数据或案例支撑" }
  ],
  "summary": "整体而言……（用评委风格写 60-100 字）"
}`

/**
 * 解析并校验 LLM 返回的单方稿评估 JSON。
 * 失败抛错（由调用方转失败结果）。
 */
function parseSpeechResult(
  raw: string
): Omit<JudgeSpeechResult, 'success' | 'judgeId' | 'judgeName' | 'topic' | 'stage' | 'side'> {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as {
    dimensions?: unknown
    gaps?: unknown
    improvements?: unknown
    summary?: unknown
  }

  // 校验 dimensions：覆盖 FIVE_DIMENSIONS 全部 key，score 0-10
  if (!Array.isArray(obj.dimensions)) {
    throw new Error('dimensions 缺失或非数组')
  }
  const dimByKey = new Map<string, { score?: unknown; comment?: unknown }>()
  for (const item of obj.dimensions) {
    if (item && typeof item === 'object') {
      const d = item as { key?: unknown; score?: unknown; comment?: unknown }
      if (typeof d.key === 'string') dimByKey.set(d.key, d)
    }
  }
  const dimensions: JudgeSpeechDimension[] = []
  for (const dim of FIVE_DIMENSIONS) {
    const d = dimByKey.get(dim.key)
    const score = d ? Number(d.score) : NaN
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      throw new Error(`维度 ${dim.key} score 缺失或非法`)
    }
    dimensions.push({
      key: dim.key,
      name: dim.name,
      score,
      comment: d && typeof d.comment === 'string' ? d.comment.trim() : ''
    })
  }

  // 校验 gaps（可选）
  const gaps: SpeechGap[] = []
  if (obj.gaps !== undefined) {
    if (!Array.isArray(obj.gaps)) throw new Error('gaps 非数组')
    for (const item of obj.gaps) {
      if (!item || typeof item !== 'object') continue
      const g = item as { severity?: unknown; description?: unknown; evidence?: unknown }
      const severity = g.severity === 'high' || g.severity === 'medium' || g.severity === 'low'
        ? g.severity
        : 'medium'
      if (typeof g.description === 'string' && g.description.trim() !== '') {
        gaps.push({
          severity,
          description: g.description.trim(),
          evidence: typeof g.evidence === 'string' && g.evidence.trim() !== ''
            ? g.evidence.trim()
            : undefined
        })
      }
    }
  }

  // 校验 improvements（可选）
  const improvements: SpeechImprovement[] = []
  if (obj.improvements !== undefined) {
    if (!Array.isArray(obj.improvements)) throw new Error('improvements 非数组')
    for (const item of obj.improvements) {
      if (!item || typeof item !== 'object') continue
      const imp = item as { target?: unknown; suggestion?: unknown }
      if (
        typeof imp.target === 'string' &&
        imp.target.trim() !== '' &&
        typeof imp.suggestion === 'string' &&
        imp.suggestion.trim() !== ''
      ) {
        improvements.push({ target: imp.target.trim(), suggestion: imp.suggestion.trim() })
      }
    }
  }

  const summary =
    typeof obj.summary === 'string' && obj.summary.trim() !== '' ? obj.summary.trim() : ''

  return { dimensions, gaps, improvements, summary }
}

/**
 * judge_speech 工具定义。
 *
 * 执行流程：
 *   1. 校验必填参数（topic / stage / side / speech）
 *   2. 取评委人设（未知 id 回落默认）与环节定义
 *   3. 构造 prompt：system=评委人设 + "仅评审该环节" 指令；user=辩题+立场+环节稿+评审要点+JSON 样例
 *   4. 调 llm-client.chat（非流式，透传 ctx.config / ctx.signal）
 *   5. 解析 JSON（五维评分 + gaps + improvements + summary）
 *   6. 任一环节失败 → { success:false, error }
 */
export const judgeSpeechTool: ToolDefinition<JudgeSpeechArgs, JudgeSpeechResult | JudgeSpeechFailure> =
  {
    name: 'judge_speech',
    description:
      '按评委人设评估己方某一环节的稿子（立论/驳论/质询/质询小结/自由辩论/总结陈词）：给五维评分、指出漏洞清单与改进建议。适合备赛时只有己方稿子的场景。',
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
          description: '该环节的稿子全文（必填，手动粘贴）'
        },
        judgeId: {
          type: 'string',
          enum: JUDGE_IDS,
          description: '评委人设 id（可选，默认 hu-jianbiao 胡渐彪）'
        },
        formatHint: {
          type: 'string',
          description: '赛制提示（可选，如"世锦赛制"）'
        }
      },
      required: ['topic', 'stage', 'side', 'speech']
    },
    riskLevel: 'low',
    async execute(
      args: JudgeSpeechArgs,
      ctx?: { config?: LLMConfig; signal?: AbortSignal }
    ): Promise<JudgeSpeechResult | JudgeSpeechFailure> {
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
      const systemPrompt = buildJudgeSystemPrompt(
        judge,
        [
          `你正在评估${side === 'aff' ? '正方' : '反方'}在「${stageDef?.name ?? stage}」环节的稿子。`,
          `这一环节的评审要点是：\n${stageKeyPoints}`,
          '请用你的评审标准，只针对该环节的稿子给出评估：五维打分、漏洞清单与改进建议。'
        ].join('\n')
      )

      const formatLine =
        typeof args.formatHint === 'string' && args.formatHint.trim() !== ''
          ? `\n赛制参考：${args.formatHint.trim()}`
          : ''
      const userPrompt = [
        `【辩题】${topic}${formatLine}`,
        `【立场】${side === 'aff' ? '正方' : '反方'}（${side}）`,
        `【环节】${stageDef?.name ?? stage}`,
        '',
        `【${side === 'aff' ? '正方' : '反方'}该环节稿子】`,
        speech,
        '',
        '【输出要求】',
        '请给出：1) 五个维度（立论深度/逻辑严密/反驳攻防/表达感染力/团队配合）各自的分数（0-10）与一句评语；',
        '2) gaps：漏洞清单（每条含 severity: high/medium/low 与描述，可附稿中原文片段作为 evidence）；',
        '3) improvements：改进建议（每条含 target 指向稿子哪部分 + suggestion 具体建议）；',
        '4) summary：一段总评（60-100 字），用你惯常的点评口吻。',
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
        return { success: false, error: '评委返回内容为空' }
      }

      // 5. 解析评分结果
      try {
        const parsed = parseSpeechResult(content)
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
          error: `评委输出格式异常：${e instanceof Error ? e.message : String(e)}`
        }
      }
    }
  }
