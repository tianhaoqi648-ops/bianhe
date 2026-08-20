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
  description: '4 队 8 人各 7 分钟，POI 保护第 1/6 分钟；OG/OO/CG/CO 之字形交替',
  formatData: {
    totalDurationMs: 56 * MINUTE,
    stages: [
      { id: 'pm', name: '首相发言', side: 'og', speaker: '首相', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'lo', name: '反对党领袖发言', side: 'oo', speaker: '反对党领袖', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'dpm', name: '副首相发言', side: 'og', speaker: '副首相', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'dlo', name: '反对党副领袖发言', side: 'oo', speaker: '反对党副领袖', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'mg', name: '政府阁员发言', side: 'cg', speaker: '政府阁员', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'mo', name: '反对党阁员发言', side: 'co', speaker: '反对党阁员', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'gw', name: '政府党鞭总结', side: 'cg', speaker: '政府党鞭', durationMs: 7 * MINUTE, bells: standardBells },
      { id: 'ow', name: '反对党党鞭总结', side: 'co', speaker: '反对党党鞭', durationMs: 7 * MINUTE, bells: standardBells }
    ]
  }
}
