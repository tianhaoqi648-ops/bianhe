// ============================================================
// judge.ipc.ts — AI 裁判历史（judge_history）IPC handlers
//
// 提供 listHistory / getHistory / saveHistory / deleteHistory 四个通道，
// 供渲染进程持久化与读取 AI 裁判结果历史（跨页/重启保留）。
// ============================================================

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { JudgeHistoryCreateInput, JudgeHistoryFilter } from '../../shared/types'
import { judgeHistoryRepo } from '../db/repository/judge-history.repo'
import { wrap } from './utils'

/** 参数校验（仿 match.ipc.ts / format.ipc.ts） */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function registerJudgeIpc(): void {
  ipcMain.handle(IPC_CHANNELS.JUDGE_LIST_HISTORY, (_e, filter?: JudgeHistoryFilter) =>
    wrap(() => {
      assertParam(filter === undefined || (filter && typeof filter === 'object'), '参数 filter 必须为对象或省略')
      return judgeHistoryRepo.getList(filter ?? {})
    })
  )

  ipcMain.handle(IPC_CHANNELS.JUDGE_GET_HISTORY, (_e, id: string) =>
    wrap(() => {
      assertParam(typeof id === 'string' && id.length > 0, '参数 id 必须为非空字符串')
      return judgeHistoryRepo.get(id)
    })
  )

  ipcMain.handle(IPC_CHANNELS.JUDGE_SAVE_HISTORY, (_e, input: JudgeHistoryCreateInput) =>
    wrap(() => {
      assertParam(input && typeof input === 'object', '参数 input 必须为对象')
      assertParam(typeof input.toolName === 'string' && input.toolName.length > 0, 'input.toolName 必须为非空字符串')
      return judgeHistoryRepo.create(input)
    })
  )

  ipcMain.handle(IPC_CHANNELS.JUDGE_DELETE_HISTORY, (_e, id: string) =>
    wrap(() => {
      assertParam(typeof id === 'string' && id.length > 0, '参数 id 必须为非空字符串')
      return judgeHistoryRepo.delete(id)
    })
  )
}