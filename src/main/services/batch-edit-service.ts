// ============================================================
// services/batch-edit-service.ts — 批量编辑撤销编排服务
//
// 职责（Governance Task 6 - Repository 去直接依赖）：
//   撤销一次批量编辑需要在「恢复 topic 字段」和「标记历史已撤销」之间编排，
//   这是跨库（topics × batch_edit_history）业务编排。原先写在
//   batch-edit-history.repo.revertHistory 内（仓库内部跨 repo 编排），
//   现上移到 Service 层：事务与顺序在此编排，各仓库只做单库单动作：
//     - topicRepo：查/改 topics 表
//     - batchEditHistoryRepo：读历史明细、标记 reverted
// ============================================================

import { getDb } from '../db'
import { topicRepo } from '../db/repository/topic.repo'
import { batchEditHistoryRepo } from '../db/repository/batch-edit-history.repo'
import type { CustomFieldValue } from '../../shared/types'

/**
 * 撤销一次批量编辑：按 before 快照恢复 topic 字段值，再标记历史已撤销。
 * - 在事务内执行：先逐条恢复 topics，再标记 history.reverted=true
 * - topic 已删除的项跳过（不计入 restoredCount）
 * - 已撤销的历史记录不可再次撤销
 *
 * @param historyId 历史 id
 * @returns restoredCount 实际恢复的 topic 数
 */
export function revertBatchEditHistory(historyId: string): number {
  const db = getDb()

  const fn = db.transaction(() => {
    const history = batchEditHistoryRepo.getHistoryById(historyId)
    if (!history) {
      throw new Error(`[batch-edit-service] history not found: ${historyId}`)
    }
    if (history.reverted) {
      throw new Error(
        `[batch-edit-service] history already reverted: ${historyId}`
      )
    }

    const items = batchEditHistoryRepo.listItemsByHistory(historyId)
    let restored = 0

    for (const item of items) {
      if (!item.before_values) continue
      // 检查 topic 是否存在
      const topic = topicRepo.getTopicById(item.topic_id)
      if (!topic) continue // topic 已删除，跳过

      // 按 before_values 恢复字段
      // before_values key 约定：系统字段名 或 'custom_data.<fieldKey>'
      const update: Record<string, unknown> = {}
      const customDataPatch: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(item.before_values)) {
        if (key.startsWith('custom_data.')) {
          const fieldKey = key.slice('custom_data.'.length)
          if (value === null) {
            customDataPatch[fieldKey] = undefined // 标记删除
          } else {
            customDataPatch[fieldKey] = value
          }
        } else {
          update[key] = value
        }
      }

      // 合并 custom_data：保留当前 custom_data 中未在快照内的字段
      if (Object.keys(customDataPatch).length > 0) {
        const merged: Record<string, CustomFieldValue> = {
          ...(topic.custom_data ?? {})
        }
        for (const [k, v] of Object.entries(customDataPatch)) {
          if (v === undefined) {
            delete merged[k]
          } else {
            merged[k] = v as CustomFieldValue
          }
        }
        update.custom_data = Object.keys(merged).length > 0 ? merged : null
      }

      topicRepo.updateTopic(item.topic_id, update as never)
      restored++
    }

    batchEditHistoryRepo.markReverted(historyId)

    return restored
  })

  return fn()
}