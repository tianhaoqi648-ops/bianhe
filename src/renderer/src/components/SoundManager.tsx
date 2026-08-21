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
import { useSettingsStore } from '../stores/settingsStore'
import {
  getBellKitFromSettings,
  programDuration,
  type BellKitToneStep,
  type BuiltinBellSound
} from '../utils/timer-bell-kits'

/** BGM 轨道 ID */
export type BgmTrackId = 'ethereal' | 'solemn' | 'stirring'

/** BGM 播放选项 */
export interface BgmPlayOptions {
  /** 是否循环播放，默认 true */
  loop?: boolean
  /** 音量 0-1，默认 1 */
  volume?: number
}

/** 内置铃声基础峰值增益（与 P0-1 的 0.3 一致） */
const BELL_BASE_VOLUME = 0.3

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

  /**
   * 播放单段音：
   * @param frequency 频率 Hz
   * @param durationMs 持续时长 ms
   * @param type 波形
   * @param volume 峰值增益 0-1
   * @param startAtMs 相对起点延迟 ms
   */
  const playTone = useCallback((
    frequency: number,
    durationMs: number,
    type: OscillatorType = 'sine',
    volume = 0.3,
    startAtMs = 0
  ) => {
    const ctx = getCtx()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + startAtMs / 1000)

    gainNode.gain.setValueAtTime(volume, ctx.currentTime + startAtMs / 1000)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAtMs / 1000 + durationMs / 1000)

    oscillator.start(ctx.currentTime + startAtMs / 1000)
    oscillator.stop(ctx.currentTime + startAtMs / 1000 + durationMs / 1000)
  }, [getCtx])

  /** 按合成程序播放一段铃声（P2-8 铃声库） */
  const playProgram = useCallback((steps: BellKitToneStep[], baseVolume: number) => {
    for (const step of steps) {
      playTone(
        step.freq,
        step.durMs,
        step.type ?? 'sine',
        Math.max(0, Math.min(1, (step.gain ?? 1) * baseVolume)),
        step.atMs
      )
    }
  }, [playTone])

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

  // 当前铃声库（从设置读取，设置页一键切换后即时生效）
  const bellKit = useSettingsStore((s) => getBellKitFromSettings(s.settings))

  // 播放铃声并返回时长（毫秒），用于驱动播放进度环动画。
  // 自定义音：audio.duration（秒 → 毫秒）；内置音：当前铃声库合成程序时长。
  const playBell = useCallback((bell: BellDef): Promise<number> => {
    // 自定义铃声：sound = 'custom:<id>' 或 customBellId 存在
    const customId =
      bell.customBellId ??
      (typeof bell.sound === 'string' && bell.sound.startsWith('custom:')
        ? bell.sound.slice('custom:'.length)
        : null)

    if (customId) {
      return playCustomBell(customId).then((played) => {
        if (!played) return 1000
        // 铃声时长通过 audio.duration 获取（秒 → 毫秒）
        // duration 可能为 NaN/Infinity（流式或未加载），回退默认 1000ms
        const audio = audioCacheRef.current.get(customId)
        const dur =
          audio && Number.isFinite(audio.duration)
            ? audio.duration * 1000
            : 1000
        return dur
      })
    }

    // 内置音：从当前铃声库取合成程序播放（含声音库切换）
    const sound = bell.sound as BuiltinBellSound
    const program = bellKit?.sounds[sound]
    if (program) {
      playProgram(program, BELL_BASE_VOLUME)
      return Promise.resolve(programDuration(program))
    }
    // 未知内置音或仅 custom 枚举值但无 customBellId：静默
    return Promise.resolve(600)
  }, [playProgram, playCustomBell, bellKit])

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
