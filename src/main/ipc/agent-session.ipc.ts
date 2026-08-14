// ============================================================
// agent-session.ipc.ts — Agent 会话持久化 IPC handler（AI Agent v1.3.0 Week 5 Task 30 / Week 7 Task 41）
//
// 注册通道：
//   agent:session:list                列出全部会话（按 updatedAt DESC）
//   agent:session:create              创建新会话
//   agent:session:rename              重命名会话
//   agent:session:delete              删除会话（事务级联清理消息）
//   agent:session:clear-all           清空全部会话（事务级联清理全部消息）
//   agent:session:load                加载会话详情（session + messages）
//   agent:session:search              跨会话搜索（title / lastMessageText）
//   agent:session:add-message         追加一条消息到指定会话（Task 41.3）
//   agent:session:update-last-message 更新会话最近消息预览（Task 41.3）
//
// 设计要点：
//   - 复用 ipc/utils.ts 的 wrap 函数统一返回 ApiResponse，与 event.ipc.ts 风格一致
//   - 所有读/写操作均为同步（better-sqlite3 同步 API），wrap 内 try-catch 兜底
//   - 参数校验通过 assertNonEmptyString 抛友好错误，由 wrap 转 ApiResponse.error
//   - 严格 TypeScript，避免 any（用 unknown 替代）
// ============================================================

import { ipcMain } from 'electron'
import { agentSessionRepo } from '../db/repository/agent-session.repo'
import { agentMessageRepo } from '../db/repository/agent-message.repo'
import type {
  AgentSession,
  AgentMessageRecord,
  AgentContext
} from '../../shared/agent-types'
import { wrap } from './utils'

/**
 * 参数校验辅助函数。
 * 校验失败时抛出友好错误，由 wrap 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/** 校验非空字符串 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

/** 加载会话详情的返回结构 */
interface SessionLoadResult {
  session: AgentSession
  messages: AgentMessageRecord[]
}

/** add-message 入参结构 */
interface AddMessagePayload {
  sessionId: string
  message: Omit<AgentMessageRecord, 'id' | 'createdAt' | 'seq' | 'sessionId'>
}

/** update-last-message 入参结构 */
interface UpdateLastMessagePayload {
  sessionId: string
  text: string
}

/** update-context 入参结构（P0-1 引入） */
interface UpdateContextPayload {
  sessionId: string
  context: AgentContext
}

/**
 * 注册 Agent 会话持久化 IPC handler。
 * 在主进程 app.whenReady 之后、createWindow 之前调用（与 registerAgentIpc 同期）。
 */
export function registerAgentSessionIpc(): void {
  // ---------- agent:session:list ----------
  // 列出全部会话，按 updatedAt DESC 排序（最近更新的在前）
  ipcMain.handle('agent:session:list', () => wrap(() => agentSessionRepo.list()))

  // ---------- agent:session:create ----------
  // 入参 { title: string }，创建新会话
  ipcMain.handle('agent:session:create', (_e, payload: { title: string }) =>
    wrap(() => {
      assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
      assertNonEmptyString(payload.title, 'title')
      return agentSessionRepo.create(payload.title)
    })
  )

  // ---------- agent:session:rename ----------
  // 入参 { id: string; title: string }，重命名会话
  ipcMain.handle(
    'agent:session:rename',
    (_e, payload: { id: string; title: string }) =>
      wrap(() => {
        assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
        assertNonEmptyString(payload.id, 'id')
        assertNonEmptyString(payload.title, 'title')
        return agentSessionRepo.rename(payload.id, payload.title)
      })
  )

  // ---------- agent:session:delete ----------
  // 入参 { id: string }，删除会话（事务级联清理消息）
  ipcMain.handle('agent:session:delete', (_e, payload: { id: string }) =>
    wrap(() => {
      assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
      assertNonEmptyString(payload.id, 'id')
      return agentSessionRepo.delete(payload.id)
    })
  )

  // ---------- agent:session:clear-all ----------
  // 无入参，清空全部会话（事务级联清理全部消息）
  ipcMain.handle('agent:session:clear-all', () =>
    wrap(() => agentSessionRepo.clearAll())
  )

  // ---------- agent:session:load ----------
  // 入参 { id: string }，加载会话详情（session + messages）
  // 会话不存在时返回 error
  ipcMain.handle('agent:session:load', (_e, payload: { id: string }) =>
    wrap((): SessionLoadResult => {
      assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
      assertNonEmptyString(payload.id, 'id')
      const session = agentSessionRepo.get(payload.id)
      if (!session) {
        throw new Error(`会话不存在：${payload.id}`)
      }
      const messages = agentMessageRepo.listBySession(payload.id)
      return { session, messages }
    })
  )

  // ---------- agent:session:search ----------
  // 入参 { keyword: string }，跨会话搜索（title / lastMessageText）
  // keyword 为空时返回空数组（repo 内部已处理）
  ipcMain.handle('agent:session:search', (_e, payload: { keyword: string }) =>
    wrap(() => {
      assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
      assertParam(typeof payload.keyword === 'string', '参数 keyword 必须为字符串')
      return agentSessionRepo.search(payload.keyword)
    })
  )

  // ---------- agent:session:add-message（Task 41.3） ----------
  // 入参 { sessionId: string; message: Omit<AgentMessageRecord, 'id' | 'createdAt' | 'seq'> }
  // 追加一条消息到指定会话，由 agentMessageRepo.add 写入 agent_messages 表。
  // 用于 sendMessage 流程中持久化用户/assistant 消息。
  ipcMain.handle(
    'agent:session:add-message',
    (_e, payload: AddMessagePayload) =>
      wrap(() => {
        assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
        assertNonEmptyString(payload.sessionId, 'sessionId')
        assertParam(payload.message && typeof payload.message === 'object', '参数 message 必须为对象')
        assertNonEmptyString(payload.message.role, 'message.role')
        assertParam(typeof payload.message.content === 'string', '参数 message.content 必须为字符串')
        return agentMessageRepo.add(payload.sessionId, payload.message)
      })
  )

  // ---------- agent:session:update-last-message（Task 41.3） ----------
  // 入参 { sessionId: string; text: string }
  // 更新会话的 lastMessageText / lastMessageAt / updatedAt 字段。
  // 用于 sendMessage 完成后刷新会话列表的最近消息预览。
  ipcMain.handle(
    'agent:session:update-last-message',
    (_e, payload: UpdateLastMessagePayload) =>
      wrap(() => {
        assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
        assertNonEmptyString(payload.sessionId, 'sessionId')
        assertParam(typeof payload.text === 'string', '参数 text 必须为字符串')
        agentSessionRepo.updateLastMessage(payload.sessionId, payload.text)
        return true
      })
  )

  // ---------- agent:session:update-context（P0-1 引入） ----------
  // 入参 { sessionId: string; context: AgentContext }
  // 将业务上下文序列化到 agent_sessions.contextJson 并刷新 updatedAt。
  // agent-loop 每次对话结束（finally）时调用，用于重启后恢复会话上下文。
  ipcMain.handle(
    'agent:session:update-context',
    (_e, payload: UpdateContextPayload) =>
      wrap(() => {
        assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
        assertNonEmptyString(payload.sessionId, 'sessionId')
        assertParam(
          payload.context && typeof payload.context === 'object',
          '参数 context 必须为对象'
        )
        agentSessionRepo.updateContext(payload.sessionId, payload.context)
        return true
      })
  )
}
