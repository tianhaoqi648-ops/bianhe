// ============================================================
// core/schema/draw.ts — 抽题实体 schema（Bianhe Core 单真源）
//
// 源：桌面抽辩题 src/shared/types.ts L296-449（Draw 族）
// 【双源登记】与 shared/types.ts 同名类型结构一致、独立声明；改动需同步两处。
// 铁律：零外部 import（仅 core 内部）。
// 注：teams 使用 DrawTeam 最小类型（{id,name}），与端侧 Team 完整实体解耦。
// ============================================================

import type { TopicFilter, Topic } from './topic'

/** 队伍最小类型（抽题引擎消费所需字段，与端侧 Team 实体解耦） */
export interface DrawTeam {
  id: string
  name: string
}

export interface DrawSessionSettings {
  source_mix_ratio?: SourceMixRatio
  difficulty_override?: Record<string, number>
  include_stance?: boolean
  team_pairs?: Array<{ team_a_id: string; team_b_id: string }>
  filter?: TopicFilter
  /** 抽取结果是否已确认写入队伍历史 */
  confirmed?: boolean
  /** 单人持方模式：记录抽取时使用的队伍 id */
  solo_team_id?: string | null
  /** 抽取模式：'versus' 对战（默认）/ 'group' 分组同题 / 'multi_team' 多队同题 */
  draw_mode?: 'versus' | 'group' | 'multi_team'
  /** group 模式下参与抽取的分组 id 列表 */
  group_ids?: string[]
  /** multi_team 模式下每道题同题的队伍数（>=2） */
  teams_per_topic?: number
  /** 实际抽取的题数（由 draw-engine 写入，group/multi_team 模式下可能覆盖用户传入值） */
  topic_count?: number
  /** 测试模式标记：true 表示该 session 为测试抽取，不写入队伍历史 */
  is_test?: boolean
}

export interface DrawSession {
  id: string
  event_id: string
  round_id: string | null
  draw_time: string | null
  operator: string | null
  settings: DrawSessionSettings | null
}

export interface DrawSessionItem {
  id: string
  session_id: string
  topic_id: string
  team_a_id: string | null
  team_b_id: string | null
  stance_a: string | null
  stance_b: string | null
  /** 冗余快照：辩题标题（避免硬删除后显示 ID 片段） */
  topic_title?: string | null
  /** 冗余快照：A 方队伍名 */
  team_a_name?: string | null
  /** 冗余快照：B 方队伍名 */
  team_b_name?: string | null
  /** 多队同题模式下的队伍 id 列表（versus 模式为空，仍使用 team_a_id/team_b_id） */
  team_ids?: string[] | null
  /** 多队持方快照（与 team_ids 一一对应） */
  team_stances?: string[] | null
  /** 队伍名快照（与 team_ids 一一对应） */
  team_names?: string[] | null
  /** 分组模式下的所属分组 id */
  group_id?: string | null
}

export interface DrawSessionDetail extends DrawSession {
  items: DrawSessionItem[]
}

export interface SessionFilter {
  event_id?: string
  round_id?: string
  operator?: string
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}

export interface SourceMixRatio {
  /** 官方题源占比，0~1 */
  official: number
  /** 自定义题源占比，0~1 */
  custom: number
}

export interface DrawParams {
  event_id: string
  round_id?: string | null
  topic_count: number
  include_stance: boolean
  teams?: DrawTeam[]
  filters?: TopicFilter
  source_mix_ratio?: SourceMixRatio
  operator?: string
  /** 单人持方模式：传一支队伍 id，引擎为每道题随机分配正反方 */
  solo_team_id?: string
  /** 抽取模式：'versus' 对战（默认）/ 'group' 分组同题 / 'multi_team' 多队同题 */
  draw_mode?: 'versus' | 'group' | 'multi_team'
  /** group 模式下参与抽取的分组 id 列表 */
  group_ids?: string[]
  /** multi_team 模式下每道题同题的队伍数（>=2） */
  teams_per_topic?: number
  /** 标记 teams 是否来自用户 TeamPairing 配置（true 保留配对顺序不 shuffle） */
  user_pairing?: boolean
  /** 测试模式：跳过 applyExclusions、不写 team_history */
  test_mode?: boolean
  /** 允许辩题重复：跳过题池不足检查，使用有放回抽样 */
  allow_repeat?: boolean
  /** 抽题选库：限定从某个题组（题库）抽取。为空时不限（全库候选）。 */
  group_id?: string | null
}

export interface DrawResult {
  session: DrawSessionDetail
  topics: Topic[]
  actual_ratio?: { official: number; custom: number }
}
