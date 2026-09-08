import { describe, it, expect } from 'vitest'
import { normalizeStances, normalizeStancePair } from '../rules/stance-utils'

describe('core stance-utils: normalizeStances', () => {
  it('相邻同侧 → 第二位翻转；正常保持；循环赛/空数组不变', () => {
    expect(normalizeStances(['正方', '正方', '反方', '反方'])).toEqual(['正方', '反方', '反方', '正方'])
    expect(normalizeStances(['正方', '反方', '正方', '反方'])).toEqual(['正方', '反方', '正方', '反方'])
    expect(normalizeStances(['', '', '', ''])).toEqual(['', '', '', ''])
    expect(normalizeStances([])).toEqual([])
    expect(normalizeStances(['正方'])).toEqual(['正方']) // 奇数最后一位不变
  })
})

describe('core stance-utils: normalizeStancePair', () => {
  it('同侧 → stance_b 翻转；异侧/null 不变', () => {
    expect(normalizeStancePair('正方', '正方')).toEqual(['正方', '反方'])
    expect(normalizeStancePair('反方', '反方')).toEqual(['反方', '正方'])
    expect(normalizeStancePair('正方', '反方')).toEqual(['正方', '反方'])
    expect(normalizeStancePair(null, null)).toEqual([null, null])
  })
})
