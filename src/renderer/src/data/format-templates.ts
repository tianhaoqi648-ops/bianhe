// ============================================================
// format-templates.ts — 赛制模板库（P3.3 Task 14）
//
// 8 个内置赛制模板，用户可从模板克隆为可编辑副本。
// 模板本身不可变，克隆时 stages 重新生成 id 避免与现有赛制冲突。
// ============================================================

import type { StageDef } from '../../../shared/debate-formats/types'

/** 模板图标标识（由 FormatTemplateModal 映射为 antd Icon 组件） */
export type FormatTemplateIcon =
  | 'trophy'
  | 'aim'
  | 'global'
  | 'compass'
  | 'flag'
  | 'star'
  | 'thunderbolt'
  | 'solution'

export interface FormatTemplate {
  id: string
  name: string
  description: string
  stages: StageDef[]
  icon: FormatTemplateIcon
}

/** 30 秒倒计时提示铃 */
const bell30s = { atMs: 30 * 1000, sound: 'beep' as const }
/** 时间到铃 */
const bellTimeUp = { atMs: 0, sound: 'time_up' as const }

/** 标准倒计时环节铃声：30s 提示 + 时间到 */
const standardBells = [bell30s, bellTimeUp]

/**
 * 8 个内置赛制模板。
 *
 * 时长单位均为毫秒，与 StageDef.durationMs 一致。
 * 模板中 stage.id 使用稳定字符串便于维护，克隆时由 FormatTemplateModal 重新生成 uuid。
 */
export const FORMAT_TEMPLATES: FormatTemplate[] = [
  {
    id: 'tpl-national',
    name: '国赛制',
    description: '标准 4 环节：开篇立论 + 攻辩 + 自由辩论 + 总结陈词',
    icon: 'trophy',
    stages: [
      {
        id: 'national-opening',
        name: '开篇立论',
        side: 'aff',
        durationMs: 180_000,
        bells: standardBells
      },
      {
        id: 'national-cross',
        name: '攻辩',
        side: 'both',
        durationMs: 90_000,
        bells: standardBells
      },
      {
        id: 'national-free',
        name: '自由辩论',
        side: 'both',
        durationMs: 240_000,
        isFreeDebate: true,
        bells: standardBells
      },
      {
        id: 'national-closing',
        name: '总结陈词',
        side: 'neg',
        durationMs: 180_000,
        bells: standardBells
      }
    ]
  },
  {
    id: 'tpl-oregon',
    name: '奥瑞冈赛制',
    description: '5 环节：申论 + 质询 + 答辩 + 反驳 + 结辩',
    icon: 'aim',
    stages: [
      {
        id: 'oregon-constructive',
        name: '申论',
        side: 'aff',
        durationMs: 180_000,
        bells: standardBells
      },
      {
        id: 'oregon-cross-exam',
        name: '质询',
        side: 'both',
        durationMs: 90_000,
        bells: standardBells
      },
      {
        id: 'oregon-answer',
        name: '答辩',
        side: 'both',
        durationMs: 60_000,
        bells: standardBells
      },
      {
        id: 'oregon-rebuttal',
        name: '反驳',
        side: 'both',
        durationMs: 90_000,
        bells: standardBells
      },
      {
        id: 'oregon-closing',
        name: '结辩',
        side: 'both',
        durationMs: 120_000,
        bells: standardBells
      }
    ]
  },
  {
    id: 'tpl-bp',
    name: '英式辩论赛制',
    description: 'BP 制 4 队 6 环节：上院/下院申论 + 反驳',
    icon: 'global',
    stages: [
      {
        id: 'bp-og',
        name: '上院政府申论',
        side: 'og',
        durationMs: 420_000,
        bells: standardBells
      },
      {
        id: 'bp-oo',
        name: '上院反对申论',
        side: 'oo',
        durationMs: 420_000,
        bells: standardBells
      },
      {
        id: 'bp-cg',
        name: '下院政府申论',
        side: 'cg',
        durationMs: 420_000,
        bells: standardBells
      },
      {
        id: 'bp-co',
        name: '下院反对申论',
        side: 'co',
        durationMs: 420_000,
        bells: standardBells
      },
      {
        id: 'bp-upper-whip',
        name: '上院反驳',
        side: 'oo',
        durationMs: 240_000,
        bells: standardBells
      },
      {
        id: 'bp-lower-whip',
        name: '下院反驳',
        side: 'co',
        durationMs: 240_000,
        bells: standardBells
      }
    ]
  },
  {
    id: 'tpl-asian',
    name: '亚洲赛制',
    description: '3 环节：申论 + 反驳 + 结辩',
    icon: 'compass',
    stages: [
      {
        id: 'asian-constructive',
        name: '申论',
        side: 'aff',
        durationMs: 210_000,
        bells: standardBells
      },
      {
        id: 'asian-rebuttal',
        name: '反驳',
        side: 'both',
        durationMs: 120_000,
        bells: standardBells
      },
      {
        id: 'asian-closing',
        name: '结辩',
        side: 'both',
        durationMs: 90_000,
        bells: standardBells
      }
    ]
  },
  {
    id: 'tpl-singapore',
    name: '新加坡赛制',
    description: '4 环节：申论 + 反驳 + 自由辩论 + 结辩',
    icon: 'flag',
    stages: [
      {
        id: 'sg-constructive',
        name: '申论',
        side: 'aff',
        durationMs: 180_000,
        bells: standardBells
      },
      {
        id: 'sg-rebuttal',
        name: '反驳',
        side: 'both',
        durationMs: 120_000,
        bells: standardBells
      },
      {
        id: 'sg-free',
        name: '自由辩论',
        side: 'both',
        durationMs: 180_000,
        isFreeDebate: true,
        bells: standardBells
      },
      {
        id: 'sg-closing',
        name: '结辩',
        side: 'neg',
        durationMs: 150_000,
        bells: standardBells
      }
    ]
  },
  {
    id: 'tpl-star',
    name: '星辩赛制',
    description: '4 环节：开篇立论 + 攻辩 + 自由辩论 + 总结陈词',
    icon: 'star',
    stages: [
      {
        id: 'star-opening',
        name: '开篇立论',
        side: 'aff',
        durationMs: 240_000,
        bells: standardBells
      },
      {
        id: 'star-cross',
        name: '攻辩',
        side: 'both',
        durationMs: 120_000,
        bells: standardBells
      },
      {
        id: 'star-free',
        name: '自由辩论',
        side: 'both',
        durationMs: 300_000,
        isFreeDebate: true,
        bells: standardBells
      },
      {
        id: 'star-closing',
        name: '总结陈词',
        side: 'neg',
        durationMs: 210_000,
        bells: standardBells
      }
    ]
  },
  {
    id: 'tpl-1v1',
    name: '单挑赛制',
    description: '2 环节：立论 + 自由辩论',
    icon: 'thunderbolt',
    stages: [
      {
        id: '1v1-opening',
        name: '立论',
        side: 'aff',
        durationMs: 180_000,
        bells: standardBells
      },
      {
        id: '1v1-free',
        name: '自由辩论',
        side: 'both',
        durationMs: 240_000,
        isFreeDebate: true,
        bells: standardBells
      }
    ]
  },
  {
    id: 'tpl-interview',
    name: '模拟面试赛制',
    description: '2 环节：陈述 + 评委提问（不计时）',
    icon: 'solution',
    stages: [
      {
        id: 'interview-presentation',
        name: '陈述',
        side: 'both',
        durationMs: 300_000,
        bells: standardBells
      },
      {
        id: 'interview-qna',
        name: '评委提问',
        side: 'both',
        durationMs: 0,
        timingMode: 'untimed',
        bells: []
      }
    ]
  }
]
