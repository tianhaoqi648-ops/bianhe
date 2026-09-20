// ============================================================
// import-execute-concurrency.test.ts — P5-013 IMPORT_EXECUTE 并发去重回归
// （真 SQLite roundtrip + 受控 findDuplicates gate）
//
// 背景：IMPORT_EXECUTE 主体内唯一 await 点是 findDuplicates；existing
// 快照拉取与 createMany 之间的窗口可被另一 IMPORT_EXECUTE 的同步写插入
// （await 让出事件循环）→ 同一批数据绕过去重重复入库（check-then-act）。
// 修复：EXECUTE 主体经 serializeImport 串行化（check+act 同一安全边界）。
//
// 覆盖：
//   Case 1 顺序重复导入：第二次 duplicates 计数正确（既有语义不变）
//   Case 2 并发相同数据（关键）：第二个 findDuplicates 在第一个
//          createMany 之前未被调用（串行化直接证据）→ SQL GROUP BY
//          无重复行 + import_batch 统计/audit 一致
//   Case 3 不同数据并发：串行执行且都成功（串行 ≠ 拒绝）
//   Case 4 createMany 中途失败：整批回滚 + 占位批次删除
//   Case 5 findDuplicates 并发重叠计数 = 0（critical section 不重叠）
//
// 引擎：真 SQLite（node:sqlite MockDb + 真 repo SQL：topics/import_batch/
// topic_groups/topic_group_items/audit_log）；findDuplicates 经
// importOriginal 包装真实实现（去重语义保留），包装层提供 barrier 挂起
// 与并发重叠观测（生产代码零 test hook）。
// ============================================================
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// ---- node:sqlite → better-sqlite3 兼容薄适配（badge 测试同款）----
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
  /** better-sqlite3 兼容：node:sqlite 禁止 prepare PRAGMA，查询类返回空行 */
  pragma(_sql: string): unknown[] {
    return []
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

// ---- dedup-engine：importOriginal 包装真实 findDuplicates（语义保留）+
//      barrier 挂起 + 并发重叠观测 ----
const { dedupState, handleCalls } = vi.hoisted(() => ({
  dedupState: {
    active: 0,
    maxActive: 0,
    callCount: 0,
    barrier: null as Promise<void> | null
  },
  handleCalls: new Map<string, unknown>()
}))

vi.mock('../../services/dedup-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/dedup-engine')>()
  return {
    ...actual,
    findDuplicates: async (topics: unknown, options?: unknown) => {
      dedupState.active++
      dedupState.maxActive = Math.max(dedupState.maxActive, dedupState.active)
      dedupState.callCount++
      try {
        if (dedupState.barrier) {
          await dedupState.barrier
        }
        return await actual.findDuplicates(topics as never, options as never)
      } finally {
        dedupState.active--
      }
    }
  }
})

// ---- import-engine mock（静态依赖隔离，EXECUTE 路径不使用）----
vi.mock('../../services/import-engine', () => ({
  parseFile: vi.fn(),
  applyFieldMapping: vi.fn()
}))

// ---- electron：捕获 handler ----
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      handleCalls.set(channel, handler)
    })
  }
}))

// ---- 被测模块（mock 之后导入）----
import { registerImportIpc } from '../import.ipc'
import { IPC_CHANNELS } from '../../../shared/types'

const DDL = `
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) < 100),
    type TEXT, domain TEXT, difficulty TEXT, source TEXT, source_type TEXT,
    tags TEXT, weight REAL NOT NULL DEFAULT 1.0, status TEXT NOT NULL DEFAULT 'active',
    batch_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, custom_data TEXT
  );
  CREATE TABLE IF NOT EXISTS import_batch (
    id TEXT PRIMARY KEY, file_name TEXT, total_count INTEGER, imported_count INTEGER,
    duplicates_count INTEGER, failed_count INTEGER, imported_at TEXT, notes TEXT
  );
  CREATE TABLE IF NOT EXISTS topic_groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS topic_group_items (
    group_id TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (group_id, topic_id)
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, action TEXT, target_type TEXT, target_id TEXT,
    operator TEXT, detail TEXT, created_at TEXT
  );
`

type ExecuteHandler = (
  _e: unknown,
  req: unknown
) => Promise<{
  success: boolean
  error?: string
  data?: { imported: number; duplicates: number; failed: number; batchId: string }
}>

function executeHandler(): ExecuteHandler {
  const handler = handleCalls.get(IPC_CHANNELS.IMPORT_EXECUTE) as ExecuteHandler | undefined
  expect(handler, 'IMPORT_EXECUTE handler 未注册').toBeTruthy()
  return handler!
}

function waitUntil(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (cond()) return resolve()
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('waitUntil 超时：条件未在时限内成立'))
      }
      setTimeout(tick, 5)
    }
    tick()
  })
}

beforeAll(() => {
  registerImportIpc()
})

beforeEach(() => {
  mockDb.exec(DDL)
  for (const t of ['topic_group_items', 'topic_groups', 'topics', 'import_batch', 'audit_log']) {
    mockDb.exec(`DELETE FROM ${t}`)
  }
  dedupState.active = 0
  dedupState.maxActive = 0
  dedupState.callCount = 0
  dedupState.barrier = null
})

function topicCount(): number {
  return (mockDb.prepare('SELECT COUNT(*) AS n FROM topics').get() as { n: number }).n
}

function dupTitleRows(): Array<{ title: string; n: number }> {
  return mockDb
    .prepare('SELECT title, COUNT(*) AS n FROM topics GROUP BY title HAVING n > 1')
    .all() as Array<{ title: string; n: number }>
}

// title 取语义相远的措辞：真 findDuplicates 含 levenshtein/keyword 模糊匹配，
// 相近措辞（如「…一」「…二」）会被正确判重，不适合做「不同数据」用例
const REQ_A = { topics: [{ title: '人工智能伦理边界探讨' }, { title: '乡村振兴政策研究' }], checkDuplicates: true, fileName: 'a.xlsx' }
const REQ_B_SAME = { topics: [{ title: '人工智能伦理边界探讨' }, { title: '乡村振兴政策研究' }], checkDuplicates: true, fileName: 'b.xlsx' }

describe('P5-013 IMPORT_EXECUTE 并发去重回归（真 SQLite + 受控 gate）', () => {
  it('Case 1 顺序重复导入：第二次 duplicates=2（既有语义不变）', async () => {
    const handler = executeHandler()
    const r1 = await handler(null, REQ_A)
    expect(r1.success).toBe(true)
    expect(r1.data!.imported).toBe(2)
    expect(r1.data!.duplicates).toBe(0)

    const r2 = await handler(null, REQ_B_SAME)
    expect(r2.success).toBe(true)
    expect(r2.data!.imported).toBe(0)
    expect(r2.data!.duplicates).toBe(2)

    expect(topicCount()).toBe(2)
    expect(dupTitleRows()).toEqual([])
  })

  it('Case 2（关键）并发相同数据：第二个 findDuplicates 在第一个 createMany 前未被调用 → 无重复入库', async () => {
    const handler = executeHandler()
    // barrier：挂起第一个 import 的 findDuplicates（check 阶段）
    let release!: () => void
    dedupState.barrier = new Promise<void>((r) => {
      release = r
    })

    const p1 = handler(null, REQ_A)
    await waitUntil(() => dedupState.callCount === 1)

    // 串行化直接证据：第一个还在 check 阶段挂起时，第二个 EXECUTE 的
    // findDuplicates 尚未被调用（修复前：第二个此刻已在并发执行 check）
    const p2 = handler(null, REQ_B_SAME)
    await new Promise((r) => setTimeout(r, 20))
    expect(dedupState.callCount).toBe(1)

    // 放行第一个 → 第二个排队执行，existing 已包含第一个写入的数据
    release()
    const r1 = await p1
    const r2 = await p2

    expect(r1.success).toBe(true)
    expect(r1.data!.imported).toBe(2)
    expect(r2.success).toBe(true)
    expect(r2.data!.imported).toBe(0)
    expect(r2.data!.duplicates).toBe(2)

    // SQL 终态：无重复行
    expect(topicCount()).toBe(2)
    expect(dupTitleRows()).toEqual([])

    // batch 统计与实际一致
    const batches = mockDb
      .prepare('SELECT file_name, imported_count, duplicates_count FROM import_batch ORDER BY file_name')
      .all() as Array<{ file_name: string; imported_count: number; duplicates_count: number }>
    expect(batches).toEqual([
      { file_name: 'a.xlsx', imported_count: 2, duplicates_count: 0 },
      { file_name: 'b.xlsx', imported_count: 0, duplicates_count: 2 }
    ])

    // audit log 与导入批次一一对应
    const audits = mockDb
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'import'")
      .get() as { n: number }
    expect(audits.n).toBe(2)
  })

  it('Case 3 不同数据并发导入：串行执行且都成功（串行 ≠ 拒绝）', async () => {
    const handler = executeHandler()
    const p1 = handler(null, { topics: [{ title: '量子计算的错误校正机制' }], checkDuplicates: true, fileName: 'x.xlsx' })
    const p2 = handler(null, { topics: [{ title: '唐代边塞诗的意象研究' }], checkDuplicates: true, fileName: 'y.xlsx' })
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r1.data!.imported).toBe(1)
    expect(r2.data!.imported).toBe(1)
    expect(topicCount()).toBe(2)
    expect(dupTitleRows()).toEqual([])
  })

  it('Case 4 createMany 中途失败：整批回滚 + 占位批次删除', async () => {
    const handler = executeHandler()
    // 注入：第二个 title 违反 CHECK (length(title) < 100) → createMany
    // 事务内 INSERT 抛错 → 整批回滚 → deleteBatch 清理占位批次
    const longTitle = '超'.repeat(120)
    const res = await handler(null, {
      topics: [{ title: '正常辩题' }, { title: longTitle }],
      checkDuplicates: false,
      fileName: 'fail.xlsx'
    })

    expect(res.success).toBe(true) // 既有语义：createMany 失败不整体抛出，failed 计数返回
    expect(res.data!.imported).toBe(0)
    expect(res.data!.failed).toBe(2) // topicsToImport 全长（整批回滚，非半批）

    // 无半批成功：整批回滚
    expect(topicCount()).toBe(0)
    // 占位批次已删除，无孤立批次
    const batches = mockDb.prepare('SELECT COUNT(*) AS n FROM import_batch').get() as { n: number }
    expect(batches.n).toBe(0)
  })

  it('Case 5 findDuplicates 并发重叠计数 = 0（critical section 不重叠）', async () => {
    const handler = executeHandler()
    await Promise.all([
      handler(null, REQ_A),
      handler(null, REQ_B_SAME),
      handler(null, { topics: [{ title: '第三批辩题' }], checkDuplicates: true, fileName: 'c.xlsx' })
    ])
    // 三个并发 EXECUTE 的 findDuplicates 从未重叠（串行化边界成立）
    expect(dedupState.maxActive).toBe(1)
  })
})
