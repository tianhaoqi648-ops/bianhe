// ============================================================
// recording-scan-classify.test.ts — Me1：孤儿分类纯函数（T1-T12 全覆盖）
//
// classifyRecordings / collectMatchRecordingReferences /
// collectUndoRecordingReferences 均为纯函数（无 electron/DB/FS 依赖）。
// 各生命周期状态（match delete / event delete / undo / 自由练习 /
// legacy 绝对路径 / 双扩展 / 隐藏文件）通过构造输入数据模拟。
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  classifyRecordings,
  collectMatchRecordingReferences,
  collectUndoRecordingReferences,
  summarizeScanItems,
  type RecordingFileEntry,
  type RecordingScanClassification
} from '../recording-scan'

function file(basename: string, sizeBytes = 1024): RecordingFileEntry {
  return {
    basename,
    path: `/root/recordings/${basename}`,
    extension: basename.includes('.') ? basename.split('.').pop()! : '',
    sizeBytes,
    modifiedAt: '2026-09-10T00:00:00Z'
  }
}

const EMPTY_UNDO = new Map<string, string[]>()

function classNames(items: Array<{ classification: RecordingScanClassification }>): string[] {
  return items.map((i) => i.classification)
}

describe('Me1 分类：引用态（T1/T2）', () => {
  it('T1 REFERENCED：单 match 引用 → REFERENCED + referencedBy', () => {
    const refs = new Map([['a.webm', ['m-1']]])
    const items = classifyRecordings([file('a.webm')], refs, EMPTY_UNDO, 'CURRENT')
    expect(classNames(items)).toEqual(['REFERENCED'])
    expect(items[0].referencedBy).toEqual(['m-1'])
    expect(items[0].reasonCode).toBe('REFERENCED_BY_MATCH')
  })

  it('T2 SHARED：两个 match 引用同一文件 → SHARED + referenceCount=2', () => {
    const refs = new Map([['a.webm', ['m-1', 'm-2']]])
    const items = classifyRecordings([file('a.webm')], refs, EMPTY_UNDO, 'CURRENT')
    expect(classNames(items)).toEqual(['SHARED'])
    expect(items[0].referencedBy).toHaveLength(2)
    expect(items[0].reasonCode).toBe('SHARED_BY_MATCHES')
  })
})

describe('Me1 分类：UNREFERENCED 语义（T3/T5——不与 ORPHAN 混淆）', () => {
  it('T3：自由练习前缀 match-untracke- → UNREFERENCED（FREE_PRACTICE），绝不判 ORPHAN', () => {
    const items = classifyRecordings(
      [file('match-untracke-1789000000000.webm')],
      new Map(),
      EMPTY_UNDO,
      'CURRENT'
    )
    expect(items[0].classification).toBe('UNREFERENCED')
    expect(items[0].reasonCode).toBe('FREE_PRACTICE')
  })

  it('T5：自由练习场景（matchId=null 落盘文件）不判 ORPHAN / 不进 MISSING', () => {
    // matchId=null 时 buildRecordingFileName 产物前缀为 match-untracke-
    const items = classifyRecordings(
      [file('match-untracke-1789000000000.wav')],
      new Map(),
      EMPTY_UNDO,
      'CURRENT'
    )
    expect(items[0].classification).not.toBe('ORPHAN')
    expect(items[0].classification).not.toBe('MISSING')
  })
})

describe('Me1 分类：ORPHAN（T6/T7/T12）', () => {
  it('T6：match 删除后（引用消失）→ ORPHAN（ORPHAN_NO_REFERENCE）', () => {
    // match-<id8>- 前缀（非 untracked）且零引用：曾有 match，现引用已随 CASCADE 消失
    const items = classifyRecordings(
      [file('match-14791eda-1787136941628.webm')],
      new Map(),
      EMPTY_UNDO,
      'CURRENT'
    )
    expect(items[0].classification).toBe('ORPHAN')
    expect(items[0].reasonCode).toBe('ORPHAN_NO_REFERENCE')
    expect(items[0].reasonText).toContain('人工确认')
  })

  it('T7：event 删除后多文件同判 ORPHAN（数量不引发误删——分类器纯函数无副作用）', () => {
    const files = [
      file('match-14791eda-1787136941628.webm'),
      file('match-14791eda-1787192567201.webm'),
      file('match-bb590121-1787132688188.webm')
    ]
    const items = classifyRecordings(files, new Map(), EMPTY_UNDO, 'CURRENT')
    expect(items).toHaveLength(3)
    for (const i of items) {
      expect(i.classification).toBe('ORPHAN')
      expect(i.reasonCode).toBe('ORPHAN_NO_REFERENCE')
    }
  })

  it('T12：orphan.webm（非 match 前缀零引用）→ ORPHAN；分类器无删除副作用', () => {
    const items = classifyRecordings([file('orphan.webm')], new Map(), EMPTY_UNDO, 'CURRENT')
    expect(items[0].classification).toBe('ORPHAN')
    // 纯函数性质：重复调用结果一致，无状态变更
    const again = classifyRecordings([file('orphan.webm')], new Map(), EMPTY_UNDO, 'CURRENT')
    expect(again).toEqual(items)
  })
})

describe('Me1 分类：MISSING / Ghost（T4/T9）', () => {
  it('T4：DB 有引用、文件不存在 → MISSING（GHOST_REFERENCE_FILE_MISSING）', () => {
    const refs = new Map([
      ['a.webm', ['m-1']],
      ['ghost.webm', ['m-1']]
    ])
    const items = classifyRecordings([file('a.webm')], refs, EMPTY_UNDO, 'CURRENT')
    expect(classNames(items)).toEqual(['MISSING', 'REFERENCED'])
    const missing = items.find((i) => i.classification === 'MISSING')!
    expect(missing.basename).toBe('ghost.webm')
    expect(missing.reasonCode).toBe('GHOST_REFERENCE_FILE_MISSING')
  })

  it('T9：legacy 绝对路径经 filenameOf 归一 → REFERENCED', () => {
    const rows = [{ id: 'm-1', recording_meta: null, recording_ref: '/old/root/a.webm' }]
    const refs = collectMatchRecordingReferences(rows)
    expect(refs.get('a.webm')).toEqual(['m-1']) // 归一后按 basename 命中
    const items = classifyRecordings([file('a.webm')], refs, EMPTY_UNDO, 'CURRENT')
    expect(items[0].classification).toBe('REFERENCED')
  })

  it('仅 undo 快照引用且文件缺失 → 不产生 MISSING（undo 窗口预期状态）', () => {
    const undoRefs = new Map<string, string[]>([['undo-only.webm', []]])
    const items = classifyRecordings([file('a.webm')], new Map(), undoRefs, 'CURRENT')
    expect(items.some((i) => i.basename === 'undo-only.webm')).toBe(false)
    expect(items.some((i) => i.classification === 'MISSING')).toBe(false)
  })

  it('collectUndoRecordingReferences：event 聚合快照双层 JSON 提取', () => {
    const snapshot = {
      event: { id: 'ev-1' },
      matches: [
        {
          id: 'm-1',
          recording_meta: JSON.stringify([
            { id: 'rec-1', kind: 'whole', filePath: '/old/recordings/x.webm', markers: [] }
          ]),
          recording_ref: '/old/recordings/y.wav'
        }
      ]
    }
    const rows = [{ before_data: JSON.stringify(snapshot), after_data: null }]
    const refs = collectUndoRecordingReferences(rows)
    expect(refs.has('x.webm')).toBe(true)
    expect(refs.has('y.wav')).toBe(true)
  })

  it('undo 快照引用 → 文件存在时判 REFERENCED（T8 event undo 语义）', () => {
    const snapshot = {
      matches: [
        {
          id: 'm-1',
          recording_meta: JSON.stringify([
            { id: 'rec-1', kind: 'whole', filePath: 'a.webm', markers: [] }
          ])
        }
      ]
    }
    const undoRefs = collectUndoRecordingReferences([
      { before_data: JSON.stringify(snapshot), after_data: null }
    ])
    const items = classifyRecordings([file('a.webm')], new Map(), undoRefs, 'CURRENT')
    // match 引用为 0（match 行已删），但 undo 快照引用该文件 → REFERENCED（undo 保护）
    expect(items[0].classification).toBe('REFERENCED')
    expect(items[0].reasonCode).toBe('REFERENCED_BY_UNDO')
  })
})

describe('Me1 分类：身份与过滤（T10/T11）', () => {
  it('T10：同 stem 双扩展 a.webm + a.wav → 两个独立文件（全名身份，不互相覆盖）', () => {
    const refs = new Map([['a.webm', ['m-1']]]) // 仅 a.webm 被引用
    const items = classifyRecordings(
      [file('a.webm'), file('a.wav')],
      refs,
      EMPTY_UNDO,
      'CURRENT'
    )
    expect(items).toHaveLength(2)
    const webm = items.find((i) => i.basename === 'a.webm')!
    const wav = items.find((i) => i.basename === 'a.wav')!
    expect(webm.classification).toBe('REFERENCED')
    expect(wav.classification).toBe('ORPHAN') // a.wav 零引用，独立判定
  })

  it('T11a：隐藏文件与非白名单扩展 → UNKNOWN（UNSUPPORTED_EXTENSION）', () => {
    const items = classifyRecordings(
      [file('.DS_Store'), file('notes.txt')],
      new Map(),
      EMPTY_UNDO,
      'CURRENT'
    )
    for (const i of items) {
      expect(i.classification).toBe('UNKNOWN')
      expect(i.reasonCode).toBe('UNSUPPORTED_EXTENSION')
    }
  })

  it('T11b：白名单全扩展（wav/webm/m4a/mp3/flac/mp4）均不判 UNKNOWN', () => {
    const exts = ['wav', 'webm', 'm4a', 'mp3', 'flac', 'mp4']
    const files = exts.map((e) => file(`sample-${e}.${e}`))
    const items = classifyRecordings(files, new Map(), EMPTY_UNDO, 'CURRENT')
    for (const i of items) expect(i.classification).toBe('ORPHAN')
  })
})

describe('Me1 排序与汇总', () => {
  it('排序：MISSING → ORPHAN → UNKNOWN → SHARED → REFERENCED → UNREFERENCED', () => {
    const refs = new Map([
      ['ref.webm', ['m-1', 'm-2']],
      ['ok.webm', ['m-3']],
      ['missing.webm', ['m-4']]
    ])
    const files = [
      file('untracke-placeholder.webm'),
      file('orphan.webm'),
      file('weird.txt'),
      file('ref.webm'),
      file('ok.webm')
    ]
    // 自由练习前缀文件
    files[0] = file('match-untracke-1789000000000.webm')
    const items = classifyRecordings(files, refs, EMPTY_UNDO, 'CURRENT')
    expect(classNames(items)).toEqual([
      'MISSING', // missing.webm（引用侧）
      'ORPHAN', // orphan.webm（零引用）
      'UNKNOWN', // weird.txt（非白名单）
      'SHARED', // ref.webm（双引用）
      'REFERENCED', // ok.webm（单引用）
      'UNREFERENCED' // match-untracke-（自由练习）
    ])
  })

  it('summarizeScanItems：分态计数', () => {
    const refs = new Map([
      ['ref.webm', ['m-1', 'm-2']],
      ['ghost.webm', ['m-3']]
    ])
    const items = classifyRecordings(
      [file('ref.webm'), file('orphan.webm'), file('weird.txt')],
      refs,
      EMPTY_UNDO,
      'CURRENT'
    )
    const summary = summarizeScanItems(items)
    expect(summary).toEqual({
      REFERENCED: 0,
      SHARED: 1,
      UNREFERENCED: 0,
      ORPHAN: 1,
      MISSING: 1,
      UNKNOWN: 1
    })
  })
})
