import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
// 使用 ?raw 将 schema.sql 作为字符串内联进打包产物，
// 避免 electron-vite 打包后运行期再 readFileSync 文件路径错乱的问题。
import schemaSql from './schema.sql?raw'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

/**
 * 初始化数据库：
 * 1. 在 userData 目录下创建/打开 debate-drawer.db
 * 2. 开启外键与 WAL
 * 3. 执行 schema.sql 建表
 * 4. 写入 schema_version
 *
 * userData 已被 src/main/index.ts 重定向到
 *   <项目根>/.electron-userdata
 * 因此数据库文件最终位于：
 *   <项目根>/.electron-userdata/debate-drawer.db
 */
export function initDatabase(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'debate-drawer.db')
  console.log('[db] Initializing database at:', dbPath)

  db = new Database(dbPath)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')

  // 执行 schema.sql（建表 + 索引）
  db.exec(schemaSql)

  // 执行增量迁移（ALTER TABLE / 新表）
  // 在 schema.sql 之后运行，确保基表存在后再添加字段或新表
  runMigrations(db)

  // 记录 schema 版本
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  stmt.run('schema_version', JSON.stringify('1'))

  console.log('[db] Database initialized successfully')
  return db
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
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    console.log('[db] Database closed')
  }
}
