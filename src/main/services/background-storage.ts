// ============================================================
// background-storage.ts — 计时器背景图片文件存储服务
//
// 职责：管理 userData/backgrounds/ 目录下的用户上传背景图片文件
// ============================================================

import { app } from 'electron'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type { BackgroundFile } from '../../shared/types'

/** 获取 backgrounds 目录绝对路径，若不存在则创建 */
function getBackgroundsDir(): string {
  const dir = path.join(app.getPath('userData'), 'backgrounds')
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 应用启动时确保 backgrounds 目录存在（在 app.whenReady 之后调用） */
export function ensureBackgroundsDir(): void {
  getBackgroundsDir()
}

/**
 * 将 base64 编码的图片写入 backgrounds 目录
 * @param fileName 原始文件名（含扩展名）
 * @param base64Data base64 编码的文件内容（不含 data:image/... 前缀）
 * @returns filePath 绝对路径；fileUrl file:// 协议 URL
 */
export async function saveBackgroundFile(
  fileName: string,
  base64Data: string
): Promise<{ filePath: string; fileUrl: string }> {
  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']
  const ext = path.extname(fileName).toLowerCase()
  if (!allowedExtensions.includes(ext)) {
    throw new Error(`不支持的图片格式：${ext}，仅支持 ${allowedExtensions.join(', ')}`)
  }
  const dir = getBackgroundsDir()
  const id = uuidv4()
  // 文件名格式：<uuid>-<原始文件名>
  const safeName = `${id}-${path.basename(fileName)}`
  const fullPath = path.join(dir, safeName)
  const buffer = Buffer.from(base64Data, 'base64')
  await fs.writeFile(fullPath, buffer)
  // Windows 路径需转义为 file:// URL（pathToFileURL 处理跨平台差异）
  const { pathToFileURL } = await import('node:url')
  return {
    filePath: fullPath,
    fileUrl: pathToFileURL(fullPath).toString()
  }
}

/**
 * 列出 backgrounds 目录下所有文件
 * 文件名约定：<uuid>-<原始文件名>，从中拆分出 id 与 fileName
 */
export async function listBackgroundFiles(): Promise<BackgroundFile[]> {
  const dir = getBackgroundsDir()
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: BackgroundFile[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const name = entry.name
    // 解析 <uuid>-<fileName>：UUID v4 固定 36 字符，用固定位置切片
    // （UUID 自身含连字符，不能用 indexOf('-') 否则 id 被截断、fileName 残留 UUID 片段）
    if (name.length < 38) continue  // 36(uuid) + 1(-) + 至少1字符文件名
    const id = name.slice(0, 36)
    const fileName = name.slice(37)
    // 额外校验 id 格式为 UUID v4（8-4-4-4-12），避免非 UUID 文件名误解析
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) continue
    const fullPath = path.join(dir, name)
    const stat = await fs.stat(fullPath)
    const { pathToFileURL } = await import('node:url')
    result.push({
      id,
      fileName,
      fileUrl: pathToFileURL(fullPath).toString(),
      fileSize: stat.size,
      createdAt: stat.mtime.toISOString()
    })
  }
  return result
}

/**
 * 按 id（文件名前缀 uuid）删除背景文件
 * @param id 文件名前缀 uuid
 */
export async function deleteBackgroundFile(id: string): Promise<void> {
  const dir = getBackgroundsDir()
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const name = entry.name
    // UUID v4 固定 36 字符，用固定位置切片匹配
    if (name.slice(0, 36) === id) {
      await fs.unlink(path.join(dir, name))
      return
    }
  }
  // 文件不存在视为删除成功（幂等）
}
