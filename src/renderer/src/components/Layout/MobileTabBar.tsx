// ============================================================
// MobileTabBar.tsx — 移动端底部 TabBar 组件
//
// 固定在视口底部的 5 项主 Tab 导航：抽取 / 题库 / 计时器 / 历史 / 更多
// 「更多」点击弹出底部抽屉，展示剩余菜单项（按 MENU_GROUPS 分组）
// 适配 iPhone X+ 安全区域（env(safe-area-inset-bottom)）
//
// 仅在移动端渲染（<768px），由 App.tsx 控制；本组件本身不判断屏幕宽度
// ============================================================

import { Drawer, Typography, theme } from 'antd'
import {
  GiftOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  MenuOutlined
} from '@ant-design/icons'
import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { MENU_GROUPS } from './AppSidebar'
import { colorGold, colorPurple, colorPrimary, zIndex, spacing, fontSize, gray } from '../../styles/tokens'

// ------------------------------------------------------------
// 类型定义
// ------------------------------------------------------------

export interface MobileTabBarProps {
  /** 当前路由 key */
  selectedKey: string
  /** 导航回调 */
  onNavigate: (key: string) => void
}

// ------------------------------------------------------------
// 主 Tab 定义（按使用频率排序，前 4 项为直接导航，第 5 项「更多」弹出抽屉）
// ------------------------------------------------------------

interface MainTabDef {
  key: string
  label: string
  icon: ReactNode
  /** 所属功能域强调色 */
  color: string
}

const MAIN_TABS: MainTabDef[] = [
  { key: '/draw', label: '抽取', icon: <GiftOutlined />, color: colorGold },
  { key: '/topics', label: '题库', icon: <DatabaseOutlined />, color: colorGold },
  { key: '/timer', label: '计时器', icon: <ClockCircleOutlined />, color: colorPurple },
  { key: '/history', label: '历史', icon: <HistoryOutlined />, color: colorGold }
]

/** 主 Tab key 集合 */
const MAIN_TAB_KEYS = new Set(MAIN_TABS.map((t) => t.key))

// ------------------------------------------------------------
// 路由 key → 所属组强调色映射（复用 AppSidebar 的 MENU_GROUPS）
// ------------------------------------------------------------

const ROUTE_GROUP_COLOR: Record<string, string> = MENU_GROUPS.reduce(
  (acc, group) => {
    group.items.forEach((item) => {
      acc[item.key] = group.color
    })
    return acc
  },
  {} as Record<string, string>
)

/** 根据 selectedKey 解析所属组强调色（支持前缀匹配子路由） */
function resolveSelectedColor(selectedKey: string): string {
  if (ROUTE_GROUP_COLOR[selectedKey]) return ROUTE_GROUP_COLOR[selectedKey]
  for (const key of Object.keys(ROUTE_GROUP_COLOR)) {
    if (selectedKey.startsWith(key)) return ROUTE_GROUP_COLOR[key]
  }
  return colorPrimary
}

/** 判断 selectedKey 是否匹配某 itemKey（精确或前缀，前缀匹配子路由） */
function isRouteActive(itemKey: string, selectedKey: string): boolean {
  return selectedKey === itemKey || selectedKey.startsWith(`${itemKey}/`)
}

// ------------------------------------------------------------
// 样式
// ------------------------------------------------------------

/** 单个 Tab 项：flex:1 居中，相对定位用于指示器
 *
 * 触摸目标 ≥56px：通过 min-height 保证（配合 .mobile-tab-btn CSS 中的 min-height: 56px
 * 双重保险，确保触摸区域满足可达性要求）。
 */
const tabStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8px 0',
  minHeight: 56,
  position: 'relative',
  cursor: 'pointer',
  userSelect: 'none'
}

/** 选中态顶部指示器：4px 高色条 */
const indicatorStyle = (color: string): CSSProperties => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 4,
  background: color
})

/** Tab 图标：24px */
const iconStyle: CSSProperties = {
  fontSize: fontSize.h2,
  lineHeight: 1
}

/** Tab 文字：10px */
const labelStyle: CSSProperties = {
  fontSize: fontSize.caption,
  marginTop: 2,
  lineHeight: 1
}

/** 抽屉内分组容器 */
const drawerGroupStyle: CSSProperties = {
  marginBottom: spacing.lg
}

/** 抽屉内单个菜单项 */
const drawerItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: `${spacing.md}px 0`,
  cursor: 'pointer',
  fontSize: fontSize.body
}

// ------------------------------------------------------------
// 组件
// ------------------------------------------------------------

function MobileTabBar({ selectedKey, onNavigate }: MobileTabBarProps) {
  const { token } = theme.useToken()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // TabBar 根容器：固定底部，56px + 安全区域
  const tabBarStyle: CSSProperties = {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: 'calc(56px + env(safe-area-inset-bottom, 0))',
    display: 'flex',
    background: token.colorBgContainer,
    borderTop: `1px solid ${gray[100]}`,
    boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.06)',
    paddingBottom: 'env(safe-area-inset-bottom, 0)',
    zIndex: zIndex.fixed
  }

  // 抽屉中要显示的菜单项（主 Tab 已展示的除外），按 MENU_GROUPS 分组
  const moreGroups = useMemo(
    () =>
      MENU_GROUPS.map((group) => ({
        title: group.title,
        color: group.color,
        items: group.items.filter((item) => !MAIN_TAB_KEYS.has(item.key))
      })).filter((group) => group.items.length > 0),
    []
  )

  // 判断「更多」是否处于选中态：当前路由不在主 Tab 中，且匹配某个更多菜单项
  const isMoreActive = useMemo(() => {
    if (MAIN_TAB_KEYS.has(selectedKey)) return false
    return moreGroups.some((g) => g.items.some((i) => isRouteActive(i.key, selectedKey)))
  }, [selectedKey, moreGroups])

  // 「更多」选中态颜色：取当前匹配项所属组色（金/紫/蓝）
  const moreColor = isMoreActive ? resolveSelectedColor(selectedKey) : token.colorTextSecondary

  /** 主 Tab 点击 */
  const handleTabClick = (key: string): void => {
    onNavigate(key)
  }

  /** 「更多」点击：打开抽屉 */
  const handleMoreClick = (): void => {
    setDrawerOpen(true)
  }

  /** 抽屉内菜单项点击：导航并关闭抽屉 */
  const handleMoreItemClick = (key: string): void => {
    onNavigate(key)
    setDrawerOpen(false)
  }

  return (
    <>
      <div style={tabBarStyle}>
        {MAIN_TABS.map((tab) => {
          const selected = isRouteActive(tab.key, selectedKey)
          const color = selected ? tab.color : token.colorTextSecondary
          return (
            <button
              key={tab.key}
              type="button"
              className="mobile-tab-btn"
              style={tabStyle}
              role="tab"
              aria-selected={selected}
              aria-label={tab.label + (selected ? '当前选中' : '')}
              onClick={() => handleTabClick(tab.key)}
            >
              {selected && <div style={indicatorStyle(tab.color)} />}
              <span style={{ ...iconStyle, color }}>{tab.icon}</span>
              <span style={{ ...labelStyle, color }}>{tab.label}</span>
            </button>
          )
        })}

        {/* 更多 Tab */}
        <button
          type="button"
          className="mobile-tab-btn"
          style={tabStyle}
          role="tab"
          aria-selected={isMoreActive}
          aria-label={'更多' + (isMoreActive ? '当前选中' : '')}
          onClick={handleMoreClick}
        >
          {isMoreActive && <div style={indicatorStyle(moreColor)} />}
          <span style={{ ...iconStyle, color: moreColor }}>
            <MenuOutlined />
          </span>
          <span style={{ ...labelStyle, color: moreColor }}>更多</span>
        </button>
      </div>

      {/* 更多抽屉：底部滑出，50vh 高 */}
      <Drawer
        title="完整菜单"
        placement="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        height="50vh"
        styles={{ body: { padding: spacing.lg } }}
      >
        {moreGroups.map((group) => (
          <div key={group.title} style={drawerGroupStyle}>
            <Typography.Text type="secondary" style={{ fontSize: fontSize.caption }}>
              {group.title}
            </Typography.Text>
            <div>
              {group.items.map((item) => {
                const active = isRouteActive(item.key, selectedKey)
                return (
                  <div
                    key={item.key}
                    style={{
                      ...drawerItemStyle,
                      color: active ? group.color : 'inherit'
                    }}
                    onClick={() => handleMoreItemClick(item.key)}
                  >
                    <span style={{ marginRight: spacing.md, fontSize: fontSize.h3, color: group.color }}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </Drawer>
    </>
  )
}

export default MobileTabBar
