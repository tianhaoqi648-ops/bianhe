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
  description: '立论3分+质询2分+自由辩论（单方4分）+总结3分',
  formatData: {
    totalDurationMs: 20 * MINUTE,
    stages: [
      { id: 'aff_opening', name: '正方立论', side: 'aff', speaker: '正方一辩', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'neg_cross', name: '反方质询', side: 'neg', speaker: '反方四辩', durationMs: 2 * MINUTE, bells: standardBells },
      { id: 'neg_opening', name: '反方立论', side: 'neg', speaker: '反方一辩', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'aff_cross', name: '正方质询', side: 'aff', speaker: '正方四辩', durationMs: 2 * MINUTE, bells: standardBells },
      { id: 'free_debate', name: '自由辩论', side: 'aff', speaker: '双方', durationMs: 4 * MINUTE, isFreeDebate: true, bells: standardBells },
      { id: 'aff_summary', name: '正方总结', side: 'aff', speaker: '正方四辩', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'neg_summary', name: '反方总结', side: 'neg', speaker: '反方四辩', durationMs: 3 * MINUTE, bells: standardBells }
    ]
  }
}

/** 新国辩赛制 · 2025 固定版（口径 A）：13 环节，含驳辩后质询；1v1 单方发言 */
export const NEW_NATIONAL_FORMAT: PresetDef = {
  id: 'preset-new-national',
  name: '新国辩赛制',
  description: '2025 新国辩（含驳辩后质询）：立论3\'+质询2\'(单边)+驳辩3\'+质询小结2\'30+自由辩论各4\'+总结3\'',
  formatData: {
    totalDurationMs: 35 * MINUTE,
    stages: [
      // ① 立论（正方一辩）
      { id: 'aff_opening', name: '正方一辩立论', side: 'aff', speaker: '正方一辩', durationMs: 3 * MINUTE, bells: standardBells },
      // ② 质询（反方四辩质询正方一辩，单边，正方四辩接招）
      { id: 'neg_cross_aff1', name: '反方四辩质询正方一辩', side: 'neg', speaker: '反方四辩', durationMs: 2 * MINUTE, bells: standardBells },
      // ③ 立论（反方一辩）
      { id: 'neg_opening', name: '反方一辩立论', side: 'neg', speaker: '反方一辩', durationMs: 3 * MINUTE, bells: standardBells },
      // ④ 质询（正方四辩质询反方一辩，单边）
      { id: 'aff_cross_neg1', name: '正方四辩质询反方一辩', side: 'aff', speaker: '正方四辩', durationMs: 2 * MINUTE, bells: standardBells },
      // ⑤ 驳辩（正方二辩）→ ⑥ 反方三辩质询正方二辩
      { id: 'aff_rebuttal', name: '正方二辩驳辩', side: 'aff', speaker: '正方二辩', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'neg_cross_aff2', name: '反方三辩质询正方二辩', side: 'neg', speaker: '反方三辩', durationMs: 2 * MINUTE, bells: standardBells },
      // ⑦ 驳辩（反方二辩）→ ⑧ 正方三辩质询反方二辩
      { id: 'neg_rebuttal', name: '反方二辩驳辩', side: 'neg', speaker: '反方二辩', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'aff_cross_neg2', name: '正方三辩质询反方二辩', side: 'aff', speaker: '正方三辩', durationMs: 2 * MINUTE, bells: standardBells },
      // ⑨⑩ 质询小结
      { id: 'aff_cross_summary', name: '正方三辩质询小结', side: 'aff', speaker: '正方三辩', durationMs: 150 * 1000, bells: standardBells },
      { id: 'neg_cross_summary', name: '反方三辩质询小结', side: 'neg', speaker: '反方三辩', durationMs: 150 * 1000, bells: standardBells },
      // ⑪ 自由辩论（各 4 分钟，Space 切换发言方）
      { id: 'free_debate', name: '自由辩论', side: 'aff', speaker: '双方', durationMs: 4 * MINUTE, isFreeDebate: true, bells: standardBells },
      // ⑫⑬ 总结陈词
      { id: 'neg_summary', name: '反方四辩总结陈词', side: 'neg', speaker: '反方四辩', durationMs: 3 * MINUTE, bells: standardBells },
      { id: 'aff_summary', name: '正方四辩总结陈词', side: 'aff', speaker: '正方四辩', durationMs: 3 * MINUTE, bells: standardBells }
    ]
  }
}

/** 新国辩赛制 · 官方 17 分钟自由分配版（口径 B）：
 *  除自由辩论各 4\' 外，每队总环节时长 17 分钟自由分配（每环节 ≥ 1\'）。
 *  teamPoolMinutes 为官方每队池；各环节 poolSuggestedMs 仅为分配示例，可在赛制编辑器调整。
 *  总时长按「非自由环节建议和 17\' + 自由辩论 4\' = 21\'」展示 */
export const NEW_NATIONAL_17MIN_FORMAT: PresetDef = {
  id: 'preset-new-national-17',
  name: '新国辩·官方17分钟自由分配',
  description: '官方：除自由辩论各4\'外，每队17分钟总环节时长自由分配（每环节≥1\'）；本预设为分配示例，可在赛制编辑器调整',
  formatData: {
    totalDurationMs: 21 * MINUTE,
    teamPoolMinutes: { aff: 17, neg: 17 },
    stages: [
      // ① 陈词（正方一辩，正方池）
      { id: 'aff_statement1', name: '陈词1', side: 'aff', speaker: '正方一辩', durationMs: 3 * MINUTE, poolTeam: 'aff', poolSuggestedMs: 3 * MINUTE, bells: standardBells },
      // ② 质询（反方三辩质询，反方池）
      { id: 'neg_query1', name: '质询1', side: 'neg', speaker: '反方三辩', durationMs: 2 * MINUTE, poolTeam: 'neg', poolSuggestedMs: 2 * MINUTE, bells: standardBells },
      // ③ 陈词（正方二辩，正方池）
      { id: 'aff_statement2', name: '陈词2', side: 'aff', speaker: '正方二辩', durationMs: 3 * MINUTE, poolTeam: 'aff', poolSuggestedMs: 3 * MINUTE, bells: standardBells },
      // ④ 质询（反方三辩质询，反方池）
      { id: 'neg_query2', name: '质询2', side: 'neg', speaker: '反方三辩', durationMs: 2 * MINUTE, poolTeam: 'neg', poolSuggestedMs: 2 * MINUTE, bells: standardBells },
      // ⑤ 质询小结（正方三辩，正方池）
      { id: 'aff_query_summary', name: '质询小结', side: 'aff', speaker: '正方三辩', durationMs: 3 * MINUTE, poolTeam: 'aff', poolSuggestedMs: 3 * MINUTE, bells: standardBells },
      // ⑥ 总结陈词（反方四辩，反方池）
      { id: 'neg_closing', name: '总结陈词', side: 'neg', speaker: '反方四辩', durationMs: 4 * MINUTE, poolTeam: 'neg', poolSuggestedMs: 4 * MINUTE, bells: standardBells },
      // ⑦ 自由辩论（各 4 分钟）
      { id: 'free_debate', name: '自由辩论', side: 'aff', speaker: '双方', durationMs: 4 * MINUTE, isFreeDebate: true, bells: standardBells }
    ]
  }
}

export const ALL_PRESETS: PresetDef[] = [CHINESE_FORMAT, NEW_NATIONAL_FORMAT, NEW_NATIONAL_17MIN_FORMAT, WORLD_CUP_FORMAT, BP_FORMAT]
