// ============================================================
// config-validator.test.ts — 轻量 JSON 结构校验器单测（governance Task 12.3）
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  validateBankConfig,
  validateBoundRecordings,
  validateMatchRecordingMeta,
  validateRecordingMeta,
  validateTopicCustomData,
  validateUndoPayload,
  validateUndoSnapshot,
  validateBackupPackage
} from '../config-validator'

// ---------- events.bank_config ----------

describe('validateBankConfig', () => {
  it('非法 mode → 拒绝并报错', () => {
    const r = validateBankConfig({ mode: 'random', priorityOrder: ['g1'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('bank_config.mode')
  })

  it.each(['single', 'union', 'priority', 'by_round'])(
    '合法 mode %s → 通过',
    (m) => {
      const r = validateBankConfig({ mode: m })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.mode).toBe(m)
    }
  )

  it('priorityOrder 非 string[] → 拒绝', () => {
    const r = validateBankConfig({ mode: 'priority', priorityOrder: [1, 2] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('priorityOrder')
  })

  it('priorityOrder 为 string[] → 通过', () => {
    const r = validateBankConfig({ mode: 'priority', priorityOrder: ['g1', 'g2'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.priorityOrder).toEqual(['g1', 'g2'])
  })

  it('roundBanks 非对象 → 拒绝', () => {
    expect(validateBankConfig({ mode: 'by_round', roundBanks: 'x' }).ok).toBe(false)
  })

  it('roundBanks 值类型错（非 string[]）→ 拒绝', () => {
    const r = validateBankConfig({ mode: 'by_round', roundBanks: { r1: 'g1', r2: [1] } })
    expect(r.ok).toBe(false)
  })

  it('roundBanks 为 Record<string, string[]> → 通过', () => {
    const r = validateBankConfig({ mode: 'by_round', roundBanks: { r1: ['g1'], r2: ['g2', 'g1'] } })
    expect(r.ok).toBe(true)
  })

  it('缺失（旧/无配置）→ 兼容默认 single', () => {
    for (const input of [undefined, null, {} as unknown]) {
      const r = validateBankConfig(input)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value).toEqual({ mode: 'single' })
    }
  })

  it('非对象 → 拒绝', () => {
    expect(validateBankConfig('single').ok).toBe(false)
    expect(validateBankConfig(['single']).ok).toBe(false)
  })
})

// ---------- recording_meta / BoundRecording ----------

describe('validateBoundRecordings', () => {
  it('合法 BoundRecording[] → 通过', () => {
    const r = validateBoundRecordings([
      { id: 'r1', kind: 'whole', filePath: '/a.wav' },
      { id: 'r2', kind: 'stage', filePath: '/b.wav', stageId: 's1', tsMs: 100 }
    ])
    expect(r.ok).toBe(true)
  })

  it('缺省（无录音）→ 兼容空数组', () => {
    expect(validateBoundRecordings(null).ok).toBe(true)
    expect(validateBoundRecordings(undefined).ok).toBe(true)
  })

  it('缺少 id → 拒绝', () => {
    const r = validateBoundRecordings([{ kind: 'whole', filePath: '/a.wav' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('id')
  })

  it('非法 kind → 拒绝', () => {
    const r = validateBoundRecordings([{ id: 'r1', kind: 'full', filePath: '/a.wav' }])
    expect(r.ok).toBe(false)
  })

  it('filePath 非 string → 拒绝', () => {
    const r = validateBoundRecordings([{ id: 'r1', kind: 'whole', filePath: 123 }])
    expect(r.ok).toBe(false)
  })

  it('非数组 → 拒绝', () => {
    expect(validateBoundRecordings({}).ok).toBe(false)
  })
})

describe('validateMatchRecordingMeta', () => {
  it('合法旧结构 → 通过', () => {
    expect(validateMatchRecordingMeta({ filePath: '/a.wav', segmentMode: 'whole', markers: [] }).ok).toBe(true)
  })
  it('非法 segmentMode → 拒绝', () => {
    expect(validateMatchRecordingMeta({ filePath: '/a.wav', segmentMode: 'mixed' }).ok).toBe(false)
  })
})

describe('validateRecordingMeta', () => {
  it('兼容数组与旧对象两种形态', () => {
    expect(validateRecordingMeta([{ id: 'r1', kind: 'whole', filePath: '/a' }]).ok).toBe(true)
    expect(validateRecordingMeta({ filePath: '/a', segmentMode: 'whole' }).ok).toBe(true)
    expect(validateRecordingMeta(null).ok).toBe(true)
  })
  it('都不是 → 拒绝', () => {
    expect(validateRecordingMeta('boom').ok).toBe(false)
    expect(validateRecordingMeta(42).ok).toBe(false)
  })
})

// ---------- topic custom_data ----------

describe('validateTopicCustomData', () => {
  it('合法 string / string[] → 通过', () => {
    const r = validateTopicCustomData({ a: 'x', b: ['y', 'z'] })
    expect(r.ok).toBe(true)
  })
  it('值类型错（number）→ 拒绝', () => {
    const r = validateTopicCustomData({ a: 42 })
    expect(r.ok).toBe(false)
  })
  it('数组内非 string → 拒绝', () => {
    const r = validateTopicCustomData({ b: ['ok', 42] })
    expect(r.ok).toBe(false)
  })
  it('缺省 → 兼容空对象', () => {
    expect(validateTopicCustomData(null).ok).toBe(true)
    expect(validateTopicCustomData(undefined).ok).toBe(true)
  })
  it('非对象 → 拒绝', () => {
    expect(validateTopicCustomData('x').ok).toBe(false)
  })
})

// ---------- undo payload ----------

describe('validateUndoPayload', () => {
  it('null/对象快照 → 通过', () => {
    expect(validateUndoPayload({ storeName: 'topic', before: null, after: { id: 't1' } }).ok).toBe(true)
  })
  it('原始类型快照 → 拒绝', () => {
    expect(validateUndoPayload({ storeName: 'topic', before: 42, after: null }).ok).toBe(false)
  })
  it('topicGroup setBankConfig 内嵌 config 非法 → 拒绝', () => {
    const r = validateUndoPayload({
      storeName: 'topicGroup',
      before: { id: 'e1', config: { mode: 'bad' } },
      after: { id: 'e1', config: { mode: 'single' } }
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('config')
  })
  it('topicGroup setBankConfig 内嵌 config 合法 → 通过', () => {
    expect(
      validateUndoPayload({
        storeName: 'topicGroup',
        before: { id: 'e1', config: { mode: 'single' } },
        after: { id: 'e1', config: { mode: 'by_round', roundBanks: { r1: ['g1'] } } }
      }).ok
    ).toBe(true)
  })
  it('validateUndoSnapshot 原始类型 → 拒绝', () => {
    expect(validateUndoSnapshot('x').ok).toBe(false)
    expect(validateUndoSnapshot(true).ok).toBe(false)
  })
})

// ---------- backup package ----------

describe('validateBackupPackage', () => {
  const valid = {
    version: '1.0',
    exportedAt: '2026-08-24T00:00:00.000Z',
    appVersion: '1.0.0',
    categories: ['topics', 'events'],
    tables: { topics: [{ id: 't1' }] }
  }
  it('合法包 → 通过', () => {
    expect(validateBackupPackage(valid).ok).toBe(true)
  })
  it('版本缺失/类型错 → 拒绝', () => {
    expect(validateBackupPackage({ ...valid, version: undefined }).ok).toBe(false)
    expect(validateBackupPackage({ ...valid, version: 1 }).ok).toBe(false)
  })
  it('categories 非 string[] → 拒绝', () => {
    expect(validateBackupPackage({ ...valid, categories: 'topics' }).ok).toBe(false)
    expect(validateBackupPackage({ ...valid, categories: ['topics', 1] }).ok).toBe(false)
  })
  it('tables 非对象 → 拒绝', () => {
    expect(validateBackupPackage({ ...valid, tables: [] }).ok).toBe(false)
  })
  it('非对象 → 拒绝', () => {
    expect(validateBackupPackage('{}').ok).toBe(false)
  })
})