// ============================================================
// agent-session.repo.test.ts — Agent 会话持久化 CRUD 测试（Task 51.2）
//
// 覆盖 agent-session.repo.ts 的 CRUD + search + 级联删除：
//   - create：创建会话，返回含 id / title / createdAt
//   - list：创建 3 个会话后，list 返回 3 个，按 updatedAt DESC 排序
//   - get：创建后 get(id) 返回相同数据
//   - rename：rename 后 get 返回新 title
//   - updateLastMessage：更新后 lastMessageText / lastMessageAt 变化
//   - delete：delete 后 get 返回 null，list 不含该会话
//   - search：title 或 lastMessageText 含关键词时返回匹配项
//   - 级联删除：delete 会话后，agent_messages 表对应记录也被删除
//
// Mock 策略：由于 better-sqlite3 原生模块为 Electron ABI 编译，
// vitest (Node.js ABI) 无法直接加载（见 smoke.test.ts 注释）。
// 因此 mock getDb() 返回一个内存 DB 模拟器，支持 prepare/run/all/get/transaction/exec。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// 内存 DB 模拟器
// ============================================================

/** agent_sessions 表行类型 */
interface SessionRow {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageText: string | null
  lastMessageAt: string | null
  contextJson: string | null
}

/** agent_messages 表行类型（级联删除测试用） */
interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  tool_calls_json: string | null
  tool_results_json: string | null
  created_at: string
  seq: number
  session_title?: string // JOIN 查询时附加
}

/**
 * 内存 DB 模拟器。
 * 支持 agent-session.repo 与 agent-message.repo 所需的 SQL 操作。
 */
class MemoryDb {
  sessions = new Map<string, SessionRow>()
  messages = new Map<string, MessageRow>()
  tables = new Set<string>(['agent_sessions', 'agent_messages'])

  /** 模拟 db.exec（建表/索引，无操作） */
  exec(_sql: string): void {
    // no-op：内存 Map 已就绪
  }

  /** 模拟 db.transaction */
  transaction<T>(fn: () => T): () => T {
    return () => fn()
  }

  /** 模拟 db.prepare(sql)，返回 statement 对象 */
  prepare(sql: string) {
    const self = this

    // helper: LIKE 模糊匹配（% 匹配任意字符序列）
    function likeMatch(text: string | null | undefined, pattern: string): boolean {
      if (!text) return false
      // 将 SQL LIKE pattern 转为 RegExp
      const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.')
      return new RegExp(`^${regex}$`, 'i').test(text)
    }

    return {
      /** run: INSERT / UPDATE / DELETE */
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

        // UPDATE agent_sessions SET title = ?, updatedAt = ? WHERE id = ?
        // params: [title, updatedAt, id]
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

        // UPDATE agent_sessions SET lastMessageText = ?, lastMessageAt = ?, updatedAt = ? WHERE id = ?
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

        // DELETE FROM agent_sessions WHERE id = ?
        if (/^DELETE\s+FROM\s+agent_sessions\s+WHERE\s+id/i.test(s)) {
          const id = params[0]
          if (self.sessions.delete(id)) {
            return { changes: 1 }
          }
          return { changes: 0 }
        }

        return { changes: 0 }
      },

      /** all: SELECT * FROM ... */
      all(...params: any[]): any[] {
        const s = sql.trim()

        // SELECT * FROM agent_sessions ORDER BY updatedAt DESC
        if (/^SELECT\s+\*\s+FROM\s+agent_sessions\s+ORDER\s+BY\s+updatedAt\s+DESC/i.test(s)) {
          return Array.from(self.sessions.values()).sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt)
          )
        }

        // SELECT * FROM agent_sessions WHERE title LIKE ? OR lastMessageText LIKE ? ORDER BY updatedAt DESC
        if (
          /^SELECT\s+\*\s+FROM\s+agent_sessions\s+WHERE\s+title\s+LIKE/i.test(s)
        ) {
          const titlePattern = params[0]
          const msgPattern = params[1]
          return Array.from(self.sessions.values())
            .filter(
              (row) =>
                likeMatch(row.title, titlePattern) ||
                likeMatch(row.lastMessageText, msgPattern)
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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

        // SELECT m.*, s.title AS session_title FROM agent_messages m INNER JOIN agent_sessions s ...
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

      /** get: SELECT ... WHERE id = ? / MAX / sqlite_master */
      get(...params: any[]): any {
        const s = sql.trim()

        // SELECT * FROM agent_sessions WHERE id = ?
        if (
          /^SELECT\s+\*\s+FROM\s+agent_sessions\s+WHERE\s+id\s*=\s*\?/i.test(s)
        ) {
          return self.sessions.get(params[0]) ?? undefined
        }

        // SELECT * FROM agent_messages WHERE id = ?
        if (
          /^SELECT\s+\*\s+FROM\s+agent_messages\s+WHERE\s+id\s*=\s*\?/i.test(s)
        ) {
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

        // SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_messages'
        if (/sqlite_master/i.test(s)) {
          // 提取表名（name='xxx'）
          const match = s.match(/name\s*=\s*'(\w+)'/i)
          if (match && self.tables.has(match[1])) {
            return { 1: 1 }
          }
          return undefined
        }

        return undefined
      }
    }
  }
}

// ============================================================
// Mock getDb
// ============================================================

let mockDb: MemoryDb

vi.mock('../../index', () => ({
  getDb: () => mockDb
}))

// mock uuid 生成确定性 id
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`
}))

// 导入被测模块（在 mock 之后）
import { agentSessionRepo } from '../agent-session.repo'
import { agentMessageRepo } from '../agent-message.repo'

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  mockDb = new MemoryDb()
  uuidCounter = 0
})

describe('agentSessionRepo.create', () => {
  it('创建会话，返回含 id / title / createdAt', () => {
    const session = agentSessionRepo.create('测试会话')

    expect(session.id).toBeDefined()
    expect(session.id).not.toBe('')
    expect(session.title).toBe('测试会话')
    expect(session.createdAt).toBeDefined()
    expect(session.createdAt).not.toBe('')
    expect(session.updatedAt).toBe(session.createdAt)
    expect(session.lastMessageText).toBe('')
    expect(session.lastMessageAt).toBe('')
  })
})

describe('agentSessionRepo.list', () => {
  it('创建 3 个会话后，list 返回 3 个，按 updatedAt DESC 排序', async () => {
    const s1 = agentSessionRepo.create('会话1')
    // 确保 updatedAt 不同（mock uuid 已使 id 唯一，但 createdAt 可能同毫秒）
    await new Promise((r) => setTimeout(r, 10))
    const s2 = agentSessionRepo.create('会话2')
    await new Promise((r) => setTimeout(r, 10))
    const s3 = agentSessionRepo.create('会话3')

    const list = agentSessionRepo.list()
    expect(list).toHaveLength(3)

    // 按 updatedAt DESC 排序：s3 最新，s1 最旧
    expect(list[0].id).toBe(s3.id)
    expect(list[1].id).toBe(s2.id)
    expect(list[2].id).toBe(s1.id)
  })

  it('空数据库时 list 返回空数组', () => {
    const list = agentSessionRepo.list()
    expect(list).toEqual([])
  })
})

describe('agentSessionRepo.get', () => {
  it('创建后 get(id) 返回相同数据', () => {
    const created = agentSessionRepo.create('获取测试')
    const got = agentSessionRepo.get(created.id)

    expect(got).not.toBeNull()
    expect(got!.id).toBe(created.id)
    expect(got!.title).toBe('获取测试')
  })

  it('不存在的 id 返回 null', () => {
    const got = agentSessionRepo.get('nonexistent-id')
    expect(got).toBeNull()
  })
})

describe('agentSessionRepo.rename', () => {
  it('rename 后 get 返回新 title', async () => {
    const created = agentSessionRepo.create('旧标题')
    await new Promise((r) => setTimeout(r, 10))

    const success = agentSessionRepo.rename(created.id, '新标题')
    expect(success).toBe(true)

    const got = agentSessionRepo.get(created.id)
    expect(got!.title).toBe('新标题')
    // updatedAt 应被刷新
    expect(got!.updatedAt).not.toBe(created.updatedAt)
  })

  it('不存在的 id 返回 false', () => {
    const success = agentSessionRepo.rename('nonexistent', '新标题')
    expect(success).toBe(false)
  })
})

describe('agentSessionRepo.updateLastMessage', () => {
  it('更新后 lastMessageText / lastMessageAt 变化', async () => {
    const created = agentSessionRepo.create('消息测试')
    await new Promise((r) => setTimeout(r, 10))

    agentSessionRepo.updateLastMessage(created.id, '这是最新消息')

    const got = agentSessionRepo.get(created.id)
    expect(got!.lastMessageText).toBe('这是最新消息')
    expect(got!.lastMessageAt).toBeDefined()
    expect(got!.lastMessageAt).not.toBe('')
    // updatedAt 也应被刷新
    expect(got!.updatedAt).not.toBe(created.updatedAt)
  })
})

describe('agentSessionRepo.delete', () => {
  it('delete 后 get 返回 null，list 不含该会话', () => {
    const created = agentSessionRepo.create('待删除')
    const success = agentSessionRepo.delete(created.id)

    expect(success).toBe(true)
    expect(agentSessionRepo.get(created.id)).toBeNull()
    expect(agentSessionRepo.list()).toHaveLength(0)
  })

  it('不存在的 id 返回 false', () => {
    const success = agentSessionRepo.delete('nonexistent')
    expect(success).toBe(false)
  })

  it('级联删除：delete 会话后，agent_messages 表对应记录也被删除', () => {
    const session = agentSessionRepo.create('级联删除测试')

    // 先添加消息（使用 agentMessageRepo.add）
    agentMessageRepo.add(session.id, {
      role: 'user',
      content: '测试消息1'
    })
    agentMessageRepo.add(session.id, {
      role: 'assistant',
      content: '测试回复1'
    })

    // 确认消息存在
    expect(agentMessageRepo.listBySession(session.id)).toHaveLength(2)

    // 删除会话
    agentSessionRepo.delete(session.id)

    // 级联删除：消息也应被删除
    expect(agentMessageRepo.listBySession(session.id)).toHaveLength(0)
  })
})

describe('agentSessionRepo.search', () => {
  it('title 含关键词返回匹配项', () => {
    agentSessionRepo.create('辩论赛A')
    agentSessionRepo.create('演讲比赛B')
    agentSessionRepo.create('辩论赛C')

    const results = agentSessionRepo.search('辩论')
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.title).toContain('辩论')
    }
  })

  it('lastMessageText 含关键词返回匹配项', () => {
    const s1 = agentSessionRepo.create('会话X')
    const s2 = agentSessionRepo.create('会话Y')
    agentSessionRepo.updateLastMessage(s1.id, '讨论AI伦理')
    agentSessionRepo.updateLastMessage(s2.id, '讨论其他话题')

    const results = agentSessionRepo.search('AI')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(s1.id)
  })

  it('空关键词返回空数组', () => {
    agentSessionRepo.create('测试会话')
    expect(agentSessionRepo.search('')).toEqual([])
    expect(agentSessionRepo.search('   ')).toEqual([])
  })

  it('无匹配时返回空数组', () => {
    agentSessionRepo.create('辩论赛')
    const results = agentSessionRepo.search('不存在的关键词')
    expect(results).toEqual([])
  })
})
