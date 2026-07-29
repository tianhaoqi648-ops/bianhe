// ============================================================
// timer-theme-defaults.ts — 计时器主题默认值
//
// 主题存储：settings 表 key='timer.theme' JSON
// 读取时与 DEFAULT_TIMER_THEME 浅合并，缺失字段回退到默认值
// 重置：通过 CONFIG_RESET_KEYS.timerTheme 删除 settings key
// ============================================================

import type { TimerTheme } from './types'

/** 默认主题：蓝红经典配色 + 正方/反方称谓 */
export const DEFAULT_TIMER_THEME: TimerTheme = {
  affLabel: '正方',
  negLabel: '反方',
  affColor: '#1677ff',
  negColor: '#ff4d4f',
  accentColor: '#1677ff'
}

/**
 * 将用户存储的主题与默认主题合并（浅合并，仅一层）。
 * 用于渲染进程读取主题时确保所有字段都有值。
 */
export function mergeTheme(stored: Partial<TimerTheme> | null | undefined): TimerTheme {
  if (!stored) return { ...DEFAULT_TIMER_THEME }
  return {
    ...DEFAULT_TIMER_THEME,
    ...stored
  }
}
