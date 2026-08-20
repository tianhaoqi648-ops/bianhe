// ============================================================
// useLocalAudioSrc.ts — 将本地录音文件（经 window.recordingAPI.read 读取 base64）
// 转成 Blob URL 供 <audio> 播放，替代不安全的 file:// 直连。
// ============================================================

import { useEffect, useState } from 'react'

/** 按扩展名映射 MIME（未知一律按 audio/webm） */
const MIME_BY_EXT: Record<string, string> = {
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  webm: 'audio/webm'
}

function mimeForPath(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : ''
  return MIME_BY_EXT[ext] ?? 'audio/webm'
}

/** base64 → Uint8Array。兼容可选的 dataURL 前缀（如 data:audio/wav;base64,...）。 */
function base64ToUint8(base64: string): Uint8Array<ArrayBuffer> {
  const raw = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  const binary = atob(raw)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 入参：本地录音文件绝对路径；返回 { src, error }，卸载/换路径时自动 revokeObjectURL。 */
export function useLocalAudioSrc(filePath: string): { src: string | null; error: string | null } {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    setSrc(null)
    setError(null)
    if (!filePath) {
      setError('无法读取录音')
      return
    }
    ;(async () => {
      try {
        const res = await window.recordingAPI.read(filePath)
        if (cancelled) return
        if (!res.success || !res.data?.ok || !res.data.base64) {
          setError('无法读取录音')
          return
        }
        const blob = new Blob([base64ToUint8(res.data.base64)], { type: mimeForPath(filePath) })
        url = URL.createObjectURL(blob)
        setSrc(url)
      } catch {
        if (!cancelled) setError('无法读取录音')
      }
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [filePath])

  return { src, error }
}