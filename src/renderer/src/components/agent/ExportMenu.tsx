// ============================================================
// ExportMenu.tsx — Agent 对话导出菜单（AI Agent v1.3.0 Week 7 Task 45）
//
// 职责：
// 1. antd Dropdown.Button：主按钮「导出」+ 下拉项 Markdown / JSON（SubTask 45.1）
// 2. 选择格式后调用 window.agent.exportSession({ sessionId, format })（SubTask 45.2）
// 3. 主进程通过 dialog.showSaveDialog 选路径（Task 46 已实现，SubTask 45.3）
// 4. 导出成功 Toast 提示路径；用户取消不提示；失败提示错误（SubTask 45.4）
//
// 依赖：
// - antd Dropdown.Button
// - @ant-design/icons ExportOutlined / FileMarkdownOutlined / FileTextOutlined
// - useAgentSessionStore: currentSessionId
// - useToast: 成功/失败提示（项目统一 Toast 系统，避免 antd 静态 message 警告）
// - window.agent.exportSession（preload 暴露，Task 45 新增）
//
// 设计要点：
// - 无 currentSessionId 时禁用导出按钮
// - 主按钮点击默认导出 Markdown；下拉项选择对应格式
// - 导出过程中 loading 态（antd loading 自动禁用主按钮，防止重复点击）
// - 用户取消保存（data===null）静默处理，不打扰用户
// ============================================================

import { useState, useCallback } from 'react'
import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import {
  ExportOutlined,
  FileMarkdownOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { useAgentSessionStore } from '../../stores/agentSessionStore'
import { useToast } from '../../hooks/useToast'
import type { AgentAPI } from '../../../../shared/agent-types'

/** 导出格式 */
type ExportFormat = 'markdown' | 'json'

/**
 * 获取 preload 暴露的 Agent API。
 * 与 agentStore 中的 getAgentAPI 一致：通过 cast 获取类型安全引用。
 */
function getAgentAPI(): AgentAPI | null {
  const w = window as unknown as { agent?: AgentAPI }
  return w.agent ?? null
}

/**
 * ExportMenu — 对话导出菜单
 *
 * Dropdown.Button 主按钮「导出」默认导出 Markdown；
 * 下拉项提供 Markdown / JSON 两种格式选择。
 * 无 currentSessionId 时禁用。
 */
export function ExportMenu(): JSX.Element {
  const currentSessionId = useAgentSessionStore((s) => s.currentSessionId)
  const toast = useToast()
  const [exporting, setExporting] = useState(false)

  /**
   * 执行导出：调用主进程 IPC，按返回结果给出对应 Toast。
   *
   * 返回值约定（与主进程 export-session.ipc.ts 对齐）：
   * - { success: true, data: { filePath, size } }：成功，Toast 提示路径
   * - { success: true, data: null }：用户在保存对话框中取消，静默处理
   * - { success: false, error }：失败，Toast 提示错误
   */
  const handleExport = useCallback(
    async (format: ExportFormat): Promise<void> => {
      if (!currentSessionId || exporting) return
      const api = getAgentAPI()
      if (!api) {
        toast.error('Agent 服务未就绪（window.agent 不可用）')
        return
      }
      setExporting(true)
      try {
        const res = await api.exportSession({
          sessionId: currentSessionId,
          format
        })
        if (!res.success) {
          toast.error(res.error ?? '导出失败')
          return
        }
        // data === null：用户在保存对话框中取消，提示已取消
        if (res.data) {
          toast.success(`已导出到：${res.data.filePath}`)
        } else {
          toast.info('已取消导出')
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        setExporting(false)
      }
    },
    [currentSessionId, exporting, toast]
  )

  /** 下拉菜单点击：按 key 派发对应格式 */
  const handleMenuClick = useCallback(
    ({ key }: { key: string }): void => {
      void handleExport(key as ExportFormat)
    },
    [handleExport]
  )

  /** 菜单项：Markdown / JSON */
  const menuItems: MenuProps['items'] = [
    {
      key: 'markdown',
      label: 'Markdown',
      icon: <FileMarkdownOutlined />
    },
    {
      key: 'json',
      label: 'JSON',
      icon: <FileTextOutlined />
    }
  ]

  return (
    <Dropdown.Button
      menu={{ items: menuItems, onClick: handleMenuClick }}
      disabled={!currentSessionId}
      loading={exporting}
      onClick={() => void handleExport('markdown')}
    >
      <ExportOutlined /> 导出
    </Dropdown.Button>
  )
}
