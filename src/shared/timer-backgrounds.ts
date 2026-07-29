// ============================================================
// timer-backgrounds.ts — 计时器背景预设与类型定义
//
// 存储：settings 表 key='timer.background' JSON
// 读取时与 DEFAULT_TIMER_BACKGROUND 浅合并，缺失字段回退到默认值
// 重置：通过 CONFIG_RESET_KEYS.timerBackground 删除 settings key
//
// 预设背景：CSS 渐变（性能优）
// 自定义背景：'custom:<fileName>'，由 Task 10 实现的 backgroundAPI 管理
// ============================================================

import type { BackgroundFile } from './types'

/** 背景类型：preset=预设渐变；custom=用户上传图片 */
export type TimerBackgroundType = 'preset' | 'custom'

/** 预设背景结构 */
export interface TimerBackground {
  /** 唯一 id（如 'deep-blue'） */
  id: string
  /** 显示名 */
  name: string
  /** 类型固定为 'preset' */
  type: 'preset'
  /** CSS gradient 字符串（应用到根容器 background） */
  css: string
  /** 缩略图用 CSS（可与 css 相同） */
  thumbnailCss?: string
}

/** 计时器背景设置（存入 settings 表的 JSON 结构） */
export interface TimerBackgroundSetting {
  type: TimerBackgroundType
  /** preset 时 value 为预设 id；custom 时 value 为文件名或 'custom:<fileName>' */
  value: string
}

/** settings 表中存储计时器背景的 key */
export const TIMER_BACKGROUND_KEY = 'timer.background'

/** 默认背景设置：预设-银灰 */
export const DEFAULT_TIMER_BACKGROUND: TimerBackgroundSetting = {
  type: 'preset',
  value: 'silver-gray'
}

/** 6 张预设渐变背景 */
export const PRESET_BACKGROUNDS: TimerBackground[] = [
  {
    id: 'deep-blue',
    name: '深蓝',
    type: 'preset',
    css: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0c4a6e 100%)'
  },
  {
    id: 'dark-gold',
    name: '暗金',
    type: 'preset',
    css: 'linear-gradient(135deg, #1c1917 0%, #78350f 50%, #422006 100%)'
  },
  {
    id: 'black-red',
    name: '黑红',
    type: 'preset',
    css: 'linear-gradient(135deg, #0c0a09 0%, #7f1d1d 50%, #450a0a 100%)'
  },
  {
    id: 'ink-green',
    name: '墨绿',
    type: 'preset',
    css: 'linear-gradient(135deg, #0a0e0a 0%, #14532d 50%, #052e16 100%)'
  },
  {
    id: 'silver-gray',
    name: '银灰',
    type: 'preset',
    css: 'linear-gradient(135deg, #1f2937 0%, #4b5563 50%, #1e293b 100%)'
  },
  {
    id: 'violet',
    name: '紫罗兰',
    type: 'preset',
    css: 'linear-gradient(135deg, #1e1b4b 0%, #5b21b6 50%, #312e81 100%)'
  }
]

/**
 * 将用户存储的背景设置与默认值合并（浅合并）。
 * 缺失字段或非法值时回退到默认背景。
 */
export function mergeTimerBackground(
  stored: Partial<TimerBackgroundSetting> | null | undefined
): TimerBackgroundSetting {
  if (!stored) return { ...DEFAULT_TIMER_BACKGROUND }
  if (stored.type !== 'preset' && stored.type !== 'custom') {
    return { ...DEFAULT_TIMER_BACKGROUND }
  }
  if (!stored.value || typeof stored.value !== 'string') {
    return { ...DEFAULT_TIMER_BACKGROUND }
  }
  return {
    type: stored.type,
    value: stored.value
  }
}

/** 根据 id 查找预设背景 */
export function findPresetBackground(id: string): TimerBackground | undefined {
  return PRESET_BACKGROUNDS.find((b) => b.id === id)
}

/**
 * 解析背景设置为可应用的 CSS background 字符串。
 * - preset：返回预设的 css 渐变
 * - custom：从 customFiles 中按 id 查找，返回 `url('<fileUrl>') center/cover no-repeat`
 *           未找到时回退到默认预设背景以避免空白
 */
export function resolveBackgroundCss(
  setting: TimerBackgroundSetting,
  customFiles?: BackgroundFile[]
): string {
  if (setting.type === 'preset') {
    const preset = findPresetBackground(setting.value)
    if (preset) return preset.css
    return DEFAULT_TIMER_BACKGROUND.type === 'preset'
      ? findPresetBackground(DEFAULT_TIMER_BACKGROUND.value)?.css ?? ''
      : ''
  }
  // custom
  const file = customFiles?.find((f) => f.id === setting.value)
  if (file) return `url('${file.fileUrl}') center/cover no-repeat`
  // 回退到默认预设
  const fallback = findPresetBackground(DEFAULT_TIMER_BACKGROUND.value)
  return fallback?.css ?? ''
}
