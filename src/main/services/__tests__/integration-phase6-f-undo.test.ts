// ============================================================
// integration-phase6-f-undo.test.ts — Phase 6.2 链路 F：Undo → Redo → Persistence
// （真 SQLite node:sqlite + FK ON + 真 repo/undo-service）
//
// 覆盖（业务操作 → DB → undo → DB → redo → DB → 重新读取）：
//   F1 team delete → undo → redo → 重读（P5-005 聚合，原 ID 恢复）
//   F2 round delete → undo → redo → 重读（P5-004 聚合）
//   F3 draw createSession → undo → redo（P5-002 完整字段往返）
//   F4 confirmed session guard（P5-006）+ is_test 会话放行
//   F5 timer 会话在 team undo/redo 后引用完整（原 ID 恢复 → 引用不断裂）
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

class MockDb {
  private raw: DatabaseSync
  memory = false
  constructor() {
    this.raw = new DatabaseSync(':memory:')
    this.raw.exec('PRAGMA foreign_keys = ON')
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

const mockDb = new MockDb()
vi.mock('../../db', () => ({ getDb: () => mockDb }))

// 被测模块（mock 之后导入）
import {
  executeUndo,
  executeRedo,
  withUndoLog,
  collectRoundDeleteSnapshot,
  collectTeamDeleteSnapshot
} from '../undo-service'
import { eventRepo } from '../../db/repository/event.repo'
import { drawRepo } from '../../db/repository/draw.repo'
import { timerSessionRepo } from '../../db/repository/timer-session.repo'

const DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT, end_date TEXT,
    status TEXT, created_at TEXT, allow_repeat INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT, round_number INTEGER, difficulty_override TEXT, topic_count INTEGER,
    is_round_robin INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS team_groups (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY, title TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS team_history (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE ON UPDATE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE ON UPDATE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    played_at TEXT, session_id TEXT, stance TEXT, topic_title TEXT
  );
  CREATE TABLE IF NOT EXISTS draw_sessions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE ON UPDATE CASCADE,
    draw_time TEXT, operator TEXT, settings TEXT
  );
  CREATE TABLE IF NOT EXISTS draw_session_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES draw_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL ON UPDATE CASCADE,
    team_a_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    team_b_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    stance_a TEXT, stance_b TEXT, topic_title TEXT, team_a_name TEXT, team_b_name TEXT,
    team_ids TEXT, team_stances TEXT, team_names TEXT,
    group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE TABLE IF NOT EXISTS topic_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS round_topic_groups (
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (round_id, group_id)
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE ON UPDATE CASCADE,
    match_number INTEGER,
    team_a_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    team_b_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL ON UPDATE CASCADE,
    status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_judges (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
    is_ai INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_judge_votes (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE ON UPDATE CASCADE,
    judge_id TEXT NOT NULL REFERENCES match_judges(id) ON DELETE CASCADE ON UPDATE CASCADE,
    judge_system TEXT NOT NULL DEFAULT 'three_votes', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS undo_log (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, store_name TEXT NOT NULL,
    action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT,
    before_data TEXT, after_data TEXT, payload_size INTEGER NOT NULL DEFAULT 0,
    label TEXT, undone_at TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, action TEXT, target_type TEXT, target_id TEXT,
    operator TEXT, detail TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS timer_sessions (
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
  CREATE TABLE IF NOT EXISTS timer_records (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, stage_index INTEGER NOT NULL,
    stage_name TEXT, side TEXT, duration_ms INTEGER, actual_ms INTEGER,
    started_at TEXT, ended_at TEXT, pause_count INTEGER
  );
`

const EVT = 'evt-1'
const TOPIC = 'topic-1'
const ROUND = 'round-1'

beforeEach(() => {
  mockDb.exec(DDL)
  mockDb.exec(
    'DELETE FROM undo_log; DELETE FROM timer_records; DELETE FROM timer_sessions; ' +
      'DELETE FROM match_judge_votes; DELETE FROM match_judges; DELETE FROM matches; ' +
      'DELETE FROM round_topic_groups; DELETE FROM draw_session_items; DELETE FROM draw_sessions; ' +
      'DELETE FROM team_history; DELETE FROM teams; DELETE FROM team_groups; DELETE FROM rounds; ' +
      'DELETE FROM topic_groups; DELETE FROM topics; DELETE FROM events; DELETE FROM audit_log;'
  )
  mockDb.prepare('INSERT INTO events (id, name) VALUES (?, ?)').run(EVT, '赛事')
  mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run(TOPIC, '辩题')
})

// ---------- handler 复刻（与 event.ipc.ts 一致） ----------

function roundDeleteHandler(id: string) {
  return withUndoLog({
    storeName: 'event',
    action: 'delete',
    targetType: 'round',
    targetId: id,
    label: '删除轮次',
    getBefore: () => collectRoundDeleteSnapshot(id),
    execute: () => eventRepo.deleteRound(id),
    getAfter: () => null
  })
}

function teamDeleteHandler(id: string) {
  return withUndoLog({
    storeName: 'event',
    action: 'delete',
    targetType: 'team',
    targetId: id,
    label: '删除队伍',
    getBefore: () => collectTeamDeleteSnapshot(id),
    execute: () => eventRepo.deleteTeam(id),
    getAfter: () => null
  })
}

function exists(table: string, id: string): boolean {
  return !!mockDb.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)
}

describe('Phase 6.2 链路 F：Undo → Redo → Persistence', () => {
  it('F1 team delete → undo → redo → 重读一致（P5-005）', () => {
    const t1 = eventRepo.createTeam({ name: '甲队', event_id: EVT })
    const t2 = eventRepo.createTeam({ name: '乙队', event_id: EVT })

    teamDeleteHandler(t1.id)
    expect(eventRepo.listTeamsByEvent(EVT).map((t) => t.id)).toEqual([t2.id])

    executeUndo()
    // undo 后重读：原 ID 恢复
    const afterUndo = eventRepo.listTeamsByEvent(EVT).map((t) => t.id)
    expect(afterUndo).toContain(t1.id)
    expect(afterUndo).toContain(t2.id)

    executeRedo()
    // redo 后重读：终态与首次删除一致
    expect(eventRepo.listTeamsByEvent(EVT).map((t) => t.id)).toEqual([t2.id])
  })

  it('F2 round delete → undo → redo → 重读一致（P5-004）', () => {
    mockDb.prepare('INSERT INTO rounds (id, event_id, name, round_number) VALUES (?, ?, ?, 1)').run(ROUND, EVT, '初赛')

    roundDeleteHandler(ROUND)
    expect(exists('rounds', ROUND)).toBe(false)

    executeUndo()
    expect(exists('rounds', ROUND)).toBe(true)

    executeRedo()
    expect(eventRepo.listRoundsByEvent(EVT).map((r) => r.id)).not.toContain(ROUND)
  })

  it('F3 draw createSession → undo → redo：会话与 items 完整字段往返（P5-002）', () => {
    mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run('t1', '甲队', EVT)
    mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run('t2', '乙队', EVT)

    // 经 handler 复刻：create 的 undo payload = 创建结果（含完整 session detail）
    const result = withUndoLog({
      storeName: 'draw',
      action: 'execute',
      targetType: 'session',
      targetId: null,
      label: '执行抽取',
      getBefore: () => null,
      execute: () =>
        drawRepo.createSession({
          event_id: EVT,
          round_id: null,
          items: [
            {
              topic_id: TOPIC,
              team_a_id: 't1',
              team_b_id: 't2',
              stance_a: '正方',
              stance_b: '反方',
              topic_title: '辩题',
              team_a_name: '甲队',
              team_b_name: '乙队'
            }
          ]
        } as never),
      // drawTopics 返回 DrawResult（{ session, items }）；此处以 createSession 的
      // detail 等价包装，匹配 applyDrawReverse 的 after.session.id 消费形状
      getAfter: (r) => ({ session: r })
    })
    const sessionId = (result.result as { id: string }).id
    expect(exists('draw_sessions', sessionId)).toBe(true)

    // undo：会话与 items 删除
    executeUndo()
    expect(exists('draw_sessions', sessionId)).toBe(false)
    expect(
      (mockDb.prepare('SELECT COUNT(*) AS n FROM draw_session_items WHERE session_id = ?').get(sessionId) as { n: number }).n
    ).toBe(0)

    // redo：完整字段重建（P5-002：14 列 items 往返，含 name 快照）
    executeRedo()
    expect(exists('draw_sessions', sessionId)).toBe(true)
    const item = mockDb
      .prepare('SELECT * FROM draw_session_items WHERE session_id = ?')
      .get(sessionId) as Record<string, unknown>
    expect(item.team_a_id).toBe('t1')
    expect(item.team_b_id).toBe('t2')
    expect(item.stance_a).toBe('正方')
    expect(item.stance_b).toBe('反方')
    expect(item.topic_id).toBe(TOPIC)
    expect(item.topic_title).toBe('辩题')
    expect(item.team_a_name).toBe('甲队')
    expect(item.team_b_name).toBe('乙队')
  })

  it('F4 confirmed session 拒绝重删；is_test 会话放行（P5-006）', () => {
    // confirmed 正式会话
    const s1 = drawRepo.createSession({
      event_id: EVT,
      round_id: null,
      items: [{ topic_id: TOPIC }],
      settings: { confirmed: true, is_test: false }
    } as never)
    expect(() => drawRepo.assertSessionNotConfirmed(s1.id)).toThrow(/已确认/)

    // is_test 会话不受守卫限制
    const s2 = drawRepo.createSession({
      event_id: EVT,
      round_id: null,
      items: [{ topic_id: TOPIC }],
      settings: { confirmed: true, is_test: true }
    } as never)
    expect(() => drawRepo.assertSessionNotConfirmed(s2.id)).not.toThrow()
  })

  it('F5 team undo/redo 后 timer 会话引用完整（原 ID 恢复 → 引用不断裂）', () => {
    const t1 = eventRepo.createTeam({ name: '甲队', event_id: EVT })
    const ts = timerSessionRepo.create({
      formatId: 'fmt-1',
      formatSnapshot: { stages: [{ id: 's0', name: '立论', side: 'aff', durationMs: 60000, bells: [] }], totalDurationMs: 60000 },
      teamAffId: t1.id,
      teamAffName: '甲队'
    })

    teamDeleteHandler(t1.id)
    executeUndo() // 原 ID 恢复
    expect(timerSessionRepo.getById(ts.id)?.teamAffId).toBe(t1.id)
    expect(exists('teams', t1.id)).toBe(true)

    executeRedo() // team 再次删除（timer 会话行不受 team FK 级联影响）
    expect(exists('teams', t1.id)).toBe(false)
    // timer 会话仍存在（快照名兜底），引用不悬挂
    const after = timerSessionRepo.getById(ts.id)
    expect(after?.id).toBe(ts.id)
    expect(after?.teamAffName).toBe('甲队')
  })
})
