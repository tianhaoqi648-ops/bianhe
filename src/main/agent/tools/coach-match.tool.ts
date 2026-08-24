// ============================================================
// coach-match.tool.ts — Agent 工具：教练整场分环节复盘（2026-08-23）
//
// 复盘场景进阶（Task 2）：把一整场辩论按环节（立论/驳论/质询/自由辩/结辩…）
// 拆分，由教练人设对每个环节分别给出成长向诊断（立论/反驳/表达/攻防四维短板 +
// 可练方向 + 示范改写），再对整场给出汇总复盘。不判分、不排名。
//
// 与 judge_speech / judge_match 的关系：
//   - judge_speech：单方单环节稿 → 教练诊断（默认教练复盘）
//   - coach_match：整场时间线/整稿 → 逐环节教练诊断 + 整场汇总（本工具）
//   - judge_match：整场时间线 → 裁判判分（判分语义，与教练复盘点不同）
//
// 执行方式：对每个环节组循环调用一次 LLM（复用 judge-common 的教练复盘
//   buildCoachReviewUserPrompt / parseCoachResultJson），最后再调用一次 LLM
//   生成整场汇总。时间线无环节标注时退化为单一「全场」组。
//
// 风险等级 low：只读评估，不修改数据库。
// ============================================================

import type { ToolDefinition, LLMConfig } from '@shared/agent-types'
import { JUDGE_IDS, getJudgeAnonLabel, getJudgeById } from '@shared/ai-judges'
import type { DebateStageType } from '@shared/debate-stages'
import { chat, LLMError } from '../llm-client'
import { judgeHistoryRepo } from '../../db/repository/judge-history.repo'
import { buildJudgeProvenance } from '../provenance'
import {
  buildCoachPrompt,
  buildCoachReviewUserPrompt,
  groupTimelineByStage,
  parseCoachResultJson,
  type CoachShortboard,
  type CoachStageGroup,
  type MatchTimelineSegment
} from './judge-common'

/** 单个环节的教练复盘 */
export interface CoachMatchStageReview {
  /** 环节类型（若是六类之一；否则 null） */
  stage: DebateStageType | null
  /** 环节展示名 */
  stageName: string
  /** 四维短板 + 训练方向 */
  shortboards: CoachShortboard[]
  /** 可练方向 */
  practiceDirections: string[]
  /** 该环节示范改写 */
  rewriteExample: string
  /** 该环节教练总评 */
  summary: string
}

/** coach_match 工具入参 */
export interface CoachMatchArgs {
  /** 辩题（必填） */
  topic: string
  /** 己方立场（必填） */
  side: 'aff' | 'neg'
  /** 教练人设 id（可选，默认 hu-jianbiao） */
  judgeId?: string
  /** 赛制提示（可选） */
  formatHint?: string
  /** 整场时间线（可选；提供时按环节分组逐段诊断，优先于 transcript） */
  timeline?: MatchTimelineSegment[]
  /** 整场转录全文（可选，无 timeline 时的退化输入） */
  transcript?: string
}

/** coach_match 工具返回值（成功态） */
export interface CoachMatchResult {
  success: true
  judgeId: string
  judgeName: string
  topic: string
  side: 'aff' | 'neg'
  /** 逐环节教练诊断（按时间线出现顺序） */
  stageReviews: CoachMatchStageReview[]
  /** 整场汇总复盘 */
  summary: string
}

/** coach_match 工具返回值（失败态） */
export interface CoachMatchFailure {
  success: false
  error: string
}

/** 整场汇总 JSON 样例 */
const MATCH_SUMMARY_SAMPLE = `{
  "summary": "整场而言，你立论框架完整，但质询环节对判准的防守偏弱……（成长向整场总结，60-120 字）"
}`

/** 解析整场汇总 JSON（仅 summary 必需） */
function parseMatchSummary(raw: string): { summary: string } {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error('JSON 非对象')
  const sum = (parsed as { summary?: unknown }).summary
  if (typeof sum !== 'string' || sum.trim() === '') throw new Error('summary 缺失或为空')
  return { summary: sum.trim() }
}

/**
 * 单次 LLM 调用：对一个环节组做教练诊断。
 * @returns 解析后该环节诊断（不变部分交给调用方拼接）
 */
async function runCoachStageReview(
  p: {
    judge: NonNullable<ReturnType<typeof getJudgeById>>
    topic: string
    side: 'aff' | 'neg'
    group: CoachStageGroup
    formatHint?: string
  },
  ctx: { config: LLMConfig; signal?: AbortSignal }
): Promise<Omit<CoachMatchStageReview, 'stage' | 'stageName'>> {
  const systemPrompt = buildCoachPrompt({
    profile: p.judge,
    debateTopic: p.topic
  })
  const userPrompt = buildCoachReviewUserPrompt({
    topic: p.topic,
    side: p.side,
    stage: p.group.stage ?? undefined,
    stageName: p.group.stageName,
    speech: p.group.content,
    formatHint: p.formatHint
  })
  const assistantMessage = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    ctx.config,
    undefined,
    ctx.signal
  )
  const content = assistantMessage.content
  if (!content || content.trim() === '') {
    throw new Error(`环节「${p.group.stageName}」教练返回内容为空`)
  }
  return parseCoachResultJson(content)
}

/** 整场汇总：把各环节诊断 + 原始内容交给 LLM，输出整场成长向汇总 */
async function runMatchSummary(
  p: {
    judge: NonNullable<ReturnType<typeof getJudgeById>>
    topic: string
    side: 'aff' | 'neg'
    groups: CoachStageGroup[]
    reviews: CoachMatchStageReview[]
    transcript?: string
  },
  ctx: { config: LLMConfig; signal?: AbortSignal }
): Promise<string> {
  const body =
    p.groups.length > 0
      ? p.groups
          .map((g) => {
            const rev = p.reviews.find((r) => r.stageName === g.stageName)
            const revLines = rev
              ? `【教练诊断】四维短板：${rev.shortboards
                  .map((s) => `${s.area}:${s.point}`)
                  .join('；')}；总评：${rev.summary}`
              : ''
            return `【${g.stageName}】\n${g.content}\n${revLines}`
          })
          .join('\n\n')
      : (p.transcript ?? '').trim()
  const systemPrompt = buildCoachPrompt({
    profile: p.judge,
    debateTopic: p.topic
  })
  const userPrompt = [
    `【辩题】${p.topic}`,
    `【立场】${p.side === 'aff' ? '正方' : '反方'}（${p.side}）`,
    '【整场分环节内容与逐环节诊断】',
    body,
    '',
    '【你的任务】',
    '请以教练视角（成长向，不判分、不排名）对整场做汇总复盘：',
    '指出整场的整体状态、各环节间的连带问题与最值得优先训练的一件事，口吻温和而具体。',
    '严格输出 JSON（不要包含 markdown 代码块围栏），结构如下：',
    MATCH_SUMMARY_SAMPLE
  ].join('\n')
  const assistantMessage = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    ctx.config,
    undefined,
    ctx.signal
  )
  const content = assistantMessage.content
  if (!content || content.trim() === '') throw new Error('整场汇总返回内容为空')
  return parseMatchSummary(content).summary
}

/**
 * coach_match 工具定义（整场分环节教练复盘）。
 *
 * 执行流程：
 *   1. 校验必填参数（topic / side；timeline 或 transcript 至少其一）
 *   2. 取教练人设（未知 id 回落默认）
 *   3. 时间线按环节分组（无环节标注退化为单一"全场"组）
 *   4. 逐环节循环调 LLM（buildCoachReviewUserPrompt + parseCoachResultJson）
 *   5. 最后调一次 LLM 生成整场汇总
 *   6. 任一环节失败 → { success:false, error }
 */
export const coachMatchTool: ToolDefinition<CoachMatchArgs, CoachMatchResult | CoachMatchFailure> =
  {
    name: 'coach_match',
    description:
      '教练整场分环节复盘：输入辩题与整场时间线（或整场转写全文），按环节（立论/驳论/质询/自由辩/结辩…）拆分后，由教练人设对每个环节给出成长向诊断（立论/反驳/表达/攻防四维短板 + 可练方向 + 示范改写），并对整场做汇总复盘。不判分、不排名，备赛打磨整场表现用。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '辩题（必填）'
        },
        side: {
          type: 'string',
          enum: ['aff', 'neg'],
          description: '己方立场（必填）：aff 正方 / neg 反方'
        },
        judgeId: {
          type: 'string',
          enum: JUDGE_IDS,
          description: '教练人设 id（可选，默认 hu-jianbiao 胡渐彪）'
        },
        formatHint: {
          type: 'string',
          description: '赛制提示（可选）'
        },
        timeline: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              stage: { type: 'string', description: '环节类型（可选，六类之一）' },
              stageName: { type: 'string', description: '环节名（可选，优先于 stage 展示）' },
              side: { type: 'string', description: '阵营（可选）' },
              speaker: { type: 'string', description: '发言人（可选）' },
              tsMs: { type: 'number', description: '时间点（毫秒，可选）' },
              content: { type: 'string', description: '该段文本（必填非空）' }
            },
            required: ['content']
          },
          description: '整场时间线（可选；提供时按环节分组逐段诊断，优先于 transcript）'
        },
        transcript: {
          type: 'string',
          description: '整场转录全文（可选，无 timeline 时的退化输入）'
        }
      },
      required: ['topic', 'side']
    },
    riskLevel: 'low',
    tier: 'dangerous',
    async execute(
      args: CoachMatchArgs,
      ctx?: { config?: LLMConfig; signal?: AbortSignal }
    ): Promise<CoachMatchResult | CoachMatchFailure> {
      // 1. 校验必填参数
      const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
      const side = args.side === 'neg' ? 'neg' : 'aff'
      if (topic === '') {
        return { success: false, error: '参数缺失：topic 必填' }
      }
      const transcript = typeof args.transcript === 'string' ? args.transcript.trim() : ''
      const hasBody =
        (Array.isArray(args.timeline) &&
          args.timeline.some((s) => typeof s?.content === 'string' && s.content.trim() !== '')) ||
        transcript !== ''
      if (!hasBody) {
        return { success: false, error: '参数缺失：timeline 与 transcript 至少提供其一' }
      }

      // 2. 取教练人设
      const judge = getJudgeById(args.judgeId) ?? getJudgeById('hu-jianbiao')
      if (!judge) {
        return { success: false, error: '教练人设数据缺失' }
      }

      // 3. 分组；无环节标注时退化为单一"全场"组
      let groups = groupTimelineByStage(args.timeline)
      if (groups.length === 0 && transcript !== '') {
        groups = [{ key: '全场', stage: null, stageName: '全场', content: transcript }]
      }

      // 4. 逐环节循环调 LLM
      const config = ctx?.config
      if (!config) {
        return { success: false, error: '缺少 LLM 配置（请先在设置中配置 AI 助手）' }
      }
      const runCtx = { config, signal: ctx?.signal }

      const stageReviews: CoachMatchStageReview[] = []
      for (const group of groups) {
        try {
          const parsed = await runCoachStageReview(
            { judge, topic, side, group, formatHint: args.formatHint },
            runCtx
          )
          stageReviews.push({
            stage: group.stage,
            stageName: group.stageName,
            ...parsed
          })
        } catch (e) {
          const msg =
            e instanceof LLMError
              ? `LLM 调用失败（${e.code}）：${e.message}`
              : e instanceof Error
                ? e.message
                : String(e)
          return {
            success: false,
            error: `环节「${group.stageName}」复盘失败：${msg}`
          }
        }
      }

      // 5. 整场汇总
      let summary = ''
      try {
        summary = await runMatchSummary(
          { judge, topic, side, groups, reviews: stageReviews, transcript },
          runCtx
        )
      } catch (e) {
        const msg =
          e instanceof LLMError
            ? `LLM 调用失败（${e.code}）：${e.message}`
            : e instanceof Error
              ? e.message
              : String(e)
        return { success: false, error: `整场汇总失败：${msg}` }
      }

      const result: CoachMatchResult = {
        success: true,
        judgeId: judge.id,
        judgeName: getJudgeAnonLabel(judge.id),
        topic,
        side,
        stageReviews,
        summary
      }
      // 成功即写评审历史（失败静默忽略，不打断工具返回）
      try {
        judgeHistoryRepo.create({
          judgeId: judge.id,
          toolName: 'coach_match',
          side,
          topic,
          resultJson: result as unknown as Record<string, unknown>,
          // provenance：注入 LLM 模型/版本 + 整场输入材料（时间线/转录）hash
          provenance: buildJudgeProvenance({
            config,
            toolName: 'coach_match',
            topic,
            inputs: [transcript, JSON.stringify(args.timeline ?? []), side],
            extra: args.formatHint
          })
        })
      } catch {
        // 忽略历史写入失败
      }
      return result
    }
  }