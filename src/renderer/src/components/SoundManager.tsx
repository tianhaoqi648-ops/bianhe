// ============================================================
// SoundManager.tsx — 铃声播放
//
// 内置音：Web Audio API 合成（无外部音频文件）
// 自定义音：'custom:<bellId>' 通过 bellAPI.getDataUrl 取 data URL，
//           用 HTMLAudioElement 播放（带缓存）
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BellAsset, BellDef } from '../../../shared/types'
import { useToast } from '../hooks/useToast'

/** BGM 轨道 ID */
export type BgmTrackId = 'ethereal' | 'solemn' | 'stirring'

/** BGM 播放选项 */
export interface BgmPlayOptions {
  /** 是否循环播放，默认 true */
  loop?: boolean
  /** 音量 0-1，默认 1 */
  volume?: number
}

/**
 * 内置音时长（毫秒）— 与 playTone 调用参数一致。
 *
 * 用于 playBell 返回值，驱动播放进度环动画：
 * - beep：单声 200ms
 * - bell：单声 400ms
 * - double_bell：200ms + 250ms 间隔 + 200ms ≈ 450ms 结束
 * - time_up：600ms + 300ms 间隔 + 600ms ≈ 900ms 结束
 */
const BUILTIN_BELL_DURATIONS: Record<string, number> = {
  beep: 200,
  bell: 400,
  double_bell: 450,
  time_up: 900
}

export function useSoundManager() {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const [customBells, setCustomBells] = useState<BellAsset[]>([])
  const toast = useToast()

  // ===== BGM 相关 ref =====
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null)
  const bgmVolumeRef = useRef<number>(1)
  const bgmFadeRafRef = useRef<number | null>(null)
  const bgmErrorToastShownRef = useRef(false)

  // 启动时加载自定义铃声列表
  useEffect(() => {
    void window.bellAPI.list().then((res) => {
      if (res.success && res.data) setCustomBells(res.data)
    })
  }, [])

  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    }
    return audioCtxRef.current
  }, [])

  const playTone = useCallback((frequency: number, durationMs: number, type: OscillatorType = 'sine') => {
    const ctx = getCtx()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime)

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + durationMs / 1000)
  }, [getCtx])

  // 播放自定义铃声：从 bellAPI 获取 data URL 并缓存
  const playCustomBell = useCallback(async (bellId: string): Promise<boolean> => {
    let audio = audioCacheRef.current.get(bellId)
    if (!audio) {
      const res = await window.bellAPI.getDataUrl(bellId)
      if (!res.success || !res.data) return false
      audio = new Audio(res.data)
      audioCacheRef.current.set(bellId, audio)
    }
    audio.currentTime = 0
    try {
      await audio.play()
      return true
    } catch {
      return false
    }
  }, [])

  // 播放铃声并返回时长（毫秒），用于驱动播放进度环动画。
  // 自定义音：audio.duration（秒 → 毫秒）；内置音：BUILTIN_BELL_DURATIONS。
  const playBell = useCallback(async (bell: BellDef): Promise<number> => {
    // 自定义铃声：sound = 'custom:<id>' 或 customBellId 存在
    const customId =
      bell.customBellId ??
      (typeof bell.sound === 'string' && bell.sound.startsWith('custom:')
        ? bell.sound.slice('custom:'.length)
        : null)

    if (customId) {
      const played = await playCustomBell(customId)
      if (played) {
        // 铃声时长通过 audio.duration 获取（秒 → 毫秒）
        // duration 可能为 NaN/Infinity（流式或未加载），回退默认 1000ms
        const audio = audioCacheRef.current.get(customId)
        const dur =
          audio && Number.isFinite(audio.duration)
            ? audio.duration * 1000
            : 1000
        return dur
      }
    }

    // 回退到内置音（仅当 sound 是已知内置枚举值时）
    switch (bell.sound) {
      case 'beep':
        playTone(880, 200, 'sine')
        return BUILTIN_BELL_DURATIONS.beep
      case 'bell':
        playTone(660, 400, 'triangle')
        return BUILTIN_BELL_DURATIONS.bell
      case 'double_bell':
        playTone(660, 200, 'triangle')
        setTimeout(() => playTone(660, 200, 'triangle'), 250)
        return BUILTIN_BELL_DURATIONS.double_bell
      case 'time_up':
        playTone(440, 600, 'sawtooth')
        setTimeout(() => playTone(330, 600, 'sawtooth'), 300)
        return BUILTIN_BELL_DURATIONS.time_up
      default:
        // 未知内置音或仅 custom 枚举值但无 customBellId：静默
        return 600
    }
  }, [playTone, playCustomBell])

  // 刷新自定义铃声列表（铃声管理页增删后调用）
  const refreshBells = useCallback(async () => {
    const res = await window.bellAPI.list()
    if (res.success && res.data) {
      setCustomBells(res.data)
      audioCacheRef.current.clear()
    }
  }, [])

  // ===== BGM 播放 API =====
  // playBgm: 播放指定曲目（停止当前正在播放的 BGM）
  const playBgm = useCallback((
    trackId: BgmTrackId,
    opts?: BgmPlayOptions
  ): void => {
    // 停止当前 BGM（无淡出，立即切换）
    if (bgmAudioRef.current) {
      bgmAudioRef.current.pause()
      bgmAudioRef.current.src = ''
      bgmAudioRef.current = null
    }
    // 取消进行中的淡出动画
    if (bgmFadeRafRef.current != null) {
      cancelAnimationFrame(bgmFadeRafRef.current)
      bgmFadeRafRef.current = null
    }
    // 重置错误提示标记（切换曲目后允许再次提示）
    bgmErrorToastShownRef.current = false

    const volume = opts?.volume ?? 1
    const loop = opts?.loop ?? true
    bgmVolumeRef.current = volume

    const audio = new Audio(`/sounds/bgm/${trackId}.mp3`)
    audio.preload = 'auto'
    audio.loop = loop
    audio.volume = volume

    const handleError = () => {
      // BGM 文件缺失，静默忽略并 Toast 提示（每种曲目只提示一次）
      if (!bgmErrorToastShownRef.current) {
        bgmErrorToastShownRef.current = true
        toast.info(`BGM 文件缺失：请将 ${trackId}.mp3 放置在 public/sounds/bgm/ 目录`)
      }
      bgmAudioRef.current = null
    }

    audio.addEventListener('error', handleError)

    // play() 可能因自动播放策略或文件缺失 reject
    audio.play().catch(() => {
      // 仅在文件确实加载失败（networkState 为 NETWORK_NO_SOURCE）时提示
      if (audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
        handleError()
      }
      // 自动播放策略阻止时不提示（用户交互后会重试）
    })

    bgmAudioRef.current = audio
  }, [toast])

  // stopBgm: 停止 BGM 播放，支持淡出
  const stopBgm = useCallback((fadeMs?: number): void => {
    if (!bgmAudioRef.current) return
    const audio = bgmAudioRef.current
    const fadeDuration = fadeMs ?? 500

    if (fadeDuration <= 0) {
      audio.pause()
      audio.src = ''
      bgmAudioRef.current = null
      return
    }

    // 取消之前的淡出动画
    if (bgmFadeRafRef.current != null) {
      cancelAnimationFrame(bgmFadeRafRef.current)
    }

    const startVolume = audio.volume
    const startTime = performance.now()

    const fadeStep = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / fadeDuration)
      audio.volume = startVolume * (1 - progress)

      if (progress < 1) {
        bgmFadeRafRef.current = requestAnimationFrame(fadeStep)
      } else {
        audio.pause()
        audio.src = ''
        bgmAudioRef.current = null
        bgmFadeRafRef.current = null
      }
    }

    bgmFadeRafRef.current = requestAnimationFrame(fadeStep)
  }, [])

  // setBgmVolume: 实时调整 BGM 音量（不影响淡出中的音频）
  const setBgmVolume = useCallback((v: number): void => {
    const vol = Math.max(0, Math.min(1, v))
    bgmVolumeRef.current = vol
    if (bgmAudioRef.current && bgmFadeRafRef.current == null) {
      bgmAudioRef.current.volume = vol
    }
  }, [])

  // 卸载时清理 BGM 资源
  useEffect(() => {
    return () => {
      if (bgmFadeRafRef.current != null) {
        cancelAnimationFrame(bgmFadeRafRef.current)
      }
      if (bgmAudioRef.current) {
        bgmAudioRef.current.pause()
        bgmAudioRef.current.src = ''
        bgmAudioRef.current = null
      }
    }
  }, [])

  return { playBell, customBells, refreshBells, playBgm, stopBgm, setBgmVolume }
}
