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
import type { StoreApi } from 'zustand'
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
  /** 最近一次用户发送的文本（P0-3 错误重试用；未发送过为 null） */
  lastUserText: string | null
  /** 重试最近一次用户消息（P0-3：错误后一键重发） */
  retryLast: () => void
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
 * 返回 null 表示无活动会话（sendMessage 会自动创建，见下）。
 */
async function getCurrentSessionId(): Promise<string | null> {
  const { useAgentSessionStore } = await import('./agentSessionStore')
  return useAgentSessionStore.getState().currentSessionId
}

/**
 * 从用户消息推导会话标题：折叠空白（含换行）、去首尾空格、截前 12 字。
 * 纯函数，便于单测。空文本时原样返回（调用方保证入参非空）。
 */
export function deriveSessionTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (!collapsed) return text
  return collapsed.slice(0, 12)
}

/**
 * 若会话标题仍为默认「新会话」，则用首条用户消息自动命名（前 12 字）。
 * fire-and-forget：失败仅 console.error，不阻塞发送链路。
 * 手动创建（标题为新会话）与自动创建的会话一视同仁，体验统一；手动改名过的不会被覆盖。
 */
async function ensureSessionTitle(sessionId: string, text: string): Promise<void> {
  try {
    const { useAgentSessionStore } = await import('./agentSessionStore')
    const st = useAgentSessionStore.getState()
    const session = st.sessions.find((s) => s.id === sessionId)
    if (!session || session.title !== '新会话') return
    const title = deriveSessionTitle(text)
    if (title) {
      await st.renameSession(sessionId, title)
    }
  } catch (e) {
    console.error('[agentStore] 自动命名会话失败：', e)
  }
}

/** 模块级变量：保存当前对话的取消函数（由 window.agent.chat 返回） */
let currentCancelFn: (() => void) | null = null

// ============================================================
// 流式增量渲染（P0-5）：delta 文本缓冲 + 30ms 节流合并 setState
//
// 原实现每收到一个 delta 就全量 slice+concat 重建消息数组，长回复时
// 每次 token 触发一次 React 重渲染导致卡顿。改为累积到 deltaBuf，
// 30ms 节流 flush 一次，显著减少 setState 次数。
// ============================================================

/** 累积的 delta 文本（节流窗口内暂存） */
let deltaBuf = ''
/** 节流定时器（30ms） */
let deltaTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 将累积的 delta 文本一次性合并进消息列表（创建/追加流式 assistant 消息）。
 * done / error / cancel 时也会调用以清空残余缓冲。
 */
function flushDelta(set: StoreApi<AgentState>['setState']): void {
  if (deltaTimer) {
    clearTimeout(deltaTimer)
    deltaTimer = null
  }
  if (!deltaBuf) return
  const text = deltaBuf
  deltaBuf = ''
  set((s) => {
    const msgs = s.messages
    const last = msgs[msgs.length - 1]
    if (isStreamingAssistant(last)) {
      const next = msgs.slice()
      next[next.length - 1] = { ...last, content: last.content + text }
      return { messages: next }
    }
    const assistantMsg: AgentUIMessage = {
      id: genId(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
      isStreaming: true
    }
    return { messages: [...msgs, assistantMsg] }
  })
}

/** 累积一条 delta 文本并安排 30ms 节流 flush */
function enqueueDelta(set: StoreApi<AgentState>['setState'], text: string): void {
  deltaBuf += text
  if (!deltaTimer) {
    deltaTimer = setTimeout(() => flushDelta(set), 30)
  }
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  isLoading: false,
  currentSession: { id: 'default' },
  context: { currentTopic: null, currentEvent: null, currentPage: undefined },
  contextLocked: false,
  error: null,
  lastUserText: null,
  pendingNavigation: null,
  pendingConfirm: null,
  pendingSchedulePreview: null,

  sendMessage(text) {
    const trimmed = text?.trim?.() ?? ''
    if (!trimmed) return

    // P0-5：发送前清空可能残留的 delta 缓冲（防上次对话未 flush 的内容混入）
    flushDelta(set)

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
      error: null,
      lastUserText: trimmed
    }))

    const api = getAgentAPI()
    if (!api) {
      set({
        isLoading: false,
        error: { code: 'unknown', message: 'Agent 服务未就绪（window.agent 不可用）' }
      })
      return
    }

    // 每次发送时读取最新 LLM 配置（用户可能刚在设置页改过）
    // 注意：消息持久化（P0-1 起）已移交主进程 agent-loop 统一按 sessionId 落库，
    // 渲染层不再自行调用 api.session.addMessage / updateLastMessage（避免双写）。
    const config = useSettingsStore.getState().aiConfig
    const currentContext = get().context

    const onEvent = (event: ChatEvent): void => {
      switch (event.type) {
        case 'delta': {
          // P0-5：累积到缓冲，30ms 节流合并，避免每 token 全量重建消息数组
          enqueueDelta(set, event.text)
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
          // P0-5：先把残余 delta 缓冲写入消息，再置为完成
          flushDelta(set)
          // 将最后一条流式 assistant 置为完成，并解除 loading
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
          // 注：assistant 消息持久化已移交主进程（P0-1 起由 agent-loop 统一落库 +
          // 更新 lastMessageText），渲染层不再自行持久化，避免与主进程双写。
          break
        }
        case 'error': {
          // P0-5：先把残余 delta 缓冲写入消息，再设置错误状态
          flushDelta(set)
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

    // 发起对话（P0-1 + 自动建会话修复）：
    // 1. 从 agentSessionStore 读取当前 sessionId（dynamic import 解耦循环依赖）
    // 2. 无活动会话时自动创建一个（resetChat:false 保留刚输入的消息与 loading 状态），
    //    保证「首次打开直接对话」也有会话可持久化，重启后记忆不丢
    // 3. 主进程 agent-loop 按 sessionId 恢复历史并落库；创建失败时兜底无 sessionId 发送（不落库）
    const send = async (): Promise<void> => {
      let sessionId: string | null = null
      try {
        sessionId = await getCurrentSessionId()
        if (!sessionId) {
          const { useAgentSessionStore } = await import('./agentSessionStore')
          const created = await useAgentSessionStore
            .getState()
            .createSession('新会话', { resetChat: false })
          sessionId = created?.id ?? null
        }
      } catch (e) {
        // createSession / dynamic import 失败：兜底无 sessionId 发送（不阻塞、不落库）
        console.error('[agentStore] 自动创建会话失败，将以无会话模式发送：', e)
        sessionId = null
      }

      // 标题仍为「新会话」时，用首条消息自动命名（fire-and-forget，失败不阻塞）
      if (sessionId) {
        void ensureSessionTitle(sessionId, trimmed)
      }

      const request: ChatRequest = {
        message: trimmed,
        context: currentContext,
        sessionId: sessionId ?? undefined,
        config
      }
      currentCancelFn = api.chat(request, onEvent)
    }
    void send()
  },

  cancel() {
    // P0-5：先把残余 delta 缓冲写入消息（取消时保留已输出的内容）
    flushDelta(set)
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

  retryLast() {
    // P0-3：错误后一键重发最近一次用户消息（复用 sendMessage，内部处理 cancel/loading 复位）
    const last = get().lastUserText
    if (!last) return
    get().sendMessage(last)
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
