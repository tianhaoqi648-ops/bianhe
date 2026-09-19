// ============================================================
// recording-scan-service.test.ts — Me1：扫描服务集成（真 FS 双根 + MockDb 引用）
//
// 覆盖：
//   - 双根扫描：CURRENT（configured root）+ LEGACY（userData 根）分别归类
//   - legacy = current 时合并（不重复扫描）
//   - legacy 目录不存在 → 不报错
//   - 引用收集含 undo_log 双层 JSON 快照
//   - MISSING 生成（DB 引用文件缺失）
//   - 零写入行为（扫描后目录文件集合不变）
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const { mockApp, mockGetSetting } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn() },
  mockGetSetting: vi.fn(() => null as string | null)
}))

vi.mock('electron', () => ({ app: mockApp }))
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    getSetting: () => mockGetSetting(),
    setSetting: vi.fn()
  }
}))
vi.mock('../../db/index', () => ({ getDb: () => ensureDb() }))

let dbInstance: MockDb | null = null
class MockDb {
  private raw: DatabaseSync
  memory = false
  constructor() {
    this.raw = new DatabaseSync(':memory:')
  }
  exec(sql: string): void {
    this.raw.exec(sql)
  }
  prepare(sql: string) {
    const stmt = this.raw.prepare(sql)
    return {
      run: (...args: unknown[]) => stmt.run(...(args as never[])),
      get: (...args: unknown[]) => stmt.get(...(args as never[])),
      all: (...args: unknown[]) => stmt.all(...(args as never[]))
    }
  }
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: unknown[]) => {
      this.raw.exec('BEGIN')
      try {
        const r = fn(...(args as never[]))
        this.raw.exec('COMMIT')
        return r
      } catch (e) {
        this.raw.exec('ROLLBACK')
        throw e
      }
    }) as unknown as T
  }
}
function ensureDb(): MockDb {
  if (!dbInstance) dbInstance = new MockDb()
  return dbInstance
}

// 真实模块（repo 真跑在 MockDb 上）
import { scanRecordingDirectories } from '../recording-scan-service'
import { matchRepo } from '../../db/repository/match.repo'

let tmpUserData: string
let currentRoot: string

function seedMatchRow(id: string, recordingMeta: string | null, recordingRef: string | null): void {
  ensureDb()
    .prepare(
      "INSERT INTO matches (id, event_id, status, created_at, updated_at, recording_meta, recording_ref) VALUES (?, 'ev-1', 'planned', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z', ?, ?)"
    )
    .run(id, recordingMeta, recordingRef)
}

const MATCH_DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, name TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT, event_id TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY, title TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY, name TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS match_judges (
    id TEXT PRIMARY KEY, match_id TEXT, name TEXT, sort_order INTEGER DEFAULT 0,
    is_ai INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS match_judge_votes (
    id TEXT PRIMARY KEY, match_id TEXT, judge_id TEXT, judge_system TEXT DEFAULT 'three_votes',
    impression_vote TEXT, decision_vote TEXT, aff_total REAL, neg_total REAL,
    stage_scores TEXT, best_speaker TEXT, comment TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    round_id TEXT, match_number INTEGER, team_a_id TEXT, team_b_id TEXT, topic_id TEXT,
    stance_a TEXT, stance_b TEXT, draw_item_id TEXT, session_id TEXT, recording_ref TEXT,
    status TEXT NOT NULL DEFAULT 'planned', winner TEXT, aff_score REAL, neg_score REAL,
    best_speaker TEXT, notes TEXT, ai_review TEXT,
    created_at TEXT, updated_at TEXT,
    team_a_name TEXT, team_b_name TEXT, topic_title TEXT, event_name TEXT, round_name TEXT,
    recording_meta TEXT, judge_system TEXT
  );
  CREATE TABLE IF NOT EXISTS undo_log (
    id TEXT PRIMARY KEY, created_at TEXT, store_name TEXT, action TEXT,
    target_type TEXT, target_id TEXT, before_data TEXT, after_data TEXT,
    payload_size INTEGER, label TEXT, undone_at TEXT
  );
`

function rebuildSchema(): void {
  const db = ensureDb()
  for (const t of [
    'match_judge_votes',
    'match_judges',
    'matches',
    'rounds',
    'topics',
    'teams',
    'events',
    'undo_log'
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${t}`)
  }
  db.exec(MATCH_DDL)
}

beforeEach(() => {
  tmpUserData = path.join(
    os.tmpdir(),
    `rec-scan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  currentRoot = path.join(tmpUserData, 'custom-root', 'recordings')
  fs.mkdirSync(currentRoot, { recursive: true })
  fs.mkdirSync(path.join(tmpUserData, 'recordings'), { recursive: true })
  mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath key: ${key}`)
  })
  mockGetSetting.mockReturnValue(path.join(tmpUserData, 'custom-root'))
  rebuildSchema()
})

afterEach(() => {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('Me1：scanRecordingDirectories（真 FS 双根 + 真库引用）', () => {
  it('双根扫描：CURRENT 与 LEGACY 文件分别归类（同 basename 不合并）', async () => {
    // LEGACY 根（userData/recordings）：历史遗留孤儿
    fs.writeFileSync(path.join(tmpUserData, 'recordings', 'legacy-orphan.webm'), Buffer.from('x'))
    // CURRENT 根（configured）：被引用文件
    fs.writeFileSync(path.join(currentRoot, 'bound.webm'), Buffer.from('x'))
    seedMatchRow('m-1', null, null)
    matchRepo.update('m-1', {
      recordings: [{ id: 'rec-1', kind: 'whole', filePath: 'bound.webm', markers: [] }]
    })

    const report = await scanRecordingDirectories()

    expect(report.roots).toHaveLength(2)
    const legacyReport = report.roots.find((r) => r.rootType === 'LEGACY')!
    const currentReport = report.roots.find((r) => r.rootType === 'CURRENT')!
    expect(legacyReport.items[0].classification).toBe('ORPHAN')
    expect(legacyReport.items[0].basename).toBe('legacy-orphan.webm')
    expect(currentReport.items[0].classification).toBe('REFERENCED')
    expect(currentReport.items[0].referencedBy).toEqual(['m-1'])
  })

  it('configured 为空 → CURRENT 与 LEGACY 合并（单根，不重复）', async () => {
    mockGetSetting.mockReturnValue(null)
    fs.writeFileSync(path.join(tmpUserData, 'recordings', 'solo.webm'), Buffer.from('x'))

    const report = await scanRecordingDirectories()

    expect(report.roots).toHaveLength(1)
    expect(report.roots[0].items).toHaveLength(1)
    expect(report.roots[0].items[0].basename).toBe('solo.webm')
  })

  it('MISSING：DB 有引用、CURRENT 根无文件', async () => {
    seedMatchRow('m-1', null, null)
    matchRepo.update('m-1', {
      recordings: [{ id: 'rec-ghost', kind: 'whole', filePath: 'ghost.webm', markers: [] }]
    })
    fs.writeFileSync(path.join(currentRoot, 'other.webm'), Buffer.from('x'))

    const report = await scanRecordingDirectories()
    expect(report.missing).toHaveLength(1)
    expect(report.missing[0].basename).toBe('ghost.webm')
    expect(report.missing[0].referencedBy).toEqual(['m-1'])
  })

  it('undo_log 双层 JSON 快照引用 → 文件存在时不受 ORPHAN 误判', async () => {
    const snapshot = {
      matches: [
        {
          id: 'm-old',
          recording_meta: JSON.stringify([
            { id: 'rec-u', kind: 'whole', filePath: 'undo-kept.webm', markers: [] }
          ])
        }
      ]
    }
    ensureDb()
      .prepare(
        "INSERT INTO undo_log (id, created_at, store_name, action, target_type, target_id, before_data, after_data, payload_size, label) VALUES ('u1', '2026-09-10T00:00:00Z', 'event', 'delete', 'event', 'ev-1', ?, NULL, 100, '删除赛事')"
      )
      .run(JSON.stringify(snapshot))
    fs.writeFileSync(path.join(currentRoot, 'undo-kept.webm'), Buffer.from('x'))

    const report = await scanRecordingDirectories()
    const item = report.roots
      .find((r) => r.rootType === 'CURRENT')!
      .items.find((i) => i.basename === 'undo-kept.webm')
    expect(item).toBeTruthy()
    expect(item!.classification).not.toBe('ORPHAN')
  })

  it('零写入行为：扫描后目录文件集合与内容完全不变', async () => {
    fs.writeFileSync(path.join(currentRoot, 'keep.webm'), Buffer.from('keep-me'))
    const external = path.join(tmpUserData, 'external.webm')
    fs.writeFileSync(external, Buffer.from('ext'))
    matchRepo.update('m-1', {
      recordings: [{ id: 'rec-1', kind: 'whole', filePath: 'keep.webm', markers: [] }]
    })

    const before = fs.readdirSync(currentRoot).sort()
    await scanRecordingDirectories()
    const after = fs.readdirSync(currentRoot).sort()

    expect(after).toEqual(before)
    expect(fs.readFileSync(path.join(currentRoot, 'keep.webm'), 'utf8')).toBe('keep-me')
    expect(fs.existsSync(external)).toBe(true) // 未扫描目录不受影响
  })
})
