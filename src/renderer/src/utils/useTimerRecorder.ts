// ============================================================
// useTimerRecorder.ts — 麦克风录音原语
//
// getUserMedia + MediaRecorder → 停止时返回 Blob（含 mimeType），
// 供上层保存到 userData/recordings 并写回 matches/timer_sessions 引用。
// 需主进程放行 media 权限（main/index.ts setPermissionRequestHandler）。
// ============================================================

import { useRef, useState } from 'react'

export interface RecordedPayload {
  data: ArrayBuffer
  mimeType: string
}

export function useTimerRecorder() {
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef('audio/webm')
  const [recording, setRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 开始 MediaRecorder 录音。
   * @param format 可选（'webm' | 'm4a'）：m4a 走 audio/mp4（需 MediaRecorder 支持，否则报错）；
   *               缺省按平台可用性自动选 webm。
   */
  const start = async (format?: 'webm' | 'm4a'): Promise<boolean> => {
    if (recording) return false
    setStarting(true)
    setError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('当前环境不支持麦克风录音')
        return false
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      let mime = ''
      if (format === 'm4a') {
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('audio/mp4')) {
          stream.getTracks().forEach((t) => t.stop())
          setError('当前系统不支持 m4a（AAC）录音，请改用 WAV 或 WebM')
          return false
        }
        mime = 'audio/mp4'
      } else {
        const supported = (['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const).find((t) =>
          typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
        )
        mime = supported ?? 'audio/webm'
      }
      mimeRef.current = mime
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
      }
      rec.start()
      mediaRef.current = rec
      setRecording(true)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法开始录音（请检查麦克风权限）')
      return false
    } finally {
      setStarting(false)
    }
  }

  const stop = (): Promise<RecordedPayload | null> =>
    new Promise((resolve) => {
      const rec = mediaRef.current
      if (!rec || rec.state === 'inactive') {
        setRecording(false)
        resolve(null)
        return
      }
      rec.onstop = () => {
        streamTracksStop(rec)
        const mime = rec.mimeType || mimeRef.current
        rec.onstop = null
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: mime })
        if (blob.size === 0) {
          resolve(null)
          return
        }
        blob.arrayBuffer().then((buf) => resolve({ data: buf, mimeType: mime })).catch(() => resolve(null))
      }
      try {
        rec.stop()
      } catch {
        setRecording(false)
        resolve(null)
      }
    })

  return { recording, starting, error, start, stop }
}

function streamTracksStop(rec: MediaRecorder): void {
  try {
    rec.stream.getTracks().forEach((t) => t.stop())
  } catch {
    // ignore
  }
}