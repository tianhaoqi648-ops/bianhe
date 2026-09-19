// ============================================================
// recording-bind-semantics.test.ts — M2 修正版：bind 语义与文件归位
//
// 覆盖：
//   T2  固化产品语义 A：applyBindAction remove 仅解绑（列表过滤），
//       录音文件保留在录音目录（回归锚，防止未来误改为删文件）
//   T7  deleteRecording 真实返回：存在→true / 不存在→true（幂等）/
//       fs 失败→false（不再吞错恒 true）
//   M2' ensureRecordingsInDir：外部文件拷入录音目录（basename 唯一化）/
//       目录内文件不重复拷贝 / 纯 basename 输入不拷 / 拷贝失败抛错（bind 整体失败）
//   Case 4 无关文件不被删除
//
// 真实 FS + node:sqlite 无关（纯文件系统与纯函数）。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { DatabaseSync } from 'node:sqlite'
import * as path from 'path'
import type { BoundRecording, RecordingBindAction } from '../../../shared/types'

const { mockApp, mockGetSetting } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn() },
  mockGetSetting: vi.fn(() => null as string | null)
}))

vi.mock('electron', () => ({
  app: mockApp,
  ipcMain: { handle: vi.fn() },
  dialog: {},
  BrowserWindow: class {}
}))
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    getSetting: () => mockGetSetting(),
    setSetting: vi.fn()
  }
}))
vi.mock('../../db/index', () => ({ getDb: () => ensureDb() }))

// node:sqlite → better-sqlite3 兼容薄适配（External Import Failure 集成用例需要真库）
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

let dbInstance: MockDb | null = null
function ensureDb(): MockDb {
  if (!dbInstance) dbInstance = new MockDb()
  return dbInstance
}
vi.mock('../../index', () => ({ getDb: () => ({ prepare: vi.fn() }) }))

import {
  deleteRecording,
  ensureRecordingsInDir,
  readRecordingFile
} from '../recording-storage'
import { applyBindAction, registerRecordingIpc } from '../../ipc/recording.ipc'

let tmpUserData: string
let recDir: string

function makeRecording(id: string, filePath: string): BoundRecording {
  return { id, kind: 'whole', filePath, markers: [] }
}

beforeEach(() => {
  tmpUserData = path.join(
    os.tmpdir(),
    `rec-bind-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  recDir = path.join(tmpUserData, 'recordings')
  fs.mkdirSync(recDir, { recursive: true })
  mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath key: ${key}`)
  })
  mockGetSetting.mockReturnValue(null)
})

afterEach(() => {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  // 注意：不用 vi.restoreAllMocks()——会清掉 vi.mock('electron') 的 ipcMain.handle
  // 注册记录（bindHandler 依赖 mock.calls）；fs spy 由用例内自行 mockRestore
})

describe('T2：bind remove 产品语义固化（仅解绑，文件保留）', () => {
  it('remove 后列表过滤且录音文件保留在磁盘（回归锚）', () => {
    const filePath = path.join(recDir, 'a.webm')
    fs.writeFileSync(filePath, Buffer.from('keep-me'))
    const current: BoundRecording[] = [makeRecording('rec-1', filePath)]

    const action: RecordingBindAction = { kind: 'remove', matchId: 'm-1', id: 'rec-1' }
    const next = applyBindAction(current, action)

    // DB 语义：列表已移除该绑定
    expect(next).toEqual([])
    // 文件语义：仍保留在录音目录（A 语义——不删文件）
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, 'utf8')).toBe('keep-me')
  })

  it('remove 不存在的 id：列表不变（幂等）', () => {
    const current: BoundRecording[] = [makeRecording('rec-1', path.join(recDir, 'a.webm'))]
    const next = applyBindAction(current, { kind: 'remove', matchId: 'm-1', id: 'no-such' })
    expect(next).toHaveLength(1)
  })
})

describe('T7：deleteRecording 真实返回（不再吞错恒 true）', () => {
  it('存在的文件 → 删除成功返回 true，文件消失', async () => {
    const filePath = path.join(recDir, 'del.webm')
    fs.writeFileSync(filePath, Buffer.from('x'))
    const ok = await deleteRecording(filePath)
    expect(ok).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('不存在的文件 → 幂等成功返回 true（force 语义）', async () => {
    const ok = await deleteRecording(path.join(recDir, 'not-exist.webm'))
    expect(ok).toBe(true)
  })

  it('filesystem 失败 → 返回 false（不伪装成功）', async () => {
    const filePath = path.join(recDir, 'busy.webm')
    fs.writeFileSync(filePath, Buffer.from('x'))
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(new Error('EBUSY'))
    const ok = await deleteRecording(filePath)
    expect(ok).toBe(false)
    // 文件仍在（失败未删）
    expect(fs.existsSync(filePath)).toBe(true)
    rmSpy.mockRestore()
  })
})

describe('M2\u2019：ensureRecordingsInDir（外部绑定文件拷入录音目录）', () => {
  it('外部目录文件 → 拷入录音目录并改写 filePath 为 basename', async () => {
    const external = path.join(tmpUserData, 'external-src.webm')
    fs.writeFileSync(external, Buffer.from('external-audio'))
    const recs = [makeRecording('rec-ext', external)]

    const out = await ensureRecordingsInDir(recs)

    expect(out[0].filePath).toBe('external-src.webm')
    expect(fs.existsSync(path.join(recDir, 'external-src.webm'))).toBe(true)
    expect(fs.readFileSync(path.join(recDir, 'external-src.webm'), 'utf8')).toBe('external-audio')
  })

  it('录音目录内文件 → 不重复拷贝，filePath 归一为 basename', async () => {
    const inner = path.join(recDir, 'inner.webm')
    fs.writeFileSync(inner, Buffer.from('inner'))
    const beforeCount = fs.readdirSync(recDir).length
    const out = await ensureRecordingsInDir([makeRecording('rec-in', inner)])
    expect(out[0].filePath).toBe('inner.webm')
    expect(fs.readdirSync(recDir).length).toBe(beforeCount)
  })

  it('纯 basename 输入（M3 后形态）→ 不拷贝，原样保留', async () => {
    fs.writeFileSync(path.join(recDir, 'bare.webm'), Buffer.from('bare'))
    const out = await ensureRecordingsInDir([makeRecording('rec-bare', 'bare.webm')])
    expect(out[0].filePath).toBe('bare.webm')
    expect(fs.existsSync(path.join(recDir, 'bare.webm'))).toBe(true)
  })

  it('拷贝失败 → 抛错（错误含 basename），目录无半成品（Pre-Push Gate 修正）', async () => {
    const external = path.join(tmpUserData, 'broken-src.webm')
    // 不实际创建外部文件 → copyFile ENOENT → 失败分支
    const recs = [makeRecording('rec-broken', external)]
    await expect(ensureRecordingsInDir(recs)).rejects.toThrow('导入失败')
    // 录音目录无半成品（copyFile 原子，失败无产物）
    expect(fs.existsSync(path.join(recDir, 'broken-src.webm'))).toBe(false)
  })

  it('同名冲突 → 唯一化文件名（不覆盖已有文件）', async () => {
    const external = path.join(tmpUserData, 'dup-src.webm')
    fs.writeFileSync(external, Buffer.from('new-content'))
    fs.writeFileSync(path.join(recDir, 'dup-src.webm'), Buffer.from('old-content'))
    const out = await ensureRecordingsInDir([makeRecording('rec-dup', external)])
    // 新文件带时间戳后缀，旧文件内容未被覆盖
    expect(out[0].filePath).not.toBe('dup-src.webm')
    expect(out[0].filePath).toContain('dup-src')
    expect(fs.readFileSync(path.join(recDir, 'dup-src.webm'), 'utf8')).toBe('old-content')
    expect(fs.readFileSync(path.join(recDir, out[0].filePath), 'utf8')).toBe('new-content')
  })

  it('Case 4：无关文件不被删除（拷入只增不改删）', async () => {
    const keep = path.join(recDir, 'keep.webm')
    fs.writeFileSync(keep, Buffer.from('keep'))
    const external = path.join(tmpUserData, 'src.webm')
    fs.writeFileSync(external, Buffer.from('src'))
    await ensureRecordingsInDir([makeRecording('rec-s', external)])
    expect(fs.existsSync(keep)).toBe(true)
    expect(fs.readFileSync(keep, 'utf8')).toBe('keep')
  })
})

// ============================================================
// External Import Failure 集成用例（Pre-Push Gate）
// 真 handler 链：RECORDING_BIND 回调 → ensureRecordingsInDir → matchRepo.update
// 验证 copy 失败 → bind 整体失败 → DB 无新引用 / 外部文件不变 / 目录无半成品
// ============================================================
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { matchRepo } from '../../db/repository/match.repo'

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
`

let ipcRegistered = false
function bindHandler(): (
  _e: unknown,
  action: RecordingBindAction
) => Promise<{ success: boolean; error?: string; data?: BoundRecording[] | null }> {
  if (!ipcRegistered) {
    registerRecordingIpc()
    ipcRegistered = true
  }
  const call = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([ch]) => ch === IPC_CHANNELS.RECORDING_BIND)
  if (!call) throw new Error('RECORDING_BIND handler 未注册')
  return call[1] as never
}

describe('External Import Failure（真 handler 链，Pre-Push Gate）', () => {
  beforeEach(() => {
    const db = ensureDb()
    db.exec('DROP TABLE IF EXISTS match_judge_votes')
    db.exec('DROP TABLE IF EXISTS match_judges')
    db.exec('DROP TABLE IF EXISTS matches')
    db.exec('DROP TABLE IF EXISTS rounds')
    db.exec('DROP TABLE IF EXISTS topics')
    db.exec('DROP TABLE IF EXISTS teams')
    db.exec('DROP TABLE IF EXISTS events')
    db.exec(MATCH_DDL)
    db.prepare(
      "INSERT INTO events (id, name, created_at) VALUES ('ev-1', '测试赛事', '2026-09-10T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO matches (id, event_id, status, created_at, updated_at) VALUES ('m-1', 'ev-1', 'planned', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')"
    ).run()
  })

  it('copy 失败 → bind 整体失败：DB 无新引用 / 外部文件不变 / 目录无半成品 / existing binding 不受影响', async () => {
    // seed：existing binding（绑定录音目录内已有文件）
    fs.writeFileSync(path.join(recDir, 'exist.webm'), Buffer.from('exist'))
    matchRepo.update('m-1', {
      recordings: [makeRecording('rec-exist', 'exist.webm')]
    })
    // 外部文件（真实存在）
    const external = path.join(tmpUserData, 'outside.webm')
    fs.writeFileSync(external, Buffer.from('outside'))
    // 注入 copy 失败
    const spy = vi.spyOn(fs.promises, 'copyFile').mockRejectedValueOnce(new Error('ENOSPC'))

    const handler = bindHandler()
    const res = await handler(undefined, {
      kind: 'add',
      matchId: 'm-1',
      recording: makeRecording('rec-new', external)
    })

    // bind 整体失败 + 明确错误
    expect(res.success).toBe(false)
    expect(res.error).toContain('导入失败')

    // DB：existing binding 原样保留，新绑定未写入
    const row = ensureDb()
      .prepare('SELECT recording_meta FROM matches WHERE id = ?')
      .get('m-1') as { recording_meta: string | null }
    expect(row.recording_meta).not.toBeNull()
    const meta = JSON.parse(row.recording_meta!) as Array<{ id: string }>
    expect(meta).toHaveLength(1)
    expect(meta[0].id).toBe('rec-exist')

    // 外部文件保持不变；录音目录无半成品
    expect(fs.readFileSync(external, 'utf8')).toBe('outside')
    expect(fs.readdirSync(recDir).filter((f) => f.includes('outside'))).toEqual([])
    spy.mockRestore()
  })

  it('copy 成功 → bind 成功：DB 存 basename 且 resolve 后命中真实文件', async () => {
    const external = path.join(tmpUserData, 'ok-src.webm')
    fs.writeFileSync(external, Buffer.from('ok-audio'))

    const handler = bindHandler()
    const res = await handler(undefined, {
      kind: 'add',
      matchId: 'm-1',
      recording: makeRecording('rec-ok', external)
    })

    expect(res.success).toBe(true)
    expect(res.data![0].filePath).toBe('ok-src.webm')
    // DB 落 basename（M3 模型）
    const row = ensureDb()
      .prepare('SELECT recording_meta FROM matches WHERE id = ?')
      .get('m-1') as { recording_meta: string | null }
    const meta = JSON.parse(row.recording_meta!) as Array<{ filePath: string }>
    expect(meta[0].filePath).toBe('ok-src.webm')
    // resolve 成功：readRecordingFile 命中
    const buf = await readRecordingFile(meta[0].filePath)
    expect(buf!.toString('utf8')).toBe('ok-audio')
  })
})
