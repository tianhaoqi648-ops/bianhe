import { describe, it, expect } from 'vitest'
import { buildTimeoutSpeech } from '../timeout-tts'

describe('buildTimeoutSpeech: 超时语音文案', () => {
  it('正方环节播报"正方时间到"', () => {
    expect(buildTimeoutSpeech('aff', undefined)).toBe('正方时间到')
    expect(buildTimeoutSpeech('aff', null)).toBe('正方时间到')
  })

  it('反方环节播报"反方时间到"', () => {
    expect(buildTimeoutSpeech('neg', undefined)).toBe('反方时间到')
  })

  it('双人/中立环节（both）播报"时间到"', () => {
    expect(buildTimeoutSpeech('both', undefined)).toBe('时间到')
    expect(buildTimeoutSpeech('both', 'both')).toBe('时间到')
  })

  it('自由辩论用实时 currentSide 覆盖环节 side', () => {
    // 自由辩论环节 side=both，但当前发言方为正方 → 正方时间到
    expect(buildTimeoutSpeech('both', 'aff')).toBe('正方时间到')
    expect(buildTimeoutSpeech('both', 'neg')).toBe('反方时间到')
  })

  it('累进正方侧（og/cg）与反方侧（oo/co）识别', () => {
    expect(buildTimeoutSpeech('og', undefined)).toBe('正方时间到')
    expect(buildTimeoutSpeech('cg', undefined)).toBe('正方时间到')
    expect(buildTimeoutSpeech('oo', undefined)).toBe('反方时间到')
    expect(buildTimeoutSpeech('co', undefined)).toBe('反方时间到')
  })

  it('无环节信息时播报"时间到"', () => {
    expect(buildTimeoutSpeech(undefined, undefined)).toBe('时间到')
    expect(buildTimeoutSpeech(null, null)).toBe('时间到')
  })
})