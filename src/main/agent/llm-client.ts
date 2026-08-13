// ============================================================
// llm-client.ts — LLM 客户端（AI Agent v1.3.0 Week 1 Task 2）
//
// 提供 OpenAI 兼容协议的 LLM 调用能力，供 agent-loop 主循环使用。
//
// 核心能力：
//   1. chat：非流式调用 /chat/completions，返回完整 AssistantMessage
//   2. chatStream：流式 SSE 调用，逐 token 推送增量；累积 tool_calls 分片
//   3. AbortController：所有 fetch 透传 signal，abort 时优雅返回空消息
//   4. LLMError：自定义错误类，区分 no_api_key / invalid_api_key /
//      rate_limit / network / unknown，便于上层按 code 决策重试与提示
//
// 设计要点：
//   - 仅使用 Node.js 全局 fetch（Node 18+ 内置，Electron 31 支持）
//   - 不依赖任何第三方 SDK，保持包体积最小
//   - 严格 TypeScript，避免 any（用 unknown 替代）
//   - 主进程模块，ESM 语法
// ============================================================

import type {
  AssistantMessage,
  LLMConfig,
  Message,
  ToolMeta
} from '@shared/agent-types'

// ============================================================
// 自定义错误类
// ============================================================

/**
 * LLM 调用错误。
 * code 用于上层（agent-loop / IPC 错误事件）决策重试与用户提示。
 */
export class LLMError extends Error {
  constructor(
    public code:
      | 'no_api_key'
      | 'invalid_api_key'
      | 'rate_limit'
      | 'network'
      | 'unknown',
    message: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

// ============================================================
// 内部类型（OpenAI Chat Completions 响应片段）
// ============================================================

/** OpenAI tool_call 分片（流式 delta 中按 index 拼接） */
interface ToolCallDelta {
  index: number
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

/** 非流式响应中的完整 assistant message */
interface OpenAIChoiceMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/** 非流式响应结构（仅声明用到的字段） */
interface ChatCompletionResponse {
  choices: Array<{
    message: OpenAIChoiceMessage
  }>
}

/** 流式 delta 片段 */
interface ChatCompletionDelta {
  choices: Array<{
    delta: {
      content?: string | null
      tool_calls?: ToolCallDelta[]
    }
  }>
}

// ============================================================
// 配置前置校验
// ============================================================

/**
 * 配置校验结果。
 * - valid=true 表示配置可用
 * - valid=false 时 code/message 描述具体错误
 */
export type ConfigValidationResult =
  | { valid: true }
  | {
      valid: false
      code: 'no_api_key' | 'invalid_baseURL' | 'invalid_model'
      message: string
    }

/**
 * 校验 LLM 配置（测试连接前的前置校验）。
 *
 * 校验规则：
 *   1. apiKey 非空（trim 后）
 *   2. baseURL 必须以 http:// 或 https:// 开头
 *   3. model 非空（trim 后）
 *
 * @param config LLM 配置
 * @returns 校验结果
 */
export function validateConfig(config: LLMConfig): ConfigValidationResult {
  if (!config.apiKey || !config.apiKey.trim()) {
    return {
      valid: false,
      code: 'no_api_key',
      message: '请先填写 API Key'
    }
  }
  const baseURL = (config.baseURL ?? '').trim()
  if (!baseURL.startsWith('http://') && !baseURL.startsWith('https://')) {
    return {
      valid: false,
      code: 'invalid_baseURL',
      message: 'baseURL 必须以 http:// 或 https:// 开头'
    }
  }
  if (!config.model || !config.model.trim()) {
    return {
      valid: false,
      code: 'invalid_model',
      message: '请填写模型名'
    }
  }
  return { valid: true }
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 校验配置并构造请求 URL。
 * @throws LLMError('no_api_key') 当 apiKey 为空
 */
function buildEndpoint(config: LLMConfig): string {
  if (!config.apiKey) {
    throw new LLMError('no_api_key', '未配置 API Key')
  }
  // baseURL 末尾可能带或不带斜杠，统一拼接
  const base = config.baseURL.replace(/\/+$/, '')
  return `${base}/chat/completions`
}

/**
 * 构造请求头。
 */
function buildHeaders(config: LLMConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json'
  }
}

/**
 * 将 ToolMeta[] 转换为 OpenAI tools 请求参数。
 */
function toOpenAITools(
  tools: ToolMeta[]
): Array<{
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}> {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown
    }
  }))
}

/**
 * 将 fetch 网络错误转换为 LLMError。
 * - AbortError：原样向上抛，由调用方判断后优雅返回
 * - TypeError：Node fetch 在网络层失败时抛 TypeError，映射为 network 错误，
 *   保留 cause 中的原始错误细节（如 DNS 解析失败、SSL 错误）便于排查
 * - 其他：包装为 unknown 错误
 *
 * 注：导出仅供单元测试使用，外部模块不应直接调用。
 */
export function wrapNetworkError(err: unknown): LLMError {
  if (err instanceof DOMException && err.name === 'AbortError') {
    // 重新抛出 AbortError 由调用方处理（不视为错误）
    throw err
  }
  if (err instanceof TypeError) {
    // Node.js fetch 失败时 cause 字段含原始错误信息（如 DNS 解析失败、SSL 错误等）
    // 保留原始细节，便于用户排查
    const cause = (err as { cause?: Error | { message?: string } }).cause
    const causeMsg =
      cause instanceof Error
        ? cause.message
        : cause && typeof cause === 'object' && 'message' in cause
          ? String(cause.message)
          : undefined
    const detail = causeMsg || err.message
    return new LLMError('network', `网络连接失败：${detail}`)
  }
  if (err instanceof LLMError) {
    return err
  }
  const msg = err instanceof Error ? err.message : String(err)
  return new LLMError('unknown', msg)
}

/**
 * 根据 HTTP 状态码与响应体构造 LLMError。
 */
async function buildHttpError(response: Response): Promise<LLMError> {
  const statusCode = response.status
  if (statusCode === 401) {
    return new LLMError('invalid_api_key', 'API Key 无效或已过期', 401)
  }
  if (statusCode === 429) {
    return new LLMError('rate_limit', '请求过于频繁，请稍后重试', 429)
  }
  let body = ''
  try {
    body = await response.text()
  } catch {
    body = ''
  }
  return new LLMError('unknown', body || `HTTP ${statusCode}`, statusCode)
}

/**
 * 构造空 AssistantMessage（用于 abort 时的优雅返回）。
 */
function emptyAssistantMessage(): AssistantMessage {
  return { role: 'assistant', content: '' }
}

// ============================================================
// chat 非流式
// ============================================================

/**
 * 非流式调用 LLM /chat/completions。
 *
 * @param messages 对话历史（含 system / user / assistant / tool）
 * @param config LLM 连接配置
 * @param tools 可选工具元数据；传入后启用 Function Calling（tool_choice='auto'）
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns LLM 响应中的 assistant message（含 content / tool_calls）
 *
 * @throws LLMError 当 API Key 缺失、HTTP 401/429 或网络错误时抛出
 *
 * 收到 abort 信号时：不抛错，返回空 AssistantMessage（content: ''），
 * 由调用方处理后续逻辑。
 */
export async function chat(
  messages: Message[],
  config: LLMConfig,
  tools?: ToolMeta[],
  signal?: AbortSignal
): Promise<AssistantMessage> {
  const endpoint = buildEndpoint(config)

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages
  }
  if (tools && tools.length > 0) {
    requestBody.tools = toOpenAITools(tools)
    requestBody.tool_choice = 'auto'
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(requestBody),
      signal
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return emptyAssistantMessage()
    }
    throw wrapNetworkError(err)
  }

  // abort 可能在响应到达后再次触发，检查一次
  if (signal?.aborted) {
    return emptyAssistantMessage()
  }

  if (!response.ok) {
    throw await buildHttpError(response)
  }

  const data = (await response.json()) as ChatCompletionResponse
  const message = data.choices?.[0]?.message
  if (!message) {
    throw new LLMError('unknown', 'LLM 响应缺少 choices[0].message')
  }

  return {
    role: 'assistant',
    content: message.content,
    tool_calls: message.tool_calls
  }
}

// ============================================================
// chatStream 流式
// ============================================================

/**
 * 流式调用 LLM /chat/completions（stream: true）。
 *
 * @param messages 对话历史
 * @param config LLM 连接配置
 * @param tools 工具元数据（流式场景通常需要工具调用）
 * @param onDelta 收到文本增量时回调（仅推送 content 文本）
 * @param signal 可选 AbortSignal
 * @returns 完整 AssistantMessage（累积 content + tool_calls）
 *
 * 流式处理要点：
 *   - SSE 数据行格式 `data: {...}`，遇 `data: [DONE]` 结束
 *   - tool_calls 是分片的：同一 index 的 arguments 字符串需逐步拼接
 *   - id / function.name 仅在首个分片出现
 *
 * 收到 abort 信号时：不抛错，返回当前已累积的内容（可能为空）。
 *
 * @throws LLMError 当 API Key 缺失、HTTP 401/429 或网络错误时抛出
 */
export async function chatStream(
  messages: Message[],
  config: LLMConfig,
  tools: ToolMeta[],
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<AssistantMessage> {
  const endpoint = buildEndpoint(config)

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true
  }
  if (tools.length > 0) {
    requestBody.tools = toOpenAITools(tools)
    requestBody.tool_choice = 'auto'
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(requestBody),
      signal
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return emptyAssistantMessage()
    }
    throw wrapNetworkError(err)
  }

  if (!response.ok) {
    throw await buildHttpError(response)
  }

  const body = response.body
  if (!body) {
    throw new LLMError('unknown', 'LLM 流式响应缺少 body')
  }

  // 累积结果
  let contentBuf = ''
  // 按 index 分组累积 tool_calls
  const toolCallMap = new Map<
    number,
    {
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }
  >()

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let chunkBuffer = ''

  try {
    while (true) {
      // 在每次读取前检查 abort，及时退出
      if (signal?.aborted) {
        break
      }

      const { done, value } = await reader.read()
      if (done) {
        break
      }

      chunkBuffer += decoder.decode(value, { stream: true })

      // 按 \n 分行处理（SSE 协议）
      const lines = chunkBuffer.split('\n')
      // 最后一段可能不完整，留到下一次
      chunkBuffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        if (!line.startsWith('data:')) continue

        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          // 流结束，退出读取循环
          return assembleResult(contentBuf, toolCallMap)
        }

        let delta: ChatCompletionDelta
        try {
          delta = JSON.parse(payload) as ChatCompletionDelta
        } catch {
          // 跳过无法解析的非 JSON 行（如心跳/注释）
          continue
        }

        const choice = delta.choices?.[0]
        if (!choice) continue
        const d = choice.delta

        // 文本增量
        if (typeof d.content === 'string' && d.content.length > 0) {
          contentBuf += d.content
          onDelta(d.content)
        }

        // 工具调用分片累积
        if (d.tool_calls && d.tool_calls.length > 0) {
          for (const tc of d.tool_calls) {
            const existing = toolCallMap.get(tc.index)
            if (!existing) {
              // 首个分片：包含 id 与 function.name
              toolCallMap.set(tc.index, {
                id: tc.id ?? '',
                type: 'function',
                function: {
                  name: tc.function?.name ?? '',
                  arguments: tc.function?.arguments ?? ''
                }
              })
            } else {
              // 后续分片：拼接 arguments，必要时补全 id / name
              if (tc.id) {
                existing.id = tc.id
              }
              if (tc.function?.name) {
                existing.function.name += tc.function.name
              }
              if (tc.function?.arguments) {
                existing.function.arguments += tc.function.arguments
              }
            }
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // abort 时返回当前已累积内容
      return assembleResult(contentBuf, toolCallMap)
    }
    throw wrapNetworkError(err)
  } finally {
    // 释放 reader，避免资源泄漏
    try {
      reader.releaseLock()
    } catch {
      // 忽略：reader 可能已被取消
    }
  }

  // 流自然结束（done=true）但未收到 [DONE] 标记的情况
  return assembleResult(contentBuf, toolCallMap)
}

/**
 * 将累积的 content 与 tool_calls 组装为 AssistantMessage。
 */
function assembleResult(
  content: string,
  toolCallMap: Map<
    number,
    {
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }
  >
): AssistantMessage {
  // 按 index 升序输出，保证与 LLM 发出顺序一致
  const sortedIndexes = Array.from(toolCallMap.keys()).sort((a, b) => a - b)
  const toolCalls = sortedIndexes.map((i) => toolCallMap.get(i)!)

  const result: AssistantMessage = {
    role: 'assistant',
    content: content
  }
  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls
  }
  return result
}
