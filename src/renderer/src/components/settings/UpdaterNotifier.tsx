// ============================================================
// UpdaterNotifier.tsx — 全局更新通知（启动自检可见反馈）
//
// 挂在 App 根（AppLayout 内），不渲染任何 DOM（返回 null）。
// 订阅主进程广播的更新状态事件，当「启动时自动检查更新」发现
// 新版本时，无论当前在哪个页面都能弹全局提示，并提供「去更新」
// 跳转到 设置 → 关于。
//
// 依赖：仅 window.updaterAPI.onStatusChange（已存在）。
// 注意：不依赖 updaterAPI.getMeta（由并行任务 T3 提供）。
// ============================================================

import { useEffect, useRef } from 'react'
import { notification, Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { UpdateStatusPayload } from '../../../../shared/types'

/**
 * 全局更新通知组件（不渲染 DOM）。
 *
 * 在 mounted 时订阅 window.updaterAPI.onStatusChange，根据状态弹相应
 * antd notification；组件卸载时自动取消订阅。
 */
export default function UpdaterNotifier(): null {
  const navigate = useNavigate()

  // 记录已提示过的新版本号，避免同一 version 重复弹窗
  const notifiedVersionRef = useRef<string>('')

  useEffect(() => {
    if (!window.updaterAPI) {
      console.warn('[UpdaterNotifier] window.updaterAPI not available')
      return
    }

    const unsubscribe = window.updaterAPI.onStatusChange((payload: UpdateStatusPayload) => {
      const { status, info, error } = payload

      // 发现新版本 → 全局提示 + 「去更新」按钮（同一 version 仅弹一次）
      if (status === 'available' && info && notifiedVersionRef.current !== info.version) {
        notifiedVersionRef.current = info.version
        notification.info({
          message: '发现新版本',
          description: `辩盒 v${info.version} 已发布，可前往设置-关于 查看/下载`,
          placement: 'bottomRight',
          duration: 8,
          btn: (
            <Button
              type="primary"
              size="small"
              onClick={() => navigate('/settings?tab=about')}
            >
              去更新
            </Button>
          )
        })
      }

      // 检查出错 → 全局警告（短时 5s）
      if (status === 'error' && error) {
        notification.warning({
          message: '更新检查失败',
          description: error,
          placement: 'bottomRight',
          duration: 5
        })
      }

      // 下载完成 → 提示可前往 设置-关于 重启安装
      if (status === 'downloaded') {
        notification.success({
          message: '更新已下载',
          description: '可前往设置-关于 重启安装',
          placement: 'bottomRight',
          duration: 5
        })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [navigate])

  return null
}