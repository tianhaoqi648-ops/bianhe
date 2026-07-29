// ============================================================
// undo.ipc.ts — 撤销/重做 IPC handler
//
// 注册通道：
//   system:undo          撤销最近一次操作（或指定 logId）
//   system:redo          重做最近一次撤销的操作（或指定 logId）
//   system:listUndoLog   列出最近 N 条 undo log
//   system:clearUndoLog  清空 undo_log 表（数据重置用）
// ============================================================

import { ipcMain } from 'electron'
import { executeUndo, executeRedo } from '../services/undo-service'
import { undoLogRepo } from '../db/repository/undo-log.repo'
import { IPC_CHANNELS } from '../../shared/types'
import type { UndoRequest, RedoRequest } from '../../shared/types'
// L3 修复：使用公共 wrap 函数，避免重复定义
import { wrap } from './utils'

/**
 * P2-23：参数校验辅助函数。
 * 校验失败时抛出友好错误，由 wrap 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export function registerUndoIpc(): void {
  // 撤销最近一次操作（或指定 logId）
  ipcMain.handle(IPC_CHANNELS.SYSTEM_UNDO, (_e, req?: UndoRequest) =>
    wrap(() => {
      if (req !== undefined) {
        assertParam(typeof req === 'object', '参数 req 必须为对象')
      }
      return executeUndo(req?.logId)
    })
  )

  // 重做最近一次撤销的操作（或指定 logId）
  // H3 修复：完整实现 Redo 功能
  ipcMain.handle(IPC_CHANNELS.SYSTEM_REDO, (_e, req?: RedoRequest) =>
    wrap(() => {
      if (req !== undefined) {
        assertParam(typeof req === 'object', '参数 req 必须为对象')
      }
      return executeRedo(req?.logId)
    })
  )

  // 列出最近 N 条 undo log（默认 50）
  ipcMain.handle(IPC_CHANNELS.SYSTEM_LIST_UNDO_LOG, (_e, limit?: number) =>
    wrap(() => {
      if (limit !== undefined) {
        assertParam(typeof limit === 'number' && limit > 0, 'limit 必须为正整数')
      }
      return undoLogRepo.listRecent(limit ?? 50)
    })
  )

  // 清空 undo_log 表
  ipcMain.handle(IPC_CHANNELS.SYSTEM_CLEAR_UNDO_LOG, () =>
    wrap(() => undoLogRepo.clearAll())
  )
}
