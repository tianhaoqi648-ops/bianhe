import type { PresetDef } from './presets'

const MINUTE = 60 * 1000

const standardBells = [
  { atMs: 30 * 1000, sound: 'beep' as const },
  { atMs: 0, sound: 'time_up' as const }
]

/** 世界杯赛制（陈词+质询+自由辩论+总结，约 32 分钟） */
export const WORLD_CUP_FORMAT: PresetDef = {
  id: 'preset-world-cup',
  name: '世界杯赛制',
  description: '陈词4分+质询3分+自由辩论4分+总结4分，共约32分钟',
  formatData: {
    totalDurationMs: 32 * MINUTE,
    stages: [
      { id: 'aff_opening', name: '正方一辩陈词', side: 'aff', durationMs: 4 * MINUTE, bells: standardBells },
      { id: 'neg_cross_1', name: '反方质询正方一辩', side: 'neg', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'neg_opening', name: '反方一辩陈词', side: 'neg', durationMs: 4 * MINUTE, bells: standardBells },
      { id: 'aff_cross_1', name: '正方质询反方一辩', side: 'aff', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'aff_free', name: '正方自由辩论', side: 'aff', durationMs: 4 * MINUTE, isFreeDebate: true, bells: standardBells },
      { id: 'neg_free', name: '反方自由辩论', side: 'neg', durationMs: 4 * MINUTE, isFreeDebate: true, bells: standardBells },
      { id: 'aff_summary', name: '正方四辩总结', side: 'aff', durationMs: 4 * MINUTE, bells: standardBells },
      { id: 'neg_summary', name: '反方四辩总结', side: 'neg', durationMs: 4 * MINUTE, bells: standardBells }
    ]
  }
}
