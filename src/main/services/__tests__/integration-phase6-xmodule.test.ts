// ============================================================
// integration-phase6-xmodule.test.ts — Phase 6.3 跨模块组合场景集成回归
// （真 SQLite node:sqlite + FK ON + 真 repo/undo-service/backup-service）
//
// 场景 A：Event 聚合删除 → FK 级联 → Undo/Redo 往返 → 业务可继续
//         （timer_sessions 无 FK 有意排除在快照外，行保留）
// 场景 B：Draw → Match → Timer → Result 全链（B1~B8）：
//         绑定一致性 + 计时记录持久化 + notes 保留（P5-008）
// 场景 C：Undo/Redo 后业务可继续（C1 Draw / C2 Round / C3 Team）
// 场景 D：双轮备份往返（export → 变化 → import → 再变化 → export B →
//         再变化 → import B），含 BUG-P6-001 回归锚点
//         （timer_sessions.match_id 非空且指向存在的 match）
//
// 架构：node:sqlite DatabaseSync :memory:；vi.mock('../../db') 指向
//       src/main/db/index.ts（undo-service '../db'、repo '../index'、
//       backup-service '../db/index' 均解析到同一物理文件，一个 mock 全覆盖）。
//       MockDb.pragma 对 'foreign_keys = x' 走 raw.exec 真实切换（node:sqlite
//       支持，已验证），对只读 pragma 走 prepare——importBackup 的
//       clear_rebuild FK 开关因此与生产 better-sqlite3 行为一致。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DatabaseSync } from 'node:sqlite'

// ---- node:sqlite → better-sqlite3 兼容薄适配（SAVEPOINT 嵌套 + pragma） ----
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
  /** 与 FileDb.pragma 对齐；赋值型 foreign_keys pragma 真实生效（node:sqlite 允许） */
  pragma(sql: string, opts?: { simple?: boolean }): unknown {
    if (/^foreign_keys\s*=/i.test(sql)) {
      this.raw.exec(`PRAGMA ${sql}`)
      return []
    }
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

const mockDb = new MockDb()
// undo-service 用 '../db'；各 repo 用 '../index'；backup-service 用 '../db/index'
// ——均解析到 src/main/db/index.ts，一个 mock 覆盖全部 getDb。
vi.mock('../../db', () => ({ getDb: () => mockDb }))
// backup-service 依赖链引入 badge-storage → 'electron'；主路径不触达，
// 仅需模块可解析（getPath 不被实际调用）
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

// 被测模块（mock 之后导入）
import { eventRepo } from '../../db/repository/event.repo'
import { matchRepo } from '../../db/repository/match.repo'
import { drawRepo } from '../../db/repository/draw.repo'
import { timerSessionRepo } from '../../db/repository/timer-session.repo'
import {
  executeUndo,
  executeRedo,
  withUndoLog,
  collectEventAggregateSnapshot,
  collectRoundDeleteSnapshot,
  collectTeamDeleteSnapshot
} from '../undo-service'
import { exportBackup, importBackup } from '../backup-service'

// ---- DDL（a-b-e BUSINESS DDL 为基 + event_topic_groups + timer 双表 + matches 录音/AI 列） ----
const DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT, end_date TEXT,
    status TEXT, created_at TEXT, allow_repeat INTEGER NOT NULL DEFAULT 0, bank_config TEXT
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
    topic_id TEXT, team_a_id TEXT, team_b_id TEXT, stance_a TEXT, stance_b TEXT,
    topic_title TEXT, team_a_name TEXT, team_b_name TEXT,
    team_ids TEXT, team_stances TEXT, team_names TEXT, group_id TEXT
  );
  CREATE TABLE IF NOT EXISTS topic_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS topic_group_items (
    group_id TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, topic_id)
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
    round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE ON UPDATE CASCADE,
    match_number INTEGER,
    team_a_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    team_b_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL ON UPDATE CASCADE,
    stance_a TEXT, stance_b TEXT, draw_item_id TEXT, session_id TEXT, recording_ref TEXT,
    recording_meta TEXT,
    status TEXT NOT NULL DEFAULT 'planned', winner TEXT,
    aff_score REAL, neg_score REAL, best_speaker TEXT, notes TEXT, ai_review TEXT,
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
    judge_system TEXT NOT NULL DEFAULT 'three_votes',
    impression_vote TEXT, decision_vote TEXT, aff_total REAL, neg_total REAL,
    stage_scores TEXT, best_speaker TEXT, comment TEXT,
    created_at TEXT NOT NULL, updated_at TEXT
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

const TOPIC_ID = 'topic-1'

beforeEach(() => {
  mockDb.exec(DDL)
  mockDb.exec(
    'DELETE FROM undo_log; DELETE FROM timer_records; DELETE FROM timer_sessions; ' +
      'DELETE FROM match_judge_votes; DELETE FROM match_judges; DELETE FROM matches; ' +
      'DELETE FROM round_topic_groups; DELETE FROM event_topic_groups; DELETE FROM topic_group_items; ' +
      'DELETE FROM draw_session_items; DELETE FROM draw_sessions; ' +
      'DELETE FROM team_history; DELETE FROM teams; DELETE FROM team_groups; DELETE FROM rounds; ' +
      'DELETE FROM topic_groups; DELETE FROM topics; DELETE FROM events; DELETE FROM audit_log;'
  )
})

// ---------- 断言辅助 ----------

function count(table: string): number {
  return (mockDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
}

function exists(table: string, id: string): boolean {
  return !!mockDb.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)
}

// ---------- 计时赛制快照（timerSessionRepo.create 必需） ----------

const FMT = {
  stages: [
    { id: 'st0', name: '立论', side: 'aff', durationMs: 60000, bells: [] },
    { id: 'st1', name: '结辩', side: 'neg', durationMs: 60000, bells: [] }
  ],
  totalDurationMs: 120000
} as never

// ---------- IPC handler 复刻（与 event.ipc.ts / draw.ipc.ts 一致） ----------

function eventDeleteHandler(id: string) {
  return withUndoLog({
    storeName: 'event',
    action: 'delete',
    targetType: 'event',
    targetId: id,
    label: '删除赛事',
    getBefore: () => collectEventAggregateSnapshot(id),
    execute: () => eventRepo.deleteEvent(id),
    getAfter: () => null
  })
}

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

/** draw execute 编排：getAfter 包装为 { session: detail }，匹配 applyDrawReverse
 *  的 after.session.id / recreateDrawSessionWithId(after.session.items) 消费形状 */
function drawExecuteHandler(execute: () => ReturnType<typeof drawRepo.createSession>) {
  return withUndoLog({
    storeName: 'draw',
    action: 'execute',
    targetType: 'session',
    targetId: null,
    label: '执行抽取',
    getBefore: () => null,
    execute,
    getAfter: (r) => ({ session: r })
  })
}

// ---------- 聚合种子 ----------

interface Aggregate {
  eventId: string
  roundId: string
  teamGroupId: string
  topicGroupId: string
  teamAId: string
  teamBId: string
  topicId: string
  drawSessionId: string
  drawItemId: string
  matchId: string
}

/** 创建完整业务聚合：
 *  event → round → team_group → team×2 → topic → topic_group(+event/round 绑定)
 *  → draw session(+item) → match(经 upsertFromDraw 申领) → judge×2+vote×2
 *  → team_history。注意 draw session 的 round_id 置 null（与 a-b-e/c-d-g 先例
 *  一致）：round 级联语义由场景 C2 单独验证，backup 往返场景依赖其挂在 event 上。 */
function createFullAggregate(): Aggregate {
  const ev = eventRepo.createEvent({ name: '跨模块联赛', status: null, start_date: null, end_date: null })
  const round = eventRepo.createRound({
    event_id: ev.id, name: '初赛', round_number: 1,
    difficulty_override: null, topic_count: null, is_round_robin: false
  })
  mockDb
    .prepare("INSERT INTO team_groups (id, event_id, name, sort_order, created_at) VALUES ('tgx-1', ?, 'A组', 0, '2026-01-01T00:00:00Z')")
    .run(ev.id)
  const ta = eventRepo.createTeam({ name: '甲队', event_id: ev.id })
  const tb = eventRepo.createTeam({ name: '乙队', event_id: ev.id })
  mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run(TOPIC_ID, '人工智能伦理')
  mockDb
    .prepare("INSERT INTO topic_groups (id, name, is_default, created_at) VALUES ('tgrp-1', '赛事题库', 0, '2026-01-01T00:00:00Z')")
    .run()
  mockDb.prepare('INSERT INTO event_topic_groups (event_id, group_id) VALUES (?, ?)').run(ev.id, 'tgrp-1')
  mockDb.prepare('INSERT INTO round_topic_groups (round_id, group_id) VALUES (?, ?)').run(round.id, 'tgrp-1')

  const session = drawRepo.createSession({
    event_id: ev.id,
    round_id: null,
    items: [
      {
        topic_id: TOPIC_ID,
        team_a_id: ta.id,
        team_b_id: tb.id,
        stance_a: '正方',
        stance_b: '反方',
        topic_title: '人工智能伦理',
        team_a_name: '甲队',
        team_b_name: '乙队'
      }
    ]
  } as never)
  const item = session.items[0]
  const match = matchRepo.upsertFromDraw({
    eventId: ev.id,
    roundId: round.id,
    teamAffId: item.team_a_id!,
    teamNegId: item.team_b_id!,
    topicId: item.topic_id!,
    drawItemId: item.id,
    stanceAff: item.stance_a ?? null,
    stanceNeg: item.stance_b ?? null
  })

  // 裁判×2 + 评决×2（评决内容留空：需要确定性赛果的场景用显式 judges 覆盖）
  const insJudge = mockDb.prepare(
    "INSERT INTO match_judges (id, match_id, name, sort_order, is_ai, created_at) VALUES (?, ?, ?, ?, 0, '2026-01-01T00:00:00Z')"
  )
  insJudge.run('mj-1', match.id, '裁判一', 0)
  insJudge.run('mj-2', match.id, '裁判二', 1)
  const insVote = mockDb.prepare(
    "INSERT INTO match_judge_votes (id, match_id, judge_id, judge_system, created_at, updated_at) VALUES (?, ?, ?, 'three_votes', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
  )
  insVote.run('mv-1', match.id, 'mj-1')
  insVote.run('mv-2', match.id, 'mj-2')

  mockDb
    .prepare(
      "INSERT INTO team_history (id, team_id, topic_id, event_id, played_at, session_id, stance, topic_title) VALUES ('th-1', ?, ?, ?, '2026-01-02T00:00:00Z', ?, '正方', '人工智能伦理')"
    )
    .run(ta.id, TOPIC_ID, ev.id, session.id)

  return {
    eventId: ev.id,
    roundId: round.id,
    teamGroupId: 'tgx-1',
    topicGroupId: 'tgrp-1',
    teamAId: ta.id,
    teamBId: tb.id,
    topicId: TOPIC_ID,
    drawSessionId: session.id,
    drawItemId: item.id,
    matchId: match.id
  }
}

// ============================================================
// 场景 A：Event 聚合删除 + 级联 + Undo/Redo
// ============================================================

describe('Phase 6.3 场景 A：Event 聚合删除 → 级联 → Undo/Redo 往返', () => {
  it('删除级联清空子表、timer 保留 → undo 按 11 类原 id 恢复 → redo 再删 → 再 undo 业务可继续', () => {
    const agg = createFullAggregate()
    // timer session 指向聚合（event/round/match 三引用）
    const ts = timerSessionRepo.create({
      formatId: 'fmt-1',
      formatSnapshot: FMT,
      eventId: agg.eventId,
      roundId: agg.roundId,
      matchId: agg.matchId,
      teamAffId: agg.teamAId,
      teamNegId: agg.teamBId,
      topicId: agg.topicId,
      eventName: '跨模块联赛',
      teamAffName: '甲队',
      teamNegName: '乙队',
      topicTitle: '人工智能伦理'
    })
    expect(timerSessionRepo.getById(ts.id)?.matchId).toBe(agg.matchId)

    // EVENT_DELETE 编排：聚合快照 + deleteEvent（FK CASCADE）
    eventDeleteHandler(agg.eventId)

    // 快照覆盖的 10 张子表全部清空
    for (const t of [
      'rounds', 'teams', 'team_groups', 'team_history', 'draw_sessions',
      'draw_session_items', 'matches', 'match_judges', 'match_judge_votes',
      'round_topic_groups'
    ]) {
      expect(count(t), `${t} 删除后应为 0`).toBe(0)
    }
    expect(count('event_topic_groups')).toBe(0)
    // timer_sessions 的 event/round/match 引用为无 FK 裸列：不级联、也不在快照
    // 范围（undo-service 头注「有意排除」，快照列兜底显示）——按实际行为断言行仍在
    expect(count('timer_sessions')).toBe(1)

    // undo：11 类数据按原 id 完整恢复
    executeUndo()
    expect(eventRepo.getEventById(agg.eventId)?.name).toBe('跨模块联赛')
    expect(exists('rounds', agg.roundId)).toBe(true)
    expect(exists('team_groups', agg.teamGroupId)).toBe(true)
    expect(exists('teams', agg.teamAId)).toBe(true)
    expect(exists('teams', agg.teamBId)).toBe(true)
    expect(exists('team_history', 'th-1')).toBe(true)
    expect(exists('draw_sessions', agg.drawSessionId)).toBe(true)
    expect(exists('draw_session_items', agg.drawItemId)).toBe(true)
    expect(
      !!mockDb.prepare('SELECT 1 FROM event_topic_groups WHERE event_id = ? AND group_id = ?').get(agg.eventId, agg.topicGroupId)
    ).toBe(true)
    expect(
      !!mockDb.prepare('SELECT 1 FROM round_topic_groups WHERE round_id = ? AND group_id = ?').get(agg.roundId, agg.topicGroupId)
    ).toBe(true)
    expect(exists('matches', agg.matchId)).toBe(true)
    expect(exists('match_judges', 'mj-1')).toBe(true)
    expect(exists('match_judges', 'mj-2')).toBe(true)
    expect(exists('match_judge_votes', 'mv-1')).toBe(true)
    expect(exists('match_judge_votes', 'mv-2')).toBe(true)
    // match 可读且引用重新一致；timer 的 match_id 悬挂引用恢复
    const m = matchRepo.getById(agg.matchId)
    expect(m?.eventId).toBe(agg.eventId)
    expect(m?.roundId).toBe(agg.roundId)
    expect(m?.drawItemId).toBe(agg.drawItemId)
    expect(timerSessionRepo.getById(ts.id)?.matchId).toBe(agg.matchId)

    // redo：再次整体删除（timer 仍不在波及范围）
    executeRedo()
    for (const t of ['events', 'rounds', 'teams', 'team_groups', 'team_history', 'draw_sessions', 'draw_session_items', 'matches', 'match_judges', 'match_judge_votes']) {
      expect(count(t), `${t} redo 后应为 0`).toBe(0)
    }
    expect(count('timer_sessions')).toBe(1)

    // 再 undo：恢复后业务可继续（list/get 正常返回）
    executeUndo()
    expect(eventRepo.listRoundsByEvent(agg.eventId).map((r) => r.id)).toContain(agg.roundId)
    expect(eventRepo.listTeamsByEvent(agg.eventId).map((t) => t.id)).toEqual(
      expect.arrayContaining([agg.teamAId, agg.teamBId])
    )
    expect(matchRepo.getById(agg.matchId)).not.toBeNull()
  })
})

// ============================================================
// 场景 B：Draw → Match → Timer → Result 全链（B1~B8）
// ============================================================

describe('Phase 6.3 场景 B：Draw → Match → Timer → Result 全链', () => {
  it('绑定一致 + 计时记录持久化 + 赛果落库 + notes 保留 + 全量重读一致', () => {
    const agg = createFullAggregate()

    // B1/B2 draw session 已由聚合建立；upsertFromDraw 申领该对阵
    const item = drawRepo.listItemsBySession(agg.drawSessionId)[0]
    expect(item.id).toBe(agg.drawItemId)
    const m0 = matchRepo.getById(agg.matchId)
    expect(m0?.drawItemId).toBe(agg.drawItemId)
    expect(m0?.status).toBe('planned')

    // B3 计时会话绑定 event/round/match
    const ts = timerSessionRepo.create({
      formatId: 'fmt-1',
      formatSnapshot: FMT,
      eventId: agg.eventId,
      roundId: agg.roundId,
      matchId: agg.matchId,
      teamAffId: agg.teamAId,
      teamNegId: agg.teamBId,
      topicId: agg.topicId,
      teamAffName: '甲队',
      teamNegName: '乙队',
      topicTitle: '人工智能伦理'
    })
    expect(timerSessionRepo.getById(ts.id)?.status).toBe('idle')

    // B4 比赛启动：linkSession 把计时会话回写到 match.session_id
    //（生产契约：Match.sessionId = 「关联的计时会话」，linkSession 是唯一写入方；
    //  抽取侧关联由 matches.draw_item_id 承载）
    expect(matchRepo.linkSession(agg.matchId, ts.id)?.sessionId).toBe(ts.id)

    // B5 部分计时：running + addRecord（duration/actual 正值）→ finishRecord
    timerSessionRepo.update(ts.id, { status: 'running', startedAt: '2026-01-01T09:00:00Z' })
    timerSessionRepo.addRecord({
      sessionId: ts.id, stageIndex: 0, stageName: '立论', side: 'aff',
      durationMs: 60000, startedAt: '2026-01-01T09:00:10Z'
    })
    timerSessionRepo.finishRecord(ts.id, 0, 58000, '2026-01-01T09:01:08Z', 1)

    // B6 推进环节（nextStage 走 repo.update）
    timerSessionRepo.update(ts.id, { status: 'paused', currentStageIndex: 1 })

    // B7 计赛果（显式 judges 覆盖种子空评决 → 确定性 winner）+ P5-008 notes 保留
    matchRepo.setResult(agg.matchId, {
      winner: 'aff',
      affScore: 3,
      negScore: 1,
      notes: '评委备注：正方立论更完整',
      judges: [
        { name: '裁一', vote: { impressionVote: 'aff', decisionVote: 'aff' } },
        { name: '裁二', vote: { impressionVote: 'aff', decisionVote: 'neg' } }
      ]
    })
    // 第二次不带 notes（undefined）→ 保留原备注（P5-008）。注意：有评决时
    // 省略分数会被评决聚合值（aff_total 均值 0）覆盖，故分数需随行重传。
    matchRepo.setResult(agg.matchId, { winner: 'aff', affScore: 3, negScore: 1 })

    // B8 全量重读断言（模拟重开应用后的 History/详情页）
    const m = matchRepo.getById(agg.matchId)
    expect(m).not.toBeNull()
    expect(m!.sessionId).toBe(ts.id) // matches.session_id → timer session
    expect(m!.drawItemId).toBe(agg.drawItemId) // 抽取侧关联
    expect(m!.status).toBe('resulted')
    expect(m!.winner).toBe('aff')
    expect(m!.affScore).toBe(3)
    expect(m!.negScore).toBe(1)
    expect(m!.notes).toBe('评委备注：正方立论更完整')

    const t = timerSessionRepo.getById(ts.id)
    expect(t).not.toBeNull()
    expect(t!.matchId).toBe(agg.matchId) // timer_sessions.match_id → match
    expect(t!.eventId).toBe(m!.eventId)
    expect(t!.roundId).toBe(m!.roundId)
    expect(t!.status).toBe('paused')
    expect(t!.currentStageIndex).toBe(1)

    const records = timerSessionRepo.listRecords(ts.id)
    expect(records.length).toBe(1)
    expect(records[0].sessionId).toBe(ts.id)
    expect(records[0].durationMs).toBe(60000)
    expect(records[0].actualMs).toBe(58000)
    expect(records[0].pauseCount).toBe(1)

    // 裸 SQL 交叉验证绑定三元的落地值
    const rawRow = mockDb
      .prepare('SELECT match_id, event_id, round_id FROM timer_sessions WHERE id = ?')
      .get(ts.id) as { match_id: string; event_id: string; round_id: string }
    expect(rawRow.match_id).toBe(agg.matchId)
    expect(rawRow.event_id).toBe(agg.eventId)
    expect(rawRow.round_id).toBe(agg.roundId)
    expect(
      (mockDb.prepare('SELECT session_id AS s FROM matches WHERE id = ?').get(agg.matchId) as { s: string }).s
    ).toBe(ts.id)
  })
})

// ============================================================
// 场景 C：Undo/Redo 后业务可继续
// ============================================================

describe('Phase 6.3 场景 C1：Draw undo/redo 后第二场抽取可继续', () => {
  it('draw execute → match → undo → redo → 新 draw session + 新 match 成功', () => {
    const ev = eventRepo.createEvent({ name: '循环赛', status: null, start_date: null, end_date: null })
    const ta = eventRepo.createTeam({ name: '甲队', event_id: ev.id })
    const tb = eventRepo.createTeam({ name: '乙队', event_id: ev.id })
    mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run(TOPIC_ID, '人工智能伦理')

    // 第一场：draw execute 编排（产生 undo log）
    const first = drawExecuteHandler(() =>
      drawRepo.createSession({
        event_id: ev.id,
        round_id: null,
        items: [
          {
            topic_id: TOPIC_ID, team_a_id: ta.id, team_b_id: tb.id,
            stance_a: '正方', stance_b: '反方',
            topic_title: '人工智能伦理', team_a_name: '甲队', team_b_name: '乙队'
          }
        ]
      } as never)
    )
    const sessionId1 = first.result.id
    const item1 = drawRepo.listItemsBySession(sessionId1)[0]
    const m1 = matchRepo.upsertFromDraw({
      eventId: ev.id, roundId: null,
      teamAffId: item1.team_a_id!, teamNegId: item1.team_b_id!,
      topicId: item1.topic_id!, drawItemId: item1.id,
      stanceAff: item1.stance_a ?? null, stanceNeg: item1.stance_b ?? null
    })

    // undo：会话与 items 删除（match 行保留，draw_item_id 悬挂为无 FK 裸列）
    executeUndo()
    expect(exists('draw_sessions', sessionId1)).toBe(false)
    expect(count('draw_session_items')).toBe(0)

    // redo：按 after 快照原 id 重建（P5-002 完整字段）
    executeRedo()
    expect(exists('draw_sessions', sessionId1)).toBe(true)
    expect(drawRepo.listItemsBySession(sessionId1).map((i) => i.id)).toEqual([item1.id])

    // 继续业务：第一场计赛果（resulted 不再被 upsert 申领）→ 第二场 draw
    matchRepo.setResult(m1.id, { winner: 'aff', notes: '首场赛果' })
    const second = drawExecuteHandler(() =>
      drawRepo.createSession({
        event_id: ev.id,
        round_id: null,
        items: [
          {
            topic_id: TOPIC_ID, team_a_id: tb.id, team_b_id: ta.id,
            stance_a: '正方', stance_b: '反方',
            topic_title: '人工智能伦理', team_a_name: '乙队', team_b_name: '甲队'
          }
        ]
      } as never)
    )
    const sessionId2 = second.result.id
    expect(sessionId2).not.toBe(sessionId1)

    const item2 = drawRepo.listItemsBySession(sessionId2)[0]
    const m2 = matchRepo.upsertFromDraw({
      eventId: ev.id, roundId: null,
      teamAffId: item2.team_a_id!, teamNegId: item2.team_b_id!,
      topicId: item2.topic_id!, drawItemId: item2.id,
      stanceAff: item2.stance_a ?? null, stanceNeg: item2.stance_b ?? null
    })
    expect(m2.id).not.toBe(m1.id) // 新对阵（旧场已 resulted）

    // 重读一致：两个会话、两条 match、各自 draw_item 关联正确
    expect(drawRepo.getSessionById(sessionId2)?.items.length).toBe(1)
    expect(count('draw_sessions')).toBe(2)
    expect(count('matches')).toBe(2)
    expect(matchRepo.getById(m2.id)?.drawItemId).toBe(item2.id)
    expect(matchRepo.getById(m1.id)?.notes).toBe('首场赛果')
  })
})

describe('Phase 6.3 场景 C2：Round undo/redo 后同轮可继续建赛', () => {
  it('round delete → undo → redo → 再 undo 恢复 → matchRepo.create 同 round 成功', () => {
    const agg = createFullAggregate()

    roundDeleteHandler(agg.roundId)
    expect(exists('rounds', agg.roundId)).toBe(false)
    expect(exists('matches', agg.matchId)).toBe(false) // round_id CASCADE

    executeUndo()
    expect(exists('rounds', agg.roundId)).toBe(true)
    expect(exists('matches', agg.matchId)).toBe(true)

    executeRedo()
    expect(exists('rounds', agg.roundId)).toBe(false)

    // redo 后 round 处于删除态；再 undo 恢复到「业务可继续」状态（与场景 A 结尾同款）
    executeUndo()
    expect(exists('rounds', agg.roundId)).toBe(true)

    // 同 round 重新建赛成功（新 match_number），重读一致
    const m2 = matchRepo.create({ eventId: agg.eventId, roundId: agg.roundId, matchNumber: 2 })
    expect(m2.roundId).toBe(agg.roundId)
    expect(matchRepo.listByRound(agg.roundId).map((x) => x.id)).toContain(m2.id)
  })
})

describe('Phase 6.3 场景 C3：Team undo 后原 match 可继续计赛果', () => {
  it('team delete（match.team_a_id SET NULL）→ undo 恢复并回填 → setResult 成功', () => {
    const ev = eventRepo.createEvent({ name: '淘汰赛', status: null, start_date: null, end_date: null })
    const ta = eventRepo.createTeam({ name: '甲队', event_id: ev.id })
    const tb = eventRepo.createTeam({ name: '乙队', event_id: ev.id })
    const m = matchRepo.create({ eventId: ev.id, roundId: null, matchNumber: 1, teamAffId: ta.id, teamNegId: tb.id })

    teamDeleteHandler(ta.id)
    expect(exists('teams', ta.id)).toBe(false)
    // match 行保留，team_a_id 置 NULL（SET NULL 语义）
    expect(
      (mockDb.prepare('SELECT team_a_id AS a FROM matches WHERE id = ?').get(m.id) as { a: string | null }).a
    ).toBeNull()

    executeUndo()
    // team 原 id 恢复 + matches.team_a_id 回填（P5-005 rebind）
    expect(exists('teams', ta.id)).toBe(true)
    expect(matchRepo.getById(m.id)?.teamAffId).toBe(ta.id)
    expect(matchRepo.getById(m.id)?.teamNegId).toBe(tb.id)

    // 业务可继续：对原 match 计赛果并重读一致
    matchRepo.setResult(m.id, { winner: 'neg', notes: '赛后复盘' })
    const after = matchRepo.getById(m.id)
    expect(after?.status).toBe('resulted')
    expect(after?.winner).toBe('neg')
    expect(after?.notes).toBe('赛后复盘')
    expect(after?.teamAffId).toBe(ta.id)
  })
})

// ============================================================
// 场景 D：双轮备份往返（结构化备份链 + BUG-P6-001 回归锚点）
// ============================================================

describe('Phase 6.3 场景 D：双轮备份往返（export/import ×2）', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-p6xmodule-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('Restore A 还原到备份时刻 → 再变化 → 备份 B → 再污染 → Restore B 全量一致（含 timer.match_id 锚点）', () => {
    const agg = createFullAggregate()
    const timer1 = timerSessionRepo.create({
      formatId: 'fmt-1',
      formatSnapshot: FMT,
      eventId: agg.eventId,
      roundId: agg.roundId,
      matchId: agg.matchId,
      teamAffId: agg.teamAId,
      teamNegId: agg.teamBId,
      topicId: agg.topicId,
      teamAffName: '甲队',
      teamNegName: '乙队',
      topicTitle: '人工智能伦理'
    })

    // 1) 备份 A（三类核心业务数据）写盘（os.tmpdir + fs）
    const pkgA = exportBackup({ categories: ['events', 'match_records', 'timer'] })
    const fileA = path.join(tmpDir, 'backup-a.json')
    fs.writeFileSync(fileA, JSON.stringify(pkgA), 'utf-8')

    // 2) 备份后业务变化：第二场 match + timer session + 赛果
    const match2 = matchRepo.create({ eventId: agg.eventId, roundId: agg.roundId, matchNumber: 2, teamAffId: agg.teamAId, teamNegId: agg.teamBId })
    const timer2 = timerSessionRepo.create({ formatId: 'fmt-1', formatSnapshot: FMT, eventId: agg.eventId, matchId: match2.id })
    matchRepo.setResult(match2.id, { winner: 'neg', notes: '备份后新增' })

    // 3) Restore A（clear_rebuild）：MockDb 连接不变（结构化导入直接操作当前连接）
    const resA = importBackup({ filePath: fileA, strategy: 'clear_rebuild', categories: ['events', 'match_records', 'timer'] })
    expect(resA.fkInvalid).toBe(false)
    expect(resA.inserted).toBeGreaterThan(0)
    // 恢复时刻之后的变化被清；备份时刻的状态还原
    expect(matchRepo.getById(match2.id)).toBeNull()
    expect(timerSessionRepo.getById(timer2.id)).toBeNull()
    expect(timerSessionRepo.getById(timer1.id)).not.toBeNull()
    expect(matchRepo.getById(agg.matchId)?.status).toBe('planned')

    // 4) 再变化：在恢复时刻的基础上录赛果（显式 judges → 确定性 aff）
    matchRepo.setResult(agg.matchId, {
      winner: 'aff',
      affScore: 3,
      negScore: 1,
      notes: '恢复后赛果',
      judges: [
        { name: '裁一', vote: { impressionVote: 'aff', decisionVote: 'aff' } },
        { name: '裁二', vote: { impressionVote: 'aff', decisionVote: 'neg' } }
      ]
    })

    // 5) 备份 B 写盘
    const pkgB = exportBackup({ categories: ['events', 'match_records', 'timer'] })
    const fileB = path.join(tmpDir, 'backup-b.json')
    fs.writeFileSync(fileB, JSON.stringify(pkgB), 'utf-8')

    // 6) 再变化（污染）：弃赛 + timer 收尾
    matchRepo.setResult(agg.matchId, { winner: 'abandoned', notes: '污染' })
    timerSessionRepo.update(timer1.id, { status: 'finished', endedAt: '2099-01-01T00:00:00Z' })
    expect(matchRepo.getById(agg.matchId)?.winner).toBe('abandoned')

    // 7) Restore B
    const resB = importBackup({ filePath: fileB, strategy: 'clear_rebuild', categories: ['events', 'match_records', 'timer'] })
    expect(resB.fkInvalid).toBe(false)

    // 8) 全量读取断言：event/team/round/match/draw/timer/result 均在且关联一致
    expect(eventRepo.getEventById(agg.eventId)?.name).toBe('跨模块联赛')
    expect(eventRepo.listRoundsByEvent(agg.eventId).map((r) => r.id)).toContain(agg.roundId)
    expect(eventRepo.listTeamsByEvent(agg.eventId).map((t) => t.id)).toEqual(
      expect.arrayContaining([agg.teamAId, agg.teamBId])
    )
    // draw 链存活（draw_records 未勾选 → 不清不重建；FK 关闭期间也未级联误伤）
    expect(drawRepo.getSessionById(agg.drawSessionId)).not.toBeUndefined()
    expect(drawRepo.listItemsBySession(agg.drawSessionId).map((i) => i.id)).toEqual([agg.drawItemId])

    // match：恢复到备份 B 时刻（赛果 + 关联）
    const m = matchRepo.getById(agg.matchId)
    expect(m?.status).toBe('resulted')
    expect(m?.winner).toBe('aff')
    expect(m?.affScore).toBe(3)
    expect(m?.negScore).toBe(1)
    expect(m?.notes).toBe('恢复后赛果')
    expect(m?.drawItemId).toBe(agg.drawItemId)
    expect(m?.eventId).toBe(agg.eventId)
    expect(m?.roundId).toBe(agg.roundId)
    expect(matchRepo.getById(match2.id)).toBeNull() // 污染期后仍以备份 B 为准

    // timer：恢复到备份 B 时刻（idle），且 match_id 完好
    const t = timerSessionRepo.getById(timer1.id)
    expect(t?.status).toBe('idle')
    expect(t?.endedAt).toBeNull()
    expect(t?.eventId).toBe(agg.eventId)

    // BUG-P6-001 回归锚点：timer_sessions.match_id 非空且指向存在的 match
    const rawTs = mockDb
      .prepare('SELECT match_id FROM timer_sessions WHERE id = ?')
      .get(timer1.id) as { match_id: string | null }
    expect(rawTs.match_id).toBeTruthy()
    expect(rawTs.match_id).toBe(agg.matchId)
    expect(matchRepo.getById(rawTs.match_id!)).not.toBeNull()
  })
})
