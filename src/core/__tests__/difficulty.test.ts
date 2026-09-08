import { describe, it, expect } from 'vitest'
import {
  CANONICAL_DIFFICULTIES,
  DIFFICULTY_LEVELS,
  DIFFICULTY_ROUND_PRESETS,
  normalizeDifficulty,
  roundNameToDifficulty,
  getDifficultyDistribution
} from '../rules/difficulty'

describe('difficulty: 常量', () => {
  it('规范档 3 档；DIFFICULTY_LEVELS 为别名同值', () => {
    expect(CANONICAL_DIFFICULTIES).toEqual(['入门', '进阶', '专业'])
    expect(DIFFICULTY_LEVELS).toEqual(CANONICAL_DIFFICULTIES)
    expect(DIFFICULTY_ROUND_PRESETS).toHaveLength(3)
  })
})

describe('difficulty: normalizeDifficulty（标签→规范档）', () => {
  it('规范档原样；旧标签等价；大师级→专业；未知→null', () => {
    expect(normalizeDifficulty('入门')).toBe('入门')
    expect(normalizeDifficulty('入门级')).toBe('入门')
    expect(normalizeDifficulty('进阶')).toBe('进阶')
    expect(normalizeDifficulty('进阶级')).toBe('进阶')
    expect(normalizeDifficulty('专业')).toBe('专业')
    expect(normalizeDifficulty('专业级')).toBe('专业')
    expect(normalizeDifficulty('大师级')).toBe('专业')
    expect(normalizeDifficulty('未知')).toBeNull()
    expect(normalizeDifficulty(null)).toBeNull()
  })
})

describe('difficulty: roundNameToDifficulty（preset 上下文）', () => {
  it('决赛在不同 preset 档位不同', () => {
    expect(roundNameToDifficulty('决赛', 'standard')).toBe('专业')
    expect(roundNameToDifficulty('决赛', 'compact')).toBe('进阶')
    expect(roundNameToDifficulty('决赛', 'extended')).toBe('专业')
  })
  it('未命中/缺参数 → null', () => {
    expect(roundNameToDifficulty('未知轮次', 'standard')).toBeNull()
    expect(roundNameToDifficulty(null, 'standard')).toBeNull()
    expect(roundNameToDifficulty('决赛', null)).toBeNull()
  })
})

describe('difficulty: getDifficultyDistribution（关键词→规范档分布）', () => {
  it('小组/分组/初赛 → 入门偏', () => {
    expect(getDifficultyDistribution('小组赛')).toEqual({ 入门: 0.6, 进阶: 0.4, 专业: 0 })
    expect(getDifficultyDistribution('分组赛')).toEqual({ 入门: 0.6, 进阶: 0.4, 专业: 0 })
  })
  it('复赛/淘汰/半决赛 → 进阶偏', () => {
    expect(getDifficultyDistribution('复赛')).toEqual({ 入门: 0, 进阶: 0.6, 专业: 0.4 })
    expect(getDifficultyDistribution('半决赛')).toEqual({ 入门: 0, 进阶: 0.6, 专业: 0.4 })
  })
  it('决赛/总决赛/冠军 → 专业', () => {
    expect(getDifficultyDistribution('决赛')).toEqual({ 入门: 0, 进阶: 0, 专业: 1 })
    expect(getDifficultyDistribution('总决赛')).toEqual({ 入门: 0, 进阶: 0, 专业: 1 })
  })
  it('未匹配/null → 默认 0.34/0.33/0.33', () => {
    expect(getDifficultyDistribution('表演赛').入门).toBeCloseTo(0.34)
    expect(getDifficultyDistribution(null)).toEqual({ 入门: 0.34, 进阶: 0.33, 专业: 0.33 })
  })
})
