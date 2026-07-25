// ============================================================
// valueMapping.ts — 导入新值映射应用工具
//
// 提供三个函数：
//   applyMapping(topic, mapping)        对单条 topic 应用 map 动作改写
//   applyMappingToTopics(topics, mapping) 批量应用
//   isMappingValid(mapping)             校验所有 map 动作都有 target
//
// 设计要点：
//   - keep 动作不改写（原样入库）
//   - map 动作改写 field 值为 target
//   - add 动作不改写（主进程负责持久化到 settings 表）
//   - 空 mapping 直接返回原对象引用，避免无谓复制
// ============================================================

import type { TopicCreateInput, ValueMapping } from '../../../shared/types'
import type { CandidateField } from '../../../shared/constants'

/**
 * 对单条 topic 应用映射：action='map' 时把 field 值改写为 target。
 * keep/add 不改写（add 由主进程持久化）。
 */
export function applyMapping(
  topic: TopicCreateInput,
  mapping: ValueMapping
): TopicCreateInput {
  if (!mapping || Object.keys(mapping).length === 0) return topic
  const result = { ...topic }
  for (const field of Object.keys(mapping) as CandidateField[]) {
    const valueMap = mapping[field]
    if (!valueMap) continue
    const current = (result as any)[field] as string | null | undefined
    if (!current) continue
    const rule = valueMap[current]
    if (rule?.action === 'map' && rule.target) {
      ;(result as any)[field] = rule.target
    }
  }
  return result
}

/** 批量应用映射；空 mapping 直接返回原数组 */
export function applyMappingToTopics(
  topics: TopicCreateInput[],
  mapping: ValueMapping
): TopicCreateInput[] {
  if (!mapping || Object.keys(mapping).length === 0) return topics
  return topics.map((t) => applyMapping(t, mapping))
}

/**
 * 校验映射完整性：所有 action='map' 必须有 target 且非空。
 * 返回 { valid, invalidFields }
 */
export function isMappingValid(mapping: ValueMapping): {
  valid: boolean
  invalidFields: Array<{ field: CandidateField; value: string }>
} {
  const invalidFields: Array<{ field: CandidateField; value: string }> = []
  for (const field of Object.keys(mapping) as CandidateField[]) {
    const valueMap = mapping[field]
    if (!valueMap) continue
    for (const value of Object.keys(valueMap)) {
      const rule = valueMap[value]
      if (rule?.action === 'map' && !rule.target) {
        invalidFields.push({ field, value })
      }
    }
  }
  return { valid: invalidFields.length === 0, invalidFields }
}
