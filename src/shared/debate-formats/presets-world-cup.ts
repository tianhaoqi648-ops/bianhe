import type { PresetDef } from './presets'

const MINUTE = 60 * 1000

const standardBells = [
  { atMs: 30 * 1000, sound: 'beep' as const },
  { atMs: 0, sound: 'time_up' as const }
]

/** 华语辩论世界杯（黄金联赛）14 环节（立论 3'30 + 质询 2' + 小结 1'30 + 对辩/自由辩论 + 结辩 3'30） */
export const WORLD_CUP_FORMAT: PresetDef = {
  id: 'preset-world-cup',
  name: '华语辩论世界杯（黄金联赛）14 环节',
  description: '华语辩论世界杯（黄金联赛）14 环节：立论3\'30+质询2\'+小结1\'30+对辩/自由辩论+结辩3\'30，共约32.5分钟',
  formatData: {
    totalDurationMs:
      3.5 * MINUTE +
      2 * MINUTE +
      3.5 * MINUTE +
      2 * MINUTE +
      1.5 * MINUTE +
      1.5 * MINUTE +
      1.5 * MINUTE +
      1.5 * MINUTE +
      1.5 * MINUTE +
      1.5 * MINUTE +
      1.5 * MINUTE +
      4 * MINUTE +
      3.5 * MINUTE +
      3.5 * MINUTE,
    stages: [
      { id: 'aff_opening', name: '正方一辩开篇立论', side: 'aff', speaker: '正方一辩', durationMs: 3.5 * MINUTE, bells: standardBells },
      { id: 'neg_cross_1', name: '反方二辩质询正方一辩', side: 'neg', speaker: '反方二辩', durationMs: 2 * MINUTE, bells: standardBells },
      { id: 'neg_opening', name: '反方一辩开篇立论', side: 'neg', speaker: '反方一辩', durationMs: 3.5 * MINUTE, bells: standardBells },
      { id: 'aff_cross_1', name: '正方二辩质询反方一辩', side: 'aff', speaker: '正方二辩', durationMs: 2 * MINUTE, bells: standardBells },
      { id: 'neg_cross_summary_1', name: '反方二辩质询小结', side: 'neg', speaker: '反方二辩', durationMs: 1.5 * MINUTE, bells: standardBells },
      { id: 'aff_cross_summary_1', name: '正方二辩质询小结', side: 'aff', speaker: '正方二辩', durationMs: 1.5 * MINUTE, bells: standardBells },
      { id: 'aff_vs_neg_debate', name: '正方四辩vs反方四辩对辩', side: 'aff', speaker: '双方', durationMs: 1.5 * MINUTE, isFreeDebate: true, bells: standardBells },
      { id: 'aff_cross_2', name: '正方三辩盘问', side: 'aff', speaker: '正方三辩', durationMs: 1.5 * MINUTE, bells: standardBells },
      { id: 'neg_cross_2', name: '反方三辩盘问', side: 'neg', speaker: '反方三辩', durationMs: 1.5 * MINUTE, bells: standardBells },
      { id: 'aff_cross_summary_2', name: '正方三辩盘问小结', side: 'aff', speaker: '正方三辩', durationMs: 1.5 * MINUTE, bells: standardBells },
      { id: 'neg_cross_summary_2', name: '反方三辩盘问小结', side: 'neg', speaker: '反方三辩', durationMs: 1.5 * MINUTE, bells: standardBells },
      { id: 'free_debate', name: '自由辩论', side: 'aff', speaker: '双方', durationMs: 4 * MINUTE, isFreeDebate: true, bells: standardBells },
      { id: 'neg_summary', name: '反方四辩总结陈词', side: 'neg', speaker: '反方四辩', durationMs: 3.5 * MINUTE, bells: standardBells },
      { id: 'aff_summary', name: '正方四辩总结陈词', side: 'aff', speaker: '正方四辩', durationMs: 3.5 * MINUTE, bells: standardBells }
    ]
  }
}