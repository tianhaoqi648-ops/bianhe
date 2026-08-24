import Database from 'better-sqlite3'
import { app, BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync } from 'fs'
// 使用 ?raw 将 schema.sql 作为字符串内联进打包产物，
// 避免 electron-vite 打包后运行期再 readFileSync 文件路径错乱的问题。
import schemaSql from './schema.sql?raw'
import { runMigrations, SCHEMA_VERSION, getDbSchemaVersion } from './migrations'
import { backupDatabaseSync } from '../backup'
import { ALL_PRESETS } from '../../shared/debate-formats/presets'
import { formatRepo } from './repository/format.repo'
import { initAgentSessionTable } from './repository/agent-session.repo'
import { initAgentMessageTable } from './repository/agent-message.repo'
// gov4.1：dbMode 状态独立成模块（mode.ts，不依赖 electron / better-sqlite3，可独立单测）。
import { dbModeStore } from './mode'
// 导出 dbModeStore 供主进程入口（main/index.ts ipc 'db:get-mode' / 广播）读取当前模式。
export { dbModeStore }

let db: Database.Database | null = null

// 主进程通过 IPC 事件 `db:status` 通知渲染进程当前模式，
// 渲染进程据此显示"临时内存模式"常驻警告。
// dbModeStore 是主进程 dbMode 的唯一来源；模式变化时广播给所有 BrowserWindow。
dbModeStore.onChange((mode) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('db:status', mode)
    }
  }
})

/** 设置当前 db 模式（内部语义：仅在实际变化时触发广播，等价于原 setDbMode） */
function setDbMode(mode: import('./mode').DbMode): void {
  dbModeStore.setMode(mode)
}

/** Promise 化的延迟 */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 初始化数据库：
 * 1. 在 userData 目录下创建/打开 debate-drawer.db
 * 2. 开启外键与 WAL
 * 3. 执行 schema.sql 建表
 * 4. 写入 schema_version
 *
 * 错误降级策略：
 *   - SQLITE_CANTOPEN：检查/创建目录，重试 3 次（200ms / 500ms / 1000ms）
 *   - 仍失败或其他错误（SQLITE_CORRUPT 等）：降级为内存数据库
 *   - 通知渲染进程当前模式（persistent / memory）
 *
 * userData 使用 Electron 默认路径（未重定向）：
 *   - Windows: %APPDATA%/辩盒/（即 C:\Users\<用户名>\AppData\Roaming\辩盒\）
 *   - macOS:   ~/Library/Application Support/辩盒/
 *   - Linux:   ~/.config/辩盒/
 * 因此数据库文件最终位于上述目录下的 debate-drawer.db
 */
export async function initDatabase(): Promise<Database.Database> {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'debate-drawer.db')
  console.log('[db] Initializing database at:', dbPath)

  const retryDelays = [200, 500, 1000]
  let lastError: unknown = null

  // 尝试打开磁盘数据库，失败则按策略重试
  // P4-13: 仅 SQLITE_CANTOPEN 时重试（目录不存在/权限等可恢复场景），
  //        其他错误（SQLITE_CORRUPT / SQLITE_NOTADB 等）直接跳出，由后续降级为内存数据库
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      db = new Database(dbPath)
      break
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : String(e)
      const code = (e as { code?: string })?.code
      console.warn(`[db] Open attempt ${attempt + 1} failed:`, msg, '(code:', code ?? 'N/A', ')')
      // 仅 SQLITE_CANTOPEN 时重试（目录缺失/权限问题等可恢复场景）
      if (code !== 'SQLITE_CANTOPEN') {
        break
      }
      // 检查/创建目录
      try {
        mkdirSync(dirname(dbPath), { recursive: true })
      } catch (mkdirErr) {
        console.warn('[db] mkdir failed:', mkdirErr)
      }
      if (attempt < retryDelays.length) {
        await delay(retryDelays[attempt])
      }
    }
  }

  // 仍未打开 → 降级为内存数据库
  if (!db) {
    console.error(
      '[db] All open attempts failed, falling back to in-memory database. Last error:',
      lastError
    )
    try {
      db = new Database(':memory:')
      setDbMode('memory')
    } catch (memErr) {
      console.error('[db] In-memory fallback also failed:', memErr)
      throw memErr
    }
  } else {
    // 已成功打开磁盘数据库；后续 schema/exec 失败也降级
    try {
      configureAndSeed(db)
      setDbMode('persistent')
    } catch (e) {
      console.error('[db] Schema/migration failed, falling back to in-memory database:', e)
      try {
        db.close()
      } catch {
        /* ignore */
      }
      db = new Database(':memory:')
      try {
        configureAndSeed(db)
        setDbMode('memory')
      } catch (seedErr) {
        console.error('[db] In-memory seed failed:', seedErr)
        throw seedErr
      }
    }
  }

  // P2: DB 降级为内存库后，重置 timer_records 唯一索引标志，
  // 确保下次 addRecord 时在新库实例上重新创建索引。
  // 使用动态 import 避免 index.ts <-> timer-session.repo.ts 循环依赖。
  if (dbModeStore.mode === 'memory') {
    try {
      const { resetTimerRecordsIndexFlag } = await import('./repository/timer-session.repo')
      resetTimerRecordsIndexFlag()
    } catch (e) {
      console.warn('[db] Failed to reset timer records index flag:', e)
    }
  }

  console.log('[db] Database initialized successfully, mode =', dbModeStore.mode)
  return db
}

/**
 * 配置数据库（pragma / schema / migrations / seed）。
 * 抽出来便于降级到内存数据库时复用。
 */
function configureAndSeed(database: Database.Database): void {
  database.pragma('foreign_keys = ON')
  // P2-9: 基于 db.memory 属性判定是否为内存库，而非全局 currentDbMode。
  // 原因：从磁盘库 schema 失败降级到内存库时，currentDbMode 仍是 'persistent'，
  //       会导致对内存库执行 WAL pragma（无效且产生误导日志）。
  //       better-sqlite3 的 database.memory 属性反映当前实例真实状态，更可靠。
  if (!database.memory) {
    try {
      database.pragma('journal_mode = WAL')
    } catch (e) {
      console.warn('[db] Set WAL failed, continue without WAL:', e)
    }
  }

  // 执行 schema.sql（建表 + 索引）
  database.exec(schemaSql)

  // 迁移前安全保护（Task3）：
  // 检测当前库 schema 版本 < 目标版本（SCHEMA_VERSION）时，先用现有 backup 机制
  // 做一次迁移前自动快照到 backups 目录；快照失败则抛错中止本次迁移，
  // 由 initDatabase 的降级策略提示（回滚到内存库），不冒险在无备份前提下改动结构。
  // 全新空库（version 0）或内存库无需备份。
  const preMigVersion = getDbSchemaVersion(database)
  if (!database.memory && preMigVersion > 0 && preMigVersion < SCHEMA_VERSION) {
    try {
      const snapshot = backupDatabaseSync()
      if (!snapshot) {
        throw new Error('schema 升级前自动备份未生成快照，已中止迁移以免无备份改动结构')
      }
      console.log(
        `[db] Pre-migration snapshot taken: ${snapshot} (v${preMigVersion} -> v${SCHEMA_VERSION})`
      )
    } catch (e) {
      console.error('[db] Pre-migration backup failed, abort schema upgrade:', e)
      throw e
    }
  }

  // 执行增量迁移（ALTER TABLE / 新表）
  runMigrations(database)

  // 记录数值 schema 版本（PRAGMA user_version，落盘可靠）
  database.pragma(`user_version = ${SCHEMA_VERSION}`)

  // 记录 schema 版本（settings 表，兼容既有读取；数值 JSON）
  const stmt = database.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  )
  stmt.run('schema_version', JSON.stringify(SCHEMA_VERSION))

  // 初始化 Agent 会话表（Task 28）
  initAgentSessionTable(database)

  // 初始化 Agent 消息表（Task 29）
  // 位于 initAgentSessionTable 之后，因 agent_messages.session_id 外键引用 agent_sessions.id
  initAgentMessageTable(database)

  // Seed debate format presets
  try {
    for (const preset of ALL_PRESETS) {
      formatRepo.upsertPreset(preset)
    }
    console.log('[db] Debate format presets seeded:', ALL_PRESETS.length)
  } catch (e) {
    console.error('[db] Failed to seed format presets:', e)
  }
}

/**
 * 获取数据库实例。
 * 在 initDatabase() 之前调用会抛错。
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * 关闭数据库连接，释放资源。可在 app.before-quit 中调用。
 *
 * P3-1: 包 try/catch，关闭失败时仅记录 console.warn，
 *       不影响应用退出流程（app.before-quit 不应被数据库关闭失败阻断）。
 */
export function closeDatabase(): void {
  if (db) {
    try {
      db.close()
      console.log('[db] Database closed')
    } catch (e) {
      console.warn('[db] closeDatabase failed:', e)
    }
    db = null
  }
}
