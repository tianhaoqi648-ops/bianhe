// ============================================================
// AgentInput.tsx — Agent 输入框组件（AI Agent v1.3.0 Week 4 Task 22）
//
// 职责：
// 1. antd TextArea 输入：Enter 发送 / Shift+Enter 换行 / trim 后空串不发送
// 2. 发送按钮：loading 时切换为「停止」按钮（danger），点击调用 cancel
// 3. 快捷指令下拉：填入预设文本到输入框，不自动发送（让用户编辑后回车）
// 4. 未配置 API Key 时输入框置灰，显示「前往配置」链接（onNavigateToSettings 回调）
//
// 依赖：
// - antd Input / Button / Dropdown / Menu / Typography / theme.useToken()
// - @ant-design/icons SendOutlined / StopOutlined / ThunderboltOutlined
// - useAgentStore: sendMessage / cancel / isLoading
// - useSettingsStore: aiConfig.apiKey 判断是否已配置
//
// 布局：
// - 整体 flex column / padding 12 / gap 8 / 顶部用 colorBorderSecondary 分隔
// - 顶部一行：快捷指令下拉（左对齐）
// - 中间一行：TextArea（flex:1）+ 发送/停止按钮（margin-left:8）
// - 底部一行：未配置时的提示文字（仅 apiKey 为空时显示）
// ============================================================

import React, { useState } from 'react'
import { Input, Button, Dropdown, Typography, theme, Menu } from 'antd'
import { SendOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useAgentStore } from '../../stores/agentStore'
import { useSettingsStore } from '../../stores/settingsStore'

/** AgentInput Props */
export interface AgentInputProps {
  /** 用户点击「前往配置」时的回调（可选） */
  onNavigateToSettings?: () => void
}

/** 快捷指令 key → 填入文本映射 */
const COMMAND_TEXT_MAP: Record<string, string> = {
  '/抽题': '从题库抽取 8 道科技类辩题',
  '/备赛': '帮我查询辩题详情，我想备赛',
  '/建赛事': '创建一个 8 队单淘汰赛',
  '/查辩题': '搜索题库中关于 AI 伦理的辩题'
}

/** 快捷指令菜单项 */
const COMMAND_MENU_ITEMS: MenuProps['items'] = [
  { key: '/抽题', label: '/抽题' },
  { key: '/备赛', label: '/备赛' },
  { key: '/建赛事', label: '/建赛事' },
  { key: '/查辩题', label: '/查辩题' }
]

/**
 * AgentInput — Agent 对话输入框
 *
 * 顶部一行快捷指令下拉；中间一行 TextArea + 发送/停止按钮；
 * 未配置 API Key 时输入框与按钮置灰，底部显示「前往配置」链接。
 */
export function AgentInput({ onNavigateToSettings }: AgentInputProps): JSX.Element {
  const { token } = theme.useToken()
  const [value, setValue] = useState('')

  const isLoading = useAgentStore((s) => s.isLoading)
  const sendMessage = useAgentStore((s) => s.sendMessage)
  const cancel = useAgentStore((s) => s.cancel)

  const apiKey = useSettingsStore((s) => s.aiConfig.apiKey)
  const apiKeyConfigured = apiKey.length > 0

  /** 发送当前输入：trim 后空串不发送，发送后清空输入框 */
  const handleSend = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    sendMessage(trimmed)
    setValue('')
  }

  /** 按钮点击：loading 时取消，否则发送 */
  const handleButtonClick = (): void => {
    if (isLoading) {
      cancel()
    } else {
      handleSend()
    }
  }

  /** 键盘事件：Enter 发送 / Shift+Enter 换行 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /** 快捷指令点击：填入对应文本，不自动发送 */
  const handleCommandClick: MenuProps['onClick'] = ({ key }) => {
    const text = COMMAND_TEXT_MAP[key]
    if (text) {
      setValue(text)
    }
  }

  const menu = <Menu items={COMMAND_MENU_ITEMS} onClick={handleCommandClick} />

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 12,
        gap: 8,
        borderTop: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {/* 顶部：快捷指令下拉（左对齐） */}
      <div style={{ display: 'flex' }}>
        <Dropdown overlay={menu} trigger={['click']} placement="topLeft">
          <Button icon={<ThunderboltOutlined />}>快捷指令</Button>
        </Dropdown>
      </div>

      {/* 中间：TextArea（flex:1）+ 发送/停止按钮 */}
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <Input.TextArea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoSize={{ minRows: 1, maxRows: 6 }}
          placeholder={
            apiKeyConfigured
              ? '输入消息，Enter 发送，Shift+Enter 换行'
              : '未配置 API Key，无法使用'
          }
          disabled={!apiKeyConfigured}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button
          type={isLoading ? 'default' : 'primary'}
          danger={isLoading}
          disabled={!apiKeyConfigured}
          icon={isLoading ? <StopOutlined /> : <SendOutlined />}
          onClick={handleButtonClick}
          style={{ marginLeft: 8 }}
        >
          {isLoading ? '停止' : '发送'}
        </Button>
      </div>

      {/* 底部：未配置 API Key 时的提示（仅 apiKey 为空时显示） */}
      {!apiKeyConfigured && (
        <div style={{ fontSize: 12 }}>
          <Typography.Text type="secondary">未配置 API Key，</Typography.Text>
          <Typography.Link onClick={() => onNavigateToSettings?.()}>前往配置</Typography.Link>
        </div>
      )}
    </div>
  )
}
