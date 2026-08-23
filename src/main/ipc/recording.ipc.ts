// ============================================================
// recording.ipc.ts — 录音 IPC handlers（数据根 /recordings）
// ============================================================

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'path'
import { IPC_CHANNELS } from '../../shared/types'
import type { ApiResponse, RecordingSaveResult, RecordingDirInfo, RecordingBindAction, BoundRecording } from '../../shared/types'
import { matchRepo } from '../db/repository/match.repo'
import {
  saveRecording,
  listRecordings,
  readRecordingFile,
  deleteRecording,
  recordingFileExists,
  recordingsDir,
  getConfiguredRecordingDir,
  dataRootDir
} from '../services/recording-storage'

/** 把跨进程传来的数据安全转成 Node Buffer（兼容 ArrayBuffer / Uint8Array / Buffer） */
function toBuffer(data: unknown): Buffer | null {
  if (data instanceof Uint8Array) return Buffer.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return null
}

export function registerRecordingIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.RECORDING_SAVE,
    async (_e, fileName: string, data: unknown): Promise<ApiResponse<RecordingSaveResult>> => {
      try {
        if (typeof fileName !== 'string' || !fileName.trim()) {
          return { success: false, error: '参数 fileName 必须为非空字符串' }
        }
        const buf = toBuffer(data)
        if (!buf) {
          return { success: false, error: '录音数据格式无效' }
        }
        const { path, size } = await saveRecording(fileName.trim(), new Uint8Array(buf))
        return { success: true, data: { ok: true, path, size } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.RECORDING_LIST, async (): Promise<ApiResponse<Record<string, unknown>[]>> => {
    try {
      const items = await listRecordings()
      return { success: true, data: items as unknown as Record<string, unknown>[] }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.RECORDING_READ,
    async (_e, filePath: string): Promise<ApiResponse<{ ok: boolean; base64?: string; fileName?: string; error?: string }>> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: '参数 filePath 必须为非空字符串' }
        }
        const buf = await readRecordingFile(filePath.trim())
        if (!buf) {
          return { success: false, error: '录音文件不存在或读取失败' }
        }
        return { success: true, data: { ok: true, base64: buf.toString('base64'), fileName: basename(filePath.trim()) } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.RECORDING_DELETE,
    async (_e, fileName: string): Promise<ApiResponse<boolean>> => {
      try {
        if (typeof fileName !== 'string' || !fileName.trim()) {
          return { success: false, error: '参数 fileName 必须为非空字符串' }
        }
        await deleteRecording(fileName.trim())
        return { success: true, data: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 弹出系统目录选择器（供设置页配置录音数据根）。返回所选绝对路径；取消返回 null。
  ipcMain.handle(
    IPC_CHANNELS.RECORDING_PICK_DIR,
    async (e): Promise<ApiResponse<string | null>> => {
      try {
        const opts = { title: '选择录音数据根目录（录音将保存到 <根>/recordings）', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
        const win = BrowserWindow.fromWebContents(e.sender)
        const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
        if (result.canceled || !result.filePaths.length) {
          return { success: true, data: null }
        }
        return { success: true, data: result.filePaths[0] }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // 返回当前录音「数据根」与「生效录音目录」（配置优先，否则默认 userData/recordings）
  ipcMain.handle(
    IPC_CHANNELS.RECORDING_GET_DIR,
    async (): Promise<ApiResponse<RecordingDirInfo>> => {
      try {
        return {
          success: true,
          data: {
            configured: getConfiguredRecordingDir(),
            dataRoot: dataRootDir(),
            effective: await recordingsDir()
          }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 按路径校验录音文件是否存在（绝对/相对均支持）
  ipcMain.handle(
    IPC_CHANNELS.RECORDING_EXISTS,
    async (_e, filePath: unknown): Promise<ApiResponse<boolean>> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: '参数 filePath 必须为非空字符串' }
        }
        return { success: true, data: await recordingFileExists(filePath.trim()) }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 列出某一场比赛绑定的录音（有序 BoundRecording[]，无/未绑定返回 null）
  ipcMain.handle(
    IPC_CHANNELS.RECORDING_LIST_FOR_MATCH,
    async (_e, matchId: unknown): Promise<ApiResponse<BoundRecording[] | null>> => {
      try {
        if (typeof matchId !== 'string' || !matchId.trim()) {
          return { success: false, error: '参数 matchId 必须为非空字符串' }
        }
        const match = matchRepo.getById(matchId.trim())
        return { success: true, data: match?.recordings ?? null }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 多录音绑定：对一场比赛的 recordings 列表做 增(add)/删(remove)/换(replace)/整组(set) 变更
  ipcMain.handle(
    IPC_CHANNELS.RECORDING_BIND,
    async (_e, action: RecordingBindAction): Promise<ApiResponse<BoundRecording[] | null>> => {
      try {
        if (!action || typeof action !== 'object' || typeof action.kind !== 'string' || typeof action.matchId !== 'string' || !action.matchId.trim()) {
          return { success: false, error: 'bind 参数无效' }
        }
        const match = matchRepo.getById(action.matchId.trim())
        if (!match) {
          return { success: false, error: `未找到比赛：${action.matchId}` }
        }
        const next = applyBindAction(match.recordings ?? null, action)
        const updated = matchRepo.update(match.id, { recordings: next })
        return { success: true, data: updated?.recordings ?? null }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}

/** 依据一场景的当前录音列表，应用一次绑定操作，返回新列表。 */
function applyBindAction(current: BoundRecording[] | null, action: RecordingBindAction): BoundRecording[] | null {
  const base = current ?? []
  switch (action.kind) {
    case 'add':
      return [...base, action.recording]
    case 'remove':
      return base.filter((r) => r.id !== action.id)
    case 'replace':
      return base.map((r) => (r.id === action.id ? action.recording : r))
    case 'set':
      return action.recordings
  }
}