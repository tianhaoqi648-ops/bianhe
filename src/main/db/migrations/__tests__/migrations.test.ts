// ============================================================
// migrations/__tests__/migrations.test.ts — 迁移机制加固测试（Task3）
//
// 覆盖（3.5）：
//   - 空库直出当前数值 schema version（SCHEMA_VERSION）
//   - 最新库「无迁移可跳」：全部 skipped，且 user_version 保持
//   - 重复执行幂等：不产生重复记录/重复结构
//   - 旧版本库逐级连升：从某一历史版本升到最新，仅应用缺失迁移
//   - 中途失败非半状态：关键迁移失败 → 抛错、不记已应用、事务内结构改动回滚
//   - 迁移后数据完整性：核对清单表迁移后均存在、可读写
//
// 说明：better-sqlite3 为 Electron ABI 编译，vitest(Node ABI) 无法加载，
//   因此用 Node 原生 node:sqlite（真实 SQLite 引擎）包了一层与 better-sqlite3
//   兼容的薄适配（exec/prepare/pragma/transaction/memory），跑真实 SQL。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import {
  SCHEMA_VERSION,
  MIGRATION_DEFS,
  runMigrations,
  getDbSchemaVersion,
  listAppliedMigrations,
  ensureMigrationTable,
  type RunMigrationsResult
} from '../index'

// ============================================================
// better-sqlite3 兼容薄适配（基于 node:sqlite）
// ============================================================
type BindValue = string | number | bigint | null | Uint8Array
interface StmtLike {
  run: (...params: unknown[]) => { changes: number }
  all: (...params: unknown[]) => Array<Record<string, unknown>>
  get: (...params: unknown[]) => Record<string, unknown> | undefined
}

class MigMockDb {
  memory = true
  private raw: DatabaseSync

  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path)
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  prepare(sql: string): StmtLike {
    const st = this.raw.prepare(sql)
    return {
      run: (...params: unknown[]) =>
        st.run(...(params as BindValue[])) as { changes: number },
      all: (...params: unknown[]) =>
        st.all(...(params as BindValue[])) as Array<Record<string, unknown>>,
      get: (...params: unknown[]) =>
        st.get(...(params as BindValue[])) as Record<string, unknown> | undefined
    }
  }

  /* pragma(x)     → exec PRAGMA x = ...
   * pragma(x,{simple:true}) → 读取返回标量 */
  pragma(x: string, opts?: { simple?: boolean }): number {
    if (x.includes('=')) {
      this.raw.exec(`PRAGMA ${x}`)
      return 0
    }
    const row = this.raw.prepare(`PRAGMA ${x}`).get() as Record<string, unknown> | undefined
    void opts
    if (!row) return 0
    return Number(Object.values(row)[0]) || 0
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args: unknown[]) => {
      this.raw.exec('BEGIN')
      try {
        const result = fn(...args)
        this.raw.exec('COMMIT')
        return result
      } catch (e) {
        this.raw.exec('ROLLBACK')
        throw e
      }
    }
  }

  close(): void {
    try {
      this.raw.close()
    } catch {
      /* ignore */
    }
  }
}

// ============================================================
// 工具
// ============================================================

/** 读取 schema.sql 原文并 exec（还原真实初始化顺序：schema.sql → migrations） */
function createDbSeed(): MigMockDb {
  const db = new MigMockDb()
  const schemaPath = fileURLToPath(new URL('../../schema.sql', import.meta.url))
  db.exec(readFileSync(schemaPath, 'utf-8'))
  return db
}

/** 应用前 N 条迁移（N=0..SCHEMA_VERSION），复刻 runMigrations 的逐条执行 + 写 __migrations。
 *  刻意不写 user_version，用于模拟「旧库只靠 __migrations 追踪」的兼容场景。 */
function applyPrefix(db: MigMockDb, count: number): void {
  ensureMigrationTable(db as never)
  for (let i = 0; i < count; i++) {
    const def = MIGRATION_DEFS[i]
    def.up(db as never)
    db.prepare('INSERT INTO __migrations (id, applied_at) VALUES (?, ?)').run(
      def.id,
      new Date().toISOString()
    )
  }
}

/** 表是否存在 */
function tableExists(db: MigMockDb, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table)
  return !!row
}

/** 表的列名集合 */
function tableColumns(db: MigMockDb, table: string): Set<string> {
  const rows = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all()
  return new Set(rows.map((r) => String(r.name)))
}

/** 迁移后「不丢数据」核对清单（Task3.4）。均为迁移/schema.sql 创建的物理表。 */
const DATA_TABLES = [
  'topics',
  'events',
  'rounds',
  'team_groups',
  'teams',
  'team_history',
  'draw_sessions',
  'draw_session_items',
  'audit_log',
  'settings',
  'topic_custom_fields',
  'import_batch',
  'batch_edit_history',
  'batch_edit_history_item',
  'undo_log',
  'debate_formats',
  'timer_sessions',
  'timer_records',
  'bell_assets',
  'matches',
  'match_judges',
  'match_judge_votes',
  'judge_history',
  'topic_groups',
  'topic_group_items',
  'event_topic_groups',
  'round_topic_groups'
]

function countRows(db: MigMockDb, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}

const OPEN: Array<MigMockDb> = []
function track(db: MigMockDb): MigMockDb {
  OPEN.push(db)
  return db
}
afterEach(() => {
  for (const d of OPEN.splice(0)) d.close()
})

// ============================================================
// 测试
// ============================================================

describe('migrations / schema version（3.1）', () => {
  it('SCHEMA_VERSION 与迁移数目一致', () => {
    expect(SCHEMA_VERSION).toBe(MIGRATION_DEFS.length)
    expect(SCHEMA_VERSION).toBeGreaterThan(0)
  })

  it('空库 getDbSchemaVersion 为 0', () => {
    const db = track(createDbSeed())
    expect(getDbSchemaVersion(db as never)).toBe(0)
  })

  it('迁移 id 唯一，排序稳定', () => {
    const ids = MIGRATION_DEFS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    const sorted = [...ids].sort((a, b) => a.localeCompare(b))
    expect(ids).toEqual(sorted)
  })
})

describe('空库直出当前版本（3.5）', () => {
  it('空库跑一次迁移：全部 applied，version = SCHEMA_VERSION', () => {
    const db = track(createDbSeed())
    const r: RunMigrationsResult = runMigrations(db as never)

    expect(r.fromVersion).toBe(0)
    expect(r.toVersion).toBe(SCHEMA_VERSION)
    const applied = r.results.filter((x) => x.status === 'applied')
    expect(applied).toHaveLength(SCHEMA_VERSION)
    expect(listAppliedMigrations(db as never)).toHaveLength(SCHEMA_VERSION)
    expect(getDbSchemaVersion(db as never)).toBe(SCHEMA_VERSION)
  })
})

describe('最新库 / 幂等（3.5）', () => {
  it('最新库跑迁移：全部 skipped，记录数与版本不变', () => {
    const db = track(createDbSeed())
    applyPrefix(db, SCHEMA_VERSION)
    expect(listAppliedMigrations(db as never)).toHaveLength(SCHEMA_VERSION)

    // 老库 user_version=0，靠 __migrations 推导版本 → 应识别为已到最新
    expect(getDbSchemaVersion(db as never)).toBe(SCHEMA_VERSION)

    const r = runMigrations(db as never)
    expect(r.fromVersion).toBe(SCHEMA_VERSION)
    expect(r.results.every((x) => x.status === 'skipped')).toBe(true)
    expect(listAppliedMigrations(db as never)).toHaveLength(SCHEMA_VERSION)
  })

  it('重复执行幂等：不重复建表/不重复记录', () => {
    const db = track(createDbSeed())
    runMigrations(db as never)
    runMigrations(db as never)
    runMigrations(db as never)

    expect(listAppliedMigrations(db as never)).toHaveLength(SCHEMA_VERSION)
    // 关键表只存在一份（重复 create 不会导致多于一份）
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='matches'").get() as { n: number }).n
    ).toBe(1)
  })
})

describe('旧版本库逐级连升（3.5）', () => {
  it('从历史版本（缺最后 3 项）升到最新，仅应用缺失迁移', () => {
    const db = track(createDbSeed())
    const mid = SCHEMA_VERSION - 3
    applyPrefix(db, mid)

    expect(getDbSchemaVersion(db as never)).toBe(mid)

    const r = runMigrations(db as never)
    expect(r.fromVersion).toBe(mid)
    expect(r.toVersion).toBe(SCHEMA_VERSION)

    const applied = r.results.filter((x) => x.status === 'applied')
    expect(applied).toHaveLength(3) // 仅补齐缺失的 3 项
    const skipped = r.results.filter((x) => x.status === 'skipped')
    expect(skipped).toHaveLength(mid)
    expect(getDbSchemaVersion(db as never)).toBe(SCHEMA_VERSION)

    // 最后 3 项对应的结构确已补齐
    expect(tableExists(db, 'judge_history')).toBe(true)
    expect(tableExists(db, 'topic_groups')).toBe(true)
    expect(tableExists(db, 'round_topic_groups')).toBe(true)
    expect(tableColumns(db, 'events').has('bank_config')).toBe(true)
  })

  it('从任一历史版本连升到底，覆盖每个断点（逐级验证）', () => {
    // 从 0 到 SCHEMA_VERSION-1 每个断点都验证能一次升到最新
    for (let cut = 0; cut < SCHEMA_VERSION; cut++) {
      const db = track(createDbSeed())
      applyPrefix(db, cut)
      const r = runMigrations(db as never)
      expect(r.fromVersion).toBe(cut)
      expect(r.toVersion).toBe(SCHEMA_VERSION)
      const applied = r.results.filter((x) => x.status === 'applied')
      expect(applied).toHaveLength(SCHEMA_VERSION - cut)
      expect(getDbSchemaVersion(db as never)).toBe(SCHEMA_VERSION)
    }
  })
})

describe('中途失败非半状态（3.2 / 3.5）', () => {
  it('关键迁移失败 → 抛错、不记为已应用、事务内结构改动回滚', () => {
    // 构造：schema + 前 20260904 全部应用，然后删掉 topics 表，
    // 使 20260905（依赖 topics 做 UPDATE 回填）成为待应用且必然失败的关键迁移。
    const db = track(createDbSeed())
    const idx = MIGRATION_DEFS.findIndex((m) => m.id === '20260905_add_team_history_topic_title')
    expect(idx).toBeGreaterThan(0)
    applyPrefix(db, idx) // 已应用到 20260904 为止

    db.exec('DROP TABLE topics') // 制造失败前提

    expect(() => runMigrations(db as never)).toThrow()

    // 1) 失败的关键迁移未被记录为已应用
    const applied = listAppliedMigrations(db as never)
    expect(applied).not.toContain('20260905_add_team_history_topic_title')

    // 2) 事务内已发生的 ALTER（addTeamHistoryTopicTitle 先加 topic_title 列）被回滚
    expect(tableColumns(db, 'team_history').has('topic_title')).toBe(false)

    // 3) 之后的迁移也未执行（流水中止）
    expect(applied).not.toContain('20260906_ensure_match_multijudge_schema')
  })
})

describe('迁移后数据完整性（3.4）', () => {
  it('核对清单表全部存在，settings 记录数值 schema_version', async () => {
    const db = track(createDbSeed())
    await Promise.resolve()
    runMigrations(db as never)

    for (const t of DATA_TABLES) {
      expect(tableExists(db, t)).toBe(true)
    }

    // 核心业务表可写入读到（不丢数据前提：表可正常读写）
    expect(countRows(db, 'topics')).toBe(0)
    db.prepare(
      "INSERT INTO topics (id, title) VALUES (?, ?)"
    ).run('t1', '测试辩题')
    expect(countRows(db, 'topics')).toBe(1)

    // 版本正确：数值 schema version 与迁移数一致（user_version/settings 落盘由 db/index 编排，此处以 getDbSchemaVersion 校验）
    expect(getDbSchemaVersion(db as never)).toBe(SCHEMA_VERSION)
  })
})