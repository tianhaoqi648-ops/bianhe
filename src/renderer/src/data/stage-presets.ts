// ============================================================
// stage-presets.ts — 环节预设库（P3.3 Task 15）
//
// 12 个常见环节预设，用户可通过 Dropdown 快速添加到赛制。
// 每个 preset 的 stage 字段为 Partial<StageDef>，由 StageCardList
// 调用 addStage 时补全 id（uuid）与缺失的默认字段。
// ============================================================

import type { StageDef, StageSide } from '../../../shared/debate-formats/types'

/** 30 秒倒计时提示铃 */
const bell30s = { atMs: 30 * 1000, sound: 'beep' as const }
/** 时间到铃 */
const bellTimeUp = { atMs: 0, sound: 'time_up' as const }

export interface StagePreset {
  id: string
  name: string
  description: string
  /** Partial<StageDef>：调用方负责补全 id 与必要字段 */
  stage: Partial<StageDef>
}

/**
 * 12 个常见环节预设。
 *
 * 字段映射说明（tasks.md 中的逻辑字段 → StageDef 实际字段）：
 * - speaker='pro'    → side='aff'
 * - speaker='con'    → side='neg'
 * - speaker='alternate' → side='both'
 * - timerDirection='down'  → timingMode='countdown'（默认，可省略）
 * - timerDirection='none'  → timingMode='untimed'
 * - isUntimed=true → timingMode='untimed'
 */
export const STAGE_PRESETS: StagePreset[] = [
  {
    id: 'preset-opening',
    name: '开篇立论',
    description: '正方立论，3 分钟，30 秒提示铃',
    stage: {
      name: '开篇立论',
      side: 'aff' as StageSide,
      durationMs: 180_000,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-cross',
    name: '攻辩',
    description: '双方交替攻辩，1.5 分钟',
    stage: {
      name: '攻辩',
      side: 'both' as StageSide,
      durationMs: 90_000,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-cross-summary',
    name: '攻辩小结',
    description: '正方攻辩小结，2 分钟',
    stage: {
      name: '攻辩小结',
      side: 'aff' as StageSide,
      durationMs: 120_000,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-free',
    name: '自由辩论',
    description: '双方自由辩论，4 分钟，Space 切换发言方',
    stage: {
      name: '自由辩论',
      side: 'both' as StageSide,
      durationMs: 240_000,
      isFreeDebate: true,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-closing',
    name: '总结陈词',
    description: '反方总结陈词，3 分钟',
    stage: {
      name: '总结陈词',
      side: 'neg' as StageSide,
      durationMs: 180_000,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-constructive',
    name: '申论',
    description: '申论环节，3 分钟',
    stage: {
      name: '申论',
      side: 'both' as StageSide,
      durationMs: 180_000,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-cross-exam',
    name: '质询',
    description: '质询环节，1.5 分钟',
    stage: {
      name: '质询',
      side: 'both' as StageSide,
      durationMs: 90_000,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-answer',
    name: '答辩',
    description: '答辩环节，1 分钟',
    stage: {
      name: '答辩',
      side: 'both' as StageSide,
      durationMs: 60_000,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-rebuttal',
    name: '反驳',
    description: '反驳环节，1.5 分钟',
    stage: {
      name: '反驳',
      side: 'both' as StageSide,
      durationMs: 90_000,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-final-closing',
    name: '结辩',
    description: '结辩环节，2 分钟',
    stage: {
      name: '结辩',
      side: 'both' as StageSide,
      durationMs: 120_000,
      bells: [bell30s, bellTimeUp]
    }
  },
  {
    id: 'preset-judge-qna',
    name: '评委提问',
    description: '不计时环节，评委提问',
    stage: {
      name: '评委提问',
      side: 'both' as StageSide,
      durationMs: 0,
      timingMode: 'untimed',
      bells: []
    }
  },
  {
    id: 'preset-break',
    name: '休息',
    description: '不计时环节，休息 10 分钟',
    stage: {
      name: '休息',
      side: 'both' as StageSide,
      durationMs: 600_000,
      timingMode: 'untimed',
      bells: []
    }
  }
]
