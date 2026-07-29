// ============================================================
// timer-theme-service.ts — 主题配置存储（settings 表 key='timer.theme'）
// ============================================================

import { getDb } from '../db'
import type { TimerTheme } from '../../shared/debate-formats/types'

const DEFAULT_THEME: TimerTheme = {
  affLabel: '正方',
  negLabel: '反方',
  affColor: '#1677ff',
  negColor: '#ff4d4f',
  accentColor: '#faad14',
  backgroundFit: 'cover'
}

export const timerThemeService = {
  getTheme(): TimerTheme {
    const row = getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('timer.theme') as { value: string } | undefined
    if (!row) return DEFAULT_THEME
    try {
      return { ...DEFAULT_THEME, ...JSON.parse(row.value) }
    } catch {
      return DEFAULT_THEME
    }
  },

  setTheme(theme: Partial<TimerTheme>): TimerTheme {
    const merged = { ...this.getTheme(), ...theme }
    const existing = getDb().prepare('SELECT 1 FROM settings WHERE key = ?').get('timer.theme')
    if (existing) {
      getDb()
        .prepare('UPDATE settings SET value = ? WHERE key = ?')
        .run(JSON.stringify(merged), 'timer.theme')
    } else {
      getDb()
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('timer.theme', JSON.stringify(merged))
    }
    return merged
  }
}
