// ============================================================
// matchRecordingKit.test.ts — 多录音缺失态 / 多段归并 / 绑定动作（T3/T4）
// ============================================================

import { describe, it, expect } from 'vitest'
import type { BoundRecording, MatchRecordingMeta } from '../../../../shared/types'
import {
  resolveMatchRecordings,
  withExists,
  availableRecordings,
  missingRecordings,
  hasAvailableRecording,
  allRecordingsMissing,
  markersForRecording,
  assembleSegsFromTracks,
  orderByTs,
  bindAdd,
  bindRemove,
  bindReplace,
  bindSet,
  labelOfRecording,
  type RecordingExistsMap
} from '../../utils/matchRecordingKit'

function whole(id: string, filePath: string, tsMs?: number): BoundRecording {
  return {
    id,
    kind: 'whole',
    filePath,
    markers: tsMs != null ? [{ tsMs, stageId: 'opening', stageName: '开篇立论', side: null, speaker: '正方一辩' }] : []
  }
}

function stage(id: string, filePath: string, stageId: string, tsMs?: number): BoundRecording {
  return {
    id,
    kind: 'stage',
    filePath,
    stageId,
    tsMs
  }
}

describe('resolveMatchRecordings：新 recordings 优先，旧 recordingMeta 兜底', () => {
  it('recordings 数组直接采用', () => {
    const recs = [whole('a', '/p/a.wav')]
    expect(resolveMatchRecordings({ recordings: recs })).toEqual(recs)
  })

  it('recordings 为 null 时回退旧 recordingMeta（whole → 单条 whole）', () => {
    const meta: MatchRecordingMeta = { filePath: '/p/w.wav', segmentMode: 'whole', markers: [{ tsMs: 0, stageId: 'opening', stageName: '开篇', side: null, speaker: null }] }
    const out = resolveMatchRecordings({ recordings: null, recordingMeta: meta })
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('whole')
    expect(out[0].filePath).toBe('/p/w.wav')
  })

  it('recordings 为空数组 → 视为有效（无录音），不回退旧 recordingMeta', () => {
    const meta: MatchRecordingMeta = { filePath: '/p/w.wav', segmentMode: 'whole', markers: [] }
    expect(resolveMatchRecordings({ recordings: [], recordingMeta: meta })).toEqual([])
  })

  it('recordings 为 undefined（缺省）时用旧 recordingMeta split → 多条 stage', () => {
    const meta: MatchRecordingMeta = {
      filePath: '/p/s1.wav',
      segmentMode: 'split',
      markers: [
        { tsMs: 0, filePath: '/p/s1.wav', stageId: 'opening', stageName: '开篇', side: null, speaker: null },
        { tsMs: 1000, filePath: '/p/s2.wav', stageId: 'rebuttal', stageName: '驳论', side: null, speaker: null }
      ]
    }
    const out = resolveMatchRecordings({ recordingMeta: meta })
    expect(out).toHaveLength(2)
    expect(out.every((r) => r.kind === 'stage')).toBe(true)
  })

  it('均无 → 空数组', () => {
    expect(resolveMatchRecordings(null)).toEqual([])
    expect(resolveMatchRecordings({ recordings: null, recordingMeta: null })).toEqual([])
  })
})

describe('缺失态判定（withExists / available / missing / allMissing）', () => {
  const recs = [whole('a', '/p/a.wav'), stage('b', '/p/b.wav', 'rebuttal'), whole('c', '/p/c.wav')]

  it('缺省键视为存在（未校验态）', () => {
    const list = withExists(recs, {})
    expect(list.every((x) => x.exists)).toBe(true)
  })

  it('按 exists map 标注缺失与可用', () => {
    const map: RecordingExistsMap = { a: true, b: false, c: true }
    const list = withExists(recs, map)
    expect(hasAvailableRecording(list)).toBe(true)
    expect(availableRecordings(list).map((x) => x.id)).toEqual(['a', 'c'])
    expect(missingRecordings(list).map((x) => x.id)).toEqual(['b'])
    expect(allRecordingsMissing(list)).toBe(false)
  })

  it('全缺失：有录音但全部 false → allRecordingsMissing 为 true', () => {
    const list = withExists(recs, { a: false, b: false, c: false })
    expect(allRecordingsMissing(list)).toBe(true)
    expect(hasAvailableRecording(list)).toBe(false)
  })

  it('空列表：既非全部缺失也无可用的启发式不误报', () => {
    expect(allRecordingsMissing([])).toBe(false)
    expect(hasAvailableRecording([])).toBe(false)
  })
})

describe('markersForRecording：whole 用 markers，stage 用自身', () => {
  it('whole 的多条 markers 展开为 SttRequest 形态', () => {
    const rec: BoundRecording = {
      id: 'a',
      kind: 'whole',
      filePath: '/p/a.wav',
      markers: [
        { tsMs: 0, stageId: 'op1', stageName: '开篇', side: null, speaker: '正方一辩' },
        { tsMs: 1000, stageId: 'op2', stageName: '驳论', side: null, speaker: null }
      ]
    }
    const m = markersForRecording(rec)
    expect(m).toEqual([
      { stage: '开篇', speaker: '正方一辩', atMs: 0 },
      { stage: '驳论', speaker: undefined, atMs: 1000 }
    ])
  })

  it('无 markers → undefined', () => {
    expect(markersForRecording(whole('a', '/p/a.wav'))).toBeUndefined()
  })
})

describe('assembleSegsFromTracks：多段归并组装（缺失占位不阻塞其余）', () => {
  it('可用份展平 segs，缺失份插入 missing 占位，保持顺序', () => {
    const recA = whole('a', '/p/a.wav')
    const recB = whole('b', '/p/b.wav')
    const out = assembleSegsFromTracks([
      { recording: recA, segs: [{ stage: '开篇', speaker: '正方', text: 'A文本' }] },
      { recording: recB, missing: true }
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ sourceId: 'a', content: 'A文本' })
    expect(out[1]).toMatchObject({ sourceId: 'b', missing: true, content: '' })
  })

  it('可用份无 segs（空）→ 跳过不产生片段', () => {
    const out = assembleSegsFromTracks([{ recording: whole('a', '/p/a.wav'), segs: [] }])
    expect(out).toEqual([])
  })

  it('stage 份：segs 的 stage 优先，缺省回退 recording.stageId', () => {
    const rec = stage('s1', '/p/s1.wav', 'rebuttal')
    const out = assembleSegsFromTracks([
      { recording: rec, segs: [{ text: '只有文本' }] },
      { recording: stage('s2', '/p/s2.wav', 'opening'), segs: [{ stage: '开篇', text: '带stage' }] }
    ])
    expect(out[0].stage).toBe('rebuttal')
    expect(out[0].stageName).toBe('rebuttal')
    expect(out[1].stage).toBe('开篇')
  })
})

describe('orderByTs：按参考时间归并，无时序稳定靠后', () => {
  it('stage 用 tsMs，whole 用首条 marker 的 tsMs', () => {
    const late = whole('late', '/p/late.wav', 5000)
    const early = stage('early', '/p/early.wav', 'opening', 100)
    const noTs = whole('no', '/p/no.wav')
    const ordered = orderByTs(withExists([late, noTs, early], {})).map((x) => x.id)
    expect(ordered).toEqual(['early', 'late', 'no'])
  })
})

describe('labelOfRecording 与 绑定动作构造', () => {
  it('label 区分整场/环节并仅含文件名', () => {
    expect(labelOfRecording(whole('a', '/p/x/a.wav'))).toBe('整场 · a.wav')
    expect(labelOfRecording(stage('b', '/p/x/b.flac', 'opening'))).toBe('环节 · b.flac')
  })

  it('bindAdd / bindRemove / bindReplace / bindSet 构造合法动作', () => {
    const rec = whole('a', '/p/a.wav')
    expect(bindAdd('m', rec)).toEqual({ kind: 'add', matchId: 'm', recording: rec })
    expect(bindRemove('m', 'a')).toEqual({ kind: 'remove', matchId: 'm', id: 'a' })
    expect(bindReplace('m', 'a', rec)).toEqual({ kind: 'replace', matchId: 'm', id: 'a', recording: rec })
    expect(bindSet('m', [rec])).toEqual({ kind: 'set', matchId: 'm', recordings: [rec] })
    expect(bindSet('m', null)).toEqual({ kind: 'set', matchId: 'm', recordings: null })
  })
})