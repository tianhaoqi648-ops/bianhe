// ============================================================
// Agent 共享类型定义（AI Agent v1.3.0）
//
// 此文件不依赖 main 或 renderer 任何模块，确保两侧都能安全引用。
// 定义 Agent 功能所需的全部共享类型：工具、消息、对话请求、流式事件、
// LLM 配置、业务上下文，以及 preload 暴露给渲染进程的 AgentAPI。
//
// 设计要点：
// - 通过 OpenAI 兼容协议调用 LLM，支持 Function Calling
// - 流式响应通过 IPC webContents.send('agent:event', ...) 推送，
//   preload 通过 ipcRenderer.on('agent:event', onEvent) 监听
// - 严格使用 TypeScript，避免 any（用 unknown 替代）
// ============================================================

import type { ApiResponse } from './types'

// ---------- 1. 工具相关类型（SubTask 1.1） ----------

/**
 * 工具参数 JSON Schema 的元素（OpenAI Function Calling 格式）。
 * 支持嵌套 object（数组元素为对象时用 properties/required），批3 环节分段入参需要。
 */
export interface ToolSchemaItem {
  type: string
  description?: string
  enum?: string[]
  default?: unknown
  /** 当 type='array' 时，描述数组元素的 schema */
  items?: ToolSchemaItem
  /** 当 type='object' 时，描述属性 */
  properties?: Record<string, ToolSchemaItem>
  required?: string[]
}

/** 工具参数 JSON Schema（OpenAI Function Calling 格式） */
export interface ToolSchema {
  type: 'object'
  properties: Record<string, ToolSchemaItem>
  required?: string[]
}

/**
 * 工具权限等级（用于默认只读权限策略，AI Agent v1.5.0 引入）。
 * - read      ：纯查询，直接放行，无需授权
 * - write     ：创建/修改赛事、题库、比赛、写回评审、保存历史等，需用户授权
 * - dangerous ：删除/批量修改/文件写入/外部网络调用/清空类，需用户授权
 */
export type ToolPermissionTier = 'read' | 'write' | 'dangerous'

/**
 * 工具权限授权声明。
 * 传给 execute 的 ctx.grants，标记本次调用已获得哪些工具 / 哪些权限级别的授权。
 * 匹配规则：按 toolName 精确匹配 或 按 tier 级别匹配，二者任一命中即视为已授权。
 *
 * 注意（governance Task 9）：execute 不再信任调用方自行声明的 grants 作为授权依据，
 * 而要求 write / dangerous 工具提供主进程登记过的一次性 ToolGrant（见 ctx.grantId）。
 * 本声明保留仅为既有工具/测试的兼容。
 */
export interface PermissionGrant {
  /** 已授权的工具名（精确匹配） */
  toolName?: string
  /** 已授权的权限级别（匹配该级别全部工具） */
  tier?: ToolPermissionTier
}

/**
 * 一次性绑定授权 grant（governance Task 9）。
 * 由主进程（agent-loop 在用户确认后 / run-tool 显式调用时）创建并登记到 grant 登记处，
 * execute() 校验 grant 是否有效（存在、未过期、session/tool/argsHash/tier 均匹配）后才放行，
 * 避免仅信任调用方传入的 grants 声明。校验通过即一次性消费，杜绝重放。
 */
export interface ToolGrant {
  /** grant 唯一 id（execute 据此从登记处取回记录校验） */
  grantId: string
  /** 归属会话 id（用户确认时登记；execute 校验 ctx.sessionId 与之一致） */
  sessionId?: string
  /** 被授权的工具名（execute 校验与目标工具一致） */
  toolName: string
  /** 入参哈希（execute 校验与本次实际 args 哈希一致，防止参数被偷换） */
  argsHash: string
  /** 授权级别（execute 校验与目标工具要求的 tier 一致） */
  tier: ToolPermissionTier
  /** 过期时间戳（毫秒）；过期即拒绝 */
  expiresAt: number
}

/** 工具元数据（不含 execute 函数，用于 IPC 与 UI 显示） */
export interface ToolMeta {
  /** 工具唯一名（与 LLM function name 对齐） */
  name: string
  /** 工具描述（LLM 据此决定是否调用） */
  description: string
  /** 参数 JSON Schema */
  parameters: ToolSchema
  /** 风险等级（用于决定是否需要人工确认；ToolDefinition 通过继承获得该字段） */
  riskLevel: ToolRiskLevel
  /** 权限等级（默认 'read'；write / dangerous 执行前需授权，否则拒绝执行） */
  tier: ToolPermissionTier
}

/**
 * 工具执行上下文（AI 裁判功能 2026-08-18 引入）。
 * 提供给需要调用 LLM / 响应取消的工具（如 judge_debate）。
 * 可选字段向后兼容：现有工具忽略 ctx 即可零改动。
 */
export interface ToolExecutionContext {
  /** LLM 连接配置（由渲染进程经 ChatRequest 下发，主进程不持有） */
  config?: LLMConfig
  /** 取消信号（agent-loop 的 AbortSignal，透传给内部 LLM 调用） */
  signal?: AbortSignal
  /** 所属会话 id（governance Task 9：execute 校验 grant.sessionId 与之一致） */
  sessionId?: string
  /**
   * 一次性授权 grant id（governance Task 9）。
   * write / dangerous 工具执行前，调用方须引用主进程登记过的一次性 ToolGrant，
   * execute 据此校验（存在/未过期/session/tool/argsHash/tier 均匹配）才放行，
   * 校验通过即一次性消费。不再信任调用方自行声明的 grants。
   */
  grantId?: string
  /**
   * 已授予的权限（AI Agent v1.5.0：默认只读）。write / dangerous 工具执行前，
   * 调用方需在此声明本次已获得的授权（用户确认弹窗 / 设置页自动放行），否则被拒绝。
   * read 工具为空数组 / 缺省即可放行。
   * 注意：governance Task 9 起，execute 的授权校验以 ctx.grantId 对应的 ToolGrant 为准，
   * 不再以 grants 声明为授权依据。
   */
  grants?: PermissionGrant[]
}

/**
 * 完整工具定义（主进程内部使用，含 execute）。
 * - TArgs：工具参数类型，默认 Record<string, unknown>
 * - TResult：工具返回值类型，默认 unknown
 */
export interface ToolDefinition<
  TArgs = Record<string, unknown>,
  TResult = unknown
> extends ToolMeta {
  /** 工具执行函数（主进程内调用，IPC 边界不传输） */
  execute: (args: TArgs, ctx?: ToolExecutionContext) => Promise<TResult>
}

// ---------- 2. 消息相关类型（SubTask 1.2） ----------

/** 用户消息 */
export interface UserMessage {
  role: 'user'
  content: string
}

/** 助手消息（含可选 tool_calls） */
export interface AssistantMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/** 工具结果消息 */
export interface ToolResultMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

/** 系统消息 */
export interface SystemMessage {
  role: 'system'
  content: string
}

/** OpenAI Chat Completions 消息联合类型 */
export type Message =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | SystemMessage

// ---------- 3. 对话请求类型（SubTask 1.3） ----------

export interface ChatRequest {
  /** 用户本次输入的文本 */
  message: string
  /**
   * 目标会话 id（多会话上下文隔离 P0-1 引入）。
   * - 传值：agent-loop 按该会话恢复历史与业务上下文，消息实时落库，结束持久化上下文
   * - 不传/空：不持久化、每次对话内存历史清空（向后兼容测试与无会话场景）
   */
  sessionId?: string
  /** 当前业务上下文（如选中的辩题/赛事） */
  context?: AgentContext
  /** 是否流式响应（默认 true） */
  stream?: boolean
  /**
   * LLM 连接配置（由渲染进程从 settingsStore.aiConfig 传入）。
   * 主进程不持有渲染进程状态，因此配置随请求一并下发；
   * handler 内会校验 apiKey 非空（Task 17.1）。
   */
  config: LLMConfig
}

// ---------- 4. 流式事件类型（SubTask 1.4） ----------

/** 文本增量事件（assistant 输出 token 流） */
export interface DeltaEvent {
  type: 'delta'
  /** 所属会话 id（2026-08-18：支持多会话并发路由） */
  sessionId: string
  text: string
}

/** 工具调用开始事件（主进程即将执行工具） */
export interface ToolCallStartEvent {
  type: 'tool_call_start'
  sessionId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

/** 工具调用结果事件（主进程执行工具后回传） */
export interface ToolCallResultEvent {
  type: 'tool_call_result'
  sessionId: string
  toolCallId: string
  toolName: string
  success: boolean
  result?: unknown
  error?: string
}

/** 工具调用人工确认事件（高风险工具执行前由主进程推送，渲染进程弹出确认框） */
export interface ToolCallConfirmEvent {
  type: 'tool_call_confirm'
  sessionId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  /** 工具的人类可读说明文案 */
  description: string
}

/** 对话完成事件 */
export interface DoneEvent {
  type: 'done'
  sessionId: string
}

/** 错误事件 */
export interface ErrorEvent {
  type: 'error'
  sessionId: string
  code:
    | 'no_api_key'
    | 'invalid_api_key'
    | 'rate_limit'
    | 'network'
    | 'tool_error'
    | 'agent_restore_failed'
    | 'unknown'
  message: string
}

/** 通过 IPC 推送的流式事件联合类型 */
export type ChatEvent =
  | DeltaEvent
  | ToolCallStartEvent
  | ToolCallResultEvent
  | ToolCallConfirmEvent
  | DoneEvent
  | ErrorEvent

/**
 * 不带 sessionId 的流式事件联合（2026-08-18 引入）。
 * 主进程 agent-loop 内部生成事件时不含 sessionId，由 ipc 层统一注入。
 * 注意：不能用 Omit<ChatEvent, 'sessionId'>（联合类型 Omit 不分发，会退化为仅公共字段）。
 */
export type ChatEventWithoutSession =
  | Omit<DeltaEvent, 'sessionId'>
  | Omit<ToolCallStartEvent, 'sessionId'>
  | Omit<ToolCallResultEvent, 'sessionId'>
  | Omit<ToolCallConfirmEvent, 'sessionId'>
  | Omit<DoneEvent, 'sessionId'>
  | Omit<ErrorEvent, 'sessionId'>

/** 测试连接结果 */
export interface TestConnectionResult {
  /** 是否连接成功 */
  success: boolean
  /** 错误码（success=true 时为 undefined） */
  code?:
    | 'no_api_key'
    | 'invalid_api_key'
    | 'rate_limit'
    | 'network'
    | 'timeout'
    | 'invalid_baseURL'
    | 'invalid_model'
    | 'unknown'
  /** 错误信息（success=true 时为 undefined） */
  message?: string
  /** HTTP 状态码（如 401/429，仅在网络请求返回 HTTP 响应时存在） */
  statusCode?: number
  /** 请求耗时（毫秒，success=true 时返回） */
  latencyMs?: number
}

// ---------- 5. LLM 配置类型（SubTask 1.5） ----------

/** LLM 服务商标识（用于设置页预填与运行时分支） */
export type LLMProvider = 'openai' | 'qwen' | 'kimi' | 'zhipu' | 'deepseek' | 'custom'

/** LLM 连接配置（存储于 settings 表 key='agent.llm'） */
export interface LLMConfig {
  /** 服务商标识 */
  provider: LLMProvider
  /** OpenAI 兼容 API base URL */
  baseURL: string
  /** API Key（敏感数据，仅主进程持有） */
  apiKey: string
  /** 模型名 */
  model: string
}

/**
 * 服务商预设常量（设置页预填使用）。
 * - custom：baseURL 与 model 留空，由用户手动填写
 */
export const LLM_PROVIDER_PRESETS: Record<
  LLMProvider,
  { baseURL: string; model: string; label: string }
> = {
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  qwen: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    label: '通义千问'
  },
  kimi: { baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', label: 'Kimi' },
  zhipu: {
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    label: '智谱清言'
  },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  custom: { baseURL: '', model: '', label: '自定义' }
}

// ---------- 6. 业务上下文类型（SubTask 1.6） ----------

/**
 * Agent 业务上下文（渲染进程在发起对话时填充）。
 * 用于 system prompt 注入当前选中的辩题/赛事/页面，让 LLM 感知业务状态。
 */
export interface AgentContext {
  /** 当前选中的辩题（用户在 TopicLibrary 选中时填充） */
  currentTopic?: { id: string; title: string } | null
  /** 当前选中的赛事 */
  currentEvent?: { id: string; name: string } | null
  /** 当前所在页面 */
  currentPage?: string
  /**
   * 上下文是否锁定（Week 6 Task 33 引入）。
   * - 默认 undefined / falsy：setContext 走正常覆盖合并逻辑
   * - true：setContext 仅追加当前不存在的字段，已存在字段保持不变
   * 通过 contextManager.lock() / unlock() 切换。
   */
  locked?: boolean
}

// ---------- 7. Agent API（SubTask 1.7 / 30.4） ----------

/**
 * Agent 会话管理 API（SubTask 30.4 / Task 41.3）。
 * 提供多会话列表、创建、重命名、删除、加载详情与搜索能力，
 * 以及单条消息持久化与最近消息预览更新能力。
 */
export interface AgentSessionAPI {
  /** 列出全部会话（按 updatedAt DESC） */
  list(): Promise<ApiResponse<AgentSession[]>>
  /** 创建新会话 */
  create(title: string): Promise<ApiResponse<AgentSession>>
  /** 重命名会话 */
  rename(id: string, title: string): Promise<ApiResponse<boolean>>
  /** 删除会话（事务级联清理消息） */
  delete(id: string): Promise<ApiResponse<boolean>>
  /** 清空全部会话（事务级联清理全部消息，不可恢复） */
  clearAll(): Promise<ApiResponse<boolean>>
  /** 加载会话详情（session + messages） */
  load(id: string): Promise<ApiResponse<{ session: AgentSession; messages: AgentMessageRecord[] }>>
  /** 跨会话搜索（title / lastMessageText） */
  search(keyword: string): Promise<ApiResponse<AgentSession[]>>
  /**
   * 追加一条消息到指定会话（Task 41.3）。
   * 用于 sendMessage 流程中将用户/assistant 消息持久化到 agent_messages 表。
   * @param sessionId 目标会话 id
   * @param message   消息内容（不含 id / createdAt / seq，由主进程自动填充）
   */
  addMessage(
    sessionId: string,
    message: Omit<AgentMessageRecord, 'id' | 'createdAt' | 'seq' | 'sessionId'>
  ): Promise<ApiResponse<AgentMessageRecord>>
  /**
   * 更新会话最近一条消息的预览文本与时间（Task 41.3）。
   * 同步刷新 updatedAt，保证会话列表按最新活动排序。
   */
  updateLastMessage(sessionId: string, text: string): Promise<ApiResponse<boolean>>
}

/**
 * Agent 配置 API（SubTask 30.4）。
 * 提供工具人工确认规则的读取与保存能力。
 */
export interface AgentConfigAPI {
  /** 读取工具确认规则（无配置时返回默认规则） */
  getConfirmRules(): Promise<ApiResponse<ToolConfirmRule[]>>
  /** 保存工具确认规则到 settings 表 */
  setConfirmRules(rules: ToolConfirmRule[]): Promise<ApiResponse<boolean>>
}

/**
 * preload 暴露给渲染进程的 Agent API。
 *
 * 通过 contextBridge.exposeInMainWorld 挂载到 window.electron.agent。
 * 流式事件通过 IPC 'agent:event' 通道推送，preload 内部转发给 onEvent 回调。
 *
 * SubTask 30.4：扩展 session 与 config 命名空间，支持多会话持久化与工具确认规则配置。
 */

/** agent:run-tool 请求（AI 裁判工作台直接调工具，2026-08-18） */
export interface RunToolRequest {
  /** 工具名（白名单：5 个裁判工具） */
  toolName: string
  /** 工具入参（与各工具 schema 对齐） */
  args: Record<string, unknown>
  /** LLM 连接配置（由渲染进程从 settingsStore.aiConfig 传入） */
  config: LLMConfig
  /** 会话 id（可选，用于会话上下文归属） */
  sessionId?: string
}

/** agent:run-tool 结果（AI 裁判工作台） */
export interface RunToolResult {
  success: boolean
  code?:
    | 'ok'
    | 'forbidden_tool'
    | 'not_found'
    | 'no_api_key'
    | 'permission_denied'
    | 'cancelled'
    | 'error'
  message?: string
  /** 工具执行结果（成功时） */
  data?: unknown
}

export interface AgentAPI {
  /**
   * 发起 Agent 对话。
   * @param request 对话请求
   * @param onEvent 流式事件回调
   * @returns 取消函数，调用后终止当前对话
   */
  chat(request: ChatRequest, onEvent: (event: ChatEvent) => void): () => void
  /**
   * 测试 LLM 连接（不进入 agent 循环，不写入会话历史）。
   * @param config LLM 连接配置
   * @returns 测试结果（含成功/失败、错误码、耗时）
   */
  testConnection(config: LLMConfig): Promise<TestConnectionResult>
  /**
   * 取消指定会话进行中的对话（2026-08-18：按会话维度取消，支持多会话并发）。
   * @param sessionId 会话 id；缺失时取消当前窗口全部进行中的对话（兼容旧调用）
   */
  cancel(sessionId?: string): Promise<void>
  /**
   * 直接调用裁判工具（AI 裁判工作台，2026-08-18）。
   * 白名单：judge_match / judge_debate / judge_speech / detect_stage / simulate_opponent。
   * 绕过 agent-loop 聊天流，表单直接执行；结果通过返回值返回。
   */
  runTool(req: RunToolRequest): Promise<RunToolResult>
  /** 取消当前进行中的 runTool 调用（AI 裁判工作台「取消」按钮） */
  cancelTool(): Promise<void>
  /**
   * 回传工具人工确认结果（Task 32 / 41.4）。
   * 渲染进程在 ToolConfirmModal 中点击「确认/取消」后调用本方法，
   * 主进程 agent-loop.ts 内通过 'agent:confirm-result' IPC handler 解析对应 Promise。
   * @param result 确认结果（含 toolCallId / confirmed / 可选 modifiedArgs）
   */
  confirmResult(result: ToolConfirmResult): Promise<void>
  /**
   * 导出指定会话为 Markdown / JSON 文件（Task 46 主进程实现 / Task 45 渲染进程调用）。
   * 主进程通过 dialog.showSaveDialog 让用户选择保存路径；
   * 用户取消保存时返回 { success: true, data: null }，前端据此区分取消与失败。
   *
   * @param payload { sessionId, format }
   * @returns 成功：{ filePath, size }；用户取消：null；失败：success=false + error
   */
  exportSession(payload: {
    sessionId: string
    format: 'markdown' | 'json'
  }): Promise<ApiResponse<{ filePath: string; size: number } | null>>
  /** 会话管理（多会话持久化） */
  session: AgentSessionAPI
  /** Agent 配置（工具确认规则等） */
  config: AgentConfigAPI
}

// ---------- 8. 会话与消息持久化类型（SubTask 27.1 / 27.2） ----------

/**
 * Agent 会话记录（多会话持久化使用）。
 * 用于会话列表展示与恢复，对应数据库 sessions 表。
 */
export interface AgentSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** 最近一条消息的预览文本（列表展示用） */
  lastMessageText: string
  lastMessageAt: string
  /** 会话绑定的业务上下文（恢复时复用） */
  context?: AgentContext
}

/**
 * Agent 消息持久化记录（单条消息）。
 * 对应数据库 messages 表，按 sessionId 关联会话。
 * role 在原 Message 联合基础上扩展 tool_call / tool_result，便于落库查询。
 */
export interface AgentMessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
  content: string
  /** 助手消息附带的工具调用（沿用 AssistantMessage.tool_calls 结构） */
  toolCalls?: AssistantMessage['tool_calls']
  /** 工具结果附带的执行详情 */
  toolResults?: Array<{
    toolCallId: string
    success: boolean
    result?: unknown
    error?: string
  }>
  createdAt: string
}

// ---------- 9. 工具人工确认类型（SubTask 27.3 / 27.5 / 27.7） ----------

/** 工具风险等级（用于决定是否需要人工确认） */
export type ToolRiskLevel = 'high' | 'medium' | 'low'

/**
 * 工具人工确认规则。
 * 主进程在执行工具前根据此规则判断是否需要暂停并推送 ToolCallConfirmEvent。
 */
export interface ToolConfirmRule {
  toolName: string
  requireConfirm: boolean
}

/**
 * 工具确认结果（渲染进程回传给主进程）。
 * - confirmed=false 表示用户拒绝执行
 * - modifiedArgs 用于用户在确认框中修改参数后回传
 */
export interface ToolConfirmResult {
  toolCallId: string
  confirmed: boolean
  /** 用户在确认框中修改后的参数（可选，未修改则不传） */
  modifiedArgs?: Record<string, unknown>
}

// ---------- 10. 赛程类型（SubTask 27.4） ----------

/**
 * 赛程单场比赛。
 * - homeTeamId / awayTeamId 为 null 表示该队本轮轮空（bye）
 */
export interface ScheduleMatch {
  matchIndex: number
  /** 主队 ID，null 表示轮空 */
  homeTeamId: string | null
  /** 客队 ID，null 表示轮空 */
  awayTeamId: string | null
  /** 比赛日期（ISO 日期字符串） */
  date: string
}

/** 赛程单轮（roundIndex 从 1 开始） */
export interface ScheduleRound {
  /** 轮次序号，从 1 开始 */
  roundIndex: number
  matches: ScheduleMatch[]
}
