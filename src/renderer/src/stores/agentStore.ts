// ============================================================
// agentStore.ts — Agent UI 状态管理（AI Agent v1.3.0 Week 4 Task 18 / Week 7 Task 41）
//
// 2026-08-18 重大改造：**按会话分桶**（支持切换会话不中断回复、多会话并发）。
// - messages → messagesBySession: Record<sessionId, AgentUIMessage[]>
// - isLoading → loadingBySession: Record<sessionId, boolean>
// - 流式 delta 缓冲 / 取消函数 全部按 sessionId 分桶
// - 流式事件带 sessionId：只更新对应会话的桶，切走会话的后台回复不打断
//
// 职责：
// 1. 维护 Agent 对话消息列表（user / assistant，工具调用挂在 assistant 上）
// 2. 驱动流式 UI：delta 追加文本、tool_call_start/result 更新工具调用状态
// 3. 管理业务上下文（currentTopic / currentEvent / currentPage）与上下文锁定
// 4. 工具人工确认状态（pendingConfirm 驱动 ToolConfirmModal 显隐）
// 5. 多会话集成：消息持久化由主进程 agent-loop 按 sessionId 落库
// 6. 错误状态与 loading 状态
//
// 设计要点：
// - 无 sessionId 的操作落在 '__default__' 桶（兼容无会话场景/测试）
// - UI 组件读取 messagesBySession[activeSessionId] / loadingBySession[activeSessionId]
// - assistant 消息以 isStreaming=true 标记流式态，done/error 时置 false
// - 工具调用挂在"该会话当前流式 assistant 消息"的 toolCalls 数组上
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
  /** 按会话分桶的 UI 消息列表（2026-08-18 起，取代单一 messages） */
  messagesBySession: Record<string, AgentUIMessage[]>
  /** 按会话分桶的 loading 状态 */
  loadingBySession: Record<string, boolean>
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
  /** 待预览的赛程数据（Task 49.4） */
  pendingSchedulePreview: ScheduleRound[] | null

  /** 发送用户消息并启动流式对话（写入当前活动会话的桶） */
  sendMessage(text: string): void
  /**
   * 取消指定会话进行中的对话（2026-08-18：按会话维度）。
   * @param sessionId 目标会话；缺省时取消当前活动会话
   */
  cancel(sessionId?: string): void
  /** 合并更新业务上下文（contextLocked=true 时仅追加不存在的字段） */
  setContext(partial: Partial<AgentContext>): void
  /** 清空业务上下文（currentTopic/currentEvent 置 null）并解锁 */
  clearContext(): void
  /** 锁定上下文（Task 41.2）：setContext 仅追加字段 */
  lockContext(): void
  /** 解锁上下文（Task 41.2）：setContext 恢复覆盖合并语义 */
  unlockContext(): void
  /** 清空指定会话的消息桶（缺省时清空全部桶） */
  clearMessages(sessionId?: string): void
  /** 直接覆盖指定会话的消息桶（agentSessionStore.loadSessionMessages 调用） */
  setMessages(sessionId: string, messages: AgentUIMessage[]): void
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
 * 同步获取当前活动会话 id（在流式事件回调内使用，不能 await）。
 * 模块加载后 agentSessionStore 的 getState 同步可用；失败返回 null。
 */
function getActiveSessionIdSync(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAgentSessionStore } = require('./agentSessionStore') as {
      useAgentSessionStore: { getState: () => { currentSessionId: string | null } }
    }
    return useAgentSessionStore.getState().currentSessionId
  } catch {
    return null
  }
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

/** 无 sessionId 时的默认桶 key */
const DEFAULT_SESSION_KEY = '__default__'

/** 每会话的取消函数（由 window.agent.chat 返回） */
const cancelFns = new Map<string, () => void>()

// ============================================================
// 流式增量渲染（P0-5）：delta 文本缓冲 + 30ms 节流合并 setState
// 2026-08-18：缓冲按 sessionId 分桶（多会话并发各自独立）
// ============================================================

/** 每会话累积的 delta 文本（节流窗口内暂存） */
const deltaBufs = new Map<string, string>()
/** 每会话节流定时器（30ms） */
const deltaTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * 将指定会话累积的 delta 文本一次性合并进该会话消息桶。
 * done / error / cancel 时也会调用以清空残余缓冲。
 */
function flushDelta(set: StoreApi<AgentState>['setState'], sessionId: string): void {
  const timer = deltaTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    deltaTimers.delete(sessionId)
  }
  const buf = deltaBufs.get(sessionId)
  if (!buf) return
  deltaBufs.delete(sessionId)
  set((s) => {
    const msgs = s.messagesBySession[sessionId] ?? []
    const last = msgs[msgs.length - 1]
    if (isStreamingAssistant(last)) {
      const next = msgs.slice()
      next[next.length - 1] = { ...last, content: last.content + buf }
      return { messagesBySession: { ...s.messagesBySession, [sessionId]: next } }
    }
    const assistantMsg: AgentUIMessage = {
      id: genId(),
      role: 'assistant',
      content: buf,
      createdAt: Date.now(),
      isStreaming: true
    }
    return { messagesBySession: { ...s.messagesBySession, [sessionId]: [...msgs, assistantMsg] } }
  })
}

/** 累积一条 delta 文本到指定会话桶并安排 30ms 节流 flush */
function enqueueDelta(set: StoreApi<AgentState>['setState'], sessionId: string, text: string): void {
  const prev = deltaBufs.get(sessionId) ?? ''
  deltaBufs.set(sessionId, prev + text)
  if (!deltaTimers.has(sessionId)) {
    const timer = setTimeout(() => flushDelta(set, sessionId), 30)
    deltaTimers.set(sessionId, timer)
  }
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messagesBySession: {},
  loadingBySession: {},
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

    // 异步确定目标会话（无活动会话时自动创建），再写桶并发起对话
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
      const sid = sessionId ?? DEFAULT_SESSION_KEY

      // 标题仍为「新会话」时，用首条消息自动命名（fire-and-forget，失败不阻塞）
      if (sessionId) {
        void ensureSessionTitle(sessionId, trimmed)
      }

      // P0-5：发送前清空该会话可能残留的 delta 缓冲（防上次对话未 flush 的内容混入）
      flushDelta(set, sid)

      // 清理该会话上一次的取消函数（移除 IPC handler，防残留导致 delta 双写）
      const prevCancelFn = cancelFns.get(sid)
      if (prevCancelFn) {
        try {
          prevCancelFn()
        } catch {
          // 忽略取消异常
        }
        cancelFns.delete(sid)
      }

      const userMsg: AgentUIMessage = {
        id: genId(),
        role: 'user',
        content: trimmed,
        createdAt: Date.now()
      }

      set((s) => ({
        messagesBySession: {
          ...s.messagesBySession,
          [sid]: [...(s.messagesBySession[sid] ?? []), userMsg]
        },
        loadingBySession: { ...s.loadingBySession, [sid]: true },
        error: null,
        lastUserText: trimmed
      }))

      const api = getAgentAPI()
      if (!api) {
        set({
          loadingBySession: { ...get().loadingBySession, [sid]: false },
          error: { code: 'unknown', message: 'Agent 服务未就绪（window.agent 不可用）' }
        })
        return
      }

      // 每次发送时读取最新 LLM 配置（用户可能刚在设置页改过）
      const config = useSettingsStore.getState().aiConfig
      const currentContext = get().context

      // 流式事件回调：事件带 sessionId（主进程注入）；空时回退到本会话 id
      const onEvent = (event: ChatEvent): void => {
        const eventSid = event.sessionId || sid
        const bucket = (s2: AgentState): AgentUIMessage[] =>
          s2.messagesBySession[eventSid] ?? []

        switch (event.type) {
          case 'delta': {
            enqueueDelta(set, eventSid, event.text)
            break
          }
          case 'tool_call_start': {
            set((s) => {
              const msgs = bucket(s)
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
                return { messagesBySession: { ...s.messagesBySession, [eventSid]: next } }
              }
              const assistantMsg: AgentUIMessage = {
                id: genId(),
                role: 'assistant',
                content: '',
                createdAt: Date.now(),
                isStreaming: true,
                toolCalls: [newToolCall]
              }
              return {
                messagesBySession: { ...s.messagesBySession, [eventSid]: [...msgs, assistantMsg] }
              }
            })
            break
          }
          case 'tool_call_result': {
            set((s) => {
              const msgs = bucket(s)
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
              return { messagesBySession: { ...s.messagesBySession, [eventSid]: next } }
            })

            // Task 24: 业务页面双向联动（仅在工具调用成功时触发）
            if (event.success) {
              if (event.toolName === 'draw_topics' && event.result) {
                import('./drawStore').then(({ useDrawStore }) => {
                  useDrawStore.getState().setLastResult(event.result as never)
                })
                set({ pendingNavigation: '/draw' })
              } else if (event.toolName === 'create_topic') {
                import('./topicStore').then(({ useTopicStore }) => {
                  void useTopicStore.getState().fetchList()
                })
              } else if (event.toolName === 'create_event') {
                import('./eventStore').then(({ useEventStore }) => {
                  void useEventStore.getState().listEvents()
                })
                set({ pendingNavigation: '/events' })
              } else if (event.toolName === 'import_event_batch') {
                import('./eventStore').then(({ useEventStore }) => {
                  void useEventStore.getState().listEvents()
                })
                set({ pendingNavigation: '/events' })
              } else if (event.toolName === 'optimize_team_groups') {
                import('./eventStore').then(({ useEventStore }) => {
                  const store = useEventStore.getState()
                  void store.listEvents()
                  if (store.currentEvent) {
                    void store.fetchGroups(store.currentEvent.id)
                    void store.listTeamsByEvent(store.currentEvent.id)
                  }
                })
                set({ pendingNavigation: '/events' })
              } else if (
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
            set({ pendingConfirm: event })
            break
          }
          case 'done': {
            flushDelta(set, eventSid)
            set((s) => {
              const msgs = bucket(s)
              const last = msgs[msgs.length - 1]
              if (isStreamingAssistant(last)) {
                const next = msgs.slice()
                next[next.length - 1] = { ...last, isStreaming: false }
                return {
                  messagesBySession: { ...s.messagesBySession, [eventSid]: next },
                  loadingBySession: { ...s.loadingBySession, [eventSid]: false }
                }
              }
              return { loadingBySession: { ...s.loadingBySession, [eventSid]: false } }
            })
            // 清理该会话的 IPC handler（避免 handler 残留导致 delta 双写）
            const doneCancelFn = cancelFns.get(eventSid)
            if (doneCancelFn) {
              try {
                doneCancelFn()
              } catch {
                // 忽略取消异常
              }
              cancelFns.delete(eventSid)
            }
            break
          }
          case 'error': {
            flushDelta(set, eventSid)
            set((s) => {
              const msgs = bucket(s)
              const last = msgs[msgs.length - 1]
              const error: AgentError = { code: event.code, message: event.message }
              if (isStreamingAssistant(last)) {
                const next = msgs.slice()
                next[next.length - 1] = { ...last, isStreaming: false }
                return {
                  messagesBySession: { ...s.messagesBySession, [eventSid]: next },
                  loadingBySession: { ...s.loadingBySession, [eventSid]: false },
                  error
                }
              }
              return {
                loadingBySession: { ...s.loadingBySession, [eventSid]: false },
                error
              }
            })
            const errCancelFn = cancelFns.get(eventSid)
            if (errCancelFn) {
              try {
                errCancelFn()
              } catch {
                // 忽略取消异常
              }
              cancelFns.delete(eventSid)
            }
            break
          }
          default: {
            break
          }
        }
      }

      const request: ChatRequest = {
        message: trimmed,
        context: currentContext,
        sessionId: sessionId ?? undefined,
        config
      }
      cancelFns.set(sid, api.chat(request, onEvent))
    }
    void send()
  },

  cancel(sessionId) {
    // 确定目标会话：显式传入 > 当前活动会话 > 全部（兼容）
    let targetIds: string[] = []
    if (sessionId) {
      targetIds = [sessionId]
    } else {
      const active = getActiveSessionIdSync()
      if (active) {
        targetIds = [active]
      } else {
        targetIds = [...cancelFns.keys()]
      }
    }

    for (const sid of targetIds) {
      // P0-5：先把残余 delta 缓冲写入消息（取消时保留已输出的内容）
      flushDelta(set, sid)
      // 1. 调用 chat 返回的取消函数（移除 IPC 事件监听 + 发送 agent:cancel 信号）
      const cancelFn = cancelFns.get(sid)
      if (cancelFn) {
        try {
          cancelFn()
        } catch {
          // 忽略取消异常
        }
        cancelFns.delete(sid)
      }
      // 2. 调用 window.agent.cancel()（IPC invoke，主进程侧终止该会话 agent-loop）
      const api = getAgentAPI()
      if (api) {
        void api.cancel(sid).catch(() => {
          // 忽略取消异常
        })
      }
      // 3. 解除该会话 loading、把最后一条流式 assistant 置为完成
      set((s) => {
        const msgs = s.messagesBySession[sid] ?? []
        const last = msgs[msgs.length - 1]
        if (isStreamingAssistant(last)) {
          const next = msgs.slice()
          next[next.length - 1] = { ...last, isStreaming: false }
          return {
            messagesBySession: { ...s.messagesBySession, [sid]: next },
            loadingBySession: { ...s.loadingBySession, [sid]: false }
          }
        }
        return { loadingBySession: { ...s.loadingBySession, [sid]: false } }
      })
    }
  },

  setContext(partial) {
    // Task 41.1/41.2：contextLocked=true 时仅追加不存在的字段
    if (get().contextLocked) {
      set((s) => {
        const merged: AgentContext = { ...s.context }
        for (const key of Object.keys(partial) as Array<keyof AgentContext>) {
          const current = s.context[key]
          if (current === undefined || current === null) {
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
    set({
      context: { currentTopic: null, currentEvent: null, currentPage: undefined },
      contextLocked: false
    })
  },

  lockContext() {
    set({ contextLocked: true })
  },

  unlockContext() {
    set({ contextLocked: false })
  },

  clearMessages(sessionId) {
    if (sessionId) {
      set((s) => {
        const next = { ...s.messagesBySession }
        delete next[sessionId]
        return { messagesBySession: next }
      })
    } else {
      set({ messagesBySession: {} })
    }
  },

  setMessages(sessionId, messages) {
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: messages }
    }))
  },

  clearError() {
    set({ error: null })
  },

  retryLast() {
    const last = get().lastUserText
    if (!last) return
    get().sendMessage(last)
  },

  clearPendingNavigation() {
    set({ pendingNavigation: null })
  },

  setPendingNavigation(path) {
    set({ pendingNavigation: path })
  },

  handleConfirmResult(toolCallId, confirmed, modifiedArgs) {
    const api = getAgentAPI()
    if (!api) {
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
        set({ pendingConfirm: null })
      })
  },

  clearPendingConfirm() {
    set({ pendingConfirm: null })
  },

  clearPendingSchedulePreview() {
    set({ pendingSchedulePreview: null })
  }
}))
