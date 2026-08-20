// ============================================================
// stt-wav.test.ts — WAV(PCM) 解析 / 切片窗 / 切片 纯函数测试
// ============================================================

import { describe, it, expect } from 'vitest'
import { parseWavHeader, computeSliceWindows, sliceWavBuffer } from '../stt-wav'

/* 构建一个标准 wav(PCM) 字节（默认 16kHz mono 16-bit） */
function buildWav(opts: {
  seconds: number
  sampleRate?: number
  channels?: number
  bits?: number
}): Uint8Array {
  const { seconds } = opts
  const sampleRate = opts.sampleRate ?? 16000
  const channels = opts.channels ?? 1
  const bits = opts.bits ?? 16
  const blockAlign = (channels * bits) / 8
  const dataLen = seconds * sampleRate * blockAlign

  const out = new Uint8Array(44 + dataLen)
  const dv = new DataView(out.buffer)
  const wav = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i)
  }
  wav(0, 'RIFF')
  dv.setUint32(4, 36 + dataLen, true)
  wav(8, 'WAVE')
  wav(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, channels, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * blockAlign, true)
  dv.setUint16(32, blockAlign, true)
  dv.setUint16(34, bits, true)
  wav(36, 'data')
  dv.setUint32(40, dataLen, true)
  // 数据区：每一帧写可辨识字节
  for (let i = 0; i < dataLen; i++) out[44 + i] = i % 251
  return out
}

describe('parseWavHeader', () => {
  it('解析标准 mono 16-bit wav 字段', () => {
    const buf = buildWav({ seconds: 2 }) // 2s * 16000 * 2 = 64000 数据字节
    const info = parseWavHeader(buf)
    expect(info).not.toBeNull()
    expect(info!.sampleRate).toBe(16000)
    expect(info!.channels).toBe(1)
    expect(info!.bitsPerSample).toBe(16)
    expect(info!.blockAlign).toBe(2)
    expect(info!.byteRate).toBe(32000)
    expect(info!.dataOffset).toBe(44)
    expect(info!.dataSize).toBe(64000)
    expect(info!.durationMs).toBe(2000)
  })

  it('非 wav（缺少 RIFF）返回 null', () => {
    const buf = new Uint8Array(64)
    expect(parseWavHeader(buf)).toBeNull()
  })

  it('过短字节返回 null', () => {
    expect(parseWavHeader(new Uint8Array(10))).toBeNull()
  })
})

describe('computeSliceWindows', () => {
  it('无标记 → 单段整张', () => {
    expect(computeSliceWindows(10000, [])).toEqual([{ startMs: 0, endMs: 10000 }])
  })

  it('单标记切成两段', () => {
    expect(computeSliceWindows(10000, [3000])).toEqual([
      { startMs: 0, endMs: 3000 },
      { startMs: 3000, endMs: 10000 }
    ])
  })

  it('乱序/越界/重复标记收敛', () => {
    const windows = computeSliceWindows(10000, [5000, 3000, 8000, 8000, 12000, -1000])
    expect(windows).toEqual([
      { startMs: 0, endMs: 3000 },
      { startMs: 3000, endMs: 5000 },
      { startMs: 5000, endMs: 8000 },
      { startMs: 8000, endMs: 10000 }
    ])
  })

  it('标记超出时长 → 收缩到 0~total', () => {
    expect(computeSliceWindows(5000, [6000])).toEqual([{ startMs: 0, endMs: 5000 }])
  })
})

describe('sliceWavBuffer', () => {
  it('切出前 1s，结果自含合法头且数据区一致', () => {
    const buf = buildWav({ seconds: 2 }) // 总时 2000ms
    const info = parseWavHeader(buf)!
    const seg = sliceWavBuffer(buf, info, { startMs: 0, endMs: 1000 })

    // 切片自身可被再次解析，且行格式正确
    const segInfo = parseWavHeader(seg)
    expect(segInfo).not.toBeNull()
    expect(segInfo!.sampleRate).toBe(16000)
    expect(segInfo!.channels).toBe(1)
    expect(segInfo!.dataSize).toBe(16000 * 2) // 1s * 2 字节
    expect(segInfo!.durationMs).toBe(1000)

    // 数据区与整段前 1s 逐字节一致
    const expectData = buf.slice(44, 44 + 32000)
    const gotData = seg.slice(segInfo!.dataOffset, segInfo!.dataOffset + segInfo!.dataSize)
    expect(gotData).toEqual(expectData)
  })

  it('切中间 500~1500ms，数据区与整段对应区一致', () => {
    const buf = buildWav({ seconds: 2 })
    const info = parseWavHeader(buf)!
    const seg = sliceWavBuffer(buf, info, { startMs: 500, endMs: 1500 })
    const segInfo = parseWavHeader(seg)!

    const startByte = info.dataOffset + Math.floor((500 / 1000) * 16000) * 2
    const expectData = buf.slice(startByte, startByte + segInfo.dataSize)
    const gotData = seg.slice(segInfo.dataOffset, segInfo.dataOffset + segInfo.dataSize)
    expect(gotData).toEqual(expectData)
  })
})