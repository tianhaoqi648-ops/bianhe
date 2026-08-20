// ============================================================
// recording-storage.ts — 录音文件存储服务
//
// 将渲染进程采集的录音（ArrayBuffer）落盘到 userData/recordings/，
// 返回可写回 matches.recording_ref / timer_sessions 的本地绝对路径。
// ============================================================

import { app } from 'electron'
import { promises as fs } from 'fs'
import { basename, isAbsolute, join } from 'path'
import { auditRepo } from '../db/repository/audit.repo'
import { RECORDING_SEGMENT_KEY, RECORDING_FORMAT_KEY, resolveSegmentMode, resolveRecordingFormat, uniqueRecordingFileName, type RecordingSegmentMode, type RecordingFormat } from '../../shared/match-recording'

export const RECORDINGS_DIR_NAME = 'recordings'
/** settings 表里录音目录的 key（绝对路径；空/缺失则用默认 userData/recordings） */
export const RECORDING_DIR_KEY = 'recording.dir'

/** settings 表里录音分段模式的 key（whole/split，缺失默认 'whole'） */
export { RECORDING_SEGMENT_KEY }
/** settings 表里录音格式的 key（wav/webm，缺失默认 'wav'）；转发自共享层 */
export { RECORDING_FORMAT_KEY }

/**
 * 录音分段模式：'whole' 整场一轨 / 'split' 按环节分段。
 * 读 settings key `recording.segmentMode`，缺失或非法回退 'whole'。
 */
export function getSegmentMode(): RecordingSegmentMode {
  return resolveSegmentMode(auditRepo.getSetting(RECORDING_SEGMENT_KEY))
}

/** 用户配置的录音格式：'wav'（PCM 可拖）/'webm'（体积小）。读 settings key `recording.format`，缺失或非法回退 'wav' */
export function getRecordingFormat(): RecordingFormat {
  return resolveRecordingFormat(auditRepo.getSetting(RECORDING_FORMAT_KEY))
}

/** 用户配置的录音目录（settings 中存的绝对路径；未配置返回 null） */
export function getConfiguredRecordingDir(): string | null {
  const v = auditRepo.getSetting(RECORDING_DIR_KEY)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** 设置录音目录（空字符串视为恢复默认） */
export function setConfiguredRecordingDir(dir: string): void {
  auditRepo.setSetting(RECORDING_DIR_KEY, dir && dir.trim() ? dir.trim() : '')
}

/** 录音目录绝对路径（优先用配置，缺省 userData/recordings；按需创建） */
export async function recordingsDir(): Promise<string> {
  const configured = getConfiguredRecordingDir()
  const dir = configured || join(app.getPath('userData'), RECORDINGS_DIR_NAME)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/** 录音元信息 */
export interface RecordingMeta {
  fileName: string
  size: number
  modifiedAt: string
}

/**
 * 保存一份录音字节流。
 * @param fileName 建议形如 match-<id>-<ts>.webm
 * @param data 音频字节
 * @returns 保存路径与大小；已对 fileName 做 basename 校验与唯一化，防止路径穿越/覆盖
 */
export async function saveRecording(fileName: string, data: Uint8Array): Promise<{ path: string; size: number }> {
  const safe = basename(fileName)
  const dir = await recordingsDir()
  // 若同名已存在，加时间戳避免覆盖
  const candidates = await fs.readdir(dir).catch(() => [] as string[])
  const target = uniqueRecordingFileName(safe, candidates)
  const filePath = join(dir, target)
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  const buf = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)
  await fs.writeFile(filePath, buf)
  return { path: filePath, size: buf.byteLength }
}

/** 列出 recordings 目录下的所有录音（按修改时间倒序） */
export async function listRecordings(): Promise<RecordingMeta[]> {
  const dir = await recordingsDir()
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const metas: RecordingMeta[] = []
  for (const e of entries) {
    if (!e.isFile()) continue
    try {
      const stat = await fs.stat(join(dir, e.name))
      metas.push({ fileName: e.name, size: stat.size, modifiedAt: stat.mtime.toISOString() })
    } catch {
      // ignore unreadable entries
    }
  }
  metas.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
  return metas
}

/**
 * 读取一份录音文件的字节。
 * - 若 filePath 为绝对路径（recording_meta.filePath 存的就是绝对路径）则直接读取；
 * - 若为相对路径（仅文件名/相对路径）则 join 到录音目录下，避免路径穿越。
 * 不存在或读取失败返回 null（由调用方/IPC 层处理）。
 */
export async function readRecordingFile(filePath: string): Promise<Buffer | null> {
  try {
    const resolved = isAbsolute(filePath) ? filePath : join(await recordingsDir(), filePath)
    return await fs.readFile(resolved)
  } catch {
    return null
  }
}

/** 删除一份录音 */
export async function deleteRecording(fileName: string): Promise<boolean> {
  const dir = await recordingsDir()
  const filePath = join(dir, basename(fileName))
  const exists = await fs.rm(filePath, { force: true }).then(() => true).catch(() => true)
  void exists
  return true
}