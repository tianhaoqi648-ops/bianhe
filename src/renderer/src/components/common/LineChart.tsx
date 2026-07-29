// ============================================================
// LineChart.tsx — SVG 折线图组件
//
// 使用 <path> 手写折线 + 渐变填充。
// 用于展示时间序列数据（如近 7 天抽取次数）。
//
// 特性：
// 1. X 轴（日期）、Y 轴（数值，自动刻度）
// 2. 折线 + 渐变填充
// 3. hover 数据点显示 tooltip
// 4. 空数据返回 null（由父组件处理 EmptyState）
// 5. 响应 antd 主题（colorBorderSecondary / colorTextSecondary）
// ============================================================

import { useState } from 'react'
import { theme } from 'antd'
import React from 'react'
import { colorPrimary } from '../../styles/tokens'

export interface LineChartDatum {
  /** 日期标签（如 "2024-01-15"） */
  date: string
  /** 数值 */
  value: number
}

export interface LineChartProps {
  /** 数据集 */
  data: LineChartDatum[]
  /** 折线颜色（默认 colorPrimary） */
  color?: string
  /** 图表高度，默认 200 */
  height?: number
  /** 自定义 className */
  className?: string
  /** 自定义 style */
  style?: React.CSSProperties
}

/** SVG viewBox 宽度（高度由 height prop 决定） */
const VIEW_WIDTH = 700
/** 图表内边距 */
const PADDING = { top: 16, right: 16, bottom: 28, left: 40 }

/**
 * 计算合适的 Y 轴最大值（向上取整到美观的整数）
 */
function niceMax(value: number): number {
  if (value <= 5) return 5
  if (value <= 10) return 10
  if (value <= 20) return 20
  if (value <= 50) return 50
  if (value <= 100) return 100
  return Math.ceil(value / 50) * 50
}

/**
 * 生成 Y 轴刻度（5 等分）
 */
function generateTicks(max: number): number[] {
  const count = 5
  const step = max / count
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i))
}

/**
 * 格式化日期标签：YYYY-MM-DD → MM-DD
 */
function formatDateLabel(date: string): string {
  const parts = date.split('-')
  if (parts.length === 3) {
    return `${parts[1]}-${parts[2]}`
  }
  return date
}

/**
 * LineChart — SVG 折线图
 *
 * 用法：
 * ```tsx
 * <LineChart
 *   data={[
 *     { date: '2024-01-15', value: 3 },
 *     { date: '2024-01-16', value: 5 },
 *     { date: '2024-01-17', value: 2 }
 *   ]}
 * />
 * ```
 *
 * 空数据时返回 null，由父组件渲染 EmptyState。
 */
export default function LineChart({
  data,
  color,
  height = 200,
  className,
  style
}: LineChartProps) {
  const { token } = theme.useToken()
  const lineColor = color ?? colorPrimary
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  if (!data || data.length === 0) return null

  const plotWidth = VIEW_WIDTH - PADDING.left - PADDING.right
  const plotHeight = height - PADDING.top - PADDING.bottom

  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const yMax = niceMax(maxValue)
  const yTicks = generateTicks(yMax)

  const xStep = data.length > 1 ? plotWidth / (data.length - 1) : 0

  const points = data.map((d, i) => ({
    x: PADDING.left + (data.length > 1 ? i * xStep : plotWidth / 2),
    y: PADDING.top + plotHeight - (d.value / yMax) * plotHeight,
    date: d.date,
    value: d.value
  }))

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')

  const hasArea = points.length >= 2
  const areaPath = hasArea
    ? `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(PADDING.top + plotHeight).toFixed(2)} L ${points[0].x.toFixed(2)} ${(PADDING.top + plotHeight).toFixed(2)} Z`
    : ''

  const gradientId = 'line-chart-gradient'

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', ...style }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Y 轴网格线 + 标签 */}
        {yTicks.map((tick, i) => {
          const y = PADDING.top + plotHeight - (tick / yMax) * plotHeight
          return (
            <g key={i}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={VIEW_WIDTH - PADDING.right}
                y2={y}
                stroke={token.colorBorderSecondary}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text
                x={PADDING.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={11}
                fill={token.colorTextSecondary}
              >
                {tick}
              </text>
            </g>
          )
        })}

        {/* 渐变填充区域 */}
        {hasArea && <path d={areaPath} fill={`url(#${gradientId})`} />}

        {/* 折线 */}
        {hasArea && (
          <path
            d={linePath}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* X 轴标签 */}
        {points.map((p, i) => (
          <text
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            x={p.x}
            y={height - PADDING.bottom + 16}
            textAnchor="middle"
            fontSize={11}
            fill={token.colorTextSecondary}
          >
            {formatDateLabel(p.date)}
          </text>
        ))}

        {/* 数据点 + hover 区域 */}
        {points.map((p, i) => (
          <g
            // eslint-disable-next-line react/no-array-index-key
            key={i}
          >
            <circle
              cx={p.x}
              cy={p.y}
              r={hoverIndex === i ? 5 : 3}
              fill={lineColor}
              stroke="#fff"
              strokeWidth={1.5}
            />
            {/* 透明 hover 区域 */}
            <rect
              x={p.x - Math.max(xStep / 2, 15)}
              y={PADDING.top}
              width={Math.max(xStep, 30)}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            />
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hoverIndex !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${(points[hoverIndex].x / VIEW_WIDTH) * 100}%`,
            top: points[hoverIndex].y,
            transform: 'translate(-50%, -100%)',
            marginTop: -8,
            background: token.colorBgElevated,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 6,
            padding: '4px 8px',
            boxShadow: token.boxShadowSecondary,
            fontSize: 12,
            color: token.colorText,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10
          }}
        >
          <div>{data[hoverIndex].date}</div>
          <div style={{ color: lineColor, fontWeight: 600 }}>
            {data[hoverIndex].value} 次
          </div>
        </div>
      )}
    </div>
  )
}
