// ============================================================
// agent-loop.test.ts — Agent 对话主循环人工确认分支测试（Task 51.4）
//
// 覆盖 agent-loop.ts 的人工确认机制（Task 32）：
//   - 无 tool_calls → 直接 done
//   - low risk 工具 → 直接执行无需确认
//   - high risk 工具 + 用户确认（confirmed=true）→ 执行
//   - high risk 工具 + 用户取消（confirmed=false）→ 不执行，错误反馈 LLM
//   - high risk 工具 + modifiedArgs → 用修改后参数执行
//   - high risk 工具 + 超时 → 视为取消
//   - 默认规则：high/medium 需确认，low 不需确认
//   - 用户配置覆盖：requireConfirm=false → high risk 也不确认
//   - 用户配置覆盖：requireConfirm=true → low risk 也需确认
//
// Mock 策略：
//   - electron.ipcMain.handle：捕获 'agent:confirm-result' handler，测试中直接调用模拟用户操作
//   - llm-client.chatStream：控制返回的 assistant message（含/不含 tool_calls）
//   - tool-registry：控制 riskLevel / execute 行为
//   - context-manager：空实现
//   - db.getDb：控制 loadConfirmRules 读取的确认规则
// ============================================================

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================
// vi.hoisted：提升 mock 状态与函数，避免 vi.mock factory TDZ
// ============================================================

const {
  confirmHandlerRef,
  mockChatStream,
  mockExecute,
  mockGetRiskLevel,
  mockGet,
  mockList,
  mockAddMessage,
  mockBuildLLMMessages,
  mockSetContext,
  mockSetMessages,
  mockClearContext,
  mockGetContext,
  mockListBySession,
  mockMessageAdd,
  mockGetSession,
  mockUpdateLastMessage,
  mockUpdateContext,
  mockDbGetReturn
} = vi.hoisted(() => {
  // 捕获 'agent:confirm-result' IPC handler 引用，测试中直接调用以模拟用户确认
  const confirmHandlerRef: {
    current: ((result: unknown) => Promise<unknown>) | null
  } = { current: null }

  const mockChatStream = vi.fn()
  const mockExecute = vi.fn()
  const mockGetRiskLevel = vi.fn()
  const mockGet = vi.fn()
  const mockList = vi.fn()
  const mockAddMessage = vi.fn()
  const mockBuildLLMMessages = vi.fn()
  const mockSetContext = vi.fn()
  // P0-1 会话隔离相关 mock
  const mockSetMessages = vi.fn()
  const mockClearContext = vi.fn()
  const mockGetContext = vi.fn()
  const mockListBySession = vi.fn()
  const mockMessageAdd = vi.fn()
  const mockGetSession = vi.fn()
  const mockUpdateLastMessage = vi.fn()
  const mockUpdateContext = vi.fn()

  // loadConfirmRules 读取 settings 表的返回值（undefined=无配置，{value:JSON字符串}=有配置）
  const mockDbGetReturn: { current: unknown } = { current: undefined }

  return {
    confirmHandlerRef,
    mockChatStream,
    mockExecute,
    mockGetRiskLevel,
    mockGet,
    mockList,
    mockAddMessage,
    mockBuildLLMMessages,
    mockSetContext,
    mockSetMessages,
    mockClearContext,
    mockGetContext,
    mockListBySession,
    mockMessageAdd,
    mockGetSession,
    mockUpdateLastMessage,
    mockUpdateContext,
    mockDbGetReturn
  }
})

// ============================================================
// Mock 依赖
// ============================================================

// Mock electron：捕获 ipcMain.handle 注册的 'agent:confirm-result' handler
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (e: unknown, result: unknown) => Promise<unknown>) => {
      if (channel === 'agent:confirm-result') {
        confirmHandlerRef.current = handler.bind(null, null)
      }
    }
  }
}))

// Mock llm-client
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

// Mock tool-registry
vi.mock('../tool-registry', () => ({
  list: mockList,
  execute: mockExecute,
  getRiskLevel: mockGetRiskLevel,
  get: mockGet
}))

// Mock context-manager（P0-1：补充 setMessages / clearContext / getContext）
vi.mock('../context-manager', () => ({
  addMessage: mockAddMessage,
  buildLLMMessages: mockBuildLLMMessages,
  setContext: mockSetContext,
  setMessages: mockSetMessages,
  clearContext: mockClearContext,
  getContext: mockGetContext
}))

// Mock agent-message.repo（P0-1：agent-loop 现在按 sessionId 恢复历史与落库）
vi.mock('../../db/repository/agent-message.repo', () => ({
  agentMessageRepo: {
    listBySession: mockListBySession,
    add: mockMessageAdd
  }
}))

// Mock agent-session.repo（P0-1：agent-loop 现在恢复/持久化会话上下文）
vi.mock('../../db/repository/agent-session.repo', () => ({
  agentSessionRepo: {
    get: mockGetSession,
    updateLastMessage: mockUpdateLastMessage,
    updateContext: mockUpdateContext
  }
}))

// Mock db：控制 loadConfirmRules 读取的确认规则
vi.mock('../../db/index', () => ({
  getDb: () => ({
    prepare: () => ({
      get: () => mockDbGetReturn.current
    })
  })
}))

// 导入被测模块（在 mock 之后）
import { runAgentLoop } from '../agent-loop'
import type {
  ChatEvent,
  ChatEventWithoutSession,
  LLMConfig,
  AssistantMessage,
  ToolConfirmResult
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

/** 构造含 tool_calls 的 assistant 消息 */
function makeAssistantWithToolCall(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> = {}
): AssistantMessage {
  return {
    role: 'assistant',
    content: `即将调用 ${toolName}`,
    tool_calls: [
      {
        id: toolCallId,
        type: 'function',
        function: {
          name: toolName,
          arguments: JSON.stringify(args)
        }
      }
    ]
  }
}

/** 构造无 tool_calls 的 assistant 消息（用于结束循环） */
function makeAssistantDone(text: string = '完成'): AssistantMessage {
  return {
    role: 'assistant',
    content: text,
    tool_calls: undefined
  }
}

/** 调用捕获的 confirm handler 模拟用户确认 */
async function simulateConfirmResult(result: ToolConfirmResult): Promise<void> {
  if (!confirmHandlerRef.current) {
    throw new Error('confirm handler 未捕获（ipcMain.handle 未被调用）')
  }
  await confirmHandlerRef.current(result)
}

/** 收集 onEvent 推送的事件 */
function collectEvents(): { events: ChatEvent[]; onEvent: (e: ChatEventWithoutSession) => void } {
  const events: ChatEvent[] = []
  const onEvent = (e: ChatEventWithoutSession): void => {
    events.push(e as ChatEvent)
  }
  return { events, onEvent }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  // 重置所有 mock（仅清除调用记录与返回值，不清除 mock factory 内的闭包状态）
  vi.clearAllMocks()
  // 重置 confirm rules 返回值（undefined = 无用户配置，走默认规则）
  mockDbGetReturn.current = undefined
  // 注意：不要重置 confirmHandlerRef.current = null。
  // ipcMain.handle 在模块加载时只注册一次（confirmResultHandlerRegistered 守卫），
  // 重置后无法再次捕获，会导致后续测试报「confirm handler 未捕获」。
  // 默认 mock 行为
  mockList.mockReturnValue([])
  mockBuildLLMMessages.mockReturnValue([])
  mockAddMessage.mockImplementation(() => {})
  mockSetContext.mockImplementation(() => {})
  // P0-1 会话隔离默认值：无历史、无会话、上下文为空
  mockSetMessages.mockImplementation(() => {})
  mockClearContext.mockImplementation(() => {})
  mockGetContext.mockReturnValue({})
  mockListBySession.mockReturnValue([])
  mockMessageAdd.mockImplementation(() => ({
    id: 'mock-msg',
    sessionId: 's1',
    role: 'user',
    content: '',
    createdAt: new Date().toISOString()
  }))
  mockGetSession.mockReturnValue(null)
  mockUpdateLastMessage.mockImplementation(() => {})
  mockUpdateContext.mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runAgentLoop：无 tool_calls 分支', () => {
  it('LLM 返回无 tool_calls → 推送 done 事件结束', async () => {
    mockChatStream.mockResolvedValueOnce(makeAssistantDone('你好'))

    const { events, onEvent } = collectEvents()
    await runAgentLoop({
      userMessage: '你好',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    // 应有 done 事件
    expect(events.some((e) => e.type === 'done')).toBe(true)
    // 不应有 tool_call_start
    expect(events.some((e) => e.type === 'tool_call_start')).toBe(false)
    // 不应有 tool_call_confirm
    expect(events.some((e) => e.type === 'tool_call_confirm')).toBe(false)
  })
})

describe('runAgentLoop：low risk 工具无需确认', () => {
  it('low risk 工具 → 直接执行，无 tool_call_confirm 事件', async () => {
    const toolName = 'search_topics'
    const toolCallId = 'call-low-1'
    const args = { keyword: 'AI' }

    // 第 1 轮：返回 tool_call；第 2 轮：返回无 tool_calls 结束
    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall(toolCallId, toolName, args))
      .mockResolvedValueOnce(makeAssistantDone('搜索完成'))

    mockGetRiskLevel.mockReturnValue('low')
    mockGet.mockReturnValue({
      name: toolName,
      description: '搜索辩题',
      riskLevel: 'low'
    })
    mockExecute.mockResolvedValue({ topics: [] })

    const { events, onEvent } = collectEvents()
    await runAgentLoop({
      userMessage: '搜索 AI 辩题',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    // 应有 tool_call_start
    expect(events.some((e) => e.type === 'tool_call_start')).toBe(true)
    // 不应有 tool_call_confirm（low risk 无需确认）
    expect(events.some((e) => e.type === 'tool_call_confirm')).toBe(false)
    // 应有 tool_call_result(success=true)
    const resultEvent = events.find(
      (e) => e.type === 'tool_call_result'
    ) as Extract<ChatEvent, { type: 'tool_call_result' }> | undefined
    expect(resultEvent).toBeDefined()
    expect(resultEvent!.success).toBe(true)
    // execute 应被调用
    expect(mockExecute).toHaveBeenCalledWith(toolName, args, expect.anything())
  })
})

describe('runAgentLoop：high risk 工具人工确认分支', () => {
  beforeEach(() => {
    // 默认设置 high risk
    mockGetRiskLevel.mockReturnValue('high')
    mockGet.mockReturnValue({
      name: 'generate_schedule',
      description: '生成赛程对阵',
      riskLevel: 'high'
    })
  })

  it('用户确认（confirmed=true）→ 执行工具，有 tool_call_confirm 事件', async () => {
    const toolName = 'generate_schedule'
    const toolCallId = 'call-high-confirm'
    const args = { format: 'single-elimination', teamCount: 8, startDate: '2026-01-15' }

    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall(toolCallId, toolName, args))
      .mockResolvedValueOnce(makeAssistantDone('赛程已生成'))

    mockExecute.mockResolvedValue({ rounds: [] })

    const { events, onEvent } = collectEvents()

    // 由于 waitForConfirm 是 Promise，需要在 chatStream 返回后、execute 调用前注入确认
    // 使用 async 钩子：chatStream 第一次 resolve 后，模拟用户确认
    const loopPromise = runAgentLoop({
      userMessage: '生成赛程',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    // 等待一小段时间让 chatStream resolve 与 tool_call_confirm 推送
    await new Promise((r) => setTimeout(r, 50))

    // 模拟用户点击「确认执行」
    await simulateConfirmResult({ toolCallId, confirmed: true })

    await loopPromise

    // 应有 tool_call_confirm 事件
    expect(events.some((e) => e.type === 'tool_call_confirm')).toBe(true)
    // 应有 tool_call_result(success=true)
    const resultEvent = events.find(
      (e) => e.type === 'tool_call_result'
    ) as Extract<ChatEvent, { type: 'tool_call_result' }> | undefined
    expect(resultEvent).toBeDefined()
    expect(resultEvent!.success).toBe(true)
    // execute 应以原 args 被调用
    expect(mockExecute).toHaveBeenCalledWith(toolName, args, expect.anything())
  })

  it('用户取消（confirmed=false）→ 不执行工具，反馈错误给 LLM', async () => {
    const toolName = 'generate_schedule'
    const toolCallId = 'call-high-cancel'
    const args = { format: 'swiss', teamCount: 8, startDate: '2026-01-15' }

    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall(toolCallId, toolName, args))
      .mockResolvedValueOnce(makeAssistantDone('好的，已取消'))

    mockExecute.mockResolvedValue({ rounds: [] })

    const { events, onEvent } = collectEvents()

    const loopPromise = runAgentLoop({
      userMessage: '生成赛程',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    await new Promise((r) => setTimeout(r, 50))

    // 模拟用户点击「取消」
    await simulateConfirmResult({ toolCallId, confirmed: false })

    await loopPromise

    // 应有 tool_call_confirm 事件
    expect(events.some((e) => e.type === 'tool_call_confirm')).toBe(true)
    // 应有 tool_call_result(success=false, error='用户取消了该操作')
    const resultEvent = events.find(
      (e) => e.type === 'tool_call_result'
    ) as Extract<ChatEvent, { type: 'tool_call_result' }> | undefined
    expect(resultEvent).toBeDefined()
    expect(resultEvent!.success).toBe(false)
    expect(resultEvent!.error).toBe('用户取消了该操作')
    // execute 不应被调用
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('用户确认并修改参数（modifiedArgs）→ 用修改后参数执行', async () => {
    const toolName = 'generate_schedule'
    const toolCallId = 'call-high-modified'
    const originalArgs = { format: 'single-elimination', teamCount: 8, startDate: '2026-01-15' }
    const modifiedArgs = {
      format: 'single-elimination',
      teamCount: 16,
      startDate: '2026-02-01'
    }

    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall(toolCallId, toolName, originalArgs))
      .mockResolvedValueOnce(makeAssistantDone('赛程已生成'))

    mockExecute.mockResolvedValue({ rounds: [] })

    const { events, onEvent } = collectEvents()

    const loopPromise = runAgentLoop({
      userMessage: '生成赛程',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    await new Promise((r) => setTimeout(r, 50))

    // 模拟用户修改参数后确认
    await simulateConfirmResult({
      toolCallId,
      confirmed: true,
      modifiedArgs
    })

    await loopPromise

    // 应有 tool_call_result(success=true)
    const resultEvent = events.find(
      (e) => e.type === 'tool_call_result'
    ) as Extract<ChatEvent, { type: 'tool_call_result' }> | undefined
    expect(resultEvent).toBeDefined()
    expect(resultEvent!.success).toBe(true)
    // execute 应以 modifiedArgs 被调用，而非 originalArgs
    expect(mockExecute).toHaveBeenCalledWith(toolName, modifiedArgs, expect.anything())
    expect(mockExecute).not.toHaveBeenCalledWith(toolName, originalArgs)
  })

  it('超时（5 分钟无响应）→ 视为取消，不执行工具', async () => {
    const toolName = 'generate_schedule'
    const toolCallId = 'call-high-timeout'
    const args = { format: 'single-round-robin', teamCount: 4, startDate: '2026-01-15' }

    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall(toolCallId, toolName, args))
      .mockResolvedValueOnce(makeAssistantDone('已取消'))

    mockExecute.mockResolvedValue({ rounds: [] })

    // 使用 fake timers 加速超时
    vi.useFakeTimers()

    const { events, onEvent } = collectEvents()

    const loopPromise = runAgentLoop({
      userMessage: '生成赛程',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    // 等待微任务让 chatStream resolve
    await vi.advanceTimersByTimeAsync(50)

    // 推进 5 分钟（300_000ms）触发超时
    await vi.advanceTimersByTimeAsync(300_000)

    await loopPromise

    // 应有 tool_call_confirm 事件
    expect(events.some((e) => e.type === 'tool_call_confirm')).toBe(true)
    // 应有 tool_call_result(success=false, error='用户取消了该操作')
    const resultEvent = events.find(
      (e) => e.type === 'tool_call_result'
    ) as Extract<ChatEvent, { type: 'tool_call_result' }> | undefined
    expect(resultEvent).toBeDefined()
    expect(resultEvent!.success).toBe(false)
    expect(resultEvent!.error).toBe('用户取消了该操作')
    // execute 不应被调用
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('runAgentLoop：默认确认规则', () => {
  it('medium risk 工具 → 默认需确认', async () => {
    const toolName = 'create_topic'
    const toolCallId = 'call-medium-1'
    const args = { title: 'AI 是否应被禁止' }

    mockGetRiskLevel.mockReturnValue('medium')
    mockGet.mockReturnValue({
      name: toolName,
      description: '创建辩题',
      riskLevel: 'medium'
    })

    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall(toolCallId, toolName, args))
      .mockResolvedValueOnce(makeAssistantDone('已创建'))

    mockExecute.mockResolvedValue({ id: 'topic-1' })

    const { events, onEvent } = collectEvents()

    const loopPromise = runAgentLoop({
      userMessage: '创建辩题',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    await new Promise((r) => setTimeout(r, 50))

    // medium risk 默认需确认 → 应有 tool_call_confirm
    expect(events.some((e) => e.type === 'tool_call_confirm')).toBe(true)

    // 确认以结束循环
    await simulateConfirmResult({ toolCallId, confirmed: true })
    await loopPromise

    expect(mockExecute).toHaveBeenCalledWith(toolName, args, expect.anything())
  })
})

describe('runAgentLoop：用户配置覆盖默认规则', () => {
  it('用户配置 high risk 工具 requireConfirm=false → 无需确认直接执行', async () => {
    const toolName = 'generate_schedule'
    const toolCallId = 'call-override-1'
    const args = { format: 'swiss', teamCount: 8, startDate: '2026-01-15' }

    // 模拟用户在设置页配置了 generate_schedule 不需确认
    mockDbGetReturn.current = {
      value: JSON.stringify([
        { toolName: 'generate_schedule', requireConfirm: false }
      ])
    }

    mockGetRiskLevel.mockReturnValue('high')
    mockGet.mockReturnValue({
      name: toolName,
      description: '生成赛程',
      riskLevel: 'high'
    })

    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall(toolCallId, toolName, args))
      .mockResolvedValueOnce(makeAssistantDone('赛程已生成'))

    mockExecute.mockResolvedValue({ rounds: [] })

    const { events, onEvent } = collectEvents()
    await runAgentLoop({
      userMessage: '生成赛程',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    // 不应有 tool_call_confirm（用户配置覆盖为不需确认）
    expect(events.some((e) => e.type === 'tool_call_confirm')).toBe(false)
    // 应直接执行
    expect(mockExecute).toHaveBeenCalledWith(toolName, args, expect.anything())
    // 应有 tool_call_result(success=true)
    const resultEvent = events.find(
      (e) => e.type === 'tool_call_result'
    ) as Extract<ChatEvent, { type: 'tool_call_result' }> | undefined
    expect(resultEvent).toBeDefined()
    expect(resultEvent!.success).toBe(true)
  })

  it('用户配置 low risk 工具 requireConfirm=true → 需确认才执行', async () => {
    const toolName = 'search_topics'
    const toolCallId = 'call-override-2'
    const args = { keyword: 'AI' }

    // 模拟用户配置 search_topics 需确认
    mockDbGetReturn.current = {
      value: JSON.stringify([
        { toolName: 'search_topics', requireConfirm: true }
      ])
    }

    mockGetRiskLevel.mockReturnValue('low')
    mockGet.mockReturnValue({
      name: toolName,
      description: '搜索辩题',
      riskLevel: 'low'
    })

    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall(toolCallId, toolName, args))
      .mockResolvedValueOnce(makeAssistantDone('搜索完成'))

    mockExecute.mockResolvedValue({ topics: [] })

    const { events, onEvent } = collectEvents()

    const loopPromise = runAgentLoop({
      userMessage: '搜索辩题',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    await new Promise((r) => setTimeout(r, 50))

    // low risk 但用户配置需确认 → 应有 tool_call_confirm
    expect(events.some((e) => e.type === 'tool_call_confirm')).toBe(true)

    // 确认以结束循环
    await simulateConfirmResult({ toolCallId, confirmed: true })
    await loopPromise

    expect(mockExecute).toHaveBeenCalledWith(toolName, args, expect.anything())
  })
})

describe('runAgentLoop：多会话上下文隔离（P0-1）', () => {
  it('传 sessionId → 恢复历史/上下文、消息落库、结束持久化上下文', async () => {
    mockChatStream.mockResolvedValueOnce(makeAssistantDone('你好，上次我们聊过'))

    // 模拟该会话的持久化历史：1 条历史 user 消息
    mockListBySession.mockReturnValue([
      {
        id: 'm-hist-1',
        sessionId: 's1',
        role: 'user',
        content: '上次的问题',
        toolCalls: undefined,
        toolResults: undefined,
        createdAt: '2026-08-01T00:00:00.000Z'
      }
    ])
    // 模拟该会话的持久化上下文
    mockGetSession.mockReturnValue({
      id: 's1',
      title: '会话A',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      lastMessageText: '上次的问题',
      lastMessageAt: '2026-08-01T00:00:00.000Z',
      context: { currentPage: '/draw' }
    })

    const { events, onEvent } = collectEvents()
    await runAgentLoop({
      userMessage: '继续',
      systemPrompt: 'test',
      sessionId: 's1',
      config: MOCK_CONFIG,
      onEvent
    })

    // 1. 恢复历史：setMessages(sessionId, msgs) 被调用，且收到的是该会话恢复的消息
    expect(mockSetMessages).toHaveBeenCalledTimes(1)
    expect(mockSetMessages.mock.calls[0][0]).toBe('s1')
    const restored = mockSetMessages.mock.calls[0][1] as unknown[]
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({ role: 'user', content: '上次的问题' })

    // 2. 消息落库：user 与 assistant 都按 sessionId=s1 写入
    expect(mockMessageAdd).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ role: 'user', content: '继续' })
    )
    expect(mockMessageAdd).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ role: 'assistant', content: '你好，上次我们聊过' })
    )

    // 3. 结束持久化上下文：updateContext 被调用
    expect(mockUpdateContext).toHaveBeenCalledWith('s1', expect.any(Object))

    // 4. 正常完成
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('传 sessionId → assistant 带 tool_calls 时落库保留 toolCalls', async () => {
    const toolName = 'search_topics'
    const toolCallId = 'call-p01-1'
    const args = { keyword: 'AI' }

    // 第 1 轮：返回 tool_call；第 2 轮：无 tool_calls 结束
    mockChatStream
      .mockResolvedValueOnce(makeAssistantWithToolCall(toolCallId, toolName, args))
      .mockResolvedValueOnce(makeAssistantDone('搜索完成'))
    mockGetRiskLevel.mockReturnValue('low')
    mockGet.mockReturnValue({
      name: toolName,
      description: '搜索辩题',
      riskLevel: 'low'
    })
    mockExecute.mockResolvedValue({ topics: [] })

    const { onEvent } = collectEvents()
    await runAgentLoop({
      userMessage: '搜索 AI 辩题',
      systemPrompt: 'test',
      sessionId: 's1',
      config: MOCK_CONFIG,
      onEvent
    })

    // 落库的 assistant 消息应带 toolCalls（tool_calls 持久化，供历史恢复展示）
    const assistantAddCall = mockMessageAdd.mock.calls.find(
      (c) => c[1] && (c[1] as { role: string }).role === 'assistant'
    )
    expect(assistantAddCall).toBeDefined()
    expect(assistantAddCall![1]).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: toolCallId, function: { name: toolName } }]
    })
  })

  it('无 sessionId → 清空内存历史且不落库（向后兼容）', async () => {
    mockChatStream.mockResolvedValueOnce(makeAssistantDone('ok'))

    const { events, onEvent } = collectEvents()
    await runAgentLoop({
      userMessage: 'hi',
      systemPrompt: 'test',
      config: MOCK_CONFIG,
      onEvent
    })

    // 清空历史：setMessages(undefined, []) 以空数组调用
    expect(mockSetMessages).toHaveBeenCalledWith(undefined, [])
    // 不落库
    expect(mockMessageAdd).not.toHaveBeenCalled()
    // 不持久化上下文
    expect(mockUpdateContext).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })
})
