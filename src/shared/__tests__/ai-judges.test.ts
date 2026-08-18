// ============================================================
// ai-judges.test.ts — 评委人设包数据结构完整性测试（AI 裁判功能 2026-08-18）
//
// 覆盖：
//   - 内置评委数量 = 5、id 唯一且符合短横线命名
//   - FIVE_DIMENSIONS 与每位评委 weights 的 key 全集一致
//   - 每位评委五维权重和 ≈ 1
//   - 必填字段非空（bio/styleTraits/judgePriorities/signaturePhrases/reviewStyle）
//   - getJudgeById 命中与未命中
// ============================================================

import { describe, it, expect } from 'vitest'
import { JUDGES, FIVE_DIMENSIONS, getJudgeById } from '../ai-judges'

const DIMENSION_KEYS = FIVE_DIMENSIONS.map((d) => d.key)

describe('评委人设包结构', () => {
  it('内置 5 位评委', () => {
    expect(JUDGES).toHaveLength(5)
  })

  it('id 唯一且短横线命名', () => {
    const ids = JUDGES.map((j) => j.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z]+(-[a-z]+)+$/)
    }
  })

  it('每位评委的 weights key 与 FIVE_DIMENSIONS 一致', () => {
    for (const judge of JUDGES) {
      const weightKeys = Object.keys(judge.weights).sort()
      expect(weightKeys).toEqual([...DIMENSION_KEYS].sort())
    }
  })

  it('每位评委五维权重和 ≈ 1', () => {
    for (const judge of JUDGES) {
      const sum = Object.values(judge.weights).reduce((a, b) => a + b, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
    }
  })

  it('权重均在 0-1 之间', () => {
    for (const judge of JUDGES) {
      for (const w of Object.values(judge.weights)) {
        expect(w).toBeGreaterThanOrEqual(0)
        expect(w).toBeLessThanOrEqual(1)
      }
    }
  })

  it('必填字段非空', () => {
    for (const judge of JUDGES) {
      expect(judge.name.length).toBeGreaterThan(0)
      expect(judge.category.length).toBeGreaterThan(0)
      expect(judge.bio.length).toBeGreaterThan(0)
      expect(judge.styleTraits.length).toBeGreaterThan(0)
      expect(judge.judgePriorities.top.length).toBeGreaterThan(0)
      expect(judge.judgePriorities.secondary.length).toBeGreaterThan(0)
      expect(judge.judgePriorities.ignored.length).toBeGreaterThan(0)
      expect(judge.signaturePhrases.length).toBeGreaterThan(0)
      expect(judge.reviewStyle.length).toBeGreaterThan(0)
    }
  })

  it('五维维度名非空且 key 唯一', () => {
    const keys = FIVE_DIMENSIONS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const d of FIVE_DIMENSIONS) {
      expect(d.name.length).toBeGreaterThan(0)
    }
  })
})

describe('getJudgeById', () => {
  it('命中：返回对应评委', () => {
    const judge = getJudgeById('hu-jianbiao')
    expect(judge?.name).toBe('胡渐彪')
  })

  it('未命中：返回 undefined', () => {
    expect(getJudgeById('unknown-judge')).toBeUndefined()
  })

  it('空 id：返回 undefined', () => {
    expect(getJudgeById(undefined)).toBeUndefined()
  })
})
