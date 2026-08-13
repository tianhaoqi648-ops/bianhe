// ============================================================
// Agent 上下文管理器（AI Agent v1.3.0 - Week 1 Task 4）
//
// 维护 Agent 主进程内的会话历史与当前业务上下文。
// 采用模块级变量（单例模式），主进程内全局共享一份状态。
//
// 职责：
// - 会话历史管理：追加/获取/设置/截断（SubTask 4.1）
// - 业务上下文管理：更新/获取/清空（SubTask 4.2）
// - 统一清空：开始新对话时重置全部状态（SubTask 4.3）
// - 构建 LLM 请求消息：在历史前注入 system 消息
//
// 设计要点：
// - 不持久化（第一期会话不落库，应用重启后清空）
// - 对外返回只读副本，防止外部代码意外修改内部状态
// - 不依赖任何外部库
// ============================================================

import type { AgentContext, Message, SystemMessage } from '@shared/agent-types'

/** 会话历史最大长度（超过则按规则截断） */
const MAX_HISTORY = 20

/** 当前会话历史（模块级单例） */
let messages: Message[] = []

/** 当前业务上下文（模块级单例） */
let context: AgentContext = {}

// ---------- SubTask 4.1：会话历史管理 ----------

/**
 * 追加一条消息到会话历史。
 * - 总长度 ≤ MAX_HISTORY：直接追加
 * - 超过 MAX_HISTORY：保留首条 system 消息（如有）+ 最近 MAX_HISTORY-1 条非 system 消息
 *
 * @param msg 待追加的消息
 */
export function addMessage(msg: Message): void {
  messages.push(msg)

  // 未超限，直接返回
  if (messages.length <= MAX_HISTORY) {
    return
  }

  // 超限：分离首条 system 消息与其余消息
  const first = messages[0]
  const hasLeadingSystem = first !== undefined && first.role === 'system'

  // 非首位的 system 消息在截断时不特殊保留，仅保留首位 system（如有）
  const rest: Message[] = hasLeadingSystem ? messages.slice(1) : messages

  // 保留首位 system + 最近的 MAX_HISTORY-1 条非 system 消息
  const keptRest = rest.slice(-(MAX_HISTORY - 1))

  messages = hasLeadingSystem ? [first, ...keptRest] : keptRest
}

/**
 * 获取当前会话历史（只读副本）。
 * 返回新数组，外部修改不会影响内部状态。
 */
export function getMessages(): Message[] {
  return [...messages]
}

/**
 * 设置完整会话历史（用于从持久化恢复，谨慎使用）。
 * 内部会复制一份，避免外部数组被后续修改影响。
 *
 * @param msgs 新的会话历史
 */
export function setMessages(msgs: Message[]): void {
  messages = [...msgs]
}

// ---------- SubTask 4.2：业务上下文管理 ----------

/**
 * 更新业务上下文（部分更新，类似 setState）。
 * 仅合并传入字段，未传入字段保持原值。
 *
 * 锁定行为（Week 6 Task 33）：
 * - 当 context.locked === true 时，仅追加当前不存在的字段，
 *   已存在字段保持不变（即跳过覆盖）。
 * - 未锁定（默认）时走正常的覆盖合并逻辑。
 *
 * @param partial 待合并的上下文片段
 */
export function setContext(partial: Partial<AgentContext>): void {
  // 上下文已锁定：仅追加当前不存在的字段，已存在字段保持不变
  if (context.locked === true) {
    // 筛选出当前 context 中不存在（值为 undefined）的字段，仅追加这些字段。
    // 注意：null 视为有效值（如 currentTopic=null 表示"无选中辩题"），不视为缺失。
    const additions = Object.fromEntries(
      Object.entries(partial).filter(
        ([key]) => context[key as keyof AgentContext] === undefined
      )
    ) as Partial<AgentContext>
    context = { ...context, ...additions }
    return
  }
  // 未锁定：正常合并（覆盖已存在字段）
  context = { ...context, ...partial }
}

/**
 * 获取当前业务上下文（只读副本）。
 * 返回浅拷贝对象，外部修改不会影响内部状态。
 */
export function getContext(): AgentContext {
  return { ...context }
}

/** 清空业务上下文（重置为空对象，同时清除 locked 状态） */
export function clearContext(): void {
  context = {}
}

// ---------- SubTask 4.3：统一清空 ----------
// ---------- Week 6 Task 33：锁定 / 解锁 ----------

/**
 * 锁定业务上下文。
 * 锁定后 setContext 仅追加当前不存在的字段，不会覆盖已有字段。
 */
export function lock(): void {
  context.locked = true
}

/**
 * 解锁业务上下文。
 * 解锁后 setContext 恢复为正常的覆盖合并行为。
 */
export function unlock(): void {
  context.locked = false
}

/**
 * 清空会话历史与业务上下文，并解锁上下文。
 * 开始新对话时调用。
 *
 * 注：context 重置为 {} 后 locked 字段也随之变为 undefined（falsy），
 * 即等价于解锁状态，无需额外调用 unlock()。
 */
export function clear(): void {
  messages = []
  context = {}
}

// ---------- 辅助方法：构建 LLM 请求消息 ----------

/**
 * 构建发送给 LLM 的完整消息列表。
 * - 在会话历史前插入 system 消息（角色设定 + 上下文摘要）
 * - 如果会话历史首条已是 system 消息，则替换之
 * - 不修改内部 messages，返回新数组
 *
 * @param systemPrompt system 消息内容
 */
export function buildLLMMessages(systemPrompt: string): Message[] {
  const copy = [...messages]

  // 若首条为 system 消息，则移除之
  if (copy.length > 0 && copy[0].role === 'system') {
    copy.shift()
  }

  // 在开头插入新的 system 消息
  const systemMessage: SystemMessage = {
    role: 'system',
    content: systemPrompt
  }

  return [systemMessage, ...copy]
}
