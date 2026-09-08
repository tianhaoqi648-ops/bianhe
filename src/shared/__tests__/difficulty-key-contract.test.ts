// ============================================================
// difficulty-key-contract.test.ts — 难度「规范档 / label」双命名空间契约测试
//
// 背景（Phase 0.6 补契约，零生产代码改动）：
//   core 迁移把难度规范从桌面本地实现抽到 @core/rules/difficulty，
//   规范档键为「入门/进阶/专业」，而数据库与显示层仍用 label 键「入门级/进阶级/专业级」。
//
// 本文件锁住 5 条契约：
//   1) 旧难度值经 normalizeDifficulty 得预期规范档（含 大师级 / 未知 / 空值边界）
//   2) getDifficultyDistribution 返回键恒为规范档（防止未来改回 label 键）
//   3) 旧 label 候选仍能正确进池 —— 经 applyDifficultyDistribution 行为间接锁住
//      私有 distValue / matchesLevel 兼容层（这是「当前无回归」的根因）
//   4) 引擎↔显示桥梁往返一致（经公开 DIFFICULTY_PRESETS / DIFFICULTY_OPTIONS 验证）
//   5) 文档化双命名空间：显示层若先 normalize 再查 label 表会整体落 default
//
// 放置于 shared（core 与桌面之间的接缝）而非 core/__tests__，
// 避免 core 反向依赖 shared，违反 core「零外部 import」铁律。
// 与 src/core/__tests__/golden/fixtures/difficulty.json 预期一致。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  CANONICAL_DIFFICULTIES,
  DIFFICULTY_LEVELS,
  DIFFICULTY_ROUND_PRESETS,
  normalizeDifficulty,
  getDifficultyDistribution
} from '@core/rules/difficulty'
import { applyDifficultyDistribution, type WeightedItem } from '@core/rules/draw/probability'
import { DIFFICULTY_PRESETS, DIFFICULTY_OPTIONS } from '../difficulty-presets'

describe('难度键契约：normalizeDifficulty 规范档映射（含边界）', () => {
  it('规范档原样返回；旧标签等价映射到规范档', () => {
    expect(normalizeDifficulty('入门')).toBe('入门')
    expect(normalizeDifficulty('入门级')).toBe('入门')
    expect(normalizeDifficulty('进阶')).toBe('进阶')
    expect(normalizeDifficulty('进阶级')).toBe('进阶')
    expect(normalizeDifficulty('专业')).toBe('专业')
    expect(normalizeDifficulty('专业级')).toBe('专业')
  })

  it('大师级归一化为专业', () => {
    expect(normalizeDifficulty('大师级')).toBe('专业')
  })

  it('未知字符串一律 null（简单/中等/困难/easy/未知 等历史变体不在映射表内）', () => {
    expect(normalizeDifficulty('简单')).toBeNull()
    expect(normalizeDifficulty('中等')).toBeNull()
    expect(normalizeDifficulty('困难')).toBeNull()
    expect(normalizeDifficulty('easy')).toBeNull()
    expect(normalizeDifficulty('未知')).toBeNull()
  })

  it('空值与纯空白 → null', () => {
    expect(normalizeDifficulty(null)).toBeNull()
    expect(normalizeDifficulty(undefined)).toBeNull()
    expect(normalizeDifficulty('')).toBeNull()
    expect(normalizeDifficulty('   ')).toBeNull()
  })

  it('前后空白被 trim 后比较', () => {
    expect(normalizeDifficulty(' 入门 ')).toBe('入门')
    expect(normalizeDifficulty('\t进阶级\n')).toBe('进阶')
  })
})

describe('难度键契约：getDifficultyDistribution 键恒为规范档', () => {
  it('返回对象键集合恒为规范档三键，绝不出现 label 键', () => {
    // 注意：中文 sort() 按 UTF-16 码元排序，顺序非字面顺序，故两侧同序比较
    const expectedKeys = [...CANONICAL_DIFFICULTIES].sort()
    const rounds = ['小组赛', '分组赛', '初赛', '复赛', '半决赛', '决赛', '总决赛', '冠军', '表演赛', null]
    for (const r of rounds) {
      expect(Object.keys(getDifficultyDistribution(r)).sort()).toEqual(expectedKeys)
    }
  })

  it('三项比例之和恒为 1', () => {
    for (const r of ['小组赛', '复赛', '决赛', '表演赛']) {
      const d = getDifficultyDistribution(r)
      expect(d.入门 + d.进阶 + d.专业).toBeCloseTo(1)
    }
  })

  it('关键词命中正确分布', () => {
    expect(getDifficultyDistribution('小组赛')).toEqual({ 入门: 0.6, 进阶: 0.4, 专业: 0 })
    expect(getDifficultyDistribution('复赛')).toEqual({ 入门: 0, 进阶: 0.6, 专业: 0.4 })
    expect(getDifficultyDistribution('决赛')).toEqual({ 入门: 0, 进阶: 0, 专业: 1 })
  })
})

describe('难度键契约：旧 label 值仍能正确进池（distValue / matchesLevel 兼容层）', () => {
  interface MockTopic extends WeightedItem {
    id: string
    difficulty: string | null
  }

  function labelPool(): MockTopic[] {
    return [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `entry-${i}`, weight: 1, difficulty: '入门级' })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `inter-${i}`, weight: 1, difficulty: '进阶级' })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `pro-${i}`, weight: 1, difficulty: '专业级' }))
    ]
  }

  it('候选用 label 键（入门级）也能正确归入规范档【入门】池', () => {
    const result = applyDifficultyDistribution(labelPool(), { 入门: 1, 进阶: 0, 专业: 0 }, 4)
    expect(result).toHaveLength(4)
    expect(result.every((r) => r.difficulty === '入门级')).toBe(true)
  })

  it('label 键候选在混合分布下按规范档分层，不足部分从余量补足', () => {
    const result = applyDifficultyDistribution(labelPool(), { 入门: 0.6, 进阶: 0.4, 专业: 0 }, 10)
    expect(result).toHaveLength(10)
    expect(result.filter((r) => r.difficulty === '入门级')).toHaveLength(4)
    expect(result.filter((r) => r.difficulty === '进阶级')).toHaveLength(4)
    expect(result.filter((r) => r.difficulty === '专业级')).toHaveLength(2)
  })

  it('分布对象用 label 键（入门级/进阶级/专业级）也能被 distValue 兼容读取', () => {
    const labelKeyedDist = { 入门级: 0.5, 进阶级: 0.5, 专业级: 0 } as never
    const result = applyDifficultyDistribution(labelPool(), labelKeyedDist, 8)
    expect(result).toHaveLength(8)
    expect(result.filter((r) => r.difficulty === '入门级')).toHaveLength(4)
    expect(result.filter((r) => r.difficulty === '进阶级')).toHaveLength(4)
  })
})

describe('难度键契约：引擎↔显示桥梁往返一致', () => {
  it('每个 preset 轮次的 difficulty_override(label) 归一化后回到对应规范档', () => {
    for (const coreP of DIFFICULTY_ROUND_PRESETS) {
      const desktopP = DIFFICULTY_PRESETS.find((p) => p.key === coreP.key)
      expect(desktopP).toBeDefined()
      for (const round of coreP.presets) {
        const desktopRound = desktopP!.presets.find((r) => r.name === round.name)
        expect(desktopRound).toBeDefined()
        expect(normalizeDifficulty(desktopRound!.difficulty_override)).toBe(round.difficulty)
      }
    }
  })

  it('DIFFICULTY_OPTIONS(label 选项) 归一化回规范档；大师级→专业', () => {
    expect(normalizeDifficulty(DIFFICULTY_OPTIONS[0])).toBe('入门')
    expect(normalizeDifficulty(DIFFICULTY_OPTIONS[1])).toBe('进阶')
    expect(normalizeDifficulty(DIFFICULTY_OPTIONS[2])).toBe('专业')
    expect(normalizeDifficulty(DIFFICULTY_OPTIONS[3])).toBe('专业')
  })

  it('DIFFICULTY_LEVELS 与 CANONICAL_DIFFICULTIES 同值（规范档真源）', () => {
    expect(DIFFICULTY_LEVELS).toEqual(CANONICAL_DIFFICULTIES)
  })
})

describe('难度键契约（文档化反例）：显示层禁止先 normalize 再查 label 映射表', () => {
  it('先 normalize 后查 label 表会整体落 default —— 证明显示层必须以 label 为键', () => {
    const DISPLAY_COLOR: Record<string, string> = { 入门级: 'green', 进阶级: 'orange', 专业级: 'red' }
    expect(DISPLAY_COLOR[normalizeDifficulty('入门级') as string]).toBeUndefined()
    expect(DISPLAY_COLOR['入门级']).toBe('green')
  })
})
