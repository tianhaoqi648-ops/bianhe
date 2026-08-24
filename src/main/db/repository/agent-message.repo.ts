// ============================================================
// agent-message.repo.ts — Agent 消息持久化 CRUD（AI Agent v1.3.0 Week 5 Task 29）
//
// 对应 agent_messages 表，存储单个 Agent 会话下的逐条消息（user / assistant /
// tool_call / tool_result / system）。
//
// 设计要点：
// - DB 列名采用 snake_case（session_id / tool_calls_json / tool_results_json /
//   created_at），与 Task 28 中 agent-session.repo.ts 的 delete 方法级联删除
//   所使用的 session_id 列名保持一致；TypeScript 字段使用 camelCase，
//   通过 rowToMessage 做映射
// - 外键 session_id REFERENCES agent_sessions(id) ON DELETE CASCADE，
//   由 Task 28 的 delete 方法事务级联清理（前向兼容，表存在性已在该处检查）
// - initAgentMessageTable(db) 在数据库初始化时调用，幂等建表
// - CRUD 方法通过 getDb() 获取实例，沿用 event.repo / timer-session.repo 模式
// - 所有 SQL 使用 prepared statements（db.prepare）
// - JSON 列（tool_calls_json / tool_results_json）使用 safeJsonParse 容错解析
// ============================================================

import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type {
  AgentMessageRecord,
  AssistantMessage
} from '../../../shared/agent-types'

/** DB agent_messages 表的原始行类型（snake_case 列名） */
interface AgentMessageRow {
  id: string
  session_id: string
  role: string
  content: string
  tool_calls_json: string | null
  tool_results_json: string | null
  created_at: string
  seq: number
}

/**
 * 安全 JSON.parse：解析失败时返回 fallback。
 * 用于 tool_calls_json / tool_results_json 列的容错反序列化，
 * 避免单行坏数据导致整列查询失败。
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
 * DB row -> AgentMessageRecord
 * - session_id -> sessionId
 * - tool_calls_json: JSON 字符串 -> AssistantMessage['tool_calls']（解析失败回退 undefined）
 * - tool_results_json: JSON 字符串 -> toolResults 数组（解析失败回退 undefined）
 * - created_at -> createdAt
 * - seq 字段仅用于排序，不暴露到 AgentMessageRecord 类型
 */
function rowToMessage(row: AgentMessageRow): AgentMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as AgentMessageRecord['role'],
    content: row.content,
    toolCalls: safeJsonParse<AssistantMessage['tool_calls'] | undefined>(
      row.tool_calls_json,
      undefined
    ),
    toolResults: safeJsonParse<AgentMessageRecord['toolResults'] | undefined>(
      row.tool_results_json,
      undefined
    ),
    createdAt: row.created_at
  }
}

// ============================================================
// SubTask 29.1: 建表 SQL
// ============================================================

/**
 * 初始化 agent_messages 表。
 * - CREATE TABLE IF NOT EXISTS，幂等执行，重复调用无副作用
 * - 外键 session_id REFERENCES agent_sessions(id) ON DELETE CASCADE，
 *   与 Task 28 中 agent-session.repo.ts 的 delete 方法级联删除约定一致
 * - 附带 (session_id, seq) 联合索引，加速 listBySession 排序
 * - 附带 created_at DESC 索引，加速 searchAll 排序
 *
 * 在 src/main/db/index.ts 的 configureAndSeed 中调用，
 * 位于 initAgentSessionTable 之后。
 */
export function initAgentMessageTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      role              TEXT NOT NULL,
      content           TEXT NOT NULL,
      tool_calls_json   TEXT,
      tool_results_json TEXT,
      created_at        TEXT NOT NULL,
      seq               INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session_seq
      ON agent_messages(session_id, seq ASC);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_createdAt
      ON agent_messages(created_at DESC);
  `)
}

// ============================================================
// SubTask 29.2 / 29.3: CRUD + searchAll
// ============================================================

export const agentMessageRepo = {
  /**
   * 追加一条消息到指定会话。
   * - v4 生成 id
   * - 自动写入 createdAt（ISO 8601）
   * - 自动计算 seq：同一 sessionId 下取 max(seq) + 1，若无记录则从 1 开始
   * - toolCalls / toolResults 通过 JSON.stringify 序列化为 tool_calls_json /
   *   tool_results_json 列存储
   *
   * @param sessionId 目标会话 id
   * @param message   消息内容（不含 id / createdAt / seq，由本方法自动填充）
   */
  add(
    sessionId: string,
    message: Omit<AgentMessageRecord, 'id' | 'createdAt' | 'seq' | 'sessionId'>
  ): AgentMessageRecord {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    // 计算下一个 seq：当前会话最大 seq + 1，无记录时为 1
    const maxRow = db
      .prepare('SELECT MAX(seq) AS maxSeq FROM agent_messages WHERE session_id = ?')
      .get(sessionId) as { maxSeq: number | null } | undefined
    const seq = maxRow && maxRow.maxSeq !== null ? maxRow.maxSeq + 1 : 1

    db.prepare(`
      INSERT INTO agent_messages
        (id, session_id, role, content, tool_calls_json, tool_results_json, created_at, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      message.role,
      message.content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolResults ? JSON.stringify(message.toolResults) : null,
      now,
      seq
    )

    const created = this.getById(id)
    if (!created) {
      throw new Error(
        `[agentMessageRepo] add: insert succeeded but row not found, id=${id}`
      )
    }
    return created
  },

  /**
   * 按 id 获取单条消息（内部辅助）。不存在时返回 null。
   */
  getById(id: string): AgentMessageRecord | null {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM agent_messages WHERE id = ?')
      .get(id) as AgentMessageRow | undefined
    return row ? rowToMessage(row) : null
  },

  /**
   * 列出指定会话的全部消息，按 seq ASC 排序（保证消息时间顺序）。
   */
  listBySession(sessionId: string): AgentMessageRecord[] {
    const db = getDb()
    const rows = db
      .prepare('SELECT * FROM agent_messages WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as AgentMessageRow[]
    return rows.map(rowToMessage)
  },

  /**
   * 删除指定会话的全部消息。
   * 通常由 agent-session.repo.ts 的 delete 方法在事务内级联调用；
   * 此处也独立暴露，便于按会话清空消息但保留会话元数据。
   *
   * @returns 是否删除了至少一条记录
   */
  deleteBySession(sessionId: string): boolean {
    const db = getDb()
    const result = db
      .prepare('DELETE FROM agent_messages WHERE session_id = ?')
      .run(sessionId)
    return result.changes > 0
  },

  /**
   * 备份用：一次性返回 agent_messages 表的全部行（DB 原始格式）。
   * 与 timer-session.repo 的 findAllForBackup 一致，供 backup-service 导出。
   */
  findAllForBackup(): Array<Record<string, unknown>> {
    const db = getDb()
    return db.prepare('SELECT * FROM agent_messages').all() as Array<Record<string, unknown>>
  },

  /**
   * 跨所有会话搜索消息内容（SubTask 29.3）。
   *
   * - 使用 LIKE 模糊匹配 agent_messages.content 字段
   * - JOIN agent_sessions 表获取 sessionTitle
   * - 按 created_at DESC 排序（最近的消息在前）
   * - keyword 为空（或纯空白）时返回空数组
   * - 每条记录包含完整 message 对象（已通过 rowToMessage 解析
   *   tool_calls_json / tool_results_json）
   *
   * @param keyword 搜索关键词
   */
  searchAll(keyword: string): Array<{
    sessionId: string
    sessionTitle: string
    message: AgentMessageRecord
    createdAt: string
  }> {
    const db = getDb()
    const trimmed = keyword.trim()
    if (!trimmed) return []

    const like = `%${trimmed}%`
    const rows = db
      .prepare(`
        SELECT m.*, s.title AS session_title
        FROM agent_messages m
        INNER JOIN agent_sessions s ON m.session_id = s.id
        WHERE m.content LIKE ?
        ORDER BY m.created_at DESC
      `)
      .all(like) as Array<AgentMessageRow & { session_title: string }>

    return rows.map((row) => ({
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      message: rowToMessage(row),
      createdAt: row.created_at
    }))
  }
}
