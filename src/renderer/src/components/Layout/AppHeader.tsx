// ============================================================
// AppHeader.tsx — 辩盒应用顶栏
//
// 两段式布局：左侧面包屑 + 右侧搜索/主题切换/关于
// - 面包屑：根据 selectedKey 从 MENU_GROUPS 解析所属组与页面名，当前页用组强调色
// - 搜索：点击按钮触发命令面板（Ctrl+K）
// - 主题切换：Dropdown 三态（亮色 / 暗色 / 跟随系统）
// - 关于：弹出 AboutModal 组件（Task 19）
// 响应式：≥768px 显示完整面包屑；<768px 仅显示当前页名
// ============================================================

import { Breadcrumb, Button, Dropdown, Grid, Layout, Tooltip, theme, Badge } from 'antd'
import type { MenuProps } from 'antd'
import {
  DesktopOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  MoonOutlined,
  SearchOutlined,
  SunOutlined
} from '@ant-design/icons'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { MENU_GROUPS } from './AppSidebar'
import { useThemeMode } from '../../hooks/useThemeMode'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import type { ThemeMode } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useDbModeStore } from '../../stores/dbModeStore'
import { useEventStore } from '../../stores/eventStore'
import { spacing, gray, colorGold } from '../../styles/tokens'
import AboutModal from '../AboutModal'

const { Header } = Layout
const { useBreakpoint } = Grid

// ------------------------------------------------------------
// 类型定义
// ------------------------------------------------------------

export interface AppHeaderProps {
  /** 当前路由 key */
  selectedKey: string
}

/** 从 selectedKey 解析出的菜单信息 */
interface ResolvedMenuInfo {
  /** 所属组标题（如"赛事工作区"） */
  groupTitle: string
  /** 所属组强调色 */
  groupColor: string
  /** 菜单项标签（如"题库"） */
  itemLabel: string
  /** 菜单项路由 key */
  itemKey: string
}

// ------------------------------------------------------------
// 辅助函数
// ------------------------------------------------------------

/**
 * 根据 selectedKey 从 MENU_GROUPS 解析所属组与页面信息。
 * 支持精确匹配与前缀匹配（用于子路由，如 /topics/123）。
 */
function resolveMenuInfo(selectedKey: string): ResolvedMenuInfo | null {
  // 精确匹配优先
  for (const group of MENU_GROUPS) {
    for (const item of group.items) {
      if (item.key === selectedKey) {
        return {
          groupTitle: group.title,
          groupColor: group.color,
          itemLabel: item.label,
          itemKey: item.key
        }
      }
    }
  }
  // 前缀匹配（子路由）
  for (const group of MENU_GROUPS) {
    for (const item of group.items) {
      if (selectedKey.startsWith(item.key)) {
        return {
          groupTitle: group.title,
          groupColor: group.color,
          itemLabel: item.label,
          itemKey: item.key
        }
      }
    }
  }
  return null
}

/** 根据当前主题模式返回对应图标 */
function getThemeIcon(mode: ThemeMode): React.ReactNode {
  if (mode === 'light') return <SunOutlined />
  if (mode === 'dark') return <MoonOutlined />
  return <DesktopOutlined />
}

// ------------------------------------------------------------
// 主题切换菜单项
// ------------------------------------------------------------

const THEME_MENU_ITEMS: MenuProps['items'] = [
  { key: 'light', label: '亮色', icon: <SunOutlined /> },
  { key: 'dark', label: '暗色', icon: <MoonOutlined /> },
  { key: 'system', label: '跟随系统', icon: <DesktopOutlined /> }
]

// ------------------------------------------------------------
// 组件
// ------------------------------------------------------------

function AppHeader({ selectedKey }: AppHeaderProps) {
  const { themeMode, setThemeMode } = useThemeMode()
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const screens = useBreakpoint()
  // md 未测量时（undefined）默认按桌面处理，避免初次渲染闪烁
  const isDesktop = screens.md !== false
  const isMobile = useMediaQuery('(max-width: 767px)')

  const [aboutOpen, setAboutOpen] = useState(false)

  // gov4.1：读取共享 dbModeStore（pv 由 App 根 initDbMode 初始化订阅），
  // 供"临时模式"Badge 展示（常驻警告条见 MemoryModeBanner）。
  const dbMode = useDbModeStore((s) => s.dbMode)

  // 从 eventStore 读取赛事列表 / 当前赛事 / 当前赛事轮次
  const events = useEventStore((s) => s.events)
  const currentEvent = useEventStore((s) => s.currentEvent)
  const rounds = useEventStore((s) => s.rounds)

  // 解析当前菜单信息
  const menuInfo = useMemo(() => resolveMenuInfo(selectedKey), [selectedKey])

  // 进行中赛事：优先使用 currentEvent（若正在进行），否则从列表中取第一个
  const ongoingEvent = useMemo(() => {
    if (currentEvent?.status === 'ongoing') return currentEvent
    return events.find((e) => e.status === 'ongoing') ?? null
  }, [events, currentEvent])

  // 当前轮次：仅当 currentEvent 即进行中赛事且轮次已加载时，取 round_number 最小者作为「当前轮次」
  const ongoingRound = useMemo(() => {
    if (!ongoingEvent || currentEvent?.id !== ongoingEvent.id) return null
    if (rounds.length === 0) return null
    const sorted = [...rounds].sort(
      (a, b) => (a.round_number ?? 0) - (b.round_number ?? 0)
    )
    return sorted[0] ?? null
  }, [ongoingEvent, currentEvent, rounds])

  // 轮次显示标签：优先 name，其次「第N轮」，都缺则不显示轮次
  const roundLabel =
    ongoingRound?.name ??
    (ongoingRound?.round_number != null
      ? `第${ongoingRound.round_number}轮`
      : null)

  // 主题切换菜单点击
  const handleThemeMenuClick: MenuProps['onClick'] = ({ key }) => {
    setThemeMode(key as ThemeMode)
  }

  // 胶囊点击：暂存预选赛事 ID 并跳转 /events
  const handleCapsuleClick = () => {
    if (!ongoingEvent) return
    localStorage.setItem('bianhe-event-preselect', ongoingEvent.id)
    navigate('/events')
  }

  return (
    <Header
      style={{
        background: token.colorBgContainer,
        borderBottom: `1px solid ${gray[100]}`,
        height: isMobile ? 56 : 64,
        padding: `0 ${isMobile ? spacing.md : spacing.xxl}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        flexShrink: 0
      }}
    >
      {/* 左侧：面包屑 + 进行中赛事胶囊（移动端仅显示当前页名） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.md,
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden'
        }}
      >
        {isDesktop ? (
          <Breadcrumb
            items={[
              {
                title: (
                  <span>
                    <HomeOutlined style={{ marginRight: 4 }} />
                    辩盒
                  </span>
                )
              },
              menuInfo ? { title: menuInfo.groupTitle } : null,
              menuInfo
                ? {
                    title: (
                      <span
                        style={{ color: menuInfo.groupColor, fontWeight: 500 }}
                      >
                        {menuInfo.itemLabel}
                      </span>
                    )
                  }
                : null
            ].filter(Boolean) as never}
          />
        ) : (
          // 移动端：只显示当前页名
          <span style={{ fontWeight: 500, fontSize: 15 }}>
            {menuInfo ? menuInfo.itemLabel : '辩盒'}
          </span>
        )}

        {/* 进行中赛事胶囊（无进行中赛事时不渲染） */}
        {ongoingEvent && (
          <div
            title="查看赛事详情"
            onClick={handleCapsuleClick}
            style={{
              background: colorGold,
              color: gray[900],
              borderRadius: 16,
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              userSelect: 'none'
            }}
          >
            {ongoingEvent.name}
            {roundLabel ? ` · ${roundLabel}` : ''}
          </div>
        )}
      </div>

      {/* 右侧：搜索 + 临时模式 Badge + 主题切换 + 关于 */}
      <div
        style={{
          flex: '0 0 auto',
          minWidth: 0,
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: spacing.sm
        }}
      >
        <Tooltip title="搜索 (Ctrl+K)">
          <Button
            type="text"
            icon={<SearchOutlined />}
            onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}
            aria-label="搜索"
          />
        </Tooltip>
        {dbMode === 'memory' && (
          <Tooltip title="数据库锁定，已切临时模式，重启应用可恢复">
            <Badge
              count="临时模式"
              color="#faad14"
              style={{
                cursor: 'help',
                fontSize: 12,
                height: 20,
                lineHeight: '20px',
                padding: '0 6px'
              }}
            />
          </Tooltip>
        )}
        <Dropdown
          menu={{ items: THEME_MENU_ITEMS, onClick: handleThemeMenuClick }}
          placement="bottomRight"
        >
          <Button
            shape="circle"
            size="large"
            icon={getThemeIcon(themeMode)}
            aria-label="切换主题"
          />
        </Dropdown>
        <Tooltip title="关于">
          <Button
            shape="circle"
            icon={<InfoCircleOutlined />}
            onClick={() => setAboutOpen(true)}
            aria-label="关于"
          />
        </Tooltip>
      </div>

      {/* 关于弹窗（AboutModal 组件，Task 19） */}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </Header>
  )
}

export default AppHeader
