// ============================================================
// agent-config.ipc.ts — Agent 配置 IPC handler（AI Agent v1.3.0 Week 5 Task 30）
//
// 注册通道：
//   agent:config:get-confirm-rules  读取工具人工确认规则（无配置时返回默认规则）
//   agent:config:set-confirm-rules  保存工具人工确认规则到 settings 表
//
// 设计要点：
//   - 配置持久化在 settings 表，key='agent.confirm_rules'，value 为 JSON 字符串
//   - 沿用项目现有 settings 读写模式（直接 SQL，参考 audit.repo.ts 内 getSetting/setSetting）
//   - 无配置时返回 DEFAULT_CONFIRM_RULES（写操作 requireConfirm=true，读操作=false）
//   - 复用 ipc/utils.ts 的 wrap 函数统一返回 ApiResponse
//   - 严格 TypeScript，避免 any（用 unknown 替代）
// ============================================================

import { ipcMain } from 'electron'
import { getDb } from '../db/index'
import type { ToolConfirmRule } from '../../shared/agent-types'
import { wrap } from './utils'

/**
 * settings 表中存储工具确认规则的 key。
 * 与 agentStore / 设置页保持一致，便于渲染进程直接读取（如需）。
 */
const CONFIRM_RULES_KEY = 'agent.confirm_rules'

/**
 * 默认工具确认规则。
 *
 * 规则：写操作（create_* / draw_*）requireConfirm=true，执行前需用户确认；
 *      读操作（search/get/list）requireConfirm=false，直接执行。
 *
 * 工具名与 src/main/agent/tools/*.tool.ts 中 name 字段对齐：
 *   - search_topics / get_topic_detail / list_events / get_format /
 *     get_current_timer_state  → 读操作，无需确认
 *   - create_topic / create_event / draw_topics              → 写操作，需确认
 */
const DEFAULT_CONFIRM_RULES: ToolConfirmRule[] = [
  { toolName: 'search_topics', requireConfirm: false },
  { toolName: 'get_topic_detail', requireConfirm: false },
  { toolName: 'create_topic', requireConfirm: true },
  { toolName: 'draw_topics', requireConfirm: true },
  { toolName: 'list_events', requireConfirm: false },
  { toolName: 'create_event', requireConfirm: true },
  { toolName: 'get_format', requireConfirm: false },
  { toolName: 'get_current_timer_state', requireConfirm: false }
]

/**
 * 参数校验辅助函数。
 * 校验失败时抛出友好错误，由 wrap 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * 安全 JSON.parse：解析失败时返回 fallback。
 * 用于 confirm_rules 配置的容错反序列化，避免坏数据导致读取失败。
 */
function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * 校验 ToolConfirmRule 数组结构与字段类型。
 * - 顶层数组
 * - 每项含 toolName(非空字符串) 与 requireConfirm(布尔)
 * 校验失败抛错，由 wrap 转 ApiResponse.error。
 */
function assertConfirmRules(value: unknown): asserts value is ToolConfirmRule[] {
  assertParam(Array.isArray(value), '参数 rules 必须为数组')
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    assertParam(item && typeof item === 'object', `参数 rules[${i}] 必须为对象`)
    assertParam(
      typeof (item as ToolConfirmRule).toolName === 'string' &&
        (item as ToolConfirmRule).toolName.length > 0,
      `参数 rules[${i}].toolName 必须为非空字符串`
    )
    assertParam(
      typeof (item as ToolConfirmRule).requireConfirm === 'boolean',
      `参数 rules[${i}].requireConfirm 必须为布尔值`
    )
  }
}

/**
 * 注册 Agent 配置 IPC handler。
 * 在主进程 app.whenReady 之后、createWindow 之前调用（与 registerAgentIpc 同期）。
 */
export function registerAgentConfigIpc(): void {
  // ---------- agent:config:get-confirm-rules ----------
  // 从 settings 表读取 key='agent.confirm_rules'，无配置时返回默认规则
  // 容错：value 损坏或结构异常时回退默认规则，避免阻塞 agent-loop
  ipcMain.handle('agent:config:get-confirm-rules', () =>
    wrap(() => {
      const db = getDb()
      const row = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(CONFIRM_RULES_KEY) as { value: string } | undefined

      if (!row) {
        // 无配置时返回默认规则
        return DEFAULT_CONFIRM_RULES
      }

      const parsed = safeJsonParse<unknown>(row.value, undefined)
      if (!Array.isArray(parsed)) {
        // value 损坏或非数组，回退默认规则
        return DEFAULT_CONFIRM_RULES
      }

      try {
        assertConfirmRules(parsed)
        return parsed
      } catch {
        // 结构不合规，回退默认规则
        return DEFAULT_CONFIRM_RULES
      }
    })
  )

  // ---------- agent:config:set-confirm-rules ----------
  // 入参 { rules: ToolConfirmRule[] }，保存到 settings 表
  // 使用 INSERT OR REPLACE upsert，value 用 JSON.stringify 转字符串
  ipcMain.handle(
    'agent:config:set-confirm-rules',
    (_e, payload: { rules: ToolConfirmRule[] }) =>
      wrap(() => {
        assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
        assertConfirmRules(payload.rules)

        const db = getDb()
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
          CONFIRM_RULES_KEY,
          JSON.stringify(payload.rules)
        )
        return true
      })
  )
}
