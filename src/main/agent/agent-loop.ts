// ============================================================
// agent-loop.ts — Agent 对话主循环（AI Agent v1.3.0 Week 3 Task 15）
//
// 实现 plan → tool_call → observe → respond 的对话循环：
//   1. 将用户消息加入会话历史
//   2. 循环调用 LLM，检测 tool_calls
//   3. 顺序执行工具，将结果反馈给 LLM
//   4. 直到 LLM 不再发起 tool_calls，或达到最大迭代次数
//
// 通过 onEvent 回调向调用方推送流式事件：
//   - delta：LLM 文本增量
//   - tool_call_start / tool_call_result：工具调用生命周期
//   - tool_call_confirm：高风险工具执行前需人工确认（Task 32）
//   - done：对话正常结束
//   - error：LLM 调用错误（透传 LLMError 的 code）
//
// 设计要点：
//   - 不直接依赖 prompt-templates：systemPrompt 由调用方传入
//   - 不直接管理上下文：通过 params.context 调用 context-manager
//   - tool_calls 顺序执行，避免并发问题
//   - 工具执行错误不中断循环，作为 success=false 反馈给 LLM
//   - Task 32：工具执行前根据 riskLevel 与用户 confirm_rules 判断是否需人工确认；
//              确认期间通过 Promise 暂停执行，不阻塞主进程其他事件循环
//   - 严格 TypeScript，避免 any（用 unknown 替代）
// ============================================================

import { ipcMain } from 'electron'
import type {
  ChatEventWithoutSession,
  LLMConfig,
  AgentContext,
  AssistantMessage,
  Message,
  ToolConfirmRule,
  ToolConfirmResult,
  AgentMessageRecord
} from '@shared/agent-types'
import { chatStream, LLMError } from './llm-client'
import { list, execute, getRiskLevel, getTier, get, createGrant } from './tool-registry'
import {
  addMessage,
  buildLLMMessages,
  setContext,
  clearContext,
  setMessages,
  getContext
} from './context-manager'
import { agentMessageRepo } from '../db/repository/agent-message.repo'
import { agentSessionRepo } from '../db/repository/agent-session.repo'
import { getDb } from '../db/index'

// ============================================================
// 类型定义
// ============================================================

/**
 * 流式事件回调类型。
 * 2026-08-18：事件不带 sessionId（由 ipc 层统一注入，agent-loop 内部无需感知）。
 */
export type AgentEventCallback = (event: ChatEventWithoutSession) => void

/** runAgentLoop 入参 */
export interface RunAgentLoopParams {
  /** 用户本次输入的文本 */
  userMessage: string
  /** 系统提示词（由调用方传入，解耦 prompt-templates） */
  systemPrompt: string
  /**
   * 目标会话 id（多会话上下文隔离 P0-1 引入）。
   * - 传值：入口按该会话恢复历史与业务上下文，消息实时落库，结束持久化上下文
   * - 不传：内存历史清空（不串话）、不持久化（向后兼容测试与无会话场景）
   */
  sessionId?: string
  /** 当前业务上下文（可选） */
  context?: AgentContext
  /** LLM 配置 */
  config: LLMConfig
  /** 流式事件回调 */
  onEvent: AgentEventCallback
  /** AbortSignal（用于取消） */
  signal?: AbortSignal
}

// ============================================================
// 常量
// ============================================================

/** 最大循环次数（防止无限工具调用） */
const MAX_ITERATIONS = 5

/** 人工确认超时时间（Task 32.7：5 分钟，单位 ms） */
const CONFIRM_TIMEOUT_MS = 300_000

/** settings 表中存储工具确认规则的 key（与 agent-config.ipc.ts 保持一致） */
const CONFIRM_RULES_KEY = 'agent.confirm_rules'

// ============================================================
// 会话持久化辅助（多会话上下文隔离 P0-1 引入）
//
// 消息双向转换：
//   - 内存 Message（OpenAI 格式）↔ DB AgentMessageRecord（agent_messages 表）
//   - assistant 的 tool_calls 落库到 tool_calls_json；
//   - role='tool'（工具结果）落库为 role='tool_result' + toolResults[0]，
//     恢复时从 toolResults[0] 取回 tool_call_id 与结果内容。
// ============================================================

/** Message（OpenAI 格式）-> AgentMessageRecord（DB 格式，不含自增字段） */
function messageToRecord(
  msg: Message
): Omit<AgentMessageRecord, 'id' | 'createdAt' | 'seq' | 'sessionId'> {
  switch (msg.role) {
    case 'user':
      return { role: 'user', content: msg.content }
    case 'assistant':
      return {
        role: 'assistant',
        content: msg.content ?? '',
        toolCalls: msg.tool_calls
      }
    case 'tool':
      return {
        role: 'tool_result',
        content: msg.content,
        toolResults: [
          {
            toolCallId: msg.tool_call_id,
            success: true,
            result: msg.content
          }
        ]
      }
    case 'system':
      return { role: 'system', content: msg.content }
  }
}

/** AgentMessageRecord（DB 格式）-> Message（OpenAI 格式） */
function recordToMessage(rec: AgentMessageRecord): Message {
  switch (rec.role) {
    case 'user':
      return { role: 'user', content: rec.content }
    case 'assistant':
      return {
        role: 'assistant',
        content: rec.content,
        ...(rec.toolCalls && rec.toolCalls.length > 0
          ? { tool_calls: rec.toolCalls }
          : {})
      }
    case 'tool_result': {
      const tr = rec.toolResults?.[0]
      return {
        role: 'tool',
        tool_call_id: tr?.toolCallId ?? '',
        content: tr?.result != null ? String(tr.result) : rec.content
      }
    }
    case 'system':
      return { role: 'system', content: rec.content }
    case 'tool_call':
      // tool_call 不会作为独立消息出现（挂在 assistant.tool_calls 上），兜底降级为 system
      return { role: 'system', content: rec.content }
  }
}

/** 生成会话列表最近消息预览（截断到 100 字） */
function toPreview(text: string): string {
  return text.length > 100 ? text.slice(0, 100) + '...' : text
}

/**
 * 向会话历史追加消息，并（若有 sessionId）同步落库 + 刷新最近消息预览。
 * 落库失败仅记录日志，不中断对话。
 */
function appendMessage(sessionId: string | undefined, msg: Message): void {
  addMessage(sessionId, msg)
  if (!sessionId) return
  try {
    agentMessageRepo.add(sessionId, messageToRecord(msg))
  } catch (e) {
    console.error('[agent-loop] 持久化消息失败：', e)
  }
  if (msg.role === 'user' || msg.role === 'assistant') {
    try {
      agentSessionRepo.updateLastMessage(sessionId, toPreview(msg.content ?? ''))
    } catch (e) {
      console.error('[agent-loop] 更新最近消息预览失败：', e)
    }
  }
}

/**
 * 按 sessionId 恢复会话历史与业务上下文。
 * - 历史：agent_messages 全量按 seq 恢复为内存 Message[]
 * - 上下文：agent_sessions.contextJson 恢复为 AgentContext
 * 无 sessionId 时清空内存历史（防止无会话场景串话）。
 */
function restoreSession(
  sessionId: string | undefined,
  onError?: (userMessage: string) => void
): void {
  if (!sessionId) {
    setMessages(sessionId, [])
    return
  }
  try {
    const history = agentMessageRepo.listBySession(sessionId).map(recordToMessage)
    setMessages(sessionId, history)
  } catch (e) {
    console.error('[agent-loop] 恢复会话历史失败：', e)
    onError?.('恢复会话历史失败，本次对话将从头开始（本地历史已清空）')
    setMessages(sessionId, [])
  }
  try {
    const session = agentSessionRepo.get(sessionId)
    if (session?.context && Object.keys(session.context).length > 0) {
      clearContext(sessionId)
      setContext(sessionId, session.context)
    } else {
      clearContext(sessionId)
    }
  } catch (e) {
    console.error('[agent-loop] 恢复会话上下文失败：', e)
    clearContext(sessionId)
  }
}

/** 将当前业务上下文持久化到会话（若有 sessionId）。失败仅记录日志。 */
function persistContext(sessionId: string | undefined): void {
  if (!sessionId) return
  try {
    agentSessionRepo.updateContext(sessionId, getContext(sessionId))
  } catch (e) {
    console.error('[agent-loop] 持久化会话上下文失败：', e)
  }
}

// ============================================================
// Task 32：人工确认机制
//
// 通过模块级 Map 维护 toolCallId → { resolve } 的待确认映射。
// 渲染进程在用户点击「确认/取消」后通过 ipcRenderer.invoke('agent:confirm-result', result)
// 回传 ToolConfirmResult，主进程收到后从 Map 取出对应 Promise 并 resolve。
// ipcMain.handle 在模块加载时注册一次（模块级布尔标志避免重复注册）。
// ============================================================

/** 待确认工具调用的 Promise 解析器 */
interface PendingConfirm {
  /** 所属会话 id（2026-08-18：并发时防串台，记录会话归属） */
  sessionId?: string
  resolve: (result: ToolConfirmResult) => void
}

/** toolCallId → 待确认 Promise 解析器 的映射 */
const pendingConfirms = new Map<string, PendingConfirm>()

/** 标记 'agent:confirm-result' handler 是否已注册（避免热重载或多次调用导致重复注册） */
let confirmResultHandlerRegistered = false

/**
 * 注册 'agent:confirm-result' IPC handler。
 * 渲染进程在确认框中点击「确认/取消」后通过 ipcRenderer.invoke 调用本通道，
 * 主进程收到 ToolConfirmResult 后从 pendingConfirms 取出对应 Promise 并 resolve。
 *
 * 注意：ipcMain.handle 应只注册一次，故使用模块级布尔标志守卫。
 */
function registerConfirmResultHandler(): void {
  if (confirmResultHandlerRegistered) return
  confirmResultHandlerRegistered = true

  ipcMain.handle(
    'agent:confirm-result',
    async (_e, result: ToolConfirmResult) => {
      const pending = pendingConfirms.get(result.toolCallId)
      if (pending) {
        pending.resolve(result)
      }
      // 返回值仅作 ack，渲染进程不依赖此返回值
      return true
    }
  )
}

// 模块加载时立即注册（模块单例，整个进程只注册一次）
registerConfirmResultHandler()

/**
 * 等待渲染进程回传工具确认结果（Task 32.3 / 32.4 / 32.7）。
 *
 * 实现要点：
 *   - 使用 Promise 暂停当前工具执行流程，不阻塞主进程事件循环
 *   - 通过 5 分钟超时防止永久挂起，超时视为取消
 *   - 收到结果或超时后均清理 Map 条目，避免内存泄漏
 *   - 2026-08-18：记录所属 sessionId（并发多会话时防确认串台）
 *
 * @param toolCallId 工具调用 ID（用于匹配渲染进程回传的结果）
 * @param sessionId 所属会话 id（可选）
 * @returns 确认结果（confirmed=true/false，可能含 modifiedArgs）
 */
function waitForConfirm(toolCallId: string, sessionId?: string): Promise<ToolConfirmResult> {
  return new Promise<ToolConfirmResult>((resolve) => {
    let settled = false

    // 包装 resolve：保证只触发一次，并清理定时器与 Map 条目
    const wrappedResolve = (result: ToolConfirmResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pendingConfirms.delete(toolCallId)
      resolve(result)
    }

    // 注册到 Map，等待 'agent:confirm-result' handler 调用
    pendingConfirms.set(toolCallId, { sessionId, resolve: wrappedResolve })

    // 超时定时器：5 分钟后视为取消，自动清理 Map 条目（Task 32.7）
    const timer = setTimeout(() => {
      wrappedResolve({ toolCallId, confirmed: false })
    }, CONFIRM_TIMEOUT_MS)
  })
}

/**
 * 从 settings 表读取工具确认规则（Task 32.1）。
 * 与 agent-config.ipc.ts 读取逻辑保持一致：读取 key='agent.confirm_rules' 的 JSON。
 *
 * 容错策略：
 *   - 数据库未就绪或查询失败 → 返回 null（调用方走默认规则）
 *   - value 损坏或结构异常   → 返回 null
 *
 * @returns 用户配置的确认规则数组；无配置或读取失败返回 null
 */
function loadConfirmRules(): ToolConfirmRule[] | null {
  try {
    const db = getDb()
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(CONFIRM_RULES_KEY) as { value: string } | undefined
    if (!row || !row.value) return null

    const parsed: unknown = JSON.parse(row.value)
    if (!Array.isArray(parsed)) return null

    // 简单结构校验：每项须含 toolName(字符串) 与 requireConfirm(布尔)
    for (const item of parsed) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof (item as ToolConfirmRule).toolName !== 'string' ||
        typeof (item as ToolConfirmRule).requireConfirm !== 'boolean'
      ) {
        return null
      }
    }
    return parsed as ToolConfirmRule[]
  } catch {
    // 数据库未就绪或 JSON 解析失败，回退 null
    return null
  }
}

/**
 * 判断工具是否需要人工确认（Task 32.1；AI Agent v1.5.0 起并入默认只读权限策略）。
 *
 * 判断优先级：
 *   1. 用户在 settings 中配置了该工具的规则 → 以用户配置为准
 *   2. 未配置 → 默认只读策略：权限等级为 write / dangerous 的工具默认需确认（作为授权入口）
 *   3. 未配置且权限等级为 read → 按兼容旧规则：riskLevel 为 high/medium 需确认，low 不需确认
 *   4. 权限等级或 riskLevel 缺失（工具未注册）→ 不需确认
 *
 * 说明：write / dangerous 工具的人工确认弹窗即用户「授权」入口——用户在弹窗中确认后，
 * agent-loop 才向 execute 传递 grants 使工具可执行；确认/超时/用户配置为关闭时视为未授权。
 *
 * @param toolName 工具名
 * @param rules 用户配置的确认规则（可为 null）
 */
function shouldConfirm(
  toolName: string,
  rules: ToolConfirmRule[] | null
): boolean {
  // 1. 用户配置优先
  if (rules) {
    const matched = rules.find((r) => r.toolName === toolName)
    if (matched) {
      return matched.requireConfirm
    }
  }
  // 2. 未配置 → 默认只读策略：write / dangerous 需确认（授权入口）
  const tier = getTier(toolName)
  if (tier === 'write' || tier === 'dangerous') {
    return true
  }
  // 3. 兼容旧规则：read 工具按 riskLevel 决定（high/medium 需确认，low 不需确认）
  const riskLevel = getRiskLevel(toolName)
  if (riskLevel === 'high' || riskLevel === 'medium') {
    return true
  }
  // 4. read 且 low，或权限/风险等级缺失 → 不需确认
  return false
}

// ============================================================
// 主循环
// ============================================================

/**
 * 运行 Agent 对话循环。
 *
 * 流程：
 *   0. 按 sessionId 恢复会话历史与业务上下文（多会话隔离，P0-1 引入）
 *   1. 更新业务上下文（params.context 为最新业务状态，覆盖/合并）
 *   2. 将用户消息加入会话历史（内存 + 按 sessionId 落库）
 *   3. 加载用户工具确认规则（Task 32.1）
 *   4. 循环：
 *      - 调用 chatStream 获取 assistant 消息（流式推送 delta）
 *      - 若无 tool_calls，推送 done 并结束
 *      - 顺序执行所有 tool_calls，结果反馈给会话历史（含落库）
 *        · 工具执行前根据 riskLevel 与 confirm_rules 判断是否需人工确认（Task 32）
 *        · 需确认时推送 tool_call_confirm 事件，暂停等待渲染进程回传结果
 *        · 用户取消或超时 → 将「用户取消了该操作」反馈给 LLM，跳过执行
 *        · 用户确认 → 使用 modifiedArgs（若有）执行
 *      - 继续下一轮，让 LLM 基于工具结果响应
 *   5. 达到 MAX_ITERATIONS 时推送提示并结束
 *   finally：按 sessionId 持久化当前业务上下文
 *
 * 错误处理：
 *   - LLMError：透传 code 与 message 到 onEvent('error')，直接结束
 *   - 工具执行错误：作为 tool_call_result(success=false) 推送，不中断循环
 *   - arguments JSON.parse 失败：用空对象继续，不中断
 *   - 人工确认超时（5 分钟）：视为取消，走取消逻辑
 *   - AbortSignal：chatStream 内部已处理（返回空 message），循环开始处检查并退出
 *
 * @param params 入参
 */

/**
 * 判断工具返回值是否代表「业务失败」。
 * 部分工具把失败封装成「正常返回」的对象（显式声明 success === false 并携带 error 信息），
 * 而非向上抛错。此时 agent-loop 不能再按「未抛错」一律标记 success:true 反馈 LLM，
 * 否则会误导会话把失败当成功。
 *
 * @param result 工具 execute 的返回值
 * @returns true 表示该返回值显式声明了业务失败
 */
function isToolResultFailure(result: unknown): result is Record<string, unknown> {
  if (typeof result !== 'object' || result === null) return false
  return (result as Record<string, unknown>)['success'] === false
}

/**
 * 从失败返回值中提取可反馈给 LLM 的失败信息。
 * 优先取 error.userMessage / error.message（错误对象形式），其次取 error 字符串，
 * 均取不到时回退通用兜底文案。
 */
function extractToolError(result: Record<string, unknown>): string {
  const err = result['error']
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e['userMessage'] === 'string' && e['userMessage']) return e['userMessage']
    if (typeof e['message'] === 'string' && e['message']) return e['message']
  }
  if (typeof err === 'string' && err) return err
  return '工具执行失败'
}

export async function runAgentLoop(params: RunAgentLoopParams): Promise<void> {
  const { userMessage, systemPrompt, context, config, onEvent, signal, sessionId } = params

  try {
    // 0. 恢复会话历史与业务上下文（无 sessionId 时清空内存历史，防止串话）
    // T2：会话历史恢复失败时向前端推 {type:'error'}（复用 agent 事件链路），
    //     而非静默仅 console.error。恢复失败仍继续对话（从空历史开始）。
    restoreSession(sessionId, (msg) =>
      onEvent({ type: 'error', code: 'agent_restore_failed', message: msg })
    )

    // 1. 更新业务上下文（如有）。
    //    注意：restoreSession 已恢复会话持久化的上下文，此处 params.context
    //    是本次请求的最新业务状态（用户可能切换页面/选中新辩题），覆盖/合并之。
    if (context) {
      setContext(sessionId, context)
    }

    // 2. 将用户消息加入会话历史（内存 + 按 sessionId 落库 + 刷新最近消息预览）
    appendMessage(sessionId, { role: 'user', content: userMessage })

    // 3. 获取工具元数据（ToolMeta[]，含 riskLevel）供 chatStream 使用。
    //    list() 返回不含 execute 的元数据数组，直接作为 chatStream 的 tools 入参。
    const tools = list()

    // 3.1 加载用户工具确认规则（Task 32.1：每轮对话加载一次，工具调用时按工具名查找）。
    //     读取失败或无配置时返回 null，由 shouldConfirm 走默认规则（high/medium 需确认）。
    const confirmRules = loadConfirmRules()

    // 4. 主循环
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // 循环开始检查 abort 信号
      if (signal?.aborted) {
        onEvent({ type: 'done' })
        return
      }

    // 构建完整消息列表（含 system prompt）
    const messages = buildLLMMessages(sessionId, systemPrompt)

    // 调用 LLM 流式接口
    let assistantMessage: AssistantMessage
    try {
      assistantMessage = await chatStream(
        messages,
        config,
        tools,
        (deltaText) => {
          onEvent({ type: 'delta', text: deltaText })
        },
        signal
      )
    } catch (err) {
      // LLM 调用错误：透传 code 与 message，直接结束
      if (err instanceof LLMError) {
        onEvent({ type: 'error', code: err.code, message: err.message })
      } else {
        onEvent({
          type: 'error',
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err)
        })
      }
      return
    }

    // 将 assistant 消息加入会话历史（内存 + 按 sessionId 落库，tool_calls 一并持久化）
    appendMessage(sessionId, assistantMessage)

    // 检查是否有 tool_calls：无则对话结束
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      onEvent({ type: 'done' })
      return
    }

    // 顺序执行所有 tool_calls（避免并发问题）
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name

      // 解析工具入参，失败时用空对象继续
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(toolCall.function.arguments || '{}')
      } catch {
        // arguments 解析失败，保留空对象
      }

      // 推送工具调用开始事件
      onEvent({
        type: 'tool_call_start',
        toolCallId: toolCall.id,
        toolName,
        args
      })

      // ---------- Task 32：人工确认前置检查 ----------
      // 根据用户 confirm_rules（优先）与工具 riskLevel（默认）判断是否需确认。
      // 需确认时推送 tool_call_confirm 事件，暂停执行等待渲染进程回传结果。
      let effectiveArgs = args
      if (shouldConfirm(toolName, confirmRules)) {
        // 获取工具描述（用于确认框展示）；工具未注册时回退工具名
        const toolMeta = get(toolName)
        const description = toolMeta?.description ?? toolName

        // Task 32.2：推送人工确认事件给渲染进程
        onEvent({
          type: 'tool_call_confirm',
          toolCallId: toolCall.id,
          toolName,
          args: effectiveArgs,
          description
        })

        // Task 32.3 / 32.4 / 32.7：暂停执行，等待确认结果（含 5 分钟超时）
        const confirmResult = await waitForConfirm(toolCall.id, sessionId)

        // Task 32.6：用户取消（confirmed=false 或超时）→ 将取消信息作为 tool_result 反馈 LLM
        if (!confirmResult.confirmed) {
          onEvent({
            type: 'tool_call_result',
            toolCallId: toolCall.id,
            toolName,
            success: false,
            error: '用户取消了该操作'
          })
          appendMessage(sessionId, {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: '用户取消了该操作'
          })
          // 跳过当前工具执行，继续下一个 tool_call
          continue
        }

        // Task 32.5：用户确认 → 使用 modifiedArgs（若有）执行
        if (confirmResult.modifiedArgs) {
          effectiveArgs = confirmResult.modifiedArgs
        }
      }

      // 执行工具（AI 裁判 2026-08-18：透传 config/signal 供需调用 LLM 的工具使用；
      // governance Task 9：非 read 工具在用户确认后，由主进程创建并登记一次性 grant，
      // 将 grantId 交给 execute 自校验（存在/未过期/session/tool/argsHash/tier 均匹配），
      // 而非仅向 execute 声明 grants。read 工具直接放行，不登记 grant。
      const tier = getTier(toolName)
      // 一次性 grant：绑定归属会话 / 工具 / 实际执行参数 / 授权级别 / 有效期。
      // 用 effectiveArgs（可能被用户在确认框中修改）作为绑定入参，与 execute 实际入参一致。
      const grant = tier !== 'read' ? createGrant({ sessionId, toolName, args: effectiveArgs, tier }) : undefined
      try {
        const result = await execute(toolName, effectiveArgs, {
          config,
          signal,
          sessionId,
          grantId: grant?.grantId
        })
        if (isToolResultFailure(result)) {
          // 工具正常返回但显式声明业务失败（success:false）：视为失败，反馈失败信息给 LLM。
          // 不标成功、不中断循环、不污染会话（与「抛错」路径同语义）。
          const errorMsg = extractToolError(result)
          onEvent({
            type: 'tool_call_result',
            toolCallId: toolCall.id,
            toolName,
            success: false,
            error: errorMsg
          })
          appendMessage(sessionId, {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: errorMsg })
          })
        } else {
          onEvent({
            type: 'tool_call_result',
            toolCallId: toolCall.id,
            toolName,
            success: true,
            result
          })
          // 将工具成功结果加入会话历史（内存 + 按 sessionId 落库）
          appendMessage(sessionId, {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          })
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        onEvent({
          type: 'tool_call_result',
          toolCallId: toolCall.id,
          toolName,
          success: false,
          error: errorMsg
        })
        // 工具失败也将错误信息加入会话历史（内存 + 按 sessionId 落库），让 LLM 决定如何处理
        appendMessage(sessionId, {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: errorMsg })
        })
      }
    }

    // 继续下一轮循环，让 LLM 基于工具结果继续响应
    }

    // 达到最大循环次数，推送提示并结束
    onEvent({ type: 'delta', text: '（已达到最大工具调用次数，停止迭代）' })
    onEvent({ type: 'done' })
  } finally {
    // 无论正常结束 / 错误 / 中止，按 sessionId 持久化当前业务上下文
    persistContext(sessionId)
  }
}
