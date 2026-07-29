// ============================================================
// CommandPalette.tsx — Ctrl+K 命令面板
//
// 集成页面跳转、题库搜索、赛事搜索、快速动作、最近访问。
// 使用 uiStore 控制 open 状态，window.location.hash 进行路由跳转
// （可在 HashRouter 外部渲染，不依赖 useNavigate）。
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Input, Typography, theme } from 'antd'
import type { InputRef } from 'antd'
import {
  FileTextOutlined,
  TrophyOutlined,
  ThunderboltOutlined,
  EnvironmentOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { useUIStore } from '../stores/uiStore'
import type { RecentActionEntry } from '../stores/uiStore'
import { MENU_GROUPS } from './Layout/AppSidebar'
import type { Topic, Event } from '../../../shared/types'
import { radius, spacing, fontSize, fontFamily } from '../styles/tokens'

const { Text } = Typography

// ------------------------------------------------------------
// 类型定义
// ------------------------------------------------------------

/** 单个命令项（扁平化后用于键盘导航） */
interface CommandItem {
  /** 唯一 key */
  id: string
  /** 图标 */
  icon: React.ReactNode
  /** 显示标签 */
  label: string
  /** 所属分组名 */
  group: string
  /** 搜索匹配用的附加关键字 */
  keywords?: string
  /** 路由路径（用于记录最近操作） */
  path: string
  /** 执行动作 */
  action: () => void
}

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

/** 快速动作预定义 */
const QUICK_ACTIONS: Array<{ label: string; path: string; keywords: string }> = [
  { label: '新建辩题', path: '/topics', keywords: 'new create 新建 辩题' },
  { label: '新建赛事', path: '/events', keywords: 'new create 新建 赛事' },
  { label: '开始计时', path: '/timer', keywords: 'start begin 开始 计时 timer' },
  { label: '导入辩题', path: '/topics', keywords: 'import 导入 辩题' }
]

/** 题目标题截断长度 */
const TOPIC_LABEL_MAX = 60

/** 面板最大显示项数 */
const MAX_ITEMS = 8

/** 搜索 API 防抖延迟 (ms) */
const SEARCH_DEBOUNCE_MS = 200

// ------------------------------------------------------------
// 辅助函数
// ------------------------------------------------------------

/** 在 MENU_GROUPS 中查找路由对应的菜单项 */
function findMenuItem(path: string) {
  for (const group of MENU_GROUPS) {
    const found = group.items.find((item) => item.key === path)
    if (found) return found
  }
  return null
}

/** 截断字符串并追加省略号 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

/**
 * 规范化命令 id，用于最近操作去重。
 * - `recent-action-X` → `X`（最近操作区点击时复用原 id）
 * - `recent-/path` → `page-/path`（与页面跳转项视为同一操作）
 * - 其他保持不变
 */
function normalizeActionId(itemId: string): string {
  if (itemId.startsWith('recent-action-')) {
    return itemId.slice('recent-action-'.length)
  }
  if (itemId.startsWith('recent-')) {
    return `page-${itemId.slice('recent-'.length)}`
  }
  return itemId
}

/** 根据 item id 推断图标类型 */
function getIconType(itemId: string): RecentActionEntry['iconType'] | null {
  const normalized = normalizeActionId(itemId)
  if (normalized.startsWith('page-')) return 'page'
  if (normalized.startsWith('action-')) return 'action'
  if (normalized.startsWith('topic-')) return 'topic'
  if (normalized.startsWith('event-')) return 'event'
  return null
}

/** 根据图标类型 + 路径重建图标 ReactNode（用于反序列化最近操作） */
function getIconForType(iconType: RecentActionEntry['iconType'], path: string): React.ReactNode {
  switch (iconType) {
    case 'page': {
      const menuItem = findMenuItem(path)
      return menuItem?.icon ?? <EnvironmentOutlined />
    }
    case 'topic':
      return <FileTextOutlined />
    case 'event':
      return <TrophyOutlined />
    case 'action':
      return <ThunderboltOutlined />
    default:
      return <EnvironmentOutlined />
  }
}

// ------------------------------------------------------------
// 组件
// ------------------------------------------------------------

/**
 * CommandPalette — Ctrl+K 命令面板
 *
 * 无 props，所有状态从 uiStore 读取。
 * 5 大分组：最近访问 / 页面跳转 / 题库搜索 / 赛事搜索 / 快速动作。
 * 键盘：↑↓ 导航、Enter 执行、Esc 关闭。
 * 路由跳转使用 window.location.hash，可在 HashRouter 外部渲染。
 */
function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    recentPages,
    addRecentPage,
    recentActions,
    addRecentAction
  } = useUIStore()
  const { token } = theme.useToken()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [topics, setTopics] = useState<Topic[]>([])
  const [events, setEvents] = useState<Event[]>([])

  const inputRef = useRef<InputRef>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 打开时自动聚焦 + 重置状态
  useEffect(() => {
    if (!commandPaletteOpen) return
    setQuery('')
    setSelectedIndex(0)
    setTopics([])
    setEvents([])
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [commandPaletteOpen])

  // 跳转辅助函数：使用 hash 路由（不依赖 useNavigate，可在 Router 外部渲染）
  const navigateTo = (path: string) => {
    addRecentPage(path)
    setCommandPaletteOpen(false)
    window.location.hash = path
  }

  /**
   * 执行命令并记录到最近操作。
   * - 通过 normalizeActionId 规范化 id（recent-* → page-*），保证去重一致性
   * - 来自"最近操作"区的点击也会更新顺序（移到顶部）
   */
  const executeItem = (item: CommandItem) => {
    const normalizedId = normalizeActionId(item.id)
    const iconType = getIconType(item.id)
    if (iconType) {
      addRecentAction({
        id: normalizedId,
        label: item.label,
        // 来自"最近访问"/"最近操作"区的条目统一记录为原始分组
        group: item.group === '最近访问' || item.group === '最近操作' ? '页面跳转' : item.group,
        path: item.path,
        iconType
      })
    }
    item.action()
  }

  // 题库搜索（防抖，仅当 query >= 1 字符）
  useEffect(() => {
    if (!commandPaletteOpen) return
    const keyword = query.trim()
    if (keyword.length < 1) {
      setTopics([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await window.topicAPI.list({ keyword, page: 1, pageSize: 5 })
        if (res.success && res.data) {
          setTopics(res.data.items)
        } else {
          setTopics([])
        }
      } catch {
        setTopics([])
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, commandPaletteOpen])

  // 赛事搜索（防抖）
  // 注意：EventFilter 不含 keyword 字段，先拉取再客户端按名称过滤，取前 5 条
  useEffect(() => {
    if (!commandPaletteOpen) return
    const keyword = query.trim().toLowerCase()
    if (keyword.length < 1) {
      setEvents([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await window.eventAPI.listEvents({ page: 1, pageSize: 100 })
        if (res.success && res.data) {
          const filtered = res.data.items
            .filter((e) => e.name.toLowerCase().includes(keyword))
            .slice(0, 5)
          setEvents(filtered)
        } else {
          setEvents([])
        }
      } catch {
        setEvents([])
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, commandPaletteOpen])

  // 构建所有分组的扁平化项列表
  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase()
    const match = (text: string) => q === '' || text.toLowerCase().includes(q)
    const result: CommandItem[] = []

    // 0. 最近操作（仅当 query 为空时显示，置于顶部）
    if (q === '' && recentActions.length > 0) {
      recentActions.forEach((entry) => {
        result.push({
          id: `recent-action-${entry.id}`,
          icon: getIconForType(entry.iconType, entry.path),
          label: entry.label,
          group: '最近操作',
          keywords: entry.label,
          path: entry.path,
          action: () => navigateTo(entry.path)
        })
      })
    }

    // 1. 最近访问（仅有内容时显示）
    if (recentPages.length > 0) {
      recentPages.forEach((path) => {
        const menuItem = findMenuItem(path)
        const label = menuItem?.label ?? path
        const icon = menuItem?.icon ?? <EnvironmentOutlined />
        if (match(label) || match(path)) {
          result.push({
            id: `recent-${path}`,
            icon,
            label,
            group: '最近访问',
            keywords: path,
            path,
            action: () => navigateTo(path)
          })
        }
      })
    }

    // 2. 页面跳转（始终显示，匹配时过滤）
    MENU_GROUPS.forEach((group) => {
      group.items.forEach((item) => {
        if (match(item.label) || match(item.key)) {
          result.push({
            id: `page-${item.key}`,
            icon: item.icon,
            label: item.label,
            group: '页面跳转',
            keywords: item.key,
            path: item.key,
            action: () => navigateTo(item.key)
          })
        }
      })
    })

    // 3. 题库搜索（仅当 query >= 1 字符时，最多 5 条）
    if (q.length >= 1) {
      topics.forEach((topic, idx) => {
        result.push({
          id: `topic-${topic.id}-${idx}`,
          icon: <FileTextOutlined />,
          label: truncate(topic.title, TOPIC_LABEL_MAX),
          group: '题库',
          keywords: topic.title,
          path: '/topics',
          action: () => navigateTo('/topics')
        })
      })
    }

    // 4. 赛事搜索（仅当 query >= 1 字符时，最多 5 条）
    if (q.length >= 1) {
      events.forEach((event, idx) => {
        result.push({
          id: `event-${event.id}-${idx}`,
          icon: <TrophyOutlined />,
          label: event.name,
          group: '赛事',
          keywords: event.name,
          path: '/events',
          action: () => navigateTo('/events')
        })
      })
    }

    // 5. 快速动作（始终显示，匹配时过滤）
    QUICK_ACTIONS.forEach((action) => {
      if (match(action.label) || match(action.keywords)) {
        result.push({
          id: `action-${action.label}`,
          icon: <ThunderboltOutlined />,
          label: action.label,
          group: '快速动作',
          keywords: action.keywords,
          path: action.path,
          action: () => navigateTo(action.path)
        })
      }
    })

    return result
    // navigateTo 依赖 uiStore 的稳定 actions，无需进入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, recentPages, recentActions, topics, events])

  // 限制最多显示 8 项
  const visibleItems = useMemo(() => items.slice(0, MAX_ITEMS), [items])

  // selectedIndex 边界保护
  useEffect(() => {
    if (selectedIndex >= visibleItems.length) {
      setSelectedIndex(Math.max(0, visibleItems.length - 1))
    }
  }, [visibleItems.length, selectedIndex])

  // 将可见项按分组聚合，便于渲染分组标题
  const groupedVisible = useMemo(() => {
    const groups: Array<{ title: string; items: CommandItem[] }> = []
    visibleItems.forEach((item) => {
      let g = groups.find((x) => x.title === item.group)
      if (!g) {
        g = { title: item.group, items: [] }
        groups.push(g)
      }
      g.items.push(item)
    })
    return groups
  }, [visibleItems])

  // 键盘交互：↑↓ 导航、Enter 执行、Esc 关闭、数字键 1-8 快速跳转
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, visibleItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = visibleItems[selectedIndex]
      if (item) executeItem(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setCommandPaletteOpen(false)
    } else if (/^[1-8]$/.test(e.key)) {
      // 数字键 1-8 快速跳转：仅当查询为空时生效，避免影响搜索输入
      if (query.trim() === '') {
        const idx = parseInt(e.key, 10) - 1
        if (idx < visibleItems.length) {
          e.preventDefault()
          const item = visibleItems[idx]
          if (item) executeItem(item)
        }
      }
      // 查询非空时，数字键正常输入到搜索框（不 preventDefault）
    }
  }

  // 选中项滚动到可视区
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!commandPaletteOpen) return null

  // 计算分组内项的全局索引偏移（用于键盘导航跨分组）
  let runningIndex = 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh'
      }}
      onClick={() => setCommandPaletteOpen(false)}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          width: 640,
          maxWidth: '92vw',
          maxHeight: '70vh',
          background: token.colorBgContainer,
          borderRadius: radius.xl,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: fontFamily.sans
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部搜索 Input（自动聚焦） */}
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelectedIndex(0)
          }}
          placeholder="搜索页面、辩题、赛事或动作…"
          variant="borderless"
          prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
          style={{
            fontSize: 16,
            padding: `${spacing.lg}px ${spacing.xl}px`,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 0
          }}
        />

        {/* 分组列表 */}
        <div
          ref={listRef}
          style={{
            overflowY: 'auto',
            padding: `${spacing.sm}px 0`
          }}
        >
          {visibleItems.length === 0 ? (
            <div
              style={{
                padding: `${spacing.xl}px ${spacing.xxl}px`,
                textAlign: 'center'
              }}
            >
              <Text type="secondary">无匹配项</Text>
            </div>
          ) : (
            groupedVisible.map((group) => {
              const groupStartIndex = runningIndex
              runningIndex += group.items.length
              return (
                <div key={group.title}>
                  {/* 分组标题 */}
                  <div
                    style={{
                      fontSize: fontSize.caption,
                      color: token.colorTextSecondary,
                      padding: `${spacing.sm}px ${spacing.lg}px`,
                      fontWeight: 500
                    }}
                  >
                    {group.title}
                  </div>
                  {/* 分组项 */}
                  {group.items.map((item, idx) => {
                    const globalIdx = groupStartIndex + idx
                    const selected = globalIdx === selectedIndex
                    // 数字索引（1-8），仅前 8 项显示
                    const numberLabel = globalIdx < 8 ? String(globalIdx + 1) : null
                    return (
                      <div
                        key={item.id}
                        data-idx={globalIdx}
                        onClick={() => executeItem(item)}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: spacing.md,
                          padding: `${spacing.md}px ${spacing.lg}px`,
                          cursor: 'pointer',
                          background: selected ? token.colorPrimaryBg : 'transparent',
                          color: selected ? token.colorPrimaryText : token.colorText,
                          transition: 'background 0.1s ease'
                        }}
                      >
                        {/* 数字索引 kbd 徽章 */}
                        {numberLabel && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 500,
                              color: selected ? token.colorPrimary : token.colorTextTertiary,
                              width: 18,
                              height: 18,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: `1px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
                              borderRadius: radius.sm,
                              flexShrink: 0,
                              fontFamily: fontFamily.mono,
                              lineHeight: 1
                            }}
                          >
                            {numberLabel}
                          </span>
                        )}
                        {!numberLabel && <span style={{ width: 18, flexShrink: 0 }} />}
                        <span
                          style={{
                            fontSize: 16,
                            color: selected ? token.colorPrimary : token.colorTextSecondary,
                            display: 'flex',
                            flexShrink: 0
                          }}
                        >
                          {item.icon}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {item.label}
                        </span>
                        {/* 题库 / 赛事标签 */}
                        {(item.group === '题库' || item.group === '赛事') && (
                          <span
                            style={{
                              fontSize: 11,
                              color: token.colorTextTertiary,
                              padding: '1px 6px',
                              border: `1px solid ${token.colorBorderSecondary}`,
                              borderRadius: radius.sm,
                              flexShrink: 0
                            }}
                          >
                            {item.group}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            padding: `${spacing.sm}px ${spacing.lg}px`,
            fontSize: 11,
            color: token.colorTextTertiary,
            display: 'flex',
            gap: spacing.lg,
            justifyContent: 'flex-end'
          }}
        >
          <span>↑↓ 导航</span>
          <span>↵ 选择</span>
          <span>1-8 快速跳转</span>
          <span>ESC 关闭</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
