// ============================================================
// agentSessionStore.ts — Agent 多会话状态管理（AI Agent v1.3.0 Week 7 Task 40）
//
// 职责：
// 1. 维护 Agent 会话列表（sessions）与当前活动会话（currentSessionId）
// 2. 提供会话 CRUD：创建 / 切换 / 重命名 / 删除
// 3. 提供跨会话搜索能力（searchKeyword / searchResults）
// 4. 加载指定会话的消息历史并写入 agentStore.messages（与单会话 store 联动）
//
// 依赖：
// - zustand 状态管理
// - window.agent.session.* API（preload 通过 contextBridge 暴露）
// - useAgentStore（用于 setMessages / 切换会话时回填消息）
//
// 设计要点：
// - 会话列表仅在内存中维护，由 loadSessions() 主动从主进程拉取
// - 切换会话时联动 agentStore：清空旧消息 → 写入新会话上下文 → 加载历史消息
// - 搜索结果与 sessions 独立存储，UI 层根据 searchKeyword 是否为空切换展示
// - 所有 IPC 调用失败时仅 console.error，不抛错打断 UI；后续可按需加 error 状态
// ============================================================

import { create } from 'zustand'
import type { AgentSession, AgentAPI } from '../../../shared/agent-types'
import type { ApiResponse } from '../../../shared/types'
import { useAgentStore, type AgentUIMessage } from './agentStore'

/** Agent 会话 Store 状态 */
export interface AgentSessionState {
  /** 全部会话列表（按 updatedAt DESC） */
  sessions: AgentSession[]
  /** 当前活动会话 id（无会话时为 null） */
  currentSessionId: string | null
  /** 当前搜索关键词（空字符串表示非搜索态） */
  searchKeyword: string
  /** 搜索结果（仅搜索态下使用） */
  searchResults: AgentSession[]
  /** 是否正在加载会话列表 */
  loading: boolean
  /** 最近一次错误信息（IPC 失败时填充） */
  error: string | null

  /** 拉取全部会话列表 */
  loadSessions: () => Promise<void>
  /**
   * 创建新会话（默认标题「新会话」），并切换为当前会话。
   * @param opts.resetChat 默认 true（清空 agentStore 消息/上下文、取消进行中流式）；
   *   传 false 时跳过这些重置，用于「发送时自动建会话」场景（避免清掉刚输入的消息与 loading 状态）
   */
  createSession: (title?: string, opts?: { resetChat?: boolean }) => Promise<AgentSession | null>
  /** 切换到指定会话，并联动 agentStore 加载历史消息与上下文 */
  switchSession: (id: string) => Promise<void>
  /** 重命名指定会话 */
  renameSession: (id: string, title: string) => Promise<boolean>
  /** 删除指定会话；若为当前会话则切换到第一个或清空 */
  deleteSession: (id: string) => Promise<boolean>
  /** 清空全部会话（事务级联清理全部消息），并重置当前会话与消息列表 */
  clearAllSessions: () => Promise<boolean>
  /** 跨会话搜索（title / lastMessageText） */
  searchSessions: (keyword: string) => Promise<void>
  /** 加载指定会话的消息历史到 agentStore.messages */
  loadSessionMessages: (id: string) => Promise<void>
  /** 清空搜索状态（回到会话列表态） */
  clearSearch: () => void
  /** 设置当前活动会话 id（仅内存更新，不触发消息加载；用于 createSession 后切换） */
  setCurrentSessionId: (id: string | null) => void
}

/**
 * 获取 preload 暴露的 Agent API。
 * 与 agentStore 中的 getAgentAPI 一致：通过 cast 获取类型安全引用。
 */
function getAgentAPI(): AgentAPI | null {
  const w = window as unknown as { agent?: AgentAPI }
  return w.agent ?? null
}

/**
 * 通用响应解包：失败时抛错，成功时返回 data。
 * 与 drawStore / settingsStore 中的 extractError 同语义。
 * 接受 Promise<ApiResponse<T>>，先 await 再解包。
 */
async function extractData<T>(resPromise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await resPromise
  if (res.success && res.data !== undefined) return res.data as T
  throw new Error(res.error || '未知错误')
}

export const useAgentSessionStore = create<AgentSessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  searchKeyword: '',
  searchResults: [],
  loading: false,
  error: null,

  loadSessions: async () => {
    const api = getAgentAPI()
    if (!api) {
      set({ error: 'Agent 服务未就绪（window.agent 不可用）' })
      return
    }
    set({ loading: true, error: null })
    try {
      const data = await extractData(api.session.list())
      set({ sessions: data, loading: false })
      // 若当前无活动会话且列表非空，自动选中第一个（便于首屏展示）
      if (!get().currentSessionId && data.length > 0) {
        set({ currentSessionId: data[0].id })
      }
      // 启动预建：列表为空且无活动会话时自动创建一个，
      // 保证「首次打开直接对话」即有会话可存（配合 sendMessage 兜底，绝不丢消息）。
      // resetChat:false 避免清空 agentStore 消息/上下文；创建成功后 currentSessionId 非空，不会重复建。
      if (data.length === 0 && !get().currentSessionId) {
        await get().createSession('新会话', { resetChat: false })
      }
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  },

  createSession: async (title = '新会话', opts?: { resetChat?: boolean }) => {
    const api = getAgentAPI()
    if (!api) {
      set({ error: 'Agent 服务未就绪（window.agent 不可用）' })
      return null
    }
    const resetChat = opts?.resetChat ?? true
    // P0-2：创建新会话前取消进行中的流式对话，防止 delta 写入旧会话位置。
    // resetChat:false（发送时自动建）跳过：不应清空刚输入的消息、也不破坏 sendMessage 的 loading 状态。
    if (resetChat) {
      useAgentStore.getState().cancel()
    }
    set({ error: null })
    try {
      const created = await extractData(api.session.create(title))
      // 追加到列表头部（按 updatedAt DESC，新会话应排第一）
      set((s) => ({
        sessions: [created, ...s.sessions],
        currentSessionId: created.id
      }))
      // 切换会话时清空 agentStore 的消息与上下文（新会话无历史）。
      // resetChat:false 时跳过：发送链路已把用户消息加入 agentStore.messages，不能清掉。
      if (resetChat) {
        useAgentStore.getState().clearMessages()
        useAgentStore.getState().clearContext()
      }
      return created
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  switchSession: async (id) => {
    if (get().currentSessionId === id) return
    // P0-2：切换会话前取消进行中的流式对话，防止 delta 写入错误会话
    useAgentStore.getState().cancel()
    set({ currentSessionId: id })
    // 联动 agentStore：加载会话消息与上下文
    await get().loadSessionMessages(id)
  },

  renameSession: async (id, title) => {
    const api = getAgentAPI()
    if (!api) {
      set({ error: 'Agent 服务未就绪（window.agent 不可用）' })
      return false
    }
    set({ error: null })
    try {
      const ok = await extractData(api.session.rename(id, title))
      if (ok) {
        // 同步更新内存中的会话标题与 updatedAt
        set((s) => ({
          sessions: s.sessions.map((session) =>
            session.id === id
              ? { ...session, title, updatedAt: new Date().toISOString() }
              : session
          )
        }))
      }
      return ok
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return false
    }
  },

  deleteSession: async (id) => {
    const api = getAgentAPI()
    if (!api) {
      set({ error: 'Agent 服务未就绪（window.agent 不可用）' })
      return false
    }
    // P0-2：删除会话前取消进行中的流式对话
    useAgentStore.getState().cancel()
    set({ error: null })
    try {
      const ok = await extractData(api.session.delete(id))
      if (ok) {
        const remaining = get().sessions.filter((s) => s.id !== id)
        set({ sessions: remaining })

        // 若删除的是当前会话，切换到第一个或清空
        if (get().currentSessionId === id) {
          const nextId = remaining.length > 0 ? remaining[0].id : null
          set({ currentSessionId: nextId })
          if (nextId) {
            await get().loadSessionMessages(nextId)
          } else {
            // 无会话可用：清空 agentStore 消息与上下文
            useAgentStore.getState().clearMessages()
            useAgentStore.getState().clearContext()
          }
        }
      }
      return ok
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return false
    }
  },

  clearAllSessions: async () => {
    const api = getAgentAPI()
    if (!api) {
      set({ error: 'Agent 服务未就绪（window.agent 不可用）' })
      return false
    }
    // P0-2：清空全部会话前取消进行中的流式对话
    useAgentStore.getState().cancel()
    set({ error: null })
    try {
      const ok = await extractData(api.session.clearAll())
      if (ok) {
        // 重置会话列表、当前活动会话与搜索状态
        set({ sessions: [], currentSessionId: null, searchResults: [], searchKeyword: '' })
        // 联动 agentStore：清空消息与上下文
        useAgentStore.getState().clearMessages()
        useAgentStore.getState().clearContext()
      }
      return ok
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return false
    }
  },

  searchSessions: async (keyword) => {
    const api = getAgentAPI()
    if (!api) {
      set({ error: 'Agent 服务未就绪（window.agent 不可用）' })
      return
    }
    set({ error: null, searchKeyword: keyword })
    // 空关键词：退出搜索态
    if (!keyword.trim()) {
      set({ searchResults: [] })
      return
    }
    try {
      const data = await extractData(api.session.search(keyword))
      set({ searchResults: data })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  loadSessionMessages: async (id) => {
    const api = getAgentAPI()
    if (!api) {
      set({ error: 'Agent 服务未就绪（window.agent 不可用）' })
      return
    }
    set({ error: null })
    try {
      const { session, messages } = await extractData(api.session.load(id))

      // 将持久化消息转换为 agentStore 的 AgentUIMessage 格式
      // 并标记为非流式态（历史消息均已完成）
      const agentStore = useAgentStore.getState()

      // 同步会话上下文到 agentStore
      if (session.context) {
        agentStore.setContext(session.context)
      } else {
        agentStore.clearContext()
      }

      // 转换消息格式：AgentMessageRecord -> AgentUIMessage
      //
      // AgentMessageRecord.role 含 system / tool_result 等类型，而 AgentUIMessage.role
      // 仅含 user / assistant / tool_call 三种：
      // - system 属于内部提示词，不展示给用户
      // - tool_result 不生成独立气泡，其结果合并进对应 assistant 消息的 toolCalls 卡片
      // - assistant 消息的 toolCalls（OpenAI 格式，落库时保存）恢复为 AgentUIToolCall[]
      //   （工具卡片），并匹配后续 tool_result 记录补上结果 / 失败状态——修复历史
      //   会话「工具调用卡片丢失 → 多轮回复看起来被分段」的问题
      const uiMessages: AgentUIMessage[] = []

      // 1) 先收集 tool_result 结果：toolCallId -> 结果/错误。
      //    注意：落库层 messageToRecord 对 tool 消息硬编码 success=true，
      //    成败需从内容判断——{ error: string } 结构视为失败。
      const toolResultMap = new Map<
        string,
        { result?: unknown; error?: string }
      >()
      for (const m of messages) {
        if (m.role !== 'tool_result') continue
        const tr = m.toolResults?.[0]
        if (!tr) continue
        const raw = tr.result != null ? String(tr.result) : m.content
        let parsed: unknown = raw
        try {
          parsed = JSON.parse(raw)
        } catch {
          // 非 JSON（纯文本结果）原样保留
        }
        const asRecord =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null
        if (asRecord && typeof asRecord.error === 'string') {
          toolResultMap.set(tr.toolCallId, { error: asRecord.error })
        } else {
          toolResultMap.set(tr.toolCallId, { result: parsed })
        }
      }

      // 2) 转换为 UI 消息（仅保留 user / assistant；tool_result 已合并进卡片）
      for (const m of messages) {
        if (m.role !== 'user' && m.role !== 'assistant') continue
        const uiMsg: AgentUIMessage = {
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: new Date(m.createdAt).getTime(),
          isStreaming: false
        }
        // 历史 assistant 消息恢复工具调用卡片
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          uiMsg.toolCalls = m.toolCalls.map((tc) => {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
            } catch {
              // arguments 解析失败保留空对象
            }
            const outcome = toolResultMap.get(tc.id)
            return {
              toolCallId: tc.id,
              toolName: tc.function.name,
              args,
              status: outcome?.error ? ('error' as const) : ('success' as const),
              result: outcome?.result,
              error: outcome?.error
            }
          })
        }
        uiMessages.push(uiMsg)
      }
      agentStore.setMessages(uiMessages)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  clearSearch: () => {
    set({ searchKeyword: '', searchResults: [] })
  },

  setCurrentSessionId: (id) => {
    set({ currentSessionId: id })
  }
}))
