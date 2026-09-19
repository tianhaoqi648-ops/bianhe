// ============================================================
// recording-storage.ts — 录音文件存储服务
//
// 将渲染进程采集的录音（ArrayBuffer）落盘到 userData/recordings/，
// 返回可写回 matches.recording_ref / timer_sessions 的本地绝对路径。
// ============================================================

import { app } from 'electron'
import { promises as fs } from 'fs'
import { basename, dirname, join, resolve as resolvePath } from 'path'
import type { BoundRecording } from '../../shared/types'
import { auditRepo } from '../db/repository/audit.repo'
import { RECORDING_SEGMENT_KEY, RECORDING_FORMAT_KEY, resolveSegmentMode, resolveRecordingFormat, uniqueRecordingFileName, type RecordingSegmentMode, type RecordingFormat } from '../../shared/match-recording'

export const RECORDINGS_DIR_NAME = 'recordings'
/** settings 表里录音「数据根」的 key（存用户选择的数据根目录；空/缺失则用默认 userData → <根>/recordings） */
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

/** 用户配置的录音「数据根」（settings 中存的数据根；未配置返回 null）。空字符串/未配置视为恢复默认 userData。 */
export function getConfiguredRecordingDir(): string | null {
  const v = auditRepo.getSetting(RECORDING_DIR_KEY)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** 设置录音数据根（空字符串视为恢复默认 userData） */
export function setConfiguredRecordingDir(dir: string): void {
  auditRepo.setSetting(RECORDING_DIR_KEY, dir && dir.trim() ? dir.trim() : '')
}

/**
 * 解析录音「数据根」目录。
 * recording.dir 存的是用户选择的数据根，实际录音目录固定落为 `<根>/recordings`（仿 stt.dir→<根>/stt）。
 * - root 为空 → 默认 userData；
 * - root 最后一段已是 `recordings`（大小写不敏感）→ 其 dirname 即为数据根（兼容旧设置里直接存「绝对录音目录」形如 `<根>/recordings`，
 *   取上一级作数据根后，生效录音目录不变，旧录音不失联）；
 * - 否则 → root 本身即为数据根。
 */
export function resolveDataRoot(root: string | null): string {
  if (!root || !root.trim()) {
    return app.getPath('userData')
  }
  const finalSeg = basename(root)
  if (finalSeg.toLowerCase() === RECORDINGS_DIR_NAME.toLowerCase()) {
    return dirname(root)
  }
  return root
}

/**
 * 当前生效的数据根（未配置回退默认 userData）。与 recordingsDir() 的关系：生效录音目录 = 数据根 /recordings。
 */
export function dataRootDir(): string {
  return resolveDataRoot(getConfiguredRecordingDir())
}

/**
 * 归一化录音目录。
 * root 视为数据根，实际录音目录固定落为 `<根>/recordings`：
 * - root 为空 → 默认 userData/recordings；
 * - root 最后一段已是 `recordings` → 直接用 root（兼容旧设置直接存绝对录音目录，避免 recordings/recordings，旧录音不失联）；
 * - 否则 → join(root, 'recordings')。
 */
export function resolveRecordingsDir(root: string | null): string {
  if (!root || !root.trim()) {
    return join(app.getPath('userData'), RECORDINGS_DIR_NAME)
  }
  const finalSeg = basename(root)
  if (finalSeg.toLowerCase() === RECORDINGS_DIR_NAME.toLowerCase()) {
    return root
  }
  return join(root, RECORDINGS_DIR_NAME)
}

/** 录音目录绝对路径（数据根 /recordings，数据根优先用配置，缺省 userData；按需创建）。 */
export async function recordingsDir(): Promise<string> {
  const root = getConfiguredRecordingDir()
  const dir = resolveRecordingsDir(root)
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
 * - 安全加固：无论传入绝对路径还是相对路径，一律取 basename 后锁定到当前录音
 *   目录内（与 saveRecording / deleteRecording 的处理一致），杜绝经
 *   recording_meta.filePath 注入的任意绝对路径读取（路径穿越 / 越界读）。
 *   行为变化：若用户曾更改录音数据根，指向旧目录的 recording_meta 将不再可读
 *   （原实现可读旧绝对路径），属收紧带来的预期取舍。
 * 不存在或读取失败返回 null（由调用方/IPC 层处理）。
 */
export async function readRecordingFile(filePath: string): Promise<Buffer | null> {
  try {
    const resolved = join(await recordingsDir(), basename(filePath))
    return await fs.readFile(resolved)
  } catch {
    return null
  }
}

/**
 * 校验录音文件是否存在。
 * - 安全加固：与 readRecordingFile 一致，一律取 basename 锁定到录音目录内。
 * 不存在或读取失败返回 false。
 */
export async function recordingFileExists(filePath: string): Promise<boolean> {
  try {
    const resolved = join(await recordingsDir(), basename(filePath))
    const st = await fs.stat(resolved)
    return st.isFile()
  } catch {
    return false
  }
}

/**
 * 删除一份录音文件（basename 锁定到录音目录）。
 *
 * Phase 1.2-fix：真实返回删除结果（不再吞错恒返 true）：
 * - true：文件已删除，或本就不存在（幂等）
 * - false：实际删除失败（权限不足/文件占用等），调用方可感知
 * 注意：当前 UI 的「移除」走 bind remove（仅解绑元数据），本函数为
 * 预留的文件删除能力（RECORDING_DELETE 通道），不被现有 UI 调用。
 */
export async function deleteRecording(fileName: string): Promise<boolean> {
  const dir = await recordingsDir()
  try {
    await fs.rm(join(dir, basename(fileName)), { force: true })
    return true
  } catch (e) {
    console.warn('[recording] delete failed:', fileName, e)
    return false
  }
}

/**
 * Phase 1.2-fix：绑定写入前的文件归位——把 recordingsDir 之外的录音文件
 * 拷入录音目录（basename 唯一化），并统一改写 filePath 为 basename。
 *
 * 背景：Phase 1.0-B 起读取端 basename 锁定后，绑定外部目录文件将无法
 * 读取/转写；本函数在 bind 写入时把外部文件「收编」进录音目录，保证
 * 绑定后立即可播/可转写，并与 M3 的 basename 元数据模型一致。
 *
 * 失败语义（Pre-Push Gate 修正）：拷贝失败时抛错——由 bind handler
 * 返回 {success:false}，**不创建新的 Recording 引用**（否则 M3 归一
 * 会把原绝对路径压缩成当前根下必不存在的 basename，形成静默死引用）。
 * 原外部文件保持不变，recordingsDir 不留半成品（copyFile 原子）。
 */
export async function ensureRecordingsInDir(
  recordings: BoundRecording[]
): Promise<BoundRecording[]> {
  const dir = await recordingsDir()
  const out: BoundRecording[] = []
  for (const r of recordings) {
    const fp = r.filePath ?? ''
    const base = basename(fp)
    // 纯 basename（无分隔符）：已是目录内相对引用，原样保留
    const isBare = !fp.includes('/') && !fp.includes('\\')
    let finalBase = base
    try {
      if (!isBare && resolvePath(fp) !== join(dir, base)) {
        // 外部文件：拷入录音目录（同名自动追加时间戳后缀）
        const candidates = (await fs.readdir(dir)).filter((f) => !f.startsWith('.'))
        finalBase = uniqueRecordingFileName(base, candidates)
        await fs.copyFile(fp, join(dir, finalBase))
      }
    } catch (e) {
      throw new Error(
        `录音文件导入失败（${base}）：${e instanceof Error ? e.message : String(e)}`
      )
    }
    out.push({ ...r, filePath: finalBase })
  }
  return out
}