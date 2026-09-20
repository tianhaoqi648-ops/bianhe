// ============================================================
// draw-undo-rebuild.test.ts — P5-002 draw undo/redo 重建全字段回归
// （真 SQLite roundtrip）
//
// 背景：recreateDrawSessionWithId 此前仅写 items 7 列，丢失
// topic_title / team_a_name / team_b_name / team_ids / team_stances /
// team_names / group_id——multi_team/group 会话 undo/redo 后 team_ids
// 为 null，confirm 流程（event.ipc 读 item.team_ids）写不出 team_history。
//
// 覆盖：
//   1. CREATE→UNDO→REDO（multi_team + group + topic 快照）全持久化字段
//      snapshot 深比较
//   2. REDRAW→UNDO→REDO：旧/新 session 均全字段重建
//   3. topic_title 历史快照：题库 title 变化后 undo/redo 不漂移
//   4. confirm 业务链：multi_team 会话 undo/redo 后 confirm 正常写出 team_history
//   5. 旧格式兼容：payload 缺字段 → NULL fallback，不抛错
//   6. 事务安全：重建中途 NOT NULL 违规 → 整体回滚，标记不变
//
// 引擎：node:sqlite DatabaseSync（FK 默认开启，等同生产 foreign_keys=ON）。
// payload 采用生产形态（draw.repo.getSessionById / createSession 返回的
// DrawSessionDetail），经 undoLogRepo.createLog 构造 undo log。
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

class MockDb {
  private raw: DatabaseSync
  memory = false
  constructor() {
    this.raw = new DatabaseSync(':memory:')
    // 等同生产 db/index.ts 的 foreign_keys = ON
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

// undo-service / draw.repo / event.repo / undo-log.repo 均经 src/main/db/index.ts 取连接
vi.mock('../../db', () => ({ getDb: () => mockDb }))

// 被测模块（mock 之后导入）
import { executeUndo, executeRedo } from '../undo-service'
import { drawRepo } from '../../db/repository/draw.repo'
import { eventRepo } from '../../db/repository/event.repo'
import { undoLogRepo } from '../../db/repository/undo-log.repo'
import type { DrawSessionDetail } from '../../../shared/types'

const DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS team_groups (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS draw_sessions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE ON UPDATE CASCADE,
    draw_time TEXT,
    operator TEXT,
    settings TEXT
  );
  CREATE TABLE IF NOT EXISTS draw_session_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES draw_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL ON UPDATE CASCADE,
    team_a_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    team_b_id TEXT REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE,
    stance_a TEXT,
    stance_b TEXT,
    topic_title TEXT,
    team_a_name TEXT,
    team_b_name TEXT,
    team_ids TEXT,
    team_stances TEXT,
    team_names TEXT,
    group_id TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE TABLE IF NOT EXISTS team_history (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE ON UPDATE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE ON UPDATE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    played_at TEXT,
    session_id TEXT,
    stance TEXT,
    topic_title TEXT
  );
  CREATE TABLE IF NOT EXISTS undo_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    store_name TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    before_data TEXT,
    after_data TEXT,
    payload_size INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    undone_at TEXT
  );
`

const EVT = 'evt-1'
const GROUP = 'grp-1'
const TOPIC = 'topic-1'
const TOPIC_TITLE = 'AI 是否会取代人类辩论'

beforeEach(() => {
  mockDb.exec(DDL)
  // 模块级单例连接：先清数据再种子化（FK 顺序：子表在前）
  mockDb.exec(
    'DELETE FROM team_history; DELETE FROM draw_session_items; DELETE FROM draw_sessions; DELETE FROM undo_log; DELETE FROM teams; DELETE FROM topics; DELETE FROM team_groups; DELETE FROM events;'
  )
  mockDb
    .prepare('INSERT INTO events (id, name, created_at) VALUES (?, ?, ?)')
    .run(EVT, '测试赛事', '2026-01-01T00:00:00.000Z')
  mockDb
    .prepare('INSERT INTO topics (id, title, created_at) VALUES (?, ?, ?)')
    .run(TOPIC, TOPIC_TITLE, '2026-01-01T00:00:00.000Z')
  mockDb
    .prepare(
      'INSERT INTO team_groups (id, event_id, name, sort_order, created_at) VALUES (?, ?, ?, 0, ?)'
    )
    .run(GROUP, EVT, 'A 组', '2026-01-01T00:00:00.000Z')
  // multi_team 会话的队伍（team_history FK 依赖）
  for (const [i, name] of ['队伍一', '队伍二', '队伍三', '队伍四'].entries()) {
    mockDb
      .prepare('INSERT INTO teams (id, name, event_id, group_id) VALUES (?, ?, ?, NULL)')
      .run(`t${i + 1}`, name, EVT)
  }
})

/** 创建 multi_team + group 抽签会话（走真实 createSession 写入路径），返回详情 payload */
function createMultiTeamSession(settings: Record<string, unknown>): DrawSessionDetail {
  return drawRepo.createSession({
    event_id: EVT,
    draw_time: '2026-01-02T00:00:00.000Z',
    operator: 'tester',
    settings,
    items: [
      {
        id: 'item-1',
        session_id: '',
        topic_id: TOPIC,
        team_a_id: null,
        team_b_id: null,
        stance_a: null,
        stance_b: null,
        topic_title: TOPIC_TITLE,
        team_a_name: null,
        team_b_name: null,
        team_ids: ['t1', 't2', 't3'],
        team_stances: ['正方', '反方', '中评'],
        team_names: ['队伍一', '队伍二', '队伍三'],
        group_id: GROUP
      },
      {
        id: 'item-2',
        session_id: '',
        topic_id: TOPIC,
        team_a_id: null,
        team_b_id: null,
        stance_a: null,
        stance_b: null,
        topic_title: TOPIC_TITLE,
        team_a_name: null,
        team_b_name: null,
        team_ids: ['t4'],
        team_stances: ['正方'],
        team_names: ['队伍四'],
        group_id: GROUP
      }
    ]
  } as never)
}

/** 读某会话全部持久化行（深比较用；全列 SELECT，无排除字段） */
function snapshotSession(id: string): { session: unknown; items: unknown[] } {
  const session = mockDb.prepare('SELECT * FROM draw_sessions WHERE id = ?').get(id)
  const items = mockDb
    .prepare('SELECT * FROM draw_session_items WHERE session_id = ? ORDER BY id')
    .all(id)
  return { session, items }
}

function getUndoneAt(logId: string): string | null {
  const row = mockDb.prepare('SELECT undone_at FROM undo_log WHERE id = ?').get(logId) as
    | { undone_at: string | null }
    | undefined
  return row?.undone_at ?? null
}

describe('P5-002 draw undo/redo 重建全字段（真 SQLite）', () => {
  it('CREATE→UNDO→REDO：multi_team+group 全持久化字段 snapshot 深比较一致', () => {
    const payload = createMultiTeamSession({ mode: 'multi_team' })
    const before = snapshotSession(payload.id)

    // undo log（情况 A：payload 即 getSessionById/createSession 返回的完整详情）
    undoLogRepo.createLog({
      store_name: 'draw',
      action: 'execute',
      target_type: 'session',
      target_id: null,
      before_data: { params: {} },
      after_data: { session: payload },
      label: '执行抽取'
    })

    // UNDO：session 完整消失
    executeUndo()
    expect(mockDb.prepare('SELECT COUNT(*) AS n FROM draw_session_items WHERE session_id = ?').get(payload.id)).toEqual({ n: 0 })

    // REDO：全字段重建，深比较一致（含 7 个此前丢失的字段）
    executeRedo()
    const after = snapshotSession(payload.id)
    expect(after).toEqual(before)

    // 关键字段显式复核（按 team_ids 内容定位——createSession 会以 uuid 覆盖传入 item id）
    const itemsAfter = after.items as Array<Record<string, unknown>>
    const item1 = itemsAfter.find((i) => String(i.team_ids).includes('"t1"'))!
    expect(item1.team_ids).toBe(JSON.stringify(['t1', 't2', 't3']))
    expect(item1.team_stances).toBe(JSON.stringify(['正方', '反方', '中评']))
    expect(item1.team_names).toBe(JSON.stringify(['队伍一', '队伍二', '队伍三']))
    expect(item1.topic_title).toBe(TOPIC_TITLE)
    expect(item1.group_id).toBe(GROUP)
    const item2 = itemsAfter.find((i) => String(i.team_ids).includes('"t4"'))!
    expect(item2.team_ids).toBe(JSON.stringify(['t4']))
  })

  it('REDRAW→UNDO→REDO：旧/新 session 均全字段重建', () => {
    // 旧会话（multi_team + group）
    const oldSession = createMultiTeamSession({ mode: 'multi_team' })
    const oldSnapshot = snapshotSession(oldSession.id)

    // redraw：删旧建新（真实删除路径），构造 redraw undo log
    drawRepo.deleteSession(oldSession.id)
    const newSession = createMultiTeamSession({ mode: 'multi_team', redraw: true })
    const newSnapshotBeforeUndo = snapshotSession(newSession.id)
    undoLogRepo.createLog({
      store_name: 'draw',
      action: 'redraw',
      target_type: 'session',
      target_id: null,
      before_data: { oldSessionId: oldSession.id, oldSession },
      after_data: { session: newSession },
      label: '重抽'
    })

    // UNDO：删新 + 重建旧 → 旧快照一致
    executeUndo()
    expect(
      mockDb.prepare('SELECT COUNT(*) AS n FROM draw_session_items WHERE session_id = ?').get(newSession.id)
    ).toEqual({ n: 0 })
    expect(snapshotSession(oldSession.id)).toEqual(oldSnapshot)

    // REDO：删旧 + 重建新 → 与 undo 前新会话快照一致
    executeRedo()
    expect(
      mockDb.prepare('SELECT COUNT(*) AS n FROM draw_session_items WHERE session_id = ?').get(oldSession.id)
    ).toEqual({ n: 0 })
    expect(snapshotSession(newSession.id)).toEqual(newSnapshotBeforeUndo)
  })

  it('topic_title 历史快照：题库 title 变化后 undo/redo 不漂移', () => {
    const payload = createMultiTeamSession({ mode: 'multi_team' })
    const before = snapshotSession(payload.id)

    // 题库状态变化：当前 title 已改（模拟题库编辑）
    mockDb.prepare('UPDATE topics SET title = ? WHERE id = ?').run('新标题', TOPIC)

    undoLogRepo.createLog({
      store_name: 'draw',
      action: 'execute',
      target_type: 'session',
      target_id: null,
      before_data: { params: {} },
      after_data: { session: payload },
      label: '执行抽取'
    })

    executeUndo()
    executeRedo()
    const after = snapshotSession(payload.id)
    const items = after.items as Array<Record<string, unknown>>
    // 保持抽签时快照值，不随 topics 当前 title 漂移
    for (const it of items) {
      expect(it.topic_title).toBe(TOPIC_TITLE)
      expect(it.topic_title).not.toBe('新标题')
    }
    expect(after).toEqual(before)
  })

  it('confirm 业务链：multi_team 会话 undo/redo 后 confirm 正常写出 team_history', () => {
    const payload = createMultiTeamSession({ mode: 'multi_team' })
    undoLogRepo.createLog({
      store_name: 'draw',
      action: 'execute',
      target_type: 'session',
      target_id: null,
      before_data: { params: {} },
      after_data: { session: payload },
      label: '执行抽取'
    })

    // UNDO → REDO → confirm（复刻 event.ipc DRAW_CONFIRM_SESSION 的 team_history 循环）
    executeUndo()
    executeRedo()

    const detail = drawRepo.getSessionById(payload.id)
    expect(detail).toBeTruthy()
    for (const item of detail!.items) {
      const teamIds = Array.isArray(item.team_ids) ? item.team_ids : []
      const stances = item.team_stances ?? []
      for (let i = 0; i < teamIds.length; i++) {
        eventRepo.addTeamHistory({
          team_id: teamIds[i],
          topic_id: item.topic_id!,
          event_id: detail!.event_id,
          played_at: '2026-01-03T00:00:00.000Z',
          session_id: payload.id,
          stance: stances[i] ?? null
        })
      }
    }

    // team_history：t1~t4 各一条，stance 与 team_stances 快照一一对应
    const rows = mockDb
      .prepare('SELECT team_id, stance FROM team_history WHERE session_id = ? ORDER BY team_id')
      .all(payload.id) as Array<{ team_id: string; stance: string }>
    expect(rows).toEqual([
      { team_id: 't1', stance: '正方' },
      { team_id: 't2', stance: '反方' },
      { team_id: 't3', stance: '中评' },
      { team_id: 't4', stance: '正方' }
    ])
  })

  it('旧格式兼容：payload 缺失字段 → NULL fallback，不抛错', () => {
    // 模拟极旧/手写的 payload：items 缺全部新增字段（undefined）
    const legacySession: DrawSessionDetail = {
      id: 'legacy-1',
      event_id: EVT,
      round_id: null,
      draw_time: '2026-01-02T00:00:00.000Z',
      operator: null,
      settings: null,
      items: [
        {
          id: 'li-1',
          session_id: 'legacy-1',
          topic_id: TOPIC,
          team_a_id: 't1',
          team_b_id: 't2',
          stance_a: '正方',
          stance_b: '反方'
          // topic_title / team_a_name / team_b_name / team_ids / team_stances / team_names / group_id 缺失
        } as never
      ]
    }
    undoLogRepo.createLog({
      store_name: 'draw',
      action: 'execute',
      target_type: 'session',
      target_id: null,
      before_data: { params: {} },
      after_data: { session: legacySession },
      label: '旧格式抽取'
    })
    // 模拟「历史遗留 log 已被撤销」状态（redo 的前置条件）
    const legacyLogId = (
      mockDb.prepare('SELECT id FROM undo_log ORDER BY created_at DESC LIMIT 1').get() as { id: string }
    ).id
    undoLogRepo.markUndone(legacyLogId)

    // redo 重建：不抛错；缺失列按 NULL 落库（旧语义）
    executeRedo()
    const item = mockDb
      .prepare('SELECT * FROM draw_session_items WHERE id = ?')
      .get('li-1') as Record<string, unknown>
    expect(item).toBeTruthy()
    expect(item.team_ids).toBeNull()
    expect(item.topic_title).toBeNull()
    expect(item.group_id).toBeNull()
    expect(item.team_a_id).toBe('t1')

    // undo（删除）→ redo（重建）再次成功
    executeUndo()
    expect(mockDb.prepare('SELECT COUNT(*) AS n FROM draw_session_items WHERE session_id = ?').get('legacy-1')).toEqual({ n: 0 })
    executeRedo()
    const item2 = mockDb
      .prepare('SELECT * FROM draw_session_items WHERE id = ?')
      .get('li-1') as Record<string, unknown>
    expect(item2).toBeTruthy()
    expect(item2.team_ids).toBeNull()
    expect(item2.team_a_id).toBe('t1')
  })

  it('事务安全：items 重建中途 NOT NULL 违规 → 整体回滚，标记不变', () => {
    const payload = createMultiTeamSession({ mode: 'multi_team' })
    // 注入失败：篡改 payload，items[0].session_id 置 null（NOT NULL 违规）
    const badPayload = {
      session: {
        ...payload,
        items: [{ ...payload.items[0], session_id: null }, ...payload.items.slice(1)]
      }
    }
    undoLogRepo.createLog({
      store_name: 'draw',
      action: 'execute',
      target_type: 'session',
      target_id: null,
      before_data: { params: {} },
      after_data: badPayload,
      label: '坏 payload'
    })

    // 先 undo（删除真实 session）成功
    executeUndo()
    expect(mockDb.prepare('SELECT COUNT(*) AS n FROM draw_sessions WHERE id = ?').get(payload.id)).toEqual({ n: 0 })

    // redo 重建中途违规 → 抛错，且 undo log 不被标记为已重做（undone_at 保持）
    const logId = (
      mockDb.prepare('SELECT id FROM undo_log ORDER BY created_at DESC LIMIT 1').get() as { id: string }
    ).id
    const undoneAtBefore = getUndoneAt(logId)
    expect(() => executeRedo()).toThrow()
    expect(getUndoneAt(logId)).toBe(undoneAtBefore)
  })
})
