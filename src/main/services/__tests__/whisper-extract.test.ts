import { describe, it, expect } from 'vitest'
import { gzipSync } from 'zlib'
import { extractArchive } from '../whisper-extract'

// ---------------- 构建测试用压缩包 ----------------

function buildTarGz(files: Array<{ name: string; data: Buffer }>): Buffer {
  const blocks: Buffer[] = []
  const writeOctal = (v: number, len: number): Buffer => {
    const s = v.toString(8).padStart(len - 1, '0') + '\0'
    return Buffer.from(s, 'latin1')
  }
  for (const f of files) {
    const header = Buffer.alloc(512)
    header.write(f.name, 0, 'utf8')
    writeOctal(f.data.length, 12).copy(header, 124)
    header[156] = '0'.charCodeAt(0) // 普通文件
    header.write('0000777\0', 100, 'utf8') // mode
    blocks.push(header, f.data)
    // tar 要求每个文件数据区按 512 对齐
    blocks.push(Buffer.alloc((512 - (f.data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024)) // 结束标记（两个空块）
  const tar = Buffer.concat(blocks)
  return gzipSync(tar) as Buffer
}

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  }
  return ~c >>> 0
}

function buildStoredZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data)
    // local header
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: stored
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(f.data.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra len
    const localBlock = Buffer.concat([local, nameBuf, f.data])
    chunks.push(localBlock)

    const cent = Buffer.alloc(46)
    cent.writeUInt32LE(0x02014b50, 0)
    cent.writeUInt16LE(20, 4)
    cent.writeUInt16LE(0, 10)
    cent.writeUInt16LE(0, 8)
    cent.writeUInt32LE(crc, 16)
    cent.writeUInt32LE(f.data.length, 20)
    cent.writeUInt32LE(f.data.length, 24)
    cent.writeUInt16LE(nameBuf.length, 28)
    cent.writeUInt16LE(0, 32) // extra
    cent.writeUInt16LE(0, 34) // comment
    cent.writeUInt16LE(0, 38) // disk start
    cent.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([cent, nameBuf]))
    offset += localBlock.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cd, eocd])
}

// ---------------- 测试 ----------------

describe('whisper-extract', () => {
  it('tar.gz 解压出文件并将名归一为基名', () => {
    const gz = buildTarGz([
      { name: 'whisper', data: Buffer.from('ELF-BIN') },
      { name: 'libs/ggml.so', data: Buffer.from('SOBIN') },
      { name: 'README.md', data: Buffer.from('# hi') }
    ])
    const out = extractArchive(new Uint8Array(gz))
    const names = out.map((e) => e.name).sort()
    expect(names).toEqual(['README.md', 'ggml.so', 'whisper'])
    expect(Buffer.from(out.find((e) => e.name === 'whisper')!.data).toString()).toBe('ELF-BIN')
  })

  it('zip(stored) 解压并归一基名', () => {
    const zip = buildStoredZip([
      { name: 'whisper-cli.exe', data: Buffer.from('MZ-BIN') },
      { name: 'whisper.dll', data: Buffer.from('DLL') }
    ])
    const out = extractArchive(new Uint8Array(zip))
    const names = out.map((e) => e.name).sort()
    expect(names).toEqual(['whisper-cli.exe', 'whisper.dll'])
    expect(Buffer.from(out.find((e) => e.name === 'whisper-cli.exe')!.data).toString()).toBe('MZ-BIN')
  })

  it('未知格式抛错', () => {
    expect(() => extractArchive(new Uint8Array(Buffer.from('not-an-archive')))).toThrow()
  })
})