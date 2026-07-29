// ============================================================
// BrandSpin.tsx — 品牌化加载动画组件
//
// 替代 antd Spin 的默认旋转圆环，使用「翻转辩题卡」SVG 动画：
// - 正面：渐变背景 + 白色「辩」字
// - 翻转：3D rotateY 0→180° 循环
// - 文案：可选 tip 显示在卡片下方
//
// API 兼容 antd Spin 的核心用法：
//   <BrandSpin spinning={loading}>内容</BrandSpin>
//   <BrandSpin tip="加载中..." />
//
// size 三档与 antd 一致：small (14px) / default (20px) / large (40px)
// 这里 size 控制 SVG 卡片尺寸：small=24 / default=36 / large=56
// ============================================================

import type { CSSProperties, ReactNode } from 'react'
import { gradient, colorPrimary, colorPurple, spacing, fontSize } from '../../styles/tokens'

/** BrandSpin 尺寸映射（卡片边长 px） */
const SIZE_MAP = {
  small: 24,
  default: 36,
  large: 56
} as const

export interface BrandSpinProps {
  /** 是否处于加载态（默认 true，便于 `<BrandSpin tip="..." />` 直接使用） */
  spinning?: boolean
  /** 尺寸 */
  size?: keyof typeof SIZE_MAP
  /** 加载提示文案（显示在卡片下方） */
  tip?: ReactNode
  /** 包裹的子内容（spinning=true 时叠加遮罩） */
  children?: ReactNode
  /** 自定义容器样式 */
  style?: CSSProperties
  /** 自定义卡片样式（主要用于内联覆盖） */
  className?: string
}

/**
 * 翻转辩题卡 SVG（带 3D 翻转动画）
 *
 * 结构：外层容器 + 内层卡片（preserve-3d + rotateY 动画）
 * 正面：渐变背景 + 白色「辩」字
 * 背面：纯色背景 + 边框（翻转过程中可见）
 */
function FlippingCard({ size }: { size: number }) {
  // 卡片样式：宽高一致，圆角 1/6 边长，渐变背景
  const cardStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.max(4, size / 6),
    background: gradient.brand,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: size * 0.55,
    fontWeight: 700,
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
    boxShadow: `0 ${Math.max(2, size / 12)}px ${Math.max(4, size / 6)}px rgba(22, 119, 255, 0.3)`,
    // 3D 翻转动画：1.2s 一周期，匀速循环
    animation: 'brand-spin-flip 1.2s ease-in-out infinite',
    transformStyle: 'preserve-3d'
  }

  return (
    <div
      style={{
        perspective: size * 2,
        width: size,
        height: size
      }}
    >
      <div style={cardStyle}>辩</div>
      {/* 内联 keyframes：避免依赖全局 CSS，组件可独立使用 */}
      <style>{`
        @keyframes brand-spin-flip {
          0% { transform: rotateY(0deg); }
          50% { transform: rotateY(180deg); }
          100% { transform: rotateY(360deg); }
        }
      `}</style>
    </div>
  )
}

/**
 * BrandSpin — 品牌化加载动画
 *
 * 用法 1：包裹内容（与 antd Spin 一致）
 * ```tsx
 * <BrandSpin spinning={loading}>
 *   <Table dataSource={data} />
 * </BrandSpin>
 * ```
 *
 * 用法 2：独立加载占位
 * ```tsx
 * <BrandSpin tip="正在加载..." />
 * ```
 *
 * 当 children 存在且 spinning=false 时，直接渲染 children（不渲染卡片）。
 * 当 children 存在且 spinning=true 时，children 渲染在底层，卡片作为遮罩居中显示。
 * 当 children 不存在时，仅渲染卡片（+ tip 文案）。
 */
export default function BrandSpin({
  spinning = true,
  size = 'default',
  tip,
  children,
  style,
  className
}: BrandSpinProps) {
  const cardSize = SIZE_MAP[size] ?? SIZE_MAP.default

  // 无 children：仅渲染卡片 + tip
  if (!children) {
    if (!spinning) return null
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.lg,
          ...style
        }}
      >
        <FlippingCard size={cardSize} />
        {tip && (
          <div
            style={{
              marginTop: spacing.md,
              fontSize: fontSize.body,
              color: '#8c8c8c',
              textAlign: 'center'
            }}
          >
            {tip}
          </div>
        )}
      </div>
    )
  }

  // 有 children：spinning=false 直接渲染，spinning=true 叠加遮罩
  if (!spinning) {
    return <div className={className} style={style}>{children}</div>
  }

  // 遮罩层：绝对定位居中，半透明背景
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        ...style
      }}
    >
      {children}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255, 255, 255, 0.65)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          zIndex: 10
        }}
      >
        <FlippingCard size={cardSize} />
        {tip && (
          <div
            style={{
              marginTop: spacing.md,
              fontSize: fontSize.body,
              color: colorPrimary,
              fontWeight: 500,
              textAlign: 'center'
            }}
          >
            {tip}
          </div>
        )}
      </div>
    </div>
  )
}

/** 暗色模式适配：遮罩背景改为深色半透明 */
export function BrandSpinDark({ spinning = true, size = 'default', tip, children, style, className }: BrandSpinProps) {
  const cardSize = SIZE_MAP[size] ?? SIZE_MAP.default

  if (!children) {
    if (!spinning) return null
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.lg,
          ...style
        }}
      >
        <FlippingCard size={cardSize} />
        {tip && (
          <div style={{ marginTop: spacing.md, fontSize: fontSize.body, color: 'rgba(255,255,255,0.65)', textAlign: 'center' }}>
            {tip}
          </div>
        )}
      </div>
    )
  }

  if (!spinning) {
    return <div className={className} style={style}>{children}</div>
  }

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      {children}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(10, 15, 26, 0.65)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          zIndex: 10
        }}
      >
        <FlippingCard size={cardSize} />
        {tip && (
          <div style={{ marginTop: spacing.md, fontSize: fontSize.body, color: colorPurple, fontWeight: 500, textAlign: 'center' }}>
            {tip}
          </div>
        )}
      </div>
    </div>
  )
}
