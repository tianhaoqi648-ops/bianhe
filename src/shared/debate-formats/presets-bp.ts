import type { PresetDef } from './presets'

const MINUTE = 60 * 1000

const standardBells = [
  { atMs: 30 * 1000, sound: 'beep' as const },
  { atMs: 0, sound: 'time_up' as const }
]

/**
 * BP 英式议会制（British Parliamentary）
 * 4 支队伍：OG（正方上院）/ OO（反方上院）/ CG（正方下院）/ CO（反方下院）
 * 数据层仍映射为 aff/neg 两方，stage.side 使用 og/oo/cg/co 细分角色
 */
export const BP_FORMAT: PresetDef = {
  id: 'preset-bp',
  name: '英式议会制（BP）',
  description: 'OG/OO/CG/CO 四角色 7 分钟发言 + POI，共约 28 分钟',
  formatData: {
    totalDurationMs: 28 * MINUTE,
    stages: [
      { id: 'pm', name: '首相发言（OG）', side: 'og', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'lo', name: '领袖反对（OO）', side: 'oo', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'dpm', name: '副首相发言（CG）', side: 'cg', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'dlo', name: '副领袖反对（CO）', side: 'co', durationMs: 7 * MINUTE, bells: standardBells }
    ]
  }
}
