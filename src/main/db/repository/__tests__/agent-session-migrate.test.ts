// ============================================================
// agent-session-migrate.test.ts — v1.3.0 单会话孤儿消息迁移测试
//
// 覆盖 agentSessionRepo.migrateLegacySessions()：
//   - 空库（无 session 无 message）不迁移
//   - agent_messages 表不存在时不迁移（前向兼容）
//   - 已有 session 时不迁移
//   - 无 session 有 orphan messages 时创建「默认会话」并迁移全部孤儿消息
//
// Mock 策略：与 agent-session.repo.test.ts 一致，mock getDb() 返回内存 DB 模拟器。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// 内存 DB 模拟器
// ============================================================

interface SessionRow {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageText: string | null
  lastMessageAt: string | null
  contextJson: string | null
}

interface MessageRow {
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
 * 内存 DB 模拟器。
 * 支持 migrateLegacySessions 所需 SQL（sqlite_master / COUNT / INSERT / UPDATE）
 * 以及验证用 SQL（list / listBySession / get / add）。
 */
class MemoryDb {
  sessions = new Map<string, SessionRow>()
  messages = new Map<string, MessageRow>()
  tables = new Set<string>(['agent_sessions', 'agent_messages'])

  /** 测试辅助：模拟 DROP TABLE（用于验证表不存在时的前向兼容分支） */
  dropTable(name: string): void {
    this.tables.delete(name)
  }

  /** 测试辅助：直接注入一条孤儿消息（session_id 指向不存在的会话） */
  insertOrphanMessage(
    role: string,
    content: string,
    sessionId = 'orphan-session-id'
  ): MessageRow {
    const row: MessageRow = {
      id: `orphan-${this.messages.size + 1}`,
      session_id: sessionId,
      role,
      content,
      tool_calls_json: null,
      tool_results_json: null,
      created_at: new Date().toISOString(),
      seq: this.messages.size + 1
    }
    this.messages.set(row.id, row)
    return row
  }

  exec(_sql: string): void {}

  transaction<T>(fn: () => T): () => T {
    return () => fn()
  }

  prepare(sql: string) {
    const self = this

    return {
      run(...params: any[]): { changes: number } {
        const s = sql.trim()

        // INSERT INTO agent_sessions
        if (/^INSERT\s+INTO\s+agent_sessions/i.test(s)) {
          const row: SessionRow = {
            id: params[0],
            title: params[1],
            createdAt: params[2],
            updatedAt: params[3],
            lastMessageText: params[4],
            lastMessageAt: params[5],
            contextJson: params[6]
          }
          self.sessions.set(row.id, row)
          return { changes: 1 }
        }

        // INSERT INTO agent_messages
        if (/^INSERT\s+INTO\s+agent_messages/i.test(s)) {
          const row: MessageRow = {
            id: params[0],
            session_id: params[1],
            role: params[2],
            content: params[3],
            tool_calls_json: params[4],
            tool_results_json: params[5],
            created_at: params[6],
            seq: params[7]
          }
          self.messages.set(row.id, row)
          return { changes: 1 }
        }

        // UPDATE agent_sessions SET title ...
        if (/^UPDATE\s+agent_sessions\s+SET\s+title/i.test(s)) {
          const id = params[2]
          const row = self.sessions.get(id)
          if (row) {
            row.title = params[0]
            row.updatedAt = params[1]
            return { changes: 1 }
          }
          return { changes: 0 }
        }

        // UPDATE agent_sessions SET lastMessageText ...
        if (/^UPDATE\s+agent_sessions\s+SET\s+lastMessageText/i.test(s)) {
          const id = params[3]
          const row = self.sessions.get(id)
          if (row) {
            row.lastMessageText = params[0]
            row.lastMessageAt = params[1]
            row.updatedAt = params[2]
            return { changes: 1 }
          }
          return { changes: 0 }
        }

        // UPDATE agent_messages SET session_id = ?  （无 WHERE，全量更新）
        if (/^UPDATE\s+agent_messages\s+SET\s+session_id/i.test(s)) {
          const newSessionId = params[0]
          let changes = 0
          for (const msg of self.messages.values()) {
            msg.session_id = newSessionId
            changes++
          }
          return { changes }
        }

        return { changes: 0 }
      },

      all(...params: any[]): any[] {
        const s = sql.trim()

        // SELECT * FROM agent_sessions ORDER BY updatedAt DESC
        if (/^SELECT\s+\*\s+FROM\s+agent_sessions\s+ORDER\s+BY\s+updatedAt\s+DESC/i.test(s)) {
          return Array.from(self.sessions.values()).sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt)
          )
        }

        // SELECT * FROM agent_messages WHERE session_id = ? ORDER BY seq ASC
        if (
          /^SELECT\s+\*\s+FROM\s+agent_messages\s+WHERE\s+session_id\s*=\s*\?\s+ORDER\s+BY\s+seq\s+ASC/i.test(
            s
          )
        ) {
          const sessionId = params[0]
          return Array.from(self.messages.values())
            .filter((m) => m.session_id === sessionId)
            .sort((a, b) => a.seq - b.seq)
        }

        return []
      },

      get(...params: any[]): any {
        const s = sql.trim()

        // SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_messages'
        if (/sqlite_master/i.test(s)) {
          const match = s.match(/name\s*=\s*'(\w+)'/i)
          if (match && self.tables.has(match[1])) {
            return { 1: 1 }
          }
          return undefined
        }

        // SELECT COUNT(*) AS cnt FROM agent_sessions / agent_messages
        if (/SELECT\s+COUNT\(\*\)\s+AS\s+cnt/i.test(s)) {
          if (/FROM\s+agent_sessions/i.test(s)) {
            return { cnt: self.sessions.size }
          }
          if (/FROM\s+agent_messages/i.test(s)) {
            return { cnt: self.messages.size }
          }
          return { cnt: 0 }
        }

        // SELECT * FROM agent_sessions WHERE id = ?
        if (/^SELECT\s+\*\s+FROM\s+agent_sessions\s+WHERE\s+id\s*=\s*\?/i.test(s)) {
          return self.sessions.get(params[0]) ?? undefined
        }

        // SELECT * FROM agent_messages WHERE id = ?
        if (/^SELECT\s+\*\s+FROM\s+agent_messages\s+WHERE\s+id\s*=\s*\?/i.test(s)) {
          return self.messages.get(params[0]) ?? undefined
        }

        // SELECT MAX(seq) AS maxSeq FROM agent_messages WHERE session_id = ?
        if (/SELECT\s+MAX\(seq\)\s+AS\s+maxSeq/i.test(s)) {
          const sessionId = params[0]
          let maxSeq: number | null = null
          for (const m of self.messages.values()) {
            if (m.session_id === sessionId) {
              if (maxSeq === null || m.seq > maxSeq) maxSeq = m.seq
            }
          }
          return { maxSeq }
        }

        return undefined
      }
    }
  }
}

// ============================================================
// Mock getDb + uuid
// ============================================================

let mockDb: MemoryDb

vi.mock('../../index', () => ({
  getDb: () => mockDb
}))

let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`
}))

import { agentSessionRepo } from '../agent-session.repo'
import { agentMessageRepo } from '../agent-message.repo'

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  mockDb = new MemoryDb()
  uuidCounter = 0
})

describe('agentSessionRepo.migrateLegacySessions', () => {
  it('空数据库（无 session 无 message）不迁移', () => {
    agentSessionRepo.migrateLegacySessions()

    expect(agentSessionRepo.list()).toHaveLength(0)
  })

  it('agent_messages 表不存在时不迁移（前向兼容）', () => {
    mockDb.dropTable('agent_messages')

    agentSessionRepo.migrateLegacySessions()

    expect(agentSessionRepo.list()).toHaveLength(0)
  })

  it('已有 session 时不迁移（即使存在 orphan messages）', () => {
    // 已存在一个正常会话
    const existing = agentSessionRepo.create('已存在会话')

    // 同时存在一条孤儿消息（session_id 指向不存在的会话）
    mockDb.insertOrphanMessage('user', '孤儿消息', 'nonexistent-session')

    agentSessionRepo.migrateLegacySessions()

    // 不应新增任何会话
    const sessions = agentSessionRepo.list()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(existing.id)
    expect(sessions[0].title).toBe('已存在会话')
  })

  it('无 session 有 orphan messages 时创建「默认会话」并迁移全部孤儿消息', () => {
    // 注入 3 条孤儿消息，session_id 指向不存在的会话
    mockDb.insertOrphanMessage('user', '历史消息1')
    mockDb.insertOrphanMessage('assistant', '历史回复1')
    mockDb.insertOrphanMessage('user', '历史消息2')

    // 迁移前：无 session，3 条孤儿消息
    expect(agentSessionRepo.list()).toHaveLength(0)

    agentSessionRepo.migrateLegacySessions()

    // 迁移后：1 个默认会话
    const sessions = agentSessionRepo.list()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('默认会话')
    expect(sessions[0].id).toBeDefined()

    // 全部 3 条孤儿消息迁移到默认会话下，按 seq ASC 排序
    const msgs = agentMessageRepo.listBySession(sessions[0].id)
    expect(msgs).toHaveLength(3)
    expect(msgs[0].content).toBe('历史消息1')
    expect(msgs[1].content).toBe('历史回复1')
    expect(msgs[2].content).toBe('历史消息2')

    // 每条消息的 sessionId 都已更新为默认会话 id
    for (const m of msgs) {
      expect(m.sessionId).toBe(sessions[0].id)
    }
  })

  it('迁移幂等：再次调用不产生副作用', () => {
    mockDb.insertOrphanMessage('user', '历史消息1')

    // 第一次迁移：创建默认会话并迁移
    agentSessionRepo.migrateLegacySessions()
    const sessionsAfterFirst = agentSessionRepo.list()
    expect(sessionsAfterFirst).toHaveLength(1)

    // 第二次调用：sessions 已有记录，应直接返回
    agentSessionRepo.migrateLegacySessions()
    const sessionsAfterSecond = agentSessionRepo.list()
    expect(sessionsAfterSecond).toHaveLength(1)
    expect(sessionsAfterSecond[0].id).toBe(sessionsAfterFirst[0].id)
  })
})
