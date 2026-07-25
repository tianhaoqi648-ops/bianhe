// ============================================================
// event.ipc.ts — 赛事/轮次/队伍/队伍历史 IPC handler
//
// 注册通道：
//   event:list / event:get / event:create / event:update / event:event_delete
//   round:listByEvent / round:get / round:create / round:update / round:delete
//   team:listByEvent / team:get / team:create / team:update / team:delete
//   teamHistory:list / teamHistory:listByEvent / teamHistory:add / teamHistory:delete
// ============================================================

import { ipcMain } from 'electron'
import { eventRepo } from '../db/repository/event.repo'
import type {
  EventFilter,
  EventCreateInput,
  EventUpdateInput,
  RoundCreateInput,
  RoundUpdateInput,
  TeamCreateInput,
  TeamUpdateInput,
  TeamHistoryCreateInput
} from '../db/repository/event.repo'
import { IPC_CHANNELS, type ApiResponse } from '../../shared/types'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerEventIpc(): void {
  // ---------- event ----------
  ipcMain.handle(IPC_CHANNELS.EVENT_LIST, (_e, filter?: EventFilter) =>
    wrap(() => eventRepo.listEvents(filter))
  )
  ipcMain.handle(IPC_CHANNELS.EVENT_GET, (_e, id: string) =>
    wrap(() => eventRepo.getEventById(id))
  )
  ipcMain.handle(IPC_CHANNELS.EVENT_CREATE, (_e, data: EventCreateInput) =>
    wrap(() => eventRepo.createEvent(data))
  )
  ipcMain.handle(IPC_CHANNELS.EVENT_UPDATE, (_e, id: string, data: EventUpdateInput) =>
    wrap(() => eventRepo.updateEvent(id, data))
  )
  ipcMain.handle(IPC_CHANNELS.EVENT_DELETE, (_e, id: string) =>
    wrap(() => eventRepo.deleteEvent(id))
  )

  // ---------- round ----------
  ipcMain.handle(IPC_CHANNELS.ROUND_LIST_BY_EVENT, (_e, eventId: string) =>
    wrap(() => eventRepo.listRoundsByEvent(eventId))
  )
  ipcMain.handle(IPC_CHANNELS.ROUND_GET, (_e, id: string) =>
    wrap(() => eventRepo.getRoundById(id))
  )
  ipcMain.handle(IPC_CHANNELS.ROUND_CREATE, (_e, data: RoundCreateInput) =>
    wrap(() => eventRepo.createRound(data))
  )
  ipcMain.handle(IPC_CHANNELS.ROUND_UPDATE, (_e, id: string, data: RoundUpdateInput) =>
    wrap(() => eventRepo.updateRound(id, data))
  )
  ipcMain.handle(IPC_CHANNELS.ROUND_DELETE, (_e, id: string) =>
    wrap(() => eventRepo.deleteRound(id))
  )

  // ---------- team ----------
  ipcMain.handle(IPC_CHANNELS.TEAM_LIST_BY_EVENT, (_e, eventId: string) =>
    wrap(() => eventRepo.listTeamsByEvent(eventId))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_GET, (_e, id: string) =>
    wrap(() => eventRepo.getTeamById(id))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_CREATE, (_e, data: TeamCreateInput) =>
    wrap(() => eventRepo.createTeam(data))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_UPDATE, (_e, id: string, data: TeamUpdateInput) =>
    wrap(() => eventRepo.updateTeam(id, data))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_DELETE, (_e, id: string) =>
    wrap(() => eventRepo.deleteTeam(id))
  )

  // ---------- team history ----------
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_LIST, (_e, teamId: string) =>
    wrap(() => eventRepo.listTeamHistory(teamId))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_LIST_BY_EVENT, (_e, eventId: string) =>
    wrap(() => eventRepo.listTeamHistoryByEvent(eventId))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_ADD, (_e, data: TeamHistoryCreateInput) =>
    wrap(() => eventRepo.addTeamHistory(data))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_DELETE, (_e, id: string) =>
    wrap(() => eventRepo.deleteTeamHistory(id))
  )
}
