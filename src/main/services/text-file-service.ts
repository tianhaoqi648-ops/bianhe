// ============================================================
// text-file-service.ts — 稿子文本文件读取（AI 裁判工作台 2026-08-18）
//
// 读取稿子文件内容（纯文本，无 electron 依赖，便于单测）：
//   - .txt / .md：fs.promises.readFile utf-8
//   - .docx：mammoth.extractRawText（提取纯文本，复用已装依赖）
//   - 限制：仅允许 txt/md/docx；文件 ≤ 2MB
// ============================================================

import { promises as fs } from 'fs'
import path from 'path'
import mammoth from 'mammoth'

/** 支持读取的稿子文件扩展名 */
export const SPEECH_FILE_EXTENSIONS = ['txt', 'md', 'docx']

/** 稿子文件大小上限（2MB） */
export const MAX_SPEECH_FILE_SIZE = 2 * 1024 * 1024

/** 读取失败的错误码 */
export type ReadTextFileErrorCode = 'unsupported_type' | 'file_too_large' | 'read_failed' | 'not_found'

/** 读取结果 */
export interface ReadTextFileResult {
  ok: boolean
  content?: string
  code?: ReadTextFileErrorCode
  message?: string
}

/**
 * 读取稿子文件内容。
 *
 * @param filePath 文件绝对路径（由 dialog.showOpenDialog 返回）
 * @returns 成功：{ ok: true, content }；失败：{ ok: false, code, message }（不抛错）
 */
export async function readTextFileContent(filePath: string): Promise<ReadTextFileResult> {
  try {
    // 1. 扩展名校验
    const ext = path.extname(filePath).toLowerCase().replace('.', '')
    if (!SPEECH_FILE_EXTENSIONS.includes(ext)) {
      return {
        ok: false,
        code: 'unsupported_type',
        message: `不支持的文件类型 .${ext}，仅支持 txt / md / docx`
      }
    }

    // 2. 大小限制
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_SPEECH_FILE_SIZE) {
        return {
          ok: false,
          code: 'file_too_large',
          message: '文件超过 2MB 限制，请压缩后重试'
        }
      }
    } catch {
      return { ok: false, code: 'not_found', message: '文件不存在或无法访问' }
    }

    // 3. 读取内容
    let content: string
    if (ext === 'docx') {
      // docx：mammoth 提取纯文本（不保留格式）
      const result = await mammoth.extractRawText({ path: filePath })
      content = result.value ?? ''
    } else {
      // txt / md：utf-8 直接读取
      content = await fs.readFile(filePath, 'utf-8')
    }

    return { ok: true, content }
  } catch (e) {
    return {
      ok: false,
      code: 'read_failed',
      message: e instanceof Error ? e.message : String(e)
    }
  }
}
