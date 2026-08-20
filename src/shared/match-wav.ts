// ============================================================
// match-wav.ts — 纯函数：Float32 PCM → 16-bit 单声道 WAV（RIFF/WAVE）
//
// 供渲染端 useWavRecorder 把累积的采样编码为可拖动进度的 .wav，
// 纯函数、无 DOM/electron 依赖，便于 vitest 直接单测。
// ============================================================

/**
 * 将单声道 float32 采样（取值预期在 [-1, 1]）编码为 16-bit PCM WAV 文件字节。
 * 生成完整 RIFF/WAVE（fmt 块 PCM=1、channels=1、bits=16、byteRate、blockAlign
 * + data 块）。float32 clamp[-1,1] → int16 小端。
 */
export function encodePcmToWav(float32: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = float32.length
  const bytesPerSample = 2 // 16-bit
  const dataBytes = numSamples * bytesPerSample
  const bytesPerFrame = bytesPerSample // 单声道
  const byteRate = sampleRate * bytesPerFrame
  // RIFF 头(12) + fmt 块(24) + data 块头(8) + PCM 数据
  const totalBytes = 44 + dataBytes

  const buffer = new ArrayBuffer(totalBytes)
  const view = new DataView(buffer)

  let offset = 0
  // RIFF 块
  writeAscii(view, offset, 'RIFF'); offset += 4
  view.setUint32(offset, totalBytes - 8, true); offset += 4 // 文件大小减 RIFF(4)+size(4)
  writeAscii(view, offset, 'WAVE'); offset += 4

  // fmt 块
  writeAscii(view, offset, 'fmt '); offset += 4
  view.setUint32(offset, 16, true); offset += 4 // fmt 块体大小
  view.setUint16(offset, 1, true); offset += 2 // 音频格式 PCM=1
  view.setUint16(offset, 1, true); offset += 2 // 声道数 mono
  view.setUint32(offset, sampleRate, true); offset += 4 // 采样率
  view.setUint32(offset, byteRate, true); offset += 4
  view.setUint16(offset, bytesPerFrame, true); offset += 2 // blockAlign
  view.setUint16(offset, 16, true); offset += 2 // bitsPerSample

  // data 块
  writeAscii(view, offset, 'data'); offset += 4
  view.setUint32(offset, dataBytes, true); offset += 4

  // PCM 数据：float32 clamp[-1,1] → int16 小端
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
    view.setInt16(offset, int16, true)
    offset += 2
  }

  return buffer
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i) & 0xff)
  }
}