// ============================================================
// SessionList.tsx — Agent 会话列表侧边栏（AI Agent v1.3.0 Week 7 Task 42）
//
// 职责：
// 1. 宽度 200px，可折叠（折叠状态由父组件 AgentChatPanel 控制，SubTask 42.1）
// 2. 顶部搜索框 + 「新建会话」按钮（SubTask 42.2）
// 3. 列表项展示 title / 最后消息预览（30 字截断）/ updatedAt 相对时间（SubTask 42.3）
// 4. 当前会话高亮；双击 title 进入重命名编辑态（Enter 保存 / ESC 取消，SubTask 42.4）
// 5. 每项右侧「删除」按钮 hover 显示，点击弹二次确认（SubTask 42.5）
// 6. 搜索状态下列表替换为搜索结果，点击结果跳转对应会话并清空搜索（SubTask 42.6）
//
// 依赖：
// - antd Input.Search / Button / List / Modal / Tooltip / Typography / Empty / theme
// - @ant-design/icons PlusOutlined / DeleteOutlined / SearchOutlined
// - useAgentSessionStore: sessions / currentSessionId / searchKeyword / searchResults
//   loadSessions / createSession / switchSession / renameSession / deleteSession
//   searchSessions / clearSearch
//
// 设计要点：
// - 折叠态显示 48px 窄条（仅图标 + 垂直标题），与 AgentChatPanel 折叠态风格一致
// - 搜索采用 debounce（300ms）避免高频 IPC 调用；空关键词时清空搜索态
// - 双击 title 切换为 Input 编辑态；Enter 保存 / ESC 取消 / blur 也保存
// - 列表项 hover 时显示删除按钮（opacity 过渡），避免常态视觉噪音
// - 相对时间格式化使用原生 Date 实现（项目未引入 dayjs）
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Input, Button, List, Modal, Tooltip, Typography, Empty, theme } from 'antd'
import type { InputRef } from 'antd'
import { PlusOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import { useAgentSessionStore } from '../../stores/agentSessionStore'
import type { AgentSession } from '../../../../shared/agent-types'

/** SessionList Props */
export interface SessionListProps {
  /** 折叠状态（由父组件 AgentChatPanel 控制） */
  collapsed: boolean
}

/** 展开态宽度 */
const PANEL_WIDTH_EXPANDED = 200
/** 折叠态宽度（与 AgentChatPanel 折叠态一致） */
const PANEL_WIDTH_COLLAPSED = 48
/** 搜索 debounce 延迟（ms） */
const SEARCH_DEBOUNCE_MS = 300
/** 最后消息预览最大长度 */
const PREVIEW_MAX_LENGTH = 30

/**
 * 格式化 ISO 时间为相对时间文案。
 * - 1 分钟内：刚刚
 * - 1 小时内：N 分钟前
 * - 24 小时内：N 小时前
 * - 7 天内：N 天前
 * - 超过 7 天：YYYY-MM-DD
 *
 * 与项目其他组件一致使用原生 Date（项目未引入 dayjs）。
 */
function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 0) return '刚刚'
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    if (diff < minute) return '刚刚'
    if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
    if (diff < day) return `${Math.floor(diff / hour)} 小时前`
    if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch {
    return iso
  }
}

/**
 * 截断最后消息预览到指定长度。
 * 空字符串返回占位文案「（暂无消息）」。
 */
function truncatePreview(text: string, max: number = PREVIEW_MAX_LENGTH): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return '（暂无消息）'
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max) + '...'
}

/**
 * SessionList — Agent 会话列表侧边栏
 *
 * collapsed=true 时显示 48px 窄条（仅 PlusOutlined 图标 + 垂直「会话」标题）；
 * collapsed=false 时显示 200px 完整面板（搜索框 + 新建按钮 + 会话列表）。
 */
export function SessionList({ collapsed }: SessionListProps): JSX.Element {
  const { token } = theme.useToken()

  // ===== store 状态 =====
  const sessions = useAgentSessionStore((s) => s.sessions)
  const currentSessionId = useAgentSessionStore((s) => s.currentSessionId)
  const searchKeyword = useAgentSessionStore((s) => s.searchKeyword)
  const searchResults = useAgentSessionStore((s) => s.searchResults)
  const loadSessions = useAgentSessionStore((s) => s.loadSessions)
  const createSession = useAgentSessionStore((s) => s.createSession)
  const switchSession = useAgentSessionStore((s) => s.switchSession)
  const renameSession = useAgentSessionStore((s) => s.renameSession)
  const deleteSession = useAgentSessionStore((s) => s.deleteSession)
  const searchSessions = useAgentSessionStore((s) => s.searchSessions)
  const clearSearch = useAgentSessionStore((s) => s.clearSearch)

  // ===== 本地状态 =====
  /** 搜索框输入值（与 store.searchKeyword 分离，便于 debounce） */
  const [searchValue, setSearchValue] = useState('')
  /** 当前正在重命名的会话 id */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  /** 重命名输入框的当前值 */
  const [renamingTitle, setRenamingTitle] = useState('')
  /** 重命名输入框 ref（用于自动聚焦，antd Input 的 ref 类型为 InputRef） */
  const renameInputRef = useRef<InputRef>(null)
  /** debounce 定时器 ref */
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 首次挂载：拉取会话列表
  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  // 卸载时清理 debounce 定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [])

  // 进入重命名态时自动聚焦并选中文字
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  // ===== 事件处理 =====

  /** 搜索框 onChange：本地立即更新 + debounce 调用 store.searchSessions。
   * 空关键词立即清空搜索态，不走 debounce（保证 allowClear 响应及时）。 */
  const handleSearchChange = useCallback(
    (value: string): void => {
      setSearchValue(value)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      // 空关键词：立即清空搜索态
      if (!value.trim()) {
        clearSearch()
        return
      }
      debounceTimerRef.current = setTimeout(() => {
        void searchSessions(value)
      }, SEARCH_DEBOUNCE_MS)
    },
    [searchSessions, clearSearch]
  )

  /** 清空搜索（点击搜索框右侧清除按钮或 ESC） */
  const handleSearchClear = useCallback((): void => {
    setSearchValue('')
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    clearSearch()
  }, [clearSearch])

  /** 新建会话 */
  const handleCreate = useCallback((): void => {
    void createSession('新会话')
  }, [createSession])

  /** 切换会话 */
  const handleSwitch = useCallback(
    (id: string): void => {
      void switchSession(id)
    },
    [switchSession]
  )

  /** 点击搜索结果：跳转对应会话并清空搜索 */
  const handleSearchResultClick = useCallback(
    (id: string): void => {
      void switchSession(id)
      handleSearchClear()
    },
    [switchSession, handleSearchClear]
  )

  /** 双击 title 进入重命名编辑态 */
  const handleRenameStart = useCallback((session: AgentSession): void => {
    setRenamingId(session.id)
    setRenamingTitle(session.title)
  }, [])

  /** 保存重命名：空字符串不保存；与原标题相同则直接退出编辑态 */
  const handleRenameSave = useCallback((): void => {
    if (!renamingId) return
    const trimmed = renamingTitle.trim()
    const original = sessions.find((s) => s.id === renamingId)?.title ?? ''
    if (trimmed && trimmed !== original) {
      void renameSession(renamingId, trimmed)
    }
    setRenamingId(null)
    setRenamingTitle('')
  }, [renamingId, renamingTitle, sessions, renameSession])

  /** 取消重命名（ESC） */
  const handleRenameCancel = useCallback((): void => {
    setRenamingId(null)
    setRenamingTitle('')
  }, [])

  /** 重命名输入框键盘事件：Enter 保存 / ESC 取消 */
  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleRenameSave()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleRenameCancel()
      }
    },
    [handleRenameSave, handleRenameCancel]
  )

  /** 删除会话二次确认 */
  const handleDelete = useCallback(
    (session: AgentSession): void => {
      Modal.confirm({
        title: '删除会话',
        content: `确定要删除会话「${session.title}」吗？该会话的全部消息将一并删除，此操作不可撤销。`,
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => deleteSession(session.id)
      })
    },
    [deleteSession]
  )

  // ===== 渲染辅助 =====

  /** 渲染单个会话项 */
  const renderItem = (session: AgentSession, isSearchResult: boolean): React.ReactNode => {
    const isCurrent = session.id === currentSessionId
    const isRenaming = renamingId === session.id
    return (
      <List.Item
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          backgroundColor: isCurrent
            ? token.colorPrimaryBg
            : 'transparent',
          borderLeft: isCurrent
            ? `2px solid ${token.colorPrimary}`
            : '2px solid transparent',
          transition: 'background-color 0.2s',
          position: 'relative'
        }}
        onMouseEnter={(e) => {
          // hover 时若非当前会话，添加淡色背景
          if (!isCurrent) {
            e.currentTarget.style.backgroundColor = token.colorFillQuaternary
          }
        }}
        onMouseLeave={(e) => {
          if (!isCurrent) {
            e.currentTarget.style.backgroundColor = 'transparent'
          }
        }}
        onClick={() =>
          isSearchResult
            ? handleSearchResultClick(session.id)
            : handleSwitch(session.id)
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
          {/* 第一行：标题（或重命名输入框） + 删除按钮 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              minWidth: 0
            }}
          >
            {isRenaming ? (
              <Input
                ref={renameInputRef}
                size="small"
                value={renamingTitle}
                onChange={(e) => setRenamingTitle(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={handleRenameSave}
                onClick={(e) => e.stopPropagation()}
                style={{ flex: 1, minWidth: 0 }}
              />
            ) : (
              <Typography.Text
                strong={isCurrent}
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  handleRenameStart(session)
                }}
                title={session.title}
              >
                {session.title}
              </Typography.Text>
            )}

            {/* 删除按钮：仅非重命名态显示，hover 行时显现 */}
            {!isRenaming && (
              <Tooltip title="删除会话" placement="top">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(session)
                  }}
                  style={{
                    flexShrink: 0,
                    opacity: 0,
                    transition: 'opacity 0.2s'
                  }}
                  className="session-delete-btn"
                  aria-label={`删除会话 ${session.title}`}
                />
              </Tooltip>
            )}
          </div>

          {/* 第二行：最后消息预览 */}
          <Typography.Text
            type="secondary"
            style={{
              fontSize: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {truncatePreview(session.lastMessageText)}
          </Typography.Text>

          {/* 第三行：相对时间 */}
          <Typography.Text
            type="secondary"
            style={{ fontSize: 11 }}
          >
            {formatRelativeTime(session.updatedAt)}
          </Typography.Text>
        </div>
      </List.Item>
    )
  }

  // ===== 容器样式 =====
  const panelStyle: React.CSSProperties = {
    width: collapsed ? PANEL_WIDTH_COLLAPSED : PANEL_WIDTH_EXPANDED,
    height: '100%',
    backgroundColor: token.colorBgContainer,
    borderRight: `1px solid ${token.colorBorderSecondary}`,
    transition: 'width 0.2s ease',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0
  }

  // 局部样式：hover 行时显示删除按钮
  const hoverStyle = `
    .session-list-item:hover .session-delete-btn,
    .session-list-item:focus-within .session-delete-btn {
      opacity: 1 !important;
    }
  `

  // ===== 折叠态：48px 窄条 =====
  if (collapsed) {
    return (
      <div style={panelStyle}>
        <style>{hoverStyle}</style>
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
          <Tooltip title="新建会话" placement="right">
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={handleCreate}
              aria-label="新建会话"
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
            会话
          </div>
        </div>
      </div>
    )
  }

  // ===== 展开态：200px 完整面板 =====
  // 搜索态下展示 searchResults，否则展示 sessions
  const isSearching = searchKeyword.trim().length > 0
  const listData = isSearching ? searchResults : sessions
  const isEmpty = listData.length === 0

  return (
    <div style={panelStyle}>
      <style>{hoverStyle}</style>

      {/* 顶部：搜索框 + 新建会话按钮 */}
      <div
        style={{
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0
        }}
      >
        <Input.Search
          size="small"
          placeholder="搜索会话"
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          allowClear
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          // onSearch 不绑定：实际搜索由 onChange debounce 驱动，
          // allowClear 的清除按钮已通过 onChange('') 立即清空搜索态
        />
        <Button
          block
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={handleCreate}
        >
          新建会话
        </Button>
      </div>

      {/* 中部：会话列表 / 搜索结果列表 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0
        }}
        className="session-list-container"
      >
        {isEmpty ? (
          <div style={{ padding: 16 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                isSearching ? '未找到匹配的会话' : '暂无会话'
              }
            />
          </div>
        ) : (
          <List
            dataSource={listData}
            split={false}
            renderItem={(session) => (
              <div className="session-list-item">
                {renderItem(session, isSearching)}
              </div>
            )}
          />
        )}
      </div>

      {/* 底部：搜索状态指示（仅搜索态显示） */}
      {isSearching && (
        <div
          style={{
            padding: '4px 12px',
            fontSize: 11,
            color: token.colorTextSecondary,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>找到 {searchResults.length} 个结果</span>
          <Typography.Link
            style={{ fontSize: 11 }}
            onClick={handleSearchClear}
          >
            退出搜索
          </Typography.Link>
        </div>
      )}
    </div>
  )
}
