// ============================================================
// transcription.ts — 录音转文字（STT）服务
//
// AI 裁判「整场评审」的 录音→分段转文字 引擎：
//   1. 本地引擎（本地实现二选一，settings stt.localEngine）：
//        - whisper 本地 whisper.cpp（检测 userData/stt 下 whisper 二进制 + ggml-<model>.bin，spawn 转写）
//        - funasr 本机 python funasr 环境（requests funasr-service，AutoModel 整段转写）
//   2. AI 兼容 API 兜底（POST {baseURL}/audio/transcriptions，OpenAI 兼容）
//
// 引擎解析：策略（local-first/local/api，stt.engine）决定是否用 API 兜底；
//          本地实现（whisper/funasr，stt.localEngine）决定本地用哪个引擎，两者正交。
// wav(PCM mono 16bit) 整段转写后，用 markers 归一化出的环节边界归段（bucketByStage）；
// webm/m4a 有 ffmpeg 时转码成 wav 同样整段转写，无 ffmpeg 则整段走 API/报错。
// 纯解析/归段逻辑在同文件的 parseWhisperSegments / bucketByStage（可单测）。
// ============================================================

import { app, net, dialog } from 'electron'
import { promises as fs, existsSync, readdirSync } from 'fs'
import { spawn } from 'child_process'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import type { SttEngine, SttLocalEngine, SttRequest, SttSegment, SttDirDiagnostics } from '../../shared/types'
import { STT_ENGINE_KEY, STT_MODEL_KEY, STT_DIR_NAME, STT_LOCAL_ENGINE_KEY } from '../../shared/types'
import { STT_DIR_KEY } from '../../shared/match-recording'
import { parseWavHeader, computeSliceWindows, sliceWavBuffer } from '../../shared/stt-wav'
import { auditRepo } from '../db/repository/audit.repo'
import { getFfmpegStatus, transcodeToWav, ffmpegPath } from './ffmpeg-service'
// FunASR 本地引擎：环境检测 + 依赖自检 + 整段转写（与 whisper.cpp 并列的第二种本地实现）
import {
  transcribeWholeFunAsr,
  currentFunAsrModel,
  checkFunAsrReadiness,
  type FunAsrReadiness
} from './funasr-service'

// ============================================================
// 路径与解析工具
// ============================================================

/** 用户配置的转写引擎目录（settings 中存的完整绝对路径；未配置返回 ''） */
export function getConfiguredSttDir(): string {
  const v = auditRepo.getSetting(STT_DIR_KEY)
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

/**
 * 归一化转写引擎目录。
 *
 * stt.dir 保存的是用户选择的「数据根目录」，实际引擎目录固定落为 `<根>/stt`，
 * 以便与 NSIS 保护脚本（只保护 $INSTDIR/stt*）对所有自定义目录名统一匹配，避免更新清空。
 * - root 为空 → 用默认 userData/stt
 * - root 最后一段已是 stt（大小写不敏感，精确某段） → 直接用 root（避免 stt/stt）
 * - 否则 → join(root, 'stt')
 */
export function resolveSttDir(root: string): string {
  if (!root || !root.trim()) {
    return join(app.getPath('userData'), STT_DIR_NAME)
  }
  const finalSeg = basename(root)
  if (finalSeg.toLowerCase() === STT_DIR_NAME.toLowerCase()) {
    return root
  }
  return join(root, STT_DIR_NAME)
}

/** 转写引擎目录：stt.dir 为数据根目录，实际目录为 <根>/stt；缺省回退 userData/stt */
export function sttDir(): string {
  return resolveSttDir(getConfiguredSttDir())
}

/** 模型子目录名（sttDir/models/<model>/），各模型彼此隔离 */
export const MODELS_DIR = 'models'
/** ffmpeg 子目录名（sttDir/ffmpeg/），与模型/二进制隔离 */
export const FFMPEG_DIR = 'ffmpeg'

/** ffmpeg 子目录规范路径（sttDir/ffmpeg），供 ffmpeg-service 读写用 */
export function ffmpegCanonicalDir(): string {
  return join(sttDir(), FFMPEG_DIR)
}

/** whisper 二进制文件名（win 为 whisper.exe，其余为 whisper） */
export function whisperBinaryName(): string {
  return process.platform === 'win32' ? 'whisper.exe' : 'whisper'
}

/** 手动指定本机已有 whisper 转写器（whisper-cli）的路径设置项；空=用下载/内置 */
export const WHISPER_CLI_KEY = 'stt.whisperCliPath'

/** whisper 二进制绝对路径：优先用户手动指定的 whisper-cli；否则用 sttDir() 下的 whisper(.exe) */
export function whisperBinaryPath(): string {
  const manual = auditRepo.getSetting(WHISPER_CLI_KEY)
  if (typeof manual === 'string' && manual.trim()) return manual.trim()
  return join(sttDir(), whisperBinaryName())
}

/** 手动设置/清除 whisper 转写器路径，返回是否指向有效文件 */
export async function setWhisperCliManualPath(path: string): Promise<boolean> {
  const p = (path ?? '').trim()
  auditRepo.setSetting(WHISPER_CLI_KEY, p)
  return isFileP(p)
}

/** 手动选择本机已有的 whisper-cli 可执行文件（离线兜底，免在线下载） */
export async function pickWhisperCli(): Promise<boolean> {
  const win = process.platform === 'win32'
  const res = await dialog.showOpenDialog({
    title: '选择本机已有的 whisper 转写器（whisper-cli，非 bench ）',
    properties: ['openFile'],
    filters: [{ name: 'whisper', extensions: win ? ['exe'] : ['*'] }]
  })
  if (res.canceled || !res.filePaths || !res.filePaths[0]) {
    return isFileP(whisperBinaryPath())
  }
  auditRepo.setSetting(WHISPER_CLI_KEY, res.filePaths[0].trim())
  return isFileP(res.filePaths[0])
}

/** 清除手动 whisper 转写器路径 */
export async function clearWhisperCli(): Promise<boolean> {
  auditRepo.setSetting(WHISPER_CLI_KEY, '')
  return isFileP(join(sttDir(), whisperBinaryName()))
}

/**
 * stt 目录诊断：返回当前生效转写目录路径，以及 whisper 二进制 / ffmpeg / 已装模型子目录是否在位。
 * 供「设置 → AI 转写」展示引擎与数据存放位置，并在更新后数据缺失时引导找回。
 */
export function getSttDirDiagnostics(): SttDirDiagnostics {
  const dir = sttDir()
  let models: string[] = []
  try {
    models = readdirSync(join(dir, MODELS_DIR), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch {
    models = []
  }
  return {
    path: dir,
    hasWhisperCli: pathExists(whisperBinaryPath()),
    hasFfmpeg: pathExists(ffmpegPath()),
    models
  }
}

async function isFileP(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p)
    return s.isFile()
  } catch {
    return false
  }
}

/** 指定模型的 ggml-<model>.bin 绝对路径（新布局：sttDir/models/<model>/，写/下载用） */
export function whisperModelPath(model: string): string {
  return join(sttDir(), MODELS_DIR, model, `ggml-${model}.bin`)
}

/** 同步判断路径是否存在（目录/文件均可） */
function pathExists(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

/**
 * 解析指定模型实际可用的 ggml-<model>.bin 路径（读取/状态判定用）：
 * 新布局 sttDir/models/<model>/… 存在 → 用它；否则旧根 sttDir/ggml-<model>.bin 存在 → 旧路径（兼容旧布局）；
 * 均不存在 → 返回新布局路径作为写/装缺省。
 */
export function resolveExistingModelPath(model: string): string {
  const canonical = join(sttDir(), MODELS_DIR, model, `ggml-${model}.bin`)
  if (pathExists(canonical)) return canonical
  const legacy = join(sttDir(), `ggml-${model}.bin`)
  if (pathExists(legacy)) return legacy
  return canonical
}

/** 规范化模型名（trim + 去非法文件名字符）；缺省/非法回退 fallback */
export function asWhisperModel(model: string | undefined, fallback = 'base'): string {
  if (typeof model === 'string') {
    const m = model.trim().replace(/[\\/:*?"<>|]/g, '')
    if (m) return m
  }
  return fallback
}

/** 解析引擎设置值 → 'local-first' | 'local' | 'api'（缺省/非法回退 local-first） */
export function resolveSttEngine(value: unknown): SttEngine {
  return value === 'local' ? 'local' : value === 'api' ? 'api' : 'local-first'
}

/** 解析「本地引擎实现」设置值 → 'whisper' | 'funasr'（缺省/非法回退 whisper）。仅影响本地实现，与策略 STT_ENGINE_KEY 正交。 */
export function resolveSttLocalEngine(value: unknown): SttLocalEngine {
  return value === 'funasr' ? 'funasr' : 'whisper'
}

/** AI 转写兜底所需的镜像配置（baseURL/apiKey/model） */
export interface AiTranscribeConfig {
  baseURL: string
  apiKey: string
  model: string
}

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * 从 settings 表读取 AI 镜像配置（读写阵营与 llm-client 一致）。
 * 优先读整对象键 `agent.llm`（LLMConfig，见 shared/agent-types 注释），
 * 否则回退拆分键 `ai.baseURL` / `ai.apiKey` / `ai.model`。
 */
export function readAiConfigFromSettings(): AiTranscribeConfig {
  const stored = auditRepo.getSetting('agent.llm')
  if (stored && typeof stored === 'object') {
    const o = stored as Record<string, unknown>
    return {
      baseURL: asString(o.baseURL),
      apiKey: asString(o.apiKey),
      model: asString(o.model)
    }
  }
  return {
    baseURL: asString(auditRepo.getSetting('ai.baseURL')),
    apiKey: asString(auditRepo.getSetting('ai.apiKey')),
    model: asString(auditRepo.getSetting('ai.model'))
  }
}

// ============================================================
// whisper.cpp stdout 解析（可单测的纯函数）
// ============================================================

/** whisper 调试日志行前缀黑名单（与 extractStdoutText 一致，避免日志混进转写结果） */
const STT_LOG_LINE_RE = /^(load_|whisper_|read_audio|system_info|main:|whisper_print_timings|\s*\{)/i

/**
 * 匹配形如 `[MM:SS.mmm --> MM:SS.mmm]  文本` 或 `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  文本` 的行。
 * 捕获组：1=开始时间、2=结束时间、3=文本（时间戳后的整行）。小时与分钟至多 3 位，兼容长时长录音。
 */
const STT_TIMESTAMP_LINE_RE =
  /^\[\s*(\d{1,3}:\d{2}(?::\d{2})?\.\d{3})\s*-->\s*(\d{1,3}:\d{2}(?::\d{2})?\.\d{3})\]\s*(.*)$/

/**
 * 把 whisper 时间戳串转为毫秒。
 * 支持 MM:SS.mmm（分钟）与 HH:MM:SS.mmm（小时，可多位）两种格式：
 *   MM:SS.mmm   → (MM*60+SS)*1000 + mmm
 *   HH:MM:SS.mmm→ ((HH*60+MM)*60+SS)*1000 + mmm
 */
function timestampToMs(ts: string): number {
  const dot = ts.indexOf('.')
  const mmm = Number(ts.slice(dot + 1))
  const cols = ts.slice(0, dot).split(':').map(Number)
  if (cols.length === 3) {
    const [h, m, s] = cols
    return ((h * 60 + m) * 60 + s) * 1000 + mmm
  }
  const [m, s] = cols
  return (m * 60 + s) * 1000 + mmm
}

/**
 * 逐行解析 whisper.cpp 输出的带时间戳转写段（纯函数，可在 vitest 单测）。
 * 兼容 `[MM:SS.mmm --> MM:SS.mmm]` 与 `[HH:MM:SS.mmm --> HH:MM:SS.mmm]` 两种时间戳格式，
 * 返回每段的开始毫秒 / 结束毫秒 / 文本。自动跳过空行、whisper 分隔符行（如 `--`）
 * 与调试日志行（STT_LOG_LINE_RE 黑名单），确保日志不混进转写段。
 */
export function parseWhisperSegments(
  out: string
): Array<{ startMs: number; endMs: number; text: string }> {
  const segments: Array<{ startMs: number; endMs: number; text: string }> = []
  for (const line of (out || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (STT_LOG_LINE_RE.test(trimmed)) continue
    const m = trimmed.match(STT_TIMESTAMP_LINE_RE)
    if (!m) continue // 非时间戳行（分隔符 / 其他噪声）直接跳过
    const text = (m[3] || '').trim()
    if (!text) continue // 无文本的空时间戳行忽略
    segments.push({ startMs: timestampToMs(m[1]), endMs: timestampToMs(m[2]), text })
  }
  return segments
}

/**
 * 把整段转写出的时间戳段按「环节区间」归组（纯函数，可在 vitest 单测）。
 * @param segs 整段转写出的时间戳段（每条含 startMs/endMs/text）
 * @param stageTimes 各环节边界毫秒（相对或绝对均可；首个非 0 时统一减去首值使首个为 0）
 * @param labels 与归一化后 stageTimes 一一对应的环节标签；某项为 undefined 表示该环节无归属
 * @returns 按 time 排序的归组段；同一环节的多条语句文本用换行合并、startMs 取该环节首条
 * 当 stageTimes 为空、无有效标签或 segs 为空时，返回单段（无 stage/speaker，text 为全部文本按行合并）。
 */
export function bucketByStage(
  segs: Array<{ startMs: number; endMs: number; text: string }>,
  stageTimes: number[],
  labels: Array<{ stage: string; speaker?: string } | undefined>
): Array<{ stage?: string; speaker?: string; text: string; startMs: number }> {
  const list = segs || []
  const raw = (stageTimes || []).filter((n) => typeof n === 'number' && Number.isFinite(n))
  const times = Array.from(new Set(raw.map((n) => Math.round(n)))).sort((a, b) => a - b)
  const lt = labels || []

  // stageTimes 为空或无有效标记 → 整段归一个单段（无 stage/speaker）
  if (times.length === 0 || !lt.some((l) => l)) {
    return [
      {
        text: list.map((s) => s.text).join('\n'),
        startMs: list.length ? list[0].startMs : 0
      }
    ]
  }

  // 归一化：首个非 0 时统一减去首值，使首个边界为 0
  const first = times[0]
  const norm = first !== 0 ? times.map((t) => t - first) : times

  // 每条 seg 按其 startMs 落在哪个环节区间 → 归入该环节
  const size = norm.length
  const ofBucket = (startMs: number): number => {
    let idx = 0
    for (let i = 0; i < size; i++) {
      if (startMs >= norm[i]) idx = i
      else break
    }
    return idx
  }

  // 依 segs 原顺序聚合到各环节桶（list 本身按时间升序，故桶也按环节升序出现）
  const buckets: Array<{ idx: number; items: typeof list }> = []
  for (const s of list) {
    const idx = ofBucket(s.startMs)
    const b = buckets.find((x) => x.idx === idx)
    if (b) b.items.push(s)
    else buckets.push({ idx, items: [s] })
  }

  return buckets.map((b) => {
    const label = lt[b.idx]
    return {
      ...(label?.stage !== undefined ? { stage: label.stage } : {}),
      ...(label?.speaker !== undefined ? { speaker: label.speaker } : {}),
      text: b.items.map((s) => s.text).join('\n'),
      startMs: b.items[0].startMs
    }
  })
}

/**
 * 把 whisper.cpp 输出到 stdout 的文本解析为纯文本。
 * stdout 每一行形如：
 *   [00:00:00.000 --> 00:00:03.500]   各位评委好
 * 这里剥掉时间戳前缀，合并为多行文本。
 */
export function parseWhisperStdout(out: string): string {
  const parts: string[] = []
  for (const line of (out || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const cleaned = trimmed.replace(
      /^\[\s*\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\s*-->\s*\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\]\s*/,
      ''
    )
    if (cleaned) parts.push(cleaned)
  }
  return parts.join('\n')
}

// ============================================================
// wav 切片（纯逻辑在 shared/stt-wav；此处做文件读写）
// ============================================================

export interface WavSlice {
  startMs: number
  endMs: number
  path: string
}

/**
 * 按 markers 的 atMs 把 wav 切成若干独立小段 wav，写入 outDir（用完请清理）。
 * 返回各段相对整段的 [startMs,endMs) 与临时文件路径。
 */
export async function sliceWavSegments(
  wavPath: string,
  markers: SttRequest['markers'],
  outDir: string
): Promise<WavSlice[]> {
  const buf = await fs.readFile(wavPath)
  const info = parseWavHeader(new Uint8Array(buf))
  if (!info) throw new Error('无法解析录音 wav 文件头（需带 fmt/data 的 PCM WAV）')
  if (info.channels !== 1) {
    throw new Error(`当前仅支持 mono（单声道）wav，实际为 ${info.channels} 声道`)
  }
  const points = (markers || []).map((m) => m.atMs).filter((n) => typeof n === 'number')
  const windows = computeSliceWindows(info.durationMs, points)
  if (windows.length === 0) throw new Error('wav 数据为空，无法切片')

  await fs.mkdir(outDir, { recursive: true })
  const slices: WavSlice[] = []
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const segBuf = sliceWavBuffer(buf, info, w)
    const path = join(outDir, `seg-${i}-${Math.round(w.startMs)}.wav`)
    await fs.writeFile(path, Buffer.from(segBuf))
    slices.push({ startMs: w.startMs, endMs: w.endMs, path })
  }
  return slices
}

/** 转录分窗时长：whisper 对 30s 左右的完整段落效果最好；过小的片段会明显掉词 */
const TRANSCRIBE_WINDOW_MS = 30_000

/**
 * 把 wav 按「环节边界 + 每环节内 ≤TRANSCRIBE_WINDOW_MS」切成独立小段 wav。
 * - 一个窗口不会跨越环节边界 → 时间线归口正确（不会把多环节内容塞进一个环节框）；
 * - 每段 ≤30s → 保证 whisper 转写精度。
 * 标记的 atMs 若为绝对时间戳（epoch），按「首个标记=0」归一化后再切分。
 * 返回可直接转写的 targets（path/stage/speaker/atMs）。
 */
export async function sliceWavWindows(
  wavPath: string,
  markers: SttRequest['markers'],
  outDir: string
): Promise<Array<{ path: string; stage?: string; speaker?: string; atMs: number }>> {
  const buf = await fs.readFile(wavPath)
  const info = parseWavHeader(new Uint8Array(buf))
  if (!info) throw new Error('无法解析录音 wav 文件头（需带 fmt/data 的 PCM WAV）')
  if (info.channels !== 1) {
    throw new Error(`当前仅支持 mono（单声道）wav，实际为 ${info.channels} 声道`)
  }

  // 环节边界（归一化到相对起始）：取有 atMs 的标记；首个标记视为 0
  const withTime = (markers || []).filter((m) => typeof m.atMs === 'number')
  let stageTimes: number[] = []
  if (withTime.length) {
    const min = Math.min(...withTime.map((m) => m.atMs as number))
    stageTimes = Array.from(
      new Set(withTime.map((m) => Math.max(0, (m.atMs as number) - min)))
    ).sort((a, b) => a - b)
  }

  // 边界：0 + 每段起点 + 段内 30s 分步 + 段尾（不跨环节）
  const bounds: number[] = [0]
  const spanEnds = stageTimes.length ? stageTimes : [info.durationMs]
  for (const end of spanEnds) {
    let b = bounds[bounds.length - 1]
    while (b + TRANSCRIBE_WINDOW_MS < end) {
      b += TRANSCRIBE_WINDOW_MS
      bounds.push(b)
    }
    if (bounds[bounds.length - 1] !== end) bounds.push(end)
  }
  if (bounds[bounds.length - 1] !== info.durationMs) bounds.push(info.durationMs)

  const windows = computeSliceWindows(info.durationMs, bounds.slice(1))
  if (windows.length === 0) throw new Error('wav 数据为空，无法切片')

  // 归口：窗口起点落在哪个环节区间，就标成哪个环节
  const labelFor = (startMs: number): { stage?: string; speaker?: string } => {
    const withT = (markers || []).filter((m) => typeof m.atMs === 'number')
    if (!withT.length || stageTimes.length === 0) return {}
    const rel = Math.max(0, startMs) // startMs 已是相对
    let idx = 0
    for (let i = 0; i < stageTimes.length; i++) {
      if (rel >= stageTimes[i]) idx = i
      else break
    }
    const mk = withT[idx]
    return { stage: mk?.stage, speaker: mk?.speaker }
  }

  await fs.mkdir(outDir, { recursive: true })
  const out: Array<{ path: string; stage?: string; speaker?: string; atMs: number }> = []
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const segBuf = sliceWavBuffer(buf, info, w)
    const path = join(outDir, `win-${i}-${Math.round(w.startMs)}.wav`)
    await fs.writeFile(path, Buffer.from(segBuf))
    out.push({ path, ...labelFor(w.startMs), atMs: w.startMs })
  }
  return out
}

/**
 * 从 whisper 输出里提取转写文本。
 * 只保留形如 [hh:mm:ss.mmm --> hh:mm:ss.mmm] 文本 的时间戳行并按行合并；
 * 并丢弃 whisper 的调试日志行（load 前缀、whisper 前缀、system_info、main: 处理行等），
 * 避免日志混进转写文本框。
 */
export function extractStdoutText(out: string): string {
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const parts: string[] = []
  for (const line of lines) {
    if (STT_LOG_LINE_RE.test(line)) continue
    const m = line.match(STT_TIMESTAMP_LINE_RE)
    if (m && m[3] && m[3].trim()) parts.push(m[3].trim())
    else if (!m && !/\d{4}-\d{2}-\d{2}T/.test(line) && !/\.(wav|mp3|webm|m4a|bin|dll)/i.test(line)) {
      // 兜底：仅接纳不像日志、不含路径/时间戳的字行
      parts.push(line)
    }
  }
  return parts.join('\n')
}

/**
 * spawn whisper.cpp 对单个 wav 文件进行「整段」转写，返回带时间戳的转写段数组。
 * - 不传任何输出文件开关（`-ot` 在部分版本会抑制控制台输出，导致拿不到文本）；
 *   whisper 默认会把形如 `[hh:mm:ss.mmm --> hh:mm:ss.mmm]  文本` 打到 stdout。
 * - 同时解析 stderr（某些构建把转写写到 stderr），兜底合并两者后交给 parseWhisperSegments 解析。
 * 期望输入为 16k mono wav（whisper.cpp 支持任意采样率，内部重采样）。
 */
function transcribeWholeLocal(
  wavPath: string,
  binaryPath: string,
  modelPath: string
): Promise<Array<{ startMs: number; endMs: number; text: string }>> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(
        binaryPath,
        ['-m', modelPath, '-l', 'zh', '-f', wavPath],
        { windowsHide: true }
      )
    } catch (e) {
      reject(new Error(`无法启动 whisper：${e instanceof Error ? e.message : String(e)}`))
      return
    }
    let out = ''
    let err = ''
    child.stdout!.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr!.on('data', (d: Buffer) => (err += d.toString('utf8')))
    child.on('error', (e) => reject(new Error(`无法启动 whisper：${e.message}`)))
    child.on('close', (code) => {
      // 整段转写：合并 stdout 与 stderr 后解析出全部带时间戳的转写段
      const segments = parseWhisperSegments(`${out}\n${err}`)
      if (code === 0) {
        resolve(segments)
        return
      }
      reject(
        new Error(
          `whisper 退出码 ${code}：${err.trim() || out.trim() || '未知错误'}${
            segments.length ? `（已识别到：${segments.map((s) => s.text).join('').slice(0, 60)}）` : ''
          }`
        )
      )
    })
  })
}

// ============================================================
// AI 兼容 API 兜底（OpenAI /audio/transcriptions）
// ============================================================

async function transcribeSegmentApi(filePath: string, cfg: AiTranscribeConfig): Promise<string> {
  const base = cfg.baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
  const buf = await fs.readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buf)]), basename(filePath))
  form.append('model', cfg.model || 'whisper-1')
  // 端点候选：有的 OpenAI 兼容供应商把转写挂在 /audio/transcriptions，有的在 /v1/audio/transcriptions
  const urls = [`${base}/audio/transcriptions`, `${base}/v1/audio/transcriptions`]
  let lastBody = ''
  for (const url of urls) {
    const res = await net.fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form
    })
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { text?: string } | null
      return typeof data?.text === 'string' ? data.text : ''
    }
    const body = (await res.text().catch(() => '')) || `HTTP ${res.status}`
    if (res.status === 404) {
      lastBody = body
      continue // 路径不对，试下一个候选端点
    }
    throw new Error(`转写 API 失败：${body}`)
  }
  throw new Error(`转写 API 失败：${lastBody || `${urls[0]} 不可用（404）`}，请检查 AI 的 baseURL 是否正确（需为 OpenAI 兼容的转录端点，可能需要 /v1）`)
}

/** 本地模型缺失/失败且无 AI 兜底时，随错误一同给出的分步引导 */
const STT_GUIDE_SUFFIX =
  '可到「设置 → AI 转写」：下载转写引擎，或导入本地模型（ggml-*.bin）；也可把引擎切为“仅 API”后配置 AI 助手。'

/** 本地引擎选择为 FunASR 但本机无 python/funasr 运行环境时的引导 */
const FUNASR_MISSING_MSG =
  '本地引擎选为 FunASR，但本机未检测到 python 的 funasr 运行环境。' +
  '请先在本机安装 Python 并执行 `pip install funasr`（首次运行会联网拉取模型）；' +
  '或在「设置 → AI 转写」把本地引擎改回 whisper 继续离线转写。'

/**
 * 依据 FunASR 就绪探测结果生成用户可读的错误引导。
 * - no-funasr：未装 funasr 包；
 * - missing-deps：缺推理依赖，指出具体模块名与一键安装/手动 pip 命令；
 * - env-error：依赖探针无法运行，环境级异常。
 */
function funasrUnreadyMessage(r: FunAsrReadiness | undefined): string {
  if (r?.reason === 'missing-deps') {
    return (
      `本地引擎选为 FunASR，但缺少推理依赖：${r.missingDeps.join('、')}。` +
      '请到「设置 → AI 转写」点击“一键安装 FunASR 依赖”补全，或执行：' +
      `pip install ${r.missingDeps.join(' ')}；也可把本地引擎改回 whisper 继续离线转写。`
    )
  }
  if (r?.reason === 'env-error') {
    return (
      '本地引擎选为 FunASR，但无法确认其运行环境（依赖探针执行失败）。' +
      '请重试，或手动执行：pip install torch torchaudio；也可把本地引擎改回 whisper 继续离线转写。'
    )
  }
  return FUNASR_MISSING_MSG
}

// ============================================================
// 对外入口
// ============================================================

async function isFile(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p)
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
}

/**
 * 组装 AI 转写兜底配置：优先用请求里传入的 req.aiConfig（渲染端可带 localStorage 配置），
 * 未传再回读 settings 表。
 */
function buildAiConfig(req: SttRequest): AiTranscribeConfig {
  if (req.aiConfig && typeof req.aiConfig === 'object') {
    return {
      baseURL: asString(req.aiConfig.baseURL),
      apiKey: asString(req.aiConfig.apiKey),
      model: asString(req.aiConfig.model)
    }
  }
  return readAiConfigFromSettings()
}

/**
 * 对一份录音执行「整段转写 → 按环节归段」。
 * - wav（或经 ffmpeg 转码出的 wav）：整段本地转写得到带时间戳的转写段，
 *   再按 markers 归一化出的环节边界聚合成按 startMs 升序的 SttSegment[]（stage/speaker 取自对应环节标记）。
 * - webm/m4a/其他：有 ffmpeg 转成 wav 同上；无 ffmpeg 走 API（单段）或明确报错。
 * @param req 转写请求
 * @returns 按时间升序的文本段（无标记时整段归一个 SttSegment）
 */
export async function transcribeRecordings(req: SttRequest): Promise<SttSegment[]> {
  if (!req || typeof req.filePath !== 'string' || !req.filePath.trim()) {
    throw new Error('参数 filePath 必须为非空字符串')
  }

  const engine = req.engine ?? resolveSttEngine(auditRepo.getSetting(STT_ENGINE_KEY))
  const model = asWhisperModel(req.model ?? auditRepo.getSetting(STT_MODEL_KEY))
  const filePath = req.filePath.trim()
  const markers = Array.isArray(req.markers) ? req.markers : []

  const aiConfig = buildAiConfig(req)
  const hasApi = !!(aiConfig.apiKey && aiConfig.baseURL)
  const binaryPath = whisperBinaryPath()
  // 模型用「新布局优先、旧根兜底」的实际存在路径（兼容旧布局的已装模型）
  const modelPath = resolveExistingModelPath(model)
  const localReady = (await isFile(binaryPath)) && (await isFile(modelPath))

  // 1. 确定为「可直接喂给本地 whisper 整段转写」的 wav 路径：
  //    原 wav 直接用；非 wav 且本机有 ffmpeg 时转成 16k mono wav；否则留给 API/报错分支
  const tmpSegDir = await fs.mkdtemp(join(tmpdir(), 'stt-seg-'))
  try {
    const isOriginalWav = extname(filePath).toLowerCase() === '.wav'
    const last = markers.length ? markers[markers.length - 1] : undefined
    let localWav: string | undefined
    let ffmpegFailedToApi = false

    if (isOriginalWav) {
      // 原 wav：整段转写，不再按 30s 物理切片（避免切点掉字/质量下降）
      localWav = filePath
    } else if (engine === 'api') {
      // 仅 API：直接喂原始文件即可，无需 ffmpeg 转码（避免「ffmpeg 转码失败」卡住 API 用户）
      localWav = filePath
    } else {
      // 非 wav（m4a/webm/mp3 等）：本地引擎需 16k mono wav → 优先本机 ffmpeg 转码；
      // 转码失败且已配 API 时回退 API（喂原始文件），避免硬错误；无 API 才报错提示。
      const ff = await getFfmpegStatus()
      const ffReady = ff.installed && (await isFile(ffmpegPath()))
      if (ffReady) {
        const wav = join(tmpSegDir, 'transcoded.wav')
        try {
          await transcodeToWav(filePath, wav, { ar: 16000, ac: 1 })
          localWav = wav
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e)
          if (hasApi) {
            ffmpegFailedToApi = true // 有 API 时不被转码卡住，改用 API 转写原始文件
          } else {
            throw new Error(
              `ffmpeg 转码失败：${em}。可改用 AI API（把引擎设为「仅 API」并配置 AI 助手），或更换 ffmpeg 后重试。`
            )
          }
        }
      }
    }

    const isWav = localWav !== undefined

    // 2. 按引擎策略「整段」转写，得到带时间戳的转写段（不再逐小段拼接）
    //    ffmpeg 转码失败但有 API 时，回退到 API 处理原始文件
    const effEngine = ffmpegFailedToApi ? 'api' : engine
    let timeSegs: Array<{ startMs: number; endMs: number; text: string }> = []

    if (effEngine === 'api') {
      // 仅 API：整段文件转写为一段（T4 保持 API 单段语义）
      if (!hasApi) throw new Error('未配置 AI API（baseURL/apiKey），无法使用 API 转写')
      const text = (await transcribeSegmentApi(localWav ?? filePath, aiConfig)).trim()
      if (!text) throw new Error('未识别到有效语音（API 未返回文本）。请确认录音内容或检查 AI 配置。')
      return [{ stage: last?.stage, speaker: last?.speaker, atMs: last?.atMs ?? 0, text }]
    }

    if (isWav) {
      // wav：本机输料为 16k mono wav，按「本地引擎实现」路由整段转写（whisper / funasr）
      const wav = localWav as string
      const localEngine =
        req.localEngine ?? resolveSttLocalEngine(auditRepo.getSetting(STT_LOCAL_ENGINE_KEY))
      const funasrWanted = localEngine === 'funasr'

      // 本地引擎可用性：whisper 需 binary+模型（前文 localReady）；funasr 需本机 python 环境 + 推理依赖齐全
      const funasrCheck = funasrWanted ? await checkFunAsrReadiness() : undefined
      const funasrOk = funasrWanted ? !!funasrCheck?.ready : false
      const localOk = funasrWanted ? funasrOk : localReady

      // 选中的本地引擎执行整段转写（whisper → transcribeWholeLocal；funasr → transcribeWholeFunAsr）
      const localWanted = funasrWanted ? 'funasr' : 'whisper'
      const transcribeLocal = async (): Promise<typeof timeSegs> =>
        funasrWanted
          ? transcribeWholeFunAsr(wav, currentFunAsrModel())
          : transcribeWholeLocal(wav, binaryPath, modelPath)

      if (engine === 'local') {
        if (!localOk) {
          throw new Error(
            funasrWanted
              ? funasrUnreadyMessage(funasrCheck)
              : `本地转写引擎未安装（模型 ${model}），请先在设置里下载转写引擎。${STT_GUIDE_SUFFIX}`
          )
        }
        timeSegs = await transcribeLocal()
      } else {
        // local-first
        if (!localOk && !hasApi) {
          throw new Error(
            funasrWanted
              ? funasrUnreadyMessage(funasrCheck)
              : `本地转写引擎未安装（模型 ${model}），且未配置 AI API。${STT_GUIDE_SUFFIX}`
          )
        }
        if (localOk) {
          timeSegs = await transcribeLocal()
        }
        // 整段本地无有效文本（或本地不足）→ 回退 API 整段再试一次
        if (timeSegs.length === 0 && hasApi) {
          const apiText = (await transcribeSegmentApi(wav, aiConfig)).trim()
          if (apiText) timeSegs = [{ startMs: 0, endMs: 0, text: apiText }]
        }
      }

      if (timeSegs.length === 0) {
        throw new Error(
          `未识别到有效语音（录音可能静音/无人声，或本地${localWanted}未出字）。请确认录音内容；如需离线本地转写，建议改用 WAV 录音。`
        )
      }

      // 3. 归段：按 markers 归一化出的环节边界，把整段转写聚合成 SttSegment[]
      const withTime = markers.filter((m) => typeof m.atMs === 'number')
      const labels = withTime.map((m) => ({ stage: m.stage, speaker: m.speaker }))
      const stageTimes = withTime.map((m) => m.atMs as number)
      const buckets = bucketByStage(timeSegs, stageTimes, labels)
      return buckets.map((b) => ({
        stage: b.stage,
        speaker: b.speaker,
        atMs: b.startMs,
        text: b.text
      }))
    }

    // 非 wav 且无 ffmpeg（localWav 未生成）：本地 whisper 内置解码器不支持这些容器
    if (engine === 'local') {
      // 仅本地：绝不回退 API；无 ffmpeg 时明确报错
      throw new Error(
        `当前录音不是 WAV 格式，且未检测到 ffmpeg 转码器（本地 whisper 不支持 m4a/webm 等解码）。` +
          `请改用 WAV 录音、到「设置 → AI 转写」下载转码器（ffmpeg），或把引擎改为「仅 API」。`
      )
    }
    // local-first / api：有 API 则整段走 API（本地无 ffmpeg 时不强转）
    if (hasApi) {
      const text = (await transcribeSegmentApi(filePath, aiConfig)).trim()
      if (text) return [{ stage: last?.stage, speaker: last?.speaker, atMs: last?.atMs ?? 0, text }]
      throw new Error('未识别到有效语音（API 未返回文本）。请确认录音内容或检查 AI 配置。')
    } else if (engine === 'local-first') {
      throw new Error(
        `当前录音不是 WAV 格式，且未检测到 ffmpeg 转码器，也未配置 AI API。` +
          `请改用 WAV 录音、下载转码器（ffmpeg），或配置 AI API。${STT_GUIDE_SUFFIX}`
      )
    } else {
      throw new Error('未配置 AI API（baseURL/apiKey），无法转写该音频格式')
    }
  } finally {
    await fs.rm(tmpSegDir, { recursive: true, force: true }).catch(() => {
      // 临时切片目录清理失败可忽略
    })
  }
}