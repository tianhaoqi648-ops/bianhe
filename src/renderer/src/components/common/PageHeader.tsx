// ============================================================
// PageHeader.tsx — 页面统一页头组件
//
// 各页面顶部统一的标题区，结构为：
// 左侧 4px 强调色竖条 + H1 标题 + 副标题（可选）+ 右侧操作区 slot。
//
// 强调色根据当前路由自动解析：
// - 赛事工作区（/draw /topics /events /history /teams）→ 金色 colorGold
// - 比赛工具区（/timer /format）→ 紫色 colorPurple
// - 系统区（/settings）→ 蓝色 colorPrimary
// - 其他 → 蓝色 colorPrimary
//
// 也可通过 accent prop 手动指定强调色，覆盖路由自动解析。
// ============================================================

import { Typography, theme } from 'antd'
import React from 'react'
import { useLocation } from 'react-router-dom'

import {
  spacing,
  colorGold,
  colorPurple,
  colorPrimary,
  fontSize
} from '../../styles/tokens'

// ------------------------------------------------------------
// 类型定义
// ------------------------------------------------------------

export interface PageHeaderProps {
  /** 主标题 */
  title: string
  /** 副标题（可选） */
  subtitle?: string
  /** 右侧操作区，通常是 Button / Space 等 */
  extra?: React.ReactNode
  /** 手动指定强调色，覆盖路由自动解析 */
  accent?: 'gold' | 'purple' | 'primary' | 'none'
  /** 自定义 className */
  className?: string
  /** 自定义 style */
  style?: React.CSSProperties
}

// ------------------------------------------------------------
// 路由 → 强调色解析
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
 */
function resolveAccentByPathname(
  pathname: string
): 'gold' | 'purple' | 'primary' {
  if (GOLD_ROUTES.some((r) => pathname.startsWith(r))) return 'gold'
  if (PURPLE_ROUTES.some((r) => pathname.startsWith(r))) return 'purple'
  if (PRIMARY_ROUTES.some((r) => pathname.startsWith(r))) return 'primary'
  return 'primary'
}

/** 将强调色类型映射为具体色值，none 返回 null（不渲染竖条） */
function accentToColor(
  accent: 'gold' | 'purple' | 'primary' | 'none'
): string | null {
  if (accent === 'none') return null
  if (accent === 'gold') return colorGold
  if (accent === 'purple') return colorPurple
  return colorPrimary
}

// ------------------------------------------------------------
// 组件
// ------------------------------------------------------------

/**
 * PageHeader — 页面统一页头组件
 *
 * 用法：
 * ```tsx
 * <PageHeader title="题库" subtitle="管理辩题数据" extra={<Button>导入</Button>} />
 * ```
 *
 * 强调色默认根据当前路由自动解析，也可通过 `accent` prop 手动覆盖。
 * 传 `accent="none"` 可隐藏竖条。
 */
function PageHeader({
  title,
  subtitle,
  extra,
  accent,
  className,
  style
}: PageHeaderProps) {
  const { token } = theme.useToken()
  const location = useLocation()

  // 强调色优先级：手动传入 > 路由自动解析
  const resolvedAccent = accent ?? resolveAccentByPathname(location.pathname)
  const accentColor = accentToColor(resolvedAccent)

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        padding: `${spacing.md} ${spacing.sm}`,
        marginBottom: spacing.lg,
        background: token.colorBgContainer,
        ...style
      }}
    >
      {/* 左侧：竖条 + 标题/副标题垂直堆叠 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: spacing.sm,
          minWidth: 0,
          flex: '1 1 auto'
        }}
      >
        {accentColor !== null && (
          <div
            style={{
              width: 4,
              minWidth: 4,
              background: accentColor
            }}
          />
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center'
          }}
        >
          <Typography.Title
            level={1}
            style={{
              margin: 0,
              fontSize: fontSize.h1,
              fontWeight: 600
            }}
          >
            {title}
          </Typography.Title>
          {subtitle ? (
            <Typography.Text
              style={{
                fontSize: fontSize.body,
                color: token.colorTextSecondary
              }}
            >
              {subtitle}
            </Typography.Text>
          ) : null}
        </div>
      </div>

      {/* 右侧：操作区 */}
      {extra ? <div style={{ flexShrink: 0 }}>{extra}</div> : null}
    </div>
  )
}

export default PageHeader
