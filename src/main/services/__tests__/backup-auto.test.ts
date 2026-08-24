// ============================================================
// backup-auto.test.ts — 数据库自动备份与恢复（Task 5.5）
//
// 覆盖 src/main/backup/index.ts：
//   - cleanupOldBackups：保留最近 7 份，超出清理
//   - runBackupIfNeeded：距上次备份 >24h 触发 / <24h 跳过 / 无时间戳触发
//   - backupDatabase：正常备份（复制 db + 写时间戳）
//   - deleteBackup / restoreBackup：参数校验 / schema 版本校验 / 复制恢复
//
// 用 vi.mock('electron') 把 userData 指向系统临时目录，用真实 fs 验证。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ---- mock electron.app.getPath -> 临时目录 ----
const { mockApp } = vi.hoisted(() => ({ mockApp: { getPath: vi.fn() } }))
vi.mock('electron', () => ({ app: mockApp }))

import {
  cleanupOldBackups,
  backupDatabase,
  runBackupIfNeeded,
  listBackups,
  deleteBackup,
  restoreBackup
} from '../../backup'

let tmpUserData: string

function setupTempUserData(): string {
  const dir = path.join(
    os.tmpdir(),
    `backup-auto-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 在备份目录写入 count 个 .db 备份文件，mtime 从 now 往前逐份递减 1 分钟 */
function writeBackupFiles(count: number): string[] {
  const backupsDir = path.join(tmpUserData, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  const names: string[] = []
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    const name = `backup-${i}.db`
    const full = path.join(backupsDir, name)
    fs.writeFileSync(full, `fake-db-${i}`)
    // 越早创建的文件 mtime 越小（越旧）；i=0 最新
    const mtime = new Date(now - i * 60000)
    fs.utimesSync(full, mtime, mtime)
    names.push(name)
  }
  return names
}

describe('backup 自动备份模块（Task 5.5）', () => {
  beforeEach(() => {
    tmpUserData = setupTempUserData()
    mockApp.getPath.mockReturnValue(tmpUserData)
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpUserData, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  describe('cleanupOldBackups：保留最近 7 份', () => {
    it('超过 7 份时删除最旧的，保留 7 份', () => {
      writeBackupFiles(10)
      const before = fs.readdirSync(path.join(tmpUserData, 'backups'))
      expect(before.filter((f) => f.endsWith('.db'))).toHaveLength(10)

      cleanupOldBackups()

      const after = fs.readdirSync(path.join(tmpUserData, 'backups')).filter((f) => f.endsWith('.db'))
      expect(after).toHaveLength(7)
      // 最新的 7 份（backup-0..backup-6）保留，最老的 3 份（backup-7/8/9）被清理
      expect(after).toContain('backup-0.db')
      expect(after).toContain('backup-6.db')
      expect(after).not.toContain('backup-7.db')
      expect(after).not.toContain('backup-9.db')
    })

    it('不超过 7 份时不做任何清理', () => {
      writeBackupFiles(5)
      cleanupOldBackups()
      const after = fs.readdirSync(path.join(tmpUserData, 'backups')).filter((f) => f.endsWith('.db'))
      expect(after).toHaveLength(5)
    })

    it('备份目录不存在时不报错', () => {
      expect(() => cleanupOldBackups()).not.toThrow()
    })
  })

  describe('runBackupIfNeeded：24h 判断', () => {
    it('无 last-backup.txt → 触发备份', async () => {
      // 需存在 db 文件才会真正复制
      fs.writeFileSync(path.join(tmpUserData, 'debate-drawer.db'), 'db-content')
      await runBackupIfNeeded()
      const backupsDir = path.join(tmpUserData, 'backups')
      expect(fs.existsSync(backupsDir)).toBe(true)
      expect(fs.existsSync(path.join(backupsDir, 'last-backup.txt'))).toBe(true)
      const dbs = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db'))
      expect(dbs).toHaveLength(1)
    })

    it('距上次备份 <24h → 跳过，不新增备份', async () => {
      writeBackupFiles(1)
      const backupsDir = path.join(tmpUserData, 'backups')
      fs.writeFileSync(path.join(tmpUserData, 'debate-drawer.db'), 'db-content')
      // 1 小时前备份过
      fs.writeFileSync(
        path.join(backupsDir, 'last-backup.txt'),
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        'utf8'
      )

      await runBackupIfNeeded()

      const after = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db'))
      expect(after).toHaveLength(1) // 未新增
    })

    it('距上次备份 >24h → 触发备份', async () => {
      writeBackupFiles(1)
      const backupsDir = path.join(tmpUserData, 'backups')
      fs.writeFileSync(path.join(tmpUserData, 'debate-drawer.db'), 'db-content')
      // 48 小时前备份过
      fs.writeFileSync(
        path.join(backupsDir, 'last-backup.txt'),
        new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        'utf8'
      )

      await runBackupIfNeeded()

      const after = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db'))
      expect(after).toHaveLength(2) // 新增 1 份
    })
  })

  describe('backupDatabase：正常备份', () => {
    it('复制 db 并写时间戳', async () => {
      fs.writeFileSync(path.join(tmpUserData, 'debate-drawer.db'), 'real-db-bytes')
      await backupDatabase()
      const backupsDir = path.join(tmpUserData, 'backups')
      const dbs = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db'))
      expect(dbs).toHaveLength(1)
      // 内容一致
      expect(fs.readFileSync(path.join(backupsDir, dbs[0]), 'utf8')).toBe('real-db-bytes')
      expect(fs.existsSync(path.join(backupsDir, 'last-backup.txt'))).toBe(true)
    })

    it('db 文件不存在时跳过（不创建备份）', async () => {
      await backupDatabase()
      const backupsDir = path.join(tmpUserData, 'backups')
      const dbs = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db'))
      expect(dbs).toHaveLength(0)
    })
  })

  describe('listBackups / deleteBackup / restoreBackup', () => {
    it('listBackups 返回按时间倒序的备份信息', async () => {
      writeBackupFiles(3)
      const backups = await listBackups()
      expect(backups).toHaveLength(3)
      // 最新在前（mtime 降序）
      expect(backups[0].filename).toBe('backup-0.db')
      expect(backups[2].filename).toBe('backup-2.db')
      expect(backups[0].size).toBeGreaterThan(0)
      expect(typeof backups[0].mtime).toBe('string')
    })

    it('deleteBackup：参数校验（路径穿越 / 非 .db）', async () => {
      writeBackupFiles(1)
      await expect(deleteBackup('../evil.db')).rejects.toThrow('Invalid backup filename')
      await expect(deleteBackup('foo\\bar.db')).rejects.toThrow('Invalid backup filename')
      await expect(deleteBackup('backup.txt')).rejects.toThrow('end with .db')
      await expect(deleteBackup('not-exist.db')).rejects.toThrow('Backup not found')
    })

    it('deleteBackup：删除已存在备份', async () => {
      writeBackupFiles(1)
      await deleteBackup('backup-0.db')
      const after = fs.readdirSync(path.join(tmpUserData, 'backups')).filter((f) => f.endsWith('.db'))
      expect(after).toHaveLength(0)
    })

    it('restoreBackup：参数校验 + 覆盖 db 文件', async () => {
      writeBackupFiles(1)
      fs.writeFileSync(path.join(tmpUserData, 'backups', 'backup-0.db'), 'backup-content')
      await expect(restoreBackup('../evil.db')).rejects.toThrow('Invalid backup filename')
      await expect(restoreBackup('no.db')).rejects.toThrow('Backup not found')

      // 备份文件为普通文本（非常规 sqlite）→ schemaVersion 读取失败视为 0，可正常恢复
      await restoreBackup('backup-0.db')
      const dbContent = fs.readFileSync(path.join(tmpUserData, 'debate-drawer.db'), 'utf8')
      expect(dbContent).toBe('backup-content')
    })
  })
})