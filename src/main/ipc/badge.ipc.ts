// ============================================================
// badge.ipc.ts — 队徽库 IPC handlers（P1-6）
//
// 通道：
//   badge:list     列出队徽库（内置 + 自定义）
//   badge:upload   上传队徽（name + fileName + base64 → 落盘 userData/badges）
//   badge:delete   删除自定义队徽
//   badge:setTeam / badge:getTeam / badge:clearTeam  队伍 ↔ 队徽绑定
// ============================================================

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { ApiResponse, BadgeItem } from '../../shared/types'
import type { IpcMainInvokeEvent } from 'electron'
import {
  clearTeamBadge,
  deleteBadge,
  getBadgeDataUrl,
  getTeamBadge,
  listBadges,
  setTeamBadge,
  uploadBadge
} from '../services/badge-storage'
import { wrap } from './utils'

function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

export function registerBadgeIpc(): void {
  ipcMain.handle(IPC_CHANNELS.BADGE_LIST, (_e: IpcMainInvokeEvent, keyword?: string): ApiResponse<BadgeItem[]> =>
    wrap(() => {
      const k = typeof keyword === 'string' ? keyword.trim() : ''
      const all = listBadges()
      if (!k) return all
      const lower = k.toLowerCase()
      return all.filter((b) => b.name.toLowerCase().includes(lower))
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.BADGE_UPLOAD,
    (_e: IpcMainInvokeEvent, opts: { name: string; fileName: string; base64: string }): ApiResponse<BadgeItem> =>
      wrap(() => {
        assertParam(opts && typeof opts === 'object', '参数 opts 必须为对象')
        assertNonEmptyString(opts.name, 'opts.name')
        assertNonEmptyString(opts.fileName, 'opts.fileName')
        return uploadBadge({ name: opts.name, fileName: opts.fileName, base64: opts.base64 })
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.BADGE_DELETE,
    (_e: IpcMainInvokeEvent, id: string): ApiResponse<boolean> =>
      wrap(() => {
        assertNonEmptyString(id, 'id')
        return deleteBadge(id)
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.BADGE_GET_DATA_URL,
    (_e: IpcMainInvokeEvent, id: string): ApiResponse<string | null> =>
      wrap(() => {
        assertNonEmptyString(id, 'id')
        return getBadgeDataUrl(id)
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.BADGE_SET_TEAM,
    (_e: IpcMainInvokeEvent, req: { teamId: string; badgeId: string }): ApiResponse<boolean> =>
      wrap(() => {
        assertParam(req && typeof req === 'object', '参数 req 必须为对象')
        assertNonEmptyString(req.teamId, 'req.teamId')
        assertNonEmptyString(req.badgeId, 'req.badgeId')
        setTeamBadge(req.teamId, req.badgeId)
        return true
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.BADGE_GET_TEAM,
    (_e: IpcMainInvokeEvent, teamId: string): ApiResponse<string | null | undefined> =>
      wrap(() => {
        assertNonEmptyString(teamId, 'teamId')
        return getTeamBadge(teamId)
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.BADGE_CLEAR_TEAM,
    (_e: IpcMainInvokeEvent, teamId: string): ApiResponse<boolean> =>
      wrap(() => {
        assertNonEmptyString(teamId, 'teamId')
        clearTeamBadge(teamId)
        return true
      })
  )
}