// ============================================================
// AppSidebar.tsx — 辩盒应用侧栏（分组菜单 + Logo + 版本号）
//
// 三段式布局：顶部 Logo 区（64px）+ 中间 Menu 区（flex:1）+ 底部版本号区（48px）
// 菜单按功能域分组：赛事工作区（金）/ 比赛工具（紫）/ 系统（蓝）
// 高亮色随当前页所属功能域动态切换。
// ============================================================

import { ConfigProvider, Layout, Menu } from 'antd'
import type { MenuProps } from 'antd'
import {
  GiftOutlined,
  DatabaseOutlined,
  TeamOutlined,
  TrophyOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
  FormOutlined,
  RobotOutlined,
  SettingOutlined
} from '@ant-design/icons'
import type { CSSProperties, ReactNode } from 'react'
import {
  colorPrimary,
  colorGold,
  colorPurple,
  gradient,
  fontFamily,
  spacing,
  fontSize,
  glassSidebarBg,
  glassSidebarBgDark
} from '../../styles/tokens'
import { useThemeMode } from '../../hooks/useThemeMode'
import { APP_META } from '../AboutModal'

const { Sider } = Layout

// ------------------------------------------------------------
// 类型定义
// ------------------------------------------------------------

/** 单个菜单项定义 */
interface MenuItemDef {
  key: string
  icon: ReactNode
  label: string
}

/** 菜单分组定义 */
interface MenuGroupDef {
  /** 组标题 */
  title: string
  /** 组强调色 */
  color: string
  /** 组内菜单项 */
  items: MenuItemDef[]
}

export interface AppSidebarProps {
  /** 当前路由 key，用于高亮当前菜单项 */
  selectedKey: string
  /** 是否为折叠态（平板断点） */
  collapsed: boolean
  /** 菜单点击回调，参数为目标路由 key */
  onNavigate: (key: string) => void
}

// ------------------------------------------------------------
// 菜单分组数据（命名导出，便于 MobileTabBar 等组件复用）
// ------------------------------------------------------------

export const MENU_GROUPS: MenuGroupDef[] = [
  {
    title: '赛事工作区',
    color: colorGold,
    items: [
      { key: '/draw', icon: <GiftOutlined />, label: '抽取' },
      { key: '/topics', icon: <DatabaseOutlined />, label: '题库' },
      { key: '/teams', icon: <TeamOutlined />, label: '队伍' },
      { key: '/events', icon: <TrophyOutlined />, label: '赛事' },
      { key: '/history', icon: <HistoryOutlined />, label: '历史' }
    ]
  },
  {
    title: '比赛工具',
    color: colorPurple,
    items: [
      { key: '/timer', icon: <ClockCircleOutlined />, label: '计时器' },
      // 注意：路由 key 与 App.tsx 现有路由保持一致（/format-editor）
      { key: '/format-editor', icon: <FormOutlined />, label: '赛制编辑器' },
      { key: '/judge', icon: <RobotOutlined />, label: 'AI 裁判' }
    ]
  },
  {
    title: '系统',
    color: colorPrimary,
    items: [{ key: '/settings', icon: <SettingOutlined />, label: '设置' }]
  }
]

// ------------------------------------------------------------
// 路由 key → 所属组强调色映射（用于动态高亮）
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

/** 根据 selectedKey 解析当前页所属组的强调色（支持前缀匹配子路由） */
function resolveSelectedColor(selectedKey: string): string {
  if (ROUTE_GROUP_COLOR[selectedKey]) return ROUTE_GROUP_COLOR[selectedKey]
  for (const key of Object.keys(ROUTE_GROUP_COLOR)) {
    if (selectedKey.startsWith(key)) return ROUTE_GROUP_COLOR[key]
  }
  return colorPrimary
}

// ------------------------------------------------------------
// 样式
// ------------------------------------------------------------

/** Sider 根容器：三段式 flex 列布局（深色玻璃态） */
const siderStyle = (isDark: boolean): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  position: 'sticky',
  top: 0,
  // 亮色模式也使用深色玻璃态背景，增强「指挥台」氛围
  background: isDark ? glassSidebarBgDark : glassSidebarBg,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '2px 0 8px rgba(0, 0, 0, 0.04)',
  overflow: 'hidden'
})

/** Logo 区样式 */
const logoStyle: CSSProperties = {
  height: 64,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: gradient.primary,
  color: '#fff',
  flexShrink: 0,
  fontFamily: fontFamily.sans
}

/** 折叠态 Logo「辩」字 48×48 居中容器 */
const logoCollapsedStyle: CSSProperties = {
  width: 48,
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 26,
  fontWeight: 700,
  color: '#fff',
  lineHeight: 1
}

/** 展开态 Logo 文字列 */
const logoExpandedStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  lineHeight: 1.1,
  userSelect: 'none'
}

/** 中间 Menu 容器：flex 1，纵向滚动 */
const menuWrapperStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
  minHeight: 0
}

/** 底部版本号区样式（适配深色玻璃态背景） */
const footerStyle = (collapsed: boolean): CSSProperties => ({
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: collapsed ? 'center' : 'flex-start',
  padding: collapsed ? 0 : `0 ${spacing.lg}`,
  // 深色玻璃背景下使用半透明白色分隔线
  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
  fontSize: fontSize.caption,
  // 深色背景下使用半透明白色文字
  color: 'rgba(255, 255, 255, 0.45)',
  flexShrink: 0,
  fontFamily: fontFamily.mono,
  whiteSpace: 'nowrap'
})

// ------------------------------------------------------------
// 组件
// ------------------------------------------------------------

function AppSidebar({ selectedKey, collapsed, onNavigate }: AppSidebarProps) {
  // 当前实际生效的主题模式（用于选择玻璃态背景浓度）
  const { resolvedMode } = useThemeMode()
  const isDark = resolvedMode === 'dark'

  // 构造 antd Menu items（按 group 分组）
  const menuItems: MenuProps['items'] = MENU_GROUPS.map((group, groupIdx) => ({
    key: `group-${groupIdx}`,
    type: 'group' as const,
    label: group.title,
    children: group.items.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.label
    }))
  }))

  // 当前页所属组强调色 → 注入 antd Menu 选中态 token
  const selectedColor = resolveSelectedColor(selectedKey)

  return (
    <Sider
      width={240}
      collapsedWidth={80}
      collapsed={collapsed}
      trigger={null}
      theme="dark"
      style={siderStyle(isDark)}
    >
      {/* 顶部 Logo 区（保持品牌渐变不变） */}
      <div style={logoStyle}>
        {collapsed ? (
          <span style={logoCollapsedStyle}>辩</span>
        ) : (
          <div style={logoExpandedStyle}>
            <span style={{ fontSize: fontSize.h3, fontWeight: 700, color: '#fff' }}>辩盒</span>
            <span style={{ fontSize: fontSize.caption, color: 'rgba(255, 255, 255, 0.7)' }}>Debate Box</span>
          </div>
        )}
      </div>

      {/* 中间 Menu 区（暗色主题，浅色文字） */}
      <div style={menuWrapperStyle}>
        <ConfigProvider
          theme={{
            components: {
              Menu: {
                // 选中项背景：组强调色透明度（暗色底用 20%，增强可见性）
                itemSelectedBg: `${selectedColor}${isDark ? '33' : '1a'}`,
                // 选中项文字色：组强调色
                itemSelectedColor: selectedColor
              }
            }
          }}
        >
          <Menu
            mode="inline"
            theme="dark"
            inlineCollapsed={collapsed}
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key }) => onNavigate(key)}
            style={{ borderRight: 'none', fontFamily: fontFamily.sans, height: '100%', background: 'transparent' }}
          />
        </ConfigProvider>
      </div>

      {/* 底部版本号区 */}
      <div style={footerStyle(collapsed)}>{collapsed ? null : `v${APP_META.version}`}</div>
    </Sider>
  )
}

export default AppSidebar
