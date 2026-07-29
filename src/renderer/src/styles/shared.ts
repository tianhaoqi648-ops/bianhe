// ============================================================
// shared.ts — 共享 inline style 常量
//
// 消除 6+ 处重复的 `padding:12 + borderRadius:8 + border:1px solid colorBorderSecondary` 模式。
// 所有常量均为 React.CSSProperties，可直接展开使用。
// ============================================================

import { shadow, spacing, radius, gradient, colorGold, colorPurple, colorPrimary, fontSize, gray } from './tokens'

/** 页面容器（每个页面根 div）
 *
 * 设计要点（refine-ui-v2）：
 * - 不使用 `height: '100%'`：避免父容器隐式高度链路导致的 overflow 失效
 * - 仅约束 `minHeight`，允许内容超出时 body 自然滚动
 * - padding 使用 `clamp()` 在桌面 24 / 移动 16 之间自适应
 */
export const pageContainerStyle: React.CSSProperties = {
  padding: 'clamp(16px, 2vw, 24px)',
  minHeight: 'calc(100vh - 56px)'
}

/** 工具栏样式（顶部搜索 + 操作按钮区） */
export const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: spacing.sm,
  padding: `${spacing.md} ${spacing.lg}`,
  background: '#fff',
  borderRadius: radius.lg,
  border: `1px solid ${gray[100]}`,
  boxShadow: shadow.sm,
  marginBottom: spacing.lg
}

/** 通用卡片样式 */
export const cardStyle: React.CSSProperties = {
  borderRadius: radius.lg,
  boxShadow: shadow.sm
}

/** 统计卡片样式（带左侧色块） */
export const statCardStyle = (color: string): React.CSSProperties => ({
  borderRadius: radius.lg,
  overflow: 'hidden',
  position: 'relative',
  background: '#fff',
  border: `1px solid ${gray[100]}`,
  boxShadow: shadow.sm,
  borderLeft: `4px solid ${color}`
})

/** 统计卡片左侧色块装饰 */
export const statCardDecoration = (color: string): React.CSSProperties => ({
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  width: 4,
  background: color
})

/**
 * 卡片 hover 抬升动画基础样式
 *
 * 仅声明过渡属性，具体的 boxShadow / transform 由组件通过 hover 状态切换
 * （配合 shadow.cardRest → shadow.cardHover 实现「抬升」效果）。
 */
export const cardHoverStyle: React.CSSProperties = {
  transition: 'box-shadow 0.2s ease, transform 0.2s ease'
}

/**
 * 卡片左侧色条装饰类型
 * - gold：赛事工作区（DrawPage / TopicLibrary / EventManage / History）
 * - purple：比赛工具区（TimerPage）
 * - primary：系统区（Settings）
 * - none：无装饰
 */
export type CardAccent = 'gold' | 'purple' | 'primary' | 'none'

/**
 * 根据强调色返回卡片左侧色条样式（工厂函数）
 *
 * @param accent 强调色类型，默认 'none'（不渲染色条）
 * @returns React.CSSProperties，可直接展开到 Card 的 style 中
 */
export function getCardAccentStyle(accent: CardAccent = 'none'): React.CSSProperties {
  if (accent === 'none') return {}
  const color =
    accent === 'gold'
      ? colorGold
      : accent === 'purple'
        ? colorPurple
        : colorPrimary
  return {
    borderLeft: `3px solid ${color}`
  }
}

/** 选中态样式（题卡 / 列表项） */
export const selectedStyle: React.CSSProperties = {
  boxShadow: shadow.selected,
  borderColor: colorPrimary,
  borderWidth: 1,
  borderStyle: 'solid'
}

/** 主按钮增强样式 */
export const primaryButtonStyle: React.CSSProperties = {
  borderRadius: radius.lg,
  height: 44,
  fontSize: fontSize.h4,
  fontWeight: 600,
  boxShadow: shadow.primary
}

/** 标题左侧蓝色竖条装饰 */
export const titleBarStyle: React.CSSProperties = {
  borderLeft: `4px solid ${colorPrimary}`,
  paddingLeft: spacing.sm,
  display: 'flex',
  alignItems: 'center',
  gap: spacing.sm
}

/** 分页栏 sticky 样式 */
export const paginationStyle: React.CSSProperties = {
  position: 'sticky',
  bottom: 0,
  padding: `${spacing.md} ${spacing.lg}`,
  background: 'rgba(255, 255, 255, 0.85)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  borderTop: `1px solid ${gray[100]}`,
  borderRadius: `0 0 ${radius.lg}px ${radius.lg}px`,
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  zIndex: 10
}

/** 内容区背景渐变
 *
 * 设计要点（refine-ui-v2）：
 * - 不再约束 `minHeight`：已由 pageContainerStyle 承担，避免双重约束
 * - 仅保留 background 渐变，暗色模式由 App.tsx 动态覆盖
 */
export const contentBgStyle: React.CSSProperties = {
  background: gradient.contentBg
}

/** Sider 阴影 */
export const siderStyle: React.CSSProperties = {
  boxShadow: '2px 0 8px rgba(0, 0, 0, 0.04)'
}

/** Logo 容器样式（圆形渐变背景） */
export const logoContainerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  background: gradient.brand,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontSize: fontSize.h3,
  flexShrink: 0
}

/** Header 玻璃模糊效果 */
export const headerStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.85)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  borderBottom: `1px solid ${gray[100]}`,
  padding: `0 ${spacing.xxl}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 56
}

/** 空状态容器 */
export const emptyStateStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  minHeight: 400,
  padding: spacing.xxxl,
  textAlign: 'center'
}

/** 浮动操作栏（底部 Affix） */
export const floatActionBarStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: spacing.xl,
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#fff',
  borderRadius: radius.xl,
  boxShadow: shadow.xl,
  padding: `${spacing.md} ${spacing.xl}`,
  display: 'flex',
  alignItems: 'center',
  gap: spacing.md,
  zIndex: 100
}

/** 键盘按键样式（<kbd>） */
export const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  background: 'rgba(255, 255, 255, 0.15)',
  border: '1px solid rgba(255, 255, 255, 0.25)',
  borderRadius: radius.sm,
  fontFamily: 'monospace',
  fontSize: fontSize.caption,
  color: '#fff',
  margin: '0 4px'
}
