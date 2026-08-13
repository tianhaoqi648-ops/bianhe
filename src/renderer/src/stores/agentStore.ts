// ============================================================
// agentStore.ts — Agent UI 状态管理（AI Agent v1.3.0 Week 4 Task 18 / Week 7 Task 41）
//
// 职责：
// 1. 维护 Agent 对话消息列表（user / assistant，工具调用挂在 assistant 上）
// 2. 驱动流式 UI：delta 追加文本、tool_call_start/result 更新工具调用状态
// 3. 管理业务上下文（currentTopic / currentEvent / currentPage）与上下文锁定（Task 41.1/41.2）
// 4. 工具人工确认状态（pendingConfirm 驱动 ToolConfirmModal 显隐，Task 41.4/41.5）
// 5. 多会话集成：sendMessage 持久化用户/assistant 消息到 agent_messages 表（Task 41.3）
// 6. 错误状态与 loading 状态
//
// 依赖：
// - zustand 状态管理
// - useSettingsStore.aiConfig 提供 LLM 配置（每次发送时读取最新值）
// - window.agent API（preload 通过 contextBridge.exposeInMainWorld('agent', ...) 暴露）
// - useAgentSessionStore.currentSessionId 决定是否持久化消息（双向引用通过 dynamic import 解耦）
//
// 设计要点：
// - 多会话模型：currentSessionId 由 agentSessionStore 维护，本 store 通过 get() 读取最新值
// - contextLocked=true 时，setContext 仅追加不存在的字段（与 contextManager.lock 语义一致）
// - assistant 消息以 isStreaming=true 标记流式态，done/error 时置 false
// - 工具调用挂在"当前流式 assistant 消息"的 toolCalls 数组上
// - 模块级 currentCancelFn 保存当前对话的取消函数，cancel() 时调用
// - pendingConfirm 状态驱动 UI（Task 43 的 ToolConfirmModal 组件渲染时读取此状态）
// ============================================================

import { create } from 'zustand'
import type {
  ChatRequest,
  ChatEvent,
  AgentContext,
  AgentAPI,
  ToolCallConfirmEvent,
  ToolConfirmResult,
  ScheduleRound
} from '../../../shared/agent-types'
import { useSettingsStore } from './settingsStore'

/** UI 渲染用的工具调用条目（挂在 assistant 消息上） */
export interface AgentUIToolCall {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  status: 'loading' | 'success' | 'error'
  result?: unknown
  error?: string
}

/** UI 渲染用的消息（user / assistant） */
export interface AgentUIMessage {
  id: string
  role: 'user' | 'assistant' | 'tool_call'
  content: string
  toolCalls?: AgentUIToolCall[]
  createdAt: number
  isStreaming?: boolean
}

/** 错误状态 */
export interface AgentError {
  code: string
  message: string
}

export interface AgentState {
  /** UI 渲染用的消息列表 */
  messages: AgentUIMessage[]
  /** 是否正在等待 LLM/工具响应 */
  isLoading: boolean
  /** 当前会话（保留兼容字段；多会话由 agentSessionStore 管理） */
  currentSession: { id: string } | null
  /** 当前业务上下文 */
  context: AgentContext
  /**
   * 上下文是否锁定（Task 41.1）。
   * - false（默认）：setContext 走正常覆盖合并逻辑
   * - true：setContext 仅追加当前不存在的字段，已存在字段保持不变
   * 通过 lockContext() / unlockContext() 切换。
   */
  contextLocked: boolean
  /** 最近一次错误 */
  error: AgentError | null
  /** 待跳转的路由路径（由工具调用触发，AgentChatPanel 监听并执行 navigate） */
  pendingNavigation: string | null
  /** 设置待跳转路由（Task 49.2：ToolCallCard「应用此赛制」按钮外部调用） */
  setPendingNavigation: (path: string) => void
  /** 清除待跳转路由（AgentChatPanel 执行 navigate 后调用） */
  clearPendingNavigation: () => void
  /**
   * 待确认的工具调用事件（Task 41.4/41.5）。
   * - 主进程推送 tool_call_confirm 事件时填充
   * - 渲染进程 ToolConfirmModal 据此显隐
   * - handleConfirmResult 调用后置 null
   */
  pendingConfirm: ToolCallConfirmEvent | null
  /**
   * 待预览的赛程数据（Task 49.4）。
   * - generate_schedule 工具成功时填充为赛程轮次数组
   * - SchedulePreviewModal 据此显隐
   * - clearPendingSchedulePreview 调用后置 null
   */
  pendingSchedulePreview: ScheduleRound[] | null

  /** 发送用户消息并启动流式对话 */
  sendMessage(text: string): void
  /** 取消当前进行中的对话 */
  cancel(): void
  /** 合并更新业务上下文（contextLocked=true 时仅追加不存在的字段） */
  setContext(partial: Partial<AgentContext>): void
  /** 清空业务上下文（currentTopic/currentEvent 置 null）并解锁 */
  clearContext(): void
  /** 锁定上下文（Task 41.2）：setContext 仅追加字段 */
  lockContext(): void
  /** 解锁上下文（Task 41.2）：setContext 恢复覆盖合并语义 */
  unlockContext(): void
  /** 清空消息列表 */
  clearMessages(): void
  /** 直接覆盖消息列表（agentSessionStore.loadSessionMessages 调用） */
  setMessages(messages: AgentUIMessage[]): void
  /** 清空最近一次错误 */
  clearError(): void
  /**
   * 处理工具确认结果（Task 41.4）。
   * 调用 window.agent.confirmResult 将结果回传主进程，并清空 pendingConfirm。
   */
  handleConfirmResult(toolCallId: string, confirmed: boolean, modifiedArgs?: Record<string, unknown>): void
  /** 清空 pendingConfirm（Task 41.5：UI 关闭 Modal 时调用） */
  clearPendingConfirm(): void
  /** 清空 pendingSchedulePreview（Task 49.4：UI 关闭 Modal 时调用） */
  clearPendingSchedulePreview(): void
}

/**
 * 生成消息唯一 ID。
 * 优先使用 crypto.randomUUID（安全上下文可用），回退到时间戳+随机串。
 */
function genId(): string {
  // crypto.randomUUID 在非安全上下文（如 http://localhost）可能不可用，需可选链保护
  const uuid = crypto?.randomUUID?.()
  if (uuid) return uuid
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/**
 * 获取 preload 暴露的 Agent API。
 *
 * window.agent 通过 contextBridge.exposeInMainWorld('agent', agentAPI) 挂载，
 * 但 index.d.ts 的 Window 接口尚未声明 agent 字段（待后续补全），
 * 此处用 cast 获取类型安全引用，与 Settings.tsx 中的处理方式一致。
 */
function getAgentAPI(): AgentAPI | null {
  const w = window as unknown as { agent?: AgentAPI }
  return w.agent ?? null
}

/**
 * 判断消息是否为"当前可追加的流式 assistant 消息"。
 * 即最后一条消息为 assistant 且 isStreaming=true。
 */
function isStreamingAssistant(msg: AgentUIMessage | undefined): msg is AgentUIMessage {
  return !!msg && msg.role === 'assistant' && msg.isStreaming === true
}

/**
 * 获取当前活动会话 id（从 agentSessionStore 读取最新值）。
 * 使用 dynamic import 避免循环依赖：agentSessionStore 顶部 import 了 useAgentStore。
 * 返回 null 表示无活动会话（不持久化消息）。
 */
async function getCurrentSessionId(): Promise<string | null> {
  const { useAgentSessionStore } = await import('./agentSessionStore')
  return useAgentSessionStore.getState().currentSessionId
}

/** 模块级变量：保存当前对话的取消函数（由 window.agent.chat 返回） */
let currentCancelFn: (() => void) | null = null

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  isLoading: false,
  currentSession: { id: 'default' },
  context: { currentTopic: null, currentEvent: null, currentPage: undefined },
  contextLocked: false,
  error: null,
  pendingNavigation: null,
  pendingConfirm: null,
  pendingSchedulePreview: null,

  sendMessage(text) {
    const trimmed = text?.trim?.() ?? ''
    if (!trimmed) return

    // 修复：无论 isLoading 状态，先调用上一次的取消函数清理 IPC handler。
    // 上一次对话 done/error 事件只置空了 currentCancelFn 引用，但 preload 层
    // 的 ipcRenderer.on('agent:event', handler) 可能仍残留，导致下次对话时
    // 两个 handler 同时处理 delta，造成每个字符被写入两次。
    if (currentCancelFn) {
      try {
        currentCancelFn()
      } catch {
        // 忽略取消异常
      }
      currentCancelFn = null
    }

    // 避免并发对话：若上一次仍在 loading，复位状态
    if (get().isLoading) {
      set((s) => {
        const msgs = s.messages
        const last = msgs[msgs.length - 1]
        if (isStreamingAssistant(last)) {
          const next = msgs.slice()
          next[next.length - 1] = { ...last, isStreaming: false }
          return { messages: next, isLoading: false }
        }
        return { isLoading: false }
      })
    }

    const userMsg: AgentUIMessage = {
      id: genId(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now()
    }

    set((s) => ({
      messages: [...s.messages, userMsg],
      isLoading: true,
      error: null
    }))

    const api = getAgentAPI()
    if (!api) {
      set({
        isLoading: false,
        error: { code: 'unknown', message: 'Agent 服务未就绪（window.agent 不可用）' }
      })
      return
    }

    // Task 41.3：在发送前持久化用户消息到 agent_messages 表
    // 异步执行，不阻塞流式响应；失败时仅 console.error，不打断 UI
    void getCurrentSessionId()
      .then((sessionId) => {
        if (!sessionId) return
        return api.session
          .addMessage(sessionId, {
            role: 'user',
            content: trimmed
          })
          .catch((e) => {
            console.error('[agentStore] 持久化用户消息失败：', e)
          })
      })
      .catch(() => {
        // 忽略 dynamic import 失败
      })

    // 每次发送时读取最新 LLM 配置（用户可能刚在设置页改过）
    const config = useSettingsStore.getState().aiConfig
    const request: ChatRequest = {
      message: trimmed,
      context: get().context,
      config
    }

    const onEvent = (event: ChatEvent): void => {
      switch (event.type) {
        case 'delta': {
          // 若最后一条是流式 assistant，则追加文本；否则新建一条
          set((s) => {
            const msgs = s.messages
            const last = msgs[msgs.length - 1]
            if (isStreamingAssistant(last)) {
              const next = msgs.slice()
              next[next.length - 1] = { ...last, content: last.content + event.text }
              return { messages: next }
            }
            const assistantMsg: AgentUIMessage = {
              id: genId(),
              role: 'assistant',
              content: event.text,
              createdAt: Date.now(),
              isStreaming: true
            }
            return { messages: [...msgs, assistantMsg] }
          })
          break
        }
        case 'tool_call_start': {
          // 在当前流式 assistant 消息的 toolCalls 数组中新增一项；若无则新建一条
          set((s) => {
            const msgs = s.messages
            const last = msgs[msgs.length - 1]
            const newToolCall: AgentUIToolCall = {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              status: 'loading'
            }
            if (isStreamingAssistant(last)) {
              const next = msgs.slice()
              next[next.length - 1] = {
                ...last,
                toolCalls: [...(last.toolCalls ?? []), newToolCall]
              }
              return { messages: next }
            }
            const assistantMsg: AgentUIMessage = {
              id: genId(),
              role: 'assistant',
              content: '',
              createdAt: Date.now(),
              isStreaming: true,
              toolCalls: [newToolCall]
            }
            return { messages: [...msgs, assistantMsg] }
          })
          break
        }
        case 'tool_call_result': {
          // 按 toolCallId 定位并更新对应工具调用的状态/结果/错误
          set((s) => {
            const msgs = s.messages
            let targetIndex = -1
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i]
              if (
                m.role === 'assistant' &&
                m.toolCalls?.some((tc) => tc.toolCallId === event.toolCallId)
              ) {
                targetIndex = i
                break
              }
            }
            if (targetIndex === -1) {
              // 未找到对应工具调用：忽略，保持状态不变
              return {}
            }
            const target = msgs[targetIndex]
            const toolCalls = (target.toolCalls ?? []).map((tc) =>
              tc.toolCallId === event.toolCallId
                ? {
                    ...tc,
                    status: event.success ? ('success' as const) : ('error' as const),
                    result: event.result,
                    error: event.error
                  }
                : tc
            )
            const next = msgs.slice()
            next[targetIndex] = { ...target, toolCalls }
            return { messages: next }
          })

          // Task 24: 业务页面双向联动（仅在工具调用成功时触发）
          if (event.success) {
            // SubTask 24.1: draw_topics 成功 → 更新 drawStore + 跳转 DrawPage
            if (event.toolName === 'draw_topics' && event.result) {
              // 动态导入避免循环依赖
              import('./drawStore').then(({ useDrawStore }) => {
                useDrawStore.getState().setLastResult(event.result as any)
              })
              set({ pendingNavigation: '/draw' })
            }
            // SubTask 24.2: create_topic 成功 → 刷新 topicStore
            else if (event.toolName === 'create_topic') {
              import('./topicStore').then(({ useTopicStore }) => {
                void useTopicStore.getState().fetchList()
              })
            }
            // SubTask 24.3: create_event 成功 → 刷新 eventStore + 跳转 EventManage
            else if (event.toolName === 'create_event') {
              import('./eventStore').then(({ useEventStore }) => {
                void useEventStore.getState().listEvents()
              })
              set({ pendingNavigation: '/events' })
            }
            // SubTask 49.1: import_event_batch 成功 → 刷新 eventStore + 跳转 EventManage
            else if (event.toolName === 'import_event_batch') {
              import('./eventStore').then(({ useEventStore }) => {
                void useEventStore.getState().listEvents()
              })
              set({ pendingNavigation: '/events' })
            }
            // SubTask 49.3: optimize_team_groups 成功 → 刷新 eventStore 分组 + 跳转 EventManage
            // eventStore 无独立 refreshGroups 方法，使用 listEvents() + fetchGroups(currentEvent.id) 替代
            else if (event.toolName === 'optimize_team_groups') {
              import('./eventStore').then(({ useEventStore }) => {
                const store = useEventStore.getState()
                void store.listEvents()
                if (store.currentEvent) {
                  void store.fetchGroups(store.currentEvent.id)
                  void store.listTeamsByEvent(store.currentEvent.id)
                }
              })
              set({ pendingNavigation: '/events' })
            }
            // SubTask 49.4: generate_schedule 成功 → 设置 pendingSchedulePreview 触发 Modal
            else if (
              event.toolName === 'generate_schedule' &&
              event.result &&
              Array.isArray((event.result as { rounds?: unknown }).rounds)
            ) {
              set({
                pendingSchedulePreview: (event.result as { rounds: ScheduleRound[] }).rounds
              })
            }
          }
          break
        }
        case 'tool_call_confirm': {
          // Task 41.5：高风险工具执行前主进程推送确认事件
          // 设置 pendingConfirm 状态驱动 ToolConfirmModal 显隐（Task 43 实现）
          set({ pendingConfirm: event })
          break
        }
        case 'done': {
          // 将最后一条流式 assistant 置为完成，并解除 loading
          const lastMsg = get().messages[get().messages.length - 1]
          set((s) => {
            const msgs = s.messages
            const last = msgs[msgs.length - 1]
            if (isStreamingAssistant(last)) {
              const next = msgs.slice()
              next[next.length - 1] = { ...last, isStreaming: false }
              return { messages: next, isLoading: false }
            }
            return { isLoading: false }
          })
          // 修复：调用取消函数移除 IPC handler（避免下次对话 handler 残留导致 delta 重复）
          if (currentCancelFn) {
            try {
              currentCancelFn()
            } catch {
              // 忽略取消异常
            }
            currentCancelFn = null
          }

          // Task 41.3：在收到 done 事件后，持久化 assistant 的最后一条消息，
          // 并更新 agent_sessions.lastMessageText。
          // 异步执行，不阻塞 UI；失败时仅 console.error
          if (lastMsg && lastMsg.role === 'assistant') {
            const sessionIdPromise = getCurrentSessionId()
            void sessionIdPromise
              .then((sessionId) => {
                if (!sessionId) return
                const contentToSave = lastMsg.content || ''
                // 1. 持久化 assistant 消息到 agent_messages 表
                return api.session
                  .addMessage(sessionId, {
                    role: 'assistant',
                    content: contentToSave
                  })
                  .then(() => {
                    // 2. 更新会话最近消息预览（截断到 100 字，避免列表过长）
                    const preview =
                      contentToSave.length > 100
                        ? contentToSave.slice(0, 100) + '...'
                        : contentToSave
                    return api.session.updateLastMessage(sessionId, preview)
                  })
                  .catch((e) => {
                    console.error('[agentStore] 持久化 assistant 消息失败：', e)
                  })
              })
              .catch(() => {
                // 忽略 dynamic import 失败
              })
          }
          break
        }
        case 'error': {
          // 设置错误状态、解除 loading、并把最后一条流式 assistant 置为完成
          set((s) => {
            const msgs = s.messages
            const last = msgs[msgs.length - 1]
            const error: AgentError = { code: event.code, message: event.message }
            if (isStreamingAssistant(last)) {
              const next = msgs.slice()
              next[next.length - 1] = { ...last, isStreaming: false }
              return { messages: next, isLoading: false, error }
            }
            return { isLoading: false, error }
          })
          // 修复：调用取消函数移除 IPC handler（与 done 事件一致，避免 handler 残留）
          if (currentCancelFn) {
            try {
              currentCancelFn()
            } catch {
              // 忽略取消异常
            }
            currentCancelFn = null
          }
          break
        }
        default: {
          // 兜底：未知事件类型忽略
          break
        }
      }
    }

    currentCancelFn = api.chat(request, onEvent)
  },

  cancel() {
    // 1. 调用 chat 返回的取消函数（移除 IPC 事件监听 + 发送 agent:cancel 信号）
    if (currentCancelFn) {
      try {
        currentCancelFn()
      } catch {
        // 忽略取消异常
      }
      currentCancelFn = null
    }
    // 2. 调用 window.agent.cancel()（IPC invoke，主进程侧终止 agent-loop）
    const api = getAgentAPI()
    if (api) {
      void api.cancel().catch(() => {
        // 忽略取消异常
      })
    }
    // 3. 解除 loading、把最后一条流式 assistant 置为完成
    set((s) => {
      const msgs = s.messages
      const last = msgs[msgs.length - 1]
      if (isStreamingAssistant(last)) {
        const next = msgs.slice()
        next[next.length - 1] = { ...last, isStreaming: false }
        return { messages: next, isLoading: false }
      }
      return { isLoading: false }
    })
  },

  setContext(partial) {
    // Task 41.1/41.2：contextLocked=true 时仅追加不存在的字段
    // 与 Task 33 中 contextManager.lock 的语义一致
    if (get().contextLocked) {
      set((s) => {
        const merged: AgentContext = { ...s.context }
        // 仅填充当前为空/undefined 的字段
        for (const key of Object.keys(partial) as Array<keyof AgentContext>) {
          const current = s.context[key]
          if (current === undefined || current === null) {
            // 类型断言：key 与 Partial<AgentContext> 的字段一一对应
            ;(merged as Record<string, unknown>)[key as string] = partial[key]
          }
        }
        return { context: merged }
      })
    } else {
      set((s) => ({ context: { ...s.context, ...partial } }))
    }
  },

  clearContext() {
    // Task 41.2：清空上下文并解锁
    set({
      context: { currentTopic: null, currentEvent: null, currentPage: undefined },
      contextLocked: false
    })
  },

  lockContext() {
    // Task 41.2：锁定上下文
    set({ contextLocked: true })
  },

  unlockContext() {
    // Task 41.2：解锁上下文
    set({ contextLocked: false })
  },

  clearMessages() {
    set({ messages: [] })
  },

  setMessages(messages) {
    set({ messages })
  },

  clearError() {
    set({ error: null })
  },

  clearPendingNavigation() {
    set({ pendingNavigation: null })
  },

  setPendingNavigation(path) {
    // Task 49.2：外部设置待跳转路由（ToolConfirmCard「应用此赛制」按钮等场景）
    set({ pendingNavigation: path })
  },

  handleConfirmResult(toolCallId, confirmed, modifiedArgs) {
    // Task 41.4：调用 window.agent.confirmResult 回传主进程
    const api = getAgentAPI()
    if (!api) {
      // API 不可用时也要清空 pendingConfirm，避免 Modal 卡死
      set({ pendingConfirm: null })
      return
    }
    const result: ToolConfirmResult = modifiedArgs
      ? { toolCallId, confirmed, modifiedArgs }
      : { toolCallId, confirmed }
    void api
      .confirmResult(result)
      .catch((e) => {
        console.error('[agentStore] 回传确认结果失败：', e)
      })
      .finally(() => {
        // 无论成功失败都清空 pendingConfirm，关闭 Modal
        set({ pendingConfirm: null })
      })
  },

  clearPendingConfirm() {
    set({ pendingConfirm: null })
  },

  clearPendingSchedulePreview() {
    // Task 49.4：清空待预览赛程，关闭 SchedulePreviewModal
    set({ pendingSchedulePreview: null })
  }
}))
