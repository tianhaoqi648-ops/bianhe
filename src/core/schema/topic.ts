// ============================================================
// core/schema/topic.ts — 辩题实体 schema（Bianhe Core 单真源）
//
// 源：桌面抽辩题 src/shared/types.ts L18-19（CustomFieldValue）+ L67-132（Topic 族）
// 【双源登记】与 shared/types.ts 同名类型结构一致、独立声明；改动需同步两处。
// 铁律：零外部 import（仅 core 内部）。
// ============================================================

/** 自定义字段值类型（字符串或字符串数组） */
export type CustomFieldValue = string | string[]

export interface Topic {
  id: string
  title: string
  type: string | null
  domain: string | null
  difficulty: string | null
  source: string | null
  source_type: string | null
  tags: string[] | null
  weight: number
  status: string
  batch_id: string | null
  created_at: string
  updated_at: string
  /** 自定义字段值（key → value），来自 topics.custom_data JSON 列 */
  custom_data?: Record<string, CustomFieldValue> | null
}

export interface TopicFilter {
  type?: string
  domain?: string
  difficulty?: string
  source?: string
  source_type?: string
  status?: string
  tags?: string[]
  keyword?: string
  page?: number
  pageSize?: number
  batch_id?: string
  // 多选字段（与上面单值字段二选一使用，数组优先）
  types?: string[]
  domains?: string[]
  difficulties?: string[]
  /** 自定义字段筛选：fieldKey → 目标值（仅支持 string 类型字段，tags 类型用 tags 数组语义） */
  custom_filters?: Record<string, string>
}

export interface TopicCreateInput {
  title: string
  type?: string | null
  domain?: string | null
  difficulty?: string | null
  source?: string | null
  source_type?: string | null
  tags?: string[] | null
  weight?: number
  status?: string
  batch_id?: string | null
  /** 自定义字段值 */
  custom_data?: Record<string, CustomFieldValue> | null
}

export interface TopicUpdateInput {
  title?: string
  type?: string | null
  domain?: string | null
  difficulty?: string | null
  source?: string | null
  source_type?: string | null
  tags?: string[] | null
  weight?: number
  status?: string
  /** 自定义字段值（整体覆盖） */
  custom_data?: Record<string, CustomFieldValue> | null
}
