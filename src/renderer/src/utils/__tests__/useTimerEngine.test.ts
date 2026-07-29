import { describe, it, expect } from 'vitest'

// resolveInitialSide 已提取到 shared 层，供 main/renderer 共用
import { resolveInitialSide } from '../../../../shared/debate-formats/utils'

describe('resolveInitialSide', () => {
  it('返回 aff 当 stage 为 undefined', () => {
    expect(resolveInitialSide(undefined)).toBe('aff')
  })

  it('返回 stage.side 当非自由辩论环节', () => {
    expect(resolveInitialSide({ side: 'neg', isFreeDebate: false })).toBe('neg')
    expect(resolveInitialSide({ side: 'aff', isFreeDebate: false })).toBe('aff')
    expect(resolveInitialSide({ side: 'both', isFreeDebate: false })).toBe('both')
  })

  it('返回 aff 当自由辩论环节且 side=both（双保险）', () => {
    expect(resolveInitialSide({ side: 'both', isFreeDebate: true })).toBe('aff')
  })

  it('返回 stage.side 当自由辩论环节且 side 非 both', () => {
    expect(resolveInitialSide({ side: 'aff', isFreeDebate: true })).toBe('aff')
    expect(resolveInitialSide({ side: 'neg', isFreeDebate: true })).toBe('neg')
  })
})
