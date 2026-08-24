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
import { eventRepo, type Round, type Team, type TeamGroup } from '../db/repository/event.repo'
import {
  topicGroupRepo,
  type EventBankConfig,
  type TopicGroup
} from '../db/repository/topic-group.repo'
import { drawRepo, type DrawSessionDetail, type DrawSessionItem } from '../db/repository/draw.repo'
import { auditRepo } from '../db/repository/audit.repo'
import {
  weightedRandomSelect,
  weightedRandomSelectWithReplacement,
  getDifficultyDistribution,
  applyDifficultyDistribution,
  coinFlip
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
  /** 单人持方模式：传一支队伍 id，引擎为每道题随机分配正反方 */
  solo_team_id?: string
  /** 抽取模式：'versus' 对战（默认）/ 'group' 分组同题 / 'multi_team' 多队同题 */
  draw_mode?: 'versus' | 'group' | 'multi_team'
  /** group 模式下参与抽取的分组 id 列表 */
  group_ids?: string[]
  /** multi_team 模式下每道题同题的队伍数（>=2） */
  teams_per_topic?: number
  /**
   * v6 新增：标记 teams 是否来自用户 TeamPairing 配置。
   * - true：teams 来自 TeamPairing 扁平化，multi_team 引擎应保留配对顺序，不 shuffle
   * - false 或未传：teams 来自 eventStore 或其他来源，multi_team 引擎应 shuffle
   * - group 模式不使用此标记（总是 shuffle 同组队伍，确保随机对阵）
   */
  user_pairing?: boolean
  /** 测试模式：跳过 applyExclusions、不写 team_history、settings.is_test=true、自动 allow_repeat */
  test_mode?: boolean
  /** 允许辩题重复：跳过题池不足检查，使用有放回抽样 */
  allow_repeat?: boolean
  /** 抽题选库：限定从某个题组（题库）抽取。为空时不限（全库候选）。 */
  group_id?: string | null
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
 *
 * 单人模式（params.solo_team_id 存在）下，仍复用 listTeamHistory 读取该队伍
 * 历史辩题用于去重，确保不破坏现有去重逻辑。
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
  // 单人模式：复用 listTeamHistory 读取该队伍历史辩题用于去重
  if (params.solo_team_id) {
    const history = eventRepo.listTeamHistory(params.solo_team_id)
    for (const h of history) {
      teamHistoryIds.add(h.topic_id)
    }
  }

  return candidates.filter((t) => !drawnIds.has(t.id) && !teamHistoryIds.has(t.id))
}

// ============================================================
// 步骤 2.5：按选题模式解析候选库
// ============================================================

/**
 * 候选库解析所需的 repository 依赖（便于纯函数单测，注入即可）。
 * 均来自 topicGroupRepo：
 *   - getEventBankConfig：读事件选题模式配置（缺省 single）
 *   - listGroupsByEvent：事件绑定的题库
 *   - listGroupsByRound：轮次绑定的题库
 *   - listTopicIdsByGroup：某题库内的全部 topic id
 */
export interface ResolveBankContext {
  getEventBankConfig(eventId: string): EventBankConfig
  listGroupsByEvent(eventId: string): TopicGroup[]
  listGroupsByRound(roundId: string): TopicGroup[]
  listTopicIdsByGroup(groupId: string): string[]
}

/** 取若干题库 topic ids 的并集（去重）。 */
function unionTopicGroupIds(groupIds: string[], ctx: ResolveBankContext): string[] {
  const seen = new Set<string>()
  for (const gid of groupIds) {
    for (const id of ctx.listTopicIdsByGroup(gid)) {
      seen.add(id)
    }
  }
  return [...seen]
}

/** 退化为 union：事件绑定题库的并集；无绑定返回 null（全库）。 */
function resolveEventUnion(params: DrawParams, ctx: ResolveBankContext): string[] | null {
  const boundGroups = ctx.listGroupsByEvent(params.event_id)
  if (boundGroups.length === 0) return null
  return unionTopicGroupIds(
    boundGroups.map((g) => g.id),
    ctx
  )
}

/**
 * 按事件选题模式解析本次抽取应使用的候选库 topic ids（并集）。
 *
 * 仅当未显式传 `group_id` 时调用；显式 `group_id` 仍由 drawTopics 单一过滤。
 *
 * 返回字面量语义：
 *   - `string[]`：应作为候选过滤的题库 topic ids（并集）
 *   - `null`：无可选库，回退「全库」候选（不叠加任何题库过滤）
 *
 * 各模式解析：
 *   - `single`：取 priorityOrder[0]；无则回退全库（null）。
 *   - `union`：事件绑定题库（listGroupsByEvent）并集；无绑定回退全库。
 *   - `priority`：按 priorityOrder 依次并入；累积题数达 params.topic_count 即停，
 *     不足时用下一库补足（对最终候选过滤）；无 priorityOrder 则退化为 union。
 *   - `by_round`：用 params.round_id → listGroupsByRound 命中题库的并集；
 *     无 round_id 或无轮次绑定则退化为 single → union。
 */
export function resolveBankTopicIds(
  params: DrawParams,
  ctx: ResolveBankContext
): string[] | null {
  const config = ctx.getEventBankConfig(params.event_id)
  const order = config.priorityOrder ?? []

  switch (config.mode) {
    case 'union': {
      return resolveEventUnion(params, ctx)
    }

    case 'priority': {
      if (order.length === 0) return resolveEventUnion(params, ctx)
      const needed = Math.max(1, params.topic_count)
      const seen = new Set<string>()
      for (const gid of order) {
        for (const id of ctx.listTopicIdsByGroup(gid)) seen.add(id)
        if (seen.size >= needed) break
      }
      return seen.size > 0 ? [...seen] : null
    }

    case 'by_round': {
      if (params.round_id) {
        const roundGroups = ctx.listGroupsByRound(params.round_id)
        if (roundGroups.length > 0) {
          return unionTopicGroupIds(
            roundGroups.map((g) => g.id),
            ctx
          )
        }
      }
      // 无轮次绑定 → 退化为 single → union
      if (order.length > 0) return ctx.listTopicIdsByGroup(order[0])
      return resolveEventUnion(params, ctx)
    }

    case 'single':
    default: {
      // 缺省（未配置/invalid mode）走 default：取 priorityOrder[0]，否则全库（现状）
      if (order.length > 0) return ctx.listTopicIdsByGroup(order[0])
      return null
    }
  }
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
 * allowRepeat=true 时（允许辩题重复）：子池抽取改用 weightedRandomSelectWithReplacement，
 * 子池不足也能凑够 target 数量（有放回抽样）；补足分支同步改用有放回抽样。
 *
 * 返回 { picked, actualRatio }。
 */
export function applySourceMixRatio(
  candidates: Topic[],
  ratio: SourceMixRatio,
  count: number,
  allowRepeat?: boolean
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
    if (allowRepeat) {
      // 有放回抽样：子池不足也能抽够 officialTarget 个
      const pickedOfficial = weightedRandomSelectWithReplacement(officialPool, officialTarget)
      picked.push(...pickedOfficial)
      // picked 可能含重复，不能用 Set 去重计算 remaining；直接把整个池留作补足备用
      officialRemaining.push(...officialPool)
    } else {
      const actual = Math.min(officialTarget, officialPool.length)
      const pickedOfficial = weightedRandomSelect(officialPool, actual)
      picked.push(...pickedOfficial)
      const pickedSet = new Set(pickedOfficial.map((p) => p.id))
      for (const t of officialPool) {
        if (!pickedSet.has(t.id)) officialRemaining.push(t)
      }
    }
  } else {
    officialRemaining.push(...officialPool)
  }

  // 抽自定义池
  if (customTarget > 0 && customPool.length > 0) {
    if (allowRepeat) {
      // 有放回抽样：子池不足也能抽够 customTarget 个
      const pickedCustom = weightedRandomSelectWithReplacement(customPool, customTarget)
      picked.push(...pickedCustom)
      customRemaining.push(...customPool)
    } else {
      const actual = Math.min(customTarget, customPool.length)
      const pickedCustom = weightedRandomSelect(customPool, actual)
      picked.push(...pickedCustom)
      const pickedSet = new Set(pickedCustom.map((p) => p.id))
      for (const t of customPool) {
        if (!pickedSet.has(t.id)) customRemaining.push(t)
      }
    }
  } else {
    customRemaining.push(...customPool)
  }

  // 补足
  const deficit = count - picked.length
  if (deficit > 0) {
    const remaining = [...officialRemaining, ...customRemaining]
    if (remaining.length > 0) {
      if (allowRepeat) {
        const supplement = weightedRandomSelectWithReplacement(remaining, deficit)
        picked.push(...supplement)
      } else {
        const supplement = weightedRandomSelect(remaining, Math.min(deficit, remaining.length))
        picked.push(...supplement)
      }
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
 * 同时写入快照字段（topic_title / team_a_name / team_b_name），
 * 避免后续辩题或队伍硬删除后显示 ID 片段。
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

  // 直接按 teams 顺序两两配对（保留用户在 TeamPairing 中配置的配对关系）
  // teams 顺序由 DrawPage.buildParams 按 [pair0.A, pair0.B, pair1.A, pair1.B, ...] 扁平化
  // 引擎不得重新洗牌，遵循"默认同一行的对打"原则
  const pairs: Array<[Team, Team]> = []
  for (let i = 0; i < teams.length; i += 2) {
    pairs.push([teams[i], teams[i + 1]])
  }

  // P2-24: 题数 > 配对数时采用轮询分配（i % pairs.length）确保配对复用均匀；
  // 同时对同一配对的持方做交替分配，避免某对连续打同一持方导致正反分布不均。
  // 首次使用某配对时随机持方，后续复用时与上次相反。
  const pairUseCount: number[] = new Array(pairs.length).fill(0)

  const items: Array<Omit<DrawSessionItem, 'id' | 'session_id'>> = []
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i]
    const pairIdx = i % pairs.length
    const pair = pairs[pairIdx]
    // 首次随机，后续交替（确保复用时正反方均匀）
    const aIsPro =
      pairUseCount[pairIdx] === 0 ? coinFlip() : pairUseCount[pairIdx] % 2 === 0
    pairUseCount[pairIdx]++
    items.push({
      topic_id: topic.id,
      team_a_id: pair[0].id,
      team_b_id: pair[1].id,
      stance_a: aIsPro ? '正方' : '反方',
      stance_b: aIsPro ? '反方' : '正方',
      topic_title: topic.title,
      team_a_name: pair[0].name,
      team_b_name: pair[1].name
    })
  }

  return items
}

/**
 * 单人持方模式：每道题由同一支队伍打，引擎随机分配正反方。
 *
 * - team_a_id = soloTeam.id
 * - stance_a = 随机('正方' | '反方')
 * - team_b_id = null
 * - stance_b = null
 *
 * 同时写入快照字段（topic_title / team_a_name），team_b_name 为 null。
 *
 * 返回 items 数组（不含 id 与 session_id，由 createSession 填充）。
 */
export function assignSoloStances(
  topics: Topic[],
  soloTeam: Team
): Array<Omit<DrawSessionItem, 'id' | 'session_id'>> {
  const items: Array<Omit<DrawSessionItem, 'id' | 'session_id'>> = []
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i]
    // 随机决定该队伍是正方还是反方
    const isPro = coinFlip()
    items.push({
      topic_id: topic.id,
      team_a_id: soloTeam.id,
      team_b_id: null,
      stance_a: isPro ? '正方' : '反方',
      stance_b: null,
      topic_title: topic.title,
      team_a_name: soloTeam.name,
      team_b_name: null
    })
  }

  return items
}

// ============================================================
// 步骤 5b：分组同题持方分配（group 模式）
// ============================================================

/**
 * 分组同题模式：按分组数抽取对应题数，每题分配给同组所有队伍。
 *
 * 约定：
 *   - topics 数量 = groups 数量（按顺序一一对应，调用方负责抽题数量）
 *   - 每题分配给同组所有队伍，team_ids 写入队伍 id 数组
 *   - team_a_id / team_b_id 留空（null）
 *   - group_id 写入对应分组 id
 *   - team_names 写入队伍名快照（与 team_ids 一一对应）
 *
 * 持方策略（由 isRoundRobin 控制）：
 *   - isRoundRobin=true（循环赛）：组内不分正反方
 *     - team_stances 为空字符串数组（与 team_ids 等长）
 *     - stance_a/stance_b 留空
 *   - isRoundRobin=false（非循环赛）：
 *     - 同组 2 队：随机分配正反方并写入 stance_a/stance_b；
 *       team_stances 为 [stance_a, stance_b]
 *     - 同组 >2 队：每支队伍独立随机分配正/反方，写入 team_stances；
 *       stance_a/stance_b 留空
 *
 * @throws Error topics 与 groups 数量不匹配
 */
export function assignGroupStances(
  topics: Topic[],
  groups: TeamGroup[],
  teamsByGroup: Map<string, Team[]>,
  isRoundRobin: boolean
): Array<Omit<DrawSessionItem, 'id' | 'session_id'>> {
  if (topics.length !== groups.length) {
    throw new Error(
      `分组模式题数与分组数不匹配：topics=${topics.length}, groups=${groups.length}`
    )
  }

  const items: Array<Omit<DrawSessionItem, 'id' | 'session_id'>> = []
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const topic = topics[i]
    const teamsInGroup = teamsByGroup.get(group.id) ?? []
    if (teamsInGroup.length === 0) {
      throw new Error(`分组「${group.name}」下无队伍`)
    }

    // 多队同题：team_ids 数组
    const teamIds = teamsInGroup.map((t) => t.id)
    // 队伍名快照（与 team_ids 一一对应）
    const teamNames = teamsInGroup.map((t) => t.name)

    let stanceA: string | null = null
    let stanceB: string | null = null
    let teamAId: string | null = null
    let teamBId: string | null = null
    let teamAName: string | null = null
    let teamBName: string | null = null
    // team_stances 默认为空字符串数组（循环赛情形）
    let teamStances: string[] = teamIds.map(() => '')

    if (!isRoundRobin) {
      if (teamsInGroup.length === 2) {
        // 同组 2 队：随机分配正反方，写入 stance_a/stance_b
        const [t0, t1] = teamsInGroup
        const aIsPro = coinFlip()
        teamAId = t0.id
        teamBId = t1.id
        stanceA = aIsPro ? '正方' : '反方'
        stanceB = aIsPro ? '反方' : '正方'
        teamAName = t0.name
        teamBName = t1.name
        // team_stances 与 team_ids 顺序对应：[t0 持方, t1 持方]
        teamStances = [stanceA, stanceB]
      } else {
        // 同组 >2 队：两两配对分配持方，相邻两位一正一反
        // 遵循"默认同一行的对打"原则：相邻两队为一对，每对内部 aIsPro 随机
        const pairStances: string[] = []
        for (let j = 0; j < teamsInGroup.length; j += 2) {
          if (j + 1 < teamsInGroup.length) {
            // 一对：一正一反
            const aIsPro = coinFlip()
            pairStances.push(aIsPro ? '正方' : '反方')
            pairStances.push(aIsPro ? '反方' : '正方')
          } else {
            // P1-9 修复：奇数队最后一人无对手，持方设为空字符串
            pairStances.push('')
          }
        }
        teamStances = pairStances
      }
    }

    items.push({
      topic_id: topic.id,
      team_a_id: teamAId,
      team_b_id: teamBId,
      stance_a: stanceA,
      stance_b: stanceB,
      topic_title: topic.title,
      team_a_name: teamAName,
      team_b_name: teamBName,
      team_ids: teamIds,
      team_stances: teamStances,
      team_names: teamNames,
      group_id: group.id
    })
  }

  return items
}

// ============================================================
// 步骤 5c：多队同题持方分配（multi_team 模式）
// ============================================================

/**
 * 多队同题模式：按 teamsPerTopic 个队伍一组打同一题。
 *
 * 约定：
 *   - teams.length 必须能被 teamsPerTopic 整除，否则抛错
 *   - 题数 = teams.length / teamsPerTopic
 *   - 队伍随机分组（shuffle 后切片）
 *   - team_ids 写入队伍 id 数组
 *   - team_names 写入队伍名快照（与 team_ids 一一对应）
 *   - team_a_id / team_b_id / group_id 留空（null）
 *
 * 持方策略（由 isRoundRobin 控制）：
 *   - isRoundRobin=true（循环赛）：team_stances 为空字符串数组（与 team_ids 等长）
 *   - isRoundRobin=false（非循环赛）：每支队伍随机分配正/反方，写入 team_stances
 *
 * @throws Error teams.length 不能被 teamsPerTopic 整除
 */
export function assignMultiTeamStances(
  topics: Topic[],
  teams: Team[],
  teamsPerTopic: number,
  isRoundRobin: boolean,
  userPairing: boolean
): Array<Omit<DrawSessionItem, 'id' | 'session_id'>> {
  if (teamsPerTopic < 2) {
    throw new Error('每题队伍数 ≥2')
  }
  if (teams.length % teamsPerTopic !== 0) {
    throw new Error('队伍数需为每题队伍数的整数倍')
  }

  const expectedTopicCount = teams.length / teamsPerTopic
  if (topics.length !== expectedTopicCount) {
    throw new Error(
      `多队同题模式题数与分组数不匹配：topics=${topics.length}, expected=${expectedTopicCount}`
    )
  }

  // v6: 根据 user_pairing 标记智能决定是否 shuffle
  // - user_pairing=true：teams 来自 TeamPairing 扁平化，保留配对顺序，不 shuffle
  // - user_pairing=false 或未传：teams 来自 eventStore，shuffle 后配对，随机对阵
  let shuffled: Team[]
  if (userPairing) {
    // 保留用户 TeamPairing 配对顺序
    shuffled = [...teams]
  } else {
    // 无用户配置，Fisher-Yates shuffle 后随机配对
    shuffled = [...teams]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
  }

  const items: Array<Omit<DrawSessionItem, 'id' | 'session_id'>> = []
  for (let i = 0; i < expectedTopicCount; i++) {
    const topic = topics[i]
    const chunk = shuffled.slice(i * teamsPerTopic, (i + 1) * teamsPerTopic)
    const teamIds = chunk.map((t) => t.id)
    const teamNames = chunk.map((t) => t.name)
    // 循环赛：team_stances 全为空字符串；非循环赛：两两配对分配持方，相邻两位一正一反
    const teamStances = isRoundRobin
      ? teamIds.map(() => '')
      : (() => {
          // 两两配对分配持方，相邻两位一正一反
          const pairStances: string[] = []
          for (let j = 0; j < chunk.length; j += 2) {
            if (j + 1 < chunk.length) {
              const aIsPro = coinFlip()
              pairStances.push(aIsPro ? '正方' : '反方')
              pairStances.push(aIsPro ? '反方' : '正方')
            } else {
              // P1-9 修复：奇数队最后一人无对手，持方设为空字符串
              pairStances.push('')
            }
          }
          return pairStances
        })()

    items.push({
      topic_id: topic.id,
      team_a_id: null,
      team_b_id: null,
      stance_a: null,
      stance_b: null,
      topic_title: topic.title,
      team_a_name: null,
      team_b_name: null,
      team_ids: teamIds,
      team_stances: teamStances,
      team_names: teamNames,
      group_id: null
    })
  }

  return items
}

// ============================================================
// 步骤 6a：题池充足性校验（gate）
// ============================================================

/**
 * 校验候选题池是否满足需要抽取的数量。
 *
 * - allow_repeat=true（允许辩题重复）：跳过检查（有放回可凑够）
 * - 否则：candidates.length < count 时抛 InsufficientTopicsError
 *
 * @throws InsufficientTopicsError 候选不足且不允许重复
 */
export function assertSufficientTopics(
  candidates: Topic[],
  count: number,
  allowRepeat?: boolean
): void {
  if (!allowRepeat && candidates.length < count) {
    throw new InsufficientTopicsError(candidates.length, count)
  }
}

// ============================================================
// 步骤 6b：Selection Stage — 加权随机抽取 / 去重
// ============================================================

/**
 * 从候选池中抽取 count 道辩题（纯函数，无 repo 依赖）。
 *
 * 由 options 决定抽样策略：
 *   - `sourceMixConsumed=true`：来源比例 stage 已完成抽取，直接截取前 count 道
 *     （保持与既有 drawTopics 分支一致）；allow_repeat 该项下不再二次抽样。
 *   - `allowRepeat=true && !sourceMixConsumed`：有放回加权抽取（允许重复凑够）。
 *   - 其余（普通无放回）：无放回加权抽取，结果天然去重。
 *
 * 注意：当 sourceMixConsumed=false 且候选为空时，weightedRandomSelect 会抛错，
 * 调用方应先用 assertSufficientTopics 保证题池充足。
 */
export function selectTopics(
  candidates: Topic[],
  count: number,
  options: { allowRepeat?: boolean; sourceMixConsumed?: boolean } = {}
): Topic[] {
  const { allowRepeat = false, sourceMixConsumed = false } = options

  if (allowRepeat && !sourceMixConsumed) {
    return weightedRandomSelectWithReplacement(candidates, count)
  }
  if (sourceMixConsumed) {
    return candidates.slice(0, count)
  }
  return weightedRandomSelect(candidates, count)
}

// ============================================================
// 步骤 9a：Persistence — session.settings 数据准备（纯函数）
// ============================================================

/** buildSessionSettings 的输入（来源：抽题过程中的中间状态）。 */
export interface BuildSessionSettingsInput {
  event_id: string
  round_id?: string | null
  operator?: string
  /** 实际生效题数 */
  topic_count: number
  include_stance: boolean
  filters?: TopicFilter | null
  source_mix_ratio?: SourceMixRatio | null
  actual_ratio?: { official: number; custom: number } | null
  round_difficulty_override?: string | null
  solo_team_id?: string | null
  draw_mode: 'versus' | 'group' | 'multi_team'
  group_ids?: string[] | null
  /** 多队模式下每题队伍数（其他模式传 null/0） */
  teams_per_topic: number | null
  is_test: boolean
  allow_repeat: boolean
}

/**
 * 构建会话 settings 快照（供 createSession 落库）。纯函数。
 */
export function buildSessionSettings(input: BuildSessionSettingsInput) {
  return {
    topic_count: input.topic_count,
    include_stance: input.include_stance,
    filters: input.filters ?? null,
    source_mix_ratio: input.source_mix_ratio ?? null,
    actual_ratio: input.actual_ratio ?? null,
    round_difficulty_override: input.round_difficulty_override ?? null,
    solo_team_id: input.solo_team_id ?? null,
    draw_mode: input.draw_mode,
    group_ids: input.draw_mode === 'group' ? input.group_ids ?? null : null,
    teams_per_topic: input.draw_mode === 'multi_team' ? input.teams_per_topic || null : null,
    is_test: input.is_test,
    allow_repeat: input.allow_repeat
  }
}

// ============================================================
// 步骤 10a：Persistence — 审计 detail 数据准备（纯函数）
// ============================================================

/** buildAuditDetail 的输入（来源：抽题过程中的中间状态）。 */
export interface BuildAuditDetailInput {
  event_id: string
  round_id?: string | null
  /** 实际生效题数 */
  topic_count: number
  include_stance: boolean
  team_count: number
  solo_team_id?: string | null
  filters?: TopicFilter | null
  source_mix_ratio?: SourceMixRatio | null
  actual_ratio?: { official: number; custom: number } | null
  picked_topic_ids: string[]
  session_id: string
  draw_mode: 'versus' | 'group' | 'multi_team'
  group_ids?: string[] | null
  /** 多队模式下每题队伍数（其他模式传 null/0） */
  teams_per_topic: number | null
  is_test: boolean
  allow_repeat: boolean
}

/**
 * 构建审计日志 detail 快照（供 auditRepo.addLog 使用）。纯函数。
 */
export function buildAuditDetail(input: BuildAuditDetailInput) {
  return {
    event_id: input.event_id,
    round_id: input.round_id ?? null,
    topic_count: input.topic_count,
    include_stance: input.include_stance,
    team_count: input.team_count,
    solo_team_id: input.solo_team_id ?? null,
    filters: input.filters ?? null,
    source_mix_ratio: input.source_mix_ratio ?? null,
    actual_ratio: input.actual_ratio ?? null,
    picked_topic_ids: input.picked_topic_ids,
    session_id: input.session_id,
    draw_mode: input.draw_mode,
    group_ids: input.draw_mode === 'group' ? input.group_ids ?? null : null,
    teams_per_topic: input.draw_mode === 'multi_team' ? input.teams_per_topic || null : null,
    is_test: input.is_test,
    allow_repeat: input.allow_repeat
  }
}

// ============================================================
// 主函数：drawTopics
// ============================================================

/**
 * 抽取辩题主函数。
 *
 * 编排顺序见文件头注释。
 *
 * 抽取模式（params.draw_mode）：
 *   - versus（默认）：一对一对战，沿用 assignStances 逻辑
 *   - group：按分组同题，每题分配给同组所有队伍（题数 = 分组数）
 *   - multi_team：多队同题，按 teamsPerTopic 个队伍一组打同一题
 *
 * 单人持方模式（params.solo_team_id 存在）下：
 *   - 跳过对战模式队伍数量校验
 *   - 每道题由该队伍出战，引擎随机分配正反方
 *   - team_b_id / stance_b 均为 null
 *
 * 测试模式（params.test_mode=true）：
 *   - 跳过 applyExclusions（不排除本赛事已抽 + 队伍历史）
 *   - settings.is_test=true（结果列表/历史列表显示"测试"徽章）
 *   - 不调用 eventRepo.addTeamHistory（实际守卫在 confirmDrawSession IPC handler）
 *   - 默认应配合 allow_repeat=true 使用（测试模式通常小题库 + 需凑满）
 *
 * 允许辩题重复（params.allow_repeat=true）：
 *   - 跳过题池不足检查（InsufficientTopicsError）
 *   - 加权抽取改用 weightedRandomSelectWithReplacement（有放回抽样）
 *   - applySourceMixRatio 子池抽取也改用有放回抽样
 *   - 返回结果可能含同一 topic_id 多次出现
 *
 * 验证场景（SubTask 2.5）：
 *   - 场景：allow_repeat=true 且候选 2 道、需要 4 道
 *     期望：跳过 InsufficientTopicsError 检查；weightedRandomSelectWithReplacement
 *           从 2 道中有放回抽 4 次，返回 4 道且可能含重复（同一 topic_id 出现多次）。
 *     校验点：pickedTopics.length === 4；new Set(pickedTopics.map(t=>t.id)).size <= 2。
 *
 * 验证场景（SubTask 2.6）：
 *   - 场景：test_mode=true
 *     期望：applyExclusions 不被调用（candidates 保留全部 active 题库）；
 *           settings.is_test===true；audit_logs.detail.is_test===true；
 *           drawTopics 主函数内不调用 addTeamHistory（确认结果时由 IPC 层守卫跳过）。
 *     校验点：session.settings.is_test === true；mock eventRepo.addTeamHistory 在
 *           drawTopics 调用期间无调用（实际调用发生在 confirmDrawSession）。
 *
 * @throws InsufficientTopicsError 题池不足（allow_repeat=true 时不会抛）
 * @throws Error 队伍数量不合法（对战模式 include_stance=true 时）
 * @throws Error 单人模式下 solo_team_id 对应队伍不存在
 * @throws Error group 模式下未选分组或分组下无队伍
 * @throws Error multi_team 模式下 teams_per_topic<2 或队伍数不能整除
 */
export function drawTopics(params: DrawParams): DrawResult {
  const isSoloMode = !!params.solo_team_id
  const drawMode: 'versus' | 'group' | 'multi_team' = params.draw_mode ?? 'versus'

  // ===== 分组模式预校验 + 拉取分组与队伍 =====
  let groupsForMode: TeamGroup[] = []
  let teamsByGroup: Map<string, Team[]> = new Map()
  let multiTeamList: Team[] = []
  let teamsPerTopicForMode = 0

  if (drawMode === 'group') {
    if (!params.group_ids || params.group_ids.length === 0) {
      throw new Error('请选择至少一个分组')
    }
    // 拉取赛事下全部分组，过滤出选中的
    const allGroups = eventRepo.listGroupsByEvent(params.event_id)
    const groupMap = new Map(allGroups.map((g) => [g.id, g]))
    groupsForMode = []
    for (const gid of params.group_ids) {
      const g = groupMap.get(gid)
      if (!g) continue
      groupsForMode.push(g)
      // v6: group 模式组内随机配对，回退 v5 的 TeamPairing 过滤逻辑
      // 恢复从数据库查询同组队伍（ORDER BY name ASC），然后 Fisher-Yates shuffle
      // 确保同组队伍的"谁打谁"是随机的，而非按用户配置或字典序
      let teamsInGroup: Team[] = eventRepo.listTeamsByEvent(params.event_id, { group_id: gid })

      // Fisher-Yates shuffle 打乱同组队伍顺序
      // 之后的 assignGroupStances 会按相邻两队配对，shuffle 确保配对关系随机
      for (let i = teamsInGroup.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[teamsInGroup[i], teamsInGroup[j]] = [teamsInGroup[j], teamsInGroup[i]]
      }

      if (teamsInGroup.length === 0) {
        throw new Error(`分组「${g.name}」下无队伍`)
      }
      teamsByGroup.set(gid, teamsInGroup)
    }
    if (groupsForMode.length === 0) {
      throw new Error('请选择至少一个分组')
    }
  } else if (drawMode === 'multi_team') {
    teamsPerTopicForMode = params.teams_per_topic ?? 0
    if (teamsPerTopicForMode < 2) {
      throw new Error('每题队伍数 ≥2')
    }
    multiTeamList = params.teams ?? []
    if (multiTeamList.length === 0) {
      // 若未传 teams，从赛事拉取全部
      multiTeamList = eventRepo.listTeamsByEvent(params.event_id)
    }
    if (multiTeamList.length === 0) {
      throw new Error('赛事下无队伍')
    }
    if (multiTeamList.length % teamsPerTopicForMode !== 0) {
      throw new Error('队伍数需为每题队伍数的整数倍')
    }
  }

  // 校验队伍（仅 versus / solo 模式）
  let soloTeam: Team | null = null
  if (drawMode === 'versus') {
    if (isSoloMode) {
      // 单人模式：不校验 teams 数量，但 solo_team_id 必须能查到队伍
      soloTeam = eventRepo.getTeamById(params.solo_team_id!) ?? null
      if (!soloTeam) {
        throw new Error(`单人模式队伍不存在：${params.solo_team_id}`)
      }
    } else if (params.include_stance) {
      // 对战模式：要求 teams >= 2 且为偶数
      if (!params.teams || params.teams.length < 2 || params.teams.length % 2 !== 0) {
        throw new Error('队伍数量必须为 ≥2 的偶数')
      }
    }
  }

  // ===== 计算实际需要的题数 =====
  // group 模式：题数 = 分组数（覆盖用户输入）
  // multi_team 模式：题数 = 队伍数 / teams_per_topic（覆盖用户输入）
  // versus 模式：保持用户输入 params.topic_count
  let effectiveTopicCount = params.topic_count
  if (drawMode === 'group') {
    effectiveTopicCount = groupsForMode.length
  } else if (drawMode === 'multi_team') {
    effectiveTopicCount = multiTeamList.length / teamsPerTopicForMode
  }

  // 1. 构建候选题池
  let candidates = buildCandidatePool(params)

  // 2. 排除（测试模式跳过）
  if (!params.test_mode) {
    candidates = applyExclusions(candidates, params)
  }

  // 2.5. 抽题选库：按选题模式解析候选库 topic ids 过滤候选池
  // 显式传 group_id 时仍按单一题库过滤（现状优先），不再做模式解析；
  // 未传 group_id 时按事件 bank_config 解析候选库，无可选库则回退全库（现状）。
  const bankCtx: ResolveBankContext = {
    getEventBankConfig: (id) => topicGroupRepo.getEventBankConfig(id),
    listGroupsByEvent: (id) => topicGroupRepo.listGroupsByEvent(id),
    listGroupsByRound: (id) => topicGroupRepo.listGroupsByRound(id),
    listTopicIdsByGroup: (id) => topicGroupRepo.listTopicIdsByGroup(id)
  }
  if (params.group_id) {
    const groupTopicIds = new Set(topicGroupRepo.listTopicIdsByGroup(params.group_id))
    candidates = candidates.filter((t) => groupTopicIds.has(t.id))
  } else {
    const bankTopicIds = resolveBankTopicIds(params, bankCtx)
    if (bankTopicIds !== null) {
      const bankSet = new Set(bankTopicIds)
      candidates = candidates.filter((t) => bankSet.has(t.id))
    }
  }

  // 3. 查询轮次
  let round: Round | null = null
  if (params.round_id) {
    round = eventRepo.getRoundById(params.round_id) ?? null
  }
  // 读取循环赛标志：group / multi_team 模式下传给持方分配函数
  const isRoundRobin = round?.is_round_robin ?? false

  // 4. 难度 override 过滤
  candidates = applyDifficultyOverride(candidates, round, effectiveTopicCount)

  // 5. 题源混合比例
  let actualRatio: { official: number; custom: number } | undefined
  if (params.source_mix_ratio) {
    const { picked, actualRatio: r } = applySourceMixRatio(
      candidates,
      params.source_mix_ratio,
      effectiveTopicCount,
      params.allow_repeat
    )
    candidates = picked
    actualRatio = r
  } else {
    // 不混合，直接加权抽取前先检查数量
  }

  // 6. 题池不足检查（allow_repeat 跳过，因为可重复抽取）
  assertSufficientTopics(candidates, effectiveTopicCount, params.allow_repeat)

  // 7. 加权随机抽取（Selection Stage）
  const pickedTopics: Topic[] = selectTopics(candidates, effectiveTopicCount, {
    allowRepeat: params.allow_repeat,
    // source_mix_ratio 已完成抽取（含 allow_repeat 情形），直接截取
    sourceMixConsumed: !!params.source_mix_ratio
  })

  // 8. 持方分配（按模式分支）
  let items: Array<Omit<DrawSessionItem, 'id' | 'session_id'>>
  if (drawMode === 'group') {
    // 分组同题模式：每题分配给同组所有队伍
    items = assignGroupStances(pickedTopics, groupsForMode, teamsByGroup, isRoundRobin)
  } else if (drawMode === 'multi_team') {
    // 多队同题模式：按 teamsPerTopic 个队伍一组打同一题
    items = assignMultiTeamStances(
      pickedTopics,
      multiTeamList,
      teamsPerTopicForMode,
      isRoundRobin,
      params.user_pairing ?? false
    )
  } else if (isSoloMode && soloTeam) {
    // 单人持方模式：每道题由该队伍出战，引擎随机分配正反方
    items = assignSoloStances(pickedTopics, soloTeam)
  } else if (params.include_stance) {
    // 对战模式：两两配对 + 随机正反方
    items = assignStances(pickedTopics, params.teams!)
  } else {
    // 不分配持方：仅写入 topic_title 快照，team_*_name 为 null
    items = pickedTopics.map((t) => ({
      topic_id: t.id,
      team_a_id: null,
      team_b_id: null,
      stance_a: null,
      stance_b: null,
      topic_title: t.title,
      team_a_name: null,
      team_b_name: null
    }))
  }

  // 9. 落库（Persistence：settings + items 交给 createSession）
  const session = drawRepo.createSession({
    event_id: params.event_id,
    round_id: params.round_id ?? null,
    operator: params.operator,
    settings: buildSessionSettings({
      event_id: params.event_id,
      round_id: params.round_id,
      operator: params.operator,
      topic_count: effectiveTopicCount,
      include_stance: params.include_stance,
      filters: params.filters ?? null,
      source_mix_ratio: params.source_mix_ratio ?? null,
      actual_ratio: actualRatio ?? null,
      round_difficulty_override: round?.difficulty_override ?? null,
      solo_team_id: params.solo_team_id ?? null,
      draw_mode: drawMode,
      group_ids: params.group_ids ?? null,
      teams_per_topic: drawMode === 'multi_team' ? teamsPerTopicForMode || null : null,
      is_test: params.test_mode === true,
      allow_repeat: params.allow_repeat === true
    }),
    items
  })

  // 10. 审计
  // 注：drawTopics 主函数本身不调用 eventRepo.addTeamHistory（team_history 的写入在
  //     confirmDrawSession IPC handler 中）。测试模式的实际守卫位置在 confirmDrawSession：
  //     当 session.settings.is_test=true 时跳过 addTeamHistory 调用，避免污染队伍历史。
  //     此处仅记录审计日志，不写 team_history。
  auditRepo.addLog({
    action: 'draw',
    target_type: 'session',
    target_id: session.id,
    operator: params.operator ?? 'unknown',
    detail: buildAuditDetail({
      event_id: params.event_id,
      round_id: params.round_id,
      topic_count: effectiveTopicCount,
      include_stance: params.include_stance,
      team_count: params.teams?.length ?? 0,
      solo_team_id: params.solo_team_id ?? null,
      filters: params.filters ?? null,
      source_mix_ratio: params.source_mix_ratio ?? null,
      actual_ratio: actualRatio ?? null,
      picked_topic_ids: pickedTopics.map((t) => t.id),
      session_id: session.id,
      draw_mode: drawMode,
      group_ids: params.group_ids ?? null,
      teams_per_topic: drawMode === 'multi_team' ? teamsPerTopicForMode || null : null,
      is_test: params.test_mode === true,
      allow_repeat: params.allow_repeat === true
    })
  })

  return {
    session,
    topics: pickedTopics,
    actual_ratio: actualRatio
  }
}
