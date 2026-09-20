// ============================================================
// badge-import-failure.test.ts — P5-011 badge 写盘失败降级回归
// （真 SQLite roundtrip + 失败注入）
//
// 背景：importBackup 的 DB 事务先提交，随后 badgeRestoreBackup 写队徽文件/
// index/bindings（磁盘 I/O）。此前 badge 写盘抛错会沿链上抛 → IPC 返回
// 「导入失败」，但主数据已入库——假失败。
//
// 覆盖：
//   Case 1 完整成功：DB + badge 均成功 → 成功，badgeFilesRestored>0
//   Case 2 DB 事务失败 → 抛错回滚，matches 无行
//   Case 3（关键）DB 成功 + badge 写盘失败（注入）→ 不抛（不谎报失败）、
//                  badgeFilesRestored=0、主数据存在
//   Case 4 重复导入兼容：同一包导入两次 → 行数一致不重复
//
// 引擎：真 SQLite（node:sqlite，FK ON）；badge 失败通过 vi.mock badge-storage
// 的 restoreBackup 注入抛错（方式记录于此注释）；bulkInsert/clearTable/
// TABLE_COLUMNS 用 importActual 真实实现（真实 INSERT 落真库）。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

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
  /** better-sqlite3 兼容：pragma(sql) 返回行数组。
   *  node:sqlite 禁止 prepare/exec PRAGMA 语句：
   *  - foreign_keys 切换 → no-op（本库构造时 FK 已常开，比真实 clear_rebuild
   *    临时关 FK 更严格；测试数据引用均合法，行为一致）
   *  - foreign_key_check → 返回空（测试数据无孤立引用；真实违规场景在
   *    INSERT 时即抛 FK 错误，由 Case 2 覆盖） */
  pragma(sql: string): unknown[] {
    const s = sql.trim().toLowerCase()
    if (s.startsWith('foreign_keys') || s.startsWith('foreign_key_check')) {
      return []
    }
    return this.raw.prepare(sql).all() as unknown[]
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

// badge 注入开关：true = badgeRestoreBackup 写盘抛错（模拟磁盘满/权限失败）
const { badgeState } = vi.hoisted(() => ({
  badgeState: { failWrite: false }
}))

vi.mock('../badge-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../badge-storage')>()
  return {
    ...actual,
    restoreBackup: vi.fn(() => {
      if (badgeState.failWrite) {
        throw new Error('injected badge write failure (ENOENT: no such file or directory)')
      }
      return 1
    })
  }
})

// electron mock：badge-storage 实际模块顶层 import { app } from 'electron'，
// node 测试环境无 electron 运行时，需提供最小 mock（restoreBackup 已被上面的
// 工厂覆盖，app 不会被实际调用）。
vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

// bulkInsert/clearTable 用真实实现（真 INSERT 落真库）；TABLE_COLUMNS 用真实白名单
// （importOriginal），确保主数据 INSERT 是生产 SQL。

// 被测模块（mock 之后导入）
import { importBackup } from '../backup-service'

const DDL = `
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT);
  CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, title TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY, event_id TEXT, name TEXT);
  CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, event_id TEXT);
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    round_id TEXT, match_number INTEGER,
    team_a_id TEXT, team_b_id TEXT,
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
`

function seedBase(): void {
  mockDb.prepare('INSERT INTO events (id, name) VALUES (?, ?)').run('evt-1', '赛事')
  mockDb.prepare('INSERT INTO topics (id, title) VALUES (?, ?)').run('topic-1', '辩题')
  mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run('t1', 'A 队', 'evt-1')
  mockDb.prepare('INSERT INTO teams (id, name, event_id) VALUES (?, ?, ?)').run('t2', 'B 队', 'evt-1')
}

/** 构造最小合法备份包（match_records + badges），写入临时 JSON */
function writeBackupFile(name: string): string {
  const now = '2026-01-01T00:00:00.000Z'
  const pkg = {
    version: '1.0',
    exportedAt: now,
    appVersion: '1.7.0',
    categories: ['match_records', 'badges'],
    tables: {
      matches: [
        {
          id: 'm-1', event_id: 'evt-1', round_id: null, team_a_id: 't1', team_b_id: 't2',
          topic_id: 'topic-1', status: 'planned', created_at: now, updated_at: now
        }
      ],
      match_judges: [
        { id: 'j-1', match_id: 'm-1', name: '裁判一', sort_order: 0, is_ai: 0, created_at: now }
      ],
      match_judge_votes: [
        { id: 'v-1', match_id: 'm-1', judge_id: 'j-1', judge_system: 'three_votes', created_at: now }
      ],
      badges: [{ id: 'badge-1', name: '队徽一' }],
      team_bindings: {},
      badge_files: {}
    }
  }
  const p = path.join(tmpDir, name)
  fs.writeFileSync(p, JSON.stringify(pkg), 'utf8')
  return p
}

function matchCount(): number {
  return (mockDb.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n
}

function judgeCount(): number {
  return (mockDb.prepare('SELECT COUNT(*) AS n FROM match_judges').get() as { n: number }).n
}

let tmpDir = ''

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-badge-'))
  mockDb.exec(DDL)
  mockDb.exec('DELETE FROM match_judge_votes; DELETE FROM match_judges; DELETE FROM matches; DELETE FROM teams; DELETE FROM topics; DELETE FROM events; DELETE FROM undo_log;')
  seedBase()
  badgeState.failWrite = false
})

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('P5-011 badge 写盘失败降级（真 SQLite + 失败注入）', () => {
  it('Case 1 完整成功：DB + badge 均成功 → 主数据存在、badgeFilesRestored=1', () => {
    const params = { filePath: writeBackupFile('ok.json'), strategy: 'clear_rebuild' as const, categories: ['match_records', 'badges'] as never }
    const result = importBackup(params as never)
    expect(result.badgeFilesRestored).toBe(1)
    expect(matchCount()).toBe(1)
    expect(judgeCount()).toBe(1)
  })

  it('Case 3（关键）DB 成功 + badge 写盘失败 → 不谎报失败、主数据存在', () => {
    badgeState.failWrite = true
    const params = { filePath: writeBackupFile('badge-fail.json'), strategy: 'clear_rebuild' as const, categories: ['match_records', 'badges'] as never }

    // 不抛 = 不谎报主导入失败（修复前此处会沿链抛 badge 错误）
    const result = importBackup(params as never)
    // inserted 汇总三张表：matches(1) + match_judges(1) + match_judge_votes(1)
    expect(result.inserted).toBe(3)
    expect(result.badgeFilesRestored).toBe(0)
    // 主数据保持已导入状态
    expect(matchCount()).toBe(1)
    expect(judgeCount()).toBe(1)
  })

  it('Case 2 DB 事务失败 → 抛错回滚，matches 无行', () => {
    // skip_existing 策略不禁用外键（clear_rebuild 会临时关 FK），match 指向
    // 不存在的 topic-ghost → FK 违规在事务内抛出 → 整体回滚。
    const now = '2026-01-01T00:00:00.000Z'
    const p = path.join(tmpDir, 'db-fail.json')
    fs.writeFileSync(
      p,
      JSON.stringify({
        version: '1.0',
        exportedAt: now,
        appVersion: '1.7.0',
        categories: ['match_records'],
        tables: {
          matches: [
            { id: 'm-bad', event_id: 'evt-1', round_id: null, team_a_id: 't1', team_b_id: 't2', topic_id: 'topic-ghost', status: 'planned', created_at: now, updated_at: now }
          ]
        }
      }),
      'utf8'
    )
    expect(() => importBackup({ filePath: p, strategy: 'skip_existing', categories: ['match_records'] } as never)).toThrow()
    expect(matchCount()).toBe(0)
  })

  it('Case 4 重复导入兼容：同一包导入两次 → 行数一致不重复', () => {
    const params = { filePath: writeBackupFile('repeat.json'), strategy: 'skip_existing' as const, categories: ['match_records', 'badges'] as never }
    importBackup(params as never)
    const first = matchCount()
    importBackup(params as never)
    expect(matchCount()).toBe(first)
    expect(first).toBe(1)
  })
})
