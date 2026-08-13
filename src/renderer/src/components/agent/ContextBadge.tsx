// ============================================================
// ContextBadge.tsx — Agent 上下文徽章（AI Agent v1.3.0 Week 7 Task 44）
//
// 职责：
// 1. 显示当前业务上下文（辩题 / 赛事 / 页面，SubTask 44.1）
// 2. 「锁定」图标按钮：切换 contextLocked 状态，锁定时主题色高亮（SubTask 44.2）
// 3. 「×」清除按钮：清空 context 并解锁（SubTask 44.3）
// 4. 无上下文时显示「无上下文」灰色文字（SubTask 44.4）
//
// 依赖：
// - antd Tag / Tooltip / Button / Typography / theme
// - @ant-design/icons LockOutlined / UnlockOutlined / CloseOutlined / PaperClipOutlined
// - useAgentStore: context / contextLocked
//   lockContext / unlockContext / clearContext
//
// 设计要点：
// - 组件无 props（全部从 store 读取），便于在 AgentChatPanel Header 直接嵌入
// - 上下文为空时禁用锁定/清除按钮，避免无意义操作
// - Tag 内容过长时省略号截断，避免撑爆 Header
// - 锁定按钮：锁定时 type="primary"（主题色 filled 高亮），
//   未锁定时 type="default"（outlined），与 antd filled/outlined 按钮变体对齐
// ============================================================

import React from 'react'
import { Tag, Tooltip, Button, Typography, theme } from 'antd'
import {
  LockOutlined,
  UnlockOutlined,
  CloseOutlined,
  PaperClipOutlined
} from '@ant-design/icons'
import { useAgentStore } from '../../stores/agentStore'

/** 单个上下文 Tag 的最大宽度（超出省略号截断，防止撑爆 Header） */
const TAG_MAX_WIDTH = 120

/**
 * ContextBadge — Agent 上下文徽章
 *
 * 显示当前业务上下文（辩题/赛事/页面）+ 锁定切换 + 清除按钮。
 * 无上下文时显示灰色「无上下文」占位文字。
 * 组件无 props，全部状态从 agentStore 读取。
 */
export function ContextBadge(): JSX.Element {
  const { token } = theme.useToken()

  // ===== store 状态 =====
  const context = useAgentStore((s) => s.context)
  const contextLocked = useAgentStore((s) => s.contextLocked)
  const lockContext = useAgentStore((s) => s.lockContext)
  const unlockContext = useAgentStore((s) => s.unlockContext)
  const clearContext = useAgentStore((s) => s.clearContext)

  // ===== 派生：当前是否有可用上下文 =====
  const hasTopic = !!context.currentTopic
  const hasEvent = !!context.currentEvent
  const hasPage = !!context.currentPage
  const hasContext = hasTopic || hasEvent || hasPage

  // Tag 通用样式：限宽 + 省略号 + 去除默认外边距（由父 flex gap 控制间距）
  const tagStyle: React.CSSProperties = {
    maxWidth: TAG_MAX_WIDTH,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    margin: 0
  }

  // ===== 事件处理 =====

  /** 切换上下文锁定状态：锁定 → 解锁；未锁定 → 锁定 */
  const handleToggleLock = (): void => {
    if (contextLocked) {
      unlockContext()
    } else {
      lockContext()
    }
  }

  /** 清除上下文（清空 context 并解锁，由 store.clearContext 统一处理） */
  const handleClear = (): void => {
    clearContext()
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        flex: 1,
        justifyContent: 'flex-end',
        overflow: 'hidden'
      }}
    >
      {/* 上下文展示区：PaperClipOutlined + Tag 列表 / 「无上下文」占位 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minWidth: 0,
          justifyContent: 'flex-end',
          overflow: 'hidden'
        }}
      >
        <PaperClipOutlined
          style={{
            color: hasContext ? token.colorPrimary : token.colorTextTertiary,
            flexShrink: 0
          }}
        />
        {hasContext ? (
          <>
            {hasTopic && context.currentTopic && (
              <Tooltip title={`辩题：${context.currentTopic.title}`}>
                <Tag color="blue" style={tagStyle}>
                  辩题：{context.currentTopic.title}
                </Tag>
              </Tooltip>
            )}
            {hasEvent && context.currentEvent && (
              <Tooltip title={`赛事：${context.currentEvent.name}`}>
                <Tag color="green" style={tagStyle}>
                  赛事：{context.currentEvent.name}
                </Tag>
              </Tooltip>
            )}
            {hasPage && (
              <Tooltip title={`页面：${context.currentPage}`}>
                <Tag style={tagStyle}>页面：{context.currentPage}</Tag>
              </Tooltip>
            )}
          </>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            无上下文
          </Typography.Text>
        )}
      </div>

      {/* 锁定按钮：锁定时 type="primary"（主题色 filled 高亮），未锁定时 type="default"（outlined） */}
      <Tooltip title={contextLocked ? '解锁上下文' : '锁定上下文'} placement="bottom">
        <Button
          type={contextLocked ? 'primary' : 'default'}
          icon={contextLocked ? <LockOutlined /> : <UnlockOutlined />}
          onClick={handleToggleLock}
          disabled={!hasContext}
          aria-label={contextLocked ? '解锁上下文' : '锁定上下文'}
        />
      </Tooltip>

      {/* 清除按钮：清空 context 并解锁 */}
      <Tooltip title="清除上下文" placement="bottom">
        <Button
          type="text"
          danger
          icon={<CloseOutlined />}
          onClick={handleClear}
          disabled={!hasContext}
          aria-label="清除上下文"
        />
      </Tooltip>
    </div>
  )
}
