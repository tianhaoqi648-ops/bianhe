import { describe, it, expect } from 'vitest'
import { normalizeStances, normalizeStancePair } from './stance-utils'

describe('normalizeStances', () => {
  it('相邻同侧修正：第二位翻转', () => {
    // pair(0,1): '正方','正方' → '正方','反方'（翻转第二位）
    // pair(2,3): '反方','反方' → '反方','正方'（翻转第二位，保留第一位）
    expect(normalizeStances(['正方', '正方', '反方', '反方'])).toEqual([
      '正方',
      '反方',
      '反方',
      '正方'
    ])
  })

  it('已正确不变：交替正反', () => {
    expect(normalizeStances(['正方', '反方', '正方', '反方'])).toEqual([
      '正方',
      '反方',
      '正方',
      '反方'
    ])
  })

  it('已正确不变：反正交替', () => {
    expect(normalizeStances(['反方', '正方', '反方', '正方'])).toEqual([
      '反方',
      '正方',
      '反方',
      '正方'
    ])
  })

  it('循环赛（全空字符串）不变', () => {
    expect(normalizeStances(['', '', '', ''])).toEqual(['', '', '', ''])
  })

  it('空数组原样返回', () => {
    expect(normalizeStances([])).toEqual([])
  })

  it('奇数队：最后一位保持不变', () => {
    // 3 队：前两位同侧修正，第三位保持
    expect(normalizeStances(['正方', '正方', '反方'])).toEqual(['正方', '反方', '反方'])
    // 5 队：前两位同侧修正，三四位正确，第五位保持
    expect(normalizeStances(['正方', '正方', '反方', '正方', '反方'])).toEqual([
      '正方',
      '反方',
      '反方',
      '正方',
      '反方'
    ])
  })

  it('不修改输入数组', () => {
    const input = ['正方', '正方', '反方', '反方']
    const snapshot = [...input]
    normalizeStances(input)
    expect(input).toEqual(snapshot)
  })

  it('单个元素原样返回', () => {
    expect(normalizeStances(['正方'])).toEqual(['正方'])
  })

  it('两对都同侧：均修正', () => {
    expect(normalizeStances(['反方', '反方', '反方', '反方'])).toEqual([
      '反方',
      '正方',
      '反方',
      '正方'
    ])
  })
})

describe('normalizeStancePair', () => {
  it('同侧修正：正方正方 → 正方反方', () => {
    expect(normalizeStancePair('正方', '正方')).toEqual(['正方', '反方'])
  })

  it('同侧修正：反方反方 → 反方正方', () => {
    expect(normalizeStancePair('反方', '反方')).toEqual(['反方', '正方'])
  })

  it('已正确不变：正方反方', () => {
    expect(normalizeStancePair('正方', '反方')).toEqual(['正方', '反方'])
  })

  it('已正确不变：反方正方', () => {
    expect(normalizeStancePair('反方', '正方')).toEqual(['反方', '正方'])
  })

  it('null 处理：双 null 不变', () => {
    expect(normalizeStancePair(null, null)).toEqual([null, null])
  })

  it('null 处理：stanceA 为 null 不变', () => {
    expect(normalizeStancePair(null, '正方')).toEqual([null, '正方'])
  })

  it('null 处理：stanceB 为 null 不变', () => {
    expect(normalizeStancePair('正方', null)).toEqual(['正方', null])
  })
})
