// ============================================================
// timer-theme.ipc.ts — 主题配置 IPC handlers
// ============================================================

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { timerThemeService } from '../services/timer-theme-service'
import type { TimerTheme } from '../../shared/debate-formats/types'
import { withUndoLog } from '../services/undo-service'
// L3 修复：使用公共 wrap 函数，避免重复定义
import { wrap, wrapWithUndo } from './utils'

export function registerTimerThemeIpc(): void {
  ipcMain.handle(IPC_CHANNELS.TIMER_THEME_GET, () =>
    wrap(() => timerThemeService.getTheme())
  )
  // P2-21：改用 wrapWithUndo 支持撤销。
  // 主题存储在 settings 表 key='timer.theme'，storeName='settings'、action='set'，
  // before/after 为 { key, value } 结构，applySettingsReverse 已支持 'set' action 反向恢复。
  ipcMain.handle(IPC_CHANNELS.TIMER_THEME_SET, (_e, theme: Partial<TimerTheme>) =>
    wrapWithUndo(() =>
      withUndoLog({
        storeName: 'settings',
        action: 'set',
        targetType: 'settings',
        targetId: null,
        label: `更新计时器主题`,
        getBefore: () => ({ key: 'timer.theme', value: timerThemeService.getTheme() }),
        execute: () => timerThemeService.setTheme(theme),
        getAfter: (result) => ({ key: 'timer.theme', value: result })
      })
    )
  )
}
