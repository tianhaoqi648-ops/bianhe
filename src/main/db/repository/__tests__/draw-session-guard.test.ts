// ============================================================
// draw-session-guard.test.ts — P5-006 confirmed 会话 redraw/delete 守卫回归
// （真 SQLite roundtrip，FK ON）
//
// 覆盖：
//   1. confirmed 会话 → assertSessionNotConfirmed 抛错（拒绝重抽/删除）
//   2. 非 confirmed 会话 → 不抛（行为与修复前一致）
//   3. is_test + confirmed 会话 → 不抛（测试场景行为不变）
//   4. 不存在会话 → 不抛（保持「会话不存在」错误路径不变）
//   5. confirmed 会话 delete 流程复刻：拒绝后 team_history/session 完整
//   6. 非 confirmed redraw 闭环：assert 通过 → 删除 → 重抽 → undo/redo 正常
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

vi.mock('../../index', () => ({ getDb: () => mockDb }))

// 被测模块（mock 之后导入）
import { drawRepo } from '../draw.repo'

const DDL = `
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT);
  CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, title TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE TABLE IF NOT EXISTS draw_sessions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    round_id TEXT, draw_time TEXT, operator TEXT, settings TEXT
  );
  CREATE TABLE IF NOT EXISTS draw_session_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES draw_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
    topic_id TEXT, team_a_id TEXT, team_b_id TEXT, stance_a TEXT, stance_b TEXT,
    topic_title TEXT, team_a_name TEXT, team_b_name TEXT,
    team_ids TEXT, team_stances TEXT, team_names TEXT, group_id TEXT
  );
  CREATE TABLE IF NOT EXISTS team_history (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE ON UPDATE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE ON UPDATE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    played_at TEXT, session_id TEXT, stance TEXT, topic_title TEXT
  );
  CREATE TABLE IF NOT EXISTS undo_log (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, store_name TEXT NOT NULL,
    action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT,
    before_data TEXT, after_data TEXT, payload_size INTEGER NOT NULL DEFAULT 0,
    label TEXT, undone_at TEXT
  );
`

const EVT = 'evt-1'
const TOPIC = 'topic-1'
const TEAM = 't1'

/** 创建会话（真实 createSession 路径），settings 可指定 confirmed/is_test */
function createSession(id: string, settings: Record<string, unknown>): void {
  drawRepo.createSession({
    event_id: EVT,
    draw_time: '2026-01-02T00:00:00.000Z',
    operator: 'tester',
    settings,
    items: [
      {
        id: '',
        session_id: '',
        topic_id: TOPIC,
        team_a_id: TEAM,
        team_b_id: null,
        stance_a: '正方',
        stance_b: null,
        topic_title: '辩题',
        team_a_name: '队伍一',
        team_b_name: null,
        team_ids: null,
        team_stances: null,
        team_names: null,
        group_id: null
      }
    ]
  } as never)
  // 覆盖 id（createSession 以 uuid 生成）——仅测试定位用，业务无关
  mockDb.prepare('UPDATE draw_sessions SET id = ? WHERE event_id = ? AND operator = ?').run(id, EVT, 'tester')
  mockDb.prepare('UPDATE draw_session_items SET session_id = ? WHERE session_id IS NOT NULL AND id NOT IN (SELECT id FROM draw_session_items WHERE session_id IN (SELECT id FROM draw_sessions WHERE id = ?))').run(id, id)
}

beforeEach(() => {
  mockDb.exec(DDL)
  mockDb.exec(
    'DELETE FROM team_history; DELETE FROM draw_session_items; DELETE FROM draw_sessions; DELETE FROM undo_log; DELETE FROM teams; DELETE FROM topics; DELETE FROM events;'
  )
  mockDb.prepare('INSERT INTO events (id, name) VALUES (?, ?)').run(EVT, '赛事')
  mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run(TOPIC, '辩题')
  mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run(TEAM, '队伍一', EVT)
  mockDb
    .prepare(
      "INSERT INTO team_history (id, team_id, topic_id, event_id, played_at, session_id, stance, topic_title) VALUES ('th-1', ?, ?, ?, '2026-01-03', ?, '正方', '辩题')"
    )
    .run(TEAM, TOPIC, EVT, 'sess-1')
})

describe('P5-006 confirmed 会话守卫（真 SQLite）', () => {
  it('confirmed 会话 → 守卫抛错（拒绝重抽/删除）', () => {
    createSession('s-confirmed', { confirmed: true })
    expect(() => drawRepo.assertSessionNotConfirmed('s-confirmed')).toThrow('已确认并计入队伍历史')
  })

  it('非 confirmed 会话 → 守卫通过（行为与修复前一致）', () => {
    createSession('s-draft', { mode: 'versus' })
    expect(() => drawRepo.assertSessionNotConfirmed('s-draft')).not.toThrow()
  })

  it('is_test + confirmed 会话 → 守卫通过（测试场景行为不变）', () => {
    createSession('s-test', { confirmed: true, is_test: true })
    expect(() => drawRepo.assertSessionNotConfirmed('s-test')).not.toThrow()
  })

  it('不存在的会话 → 守卫通过（保持「会话不存在」错误路径不变）', () => {
    expect(() => drawRepo.assertSessionNotConfirmed('no-such')).not.toThrow()
  })

  it('confirmed 会话 delete 流程：拒绝后 team_history 与 session 完整', () => {
    createSession('s-confirmed', { confirmed: true })
    // 复刻 DRAW_DELETE_SESSION handler：守卫失败 → success:false
    let res: { success: boolean; error?: string }
    try {
      drawRepo.assertSessionNotConfirmed('s-confirmed')
      drawRepo.deleteSession('s-confirmed')
      res = { success: true, data: true } as never
    } catch (e) {
      res = { success: false, error: e instanceof Error ? e.message : '删除失败' }
    }
    expect(res.success).toBe(false)
    expect(res.error).toContain('已确认并计入队伍历史')
    // 数据完整：session 与 team_history 均未被删除
    expect(
      mockDb.prepare('SELECT COUNT(*) AS n FROM draw_sessions WHERE id = ?').get('s-confirmed')
    ).toEqual({ n: 1 })
    expect(
      mockDb.prepare('SELECT COUNT(*) AS n FROM team_history WHERE session_id = ?').get('sess-1')
    ).toEqual({ n: 1 })
  })

  it('非 confirmed redraw 闭环：assert 通过 → 删除 → 重抽 → undo 正常（不回退）', () => {
    createSession('s-draft', { mode: 'versus' })
    // 非 confirmed → assert 通过，删除 + 重抽（复刻 DRAW_REDRAW execute 核心）
    drawRepo.assertSessionNotConfirmed('s-draft')
    drawRepo.deleteSession('s-draft')
    const fresh = drawRepo.createSession({
      event_id: EVT,
      draw_time: '2026-01-04T00:00:00.000Z',
      operator: 'tester',
      settings: { mode: 'versus', redraw: true },
      items: [
        {
          id: '',
          session_id: '',
          topic_id: TOPIC,
          team_a_id: TEAM,
          team_b_id: null,
          stance_a: '正方',
          stance_b: null,
          topic_title: '辩题',
          team_a_name: '队伍一',
          team_b_name: null,
          team_ids: null,
          team_stances: null,
          team_names: null,
          group_id: null
        }
      ]
    } as never)
    // 重抽成功（createSession 正常，返回平铺 DrawSessionDetail）
    expect(fresh.id).toBeTruthy()
    // undo/redo 通道不受守卫影响：守卫未内置 deleteSession（undo-service 调用
    // 同一 deleteSession 删除未确认会话不抛，Batch 3 已覆盖 undo/redo 闭环）
    expect(() => drawRepo.deleteSession(fresh.id)).not.toThrow()
  })
})
