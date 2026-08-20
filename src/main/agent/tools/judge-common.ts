// ============================================================
// judge-common.ts — AI 裁判工具公共模块（AI 裁判功能演进 2026-08-18）
//
// 从 judge-debate.tool.ts 提取的共享能力，供 judge_debate / judge_speech /
// simulate_opponent 等工具复用：
//   1. buildJudgeSystemPrompt：按评委人设构建 system prompt
//   2. parseJsonResult：容错解析 LLM 返回的 JSON（去 ```json 围栏、取首个 {} 块）
// ============================================================

import { FIVE_DIMENSIONS, type JudgeProfile } from '@shared/ai-judges'

/**
 * 按评委人设构建 system prompt。
 *
 * @param judge 评委人设（ai-judges.ts）
 * @param taskInstruction 当前任务的指令（如"评审一场辩论"/"设计质询问题"），追加在末尾
 * @returns system prompt 文本
 */
export function buildJudgeSystemPrompt(judge: JudgeProfile, taskInstruction: string): string {
  return [
    `你是${judge.name}（${judge.category}），一位华语辩论领域备受尊敬的辩手与评委。`,
    `【背景】${judge.bio}`,
    `【你的辩风】${judge.styleTraits.map((t) => `- ${t}`).join('\n')}`,
    `【你的评审倾向】最看重：${judge.judgePriorities.top}；次看重：${judge.judgePriorities.secondary}；可能忽略：${judge.judgePriorities.ignored}`,
    `【你的标志性表达】${judge.signaturePhrases.map((p) => `"${p}"`).join(' ')}`,
    `【你的点评风格】${judge.reviewStyle}`,
    '',
    taskInstruction
  ].join('\n')
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
