// ============================================================
// Agent 上下文管理器（AI Agent v1.3.0 - Week 1 Task 4）
//
// 维护 Agent 主进程内的会话历史与当前业务上下文。
// 2026-08-18 改造：**按 sessionId 隔离**（支持切换会话不中断回复、多会话并发）。
// 存储结构：Map<sessionId, { messages: Message[]; context: AgentContext }>，
// 无 sessionId 时落到 '__default__' key（兼容无会话/测试场景）。
//
// 职责：
// - 会话历史管理：追加/获取/设置/截断（SubTask 4.1）
// - 业务上下文管理：更新/获取/清空（SubTask 4.2）
// - 统一清空：开始新对话时重置全部状态（SubTask 4.3）
// - 构建 LLM 请求消息：在历史前注入 system 消息
//
// 设计要点：
// - 不持久化（会话不落库，应用重启后清空）
// - 对外返回只读副本，防止外部代码意外修改内部状态
// - 不依赖任何外部库
// ============================================================

import type { AgentContext, Message, SystemMessage } from '@shared/agent-types'

/** 会话历史最大长度（超过则按规则截断） */
const MAX_HISTORY = 20

/** 无 sessionId 时的默认 key */
const DEFAULT_KEY = '__default__'

/** 每会话状态（会话历史 + 业务上下文） */
interface SessionState {
  messages: Message[]
  context: AgentContext
}

/** 按会话隔离的状态存储（模块级单例） */
const states = new Map<string, SessionState>()

/** 取指定会话的状态对象（不存在时创建空状态） */
function getState(sessionId: string | undefined): SessionState {
  const key = sessionId ?? DEFAULT_KEY
  let state = states.get(key)
  if (!state) {
    state = { messages: [], context: {} }
    states.set(key, state)
  }
  return state
}

/** 删除指定会话的状态（手动清除，如会话被删除时） */
export function resetSession(sessionId: string | undefined): void {
  if (sessionId === undefined) {
    states.delete(DEFAULT_KEY)
    return
  }
  states.delete(sessionId)
}

// ---------- SubTask 4.1：会话历史管理 ----------

/**
 * 追加一条消息到指定会话历史。
 * - 总长度 ≤ MAX_HISTORY：直接追加
 * - 超过 MAX_HISTORY：保留首条 system 消息（如有）+ 最近 MAX_HISTORY-1 条非 system 消息
 *
 * @param sessionId 会话 id（可选，无则用默认）
 * @param msg 待追加的消息
 */
export function addMessage(sessionId: string | undefined, msg: Message): void {
  const state = getState(sessionId)
  state.messages.push(msg)

  // 未超限，直接返回
  if (state.messages.length <= MAX_HISTORY) {
    return
  }

  // 超限：分离首条 system 消息与其余消息
  const first = state.messages[0]
  const hasLeadingSystem = first !== undefined && first.role === 'system'

  // 非首位的 system 消息在截断时不特殊保留，仅保留首位 system（如有）
  const rest: Message[] = hasLeadingSystem ? state.messages.slice(1) : state.messages

  // 保留首位 system + 最近的 MAX_HISTORY-1 条非 system 消息
  const keptRest = rest.slice(-(MAX_HISTORY - 1))

  state.messages = hasLeadingSystem ? [first, ...keptRest] : keptRest
}

/**
 * 获取指定会话历史（只读副本）。
 * 返回新数组，外部修改不会影响内部状态。
 */
export function getMessages(sessionId: string | undefined): Message[] {
  return [...getState(sessionId).messages]
}

/**
 * 设置指定会话的完整历史（用于从持久化恢复，谨慎使用）。
 * 内部会复制一份，避免外部数组被后续修改影响。
 *
 * @param sessionId 会话 id（可选，无则用默认）
 * @param msgs 新的会话历史
 */
export function setMessages(sessionId: string | undefined, msgs: Message[]): void {
  const state = getState(sessionId)
  state.messages = [...msgs]
}

// ---------- SubTask 4.2：业务上下文管理 ----------

/**
 * 更新指定会话的业务上下文（部分更新，类似 setState）。
 * 仅合并传入字段，未传入字段保持原值。
 *
 * 锁定行为（Week 6 Task 33）：
 * - 当 context.locked === true 时，仅追加当前不存在的字段，
 *   已存在字段保持不变（即跳过覆盖）。
 * - 未锁定（默认）时走正常的覆盖合并逻辑。
 *
 * @param sessionId 会话 id（可选，无则用默认）
 * @param partial 待合并的上下文片段
 */
export function setContext(sessionId: string | undefined, partial: Partial<AgentContext>): void {
  const state = getState(sessionId)
  const { context } = state
  // 上下文已锁定：仅追加当前不存在的字段，已存在字段保持不变
  if (context.locked === true) {
    // 筛选出当前 context 中不存在（值为 undefined）的字段，仅追加这些字段。
    // 注意：null 视为有效值（如 currentTopic=null 表示"无选中辩题"），不视为缺失。
    const additions = Object.fromEntries(
      Object.entries(partial).filter(
        ([key]) => context[key as keyof AgentContext] === undefined
      )
    ) as Partial<AgentContext>
    state.context = { ...context, ...additions }
    return
  }
  // 未锁定：正常合并（覆盖已存在字段）
  state.context = { ...context, ...partial }
}

/**
 * 获取指定会话的业务上下文（只读副本）。
 * 返回浅拷贝对象，外部修改不会影响内部状态。
 */
export function getContext(sessionId: string | undefined): AgentContext {
  return { ...getState(sessionId).context }
}

/** 清空指定会话的业务上下文（重置为空对象，同时清除 locked 状态） */
export function clearContext(sessionId: string | undefined): void {
  const state = getState(sessionId)
  state.context = {}
}

// ---------- SubTask 4.3：统一清空 ----------
// ---------- Week 6 Task 33：锁定 / 解锁 ----------

/**
 * 锁定指定会话的业务上下文。
 * 锁定后 setContext 仅追加当前不存在的字段，不会覆盖已有字段。
 */
export function lock(sessionId: string | undefined): void {
  const state = getState(sessionId)
  state.context.locked = true
}

/**
 * 解锁指定会话的业务上下文。
 * 解锁后 setContext 恢复为正常的覆盖合并行为。
 */
export function unlock(sessionId: string | undefined): void {
  const state = getState(sessionId)
  state.context.locked = false
}

/**
 * 清空指定会话的会话历史与业务上下文，并解锁上下文。
 * 开始新对话时调用。
 *
 * 注：context 重置为 {} 后 locked 字段也随之变为 undefined（falsy），
 * 即等价于解锁状态，无需额外调用 unlock()。
 */
export function clear(sessionId: string | undefined): void {
  const state = getState(sessionId)
  state.messages = []
  state.context = {}
}

// ---------- 辅助方法：构建 LLM 请求消息 ----------

/**
 * 构建发送给 LLM 的完整消息列表。
 * - 在指定会话历史前插入 system 消息（角色设定 + 上下文摘要）
 * - 如果会话历史首条已是 system 消息，则替换之
 * - 不修改内部 messages，返回新数组
 *
 * @param sessionId 会话 id（可选，无则用默认）
 * @param systemPrompt system 消息内容
 */
export function buildLLMMessages(sessionId: string | undefined, systemPrompt: string): Message[] {
  const copy = [...getState(sessionId).messages]

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
