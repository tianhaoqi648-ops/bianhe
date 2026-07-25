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
import {
  IPC_CHANNELS,
  type ApiResponse,
  type DedupRunResult
} from '../../shared/types'

export function registerDedupIpc(): void {
  // ---------- 全库去重检查 ----------
  ipcMain.handle(
    IPC_CHANNELS.DEDUP_RUN,
    async (_e, options?: DedupOptions): Promise<ApiResponse<DedupRunResult>> => {
      try {
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
  ipcMain.handle(
    IPC_CHANNELS.DEDUP_DELETE_TOPICS,
    (_e, ids: string[]): ApiResponse<{ deleted: number }> => {
      try {
        const deleted = topicRepo.batchDeleteTopics(ids)
        auditRepo.addLog({
          action: 'delete',
          target_type: 'topic',
          target_id: 'bulk-dedup',
          operator: 'renderer',
          detail: { action: 'dedup_delete', count: deleted, ids }
        })
        return { success: true, data: { deleted } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
