// ============================================================
// format.ipc.ts — 赛制 IPC handlers
// ============================================================

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { formatRepo } from '../db/repository/format.repo'
import { ALL_PRESETS } from '../../shared/debate-formats/presets'
import type { DebateFormatData } from '../../shared/types'
// L3 修复：使用公共 wrap 函数，避免重复定义
import { withUndoLog } from '../services/undo-service'
import { wrap, wrapWithUndo } from './utils'

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

export function registerFormatIpc(): void {
  // P2-20：FORMAT_CREATE/UPDATE/DELETE 跳过改用 wrapWithUndo。原因：
  //   UndoLogEntry.store_name 类型仅支持 'topic' | 'event' | 'draw' | 'customField' | 'settings'，
  //   无 'format' store。改用 wrapWithUndo 会导致 TypeScript 类型错误，且 applyReverse 未实现
  //   'format' store 的反向操作（需恢复 debate_formats 行）。需先扩展 undo-service，超出本 Bug 范围。
  ipcMain.handle(IPC_CHANNELS.FORMAT_LIST, () =>
    wrap(() => formatRepo.listAll())
  )

  ipcMain.handle(IPC_CHANNELS.FORMAT_GET, (_e, id: string) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      return formatRepo.getById(id)
    })
  )

  ipcMain.handle(IPC_CHANNELS.FORMAT_CREATE, (_e, opts: { name: string; description?: string; formatData: DebateFormatData }) =>
    wrapWithUndo(() => {
      assertParam(opts && typeof opts === 'object', '参数 opts 必须为对象')
      assertNonEmptyString(opts.name, 'opts.name')
      return withUndoLog({
        storeName: 'format',
        action: 'create',
        targetType: 'format',
        targetId: null,
        label: `创建赛制 ${opts.name}`,
        getBefore: () => null,
        execute: () => formatRepo.create(opts),
        getAfter: (result) => result
      })
    })
  )

  ipcMain.handle(IPC_CHANNELS.FORMAT_UPDATE, (_e, id: string, opts: { name?: string; description?: string; formatData?: DebateFormatData }) =>
    wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      assertParam(opts && typeof opts === 'object', '参数 opts 必须为对象')
      return withUndoLog({
        storeName: 'format',
        action: 'update',
        targetType: 'format',
        targetId: id,
        label: `更新赛制`,
        getBefore: () => formatRepo.getById(id),
        execute: () => formatRepo.update(id, opts),
        getAfter: () => formatRepo.getById(id)
      })
    })
  )

  ipcMain.handle(IPC_CHANNELS.FORMAT_DELETE, (_e, id: string) =>
    wrapWithUndo(() => {
      assertNonEmptyString(id, 'id')
      const before = formatRepo.getById(id)
      return withUndoLog({
        storeName: 'format',
        action: 'delete',
        targetType: 'format',
        targetId: id,
        label: `删除赛制 ${before?.name ?? id.slice(0, 8)}`,
        getBefore: () => before,
        execute: () => formatRepo.delete(id),
        getAfter: () => null
      })
    })
  )

  ipcMain.handle(IPC_CHANNELS.FORMAT_SEED_PRESETS, () =>
    wrap(() => {
      for (const preset of ALL_PRESETS) {
        formatRepo.upsertPreset(preset)
      }
      return ALL_PRESETS.length
    })
  )

  // 导入赛制：复用 create，但参数结构匹配导入场景
  ipcMain.handle(
    IPC_CHANNELS.FORMAT_IMPORT,
    (_e, data: { name: string; description?: string; formatData: DebateFormatData }) =>
      wrapWithUndo(() => {
        assertParam(data && typeof data === 'object', '参数 opts 必须为对象')
        assertNonEmptyString(data.name, 'opts.name')
        return withUndoLog({
          storeName: 'format',
          action: 'create',
          targetType: 'format',
          targetId: null,
          label: `导入赛制 ${data.name}`,
          getBefore: () => null,
          execute: () => formatRepo.importFormat(data),
          getAfter: (result) => result
        })
      })
  )

  // 导出赛制：返回可序列化的 JSON 结构
  ipcMain.handle(IPC_CHANNELS.FORMAT_EXPORT, (_e, id: string) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      return formatRepo.exportFormat(id)
    })
  )
}
