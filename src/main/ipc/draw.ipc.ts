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
//   draw:getItemByTopicId  按 topic_id 查询最近一条多队模式抽取明细（大屏多队渲染用）
//
// 重抽组合 drawRepo.deleteSession + drawTopics，并写 action='redraw' 审计日志。
// M1 修复：DRAW_REDO 包裹 withUndoLog，使重抽可撤销。
// ============================================================

import { ipcMain } from 'electron'
import { drawRepo } from '../db/repository/draw.repo'
import type { SessionFilter } from '../db/repository/draw.repo'
import { auditRepo } from '../db/repository/audit.repo'
import { drawTopics } from '../services/draw-engine'
import type { DrawParams } from '../services/draw-engine'
import { IPC_CHANNELS } from '../../shared/types'
import { withUndoLog } from '../services/undo-service'
import { wrap, wrapWithUndo } from './utils'

/**
 * P2-23：参数校验辅助函数。
 * 校验失败时抛出友好错误，由 wrap/wrapWithUndo 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/** 校验非空字符串 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

// ------------------------------------------------------------
// P5-024：DRAW_EXECUTE 幂等防护（main 层，不依赖 renderer disabled）。
// 双击/重复派发的同一请求在 TTL 窗口内命中指纹缓存，直接返回首次结果——
// 不产生第二个 session、第二条 undo/audit。drawTopics 为同步事务，IPC 顺序
// 处理下第二次请求到达时首次已完成，缓存必然可判定。
// 两个真正不同的合法抽取（params 不同）不受影响；删除会话时主动失效，
// 「删除后用相同参数重新抽取」等场景不会被误伤。重抽走 DRAW_REDO 独立通道。
// ------------------------------------------------------------
const DRAW_EXEC_TTL_MS = 3000
let lastDrawExec: { fingerprint: string; at: number; result: unknown } | null = null

function invalidateDrawExecCache(): void {
  lastDrawExec = null
}

export function registerDrawIpc(): void {
  // 执行抽取
  ipcMain.handle(IPC_CHANNELS.DRAW_EXECUTE, (_e, params: DrawParams) => {
    // P5-024：幂等守卫——TTL 窗口内相同 params 的重复请求返回首次结果
    const fingerprint = JSON.stringify(params ?? null)
    if (
      lastDrawExec &&
      lastDrawExec.fingerprint === fingerprint &&
      Date.now() - lastDrawExec.at < DRAW_EXEC_TTL_MS
    ) {
      return lastDrawExec.result
    }
    const result = wrapWithUndo(() => {
      assertParam(params && typeof params === 'object', '参数 params 必须为对象')
      assertNonEmptyString(params.event_id, 'event_id')
      assertParam(typeof params.topic_count === 'number' && params.topic_count > 0, '参数 topic_count 必须为正整数')
      return withUndoLog({
        storeName: 'draw',
        action: 'execute',
        targetType: 'session',
        targetId: null,
        label: `执行抽取（${params.topic_count} 题）`,
        getBefore: () => ({ params }),
        execute: () => drawTopics(params),
        getAfter: (result) => result
      })
    })
    // 仅缓存成功结果——失败（如题数不足）的响应不缓存，用户修正参数后立即重试
    if ((result as { success?: boolean } | null)?.success === true) {
      lastDrawExec = { fingerprint, at: Date.now(), result }
    }
    return result
  })

  // 列出抽取会话
  ipcMain.handle(IPC_CHANNELS.DRAW_LIST_SESSIONS, (_e, filter?: SessionFilter) =>
    wrap(() => drawRepo.listSessions(filter))
  )

  // 获取会话详情
  ipcMain.handle(IPC_CHANNELS.DRAW_GET_SESSION, (_e, id: string) => {
    return wrap(() => {
      assertNonEmptyString(id, 'id')
      return drawRepo.getSessionById(id)
    })
  })

  // 删除会话
  // 返回格式验证（SubTask 3.7）：
  //   - 成功：{ success: true, data: true }
  //   - 失败：{ success: false, error: string }
  // 验证场景：
  //   1. 传入有效 session id → 删除 session 及其 items/team_history，返回 { success: true, data: true }
  //   2. 传入不存在的 session id → deleteSession 抛错，返回 { success: false, error: '会话不存在' }
  //   3. 数据库异常（如外键约束失败）→ deleteSession 抛错，返回 { success: false, error: <异常信息> }
  // P4-9: 返回 data: true 是 workaround，因渲染层 drawStore.deleteSession 调用 extractError(res)
  //       要求 res.data !== undefined，否则抛 '未知错误'。前端 extractError 修复后可改为 { success: true }。
  //       当前前端仍依赖 data:true（drawStore.ts L116-120），故保留 workaround。
  ipcMain.handle(IPC_CHANNELS.DRAW_DELETE_SESSION, async (_event, id: string) => {
    try {
      assertNonEmptyString(id, 'id')
      // P5-006：已确认会话（结果已计入队伍历史）禁止删除（main 层守卫，不可被 renderer 绕过）
      drawRepo.assertSessionNotConfirmed(id)
      drawRepo.deleteSession(id)
      // P5-024：删除会话后失效幂等缓存——「删除后用相同参数重新抽取」是合法的新一次抽取
      invalidateDrawExecCache()
      return { success: true, data: true }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : '删除失败'
      }
    }
  })

  // 已抽取辩题 ID 列表
  ipcMain.handle(IPC_CHANNELS.DRAW_LIST_DRAWN_TOPIC_IDS, (_e, eventId: string) => {
    return wrap(() => {
      assertNonEmptyString(eventId, 'eventId')
      return drawRepo.listDrawnTopicIdsByEvent(eventId)
    })
  })

  // Task 6.7：按 topic_id 查询最近一条多队模式抽取明细（大屏多队渲染用）
  ipcMain.handle(IPC_CHANNELS.DRAW_GET_ITEM_BY_TOPIC, (_e, topicId: string) => {
    return wrap(() => {
      assertNonEmptyString(topicId, 'topicId')
      return drawRepo.getItemByTopicId(topicId)
    })
  })

  // 重抽：删除旧会话 + 用相同参数重新抽取
  // M1 修复：包裹 withUndoLog，使重抽可撤销
  // Critical-4 修复：action 使用 'redraw'（而非 'execute'），让 applyDrawReverse
  //                  能识别并恢复旧 session；before 快照包含 oldSession 完整数据。
  ipcMain.handle(
    IPC_CHANNELS.DRAW_REDO,
    (_e, oldSessionId: string, params: DrawParams) => {
      // 使用 ref 对象保存 oldSession，避免 TypeScript 控制流 narrowing 问题
      // oldSession 在 wrapWithUndo 内查询（参数校验后），但需在外部审计日志中读取
      const ctx: {
        oldSession: ReturnType<typeof drawRepo.getSessionById>
      } = {
        oldSession: undefined as ReturnType<typeof drawRepo.getSessionById>
      }

      // 1. 在 withUndoLog 事务内执行：参数校验 → 查询旧会话 → 删除旧会话 + 重新抽取
      //    参数校验放 wrapWithUndo 内，确保校验失败时返回统一 ApiResponse 格式
      const response = wrapWithUndo(() => {
        assertNonEmptyString(oldSessionId, 'oldSessionId')
        assertParam(params && typeof params === 'object', '参数 params 必须为对象')
        assertNonEmptyString(params.event_id, 'event_id')
        assertParam(typeof params.topic_count === 'number' && params.topic_count > 0, '参数 topic_count 必须为正整数')
        // 查询旧会话（用于审计日志 + undo before 快照，独立于 withUndoLog 事务）
        ctx.oldSession = drawRepo.getSessionById(oldSessionId)
        // P5-006：已确认会话（结果已计入队伍历史）禁止重抽（main 层守卫，
        // 不可被 renderer 绕过）；守卫在 withUndoLog 之前抛出 → 不写 log、
        // 不删除任何数据（fail-safe）
        drawRepo.assertSessionNotConfirmed(oldSessionId)
        return withUndoLog({
          storeName: 'draw',
          action: 'redraw',
          targetType: 'session',
          targetId: null,
          label: `重抽（${params.topic_count} 题）`,
          getBefore: () => ({ oldSessionId, oldSession: ctx.oldSession ?? null }),
          execute: () => {
            drawRepo.deleteSession(oldSessionId)
            return drawTopics(params)
          },
          getAfter: (result) => result
        })
      })

      // 2. 额外审计：redraw 动作（不影响 undo_log，仅记录审计日志）
      if (response.success && response.data) {
        try {
          auditRepo.addLog({
            action: 'redraw',
            target_type: 'session',
            target_id: response.data.session.id,
            operator: params.operator ?? 'unknown',
            detail: {
              old_session_id: oldSessionId,
              old_session_settings: ctx.oldSession?.settings ?? null,
              new_session_id: response.data.session.id
            }
          })
        } catch (e) {
          // P4-10: 审计日志失败不阻断主流程，但记录 console.error 便于排查
          console.error('[draw.ipc] DRAW_REDO: 写入审计日志失败', e)
        }
      }

      return response
    }
  )
}
