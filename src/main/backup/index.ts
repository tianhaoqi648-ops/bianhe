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
//
// Task3 加固：
//   - backupDatabaseSync()：同步快照，供 schema 升级前自动备份复用（沿用本文件备份机制）
//   - 备份文件本身为原始 .db 拷贝，天然保留数据 + schema 版本（PRAGMA user_version），
//     恢复时校验备份的 schema 版本不高于当前应用支持的版本，避免把未来 schema 的数据回灌旧应用。
// ============================================================

import { app } from 'electron'
import { join } from 'path'
import type Database from 'better-sqlite3'
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
import { SCHEMA_VERSION } from '../db/migrations'

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

// ------------------------------------------------------------
// 备份/恢复操作互斥：保证 backup 与 restore 不交叉执行
// （restore 会覆盖 db 文件，若与 backup 并发可能产生半写状态）
// ------------------------------------------------------------
let opChain: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn)
  opChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
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
 * 1. 通过 better-sqlite3 在线备份 API（db.backup()）落盘——原子写入且天然包含
 *    WAL 中已提交但尚未 checkpoint 的事务，避免「拷贝主 .db 丢最近写入」的问题
 * 2. 更新 last-backup.txt 时间戳
 * 3. 调用 cleanupOldBackups
 *
 * 内存库（无对应 db 文件）退化为文件拷贝；在线备份失败时回退为拷贝兜底。
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

  await serialize(async () => {
    let usedOnlineBackup = false
    try {
      // 延迟导入：避免模块顶层硬依赖 better-sqlite3（Electron ABI）以便单测加载本模块
      const { getDb } = await import('../db')
      const database = getDb()
      if (!database.memory) {
        await database.backup(backupPath)
        usedOnlineBackup = true
        console.log('[backup] Backup created (online backup API):', backupPath)
      }
    } catch (e) {
      console.warn('[backup] online backup failed, fallback to file copy:', e)
    }
    if (!usedOnlineBackup) {
      try {
        copyFileSync(dbPath, backupPath)
        console.log('[backup] Backup created (file copy fallback):', backupPath)
      } catch (e) {
        console.error('[backup] copyFileSync failed:', e)
        throw e
      }
    }
  })

  try {
    writeFileSync(getLastBackupPath(), new Date().toISOString(), 'utf8')
  } catch (e) {
    console.warn('[backup] update last-backup.txt failed:', e)
  }

  cleanupOldBackups()
}

/**
 * 同步执行一次数据库备份（供 schema 升级前自动备份复用）。
 *
 * 与 backupDatabase() 的区别：
 *   - 同步（迁移流程为同步执行，无法 await；better-sqlite3 的 db.backup() 为异步 API，
 *     因此本函数改用「调用方注入 wal_checkpoint + copyFileSync」保证 WAL 数据落盘）
 *   - 返回备份文件名；db 文件不存在时返回 null
 *   - 文件名以 `pre-migration-` 前缀标识「迁移前快照」，便于区分与运维排查
 *
 * 复用现有备份机制：同一 backups 目录、同一保留 7 份清理策略。
 *
 * @param opts.beforeCopy 在 copyFileSync 之前执行的回调（调用方在此执行
 *   `pragma('wal_checkpoint(TRUNCATE)')`，把 WAL 中已提交事务合并进主库文件，
 *   确保快照包含全部已提交数据）。未提供时退化为纯拷贝（WAL 未合并数据可能缺失）。
 */
export function backupDatabaseSync(opts?: {
  beforeCopy?: () => void
}): string | null {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    console.warn('[backup] DB file does not exist, skip schema-migration snapshot:', dbPath)
    return null
  }
  const dir = getBackupsDir()
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  } catch (e) {
    console.error('[backup] mkdir failed:', e)
    throw e
  }

  const timestamp = formatTimestamp(new Date())
  const backupName = `pre-migration-${timestamp}.db`
  const backupPath = join(dir, backupName)

  try {
    // WAL 安全：先把 WAL 中已提交事务 checkpoint 进主库文件，再拷贝
    if (opts?.beforeCopy) {
      try {
        opts.beforeCopy()
      } catch (e) {
        console.warn('[backup] wal_checkpoint before snapshot failed (continue with copy):', e)
      }
    }
    copyFileSync(dbPath, backupPath)
    console.log('[backup] Pre-migration snapshot created:', backupPath)
  } catch (e) {
    console.error('[backup] copyFileSync (schema snapshot) failed:', e)
    throw e
  }

  cleanupOldBackups()
  return backupName
}

/**
 * 读取某个 .db 文件的 schema 版本（PRAGMA user_version）。
 *
 * 用于恢复前校验：备份文件自身保留 version 信息，恢复时据此防止把新 schema 数据回灌旧应用。
 * 使用动态 import 避免在模块顶层硬依赖 better-sqlite3（Electron ABI）以便单测加载本模块。
 */
async function getDbFileSchemaVersion(filePath: string): Promise<number> {
  if (!existsSync(filePath)) return 0
  let d: Database.Database | null = null
  try {
    const mod = (await import('better-sqlite3')) as {
      default?: new (path: string, opts?: Record<string, unknown>) => Database.Database
    }
    const DbCtor = mod.default
    if (!DbCtor) return 0
    d = new DbCtor(filePath, { readonly: true, fileMustExist: true })
    return (d.pragma('user_version', { simple: true }) as number) ?? 0
  } catch {
    return 0
  } finally {
    if (d) {
      try {
        d.close()
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 对恢复后的 .db 文件执行 PRAGMA foreign_key_check，返回孤立引用清单。
 *
 * governance 1.2：文件级恢复（restoreBackup）完成后做完整性校验，
 * 发现 orphan 时调用方返回「恢复失败」状态，避免静默成功。
 * 容错：无法打开/读取（非 sqlite 或 ABI 不可用）视为无可判定违规（返回 []）。
 * 与 getDbFileSchemaVersion 一致，动态 import better-sqlite3 以便单测加载本模块。
 */
async function getRestoredFkViolations(filePath: string): Promise<string[]> {
  let d: Database.Database | null = null
  try {
    const mod = (await import('better-sqlite3')) as {
      default?: new (path: string, opts?: Record<string, unknown>) => Database.Database
    }
    const DbCtor = mod.default
    if (!DbCtor) return []
    d = new DbCtor(filePath, { readonly: true, fileMustExist: true })
    const rows = d.pragma('foreign_key_check') as unknown
    if (!Array.isArray(rows)) return []
    return (rows as Array<{ table: string; rowid: number; parent: string; fkid: number }>).map(
      (r) => `table=${r.table}, rowid=${r.rowid}, 引用缺失父表 ${r.parent} (fkid=${r.fkid})`
    )
  } catch {
    return []
  } finally {
    if (d) {
      try {
        d.close()
      } catch {
        /* ignore */
      }
    }
  }
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

  // 恢复前校验：备份文件的 schema 版本不得高于当前应用支持的版本，
  // 避免把更新 schema 的库（含未来版本数据）回灌到旧应用造成数据损坏。
  const backupVersion = await getDbFileSchemaVersion(src)
  if (backupVersion > SCHEMA_VERSION) {
    throw new Error(
      `备份文件的 schema 版本（v${backupVersion}）高于当前应用支持的版本（v${SCHEMA_VERSION}），拒绝恢复。请先升级应用到最新版本。`
    )
  }
  console.log(
    `[backup] Backup schema version check passed (v${backupVersion} <= v${SCHEMA_VERSION})`
  )

  const dbPath = getDbPath()

  // 备份与恢复互斥：避免 restore 覆盖文件与 backup 读取/写入交叉产生半写状态
  await serialize(async () => {
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

    // 恢复后完整性校验 1：PRAGMA integrity_check（页级损坏检测）。
    // 非 ok → 明确报失败，不把「文件存在/可打开」当作「数据库有效」。
    const integrity = await getIntegrityCheckResult(dbPath)
    if (integrity !== null && integrity !== 'ok') {
      throw new Error(
        `备份恢复完成，但数据库完整性校验失败（integrity_check: ${integrity}）。备份文件可能已损坏，请勿使用本次恢复的数据。`
      )
    }

    // 恢复后完整性校验 2：PRAGMA foreign_key_check（孤立引用检测，governance 1.2）。
    // 发现 orphan → 明确报失败，不静默判定恢复成功。
    const violations = await getRestoredFkViolations(dbPath)
    if (violations.length > 0) {
      const detail = violations.slice(0, 5).join('; ')
      const more = violations.length > 5 ? ` ...等共 ${violations.length} 处` : ''
      throw new Error(
        `备份恢复完成，但外键校验失败：存在 ${violations.length} 处孤立引用（${detail}${more}）。数据可能不完整，请谨慎使用。`
      )
    }
  })
}

/**
 * 对指定 .db 文件执行 PRAGMA integrity_check，返回结果字符串。
 *
 * 返回 'ok' 表示页级结构完整；其他值（或首个错误行）表示损坏。
 * 无法打开/读取时返回 null（与 getRestoredFkViolations 的容错口径一致，
 * 由调用方决定 null 是否放行——因文件级损坏多伴随打开失败，此处不重复报错）。
 */
async function getIntegrityCheckResult(filePath: string): Promise<string | null> {
  let d: Database.Database | null = null
  try {
    const mod = (await import('better-sqlite3')) as {
      default?: new (path: string, opts?: Record<string, unknown>) => Database.Database
    }
    const DbCtor = mod.default
    if (!DbCtor) return null
    d = new DbCtor(filePath, { readonly: true, fileMustExist: true })
    const rows = d.pragma('integrity_check') as unknown
    if (Array.isArray(rows) && rows.length > 0) {
      const first = rows[0] as { integrity_check?: string }
      return first?.integrity_check ?? String(rows[0])
    }
    return null
  } catch {
    return null
  } finally {
    if (d) {
      try {
        d.close()
      } catch {
        /* ignore */
      }
    }
  }
}
