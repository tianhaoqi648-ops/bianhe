// ============================================================
// DonutChart.tsx — SVG 环形图组件
//
// 使用 <circle> + stroke-dasharray + stroke-dashoffset 技巧绘制环形分段。
// 用于展示分类数据分布（如题型分布、难度分布等）。
//
// 特性：
// 1. 从 12 点钟方向顺时针绘制（外层 <g transform="rotate(-90 cx cy)">）
// 2. 段之间留 2px 间隙（通过缩短 segmentLength 实现）
// 3. 中心支持主标签（大字号）+ 副标签（小字号）
// 4. 下方图例：色块（10×10 圆角矩形） + 标签 + 数值
// 5. 响应 antd 主题（colorTextSecondary 用于副标签）
// 6. 空数据渲染灰色空环 + "无数据" 中心标签
// ============================================================

import { useState } from 'react'
import { theme } from 'antd'
import React from 'react'

export interface DonutChartDatum {
  /** 分段标签 */
  label: string
  /** 分段数值 */
  value: number
  /** 分段颜色（CSS 颜色字符串，如 '#1677ff'） */
  color: string
}

export interface DonutChartProps {
  /** 数据集 */
  data: DonutChartDatum[]
  /** 中心标签（大字号，如 "100"） */
  centerLabel?: string
  /** 中心副标签（小字号，如 "总题数"） */
  centerSublabel?: string
  /** SVG 直径，默认 160 */
  size?: number
  /** 环宽，默认 24 */
  thickness?: number
  /** 自定义 className */
  className?: string
  /** 自定义 style */
  style?: React.CSSProperties
}

/** 段之间间隙（px） */
const SEGMENT_GAP = 2
/** 空数据时显示的占位文案 */
const EMPTY_TEXT = '无数据'
/** 空环颜色（与 antd colorBorderSecondary 接近） */
const EMPTY_RING_COLOR = '#e5e7eb'
/** 背景环透明度 */
const BG_RING_OPACITY = 0.5

/**
 * DonutChart — SVG 环形图
 *
 * 用法：
 * ```tsx
 * <DonutChart
 *   data={[
 *     { label: '入门', value: 30, color: '#52c41a' },
 *     { label: '进阶', value: 50, color: '#faad14' },
 *     { label: '专业', value: 20, color: '#ff4d4f' }
 *   ]}
 *   centerLabel="100"
 *   centerSublabel="总题数"
 * />
 * ```
 *
 * 空数据时退化为灰色空环 + "无数据" 中心标签。
 */
export default function DonutChart({
  data,
  centerLabel,
  centerSublabel,
  size = 160,
  thickness = 24,
  className,
  style
}: DonutChartProps) {
  const { token } = theme.useToken()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // 半径 = (直径 - 环宽) / 2，确保环完全落在 viewBox 内
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const cx = size / 2
  const cy = size / 2

  const total = data.reduce((sum, d) => sum + (d.value || 0), 0)
  const hasData = data.length > 0 && total > 0

  // hover 时中心标签替换为当前段信息（数量 + 百分比）
  const displayCenterLabel =
    hoveredIndex !== null ? String(data[hoveredIndex].value) : centerLabel
  const displayCenterSublabel =
    hoveredIndex !== null
      ? `${data[hoveredIndex].label} · ${total > 0 ? ((data[hoveredIndex].value / total) * 100).toFixed(1) : '0.0'}%`
      : centerSublabel

  // 中心主/副标签字号
  const mainFontSize = size * 0.18
  const subFontSize = size * 0.08

  // 累积偏移量（用于计算每段 dashoffset）
  let cumulativeOffset = 0

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        ...style
      }}
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
          stroke={EMPTY_RING_COLOR}
          strokeWidth={thickness}
          opacity={BG_RING_OPACITY}
        />

        {/* 数据段：rotate(-90 cx cy) 让起点从 12 点钟方向开始顺时针绘制 */}
        {hasData && (
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            {data.map((d, i) => {
              const value = d.value || 0
              if (value <= 0) return null

              const segmentLength = (value / total) * circumference
              // 段之间留 2px 间隙（仅多段时；单段无需间隙，避免出现缺口）
              const gap = data.length > 1 ? SEGMENT_GAP : 0
              const visibleLength = Math.max(segmentLength - gap, 0)
              if (visibleLength <= 0) return null

              // dasharray = "可见长度 剩余长度"
              // dashoffset = -累积前置段长度（负值实现顺时针推进）
              const dasharray = `${visibleLength} ${circumference - visibleLength}`
              const dashoffset = -cumulativeOffset

              // 累加原始长度（不减间隙），保证下一段起点对齐
              cumulativeOffset += segmentLength

              return (
                <circle
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={thickness}
                  strokeDasharray={dasharray}
                  strokeDashoffset={dashoffset}
                  strokeLinecap="butt"
                  opacity={hoveredIndex === null || hoveredIndex === i ? 1 : 0.35}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
                />
              )
            })}
          </g>
        )}

        {/* 中心主标签（大字号） — hover 时显示当前段数量 */}
        {hasData && displayCenterLabel && (
          <text
            x={cx}
            y={displayCenterSublabel ? cy - subFontSize * 0.7 : cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={mainFontSize}
            fontWeight={600}
            fill={token.colorText}
          >
            {displayCenterLabel}
          </text>
        )}

        {/* 中心副标签（小字号） — hover 时显示当前段标签 + 百分比 */}
        {hasData && displayCenterSublabel && (
          <text
            x={cx}
            y={displayCenterLabel ? cy + mainFontSize * 0.55 : cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={subFontSize}
            fill={token.colorTextSecondary}
          >
            {displayCenterSublabel}
          </text>
        )}

        {/* 空数据中心标签 */}
        {!hasData && (
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={subFontSize}
            fill={token.colorTextSecondary}
          >
            {EMPTY_TEXT}
          </text>
        )}
      </svg>

      {/* 图例：色块 + 标签 + 数值（horizontal flex wrap） */}
      {hasData && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '4px 12px',
            marginTop: 8,
            fontSize: 12,
            color: token.colorText
          }}
        >
          {data.map((d, i) => {
            const pct = total > 0 ? `${((d.value / total) * 100).toFixed(1)}%` : '0.0%'
            return (
            <div
              key={i}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'default',
                opacity: hoveredIndex === null || hoveredIndex === i ? 1 : 0.5,
                fontWeight: hoveredIndex === i ? 600 : 400
              }}
            >
              {/* 色块：10×10 圆角矩形 */}
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: d.color
                }}
              />
              <span>{d.label}</span>
              <span style={{ color: token.colorTextSecondary }}>{d.value} ({pct})</span>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
