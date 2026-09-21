// ============================================================
// integration-phase6-c-d-g.test.ts — Phase 6.2 核心链路集成回归
// （真 SQLite **文件**库 + 真 repo SQL + 真 FS restore）
//
// 链路 C：Draw → Match → Timer（绑定 / records 持久化 / finishSession endedAt）
// 链路 D：Timer → Recording（recording-active 与 timer 会话共存互不破坏）
// 链路 G：Backup → Restore → Continue（真文件 restore 后 integrity/fk_check
//         通过 + 业务可继续 + 损坏 source 失败原库仍在）
//
// 引擎：vi.mock('better-sqlite3') 注入 node:sqlite 文件适配器（沿
// restore-backup-safety 模式，生产代码零改动）；active 库为临时目录真实
// db 文件；repo 的 getDb 指向 active 连接。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DatabaseSync } from 'node:sqlite'

// ---- 完整 better-sqlite3 适配（prepare/transaction/pragma，repo 全接口）----
class FileDb {
  private raw: DatabaseSync
  memory = false
  constructor(p: string) {
    this.raw = new DatabaseSync(p)
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
  pragma(sql: string, opts?: { simple?: boolean }): unknown {
    const stmt = this.raw.prepare(`PRAGMA ${sql}`)
    if (opts?.simple) {
      const row = stmt.get() as Record<string, unknown> | undefined
      return row ? Object.values(row)[0] : undefined
    }
    return stmt.all()
  }
  private txDepth = 0
  private txSeq = 0
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: never[]) => {
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

const { mockApp, state } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn() },
  state: {
    activeConnection: null as {
      memory: boolean
      prepare: (sql: string) => unknown
      pragma: (sql: string, opts?: { simple?: boolean }) => unknown
    } | null
  }
}))

vi.mock('electron', () => ({ app: mockApp }))
vi.mock('../../index', () => ({
  getDb: () => {
    if (!state.activeConnection) {
      throw new Error('Database not initialized. Call initDatabase() first.')
    }
    return state.activeConnection
  }
}))

// 被测模块（mock 之后导入）
import { eventRepo } from '../event.repo'
import { matchRepo } from '../match.repo'
import { drawRepo } from '../draw.repo'
import { timerSessionRepo } from '../timer-session.repo'
import { setRecordingActive, isRecordingActive } from '../../../services/recording-active'
import { exportBackup, importBackup } from '../../../services/backup-service'

let tmpUserData: string
let activeRaw: DatabaseSync | null = null

const DB_NAME = 'debate-drawer.db'
const FMT = {
  stages: [
    { id: 'st0', name: '立论', side: 'aff', durationMs: 60000, bells: [] },
    { id: 'st1', name: '结辩', side: 'neg', durationMs: 60000, bells: [] }
  ],
  totalDurationMs: 120000
} as never

const BUSINESS_DDL = `
  CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT, end_date TEXT, status TEXT, created_at TEXT, allow_repeat INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE rounds (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, name TEXT, round_number INTEGER);
  CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, group_id TEXT);
  CREATE TABLE topics (id TEXT PRIMARY KEY, title TEXT);
  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE,
    match_number INTEGER, team_a_id TEXT, team_b_id TEXT, topic_id TEXT,
    stance_a TEXT, stance_b TEXT, draw_item_id TEXT, session_id TEXT, recording_ref TEXT,
    status TEXT NOT NULL DEFAULT 'planned', winner TEXT, aff_score REAL, neg_score REAL,
    best_speaker TEXT, notes TEXT, format_id TEXT, judge_system TEXT NOT NULL DEFAULT 'three_votes',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    team_a_name TEXT, team_b_name TEXT, topic_title TEXT, event_name TEXT, round_name TEXT
  );
  CREATE TABLE match_judges (id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE, name TEXT, sort_order INTEGER DEFAULT 0, is_ai INTEGER DEFAULT 0, created_at TEXT);
  CREATE TABLE match_judge_votes (id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE, judge_id TEXT NOT NULL REFERENCES match_judges(id) ON DELETE CASCADE, judge_system TEXT DEFAULT 'three_votes', created_at TEXT);
  CREATE TABLE draw_sessions (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, round_id TEXT, draw_time TEXT, operator TEXT, settings TEXT);
  CREATE TABLE draw_session_items (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES draw_sessions(id) ON DELETE CASCADE, topic_id TEXT, team_a_id TEXT, team_b_id TEXT, stance_a TEXT, stance_b TEXT, topic_title TEXT, team_a_name TEXT, team_b_name TEXT, team_ids TEXT, team_stances TEXT, team_names TEXT, group_id TEXT);
  CREATE TABLE timer_sessions (
    id TEXT PRIMARY KEY, event_id TEXT, round_id TEXT, match_id TEXT,
    team_aff_id TEXT, team_neg_id TEXT, topic_id TEXT,
    format_id TEXT, format_snapshot TEXT, status TEXT NOT NULL,
    started_at TEXT, ended_at TEXT, current_stage_index INTEGER,
    current_side TEXT, remaining_ms INTEGER, theme_snapshot TEXT, label TEXT, created_at TEXT,
    stage_remaining_cache TEXT, aff_remaining_ms INTEGER, neg_remaining_ms INTEGER,
    aff_pool_remaining_ms INTEGER, neg_pool_remaining_ms INTEGER,
    aff_speech_count INTEGER, neg_speech_count INTEGER,
    event_name TEXT, team_aff_name TEXT, team_neg_name TEXT, topic_title TEXT
  );
  CREATE TABLE timer_records (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, stage_index INTEGER NOT NULL,
    stage_name TEXT, side TEXT, duration_ms INTEGER, actual_ms INTEGER,
    started_at TEXT, ended_at TEXT, pause_count INTEGER
  );
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, action TEXT, target_type TEXT, target_id TEXT, operator TEXT, detail TEXT, created_at TEXT);
  CREATE TABLE team_history (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    played_at TEXT, session_id TEXT, stance TEXT, topic_title TEXT
  );
  CREATE TABLE topic_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT);
  CREATE TABLE team_groups (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT);
`

function dbPath(): string {
  return path.join(tmpUserData, DB_NAME)
}

/** 打开 active 库（真文件）并建全业务表；注入 mock getDb 供 repo 使用 */
function openActive(): void {
  activeRaw = new DatabaseSync(dbPath())
  activeRaw.exec('PRAGMA journal_mode = WAL')
  activeRaw.exec(BUSINESS_DDL)
  const raw = activeRaw
  state.activeConnection = new FileDb(dbPath())
  void raw
}

beforeEach(() => {
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-p6cdg-'))
  mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath: ${key}`)
  })
  openActive()
})

afterEach(() => {
  state.activeConnection = null
  activeRaw?.close()
  activeRaw = null
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

/** C 链完整业务流：event → team → draw → match → timer session + record */
function runBusinessFlow(): { matchId: string; sessionId: string } {
  const ev = eventRepo.createEvent({ name: '积分赛', status: null, start_date: null, end_date: null })
  const ta = eventRepo.createTeam({ name: '甲队', event_id: ev.id })
  const tb = eventRepo.createTeam({ name: '乙队', event_id: ev.id })
  const db = state.activeConnection as unknown as FileDb
  db.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run('topic-1', '辩题甲')
  const session = drawRepo.createSession({
    event_id: ev.id,
    round_id: null,
    items: [
      { topic_id: 'topic-1', team_a_id: ta.id, team_b_id: tb.id, stance_a: '正方', stance_b: '反方' }
    ]
  } as never)
  const item = drawRepo.listItemsBySession(session.id)[0]
  const match = matchRepo.upsertFromDraw({
    eventId: ev.id,
    roundId: null,
    teamAffId: item.team_a_id!,
    teamNegId: item.team_b_id!,
    topicId: item.topic_id!,
    drawItemId: item.id,
    stanceAff: item.stance_a ?? null,
    stanceNeg: item.stance_b ?? null
  })
  const timerSession = timerSessionRepo.create({
    formatId: 'fmt-1',
    formatSnapshot: FMT,
    eventId: ev.id,
    matchId: match.id,
    teamAffId: ta.id,
    teamNegId: tb.id,
    topicId: 'topic-1',
    teamAffName: '甲队',
    teamNegName: '乙队',
    topicTitle: '辩题甲'
  })
  return { matchId: match.id, sessionId: timerSession.id }
}

describe('Phase 6.2 链路 C：Draw → Match → Timer', () => {
  it('C1/C2 draw → match → timer 会话绑定 + record 持久化（actualMs 落库）', () => {
    const { matchId, sessionId } = runBusinessFlow()

    const ts = timerSessionRepo.getById(sessionId)
    expect(ts?.matchId).toBe(matchId)
    expect(ts?.status).toBe('idle')
    expect(ts?.teamAffName).toBe('甲队')

    // running：record 开始 → 结束（actualMs 持久化）
    timerSessionRepo.update(sessionId, { status: 'running', startedAt: '2026-01-01T09:00:00Z' })
    timerSessionRepo.addRecord({
      sessionId, stageIndex: 0, stageName: '立论', side: 'aff',
      durationMs: 60000, startedAt: '2026-01-01T09:00:10Z'
    })
    timerSessionRepo.finishRecord(sessionId, 0, 58000, '2026-01-01T09:01:08Z', 1)
    const records = timerSessionRepo.listRecords(sessionId)
    expect(records.length).toBe(1)
    expect(records[0].actualMs).toBe(58000)
    expect(records[0].pauseCount).toBe(1)

    // C4 nextStage 状态往返：update 推进 currentStageIndex 不产生非法状态
    timerSessionRepo.update(sessionId, { status: 'paused', currentStageIndex: 1 })
    const after = timerSessionRepo.getById(sessionId)
    expect(after?.currentStageIndex).toBe(1)
    expect(after?.status).toBe('paused')
  })

  it('C5 finishSession（status=finished + endedAt）落库（P5-016 集成层）', () => {
    const { sessionId } = runBusinessFlow()
    // TimerPage.onFinish 接线最终走的 repo.update 路径
    const finished = timerSessionRepo.update(sessionId, {
      status: 'finished',
      endedAt: '2026-01-01T10:00:00Z'
    })
    expect(finished?.status).toBe('finished')
    expect(finished?.endedAt).toBe('2026-01-01T10:00:00Z')
    // 重读（模拟 History 页加载）
    const reloaded = timerSessionRepo.getById(sessionId)
    expect(reloaded?.endedAt).toBe('2026-01-01T10:00:00Z')
  })
})

describe('Phase 6.2 链路 D：Timer → Recording 共存', () => {
  it('recording-active 与 timer 会话状态互不破坏、结束顺序正常', () => {
    const { sessionId } = runBusinessFlow()
    // 比赛开始 → 录音开始
    setRecordingActive(true)
    expect(isRecordingActive()).toBe(true)
    timerSessionRepo.update(sessionId, { status: 'running', startedAt: '2026-01-01T09:00:00Z' })

    // pause / resume 期间 recording flag 独立维持
    timerSessionRepo.update(sessionId, { status: 'paused' })
    expect(isRecordingActive()).toBe(true)
    timerSessionRepo.update(sessionId, { status: 'running' })

    // 比赛结束 → 录音结束（先 session 后 flag 的结束时序不互相破坏）
    timerSessionRepo.update(sessionId, { status: 'finished', endedAt: '2026-01-01T10:00:00Z' })
    setRecordingActive(false)
    expect(isRecordingActive()).toBe(false)

    const ts = timerSessionRepo.getById(sessionId)
    expect(ts?.status).toBe('finished')
    expect(ts?.endedAt).toBe('2026-01-01T10:00:00Z')
    // 会话恢复（内存态归零后录音可再启动，与 restore race 专项语义一致）
    setRecordingActive(true)
    expect(isRecordingActive()).toBe(true)
    setRecordingActive(false)
  })
})

describe('Phase 6.2 链路 G：Backup → Restore → Continue（结构化备份全链）', () => {
  /** FileDb.pragma 对 FK 切换 no-op（node:sqlite 运行时不允许改 FK；FK 常开，
   *  clear_rebuild 的表序已保证先清后插的一致性——P5-011 测试同款处理）。 */
  function disableFkSwitch(): void {
    const conn = state.activeConnection as unknown as FileDb
    const orig = conn.pragma.bind(conn)
    conn.pragma = (sql: string, opts?: { simple?: boolean }) =>
      /foreign_keys/i.test(sql) ? [] : orig(sql, opts)
  }

  it('G1/G2 备份 → 修改原数据 → 恢复 → 内容还原 + 继续业务', async () => {
    const { matchId, sessionId } = runBusinessFlow()
    disableFkSwitch()

    // 1) 备份（三类核心业务数据）
    const pkg = exportBackup({ categories: ['events', 'match_records', 'timer'] })
    const backupFile = path.join(tmpUserData, 'backup-phase6.json')
    fs.writeFileSync(backupFile, JSON.stringify(pkg), 'utf-8')

    // 2) 备份后修改原数据（模拟「恢复前业务继续变化」）
    matchRepo.setResult(matchId, { winner: 'neg', notes: '恢复前被改' })
    timerSessionRepo.update(sessionId, { status: 'finished', endedAt: '2099-01-01T00:00:00Z' })

    // 3) 恢复（clear_rebuild）
    importBackup({ filePath: backupFile, strategy: 'clear_rebuild', categories: ['events', 'match_records', 'timer'] })

    // 4) 恢复后重读：备份时刻的内容还原
    const m = matchRepo.getById(matchId)
    expect(m?.status).toBe('planned') // 备份时刻尚未开赛
    expect(m?.winner).toBeNull() // 恢复前被改的 winner 被还原
    const ts = timerSessionRepo.getById(sessionId)
    expect(ts?.status).toBe('idle')
    expect(ts?.endedAt).toBeNull()

    // 5) 继续业务：恢复后的库可正常创建/修改
    const ev2 = eventRepo.createEvent({ name: '恢复后新建赛事', status: null, start_date: null, end_date: null })
    expect(eventRepo.getEventById(ev2.id)?.name).toBe('恢复后新建赛事')
    matchRepo.setResult(matchId, { winner: 'aff', notes: '恢复后录入' })
    expect(matchRepo.getById(matchId)?.winner).toBe('aff')
    timerSessionRepo.update(sessionId, { status: 'finished', endedAt: '2026-01-01T10:00:00Z' })
    expect(timerSessionRepo.getById(sessionId)?.endedAt).toBe('2026-01-01T10:00:00Z')

    // 6) 恢复后库完整性
    expect((activeRaw as DatabaseSync).prepare('PRAGMA integrity_check').get() as { integrity_check: string }).toEqual({ integrity_check: 'ok' })
    expect((activeRaw as DatabaseSync).prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('G3 损坏备份恢复失败 → 原数据仍在', async () => {
    const { matchId } = runBusinessFlow()
    const badFile = path.join(tmpUserData, 'backup-bad.json')
    fs.writeFileSync(badFile, '{ not valid json', 'utf-8')

    expect(() =>
      importBackup({ filePath: badFile, strategy: 'clear_rebuild', categories: ['events'] })
    ).toThrow()

    // 原数据未被破坏
    const m = matchRepo.getById(matchId)
    expect(m?.status).toBe('planned')
  })
})
