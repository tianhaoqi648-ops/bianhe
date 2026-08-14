// ============================================================
// agentSessionStore.test.ts — Agent 多会话 store 单元测试
//
// 覆盖（2026-08-14 自动建会话修复）：
// 1. loadSessions 空列表 → 自动预建一个会话（启动预建）
// 2. loadSessions 非空列表 → 不预建，自动选中第一个
// 3. createSession 默认 resetChat=true → 清空 agentStore 消息/上下文 + 取消流式
// 4. createSession({ resetChat: false }) → 跳过上述重置（发送时自动建场景）
// 5. createSession IPC 失败 → 返回 null，不切换当前会话
// 6. deriveSessionTitle 纯函数（换行折叠 / 12 字截断 / 空文本）
//
// mock 方式：参照 settingsStore.test —— 在 import 后顶层注入 (globalThis as any).window.agent
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAgentSessionStore } from '../agentSessionStore'
import { useAgentStore, deriveSessionTitle } from '../agentStore'
import type { AgentSession, AgentAPI } from '../../../../shared/agent-types'

// ---------- window.agent mock ----------
const mockList = vi.fn()
const mockCreate = vi.fn()
const mockRename = vi.fn()
const mockDelete = vi.fn()
const mockClearAll = vi.fn()
const mockLoad = vi.fn()
const mockSearch = vi.fn()
const mockAddMessage = vi.fn()
const mockUpdateLastMessage = vi.fn()
const mockChat = vi.fn()
const mockCancel = vi.fn()
const mockConfirmResult = vi.fn()
const mockTestConnection = vi.fn()

;(globalThis as any).window = {
  agent: {
    chat: mockChat,
    testConnection: mockTestConnection,
    cancel: mockCancel,
    confirmResult: mockConfirmResult,
    exportSession: vi.fn(),
    session: {
      list: mockList,
      create: mockCreate,
      rename: mockRename,
      delete: mockDelete,
      clearAll: mockClearAll,
      load: mockLoad,
      search: mockSearch,
      addMessage: mockAddMessage,
      updateLastMessage: mockUpdateLastMessage
    },
    config: {
      getConfirmRules: vi.fn(),
      setConfirmRules: vi.fn()
    }
  } satisfies AgentAPI
}

// ---------- fixtures ----------
function makeSession(id: string, title = '新会话'): AgentSession {
  return {
    id,
    title,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    lastMessageText: '',
    lastMessageAt: '2026-08-14T00:00:00.000Z'
  }
}

const SESSION_A = makeSession('sess-a')
const SESSION_B = makeSession('sess-b', '旧会话')

describe('agentSessionStore 自动建会话（loadSessions 启动预建）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockList.mockReset()
    mockCreate.mockReset()
    useAgentSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      searchKeyword: '',
      searchResults: [],
      loading: false,
      error: null
    })
    useAgentStore.setState({
      messages: [],
      isLoading: false,
      context: { currentTopic: null, currentEvent: null, currentPage: undefined },
      contextLocked: false,
      error: null,
      lastUserText: null,
      pendingNavigation: null,
      pendingConfirm: null,
      pendingSchedulePreview: null
    })
  })

  it('列表为空时自动预建一个会话并切换为当前会话', async () => {
    mockList.mockResolvedValue({ success: true, data: [] })
    mockCreate.mockResolvedValue({ success: true, data: SESSION_A })

    await useAgentSessionStore.getState().loadSessions()

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith('新会话')
    const st = useAgentSessionStore.getState()
    expect(st.currentSessionId).toBe('sess-a')
    expect(st.sessions).toHaveLength(1)
    expect(st.sessions[0].id).toBe('sess-a')
  })

  it('列表非空时不预建，自动选中第一个', async () => {
    mockList.mockResolvedValue({ success: true, data: [SESSION_A, SESSION_B] })
    mockCreate.mockResolvedValue({ success: true, data: SESSION_A })

    await useAgentSessionStore.getState().loadSessions()

    expect(mockCreate).not.toHaveBeenCalled()
    const st = useAgentSessionStore.getState()
    expect(st.currentSessionId).toBe('sess-a')
    expect(st.sessions).toHaveLength(2)
  })

  it('已有活动会话时不重复预建（重复 loadSessions 幂等）', async () => {
    mockList.mockResolvedValue({ success: true, data: [] })
    mockCreate.mockResolvedValue({ success: true, data: SESSION_A })

    // 第一次：预建
    await useAgentSessionStore.getState().loadSessions()
    expect(mockCreate).toHaveBeenCalledTimes(1)

    // 第二次：列表仍空，但已有 currentSessionId → 不再创建
    await useAgentSessionStore.getState().loadSessions()
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('预建失败（create IPC 返回失败）时不抛错，保持无会话状态', async () => {
    mockList.mockResolvedValue({ success: true, data: [] })
    mockCreate.mockResolvedValue({ success: false, error: 'DB 异常' })

    await useAgentSessionStore.getState().loadSessions()

    const st = useAgentSessionStore.getState()
    expect(st.currentSessionId).toBeNull()
    expect(st.sessions).toHaveLength(0)
    expect(st.error).toBe('DB 异常')
  })
})

describe('agentSessionStore createSession resetChat 选项', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockCreate.mockReset()
    // 默认让 mockCancel 返回已 resolve 的 Promise，避免真实调用 cancel() 时 .catch 报错
    mockCancel.mockResolvedValue(undefined)
    useAgentSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      searchKeyword: '',
      searchResults: [],
      loading: false,
      error: null
    })
    useAgentStore.setState({
      messages: [],
      isLoading: false,
      context: { currentTopic: null, currentEvent: null, currentPage: undefined },
      contextLocked: false,
      error: null,
      lastUserText: null,
      pendingNavigation: null,
      pendingConfirm: null,
      pendingSchedulePreview: null
    })
  })

  it('默认 resetChat=true：取消流式并清空消息/上下文', async () => {
    const cancelSpy = vi.spyOn(useAgentStore.getState(), 'cancel').mockImplementation(() => {})
    const clearMessagesSpy = vi
      .spyOn(useAgentStore.getState(), 'clearMessages')
      .mockImplementation(() => {})
    const clearContextSpy = vi
      .spyOn(useAgentStore.getState(), 'clearContext')
      .mockImplementation(() => {})
    mockCreate.mockResolvedValue({ success: true, data: SESSION_A })

    const created = await useAgentSessionStore.getState().createSession()

    expect(created?.id).toBe('sess-a')
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(clearMessagesSpy).toHaveBeenCalledTimes(1)
    expect(clearContextSpy).toHaveBeenCalledTimes(1)
  })

  it('resetChat=false：跳过取消与清空（发送时自动建场景，保留消息与 loading）', async () => {
    const cancelSpy = vi.spyOn(useAgentStore.getState(), 'cancel').mockImplementation(() => {})
    const clearMessagesSpy = vi
      .spyOn(useAgentStore.getState(), 'clearMessages')
      .mockImplementation(() => {})
    const clearContextSpy = vi
      .spyOn(useAgentStore.getState(), 'clearContext')
      .mockImplementation(() => {})
    mockCreate.mockResolvedValue({ success: true, data: SESSION_A })

    const created = await useAgentSessionStore
      .getState()
      .createSession('新会话', { resetChat: false })

    expect(created?.id).toBe('sess-a')
    expect(cancelSpy).not.toHaveBeenCalled()
    expect(clearMessagesSpy).not.toHaveBeenCalled()
    expect(clearContextSpy).not.toHaveBeenCalled()
    // 会话仍切换到新会话
    expect(useAgentSessionStore.getState().currentSessionId).toBe('sess-a')
  })

  it('createSession 失败返回 null，不切换当前会话', async () => {
    useAgentSessionStore.setState({ currentSessionId: 'sess-b', sessions: [SESSION_B] })
    mockCreate.mockResolvedValue({ success: false, error: '创建失败' })

    const created = await useAgentSessionStore.getState().createSession()

    expect(created).toBeNull()
    const st = useAgentSessionStore.getState()
    expect(st.currentSessionId).toBe('sess-b')
    expect(st.error).toBe('创建失败')
  })
})

describe('deriveSessionTitle 纯函数', () => {
  it('截取前 12 字', () => {
    expect(deriveSessionTitle('帮我搜 8 道科技类辩题用于明天的比赛')).toBe('帮我搜 8 道科技类辩题')
  })

  it('折叠换行与连续空白', () => {
    expect(deriveSessionTitle('第一行\n第二行   第三行')).toBe('第一行 第二行 第三行')
  })

  it('短文本原样返回（去首尾空白）', () => {
    expect(deriveSessionTitle('  你好  ')).toBe('你好')
  })

  it('空文本原样返回', () => {
    expect(deriveSessionTitle('')).toBe('')
  })
})
