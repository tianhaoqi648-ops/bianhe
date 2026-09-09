// ============================================================
// event-undo-aggregate.test.ts — Event 聚合快照 Undo（Phase 1.1-fix R1/R3）
//
// 真实 SQLite 回归测试：删除 Event → Undo 必须完整恢复全部 CASCADE 子表。
//
// 覆盖：
//   Test A：完整聚合（rounds/teams/team_history/event_topic_groups/
//           draw_sessions+items/round_topic_groups/matches 三表）→ 删 → undo
//           → 13 表行数/原 id/allow_repeat/bank_config 全恢复
//   Test B：空子表（仅 teams）→ 删 → undo → 恢复
//   Test C：快照被破坏（teams.name=null 违反 NOT NULL）→ executeUndo 抛错
//           → 无半恢复（events 0 行）+ undone_at 仍 NULL（事务回滚生效）
//   Test D（R3）：真实 createEventWithDefaultGroup → logEventCreateSnapshot
//           → undo → events/teams/绑定全清（CASCADE）→ redo → 完整重建
//
// 架构：node:sqlite DatabaseSync 真实引擎；vi.mock('../db') 与
//       vi.mock('../index') 指向同一物理文件 src/main/db/index.ts，
//       一个 mock 覆盖 undo-service 与全部 repo 的 getDb（repo 真跑）。
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

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

// 惰性单例（避免 vi.hoisted TDZ）
let dbInstance: MockDb | null = null
function ensureDb(): MockDb {
  if (!dbInstance) dbInstance = new MockDb()
  return dbInstance
}

// undo-service 用 '../db'；各 repo 用 '../index'——均解析到 src/main/db/index.ts
//（vi.mock 相对路径基于本测试文件：__tests__/../.. = src/main，故用 '../../db'/'../../index'）
vi.mock('../../db', () => ({ getDb: () => ensureDb() }))
vi.mock('../../index', () => ({ getDb: () => ensureDb() }))

// 真实模块（不 mock repo——真跑 SQL）
import {
  withUndoLog,
  executeUndo,
  executeRedo,
  collectEventAggregateSnapshot,
  logEventCreateSnapshot
} from '../undo-service'
import { eventRepo } from '../../db/repository/event.repo'
import { createEvent as createEventWithDefaultGroup } from '../event-service'

// ---- DDL（与 schema.sql/迁移同源的必要列） ----
const DDL = `
  CREATE TABLE IF NOT EXISTS undo_log (
    id TEXT PRIMARY KEY, created_at TEXT, store_name TEXT, action TEXT,
    target_type TEXT, target_id TEXT, before_data TEXT, after_data TEXT,
    payload_size INTEGER, label TEXT, undone_at TEXT
  );
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY, title TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS topic_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, is_default INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT, end_date TEXT,
    status TEXT, created_at TEXT,
    allow_repeat INTEGER NOT NULL DEFAULT 0, bank_config TEXT
  );
  CREATE TABLE IF NOT EXISTS team_groups (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT, round_number INTEGER, difficulty_override TEXT, topic_count INTEGER,
    is_round_robin INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS team_history (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE ON UPDATE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
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
    topic_id TEXT, team_a_id TEXT, team_b_id TEXT, stance_a TEXT, stance_b TEXT,
    topic_title TEXT, team_a_name TEXT, team_b_name TEXT,
    team_ids TEXT, team_stances TEXT, team_names TEXT, group_id TEXT
  );
  CREATE TABLE IF NOT EXISTS event_topic_groups (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    group_id TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (event_id, group_id)
  );
  CREATE TABLE IF NOT EXISTS round_topic_groups (
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE ON UPDATE CASCADE,
    group_id TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (round_id, group_id)
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    round_id TEXT, match_number INTEGER, team_a_id TEXT, team_b_id TEXT, topic_id TEXT,
    stance_a TEXT, stance_b TEXT, draw_item_id TEXT, session_id TEXT, recording_ref TEXT,
    status TEXT NOT NULL DEFAULT 'planned', winner TEXT, aff_score REAL, neg_score REAL,
    best_speaker TEXT, notes TEXT, ai_review TEXT, created_at TEXT, updated_at TEXT,
    team_a_name TEXT, team_b_name TEXT, topic_title TEXT, event_name TEXT, round_name TEXT,
    recording_meta TEXT, judge_system TEXT
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
    judge_system TEXT NOT NULL DEFAULT 'three_votes',
    impression_vote TEXT, decision_vote TEXT, aff_total REAL, neg_total REAL,
    stage_scores TEXT, best_speaker TEXT, comment TEXT,
    created_at TEXT, updated_at TEXT
  );
`

function rebuildSchema(): void {
  const db = ensureDb()
  for (const t of [
    'match_judge_votes',
    'match_judges',
    'matches',
    'draw_session_items',
    'draw_sessions',
    'team_history',
    'round_topic_groups',
    'event_topic_groups',
    'teams',
    'team_groups',
    'rounds',
    'topics',
    'topic_groups',
    'events',
    'undo_log'
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${t}`)
  }
  db.exec(DDL)
}

function count(table: string): number {
  return (ensureDb().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
}

/** seed 完整聚合：event(allow_repeat=1,bank_config) + 各子表 */
function seedFullAggregate(): string {
  const db = ensureDb()
  const eid = 'ev-full'
  db.prepare(
    "INSERT INTO events (id, name, start_date, end_date, status, created_at, allow_repeat, bank_config) VALUES (?, '全量赛事', '2026-09-01', NULL, 'active', '2026-09-09T00:00:00Z', 1, '{\"mode\":\"pool\"}')"
  ).run(eid)
  db.prepare("INSERT INTO topics (id, title, created_at) VALUES ('topic-1', '示例辩题', '2026-09-01T00:00:00Z')").run()
  db.prepare("INSERT INTO topic_groups (id, name, is_default, created_at) VALUES ('tgroup-1', '默认题库', 1, '2026-09-01T00:00:00Z')").run()
  db.prepare("INSERT INTO team_groups (id, event_id, name, sort_order, created_at) VALUES ('tg-1', ?, '正方组', 0, '2026-09-09T00:00:00Z')").run(eid)
  db.prepare("INSERT INTO teams (id, name, event_id, group_id) VALUES ('team-1', '清华队', ?, 'tg-1')").run(eid)
  db.prepare("INSERT INTO teams (id, name, event_id, group_id) VALUES ('team-2', '北大队', ?, NULL)").run(eid)
  db.prepare("INSERT INTO rounds (id, event_id, name, round_number, difficulty_override, topic_count, is_round_robin) VALUES ('round-1', ?, '初赛', 1, NULL, 2, 1)").run(eid)
  db.prepare("INSERT INTO round_topic_groups (round_id, group_id) VALUES ('round-1', 'tgroup-1')").run()
  db.prepare("INSERT INTO event_topic_groups (event_id, group_id) VALUES (?, 'tgroup-1')").run(eid)
  db.prepare(
    "INSERT INTO team_history (id, team_id, topic_id, event_id, played_at, session_id, stance, topic_title) VALUES ('th-1', 'team-1', 'topic-1', ?, '2026-09-09T01:00:00Z', 'ds-1', '正方', '示例辩题')"
  ).run(eid)
  db.prepare(
    "INSERT INTO draw_sessions (id, event_id, round_id, draw_time, operator, settings) VALUES ('ds-1', ?, 'round-1', '2026-09-09T01:00:00Z', 'manual', '{\"confirmed\":true}')"
  ).run(eid)
  db.prepare(
    "INSERT INTO draw_session_items (id, session_id, topic_id, team_a_id, team_b_id, stance_a, stance_b, topic_title, team_a_name, team_b_name, team_ids, team_stances, team_names, group_id) VALUES ('dsi-1', 'ds-1', 'topic-1', 'team-1', 'team-2', '正方', '反方', '示例辩题', '清华队', '北大队', '[\"team-1\",\"team-2\"]', '[\"正方\",\"反方\"]', '[\"清华队\",\"北大队\"]', NULL)"
  ).run()
  db.prepare(
    "INSERT INTO matches (id, event_id, round_id, match_number, team_a_id, team_b_id, topic_id, status, judge_system, created_at, updated_at) VALUES ('m-1', ?, 'round-1', 1, 'team-1', 'team-2', 'topic-1', 'planned', 'three_votes', '2026-09-09T01:00:00Z', '2026-09-09T01:00:00Z')"
  ).run(eid)
  db.prepare(
    "INSERT INTO match_judges (id, match_id, name, sort_order, is_ai, created_at) VALUES ('mj-1', 'm-1', '裁判A', 0, 0, '2026-09-09T01:00:00Z')"
  ).run()
  db.prepare(
    "INSERT INTO match_judge_votes (id, match_id, judge_id, judge_system, decision_vote, created_at, updated_at) VALUES ('mv-1', 'm-1', 'mj-1', 'three_votes', 'aff', '2026-09-09T01:00:00Z', '2026-09-09T01:00:00Z')"
  ).run()
  return eid
}

/** 模拟 EVENT_DELETE ipc 路径：快照 + 删除（与 event.ipc.ts 一致） */
function deleteEventViaUndoPath(id: string): void {
  withUndoLog({
    storeName: 'event',
    action: 'delete',
    targetType: 'event',
    targetId: id,
    label: `删除赛事（测试）`,
    getBefore: () => collectEventAggregateSnapshot(id),
    execute: () => eventRepo.deleteEvent(id),
    getAfter: () => null
  })
}

beforeEach(() => {
  rebuildSchema()
})

describe('R1：删 Event → Undo 完整聚合恢复（真实 SQLite）', () => {
  it('Test A：完整聚合删除后 undo，13 表全部按原 id 恢复（含 allow_repeat/bank_config）', () => {
    const eid = seedFullAggregate()

    // 删除前快照内容诊断
    const snap = collectEventAggregateSnapshot(eid)
    expect(snap).not.toBeNull()
    expect(snap!.roundTopicGroups.length).toBe(1)
    expect(snap!.matches.length).toBe(1)

    // 删除：全部 CASCADE 子表清空
    deleteEventViaUndoPath(eid)
    for (const t of [
      'events',
      'rounds',
      'team_groups',
      'teams',
      'team_history',
      'draw_sessions',
      'draw_session_items',
      'event_topic_groups',
      'round_topic_groups',
      'matches',
      'match_judges',
      'match_judge_votes'
    ]) {
      expect(count(t), `${t} 删除后应为 0`).toBe(0)
    }

    // Undo：完整恢复
    const result = executeUndo()
    expect(result.affectedCount).toBe(1)

    expect(count('events')).toBe(1)
    expect(count('rounds')).toBe(1)
    expect(count('team_groups')).toBe(1)
    expect(count('teams')).toBe(2)
    expect(count('team_history')).toBe(1)
    expect(count('draw_sessions')).toBe(1)
    expect(count('draw_session_items')).toBe(1)
    expect(count('event_topic_groups')).toBe(1)
    expect(count('round_topic_groups')).toBe(1)
    expect(count('matches')).toBe(1)
    expect(count('match_judges')).toBe(1)
    expect(count('match_judge_votes')).toBe(1)

    // event 主行：allow_repeat 与 bank_config 保持原值（R1 修复点）
    const ev = ensureDb()
      .prepare('SELECT id, name, allow_repeat, bank_config FROM events WHERE id = ?')
      .get(eid) as { id: string; name: string; allow_repeat: number; bank_config: string }
    expect(ev.id).toBe(eid)
    expect(ev.allow_repeat).toBe(1)
    expect(ev.bank_config).toBe('{"mode":"pool"}')

    // 子表原 id 保持 + 外键关系恢复
    const round = ensureDb().prepare('SELECT id, event_id, is_round_robin FROM rounds').get() as {
      id: string
      event_id: string
      is_round_robin: number
    }
    expect(round.id).toBe('round-1')
    expect(round.event_id).toBe(eid)
    expect(round.is_round_robin).toBe(1)
    const team = ensureDb()
      .prepare('SELECT id, group_id FROM teams WHERE id = ?')
      .get('team-1') as { id: string; group_id: string | null }
    expect(team.group_id).toBe('tg-1')
    const item = ensureDb().prepare('SELECT topic_title FROM draw_session_items').get() as {
      topic_title: string
    }
    expect(item.topic_title).toBe('示例辩题')
  })

  it('Test B：空子表（仅 teams）的 event 删除后 undo 正常恢复', () => {
    const db = ensureDb()
    db.prepare(
      "INSERT INTO events (id, name, created_at, allow_repeat) VALUES ('ev-empty', '空赛事', '2026-09-09T00:00:00Z', 0)"
    ).run()
    db.prepare("INSERT INTO teams (id, name, event_id) VALUES ('team-e1', '唯一队', 'ev-empty')").run()

    deleteEventViaUndoPath('ev-empty')
    expect(count('events')).toBe(0)
    expect(count('teams')).toBe(0)

    executeUndo()
    expect(count('events')).toBe(1)
    expect(count('teams')).toBe(1)
    const ev = db
      .prepare('SELECT allow_repeat FROM events WHERE id = ?')
      .get('ev-empty') as { allow_repeat: number }
    expect(ev.allow_repeat).toBe(0)
  })

  it('Test C：快照被破坏 → undo 抛错且无半恢复（事务回滚生效）', () => {
    const eid = seedFullAggregate()
    deleteEventViaUndoPath(eid)
    expect(count('events')).toBe(0)

    // 篡改 undo_log 的 before_data：teams 行 name=null 违反 NOT NULL
    const broken = {
      event: { id: eid, name: '全量赛事', allow_repeat: 1, bank_config: null },
      rounds: [],
      teamGroups: [],
      teams: [{ id: 'team-x', name: null, event_id: eid, group_id: null }],
      teamHistory: [],
      drawSessions: [],
      eventTopicGroups: [],
      roundTopicGroups: [],
      matches: [],
      matchJudges: [],
      matchJudgeVotes: []
    }
    ensureDb()
      .prepare('UPDATE undo_log SET before_data = ?')
      .run(JSON.stringify(broken))

    expect(() => executeUndo()).toThrow()

    // 回滚验证：无半恢复（event 未被恢复）+ undo_log 未标记已撤销（可重试）
    expect(count('events')).toBe(0)
    expect(count('teams')).toBe(0)
    const log = ensureDb()
      .prepare('SELECT undone_at FROM undo_log ORDER BY created_at DESC LIMIT 1')
      .get() as { undone_at: string | null }
    expect(log.undone_at).toBeNull()
  })
})

describe('R3：创建赛事统一 undo 语义（真实 SQLite）', () => {
  it('Test D：createEventWithDefaultGroup → logEventCreateSnapshot → undo 全清 → redo 完整重建', () => {
    // 真实创建（含默认题库绑定）
    const ev = createEventWithDefaultGroup({ name: '导入赛事', start_date: null, end_date: null, status: null })
    expect(count('events')).toBe(1)
    expect(count('event_topic_groups')).toBe(1)

    // R3 接入：先补齐 batch 场景的追加数据（建队），再登记聚合快照
    //（快照语义 = 登记时刻的完整聚合；undo 清场 / redo 按快照重建）
    ensureDb()
      .prepare("INSERT INTO teams (id, name, event_id) VALUES ('team-late', '后建队', ?)")
      .run(ev.id)
    expect(count('teams')).toBe(1)
    const logId = logEventCreateSnapshot(ev.id)
    expect(logId).not.toBeNull()

    // undo：create 的反向 = deleteEvent（CASCADE 清场）
    const result = executeUndo()
    expect(result.affectedCount).toBe(1)
    expect(count('events')).toBe(0)
    expect(count('teams')).toBe(0)
    expect(count('event_topic_groups')).toBe(0)

    // redo：create 的正向 = 聚合快照完整重建（含创建后追加的 team）
    const redo = executeRedo()
    expect(redo.affectedCount).toBe(1)
    expect(count('events')).toBe(1)
    expect(count('teams')).toBe(1)
    expect(count('event_topic_groups')).toBe(1)
  })

  it('Test E（logId 兜底）：对不存在的 event 登记 → 返回 null', () => {
    const logId = logEventCreateSnapshot('ev-not-exist')
    expect(logId).toBeNull()
  })
})
