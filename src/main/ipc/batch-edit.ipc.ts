// ============================================================
// batch-edit.ipc.ts — 批量编辑 IPC handler
//
// 注册通道：
//   batchEdit:execute       执行批量编辑（事务 + 快照 + 历史）
//   batchEdit:revert        撤销一次批量编辑
//   batchEdit:listHistory   列出历史记录（最多 20 条）
//
// 事务边界：execute 在单一事务内完成「批量更新 + 创建历史」，
//           保证更新与快照原子性。
// ============================================================

import { ipcMain } from 'electron'
import { topicRepo } from '../db/repository/topic.repo'
import { batchEditHistoryRepo } from '../db/repository/batch-edit-history.repo'
import { auditRepo } from '../db/repository/audit.repo'
import { getDb } from '../db'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type BatchEditExecuteRequest,
  type BatchEditExecuteResult,
  type BatchEditHistory,
  type BatchEditRevertResult
} from '../../shared/types'

/** 系统字段中文标签映射，用于生成摘要 */
const FIELD_LABELS: Record<string, string> = {
  type: '类型',
  domain: '领域',
  difficulty: '难度',
  source: '来源',
  source_type: '来源类型',
  status: '状态',
  weight: '权重',
  tags: '标签'
}

const MODE_LABELS: Record<BatchEditExecuteRequest['actions'][number]['mode'], string> = {
  replace: '替换',
  append: '追加',
  clear: '清空'
}

/**
 * 生成摘要文案，如「替换了 类型、难度 等 2 个字段的 50 条辩题」
 * 若 actions 模式不一致，使用首个动作的模式作为代表。
 */
function buildSummary(
  actions: BatchEditExecuteRequest['actions'],
  affectedCount: number
): string {
  const fieldNames = actions.map((a) => FIELD_LABELS[a.field] ?? a.field)
  const modeLabel = actions[0] ? MODE_LABELS[actions[0].mode] : '编辑'
  return `${modeLabel}了 ${fieldNames.join('、')} 等 ${actions.length} 个字段的 ${affectedCount} 条辩题`
}

export function registerBatchEditIpc(): void {
  // 执行批量编辑
  ipcMain.handle(
    IPC_CHANNELS.BATCH_EDIT_EXECUTE,
    async (
      _e,
      req: BatchEditExecuteRequest
    ): Promise<ApiResponse<BatchEditExecuteResult>> => {
      try {
        if (!req.topicIds || req.topicIds.length === 0) {
          return { success: false, error: '未选择辩题' }
        }
        if (!req.actions || req.actions.length === 0) {
          return { success: false, error: '未指定编辑动作' }
        }

        const db = getDb()

        // 在单一事务内：批量更新 + 创建历史
        const tx = db.transaction(() => {
          const updateResult = topicRepo.batchUpdateTopics(
            req.topicIds,
            req.actions
          )
          const summary = buildSummary(req.actions, updateResult.affectedCount)
          const historyId = batchEditHistoryRepo.createHistory(
            updateResult.snapshots,
            summary
          )
          return { ...updateResult, historyId }
        })

        const result = tx()

        // 审计日志（失败不阻断主流程）
        try {
          auditRepo.addLog({
            action: 'batch_edit_execute',
            target_type: 'topic',
            target_id: result.historyId,
            operator: 'renderer',
            detail: {
              topicCount: result.affectedCount,
              fieldCount: result.fieldCount,
              actions: req.actions
            }
          })
        } catch (e) {
          console.error('[batch-edit.ipc] addLog failed:', e)
        }

        return {
          success: true,
          data: {
            historyId: result.historyId,
            affectedCount: result.affectedCount,
            fieldCount: result.fieldCount
          }
        }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  // 撤销一次批量编辑
  ipcMain.handle(
    IPC_CHANNELS.BATCH_EDIT_REVERT,
    async (_e, historyId: string): Promise<ApiResponse<BatchEditRevertResult>> => {
      try {
        const history = batchEditHistoryRepo.getHistoryById(historyId)
        if (!history) {
          return { success: false, error: '历史记录不存在' }
        }
        if (history.reverted) {
          return { success: false, error: '该记录已撤销' }
        }

        const restoredCount = batchEditHistoryRepo.revertHistory(historyId)

        // 审计日志
        try {
          auditRepo.addLog({
            action: 'batch_edit_revert',
            target_type: 'topic',
            target_id: historyId,
            operator: 'renderer',
            detail: {
              restoredCount,
              originalTopicCount: history.topic_count
            }
          })
        } catch (e) {
          console.error('[batch-edit.ipc] addLog failed:', e)
        }

        return { success: true, data: { restoredCount } }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  // 列出历史记录
  // P4-11: 接受可选 limit 参数（默认 20），避免硬编码
  ipcMain.handle(
    IPC_CHANNELS.BATCH_EDIT_LIST_HISTORY,
    async (_e, limit?: number): Promise<ApiResponse<BatchEditHistory[]>> => {
      try {
        const list = batchEditHistoryRepo.listHistory(limit ?? 20)
        return { success: true, data: list }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )
}
