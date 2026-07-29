// ============================================================
// main/backup/index.ts — 数据库自动备份与恢复
//
// 备份目录：app.getPath('userData')/backups/
//   userData 在 Windows 上默认为 %APPDATA%/辩盒/，最终路径形如：
//   C:\Users\<user>\AppData\Roaming\辩盒\backups\
//
// 策略：
//   - 应用启动时若距上次备份 >24h，自动备份一次
//   - 备份文件名格式：{YYYYMMDD-HHmmss}.db
//   - 保留最近 7 份，超出自动清理（按 mtime 排序）
//   - 恢复：复制备份覆盖当前 db 文件（不关闭连接，由用户重启生效）
// ============================================================

import { app } from 'electron'
import { join } from 'path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'

/** 备份保留份数 */
const MAX_BACKUPS = 7
/** 触发自动备份的间隔（ms），24h */
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 备份文件信息（用于渲染进程展示） */
export interface BackupInfo {
  filename: string
  size: number
  mtime: string
}

/** 获取备份目录绝对路径（不创建） */
function getBackupsDir(): string {
  return join(app.getPath('userData'), 'backups')
}

/** 获取 last-backup.txt 时间戳文件路径 */
function getLastBackupPath(): string {
  return join(getBackupsDir(), 'last-backup.txt')
}

/** 获取当前数据库文件路径（与 initDatabase 保持一致） */
function getDbPath(): string {
  return join(app.getPath('userData'), 'debate-drawer.db')
}

/** 生成 YYYYMMDD-HHmmss 格式时间戳 */
function formatTimestamp(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/**
 * 扫描备份目录，返回 .db 文件列表（按 mtime 降序，最新的在前）。
 */
function scanBackups(): Array<{ filename: string; size: number; mtimeMs: number }> {
  const dir = getBackupsDir()
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const items: Array<{ filename: string; size: number; mtimeMs: number }> = []
  for (const name of entries) {
    if (!name.endsWith('.db')) continue
    if (name === 'last-backup.txt') continue
    const full = join(dir, name)
    try {
      const st = statSync(full)
      if (!st.isFile()) continue
      items.push({ filename: name, size: st.size, mtimeMs: st.mtimeMs })
    } catch {
      /* skip */
    }
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return items
}

/**
 * 清理旧备份，仅保留最近 MAX_BACKUPS 份。
 */
export function cleanupOldBackups(): void {
  const items = scanBackups()
  if (items.length <= MAX_BACKUPS) return
  const toDelete = items.slice(MAX_BACKUPS)
  for (const it of toDelete) {
    try {
      unlinkSync(join(getBackupsDir(), it.filename))
      console.log('[backup] Old backup removed:', it.filename)
    } catch (e) {
      console.warn('[backup] Failed to remove old backup:', it.filename, e)
    }
  }
}

/**
 * 立即执行一次数据库备份：
 * 1. 复制 db 文件到 backups/{YYYYMMDD-HHmmss}.db
 * 2. 更新 last-backup.txt 时间戳
 * 3. 调用 cleanupOldBackups
 */
export async function backupDatabase(): Promise<void> {
  const dir = getBackupsDir()
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  } catch (e) {
    console.error('[backup] mkdir failed:', e)
    throw e
  }

  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    console.warn('[backup] DB file does not exist, skip:', dbPath)
    return
  }

  const timestamp = formatTimestamp(new Date())
  const backupName = `${timestamp}.db`
  const backupPath = join(dir, backupName)

  try {
    copyFileSync(dbPath, backupPath)
    console.log('[backup] Backup created:', backupPath)
  } catch (e) {
    console.error('[backup] copyFileSync failed:', e)
    throw e
  }

  try {
    writeFileSync(getLastBackupPath(), new Date().toISOString(), 'utf8')
  } catch (e) {
    console.warn('[backup] update last-backup.txt failed:', e)
  }

  cleanupOldBackups()
}

/**
 * 若距上次备份 >24h，则触发备份。
 *
 * - last-backup.txt 不存在或读取失败 → 触发备份
 * - 时间戳解析失败 → 触发备份
 * - 距上次 <24h → 跳过
 */
export async function runBackupIfNeeded(): Promise<void> {
  const lastPath = getLastBackupPath()
  let shouldBackup = true

  if (existsSync(lastPath)) {
    try {
      const content = readFileSync(lastPath, 'utf8').trim()
      const last = new Date(content).getTime()
      if (!Number.isNaN(last)) {
        const diff = Date.now() - last
        if (diff < BACKUP_INTERVAL_MS) {
          shouldBackup = false
          console.log('[backup] Skip, last backup was at', content)
        }
      }
    } catch {
      /* 解析失败视为需要备份 */
    }
  }

  if (shouldBackup) {
    await backupDatabase()
  }
}

/**
 * 列出当前所有备份（按时间倒序）。
 */
export async function listBackups(): Promise<BackupInfo[]> {
  const items = scanBackups()
  return items.map((it) => ({
    filename: it.filename,
    size: it.size,
    mtime: new Date(it.mtimeMs).toISOString()
  }))
}

/**
 * 删除指定备份。
 *
 * @param filename 备份文件名（仅 basename，不允许包含路径分隔符）
 */
export async function deleteBackup(filename: string): Promise<void> {
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid backup filename')
  }
  if (!filename.endsWith('.db')) {
    throw new Error('Backup filename must end with .db')
  }
  const full = join(getBackupsDir(), filename)
  if (!existsSync(full)) {
    throw new Error(`Backup not found: ${filename}`)
  }
  unlinkSync(full)
  console.log('[backup] Backup deleted:', filename)
}

/**
 * 恢复指定备份：复制备份文件覆盖当前 db 文件。
 *
 * 注意：不会主动关闭数据库连接（避免影响正在运行的事务）。
 * 用户需重启应用以加载恢复后的数据。
 *
 * @param filename 备份文件名（仅 basename，不允许包含路径分隔符）
 */
export async function restoreBackup(filename: string): Promise<void> {
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid backup filename')
  }
  if (!filename.endsWith('.db')) {
    throw new Error('Backup filename must end with .db')
  }
  const src = join(getBackupsDir(), filename)
  if (!existsSync(src)) {
    throw new Error(`Backup not found: ${filename}`)
  }
  const dbPath = getDbPath()
  // 先复制到临时文件再 rename，避免覆盖失败导致半写状态
  const tmp = `${dbPath}.restore-tmp`
  copyFileSync(src, tmp)
  try {
    renameSync(tmp, dbPath)
  } catch (e) {
    // rename 跨卷可能失败，回退为直接 copy
    try {
      copyFileSync(src, dbPath)
      unlinkSync(tmp)
    } catch (e2) {
      throw e2
    }
  }
  console.log('[backup] Backup restored:', filename, '->', dbPath)
}
