// ============================================================
// presets.ts — 内置赛制预设
//
// 4.1 子阶段仅实现中式 + 新国辩 2 种
// 世界杯 + BP 在子阶段 4.2 补充
// ============================================================

import type { DebateFormatData } from './types'
import { WORLD_CUP_FORMAT } from './presets-world-cup'
import { BP_FORMAT } from './presets-bp'

export interface PresetDef {
  id: string
  name: string
  description: string
  formatData: DebateFormatData
}

const MINUTE = 60 * 1000

const standardBells = [
  { atMs: 30 * 1000, sound: 'beep' as const },
  { atMs: 0, sound: 'time_up' as const }
]

/** 中式辩论赛制（立论+质询+自由辩论+总结，共约 20 分钟） */
export const CHINESE_FORMAT: PresetDef = {
  id: 'preset-chinese',
  name: '中式辩论赛制',
  description: '立论3分+质询2分+自由辩论4分+总结3分，共约20分钟',
  formatData: {
    totalDurationMs: 20 * MINUTE,
    stages: [
      { id: 'aff_opening', name: '正方立论', side: 'aff', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'neg_cross', name: '反方质询', side: 'neg', durationMs: 2 * MINUTE, bells: standardBells },
      { id: 'neg_opening', name: '反方立论', side: 'neg', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'aff_cross', name: '正方质询', side: 'aff', durationMs: 2 * MINUTE, bells: standardBells },
      { id: 'free_debate', name: '自由辩论', side: 'both', durationMs: 4 * MINUTE, isFreeDebate: true, bells: standardBells },
      { id: 'aff_summary', name: '正方总结', side: 'aff', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'neg_summary', name: '反方总结', side: 'neg', durationMs: 3 * MINUTE, bells: standardBells }
    ]
  }
}

/** 新国辩赛制（陈词+质询+交锋+自由辩论+总结） */
export const NEW_NATIONAL_FORMAT: PresetDef = {
  id: 'preset-new-national',
  name: '新国辩赛制',
  description: '陈词4分+质询3分+自由辩论4分+总结4分，共约30分钟',
  formatData: {
    totalDurationMs: 30 * MINUTE,
    stages: [
      { id: 'aff_constructive', name: '正方陈词', side: 'aff', durationMs: 4 * MINUTE, bells: standardBells },
      { id: 'neg_constructive', name: '反方陈词', side: 'neg', durationMs: 4 * MINUTE, bells: standardBells },
      { id: 'aff_cross', name: '正方质询', side: 'aff', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'neg_cross', name: '反方质询', side: 'neg', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'free_debate', name: '自由辩论', side: 'both', durationMs: 4 * MINUTE, isFreeDebate: true, bells: standardBells },
      { id: 'aff_summary', name: '正方总结', side: 'aff', durationMs: 4 * MINUTE, bells: standardBells },
      { id: 'neg_summary', name: '反方总结', side: 'neg', durationMs: 4 * MINUTE, bells: standardBells }
    ]
  }
}

export const ALL_PRESETS: PresetDef[] = [CHINESE_FORMAT, NEW_NATIONAL_FORMAT, WORLD_CUP_FORMAT, BP_FORMAT]
