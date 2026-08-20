// ============================================================
// stt-wav.ts — 录音转文字（STT）的 WAV(PCM mono 16-bit) 纯切片逻辑
//
// AI 裁判「整场评审」需要把整轨 wav 按环节/发言人标记（atMs）切成若干段，
// 分别交给本地 whisper.cpp / API 转写。本文件只含纯函数（解析头 / 算切片窗 /
// 生成切片 wav 字节），不含 electron / node ABI 依赖，可直接在 vitest 单测，
// 主进程 services/transcription.ts 复用并负责实际读写文件。
// ============================================================

/** 解析出的 WAV(PCM) 基本信息 */
export interface WavInfo {
  /** 采样率（Hz），如 16000/44100 */
  sampleRate: number
  /** 声道数（STT 期望 mono=1） */
  channels: number
  /** 位深（bit），STT 期望 16 */
  bitsPerSample: number
  /** 每帧字节数 = channels * bits/8 */
  blockAlign: number
  /** 每秒字节数 = sampleRate * blockAlign */
  byteRate: number
  /** PCM 数据块起始偏移（字节） */
  dataOffset: number
  /** PCM 数据字节数 */
  dataSize: number
  /** 总时长（毫秒） */
  durationMs: number
}

/** 一个切片窗（毫秒），[startMs, endMs) */
export interface SliceWindow {
  startMs: number
  endMs: number
}

const u16 = (buf: Uint8Array, o: number): number => buf[o] | (buf[o + 1] << 8)
const u32 = (buf: Uint8Array, o: number): number =>
  buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)

const ascii = (buf: Uint8Array, o: number, len: number): string => {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(buf[o + i])
  return s
}

/**
 * 解析标准 WAV 文件头（RIFF/WAVE，含 fmt + data chunk 扫描）。
 * 返回 null 表示文件不是可识别的 PCM WAV。
 */
export function parseWavHeader(buf: Uint8Array): WavInfo | null {
  if (buf.byteLength < 44) return null
  if (ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 4) !== 'WAVE') return null

  // fmt 子块（标准 16 字节）从偏移 12 开始
  if (ascii(buf, 12, 4) !== 'fmt ') return null
  const audioFormat = u16(buf, 20)
  if (audioFormat !== 1) return null // 仅 PCM
  const channels = u16(buf, 22)
  const sampleRate = u32(buf, 24)
  const bitsPerSample = u16(buf, 34)
  const blockAlign = Math.max(1, (channels * bitsPerSample) / 8)
  const byteRate = sampleRate * blockAlign

  // 扫描 data 子块（fmt 可能带有额外字节，故按 chunk 遍历）
  let pos = 12
  let dataOffset = -1
  let dataSize = 0
  while (pos + 8 <= buf.byteLength) {
    const id = ascii(buf, pos, 4)
    const size = u32(buf, pos + 4)
    if (id === 'data') {
      dataOffset = pos + 8
      dataSize = Math.min(size, Math.max(0, buf.byteLength - dataOffset))
      break
    }
    pos += 8 + size + (size & 1) // 补到偶数对齐
    if (size <= 0) break
  }
  if (dataOffset < 0 || dataSize <= 0) return null

  return {
    sampleRate,
    channels,
    bitsPerSample,
    blockAlign,
    byteRate,
    dataOffset,
    dataSize,
    durationMs: (dataSize / byteRate) * 1000
  }
}

/**
 * 由环节/发言人标记时间点计算切片窗（纯函数）。
 * @param totalDurationMs wav 总时长（毫秒）
 * @param atMsPoints 各标记相对录音起点的毫秒（自动排序去重、夹到 [0,total]）
 * @returns 依时间升序的切片窗数组；无有效标记时返回整段 [{0, total}]
 */
export function computeSliceWindows(totalDurationMs: number, atMsPoints: number[]): SliceWindow[] {
  const total = Math.max(0, totalDurationMs)
  const points = (atMsPoints || [])
    .filter((n) => typeof n === 'number' && Number.isFinite(n))
    .map((n) => Math.min(Math.max(0, Math.round(n)), total))
    .sort((a, b) => a - b)
    .filter((n, i, arr) => i === 0 || n > arr[i - 1])

  const boundaries = [0, ...points, total]
  const windows: SliceWindow[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startMs = boundaries[i]
    const endMs = boundaries[i + 1]
    if (endMs > startMs) windows.push({ startMs, endMs })
  }
  return windows
}

/** 按帧对齐计算的 PCM 数据区间 [startByte, endByte)（含 wav 头偏移） */
function pcmRange(
  info: WavInfo,
  w: SliceWindow
): { startByte: number; endByte: number } {
  const totalFrames = Math.floor(info.dataSize / Math.max(1, info.blockAlign))
  const startFrame = Math.floor((w.startMs / 1000) * info.sampleRate)
  const endFrame = Math.min(totalFrames, Math.ceil((w.endMs / 1000) * info.sampleRate))
  const s = Math.max(0, Math.min(totalFrames, startFrame))
  const e = Math.max(s, endFrame)
  return {
    startByte: info.dataOffset + s * info.blockAlign,
    endByte: info.dataOffset + e * info.blockAlign
  }
}

/** 重建一个标准 44 字节 PCM wav 头（复用 info 的采样参数，替换 data 大小） */
function buildWavHeader(info: WavInfo, dataLen: number): Uint8Array {
  const h = new Uint8Array(44)
  const setAscii = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i)
  }
  const setU16 = (o: number, v: number): void => {
    h[o] = v & 0xff
    h[o + 1] = (v >> 8) & 0xff
  }
  const setU32 = (o: number, v: number): void => {
    h[o] = v & 0xff
    h[o + 1] = (v >> 8) & 0xff
    h[o + 2] = (v >> 16) & 0xff
    h[o + 3] = (v >>> 24) & 0xff
  }
  const ckSize = 36 + dataLen
  setAscii(0, 'RIFF')
  setU32(4, ckSize)
  setAscii(8, 'WAVE')
  setAscii(12, 'fmt ')
  setU32(16, 16)
  setU16(20, 1) // PCM
  setU16(22, info.channels)
  setU32(24, info.sampleRate)
  setU32(28, info.byteRate)
  setU16(32, info.blockAlign)
  setU16(34, info.bitsPerSample)
  setAscii(36, 'data')
  setU32(40, dataLen)
  return h
}

/**
 * 从整段 wav 字节中切出指定 [startMs, endMs) 窗对应的独立 wav 文件字节。
 * @param buf 整段 wav 字节
 * @param info 由 parseWavHeader 解析得到
 * @param w 切片窗
 * @returns 新的、自含头的 wav 字节（PCM 参数与整段一致）
 */
export function sliceWavBuffer(buf: Uint8Array, info: WavInfo, w: SliceWindow): Uint8Array {
  const { startByte, endByte } = pcmRange(info, w)
  const data = buf.subarray(startByte, endByte)
  const out = new Uint8Array(44 + data.byteLength)
  out.set(buildWavHeader(info, data.byteLength), 0)
  out.set(data, 44)
  return out
}