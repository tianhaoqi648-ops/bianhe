// ============================================================
// hotkey-presets.ts —— 快捷键预设定义
//
// 集中管理所有快捷键的 combo + 描述，用于：
//   1. 帮助弹窗展示
//   2. UI 上的快捷键提示文案（如 placeholder）
// ============================================================

export interface HotkeyPreset {
  /** 唯一 id，格式 `${scope}::${combo}`，用作自定义映射的稳定 key */
  id: string
  /** 组合键，与 HotkeyDef.combo 一致 */
  combo: string
  /** 中文描述 */
  description: string
  /** 作用域 */
  scope: string
}

/** 作用域的中文标签 */
export const SCOPE_LABELS: Record<string, string> = {
  global: '全局',
  draw: '抽取页',
  'topic-library': '题库管理',
  bigscreen: '大屏',
  timer: '计时器',
  'timer-bigscreen': '计时器大屏'
}

/** 所有预设快捷键，按 scope 分组 */
export const HOTKEY_PRESETS: HotkeyPreset[] = [
  // 全局
  { id: 'global::ctrl+k', combo: 'ctrl+k', description: '聚焦搜索框', scope: 'global' },
  { id: 'global::escape', combo: 'escape', description: '退出大屏 / 关闭弹窗', scope: 'global' },
  { id: 'global::?', combo: '?', description: '显示快捷键帮助', scope: 'global' },
  { id: 'global::ctrl+z', combo: 'ctrl+z', description: '撤销最近一步操作', scope: 'global' },
  { id: 'global::ctrl+shift+z', combo: 'ctrl+shift+z', description: '重做最近一步撤销的操作', scope: 'global' },

  // 抽取页
  { id: 'draw::r', combo: 'r', description: '重新抽取', scope: 'draw' },
  { id: 'draw::f', combo: 'f', description: '进入大屏', scope: 'draw' },

  // 题库管理
  { id: 'topic-library::/', combo: '/', description: '聚焦搜索框', scope: 'topic-library' },
  { id: 'topic-library::ctrl+a', combo: 'ctrl+a', description: '全选当前筛选结果', scope: 'topic-library' },
  { id: 'topic-library::delete', combo: 'delete', description: '删除选中辩题', scope: 'topic-library' },
  { id: 'topic-library::ctrl+b', combo: 'ctrl+b', description: '打开批量编辑弹窗', scope: 'topic-library' },

  // 大屏
  { id: 'bigscreen::arrowright', combo: 'arrowright', description: '下一题', scope: 'bigscreen' },
  { id: 'bigscreen::arrowleft', combo: 'arrowleft', description: '上一题', scope: 'bigscreen' },

  // 计时器（小屏，大屏使用独立的 timer-bigscreen scope）
  { id: 'timer::space', combo: 'space', description: '启动/暂停/恢复', scope: 'timer' },
  { id: 'timer::p', combo: 'p', description: '中断（结束当前会话）', scope: 'timer' },
  { id: 'timer::arrowleft', combo: 'arrowleft', description: '上一环节', scope: 'timer' },
  { id: 'timer::arrowright', combo: 'arrowright', description: '下一环节', scope: 'timer' },
  { id: 'timer::q', combo: 'q', description: '+30秒', scope: 'timer' },
  { id: 'timer::w', combo: 'w', description: '+5秒', scope: 'timer' },
  { id: 'timer::e', combo: 'e', description: '时间到（结束当前环节）', scope: 'timer' },
  { id: 'timer::f', combo: 'f', description: '进入大屏', scope: 'timer' },
  { id: 'timer::s', combo: 's', description: '切换发言方（仅自由辩论）', scope: 'timer' },
  { id: 'timer::r', combo: 'r', description: '重置当前环节（二次确认）', scope: 'timer' },
  { id: 'timer::shift+r', combo: 'shift+r', description: '全重置（清空所有进度，二次确认）', scope: 'timer' },

  // 计时器大屏（独立 scope，避免与小屏 timer scope 冲突）
  { id: 'timer-bigscreen::space', combo: 'space', description: '启动/暂停/恢复', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::p', combo: 'p', description: '中断（结束当前会话）', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::arrowleft', combo: 'arrowleft', description: '上一环节', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::arrowright', combo: 'arrowright', description: '下一环节', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::q', combo: 'q', description: '+30秒', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::w', combo: 'w', description: '+5秒', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::e', combo: 'e', description: '时间到（结束当前环节）', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::f', combo: 'f', description: '切换全屏', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::b', combo: 'b', description: '关闭大屏', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::s', combo: 's', description: '切换发言方（仅自由辩论）', scope: 'timer-bigscreen' },
  { id: 'timer-bigscreen::escape', combo: 'escape', description: '退出大屏（浏览器全屏下先退出全屏）', scope: 'timer-bigscreen' }
]

/** 根据 id 查找预设 */
export function getPresetById(id: string): HotkeyPreset | undefined {
  return HOTKEY_PRESETS.find((p) => p.id === id)
}

/**
 * 从 presetId 解析出默认 combo。
 * presetId 格式为 `${scope}::${combo}`，取 `::` 后的部分。
 * 若格式异常返回 undefined。
 */
export function getDefaultCombo(presetId: string): string | undefined {
  const idx = presetId.indexOf('::')
  if (idx === -1) return undefined
  return presetId.slice(idx + 2)
}

/** 按 scope 分组的预设，用于帮助弹窗 */
export function getGroupedPresets(): Record<string, HotkeyPreset[]> {
  const groups: Record<string, HotkeyPreset[]> = {}
  for (const preset of HOTKEY_PRESETS) {
    if (!groups[preset.scope]) groups[preset.scope] = []
    groups[preset.scope].push(preset)
  }
  return groups
}

/**
 * 将 combo 转为用户友好的显示文本。
 * 例如 'ctrl+k' → 'Ctrl+K'，'arrowleft' → '←'，'escape' → 'Esc'
 */
export function formatCombo(combo: string): string {
  const parts = combo.split('+')
  const formatted = parts.map((p) => {
    switch (p) {
      case 'ctrl':
        return 'Ctrl'
      case 'shift':
        return 'Shift'
      case 'alt':
        return 'Alt'
      case 'meta':
        return 'Meta'
      case 'arrowleft':
        return '←'
      case 'arrowright':
        return '→'
      case 'arrowup':
        return '↑'
      case 'arrowdown':
        return '↓'
      case 'escape':
        return 'Esc'
      case 'delete':
        return 'Delete'
      case 'backspace':
        return 'Backspace'
      case 'enter':
        return 'Enter'
      case ' ':
        return 'Space'
      default:
        // 单字符大写显示，如 'r' → 'R'
        return p.length === 1 ? p.toUpperCase() : p
    }
  })
  return formatted.join('+')
}
