// ============================================================
// run-tool.ts — AI 裁判工作台直接调工具（2026-08-18）
//
// 纯逻辑模块（无 electron 依赖，便于单测）：
// 为「AI 裁判」独立页面提供直接调用 5 个裁判工具的能力，
// 绕过 agent-loop 聊天流（LLM 选工具），表单直接执行。
//
// 安全设计：
//   - 白名单：只允许 5 个裁判工具（全部 riskLevel='low'，只读不写库），
//     其他工具一律拒绝——防止绕过聊天流的高风险人工确认机制误调写库工具。
//   - config.apiKey 必填（LLM 配置由渲染进程下发）。
//   - signal 支持取消（页面「取消」按钮）。
// ============================================================

import type { RunToolRequest, RunToolResult } from '@shared/agent-types'
import { getDefinition, execute, ToolPermissionError } from '../agent/tool-registry'

/** 裁判工具白名单（AI 裁判工作台可直调；2026-08-18 移除 rewrite_speech） */
export const JUDGE_TOOL_NAMES: string[] = [
  'judge_match',
  'judge_debate',
  'judge_speech',
  'coach_match',
  'detect_stage',
  'simulate_opponent',
  'judge_live'
]

/**
 * 直接执行裁判工具（白名单 + 参数校验 + 异常兜底）。
 *
 * @param req 请求（toolName/args/config/sessionId）
 * @param signal 取消信号（页面「取消」按钮 abort）
 * @returns 结构化结果（不抛错）
 */
export async function runJudgeTool(
  req: RunToolRequest,
  signal?: AbortSignal
): Promise<RunToolResult> {
  // 1. 白名单校验：只允许 5 个裁判工具
  if (!JUDGE_TOOL_NAMES.includes(req.toolName)) {
    return {
      success: false,
      code: 'forbidden_tool',
      message: `工具「${req.toolName}」不在裁判工作台白名单内`
    }
  }

  // 2. LLM 配置校验（与 agent:chat 一致：渲染层下发 config）
  if (!req.config || !req.config.apiKey) {
    return {
      success: false,
      code: 'no_api_key',
      message: '未配置 API Key，请先在设置页「AI 助手」中配置'
    }
  }

  // 3. 工具存在性校验
  const definition = getDefinition(req.toolName)
  if (!definition) {
    return {
      success: false,
      code: 'not_found',
      message: `工具「${req.toolName}」未注册`
    }
  }

  // 4. 执行工具（透传 config/signal，供裁判工具内部调 LLM 与支持取消）。
  //    用户在本页面显式点选工具即视为授权，故以 toolName 声明 grants，
  //    满足默认只读权限门控（裁判工具多为 dangerous 级外部网络调用）。
  try {
    const data = await execute(req.toolName, req.args ?? {}, {
      config: req.config,
      signal,
      grants: [{ toolName: req.toolName }]
    })
    // 取消优先判定（工具可能内部处理 abort 返回部分结果）
    if (signal?.aborted) {
      return { success: false, code: 'cancelled', message: '已取消' }
    }
    return { success: true, code: 'ok', data }
  } catch (err) {
    if (signal?.aborted) {
      return { success: false, code: 'cancelled', message: '已取消' }
    }
    // 权限拒绝：返回 permission_denied 码并附授权方式说明
    if (err instanceof ToolPermissionError) {
      return {
        success: false,
        code: 'permission_denied',
        message: err.message
      }
    }
    return {
      success: false,
      code: 'error',
      message: err instanceof Error ? err.message : String(err)
    }
  }
}
