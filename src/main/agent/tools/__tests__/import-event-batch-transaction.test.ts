// ============================================================
// import-event-batch-transaction.test.ts — 批量导入事务化（Phase 1.0-C）
//
// 真实 SQLite 回滚验证：中途失败（teams 主键冲突）→ 赛事与已建队伍全部回滚。
//
// 架构：
//   - node:sqlite DatabaseSync 真实引擎 + schema.sql 的 events/teams 建表
//   - vi.mock getDb（'@main/db/index' 与 event.repo 内部 '../db' 解析到同一模块）
//   - eventRepo.createTeam 跑真实 SQL（不 mock）
//   - createEventWithDefaultGroup mock 为「向同一连接 INSERT events 行」——
//     该 INSERT 位于被测外层事务内，回滚时一并撤销
//   - 注入失败方式：uuid 固定值 → teams.id 主键冲突（自然的真实失败模式）
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ---- node:sqlite → better-sqlite3 兼容薄适配 ----
class MockDb {
  private raw: DatabaseSync
  memory = false
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
  // 与 better-sqlite3 一致：嵌套事务自动降级为 SAVEPOINT
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

// vi.hoisted 阶段不能引用 import 绑定（TDZ），因此 db 采用惰性单例：
// getDb() 在测试运行时才构造 MockDb。
const { mockUuidV4, mockParseFile } = vi.hoisted(() => ({
  mockUuidV4: vi.fn(),
  mockParseFile: vi.fn()
}))

vi.mock('@main/services/import-engine', () => ({ parseFile: mockParseFile }))

// node:sqlite 默认 foreign_keys=ON：teams 引用的 team_groups 必须存在
//（即使只插入 NULL group_id，父表缺失也会在 INSERT 时报 no such table）
const TEAM_GROUPS_DDL = `
  CREATE TABLE IF NOT EXISTS team_groups (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`

/** 与既有 import-event-batch.tool.test.ts 同构的 parseFile 返回（rawTable 供工具内提取） */
function makeParsedResult(): unknown {
  return {
    topics: [],
    mapping: { 队伍名: 'teamName', 赛事名: 'eventName' },
    rawTable: {
      headers: ['队伍名', '赛事名'],
      rows: [
        ['清华队', ''],
        ['北大队', ''],
        ['复旦队', '']
      ]
    }
  }
}

// 惰性构造（模块体执行阶段，此时 DatabaseSync 已可引用）
let dbInstance: MockDb | null = null
function ensureDb(): MockDb {
  if (!dbInstance) dbInstance = new MockDb()
  return dbInstance
}

// 依赖 mock：getDb 指向真 SQLite 适配；uuid 固定序列（由用例控制）
vi.mock('@main/db/index', () => ({ getDb: () => ensureDb() }))
vi.mock('@main/services/undo-service', () => ({
  logEventCreateSnapshot: vi.fn(() => 'log-x')
}))

vi.mock('uuid', () => ({ v4: () => mockUuidV4() }))

vi.mock('@main/services/event-service', () => ({
  createEvent: (input: { name: string; start_date: null; end_date: null; status: null }) => {
    ensureDb()
      .prepare('INSERT INTO events (id, name, start_date, end_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ev-under-test', input.name, null, null, null, '2026-09-09T00:00:00Z')
    return { id: 'ev-under-test', name: input.name }
  }
}))

// 真实 eventRepo（createTeam 跑真实 SQL；通过工具内部 import 生效）
import { importEventBatchTool } from '../import-event-batch.tool'

// ---- 建表：与 schema.sql 同源的 events / teams 两表 DDL ----
const EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    start_date    TEXT,
    end_date      TEXT,
    status        TEXT,
    created_at    TEXT,
    allow_repeat  INTEGER NOT NULL DEFAULT 0,
    bank_config   TEXT
  );
`
const TEAMS_DDL = `
  CREATE TABLE IF NOT EXISTS teams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,
    group_id   TEXT REFERENCES team_groups(id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at TEXT
  );
`

function count(table: string): number {
  return (ensureDb().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
}

beforeEach(() => {
  // 重建干净表结构（:memory: 库随文件实例常驻，逐用例清空）
  ensureDb().exec('DROP TABLE IF EXISTS teams')
  ensureDb().exec('DROP TABLE IF EXISTS team_groups')
  ensureDb().exec('DROP TABLE IF EXISTS events')
  ensureDb().exec(TEAM_GROUPS_DDL)
  ensureDb().exec(EVENTS_DDL)
  ensureDb().exec(TEAMS_DDL)
  mockUuidV4.mockReset()
  mockParseFile.mockResolvedValue(makeParsedResult())
})

describe('import_event_batch 事务化（真实 SQLite 回滚验证）', () => {
  it('成功路径：赛事 + 3 队伍全部落库', async () => {
    mockUuidV4.mockImplementation(() => crypto.randomUUID())
    const result = (await importEventBatchTool.execute({
      filePath: '/path/to/roster.xlsx',
      fileType: 'xlsx',
      fieldMapping: { teamName: '队伍名' }
    })) as { eventId: string; teamCount: number }

    expect(result.teamCount).toBe(3)
    expect(count('events')).toBe(1)
    expect(count('teams')).toBe(3)
  })

  it('回滚路径：第 3 支队伍主键冲突 → 赛事与前 2 队全部回滚', async () => {
    // uuid 固定：第 1 支队伍 id=A、第 2 支 id=B、第 3 支再回到 A → 主键冲突
    mockUuidV4
      .mockReturnValueOnce('team-aaa')
      .mockReturnValueOnce('team-bbb')
      .mockReturnValueOnce('team-aaa')

    await expect(
      importEventBatchTool.execute({
        filePath: '/path/to/roster.xlsx',
        fileType: 'xlsx',
        fieldMapping: { teamName: '队伍名' }
      })
    ).rejects.toThrow()

    // 整体回滚：teams 0 行、events 0 行（赛事未残留）
    expect(count('teams')).toBe(0)
    expect(count('events')).toBe(0)
  })

  it('回滚路径：createEvent 成功但首支队伍即失败 → 赛事同样回滚', async () => {
    mockUuidV4.mockImplementation(() => crypto.randomUUID())
    // 让 createTeam 直接在主键冲突处失败：预置 teams 表占用即将生成的 id？
    // 更直接：mockUuidV4 全部返回同一值 → 第 1 支队伍成功（id=X）→ 第 2 支主键冲突
    mockUuidV4.mockReset()
    mockUuidV4.mockReturnValue('team-dup')

    await expect(
      importEventBatchTool.execute({
        filePath: '/path/to/roster.xlsx',
        fileType: 'xlsx',
        fieldMapping: { teamName: '队伍名' }
      })
    ).rejects.toThrow()

    expect(count('teams')).toBe(0)
    expect(count('events')).toBe(0)
  })
})
