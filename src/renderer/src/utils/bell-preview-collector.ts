// ============================================================
// bell-preview-collector.ts — 铃声试听环节收集器
//
// 遍历赛制所有倒计时环节的 bells，跨环节合并去重，
// 按剩余时间倒序排列（30s 在前，5s 中，0s 后），
// 自动生成主席稿式标签（「剩余 30 秒」「时间到」）。
//
// 用于 isBellPreview 环节：进入此环节时自动展示所有铃声，
// 主席可逐条试听，向选手与观众演示各铃声含义。
// ============================================================

import type {
  BellSound,
  DebateFormatData
} from '../../../shared/debate-formats/types'

/** 铃声试听条目：包含触发时间、语义标签、铃声类型 */
export interface BellPreviewItem {
  /** 触发时间点（剩余毫秒，0 = 时间到） */
  atMs: number
  /** 语义化标签：atMs>0 →「剩余 X 秒」，atMs=0 →「时间到」 */
  label: string
  /** 铃声类型（内置枚举或 `custom:<bellId>`） */
  sound: BellSound | `custom:${string}`
}

/**
 * 收集赛制中所有倒计时环节的铃声，跨环节合并去重并排序。
 *
 * 收集规则：
 *  - 仅遍历 timingMode !== 'untimed' 的环节（即 countdown 或 undefined）
 *  - 按 `${atMs}|${sound}` 去重（同时间点同铃声只保留一条）
 *  - 按 atMs 降序排列（剩余时间多→少，30s 在前，5s 中，0s 后）
 *  - 标签自动生成：
 *    - atMs > 0：「剩余 X 秒」（X = atMs/1000 整数除法）
 *    - atMs = 0：「时间到」
 *
 * @param format 赛制数据
 * @returns 去重排序后的铃声试听条目数组
 */
export function collectBellsForPreview(
  format: DebateFormatData
): BellPreviewItem[] {
  const seen = new Set<string>()
  const items: BellPreviewItem[] = []

  for (const stage of format.stages) {
    // 跳过非计时环节（timingMode === 'untimed'），仅收集倒计时环节的铃声
    if (stage.timingMode === 'untimed') continue

    for (const bell of stage.bells) {
      // 按 atMs + sound 去重（custom 铃声的 sound 已含 bellId，天然区分）
      const key = `${bell.atMs}|${bell.sound}`
      if (seen.has(key)) continue
      seen.add(key)

      const label = bell.atMs > 0
        ? `剩余 ${Math.floor(bell.atMs / 1000)} 秒`
        : '时间到'

      items.push({
        atMs: bell.atMs,
        label,
        sound: bell.sound
      })
    }
  }

  // 按 atMs 降序：剩余时间多→少（30s 在前，5s 中，0s 后）
  items.sort((a, b) => b.atMs - a.atMs)

  return items
}
