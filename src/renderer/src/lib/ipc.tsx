// ============================================================
// lib/ipc.tsx — IPC 调用安全包装
//
// 提供 safeIpc<T>(promise, fallback?) 工具函数，统一处理 IPC 错误：
//   - 捕获 ApiResponse 的 { success: false, error, appError } 响应
//   - 优先按 appError.code 分类（B3 修复：原英文关键字分类对中文
//     userMessage 几乎必然失效），显示分类 Toast
//   - Toast 主文案直接使用 error（主进程已映射为中文 userMessage），
//     不再叠加「数据库错误：/文件错误：/操作失败：」前缀（避免双重前缀）
//   - 返回 fallback 或抛出错误（无 fallback 时）
//
// Toast 用 antd message 静态方法（非 useToast hook），
// 因为 safeIpc 是普通 async 函数，无法在内部调用 hook。
// 整体并入 useToast 胶囊体系记 Deferred（B3 范围外）。
//
// 注：文件扩展名为 .tsx 因 showErrorToast 内含 JSX（Button/Space）。
// ============================================================

import { message, Button, Space } from 'antd'
import type { ApiResponse } from '../../../shared/types'

/** 错误类别 */
type ErrorCategory = 'database' | 'file' | 'network' | 'other'

/** 按 appError.code 分类（主进程 toApiError 的结构化结果，最可靠） */
function categorizeByCode(code?: string): ErrorCategory | null {
  if (!code) return null
  if (code.startsWith('SQLITE')) return 'database'
  if (code === 'FILE') return 'file'
  return null
}

/** 无结构化 code 时的文本回退分类（仅用于 IPC 传输层异常等无 appError 场景） */
function categorizeError(errorText: string): ErrorCategory {
  const lower = errorText.toLowerCase()
  if (lower.includes('database') || lower.includes('sqlite') || lower.includes('sql')) {
    return 'database'
  }
  if (lower.includes('enoent') || lower.includes('file') || lower.includes('permission')) {
    return 'file'
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('timeout')) {
    return 'network'
  }
  return 'other'
}

/**
 * 包装一个 IPC Promise，自动处理错误并显示分类 Toast。
 *
 * @param promise 原始 IPC Promise（返回 ApiResponse<T>）
 * @param fallback 可选默认值；不传则在失败时抛错
 * @returns 成功时返回 data；失败时显示 Toast 并返回 fallback（或抛错）
 *
 * @example
 *   const list = await safeIpc(window.topicAPI.list(filter), { items: [], total: 0 })
 */
export async function safeIpc<T>(
  promise: Promise<ApiResponse<T>>,
  fallback?: T
): Promise<T> {
  let res: ApiResponse<T>
  try {
    res = await promise
  } catch (e) {
    // IPC 调用本身抛错（如 ipcRenderer 异常）：无 appError，走文本回退分类
    const errText = e instanceof Error ? e.message : String(e)
    showErrorToast(errText, undefined)
    if (fallback !== undefined) return fallback
    throw e
  }

  if (res.success) {
    if (res.data === undefined) {
      // success=true 但 data 缺失（理论上不该发生），按错误处理
      const errText = 'IPC 返回成功但缺少 data'
      showErrorToast(errText, undefined)
      if (fallback !== undefined) return fallback
      throw new Error(errText)
    }
    return res.data
  }

  // success=false：主文案 = error（已是中文 userMessage），分类优先用 appError.code
  const errText = res.error || '未知错误'
  showErrorToast(errText, res.appError?.code)

  if (fallback !== undefined) return fallback
  throw new Error(errText)
}

/** 按错误类别显示 Toast（主文案不带类别前缀——errorText 已是用户可读文案） */
function showErrorToast(errorText: string, code?: string): void {
  const category = categorizeByCode(code) ?? categorizeError(errorText)
  switch (category) {
    case 'database':
      // 数据库错误：红色，含"重启应用"按钮
      message.error({
        content: (
          <Space size={8} align="center">
            <span>{errorText}</span>
            <Button
              size="small"
              type="link"
              onClick={() => window.location.reload()}
            >
              重启应用
            </Button>
          </Space>
        ),
        duration: 6
      })
      break
    case 'file':
      // 文件错误：橙色警告
      message.warning({
        content: errorText,
        duration: 5
      })
      break
    case 'network':
      // 网络错误：蓝色信息，含"重试"按钮
      message.info({
        content: (
          <Space size={8} align="center">
            <span>{errorText}</span>
            <Button
              size="small"
              type="link"
              onClick={() => {
                message.destroy()
                window.location.reload()
              }}
            >
              重试
            </Button>
          </Space>
        ),
        duration: 6
      })
      break
    default:
      // 其他：黄色警告
      message.warning({
        content: errorText,
        duration: 4
      })
  }
}
