// ============================================================
// timer.ipc.ts — 计时会话 IPC handlers
// ============================================================

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { timerSessionRepo } from '../db/repository/timer-session.repo'
import type { DebateFormatData, TimerSession } from '../../shared/types'
import type { StageSide } from '../../shared/debate-formats/types'
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

/** 校验非空字符串 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

export function registerTimerIpc(): void {
  // P2-18：TIMER_CREATE_SESSION/DELETE_SESSION 跳过改用 wrapWithUndo。原因：
  //   UndoLogEntry.store_name 类型仅支持 'topic' | 'event' | 'draw' | 'customField' | 'settings'，
  //   无 'timer' store。改用 wrapWithUndo 会导致 TypeScript 类型错误，且 applyReverse
  //   未实现 'timer' store 的反向操作（需恢复 timer_sessions 及关联 timer_records）。
  //   需先扩展 undo-service 的 store_name 类型与 applyReverse/applyForward，超出本 Bug 范围。
  ipcMain.handle(IPC_CHANNELS.TIMER_CREATE_SESSION, (_e, opts: {
    formatId: string
    formatSnapshot: DebateFormatData
    label?: string
    eventId?: string
    roundId?: string
    teamAffId?: string
    teamNegId?: string
    topicId?: string
    eventName?: string
    teamAffName?: string
    teamNegName?: string
    topicTitle?: string
  }) => {
    return wrap(() => {
      assertParam(opts && typeof opts === 'object', '参数 opts 必须为对象')
      assertNonEmptyString(opts.formatId, 'formatId')
      assertParam(opts.formatSnapshot && typeof opts.formatSnapshot === 'object', '参数 formatSnapshot 必须为对象')
      return timerSessionRepo.create(opts)
    })
  })

  ipcMain.handle(IPC_CHANNELS.TIMER_GET_SESSION, (_e, id: string) => {
    return wrap(() => {
      assertNonEmptyString(id, 'id')
      return timerSessionRepo.getById(id)
    })
  })

  ipcMain.handle(IPC_CHANNELS.TIMER_LIST_SESSIONS, (_e, limit?: number) =>
    wrap(() => {
      assertParam(limit === undefined || (typeof limit === 'number' && limit > 0), 'limit 必须为正整数')
      return timerSessionRepo.listRecent(limit ?? 50)
    })
  )

  ipcMain.handle(IPC_CHANNELS.TIMER_UPDATE_SESSION, (_e, id: string, opts: Partial<Pick<TimerSession, 'status' | 'startedAt' | 'endedAt' | 'currentStageIndex' | 'currentSide' | 'remainingMs' | 'stageRemainingCache' | 'affRemainingMs' | 'negRemainingMs' | 'affPoolRemainingMs' | 'negPoolRemainingMs'>>) => {
    return wrap(() => {
      assertNonEmptyString(id, 'id')
      assertParam(opts && typeof opts === 'object', '参数 opts 必须为对象')
      return timerSessionRepo.update(id, opts)
    })
  })

  ipcMain.handle(IPC_CHANNELS.TIMER_DELETE_SESSION, (_e, id: string) => {
    return wrap(() => {
      assertNonEmptyString(id, 'id')
      return timerSessionRepo.delete(id)
    })
  })

  ipcMain.handle(IPC_CHANNELS.TIMER_LIST_RECORDS, (_e, sessionId: string) => {
    return wrap(() => {
      assertNonEmptyString(sessionId, 'sessionId')
      return timerSessionRepo.listRecords(sessionId)
    })
  })

  // 结束会话：状态置为 finished + 写 endedAt
  ipcMain.handle(IPC_CHANNELS.TIMER_FINISH_SESSION, (_e, id: string, endedAt: string) => {
    return wrap(() => {
      assertNonEmptyString(id, 'id')
      assertNonEmptyString(endedAt, 'endedAt')
      return timerSessionRepo.update(id, {
        status: 'finished',
        endedAt
      })
    })
  })

  // 新增计时记录
  ipcMain.handle(
    IPC_CHANNELS.TIMER_ADD_RECORD,
    (_e, opts: {
      sessionId: string
      stageIndex: number
      stageName: string
      side: StageSide
      durationMs: number
      startedAt: string
    }) => {
      return wrap(() => {
        assertParam(opts && typeof opts === 'object', '参数 opts 必须为对象')
        assertNonEmptyString(opts.sessionId, 'sessionId')
        assertParam(typeof opts.stageIndex === 'number', '参数 stageIndex 必须为数字')
        assertParam(typeof opts.durationMs === 'number', '参数 durationMs 必须为数字')
        return timerSessionRepo.addRecord(opts)
      })
    }
  )

  // 完成计时记录（写 actualMs / endedAt / pauseCount）
  ipcMain.handle(
    IPC_CHANNELS.TIMER_FINISH_RECORD,
    (_e, sessionId: string, stageIndex: number, actualMs: number, endedAt: string, pauseCount: number) => {
      return wrap(() => {
        assertNonEmptyString(sessionId, 'sessionId')
        assertParam(typeof stageIndex === 'number', '参数 stageIndex 必须为数字')
        assertParam(typeof actualMs === 'number', '参数 actualMs 必须为数字')
        assertNonEmptyString(endedAt, 'endedAt')
        return timerSessionRepo.finishRecord(sessionId, stageIndex, actualMs, endedAt, pauseCount)
      })
    }
  )

  // 导出会话的所有计时记录
  ipcMain.handle(IPC_CHANNELS.TIMER_EXPORT_RECORDS, (_e, sessionId: string) => {
    return wrap(() => {
      assertNonEmptyString(sessionId, 'sessionId')
      return timerSessionRepo.exportRecords(sessionId)
    })
  })
}
