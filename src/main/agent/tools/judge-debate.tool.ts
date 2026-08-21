// ============================================================
// judge-debate.tool.ts — Agent 工具：AI 裁判评审辩论（AI 裁判功能 2026-08-18）
//
// 包装 llm-client.chat（非流式）：
//   1. 按 judgeId 取评委人设（内置 5 位知名辩手，覆盖攻防/价值/学理/建构四类审美）
//   2. 构造评审 prompt：评委身份 + 辩风 + 评审倾向 + 辩题 + 双方辩词 + 五维评分要求
//   3. 调 LLM 返回结构化 JSON 评分（胜负 + 五维双方分数 + 模仿该评委风格的点评）
//
// 入参说明：
//   - topic / affSpeech / negSpeech 必填（辩词由用户手动粘贴，MVP 不接文件）
//   - judgeId 可选（enum 内置 5 位，默认 hu-jianbiao）
//   - formatHint 可选（赛制提示，如"新国辩制"，仅影响 prompt 语境）
//
// 依赖：ctx.config（LLM 配置由渲染进程下发，见 ToolExecutionContext）、ctx.signal（取消透传）。
// 风险等级 low：只读评分，不修改数据库，不弹人工确认。
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { LLMConfig } from '@shared/agent-types'
import { FIVE_DIMENSIONS, JUDGE_IDS, getJudgeById, type DimensionKey } from '@shared/ai-judges'
import { getStageDefinition, type DebateStageType } from '@shared/debate-stages'
import { chat, LLMError } from '../llm-client'
import { judgeHistoryRepo } from '../../db/repository/judge-history.repo'
import { buildJudgeSystemPrompt, parseJsonResult } from './judge-common'

/** judge_debate 工具入参（与 parameters schema 对齐） */
export interface JudgeDebateArgs {
  /** 辩题（必填） */
  topic: string
  /** 正方辩词全文（必填，手动粘贴） */
  affSpeech: string
  /** 反方辩词全文（必填，手动粘贴） */
  negSpeech: string
  /** 评委人设 id（可选，内置 5 位，默认 hu-jianbiao） */
  judgeId?: string
  /** 赛制提示（可选，如"新国辩制"） */
  formatHint?: string
  /** 正方环节分段（可选，批3：传入时按环节逐段判定；空数组视为未提供） */
  affStages?: Array<{ stage: DebateStageType; content: string }>
  /** 反方环节分段（可选，批3） */
  negStages?: Array<{ stage: DebateStageType; content: string }>
}

/** 单个维度的双方评分 */
export interface JudgeDimensionScore {
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

/** judge_debate 工具返回值（成功态） */
export interface JudgeDebateResult {
  success: true
  /** 评委 id 与姓名（实际使用的人设，含回落） */
  judgeId: string
  judgeName: string
  /** 辩题 */
  topic: string
  /** 胜负判定 */
  verdict: {
    /** 胜方：aff（正方）/ neg（反方） */
    winner: 'aff' | 'neg'
    /** 置信度 0-1 */
    confidence: number
    /** 判定理由（一句话） */
    reason: string
  }
  /** 五维双方评分 */
  dimensions: JudgeDimensionScore[]
  /** 总评（模仿该评委的点评风格） */
  summary: string
  /** 环节分段判定（批3：仅提供 affStages/negStages 时返回；每段胜负+置信度+评语） */
  stageVerdicts?: Array<{
    stage: DebateStageType
    winner: 'aff' | 'neg'
    confidence: number
    comment: string
  }>
}

/** judge_debate 工具返回值（失败态） */
export interface JudgeDebateFailure {
  success: false
  error: string
}

/** 默认评委：胡渐彪（攻防流） */
const DEFAULT_JUDGE_ID = 'hu-jianbiao'

/** 期望 LLM 输出的 JSON 结构样例（嵌入 prompt，约束输出格式） */
const JSON_SAMPLE = `{
  "verdict": { "winner": "aff", "confidence": 0.7, "reason": "正方在核心交锋点完成了有效回应" },
  "dimensions": [
    { "key": "logicDepth", "affScore": 8, "negScore": 6, "comment": "正方立论有层次，反方稍显单薄" },
    { "key": "logicRigor", "affScore": 7, "negScore": 7, "comment": "双方论证链条都较完整" },
    { "key": "rebuttal", "affScore": 8, "negScore": 5, "comment": "反方多处未正面回应正方质询" },
    { "key": "expressiveness", "affScore": 6, "negScore": 8, "comment": "反方表达感染力更强" },
    { "key": "teamwork", "affScore": 7, "negScore": 6, "comment": "正方前后场口径一致" }
  ],
  "summary": "整体而言……（用评委的风格写总评，80-150 字）",
  "stageVerdicts": [
    { "stage": "opening", "winner": "aff", "confidence": 0.8, "comment": "正方立论框架更完整" },
    { "stage": "rebuttal", "winner": "neg", "confidence": 0.65, "comment": "反方拆解更有力" }
  ]
}`

/**
 * 构造评审 prompt 的 user 部分（辩题 + 双辩词 + 可选分段标注 + 评分要求 + JSON 样例）。
 */
function buildUserPrompt(args: JudgeDebateArgs): string {
  const dimsText = FIVE_DIMENSIONS.map((d, i) => `${i + 1}. ${d.name}（${d.key}）`).join('\n')
  const formatLine =
    typeof args.formatHint === 'string' && args.formatHint.trim() !== ''
      ? `\n赛制参考：${args.formatHint.trim()}`
      : ''

  // 分段标注区（批3）：双方提供 affStages/negStages 时按环节标注，供逐段判定
  const hasStages =
    (Array.isArray(args.affStages) && args.affStages.length > 0) ||
    (Array.isArray(args.negStages) && args.negStages.length > 0)
  let stagesBlock = ''
  let stageInstruction = ''
  if (hasStages) {
    const formatStages = (
      stages: Array<{ stage: DebateStageType; content: string }> | undefined
    ): string => {
      if (!stages || stages.length === 0) return ''
      return stages
        .map(
          (s) =>
            `- [${getStageDefinition(s.stage)?.name ?? s.stage}]（${s.stage}）：${s.content}`
        )
        .join('\n')
    }
    const affBlock = formatStages(args.affStages)
    const negBlock = formatStages(args.negStages)
    stagesBlock = [
      '',
      '【分段标注】',
      '以下是双方按环节分段整理的辩词（与上面全文对应）：',
      affBlock !== '' ? `正方环节分段：\n${affBlock}` : '',
      negBlock !== '' ? `反方环节分段：\n${negBlock}` : ''
    ]
      .filter((s) => s !== '')
      .join('\n')
    stageInstruction = [
      '',
      '3. stageVerdicts：按环节分段逐段给出胜负判定（stage / winner / confidence / 一句评语 comment）；',
      '   若未提供分段则省略该字段'
    ].join('\n')
  }

  return `请你以评委身份评审以下一场辩论。

【辩题】${args.topic}${formatLine}

【正方辩词】
${args.affSpeech}

【反方辩词】
${args.negSpeech}
${stagesBlock}
【评分要求】
请从以下五个维度，分别给正反双方打分（0-10 分）并各写一句评语：
${dimsText}

然后给出：
1. verdict：胜方（aff=正方 / neg=反方）、置信度（0-1）、一句判定理由
2. summary：一段总评（80-150 字），用你惯常的点评口吻，体现你的评审视角${stageInstruction}

【输出格式】
严格输出 JSON（不要包含 markdown 代码块围栏），结构如下：
${JSON_SAMPLE}`
}

/**
 * 解析 LLM 返回的 content 为 JudgeDebateResult（结构校验）。
 * JSON 围栏/提取由 judge-common.parseJsonResult 处理；失败抛错。
 */
function parseJudgeResult(raw: string): Omit<JudgeDebateResult, 'success' | 'judgeId' | 'judgeName' | 'topic'> {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as {
    verdict?: { winner?: unknown; confidence?: unknown; reason?: unknown }
    dimensions?: unknown
    summary?: unknown
    stageVerdicts?: unknown
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
  const dimensions: JudgeDimensionScore[] = []
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
      d && typeof d.comment === 'string' && d.comment.trim() !== ''
        ? d.comment.trim()
        : ''
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

  // 校验 stageVerdicts（批3，可选）：数组时逐项过滤，非法项跳过；空/非数组 → undefined
  let stageVerdicts: JudgeDebateResult['stageVerdicts']
  if (Array.isArray(obj.stageVerdicts) && obj.stageVerdicts.length > 0) {
    const list: NonNullable<JudgeDebateResult['stageVerdicts']> = []
    for (const item of obj.stageVerdicts) {
      if (!item || typeof item !== 'object') continue
      const s = item as { stage?: unknown; winner?: unknown; confidence?: unknown; comment?: unknown }
      const stage = s.stage
      if (typeof stage !== 'string' || !getStageDefinition(stage as DebateStageType)) continue
      if (s.winner !== 'aff' && s.winner !== 'neg') continue
      const confidence = Number(s.confidence)
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue
      const comment = typeof s.comment === 'string' && s.comment.trim() !== '' ? s.comment.trim() : ''
      if (comment === '') continue
      list.push({ stage: stage as DebateStageType, winner: s.winner, confidence, comment })
    }
    if (list.length > 0) {
      stageVerdicts = list
    }
  }

  return { verdict: { winner, confidence, reason }, dimensions, summary, stageVerdicts }
}

/**
 * judge_debate 工具定义。
 *
 * 执行流程：
 *   1. 校验必填参数（topic / affSpeech / negSpeech 非空）
 *   2. 按 judgeId 取人设（未知 id 回落默认胡渐彪）
 *   3. 构造评审 prompt（system：评委身份/辩风/评审倾向；user：辩题+辩词+评分要求+JSON 样例）
 *   4. 调 llm-client.chat（非流式，透传 ctx.config / ctx.signal）
 *   5. 解析 LLM 返回 JSON，结构校验后返回评分结果
 *   6. 任一环节失败 → 返回 { success:false, error }（不抛错，由 agent-loop 反馈 LLM）
 */
export const judgeDebateTool: ToolDefinition<JudgeDebateArgs, JudgeDebateResult | JudgeDebateFailure> =
  {
    name: 'judge_debate',
    description:
      '按评委人设评审一场辩论：输入辩题与双方辩词，由内置知名评委（胡渐彪/黄执中/陈铭/周玄毅/熊浩）给出胜负判定、五维双方评分与点评。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '辩题（必填）'
        },
        affSpeech: {
          type: 'string',
          description: '正方辩词全文（必填，手动粘贴）'
        },
        negSpeech: {
          type: 'string',
          description: '反方辩词全文（必填，手动粘贴）'
        },
        judgeId: {
          type: 'string',
          enum: JUDGE_IDS,
          description: '评委人设 id（可选，默认 hu-jianbiao 胡渐彪）'
        },
        formatHint: {
          type: 'string',
          description: '赛制提示（可选，如"新国辩制"）'
        },
        affStages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              stage: {
                type: 'string',
                enum: ['opening', 'rebuttal', 'cross_exam', 'cross_summary', 'free_debate', 'closing'],
                description: '环节类型（六类之一）'
              },
              content: {
                type: 'string',
                description: '该环节辩词'
              }
            },
            required: ['stage', 'content']
          },
          description: '正方环节分段（可选，传入时按环节逐段判定胜负）'
        },
        negStages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              stage: {
                type: 'string',
                enum: ['opening', 'rebuttal', 'cross_exam', 'cross_summary', 'free_debate', 'closing'],
                description: '环节类型（六类之一）'
              },
              content: {
                type: 'string',
                description: '该环节辩词'
              }
            },
            required: ['stage', 'content']
          },
          description: '反方环节分段（可选，传入时按环节逐段判定胜负）'
        }
      },
      required: ['topic', 'affSpeech', 'negSpeech']
    },
    riskLevel: 'low',
    async execute(
      args: JudgeDebateArgs,
      ctx?: { config?: LLMConfig; signal?: AbortSignal }
    ): Promise<JudgeDebateResult | JudgeDebateFailure> {
      // 1. 校验必填参数
      const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
      const affSpeech = typeof args.affSpeech === 'string' ? args.affSpeech.trim() : ''
      const negSpeech = typeof args.negSpeech === 'string' ? args.negSpeech.trim() : ''
      if (topic === '' || affSpeech === '' || negSpeech === '') {
        return { success: false, error: '参数缺失：topic / affSpeech / negSpeech 均必填' }
      }

      // 1.1 校验分段结构（批3）：任一提供时两数组逐项校验；空数组视为未提供
      const validateStages = (
        name: string,
        stages: Array<{ stage: DebateStageType; content: string }> | undefined
      ): { success: true } | { success: false; error: string } => {
        if (stages === undefined || stages.length === 0) return { success: true }
        for (const s of stages) {
          if (!s || !getStageDefinition(s.stage) || typeof s.content !== 'string' || s.content.trim() === '') {
            return {
              success: false,
              error: `${name} 结构非法：每项须含合法 stage（六类之一）与非空 content`
            }
          }
        }
        return { success: true }
      }
      const affCheck = validateStages('affStages', args.affStages)
      if (!affCheck.success) return affCheck
      const negCheck = validateStages('negStages', args.negStages)
      if (!negCheck.success) return negCheck

      // 2. 取评委人设（未知 id 回落默认）
      const judge = getJudgeById(args.judgeId) ?? getJudgeById(DEFAULT_JUDGE_ID)
      if (!judge) {
        return { success: false, error: '评委人设数据缺失' }
      }

      // 3. 构造评审 prompt（复用 judge-common 的人设 system prompt 构建）
      const systemPrompt = buildJudgeSystemPrompt(
        judge,
        [
          '现在请你作为这位评委，用你的评审标准与口吻，对下面的辩论进行评判。',
          '请客观评分，但让分数与评语自然体现你的审美侧重。'
        ].join('\n')
      )

      const userPrompt = buildUserPrompt({
        topic,
        affSpeech,
        negSpeech,
        formatHint: args.formatHint,
        affStages: args.affStages,
        negStages: args.negStages
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
        const msg = err instanceof LLMError ? `LLM 调用失败（${err.code}）：${err.message}` : err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
      if (!content || content.trim() === '') {
        return { success: false, error: '评委返回内容为空' }
      }

      // 5. 解析评分结果
      try {
        const parsed = parseJudgeResult(content)
        const result: JudgeDebateResult = {
          success: true,
          judgeId: judge.id,
          judgeName: judge.name,
          topic,
          ...parsed
        }
        // 成功即写评审历史（失败静默忽略，不打断工具返回）
        try {
          judgeHistoryRepo.create({
            judgeId: judge.id,
            toolName: 'judge_debate',
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
