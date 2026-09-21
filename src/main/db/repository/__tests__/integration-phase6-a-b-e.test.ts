// ============================================================
// integration-phase6-a-b-e.test.ts — Phase 6.2 核心链路集成回归
// （真 SQLite node:sqlite + FK ON + 真 repo/undo-service SQL）
//
// 链路 A：Event → Round → Match（创建/关联/重读 + round 删除聚合 undo）
// 链路 B：Team → Draw → Match（upsertFromDraw 单 match、换边不重复、双名解析）
// 链路 E：Match Result → History（三种 winner + notes 保留 + 重读全链）
//
// 涉及 Phase 5 回归：P5-004（round delete aggregate）、P5-007（order-independent
// upsert）、P5-008（notes preserve）、resolveNames（collectTeamIds）。
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
vi.mock('../../index', () => ({ getDb: () => mockDb }))

// 被测模块（mock 之后导入）
import { eventRepo } from '../event.repo'
import { matchRepo } from '../match.repo'
import { drawRepo } from '../draw.repo'
import {
  executeUndo,
  executeRedo,
  withUndoLog,
  collectRoundDeleteSnapshot
} from '../../../services/undo-service'

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
    stance_a TEXT, stance_b TEXT, draw_item_id TEXT, session_id TEXT, recording_ref TEXT,
    status TEXT NOT NULL DEFAULT 'planned', winner TEXT,
    aff_score REAL, neg_score REAL, best_speaker TEXT, notes TEXT,
    format_id TEXT, judge_system TEXT NOT NULL DEFAULT 'three_votes',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    team_a_name TEXT, team_b_name TEXT, topic_title TEXT, event_name TEXT, round_name TEXT
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
`

const TOPIC = 'topic-1'

beforeEach(() => {
  mockDb.exec(DDL)
  mockDb.exec(
    'DELETE FROM undo_log; DELETE FROM match_judge_votes; DELETE FROM match_judges; DELETE FROM matches; ' +
      'DELETE FROM round_topic_groups; DELETE FROM draw_session_items; DELETE FROM draw_sessions; ' +
      'DELETE FROM team_history; DELETE FROM teams; DELETE FROM team_groups; DELETE FROM rounds; ' +
      'DELETE FROM topic_groups; DELETE FROM topics; DELETE FROM events; DELETE FROM audit_log;'
  )
})

/** 链路 A 完整创建：event → round → match（走真实 repo create） */
function createEventRoundMatch(matchNumber = 1): { eventId: string; roundId: string; matchId: string } {
  const ev = eventRepo.createEvent({ name: '新生赛', status: null, start_date: null, end_date: null })
  const round = eventRepo.createRound({
    event_id: ev.id, name: '初赛', round_number: 1,
    difficulty_override: null, topic_count: null, is_round_robin: false
  })
  const match = matchRepo.create({
    eventId: ev.id,
    roundId: round.id,
    matchNumber
  })
  return { eventId: ev.id, roundId: round.id, matchId: match.id }
}

describe('Phase 6.2 链路 A：Event → Round → Match', () => {
  it('A1/A2 创建后 event/round/match 关联正确', () => {
    const { eventId, roundId, matchId } = createEventRoundMatch()

    const ev = eventRepo.getEventById(eventId)
    expect(ev?.name).toBe('新生赛')
    const rounds = eventRepo.listRoundsByEvent(eventId)
    expect(rounds.map((r) => r.id)).toContain(roundId)
    const match = matchRepo.getById(matchId)
    expect(match?.eventId).toBe(eventId)
    expect(match?.roundId).toBe(roundId)
  })

  it('A3 重新读取（模拟重开）后关系仍正确', () => {
    const { eventId, roundId, matchId } = createEventRoundMatch(2)
    // 全部重新 list/get（新查询，非缓存对象）
    const rounds = eventRepo.listRoundsByEvent(eventId)
    expect(rounds.length).toBe(1)
    expect(rounds[0].event_id).toBe(eventId)
    const match = matchRepo.getById(matchId)
    expect(match?.roundId).toBe(roundId)
    expect(match?.eventId).toBe(eventId)
    expect(match?.matchNumber).toBe(2)
  })

  it('A4 round 删除 → undo 聚合恢复 → redo 再删（P5-004）', () => {
    const { eventId, roundId, matchId } = createEventRoundMatch()
    // match 关联 judge + vote，round 下挂 draw session + item + rtg
    mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run(TOPIC, '辩题')
    mockDb
      .prepare("INSERT INTO match_judges (id, match_id, name, sort_order, is_ai, created_at) VALUES ('mj-1', ?, '裁判一', 0, 0, '2026-01-01')")
      .run(matchId)
    mockDb
      .prepare("INSERT INTO match_judge_votes (id, match_id, judge_id, judge_system, created_at) VALUES ('mv-1', ?, 'mj-1', 'three_votes', '2026-01-01')")
      .run(matchId)
    mockDb
      .prepare("INSERT INTO draw_sessions (id, event_id, round_id, draw_time, operator) VALUES ('ds-1', ?, ?, '2026-01-02T00:00:00Z', 'tester')")
      .run(eventId, roundId)
    mockDb
      .prepare("INSERT INTO draw_session_items (id, session_id, topic_id) VALUES ('dsi-1', 'ds-1', ?)")
      .run(TOPIC)
    mockDb.prepare("INSERT INTO topic_groups (id, name, is_default, created_at) VALUES ('tg-1', '题库一', 0, '2026-01-01')").run()
    mockDb.prepare("INSERT INTO round_topic_groups (round_id, group_id) VALUES (?, 'tg-1')").run(roundId)

    // 删除（经 handler 复刻：快照 + deleteRound 入 undo 栈）
    withUndoLog({
      storeName: 'event',
      action: 'delete',
      targetType: 'round',
      targetId: roundId,
      label: '删除轮次',
      getBefore: () => collectRoundDeleteSnapshot(roundId),
      execute: () => eventRepo.deleteRound(roundId),
      getAfter: () => null
    })
    expect(mockDb.prepare('SELECT 1 FROM rounds WHERE id = ?').get(roundId), 'step:delete-round').toBeUndefined()
    expect(mockDb.prepare('SELECT 1 FROM matches WHERE id = ?').get(matchId), 'step:delete-match').toBeUndefined()
    expect(mockDb.prepare('SELECT 1 FROM match_judges WHERE id = ?').get('mj-1'), 'step:delete-judge').toBeUndefined()
    expect(mockDb.prepare('SELECT 1 FROM draw_sessions WHERE id = ?').get('ds-1'), 'step:delete-session').toBeUndefined()

    // undo：聚合恢复（原 ID）
    expect(() => executeUndo(), 'step:execute-undo').not.toThrow()
    expect(mockDb.prepare('SELECT 1 FROM rounds WHERE id = ?').get(roundId)).toBeTruthy()
    expect(mockDb.prepare('SELECT 1 FROM matches WHERE id = ?').get(matchId)).toBeTruthy()
    expect(mockDb.prepare('SELECT 1 FROM match_judges WHERE id = ?').get('mj-1')).toBeTruthy()
    expect(mockDb.prepare('SELECT 1 FROM match_judge_votes WHERE id = ?').get('mv-1')).toBeTruthy()
    expect(mockDb.prepare('SELECT 1 FROM draw_sessions WHERE id = ?').get('ds-1')).toBeTruthy()
    expect(mockDb.prepare('SELECT 1 FROM draw_session_items WHERE id = ?').get('dsi-1')).toBeTruthy()
    expect(mockDb.prepare("SELECT 1 FROM round_topic_groups WHERE round_id = ? AND group_id = 'tg-1'").get(roundId)).toBeTruthy()

    // redo：再次删除，终态一致
    executeRedo()
    expect(mockDb.prepare('SELECT 1 FROM rounds WHERE id = ?').get(roundId)).toBeUndefined()
    expect(mockDb.prepare('SELECT 1 FROM matches WHERE id = ?').get(matchId)).toBeUndefined()
  })
})

describe('Phase 6.2 链路 B：Team → Draw → Match', () => {
  /** 建赛事/队伍/辩题 + 一个 draw 会话（items A vs B），返回上下文 */
  function seedDrawWithItems(order: 'AB' | 'BA') {
    const ev = eventRepo.createEvent({ name: '联赛', status: null, start_date: null, end_date: null })
    const ta = eventRepo.createTeam({ name: '曙光队', event_id: ev.id })
    const tb = eventRepo.createTeam({ name: '破晓队', event_id: ev.id })
    mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run(TOPIC, '人工智能伦理')
    const [aff, neg] = order === 'AB' ? [ta.id, tb.id] : [tb.id, ta.id]
    const session = drawRepo.createSession({
      event_id: ev.id,
      round_id: null,
      items: [
        {
          topic_id: TOPIC,
          team_a_id: aff,
          team_b_id: neg,
          stance_a: '正方',
          stance_b: '反方'
        }
      ]
    } as never)
    return { eventId: ev.id, teamA: ta.id, teamB: tb.id, sessionId: session.id, aff, neg }
  }

  it('B1/B2 抽取双方生成单条 match；交换顺序重抽不产生重复（P5-007）', () => {
    const ctx = seedDrawWithItems('AB')
    const item = drawRepo.listItemsBySession(ctx.sessionId)[0]
    const m1 = matchRepo.upsertFromDraw({
      eventId: ctx.eventId,
      roundId: null,
      teamAffId: item.team_a_id!,
      teamNegId: item.team_b_id!,
      topicId: item.topic_id!,
      drawItemId: item.id,
      stanceAff: item.stance_a ?? null,
      stanceNeg: item.stance_b ?? null
    })
    expect(m1.teamAffId).toBe(ctx.aff)
    expect(m1.teamNegId).toBe(ctx.neg)

    // 重抽（换边）：B vs A → 仍是同一条 match（order-independent），换边归位
    const item2 = drawRepo.listItemsBySession(ctx.sessionId)[0]
    const m2 = matchRepo.upsertFromDraw({
      eventId: ctx.eventId,
      roundId: null,
      teamAffId: item2.team_b_id!,
      teamNegId: item2.team_a_id!,
      topicId: item2.topic_id!,
      drawItemId: item2.id,
      stanceAff: item2.stance_b ?? null,
      stanceNeg: item2.stance_a ?? null
    })
    expect(m2.id).toBe(m1.id) // 不产生第二条 match
    const all = mockDb.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }
    expect(all.n).toBe(1)
    expect(m2.teamAffId).toBe(ctx.teamB) // 换边归位：team_a 语义=正方
    expect(m2.teamNegId).toBe(ctx.teamA)
  })

  it('B3 读取 match 时 team_a_name / team_b_name 双名解析正确', () => {
    const ctx = seedDrawWithItems('AB')
    const item = drawRepo.listItemsBySession(ctx.sessionId)[0]
    const m = matchRepo.upsertFromDraw({
      eventId: ctx.eventId,
      roundId: null,
      teamAffId: item.team_a_id!,
      teamNegId: item.team_b_id!,
      topicId: item.topic_id!,
      drawItemId: item.id,
      stanceAff: item.stance_a ?? null,
      stanceNeg: item.stance_b ?? null
    })
    expect(m.teamAffName).toBe('曙光队')
    expect(m.teamNegName).toBe('破晓队')
    expect(m.topicTitle).toBe('人工智能伦理')
  })
})

describe('Phase 6.2 链路 E：Match Result → History', () => {
  it('E1/E2/E3 三种 winner 保存 + notes 保留（undefined 不清空）+ 重读全链正确', () => {
    const { eventId, roundId, matchId } = createEventRoundMatch()
    // E1：affirmative
    matchRepo.setResult(matchId, { winner: 'aff', notes: '首回合备注' })
    let m = matchRepo.getById(matchId)
    expect(m?.status).toBe('resulted')
    expect(m?.winner).toBe('aff')
    expect(m?.notes).toBe('首回合备注')

    // E2：更新 winner 不带 notes（undefined）→ notes 保留（P5-008）
    matchRepo.setResult(matchId, { winner: 'neg' })
    m = matchRepo.getById(matchId)
    expect(m?.winner).toBe('neg')
    expect(m?.notes).toBe('首回合备注')

    // E2 补充：显式 null 清空；draw 场景 winner 正确保存
    matchRepo.setResult(matchId, { winner: 'draw', notes: null })
    m = matchRepo.getById(matchId)
    expect(m?.winner).toBe('draw')
    expect(m?.notes).toBeNull()

    // E3：重新读取后 result/notes/team/round/event 关系仍正确
    matchRepo.setResult(matchId, { winner: 'aff', notes: '定稿' })
    const final = matchRepo.getById(matchId)
    expect(final?.eventId).toBe(eventId)
    expect(final?.roundId).toBe(roundId)
    expect(final?.winner).toBe('aff')
    expect(final?.notes).toBe('定稿')
    expect(final?.status).toBe('resulted')
  })
})
