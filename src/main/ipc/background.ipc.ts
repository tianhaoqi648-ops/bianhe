// ============================================================
// background.ipc.ts — 计时器自定义背景图片 IPC handlers
//
// 用户上传的背景图片保存在 userData/backgrounds/ 目录，
// 不入库（无元数据表），文件名约定：<uuid>-<原始文件名>。
// ============================================================

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import path from 'path'
import { IPC_CHANNELS, type ApiResponse, type BackgroundFile } from '../../shared/types'
import {
  saveBackgroundFile,
  listBackgroundFiles,
  deleteBackgroundFile
} from '../services/background-storage'
// P3-14: 引入公共 wrap 函数。注意：因 saveBackgroundFile/listBackgroundFiles/
//        deleteBackgroundFile 均为 async，wrap 为同步实现无法 await Promise，
//        故 async handler 仍保留 try-catch。wrap 导入仅用于统一错误格式约定的类型符号。
import { wrap } from './utils'

/** 文件大小上限：2MB（base64 解码后字节数） */
const MAX_BACKGROUND_SIZE = 2 * 1024 * 1024

/** 允许的图片扩展名白名单 */
const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']

/**
 * P2-23：参数校验辅助函数。
 * 校验失败时抛出友好错误，由 try-catch 捕获并转为 ApiResponse.error 返回前端。
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

export function registerBackgroundIpc(): void {
  // 上传背景图片：renderer 读取文件为 base64 后传入
  ipcMain.handle(
    IPC_CHANNELS.BACKGROUND_UPLOAD,
    async (
      _e: IpcMainInvokeEvent,
      opts: { fileName: string; base64: string }
    ): Promise<ApiResponse<{ id: string; fileName: string; fileUrl: string }>> => {
      try {
        assertParam(opts && typeof opts === 'object', '参数 opts 必须为对象')
        assertNonEmptyString(opts.fileName, 'opts.fileName')
        // 文件扩展名白名单校验，防止上传可执行文件等非图片资源
        const ext = path.extname(opts.fileName).toLowerCase()
        if (!ALLOWED_IMAGE_EXT.includes(ext)) {
          return { success: false, error: `不支持的图片格式：${ext}，仅支持 ${ALLOWED_IMAGE_EXT.join(', ')}` }
        }
        // 先解码校验大小，避免大文件落盘
        const buffer = Buffer.from(opts.base64, 'base64')
        if (buffer.length > MAX_BACKGROUND_SIZE) {
          return { success: false, error: '文件超过 2MB 限制' }
        }
        const { filePath, fileUrl } = await saveBackgroundFile(opts.fileName, opts.base64)
        // 从文件名解析 id 与 fileName（与 listBackgroundFiles 约定一致）
        const storedName = filePath.split(/[\\/]/).pop() ?? ''
        const dashIdx = storedName.indexOf('-')
        const id = dashIdx >= 0 ? storedName.slice(0, dashIdx) : storedName
        return {
          success: true,
          data: {
            id,
            fileName: dashIdx >= 0 ? storedName.slice(dashIdx + 1) : storedName,
            fileUrl
          }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 列出所有背景图片
  ipcMain.handle(
    IPC_CHANNELS.BACKGROUND_LIST,
    async (): Promise<ApiResponse<BackgroundFile[]>> => {
      try {
        const data = await listBackgroundFiles()
        return { success: true, data }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 按 id 删除背景图片
  ipcMain.handle(
    IPC_CHANNELS.BACKGROUND_DELETE,
    async (_e: IpcMainInvokeEvent, id: string): Promise<ApiResponse<void>> => {
      try {
        assertNonEmptyString(id, 'id')
        await deleteBackgroundFile(id)
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}

// 防止 wrap 未使用警告（统一从 ./utils 引入约定，供后续 sync handler 使用）
void wrap
