// ============================================================
// recording-storage.test.ts — 计时录音相关纯函数测试（T2）
//
// recording-storage.ts 顶层 import 了 electron(u app)，无法在 node 环境的
// vitest 中直接引用；这里测试其使用的共享纯函数（shared/match-recording），
// 等价覆盖 getSegmentMode 的取值逻辑、分段文件名唯一化、mm:ss 格式化。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  resolveSegmentMode,
  RECORDING_SEGMENT_KEY,
  buildMarker,
  buildRecordingBaseName,
  buildRecordingFileName,
  uniqueRecordingFileName,
  formatMarkerTime,
  buildWholeMeta,
  buildSplitMeta,
  boundRecordingsFromMeta,
  metaFromBoundRecordings,
  recordingIdForFile,
  resolveRecordingsDirPlain,
  resolveDataRootPlain
} from '@shared/match-recording'
import type { StageDef } from '@shared/debate-formats/types'
import type { MatchRecordingMeta } from '@shared/types'

const mkStage = (over: Partial<StageDef>): StageDef => ({
  id: 's1',
  name: '立论',
  side: 'aff',
  durationMs: 60000,
  bells: [],
  ...over
})

describe('getSegmentMode 取值逻辑（resolveSegmentMode）', () => {
  it('settings 缺失 → 默认 whole', () => {
    expect(resolveSegmentMode(undefined)).toBe('whole')
  })
  it('settings = "split" → split', () => {
    expect(resolveSegmentMode('split')).toBe('split')
  })
  it('非法值回退 whole', () => {
    expect(resolveSegmentMode('whatever')).toBe('whole')
  })
  it('导出 settings key = recording.segmentMode', () => {
    expect(RECORDING_SEGMENT_KEY).toBe('recording.segmentMode')
  })
})

describe('分段/录音文件名与唯一化', () => {
  it('基础名：match-<id8>-<ts>', () => {
    expect(buildRecordingBaseName('1234567890', 12345)).toBe('match-12345678-12345')
  })
  it('分段：附加 stageId', () => {
    expect(buildRecordingBaseName('1234567890', 12345, 'debate1')).toBe('match-12345678-12345-debate1')
  })
  it('按 mimeType 生成扩展名', () => {
    expect(buildRecordingFileName('1234567890', 1, 'audio/webm')).toBe('match-12345678-1.webm')
  })
  it('无 matchId 时用 untracked 兜底（前 8 位）', () => {
    expect(buildRecordingBaseName(undefined, 1)).toBe('match-untracke-1')
  })
  it('同名冲突 → 唯一化返回不同文件名', () => {
    const got = uniqueRecordingFileName('match-12345678-1.webm', ['match-12345678-1.webm'])
    expect(got).toMatch(/^match-12345678-1-\d+\.webm$/)
    expect(got).not.toBe('match-12345678-1.webm')
  })
  it('无冲突 → 原样返回', () => {
    expect(uniqueRecordingFileName('a.webm', ['b.webm'])).toBe('a.webm')
  })
})

describe('mm:ss 格式化（formatMarkerTime）', () => {
  it('0 → 00:00', () => {
    expect(formatMarkerTime(0)).toBe('00:00')
  })
  it('61s → 01:01', () => {
    expect(formatMarkerTime(61000)).toBe('01:01')
  })
  it('>=1h → h:mm:ss', () => {
    expect(formatMarkerTime(3661000)).toBe('1:01:01')
  })
  it('负数 → 00:00', () => {
    expect(formatMarkerTime(-500)).toBe('00:00')
  })
})

describe('环节标记构造（buildMarker）', () => {
  it('speaker 缺省按 side 兜底（正方）', () => {
    const m = buildMarker(mkStage({ side: 'aff', speaker: undefined }), 123)
    expect(m.speaker).toBe('正方')
    expect(m.stageId).toBe('s1')
    expect(m.tsMs).toBe(123)
  })
  it('speaker 优先', () => {
    expect(buildMarker(mkStage({ side: 'aff', speaker: '正方一辩' }), 0).speaker).toBe('正方一辩')
  })
  it('自由辩论 both → 双方', () => {
    expect(buildMarker(mkStage({ side: 'both' }), 0).speaker).toBe('双方')
  })
})

describe('recording_meta 组装', () => {
  it('whole：路径 + 模式 + 标记', () => {
    const meta = buildWholeMeta('/x/a.webm', [])
    expect(meta).toEqual({ filePath: '/x/a.webm', segmentMode: 'whole', markers: [] })
  })
  it('split：filePath 取首个带分片引用的标记', () => {
    const markers = [
      { tsMs: 0, stageId: 's1', stageName: '立论', side: 'aff' as const, speaker: null, filePath: '/x/s1.webm' },
      { tsMs: 1000, stageId: 's2', stageName: '对辩', side: 'neg' as const, speaker: null }
    ]
    const meta = buildSplitMeta(markers)
    expect(meta.segmentMode).toBe('split')
    expect(meta.filePath).toBe('/x/s1.webm')
  })
})

describe('Task2 多录音转换 / 迁移（旧 MatchRecordingMeta ⇄ BoundRecording[]）', () => {
  it('whole meta → 一份 kind=whole 录音（保留 markers）', () => {
    const meta: MatchRecordingMeta = {
      filePath: '/x/a.webm',
      segmentMode: 'whole',
      markers: [{ tsMs: 0, stageId: 's1', stageName: '立论', side: 'aff', speaker: '正方一辩' }]
    }
    const recs = boundRecordingsFromMeta(meta)
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({ kind: 'whole', filePath: '/x/a.webm' })
    expect(recs[0].markers).toHaveLength(1)
  })

  it('split meta（markers[].filePath）→ 多份 kind=stage 录音', () => {
    const meta: MatchRecordingMeta = {
      filePath: '/x/s1.webm',
      segmentMode: 'split',
      markers: [
        { tsMs: 0, stageId: 's1', stageName: '立论', side: 'aff', speaker: '正方一辩', filePath: '/x/s1.webm' },
        { tsMs: 1000, stageId: 's2', stageName: '对辩', side: 'neg', speaker: '反方一辩', filePath: '/x/s2.webm' }
      ]
    }
    const recs = boundRecordingsFromMeta(meta)
    expect(recs).toHaveLength(2)
    expect(recs[0]).toMatchObject({ kind: 'stage', stageId: 's1', tsMs: 0, filePath: '/x/s1.webm' })
    expect(recs[1]).toMatchObject({ kind: 'stage', stageId: 's2', tsMs: 1000, filePath: '/x/s2.webm' })
    // 无 filePath 的标记不生成分片
    const mixed = metaFromBoundRecordings(recs)
    expect(mixed?.segmentMode).toBe('split')
  })

  it('无 meta → 空数组；空列表 → 无旧 meta', () => {
    expect(boundRecordingsFromMeta(null)).toEqual([])
    expect(boundRecordingsFromMeta(undefined)).toEqual([])
    expect(metaFromBoundRecordings([])).toBeNull()
    expect(metaFromBoundRecordings(null)).toBeNull()
    expect(metaFromBoundRecordings(undefined)).toBeNull()
  })

  it('BoundRecording[]（whole）→ 派生旧 whole meta（round-trip）', () => {
    const src: MatchRecordingMeta = { filePath: '/x/w.webm', segmentMode: 'whole', markers: [] }
    const back = metaFromBoundRecordings(boundRecordingsFromMeta(src))
    expect(back).toEqual(src)
  })

  it('BoundRecording[]（stage）→ 派生旧 split meta，且 round-trip 还原', () => {
    const src: MatchRecordingMeta = {
      filePath: '/x/s1.webm',
      segmentMode: 'split',
      markers: [{ tsMs: 0, stageId: 's1', stageName: '立论', side: 'aff', speaker: null, filePath: '/x/s1.webm' }]
    }
    const back = metaFromBoundRecordings(boundRecordingsFromMeta(src))
    expect(back?.segmentMode).toBe('split')
    expect(back?.markers[0].stageId).toBe('s1')
  })

  it('recordingIdForFile：去扩展名 basename 作稳定 id', () => {
    expect(recordingIdForFile('/x/a.webm')).toBe('a')
    expect(recordingIdForFile('D:\\data\\recordings\\match-abc-1.wav')).toBe('match-abc-1')
  })
})

describe('Task1 录音「数据根」派生（<根>/recordings）与兼容', () => {
  const DEFAULT_ROOT = 'C:/default-userData'
  it('未配置根 → 默认数据根/recordings', () => {
    expect(resolveRecordingsDirPlain(null, DEFAULT_ROOT)).toBe(`${DEFAULT_ROOT}/recordings`)
    expect(resolveRecordingsDirPlain('', DEFAULT_ROOT)).toBe(`${DEFAULT_ROOT}/recordings`)
    expect(resolveDataRootPlain(null, DEFAULT_ROOT)).toBe(DEFAULT_ROOT)
  })
  it('配置数据根 → 派生 <根>/recordings', () => {
    expect(resolveRecordingsDirPlain('D:/data', DEFAULT_ROOT)).toBe('D:/data/recordings')
    expect(resolveRecordingsDirPlain('D:/data/', DEFAULT_ROOT)).toBe('D:/data/recordings')
    expect(resolveDataRootPlain('D:/data', DEFAULT_ROOT)).toBe('D:/data')
  })
  it('根末段已是 recordings（兼容旧绝对录音目录）→ 直接用，避免 recordings/recordings（护栏移除后旧路径不失联）', () => {
    expect(resolveRecordingsDirPlain('D:/data/recordings', DEFAULT_ROOT)).toBe('D:/data/recordings')
    expect(resolveRecordingsDirPlain('D:/data/RECORDINGS', DEFAULT_ROOT)).toBe('D:/data/RECORDINGS')
    expect(resolveDataRootPlain('D:/data/recordings', DEFAULT_ROOT)).toBe('D:/data')
  })
})