// ============================================================
// agent-harness.test.ts — Task6.5 多会话内存隔离测试（harness 级）
//
// 与 agent-loop.test.ts 不同：本文件**不 mock context-manager**，
// 而是使用其真实实现，从而能在 runAgentLoop 完成后直接查询各会话的
// 内存消息历史与业务上下文，验证「一个 Agent 会话不污染另一个会话」。
//
// Mock 覆盖：electron（confirm handler）/ llm-client（chatStream + LLMError）/
//             tool-registry（execute/getTier/getRiskLevel/get/list）/ repos / db。
//
// 覆盖点：
//   1. 两会话并发：工具调用结果只进入各自会话历史，互不串扰
//   2. 历史恢复：各会话按各自持久化历史恢复，互不包含对方内容
//   3. 上下文恢复：各会话业务上下文独立，互不覆盖
//   4. 工具执行失败只污染本会话，不污染另一会话
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// vi.hoisted：提升 mock 状态与函数，避免 vi.mock factory TDZ
// ============================================================
const {
  mockChatStream,
  mockExecute,
  mockGetRiskLevel,
  mockGetTier,
  mockGet,
  mockList,
  mockListBySession,
  mockMessageAdd,
  mockGetSession,
  mockUpdateLastMessage,
  mockUpdateContext,
  mockDbGetReturn
} = vi.hoisted(() => {
  const mockChatStream = vi.fn()
  const mockExecute = vi.fn()
  const mockGetRiskLevel = vi.fn()
  const mockGetTier = vi.fn()
  const mockGet = vi.fn()
  const mockList = vi.fn()
  const mockListBySession = vi.fn()
  const mockMessageAdd = vi.fn()
  const mockGetSession = vi.fn()
  const mockUpdateLastMessage = vi.fn()
  const mockUpdateContext = vi.fn()
  // loadConfirmRules 读取 settings 表返回值
  const mockDbGetReturn: { current: unknown } = { current: undefined }
  return {
    mockChatStream,
    mockExecute,
    mockGetRiskLevel,
    mockGetTier,
    mockGet,
    mockList,
    mockListBySession,
    mockMessageAdd,
    mockGetSession,
    mockUpdateLastMessage,
    mockUpdateContext,
    mockDbGetReturn
  }
})

// ============================================================
// mock 依赖（context-manager 保持真实，不 mock）
// ============================================================

vi.mock('electron', () => ({
  ipcMain: {
    handle: () => {}
  }
}))

vi.mock('../llm-client', () => ({
  chatStream: mockChatStream,
  LLMError: class LLMError extends Error {
    code: string
    statusCode?: number
    constructor(code: string, message: string, statusCode?: number) {
      super(message)
      this.code = code
      this.statusCode = statusCode
      this.name = 'LLMError'
    }
  }
}))

vi.mock('../tool-registry', () => ({
  list: mockList,
  execute: mockExecute,
  getRiskLevel: mockGetRiskLevel,
  getTier: mockGetTier,
  get: mockGet
}))

vi.mock('../../db/repository/agent-message.repo', () => ({
  agentMessageRepo: {
    listBySession: mockListBySession,
    add: mockMessageAdd
  }
}))

vi.mock('../../db/repository/agent-session.repo', () => ({
  agentSessionRepo: {
    get: mockGetSession,
    updateLastMessage: mockUpdateLastMessage,
    updateContext: mockUpdateContext
  }
}))

vi.mock('../../db/index', () => ({
  getDb: () => ({
    prepare: () => ({
      get: () => mockDbGetReturn.current
    })
  })
}))

// 导入被测模块与真实 context-manager（用于断言内存隔离）
import { runAgentLoop } from '../agent-loop'
import {
  resetSession,
  getMessages,
  getContext
} from '../context-manager'
import type {
  ChatEventWithoutSession,
  LLMConfig,
  AssistantMessage
} from '@shared/agent-types'

// ============================================================
// 工具函数
// ============================================================

const MOCK_CONFIG: LLMConfig = {
  provider: 'openai',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  model: 'gpt-4o-mini'
}

function makeAssistantWithToolCall(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> = {}
): AssistantMessage {
  return {
    role: 'assistant',
    content: `调用 ${toolName}`,
    tool_calls: [
      {
        id: toolCallId,
        type: 'function',
        function: { name: toolName, arguments: JSON.stringify(args) }
      }
    ]
  }
}

function makeAssistantDone(text: string = '完成'): AssistantMessage {
  return { role: 'assistant', content: text }
}

/** 收集 onEvent 推事件 */
function collectEvents(): { onEvent: (e: ChatEventWithoutSession) => void } {
  return { onEvent: () => {} }
}

/** 构造一条持久化历史记录 */
function makeHistoryRecord(
  id: string,
  role: string,
  content: string
): {
  id: string
  sessionId: string
  role: string
  content: string
  createdAt: string
} {
  return {
    id,
    sessionId: 'dummy',
    role,
    content,
    createdAt: '2026-08-01T00:00:00.000Z',
    toolCalls: undefined,
    toolResults: undefined
  } as never
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  // 清空内存会话状态（真实 context-manager）
  resetSession(undefined)
  resetSession('sA')
  resetSession('sB')

  mockDbGetReturn.current = undefined
  mockList.mockReturnValue([])
  mockGetTier.mockReturnValue('read')
  mockGetRiskLevel.mockReturnValue('low')
  mockGet.mockReturnValue({ name: 'search_topics', description: '搜索', riskLevel: 'low' })
  mockListBySession.mockReturnValue([])
  mockGetSession.mockReturnValue(null)
  mockMessageAdd.mockImplementation(() => ({
    id: 'mock-msg',
    sessionId: 'x',
    role: 'user',
    content: ''
  }))
  mockUpdateLastMessage.mockImplementation(() => {})
  mockUpdateContext.mockImplementation(() => {})
})

describe('Task6.5：多会话内存隔离（真实 context-manager）', () => {
  it('两会话并发：A 发工具调用、B 纯文本，消息历史互不污染', async () => {
    // sA：第 1 轮工具调用，第 2 轮完成；sB：纯文本完成。
    // 两会话并发执行时 chatStream 的调用次序不定，故用 mockImplementation 依据
    // 请求消息内容稳定切分会话，避免 mockResolvedValueOnce 顺序竞争（非确定性）。
    mockChatStream.mockImplementation(async (messages: Array<{ role?: string; content?: unknown }>) => {
      const last = messages[messages.length - 1]
      // 上轮产生了 tool 结果 → sA 第二轮，返回完成
      if (last?.role === 'tool') return { role: 'assistant', content: 'A完成' } as never
      // 历史含用户消息「A搜索」→ sA 第一轮，发工具调用
      if (messages.some((m) => m.content === 'A搜索')) {
        return makeAssistantWithToolCall('cA1', 'search_topics', { keyword: 'A' })
      }
      // 其余为 sB，直接完成
      return { role: 'assistant', content: 'B完成' } as never
    })
    mockExecute.mockResolvedValue({ topics: [{ title: 'A的辩题' }] })

    const { onEvent: onA } = collectEvents()
    const { onEvent: onB } = collectEvents()

    // 并发执行两会话
    await Promise.all([
      runAgentLoop({ userMessage: 'A搜索', systemPrompt: 'test', config: MOCK_CONFIG, onEvent: onA, sessionId: 'sA' }),
      runAgentLoop({ userMessage: 'B闲聊', systemPrompt: 'test', config: MOCK_CONFIG, onEvent: onB, sessionId: 'sB' })
    ])

    // A 的历史包含工具结果消息；B 的历史不包含任何工具结果
    expect(getMessages('sA').some((m) => m.role === 'tool')).toBe(true)
    expect(getMessages('sB').some((m) => m.role === 'tool')).toBe(false)

    // 两会话历史互不包含对方内容
    const contentsA = getMessages('sA').map((m) => m.content)
    const contentsB = getMessages('sB').map((m) => m.content)
    // A 不含 B 的「B完成」回复，B 不含 A 的「A完成」回复与工具结果
    expect(contentsA).not.toContain('B完成')
    expect(contentsA).toContain('A完成')
    expect(contentsB).not.toContain('A完成')
    expect(contentsB).toContain('B完成')
  })

  it('历史恢复正确：各会话按各自持久化历史恢复，互不包含对方内容', async () => {
    // 不同会话返回不同历史
    mockListBySession.mockImplementation((sid: string) => {
      if (sid === 'sA') return [makeHistoryRecord('hA1', 'user', 'A的历史问题'), makeHistoryRecord('hA2', 'assistant', 'A的历史回答')]
      if (sid === 'sB') return [makeHistoryRecord('hB1', 'user', 'B的历史问题')]
      return []
    })

    mockChatStream.mockResolvedValue(makeAssistantDone('ok'))

    const { onEvent: onA } = collectEvents()
    const { onEvent: onB } = collectEvents()
    await Promise.all([
      runAgentLoop({ userMessage: 'A继续', systemPrompt: 'test', config: MOCK_CONFIG, onEvent: onA, sessionId: 'sA' }),
      runAgentLoop({ userMessage: 'B继续', systemPrompt: 'test', config: MOCK_CONFIG, onEvent: onB, sessionId: 'sB' })
    ])

    const messagesA = getMessages('sA')
    const messagesB = getMessages('sB')
    const textA = messagesA.map((m) => m.content)
    const textB = messagesB.map((m) => m.content)

    // A 恢复出自己的历史 + 新消息
    expect(textA).toContain('A的历史问题')
    expect(textA).toContain('A的历史回答')
    expect(textA).toContain('A继续')
    // B 恢复出自己的历史 + 新消息
    expect(textB).toContain('B的历史问题')
    expect(textB).toContain('B继续')
    // 互不包含对方历史
    expect(textA).not.toContain('B的历史问题')
    expect(textB).not.toContain('A的历史问题')
    expect(textB).not.toContain('A的历史回答')
  })

  it('上下文恢复正确：两会话业务上下文独立，互不覆盖', async () => {
    // 两会话绑定各自业务上下文
    mockGetSession.mockImplementation((sid: string) => {
      if (sid === 'sA') {
        return {
          id: 'sA',
          title: '会话A',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastMessageText: '',
          lastMessageAt: '',
          context: { currentTopic: { id: 'T-A', title: '辩题A' }, currentPage: '/draw' }
        } as never
      }
      if (sid === 'sB') {
        return {
          id: 'sB',
          title: '会话B',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastMessageText: '',
          lastMessageAt: '',
          context: { currentTopic: { id: 'T-B', title: '辩题B' } }
        } as never
      }
      return null
    })

    mockChatStream.mockResolvedValue(makeAssistantDone('ok'))

    const { onEvent: onA } = collectEvents()
    const { onEvent: onB } = collectEvents()
    await Promise.all([
      runAgentLoop({ userMessage: '你好', systemPrompt: 'test', config: MOCK_CONFIG, sessionId: 'sA', onEvent: onA }),
      runAgentLoop({ userMessage: '你好', systemPrompt: 'test', config: MOCK_CONFIG, sessionId: 'sB', onEvent: onB })
    ])

    // 各会话上下文独立
    expect(getContext('sA').currentTopic?.title).toBe('辩题A')
    expect(getContext('sB').currentTopic?.title).toBe('辩题B')
    // 互不覆盖：A 的上下文不含 B 的 topic，反之亦然
    expect(getContext('sA').currentTopic?.id).not.toBe('T-B')
    expect(getContext('sB').currentTopic?.id).not.toBe('T-A')
  })

  it('工具执行失败只污染本会话历史，不污染另一会话', async () => {
    // sA：工具执行失败；sB：无工具调用
    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall('cF', 'search_topics', {}))
      .mockResolvedValueOnce(makeAssistantDone('A处理完'))
      .mockResolvedValueOnce(makeAssistantDone('B完成'))

    // 仅第一次 execute 失败（sA），后续不执行
    mockExecute.mockRejectedValueOnce(new Error('A的工具炸了'))

    const { onEvent: onA } = collectEvents()
    const { onEvent: onB } = collectEvents()
    await Promise.all([
      runAgentLoop({ userMessage: 'A', systemPrompt: 'test', config: MOCK_CONFIG, onEvent: onA, sessionId: 'sA' }),
      runAgentLoop({ userMessage: 'B', systemPrompt: 'test', config: MOCK_CONFIG, onEvent: onB, sessionId: 'sB' })
    ])

    // sA 历史含工具失败信息（错误内容 JSON.stringify 后写入）
    const textA = getMessages('sA').map((m) => m.content)
    expect(textA.some((t) => t?.includes('A的工具炸了'))).toBe(true)
    // sB 历史干净，不包含失败信息
    const textB = getMessages('sB').map((m) => m.content)
    expect(textB.some((t) => t?.includes('A的工具炸了'))).toBe(false)
  })
})