// ============================================================
// useWavRecorder.ts — WAV 录音原语（16-bit 单声道 PCM）
//
// getUserMedia + AudioContext + MediaStreamAudioSourceNode；
// 优先用 AudioWorkletNode（内联模块 Blob URL），不支持则回退
// ScriptProcessorNode。停止时编码 RIFF/WAVE（audio/wav）返回
// { data, mimeType: 'audio/wav', format: 'wav' }，无样本返回 null。
// 接口对齐 useTimerRecorder（start/stop/recording/starting/error）。
// ============================================================

import { useRef, useState, type MutableRefObject } from 'react'
import { encodePcmToWav } from '../../../shared/match-wav'

export interface WavRecordedPayload {
  data: ArrayBuffer
  mimeType: 'audio/wav'
  format: 'wav'
}

const WORKLET_CODE = `
class WavBufferProcessor extends AudioWorkletProcessor {
  constructor() { super() }
  process(inputs, outputs, parameters) {
    const input = inputs[0]
    if (input && input[0]) {
      for (const ch of input) {
        this.port.postMessage(ch)
      }
    }
    return true
  }
}
registerProcessor('wav-buffer-processor', WavBufferProcessor)
`

export function useWavRecorder() {
  const mediaRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const nodeRef = useRef<AudioNode | null>(null)
  const audioWorkletRef = useRef<AudioWorkletNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const constGainRef = useRef<GainNode | null>(null)
  const samplesRef = useRef<Float32Array[]>([])
  const [recording, setRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async (): Promise<boolean> => {
    if (recording) return false
    setStarting(true)
    setError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
        setError('当前环境不支持 WAV 录音')
        return false
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      samplesRef.current = []
      ctxRef.current = ctx
      mediaRef.current = stream
      sourceRef.current = source

      const useWorklet = typeof ctx.audioWorklet?.addModule === 'function'
      if (useWorklet) {
        const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
        const url = URL.createObjectURL(blob)
        try {
          await ctx.audioWorklet.addModule(url)
          const worklet = new AudioWorkletNode(ctx, 'wav-buffer-processor')
          worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
            samplesRef.current.push(e.data)
          }
          source.connect(worklet)
          worklet.connect(connectConstGain(ctx, constGainRef))
          audioWorkletRef.current = worklet
          nodeRef.current = worklet
        } catch {
          URL.revokeObjectURL(url)
          await attachScriptProcessor(ctx, source)
        } finally {
          URL.revokeObjectURL(url)
        }
        if (!nodeRef.current) await attachScriptProcessor(ctx, source)
      } else {
        await attachScriptProcessor(ctx, source)
      }

      setRecording(true)
      return true
    } catch (e) {
      teardownAll()
      setError(e instanceof Error ? e.message : '无法开始 WAV 录音（请检查麦克风权限）')
      return false
    } finally {
      setStarting(false)
    }
  }

  const attachScriptProcessor = async (ctx: AudioContext, source: MediaStreamAudioSourceNode): Promise<void> => {
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0)
      samplesRef.current.push(ch.slice())
    }
    source.connect(processor)
    processor.connect(connectConstGain(ctx, constGainRef))
    processorRef.current = processor
    nodeRef.current = processor
  }

  const stop = (): Promise<WavRecordedPayload | null> =>
    new Promise((resolve) => {
      const ctx = ctxRef.current
      const collected = samplesRef.current
      if (!ctx || collected.length === 0) {
        teardownAll()
        setRecording(false)
        resolve(null)
        return
      }
      // 先断开采集节点，停止后再编码
      const sampleRate = ctx.sampleRate
      try {
        nodeRef.current?.disconnect()
      } catch {
        // ignore
      }
      const totalSamples = collected.reduce((acc, f) => acc + f.length, 0)
      const merged = new Float32Array(totalSamples)
      let idx = 0
      for (const f of collected) {
        merged.set(f, idx)
        idx += f.length
      }
      teardownAll()
      setRecording(false)
      const data = encodePcmToWav(merged, sampleRate)
      resolve({ data, mimeType: 'audio/wav', format: 'wav' })
    })

  const teardownAll = (): void => {
    try { processorRef.current?.disconnect() } catch { /* ignore */ }
    try { audioWorkletRef.current?.disconnect() } catch { /* ignore */ }
    processorRef.current = null
    audioWorkletRef.current = null
    nodeRef.current = null
    try { constGainRef.current?.disconnect() } catch { /* ignore */ }
    constGainRef.current = null
    try { sourceRef.current?.disconnect() } catch { /* ignore */ }
    sourceRef.current = null
    try { mediaRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
    mediaRef.current = null
    try { void ctxRef.current?.close() } catch { /* ignore */ }
    ctxRef.current = null
  }

  return { recording, starting, error, start, stop }
}

// 静音输出节点：捕获音频用于处理但不出声（避免麦克风啸叫）。
// 采集节点（ScriptProcessor/AudioWorklet）必须接到目标端才会被拉取处理，
// 经 0 增益在目的端不产生可听声音；节点记录到 ref 便于收敛释放。
function connectConstGain(ctx: AudioContext, ref: MutableRefObject<GainNode | null>): GainNode {
  const g = ctx.createGain()
  g.gain.value = 0
  g.connect(ctx.destination)
  ref.current = g
  return g
}