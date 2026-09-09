// ============================================================
// backup-wal.test.ts — 备份 WAL 安全性的真实 SQLite 验证
//
// 覆盖范围：
//   1. WAL 模式下已提交但未 checkpoint 的事务，若不经 wal_checkpoint
//      直接拷贝主 .db 文件 → 备份中读不到该数据（反例，证明 checkpoint 必要）
//   2. 经 wal_checkpoint(TRUNCATE) 后拷贝（与生产 backupDatabaseSync 的
//      beforeCopy 回调同一 PRAGMA）→ 备份包含全部已提交数据
//   3. 备份文件 PRAGMA integrity_check = ok
//
// 引擎说明：node:sqlite 的 DatabaseSync 是真实 SQLite 引擎（Node 22+ 内置），
// 与 better-sqlite3 共享同一底层 SQLite 行为（WAL / checkpoint / integrity_check），
// 用于规避 better-sqlite3 的 Electron ABI 与 vitest(Node ABI) 不兼容问题。
// ============================================================
import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, copyFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let dir: string | null = null

function makeDbPath(name: string): string {
  if (!dir) dir = mkdtempSync(join(tmpdir(), 'bianhe-backup-wal-'))
  return join(dir, name)
}

afterEach(() => {
  if (dir) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    dir = null
  }
})

/** 打开一个 WAL 模式的真实 SQLite 库并建表 */
function openWalDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, val TEXT NOT NULL)')
  return db
}

describe('backup WAL safety: checkpoint-before-copy（真实 SQLite）', () => {
  it('反例：WAL 未 checkpoint 时直接拷贝主 .db，备份中读不到最新已提交数据', () => {
    const dbPath = makeDbPath('src-no-checkpoint.db')
    const backupPath = makeDbPath('backup-no-checkpoint.db')

    const db = openWalDb(dbPath)
    // 写入一条已提交数据（WAL 模式下默认停留在 -wal 文件，不自动合并到主库）
    db.prepare('INSERT INTO t (val) VALUES (?)').run('committed-but-in-wal')
    // 确认数据可读（连接内可见）
    const seen = db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
    expect(seen.c).toBe(1)

    // 直接拷贝主 .db（旧实现的缺陷路径）
    copyFileSync(dbPath, backupPath)
    expect(existsSync(backupPath)).toBe(true)

    // 用独立连接打开备份：WAL 中的数据（含建表语句本身）不在其中
    const b = new DatabaseSync(backupPath)
    const tables = b
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
    b.close()
    db.close()

    expect(tables).toHaveLength(0)
  })

  it('正例：wal_checkpoint(TRUNCATE) 后拷贝（与生产 backupDatabaseSync 同一 PRAGMA），备份包含全部已提交数据', () => {
    const dbPath = makeDbPath('src-checkpointed.db')
    const backupPath = makeDbPath('backup-checkpointed.db')

    const db = openWalDb(dbPath)
    db.prepare('INSERT INTO t (val) VALUES (?)').run('committed-before-checkpoint')

    // 与生产 backupDatabaseSync 的 beforeCopy 回调同一调用
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

    copyFileSync(dbPath, backupPath)
    expect(existsSync(backupPath)).toBe(true)

    const b = new DatabaseSync(backupPath)
    // 备份文件页级完整性
    const integrity = b.prepare('PRAGMA integrity_check').get() as {
      integrity_check: string
    }
    expect(integrity.integrity_check).toBe('ok')
    // WAL 中的最新提交已包含在备份内
    const rows = b.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
    const val = b.prepare('SELECT val FROM t LIMIT 1').get() as { val: string }
    b.close()
    db.close()

    expect(rows.c).toBe(1)
    expect(val.val).toBe('committed-before-checkpoint')
  })

  it('正例：连续多次写入 + checkpoint，备份始终反映全部已提交事务', () => {
    const dbPath = makeDbPath('src-multi.db')
    const backupPath = makeDbPath('backup-multi.db')

    const db = openWalDb(dbPath)
    for (let i = 0; i < 5; i++) {
      db.prepare('INSERT INTO t (val) VALUES (?)').run(`v${i}`)
      if (i === 2) db.exec('PRAGMA wal_checkpoint(TRUNCATE)') // 中途 checkpoint 一次
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

    copyFileSync(dbPath, backupPath)
    const b = new DatabaseSync(backupPath)
    const rows = b.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
    b.close()
    db.close()

    expect(rows.c).toBe(5)
  })
})
