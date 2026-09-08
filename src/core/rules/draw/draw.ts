// ============================================================
// core/rules/draw/draw.ts — 抽题规则（Bianhe Core 单真源）
//
// 源：小程序 cloud/functions/draw/draw-engine.js 纯规则移植（TS 化）
// 编排/落库（confirm service、ownership、event、team_history 等）留在端侧，
// 本模块仅含：候选处理 / 难度覆盖 / 题源混合 / 持方分配 / 纯编排 drawFromPool。
// 铁律：零外部 import（仅 core 内部）。
// ============================================================

import {
  coinFlip,
  weightedRandomSelect,
  weightedRandomSelectWithReplacement,
  applyDifficultyDistribution
} from './probability'
import { getDifficultyDistribution } from '../difficulty'

export { getDifficultyDistribution, DIFFICULTY_LEVELS } from '../difficulty'
export type { DifficultyLevel, DifficultyDistribution } from '../difficulty'
export { coinFlip, weightedRandomSelect, weightedRandomSelectWithReplacement, applyDifficultyDistribution } from './probability'

/** 候选对象约定字段 */
export interface DrawCandidate {
  id: string
  source_type: string | null
  difficulty: string | null
  title: string
  weight: number
}

/** 抽取结果 item 约定字段 */
export interface DrawItem {
  topic_id: string
  team_a_id: string | null
  team_b_id: string | null
  stance_a: string | null
  stance_b: string | null
  topic_title: string | null
  team_a_name: string | null
  team_b_name: string | null
  team_ids?: string[] | null
  team_stances?: string[] | null
  team_names?: string[] | null
  group_id?: string | null
}

/** 题池不足错误 */
export class InsufficientTopicsError extends Error {
  candidateCount: number
  requiredCount: number
  constructor(candidateCount: number, requiredCount: number) {
    super(`题池不足：候选 ${candidateCount} 道，需要 ${requiredCount} 道`)
    this.name = 'InsufficientTopicsError'
    this.candidateCount = candidateCount
    this.requiredCount = requiredCount
  }
}

/** 防重复：剔除已抽/队伍历史中出现过的候选 */
export function applyExclusionsByIds<T extends { id: string }>(
  candidates: T[],
  drawnIds: Set<string>,
  teamHistoryIds: Set<string>
): T[] {
  return candidates.filter((t) => !drawnIds.has(t.id) && !teamHistoryIds.has(t.id))
}

/** 难度覆盖：round.distribution 预计算直用；否则按 round.difficulty_override 关键词分布 */
export function applyDifficultyOverride<T extends DrawCandidate>(
  candidates: T[],
  round: { distribution?: Record<string, number>; difficulty_override?: string } | null | undefined,
  count: number
): T[] {
  if (!round) return candidates
  if (round.distribution) {
    return applyDifficultyDistribution(candidates as any, round.distribution as any, count)
  }
  if (round.difficulty_override) {
    const distribution = getDifficultyDistribution(round.difficulty_override)
    return applyDifficultyDistribution(candidates as any, distribution as any, count)
  }
  return candidates
}

/** 官方题判定（兼容中文 seed 与英文导入） */
function isOfficialTopic(t: DrawCandidate | null | undefined): boolean {
  return !!t && (t.source_type === '官方' || t.source_type === 'official')
}

/**
 * 按 official:custom 比例从候选池分层抽样。
 * 返回 { picked, actualRatio: {official, custom} }。
 */
export function applySourceMixRatio<T extends DrawCandidate>(
  candidates: T[],
  ratio: { official: number; custom: number },
  count: number,
  allowRepeat?: boolean
): { picked: T[]; actualRatio: { official: number; custom: number } } {
  if (count <= 0 || candidates.length === 0) {
    return { picked: [], actualRatio: { official: 0, custom: 0 } }
  }
  const officialPool = candidates.filter(isOfficialTopic)
  const customPool = candidates.filter((t) => !isOfficialTopic(t))
  const officialTarget = Math.floor(count * ratio.official)
  const customTarget = count - officialTarget
  const picked: T[] = []
  const officialRemaining: T[] = []
  const customRemaining: T[] = []
  if (officialTarget > 0 && officialPool.length > 0) {
    if (allowRepeat) {
      picked.push(...weightedRandomSelectWithReplacement(officialPool, officialTarget))
      officialRemaining.push(...officialPool)
    } else {
      const actual = Math.min(officialTarget, officialPool.length)
      const pickedOfficial = weightedRandomSelect(officialPool, actual)
      picked.push(...pickedOfficial)
      const pickedSet = new Set(pickedOfficial)
      for (const t of officialPool) if (!pickedSet.has(t)) officialRemaining.push(t)
    }
  } else {
    officialRemaining.push(...officialPool)
  }
  if (customTarget > 0 && customPool.length > 0) {
    if (allowRepeat) {
      picked.push(...weightedRandomSelectWithReplacement(customPool, customTarget))
      customRemaining.push(...customPool)
    } else {
      const actual = Math.min(customTarget, customPool.length)
      const pickedCustom = weightedRandomSelect(customPool, actual)
      picked.push(...pickedCustom)
      const pickedSet = new Set(pickedCustom)
      for (const t of customPool) if (!pickedSet.has(t)) customRemaining.push(t)
    }
  } else {
    customRemaining.push(...customPool)
  }
  const deficit = count - picked.length
  if (deficit > 0) {
    const remaining = [...officialRemaining, ...customRemaining]
    if (remaining.length > 0) {
      if (allowRepeat) {
        picked.push(...weightedRandomSelectWithReplacement(remaining, deficit))
      } else {
        picked.push(...weightedRandomSelect(remaining, Math.min(deficit, remaining.length)))
      }
    }
  }
  const actualOfficial = picked.filter(isOfficialTopic).length
  const actualCustom = picked.length - actualOfficial
  return {
    picked,
    actualRatio: {
      official: picked.length > 0 ? actualOfficial / picked.length : 0,
      custom: picked.length > 0 ? actualCustom / picked.length : 0
    }
  }
}

interface TeamLike {
  id: string
  name: string
}

/** versus 对战：队伍两两配对，按题轮转配对并分配正反方 */
export function assignStances<T extends DrawCandidate>(
  topics: T[],
  teams: TeamLike[],
  userPairing = false
): DrawItem[] {
  if (teams.length < 2 || teams.length % 2 !== 0) {
    throw new Error('队伍数量必须为 ≥2 的偶数')
  }
  let paired = teams
  if (!userPairing) {
    paired = [...teams]
    for (let i = paired.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[paired[i], paired[j]] = [paired[j], paired[i]]
    }
  }
  const pairs: TeamLike[][] = []
  for (let i = 0; i < paired.length; i += 2) pairs.push([paired[i], paired[i + 1]])
  const pairUseCount = new Array(pairs.length).fill(0)
  const items: DrawItem[] = []
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i]
    const pairIdx = i % pairs.length
    const pair = pairs[pairIdx]
    const aIsPro = pairUseCount[pairIdx] === 0 ? coinFlip() : pairUseCount[pairIdx] % 2 === 0
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

/** 单人持方：每道题给独奏队伍随机正反方 */
export function assignSoloStances<T extends DrawCandidate>(
  topics: T[],
  soloTeam: TeamLike
): DrawItem[] {
  const items: DrawItem[] = []
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i]
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

interface GroupLike {
  id: string
  name: string
}

/** 分组同题：每组一题，组内队伍分配持方（非循环赛） */
export function assignGroupStances<T extends DrawCandidate>(
  topics: T[],
  groups: GroupLike[],
  teamsByGroup: Map<string, TeamLike[]>,
  isRoundRobin?: boolean
): DrawItem[] {
  if (topics.length !== groups.length) {
    throw new Error(`分组模式题数与分组数不匹配：topics=${topics.length}, groups=${groups.length}`)
  }
  const items: DrawItem[] = []
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const topic = topics[i]
    const teamsInGroup = teamsByGroup.get(group.id) ?? []
    if (teamsInGroup.length === 0) throw new Error(`分组「${group.name}」下无队伍`)
    const teamIds = teamsInGroup.map((t) => t.id)
    const teamNames = teamsInGroup.map((t) => t.name)
    let stanceA: string | null = null
    let stanceB: string | null = null
    let teamAId: string | null = null
    let teamBId: string | null = null
    let teamAName: string | null = null
    let teamBName: string | null = null
    let teamStances: string[] = teamIds.map(() => '')
    if (!isRoundRobin) {
      if (teamsInGroup.length === 2) {
        const [t0, t1] = teamsInGroup
        const aIsPro = coinFlip()
        teamAId = t0.id
        teamBId = t1.id
        stanceA = aIsPro ? '正方' : '反方'
        stanceB = aIsPro ? '反方' : '正方'
        teamAName = t0.name
        teamBName = t1.name
        teamStances = [stanceA, stanceB]
      } else {
        const pairStances: string[] = []
        for (let j = 0; j < teamsInGroup.length; j += 2) {
          if (j + 1 < teamsInGroup.length) {
            const aIsPro = coinFlip()
            pairStances.push(aIsPro ? '正方' : '反方')
            pairStances.push(aIsPro ? '反方' : '正方')
          } else {
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

/** 多队同题：每题 teamsPerTopic 支队伍，按 chunk 分配持方 */
export function assignMultiTeamStances<T extends DrawCandidate>(
  topics: T[],
  teams: TeamLike[],
  teamsPerTopic: number,
  isRoundRobin?: boolean,
  userPairing?: boolean
): DrawItem[] {
  if (teamsPerTopic < 2) throw new Error('每题队伍数 ≥2')
  if (teams.length % teamsPerTopic !== 0) throw new Error('队伍数需为每题队伍数的整数倍')
  const expectedTopicCount = teams.length / teamsPerTopic
  if (topics.length !== expectedTopicCount) {
    throw new Error(`多队同题模式题数与分组数不匹配：topics=${topics.length}, expected=${expectedTopicCount}`)
  }
  const shuffled = teams.slice()
  if (!userPairing) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
  }
  const items: DrawItem[] = []
  for (let i = 0; i < expectedTopicCount; i++) {
    const topic = topics[i]
    const chunk = shuffled.slice(i * teamsPerTopic, (i + 1) * teamsPerTopic)
    const teamIds = chunk.map((t) => t.id)
    const teamNames = chunk.map((t) => t.name)
    const teamStances = isRoundRobin
      ? teamIds.map(() => '')
      : (() => {
          const pairStances: string[] = []
          for (let j = 0; j < chunk.length; j += 2) {
            if (j + 1 < chunk.length) {
              const aIsPro = coinFlip()
              pairStances.push(aIsPro ? '正方' : '反方')
              pairStances.push(aIsPro ? '反方' : '正方')
            } else {
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

// ---- drawFromPool 入参/出参（纯编排契约，端侧 handler 组装数据后调用） ----

export interface DrawPoolParams {
  topic_count: number
  include_stance: boolean
  teams?: TeamLike[]
  source_mix_ratio?: { official: number; custom: number }
  solo_team_id?: string
  draw_mode?: 'versus' | 'group' | 'multi_team'
  teams_per_topic?: number
  allow_repeat?: boolean
  user_pairing?: boolean
}

export interface DrawPoolOptions {
  round?: { distribution?: Record<string, number>; difficulty_override?: string; is_round_robin?: boolean } | null
  groups?: GroupLike[]
  teamsByGroup?: Map<string, TeamLike[]>
  soloTeam?: TeamLike
}

/**
 * 从候选题池中抽取辩题（纯函数，无副作用）。
 * 编排顺序：难度 override → 题源混合 → 题池不足检查 → 加权抽取 → 持方分配。
 */
export function drawFromPool<T extends DrawCandidate>(
  candidates: T[],
  params: DrawPoolParams,
  options?: DrawPoolOptions
): { topics: T[]; items: DrawItem[]; actual_ratio?: { official: number; custom: number }; effective_topic_count: number } {
  options = options || {}
  const isSoloMode = !!params.solo_team_id
  const drawMode = params.draw_mode ?? 'versus'
  const round = options.round ?? null
  const isRoundRobin = !!(round && round.is_round_robin)

  let effectiveTopicCount = params.topic_count
  if (drawMode === 'group') {
    effectiveTopicCount = (options.groups && options.groups.length) || 0
  } else if (drawMode === 'multi_team') {
    const teamsPerTopic = params.teams_per_topic || 0
    const teamList = params.teams || []
    effectiveTopicCount = teamsPerTopic > 0 ? Math.floor(teamList.length / teamsPerTopic) : 0
  }

  let pool: T[] = applyDifficultyOverride(candidates, round, effectiveTopicCount)

  let actualRatio: { official: number; custom: number } | undefined
  if (params.source_mix_ratio) {
    const { picked, actualRatio: r } = applySourceMixRatio(
      pool,
      params.source_mix_ratio,
      effectiveTopicCount,
      params.allow_repeat
    )
    pool = picked
    actualRatio = r
  }

  if (!params.allow_repeat && pool.length < effectiveTopicCount) {
    throw new InsufficientTopicsError(pool.length, effectiveTopicCount)
  }

  let pickedTopics: T[]
  if (params.allow_repeat && !params.source_mix_ratio) {
    pickedTopics = weightedRandomSelectWithReplacement(pool, effectiveTopicCount)
  } else if (params.source_mix_ratio) {
    pickedTopics = pool.slice(0, effectiveTopicCount)
  } else {
    pickedTopics = weightedRandomSelect(pool, effectiveTopicCount)
  }

  let items: DrawItem[]
  if (drawMode === 'group') {
    if (!options.groups || !options.teamsByGroup) {
      throw new Error('group 模式需要提供 groups 和 teamsByGroup')
    }
    items = assignGroupStances(pickedTopics, options.groups, options.teamsByGroup, isRoundRobin)
  } else if (drawMode === 'multi_team') {
    items = assignMultiTeamStances(
      pickedTopics,
      params.teams || [],
      params.teams_per_topic || 2,
      isRoundRobin,
      params.user_pairing || false
    )
  } else if (isSoloMode && options.soloTeam) {
    items = assignSoloStances(pickedTopics, options.soloTeam)
  } else if (params.include_stance) {
    if (!params.teams || params.teams.length < 2 || params.teams.length % 2 !== 0) {
      throw new Error('队伍数量必须为 ≥2 的偶数')
    }
    items = assignStances(pickedTopics, params.teams, params.user_pairing)
  } else {
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

  return {
    topics: pickedTopics,
    items,
    actual_ratio: actualRatio,
    effective_topic_count: effectiveTopicCount
  }
}
