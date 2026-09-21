// ============================================================
// schema-whitelist-drift.test.ts — 备份恢复列白名单 vs 真实 schema 漂移防护
//
// 背景（BUG-P6-001 timer_sessions.match_id / BUG-P6-002 team_history.topic_title）：
//   结构化备份导出走 SELECT *，行内列 = 真实 schema 的全部列；
//   导入时 bulkInsert 按 repository/utils.ts 的 TABLE_COLUMNS 白名单校验，
//   一旦真实 schema 新增列而白名单未同步，该类别导入即抛错整体失败。
//   此类「加列后忘记同步白名单」的漂移已发生两次，此前无系统性测试防护。
//
// 真实 schema 构建（还原 db/index.ts configureAndSeed 的初始化顺序）：
//   schema.sql → runMigrations()（src/main/db/migrations）→ agent 表建表。
//   注意：部分列（matches.recording_meta、team_history.topic_title、
//   undo_log.undone_at 等）只存在于迁移中而不在 schema.sql，
//   因此迁移必须纳入真实 schema，否则本测试会漏报。
//
// 断言方向（首次落地时双向现状已完全一致，故均为硬断言）：
//   1. 真实列 ⊆ 白名单（防 BUG-P6-001/002 同类漂移，历史已两次翻车）；
//   2. 白名单表必须真实存在（防幽灵表）；
//   3. 白名单列 ⊆ 真实列（白名单引用不存在的列，虽不直接导致导入故障，
//      但属同源漂移，一并拦截；正常加列流程「schema + 白名单同 PR 同步」
//      两个方向都不会被误伤）。
// ============================================================
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

// ============================================================
// better-sqlite3 兼容薄适配（基于 node:sqlite）
// 与 migrations/__tests__/migrations.test.ts 的 MigMockDb 同构
// ============================================================
type BindValue = string | number | bigint | null | Uint8Array

class SchemaMockDb {
  memory = true
  private raw: DatabaseSync

  constructor() {
    this.raw = new DatabaseSync(':memory:')
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  prepare(sql: string) {
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
   * pragma(x)     → 读取返回标量 */
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

const mockDb = new SchemaMockDb()
// agent-session / agent-message repo 顶层 import '../index'（耦合 electron），
// 与 integration-phase6-a-b-e.test.ts 同法 mock 掉；utils.ts 只在函数体内
// 调用 getDb，建表 init 函数直接接收 db 参数，均不受影响。
vi.mock('../../index', () => ({ getDb: () => mockDb }))

// 被测模块（mock 之后导入）
import { runMigrations } from '../../migrations'
import { TABLE_COLUMNS } from '../utils'
import { initAgentSessionTable } from '../agent-session.repo'
import { initAgentMessageTable } from '../agent-message.repo'

let db: SchemaMockDb

beforeAll(() => {
  // 还原生产初始化顺序：schema.sql → 全部迁移 → agent 表
  const schemaPath = fileURLToPath(new URL('../../schema.sql', import.meta.url))
  db = new SchemaMockDb()
  db.exec(readFileSync(schemaPath, 'utf-8'))
  runMigrations(db as never)
  initAgentSessionTable(db as never)
  initAgentMessageTable(db as never)
})

afterAll(() => {
  db?.close()
})

/** 表是否真实存在 */
function tableExists(table: string): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table)
}

/** 表的真实列名集合（PRAGMA table_info） */
function realColumns(table: string): Set<string> {
  const rows = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all()
  return new Set(rows.map((r) => String(r.name)))
}

describe('TABLE_COLUMNS 白名单 vs 真实 schema（备份恢复漂移防护）', () => {
  it('白名单中的每个表都真实存在（防幽灵表）', () => {
    const tables = Object.keys(TABLE_COLUMNS)
    expect(tables.length).toBeGreaterThan(0)
    for (const table of tables) {
      expect(tableExists(table), `白名单表 ${table} 在真实 schema 中不存在（幽灵表）`).toBe(true)
    }
  })

  it('真实 schema 列 ⊆ TABLE_COLUMNS 白名单（BUG-P6-001/002 同类漂移防护）', () => {
    const problems: string[] = []
    for (const [table, allowed] of Object.entries(TABLE_COLUMNS)) {
      const missing = [...realColumns(table)].filter((c) => !allowed.includes(c))
      if (missing.length > 0) {
        problems.push(`表 ${table}: 真实列 [${missing.join(', ')}] 不在白名单中`)
      }
    }
    expect(
      problems,
      '白名单缺列（真实 schema 新增列后未同步 utils.ts 的 TABLE_COLUMNS，' +
        '将导致该类别结构化备份导入整体失败）:\n' +
        problems.join('\n')
    ).toEqual([])
  })

  it('白名单列 ⊆ 真实 schema 列（防白名单引用不存在的列）', () => {
    const extras: string[] = []
    for (const [table, allowed] of Object.entries(TABLE_COLUMNS)) {
      const real = realColumns(table)
      for (const col of allowed) {
        if (!real.has(col)) extras.push(`${table}.${col}`)
      }
    }
    // 首次落地（2026-09）时两侧现状完全一致，故收紧为硬断言。
    expect(
      extras,
      '白名单列在真实 schema 中不存在（TABLE_COLUMNS 加了列但 schema.sql / 迁移未落地）:\n' +
        extras.join('\n')
    ).toEqual([])
  })
})
