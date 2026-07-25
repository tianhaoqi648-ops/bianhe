// ============================================================
// draw.ipc.ts — 抽取相关 IPC handler
//
// 注册通道：
//   draw:execute        执行抽取
//   draw:listSessions   列出抽取会话
//   draw:getSession     获取会话详情
//   draw:deleteSession  删除会话
//   draw:listDrawnTopicIds  已抽取辩题 ID 列表
//   draw:redo           重抽（删除旧会话 + 用相同参数重新抽取）
//
// 重抽组合 drawRepo.deleteSession + drawTopics，并写 action='redraw' 审计日志。
// ============================================================

import { ipcMain } from 'electron'
import { drawRepo } from '../db/repository/draw.repo'
import type { SessionFilter } from '../db/repository/draw.repo'
import { auditRepo } from '../db/repository/audit.repo'
import { drawTopics } from '../services/draw-engine'
import type { DrawParams } from '../services/draw-engine'
import { IPC_CHANNELS, type ApiResponse } from '../../shared/types'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerDrawIpc(): void {
  // 执行抽取
  ipcMain.handle(IPC_CHANNELS.DRAW_EXECUTE, (_e, params: DrawParams) =>
    wrap(() => drawTopics(params))
  )

  // 列出抽取会话
  ipcMain.handle(IPC_CHANNELS.DRAW_LIST_SESSIONS, (_e, filter?: SessionFilter) =>
    wrap(() => drawRepo.listSessions(filter))
  )

  // 获取会话详情
  ipcMain.handle(IPC_CHANNELS.DRAW_GET_SESSION, (_e, id: string) =>
    wrap(() => drawRepo.getSessionById(id))
  )

  // 删除会话
  ipcMain.handle(IPC_CHANNELS.DRAW_DELETE_SESSION, (_e, id: string) =>
    wrap(() => drawRepo.deleteSession(id))
  )

  // 已抽取辩题 ID 列表
  ipcMain.handle(IPC_CHANNELS.DRAW_LIST_DRAWN_TOPIC_IDS, (_e, eventId: string) =>
    wrap(() => drawRepo.listDrawnTopicIdsByEvent(eventId))
  )

  // 重抽：删除旧会话 + 用相同参数重新抽取
  ipcMain.handle(
    IPC_CHANNELS.DRAW_REDO,
    (_e, oldSessionId: string, params: DrawParams) =>
      wrap(() => {
        // 1. 查旧会话拿 settings（便于审计）
        const oldSession = drawRepo.getSessionById(oldSessionId)
        // 2. 删除旧会话
        drawRepo.deleteSession(oldSessionId)
        // 3. 重新抽取
        const result = drawTopics(params)
        // 4. 额外审计：redraw 动作
        auditRepo.addLog({
          action: 'redraw',
          target_type: 'session',
          target_id: result.session.id,
          operator: params.operator ?? 'unknown',
          detail: {
            old_session_id: oldSessionId,
            old_session_settings: oldSession?.settings ?? null,
            new_session_id: result.session.id
          }
        })
        return result
      })
  )
}
