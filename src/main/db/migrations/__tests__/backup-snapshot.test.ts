// ============================================================
// migrations/__tests__/backup-snapshot.test.ts — 迁移前快照与恢复版本校验（Task3.3）
//
// 覆盖：
//   - backupDatabaseSync()：迁移前自动快照写入 backups 目录、返回文件名、沿用保留策略
//   - restoreBackup()：校验备份 schema 版本，高于当前支持版本则拒绝恢复
//
// 说明：electron 与 better-sqlite3（Electron ABI）在 vitest 下不可用，
//   通过 vi.mock 分别替换 app.getPath 与动态 import('better-sqlite3') 的返回值。
// ============================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { SCHEMA_VERSION } from '../index'

// ---- 临时 userData 目录 ----
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-backup-test-'))
const userData = path.join(tmpRoot, 'userData')

// ---- mock electron：app.getPath 返回临时 userData ----
vi.mock('electron', () => ({
  app: { getPath: () => userData }
}))

// ---- mock better-sqlite3（getDbFileSchemaVersion / 恢复后 foreign_key_check 的动态 import）----
const state = vi.hoisted(() => ({
  schemaVersion: 0,
  /** 恢复后 foreign_key_check 应返回的孤立引用行（[] 表示无违规） */
  fkViolations: [] as unknown[]
}))
vi.mock('better-sqlite3', () => ({
  default: class FakeDb {
    pragma(op: string, _opts?: { simple?: boolean }): unknown {
      if (op === 'foreign_key_check') return state.fkViolations
      return state.schemaVersion
    }
    close(): void {}
  }
}))

// ---- 在 mock 之后 import ----
import { backupDatabaseSync, restoreBackup } from '../../../backup'

function getBackupsDir(): string {
  return path.join(userData, 'backups')
}

function listBackupFiles(): string[] {
  const dir = getBackupsDir()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.db'))
}

beforeAll(() => {
  fs.mkdirSync(userData, { recursive: true })
})

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('backupDatabaseSync（迁移前自动快照）', () => {
  it('db 文件不存在时返回 null 且不创建快照', () => {
    // 确保无 db 文件
    const dbPath = path.join(userData, 'debate-drawer.db')
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    expect(backupDatabaseSync()).toBeNull()
    expect(listBackupFiles()).toHaveLength(0)
  })

  it('生成 pre-migration 快照并入库 backups 目录', () => {
    const dbPath = path.join(userData, 'debate-drawer.db')
    fs.writeFileSync(dbPath, 'DBDATA-v5', 'utf8')

    const name = backupDatabaseSync()
    expect(name).toBeTruthy()
    expect(name!.startsWith('pre-migration-')).toBe(true)
    expect(name!.endsWith('.db')).toBe(true)

    const files = listBackupFiles()
    expect(files).toContain(name!)
    const content = fs.readFileSync(path.join(getBackupsDir(), name!), 'utf8')
    expect(content).toBe('DBDATA-v5')
  })
})

describe('restoreBackup schema 版本校验', () => {
  it('备份版本高于当前支持版本 → 拒绝恢复', async () => {
    const name = listBackupFiles()[0]
    expect(name).toBeTruthy()

    state.schemaVersion = SCHEMA_VERSION + 99
    await expect(restoreBackup(name!)).rejects.toThrow(/高于当前应用支持的版本/)
  })

  it('备份版本 ≤ 当前支持版本 → 恢复成功并覆盖 db 文件', async () => {
    const name = listBackupFiles()[0]
    expect(name).toBeTruthy()

    const dbPath = path.join(userData, 'debate-drawer.db')
    state.schemaVersion = SCHEMA_VERSION
    await restoreBackup(name! as string)

    // 恢复后 db 文件内容被备份覆盖
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('DBDATA-v5')
  })

  it('恢复后 foreign_key_check 存在孤立引用 → 明确抛错（不静默成功）', async () => {
    const name = listBackupFiles()[0]
    expect(name).toBeTruthy()

    state.schemaVersion = SCHEMA_VERSION
    state.fkViolations = [
      { table: 'match_judges', rowid: 7, parent: 'matches', fkid: 0 }
    ]
    try {
      await expect(restoreBackup(name! as string)).rejects.toThrow('外键校验失败')
    } finally {
      state.fkViolations = []
    }
  })

  it('恢复后无孤立引用 → 恢复成功且不抛错', async () => {
    const name = listBackupFiles()[0]
    expect(name).toBeTruthy()

    state.schemaVersion = SCHEMA_VERSION
    state.fkViolations = []
    await expect(restoreBackup(name! as string)).resolves.toBeUndefined()
  })
})