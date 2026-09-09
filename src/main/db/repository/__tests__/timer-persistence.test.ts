// ============================================================
// timer-persistence.test.ts — Timer 持久化真实 SQLite 测试（Phase 1.1-fix R5）
//
// Timer 是此前测试最弱环节（零测试）。本文件建立最小真库链：
//   create session → addRecord → finishRecord → listRecords / getById
//   → update(finished) → 重读一致 → 重复 finish 幂等 → FK 校验
//
// 引擎：node:sqlite DatabaseSync（真实 SQLite，Node 22+，默认 FK ON）。
// vi.mock('../../index') 覆盖 timer-session.repo 的 getDb（真跑 SQL，无 mock repo）。
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { DebateFormatData } from '../../../../shared/types'

// ---- node:sqlite → better-sqlite3 兼容薄适配（含 SAVEPOINT 嵌套） ----
class MockDb {
  private raw: DatabaseSync
  memory = false
  private txDepth = 0
  private txSeq = 0
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
      const sp = 'sp_' + ++this.txSeq
      if (this.txDepth === 0) this.raw.exec('BEGIN')
      else this.raw.exec('SAVEPOINT ' + sp)
      this.txDepth++
      try {
        const r = fn(...(args as never[]))
        this.txDepth--
        if (this.txDepth === 0) this.raw.exec('COMMIT')
        else this.raw.exec('RELEASE ' + sp)
        return r
      } catch (e) {
        this.txDepth--
        if (this.txDepth === 0) this.raw.exec('ROLLBACK')
        else {
          this.raw.exec('ROLLBACK TO ' + sp)
          this.raw.exec('RELEASE ' + sp)
        }
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

// timer-session.repo 的 getDb 来自 '../index'
vi.mock('../../index', () => ({ getDb: () => ensureDb() }))

import {
  timerSessionRepo,
  resetTimerRecordsIndexFlag
} from '../timer-session.repo'

// ---- DDL（与 migrations/index.ts 同源列） ----
const DDL = `
  CREATE TABLE IF NOT EXISTS debate_formats (
    id TEXT PRIMARY KEY, name TEXT, description TEXT, is_preset INTEGER,
    format_data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS timer_sessions (
    id TEXT PRIMARY KEY,
    event_id TEXT, round_id TEXT, team_aff_id TEXT, team_neg_id TEXT, topic_id TEXT,
    match_id TEXT,
    format_id TEXT NOT NULL,
    format_snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    started_at TEXT, ended_at TEXT,
    current_stage_index INTEGER NOT NULL DEFAULT 0,
    current_side TEXT,
    remaining_ms INTEGER,
    theme_snapshot TEXT, label TEXT,
    created_at TEXT NOT NULL,
    stage_remaining_cache TEXT,
    aff_remaining_ms INTEGER, neg_remaining_ms INTEGER,
    aff_pool_remaining_ms INTEGER, neg_pool_remaining_ms INTEGER,
    aff_speech_count INTEGER DEFAULT 0, neg_speech_count INTEGER DEFAULT 0,
    event_name TEXT, team_aff_name TEXT, team_neg_name TEXT, topic_title TEXT,
    FOREIGN KEY (format_id) REFERENCES debate_formats(id)
  );
  CREATE TABLE IF NOT EXISTS timer_records (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    stage_index INTEGER NOT NULL,
    stage_name TEXT NOT NULL,
    side TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    actual_ms INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    pause_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES timer_sessions(id) ON DELETE CASCADE
  );
`

/** 最小赛制快照 fixture（单环节非自由辩论） */
function makeFormatSnapshot(): DebateFormatData {
  return {
    stages: [
      {
        id: 's1',
        name: '立论',
        side: 'aff',
        durationMs: 180000,
        bells: [],
        isFreeDebate: false
      }
    ]
  } as unknown as DebateFormatData
}

function seedFormat(id = 'fmt-1'): void {
  ensureDb()
    .prepare(
      "INSERT INTO debate_formats (id, name, description, is_preset, format_data, created_at, updated_at) VALUES (?, '测试赛制', NULL, 1, '{}', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z')"
    )
    .run(id)
}

beforeEach(() => {
  const db = ensureDb()
  db.exec('DROP TABLE IF EXISTS timer_records')
  db.exec('DROP TABLE IF EXISTS timer_sessions')
  db.exec('DROP TABLE IF EXISTS debate_formats')
  db.exec(DDL)
  db.exec("PRAGMA foreign_keys = ON")
  seedFormat()
  resetTimerRecordsIndexFlag()
})

describe('R5：Timer 持久化真实 SQLite 链（create → record → finish → reload）', () => {
  it('create → addRecord → finishRecord → listRecords：记录落库且 finish 后状态正确', () => {
    const session = timerSessionRepo.create({
      formatId: 'fmt-1',
      formatSnapshot: makeFormatSnapshot(),
      label: '测试会话'
    })
    expect(session.status).toBe('idle')
    expect(session.currentSide).toBe('aff')

    timerSessionRepo.addRecord({
      sessionId: session.id,
      stageIndex: 0,
      stageName: '立论',
      side: 'aff',
      durationMs: 180000,
      startedAt: '2026-09-09T10:00:00Z'
    })
    timerSessionRepo.finishRecord(session.id, 0, 175000, '2026-09-09T10:02:55Z', 1)

    const records = timerSessionRepo.listRecords(session.id)
    expect(records.length).toBe(1)
    expect(records[0].actualMs).toBe(175000)
    expect(records[0].endedAt).toBe('2026-09-09T10:02:55Z')
    expect(records[0].pauseCount).toBe(1)
  })

  it('update(finished) 后重新 getById 读取状态一致（reload 语义）', () => {
    const session = timerSessionRepo.create({
      formatId: 'fmt-1',
      formatSnapshot: makeFormatSnapshot()
    })
    timerSessionRepo.update(session.id, {
      status: 'finished',
      startedAt: '2026-09-09T10:00:00Z',
      endedAt: '2026-09-09T10:20:00Z'
    })

    const reloaded = timerSessionRepo.getById(session.id)
    expect(reloaded).not.toBeNull()
    expect(reloaded!.status).toBe('finished')
    expect(reloaded!.startedAt).toBe('2026-09-09T10:00:00Z')
    expect(reloaded!.endedAt).toBe('2026-09-09T10:20:00Z')
    // formatSnapshot JSON 往返后保持可用
    expect(reloaded!.formatSnapshot.stages[0].name).toBe('立论')
  })

  it('重复 finishRecord 幂等：仅更新同一条最新记录，不产生重复行或错误数据', () => {
    const session = timerSessionRepo.create({
      formatId: 'fmt-1',
      formatSnapshot: makeFormatSnapshot()
    })
    timerSessionRepo.addRecord({
      sessionId: session.id,
      stageIndex: 0,
      stageName: '立论',
      side: 'aff',
      durationMs: 180000,
      startedAt: '2026-09-09T10:00:00Z'
    })

    timerSessionRepo.finishRecord(session.id, 0, 100, '2026-09-09T10:01:00Z', 0)
    timerSessionRepo.finishRecord(session.id, 0, 200, '2026-09-09T10:02:00Z', 2)
    timerSessionRepo.finishRecord(session.id, 0, 175000, '2026-09-09T10:02:55Z', 1)

    const records = timerSessionRepo.listRecords(session.id)
    expect(records.length).toBe(1)
    expect(records[0].actualMs).toBe(175000)
    expect(records[0].pauseCount).toBe(1)

    // session 行为 1 行
    expect(count('timer_sessions')).toBe(1)
    expect(count('timer_records')).toBe(1)
  })

  it('FK 校验：format_id 不存在时创建 session 应抛错（外键约束）', () => {
    expect(() =>
      timerSessionRepo.create({
        formatId: 'fmt-not-exist',
        formatSnapshot: makeFormatSnapshot()
      })
    ).toThrow()
  })

  it('delete session 后 records 级联清除（ON DELETE CASCADE）', () => {
    const session = timerSessionRepo.create({
      formatId: 'fmt-1',
      formatSnapshot: makeFormatSnapshot()
    })
    timerSessionRepo.addRecord({
      sessionId: session.id,
      stageIndex: 0,
      stageName: '立论',
      side: 'aff',
      durationMs: 180000,
      startedAt: '2026-09-09T10:00:00Z'
    })
    expect(timerSessionRepo.delete(session.id)).toBe(true)
    expect(count('timer_records')).toBe(0)
    expect(timerSessionRepo.getById(session.id)).toBeNull()
  })
})

function count(table: string): number {
  return (ensureDb().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
}
