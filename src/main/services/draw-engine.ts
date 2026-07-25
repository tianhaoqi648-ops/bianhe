// ============================================================
// draw-engine.ts — 抽取引擎
//
// 提供：
//   drawTopics(params: DrawParams): DrawResult
//
// 流程：
//   1. 构建候选题池（topicRepo.listTopics + 排除黑名单）
//   2. 排除本赛事已抽 + 队伍历史
//   3. 难度 override 过滤
//   4. 题源混合比例分层抽样
//   5. 加权随机抽取
//   6. 持方分配（可选）
//   7. 落库（drawRepo.createSession 事务）
//   8. 审计（auditRepo.addLog）
//
// 依赖：probability.ts + 4 个 repository
// ============================================================

import { topicRepo, type Topic, type TopicFilter } from '../db/repository/topic.repo'
import { eventRepo, type Round, type Team } from '../db/repository/event.repo'
import { drawRepo, type DrawSessionDetail, type DrawSessionItem } from '../db/repository/draw.repo'
import { auditRepo } from '../db/repository/audit.repo'
import {
  weightedRandomSelect,
  getDifficultyDistribution,
  applyDifficultyDistribution
} from './probability'

// ============================================================
// 类型定义
// ============================================================

export interface SourceMixRatio {
  /** 官方题源占比，0~1 */
  official: number
  /** 自定义题源占比，0~1 */
  custom: number
}

export interface DrawParams {
  /** 赛事 ID（必填） */
  event_id: string
  /** 轮次 ID（可选，决定 difficulty_override） */
  round_id?: string | null
  /** 抽取辩题数量 */
  topic_count: number
  /** 是否同时抽取持方（正反方） */
  include_stance: boolean
  /** 参与队伍列表（include_stance=true 时用于配对） */
  teams?: Team[]
  /** 筛选条件，传给 topicRepo.listTopics */
  filters?: TopicFilter
  /** 题库混合比例，如 { official: 0.7, custom: 0.3 } */
  source_mix_ratio?: SourceMixRatio
  /** 操作人 */
  operator?: string
}

export interface DrawResult {
  /** 创建的会话（含 items） */
  session: DrawSessionDetail
  /** 实际抽取的辩题列表（从 session.items 反查 topic 得到） */
  topics: Topic[]
  /** 实际题源比例（用于审计与回显） */
  actual_ratio?: { official: number; custom: number }
}

/**
 * 题池不足错误。
 */
export class InsufficientTopicsError extends Error {
  constructor(public candidateCount: number, public requiredCount: number) {
    super(`题池不足：候选 ${candidateCount} 道，需要 ${requiredCount} 道`)
    this.name = 'InsufficientTopicsError'
  }
}

// ============================================================
// 步骤 1：构建候选题池
// ============================================================

/**
 * 从 topicRepo 拉取候选题池。
 * - 使用 filters 过滤
 * - pageSize 设大（10000）确保不分页
 * - 排除 status='blacklisted' 的辩题
 */
export function buildCandidatePool(params: DrawParams): Topic[] {
  const filter: TopicFilter = {
    ...params.filters,
    status: 'active', // 只取 active，自动排除 blacklisted/favorited 等
    page: 1,
    pageSize: 10000
  }
  const { items } = topicRepo.listTopics(filter)
  return items
}

// ============================================================
// 步骤 2：排除本赛事已抽 + 队伍历史
// ============================================================

/**
 * 排除：
 *   - 本赛事已抽取过的辩题（drawRepo.listDrawnTopicIdsByEvent）
 *   - 参与队伍的历史辩题（eventRepo.listTeamHistory 汇总 topic_id）
 */
export function applyExclusions(candidates: Topic[], params: DrawParams): Topic[] {
  // 本赛事已抽
  const drawnIds = new Set<string>(drawRepo.listDrawnTopicIdsByEvent(params.event_id))

  // 队伍历史
  const teamHistoryIds = new Set<string>()
  if (params.teams && params.teams.length > 0) {
    for (const team of params.teams) {
      const history = eventRepo.listTeamHistory(team.id)
      for (const h of history) {
        teamHistoryIds.add(h.topic_id)
      }
    }
  }

  return candidates.filter((t) => !drawnIds.has(t.id) && !teamHistoryIds.has(t.id))
}

// ============================================================
// 步骤 3：难度 override 过滤
// ============================================================

/**
 * 如果轮次设置了 difficulty_override（非空字符串），按 getDifficultyDistribution
 * 返回的比例对候选池做分层抽样。
 *
 * 注：difficulty_override 在 schema 中是 TEXT，存轮次名（如 "小组赛"/"决赛"）。
 *     这里把它当作 roundName 传给 getDifficultyDistribution。
 *
 * 如果 round 为 null 或 difficulty_override 为空，直接返回原候选池。
 */
export function applyDifficultyOverride(
  candidates: Topic[],
  round: Round | null | undefined,
  count: number
): Topic[] {
  if (!round || !round.difficulty_override) {
    return candidates
  }

  const distribution = getDifficultyDistribution(round.difficulty_override)
  return applyDifficultyDistribution(candidates, distribution, count)
}

// ============================================================
// 步骤 4：题源混合比例分层抽样
// ============================================================

/**
 * 按 official:custom 比例从候选池分层抽样。
 * - official 子池：source_type='官方'
 * - custom 子池：source_type='自定义'（或其他非"官方"值）
 *
 * 某子池不足时从另一子池补足。
 *
 * 返回 { picked, actualRatio }。
 */
export function applySourceMixRatio(
  candidates: Topic[],
  ratio: SourceMixRatio,
  count: number
): { picked: Topic[]; actualRatio: { official: number; custom: number } } {
  if (count <= 0 || candidates.length === 0) {
    return {
      picked: [],
      actualRatio: { official: 0, custom: 0 }
    }
  }

  const officialPool = candidates.filter((t) => t.source_type === '官方')
  const customPool = candidates.filter((t) => t.source_type !== '官方')

  const officialTarget = Math.floor(count * ratio.official)
  const customTarget = count - officialTarget

  const picked: Topic[] = []
  const officialRemaining: Topic[] = []
  const customRemaining: Topic[] = []

  // 抽官方池
  if (officialTarget > 0 && officialPool.length > 0) {
    const actual = Math.min(officialTarget, officialPool.length)
    const pickedOfficial = weightedRandomSelect(officialPool, actual)
    picked.push(...pickedOfficial)
    const pickedSet = new Set(pickedOfficial.map((p) => p.id))
    for (const t of officialPool) {
      if (!pickedSet.has(t.id)) officialRemaining.push(t)
    }
  } else {
    officialRemaining.push(...officialPool)
  }

  // 抽自定义池
  if (customTarget > 0 && customPool.length > 0) {
    const actual = Math.min(customTarget, customPool.length)
    const pickedCustom = weightedRandomSelect(customPool, actual)
    picked.push(...pickedCustom)
    const pickedSet = new Set(pickedCustom.map((p) => p.id))
    for (const t of customPool) {
      if (!pickedSet.has(t.id)) customRemaining.push(t)
    }
  } else {
    customRemaining.push(...customPool)
  }

  // 补足
  const deficit = count - picked.length
  if (deficit > 0) {
    const remaining = [...officialRemaining, ...customRemaining]
    if (remaining.length > 0) {
      const supplement = weightedRandomSelect(remaining, Math.min(deficit, remaining.length))
      picked.push(...supplement)
    }
  }

  const actualOfficial = picked.filter((t) => t.source_type === '官方').length
  const actualCustom = picked.length - actualOfficial
  return {
    picked,
    actualRatio: {
      official: picked.length > 0 ? actualOfficial / picked.length : 0,
      custom: picked.length > 0 ? actualCustom / picked.length : 0
    }
  }
}

// ============================================================
// 步骤 5：持方分配
// ============================================================

/**
 * 对每道题随机分配正反方，并把 teams 两两配对到 A/B。
 *
 * 校验：
 *   - teams.length >= 2
 *   - teams.length 为偶数
 *
 * 返回 items 数组（不含 id 与 session_id，由 createSession 填充）。
 */
export function assignStances(
  topics: Topic[],
  teams: Team[]
): Array<Omit<DrawSessionItem, 'id' | 'session_id'>> {
  if (teams.length < 2 || teams.length % 2 !== 0) {
    throw new Error('队伍数量必须为 ≥2 的偶数')
  }

  // 队伍两两配对
  const pairs: Array<[Team, Team]> = []
  const shuffledTeams = [...teams]
  // Fisher-Yates 洗牌
  for (let i = shuffledTeams.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffledTeams[i], shuffledTeams[j]] = [shuffledTeams[j], shuffledTeams[i]]
  }
  for (let i = 0; i < shuffledTeams.length; i += 2) {
    pairs.push([shuffledTeams[i], shuffledTeams[i + 1]])
  }

  const items: Array<Omit<DrawSessionItem, 'id' | 'session_id'>> = []
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i]
    const pair = pairs[i % pairs.length]
    // 随机决定 A 是正方还是反方
    const aIsPro = Math.random() < 0.5
    items.push({
      topic_id: topic.id,
      team_a_id: pair[0].id,
      team_b_id: pair[1].id,
      stance_a: aIsPro ? '正方' : '反方',
      stance_b: aIsPro ? '反方' : '正方'
    })
  }

  return items
}

// ============================================================
// 主函数：drawTopics
// ============================================================

/**
 * 抽取辩题主函数。
 *
 * 编排顺序见文件头注释。
 *
 * @throws InsufficientTopicsError 题池不足
 * @throws Error 队伍数量不合法（include_stance=true 时）
 */
export function drawTopics(params: DrawParams): DrawResult {
  // 校验队伍
  if (params.include_stance) {
    if (!params.teams || params.teams.length < 2 || params.teams.length % 2 !== 0) {
      throw new Error('队伍数量必须为 ≥2 的偶数')
    }
  }

  // 1. 构建候选题池
  let candidates = buildCandidatePool(params)

  // 2. 排除
  candidates = applyExclusions(candidates, params)

  // 3. 查询轮次
  let round: Round | null = null
  if (params.round_id) {
    round = eventRepo.getRoundById(params.round_id) ?? null
  }

  // 4. 难度 override 过滤
  candidates = applyDifficultyOverride(candidates, round, params.topic_count)

  // 5. 题源混合比例
  let actualRatio: { official: number; custom: number } | undefined
  if (params.source_mix_ratio) {
    const { picked, actualRatio: r } = applySourceMixRatio(
      candidates,
      params.source_mix_ratio,
      params.topic_count
    )
    candidates = picked
    actualRatio = r
  } else {
    // 不混合，直接加权抽取前先检查数量
  }

  // 6. 题池不足检查
  if (candidates.length < params.topic_count) {
    throw new InsufficientTopicsError(candidates.length, params.topic_count)
  }

  // 7. 加权随机抽取
  let pickedTopics: Topic[]
  if (params.source_mix_ratio) {
    // 已通过 applySourceMixRatio 抽取
    pickedTopics = candidates.slice(0, params.topic_count)
  } else {
    pickedTopics = weightedRandomSelect(candidates, params.topic_count)
  }

  // 8. 持方分配
  let items: Array<Omit<DrawSessionItem, 'id' | 'session_id'>>
  if (params.include_stance) {
    items = assignStances(pickedTopics, params.teams!)
  } else {
    items = pickedTopics.map((t) => ({
      topic_id: t.id,
      team_a_id: null,
      team_b_id: null,
      stance_a: null,
      stance_b: null
    }))
  }

  // 9. 落库
  const session = drawRepo.createSession({
    event_id: params.event_id,
    round_id: params.round_id ?? null,
    operator: params.operator,
    settings: {
      topic_count: params.topic_count,
      include_stance: params.include_stance,
      filters: params.filters ?? null,
      source_mix_ratio: params.source_mix_ratio ?? null,
      actual_ratio: actualRatio ?? null,
      round_difficulty_override: round?.difficulty_override ?? null
    },
    items
  })

  // 10. 审计
  auditRepo.addLog({
    action: 'draw',
    target_type: 'session',
    target_id: session.id,
    operator: params.operator ?? 'unknown',
    detail: {
      event_id: params.event_id,
      round_id: params.round_id ?? null,
      topic_count: params.topic_count,
      include_stance: params.include_stance,
      team_count: params.teams?.length ?? 0,
      filters: params.filters ?? null,
      source_mix_ratio: params.source_mix_ratio ?? null,
      actual_ratio: actualRatio ?? null,
      picked_topic_ids: pickedTopics.map((t) => t.id),
      session_id: session.id
    }
  })

  return {
    session,
    topics: pickedTopics,
    actual_ratio: actualRatio
  }
}
