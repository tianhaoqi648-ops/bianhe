// ============================================================
// match-wav.test.ts — WAV 编码纯函数（T7.2）：RIFF/WAVE 头 + PCM 对齐
// ============================================================

import { describe, it, expect } from 'vitest'
import { encodePcmToWav } from '../match-wav'

describe('encodePcmToWav', () => {
  it('空样本：仅含 44 字节合法头', () => {
    const buf = encodePcmToWav(new Float32Array(0), 48000)
    expect(buf.byteLength).toBe(44)
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('RIFF')
  })

  it('RIFF/WAVE 头部字段正确', () => {
    const sampleRate = 44100
    const data = encodePcmToWav(new Float32Array(10), sampleRate)
    const view = new DataView(data)
    expect(String.fromCharCode(...new Uint8Array(data, 0, 4))).toBe('RIFF')
    // RIFF size = 文件大小 - 8
    expect(view.getUint32(4, true)).toBe(data.byteLength - 8)
    expect(String.fromCharCode(...new Uint8Array(data, 8, 4))).toBe('WAVE')
    // fmt 块
    expect(String.fromCharCode(...new Uint8Array(data, 12, 4))).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // 单声道
    expect(view.getUint32(24, true)).toBe(sampleRate)
    expect(view.getUint32(28, true)).toBe(sampleRate * 2) // byteRate = sr * blockAlign
    expect(view.getUint16(32, true)).toBe(2) // blockAlign
    expect(view.getUint16(34, true)).toBe(16) // bits
    // data 块
    expect(String.fromCharCode(...new Uint8Array(data, 36, 4))).toBe('data')
    expect(view.getUint32(40, true)).toBe(10 * 2)
    expect(data.byteLength).toBe(44 + 10 * 2)
  })

  it('采样对齐：已知样本写回后读回粗略 int16 值', () => {
    const sampleRate = 8000
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
    const data = encodePcmToWav(samples, sampleRate)
    const view = new DataView(data)
    // 数据起始偏移 44
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBeGreaterThan(15000) // 0.5 * 32767 ≈ 16383
    expect(view.getInt16(46, true)).toBeLessThanOrEqual(16384)
    expect(view.getInt16(48, true)).toBeLessThan(-15000) // -0.5 → -16384
    expect(view.getInt16(50, true)).toBe(32767) // clamp 1
    expect(view.getInt16(52, true)).toBe(-32768) // clamp -1
  })

  it('clamp 超界样本到 [-1,1]', () => {
    const data = encodePcmToWav(new Float32Array([2, -2]), 8000)
    const view = new DataView(data)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
  })
})