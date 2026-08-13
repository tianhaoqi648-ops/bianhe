// ============================================================
// AgentChatPanel.tsx — Agent 聊天面板组件（AI Agent v1.3.0 Week 4 Task 19 + 23 / Week 7 Task 47）
//
// 职责：
// 1. 左侧可折叠面板（默认收起，宽度 400px / 收起 48px）
// 2. Ctrl+J 快捷键切换折叠状态（SubTask 19.2）
// 3. 顶部 Header：折叠按钮 + 会话列表切换按钮 + 标题 + ContextBadge + ExportMenu + 清空会话按钮（SubTask 19.3 / 47.2）
// 4. 中部消息流：渲染 AgentMessage 列表，自动滚动到底部（SubTask 19.4）
// 5. 底部 AgentInput 输入区（SubTask 19.5）
// 6. 未配置 API Key 时显示引导卡片（SubTask 19.6 / 47.4）
// 7. Task 47 集成：
//    - 左侧新增 SessionList（200px / 折叠 48px，本地 state 管理，SubTask 47.1）
//    - Header 新增 ExportMenu + ContextBadge（SubTask 47.2）
//    - 渲染 ToolConfirmModal（由 agentStore.pendingConfirm 驱动显隐，SubTask 47.3）
//    - 未配置 API Key 时 SessionList 置灰（SubTask 47.4）
//
// 依赖：
// - antd Button / Tooltip / Typography / Modal / Alert / theme
// - @ant-design/icons MenuFoldOutlined / DeleteOutlined / RobotOutlined / RightOutlined / UnorderedListOutlined
// - useHotkeys: Ctrl+J 切换折叠
// - useAgentStore: messages / error / clearMessages / clearError / pendingNavigation
// - useSettingsStore: aiConfig.apiKey 判断是否已配置
// - AgentMessage / AgentInput / SessionList / ToolConfirmModal / ContextBadge / ExportMenu 子组件
// ============================================================

import React, { useRef, useEffect, useState } from 'react'
import { Button, Tooltip, Typography, Modal, Alert, theme } from 'antd'
import {
  MenuFoldOutlined,
  DeleteOutlined,
  RobotOutlined,
  RightOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useHotkeys } from '../../hooks/useHotkeys'
import { useAgentStore } from '../../stores/agentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { AgentMessage } from './AgentMessage'
import { AgentInput } from './AgentInput'
import { SessionList } from './SessionList'
import { ToolConfirmModal } from './ToolConfirmModal'
import { SchedulePreviewModal } from './SchedulePreviewModal'
import { ContextBadge } from './ContextBadge'
import { ExportMenu } from './ExportMenu'

/** AgentChatPanel Props */
export interface AgentChatPanelProps {
  /** 面板折叠状态（受控） */
  collapsed: boolean
  /** 切换折叠状态回调 */
  onToggle: () => void
  /** 导航到设置页回调（可选，默认导航到 /settings） */
  onNavigateToSettings?: () => void
}

/** 主体面板展开时的宽度 */
const PANEL_WIDTH_EXPANDED = 400
/** 面板收起时的宽度 */
const PANEL_WIDTH_COLLAPSED = 48

/**
 * AgentChatPanel — Agent 聊天面板
 *
 * 整体布局：[SessionList 200px/48px] [主体 400px]。
 * collapsed=true 时显示 48px 窄条（展开按钮 + 垂直标题）；
 * collapsed=false 时显示 [SessionList] + 主体（Header / 消息流 / 输入区）。
 * SessionList 的折叠状态由本组件 local state 管理，切换按钮位于 Header。
 */
export function AgentChatPanel({
  collapsed,
  onToggle,
  onNavigateToSettings
}: AgentChatPanelProps): JSX.Element | null {
  const { token } = theme.useToken()
  const navigate = useNavigate()

  const messages = useAgentStore((s) => s.messages)
  const error = useAgentStore((s) => s.error)
  const clearMessages = useAgentStore((s) => s.clearMessages)
  const clearError = useAgentStore((s) => s.clearError)
  const pendingNavigation = useAgentStore((s) => s.pendingNavigation)
  const clearPendingNavigation = useAgentStore((s) => s.clearPendingNavigation)

  const apiKey = useSettingsStore((s) => s.aiConfig.apiKey)
  const apiKeyConfigured = apiKey.length > 0

  const scrollRef = useRef<HTMLDivElement>(null)

  // SubTask 47.1: SessionList 折叠状态（由本组件管理，切换按钮在 Header）
  const [sessionListCollapsed, setSessionListCollapsed] = useState(false)

  // SubTask 19.2: Ctrl+J 切换折叠状态
  useHotkeys({
    combo: 'ctrl+j',
    description: '切换 AI 助手面板',
    handler: () => onToggle(),
    scope: 'global'
  })

  // SubTask 19.4: 消息列表长度变化时自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length])

  // Task 24: 监听 pendingNavigation，工具调用触发路由跳转
  useEffect(() => {
    if (pendingNavigation) {
      navigate(pendingNavigation)
      clearPendingNavigation()
    }
  }, [pendingNavigation, navigate, clearPendingNavigation])

  // 导航到设置页（默认导航到 /settings）
  const handleNavigateToSettings = onNavigateToSettings ?? (() => navigate('/settings'))

  // SubTask 19.3: 清空会话二次确认
  const handleClear = (): void => {
    Modal.confirm({
      title: '清空会话',
      content: '确定要清空所有对话记录吗？此操作不可撤销。',
      okText: '清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => clearMessages()
    })
  }

  // SubTask 47.1: 切换 SessionList 折叠状态
  const handleToggleSessionList = (): void => {
    setSessionListCollapsed((v) => !v)
  }

  // 收起态容器样式（48px 窄条）
  // height 固定为 100vh（而非 100%），避免外层 Layout minHeight:100vh 在内容超过视口时
  // 向下扩展导致面板跟随撑高。alignSelf:flex-start 防止 flex stretch 拉伸；
  // position:sticky + top:0 让面板在主内容滚动时粘住视口。
  const collapsedStyle: React.CSSProperties = {
    width: PANEL_WIDTH_COLLAPSED,
    height: '100vh',
    alignSelf: 'flex-start',
    position: 'sticky',
    top: 0,
    backgroundColor: token.colorBgContainer,
    borderRight: `1px solid ${token.colorBorderSecondary}`,
    transition: 'width 0.2s ease',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 10,
    overflow: 'hidden',
    flexShrink: 0
  }

  // 展开态外层容器样式（[SessionList] [主体] 水平排列，宽度由子元素决定）
  // 同 collapsedStyle：height 固定 100vh + sticky，确保内部消息流 overflowY:auto 生效。
  const outerStyle: React.CSSProperties = {
    height: '100vh',
    alignSelf: 'flex-start',
    position: 'sticky',
    top: 0,
    display: 'flex',
    flexDirection: 'row',
    backgroundColor: token.colorBgContainer,
    borderRight: `1px solid ${token.colorBorderSecondary}`,
    flexShrink: 0,
    zIndex: 10,
    overflow: 'hidden'
  }

  // 展开态主体样式（400px，Header + 消息流 + 输入区）
  const mainBodyStyle: React.CSSProperties = {
    width: PANEL_WIDTH_EXPANDED,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    position: 'relative',
    overflow: 'hidden'
  }

  // SubTask 47.3: ToolConfirmModal（无论折叠/展开都渲染，由 store.pendingConfirm 控制显隐）
  const toolConfirmModal = <ToolConfirmModal />
  // Task 49.4: SchedulePreviewModal（无论折叠/展开都渲染，由 store.pendingSchedulePreview 控制显隐）
  const schedulePreviewModal = <SchedulePreviewModal />

  // ====== 收起态：48px 窄条 ======
  if (collapsed) {
    return (
      <>
        <div style={collapsedStyle}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              height: '100%',
              paddingTop: 8,
              gap: 16
            }}
          >
            <Tooltip title="展开 AI 助手" placement="right">
              <Button
                type="text"
                icon={<RightOutlined />}
                onClick={onToggle}
                aria-label="展开 AI 助手"
              />
            </Tooltip>
            <div
              style={{
                writingMode: 'vertical-rl',
                fontSize: 14,
                fontWeight: 500,
                color: token.colorText,
                letterSpacing: 2
              }}
            >
              AI 助手
            </div>
          </div>
        </div>
        {toolConfirmModal}
        {schedulePreviewModal}
      </>
    )
  }

  // ====== 展开态：[SessionList] [主体 400px] ======
  return (
    <>
      <div style={outerStyle}>
        {/* SubTask 47.1: 左侧 SessionList（200px / 折叠 48px）。
            SubTask 47.4: 未配置 API Key 时置灰并禁用交互，引导用户先配置。 */}
        <div
          style={{
            display: 'flex',
            height: '100%',
            opacity: apiKeyConfigured ? 1 : 0.5,
            pointerEvents: apiKeyConfigured ? 'auto' : 'none'
          }}
        >
          <SessionList collapsed={sessionListCollapsed} />
        </div>

        {/* 主体：Header / 消息流 / 输入区 */}
        <div style={mainBodyStyle}>
          {/* SubTask 19.3 / 47.2: 顶部 Header */}
          <div
            style={{
              height: 48,
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              gap: 4,
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              flexShrink: 0
            }}
          >
            <Tooltip title="收起面板" placement="bottom">
              <Button
                type="text"
                icon={<MenuFoldOutlined />}
                onClick={onToggle}
                aria-label="收起 AI 助手面板"
              />
            </Tooltip>
            {/* SubTask 47.1: 切换 SessionList 折叠状态 */}
            <Tooltip
              title={sessionListCollapsed ? '展开会话列表' : '收起会话列表'}
              placement="bottom"
            >
              <Button
                type="text"
                icon={<UnorderedListOutlined />}
                onClick={handleToggleSessionList}
                aria-label={sessionListCollapsed ? '展开会话列表' : '收起会话列表'}
              />
            </Tooltip>
            <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>
              AI 助手
            </Typography.Text>
            {/* SubTask 47.2: 上下文徽章（组件内部 flex:1 占据剩余空间，右对齐展示） */}
            <ContextBadge />
            {/* SubTask 47.2: 导出菜单 */}
            <ExportMenu />
            <Tooltip title="清空会话" placement="bottom">
              <Button
                type="text"
                icon={<DeleteOutlined />}
                onClick={handleClear}
                aria-label="清空会话"
              />
            </Tooltip>
          </div>

          {/* 错误提示：agentStore.error 非空时显示 */}
          {error && (
            <div style={{ padding: '8px 12px 0', flexShrink: 0 }}>
              <Alert
                type="error"
                message={error.message}
                closable
                onClose={clearError}
                showIcon
              />
            </div>
          )}

          {/* SubTask 19.4 / 19.6: 消息流 */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            {messages.length === 0 ? (
              apiKeyConfigured ? (
                <WelcomeScreen />
              ) : (
                <ApiKeyGuide onNavigateToSettings={handleNavigateToSettings} />
              )
            ) : (
              messages.map((msg) => <AgentMessage key={msg.id} message={msg} />)
            )}
          </div>

          {/* SubTask 19.5: 底部输入区 */}
          <AgentInput onNavigateToSettings={handleNavigateToSettings} />
        </div>
      </div>

      {/* SubTask 47.3: 工具调用确认弹窗（由 agentStore.pendingConfirm 驱动显隐） */}
      {toolConfirmModal}
      {/* Task 49.4: 赛程预览弹窗（由 agentStore.pendingSchedulePreview 驱动显隐） */}
      {schedulePreviewModal}
    </>
  )
}

/**
 * 欢迎屏：消息列表为空且已配置 API Key 时显示。
 * 居中展示 RobotOutlined 图标 + 欢迎文案 + 快捷指令示例。
 */
function WelcomeScreen(): JSX.Element {
  const { token } = theme.useToken()
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        textAlign: 'center',
        padding: 24
      }}
    >
      <RobotOutlined style={{ fontSize: 48, color: token.colorTextTertiary }} />
      <Typography.Text strong style={{ fontSize: 16 }}>
        我是辩盒 AI 助手
      </Typography.Text>
      <Typography.Text type="secondary">
        试试问我：从题库抽 8 道科技类辩题
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        快捷指令：/抽题 · /备赛 · /建赛事 · /查辩题
      </Typography.Text>
    </div>
  )
}

/**
 * API Key 引导卡片：消息列表为空且未配置 API Key 时显示。
 * 含 RobotOutlined 图标 + 提示文案 + 「前往配置」按钮。
 */
function ApiKeyGuide({
  onNavigateToSettings
}: {
  onNavigateToSettings: () => void
}): JSX.Element {
  const { token } = theme.useToken()
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        textAlign: 'center',
        padding: 24
      }}
    >
      <RobotOutlined style={{ fontSize: 48, color: token.colorTextTertiary }} />
      <Typography.Text strong style={{ fontSize: 16 }}>
        未配置 API Key
      </Typography.Text>
      <Typography.Text type="secondary">
        请先前往设置页配置 LLM API Key，才能使用 AI 助手功能。
      </Typography.Text>
      <Button type="primary" onClick={onNavigateToSettings}>
        前往配置
      </Button>
    </div>
  )
}
