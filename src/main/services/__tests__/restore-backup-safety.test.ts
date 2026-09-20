// ============================================================
// restore-backup-safety.test.ts — P5-003 + P5-010 restore 安全回归
// （真 SQLite roundtrip）
//
// 覆盖：
//   1. WAL restore：active 库启用 WAL 且 WAL 含未 checkpoint 帧，恢复源内容
//      明显不同 → restore 后重开库内容 == 纯备份源，无旧事务污染（P5-003）
//   2. corrupted source（FK 孤儿行）→ restore 失败，active 旧库完整可打开、
//      integrity ok（P5-010 失败前后断言，不止 throws）
//   3. corrupted source（垃圾字节）→ fail-closed 拒绝，active 未被触碰
//   4. successful restore：active=B、integrity ok、FK ok、回退副本/临时文件清理
//   5. swap 失败 → 从回退副本还原，active 保持旧库
//
// 引擎说明：
//   - 真实 SQLite 文件 + node:sqlite DatabaseSync；backup/index.ts 内部动态
//     import('better-sqlite3') 在 vitest（Node ABI）下不可加载，因此用
//     vi.mock('better-sqlite3') 注入 node:sqlite 适配器（生产代码零改动）。
//   - WAL 帧构造方式：active 连接写入后【不执行任何 checkpoint】；SQLite 默认
//     auto-checkpoint 阈值为 1000 页，测试仅写数行（<<1000 页），WAL 帧得以保留
//     （测试中显式断言 -wal 文件存在且 >0 字节，保证场景成立）。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DatabaseSync } from 'node:sqlite'

// ---- mock electron.app.getPath -> 临时 userData ----
const { mockApp, state } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn() },
  state: {
    // restore 的 wal_checkpoint(TRUNCATE) 经此真实执行（mock getDb 目标）
    activeConnection: null as {
      memory: boolean
      pragma: (sql: string, opts?: { simple?: boolean }) => unknown
    } | null,
    // swap 失败注入开关（P5-010 还原路径测试用）
    injectSwapFailure: false
  }
}))
vi.mock('electron', () => ({ app: mockApp }))

// ---- mock fs：默认全部透传；injectSwapFailure 开启时令「tmp -> 正式库」的
//      覆盖拷贝抛错，迫使 restore 走回退分支（ESM namespace 不可 spyOn，故用工厂包装）----
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    copyFileSync: (src: fs.PathLike, dest: fs.PathLike) => {
      if (
        state.injectSwapFailure &&
        String(src).endsWith('.restore-tmp') &&
        String(dest).endsWith('debate-drawer.db')
      ) {
        throw new Error('injected swap failure')
      }
      return actual.copyFileSync(src, dest)
    }
  }
})

// ---- mock '../../db'（backup/index.ts 内 await import('../db') 的目标）----
// active 连接由测试打开后注入；restore 的 wal_checkpoint(TRUNCATE) 经此真实执行。
vi.mock('../../db', () => ({
  getDb: () => {
    if (!state.activeConnection) {
      throw new Error('Database not initialized. Call initDatabase() first.')
    }
    return state.activeConnection
  }
}))

// ---- mock better-sqlite3：node:sqlite 适配（供 getDbFileSchemaVersion /
//      getIntegrityCheckResult / getRestoredFkViolations 的动态 import 使用）----
vi.mock('better-sqlite3', async () => {
  const { createFileDbClass } = await import('./helpers/node-sqlite-adapter')
  return { default: createFileDbClass() }
})

// 被测模块（mock 之后导入）
import { restoreBackup } from '../../backup'
import { setRecordingActive } from '../recording-active'

let tmpUserData: string
let activeRaw: DatabaseSync | null = null

const DB_NAME = 'debate-drawer.db'

function dbPath(): string {
  return path.join(tmpUserData, DB_NAME)
}

function backupsPath(name: string): string {
  return path.join(tmpUserData, 'backups', name)
}

/** 打开 active 库（WAL）并建 items 表；同时注入 mock getDb 供 restore checkpoint 使用 */
function openActive(wal: boolean): void {
  activeRaw = new DatabaseSync(dbPath())
  if (wal) {
    activeRaw.exec('PRAGMA journal_mode = WAL')
  }
  activeRaw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, tag TEXT)')
  const raw = activeRaw
  state.activeConnection = {
    memory: false,
    pragma: (sql: string, opts?: { simple?: boolean }) => {
      const stmt = raw.prepare(`PRAGMA ${sql}`)
      if (opts?.simple) {
        const row = stmt.get() as Record<string, unknown> | undefined
        return row ? Object.values(row)[0] : undefined
      }
      return stmt.all()
    }
  }
}

/** 生成内容为 tag 的独立 sqlite 文件（checkpoint + close），返回文件路径 */
function makeSourceDb(tag: string, opts?: { orphanFk?: boolean }): string {
  const p = path.join(tmpUserData, `source-${tag}-${Math.random().toString(36).slice(2)}.db`)
  const d = new DatabaseSync(p)
  if (opts?.orphanFk) {
    // FK 孤儿：parent/child 约束声明于 schema。node:sqlite 默认启用 FK 强制，
    // 因此构造数据时用 FK OFF 连接插入孤儿行；foreign_key_check 基于数据本身
    // 检查，任何后续连接都能检出违规。
    const dOff = new DatabaseSync(p, { enableForeignKeyConstraints: false })
    dOff.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
    `)
    dOff.prepare('INSERT INTO child (id, parent_id) VALUES (1, 999)').run()
    dOff.close()
    return p
  }
  d.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, tag TEXT)')
  d.prepare('INSERT INTO items (tag) VALUES (?)').run(tag)
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  d.close()
  return p
}

/** 把 sqlite 文件放入 backups 目录 */
function stageBackup(srcFile: string, name: string): void {
  fs.mkdirSync(path.join(tmpUserData, 'backups'), { recursive: true })
  fs.copyFileSync(srcFile, backupsPath(name))
}

/** 以只读新连接读取 active 库 items 内容（验证「重新打开后的最终状态」） */
function readActiveTags(): string[] {
  const d = new DatabaseSync(dbPath())
  const rows = d.prepare('SELECT tag FROM items').all() as Array<{ tag: string }>
  d.close()
  return rows.map((r) => r.tag)
}

function integrityOk(): boolean {
  const d = new DatabaseSync(dbPath())
  const rows = d.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
  d.close()
  return rows.length > 0 && rows[0].integrity_check === 'ok'
}

function fkViolationCount(): number {
  const d = new DatabaseSync(dbPath())
  const rows = d.prepare('PRAGMA foreign_key_check').all() as unknown[]
  d.close()
  return rows.length
}

beforeEach(() => {
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-safety-'))
  mockApp.getPath.mockReturnValue(tmpUserData)
  state.activeConnection = null
  state.injectSwapFailure = false
  setRecordingActive(false)
})

afterEach(() => {
  try {
    activeRaw?.close()
  } catch {
    /* ignore */
  }
  activeRaw = null
  state.activeConnection = null
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

describe('restoreBackup 安全回归（P5-003 + P5-010，真 SQLite）', () => {
  it('WAL restore：恢复后重开内容 == 纯备份源，无旧 WAL 事务污染（P5-003）', async () => {
    // active A：WAL 模式 + 写入（不 checkpoint，WAL 帧保留）
    openActive(true)
    activeRaw!.prepare("INSERT INTO items (tag) VALUES ('A-data')").run()

    // 场景自检：WAL 文件确实存在且有内容（帧未 checkpoint）
    const walFile = `${dbPath()}-wal`
    expect(fs.existsSync(walFile)).toBe(true)
    expect(fs.statSync(walFile).size).toBeGreaterThan(0)

    // 备份源 B：内容明显不同
    stageBackup(makeSourceDb('B-data'), 'backup-b.db')

    await restoreBackup('backup-b.db')

    // 重新打开：内容必须是纯 B，不得混入 A 的旧事务
    const tags = readActiveTags()
    expect(tags).toEqual(['B-data'])
    expect(tags).not.toContain('A-data')
    expect(integrityOk()).toBe(true)
    expect(fkViolationCount()).toBe(0)

    // cleanup：无临时/回退文件残留
    expect(fs.existsSync(`${dbPath()}.restore-tmp`)).toBe(false)
    expect(fs.existsSync(`${dbPath()}.restore-old`)).toBe(false)
  })

  it('corrupted source（FK 孤儿行）→ restore 失败，旧库完整且 integrity ok（P5-010）', async () => {
    openActive(false)
    activeRaw!.prepare("INSERT INTO items (tag) VALUES ('A-data')").run()

    stageBackup(makeSourceDb('junk', { orphanFk: true }), 'backup-orphan.db')

    await expect(restoreBackup('backup-orphan.db')).rejects.toThrow('外键校验失败')

    // 失败前后：active 仍为 A，A 数据完整、可打开、integrity ok（不止断言 throws）
    expect(readActiveTags()).toEqual(['A-data'])
    expect(integrityOk()).toBe(true)
    expect(fs.existsSync(`${dbPath()}.restore-tmp`)).toBe(false)
    expect(fs.existsSync(`${dbPath()}.restore-old`)).toBe(false)
  })

  it('corrupted source（垃圾字节）→ fail-closed 拒绝，active 未被触碰', async () => {
    openActive(false)
    activeRaw!.prepare("INSERT INTO items (tag) VALUES ('A-data')").run()

    fs.mkdirSync(path.join(tmpUserData, 'backups'), { recursive: true })
    fs.writeFileSync(backupsPath('backup-junk.db'), 'this is not a sqlite database at all')

    await expect(restoreBackup('backup-junk.db')).rejects.toThrow('完整性校验失败')

    expect(readActiveTags()).toEqual(['A-data'])
    expect(integrityOk()).toBe(true)
    expect(fs.existsSync(`${dbPath()}.restore-tmp`)).toBe(false)
  })

  it('successful restore（非 WAL）：active=B、integrity/FK ok、回退副本与临时文件清理', async () => {
    openActive(false)
    activeRaw!.prepare("INSERT INTO items (tag) VALUES ('A-data')").run()

    stageBackup(makeSourceDb('B-data'), 'backup-b.db')
    await restoreBackup('backup-b.db')

    expect(readActiveTags()).toEqual(['B-data'])
    expect(integrityOk()).toBe(true)
    expect(fkViolationCount()).toBe(0)
    expect(fs.existsSync(`${dbPath()}.restore-tmp`)).toBe(false)
    expect(fs.existsSync(`${dbPath()}.restore-old`)).toBe(false)
  })

  it('swap 失败 → 从回退副本还原，active 保持旧库（P5-010 还原路径）', async () => {
    openActive(false)
    activeRaw!.prepare("INSERT INTO items (tag) VALUES ('A-data')").run()

    stageBackup(makeSourceDb('B-data'), 'backup-b.db')

    // 注入：rename 之后的覆盖拷贝（tmp -> dbPath）失败，迫使走回退分支。
    // renameSync 对 Windows 上被打开的 dbPath 通常已失败，copyFileSync 是实际替换路径。
    state.injectSwapFailure = true

    await expect(restoreBackup('backup-b.db')).rejects.toThrow('injected swap failure')

    state.injectSwapFailure = false

    // 回退生效：active 仍是 A，数据完整
    expect(readActiveTags()).toEqual(['A-data'])
    expect(integrityOk()).toBe(true)
    // tmp 已清理；回退副本在成功还原后也不残留
    expect(fs.existsSync(`${dbPath()}.restore-tmp`)).toBe(false)
    expect(fs.existsSync(`${dbPath()}.restore-old`)).toBe(false)
  })
})
