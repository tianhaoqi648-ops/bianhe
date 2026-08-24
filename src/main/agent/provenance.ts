// ============================================================
// provenance.ts — AI 评审结果可溯源（governance Task 10，Phase 3）
//
// 目标：登记历史结果可追溯「什么模型/版本/基于什么输入」。
//   - buildJudgeProvenance：在工具执行时，从当前 LLM 配置与常量
//     注入 provenance（provider/model/prompt_version/judge_version/
//     评审模式/输入 hash/材质版本/created_at/temperature）。
//   - deterministicHash：对「评审模式 + 辩题 + 输入材料」做确定性哈希
//     （FNV-1a 32bit），保证同输入 → 同 hash，便于去重与溯源审计。
//
// 承载方式：不新增 DB 列（尽量不改已发布 migration），由 judgeHistoryRepo
//   把 provenance 以保留键 __provenance 写入现有 result_json 中；读取时
//   拆出为独立字段，resultJson 保持纯净的工具输出。
// ============================================================

import type { LLMConfig } from '@shared/agent-types'
import type { JudgeProvenance } from '../../shared/types'

/** 评审器/工具（judge 引擎）版本——变更评审算法或评分口径时手动递增 */
export const JUDGE_VERSION = '1.0.0'

/** 评审 prompt 模板版本——变更评审 prompt/schema 时手动递增 */
export const JUDGE_PROMPT_VERSION = '2026-08'

/** 评审模式（judge 工具名 → 语义模式） */
export type JudgeProvenanceMode = 'whole' | 'stage' | 'live' | 'coach' | 'other'

/**
 * 由裁判工具名推导评审模式。
 *   judge_debate / judge_match → whole（整场裁决）
 *   judge_speech               → stage（单方单环节复盘）
 *   coach_match                → coach（整场分环节教练复盘）
 *   judge_live                 → live（实时对辩陪练）
 *   其它                       → other
 */
export function judgeProvenanceModeOf(toolName: string): JudgeProvenanceMode {
  switch (toolName) {
    case 'judge_debate':
    case 'judge_match':
      return 'whole'
    case 'judge_speech':
      return 'stage'
    case 'coach_match':
      return 'coach'
    case 'judge_live':
      return 'live'
    default:
      return 'other'
  }
}

/**
 * 确定性字符串哈希（FNV-1a 32bit）。
 * 纯函数：相同输入序列恒产出相同 8 位十六进制串；与运行时间/随机数无关。
 * 空字段以 '' 参与拼接，保持序列位置稳定。
 */
export function deterministicHash(...parts: Array<string | undefined | null>): string {
  const input = parts.map((p) => (p == null ? '' : p)).join('\u0001')
  // FNV-1a 32-bit 偏移基数与素数
  let hash = 0x811c9dc5
  const prime = 0x01000193
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * prime) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** buildJudgeProvenance 入参 */
export interface BuildJudgeProvenanceParams {
  /** 当前 LLM 配置（工具执行时注入 provider/model；缺省 unknown） */
  config?: LLMConfig
  /** 裁判工具名（judge_debate / judge_match / judge_speech / coach_match / judge_live） */
  toolName: string
  /** 辩题（参与输入 hash） */
  topic?: string
  /** 评审模式；缺省由 toolName 推导 */
  mode?: JudgeProvenanceMode
  /** 参与输入 hash 的原始材料（辩词/时间线/转录/稿子等） */
  inputs?: Array<string | undefined | null>
  /** 额外参与 hash 的静态项（如 side/stage 快照），可选 */
  extra?: string
  /** 评审温度（如有）；judge 工具当前未下发 temperature，缺省省略 */
  temperature?: number
  /** 创建时间；缺省取当前 ISO 时间 */
  createdAt?: string
}

/**
 * 构造一条评审 provenance 记录。
 * inputHash = deterministicHash(mode, topic, ...inputs, extra)——覆盖
 * 输入稿 + 辩题 + 评审模式，同输入必同 hash。
 */
export function buildJudgeProvenance(p: BuildJudgeProvenanceParams): JudgeProvenance {
  const mode = p.mode ?? judgeProvenanceModeOf(p.toolName)
  const createdAt = p.createdAt ?? new Date().toISOString()
  const inputHash = deterministicHash(mode, p.topic, ...(p.inputs ?? []), p.extra)
  return {
    provider: p.config?.provider ?? 'unknown',
    model: p.config?.model ?? 'unknown',
    promptVersion: JUDGE_PROMPT_VERSION,
    judgeVersion: JUDGE_VERSION,
    mode,
    inputHash,
    createdAt,
    temperature: typeof p.temperature === 'number' ? p.temperature : undefined
  }
}