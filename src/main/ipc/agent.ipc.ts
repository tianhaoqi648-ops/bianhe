// ============================================================
// agent.ipc.ts — Agent IPC handler（AI Agent v1.3.0 Week 3 Task 16-17）
//
// 注册通道：
//   agent:chat    发起 Agent 对话，流式事件通过 webContents.send('agent:event', ...) 推送
//   agent:cancel  取消当前进行中的对话（通过 AbortController 中断 fetch 与循环）
//
// 设计要点：
//   - 主进程不持有渲染进程状态（settingsStore 在渲染进程的 Zustand 中），
//     LLMConfig 由渲染进程在调用 agent:chat 时随 ChatRequest 一并传入，
//     handler 内校验 config.apiKey 非空（Task 17.1）。
//   - 每个 webContents 维护一个 AbortController，支持多窗口独立对话；
//     同一窗口发起新对话会覆盖旧 controller（渲染进程应在发起新对话前调用 cancel）。
//   - 错误处理边界：
//       17.1 API Key 未配置  → handler 校验，推送 error 事件后直接返回
//       17.2 API Key 无效    → llm-client.ts 抛 LLMError('invalid_api_key')，agent-loop 已透传
//       17.3 速率限制        → llm-client.ts 抛 LLMError('rate_limit')，agent-loop 已透传
//       17.4 工具执行失败    → agent-loop.ts 推送 tool_call_result(success=false)，不中断
//       17.5 网络错误        → llm-client.ts 抛 LLMError('network')，agent-loop 已透传
//     本文件 catch 块作为最后防线，兜底未被 agent-loop 捕获的异常。
//   - 严格 TypeScript，避免 any（用 unknown 替代）
// ============================================================

import { ipcMain, type WebContents } from 'electron'
import type { ChatRequest, ChatEvent, TestConnectionResult, LLMConfig } from '@shared/agent-types'
import { runAgentLoop } from '../agent/agent-loop'
import { buildSystemPrompt } from '../agent/prompt-templates'
import { LLMError, chat, validateConfig } from '../agent/llm-client'

/**
 * 每个 webContents 对应一个进行中的 AbortController。
 * 多窗口独立对话互不影响；同一窗口同时只有一个活跃对话。
 */
const activeControllers = new Map<WebContents, AbortController>()

/**
 * 注册 Agent IPC handler。
 * 在主进程 app.whenReady 之后、createWindow 之前调用（与 registerAllIpc 同期）。
 */
export function registerAgentIpc(): void {
  // ---------- agent:chat ----------
  ipcMain.handle('agent:chat', async (event, request: ChatRequest) => {
    const webContents = event.sender
    const { message, context, config, sessionId } = request

    // Task 17.1：API Key 未配置（config 缺失或 apiKey 为空）
    // 直接推送 error 事件并返回，不进入 agent-loop
    if (!config || !config.apiKey) {
      sendEvent(webContents, {
        type: 'error',
        code: 'no_api_key',
        message: '未配置 API Key，请先在设置页「AI 助手」中配置'
      })
      return
    }

    // 防御性：若同 webContents 有旧 AbortController，先 abort 并清理。
    // 避免旧对话的流式事件继续推送到渲染进程（与渲染进程侧的 handler 清理配合），
    // 防止旧对话的 delta 与新对话的 delta 交叠造成字符双写。
    const oldController = activeControllers.get(webContents)
    if (oldController) {
      try {
        oldController.abort()
      } catch {
        // 忽略 abort 异常
      }
      activeControllers.delete(webContents)
    }

    // 创建 AbortController 并绑定到当前 webContents
    // （若同一窗口仍有旧对话在进行，旧 controller 被覆盖；渲染进程应先调用 cancel）
    const controller = new AbortController()
    activeControllers.set(webContents, controller)

    try {
      await runAgentLoop({
        userMessage: message,
        systemPrompt: buildSystemPrompt(context),
        context,
        sessionId,
        config,
        onEvent: (evt) => sendEvent(webContents, evt),
        signal: controller.signal
      })
    } catch (err) {
      // 兜底错误处理：agent-loop 内部已处理 LLMError 与工具错误，
      // 这里捕获未被内部处理的异常（理论上不应到达），作为最后防线
      const code = err instanceof LLMError ? err.code : 'unknown'
      const msg = err instanceof Error ? err.message : String(err)
      sendEvent(webContents, { type: 'error', code, message: msg })
    } finally {
      activeControllers.delete(webContents)
    }
  })

  // ---------- agent:test-connection ----------
  // 独立的测试连接通道：不进入 agent-loop、不加载工具、不注入系统提示词、不写入会话历史
  // 直接调用 chat 一次最小请求，返回结构化 TestConnectionResult
  ipcMain.handle(
    'agent:test-connection',
    async (_event, config: LLMConfig): Promise<TestConnectionResult> => {
      // 1. 前置校验配置（防御性，渲染进程已校验过一次）
      const validation = validateConfig(config)
      if (!validation.valid) {
        return {
          success: false,
          code: validation.code,
          message: validation.message
        }
      }

      // 2. 创建 15s 超时的 AbortController
      const controller = new AbortController()
      const timeoutMs = 15_000
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const startTime = Date.now()

      try {
        // 3. 发起最小请求（仅一条 user 消息，不传 tools）
        await chat(
          [{ role: 'user', content: 'ping' }],
          config,
          undefined,
          controller.signal
        )
        const latencyMs = Date.now() - startTime

        // chat 函数在 abort 时会捕获 AbortError 并返回空 AssistantMessage（而非抛出），
        // 因此需要在返回前检查 signal 是否已 abort，以正确识别超时
        if (controller.signal.aborted) {
          return {
            success: false,
            code: 'timeout',
            message: '请求超时（15s），请检查网络或更换 LLM 服务'
          }
        }

        return { success: true, latencyMs }
      } catch (err) {
        const latencyMs = Date.now() - startTime

        // 4. 超时判断（AbortController 触发 + 已经过去 15s）
        if (
          err instanceof DOMException &&
          err.name === 'AbortError' &&
          latencyMs >= timeoutMs - 100
        ) {
          return {
            success: false,
            code: 'timeout',
            message: '请求超时（15s），请检查网络或更换 LLM 服务'
          }
        }

        // 5. LLMError 映射
        if (err instanceof LLMError) {
          return {
            success: false,
            code: err.code,
            message: err.message,
            statusCode: err.statusCode
          }
        }

        // 6. 其他未知错误
        return {
          success: false,
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err)
        }
      } finally {
        clearTimeout(timer)
      }
    }
  )

  // ---------- agent:cancel ----------
  ipcMain.handle('agent:cancel', async (event) => {
    const controller = activeControllers.get(event.sender)
    if (controller) {
      controller.abort()
      activeControllers.delete(event.sender)
    }
  })
}

/**
 * 向渲染进程推送流式事件。
 * preload 通过 ipcRenderer.on('agent:event', onEvent) 监听并转发给 AgentAPI.chat 的 onEvent 回调。
 */
function sendEvent(webContents: WebContents, event: ChatEvent): void {
  // webContents 可能已被销毁（窗口关闭），发送前校验避免抛错
  if (webContents.isDestroyed()) return
  webContents.send('agent:event', event)
}
