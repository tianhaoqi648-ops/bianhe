// ============================================================
// agent-message.repo.test.ts — Agent 消息持久化 CRUD 测试（Task 51.3）
//
// 覆盖 agent-message.repo.ts 的 CRUD + searchAll：
//   - add：添加消息，返回含 id / createdAt / seq
//   - listBySession：添加 3 条消息后，返回 3 条，按 seq ASC 排序
//   - deleteBySession：删除后 listBySession 返回空
//   - searchAll：添加含关键词的消息，searchAll 返回匹配项，含 sessionTitle
//   - seq 自增：同一 session 添加多条，seq 递增
//
// Mock 策略：与 agent-session.repo.test.ts 一致，mock getDb() 返回内存 DB 模拟器。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// 内存 DB 模拟器
// ============================================================

/** agent_sessions 表行类型（searchAll JOIN 用） */
interface SessionRow {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageText: string | null
  lastMessageAt: string | null
  contextJson: string | null
}

/** agent_messages 表行类型 */
interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  tool_calls_json: string | null
  tool_results_json: string | null
  created_at: string
  seq: number
  session_title?: string
}

/** 内存 DB 模拟器（支持 agent-message.repo 所需 SQL 操作） */
class MemoryDb {
  sessions = new Map<string, SessionRow>()
  messages = new Map<string, MessageRow>()

  exec(_sql: string): void {}

  transaction<T>(fn: () => T): () => T {
    return () => fn()
  }

  prepare(sql: string) {
    const self = this

    function likeMatch(text: string | null | undefined, pattern: string): boolean {
      if (!text) return false
      const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.')
      return new RegExp(`^${regex}$`, 'i').test(text)
    }

    return {
      run(...params: any[]): { changes: number } {
        const s = sql.trim()

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

        // INSERT INTO agent_sessions（测试辅助：创建会话）
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

        // DELETE FROM agent_messages WHERE session_id = ?
        if (/^DELETE\s+FROM\s+agent_messages\s+WHERE\s+session_id/i.test(s)) {
          const sessionId = params[0]
          let changes = 0
          for (const [id, msg] of self.messages) {
            if (msg.session_id === sessionId) {
              self.messages.delete(id)
              changes++
            }
          }
          return { changes }
        }

        return { changes: 0 }
      },

      all(...params: any[]): any[] {
        const s = sql.trim()

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

        // SELECT m.*, s.title AS session_title FROM agent_messages m
        // INNER JOIN agent_sessions s ON m.session_id = s.id
        // WHERE m.content LIKE ? ORDER BY m.created_at DESC
        if (/^SELECT\s+m\.\*,\s+s\.title\s+AS\s+session_title/i.test(s)) {
          const likePattern = params[0]
          return Array.from(self.messages.values())
            .filter((m) => likeMatch(m.content, likePattern))
            .map((m) => ({
              ...m,
              session_title: self.sessions.get(m.session_id)?.title ?? ''
            }))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
        }

        return []
      },

      get(...params: any[]): any {
        const s = sql.trim()

        // SELECT * FROM agent_messages WHERE id = ?
        if (
          /^SELECT\s+\*\s+FROM\s+agent_messages\s+WHERE\s+id\s*=\s*\?/i.test(s)
        ) {
          return self.messages.get(params[0]) ?? undefined
        }

        // SELECT * FROM agent_sessions WHERE id = ?（测试辅助）
        if (
          /^SELECT\s+\*\s+FROM\s+agent_sessions\s+WHERE\s+id\s*=\s*\?/i.test(s)
        ) {
          return self.sessions.get(params[0]) ?? undefined
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

import { agentMessageRepo } from '../agent-message.repo'
import { agentSessionRepo } from '../agent-session.repo'

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  mockDb = new MemoryDb()
  uuidCounter = 0
})

describe('agentMessageRepo.add', () => {
  it('添加消息，返回含 id / createdAt', () => {
    const session = agentSessionRepo.create('测试会话')

    const msg = agentMessageRepo.add(session.id, {
      role: 'user',
      content: '你好'
    })

    expect(msg.id).toBeDefined()
    expect(msg.id).not.toBe('')
    expect(msg.createdAt).toBeDefined()
    expect(msg.createdAt).not.toBe('')
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('你好')
    expect(msg.sessionId).toBe(session.id)
  })

  it('支持 toolCalls 与 toolResults 序列化', () => {
    const session = agentSessionRepo.create('工具调用会话')

    const msg = agentMessageRepo.add(session.id, {
      role: 'assistant',
      content: '调用工具中',
      toolCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'search_topics', arguments: '{"keyword":"AI"}' }
        }
      ]
    })

    expect(msg.toolCalls).toBeDefined()
    expect(msg.toolCalls).toHaveLength(1)
    expect(msg.toolCalls![0].function.name).toBe('search_topics')
  })
})

describe('agentMessageRepo.listBySession', () => {
  it('添加 3 条消息后，返回 3 条，按 seq ASC 排序', () => {
    const session = agentSessionRepo.create('列表测试')

    const m1 = agentMessageRepo.add(session.id, { role: 'user', content: '消息1' })
    const m2 = agentMessageRepo.add(session.id, { role: 'assistant', content: '回复1' })
    const m3 = agentMessageRepo.add(session.id, { role: 'user', content: '消息2' })

    const list = agentMessageRepo.listBySession(session.id)
    expect(list).toHaveLength(3)
    // 按 seq ASC 排序：通过 id 与添加顺序一致验证
    expect(list[0].id).toBe(m1.id)
    expect(list[1].id).toBe(m2.id)
    expect(list[2].id).toBe(m3.id)
    // 通过 content 验证顺序
    expect(list[0].content).toBe('消息1')
    expect(list[1].content).toBe('回复1')
    expect(list[2].content).toBe('消息2')
  })

  it('无消息时返回空数组', () => {
    const session = agentSessionRepo.create('空会话')
    const list = agentMessageRepo.listBySession(session.id)
    expect(list).toEqual([])
  })

  it('不同会话的消息互不影响', () => {
    const s1 = agentSessionRepo.create('会话A')
    const s2 = agentSessionRepo.create('会话B')

    agentMessageRepo.add(s1.id, { role: 'user', content: 'A1' })
    agentMessageRepo.add(s2.id, { role: 'user', content: 'B1' })
    agentMessageRepo.add(s1.id, { role: 'user', content: 'A2' })

    expect(agentMessageRepo.listBySession(s1.id)).toHaveLength(2)
    expect(agentMessageRepo.listBySession(s2.id)).toHaveLength(1)
  })
})

describe('agentMessageRepo.deleteBySession', () => {
  it('删除后 listBySession 返回空', () => {
    const session = agentSessionRepo.create('删除测试')
    agentMessageRepo.add(session.id, { role: 'user', content: '消息1' })
    agentMessageRepo.add(session.id, { role: 'assistant', content: '回复1' })

    expect(agentMessageRepo.listBySession(session.id)).toHaveLength(2)

    const deleted = agentMessageRepo.deleteBySession(session.id)
    expect(deleted).toBe(true)
    expect(agentMessageRepo.listBySession(session.id)).toEqual([])
  })

  it('无消息时返回 false', () => {
    const session = agentSessionRepo.create('空会话')
    const deleted = agentMessageRepo.deleteBySession(session.id)
    expect(deleted).toBe(false)
  })
})

describe('agentMessageRepo.searchAll', () => {
  it('添加含关键词的消息，searchAll 返回匹配项，含 sessionTitle', () => {
    const session = agentSessionRepo.create('AI 讨论会话')
    agentMessageRepo.add(session.id, { role: 'user', content: '讨论 AI 伦理问题' })
    agentMessageRepo.add(session.id, { role: 'assistant', content: 'AI 伦理涉及多个方面' })
    agentMessageRepo.add(session.id, { role: 'user', content: '完全无关的话题' })

    const results = agentMessageRepo.searchAll('AI')
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.sessionTitle).toBe('AI 讨论会话')
      expect(r.message.content).toContain('AI')
    }
  })

  it('跨会话搜索返回多个会话的消息', () => {
    const s1 = agentSessionRepo.create('会话1')
    const s2 = agentSessionRepo.create('会话2')

    agentMessageRepo.add(s1.id, { role: 'user', content: '搜索关键词' })
    agentMessageRepo.add(s2.id, { role: 'user', content: '搜索关键词' })

    const results = agentMessageRepo.searchAll('搜索关键词')
    expect(results).toHaveLength(2)
    const titles = results.map((r) => r.sessionTitle)
    expect(titles).toContain('会话1')
    expect(titles).toContain('会话2')
  })

  it('空关键词返回空数组', () => {
    const session = agentSessionRepo.create('会话')
    agentMessageRepo.add(session.id, { role: 'user', content: '内容' })

    expect(agentMessageRepo.searchAll('')).toEqual([])
    expect(agentMessageRepo.searchAll('   ')).toEqual([])
  })

  it('无匹配时返回空数组', () => {
    const session = agentSessionRepo.create('会话')
    agentMessageRepo.add(session.id, { role: 'user', content: '内容' })

    const results = agentMessageRepo.searchAll('不存在的关键词')
    expect(results).toEqual([])
  })
})

describe('seq 自增（通过 listBySession 顺序间接验证）', () => {
  it('同一 session 添加多条，按添加顺序返回', () => {
    const session = agentSessionRepo.create('seq 测试')

    agentMessageRepo.add(session.id, { role: 'user', content: 'm1' })
    agentMessageRepo.add(session.id, { role: 'assistant', content: 'm2' })
    agentMessageRepo.add(session.id, { role: 'user', content: 'm3' })
    agentMessageRepo.add(session.id, { role: 'assistant', content: 'm4' })

    // seq 不暴露到 AgentMessageRecord，通过 listBySession 的返回顺序间接验证
    const list = agentMessageRepo.listBySession(session.id)
    expect(list).toHaveLength(4)
    expect(list[0].content).toBe('m1')
    expect(list[1].content).toBe('m2')
    expect(list[2].content).toBe('m3')
    expect(list[3].content).toBe('m4')
  })

  it('不同 session 的 seq 独立计数', () => {
    const s1 = agentSessionRepo.create('会话A')
    const s2 = agentSessionRepo.create('会话B')

    agentMessageRepo.add(s1.id, { role: 'user', content: 'a1' })
    agentMessageRepo.add(s2.id, { role: 'user', content: 'b1' })
    agentMessageRepo.add(s1.id, { role: 'user', content: 'a2' })

    // s1 有 2 条（seq=1,2），s2 有 1 条（seq=1），各自独立计数
    const listA = agentMessageRepo.listBySession(s1.id)
    const listB = agentMessageRepo.listBySession(s2.id)
    expect(listA).toHaveLength(2)
    expect(listB).toHaveLength(1)
    expect(listA[0].content).toBe('a1')
    expect(listA[1].content).toBe('a2')
    expect(listB[0].content).toBe('b1')
  })
})
