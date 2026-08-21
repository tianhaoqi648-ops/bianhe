// ============================================================
// timeout-tts.ts — 超时语音警告（P2-8）
//
// 到点 / 超时（bell.atMs === 0）时用本地 TTS 播报语音提示，
// 如「时间到」「正方时间到」「反方时间到」。仅用系统本地 TTS
// （Electron 内嵌 Chromium 的 speechSynthesis），不引入云 TTS。
//
// buildTimeoutSpeech 为纯函数（可单测）；
// speakTimeout 依赖 DOM speechSynthesis（运行在渲染进程）。
// ============================================================

import type { StageSide } from '../../../shared/debate-formats/types'

/** 近似正方 / 反方侧的环节 side 集合（与 BigScreenTimer 的 AFF/NEG_SIDES 一致） */
const AFF_SIDES: ReadonlySet<string> = new Set(['aff', 'og', 'cg'])
const NEG_SIDES: ReadonlySet<string> = new Set(['neg', 'oo', 'co'])

/**
 * 生成超时语音播报文案。
 *
 * @param stageSide 当前环节定义的 side（StageSide）
 * @param currentSide 引擎实时 currentSide（自由辩论时为当前发言方，其余为环节 side）
 * @returns 播报文本，如「时间到」「正方时间到」「反方时间到」
 */
export function buildTimeoutSpeech(
  stageSide: StageSide | null | undefined,
  currentSide: StageSide | null | undefined
): string {
  const side = currentSide === 'aff' || currentSide === 'neg' ? currentSide : stageSide
  if (side != null && AFF_SIDES.has(side)) return '正方时间到'
  if (side != null && NEG_SIDES.has(side)) return '反方时间到'
  return '时间到'
}

/**
 * 用本地 TTS 播报指定文本。
 *
 * @param text 播报文案
 * @param volume 音量 0-100
 * @param onVoiceReady 供测试/需要时探测语音就绪（默认不启用）
 */
export function speakTimeout(text: string, volume: number): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  if (!text) return

  const synth = window.speechSynthesis
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'
  utterance.rate = 1
  utterance.pitch = 1
  const vol = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) / 100 : 0.8
  utterance.volume = Math.max(0, Math.min(1, vol))

  // 优先用已加载的中文语音；语音列表异步加载时尝试同步读取
  let voices = synth.getVoices()
  if (voices.length === 0) {
    voices = synth.getVoices()
  }
  const zh = voices.find((v) => /^zh/i.test(v.lang))
  if (zh) utterance.voice = zh

  try {
    synth.speak(utterance)
  } catch {
    // speechSynthesis 不可用时静默失败，不影响计时主流程
  }
}