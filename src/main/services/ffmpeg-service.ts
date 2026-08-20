// ============================================================
// ffmpeg-service.ts — ffmpeg 转码器「按需下载」+ 转码
//
// 供录音转文字（STT）在本地 whisper 前，把 m4a/webm 转成 16k mono wav。
// 首次使用时按需下载到 userData/stt/ffmpeg(.exe)，不装进安装包。
//
// 提供：
//   transcodeToWav        spawn ffmpeg 把任意音视频转成 16k mono wav
//   getFfmpegStatus       查询安装/下载状态
//   downloadFfmpeg        按需下载（Win64 官方源 + ghproxy 镜像多源回退、解压）
//   cancelFfmpeg          取消进行中的下载
//   removeFfmpeg          删除已下载的 ffmpeg（含进行中先取消）
//
// 并发防串：与转写引擎共享模块级互斥模式，但各自独立的互斥/取消/进度状态。
// ============================================================

import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { dialog } from 'electron'
import type { SttFfmpegStatus } from '../../shared/types'
import { sttDir, ffmpegCanonicalDir } from './transcription'
import { extractArchive } from './whisper-extract'
import { downloadFile } from './stt-download'
import { auditRepo } from '../db/repository/audit.repo'

// ============================================================
// 路径与平台
// ============================================================

/** ffmpeg 二进制文件名（win 为 ffmpeg.exe，其余为 ffmpeg） */
export function ffmpegName(): string {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

/** 手动指定本机已有 ffmpeg 的路径设置项（存 settings 表，空=未手动指定） */
const FFMPEG_MANUAL_KEY = 'stt.ffmpegPath'

/** 同步判断路径是否存在 */
function pathExists(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

/**
 * ffmpeg 读/转码路径：手动指定最高优先；否则新布局 sttDir/ffmpeg/ffmpeg(.exe) 存在 → 用它；
 * 否则旧根 sttDir/ffmpeg(.exe) 存在 → 旧路径（兼容旧布局）；均不存在 → 返回新布局路径（缺省）。
 */
export function ffmpegPath(): string {
  const manual = auditRepo.getSetting(FFMPEG_MANUAL_KEY)
  if (typeof manual === 'string' && manual.trim()) return manual.trim()
  const canonical = join(ffmpegCanonicalDir(), ffmpegName())
  if (pathExists(canonical)) return canonical
  const legacy = join(sttDir(), ffmpegName())
  if (pathExists(legacy)) return legacy
  return canonical
}

/** ffmpeg 写/下载路径：恒用新布局 sttDir/ffmpeg/ffmpeg(.exe)（与 whisper/模型隔离） */
export function ffmpegWritePath(): string {
  return join(ffmpegCanonicalDir(), ffmpegName())
}

/** 手动设置/清除本机 ffmpeg 路径，并返回最新状态 */
export async function setFfmpegManualPath(path: string): Promise<SttFfmpegStatus> {
  const p = (path ?? '').trim()
  auditRepo.setSetting(FFMPEG_MANUAL_KEY, p)
  return getFfmpegStatus()
}

/** 弹窗选择本机已有的 ffmpeg 可执行文件（豁免在线下载的离线路径） */
export async function pickFfmpegPath(): Promise<SttFfmpegStatus> {
  const win = process.platform === 'win32'
  const res = await dialog.showOpenDialog({
    title: '选择本机已有的 ffmpeg 可执行文件',
    properties: ['openFile'],
    filters: [{ name: 'ffmpeg', extensions: win ? ['exe'] : ['*'] }]
  })
  if (res.canceled || !res.filePaths || !res.filePaths[0]) {
    return getFfmpegStatus()
  }
  return setFfmpegManualPath(res.filePaths[0])
}

// ============================================================
// 转码
// ============================================================

export interface TranscodeOptions {
  /** 输出采样率（Hz），默认 16000 */
  ar?: number
  /** 输出声道数，默认 1 */
  ac?: number
}

/**
 * 用 ffmpeg 把 input 转码为 16k mono PCM wav（outWav）。
 * `-y` 允许覆盖已存在输出；`-vn` 不强制加（whisper 只需音频轨，ffmpeg 默认会处理）。
 */
export function transcodeToWav(
  input: string,
  outWav: string,
  opts?: TranscodeOptions
): Promise<void> {
  const ar = opts?.ar ?? 16000
  const ac = opts?.ac ?? 1
  const args = ['-y', '-i', input, '-ar', String(ar), '-ac', String(ac), '-acodec', 'pcm_s16le', outWav]
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(ffmpegPath(), args, { windowsHide: true })
    } catch (e) {
      reject(new Error(`无法启动 ffmpeg：${e instanceof Error ? e.message : String(e)}`))
      return
    }
    let err = ''
    child.stderr!.on('data', (d: Buffer) => {
      if (err.length < 2000) err += d.toString('utf8')
    })
    child.on('error', (e) => reject(new Error(`无法启动 ffmpeg：${e.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 退出码 ${code}：${err.trim() || '未知错误'}`))
    })
  })
}

// ============================================================
// 模块级并发互斥 + 下载进度状态（独立于转写引擎）
// ============================================================

let ffmpegDownloading = false
let ffmpegCancelFlag = false
let currentProgress = 0

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function isFile(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p)
    return s.isFile()
  } catch {
    return false
  }
}

/**
 * 查询 ffmpeg 安装/下载状态。
 */
export async function getFfmpegStatus(): Promise<SttFfmpegStatus> {
  const p = ffmpegPath()
  const info = await fs
    .stat(p)
    .then((s) => (s.isFile() ? { ok: true as const, size: s.size } : { ok: false as const, size: 0 }))
    .catch(() => ({ ok: false as const, size: 0 }))
  return {
    installed: info.ok,
    path: info.ok ? p : undefined,
    fileSize: info.ok ? info.size : undefined,
    downloading: ffmpegDownloading,
    progress: ffmpegDownloading ? currentProgress : undefined
  }
}

// ============================================================
// 下载源（BtbN FFmpeg-Builds 官方 Release + ghproxy 国内镜像）
// ============================================================

/** Win64 官方 zip（BtbN FFmpeg-Builds，latest），zip 可被 extractArchive 解压 */
const FFMPEG_OFFICIAL_ZIP =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

/** ffmpeg 候选源：官方优先，后接多个国内 GitHub 代理镜像（任一可达即可） */
function ffmpegCandidateUrls(): string[] {
  const prefix = ['', 'https://ghproxy.com/', 'https://mirror.ghproxy.com/', 'https://gh-proxy.com/', 'https://ghfast.top/', 'https://gh.llkk.cc/']
  return prefix.map((p) => `${p}${FFMPEG_OFFICIAL_ZIP}`)
}

/**
 * 下载并安装 ffmpeg 到 userData/stt/ffmpeg(.exe)。
 * 仅 win32-x64 提供可解析的单文件下载源（zip→extractArchive 取 bin/ffmpeg.exe）；
 * 其余平台无可用单文件源 → 返回带 error 的状态（不抛错阻塞），提示改用 AI API 或系统自带 ffmpeg。
 */
export async function downloadFfmpeg(): Promise<SttFfmpegStatus> {
  if (ffmpegDownloading) throw new Error('已有 ffmpeg 下载正在进行中，请等待完成或先取消')

  // 仅 win32-x64 有现成可解压的官方 zip；其余平台暂无可解析的单文件压缩源
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return {
      installed: await isFile(ffmpegPath()),
      downloading: false,
      error: '该平台暂无可下载的 ffmpeg 压缩包（建议用 AI API 或系统自带 ffmpeg）'
    }
  }

  ffmpegDownloading = true
  ffmpegCancelFlag = false
  currentProgress = 0
  const dir = sttDir()
  const archivePath = join(dir, '.ffmpeg')

  try {
    await fs.mkdir(dir, { recursive: true })
    try {
      await downloadFile(ffmpegCandidateUrls(), archivePath, 0, 100, {
        isCancelled: () => ffmpegCancelFlag,
        onProgress: (p) => {
          currentProgress = p
        }
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { installed: false, downloading: false, error: msg }
    }

    // 解压并挑出 ffmpeg(.exe)：extractArchive 已把条目名归一为 basename，直接找 ffmpeg.exe 即可
    const buf = await fs.readFile(archivePath)
    const entries = extractArchive(new Uint8Array(buf))
    const target = ffmpegName()
    const exe = entries.find((en) => en.name === target)
    if (!exe) throw new Error(`解压后未找到 ${target}（条目：${entries.map((en) => en.name).slice(0, 8).join(', ') || '无'}）`)

    // 确保 ffmpeg 子目录存在（隔离布局 sttDir/ffmpeg/）
    await fs.mkdir(ffmpegCanonicalDir(), { recursive: true })
    // 只保留 ffmpeg 二进制，其余条目（dll/ffprobe…）一并丢弃
    await fs.writeFile(
      ffmpegPath(),
      Buffer.from(exe.data.buffer, exe.data.byteOffset, exe.data.byteLength)
    )
    if (process.platform !== 'win32') {
      await fs.chmod(ffmpegPath(), 0o755).catch(() => undefined)
    }
    currentProgress = 100
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { installed: false, downloading: false, error: msg }
  } finally {
    ffmpegDownloading = false
    ffmpegCancelFlag = false
    // 清理临时压缩包与残留 .part
    await fs.rm(archivePath, { force: true }).catch(() => undefined)
    await fs.rm(`${ffmpegPath()}.part`, { force: true }).catch(() => undefined)
  }

  return getFfmpegStatus()
}

/** 取消进行中的 ffmpeg 下载（无进行返回原样成功） */
export async function cancelFfmpeg(): Promise<void> {
  if (!ffmpegDownloading) return
  ffmpegCancelFlag = true
  let waited = 0
  while (ffmpegDownloading && waited < 10000) {
    await sleep(50)
    waited += 50
  }
  await fs.rm(`${ffmpegWritePath()}.part`, { force: true }).catch(() => undefined)
  await fs.rm(join(sttDir(), '.ffmpeg'), { force: true }).catch(() => undefined)
}

/** 删除已下载的 ffmpeg（含进行中则先取消）。只删 ffmpeg/ 子目录与旧根 ffmpeg(.exe)，不影响 whisper 引擎/模型 */
export async function removeFfmpeg(): Promise<void> {
  ffmpegCancelFlag = true
  let waited = 0
  while (ffmpegDownloading && waited < 10000) {
    await sleep(50)
    waited += 50
  }
  // 整删新布局 ffmpeg/ 子目录（与 whisper/模型彼此隔离）
  await fs.rm(ffmpegCanonicalDir(), { recursive: true, force: true }).catch(() => undefined)
  // 兼容旧布局：旧根 sttDir/ffmpeg(.exe) 一并清理
  await fs.rm(join(sttDir(), ffmpegName()), { force: true }).catch(() => undefined)
  await fs.rm(join(sttDir(), `${ffmpegName()}.part`), { force: true }).catch(() => undefined)
  await fs.rm(join(sttDir(), '.ffmpeg'), { force: true }).catch(() => undefined)
}