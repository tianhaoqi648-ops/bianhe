// ============================================================
// timer-bell-kits.ts — 内置铃声库预设（P2-8）
//
// 本模块定义「铃声库」概念：多套内置预设铃声（电子/敲铃/提示音），
// 用户在设置页一键切换，切换后全应用（小屏/大屏）计时到点/预告铃声
// 即时生效，无需修改赛制数据。
//
// 方案说明：
// - 赛制中的 BellSound 仍是既有 4 种语义键（beep/bell/double_bell/time_up），
//   不改变 schema，避免污染用户赛制数据。
// - 每套铃声库将「语义键 → 一段 Web Audio 合成程序」，由 SoundManager 播放。
// - 纯函数、无副作用，便于单测与在渲染进程统一使用。
// ============================================================

/** 内置铃声的语义键（与赛制 BellSound 的内置枚举保持一致） */
export type BuiltinBellSound = 'beep' | 'bell' | 'double_bell' | 'time_up'

/** 单段振荡器波形 */
export type BellToneType = 'sine' | 'square' | 'sawtooth' | 'triangle'

/** 合成程序中的一段音 */
export interface BellKitToneStep {
  /** 频率（Hz） */
  freq: number
  /** 距程序起点的延迟（毫秒） */
  atMs: number
  /** 持续时长（毫秒） */
  durMs: number
  /** 波形，默认 sine */
  type?: BellToneType
  /** 峰值增益 0-1，默认 0.3（由播放器决定），可微调 */
  gain?: number
}

/** 一套铃声库：为 4 个语义键各提供一段合成程序 */
export type BellKitSounds = Record<BuiltinBellSound, BellKitToneStep[]>

export type BellKitId = 'classic' | 'electronic' | 'gate' | 'clock' | 'gong'

export interface BellKit {
  id: BellKitId
  /** 展示名（设置页下拉） */
  name: string
  /** 简短说明 */
  description: string
  sounds: BellKitSounds
}

/** 铃声库在 settings 中的 key（也用于重置配置 category） */
export const BELL_KIT_KEY = 'timer.bellKit'

export const DEFAULT_BELL_KIT: BellKitId = 'classic'

// 经典默认：与 P0-1 原始音量/时长一致（beep 200 / bell 400 / double_bell 450 / time_up 900）
const CLASSIC: BellKitSounds = {
  beep: [{ freq: 880, atMs: 0, durMs: 200, type: 'sine' }],
  bell: [{ freq: 660, atMs: 0, durMs: 400, type: 'triangle' }],
  double_bell: [
    { freq: 660, atMs: 0, durMs: 200, type: 'triangle' },
    { freq: 660, atMs: 250, durMs: 200, type: 'triangle' }
  ],
  time_up: [
    { freq: 440, atMs: 0, durMs: 600, type: 'sawtooth' },
    { freq: 330, atMs: 300, durMs: 600, type: 'sawtooth' }
  ]
}

// 电子音：方波急促电子提示
const ELECTRONIC: BellKitSounds = {
  beep: [{ freq: 1000, atMs: 0, durMs: 150, type: 'square' }],
  bell: [
    { freq: 880, atMs: 0, durMs: 200, type: 'square' },
    { freq: 1320, atMs: 120, durMs: 220, type: 'square' }
  ],
  double_bell: [
    { freq: 784, atMs: 0, durMs: 180, type: 'square' },
    { freq: 1046, atMs: 200, durMs: 220, type: 'square' }
  ],
  time_up: [
    { freq: 660, atMs: 0, durMs: 300, type: 'square' },
    { freq: 880, atMs: 300, durMs: 300, type: 'square' },
    { freq: 660, atMs: 600, durMs: 400, type: 'square' }
  ]
}

// 敲铃音：低音敲击 / 法槌，现场辨识度高
const GATE: BellKitSounds = {
  beep: [{ freq: 220, atMs: 0, durMs: 120, type: 'triangle', gain: 0.5 }],
  bell: [
    { freq: 330, atMs: 0, durMs: 140, type: 'triangle', gain: 0.5 },
    { freq: 330, atMs: 180, durMs: 160, type: 'triangle', gain: 0.4 }
  ],
  double_bell: [
    { freq: 247, atMs: 0, durMs: 140, type: 'triangle', gain: 0.5 },
    { freq: 247, atMs: 260, durMs: 160, type: 'triangle', gain: 0.5 }
  ],
  time_up: [
    { freq: 196, atMs: 0, durMs: 200, type: 'triangle', gain: 0.55 },
    { freq: 196, atMs: 300, durMs: 200, type: 'triangle', gain: 0.55 },
    { freq: 196, atMs: 600, durMs: 300, type: 'triangle', gain: 0.6 }
  ]
}

// 提示音：柔和悦耳钟声/提示
const CLOCK: BellKitSounds = {
  beep: [{ freq: 1318, atMs: 0, durMs: 260, type: 'sine' }],
  bell: [
    { freq: 1046, atMs: 0, durMs: 300, type: 'sine' },
    { freq: 1568, atMs: 150, durMs: 360, type: 'sine' }
  ],
  double_bell: [
    { freq: 880, atMs: 0, durMs: 260, type: 'sine' },
    { freq: 1175, atMs: 220, durMs: 320, type: 'sine' }
  ],
  time_up: [
    { freq: 1046, atMs: 0, durMs: 350, type: 'sine' },
    { freq: 784, atMs: 320, durMs: 420, type: 'sine' }
  ]
}

const GONG: BellKitSounds = {
  beep: [{ freq: 659, atMs: 0, durMs: 320, type: 'sine' }],
  bell: [{ freq: 528, atMs: 0, durMs: 900, type: 'triangle' }],
  double_bell: [
    { freq: 660, atMs: 0, durMs: 400, type: 'triangle' },
    { freq: 550, atMs: 350, durMs: 600, type: 'triangle' }
  ],
  time_up: [
    { freq: 494, atMs: 0, durMs: 1200, type: 'triangle' },
    { freq: 330, atMs: 600, durMs: 1400, type: 'triangle' }
  ]
}

/** 全部内置铃声库（顺序即设置页下拉顺序） */
export const BELL_KITS: BellKit[] = [
  {
    id: 'classic',
    name: '经典电子铃',
    description: '默认：beep / 单声铃 / 双声铃 / 时间到',
    sounds: CLASSIC
  },
  {
    id: 'electronic',
    name: '电子音效',
    description: '急促方波：适合快速节奏提醒',
    sounds: ELECTRONIC
  },
  {
    id: 'gate',
    name: '敲铃音',
    description: '法槌 / 木鱼敲击：现场辨识度高',
    sounds: GATE
  },
  {
    id: 'clock',
    name: '提示音',
    description: '柔和钟声：适合安静正式场合',
    sounds: CLOCK
  },
  {
    id: 'gong',
    name: '锣鼓音',
    description: '悠长锣声：时间到的郑重宣告',
    sounds: GONG
  }
]

/** 按 id 取铃声库；非法/缺失回退到第一套（classic） */
export function getBellKit(id: unknown): BellKit {
  return BELL_KITS.find((k) => k.id === id) ?? BELL_KITS[0]
}

/** 从 settings 扁平对象解析当前铃声库（含缺失/非法回退） */
export function getBellKitFromSettings(
  settings: Record<string, any> | null | undefined
): BellKit {
  return getBellKit(settings?.[BELL_KIT_KEY])
}

/** 解析 settings 中存储的铃声库 id（用于写入前校验等场景） */
export function resolveBellKitId(raw: unknown): BellKitId {
  const kit = getBellKit(raw)
  return kit.id
}

/**
 * 合成程序总时长（毫秒）。
 * 返回最后一个音结束的时间点；用于驱动播放进度环动画。
 */
export function programDuration(steps: BellKitToneStep[]): number {
  if (!steps || steps.length === 0) return 0
  let end = 0
  for (const s of steps) {
    const e = s.atMs + s.durMs
    if (e > end) end = e
  }
  return Math.max(0, end)
}