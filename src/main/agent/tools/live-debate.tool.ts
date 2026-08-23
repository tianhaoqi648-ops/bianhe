// ============================================================
// live-debate.tool.ts — Agent 工具：实时对辩（陪练子模式 Task 4 2026-08-23）
//
// 备赛刚需场景：在回合制陪练之上，支持更像实战的「实时对辩」——
//   按 申论(constructive) → 质询(crossfire) → 自由辩论(free) → 总结(summary)
//   四个环节近似真实赛制的推进，AI 对手按当前环节发表发言，用户以文本或
//   麦克风（STT 转字）回应后逐轮推进；结束时输出对抗要点汇总。
//
// 设计要点：
//   - 与 simulate_opponent 相同的「回合制」结构（history 驱动），由前端/调用方
//     传入当前环节 phase 与已完成的 live rounds，工具产出一段对手发言。
//   - 环节语气通过 buildLiveDebatePrompt（judge-common）按 phase 分档注入。
//   - 状态由 history/phase 推导，不持久化服务端。
//   - 成功结果写 judge_history（role=sparring，toolName=judge_live 独立标记）。
//
// 风险等级 low：只读，不修改数据库。
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { LLMConfig } from '@shared/agent-types'
import { JUDGE_IDS, getJudgeAnonLabel, getJudgeById, type JudgeProfile, type SparringDifficulty } from '@shared/ai-judges'
import { chat, LLMError } from '../llm-client'
import { judgeHistoryRepo } from '../../db/repository/judge-history.repo'
import {
  LIVE_PHASE_NAMES,
  LIVE_PHASE_ORDER,
  buildLiveDebatePrompt,
  nextLivePhase,
  parseJsonResult,
  type LiveDebatePhase,
  type SparringStageScope
} from './judge-common'

/** 陪练难度白名单（默认 intermediate 进阶） */
const SPARRING_DIFFICULTIES: SparringDifficulty[] = ['novice', 'intermediate', 'national']

/** 环节范围白名单（全程 + 实时对辩四环节） */
const SPARRING_JUDGE_SCOPES: SparringStageScope[] = ['full', 'constructive', 'crossfire', 'free', 'summary']

/** 实时对辩：已完成的一个轮次（环节 + 对方发言 + 用户回应） */
export interface LiveDebateRound {
  /** 本轮的环节 */
  phase: LiveDebatePhase
  /** 对方（AI 对手）本轮发言 */
  opponent: string
  /** 用户（对方辩友）本轮回应 */
  userReply: string
}

/** judge_live 工具入参 */
export interface LiveDebateArgs {
  /** 辩题（必填） */
  topic: string
  /** 己方立场（必填） */
  side: 'aff' | 'neg'
  /** 可选己方基础立论/稿子（注入 prompt，让对手据此发言） */
  speech?: string
  /** 可选整稿 / 整场上下文（整份立论或整场转写文本）；提供时对手紧扣上下文发言 */
  context?: string
  /** 对手人设 id（可选，默认 hu-jianbiao） */
  judgeId?: string
  /** 对手难度（可选，默认 intermediate） */
  difficulty?: SparringDifficulty
  /** 当前环节（可选；缺省由 history 尾部推导，再缺省 constructive） */
  phase?: LiveDebatePhase
  /** 已完成的实时对辩轮次（可选，续接时传入，需含 phase） */
  history?: LiveDebateRound[]
  /** 置 true 表示结束实时对辩并输出对抗要点汇总（可选） */
  finalize?: boolean
  /** 环节范围（可选）：'full' 全程（缺省，按 phase 推进）或 具体环节——指定时锁定该环节持续训练 */
  scope?: SparringStageScope
}

/** judge_live 实时对辩：一轮对方发言（成功态） */
export interface LiveDebateTurnResult {
  success: true
  mode: 'live_turn'
  /** 恒为 opponent（AI 对手在发言） */
  role: 'opponent'
  /** 当前环节 */
  phase: LiveDebatePhase
  /** 对方本段发言 */
  speech: string
  /** 续接用的完整轮次快照（本轮对手发言即 history 的追加基准，用户回应由前端补齐） */
  nextRounds: LiveDebateRound[] | null
  judgeId: string
  judgeName: string
  topic: string
  side: 'aff' | 'neg'
  difficulty: SparringDifficulty
  /** 本轮序号（1 基） */
  roundIndex: number
}

/** judge_live 实时对辩：结束并汇总（对抗要点，成长向） */
export interface LiveDebateFinalizeResult {
  success: true
  mode: 'live_finalize'
  role: 'opponent'
  phase: 'summary'
  judgeId: string
  judgeName: string
  topic: string
  side: 'aff' | 'neg'
  difficulty: SparringDifficulty
  /** 已完成的实时对辩轮次数量 */
  roundsPlayed: number
  /** 整体对抗评价（成长向，40-80 字） */
  summary: string
  /** 对抗要点（对方最有效攻击 / 典型失守点 + 对应应对建议） */
  keyPoints: Array<{ point: string; tip: string }>
}

/** judge_live 工具失败态 */
export interface LiveDebateFailure {
  success: false
  error: string
}

/** judge_live 成功态（换轮 + 汇总两形态） */
export type LiveDebateSuccess = LiveDebateTurnResult | LiveDebateFinalizeResult

/** 归一化实时对辩历史轮次（过滤空字段，phase 缺省补 constructive） */
function normalizeLiveRounds(history: LiveDebateRound[] | undefined): LiveDebateRound[] {
  if (!Array.isArray(history)) return []
  const rounds: LiveDebateRound[] = []
  for (const r of history) {
    if (!r || typeof r !== 'object') continue
    const phase: LiveDebatePhase = LIVE_PHASE_ORDER.includes(r.phase as LiveDebatePhase)
      ? (r.phase as LiveDebatePhase)
      : 'constructive'
    const opponent = typeof r.opponent === 'string' ? r.opponent.trim() : ''
    const userReply = typeof r.userReply === 'string' ? r.userReply.trim() : ''
    if (opponent === '' && userReply === '') continue
    rounds.push({ phase, opponent, userReply })
  }
  return rounds
}

/** 把已完成的实时对辩轮次格式化为连续文本（第 N 轮·环节：对方发言 / 你的回应） */
function formatLiveRounds(rounds: LiveDebateRound[]): string {
  return rounds
    .map((r, i) => {
      const lines = [`第 ${i + 1} 轮【${LIVE_PHASE_NAMES[r.phase] ?? r.phase}】`]
      if (r.opponent !== '') lines.push(`对方发言：${r.opponent}`)
      if (r.userReply !== '') lines.push(`你的回应：${r.userReply}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** 由历史尾部推导当前环节（最后一个已完成轮次的下一个环节） */
function derivePhase(
  phase: LiveDebatePhase | undefined,
  rounds: LiveDebateRound[],
  scope?: SparringStageScope
): LiveDebatePhase {
  // 指定环节范围时锁定为该环节（覆盖 phase/历史推导）
  if (scope && scope !== 'full' && LIVE_PHASE_ORDER.includes(scope as LiveDebatePhase)) {
    return scope as LiveDebatePhase
  }
  if (LIVE_PHASE_ORDER.includes(phase as LiveDebatePhase)) return phase as LiveDebatePhase
  if (rounds.length > 0) return nextLivePhase(rounds[rounds.length - 1].phase)
  return 'constructive'
}

/** 构造「实时对辩 · 换轮」的 user prompt（输出本方发言文本，非 JSON） */
function buildLiveTurnUserPrompt(p: {
  topic: string
  side: 'aff' | 'neg'
  speech: string
  phase: LiveDebatePhase
  rounds: LiveDebateRound[]
  context?: string
  scope?: SparringStageScope
}): string {
  const sideLabel = p.side === 'aff' ? '正方' : '反方'
  const hasContext = typeof p.context === 'string' && p.context.trim() !== ''
  const lines = [
    `【辩题】${p.topic}`,
    `【你是方】${sideLabel}（${p.side}）`,
    `【当前环节】${p.phase}`
  ]
  if (p.scope && p.scope !== 'full') {
    lines.push(`【环节范围】本次对辩限定在「${LIVE_PHASE_NAMES[p.scope] ?? p.scope}」环节内进行，持续以该环节节奏应对，不跳到其他环节。`)
  }
  if (p.speech.trim() !== '') {
    lines.push(`【你的整份立论/稿子】`, p.speech)
  }
  if (hasContext) {
    lines.push('【整稿/整场上下文】（发言前请重点参考，紧扣其中的结构、判准与漏洞）', p.context as string)
  }
  if (p.rounds.length > 0) {
    lines.push(
      '【已进行的实时对辩轮次】',
      formatLiveRounds(p.rounds),
      '',
      '【你刚完成的回应】',
      p.rounds[p.rounds.length - 1].userReply || '（本轮无明显回应）',
      ''
    )
  }
  lines.push(
    '【你的任务】',
    '作为实时对辩中的对方辩手，按当前环节的语气，针对对方辩友最新回应暴露的漏洞（并结合整份立论/上下文中尚未被攻破的薄弱处），发表这一轮的发言。',
    '只输出这一段发言文本本身（具体长度依环节自然而定，一般 150 字以内），不要输出解释、不要输出 JSON、不要自问自答代替对方。'
  )
  return lines.join('\n')
}

/** 实时对辩「结束并汇总」的 JSON 样例 */
const LIVE_FINALIZE_JSON_SAMPLE = `{
  "summary": "整体而言，你在申论立论清晰，但在质询环节对判准的回应多次失守……（成长向总结，40-80 字）",
  "keyPoints": [
    { "point": "质询环节对方反复追打判准为何成立，你始终未正面回应", "tip": "下轮申论先给出判准成立的论证，再谈具体数据" },
    { "point": "自由辩阶段你太快接受对方类比，险些落地", "tip": "听到类比先拆类比的适用边界再回应" }
  ]
}`

/** 构造实时对辩「结束并汇总」的 user prompt */
function buildLiveFinalizeUserPrompt(p: {
  topic: string
  side: 'aff' | 'neg'
  speech: string
  rounds: LiveDebateRound[]
  context?: string
  scope?: SparringStageScope
}): string {
  const sideLabel = p.side === 'aff' ? '正方' : '反方'
  const hasContext = typeof p.context === 'string' && p.context.trim() !== ''
  const lines = [
    `【辩题】${p.topic}`,
    `【你是方】${sideLabel}（${p.side}）`
  ]
  if (p.scope && p.scope !== 'full') {
    lines.push(`【环节范围】本次对辩限定在「${LIVE_PHASE_NAMES[p.scope] ?? p.scope}」环节内进行。`)
  }
  if (p.speech.trim() !== '') {
    lines.push(`【你的整份立论/稿子】`, p.speech)
  }
  if (hasContext) {
    lines.push('【整稿/整场上下文】', p.context as string)
  }
  if (p.rounds.length > 0) {
    lines.push('【本次实时对辩的完整轮次】', formatLiveRounds(p.rounds))
  }
  lines.push(
    '【你的任务】',
    '实时对辩到此结束。请以教练视角回顾这段对抗（含申论/质询/自由辩/总结各环节），输出成长向的对抗汇总：',
    '1) summary：整体对抗评价（40-80 字），指出最值得注意的得失；',
    '2) keyPoints：对抗要点列表（2-4 条），每条 point 指出"对方最有效的攻击切入点 / 你的典型失守点（含所属环节）"，tip 给出下次应对建议。',
    '严格输出 JSON（不要包含 markdown 代码块围栏），结构如下：',
    LIVE_FINALIZE_JSON_SAMPLE
  )
  return lines.join('\n')
}

/**
 * 解析并校验实时对辩「结束并汇总」的 JSON。
 * summary 缺失/为空抛错；keyPoints 逐项过滤非法项，允许为空数组。
 */
function parseLiveFinalize(raw: string): Pick<LiveDebateFinalizeResult, 'summary' | 'keyPoints'> {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as { summary?: unknown; keyPoints?: unknown }
  const summary = typeof obj.summary === 'string' && obj.summary.trim() !== '' ? obj.summary.trim() : ''
  if (summary === '') throw new Error('summary 缺失或为空')

  const keyPoints: Array<{ point: string; tip: string }> = []
  if (Array.isArray(obj.keyPoints)) {
    for (const item of obj.keyPoints) {
      if (!item || typeof item !== 'object') continue
      const k = item as { point?: unknown; tip?: unknown }
      const point = typeof k.point === 'string' && k.point.trim() !== '' ? k.point.trim() : ''
      const tip = typeof k.tip === 'string' && k.tip.trim() !== '' ? k.tip.trim() : ''
      if (point !== '' || tip !== '') keyPoints.push({ point, tip })
    }
  }
  return { summary, keyPoints }
}

/** 成功结果写评审历史（失败静默忽略，不打断工具返回）；role=sparring 由前端 toolName 推导 */
function writeHistory(
  judgeId: string,
  side: 'aff' | 'neg',
  topic: string,
  result: LiveDebateSuccess
): void {
  try {
    judgeHistoryRepo.create({
      judgeId,
      toolName: 'judge_live',
      side,
      topic,
      resultJson: result as unknown as Record<string, unknown>
    })
  } catch {
    // 忽略历史写入失败
  }
}

/**
 * judge_live 工具定义。
 *
 * 执行流程：
 *   1. 校验必填参数（topic / side）
 *   2. 取对手人设（未知 id 回落默认）
 *   3. 归一化已完成轮次 + 推导当前环节
 *   4. 判定模式：finalize=true → 结束并汇总；否则 → 本轮对手发言
 *   5. 调 llm-client.chat → 解析；任一失败 → { success:false, error }
 */
export const liveDebateTool: ToolDefinition<
  LiveDebateArgs,
  LiveDebateSuccess | LiveDebateFailure
> = {
  name: 'judge_live',
  description:
    '实时对辩（陪练子模式）：按 申论→质询→自由辩论→总结 四个环节近似实战的对辩练习。AI 按当前环节发表发言，用户以文本或语音回应后逐轮推进，结束时输出对抗要点汇总。备赛临场应变训练用。',
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
      speech: {
        type: 'string',
        description: '己方基础立论/稿子（可选，手动粘贴）'
      },
      judgeId: {
        type: 'string',
        enum: JUDGE_IDS,
        description: '对手人设 id（可选，默认 hu-jianbiao 胡渐彪）——以其思辩风格扮演对方'
      },
      difficulty: {
        type: 'string',
        enum: SPARRING_DIFFICULTIES,
        description: '对手难度（可选，默认 intermediate）：novice 新手 / intermediate 进阶 / national 国选手'
      },
      context: {
        type: 'string',
        description: '整稿/整场上下文（可选）：整份立论或整场转写文本。提供时对手会紧扣其中结构、判准与漏洞发言。'
      },
      phase: {
        type: 'string',
        enum: LIVE_PHASE_ORDER,
        description: '当前环节（可选）：constructive 申论 / crossfire 质询 / free 自由辩论 / summary 总结。缺省由历史尾部推导。'
      },
      history: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            phase: { type: 'string', enum: LIVE_PHASE_ORDER, description: '本轮环节' },
            opponent: { type: 'string', description: '对方本轮发言' },
            userReply: { type: 'string', description: '用户本轮回应' }
          },
          required: ['opponent', 'userReply']
        },
        description: '已完成的实时对辩轮次（可选，"下一轮"续接时传入）'
      },
      finalize: {
        type: 'boolean',
        description: '置 true 表示结束实时对辩并输出对抗要点汇总（可选）'
      },
      scope: {
        type: 'string',
        enum: SPARRING_JUDGE_SCOPES,
        description: '环节范围（可选）：full 全程（缺省，按 phase 推进）或 具体环节（constructive 申论 / crossfire 质询 / free 自由辩论 / summary 总结）——指定时锁定该环节持续训练'
      }
    },
    required: ['topic', 'side']
  },
  riskLevel: 'low',
  async execute(
    args: LiveDebateArgs,
    ctx?: { config?: LLMConfig; signal?: AbortSignal }
  ): Promise<LiveDebateSuccess | LiveDebateFailure> {
    // 1. 校验必填参数
    const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
    const side = args.side === 'neg' ? 'neg' : 'aff'
    if (topic === '') {
      return { success: false, error: '参数缺失：topic 必填' }
    }
    const difficulty: SparringDifficulty = SPARRING_DIFFICULTIES.includes(args.difficulty as SparringDifficulty)
      ? (args.difficulty as SparringDifficulty)
      : 'intermediate'

    // 2. 取对手人设
    const judge = getJudgeById(args.judgeId) ?? getJudgeById('hu-jianbiao')
    if (!judge) {
      return { success: false, error: '评委人设数据缺失' }
    }

    // 3. 归一化轮次 + 推导当前环节
    const rounds = normalizeLiveRounds(args.history)
    const scope: SparringStageScope = (SPARRING_JUDGE_SCOPES as string[]).includes(
      args.scope as string
    )
      ? (args.scope as SparringStageScope)
      : 'full'
    const phase = derivePhase(args.phase, rounds, scope)
    const context = typeof args.context === 'string' ? args.context.trim() : ''
    const speech = typeof args.speech === 'string' ? args.speech.trim() : ''

    // 4. 判定模式
    if (args.finalize === true) {
      return runLiveFinalize({ judge, topic, side, speech, difficulty, rounds, context, scope }, ctx)
    }
    return runLiveTurn({ judge, topic, side, speech, difficulty, phase, rounds, context, scope }, ctx)
  }
}

/** 实时对辩「换轮」：LLM 输出本方本环节发言 */
async function runLiveTurn(
  p: {
    judge: JudgeProfile
    topic: string
    side: 'aff' | 'neg'
    speech: string
    difficulty: SparringDifficulty
    phase: LiveDebatePhase
    rounds: LiveDebateRound[]
    context?: string
    scope?: SparringStageScope
  },
  ctx?: { config?: LLMConfig; signal?: AbortSignal }
): Promise<LiveDebateTurnResult | LiveDebateFailure> {
  const config = ctx?.config
  if (!config) {
    return { success: false, error: '缺少 LLM 配置（请先在设置中配置 AI 助手）' }
  }
  const systemPrompt = buildLiveDebatePrompt({
    profile: p.judge,
    difficulty: p.difficulty,
    side: p.side,
    phase: p.phase,
    debateTopic: p.topic,
    context: p.context,
    scope: p.scope
  })
  const userPrompt = buildLiveTurnUserPrompt({
    topic: p.topic,
    side: p.side,
    speech: p.speech,
    phase: p.phase,
    rounds: p.rounds,
    context: p.context,
    scope: p.scope
  })

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
    return {
      success: false,
      error: err instanceof LLMError ? `LLM 调用失败（${err.code}）：${err.message}` : err instanceof Error ? err.message : String(err)
    }
  }
  const speechText = content && content.trim() !== '' ? content.trim() : ''
  if (speechText === '') {
    return { success: false, error: '实时对辩对手返回内容为空' }
  }
  const result: LiveDebateTurnResult = {
    success: true,
    mode: 'live_turn',
    role: 'opponent',
    phase: p.phase,
    speech: speechText,
    // nextRounds：本轮对手发言本轮即基准；用户回应由前端补齐后再续接
    nextRounds: p.rounds,
    judgeId: p.judge.id,
    judgeName: getJudgeAnonLabel(p.judge.id),
    topic: p.topic,
    side: p.side,
    difficulty: p.difficulty,
    roundIndex: p.rounds.length + 1
  }
  writeHistory(p.judge.id, p.side, p.topic, result)
  return result
}

/** 实时对辩「结束并汇总」：LLM 输出对抗要点 JSON */
async function runLiveFinalize(
  p: {
    judge: JudgeProfile
    topic: string
    side: 'aff' | 'neg'
    speech: string
    difficulty: SparringDifficulty
    rounds: LiveDebateRound[]
    context?: string
    scope?: SparringStageScope
  },
  ctx?: { config?: LLMConfig; signal?: AbortSignal }
): Promise<LiveDebateFinalizeResult | LiveDebateFailure> {
  const config = ctx?.config
  if (!config) {
    return { success: false, error: '缺少 LLM 配置（请先在设置中配置 AI 助手）' }
  }
  const systemPrompt = buildLiveDebatePrompt({
    profile: p.judge,
    difficulty: p.difficulty,
    side: p.side,
    phase: 'summary',
    debateTopic: p.topic,
    context: p.context,
    scope: p.scope
  })
  const userPrompt = buildLiveFinalizeUserPrompt({
    topic: p.topic,
    side: p.side,
    speech: p.speech,
    rounds: p.rounds,
    context: p.context,
    scope: p.scope
  })

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
    return {
      success: false,
      error: err instanceof LLMError ? `LLM 调用失败（${err.code}）：${err.message}` : err instanceof Error ? err.message : String(err)
    }
  }
  if (!content || content.trim() === '') {
    return { success: false, error: '实时对辩汇总结果为空' }
  }
  try {
    const parsed = parseLiveFinalize(content)
    const result: LiveDebateFinalizeResult = {
      success: true,
      mode: 'live_finalize',
      role: 'opponent',
      phase: 'summary',
      judgeId: p.judge.id,
      judgeName: getJudgeAnonLabel(p.judge.id),
      topic: p.topic,
      side: p.side,
      difficulty: p.difficulty,
      roundsPlayed: p.rounds.length,
      ...parsed
    }
    writeHistory(p.judge.id, p.side, p.topic, result)
    return result
  } catch (e) {
    return {
      success: false,
      error: `实时对辩汇总输出格式异常：${e instanceof Error ? e.message : String(e)}`
    }
  }
}