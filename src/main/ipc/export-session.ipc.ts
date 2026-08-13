// ============================================================
// export-session.ipc.ts — Agent 会话导出 IPC handler（AI Agent v1.3.0 Week 7 Task 46）
//
// 注册通道：
//   agent:export-session  导出 Agent 会话为 Markdown / JSON 文件
//
// 设计要点：
//   - 复用 ipc/utils.ts 的 wrap 函数包裹同步段（参数校验 + 加载 + 渲染），
//     与 agent-session.ipc.ts 风格一致；异步段（dialog + writeFile）使用 try-catch 兜底
//   - Markdown 格式按 spec：标题 + 时间戳 + 消息流（用户/助手/工具调用）
//   - JSON 格式输出完整 { session, messages } 结构
//   - 系统消息（role='system'）跳过；tool_result 消息附在对应 tool_call 后（按 toolCallId 匹配）
//   - 使用 fs.promises.writeFile 异步写入，避免阻塞主进程
// ============================================================

import { ipcMain, dialog, app } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { agentSessionRepo } from '../db/repository/agent-session.repo'
import { agentMessageRepo } from '../db/repository/agent-message.repo'
import type {
  AgentSession,
  AgentMessageRecord
} from '../../shared/agent-types'
import type { ApiResponse } from '../../shared/types'
import { wrap, getActiveWindow } from './utils'

/**
 * 参数校验辅助函数。
 * 校验失败时抛出友好错误，由 wrap 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/** 校验非空字符串 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

/** 导出会话入参 */
interface ExportSessionPayload {
  sessionId: string
  format: 'markdown' | 'json'
}

/** 导出会话结果 */
interface ExportSessionResult {
  filePath: string
  size: number
}

/** 同步段产出：会话 + 已渲染好的文件内容 */
interface RenderContext {
  session: AgentSession
  content: string
}

/**
 * 把会话与消息列表渲染为 Markdown 字符串。
 *
 * 格式参考：
 *   # {title}
 *
 *   > 创建时间：{createdAt}
 *   > 最后更新：{updatedAt}
 *
 *   ---
 *
 *   ## 用户 / ## 助手 / ### 工具调用
 *
 * - 系统消息（role='system'）跳过
 * - tool_result 消息附在对应 tool_call 后（按 toolCallId 匹配，单独不输出段落）
 */
function renderMarkdown(session: AgentSession, messages: AgentMessageRecord[]): string {
  const lines: string[] = []
  lines.push(`# ${session.title}`)
  lines.push('')
  lines.push(`> 创建时间：${session.createdAt}`)
  lines.push(`> 最后更新：${session.updatedAt}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // 构建 toolCallId -> toolResult 映射，便于 tool_call 渲染时附上对应结果
  const toolResultMap = new Map<
    string,
    { success: boolean; result?: unknown; error?: string }
  >()
  for (const msg of messages) {
    if (msg.role === 'tool_result' && msg.toolResults) {
      for (const r of msg.toolResults) {
        toolResultMap.set(r.toolCallId, {
          success: r.success,
          result: r.result,
          error: r.error
        })
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === 'system') continue

    if (msg.role === 'user') {
      lines.push('## 用户')
      lines.push(msg.content || '')
      lines.push('')
    } else if (msg.role === 'assistant') {
      lines.push('## 助手')
      lines.push(msg.content || '(无文本内容)')
      lines.push('')
    } else if (msg.role === 'tool_call') {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          lines.push(`### 工具调用：${tc.function.name}`)
          // function.arguments 已是 JSON 字符串，直接展示
          lines.push(`- 入参：${tc.function.arguments}`)
          const result = toolResultMap.get(tc.id)
          if (result) {
            const resultStr = result.success
              ? JSON.stringify(result.result)
              : `错误：${result.error ?? '未知错误'}`
            lines.push(`- 结果：${resultStr}`)
          }
          lines.push('')
        }
      }
    }
    // tool_result 已合并到对应 tool_call 渲染，此处跳过
  }

  return lines.join('\n')
}

/**
 * 把会话与消息列表渲染为 JSON 字符串（完整结构）。
 * 输出格式：{ "session": AgentSession, "messages": AgentMessageRecord[] }
 */
function renderJson(session: AgentSession, messages: AgentMessageRecord[]): string {
  return JSON.stringify({ session, messages }, null, 2)
}

/**
 * 注册 Agent 会话导出 IPC handler。
 * 在主进程 app.whenReady 之后、createWindow 之前调用（与 registerAgentSessionIpc 同期）。
 */
export function registerExportSessionIpc(): void {
  // ---------- agent:export-session ----------
  // 入参 { sessionId: string; format: 'markdown' | 'json' }
  // 返回 { success: true, data: { filePath, size } } 或 { success: true, data: null }（用户取消）
  ipcMain.handle(
    'agent:export-session',
    async (
      _e,
      payload: ExportSessionPayload
    ): Promise<ApiResponse<ExportSessionResult>> => {
      // 同步段：参数校验 + 加载会话 + 渲染内容（用 wrap 统一错误处理）
      const renderResult = wrap((): RenderContext => {
        assertParam(payload && typeof payload === 'object', '参数 payload 必须为对象')
        assertNonEmptyString(payload.sessionId, 'sessionId')
        assertParam(
          payload.format === 'markdown' || payload.format === 'json',
          '参数 format 必须为 markdown 或 json'
        )

        const session = agentSessionRepo.get(payload.sessionId)
        if (!session) {
          throw new Error('会话不存在')
        }
        const messages = agentMessageRepo.listBySession(payload.sessionId)

        const content =
          payload.format === 'markdown'
            ? renderMarkdown(session, messages)
            : renderJson(session, messages)

        return { session, content }
      })

      if (!renderResult.success) {
        return { success: false, error: renderResult.error }
      }

      const { session, content } = renderResult.data as RenderContext

      // 异步段：弹保存对话框 + 写文件（try-catch 兜底）
      try {
        const win = getActiveWindow()
        if (!win) {
          return { success: false, error: '无可用窗口' }
        }

        const ext = payload.format === 'markdown' ? 'md' : 'json'
        // 生成 yyyyMMddHHmm 格式时间戳后缀，避免同名会话导出文件相互覆盖
        const now = new Date()
        const ts =
          `${now.getFullYear()}` +
          `${String(now.getMonth() + 1).padStart(2, '0')}` +
          `${String(now.getDate()).padStart(2, '0')}` +
          `${String(now.getHours()).padStart(2, '0')}` +
          `${String(now.getMinutes()).padStart(2, '0')}`
        const defaultName = `${session.title}-${ts}.${ext}`
        const defaultPath = join(app.getPath('documents'), defaultName)

        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: '导出会话',
          defaultPath: defaultPath,
          filters:
            payload.format === 'markdown'
              ? [{ name: 'Markdown', extensions: ['md'] }]
              : [{ name: 'JSON', extensions: ['json'] }]
        })

        if (canceled || !filePath) {
          // 用户取消保存不是错误，返回 success:true + data:null 让前端区分取消与失败
          return { success: true, data: null } as unknown as ApiResponse<ExportSessionResult>
        }

        const buffer = Buffer.from(content, 'utf-8')
        await writeFile(filePath, buffer)

        return { success: true, data: { filePath, size: buffer.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
