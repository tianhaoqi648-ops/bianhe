// ============================================================
// tool-registry.ts — Agent 工具注册中心（AI Agent v1.3.0 Week 1 Task 3）
//
// 提供工具的注册、查询、列出、执行与 OpenAI tools 格式转换能力。
// 主进程在启动时调用 register() 注册各业务工具；agent-loop 在
// 每轮对话前调用 toOpenAITools() 拼装 LLM 请求参数，并在收到
// tool_call 后调用 execute() 执行对应工具。
//
// 设计要点：
//   1. 使用模块级 Map<string, ToolDefinition> 存储工具，进程内单例
//   2. get/list 返回 ToolMeta（剥离 execute），避免 IPC 序列化函数
//   3. getDefinition 返回完整定义（含 execute），仅供主进程内部使用
//   4. execute 透传工具抛出的原始错误，由 agent-loop 捕获并作为
//      tool_result(success=false) 反馈给 LLM
//   5. 不依赖任何外部库
// ============================================================

import { createHash, randomUUID } from 'node:crypto'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolGrant,
  ToolMeta,
  ToolPermissionTier,
  ToolRiskLevel,
  ToolSchema
} from '@shared/agent-types'

// ============================================================
// 模块内工具存储（进程内单例）
// ============================================================

const tools = new Map<string, ToolDefinition>()

// ============================================================
// 注册 / 查询 / 列出
// ============================================================

/**
 * 注册一个工具。
 * 若同名工具已存在，将覆盖旧定义（用于热重载或运行时替换场景）。
 * @param tool 完整工具定义（含 execute）
 */
export function register(tool: ToolDefinition): void {
  tools.set(tool.name, tool)
}

/**
 * 按名称获取工具元数据（不含 execute，用于序列化与 IPC 传输）。
 * @param name 工具名
 * @returns 工具元数据；不存在时返回 undefined
 */
export function get(name: string): ToolMeta | undefined {
  const tool = tools.get(name)
  if (!tool) {
    return undefined
  }
  // 剥离 execute 函数，仅保留可序列化的元数据字段
  const { execute: _execute, ...meta } = tool
  return meta
}

/**
 * 按名称获取完整工具定义（含 execute，主进程内部使用）。
 * @param name 工具名
 * @returns 完整工具定义；不存在时返回 undefined
 */
export function getDefinition(name: string): ToolDefinition | undefined {
  return tools.get(name)
}

/**
 * 按名称获取工具风险等级（用于判断是否需要人工确认）。
 * @param toolName 工具名
 * @returns 风险等级；工具不存在时返回 undefined
 */
export function getRiskLevel(toolName: string): ToolRiskLevel | undefined {
  return tools.get(toolName)?.riskLevel
}

/**
 * 按名称获取工具权限等级（默认只读策略，AI Agent v1.5.0）。
 * @param toolName 工具名
 * @returns 权限等级；工具不存在或未声明时回退 'read'（缺省只读）
 */
export function getTier(toolName: string): ToolPermissionTier {
  return tools.get(toolName)?.tier ?? 'read'
}

/**
 * 列出所有已注册工具的元数据（不含 execute）。
 * @returns 工具元数据数组
 */
export function list(): ToolMeta[] {
  const result: ToolMeta[] = []
  for (const tool of tools.values()) {
    const { execute: _execute, ...meta } = tool
    result.push(meta)
  }
  return result
}

// ============================================================
// 执行（含一次性 grant 权限门控，governance Task 9）
// ============================================================

/** 权限拒绝错误：write / dangerous 工具未获有效授权时抛出（execute 调用方应捕获处理） */
export class ToolPermissionError extends Error {
  /** 错误码（供 IPC 层映射为 permission_denied） */
  readonly code = 'permission_denied' as const
  /** 被拒绝的工具名 */
  readonly toolName: string
  /** 该工具要求的权限等级 */
  readonly tier: ToolPermissionTier
  /** 拒绝的具体原因（governance Task 9：缺失/过期/不匹配等） */
  readonly reason?: string
  /** 授权方式说明（如何获得授权以放行） */
  readonly howToGrant = '请在工具确认弹窗中确认执行该工具以临时授权，或在设置页关闭其确认要求。'

  constructor(toolName: string, tier: ToolPermissionTier, reason?: string) {
    const why = reason ? `（${reason}）` : ''
    super(
      `工具「${toolName}」属于 ${tier} 级别，当前未授权执行${why}。${'请在确认弹窗/设置页授予该权限后再试。'}`
    )
    this.name = 'ToolPermissionError'
    this.toolName = toolName
    this.tier = tier
    this.reason = reason
  }
}

// ------------------------------------------------------------
// 一次性 grant 登记处（governance Task 9）
// ------------------------------------------------------------

/**
 * 一次性 grant 默认有效期（毫秒）。
 * 用户确认后到工具真正执行只差一个 await，给予充足余量但仍是"一次性窗口"。
 */
const DEFAULT_GRANT_TTL_MS = 60_000

/** grantId → ToolGrant 的登记表（进程内单例，仅主进程持有） */
const grantRegistry = new Map<string, ToolGrant>()

/**
 * 对工具入参计算稳定哈希（供 grant 绑定参数，防止调用时参数被偷换）。
 * 使用 node:crypto SHA-256，取前 16 位十六进制作为短指纹。
 */
export function hashArgs(args: Record<string, unknown>): string {
  // 稳定序列化：JSON.stringify 对同一对象键序确定；不同调用间若键序不同仍可绑死
  // 本次实际执行所传入的 args（createGrant 与 execute 使用同一 effectiveArgs 对象）。
  const repr = JSON.stringify(args ?? {})
  return createHash('sha256').update(repr).digest('hex').slice(0, 16)
}

/**
 * 创建并登记一个一次性授权 grant（由主进程在用户授权后调用）。
 *
 * grant 至少绑定：归属会话、目标工具、入参哈希、授权级别、过期时间。
 * execute() 在 write / dangerous 工具执行前据此校验，校验通过即一次性消费（自动作废），
 * 从而无法被调用方伪造或重放。
 *
 * @param input 授权来源信息
 * @returns 登记后的 ToolGrant（含生成/产生的 grantId、argsHash、expiresAt）
 */
export function createGrant(input: {
  sessionId?: string
  toolName: string
  args: Record<string, unknown>
  tier: ToolPermissionTier
  /** 有效期（毫秒），缺省取 DEFAULT_GRANT_TTL_MS；传负值可用作测试"已过期" */
  ttlMs?: number
}): ToolGrant {
  const ttl = input.ttlMs ?? DEFAULT_GRANT_TTL_MS
  const grant: ToolGrant = {
    grantId: randomUUID(),
    sessionId: input.sessionId,
    toolName: input.toolName,
    argsHash: hashArgs(input.args),
    tier: input.tier,
    expiresAt: Date.now() + ttl
  }
  grantRegistry.set(grant.grantId, grant)
  return grant
}

/**
 * 主动作废一个 grant（从登记处移除；已过期/已消费的 grant 也应在 lookup 时被过滤）。
 */
export function revokeGrant(grantId: string): void {
  grantRegistry.delete(grantId)
}

/** 清空登记处（仅用于测试） */
export function clearGrants(): void {
  grantRegistry.clear()
}

/**
 * 校验提供给某 write/dangerous 工具的一次性 grant 是否有效。
 * 返回 undefined 表示校验通过；否则返回拒绝原因（供 ToolPermissionError.reason 使用）。
 *
 * 校验项（缺一不可）：
 *   1. 提供了 grantId（不再信任调用方自行声明 tier/grants）
 *   2. 登记处存在该 grant 且尚未被消费（一次性）
 *   3. 未过期（expiresAt > now）
 *   4. grant.toolName 与目标工具一致
 *   5. grant.tier 与目标工具要求的 tier 一致
 *   6. grant.argsHash 与本次实际入参哈希一致
 *   7. 若提供了 ctx.sessionId，需与 grant.sessionId 一致
 */
function grantFailureReason(
  toolName: string,
  tier: ToolPermissionTier,
  args: Record<string, unknown>,
  ctx?: ToolExecutionContext
): string | undefined {
  const grantId = ctx?.grantId
  if (!grantId) return '未提供授权凭证（grantId）'
  const grant = grantRegistry.get(grantId)
  if (!grant) return '授权凭证不存在或已使用（一次性 grant 已被消费/作废）'
  if (Date.now() > grant.expiresAt) return '授权凭证已过期'
  if (grant.toolName !== toolName) {
    return `授权凭证绑定的工具「${grant.toolName}」与本次调用「${toolName}」不一致`
  }
  if (grant.tier !== tier) return `授权凭证级别(${grant.tier})不足以执行 ${tier} 级工具`
  if (grant.argsHash !== hashArgs(args)) return '授权凭证绑定的参数与本次调用不一致'
  if (ctx?.sessionId != null && grant.sessionId != null && ctx.sessionId !== grant.sessionId) {
    return '授权凭证归属的会话与本次调用不一致'
  }
  return undefined
}

/**
 * 执行工具（含一次性 grant 权限门控）。
 *
 * 权限策略（governance Task 9）：
 *   - read 工具：直接放行，无需授权
 *   - write / dangerous 工具：须提供主进程登记的有效一次性 grant（ctx.grantId 指向
 *     该工具、入参哈希匹配、未过期、会话归属一致的 ToolGrant），否则抛出 ToolPermissionError，
 *     并说明拒绝原因；校验通过后该 grant 一次性消费（从登记处移除）。
 *     不再信任调用方在 ctx.grants 中自行声明的 tier。
 *   - 工具不存在时抛 `Tool not found: ${name}`
 *   - 工具 execute 抛错时透传原始错误
 *
 * @param name 工具名
 * @param args 入参（来自 LLM 的 tool_call.arguments 解析后）
 * @param ctx 执行上下文（可选；含 LLM 配置 / 取消信号 / 一次性授权 grantId / 归属会话）
 * @returns 工具执行结果
 * @throws ToolPermissionError 未授权或 grant 无效时抛出；工具不存在或 execute 抛错时透传原始错误
 */
export async function execute(
  name: string,
  args: Record<string, unknown>,
  ctx?: ToolExecutionContext
): Promise<unknown> {
  const tool = tools.get(name)
  if (!tool) {
    throw new Error(`Tool not found: ${name}`)
  }
  // 一次性 grant 门控：read 放行；write / dangerous 须提供有效 grant，校验含原因说明
  const tier = tool.tier ?? 'read'
  if (tier !== 'read') {
    const reason = grantFailureReason(name, tier, args, ctx)
    if (reason) {
      throw new ToolPermissionError(name, tier, reason)
    }
    // 校验通过 → 一次性消费该 grant，防止重放
    if (ctx?.grantId) {
      grantRegistry.delete(ctx.grantId)
    }
  }
  // 入参为空对象 {} 时正常传递（部分工具无入参）；
  // 工具内部抛错时透传原始错误，由 agent-loop 捕获处理
  return await tool.execute(args, ctx)
}

// ============================================================
// OpenAI tools 格式转换
// ============================================================

/**
 * 转换为 OpenAI Chat Completions API 的 tools 参数格式。
 * @returns OpenAI function calling 格式的工具数组
 */
export function toOpenAITools(): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: ToolSchema }
}> {
  const result: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: ToolSchema }
  }> = []
  for (const tool of tools.values()) {
    result.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    })
  }
  return result
}

// ============================================================
// 辅助方法
// ============================================================

/**
 * 清空所有已注册工具（仅用于测试）。
 */
export function clear(): void {
  tools.clear()
  clearGrants()
}
