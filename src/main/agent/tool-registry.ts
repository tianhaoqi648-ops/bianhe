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

import type {
  PermissionGrant,
  ToolDefinition,
  ToolExecutionContext,
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
// 执行（含默认只读权限门控，AI Agent v1.5.0）
// ============================================================

/** 权限拒绝错误：write / dangerous 工具未获授权时抛出（execute 调用方应捕获处理） */
export class ToolPermissionError extends Error {
  /** 错误码（供 IPC 层映射为 permission_denied） */
  readonly code = 'permission_denied' as const
  /** 被拒绝的工具名 */
  readonly toolName: string
  /** 该工具要求的权限等级 */
  readonly tier: ToolPermissionTier
  /** 授权方式说明（如何获得授权以放行） */
  readonly howToGrant = '请在工具确认弹窗中确认执行该工具以临时授权，或在设置页关闭其确认要求。'

  constructor(toolName: string, tier: ToolPermissionTier) {
    super(
      `工具「${toolName}」属于 ${tier} 级别，当前未授权执行。${'请在确认弹窗/设置页授予该权限后再试。'}`
    )
    this.name = 'ToolPermissionError'
    this.toolName = toolName
    this.tier = tier
  }
}

/**
 * 判断一次调用是否已获得某 write/dangerous 工具的授权。
 * @param grants 调用方声明的授权列表
 * @param toolName 目标工具名
 * @param tier 目标工具权限等级
 */
function isGranted(
  grants: PermissionGrant[] | undefined,
  toolName: string,
  tier: ToolPermissionTier
): boolean {
  if (!grants || grants.length === 0) return false
  return grants.some(
    (g) => (g.toolName != null && g.toolName === toolName) || (g.tier != null && g.tier === tier)
  )
}

/**
 * 执行工具（含默认只读权限门控）。
 *
 * 权限策略：
 *   - read 工具：直接放行，无需授权
 *   - write / dangerous 工具：须在 ctx.grants 中声明已获授权，否则抛出 ToolPermissionError
 *     （不执行工具体，返回权限拒绝错误）
 *   - 工具不存在时抛 `Tool not found: ${name}`
 *   - 工具 execute 抛错时透传原始错误
 *
 * @param name 工具名
 * @param args 入参（来自 LLM 的 tool_call.arguments 解析后）
 * @param ctx 执行上下文（可选；含 LLM 配置 / 取消信号 / 授权声明 grants）
 * @returns 工具执行结果
 * @throws ToolPermissionError 未授权时抛出；工具不存在或 execute 抛错时透传原始错误
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
  // 默认只读门控：read 放行；write / dangerous 未授权即拒绝（不执行）
  const tier = tool.tier ?? 'read'
  if (tier !== 'read' && !isGranted(ctx?.grants, name, tier)) {
    throw new ToolPermissionError(name, tier)
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
}
