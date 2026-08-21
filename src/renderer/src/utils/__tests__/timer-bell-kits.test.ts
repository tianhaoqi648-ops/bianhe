import { describe, it, expect } from 'vitest'
import {
  BELL_KITS,
  BELL_KIT_KEY,
  DEFAULT_BELL_KIT,
  getBellKit,
  getBellKitFromSettings,
  resolveBellKitId,
  programDuration,
  type BuiltinBellSound
} from '../timer-bell-kits'

const ALL_BUILTIN: BuiltinBellSound[] = ['beep', 'bell', 'double_bell', 'time_up']

describe('timer-bell-kits: 铃声库定义完整性', () => {
  it('默认铃声库为 classic', () => {
    expect(DEFAULT_BELL_KIT).toBe('classic')
  })

  it('每套铃声库都覆盖全部 4 个内置语义键且有非空合成程序', () => {
    expect(BELL_KITS.length).toBeGreaterThan(1)
    for (const kit of BELL_KITS) {
      for (const sound of ALL_BUILTIN) {
        const program = kit.sounds[sound]
        expect(program, `${kit.id}/${sound} 应该有合成程序`).toBeDefined()
        expect(program.length, `${kit.id}/${sound} 不应为空`).toBeGreaterThan(0)
        for (const step of program) {
          expect(step.freq).toBeGreaterThan(0)
          expect(step.durMs).toBeGreaterThan(0)
          expect(step.atMs).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('timer-bell-kits: 铃声库解析与回退', () => {
  it('getBellKit 已知 id 返回对应铃声库', () => {
    expect(getBellKit('electronic').id).toBe('electronic')
  })

  it('getBellKit 非法/缺失回退到第一套（classic）', () => {
    expect(getBellKit('nope').id).toBe('classic')
    expect(getBellKit(undefined).id).toBe('classic')
    expect(getBellKit(null).id).toBe('classic')
  })

  it('getBellKitFromSettings 从 settings 读取并回退', () => {
    expect(getBellKitFromSettings({ [BELL_KIT_KEY]: 'gate' }).id).toBe('gate')
    expect(getBellKitFromSettings({}).id).toBe('classic')
    expect(getBellKitFromSettings(null).id).toBe('classic')
    expect(getBellKitFromSettings({ [BELL_KIT_KEY]: 'bad' }).id).toBe('classic')
  })

  it('resolveBellKitId 返回合法 id', () => {
    expect(resolveBellKitId('clock')).toBe('clock')
    expect(resolveBellKitId('bad')).toBe('classic')
  })
})

describe('timer-bell-kits: 合成程序时长', () => {
  it('classic 语义键时长与既有行为一致', () => {
    const classic = getBellKit('classic')
    expect(programDuration(classic.sounds.beep)).toBe(200)
    expect(programDuration(classic.sounds.bell)).toBe(400)
    expect(programDuration(classic.sounds.double_bell)).toBe(450)
    expect(programDuration(classic.sounds.time_up)).toBe(900)
  })

  it('空程序时长为 0', () => {
    expect(programDuration([])).toBe(0)
  })
})