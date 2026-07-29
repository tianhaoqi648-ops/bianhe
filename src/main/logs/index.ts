// ============================================================
// main/logs/index.ts — 主进程错误日志写入与轮转
//
// 写入路径：app.getPath('userData')/logs/error.log
//   userData 在 Windows 上默认为 %APPDATA%/辩盒/，最终路径形如：
//   C:\Users\<user>\AppData\Roaming\辩盒\logs\error.log
//
// 轮转：单文件 1MB，保留 5 份
//   error.log → error.1.log → error.2.log → ... → error.5.log
//   超过 1MB 时整体后移，最老的 error.5.log 被覆盖删除
// ============================================================

import { app } from 'electron'
import { join } from 'path'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync
} from 'fs'

/** 单文件大小阈值（1MB） */
const MAX_FILE_SIZE = 1 * 1024 * 1024
/** 保留的最大轮转文件数 */
const MAX_ROTATED_FILES = 5

/** 错误日志输入结构（与渲染进程 ErrorBoundary 对齐） */
export interface ErrorLogInput {
  name: string
  message: string
  stack: string
  timestamp: string
}

/** 获取 logs 目录绝对路径（不创建） */
function getLogsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

/** 获取当前活动 error.log 路径 */
function getCurrentLogPath(): string {
  return join(getLogsDir(), 'error.log')
}

/** 获取第 n 份轮转文件路径（n=1..MAX_ROTATED_FILES） */
function getRotatedLogPath(n: number): string {
  return join(getLogsDir(), `error.${n}.log`)
}

/**
 * 检查文件大小并执行轮转。
 *
 * 轮转顺序：error.4.log → error.5.log（覆盖）, error.3.log → error.4.log, ...,
 *           error.log → error.1.log
 * 最终 error.log 被清空，准备接收新内容。
 */
function rotateIfNeeded(): void {
  const currentPath = getCurrentLogPath()
  if (!existsSync(currentPath)) return

  let size: number
  try {
    size = statSync(currentPath).size
  } catch {
    return
  }
  if (size < MAX_FILE_SIZE) return

  // 自后向前依次重命名（覆盖最老的）
  // error.{MAX_ROTATED_FILES-1}.log → error.{MAX_ROTATED_FILES}.log
  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    const from = getRotatedLogPath(i)
    const to = getRotatedLogPath(i + 1)
    if (existsSync(from)) {
      try {
        // 第 MAX 份直接删除（避免 renameSync 覆盖时的边界问题）
        if (i + 1 === MAX_ROTATED_FILES && existsSync(to)) {
          unlinkSync(to)
        }
        renameSync(from, to)
      } catch (e) {
        console.warn('[logs] rotate rename failed:', e)
      }
    }
  }

  // error.log → error.1.log
  try {
    if (existsSync(getRotatedLogPath(MAX_ROTATED_FILES))) {
      unlinkSync(getRotatedLogPath(MAX_ROTATED_FILES))
    }
    renameSync(currentPath, getRotatedLogPath(1))
  } catch (e) {
    console.warn('[logs] rotate current → .1 failed:', e)
  }
}

/**
 * 写入一条错误日志。
 *
 * - 自动创建 logs 目录
 * - 单文件超过 1MB 触发轮转
 * - 每条日志格式：
 *   ```
 *   [2026-07-29T12:34:56.789Z] TypeError: foo is not a function
 *     at ...
 *     at ...
 *   ---
 *   ```
 */
export async function writeErrorLog(error: ErrorLogInput): Promise<void> {
  const dir = getLogsDir()
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  } catch (e) {
    console.warn('[logs] mkdir failed:', e)
    return
  }

  rotateIfNeeded()

  const line = [
    `[${error.timestamp}] ${error.name}: ${error.message}`,
    error.stack || '(no stack)',
    '---',
    ''
  ].join('\n')

  try {
    appendFileSync(getCurrentLogPath(), line, 'utf8')
  } catch (e) {
    console.warn('[logs] append failed:', e)
  }
}
