// ============================================================
// integration-phase6-failure.test.ts — Phase 6.4 异常/恢复/故障集成回归
// （真 SQLite 文件库 + 真 repo SQL + 真 backup-service 编排）
//
// 场景 E（幂等）：E2 结构化备份重复导入（clear_rebuild 幂等）；
//                E4 setResult 重复写入（last-write-wins + P5-008 notes 保留）
// 场景 F（异常输入）：不存在 ID / 已删除 ID / P5-006 confirmed guard /
//                非法引用（FK 拒绝 + 无半写行）
// 场景 G（中途失败）：G1 备份坏行 → 整批回滚无半写；
//                G2 withUndoLog 三段抛错 → 业务回滚 + 无 undo_log；
//                G3 损坏 JSON → 原库不变 + 业务可继续
// 场景 H（Recording↔Restore）：录音中导入守卫 / 失败路径不锁死 flag
// 场景 I（Timer 持久化侧）：actual_ms 持久化 / P5-019 重跑重置 /
//                finished 后 repo 层不设防（状态机守卫在 renderer hook）
//
// 引擎：vi.mock('electron') + vi.mock('../../db') 注入 node:sqlite 文件适配器
// （沿 integration-phase6-c-d-g 模式，生产代码零改动）。'../../db' 解析到
// src/main/db/index.ts，与 repo 内部 '../index'、backup-service 内部 '../db'
// 为同一 resolved module，一次 mock 全覆盖。FK 由 node:sqlite 默认开启且
// 运行时不可切换，故 importBackup 的 foreign_keys pragma 经 disableFkSwitch
// 拦截为 no-op（c-d-g 同款处理）。
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
vi.mock('../../db', () => ({
  getDb: () => {
    if (!state.activeConnection) {
      throw new Error('Database not initialized. Call initDatabase() first.')
    }
    return state.activeConnection
  }
}))

// 被测模块（mock 之后导入）
import { eventRepo } from '../../db/repository/event.repo'
import { matchRepo } from '../../db/repository/match.repo'
import { drawRepo } from '../../db/repository/draw.repo'
import { timerSessionRepo } from '../../db/repository/timer-session.repo'
import { setRecordingActive, isRecordingActive } from '../recording-active'
import { exportBackup, importBackup } from '../backup-service'
import { withUndoLog, executeUndo } from '../undo-service'

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
  CREATE TABLE rounds (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, name TEXT, round_number INTEGER, difficulty_override TEXT, topic_count INTEGER, is_round_robin INTEGER NOT NULL DEFAULT 0);
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
  -- P5-019：重跑环节的「重置既有记录」分支依赖 (session_id, stage_index) 唯一索引
  CREATE UNIQUE INDEX idx_timer_records_session_stage ON timer_records(session_id, stage_index);
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, action TEXT, target_type TEXT, target_id TEXT, operator TEXT, detail TEXT, created_at TEXT);
  CREATE TABLE undo_log (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, store_name TEXT NOT NULL,
    action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT,
    before_data TEXT, after_data TEXT, payload_size INTEGER NOT NULL DEFAULT 0,
    label TEXT, undone_at TEXT
  );
  CREATE TABLE import_batch (
    id TEXT PRIMARY KEY, file_name TEXT NOT NULL, total_count INTEGER NOT NULL,
    imported_count INTEGER NOT NULL, duplicates_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0, imported_at TEXT NOT NULL, notes TEXT
  );
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

/** 打开 active 库（真文件）并建全业务表；注入 mock getDb 供 repo/service 使用 */
function openActive(): void {
  activeRaw = new DatabaseSync(dbPath())
  activeRaw.exec('PRAGMA journal_mode = WAL')
  activeRaw.exec(BUSINESS_DDL)
  state.activeConnection = new FileDb(dbPath())
}

beforeEach(() => {
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-p6fail-'))
  mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath: ${key}`)
  })
  setRecordingActive(false)
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

function conn(): FileDb {
  return state.activeConnection as unknown as FileDb
}

function count(table: string): number {
  return (conn().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}

/** FileDb.pragma 对 FK 切换 no-op（node:sqlite 运行时不允许改 FK；FK 常开，
 *  clear_rebuild 的表序已保证先清后插的一致性——c-d-g 测试同款处理）。 */
function disableFkSwitch(): void {
  const c = conn()
  const orig = c.pragma.bind(c)
  c.pragma = (sql: string, opts?: { simple?: boolean }) =>
    /foreign_keys/i.test(sql) ? [] : orig(sql, opts)
}

/** 最小种子：event → round → team×2 → match（E2/E4/H 共用） */
function seedEventRoundMatch(): {
  eventId: string
  roundId: string
  matchId: string
} {
  const ev = eventRepo.createEvent({ name: '故障回归赛', status: null, start_date: null, end_date: null })
  const round = eventRepo.createRound({
    event_id: ev.id,
    name: '初赛',
    round_number: 1,
    difficulty_override: null,
    topic_count: null,
    is_round_robin: false
  })
  const ta = eventRepo.createTeam({ name: '甲队', event_id: ev.id })
  const tb = eventRepo.createTeam({ name: '乙队', event_id: ev.id })
  const match = matchRepo.create({ eventId: ev.id, roundId: round.id, matchNumber: 1 })
  void ta
  void tb
  return { eventId: ev.id, roundId: round.id, matchId: match.id }
}

// ============================================================
// 场景 E：幂等
// ============================================================
describe('场景 E：幂等', () => {
  it('E2 同一备份 JSON 重复 importBackup（clear_rebuild）：行数不翻倍、inserted 统计一致、内容不变', () => {
    const { eventId, matchId } = seedEventRoundMatch()
    // 备份前先产生一个非默认赛果，验证内容保真
    matchRepo.setResult(matchId, { winner: 'aff', notes: 'E2 备份时刻赛果' })

    const pkg = exportBackup({ categories: ['events', 'match_records'] })
    const backupFile = path.join(tmpUserData, 'backup-e2.json')
    fs.writeFileSync(backupFile, JSON.stringify(pkg), 'utf-8')
    disableFkSwitch()

    const params = { filePath: backupFile, strategy: 'clear_rebuild' as const, categories: ['events', 'match_records'] as never[] }
    const r1 = importBackup(params)

    const snap = () => ({
      events: count('events'),
      rounds: count('rounds'),
      teams: count('teams'),
      team_groups: count('team_groups'),
      matches: count('matches'),
      match_judges: count('match_judges'),
      match_judge_votes: count('match_judge_votes')
    })
    const after1 = snap()
    const totalAfter1 = Object.values(after1).reduce((a, b) => a + b, 0)
    // clear_rebuild 纯 INSERT：inserted 统计应与实际落库行数一致
    expect(r1.inserted).toBe(totalAfter1)
    expect(after1.events).toBe(1)
    expect(after1.matches).toBe(1)

    // 对同一 JSON 再导入一次
    const r2 = importBackup(params)
    const after2 = snap()

    // 行数不翻倍
    expect(after2).toEqual(after1)
    // 第二次 inserted 统计与实际行数一致，且与第一次相同（数据集相同）
    expect(r2.inserted).toBe(totalAfter1)
    expect(r2.inserted).toBe(r1.inserted)

    // 数据内容不变（导入前的赛果字段原样保留）
    const m = matchRepo.getById(matchId)
    expect(m?.eventId).toBe(eventId)
    expect(m?.winner).toBe('aff')
    expect(m?.notes).toBe('E2 备份时刻赛果')
    expect(m?.status).toBe('resulted')
  })

  it('E4 setResult 重复写入：match 仍 1 行、值以最后一次为准；缺省 notes 保留旧值（P5-008）', () => {
    const { matchId } = seedEventRoundMatch()

    matchRepo.setResult(matchId, { winner: 'aff', affScore: 3, negScore: 1, notes: '第一判' })
    let m = matchRepo.getById(matchId)
    expect(m?.winner).toBe('aff')
    expect(m?.affScore).toBe(3)
    expect(m?.notes).toBe('第一判')

    // 第二次 setResult（不同 winner/score）：覆盖而非追加
    matchRepo.setResult(matchId, { winner: 'neg', affScore: 2, negScore: 3, notes: '改判' })
    m = matchRepo.getById(matchId)
    expect(count('matches')).toBe(1)
    expect(m?.winner).toBe('neg')
    expect(m?.affScore).toBe(2)
    expect(m?.negScore).toBe(3)
    expect(m?.status).toBe('resulted')

    // 只传 winner 不传 notes（undefined）→ notes 保留旧值
    matchRepo.setResult(matchId, { winner: 'draw' })
    m = matchRepo.getById(matchId)
    expect(m?.winner).toBe('draw')
    expect(m?.notes).toBe('改判')
  })
})

// ============================================================
// 场景 F：异常输入
// ============================================================
describe('场景 F：异常输入', () => {
  it('不存在的 ID：各 repo get 返回空值不抛错', () => {
    expect(eventRepo.getEventById('nope')).toBeUndefined()
    expect(eventRepo.getRoundById('nope')).toBeUndefined()
    expect(matchRepo.getById('nope')).toBeFalsy() // match.repo 返回 null
    expect(timerSessionRepo.getById('nope')).toBeFalsy() // timer-session.repo 返回 null
  })

  it('已删除 ID：create → delete → get 返回空值', () => {
    const ev = eventRepo.createEvent({ name: '删除回归赛', status: null, start_date: null, end_date: null })
    const round = eventRepo.createRound({
      event_id: ev.id, name: '复赛', round_number: 1,
      difficulty_override: null, topic_count: null, is_round_robin: false
    })
    const match = matchRepo.create({ eventId: ev.id, roundId: round.id, matchNumber: 1 })

    expect(eventRepo.deleteRound(round.id)).toBe(true)
    expect(eventRepo.getRoundById(round.id)).toBeUndefined()

    matchRepo.delete(match.id)
    expect(matchRepo.getById(match.id)).toBeFalsy()

    expect(eventRepo.deleteTeam(
      eventRepo.createTeam({ name: '短命队', event_id: ev.id }).id
    )).toBe(true)
  })

  it('P5-006：confirmed 正式会话被守卫拒绝且状态不变；is_test 会话放行', () => {
    const ev = eventRepo.createEvent({ name: '守卫赛', status: null, start_date: null, end_date: null })
    eventRepo.createTeam({ name: '甲队', event_id: ev.id })
    eventRepo.createTeam({ name: '乙队', event_id: ev.id })
    eventRepo.createTeam({ name: '丙队', event_id: ev.id })

    const confirmed = drawRepo.createSession({
      event_id: ev.id,
      round_id: null,
      items: [{ topic_id: null, team_a_id: null, team_b_id: null }],
      settings: { confirmed: true, is_test: false }
    } as never)
    expect(() => drawRepo.assertSessionNotConfirmed(confirmed.id)).toThrow(/已确认/)
    // 守卫只读不写：session 状态保持 confirmed
    expect(drawRepo.getSessionById(confirmed.id)?.settings?.confirmed).toBe(true)

    const isTest = drawRepo.createSession({
      event_id: ev.id,
      round_id: null,
      items: [{ topic_id: null, team_a_id: null, team_b_id: null }],
      settings: { confirmed: true, is_test: true }
    } as never)
    expect(() => drawRepo.assertSessionNotConfirmed(isTest.id)).not.toThrow()
  })

  it('空/非法引用参数：matchRepo.create 非法 eventId 被 FK 拒绝、无半写行，随后正常创建成功', () => {
    expect(() =>
      matchRepo.create({ eventId: 'no-such-event', roundId: null, matchNumber: 1 })
    ).toThrow()
    // FK 拒绝后库一致：无半写行
    expect(count('matches')).toBe(0)

    // 错误后正常业务可继续
    const ev = eventRepo.createEvent({ name: '恢复创建赛', status: null, start_date: null, end_date: null })
    const round = eventRepo.createRound({
      event_id: ev.id, name: '决赛', round_number: 1,
      difficulty_override: null, topic_count: null, is_round_robin: false
    })
    const match = matchRepo.create({ eventId: ev.id, roundId: round.id, matchNumber: 1 })
    expect(count('matches')).toBe(1)
    expect(matchRepo.getById(match.id)?.eventId).toBe(ev.id)
  })
})

// ============================================================
// 场景 G：中途失败
// ============================================================
describe('场景 G：中途失败', () => {
  it('G1 备份含违反 NOT NULL 约束的坏行 → importBackup 抛错 → 整批回滚各表 0 行', () => {
    // 空库上先造一行合法 teams 行，导出后混入缺 name（NOT NULL）的坏行
    const ev = eventRepo.createEvent({ name: '坏行赛', status: null, start_date: null, end_date: null })
    const t = eventRepo.createTeam({ name: '合法队', event_id: ev.id })
    const pkg = exportBackup({ categories: ['events'] })
    const badRow = { id: 'bad-team', event_id: ev.id, group_id: null } as Record<string, unknown>
    ;(pkg.tables as Record<string, unknown[]>).teams!.push(badRow)
    const backupFile = path.join(tmpUserData, 'backup-g1.json')
    fs.writeFileSync(backupFile, JSON.stringify(pkg), 'utf-8')
    void t

    // 清空库：导入失败后断言「各表 0 行」才有区分度
    conn().prepare('DELETE FROM teams').run()
    conn().prepare('DELETE FROM rounds').run()
    conn().prepare('DELETE FROM events').run()
    expect(count('events')).toBe(0)
    expect(count('teams')).toBe(0)
    disableFkSwitch()

    // NOT NULL 约束必然抛错（与 FK 开关无关）；坏行前的合法行也随事务回滚
    expect(() =>
      importBackup({ filePath: backupFile, strategy: 'clear_rebuild', categories: ['events'] } as never)
    ).toThrow()

    // 整批回滚无半写：所有相关表保持 0 行
    expect(count('events')).toBe(0)
    expect(count('rounds')).toBe(0)
    expect(count('teams')).toBe(0)
    expect(count('team_groups')).toBe(0)
  })

  it('G2 withUndoLog 三段任一抛错：业务写回滚、undo_log 无记录、executeUndo 报无可撤销', () => {
    const ev = eventRepo.createEvent({ name: '原名', status: null, start_date: null, end_date: null })

    // getBefore 抛错
    expect(() =>
      withUndoLog({
        storeName: 'event', action: 'update', targetType: 'event', targetId: ev.id,
        label: 'G2 before',
        getBefore: () => { throw new Error('before boom') },
        execute: () => eventRepo.updateEvent(ev.id, { name: 'before 改名' }),
        getAfter: () => null
      })
    ).toThrow('before boom')

    // execute 抛错
    expect(() =>
      withUndoLog({
        storeName: 'event', action: 'update', targetType: 'event', targetId: ev.id,
        label: 'G2 execute',
        getBefore: () => null,
        execute: () => { throw new Error('execute boom') },
        getAfter: () => null
      })
    ).toThrow('execute boom')

    // getAfter 抛错（execute 已执行，仍须回滚）
    expect(() =>
      withUndoLog({
        storeName: 'event', action: 'update', targetType: 'event', targetId: ev.id,
        label: 'G2 after',
        getBefore: () => null,
        execute: () => eventRepo.updateEvent(ev.id, { name: 'after 改名' }),
        getAfter: () => { throw new Error('after boom') }
      })
    ).toThrow('after boom')

    // 三次失败：业务写全部回滚（名称保持原名）、undo_log 无记录
    expect(eventRepo.getEventById(ev.id)?.name).toBe('原名')
    expect(count('undo_log')).toBe(0)
    expect(() => executeUndo()).toThrow('无可撤销的操作')
  })

  it('G3 非 JSON 文件 → 报「备份文件格式无效」→ 原库数据不变 → 业务可继续', () => {
    const { eventId, matchId } = seedEventRoundMatch()
    const badFile = path.join(tmpUserData, 'backup-g3.json')
    fs.writeFileSync(badFile, 'not json', 'utf-8')

    expect(() =>
      importBackup({ filePath: badFile, strategy: 'clear_rebuild', categories: ['events'] } as never)
    ).toThrow('备份文件格式无效，请选择正确的 .json 备份文件')

    // 原库数据不变（解析失败发生在任何 DB 写之前）
    expect(eventRepo.getEventById(eventId)?.name).toBe('故障回归赛')
    expect(matchRepo.getById(matchId)).toBeTruthy()

    // 之后正常业务可继续
    matchRepo.setResult(matchId, { winner: 'neg', notes: 'G3 后续' })
    expect(matchRepo.getById(matchId)?.winner).toBe('neg')
  })
})

// ============================================================
// 场景 H：Recording ↔ Restore
// ============================================================
describe('场景 H：Recording ↔ Restore', () => {
  it('录音中拒绝导入（DB 未被清、flag 保持）；停止后重试成功；失败路径不锁死 flag', () => {
    const { matchId } = seedEventRoundMatch()
    const pkg = exportBackup({ categories: ['events', 'match_records'] })
    const backupFile = path.join(tmpUserData, 'backup-h.json')
    fs.writeFileSync(backupFile, JSON.stringify(pkg), 'utf-8')
    disableFkSwitch()

    // 1) 录音中导入 → 守卫拒绝
    setRecordingActive(true)
    expect(() =>
      importBackup({ filePath: backupFile, strategy: 'clear_rebuild', categories: ['events', 'match_records'] } as never)
    ).toThrow('当前正在录音，请先停止录音后再导入备份。')

    // 守卫在任何 DB 操作之前：行数不变、flag 仍 true
    expect(count('events')).toBe(1)
    expect(count('matches')).toBe(1)
    expect(matchRepo.getById(matchId)).toBeTruthy()
    expect(isRecordingActive()).toBe(true)

    // 2) 停止录音 → 同一 JSON 重试成功
    setRecordingActive(false)
    const r = importBackup({ filePath: backupFile, strategy: 'clear_rebuild', categories: ['events', 'match_records'] } as never)
    expect(r.inserted).toBeGreaterThan(0)
    expect(count('events')).toBe(1)

    // 3) 失败路径（损坏 JSON，录音已关）不锁死 flag
    const badFile = path.join(tmpUserData, 'backup-h-bad.json')
    fs.writeFileSync(badFile, '{ broken', 'utf-8')
    expect(() =>
      importBackup({ filePath: badFile, strategy: 'clear_rebuild', categories: ['events'] } as never)
    ).toThrow('备份文件格式无效')
    expect(isRecordingActive()).toBe(false)
  })
})

// ============================================================
// BUG-P6-002 回归：TABLE_COLUMNS.team_history 恢复白名单缺 topic_title
// ============================================================
describe('BUG-P6-002 回归：team_history 恢复白名单含 topic_title', () => {
  it('含 team_history（含 topic_title）的 draw_records 类别备份可完整导入，topic_title 保留', () => {
    const ev = eventRepo.createEvent({ name: '历史回归赛', status: null, start_date: null, end_date: null })
    const team = eventRepo.createTeam({ name: '历史队', event_id: ev.id })
    // topics / team_history 无专门 seed API（测试关注点外），裸 SQL 种子
    conn().prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run('th-topic-1', 'AI 是否加剧偏见')
    conn()
      .prepare(
        'INSERT INTO team_history (id, team_id, topic_id, event_id, played_at, session_id, stance, topic_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('th-1', team.id, 'th-topic-1', ev.id, '2026-09-20T10:00:00Z', null, '正方', 'AI 是否加剧偏见')

    // findAllForBackup 对 team_history 走 SELECT *，行内含 topic_title；
    // 修复前 bulkInsert 白名单校验必抛「包含不在白名单中的列名: topic_title」
    const pkg = exportBackup({ categories: ['draw_records'] })
    const backupFile = path.join(tmpUserData, 'backup-p6-002.json')
    fs.writeFileSync(backupFile, JSON.stringify(pkg), 'utf-8')
    disableFkSwitch()

    const r = importBackup({
      filePath: backupFile,
      strategy: 'clear_rebuild',
      categories: ['draw_records']
    } as never)
    expect(r.inserted).toBeGreaterThan(0)
    expect(count('team_history')).toBe(1)

    // topic_title 快照原样恢复（辩题删除后历史仍可显示原标题的语义依赖此列）
    const row = conn().prepare('SELECT * FROM team_history WHERE id = ?').get('th-1') as
      | { topic_title: string | null; stance: string | null }
      | undefined
    expect(row?.topic_title).toBe('AI 是否加剧偏见')
    expect(row?.stance).toBe('正方')
  })
})

// ============================================================
// 场景 I：Timer 持久化侧
// ============================================================
describe('场景 I：Timer 持久化侧', () => {
  it('addRecord → finishRecord 持久化 actual_ms；finishRecord 同 stage 两次为覆盖（不重复建行/不抛错）', () => {
    const ts = timerSessionRepo.create({
      formatId: 'fmt-1',
      formatSnapshot: FMT,
      teamAffName: '甲队',
      teamNegName: '乙队'
    })
    timerSessionRepo.update(ts.id, { status: 'running', startedAt: '2026-01-01T09:00:00Z' })

    timerSessionRepo.addRecord({
      sessionId: ts.id, stageIndex: 0, stageName: '立论', side: 'aff',
      durationMs: 60000, startedAt: '2026-01-01T09:00:10Z'
    })
    timerSessionRepo.finishRecord(ts.id, 0, 58000, '2026-01-01T09:01:08Z', 1)

    let records = timerSessionRepo.listRecords(ts.id)
    expect(records.length).toBe(1)
    expect(records[0].actualMs).toBe(58000)
    expect(records[0].actualMs as number).toBeGreaterThanOrEqual(0)
    expect(records[0].pauseCount).toBe(1)

    // 同 stage 第二次 finishRecord：按 started_at DESC 命中同一行覆盖，不新建行
    timerSessionRepo.finishRecord(ts.id, 0, 49000, '2026-01-01T09:00:59Z', 2)
    records = timerSessionRepo.listRecords(ts.id)
    expect(records.length).toBe(1)
    expect(records[0].actualMs).toBe(49000)
    expect(records[0].pauseCount).toBe(2)
  })

  it('P5-019 重跑环节：addRecord 同 stage 唯一冲突 → 重置既有记录为进行中（1 行，不抛错）', () => {
    const ts = timerSessionRepo.create({ formatId: 'fmt-1', formatSnapshot: FMT })

    timerSessionRepo.addRecord({
      sessionId: ts.id, stageIndex: 0, stageName: '立论', side: 'aff',
      durationMs: 60000, startedAt: '2026-01-01T09:00:10Z'
    })
    timerSessionRepo.finishRecord(ts.id, 0, 58000, '2026-01-01T09:01:08Z', 1)

    // 重跑同一 stage：唯一索引冲突 → 既有行被重置（actual_ms/ended_at/pause_count 归零），
    // 返回 id 为空串标记复用既有行；不重复建行、不抛错
    const rerun = timerSessionRepo.addRecord({
      sessionId: ts.id, stageIndex: 0, stageName: '立论重跑', side: 'aff',
      durationMs: 90000, startedAt: '2026-01-01T09:02:00Z'
    })
    expect(rerun.id).toBe('')

    const records = timerSessionRepo.listRecords(ts.id)
    expect(records.length).toBe(1) // 仍一行：重置而非重复建行
    expect(records[0].actualMs).toBeNull()
    expect(records[0].endedAt).toBeNull()
    expect(records[0].pauseCount).toBe(0)
    expect(records[0].stageName).toBe('立论重跑')
    expect(records[0].durationMs).toBe(90000)
    expect(records[0].startedAt).toBe('2026-01-01T09:02:00Z')

    // 重跑后正常 finish 覆盖同一行
    timerSessionRepo.finishRecord(ts.id, 0, 88000, '2026-01-01T09:03:28Z', 0)
    const after = timerSessionRepo.listRecords(ts.id)
    expect(after.length).toBe(1)
    expect(after[0].actualMs).toBe(88000)
  })

  it('finished 后 repo 层不校验状态机：addRecord/update 仍落库（守卫在 renderer hook）', () => {
    // 持久化层不校验状态机，状态机守卫在 renderer hook，
    // 由 useTimerEngine.interactions.test.ts 覆盖；此处如实记录持久化侧行为。
    const ts = timerSessionRepo.create({ formatId: 'fmt-1', formatSnapshot: FMT })
    timerSessionRepo.addRecord({
      sessionId: ts.id, stageIndex: 0, stageName: '立论', side: 'aff',
      durationMs: 60000, startedAt: '2026-01-01T09:00:10Z'
    })

    timerSessionRepo.update(ts.id, { status: 'finished', endedAt: '2026-01-01T10:00:00Z' })
    expect(timerSessionRepo.getById(ts.id)?.status).toBe('finished')

    // finished 后新增另一 stage 的 record：repo 层不拦截，直接落库
    timerSessionRepo.addRecord({
      sessionId: ts.id, stageIndex: 1, stageName: '结辩', side: 'neg',
      durationMs: 60000, startedAt: '2026-01-01T10:01:00Z'
    })
    const records = timerSessionRepo.listRecords(ts.id)
    expect(records.length).toBe(2)
    expect(records[1].stageIndex).toBe(1)

    // finished 后 update 改回 running：repo 层同样不拦截
    timerSessionRepo.update(ts.id, { status: 'running' })
    expect(timerSessionRepo.getById(ts.id)?.status).toBe('running')
  })
})
