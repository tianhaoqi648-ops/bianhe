// ============================================================
// useToast.tsx —— 统一 Toast 系统
//
// 在 App 根挂载单一 message.useMessage() 实例，通过 Context 暴露
// success/error/info/warning/loading/action/undo 方法。
//
// 视觉：底部居中胶囊 + 状态图标 + 0.3s 微缩放仪式感动效
// 行为：Esc 关闭当前 Toast；批量操作可带"撤销"按钮
//
// 用法：
//   function Page() {
//     const toast = useToast()
//     toast.success('已保存')
//     toast.error('保存失败', { retryFn: handleSave })
//     toast.undo('已删除 12 项', () => revert())
//   }
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode
} from 'react'
import { message, Button, Space } from 'antd'
import { UndoOutlined, ReloadOutlined } from '@ant-design/icons'

export interface ToastOptions {
  /** 用于更新/销毁同一 Toast（如 loading → success） */
  key?: string | number
  /** 自动消失时长（秒），0 表示常驻直至手动 destroy */
  duration?: number
}

export interface ToastAPI {
  /** 成功：✓ 图标 + 0.3s 微缩放，3s 滑出 */
  success(content: ReactNode, opts?: ToastOptions): void
  /** 错误：✗ 图标 + 可选"重试"按钮，5s 滑出 */
  error(
    content: ReactNode,
    opts?: ToastOptions & { retryFn?: () => void }
  ): void
  /** 信息：ℹ 图标，3s 滑出 */
  info(content: ReactNode, opts?: ToastOptions): void
  /** 警告：⚠ 图标，3s 滑出 */
  warning(content: ReactNode, opts?: ToastOptions): void
  /** 加载态：⏳ 图标，常驻直至切换为 success/error */
  loading(content: ReactNode, opts?: ToastOptions): void
  /** 自定义操作按钮：5s 滑出 */
  action(
    content: ReactNode,
    actionLabel: string,
    onAction: () => void,
    opts?: ToastOptions
  ): void
  /** 撤销操作：✓ 图标 + "撤销"按钮，3s 滑出 */
  undo(content: ReactNode, onUndo: () => void, opts?: ToastOptions): void
  /** 按 key 销毁，无 key 销毁全部 */
  destroy(key?: string | number): void
}

const ToastContext = createContext<ToastAPI | undefined>(undefined)

const CAPSULE_CLASS = 'bianhe-toast'

/**
 * Toast Provider —— App 根挂载一次。
 *
 * 内部用 antd message.useMessage() 提供底层 API，
 * 通过 className 'bianhe-toast' 触发胶囊样式 + 微缩放动效。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messageApi, contextHolder] = message.useMessage()

  // P3-22 修复：maxCount=1 会导致批量操作时后一条 Toast 覆盖前一条，
  // 改为 3 允许少量堆叠，兼顾仪式感与批量操作可见性
  useEffect(() => {
    message.config({ maxCount: 3 })
  }, [])

  // Esc 关闭当前 Toast（用 window 监听避免与 hotkey 系统的 scope 冲突）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        messageApi.destroy()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [messageApi])

  const api = useMemo<ToastAPI>(
    () => ({
      success: (content, opts) => {
        messageApi.open({
          type: 'success',
          content,
          duration: opts?.duration ?? 3,
          key: opts?.key,
          className: CAPSULE_CLASS
        })
      },
      error: (content, opts) => {
        const retryFn = opts?.retryFn
        if (retryFn) {
          messageApi.open({
            type: 'error',
            content: (
              <Space size={8} align="center">
                <span>{content}</span>
                <Button
                  size="small"
                  type="link"
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    messageApi.destroy(opts?.key)
                    retryFn()
                  }}
                >
                  重试
                </Button>
              </Space>
            ),
            duration: opts?.duration ?? 5,
            key: opts?.key,
            className: CAPSULE_CLASS
          })
        } else {
          messageApi.open({
            type: 'error',
            content,
            duration: opts?.duration ?? 5,
            key: opts?.key,
            className: CAPSULE_CLASS
          })
        }
      },
      info: (content, opts) => {
        messageApi.open({
          type: 'info',
          content,
          duration: opts?.duration ?? 3,
          key: opts?.key,
          className: CAPSULE_CLASS
        })
      },
      warning: (content, opts) => {
        messageApi.open({
          type: 'warning',
          content,
          duration: opts?.duration ?? 3,
          key: opts?.key,
          className: CAPSULE_CLASS
        })
      },
      loading: (content, opts) => {
        messageApi.open({
          type: 'loading',
          content,
          duration: opts?.duration ?? 0,
          key: opts?.key,
          className: CAPSULE_CLASS
        })
      },
      action: (content, actionLabel, onAction, opts) => {
        messageApi.open({
          type: 'info',
          content: (
            <Space size={8} align="center">
              <span>{content}</span>
              <Button
                size="small"
                type="link"
                onClick={() => {
                  messageApi.destroy(opts?.key)
                  onAction()
                }}
              >
                {actionLabel}
              </Button>
            </Space>
          ),
          duration: opts?.duration ?? 5,
          key: opts?.key,
          className: CAPSULE_CLASS
        })
      },
      undo: (content, onUndo, opts) => {
        messageApi.open({
          type: 'success',
          content: (
            <Space size={8} align="center">
              <span>{content}</span>
              <Button
                size="small"
                type="link"
                icon={<UndoOutlined />}
                onClick={() => {
                  messageApi.destroy(opts?.key)
                  onUndo()
                }}
              >
                撤销
              </Button>
            </Space>
          ),
          duration: opts?.duration ?? 3,
          key: opts?.key,
          className: CAPSULE_CLASS
        })
      },
      destroy: (key) => {
        if (key !== undefined) messageApi.destroy(key)
        else messageApi.destroy()
      }
    }),
    [messageApi]
  )

  return (
    <ToastContext.Provider value={api}>
      {contextHolder}
      {children}
    </ToastContext.Provider>
  )
}

/**
 * 获取 Toast API。必须在 ToastProvider 内使用。
 *
 * @throws 若在 ToastProvider 外调用
 */
export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return ctx
}
