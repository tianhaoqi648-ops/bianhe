// ============================================================
// 系统字段定义（统一来源）
//
// 将「表头别名」与「字段元数据」合并到一处管理，替代 import-engine
// 原有的 HEADER_MAPPING 常量。导入引擎通过 SYSTEM_FIELD_ALIAS_MAP
// 自动识别系统字段，未命中的表头进入 unmatchedColumns 由用户在
// FieldMappingPanel 中手动绑定。
// ============================================================

import type { FieldDefinition } from './types'

/** 系统内置字段定义（与 SYSTEM_CANDIDATES 对齐） */
export const SYSTEM_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: 'title',
    label: '标题',
    type: 'string',
    aliases: ['标题', '题目', '辩题', '辩题标题', '名称', 'title', 'topic'],
    isSystem: true,
    isCountable: false
  },
  {
    key: 'type',
    label: '类型',
    type: 'string',
    aliases: ['类型', '辩题类型', 'type', 'category'],
    isSystem: true,
    isCountable: true
  },
  {
    key: 'domain',
    label: '领域',
    type: 'string',
    aliases: ['领域', '主题领域', '分类', 'domain'],
    isSystem: true,
    isCountable: true
  },
  {
    key: 'difficulty',
    label: '难度',
    type: 'string',
    aliases: ['难度', '难度等级', 'difficulty', 'level'],
    isSystem: true,
    isCountable: true
  },
  {
    key: 'source',
    label: '来源',
    type: 'string',
    aliases: ['来源', '出处', 'source'],
    isSystem: true,
    isCountable: true
  },
  {
    key: 'source_type',
    label: '来源类型',
    type: 'string',
    aliases: ['来源类型', 'source_type', 'sourcetype', '来源类别'],
    isSystem: true,
    isCountable: true
  },
  {
    key: 'status',
    label: '状态',
    type: 'string',
    aliases: ['状态', 'status'],
    isSystem: true,
    isCountable: true
  },
  {
    key: 'tags',
    label: '标签',
    type: 'tags',
    aliases: ['标签', '标记', 'tags', 'tag'],
    isSystem: true,
    isCountable: true
  },
  {
    key: 'weight',
    label: '权重',
    type: 'number',
    aliases: ['权重', '权值', 'weight', 'Weight', 'WEIGHT'],
    isSystem: true,
    isCountable: false,
    description: '辩题权重，影响抽取概率'
  }
]

/** 系统字段 key 集合（用于区分系统字段与自定义字段） */
export const SYSTEM_FIELD_KEYS = new Set<string>(
  SYSTEM_FIELD_DEFINITIONS.map((f) => f.key)
)

/**
 * 系统字段别名反向映射表（小写 → fieldKey）
 * 供 import-engine 的小写化表头匹配使用
 */
export const SYSTEM_FIELD_ALIAS_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const f of SYSTEM_FIELD_DEFINITIONS) {
    for (const a of f.aliases) map[a.toLowerCase()] = f.key
  }
  return map
})()

/** 系统字段 key → label 映射（供 UI 显示） */
export const SYSTEM_FIELD_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const f of SYSTEM_FIELD_DEFINITIONS) map[f.key] = f.label
  return map
})()
