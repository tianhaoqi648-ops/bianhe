// ============================================================
// ProgressRing.tsx — SVG 进度环组件
//
// 使用 <circle> + stroke-dasharray + stroke-dashoffset 技巧绘制单段进度环。
// 用于在卡片等紧凑位置展示「当前/总数」进度，如赛事轮次完成度。
//
// 特性：
// 1. 从 12 点钟方向顺时针绘制（外层 <g transform="rotate(-90 cx cy)">）
// 2. 完成度 100% 时颜色自动切换为 antd colorSuccess（绿色）
// 3. 中心显示 "X/Y" 文字（受 antd 主题色驱动）
// 4. total <= 0 时退化为灰色空环 + "0/0" 文字
// 5. 进度变化有 0.3s ease 过渡动画
// 6. 响应 antd 主题（colorPrimary / colorSuccess / colorBorder / colorText）
// ============================================================

import { theme } from 'antd'
import React from 'react'

export interface ProgressRingProps {
  /** 当前完成数 */
  current: number
  /** 总数 */
  total: number
  /** SVG 直径，默认 40 */
  size?: number
  /** 进度条颜色（不传则使用 antd colorPrimary；100% 完成时强制使用 colorSuccess） */
  color?: string
  /** 环宽，默认 3 */
  strokeWidth?: number
  /** 自定义 className */
  className?: string
  /** 自定义 style */
  style?: React.CSSProperties
}

/**
 * ProgressRing — SVG 进度环
 *
 * 用法：
 * ```tsx
 * <ProgressRing current={2} total={5} size={40} />
 * ```
 *
 * total 为 0 时退化为灰色空环 + "0/0" 中心标签。
 */
export default function ProgressRing({
  current,
  total,
  size = 40,
  color,
  strokeWidth = 3,
  className,
  style
}: ProgressRingProps) {
  const { token } = theme.useToken()

  // 钳制 current 到 [0, total]，避免负数或超额
  const clampedCurrent = total > 0 ? Math.max(0, Math.min(current, total)) : 0
  const ratio = total > 0 ? clampedCurrent / total : 0
  const isComplete = total > 0 && clampedCurrent === total

  // 默认使用 antd 主色；100% 完成时使用绿色（colorSuccess）
  const ringColor = isComplete
    ? token.colorSuccess
    : (color ?? token.colorPrimary)
  const trackColor = token.colorBorderSecondary

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const cx = size / 2
  const cy = size / 2
  const dashoffset = circumference * (1 - ratio)

  // 中心 "X/Y" 文字字号
  const textFontSize = Math.max(8, size * 0.26)

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style
      }}
      role="img"
      aria-label={`进度 ${clampedCurrent}/${total}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block' }}
      >
        {/* 背景环：淡色底，填充环形轨道 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          opacity={0.45}
        />

        {/* 进度环：rotate(-90 cx cy) 让起点从 12 点方向开始顺时针绘制 */}
        {ratio > 0 && (
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={ringColor}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={dashoffset}
              strokeLinecap="round"
              style={{
                transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease'
              }}
            />
          </g>
        )}

        {/* 中心文字 "X/Y" */}
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={textFontSize}
          fontWeight={600}
          fill={token.colorText}
        >
          {clampedCurrent}/{total}
        </text>
      </svg>
    </div>
  )
}
