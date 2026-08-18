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
      messagesBySession: {},
      loadingBySession: {},
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
      messagesBySession: {},
      loadingBySession: {},
      context: { currentTopic: null, currentEvent: null, currentPage: undefined },
      contextLocked: false,
      error: null,
      lastUserText: null,
      pendingNavigation: null,
      pendingConfirm: null,
      pendingSchedulePreview: null
    })
  })

  it('默认 resetChat=true：取消流式并清空上下文（消息按会话分桶，不再清消息）', async () => {
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
    // 2026-08-18：消息改为 messagesBySession 分桶，新会话桶天然为空，
    // 旧会话桶保留（切回仍可见），createSession 不再调用 clearMessages。
    expect(clearMessagesSpy).not.toHaveBeenCalled()
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

describe('loadSessionMessages 历史工具调用恢复（F5 修复）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockLoad.mockReset()
    useAgentSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      searchKeyword: '',
      searchResults: [],
      loading: false,
      error: null
    })
    useAgentStore.setState({
      messagesBySession: {},
      loadingBySession: {},
      context: { currentTopic: null, currentEvent: null, currentPage: undefined },
      contextLocked: false,
      error: null,
      lastUserText: null,
      pendingNavigation: null,
      pendingConfirm: null,
      pendingSchedulePreview: null
    })
  })

  it('多轮工具迭代合并为一条助手消息（文字拼接 + 卡片按序）', async () => {
    mockLoad.mockResolvedValue({
      success: true,
      data: {
        session: SESSION_A,
        messages: [
          {
            id: 'm1',
            sessionId: 'sess-a',
            role: 'user',
            content: '抽取 8 道科技类辩题',
            createdAt: '2026-08-14T00:00:01.000Z'
          },
          {
            id: 'm2',
            sessionId: 'sess-a',
            role: 'assistant',
            content: '让我先查看赛事情况。',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'list_events', arguments: '{}' }
              },
              {
                id: 'call_2',
                type: 'function',
                function: {
                  name: 'search_topics',
                  arguments: '{"keyword":"科技","limit":8}'
                }
              }
            ],
            createdAt: '2026-08-14T00:00:02.000Z'
          },
          {
            id: 'm3',
            sessionId: 'sess-a',
            role: 'tool_result',
            content: '{"events":[{"id":"e1","name":"八队单淘汰赛"}]}',
            toolResults: [
              {
                toolCallId: 'call_1',
                success: true,
                result: '{"events":[{"id":"e1","name":"八队单淘汰赛"}]}'
              }
            ],
            createdAt: '2026-08-14T00:00:03.000Z'
          },
          {
            id: 'm4',
            sessionId: 'sess-a',
            role: 'tool_result',
            content: '{"error":"题库中科技类辩题数量不足"}',
            toolResults: [
              { toolCallId: 'call_2', success: true, result: '{"error":"题库中科技类辩题数量不足"}' }
            ],
            createdAt: '2026-08-14T00:00:04.000Z'
          },
          {
            id: 'm5',
            sessionId: 'sess-a',
            role: 'assistant',
            content: '抽取失败了，题库中科技类辩题数量不足。',
            createdAt: '2026-08-14T00:00:05.000Z'
          }
        ]
      }
    })

    await useAgentSessionStore.getState().loadSessionMessages('sess-a')

    const msgs = useAgentStore.getState().messagesBySession['sess-a'] ?? []
    // 回合合并：user + 1 条合并的 assistant；tool_result 不生成独立气泡
    expect(msgs).toHaveLength(2)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])

    // 合并的 assistant：文字按序拼接
    const merged = msgs[1]
    expect(merged.content).toBe(
      '让我先查看赛事情况。抽取失败了，题库中科技类辩题数量不足。'
    )

    // 工具卡片按执行顺序恢复
    expect(merged.toolCalls).toHaveLength(2)
    const [c1, c2] = merged.toolCalls!
    expect(c1).toMatchObject({
      toolCallId: 'call_1',
      toolName: 'list_events',
      args: {},
      status: 'success'
    })
    expect(c1.result).toEqual({ events: [{ id: 'e1', name: '八队单淘汰赛' }] })
    // 失败的工具调用：status error + 错误信息
    expect(c2).toMatchObject({
      toolCallId: 'call_2',
      toolName: 'search_topics',
      args: { keyword: '科技', limit: 8 },
      status: 'error',
      error: '题库中科技类辩题数量不足'
    })
  })

  it('多次提问不跨回合合并（每条 user 之后各自合并）', async () => {
    mockLoad.mockResolvedValue({
      success: true,
      data: {
        session: SESSION_A,
        messages: [
          {
            id: 'm1',
            sessionId: 'sess-a',
            role: 'user',
            content: '问题一',
            createdAt: '2026-08-14T00:00:01.000Z'
          },
          {
            id: 'm2',
            sessionId: 'sess-a',
            role: 'assistant',
            content: '回答一：第一步。',
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'list_events', arguments: '{}' } }
            ],
            createdAt: '2026-08-14T00:00:02.000Z'
          },
          {
            id: 'm3',
            sessionId: 'sess-a',
            role: 'tool_result',
            content: '{"ok":true}',
            toolResults: [{ toolCallId: 'call_1', success: true, result: '{"ok":true}' }],
            createdAt: '2026-08-14T00:00:03.000Z'
          },
          {
            id: 'm4',
            sessionId: 'sess-a',
            role: 'assistant',
            content: '回答一：第二步。',
            createdAt: '2026-08-14T00:00:04.000Z'
          },
          {
            id: 'm5',
            sessionId: 'sess-a',
            role: 'user',
            content: '问题二',
            createdAt: '2026-08-14T00:00:05.000Z'
          },
          {
            id: 'm6',
            sessionId: 'sess-a',
            role: 'assistant',
            content: '回答二。',
            createdAt: '2026-08-14T00:00:06.000Z'
          }
        ]
      }
    })

    await useAgentSessionStore.getState().loadSessionMessages('sess-a')

    const msgs = useAgentStore.getState().messagesBySession['sess-a'] ?? []
    // user(问题一) + assistant(合并回答一) + user(问题二) + assistant(回答二)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(msgs[0].content).toBe('问题一')
    expect(msgs[1].content).toBe('回答一：第一步。回答一：第二步。')
    expect(msgs[1].toolCalls).toHaveLength(1)
    expect(msgs[2].content).toBe('问题二')
    expect(msgs[3].content).toBe('回答二。')
    expect(msgs[3].toolCalls).toBeUndefined()
  })

  it('纯工具轮（无正文）正常并入同一条助手消息', async () => {
    mockLoad.mockResolvedValue({
      success: true,
      data: {
        session: SESSION_A,
        messages: [
          {
            id: 'm1',
            sessionId: 'sess-a',
            role: 'user',
            content: '推荐一个赛制',
            createdAt: '2026-08-14T00:00:01.000Z'
          },
          {
            id: 'm2',
            sessionId: 'sess-a',
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'recommend_format', arguments: '{}' } }
            ],
            createdAt: '2026-08-14T00:00:02.000Z'
          },
          {
            id: 'm3',
            sessionId: 'sess-a',
            role: 'tool_result',
            content: '{"formatId":"f1","formatName":"华辩赛制"}',
            toolResults: [
              { toolCallId: 'call_1', success: true, result: '{"formatId":"f1","formatName":"华辩赛制"}' }
            ],
            createdAt: '2026-08-14T00:00:03.000Z'
          },
          {
            id: 'm4',
            sessionId: 'sess-a',
            role: 'assistant',
            content: '推荐华辩赛制。',
            createdAt: '2026-08-14T00:00:04.000Z'
          }
        ]
      }
    })

    await useAgentSessionStore.getState().loadSessionMessages('sess-a')

    const msgs = useAgentStore.getState().messagesBySession['sess-a'] ?? []
    expect(msgs).toHaveLength(2)
    // 纯工具轮的卡片并入最终助手消息，正文不含空气泡
    expect(msgs[1].content).toBe('推荐华辩赛制。')
    expect(msgs[1].toolCalls).toHaveLength(1)
    expect(msgs[1].toolCalls![0]).toMatchObject({
      toolCallId: 'call_1',
      toolName: 'recommend_format',
      status: 'success'
    })
  })

  it('纯对话（无工具调用）恢复不受影响', async () => {
    mockLoad.mockResolvedValue({
      success: true,
      data: {
        session: SESSION_A,
        messages: [
          {
            id: 'm1',
            sessionId: 'sess-a',
            role: 'user',
            content: '你好',
            createdAt: '2026-08-14T00:00:01.000Z'
          },
          {
            id: 'm2',
            sessionId: 'sess-a',
            role: 'assistant',
            content: '你好！有什么可以帮你？',
            createdAt: '2026-08-14T00:00:02.000Z'
          }
        ]
      }
    })

    await useAgentSessionStore.getState().loadSessionMessages('sess-a')

    const msgs = useAgentStore.getState().messagesBySession['sess-a'] ?? []
    expect(msgs).toHaveLength(2)
    expect(msgs[1].content).toBe('你好！有什么可以帮你？')
    expect(msgs[1].toolCalls).toBeUndefined()
  })
})
