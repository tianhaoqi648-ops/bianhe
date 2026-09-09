// ============================================================
// recording-meta-basename.test.ts — M3：recording_meta 写入端 basename 归一
//
// 真实 SQLite（node:sqlite）+ 真实 FS：
//   T3：matchRepo.update 写绝对路径 → DB 中 recording_meta 为 basename；
//       readRecordingFile 按 basename 命中；旧绝对路径数据读取归一兼容
//   T5：切换 recording.dir 根目录 → basename 元数据跟随新根；
//       新根无文件 → read null（不回读旧根绝对路径）
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { MatchRecordingMeta } from '../../../../shared/types'

// ---- 可变 settings mock（T5 切根用） ----
const { mockApp, mockGetSetting } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn() },
  mockGetSetting: vi.fn(() => null as string | null)
}))

vi.mock('electron', () => ({ app: mockApp }))
vi.mock('../audit.repo', () => ({
  auditRepo: {
    getSetting: () => mockGetSetting(),
    setSetting: vi.fn()
  }
}))
vi.mock('../../index', () => ({ getDb: () => ensureDb() }))

let tmpUserData: string

function setupTempRoot(): string {
  const dir = path.join(
    os.tmpdir(),
    `rec-meta-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  fs.mkdirSync(path.join(dir, 'recordings'), { recursive: true })
  return dir
}

beforeEach(() => {
  tmpUserData = setupTempRoot()
  mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath key: ${key}`)
  })
  mockGetSetting.mockReturnValue(null)
  rebuildSchema()
})

afterEach(() => {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

// ---- node:sqlite → better-sqlite3 兼容薄适配 ----
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

let mockDbInstance: MockDb | null = null
function ensureDb(): MockDb {
  if (!mockDbInstance) mockDbInstance = new MockDb()
  return mockDbInstance
}

// ---- DDL（matches 全列 + SELECT JOIN 依赖的最小表） ----
const DDL = `
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
  CREATE TABLE IF NOT EXISTS match_judges (
    id TEXT PRIMARY KEY, match_id TEXT, name TEXT, sort_order INTEGER DEFAULT 0,
    is_ai INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS match_judge_votes (
    id TEXT PRIMARY KEY, match_id TEXT, judge_id TEXT, judge_system TEXT DEFAULT 'three_votes',
    impression_vote TEXT, decision_vote TEXT, aff_total REAL, neg_total REAL,
    stage_scores TEXT, best_speaker TEXT, comment TEXT, created_at TEXT, updated_at TEXT
  );
`

function rebuildSchema(): void {
  const db = ensureDb()
  for (const t of ['match_judge_votes', 'match_judges', 'matches', 'rounds', 'topics', 'teams', 'events']) {
    db.exec(`DROP TABLE IF EXISTS ${t}`)
  }
  db.exec(DDL)
  db.prepare(
    "INSERT INTO events (id, name, created_at) VALUES ('ev-1', '测试赛事', '2026-09-10T00:00:00Z')"
  ).run()
  db.prepare(
    "INSERT INTO matches (id, event_id, status, created_at, updated_at) VALUES ('m-1', 'ev-1', 'planned', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')"
  ).run()
}

// 真实模块（mock 之后导入）
import { matchRepo } from '../match.repo'
import { readRecordingFile } from '../../../services/recording-storage'

function readMeta(): { recordings: Array<{ filePath: string }> } | null {
  const row = ensureDb()
    .prepare('SELECT recording_meta FROM matches WHERE id = ?')
    .get('m-1') as { recording_meta: string | null }
  if (!row.recording_meta) return null
  const parsed = JSON.parse(row.recording_meta)
  return Array.isArray(parsed) ? { recordings: parsed } : null
}

describe('M3：recording_meta 写入端 basename 归一（真实 SQLite + 真 FS）', () => {
  it('T3-写：update 传绝对路径 → DB 存 basename → readRecordingFile(basename) 命中', async () => {
    const absPath = path.join(tmpUserData, 'recordings', 'a.webm')
    fs.writeFileSync(absPath, Buffer.from('audio-a'))

    const meta: MatchRecordingMeta = {
      filePath: absPath,
      segmentMode: 'whole',
      markers: []
    }
    matchRepo.update('m-1', { recordingMeta: meta, recordingRef: absPath })

    // DB 中 filePath 已归一为 basename；recording_ref 同口径
    const stored = readMeta()
    expect(stored).not.toBeNull()
    expect(stored!.recordings[0].filePath).toBe('a.webm')
    const ref = ensureDb()
      .prepare('SELECT recording_ref FROM matches WHERE id = ?')
      .get('m-1') as { recording_ref: string | null }
    expect(ref.recording_ref).toBe('a.webm')

    // 读取端按 basename 命中真实文件
    const buf = await readRecordingFile('a.webm')
    expect(buf).not.toBeNull()
    expect(buf!.toString('utf8')).toBe('audio-a')
  })

  it('T3-兼容：DB 中人为放旧绝对路径 → 读取归一仍命中', async () => {
    const legacyAbs = path.join(tmpUserData, 'recordings', 'legacy.webm')
    fs.writeFileSync(legacyAbs, Buffer.from('legacy-audio'))
    ensureDb()
      .prepare('UPDATE matches SET recording_meta = ? WHERE id = ?')
      .run(
        JSON.stringify([
          { id: 'legacy', kind: 'whole', filePath: legacyAbs, markers: [] }
        ]),
        'm-1'
      )

    // 读取端 basename 归一：传旧绝对路径也能命中当前根内文件
    const buf = await readRecordingFile(legacyAbs)
    expect(buf).not.toBeNull()
    expect(buf!.toString('utf8')).toBe('legacy-audio')
  })

  it('T5：切换 recording.dir 根 → basename 元数据跟随新根；新根无文件 → read null', async () => {
    // rootA（默认 userData）：文件 a.webm
    const rootARecordings = path.join(tmpUserData, 'recordings')
    fs.writeFileSync(path.join(rootARecordings, 'a.webm'), Buffer.from('root-a'))
    const meta: MatchRecordingMeta = {
      filePath: path.join(rootARecordings, 'a.webm'),
      segmentMode: 'whole',
      markers: []
    }
    matchRepo.update('m-1', { recordingMeta: meta })

    // 切换到 rootB：真实目录 + 同名文件
    const rootB = path.join(
      os.tmpdir(),
      `rec-meta-rootb-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    try {
      fs.mkdirSync(path.join(rootB, 'recordings'), { recursive: true })
      fs.writeFileSync(path.join(rootB, 'recordings', 'b.webm'), Buffer.from('root-b'))
      mockGetSetting.mockReturnValue(rootB)

      // basename 元数据命中新根的 b.webm
      const bufB = await readRecordingFile('b.webm')
      expect(bufB!.toString('utf8')).toBe('root-b')

      // 新根无 a.webm → null（不回读 rootA 的旧绝对路径）
      const bufA = await readRecordingFile('a.webm')
      expect(bufA).toBeNull()

      // STT/READ 传旧绝对路径（rootA）→ basename 归一到新根 → 仍 null（不逃逸）
      const bufLegacy = await readRecordingFile(path.join(rootARecordings, 'a.webm'))
      expect(bufLegacy).toBeNull()
    } finally {
      try {
        fs.rmSync(rootB, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })
})
