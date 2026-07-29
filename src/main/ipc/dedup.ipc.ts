// ============================================================
// dedup.ipc.ts — 去重检查 IPC handler
//
// 注册通道：
//   dedup:run           对全库辩题执行去重检测，返回重复组
//   dedup:deleteTopics  批量删除指定 id 的辩题
//
// 利用 services/dedup-engine 的 findDuplicates 完成实际比对。
// ============================================================

import { ipcMain } from 'electron'
import { findDuplicates } from '../services/dedup-engine'
import type { DedupOptions, DuplicateGroup } from '../services/dedup-engine'
import { topicRepo } from '../db/repository/topic.repo'
import { auditRepo } from '../db/repository/audit.repo'
import { withUndoLog } from '../services/undo-service'
import { wrapWithUndo } from './utils'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type DedupRunResult
} from '../../shared/types'

/**
 * P2-23：参数校验辅助函数。
 * 校验失败时抛出友好错误，由 wrap/wrapWithUndo 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export function registerDedupIpc(): void {
  // ---------- 全库去重检查 ----------
  ipcMain.handle(
    IPC_CHANNELS.DEDUP_RUN,
    async (_e, options?: DedupOptions): Promise<ApiResponse<DedupRunResult>> => {
      try {
        // P3-5: pageSize=100000 作为全量拉取的 workaround（topicRepo 无 listAll 方法）
        const { items } = topicRepo.listTopics({ page: 1, pageSize: 100000 })
        const groups: DuplicateGroup[] = await findDuplicates(items, options)
        const duplicateCount = groups.reduce(
          (sum, g) => sum + g.topics.length,
          0
        )
        return {
          success: true,
          data: {
            groups,
            totalCount: items.length,
            duplicateCount
          }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // ---------- 批量删除（去重后一键清理） ----------
  // P2-22：改用 wrapWithUndo 支持撤销。
  // storeName='topic'、action='batchDelete'，applyTopicReverse 已实现批量删除的反向恢复
  // （遍历 before.topics 逐条 recreateTopicWithId 重建）。
  ipcMain.handle(
    IPC_CHANNELS.DEDUP_DELETE_TOPICS,
    (_e, ids: string[]): ApiResponse<{ deleted: number }> => {
      // 采集 before 快照（删除前的所有 topic），在 withUndoLog 事务外预读以避免事务嵌套问题
      // P1: 将 ids.map 移入 wrapWithUndo 回调，确保校验失败时返回统一 ApiResponse 格式
      const response = wrapWithUndo(() => {
        assertParam(Array.isArray(ids), 'ids')
        const beforeTopics = ids
          .map((id) => topicRepo.getTopicById(id))
          .filter((t): t is NonNullable<typeof t> => t !== undefined)

        return withUndoLog({
          storeName: 'topic',
          action: 'batchDelete',
          targetType: 'topic',
          targetId: null,
          label: `去重清理 ${ids.length} 条辩题`,
          getBefore: () => ({ topics: beforeTopics }),
          execute: () => {
            const deleted = topicRepo.batchDeleteTopics(ids)
            return { deleted }
          },
          getAfter: () => null
        })
      })

      // 审计日志失败不影响主流程，辩题已实际删除时仍返回 success:true
      if (response.success) {
        try {
          auditRepo.addLog({
            action: 'delete',
            target_type: 'topic',
            target_id: 'bulk-dedup',
            operator: 'renderer',
            detail: { action: 'dedup_delete', count: response.data?.deleted ?? 0, ids }
          })
        } catch (logErr) {
          console.error('[dedup.ipc] DEDUP_DELETE_TOPICS: 写入审计日志失败', logErr)
        }
      }
      return response
    }
  )
}
