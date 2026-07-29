// ============================================================
// bell-asset.ipc.ts — 自定义铃声资源 IPC handlers
// ============================================================

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { bellAssetRepo } from '../db/repository/bell-asset.repo'
// L3 修复：使用公共 wrap 函数，避免重复定义
import { wrap } from './utils'

const ALLOWED_MIME = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/ogg']
const MAX_FILE_SIZE = 1 * 1024 * 1024 // 1MB

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

export function registerBellAssetIpc(): void {
  ipcMain.handle(IPC_CHANNELS.BELL_ASSET_LIST, () =>
    wrap(() => bellAssetRepo.listAll())
  )

  // upload: 接收 fileName + base64 + mimeType，主进程落盘并入库
  // P2-19：BELL_ASSET_UPLOAD/DELETE 跳过改用 wrapWithUndo。原因：
  //   UndoLogEntry.store_name 类型仅支持 'topic' | 'event' | 'draw' | 'customField' | 'settings'，
  //   无 'bell' store。改用 wrapWithUndo 会导致 TypeScript 类型错误，且 applyReverse 未实现
  //   'bell' store 的反向操作（需恢复 bell_assets 行 + userData/bells/ 文件）。
  //   需先扩展 undo-service，超出本 Bug 修复范围。
  ipcMain.handle(
    IPC_CHANNELS.BELL_ASSET_UPLOAD,
    (_e: IpcMainInvokeEvent, opts: { name: string; fileName: string; base64: string; mimeType: string }) =>
      wrap(() => {
        assertParam(opts && typeof opts === 'object', '参数 opts 必须为对象')
        assertNonEmptyString(opts.name, 'opts.name')
        assertNonEmptyString(opts.fileName, 'opts.fileName')
        assertNonEmptyString(opts.mimeType, 'opts.mimeType')
        if (!ALLOWED_MIME.includes(opts.mimeType)) {
          throw new Error(`不支持的铃声格式：${opts.mimeType}（仅支持 mp3/wav/ogg）`)
        }
        const buffer = Buffer.from(opts.base64, 'base64')
        if (buffer.length > MAX_FILE_SIZE) {
          throw new Error(`铃声文件过大：${(buffer.length / 1024 / 1024).toFixed(2)}MB（上限 1MB）`)
        }
        return bellAssetRepo.create({
          name: opts.name,
          fileName: opts.fileName,
          buffer,
          mimeType: opts.mimeType
        })
      })
  )

  // P2-19：同上，BELL_ASSET_DELETE 跳过改用 wrapWithUndo。
  ipcMain.handle(IPC_CHANNELS.BELL_ASSET_DELETE, (_e: IpcMainInvokeEvent, id: string) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      return bellAssetRepo.delete(id)
    })
  )

  ipcMain.handle(IPC_CHANNELS.BELL_ASSET_GET_DATA_URL, (_e: IpcMainInvokeEvent, id: string) =>
    wrap(() => {
      assertNonEmptyString(id, 'id')
      return bellAssetRepo.getDataUrl(id)
    })
  )
}

