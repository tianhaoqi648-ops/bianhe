// ============================================================
// whisper-extract.ts — whisper.cpp 引擎压缩包（.zip / .tar.gz）解压
//
// 纯函数：输入压缩包字节，输出档案内的文件条目列表。
// 仅依赖 Node 内置 zlib（inflateRaw / gunzip），不引入第三方依赖，
// 以避免转写引擎下载链路增加包体积或安装风险。仅主进程使用。
//
// 说明：
//  - ZIP：解析 EOCD + Central Directory + 各文件 Local Header，
//         方法 8=deflate（inflateRaw），方法 0=stored；
//         忽略 zip64 / 加密 / 数据描述符（whisper 官方包不涉及）。
//  - tar.gz：gunzip 后按 512 字节 tar 头解析，跳过目录与链接。
// ============================================================

import { inflateRawSync, gunzipSync } from 'zlib'

/** 一个解压出的文件条目 */
export interface ArchiveEntry {
  /** 归一化文件名（已去路径分隔、改名安全） */
  name: string
  data: Uint8Array
}

const MAX_ENTRY_SIZE = 512 * 1024 * 1024 // 单条目 512MB 上限
const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024 // 总大小 2GB 上限

function isGzip(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

function isZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

/** 只保留基名，规避路径穿越（whisper 官方包无多级目录需求） */
function sanitizeName(raw: string): string {
  const norm = raw.replace(/\\/g, '/')
  const base = norm.split('/').filter(Boolean).pop() ?? ''
  if (base === '' || base === '.' || base === '..') return ''
  return base
}

// ---------------- ZIP ----------------

function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + (b[o + 3] < 128 ? b[o + 3] << 24 : (b[o + 3] - 256) << 24)
}
function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8)
}

function findEocd(buf: Uint8Array): number {
  const min = Math.max(0, buf.length - 65536 - 22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      return i
    }
  }
  throw new Error('ZIP：未找到目录尾（EOCD）')
}

interface ZipCentralEntry {
  name: string
  localOffset: number
}

function readZipCentral(buf: Uint8Array, eocd: number): ZipCentralEntry[] {
  const count = u16(buf, eocd + 10)
  let offset = u32(buf, eocd + 16)
  const entries: ZipCentralEntry[] = []
  for (let n = 0; n < count; n++) {
    if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4b) break
    const method = u16(buf, offset + 10)
    const namelen = u16(buf, offset + 28)
    const extralen = u16(buf, offset + 30)
    const commentlen = u16(buf, offset + 32)
    const localOffset = u32(buf, offset + 42)
    const name = Buffer.from(buf.slice(offset + 46, offset + 46 + namelen)).toString('utf8')
    if (method === 8 || method === 0) {
      const s = sanitizeName(name)
      if (s) entries.push({ name: s, localOffset })
    }
    offset += 46 + namelen + extralen + commentlen
  }
  return entries
}

function inflateEntry(buf: Uint8Array, file: ZipCentralEntry): Uint8Array {
  const lh = file.localOffset
  if (buf[lh] !== 0x50 || buf[lh + 1] !== 0x4b || buf[lh + 2] !== 0x03 || buf[lh + 3] !== 0x04)
    throw new Error('ZIP：文件头损坏')
  const method = u16(buf, lh + 8)
  const compSize = u32(buf, lh + 18)
  const nameLen = u16(buf, lh + 26)
  const extraLen = u16(buf, lh + 28)
  if (compSize > MAX_ENTRY_SIZE) throw new Error('ZIP：条目过大')
  const dataStart = lh + 30 + nameLen + extraLen
  const comp = buf.subarray(dataStart, dataStart + compSize)
  const cb = Buffer.from(comp.buffer, comp.byteOffset, comp.byteLength)
  if (method === 0) return new Uint8Array(comp)
  return new Uint8Array(inflateRawSync(cb))
}

// ---------------- TAR.GZ ----------------

function parseOct(s: string): number {
  const t = s.replace(/[^0-7]/g, '')
  return t ? parseInt(t, 8) || 0 : 0
}

function readTarGz(buf: Uint8Array): ArchiveEntry[] {
  const gz = gunzipSync(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength))
  const out: ArchiveEntry[] = []
  let idx = 0
  let total = 0
  while (idx + 512 <= gz.length) {
    const name = gz.subarray(idx, idx + 100).toString('utf8').replace(/\0.*$/, '')
    if (!name) break
    const size = parseOct(gz.subarray(idx + 124, idx + 136).toString('utf8'))
    const typeflag = String.fromCharCode(gz[idx + 156])
    const dataStart = idx + 512
    if (typeflag === '0' || typeflag === '\0' || typeflag === ' ') {
      const s = sanitizeName(name)
      if (s) {
        total += size
        if (size > MAX_ENTRY_SIZE || total > MAX_TOTAL_SIZE) throw new Error('tar：条目过大')
        out.push({ name: s, data: new Uint8Array(gz.subarray(dataStart, dataStart + size)) })
      }
    }
    idx = dataStart + size
    idx += (512 - (idx % 512)) % 512
  }
  return out
}

/**
 * 解压 whisper 引擎压缩包，返回其中的文件条目列表。
 * 依据文件头嗅探格式：gzip→tar.gz，PK→zip。
 */
export function extractArchive(buf: Uint8Array): ArchiveEntry[] {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (isGzip(b)) return readTarGz(b)
  if (isZip(b)) {
    const eocd = findEocd(b)
    const centrals = readZipCentral(b, eocd)
    const out: ArchiveEntry[] = []
    for (const f of centrals) {
      out.push({ name: f.name, data: inflateEntry(b, f) })
    }
    return out
  }
  throw new Error('未知的转写引擎压缩格式（仅支持 zip / tar.gz）')
}