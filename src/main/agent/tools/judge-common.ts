// ============================================================
// judge-common.ts — AI 裁判工具公共模块（AI 裁判功能演进 2026-08-18）
//
// 从 judge-debate.tool.ts 提取的共享能力，供 judge_debate / judge_speech /
// simulate_opponent 等工具复用：
//   1. buildJudgeSystemPrompt：按评委人设构建 system prompt
//   2. parseJsonResult：容错解析 LLM 返回的 JSON（去 ```json 围栏、取首个 {} 块）
// ============================================================

import {
  FIVE_DIMENSIONS,
  getJudgeAnonLabel,
  type JudgeProfile,
  type SparringDifficulty
} from '@shared/ai-judges'
import { getStageDefinition, mapStageNameToType, type DebateStageType } from '@shared/debate-stages'

/**
 * 按评委人设构建 system prompt。
 *
 * 人设头衔一律用纯风格原型标签（攻防流/价值流/…），不露真人姓名（T1：匿名化展示）。
 *
 * @param judge 评委人设（ai-judges.ts）
 * @param taskInstruction 当前任务的指令（如"评审一场辩论"/"设计质询问题"），追加在末尾
 * @returns system prompt 文本
 */
export function buildJudgeSystemPrompt(judge: JudgeProfile, taskInstruction: string): string {
  return [
    `你是${getJudgeAnonLabel(judge.id)}——一位华语辩论领域风格鲜明的匿名评委（${judge.category}评审原型）。`,
    `【背景】${judge.bio}`,
    `【你的辩风】${judge.styleTraits.map((t) => `- ${t}`).join('\n')}`,
    `【你的评审倾向】最看重：${judge.judgePriorities.top}；次看重：${judge.judgePriorities.secondary}；可能忽略：${judge.judgePriorities.ignored}`,
    `【你的标志性表达】${judge.signaturePhrases.map((p) => `"${p}"`).join(' ')}`,
    `【你的点评风格】${judge.reviewStyle}`,
    '',
    taskInstruction
  ].join('\n')
}

/** buildSparringPrompt 入参 */
export interface BuildSparringPromptParams {
  /** 陪练对手人设（复用 JudgeProfile，充当对方辩手） */
  profile: JudgeProfile
  /** 对手难度：新手 / 进阶 / 国选手 */
  difficulty: SparringDifficulty
  /** 用户（对方）持方：aff 正方 / neg 反方——陪练对手扮另一立场 */
  side: 'aff' | 'neg'
  /** 辩题 */
  debateTopic: string
  /** 可选整稿 / 整场上下文（整份立论或整场转写文本），提供时提示对手据其发起针对性攻击 */
  context?: string
  /** 陪练环节范围（可选；仅在该环节内应对，如 crossfire 质询=连问你答，free 自由辩=快速攻防） */
  stage?: LiveDebatePhase
}

/** 陪练难度 → 对手人设说明（注入 system prompt） */
const SPARRING_DIFFICULTY_HINTS: Record<SparringDifficulty, string> = {
  novice:
    '你以一位略有辩龄的新辩手口吻发起攻击：从常识与直觉切入，提问直白、偶有破绽，让对方在对抗中学会识别与回应常见反驳。',
  intermediate:
    '你以一位训练有素的校队辩手口吻发起攻击：逻辑链完整、质询狠准，熟练运用拆解、归谬与类比，给对方适度的压力。',
  national:
    '你以一位国家级赛事辩手口吻发起攻击：攻防转换迅速、角度刁钻、步步紧逼，专挑立论最深处的前提与底层假设下手。'
}

/**
 * 构建「陪练对手」system prompt（回合制对练用，不复用 buildJudgeSystemPrompt 的判分口吻）。
 * 以 JudgeProfile 人设为骨架，叠加对手难度与对立立场，扮演陪练对手。
 */
export function buildSparringPrompt(params: BuildSparringPromptParams): string {
  const oppLabel = params.side === 'aff' ? '反方' : '正方'
  const hasContext = typeof params.context === 'string' && params.context.trim() !== ''
  const stageLine =
    params.stage && LIVE_PHASE_HINTS[params.stage]
      ? `本次陪练限定在「${LIVE_PHASE_NAMES[params.stage]}」环节内进行：${LIVE_PHASE_HINTS[params.stage]} 请把攻防都收束在这个环节的节奏与语境里，不要跳到其他环节。`
      : ''
  return buildJudgeSystemPrompt(
    params.profile,
    [
      `你正以「${getJudgeAnonLabel(params.profile.id)}」的思辩风格，作为对方的${oppLabel}陪练对手，与对方辩友（${params.side === 'aff' ? '正方' : '反方'}）进行回合制对抗练习。`,
      `本次辩题：${params.debateTopic}`,
      hasContext
        ? '你已获得对方的「整稿/整场上下文」：请务必通读这份完整内容，紧扣其中的立论结构、判准、论据与薄弱处，发起针对性攻击（专挑上下文里暴露的漏洞与前提）。'
        : '',
      stageLine,
      SPARRING_DIFFICULTY_HINTS[params.difficulty],
      '每一轮，你针对对方上一轮答辩暴露的漏洞（并结合其整份立论），发起新一轮有实质力的攻击（质询、反驳或设问）。',
      '保持陪练目的：攻击要有压迫感，也要有可拆解、可学习的价值，让对方在答辩中暴露并补齐漏洞。'
    ].filter((s) => s !== '').join('\n')
  )
}

/** buildCoachPrompt 入参 */
export interface BuildCoachPromptParams {
  /** 教练人设（复用 JudgeProfile，充当教练） */
  profile: JudgeProfile
  /** 辩题（可选） */
  debateTopic?: string
}

/**
 * 构建「教练复盘」system prompt（成长向诊断，非判分）。
 * 定位：帮助对方辩友把稿子练得更强——不判分、不排名，聚焦短板、可练方向与示范改写。
 */
export function buildCoachPrompt(params: BuildCoachPromptParams): string {
  return buildJudgeSystemPrompt(
    params.profile,
    [
      '你此刻的定位是一位「反思教练」（而不是打分的评委）：你的任务是帮助对方辩友把这份稿子练得更好。',
      params.debateTopic && params.debateTopic.trim() !== ''
        ? `本次辩题：${params.debateTopic.trim()}`
        : '',
      '请聚焦成长：指出这份稿子在立论、反驳、表达、攻防四个维度上的短板，给出一条可执行的训练方向，并提供一段示范性改写让对参照。',
      '不判分、不排名，重在启发与可操作的建议，口吻温和而具体。'
    ]
      .filter((s) => s !== '')
      .join('\n')
  )
}

// ============================================================
// 实时对辩（judge_live）专属：分环节 prompt（Task 4）
// 环节序列：申论(constructive) → 质询(crossfire) → 自由辩论(free) → 总结(summary)
// ============================================================

/** 实时对辩环节类型 */
export type LiveDebatePhase = 'constructive' | 'crossfire' | 'free' | 'summary'

/** 陪练/对辩环节范围：'full' 全程 或 具体实时对辩环节（申论/质询/自由辩/总结）；指定环节时对手只在该环节内应对 */
export type SparringStageScope = 'full' | LiveDebatePhase

/** 实时对辩环节顺序（用于缺省推进） */
export const LIVE_PHASE_ORDER: LiveDebatePhase[] = ['constructive', 'crossfire', 'free', 'summary']

/** 下一环节；已是最后一个则回到总结（收敛） */
export function nextLivePhase(phase: LiveDebatePhase): LiveDebatePhase {
  const idx = LIVE_PHASE_ORDER.indexOf(phase)
  if (idx < 0 || idx >= LIVE_PHASE_ORDER.length - 1) return 'summary'
  return LIVE_PHASE_ORDER[idx + 1]
}

/** 环节 → 展示名 */
export const LIVE_PHASE_NAMES: Record<LiveDebatePhase, string> = {
  constructive: '申论',
  crossfire: '质询',
  free: '自由辩论',
  summary: '总结'
}

/** buildLiveDebatePrompt 入参 */
export interface BuildLiveDebatePromptParams {
  /** 陪练对手人设（复用 JudgeProfile，充当实时对辩对手） */
  profile: JudgeProfile
  /** 对手难度 */
  difficulty: SparringDifficulty
  /** 用户持方：aff 正方 / neg 反方——对手扮另一立场（对方） */
  side: 'aff' | 'neg'
  /** 当前环节 */
  phase: LiveDebatePhase
  /** 辩题 */
  debateTopic: string
  /** 可选整稿 / 整场上下文（整份立论或整场转写文本） */
  context?: string
  /** 环节范围（可选）：'full' 全程（缺省，按 phase 推进）或 具体环节——指定时强制锁定该环节并注入对应语气 */
  scope?: SparringStageScope
}

/** 实时对辩各环节 → 对手发言风格 */
const LIVE_PHASE_HINTS: Record<LiveDebatePhase, string> = {
  constructive:
    '当前为「申论」环节，重点在立论展开：作为对方辩手，请完整、清楚地陈述己方立场，给出判准并展开核心论点，把己方框架立住（篇幅可稍长，逻辑给足）。',
  crossfire:
    '当前为「质询」环节，重点在连珠质问：短促而密集地抛出一串质询问题，每一问都直击对方立论的判准、前提与漏洞，迫使对方正面回应、难以回避。',
  free:
    '当前为「自由辩论」环节，重点在快速攻防：一句一驳、节奏紧凑，紧咬对方上一轮回应中的瑕疵与口径，快问快答、交锋密集（单条尽量短促）。',
  summary:
    '当前为「总结」环节，重点在收束：以这位评委的思辨视角回顾整场交锋，重申己方核心结论，点出对方始终未有效回应的要害，做一个有分量、可回味的收尾。'
}

/**
 * 构建「实时对辩」对手的 system prompt（Task 4.2）。
 * 以 JudgeProfile 人设为骨架，叠加对手难度、对立立场与当前环节的语气。
 */
export function buildLiveDebatePrompt(params: BuildLiveDebatePromptParams): string {
  const oppLabel = params.side === 'aff' ? '反方' : '正方'
  const hasContext = typeof params.context === 'string' && params.context.trim() !== ''
  // 指定环节范围时，锁定为具体环节（覆盖 phase），并在结尾补充"只在该环节内应对"
  const effPhase: LiveDebatePhase =
    params.scope && params.scope !== 'full' ? params.scope : params.phase
  const scopeLock =
    params.scope && params.scope !== 'full'
      ? `本次对辩限定在「${LIVE_PHASE_NAMES[params.scope]}」环节内进行，请持续以这一环节的节奏与语气应对，不要跳到其他环节。`
      : ''
  return buildJudgeSystemPrompt(
    params.profile,
    [
      `你正以「${getJudgeAnonLabel(params.profile.id)}」的思辩风格，作为对方的${oppLabel}陪练对手，与对方辩友（${params.side === 'aff' ? '正方' : '反方'}）进行实时对辩练习。`,
      `本次辩题：${params.debateTopic}`,
      hasContext
        ? '你已获得对方的「整稿/整场上下文」：请务必通读这份完整内容，紧扣其中的立论结构、判准、论据与薄弱处，发起针对性发言（专挑上下文里暴露的漏洞与前提）。'
        : '',
      SPARRING_DIFFICULTY_HINTS[params.difficulty],
      LIVE_PHASE_HINTS[effPhase],
      scopeLock,
      `当前环节：${LIVE_PHASE_NAMES[effPhase]}。请只针对对方辩友的最新一轮回应发表这一段（长度依环节自然而定，单次不要过长），不要主动结束对话。`
    ].filter((s) => s !== '').join('\n')
  )
}

/**
 * 容错解析 LLM 返回的 JSON。
 * - 去除 ```json ... ``` 围栏
 * - 提取首个 {...} 块（LLM 有时附带说明文字）
 * - 解析失败抛错（由调用方 catch 并转失败结果）
 *
 * @param raw LLM 返回的 content
 * @returns 解析后的对象
 * @throws 找不到 JSON 或 JSON.parse 失败时抛错
 */
export function parseJsonResult(raw: string): unknown {
  let text = raw.trim()
  // 去掉可能的 ```json ... ``` 围栏
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenceMatch) {
    text = fenceMatch[1].trim()
  }
  // 提取首个 {...} 块（LLM 有时会附带说明文字）
  const braceStart = text.indexOf('{')
  const braceEnd = text.lastIndexOf('}')
  if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) {
    throw new Error('未找到 JSON 对象')
  }
  text = text.slice(braceStart, braceEnd + 1)
  return JSON.parse(text)
}

// ============================================================
// 整场评审（judge_match）专属：时间线分段 + 格式化 prompt（T3.1）
// 与 judge_debate 的差异：以「整场时间线」为输入，绝不按正反方聚合辩词。
// ============================================================

/** 整场时间线中的一个分段（来自录音环节/发言人标记 + 该段文本） */
export interface MatchTimelineSegment {
  /** 环节类型（可选，如 opening；显示时优先用 stageName） */
  stage?: string
  /** 环节名（可选，优先于 stage 作为展示名） */
  stageName?: string
  /** 阵营（可选，如"正方"/"反方"） */
  side?: string
  /** 发言人（可选，可为人名或辩位编号） */
  speaker?: string | number | null
  /** 时间点（毫秒，可选） */
  tsMs?: number
  /** 该段文本（必填非空） */
  content: string
}

/**
 * 毫秒 → mm:ss 时间标签（≥1 小时显示 h:mm:ss）。
 * 非法/缺失返回空串。
 */
export function formatMatchTimestamp(tsMs?: number): string {
  if (typeof tsMs !== 'number' || !Number.isFinite(tsMs) || tsMs < 0) return ''
  const totalSec = Math.floor(tsMs / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${String(m).padStart(2, '0')}:${ss}`
}

/**
 * 把单个时间线段格式化为 `[环节名][发言人][mm:ss]：内容` 形式。
 * 各字段缺失时对应标签自动省略；内容保留原样。
 */
export function formatMatchSegment(seg: MatchTimelineSegment): string {
  const stageLabel =
    seg.stageName != null && String(seg.stageName).trim() !== ''
      ? String(seg.stageName).trim()
      : seg.stage != null && String(seg.stage).trim() !== ''
        ? String(seg.stage).trim()
        : ''
  const speaker =
    seg.speaker != null && String(seg.speaker).trim() !== '' ? String(seg.speaker).trim() : ''
  const time = formatMatchTimestamp(seg.tsMs)

  const parts: string[] = []
  if (stageLabel !== '') parts.push(`[${stageLabel}]`)
  if (speaker !== '') parts.push(`[${speaker}]`)
  if (time !== '') parts.push(`[${time}]`)

  const content = typeof seg.content === 'string' ? seg.content : ''
  const prefix = parts.join('')
  return prefix !== '' ? `${prefix}：${content}` : content
}

/**
 * 将整场时间线格式化为连续文本（保持时间顺序，不按正反方聚合）。
 * 过滤空串（内容为空的段不生成）。
 */
export function formatMatchTimeline(segments: MatchTimelineSegment[]): string {
  return segments.map(formatMatchSegment).filter((s) => s !== '').join('\n')
}

/** buildMatchUserPrompt 入参 */
export interface BuildMatchUserPromptParams {
  /** 辩题（必填） */
  topic: string
  /** 整场时间线（可选；提供时优先于 transcript） */
  timeline?: MatchTimelineSegment[]
  /** 整场转录全文（可选，无 timeline 时的退化输入） */
  transcript?: string
  /** 赛制提示（可选） */
  formatHint?: string
}

/** 样例 JSON 供 buildMatchUserPrompt 嵌入 prompt，约束输出格式 */
const MATCH_JSON_SAMPLE = `{
  "verdict": { "winner": "aff", "confidence": 0.72, "reason": "正方在核心交锋点完成了有效回应" },
  "dimensions": [
    { "key": "logicDepth", "affScore": 8, "negScore": 6, "comment": "正方立论有层次，反方稍显单薄" },
    { "key": "logicRigor", "affScore": 7, "negScore": 7, "comment": "双方论证链条都较完整" },
    { "key": "rebuttal", "affScore": 8, "negScore": 5, "comment": "反方多处未正面回应正方质询" },
    { "key": "expressiveness", "affScore": 6, "negScore": 8, "comment": "反方表达感染力更强" },
    { "key": "teamwork", "affScore": 7, "negScore": 6, "comment": "正方前后场口径一致" }
  ],
  "bestSpeaker": "正方三辩",
  "stageVerdicts": [
    { "stage": "opening", "winner": "aff", "confidence": 0.8, "comment": "正方立论框架更完整" },
    { "stage": "rebuttal", "winner": "neg", "confidence": 0.65, "comment": "反方拆解更有力" }
  ],
  "summary": "整体而言……（用评委的风格写总评，80-150 字）"
}`

/**
 * 构造整场评审（judge_match）的 user prompt。
 * - 优先选手 timeline（时间顺序连续文本），否则用 transcript 全文，绝不按正反方聚合。
 * - 复用五维评分要求 + verdict + bestSpeaker + 可选 stageVerdicts + JSON 样例。
 */
export function buildMatchUserPrompt(params: BuildMatchUserPromptParams): string {
  const dimsText = FIVE_DIMENSIONS.map((d, i) => `${i + 1}. ${d.name}（${d.key}）`).join('\n')
  const formatLine =
    typeof params.formatHint === 'string' && params.formatHint.trim() !== ''
      ? `\n赛制参考：${params.formatHint.trim()}`
      : ''

  const hasTimeline = Array.isArray(params.timeline) && params.timeline.length > 0
  let body = ''
  let sourceNote = ''
  if (hasTimeline) {
    body = formatMatchTimeline(params.timeline ?? [])
    sourceNote = '以下是整场辩论按时间先后排列的时间线（含环节/发言人/时间点），请通读后评审：'
  } else if (typeof params.transcript === 'string' && params.transcript.trim() !== '') {
    body = params.transcript.trim()
    sourceNote = '以下是整场辩论的转录全文，请通读后评审：'
  }

  return `请你以评委身份评审以下一整场辩论（按整场先后顺序，而非拆分正反方辩词）。

【辩题】${params.topic}${formatLine}

【全场实录】
${sourceNote}
${body}

【评分要求】
请从以下五个维度，分别给正反双方打分（0-10 分）并各写一句评语：
${dimsText}

【素材不足时如实拒绝】
若【全场实录】过短、与辩题无关、或不足以支撑胜负与五维判定，请如实返回 { "verdict": null, "insufficientReason": "转写内容过短/与辩题无关，无法进行有效判定" }，在 insufficientReason 中说明缺什么素材、建议补充什么，不要对无法判断的内容强行评分；只有素材确实足够时才输出完整的 verdict / dimensions / bestSpeaker。

然后给出：
1. verdict：胜方（aff=正方 / neg=反方）、置信度（0-1）、一句判定理由
2. bestSpeaker：全场最佳辩手（发言人或辩位），没有则返回 null
3. summary：一段总评（80-150 字），用你惯常的点评口吻，体现你的评审视角
4. stageVerdicts（可选）：如需按环节分段逐段判定，给出 stage / winner / confidence / 一句评语 comment

【输出格式】
严格输出 JSON（不要包含 markdown 代码块围栏），结构如下：
${MATCH_JSON_SAMPLE}`
}

// ============================================================
// 教练复盘（coach）共享：四维短板类型 / JSON 解析 / 单环节复盘 user prompt
// （从 judge-speech.tool.ts 抽出，供 judge_speech 与 coach_match 复用）
// ============================================================

/** 复盘短板领域（四维） */
export type CoachShortboardArea = '立论' | '反驳' | '表达' | '攻防'

/** 单条短板 */
export interface CoachShortboard {
  /** 维度：立论 / 反驳 / 表达 / 攻防 */
  area: CoachShortboardArea
  /** 短板描述（成长向） */
  point: string
  /** 该维度的训练方向 */
  practiceHint: string
}

/** 教练复盘 JSON 样例（短boards/可练方向/示范改写/总评） */
export const COACH_JSON_SAMPLE = `{
  "shortboards": [
    { "area": "立论", "point": "判准只给了定义没给论证，易被对方攻破", "practiceHint": "练：先写一版判准成立的论证，说明它能区分双方立场" },
    { "area": "反驳", "point": "对预设反驳回应不充分，交锋时论点被带偏", "practiceHint": "练：预判对方最可能的 3 个攻击，提前备好防守口径" },
    { "area": "表达", "point": "长句堆叠、重点不突出", "practiceHint": "练：每段结论先行，控制在一句话内讲清" },
    { "area": "攻防", "point": "被质询时容易顺着对方逻辑走", "practiceHint": "练：先判对方问的是事实还是立场，再决定撤回或加固" }
  ],
  "practiceDirections": [
    "反复打磨判准论证，让它既能自证又能有效区分双方",
    "针对预判攻击提前准备防守卡"
  ],
  "rewriteExample": "我的判准是……（示范改写的一段简短文字）",
  "summary": "整体而言……（成长向总结，60-100 字）"
}`

/**
 * 解析并校验 LLM 返回的教练复盘 JSON。
 * shortboards 逐项校验 area/point；practiceDirections 过滤非空串；
 * rewriteExample / summary 缺失时抛错（由调用方转失败结果）。
 * 纯函数；judge_speech 与 coach_match 共用。
 */
export function parseCoachResultJson(raw: string): {
  shortboards: CoachShortboard[]
  practiceDirections: string[]
  rewriteExample: string
  summary: string
} {
  const parsed: unknown = parseJsonResult(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 非对象')
  }
  const obj = parsed as {
    shortboards?: unknown
    practiceDirections?: unknown
    rewriteExample?: unknown
    summary?: unknown
  }

  if (!Array.isArray(obj.shortboards)) {
    throw new Error('shortboards 缺失或非数组')
  }
  const shortboards: CoachShortboard[] = []
  for (const item of obj.shortboards) {
    if (!item || typeof item !== 'object') continue
    const s = item as { area?: unknown; point?: unknown; practiceHint?: unknown }
    const area = s.area
    if (area !== '立论' && area !== '反驳' && area !== '表达' && area !== '攻防') continue
    if (typeof s.point !== 'string' || s.point.trim() === '') continue
    shortboards.push({
      area,
      point: s.point.trim(),
      practiceHint:
        typeof s.practiceHint === 'string' && s.practiceHint.trim() !== ''
          ? s.practiceHint.trim()
          : ''
    })
  }
  if (shortboards.length === 0) {
    throw new Error('shortboards 无有效条目')
  }

  const practiceDirections: string[] = []
  if (obj.practiceDirections !== undefined) {
    if (!Array.isArray(obj.practiceDirections)) throw new Error('practiceDirections 非数组')
    for (const d of obj.practiceDirections) {
      if (typeof d === 'string' && d.trim() !== '') practiceDirections.push(d.trim())
    }
  }

  const rewriteExample =
    typeof obj.rewriteExample === 'string' && obj.rewriteExample.trim() !== ''
      ? obj.rewriteExample.trim()
      : ''
  if (rewriteExample === '') throw new Error('rewriteExample 缺失或为空')

  const summary =
    typeof obj.summary === 'string' && obj.summary.trim() !== '' ? obj.summary.trim() : ''
  if (summary === '') throw new Error('summary 缺失或为空')

  return { shortboards, practiceDirections, rewriteExample, summary }
}

/**
 * 构造「单方稿/单环节」教练复盘 user prompt。
 * judge_speech 与 coach_match（按环节循环）共用。
 */
export interface BuildCoachReviewUserPromptParams {
  topic: string
  side: 'aff' | 'neg'
  /** 环节类型（可选，opening/rebuttal/...） */
  stage?: DebateStageType
  /** 环节展示名（可选，优先于 stage 作为标题，如"质询"） */
  stageName?: string
  /** 待复盘稿子全文 */
  speech: string
  /** 赛制提示（可选） */
  formatHint?: string
}

export function buildCoachReviewUserPrompt(p: BuildCoachReviewUserPromptParams): string {
  const formatLine =
    typeof p.formatHint === 'string' && p.formatHint.trim() !== ''
      ? `\n赛制参考：${p.formatHint.trim()}`
      : ''
  const stageLine =
    p.stage && getStageDefinition(p.stage)
      ? `${getStageDefinition(p.stage)?.description ?? ''}，环节类型：${p.stage}`
      : p.stageName && p.stageName.trim() !== ''
        ? `环节：${p.stageName.trim()}`
        : '（未指定环节，按整份稿子进行复盘）'
  return [
    `【辩题】${p.topic}${formatLine}`,
    `【立场】${p.side === 'aff' ? '正方' : '反方'}（${p.side}）`,
    stageLine,
    '',
    `【${p.side === 'aff' ? '正方' : '反方'}稿子】`,
    p.speech,
    '',
    '【输出要求】',
    '请以教练视角（成长向，不判分、不排名）给出：',
    '1) shortboards：立论/反驳/表达/攻防四维短板，每条含 area（立论/反驳/表达/攻防）、',
    '   point（短板描述）、practiceHint（该维度的训练方向）；',
    '2) practiceDirections：可练方向清单（2-4 条，每条一句话）；',
    '3) rewriteExample：一段示范改写（挑稿中最薄弱的一句改写，让对参照）；',
    '4) summary：教练总评（60-100 字），温和而具体地鼓励改进。',
    '严格输出 JSON（不要包含 markdown 代码块围栏），结构如下：',
    COACH_JSON_SAMPLE
  ].join('\n')
}

// ============================================================
// 整场分环节复盘（coach_match）专属：把时间线按环节分组（纯函数，便于测试）
// ============================================================

/** 时间线按环节分组后的一个环节组 */
export interface CoachStageGroup {
  /** 分组键（环节名或环节类型或"未标注"） */
  key: string
  /** 环节类型（若是六类之一；否则 null） */
  stage: DebateStageType | null
  /** 环节展示名 */
  stageName: string
  /** 该环节全部有效文本（保持段内顺序，逐段格式化合并） */
  content: string
}

/**
 * 把整场时间线按环节分组（保留首次出现顺序，同一环节的段合并为一组）。
 * - 分组键：优先 seg.stageName（展示名），其次 seg.stage（环节类型），否则"未标注"。
 * - 空 content 的段跳过。
 * - 纯函数，供 coach_match 与前端预览复用。
 */
export function groupTimelineByStage(segments: MatchTimelineSegment[] | undefined): CoachStageGroup[] {
  if (!Array.isArray(segments) || segments.length === 0) return []
  const groups = new Map<string, CoachStageGroup>()
  for (const seg of segments) {
    if (!seg || typeof seg.content !== 'string' || seg.content.trim() === '') continue
    const displayName =
      seg.stageName != null && String(seg.stageName).trim() !== ''
        ? String(seg.stageName).trim()
        : seg.stage != null && String(seg.stage).trim() !== ''
          ? String(seg.stage).trim()
          : '未标注'
    const key = displayName
    const text = formatMatchSegment(seg).trim()
    const existing = groups.get(key)
    if (existing) {
      existing.content = existing.content === '' ? text : `${existing.content}\n\n${text}`
    } else {
      const stage =
        seg.stage != null && getStageDefinition(seg.stage as DebateStageType)
          ? (seg.stage as DebateStageType)
          : mapStageNameToType(displayName)
      groups.set(key, {
        key,
        stage: stage ?? null,
        stageName: displayName,
        content: text
      })
    }
  }
  return Array.from(groups.values())
}
