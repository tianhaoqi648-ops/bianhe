// ============================================================
// simulate-opponent.tool.ts — Agent 工具：模拟对方攻击（AI 裁判演进 批2 2026-08-18）
//
// 备赛刚需场景：辩手只有己方稿子，需要 AI 以评委的思维站在对方立场，
// 设计攻击（质询问题 / 驳论论点 / 自由辩突袭），检验己方立论漏洞并给出防守建议。
//
// 人设复用：以 {judge.name} 的思维模拟对方攻击——
//   攻防流 → 拆逻辑链、价值流 → 追问价值前提、学理流 → 追问概念前提，
// 天然覆盖 fact（事实）/ theory（理论）/ value（价值）三层。
//
// 三种攻击方式（attackMode）：
//   - cross_exam（默认）：逼问式质询/盘问问题串
//   - rebuttal：结构化反驳论点（拆立论）
//   - free_debate：自由辩短促突袭问题串（一句一题）
//
// 风险等级 low：只读，不修改数据库。
// ============================================================

import type { ToolDefinition } from '@shared/agent-types'
import type { LLMConfig } from '@shared/agent-types'
import { JUDGE_IDS, getJudgeAnonLabel, getJudgeById, type JudgeProfile, type SparringDifficulty } from '@shared/ai-judges'
import { chat, LLMError } from '../llm-client'
import { judgeHistoryRepo } from '../../db/repository/judge-history.repo'
import {
  buildJudgeSystemPrompt,
  buildSparringPrompt,
  parseJsonResult,
  LIVE_PHASE_NAMES,
  type LiveDebatePhase,
  type SparringStageScope
} from './judge-common'

/** 攻击方式 */
export type AttackMode = 'cross_exam' | 'rebuttal' | 'free_debate'

/** 攻击点层次 */
export type AttackLayer = 'fact' | 'theory' | 'value'

/** 陪练难度白名单（默认 intermediate 进阶） */
const SPARRING_DIFFICULTIES: SparringDifficulty[] = ['novice', 'intermediate', 'national']

/** 陪练一个已完成轮次（对方攻击 + 用户答辩） */
export interface SparringRound {
  /** 对方（陪练对手）本轮攻击 */
  opponent: string
  /** 用户（对方辩友）本轮答辩 */
  userReply: string
}

/** simulate_opponent 工具入参 */
export interface SimulateOpponentArgs {
  /** 辩题（必填） */
  topic: string
  /** 己方立场（必填） */
  side: 'aff' | 'neg'
  /** 己方稿子（必填，手动粘贴） */
  speech: string
  /** 可选整稿 / 整场上下文（整份立论或整场转写文本）；提供时对手据此发起针对性攻击 */
  context?: string
  /** 评委人设 id（可选，默认 hu-jianbiao）——以其思维模拟对方攻击 */
  judgeId?: string
  /** 攻击方式（可选，默认 cross_exam 质询盘问；仅单发模式使用） */
  attackMode?: AttackMode
  /** 赛制提示（可选） */
  formatHint?: string
  // ---- 回合制陪练（2026-08-23）：提供 difficulty 或 history 时进入回合制 ----
  /** 对手难度（可选：novice 新手 / intermediate 进阶 / national 国选手） */
  difficulty?: SparringDifficulty
  /** 已完成的对抗轮次（可选，回合制续接时传入） */
  history?: SparringRound[]
  /** 置 true 表示结束陪练并输出对抗汇总（可选） */
  finalize?: boolean
  /** 环节范围（可选，回合制通用）：'full' 全程（缺省）或 具体环节（constructive/crossfire/free/summary）——指定时对手只在该环节内应对 */
  scope?: SparringStageScope
}

/** 单个攻击点 */
export interface AttackPoint {
  /** 层次：事实 / 理论 / 价值 */
  layer: AttackLayer
  /** 攻击内容（质询问句 / 反驳论点 / 突袭问题） */
  point: string
  /** 针对己方稿中哪部分（如"第一论点""判准"） */
  target: string
  /** 建议如何防守 */
  defenseHint: string
}

/** simulate_opponent 工具返回值（成功态） */
export interface SimulateOpponentResult {
  success: true
  judgeId: string
  judgeName: string
  topic: string
  side: 'aff' | 'neg'
  attackMode: AttackMode
  /** 总体弱点总结 */
  weaknessSummary: string
  /** 攻击点列表（按层次分组） */
  attackPoints: AttackPoint[]
}

/** simulate_opponent 工具返回值（失败态） */
export interface SimulateOpponentFailure {
  success: false
  error: string
}

/** 回合制陪练：一轮对方攻击结果（成功态） */
export interface SparringTurnResult {
  success: true
  mode: 'sparring_turn'
  judgeId: string
  judgeName: string
  topic: string
  side: 'aff' | 'neg'
  difficulty: SparringDifficulty
  /** 本轮序号（1 基） */
  roundIndex: number
  /** 本轮对方攻击：用户需要在答辩框作答 */
  opponentAttack: string
}

/** 回合制陪练：结束并汇总结果（对抗要点，成长向） */
export interface SparringFinalizeResult {
  success: true
  mode: 'sparring_finalize'
  judgeId: string
  judgeName: string
  topic: string
  side: 'aff' | 'neg'
  difficulty: SparringDifficulty
  /** 已完成的对抗轮次数量 */
  roundsPlayed: number
  /** 整体对抗评价（成长向，40-80 字） */
  summary: string
  /** 对抗要点（对方最有效攻击 / 对应建议） */
  keyPoints: Array<{ point: string; tip: string }>
}

/** 工具成功态返回（单发 + 回合制两种形态） */
export type SimulateOpponentSuccess =
  | SimulateOpponentResult
  | SparringTurnResult
  | SparringFinalizeResult

/** 攻击方式白名单 */
const ATTACK_MODES: AttackMode[] = ['cross_exam', 'rebuttal', 'free_debate']

/** 陪练环节范围白名单（全程 + 实时对辩四环节） */
const SPARRING_SCOPES: SparringStageScope[] = ['full', 'constructive', 'crossfire', 'free', 'summary']
/** 具体实时对辩环节 */
const LIVE_PHASE_VALUES: LiveDebatePhase[] = ['constructive', 'crossfire', 'free', 'summary']

/** 攻击方式说明（注入 prompt） */
const ATTACK_MODE_HINTS: Record<AttackMode, string> = {
  cross_exam:
    '质询/盘问方式：设计逼问式质询问题串（连环追问、可答性陷阱），每一问都要让对方难以回避；问题要击中己方稿子的具体漏洞。',
  rebuttal:
    '驳论方式：设计结构化的反驳论点（拆立论），每个攻击点是"论点 + 理由 + 落脚"的完整反驳，直接针对己方立论框架的薄弱处。',
  free_debate:
    '自由辩突袭方式：设计短促的突袭问题串，一句一题、快速连发，专挑己方稿子里来不及展开的概念与口径。'
}

/** 期望 LLM 输出的 JSON 结构样例 */
const JSON_SAMPLE = `{
  "weaknessSummary": "这份立论最大的弱点是判准未经论证，第二论点缺乏事实支撑。",
  "attackPoints": [
    {
      "layer": "theory",
      "point": "请问对方辩友，您的判准'……'为什么成立？如果按这个判准，对方的立场是否也能推出同样的结论？",
      "target": "第一段判准",
      "defenseHint": "提前补充判准成立的论证：判准须能区分正反两方，且与辩题核心冲突对应。"
    },
    {
      "layer": "fact",
      "point": "第二论点引用的数据来源是什么？样本是否具有代表性？",
      "target": "第二论点论据",
      "defenseHint": "补充数据出处与适用边界，预留'数据为佐证而非唯一依据'的口径。"
    }
  ]
}`

/**
 * 解析并校验 LLM 返回的攻击设计 JSON。
 * 非法 layer 或空字段条目跳过；attackPoints 缺失/空抛错（由调用方转失败）。
 */
function parseSimulateResult(
  raw: string
): Omit<SimulateOpponentResult, 'success' | 'judgeId' | 'judgeName' | 'topic' | 'side' | 'attackMode'> {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as { weaknessSummary?: unknown; attackPoints?: unknown }

  if (!Array.isArray(obj.attackPoints) || obj.attackPoints.length === 0) {
    throw new Error('attackPoints 缺失或为空')
  }
  const attackPoints: AttackPoint[] = []
  for (const item of obj.attackPoints) {
    if (!item || typeof item !== 'object') continue
    const p = item as { layer?: unknown; point?: unknown; target?: unknown; defenseHint?: unknown }
    if (p.layer !== 'fact' && p.layer !== 'theory' && p.layer !== 'value') continue
    if (typeof p.point !== 'string' || p.point.trim() === '') continue
    attackPoints.push({
      layer: p.layer,
      point: p.point.trim(),
      target: typeof p.target === 'string' && p.target.trim() !== '' ? p.target.trim() : '',
      defenseHint:
        typeof p.defenseHint === 'string' && p.defenseHint.trim() !== ''
          ? p.defenseHint.trim()
          : ''
    })
  }
  if (attackPoints.length === 0) {
    throw new Error('attackPoints 无有效条目')
  }

  const weaknessSummary =
    typeof obj.weaknessSummary === 'string' && obj.weaknessSummary.trim() !== ''
      ? obj.weaknessSummary.trim()
      : ''

  return { weaknessSummary, attackPoints }
}

// ============================================================
// 回合制陪练（2026-08-23）：多轮「对方攻击 → 用户答辩」
// ============================================================

/** 归一化陪练历史轮次（过滤空字段，返回干净数组） */
function normalizeSparringRounds(history: SparringRound[] | undefined): SparringRound[] {
  if (!Array.isArray(history)) return []
  const rounds: SparringRound[] = []
  for (const r of history) {
    if (!r || typeof r !== 'object') continue
    const opponent = typeof r.opponent === 'string' ? r.opponent.trim() : ''
    const userReply = typeof r.userReply === 'string' ? r.userReply.trim() : ''
    if (opponent === '' && userReply === '') continue
    rounds.push({ opponent, userReply })
  }
  return rounds
}

/** 把已完成的对抗轮次格式化为连续性文本（第 N 轮：对方攻击 / 你的答辩） */
function formatSparringRounds(rounds: SparringRound[]): string {
  return rounds
    .map((r, i) => {
      const lines = [`第 ${i + 1} 轮`]
      if (r.opponent !== '') lines.push(`对方攻击：${r.opponent}`)
      if (r.userReply !== '') lines.push(`你的答辩：${r.userReply}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** 构造回合制「发起/下一轮」的 user prompt（输出纯文本攻击，非 JSON） */
function buildSparringTurnUserPrompt(p: {
  topic: string
  side: 'aff' | 'neg'
  speech: string
  rounds: SparringRound[]
  context?: string
  stage?: LiveDebatePhase
}): string {
  const sideLabel = p.side === 'aff' ? '正方' : '反方'
  const hasContext = typeof p.context === 'string' && p.context.trim() !== ''
  const stageLine =
    p.stage && LIVE_PHASE_NAMES[p.stage]
      ? `【环节范围】本次陪练限定在「${LIVE_PHASE_NAMES[p.stage]}」环节内进行，请收束在这一环节的节奏与语境里发起攻击（质询=连问你答、自由辩=快速攻防…），不要跳到其他环节。`
      : ''
  const lines = [
    `【辩题】${p.topic}`,
    `【你是方】${sideLabel}（${p.side}）`,
    `【你的整份立论/稿子】`,
    p.speech,
    ''
  ]
  if (stageLine !== '') lines.push(stageLine)
  if (hasContext) {
    lines.push('【整稿/整场上下文】（发起攻击前请重点参考，紧扣其中的结构、判准与漏洞）', p.context as string, '')
  }
  if (p.rounds.length > 0) {
    lines.push(
      '【已进行的对抗轮次】',
      formatSparringRounds(p.rounds),
      '',
      '【你刚完成的答辩】',
      p.rounds[p.rounds.length - 1].userReply || '（本轮无明显答辩）',
      ''
    )
  }
  lines.push(
    '【你的任务】',
    '作为陪练对手，针对对方辩友最新答辩暴露的漏洞，并结合其整份立论中尚未被攻破的薄弱处，发起新一轮有实质力的攻击（质询、反驳或设问）。',
    '只输出这一轮的对手攻击文本本身（200 字以内），不要输出解释、不要输出 JSON。'
  )
  return lines.join('\n')
}

/** 回合制「结束并汇总」的 JSON 样例 */
const SPARRING_FINALIZE_JSON_SAMPLE = `{
  "summary": "整体而言，你在判准回应上多次失守……（成长向总结，40-80 字）",
  "keyPoints": [
    { "point": "对方反复追打判准为何成立，你始终未正面回应", "tip": "下轮先给出判准成立的论证，再谈具体数据" },
    { "point": "第二论点论据被归谬，但你及时用边界条件化解", "tip": "继续保持，可在开场就预设数据适用边界" }
  ]
}`

/** 构造回合制「结束并汇总」的 user prompt */
function buildSparringFinalizeUserPrompt(p: {
  topic: string
  side: 'aff' | 'neg'
  speech: string
  rounds: SparringRound[]
  context?: string
  stage?: LiveDebatePhase
}): string {
  const sideLabel = p.side === 'aff' ? '正方' : '反方'
  const hasContext = typeof p.context === 'string' && p.context.trim() !== ''
  const lines = [
    `【辩题】${p.topic}`,
    `【你是方】${sideLabel}（${p.side}）`,
    `【你的整份立论/稿子】`,
    p.speech,
    ''
  ]
  if (p.stage && LIVE_PHASE_NAMES[p.stage]) {
    lines.push(`【环节范围】本次陪练限定在「${LIVE_PHASE_NAMES[p.stage]}」环节内进行。`)
  }
  if (hasContext) {
    lines.push('【整稿/整场上下文】', p.context as string, '')
  }
  if (p.rounds.length > 0) {
    lines.push('【本次陪练的完整对抗轮次】', formatSparringRounds(p.rounds), '')
  }
  lines.push(
    '【你的任务】',
    '陪练到此结束。请以教练视角回顾这段对抗，输出成长向的对抗汇总：',
    '1) summary：整体对抗评价（40-80 字），指出最值得注意的得失；',
    '2) keyPoints：对抗要点列表（2-4 条），每条 point 指出"对方最有效的攻击切入点/你的典型失守点"，tip 给出下次应对建议。',
    '严格输出 JSON（不要包含 markdown 代码块围栏），结构如下：',
    SPARRING_FINALIZE_JSON_SAMPLE
  )
  return lines.join('\n')
}

/**
 * 解析并校验回合制「结束并汇总」的 JSON。
 * summary 缺失/为空抛错；keyPoints 逐项过滤非法项，允许为空数组。
 */
function parseSparringFinalize(
  raw: string
): Pick<SparringFinalizeResult, 'summary' | 'keyPoints'> {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as { summary?: unknown; keyPoints?: unknown }
  const summary = typeof obj.summary === 'string' && obj.summary.trim() !== ''
    ? obj.summary.trim()
    : ''
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

/**
 * simulate_opponent 工具定义。
 *
 * 执行流程（与 judge_speech 同构）：
 *   1. 校验必填参数（topic / side / speech）与 attackMode 枚举
 *   2. 取评委人设（未知 id 回落默认）
 *   3. 构造 prompt：system=评委人设 + "以评委思维站在对方立场" 指令；user=辩题+立场+攻击方式+己方稿+JSON 样例
 *   4. 调 llm-client.chat → 解析攻击点
 *   5. 任一失败 → { success:false, error }
 */
export const simulateOpponentTool: ToolDefinition<
  SimulateOpponentArgs,
  SimulateOpponentSuccess | SimulateOpponentFailure
> = {
  name: 'simulate_opponent',
  description:
    '陪练对手 / 模拟对方攻击：既可单发生成针对己方立论的攻击点（质询/驳论/突袭），也支持回合制陪练对练（多轮对方攻击→用户答辩，结束时汇总对抗要点）。备赛防守演练用。',
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
        description: '己方稿子全文（必填，手动粘贴）'
      },
      judgeId: {
        type: 'string',
        enum: JUDGE_IDS,
        description: '对手人设 id（可选，默认 hu-jianbiao 胡渐彪）——以其思辩风格扮演对方'
      },
      attackMode: {
        type: 'string',
        enum: ATTACK_MODES,
        description: '攻击方式（可选，默认 cross_exam，仅单发模式使用）：cross_exam 质询盘问 / rebuttal 驳论攻击 / free_debate 自由辩突袭'
      },
      formatHint: {
        type: 'string',
        description: '赛制提示（可选）'
      },
      context: {
        type: 'string',
        description: '整稿/整场上下文（可选，回合制通用）：整份立论或整场转写文本。提供时对手会紧扣这份上下文的立论结构与漏洞发起针对性攻击。'
      },
      difficulty: {
        type: 'string',
        enum: SPARRING_DIFFICULTIES,
        description: '对手难度（可选，回合制专用）：novice 新手 / intermediate 进阶 / national 国选手'
      },
      history: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            opponent: { type: 'string', description: '对方本轮攻击' },
            userReply: { type: 'string', description: '用户本轮答辩' }
          },
          required: ['opponent', 'userReply']
        },
        description: '已完成的对抗轮次（可选，回合制「下一轮」续接时传入）'
      },
      finalize: {
        type: 'boolean',
        description: '置 true 表示结束陪练并输出对抗汇总（可选，回合制专用）'
      },
      scope: {
        type: 'string',
        enum: SPARRING_SCOPES,
        description: '环节范围（可选，回合制通用）：full 全程（缺省）或 specific 环节（constructive 申论 / crossfire 质询 / free 自由辩论 / summary 总结）——指定时对手只在该环节内应对'
      }
    },
    required: ['topic', 'side', 'speech']
  },
  riskLevel: 'low',
  async execute(
    args: SimulateOpponentArgs,
    ctx?: { config?: LLMConfig; signal?: AbortSignal }
  ): Promise<SimulateOpponentSuccess | SimulateOpponentFailure> {
    // 1. 校验必填参数
    const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
    const speech = typeof args.speech === 'string' ? args.speech.trim() : ''
    const side = args.side === 'neg' ? 'neg' : 'aff'
    if (topic === '' || speech === '') {
      return { success: false, error: '参数缺失：topic / speech 必填' }
    }
    if (args.attackMode !== undefined && !ATTACK_MODES.includes(args.attackMode as AttackMode)) {
      return { success: false, error: '参数非法：attackMode 必须为 cross_exam / rebuttal / free_debate 之一' }
    }
    const difficulty: SparringDifficulty = SPARRING_DIFFICULTIES.includes(args.difficulty as SparringDifficulty)
      ? (args.difficulty as SparringDifficulty)
      : 'intermediate'

    // 2. 取对手人设
    const judge = getJudgeById(args.judgeId) ?? getJudgeById('hu-jianbiao')
    if (!judge) {
      return { success: false, error: '评委人设数据缺失' }
    }

    // 3. 归一化陪练历史
    const rounds = normalizeSparringRounds(args.history)
    const context = typeof args.context === 'string' ? args.context.trim() : ''
    // 3.1 环节范围：'full'（缺省）或 具体环节，非法回退 'full'
    const scope: SparringStageScope = SPARRING_SCOPES.includes(args.scope as SparringStageScope)
      ? (args.scope as SparringStageScope)
      : 'full'
    const scopeStage: LiveDebatePhase | undefined =
      scope !== 'full' && LIVE_PHASE_VALUES.includes(scope as LiveDebatePhase)
        ? (scope as LiveDebatePhase)
        : undefined

    // 4. 判定模式：
    //   - finalize=true                          → 结束并汇总
    //   - 提供了 difficulty 或 history           → 回合制（发起/下一轮）
    //   - 否则                                   → 单发模式（向后兼容）
    const sparringMode =
      args.finalize === true || SPARRING_DIFFICULTIES.includes(args.difficulty as SparringDifficulty) || rounds.length > 0

    if (args.finalize === true) {
      return runSparringFinalize({ judge, topic, side, speech, difficulty, rounds, context, scopeStage }, ctx)
    }
    if (sparringMode) {
      return runSparringTurn({ judge, topic, side, speech, difficulty, rounds, context, scopeStage }, ctx)
    }

    // ---- 单发模式（原有逻辑，向后兼容）----
    const attackMode = ATTACK_MODES.includes(args.attackMode as AttackMode)
      ? (args.attackMode as AttackMode)
      : 'cross_exam'
    const sideLabel = side === 'aff' ? '正方' : '反方'
    const systemPrompt = buildJudgeSystemPrompt(
      judge,
      [
        `现在请以${judge.name}的思维，站在对方立场，攻击${sideLabel}的这份稿子。`,
        '你不仅是设计攻击，还要像这位评委一样判断：什么才是这份立论真正的软肋，对方会从哪里下刀。',
        '攻击方式说明：',
        ATTACK_MODE_HINTS[attackMode],
        '最后请给出一句话的总体弱点总结，以及每个攻击点对应的防守建议。'
      ].join('\n')
    )

    const formatLine =
      typeof args.formatHint === 'string' && args.formatHint.trim() !== ''
        ? `\n赛制参考：${args.formatHint.trim()}`
        : ''
    const userPrompt = [
      `【辩题】${topic}${formatLine}`,
      `【${sideLabel}（己方）稿子】`,
      speech,
      '',
      '【输出要求】',
      '请给出：1) weaknessSummary：总体弱点总结（30-60 字）；',
      '2) attackPoints：攻击点列表（3-6 条），每条含 layer（fact 事实 / theory 理论 / value 价值）、',
      'point（攻击内容，按上述攻击方式组织）、target（针对稿中哪部分）、defenseHint（建议如何防守）。',
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
      return { success: false, error: '模拟结果为空' }
    }

    try {
      const parsed = parseSimulateResult(content)
      const result: SimulateOpponentResult = {
        success: true,
        judgeId: judge.id,
        judgeName: getJudgeAnonLabel(judge.id),
        topic,
        side,
        attackMode,
        ...parsed
      }
      writeHistory(judge.id, side, topic, result)
      return result
    } catch (e) {
      return {
        success: false,
        error: `模拟输出格式异常：${e instanceof Error ? e.message : String(e)}`
      }
    }
  }
}

/** 回合制「发起/下一轮」：构造 prompt → LLM 输出本轮攻击文本 */
async function runSparringTurn(
  p: {
    judge: JudgeProfile
    topic: string
    side: 'aff' | 'neg'
    speech: string
    difficulty: SparringDifficulty
    rounds: SparringRound[]
    context?: string
    scopeStage?: LiveDebatePhase
  },
  ctx?: { config?: LLMConfig; signal?: AbortSignal }
): Promise<SparringTurnResult | SimulateOpponentFailure> {
  const config = ctx?.config
  if (!config) {
    return { success: false, error: '缺少 LLM 配置（请先在设置中配置 AI 助手）' }
  }
  const systemPrompt = buildSparringPrompt({
    profile: p.judge,
    difficulty: p.difficulty,
    side: p.side,
    debateTopic: p.topic,
    context: p.context,
    stage: p.scopeStage
  })
  const userPrompt = buildSparringTurnUserPrompt({
    topic: p.topic,
    side: p.side,
    speech: p.speech,
    rounds: p.rounds,
    context: p.context,
    stage: p.scopeStage
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
      error:
        err instanceof LLMError ? `LLM 调用失败（${err.code}）：${err.message}` : err instanceof Error ? err.message : String(err)
    }
  }
  const attack = content && content.trim() !== '' ? content.trim() : ''
  if (attack === '') {
    return { success: false, error: '陪练对手返回内容为空' }
  }
  const result: SparringTurnResult = {
    success: true,
    mode: 'sparring_turn',
    judgeId: p.judge.id,
    judgeName: getJudgeAnonLabel(p.judge.id),
    topic: p.topic,
    side: p.side,
    difficulty: p.difficulty,
    roundIndex: p.rounds.length + 1,
    opponentAttack: attack
  }
  writeHistory(p.judge.id, p.side, p.topic, result)
  return result
}

/** 回合制「结束并汇总」：LLM 输出对抗要点 JSON */
async function runSparringFinalize(
  p: {
    judge: JudgeProfile
    topic: string
    side: 'aff' | 'neg'
    speech: string
    difficulty: SparringDifficulty
    rounds: SparringRound[]
    context?: string
    scopeStage?: LiveDebatePhase
  },
  ctx?: { config?: LLMConfig; signal?: AbortSignal }
): Promise<SparringFinalizeResult | SimulateOpponentFailure> {
  const config = ctx?.config
  if (!config) {
    return { success: false, error: '缺少 LLM 配置（请先在设置中配置 AI 助手）' }
  }
  const systemPrompt = buildJudgeSystemPrompt(
    p.judge,
    [
      `你是一位注重实战提升的辩论教练（保留「${getJudgeAnonLabel(p.judge.id)}」的点评风格）。`,
      '现在陪练对抗已经结束，请你回顾全程，给对方辩友一份成长向的对抗汇总。'
    ].join('\n')
  )
  const userPrompt = buildSparringFinalizeUserPrompt({
    topic: p.topic,
    side: p.side,
    speech: p.speech,
    rounds: p.rounds,
    context: p.context,
    stage: p.scopeStage
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
      error:
        err instanceof LLMError ? `LLM 调用失败（${err.code}）：${err.message}` : err instanceof Error ? err.message : String(err)
    }
  }
  if (!content || content.trim() === '') {
    return { success: false, error: '陪练汇总结果为空' }
  }
  try {
    const parsed = parseSparringFinalize(content)
    const result: SparringFinalizeResult = {
      success: true,
      mode: 'sparring_finalize',
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
      error: `陪练汇总输出格式异常：${e instanceof Error ? e.message : String(e)}`
    }
  }
}

/** 成功结果写评审历史（失败静默忽略，不打断工具返回） */
function writeHistory(
  judgeId: string,
  side: 'aff' | 'neg',
  topic: string,
  result: SimulateOpponentSuccess
): void {
  try {
    judgeHistoryRepo.create({
      judgeId,
      toolName: 'simulate_opponent',
      side,
      topic,
      resultJson: result as unknown as Record<string, unknown>
    })
  } catch {
    // 忽略历史写入失败
  }
}
