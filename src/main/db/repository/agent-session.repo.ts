// ============================================================
// agent-session.repo.ts — Agent 会话持久化 CRUD（AI Agent v1.3.0 Week 5 Task 28）
//
// 对应 agent_sessions 表，存储 Agent 多会话元数据（标题、最近消息预览、上下文）。
// 删除会话时事务级联清理 agent_messages 表对应记录（如表存在，前向兼容 Task 29）。
//
// 设计要点：
// - 列名采用 camelCase，与 AgentSession 类型字段一一对应（contextJson → context）
// - initAgentSessionTable(db) 在数据库初始化时调用，幂等建表
// - CRUD 方法通过 getDb() 获取实例，沿用 event.repo / timer-session.repo 模式
// - 所有 SQL 使用 prepared statements（db.prepare）
// ============================================================

import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type { AgentSession, AgentContext } from '../../../shared/agent-types'

/** DB agent_sessions 表的原始行类型 */
interface AgentSessionRow {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageText: string | null
  lastMessageAt: string | null
  contextJson: string | null
}

/**
 * 安全 JSON.parse：解析失败时返回 fallback。
 * 用于 contextJson 列的容错反序列化，避免单行坏数据导致整列查询失败。
 */
function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * DB row -> AgentSession
 * - contextJson: JSON 字符串 -> AgentContext 对象（解析失败回退 undefined）
 * - lastMessageText / lastMessageAt: DB 可空，应用层归一化为空字符串
 */
function rowToSession(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageText: row.lastMessageText ?? '',
    lastMessageAt: row.lastMessageAt ?? '',
    context: safeJsonParse<AgentContext | undefined>(row.contextJson, undefined)
  }
}

// ============================================================
// SubTask 28.1: 建表 SQL
// ============================================================

/**
 * 初始化 agent_sessions 表。
 * - CREATE TABLE IF NOT EXISTS，幂等执行，重复调用无副作用
 * - 附带 updatedAt DESC 索引，加速 list / search 排序
 *
 * 在 src/main/db/index.ts 的 configureAndSeed 中调用，
 * 位于 schema.sql + runMigrations 之后。
 */
export function initAgentSessionTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      createdAt       TEXT NOT NULL,
      updatedAt       TEXT NOT NULL,
      lastMessageText TEXT,
      lastMessageAt   TEXT,
      contextJson     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_updatedAt
      ON agent_sessions(updatedAt DESC);
  `)
}

// ============================================================
// SubTask 28.2 / 28.3 / 28.4: CRUD + search + 级联删除
// ============================================================

export const agentSessionRepo = {
  /**
   * 创建新会话。
   * - v4 生成 id
   * - 自动写入 createdAt / updatedAt（ISO 8601）
   * - lastMessageText / lastMessageAt 初始化为空字符串
   * - contextJson 初始化为 NULL（无业务上下文）
   */
  create(title: string): AgentSession {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO agent_sessions
        (id, title, createdAt, updatedAt, lastMessageText, lastMessageAt, contextJson)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, now, now, '', '', null)

    const created = this.get(id)
    if (!created) {
      throw new Error(
        `[agentSessionRepo] create: insert succeeded but row not found, id=${id}`
      )
    }
    return created
  },

  /**
   * 列出所有会话，按 updatedAt DESC 排序（最近更新的在前）。
   */
  list(): AgentSession[] {
    const db = getDb()
    const rows = db
      .prepare('SELECT * FROM agent_sessions ORDER BY updatedAt DESC')
      .all() as AgentSessionRow[]
    return rows.map(rowToSession)
  },

  /**
   * 按 id 获取单个会话。不存在时返回 null。
   */
  get(id: string): AgentSession | null {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM agent_sessions WHERE id = ?')
      .get(id) as AgentSessionRow | undefined
    return row ? rowToSession(row) : null
  },

  /**
   * 重命名会话，同时更新 updatedAt。
   * @returns 是否成功（会话不存在时返回 false）
   */
  rename(id: string, title: string): boolean {
    const db = getDb()
    const now = new Date().toISOString()
    const result = db
      .prepare('UPDATE agent_sessions SET title = ?, updatedAt = ? WHERE id = ?')
      .run(title, now, id)
    return result.changes > 0
  },

  /**
   * 删除会话（SubTask 28.4）。
   *
   * 级联删除 agent_messages 表中 session_id = id 的记录（如表存在），
   * 再删除 agent_sessions 表记录。使用事务保证原子性：
   *   - agent_messages 表由 Task 29 创建，当前可能不存在，通过 sqlite_master 检查前向兼容
   *   - 列名 session_id 遵循项目 snake_case 外键命名约定（与 timer_records.session_id 一致）
   *   - 事务内两步操作要么全部成功，要么全部回滚
   *
   * @returns 是否成功（会话不存在时返回 false）
   */
  delete(id: string): boolean {
    const db = getDb()

    // 检查 agent_messages 表是否存在（Task 29 创建，前向兼容）
    const msgTableExists =
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_messages'"
        )
        .get() !== undefined

    const tx = db.transaction(() => {
      // 先级联删除该会话的所有消息（如表存在）
      if (msgTableExists) {
        db.prepare('DELETE FROM agent_messages WHERE session_id = ?').run(id)
      }
      // 再删除会话本身
      const result = db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id)
      return result.changes > 0
    })

    return tx()
  },

  /**
   * 清空全部会话。
   *
   * 事务级联删除 agent_messages 表全部记录（如表存在），再删除 agent_sessions 全部记录。
   * 使用事务保证原子性，与 delete(id) 实现风格一致：
   *   - agent_messages 表由 Task 29 创建，当前可能不存在，通过 sqlite_master 检查前向兼容
   *   - 事务内两步操作要么全部成功，要么全部回滚
   *
   * @returns 始终返回 true（事务成功即视为成功）
   */
  clearAll(): boolean {
    const db = getDb()

    // 检查 agent_messages 表是否存在（Task 29 创建，前向兼容）
    const msgTableExists =
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_messages'"
        )
        .get() !== undefined

    const tx = db.transaction(() => {
      // 先级联删除全部消息（如表存在）
      if (msgTableExists) {
        db.prepare('DELETE FROM agent_messages').run()
      }
      // 再删除全部会话
      db.prepare('DELETE FROM agent_sessions').run()
      return true
    })

    return tx()
  },

  /**
   * 更新会话最后消息文本与时间。
   * 同步更新 updatedAt，便于 list 排序反映最新活动。
   */
  updateLastMessage(id: string, text: string): void {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE agent_sessions
      SET lastMessageText = ?, lastMessageAt = ?, updatedAt = ?
      WHERE id = ?
    `).run(text, now, now, id)
  },

  /**
   * 更新会话绑定的业务上下文（P0-1 引入）。
   * 将 AgentContext 序列化为 contextJson 持久化，同时刷新 updatedAt。
   * agent-loop 每次对话结束（finally）时调用，用于重启后恢复会话上下文。
   */
  updateContext(id: string, context: AgentContext): void {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(
      'UPDATE agent_sessions SET contextJson = ?, updatedAt = ? WHERE id = ?'
    ).run(JSON.stringify(context), now, id)
  },

  /**
   * 跨会话搜索（SubTask 28.3）。
   *
   * - 使用 LIKE 模糊匹配 title 与 lastMessageText 字段
   * - 按 updatedAt DESC 排序
   * - keyword 为空（或纯空白）时返回空数组
   *
   * @param keyword 搜索关键词
   */
  search(keyword: string): AgentSession[] {
    const db = getDb()
    const trimmed = keyword.trim()
    if (!trimmed) return []

    const like = `%${trimmed}%`
    const rows = db
      .prepare(`
        SELECT * FROM agent_sessions
        WHERE title LIKE ? OR lastMessageText LIKE ?
        ORDER BY updatedAt DESC
      `)
      .all(like, like) as AgentSessionRow[]
    return rows.map(rowToSession)
  },

  /**
   * 迁移 v1.3.0 单会话模式的孤儿消息为「默认会话」（v1.3.0 + v1.4.0 合并版兼容）。
   *
   * 背景：v1.3.0 首次引入 Agent 时，部分早期版本可能直接向 agent_messages 写入消息
   * 但未创建 agent_sessions 记录（单会话模式）。升级到合并版后这些消息成为孤儿，
   * 在 UI 侧无法被任何会话关联，会导致历史消息丢失。
   *
   * 迁移逻辑（方案 A：启动时检测并迁移）：
   *   1. agent_messages 表不存在 → 直接返回（前向兼容，表尚未初始化）
   *   2. agent_sessions 已有记录 → 直接返回（已迁移或正常多会话使用）
   *   3. agent_messages 无记录 → 直接返回（无孤儿消息需迁移）
   *   4. 否则：创建一个「默认会话」，在事务中将所有 agent_messages 的 session_id
   *      更新为新会话 id（此时 sessions 表为空，所有消息均为孤儿，全量更新即可）
   *
   * 在 src/main/index.ts 的 app.whenReady 中调用，位于 initDatabase（内部已调用
   * initAgentSessionTable / initAgentMessageTable）之后、registerAgentIpc 之前。
   */
  migrateLegacySessions(): void {
    const db = getDb()

    // 1. 检查 agent_messages 表是否存在（前向兼容）
    const msgTableExists =
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_messages'"
        )
        .get() !== undefined
    if (!msgTableExists) return

    // 2. agent_sessions 已有记录 → 无需迁移
    const sessionCount = db.prepare(
      'SELECT COUNT(*) AS cnt FROM agent_sessions'
    ).get() as { cnt: number } | undefined
    if (sessionCount && sessionCount.cnt > 0) return

    // 3. agent_messages 无记录 → 无孤儿消息需迁移
    const msgCount = db.prepare(
      'SELECT COUNT(*) AS cnt FROM agent_messages'
    ).get() as { cnt: number } | undefined
    if (!msgCount || msgCount.cnt === 0) return

    // 4. 创建「默认会话」并迁移所有孤儿消息（事务保证原子性）
    const id = uuidv4()
    const now = new Date().toISOString()
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO agent_sessions
          (id, title, createdAt, updatedAt, lastMessageText, lastMessageAt, contextJson)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, '默认会话', now, now, '', '', null)

      // sessions 表为空 → 所有消息均为孤儿，全量更新 session_id 即可
      db.prepare('UPDATE agent_messages SET session_id = ?').run(id)
    })
    tx()

    console.log(
      `[agentSessionRepo] migrateLegacySessions: created default session ${id}, migrated ${msgCount.cnt} orphan message(s)`
    )
  }
}
