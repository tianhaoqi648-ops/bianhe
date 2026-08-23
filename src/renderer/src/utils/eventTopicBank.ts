// ============================================================
// eventTopicBank.ts — 赛事题库页纯逻辑（T4）
//
// 承载「赛事题库」页的关键推导，与 IPC 完全解耦，便于单测：
//   mergeGroupTopics()   合并多个绑定题组的辩题，按 topic id 去重
//   markDrawn()          用「本赛事已抽 topic id 集合」标注每题的已抽/未抽态
//   countDrawn()         统计已抽题数
//   allowRepeatFromEvent 事件字段 → 开关布尔
//   allowRepeatToFlag    开关布尔 → 事件字段（1/0）
// ============================================================

import type {
  GroupTopic,
  TopicCreateInput,
  EventBankConfig,
  DrawBankMode
} from '../../../shared/types'

/** 标注了「本赛事已抽/未抽」形态的辩题（联合 GroupTopic）。 */
export interface EventTopicItem extends GroupTopic {
  /** 该题是否在本赛事任一已确认抽取中出现过（已抽） */
  drawn: boolean
}

/**
 * 合并多个绑定题组的辩题，按 topic id 去重（保留首次出现的顺序）。
 * 答辩题可同时属于多个题组，此处消除跨组重复。
 */
export function mergeGroupTopics(groups: GroupTopic[][]): GroupTopic[] {
  const seen = new Set<string>()
  const result: GroupTopic[] = []
  for (const list of groups) {
    if (!list) continue
    for (const t of list) {
      if (t && t.id && !seen.has(t.id)) {
        seen.add(t.id)
        result.push(t)
      }
    }
  }
  return result
}

/**
 * 用「本赛事已抽 topic id 数组」标注已抽/未抽。
 * 命中即为「已抽」，未命中为「未抽」。
 */
export function markDrawn(topics: GroupTopic[], drawnTopicIds: string[]): EventTopicItem[] {
  const set = new Set(drawnTopicIds)
  return topics.map((t) => ({ ...t, drawn: !!t && set.has(t.id) }))
}

/** 统计本赛事已抽的题数。 */
export function countDrawn(items: EventTopicItem[]): number {
  return items.reduce((acc, t) => acc + (t.drawn ? 1 : 0), 0)
}

/** 事件 allow_repeat 字段（0/1/undefined） → 开关布尔值。 */
export function allowRepeatFromEvent(allowRepeat: number | undefined): boolean {
  return allowRepeat === 1
}

/** 开关布尔值 → 事件 allow_repeat 字段（1/0）。 */
export function allowRepeatToFlag(allow: boolean): number {
  return allow ? 1 : 0
}

/** 赛事题库页的搜索 / 筛选条件（T4）。 */
export interface EventTopicFilter {
  /** 标题关键字（子串匹配，忽略大小写） */
  keyword?: string
  type?: string
  domain?: string
  difficulty?: string
  /** 辩题状态（active/favorited/blacklisted） */
  status?: string
  /** 标签（命中即显示） */
  tag?: string
}

/**
 * 对合并后的赛事题库题做关键词 + 多维度筛选（纯逻辑，便于单测）。
 * 全部条件为空时原样返回；各条件取交集。
 * 泛型 T 仅需满足 GroupTopic 结构，允许直接传入全局 Topic[] 或在已标注场景传入 EventTopicItem[]。
 */
export function filterEventTopics<T extends GroupTopic>(
  topics: T[],
  filter: EventTopicFilter
): T[] {
  const kw = filter.keyword?.trim().toLowerCase()
  return topics.filter((t) => {
    if (kw && !t.title.toLowerCase().includes(kw)) return false
    if (filter.type && t.type !== filter.type) return false
    if (filter.domain && t.domain !== filter.domain) return false
    if (filter.difficulty && t.difficulty !== filter.difficulty) return false
    if (filter.status && t.status !== filter.status) return false
    if (filter.tag && !(t.tags ?? []).includes(filter.tag)) return false
    return true
  })
}

/**
 * “页内快速新建辩题”草稿 → 可写全局题库的 TopicCreateInput（纯逻辑，便于单测）。
 * - 标题去除首尾空白
 * - 标签原始串按「逗号（中英文）」切分，去空白、去空项；无标签则写 null
 * - 类型/领域/难度为空则归一化为 null
 */
export interface QuickCreateDraft {
  title: string
  type?: string | null
  domain?: string | null
  difficulty?: string | null
  tags?: string
}

export function buildQuickCreateInput(draft: QuickCreateDraft): TopicCreateInput {
  const tags = (draft.tags ?? '')
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
  return {
    title: draft.title.trim(),
    type: draft.type || null,
    domain: draft.domain || null,
    difficulty: draft.difficulty || null,
    tags: tags.length > 0 ? tags : null
  }
}

/**
 * 解绑守卫：赛事必须至少保留一个绑定题库（避免空绑定导致抽题回退范围异常）。
 * targetGroupId 缺省时视为「仅作整体判断」。
 */
export function canUnbindEventGroup(
  boundGroupIds: string[],
  targetGroupId?: string
): boolean {
  const remain = targetGroupId
    ? boundGroupIds.filter((id) => id !== targetGroupId).length
    : boundGroupIds.length
  return remain >= 1
}

// ============================================================
// T6 中途换库重复提醒 —— 纯逻辑，与 IPC 解耦，便于单测
//
//   computeBankBindConflicts 求「新绑定题库」与本赛事已抽辩题的冲突
// ============================================================

/** 单个待绑定题库的题 id 快照（含可展示名）。 */
export interface BankGroupTopics {
  /** 题库 id */
  id: string
  /** 题库展示名（缺省回退到 id） */
  name?: string
  /** 该库内的辩题 id */
  topicIds: string[]
}

/** 单个题库命中本赛事已抽辩题的冲突项。 */
export interface BankDrawnConflict {
  groupId: string
  groupName: string
  /** 该库内属于「已抽」的辩题 id（去重保序） */
  drawnIds: string[]
  /** 冲突题数（= drawnIds.length） */
  count: number
}

/** 换库重复提醒的整体报告。 */
export interface BankBindConflictReport {
  /** 含已抽题的库清单（按库分组，每个库仅返回有冲突者） */
  conflicts: BankDrawnConflict[]
  /** 冲突总题数（跨库按题 id 去重统计） */
  total: number
  /** 是否命中冲突（有任意库含已抽题） */
  hasConflict: boolean
}

/**
 * 计算「新绑定题库」与本赛事已抽辩题的冲突（T6 换库重复提醒）。
 * 对每个库取其题 id 与已抽题 id 求交集；仅返回交集非空的库。
 * 重复与否由事件 allow_repeat 决定——此处只负责「提示」，不阻断绑定。
 */
export function computeBankBindConflicts(
  groups: BankGroupTopics[],
  drawnTopicIds: string[]
): BankBindConflictReport {
  const drawnSet = new Set(drawnTopicIds)
  const conflicts: BankDrawnConflict[] = []
  const seenIds = new Set<string>()
  let total = 0
  for (const g of groups ?? []) {
    const drawnIds = Array.from(
      new Set((g.topicIds ?? []).filter((id) => id && drawnSet.has(id)))
    )
    if (drawnIds.length > 0) {
      conflicts.push({
        groupId: g.id,
        groupName: g.name ?? g.id,
        drawnIds,
        count: drawnIds.length
      })
      for (const id of drawnIds) {
        if (!seenIds.has(id)) {
          seenIds.add(id)
          total += 1
        }
      }
    }
  }
  return { conflicts, total, hasConflict: conflicts.length > 0 }
}

// ============================================================
// 赛事选题模式配置（T3）——纯逻辑，与 IPC 解耦，便于单测
//
//   moduleBankModeLabel  模式展示文案
//   buildEventBankConfig 把 UI 草稿组织成可写库的 EventBankConfig
//   planRoundBankSync    计算 by_round 下 round_topic_groups 表的增删计划
// ============================================================

/** 各选题模式的展示文案（DrawPage 提示与配置 UI 用）。 */
export const bankModeLabel: Record<DrawBankMode, string> = {
  single: '单选库',
  union: '绑定并集',
  priority: '顺序后备',
  by_round: '按轮次指定'
}

/** 选题模式配置 UI 的草稿态（用户的中间选择）。 */
export interface EventBankConfigDraft {
  mode: DrawBankMode
  /** 优先级/顺序（single 取首库、priority 全序）；只应含绑定库 id。 */
  priorityGroupIds: string[]
  /** by_round：roundId -> 该轮使用的题库 id 列表。 */
  roundBanks: Record<string, string[]>
}

/**
 * 把选模式草稿组织成可写库的 EventBankConfig（仅写入当前模式所需字段）。
 * - single：priorityOrder=[首库]
 * - union：无附加字段（engine 用事件绑定并集）
 * - priority：priorityOrder=全序
 * - by_round：roundBanks（每轮题库去重保序）
 */
export function buildEventBankConfig(draft: EventBankConfigDraft): EventBankConfig {
  const order = (draft.priorityGroupIds ?? []).filter((id) => id && id.length > 0)
  const config: EventBankConfig = { mode: draft.mode }
  if (draft.mode === 'single') {
    if (order.length > 0) config.priorityOrder = [order[0]]
  } else if (draft.mode === 'priority') {
    config.priorityOrder = order
  } else if (draft.mode === 'by_round') {
    const roundBanks: Record<string, string[]> = {}
    for (const [roundId, ids] of Object.entries(draft.roundBanks ?? {})) {
      roundBanks[roundId] = Array.from(new Set((ids ?? []).filter((id) => id && id.length > 0)))
    }
    config.roundBanks = roundBanks
  }
  return config
}

/** 一轮的 round_topic_groups 增删计划（得出后由调用方执行 bind/unbind IPC）。 */
export interface RoundBankSyncOp {
  roundId: string
  /** 需要新绑定到该轮的题库 id */
  bind: string[]
  /** 需要从该轮解绑的题库 id */
  unbind: string[]
}

/**
 * 由目标 roundBanks 与当前各轮已绑定题库，计算需执行的增删操作。
 * 返回仅含「有变更」的轮次；无变更轮次不返回。
 */
export function planRoundBankSync(
  roundBanks: Record<string, string[]>,
  currentByRound: Record<string, string[]>
): RoundBankSyncOp[] {
  const roundIds = new Set([...Object.keys(roundBanks), ...Object.keys(currentByRound)])
  const ops: RoundBankSyncOp[] = []
  for (const roundId of roundIds) {
    const target = Array.from(new Set(roundBanks[roundId] ?? []))
    const current = Array.from(new Set(currentByRound[roundId] ?? []))
    const bind = target.filter((gid) => !current.includes(gid))
    const unbind = current.filter((gid) => !target.includes(gid))
    if (bind.length > 0 || unbind.length > 0) {
      ops.push({ roundId, bind, unbind })
    }
  }
  return ops
}