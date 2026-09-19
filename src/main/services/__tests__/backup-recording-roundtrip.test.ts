// ============================================================
// backup-recording-roundtrip.test.ts — Me3-fix T1-T5：
// Recording metadata / ref 经 backup export → JSON → import 的往返保持测试
//
// 目的：锁住 M3（meta 存 basename）与 legacy 兼容（旧绝对路径读取端归一）
// 在 backup/import 链路上的现状——防止未来 backup 改动破坏 Recording 元数据。
//
// 复用 backup-service.test.ts 的 mock 编排（repos/utils/getDb 全 mock，
// 断言 bulkInsert 捕获参数 = JSON 往返后的行）；另用 vi.importActual 取
// 真实 bulkInsert + TABLE_COLUMNS，在 node:sqlite 上验证真实 INSERT
// 保留 recording_meta / recording_ref 列。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { DatabaseSync } from 'node:sqlite'

// ---- hoisted 状态（vi.mock 工厂与测试体共享）----
const h = vi.hoisted(() => ({
  capturedSqls: [] as string[],
  mockBulkInsert: vi.fn(),
  mockClearTable: vi.fn(),
  mockExec: vi.fn(),
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn(),
  mockPragma: vi.fn(),
  mockApp: { getPath: vi.fn() }
}))

// ---- mock repos（仅 backup 编排触达的模块）----
vi.mock('../../db/repository/match.repo', () => ({
  matchRepo: {
    findAllForBackup: vi.fn<() => {
      matches: Array<Record<string, unknown>>
      match_judges: Array<Record<string, unknown>>
      match_judge_votes: Array<Record<string, unknown>>
    }>(() => ({ matches: [], match_judges: [], match_judge_votes: [] }))
  }
}))
vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: {
    findAllForBackup: vi.fn(() => []),
    findAllCustomFieldsForBackup: vi.fn(() => []),
    bulkRestoreTopics: vi.fn(),
    bulkRestoreCustomFields: vi.fn()
  }
}))
vi.mock('../../db/repository/event.repo', () => ({
  eventRepo: { findAllForBackup: vi.fn() }
}))
vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: { findAllForBackup: vi.fn() }
}))
vi.mock('../../db/repository/format.repo', () => ({
  formatRepo: { findAllForBackup: vi.fn() }
}))
vi.mock('../../db/repository/bell-asset.repo', () => ({
  bellAssetRepo: {
    findAllForBackup: vi.fn(() => []),
    encodeBellFiles: vi.fn(() => ({})),
    decodeBellFiles: vi.fn(() => 0)
  }
}))
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    findAllForBackup: vi.fn(() => []),
    getSetting: vi.fn(() => null), // recording.dir 未配置 → recordingsDir = userData/recordings
    setSetting: vi.fn()
  }
}))
vi.mock('../../db/repository/timer-session.repo', () => ({
  timerSessionRepo: { findAllForBackup: vi.fn() }
}))
vi.mock('../../db/repository/import-batch.repo', () => ({
  importBatchRepo: { findAllForBackup: vi.fn() }
}))
vi.mock('../../db/repository/judge-history.repo', () => ({
  judgeHistoryRepo: { findAllForBackup: vi.fn() }
}))
vi.mock('../../db/repository/agent-session.repo', () => ({
  agentSessionRepo: {
    findAllForBackup: vi.fn(() => ({ agent_sessions: [], agent_messages: [] }))
  }
}))
vi.mock('../../db/repository/topic-group.repo', () => ({
  topicGroupRepo: {
    findAllForBackup: vi.fn(() => ({
      topic_groups: [],
      topic_group_items: [],
      event_topic_groups: [],
      round_topic_groups: []
    }))
  }
}))
vi.mock('../../services/badge-storage', () => ({
  findForBackup: vi.fn(() => ({ registry: [], bindings: {}, fileNames: [] })),
  encodeBadgeFiles: vi.fn(() => ({})),
  restoreBackup: vi.fn(() => 0)
}))

// ---- mock utils（捕获 bulkInsert/clearTable 参数）----
vi.mock('../../db/repository/utils', () => ({
  bulkInsert: h.mockBulkInsert,
  clearTable: h.mockClearTable,
  // importBackup 的表级守卫需要白名单条目（真实白名单由 importActual 用例锁定）
  TABLE_COLUMNS: {
    matches: ['id', 'recording_meta', 'recording_ref'],
    match_judges: ['id', 'match_id'],
    match_judge_votes: ['id', 'match_id']
  } as Record<string, string[]>
}))

// ---- mock getDb ----
vi.mock('../../db/index', () => ({
  getDb: vi.fn(() => ({
    transaction: h.mockTransaction,
    prepare: h.mockPrepare,
    exec: h.mockExec,
    pragma: h.mockPragma
  }))
}))

// ---- electron mock（readRecordingFile 解析 recordingsDir 用）----
vi.mock('electron', () => ({ app: h.mockApp }))

// ---- mock 之后 import ----
import { exportBackup, importBackup } from '../backup-service'
import { matchRepo } from '../../db/repository/match.repo'
import { readRecordingFile, recordingsDir } from '../recording-storage'
import { filenameOf } from '../../../shared/match-recording'
import { collectMatchRecordingReferences } from '../../../shared/recording-scan'
import { SUPPORTED_BACKUP_VERSION } from '../../../shared/constants'

const isWin = process.platform === 'win32'

let tmpUserData = ''
let tmpJson: string | null = null

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    event_id: 'ev-1',
    round_id: 'round-1',
    match_number: 1,
    status: 'resulted',
    judge_system: 'three_votes',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    recording_meta: null,
    recording_ref: null,
    ...overrides
  }
}

function writeTempJson(data: unknown): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `backup-rec-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  )
  fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf-8')
  return tmpFile
}

function lastMatchesRows(): Array<Record<string, unknown>> {
  const call = h.mockBulkInsert.mock.calls.filter(([t]) => t === 'matches').at(-1) as
    | [string, Array<Record<string, unknown>>, string]
    | undefined
  expect(call, 'bulkInsert 应收到 matches 表调用').toBeTruthy()
  return call![1]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.capturedSqls.length = 0
  h.mockTransaction.mockImplementation((fn: () => unknown) => () => fn())
  h.mockPrepare.mockImplementation(() => ({
    run: () => ({ changes: 1 }),
    all: () => [],
    get: () => undefined
  }))
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-rt-'))
  h.mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath: ${key}`)
  })
})

afterEach(() => {
  if (tmpJson) {
    try {
      fs.unlinkSync(tmpJson)
    } catch {
      /* ignore */
    }
    tmpJson = null
  }
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

/** 通用编排：seed matches → export(match_records) → JSON 文件 → import(clear_rebuild) */
function roundtrip(matchRow: Record<string, unknown>): void {
  vi.mocked(matchRepo.findAllForBackup).mockReturnValue({
    matches: [matchRow],
    match_judges: [],
    match_judge_votes: []
  })
  const pkg = exportBackup({ categories: ['match_records'] })
  expect(pkg.version).toBe(SUPPORTED_BACKUP_VERSION)
  tmpJson = writeTempJson(pkg)
  h.mockBulkInsert.mockReturnValue(1)
  importBackup({ filePath: tmpJson, strategy: 'clear_rebuild', categories: ['match_records'] })
}

describe('Me3-fix T1-T5：Recording metadata/ref backup→import 往返', () => {
  it('T1：新 basename meta 往返原样保留，且读取端可命中当前 recordings 根', async () => {
    roundtrip(
      makeRow({
        recording_meta: JSON.stringify([
          { id: 'rec-1', kind: 'whole', filePath: 'a.webm', markers: [] }
        ])
      })
    )
    const rows = lastMatchesRows()
    // JSON 往返后仍为 basename，未被改写成绝对路径
    expect(rows[0].recording_meta).toBe(
      JSON.stringify([{ id: 'rec-1', kind: 'whole', filePath: 'a.webm', markers: [] }])
    )
    // 读取端：写入当前 recordings 根后可命中
    const dir = await recordingsDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.webm'), Buffer.from('audio-a'))
    expect(filenameOf('a.webm')).toBe('a.webm')
    const buf = await readRecordingFile('a.webm')
    expect(buf!.toString('utf8')).toBe('audio-a')
  })

  it('T2：legacy 绝对路径往返原样保留，读取端归一且不绕过当前 root', async () => {
    roundtrip(
      makeRow({
        recording_meta: JSON.stringify([
          { id: 'rec-1', kind: 'whole', filePath: '/old/root/recordings/b.webm', markers: [] }
        ]),
        recording_ref: 'C:\\OldRoot\\recordings\\b.webm'
      })
    )
    const rows = lastMatchesRows()
    // 包内原样保留（零转换——迁移留给读取端）
    expect(rows[0].recording_meta).toContain('/old/root/recordings/b.webm')
    expect(rows[0].recording_ref).toBe('C:\\OldRoot\\recordings\\b.webm')
    // 读取端归一：POSIX 路径在两平台都提取 basename
    expect(filenameOf('/old/root/recordings/b.webm')).toBe('b.webm')
    const dir = await recordingsDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'b.webm'), Buffer.from('audio-b'))
    // meta 侧：basename 归一后命中当前根（不读旧绝对路径）
    expect((await readRecordingFile('/old/root/recordings/b.webm'))!.toString('utf8')).toBe('audio-b')
    // ref 侧（Windows 路径）平台感知：
    if (isWin) {
      expect(filenameOf('C:\\OldRoot\\recordings\\b.webm')).toBe('b.webm')
      expect((await readRecordingFile('C:\\OldRoot\\recordings\\b.webm'))!.toString('utf8')).toBe('audio-b')
    } else {
      // POSIX：反斜杠非分隔符 → 保留为字面文件名（锁定语义，不逃逸，文件不存在 → null）
      expect(filenameOf('C:\\OldRoot\\recordings\\b.webm')).toBe('C:\\OldRoot\\recordings\\b.webm')
      expect(await readRecordingFile('C:\\OldRoot\\recordings\\b.webm')).toBeNull()
    }
    // 当前根不存在该文件名变体时不产生任意路径读取
    expect(await readRecordingFile('/old/root/recordings/other.webm')).toBeNull()
  })

  it('T3：损坏 recording_meta 六形态——export/import 不崩，其他数据照常，读取端不产生任意路径', () => {
    const corrupts = [
      '{"id":"x", filePath', // malformed JSON
      JSON.stringify({ notAnArray: true }), // 对象（非 BoundRecording[]）
      JSON.stringify([{ id: 'r1', kind: 'whole', markers: [] }]), // 缺 filePath
      JSON.stringify({}), // 空对象
      JSON.stringify('just-a-string'), // 字符串（非对象/数组）
      null // null meta
    ]
    for (const meta of corrupts) {
      h.mockBulkInsert.mockClear()
      roundtrip(makeRow({ recording_meta: meta, id: `m-${String(meta).slice(0, 6)}` }))
      // import 编排不因损坏 meta 抛错，行原样透传
      const rows = lastMatchesRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].recording_meta).toBe(meta)
      // 引用收集侧：坏行安全跳过，不抛错、不产生路径
      expect(() => collectMatchRecordingReferences([rows[0]])).not.toThrow()
      const refs = collectMatchRecordingReferences([rows[0]])
      for (const basename of refs.keys()) {
        expect(basename).not.toMatch(/[/\\]/) // 引用键必须是纯 basename
        expect(path.isAbsolute(basename)).toBe(false)
      }
    }
  })

  it('T4：recording_ref 往返（basename 与旧绝对路径两形态）', () => {
    roundtrip(
      makeRow({
        id: 'm-ref-base',
        recording_meta: null,
        recording_ref: 'ref-base.webm'
      })
    )
    expect(lastMatchesRows()[0].recording_ref).toBe('ref-base.webm')

    h.mockBulkInsert.mockClear()
    roundtrip(
      makeRow({
        id: 'm-ref-abs',
        recording_meta: null,
        recording_ref: 'D:\\Old\\recordings\\ref-abs.webm'
      })
    )
    expect(lastMatchesRows()[0].recording_ref).toBe('D:\\Old\\recordings\\ref-abs.webm')
    // 归一语义平台感知：Windows 上提取 basename；POSIX 保留字面名（不逃逸）
    if (isWin) {
      expect(filenameOf('D:\\Old\\recordings\\ref-abs.webm')).toBe('ref-abs.webm')
    } else {
      expect(filenameOf('D:\\Old\\recordings\\ref-abs.webm')).toBe('D:\\Old\\recordings\\ref-abs.webm')
    }
  })

  it('T5：meta + ref 同时存在——两者独立原样往返（source of truth = recording_meta）', () => {
    const meta = JSON.stringify([
      { id: 'rec-1', kind: 'whole', filePath: 'c.webm', markers: [{ at: 1000, label: 'x' }] }
    ])
    roundtrip(makeRow({ recording_meta: meta, recording_ref: 'legacy-c.webm' }))
    const rows = lastMatchesRows()
    expect(rows[0].recording_meta).toBe(meta)
    expect(rows[0].recording_ref).toBe('legacy-c.webm')
    // 引用收集：两列都归入引用集合（同一 match 去重）
    const refs = collectMatchRecordingReferences([rows[0]])
    expect(refs.get('c.webm')).toEqual(['m1'])
    expect(refs.get('legacy-c.webm')).toEqual(['m1'])
  })

  it('补充：真实 bulkInsert + TABLE_COLUMNS 白名单保留 recording_meta/recording_ref 列（node:sqlite）', async () => {
    const utilsActual = await vi.importActual<typeof import('../../db/repository/utils')>(
      '../../db/repository/utils'
    )
    // 白名单锁定：两列必须存在于 matches 允许列（防未来误删）
    expect(utilsActual.TABLE_COLUMNS.matches).toContain('recording_meta')
    expect(utilsActual.TABLE_COLUMNS.matches).toContain('recording_ref')
    // 真实 bulkInsert 在 node:sqlite 上：INSERT 语句含两列且值原样
    const db = new DatabaseSync(':memory:')
    db.exec(
      'CREATE TABLE matches (id TEXT PRIMARY KEY, recording_meta TEXT, recording_ref TEXT, status TEXT)'
    )
    const realPrepare = db.prepare.bind(db)
    h.mockPrepare.mockImplementation((sql: string) => {
      h.capturedSqls.push(sql)
      const stmt = realPrepare(sql)
      return {
        run: (...args: unknown[]) => stmt.run(...(args as never[])),
        all: () => stmt.all() as never[],
        get: () => stmt.get() as never
      }
    })
    h.mockPragma.mockImplementation(() => {
      db.exec('PRAGMA foreign_keys = OFF')
      return []
    })
    const meta = JSON.stringify([{ id: 'r', kind: 'whole', filePath: 'a.webm', markers: [] }])
    utilsActual.bulkInsert(
      'matches',
      [{ id: 'm1', recording_meta: meta, recording_ref: 'C:\\x\\a.webm', status: 'resulted' }],
      'clear_rebuild'
    )
    const inserted = db.prepare('SELECT recording_meta, recording_ref FROM matches').get() as {
      recording_meta: string
      recording_ref: string
    }
    expect(inserted.recording_meta).toBe(meta)
    expect(inserted.recording_ref).toBe('C:\\x\\a.webm')
    // 真库读回后仍可被引用收集器解析
    expect(
      collectMatchRecordingReferences([inserted as unknown as Record<string, unknown>]).has('a.webm')
    ).toBe(true)
  })
})
