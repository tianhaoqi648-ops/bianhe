// ============================================================
// AccentCard.tsx — 带强调色条 + hover 抬升动画的 Card 包装组件
//
// 在 antd Card 基础上叠加：
// 1. 左侧 3px 色条装饰（getCardAccentStyle）
// 2. hover 时切换至 shadow.cardHover 阴影 + translateY(-2px) 抬升
// 3. hover/off 状态过渡由 cardHoverStyle 提供
// 4. accent='auto'（默认）时根据当前路由自动解析强调色
//
// 用于页面级 Card 的统一替换，避免每个页面各自实现 hover 逻辑。
// ============================================================

import { Card } from 'antd'
import type { CardProps } from 'antd'
import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { shadow } from '../../styles/tokens'
import {
  cardHoverStyle,
  getCardAccentStyle,
  type CardAccent
} from '../../styles/shared'

// ------------------------------------------------------------
// 路由 → 强调色解析（与 PageHeader 保持一致）
// ------------------------------------------------------------

/** 金色路由前缀（赛事工作区） */
const GOLD_ROUTES = ['/draw', '/topics', '/events', '/history', '/teams']
/** 紫色路由前缀（比赛工具区） */
const PURPLE_ROUTES = ['/timer', '/format']
/** 蓝色路由前缀（系统区） */
const PRIMARY_ROUTES = ['/settings']

/**
 * 根据 pathname 解析强调色类型。
 * 支持前缀匹配，便于子路由（如 /topics/123）继承所属区颜色。
 * 未匹配的路由返回 'none'（不渲染色条）。
 */
function resolveAccentByPathname(
  pathname: string
): 'gold' | 'purple' | 'primary' | 'none' {
  if (GOLD_ROUTES.some((r) => pathname.startsWith(r))) return 'gold'
  if (PURPLE_ROUTES.some((r) => pathname.startsWith(r))) return 'purple'
  if (PRIMARY_ROUTES.some((r) => pathname.startsWith(r))) return 'primary'
  return 'none'
}

// ------------------------------------------------------------
// 类型定义
// ------------------------------------------------------------

/** accent prop 支持的值，'auto' 为默认值，根据路由自动解析 */
export type AccentCardAccent = CardAccent | 'auto'

export interface AccentCardProps extends CardProps {
  /**
   * 左侧色条强调色：
   * - 'auto'（默认）：根据 useLocation 路由自动解析
   * - 'gold' | 'purple' | 'primary'：显式指定，覆盖自动解析
   * - 'none'：不渲染色条
   */
  accent?: AccentCardAccent
  /** 是否启用 hover 抬升动画，默认 true */
  hoverable?: boolean
}

/**
 * AccentCard — 强调色 Card 包装组件
 *
 * 用法：
 * ```tsx
 * // 自动根据路由解析强调色（推荐）
 * <AccentCard title="抽取配置">
 *   ...
 * </AccentCard>
 *
 * // 显式指定强调色
 * <AccentCard accent="gold" title="抽取配置">
 *   ...
 * </AccentCard>
 * ```
 *
 * 不传 accent 或传 'auto' 时，根据当前路由自动解析强调色。
 * 传 'none' 时退化为普通 Card（仅 hoverable 控制 hover 效果）。
 */
export default function AccentCard({
  accent = 'auto',
  hoverable = true,
  style,
  onMouseEnter,
  onMouseLeave,
  children,
  ...rest
}: AccentCardProps) {
  const [hovered, setHovered] = useState(false)
  const location = useLocation()

  // 强调色优先级：显式传入（非 auto） > 路由自动解析
  const resolvedAccent: CardAccent =
    accent === 'auto' ? resolveAccentByPathname(location.pathname) : accent

  const handleMouseEnter: React.MouseEventHandler<HTMLDivElement> = (e) => {
    setHovered(true)
    onMouseEnter?.(e)
  }

  const handleMouseLeave: React.MouseEventHandler<HTMLDivElement> = (e) => {
    setHovered(false)
    onMouseLeave?.(e)
  }

  // hover 时切换至 cardHover 阴影并向上抬升 2px；非 hover 时回到 cardRest 基础态
  const hoverEffect: React.CSSProperties = hoverable
    ? {
        boxShadow: hovered ? shadow.cardHover : shadow.cardRest,
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)'
      }
    : {
        boxShadow: shadow.cardRest
      }

  return (
    <Card
      {...rest}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        ...cardHoverStyle,
        ...getCardAccentStyle(resolvedAccent),
        ...hoverEffect,
        ...style
      }}
    >
      {children}
    </Card>
  )
}
