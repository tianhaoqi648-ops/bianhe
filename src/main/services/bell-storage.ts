// ============================================================
// bell-storage.ts — 铃声文件存储服务
//
// 职责：管理 userData/bells/ 目录下的铃声文件
// ============================================================

import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

function getBellsDir(): string {
  const dir = path.join(app.getPath('userData'), 'bells')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 保存铃声文件到磁盘
 * @param fileName 原始文件名
 * @param buffer 文件内容
 * @returns 相对路径（相对于 userData/bells/）
 */
export function saveBellFile(fileName: string, buffer: Buffer): string {
  const dir = getBellsDir()
  // 校验文件扩展名白名单，防止上传可执行文件
  const ext = path.extname(fileName).toLowerCase()
  const allowedExtensions = ['.mp3', '.wav', '.ogg']
  if (!allowedExtensions.includes(ext)) {
    throw new Error('Unsupported file type. Only .mp3, .wav, .ogg are allowed')
  }
  // 加时间戳防重名
  const base = path.basename(fileName, ext)
  const uniqueName = `${base}-${Date.now()}${ext}`
  const fullPath = path.join(dir, uniqueName)
  fs.writeFileSync(fullPath, buffer)
  return uniqueName
}

/** 获取铃声文件绝对路径 */
export function getBellFullPath(relativePath: string): string {
  const bellsDir = getBellsDir()
  const fullPath = path.resolve(bellsDir, relativePath)
  // 校验解析后的路径必须在 bellsDir 子目录内，防止路径遍历攻击
  if (fullPath !== bellsDir && !fullPath.startsWith(bellsDir + path.sep)) {
    throw new Error('Invalid bell path: path traversal detected')
  }
  return fullPath
}

/** 删除铃声文件 */
export function deleteBellFile(relativePath: string): void {
  const fullPath = getBellFullPath(relativePath)
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath)
  }
}

/** 读取铃声文件 Buffer（用于 HTTP 分享） */
export function readBellFile(relativePath: string): Buffer | null {
  const fullPath = getBellFullPath(relativePath)
  if (!fs.existsSync(fullPath)) return null
  return fs.readFileSync(fullPath)
}
