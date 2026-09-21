// ============================================================
// round-team-delete-undo.test.ts — P5-004 + P5-005 删除聚合撤销回归
// （真 SQLite roundtrip，FK ON）
//
// 覆盖：
//   1. ROUND_DELETE→UNDO：round/match/judge/vote/draw_session(+item)/rtg
//      逐项恢复 + 原 ID + 关系指向断言
//   2. ROUND_DELETE→UNDO→REDO：终态与首次删除一致（无残留）
//   3. TEAM_DELETE→UNDO：team/team_history/group_id/match+item 归属恢复
//   4. TEAM_DELETE→UNDO→REDO：终态与首次删除一致
//   5. undo stack progression：操作A → delete → UNDO（markUndone）→ UNDO 进入 A
//   6. 事务失败：恢复中途 FK 违规 → 无半恢复 + 标记不变
//   7. 旧格式 plain payload 兼容：主体恢复、不抛错
//
// 引擎：node:sqlite DatabaseSync（FK 默认开启）。matches 列集为精简版
// （生产 20260904 全列 + 20260916 的 FK 语义：round_id CASCADE、
// team_a_id/team_b_id SET NULL、event_id CASCADE、topic_id SET NULL），
// 聚合重建走 insertRawRows 动态列，快照行与测试 DDL 列集天然一致。
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
import { undoLogRepo } from '../../db/repository/undo-log.repo'

const DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT
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
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
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
  CREATE TABLE IF NOT EXISTS round_topic_groups (
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (round_id, group_id)
  );
  CREATE TABLE IF NOT EXISTS topic_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT
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
`

const EVT = 'evt-1'
const GRP = 'grp-1'
const TOPIC = 'topic-1'
const ROUND = 'round-1'

beforeEach(() => {
  mockDb.exec(DDL)
  // 模块级单例连接：先清数据再种子化（FK 顺序：子表在前）
  mockDb.exec(
    'DELETE FROM undo_log; DELETE FROM match_judge_votes; DELETE FROM match_judges; DELETE FROM matches; ' +
      'DELETE FROM round_topic_groups; DELETE FROM draw_session_items; DELETE FROM draw_sessions; ' +
      'DELETE FROM team_history; DELETE FROM teams; DELETE FROM team_groups; DELETE FROM rounds; ' +
      'DELETE FROM topic_groups; DELETE FROM topics; DELETE FROM events;'
  )
  mockDb.prepare('INSERT INTO events (id, name) VALUES (?, ?)').run(EVT, '赛事')
  mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run(TOPIC, '辩题')
  mockDb
    .prepare('INSERT INTO topic_groups (id, name, is_default) VALUES (?, ?, 0)')
    .run('tg-1', '题库一')
})

// ---------- handler 复刻（与 event.ipc.ts 逐字段一致） ----------

function roundDeleteHandler(id: string) {
  return withUndoLog({
    storeName: 'event',
    action: 'delete',
    targetType: 'round',
    targetId: id,
    label: `删除轮次`,
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
    label: `删除队伍`,
    getBefore: () => collectTeamDeleteSnapshot(id),
    execute: () => eventRepo.deleteTeam(id),
    getAfter: () => null
  })
}

// ---------- 种子 ----------

function seedRound(id: string): void {
  mockDb
    .prepare('INSERT INTO rounds (id, event_id, name, round_number) VALUES (?, ?, ?, 1)')
    .run(id, EVT, '初赛')
}

function seedTeam(id: string, name: string, groupId: string | null): void {
  mockDb
    .prepare('INSERT INTO teams (id, name, event_id, group_id) VALUES (?, ?, ?, ?)')
    .run(id, name, EVT, groupId)
}

function seedMatch(id: string, roundId: string | null, teamA: string | null, teamB: string | null): void {
  mockDb
    .prepare(
      "INSERT INTO matches (id, event_id, round_id, team_a_id, team_b_id, topic_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'planned', '2026-01-01', '2026-01-01')"
    )
    .run(id, EVT, roundId, teamA, teamB, TOPIC)
}

function seedJudge(id: string, matchId: string): void {
  mockDb
    .prepare(
      "INSERT INTO match_judges (id, match_id, name, sort_order, is_ai, created_at) VALUES (?, ?, '裁判', 0, 0, '2026-01-01')"
    )
    .run(id, matchId)
}

function seedVote(id: string, matchId: string, judgeId: string): void {
  mockDb
    .prepare(
      "INSERT INTO match_judge_votes (id, match_id, judge_id, judge_system, created_at) VALUES (?, ?, ?, 'three_votes', '2026-01-01')"
    )
    .run(id, matchId, judgeId)
}

function seedDrawSession(id: string, roundId: string | null, itemId: string): void {
  mockDb
    .prepare('INSERT INTO draw_sessions (id, event_id, round_id, draw_time, operator) VALUES (?, ?, ?, ?, ?)')
    .run(id, EVT, roundId, '2026-01-02T00:00:00.000Z', 'tester')
  mockDb
    .prepare(
      'INSERT INTO draw_session_items (id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(itemId, id, TOPIC, 't1', 't2', '正方', '反方')
}

function seedRoundTopicGroup(roundId: string): void {
  mockDb.prepare('INSERT INTO round_topic_groups (round_id, group_id) VALUES (?, ?)').run(roundId, 'tg-1')
}

function seedTeamHistory(id: string, teamId: string): void {
  mockDb
    .prepare(
      "INSERT INTO team_history (id, team_id, topic_id, event_id, played_at, session_id, stance, topic_title) VALUES (?, ?, ?, ?, '2026-01-03', NULL, '正方', '辩题')"
    )
    .run(id, teamId, TOPIC, EVT)
}

function exists(table: string, id: string): boolean {
  return !!mockDb.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)
}

function getUndoneAt(logId: string): string | null {
  const row = mockDb.prepare('SELECT undone_at FROM undo_log WHERE id = ?').get(logId) as
    | { undone_at: string | null }
    | undefined
  return row?.undone_at ?? null
}

beforeEach(() => {
  // 公共种子：分组 + 两队（含 team_history）
  mockDb
    .prepare('INSERT INTO team_groups (id, event_id, name, sort_order, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(GRP, EVT, 'A 组', '2026-01-01T00:00:00.000Z')
  seedTeam('t1', '队伍一', GRP)
  seedTeam('t2', '队伍二', null)
  seedTeamHistory('th-1', 't1')
})

describe('P5-004 ROUND_DELETE 聚合撤销（真 SQLite）', () => {
  it('DELETE→UNDO：round/match/judge/vote/draw_session/item/rtg 逐项恢复 + 原 ID + 关系指向', () => {
    seedRound(ROUND)
    seedRoundTopicGroup(ROUND)
    seedMatch('m-1', ROUND, 't1', 't2')
    seedJudge('j-1', 'm-1')
    seedVote('v-1', 'm-1', 'j-1')
    seedDrawSession('ds-1', ROUND, 'di-1')

    roundDeleteHandler(ROUND)
    // 删除生效（CASCADE 全链）
    for (const [t, id] of [
      ['rounds', ROUND],
      ['matches', 'm-1'],
      ['match_judges', 'j-1'],
      ['match_judge_votes', 'v-1'],
      ['draw_sessions', 'ds-1'],
      ['draw_session_items', 'di-1']
    ] as const) {
      expect(exists(t, id)).toBe(false)
    }
    expect(
      mockDb.prepare('SELECT COUNT(*) AS n FROM round_topic_groups WHERE round_id = ?').get(ROUND)
    ).toEqual({ n: 0 })

    executeUndo()

    // 全部恢复且原 ID 保持
    expect(exists('rounds', ROUND)).toBe(true)
    expect(exists('matches', 'm-1')).toBe(true)
    expect(exists('match_judges', 'j-1')).toBe(true)
    expect(exists('match_judge_votes', 'v-1')).toBe(true)
    expect(exists('draw_sessions', 'ds-1')).toBe(true)
    expect(exists('draw_session_items', 'di-1')).toBe(true)
    expect(
      mockDb.prepare('SELECT COUNT(*) AS n FROM round_topic_groups WHERE round_id = ?').get(ROUND)
    ).toEqual({ n: 1 })
    // 关系指向原 round
    expect(
      (mockDb.prepare('SELECT round_id FROM matches WHERE id = ?').get('m-1') as { round_id: string }).round_id
    ).toBe(ROUND)
    expect(
      (mockDb.prepare('SELECT round_id FROM draw_sessions WHERE id = ?').get('ds-1') as { round_id: string }).round_id
    ).toBe(ROUND)
  })

  it('DELETE→UNDO→REDO：终态与首次删除一致（无残留）', () => {
    seedRound(ROUND)
    seedRoundTopicGroup(ROUND)
    seedMatch('m-1', ROUND, 't1', 't2')
    seedJudge('j-1', 'm-1')
    seedVote('v-1', 'm-1', 'j-1')
    seedDrawSession('ds-1', ROUND, 'di-1')

    roundDeleteHandler(ROUND)
    executeUndo()
    executeRedo()

    for (const [t, id] of [
      ['rounds', ROUND],
      ['matches', 'm-1'],
      ['match_judges', 'j-1'],
      ['match_judge_votes', 'v-1'],
      ['draw_sessions', 'ds-1'],
      ['draw_session_items', 'di-1']
    ] as const) {
      expect(exists(t, id)).toBe(false)
    }
    expect(
      mockDb.prepare('SELECT COUNT(*) AS n FROM round_topic_groups WHERE round_id = ?').get(ROUND)
    ).toEqual({ n: 0 })
  })
})

describe('P5-005 TEAM_DELETE 聚合撤销（真 SQLite）', () => {
  it('DELETE→UNDO：team/team_history 原行恢复 + group_id 归属恢复', () => {
    // t1 已有 group 归属（GRP）与 team_history（th-1）
    teamDeleteHandler('t1')
    expect(exists('teams', 't1')).toBe(false)
    expect(exists('team_history', 'th-1')).toBe(false)

    executeUndo()

    expect(exists('teams', 't1')).toBe(true)
    expect(exists('team_history', 'th-1')).toBe(true)
    expect(
      (mockDb.prepare('SELECT group_id FROM teams WHERE id = ?').get('t1') as { group_id: string }).group_id
    ).toBe(GRP)
  })

  it('DELETE→UNDO→REDO：终态与首次删除一致（team/history gone、归属清空）', () => {
    seedMatch('m-1', null, 't1', 't2')
    seedDrawSession('ds-1', null, 'di-1')

    teamDeleteHandler('t1')
    executeUndo()
    executeRedo()

    expect(exists('teams', 't1')).toBe(false)
    expect(exists('team_history', 'th-1')).toBe(false)
    expect(
      (mockDb.prepare('SELECT team_a_id FROM matches WHERE id = ?').get('m-1') as { team_a_id: string | null }).team_a_id
    ).toBeNull()
    expect(
      (mockDb.prepare('SELECT team_a_id FROM draw_session_items WHERE id = ?').get('di-1') as { team_a_id: string | null }).team_a_id
    ).toBeNull()
  })

  it('SET NULL 归属恢复：match 与 draw_session_item 的 team_a_id 回填', () => {
    seedMatch('m-1', null, 't1', 't2')
    seedDrawSession('ds-1', null, 'di-1')

    teamDeleteHandler('t1')
    // 删除生效：match/item 的 team_a_id 被 SET NULL
    expect(
      (mockDb.prepare('SELECT team_a_id FROM matches WHERE id = ?').get('m-1') as { team_a_id: string | null }).team_a_id
    ).toBeNull()

    executeUndo()
    expect(
      (mockDb.prepare('SELECT team_a_id FROM matches WHERE id = ?').get('m-1') as { team_a_id: string | null }).team_a_id
    ).toBe('t1')
    expect(
      (mockDb.prepare('SELECT team_a_id FROM draw_session_items WHERE id = ?').get('di-1') as { team_a_id: string | null }).team_a_id
    ).toBe('t1')
    // t2 作为 team_b_id 不受影响
    expect(
      (mockDb.prepare('SELECT team_b_id FROM matches WHERE id = ?').get('m-1') as { team_b_id: string | null }).team_b_id
    ).toBe('t2')
  })

  it('group 已被删时：group_id 按 SET NULL 语义置 null（不伪造悬挂引用）', () => {
    teamDeleteHandler('t1')
    executeUndo()
    // undo 后 group 仍存在 → group_id 恢复
    expect(
      (mockDb.prepare('SELECT group_id FROM teams WHERE id = ?').get('t1') as { group_id: string }).group_id
    ).toBe(GRP)

    // 再删 team → 删 group → redo（重放 team 删除，group 引用无关）
    teamDeleteHandler('t1')
    mockDb.prepare('DELETE FROM team_groups WHERE id = ?').run(GRP)
    // undo：group 不存在 → group_id 置 null
    executeUndo()
    expect(exists('teams', 't1')).toBe(true)
    expect(
      (mockDb.prepare('SELECT group_id FROM teams WHERE id = ?').get('t1') as { group_id: string | null }).group_id
    ).toBeNull()
    executeRedo()
  })
})

describe('通用回归', () => {
  it('undo stack progression：操作A → ROUND_DELETE → UNDO（标记）→ UNDO 进入 A', () => {
    seedRound(ROUND)
    // 操作 A：round create（更早）
    const opA = withUndoLog({
      storeName: 'event',
      action: 'create',
      targetType: 'round',
      targetId: null,
      label: '创建轮次',
      getBefore: () => null,
      execute: () =>
        eventRepo.createRound({ event_id: EVT, name: 'R2', round_number: 2, topic_count: null, difficulty_override: null }),
      getAfter: (result) => result
    })
    expect(opA.logId).toBeTruthy()
    // 操作 B（最新）：round delete（删除另一个轮次）
    const opB = roundDeleteHandler(ROUND)
    expect(opB.logId).toBeTruthy()

    // 规避同毫秒排序平局：A 调到 B 前 1ms（不能久远——RETENTION_MS=30 天会清理）
    const bRow = mockDb.prepare('SELECT created_at FROM undo_log WHERE id = ?').get(opB.logId) as {
      created_at: string
    }
    mockDb
      .prepare('UPDATE undo_log SET created_at = ? WHERE id = ?')
      .run(new Date(Date.parse(bRow.created_at) - 1).toISOString(), opA.logId)

    // 第一次 UNDO：命中 B（round delete），成功且 markUndone
    const r1 = executeUndo()
    expect(r1.logId).toBe(opB.logId)
    if (!opA.logId || !opB.logId) throw new Error('undo log 未创建')
    expect(getUndoneAt(opB.logId)).toBeTruthy()

    // 第二次 UNDO：进入 A（撤销 round create）
    const r2 = executeUndo()
    expect(r2.logId).toBe(opA.logId)
    expect(exists('rounds', 'R2-id')).toBe(false)
  })

  it('事务失败：聚合恢复中途 FK 违规 → 无半恢复 + 标记不变', () => {
    seedRound(ROUND)
    teamDeleteHandler('t1')
    expect(exists('teams', 't1')).toBe(false)

    // 时钟确定性（历史 flaky 根因修复）：L1 与 ghost 均显式钉死 created_at。
    // 若 L1 用真实时钟（远晚于 2026-01-01），getLatest(created_at DESC) 会返回 L1
    // 而非 ghost → undo 成功不抛错；且 L1/ghost 同毫秒创建时 DESC 平局会误选目标行。
    // 钉死顺序 L1(0s) < ghost(+10s)，保证 executeUndo 稳定命中 ghost。
    mockDb
      .prepare("UPDATE undo_log SET created_at = '2026-01-01T00:00:00.000Z' WHERE target_id = 't1'")
      .run()

    // 手工构造坏 payload：teamHistory 行引用不存在的 team（FK 违规注入）
    undoLogRepo.createLog({
      store_name: 'event',
      action: 'delete',
      target_type: 'team',
      target_id: 't-ghost',
      before_data: {
        team: { id: 't-ghost', name: '幽灵队', event_id: EVT, group_id: null },
        teamHistory: [{ id: 'th-ghost', team_id: 't-ghost-2', topic_id: TOPIC, event_id: EVT }],
        matchTeamAIds: [],
        matchTeamBIds: [],
        itemTeamAIds: [],
        itemTeamBIds: []
      },
      after_data: null,
      label: '坏 payload'
    })
    const logId = (
      mockDb.prepare('SELECT id FROM undo_log ORDER BY created_at DESC LIMIT 1').get() as { id: string }
    ).id
    // 确保 ghost log 是 latest（+10s 规避同毫秒平局）
    mockDb
      .prepare('UPDATE undo_log SET created_at = ? WHERE id = ?')
      .run(new Date(Date.parse('2026-01-01T00:00:10.000Z')).toISOString(), logId)
    expect(getUndoneAt(logId)).toBeNull()

    // executeUndo：team 本体插入成功 → team_history FK 违规 → 整体回滚
    expect(() => executeUndo()).toThrow()
    // 无半恢复：t-ghost 未留下；log 未被标记撤销
    expect(exists('teams', 't-ghost')).toBe(false)
    expect(exists('team_history', 'th-ghost')).toBe(false)
    expect(getUndoneAt(logId)).toBeNull()
  })

  it('旧格式 plain payload 兼容：round/team 单行主体恢复，不抛错', () => {
    // 旧格式 round：plain 单行（无聚合结构）；字段需完整（生产行来自 SELECT *）
    seedRound('round-legacy')
    undoLogRepo.createLog({
      store_name: 'event',
      action: 'delete',
      target_type: 'round',
      target_id: 'round-legacy',
      before_data: {
        id: 'round-legacy',
        event_id: EVT,
        name: '旧轮次',
        round_number: 9,
        difficulty_override: null,
        topic_count: null,
        is_round_robin: 0
      },
      after_data: null,
      label: '旧格式删除轮次'
    })
    eventRepo.deleteRound('round-legacy')
    executeUndo()
    expect(exists('rounds', 'round-legacy')).toBe(true)

    // 旧格式 team：plain 单行
    seedTeam('t-legacy', '旧队伍', null)
    undoLogRepo.createLog({
      store_name: 'event',
      action: 'delete',
      target_type: 'team',
      target_id: 't-legacy',
      before_data: { id: 't-legacy', name: '旧队伍', event_id: EVT, group_id: null },
      after_data: null,
      label: '旧格式删除队伍'
    })
    eventRepo.deleteTeam('t-legacy')
    executeUndo()
    expect(exists('teams', 't-legacy')).toBe(true)
  })
})
