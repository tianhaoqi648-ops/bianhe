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
  ChatEvent,
  LLMConfig,
  AgentContext,
  AssistantMessage,
  ToolConfirmRule,
  ToolConfirmResult
} from '@shared/agent-types'
import { chatStream, LLMError } from './llm-client'
import { list, execute, getRiskLevel, get } from './tool-registry'
import {
  addMessage,
  buildLLMMessages,
  setContext
} from './context-manager'
import { getDb } from '../db/index'

// ============================================================
// 类型定义
// ============================================================

/** 流式事件回调类型 */
export type AgentEventCallback = (event: ChatEvent) => void

/** runAgentLoop 入参 */
export interface RunAgentLoopParams {
  /** 用户本次输入的文本 */
  userMessage: string
  /** 系统提示词（由调用方传入，解耦 prompt-templates） */
  systemPrompt: string
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
// Task 32：人工确认机制
//
// 通过模块级 Map 维护 toolCallId → { resolve } 的待确认映射。
// 渲染进程在用户点击「确认/取消」后通过 ipcRenderer.invoke('agent:confirm-result', result)
// 回传 ToolConfirmResult，主进程收到后从 Map 取出对应 Promise 并 resolve。
// ipcMain.handle 在模块加载时注册一次（模块级布尔标志避免重复注册）。
// ============================================================

/** 待确认工具调用的 Promise 解析器 */
interface PendingConfirm {
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
 *
 * @param toolCallId 工具调用 ID（用于匹配渲染进程回传的结果）
 * @returns 确认结果（confirmed=true/false，可能含 modifiedArgs）
 */
function waitForConfirm(toolCallId: string): Promise<ToolConfirmResult> {
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
    pendingConfirms.set(toolCallId, { resolve: wrappedResolve })

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
 * 判断工具是否需要人工确认（Task 32.1）。
 *
 * 判断优先级：
 *   1. 用户在 settings 中配置了该工具的规则 → 以用户配置为准
 *   2. 未配置 → 按默认规则：riskLevel 为 high/medium 需确认，low 不需确认
 *   3. riskLevel 缺失（工具未注册或未声明风险等级）→ 不需确认
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
  // 2. 未配置 → 按默认规则：high/medium 需确认，low 不需确认
  const riskLevel = getRiskLevel(toolName)
  if (riskLevel === 'high' || riskLevel === 'medium') {
    return true
  }
  // 3. low 或缺失 → 不需确认
  return false
}

// ============================================================
// 主循环
// ============================================================

/**
 * 运行 Agent 对话循环。
 *
 * 流程：
 *   1. 更新业务上下文（如有）
 *   2. 将用户消息加入会话历史
 *   3. 加载用户工具确认规则（Task 32.1）
 *   4. 循环：
 *      - 调用 chatStream 获取 assistant 消息（流式推送 delta）
 *      - 若无 tool_calls，推送 done 并结束
 *      - 顺序执行所有 tool_calls，结果反馈给会话历史
 *        · 工具执行前根据 riskLevel 与 confirm_rules 判断是否需人工确认（Task 32）
 *        · 需确认时推送 tool_call_confirm 事件，暂停等待渲染进程回传结果
 *        · 用户取消或超时 → 将「用户取消了该操作」反馈给 LLM，跳过执行
 *        · 用户确认 → 使用 modifiedArgs（若有）执行
 *      - 继续下一轮，让 LLM 基于工具结果响应
 *   5. 达到 MAX_ITERATIONS 时推送提示并结束
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
export async function runAgentLoop(params: RunAgentLoopParams): Promise<void> {
  const { userMessage, systemPrompt, context, config, onEvent, signal } = params

  // 1. 更新业务上下文（如有）
  if (context) {
    setContext(context)
  }

  // 2. 将用户消息加入会话历史
  addMessage({ role: 'user', content: userMessage })

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
    const messages = buildLLMMessages(systemPrompt)

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

    // 将 assistant 消息加入会话历史
    addMessage(assistantMessage)

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
        const confirmResult = await waitForConfirm(toolCall.id)

        // Task 32.6：用户取消（confirmed=false 或超时）→ 将取消信息作为 tool_result 反馈 LLM
        if (!confirmResult.confirmed) {
          onEvent({
            type: 'tool_call_result',
            toolCallId: toolCall.id,
            toolName,
            success: false,
            error: '用户取消了该操作'
          })
          addMessage({
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

      // 执行工具
      try {
        const result = await execute(toolName, effectiveArgs)
        onEvent({
          type: 'tool_call_result',
          toolCallId: toolCall.id,
          toolName,
          success: true,
          result
        })
        // 将工具成功结果加入会话历史
        addMessage({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        onEvent({
          type: 'tool_call_result',
          toolCallId: toolCall.id,
          toolName,
          success: false,
          error: errorMsg
        })
        // 工具失败也将错误信息加入会话历史，让 LLM 决定如何处理
        addMessage({
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
}
