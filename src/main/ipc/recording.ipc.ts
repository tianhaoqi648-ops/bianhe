// ============================================================
// recording.ipc.ts — 录音 IPC handlers（userData/recordings/）
// ============================================================

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'path'
import { IPC_CHANNELS } from '../../shared/types'
import type { ApiResponse, RecordingSaveResult } from '../../shared/types'
import {
  saveRecording,
  listRecordings,
  readRecordingFile,
  deleteRecording,
  recordingsDir,
  getConfiguredRecordingDir
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

  // 弹出系统目录选择器（供设置页配置录音存放位置）。返回所选绝对路径；取消返回 null。
  ipcMain.handle(
    IPC_CHANNELS.RECORDING_PICK_DIR,
    async (e): Promise<ApiResponse<string | null>> => {
      try {
        const opts = { title: '选择录音存放目录', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
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

  // 返回当前录音目录（配置优先，否则默认 userData/recordings）
  ipcMain.handle(
    IPC_CHANNELS.RECORDING_GET_DIR,
    async (): Promise<ApiResponse<{ configured: string | null; effective: string }>> => {
      try {
        return { success: true, data: { configured: getConfiguredRecordingDir(), effective: await recordingsDir() } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}