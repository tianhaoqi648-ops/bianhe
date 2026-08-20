// ============================================================
// match.ipc.ts — 比赛（matches）IPC handlers
// ============================================================

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type {
  MatchAiReview,
  MatchCreateInput,
  MatchSetResultInput,
  MatchUpdateInput
} from '../../shared/types'
import { matchRepo } from '../db/repository/match.repo'
import { wrap } from './utils'

/** 参数校验辅助（仿 format.ipc.ts） */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

export function registerMatchIpc(): void {
  ipcMain.handle(IPC_CHANNELS.MATCH_CREATE, (_e, input: MatchCreateInput) =>
    wrap(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.eventId, 'input.eventId')
      return matchRepo.create(input)
    })
  )

  ipcMain.handle(IPC_CHANNELS.MATCH_GET, (_e, id: string) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      return matchRepo.getById(id)
    })
  )

  ipcMain.handle(IPC_CHANNELS.MATCH_LIST_BY_EVENT, (_e, eventId: string) =>
    wrap(() => {
      assertNonEmptyString(eventId, 'eventId')
      return matchRepo.listByEvent(eventId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.MATCH_LIST_BY_ROUND, (_e, roundId: string) =>
    wrap(() => {
      assertNonEmptyString(roundId, 'roundId')
      return matchRepo.listByRound(roundId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.MATCH_UPDATE, (_e, id: string, input: MatchUpdateInput) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      return matchRepo.update(id, input)
    })
  )

  ipcMain.handle(IPC_CHANNELS.MATCH_SET_RESULT, (_e, id: string, input: MatchSetResultInput) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertNonEmptyString(input.winner, 'input.winner')
      return matchRepo.setResult(id, input)
    })
  )

  ipcMain.handle(IPC_CHANNELS.MATCH_SET_AI_REVIEW, (_e, id: string, review: MatchAiReview) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      assertParam(review && typeof review === 'object', '参数 review 必须为对象')
      return matchRepo.setAiReview(id, review)
    })
  )

  ipcMain.handle(IPC_CHANNELS.MATCH_LINK_SESSION, (_e, id: string, sessionId: string) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      assertNonEmptyString(sessionId, 'sessionId')
      return matchRepo.linkSession(id, sessionId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.MATCH_DELETE, (_e, id: string) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      return matchRepo.delete(id)
    })
  )
}