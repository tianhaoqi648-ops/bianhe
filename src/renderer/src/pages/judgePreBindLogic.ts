// ============================================================
// judgePreBindLogic.ts — AI 裁判页路由预绑定纯逻辑（T4）
//
// 事件赛程「打开 AI 裁判工作台」通过路由 state/query 携带 eventId/roundId/matchId，
// JudgeArena 挂载后据此自动选中赛事→轮次→场次。本模块把「从原始意图规整出
// 可用的 赛事-轮次-场次 三元组」抽为纯函数，便于单测与页面复用（不依赖 jsdom）。
// 约定：ID 对不上（不存在）→ 静默回退「未绑定」，不报错不弹窗。
// ============================================================

import type { Match, Round } from '../../../shared/types'
import type { DebaterRole } from '../../../shared/ai-judges'

/** 路由预绑定意图（state 或 query 中携带的三元组，均可选） */
export interface JudgePreBindIntent {
  eventId?: string | null
  roundId?: string | null
  matchId?: string | null
  /** 可选：打开工作台时定位到的三角色 Tab（judge 裁判 / sparring 陪练 / coach 复盘） */
  role?: DebaterRole
}

/** 规整所需的已加载数据源（轮次 + 场次） */
export interface JudgePreBindSources {
  rounds?: Round[]
  matches?: Match[]
}

/** 规整结果：valid=false 表示无法绑定（应静默回退） */
export interface JudgePreBindResolved {
  valid: boolean
  eventId?: string
  /** 轮次可选：意图里无轮次，或轮次 ID 对不上时置 undefined */
  roundId?: string
  matchId?: string
  boundMatch?: Match | null
}

/**
 * 从原始意图 + 已加载的轮次/场次中规整出可用的三元组。
 * 规则：
 *   - eventId/matchId 缺失或 matchId 在已加载场次中不存在 → 不可绑定
 *   - roundId 存在且能在已加载轮次中找到才选中，否则视为未选轮次
 *   - 已加载场次都隶属于该赛事，故 matchId 命中即视为该场有效
 */
export function resolveJudgePreBind(
  intent: JudgePreBindIntent,
  sources: JudgePreBindSources
): JudgePreBindResolved {
  const { eventId, matchId } = intent
  if (!eventId || !matchId) return { valid: false, boundMatch: null }
  const match = sources.matches?.find((m) => m.id === matchId) ?? null
  if (!match) return { valid: false, boundMatch: null }
  let roundId: string | undefined
  if (intent.roundId && sources.rounds?.some((r) => r.id === intent.roundId)) {
    roundId = intent.roundId
  }
  return { valid: true, eventId, roundId, matchId: match.id, boundMatch: match }
}