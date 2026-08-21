// ============================================================
// RadarChart.tsx — 五维/多维能力雷达图（2026-08-21）
//
// 纯 SVG 手绘雷达图，不引入 echarts/recharts 等重依赖。
// 几何绘制逻辑已抽到 shared/radar-svg.ts 的 buildRadarSvgString 纯函数
// （不依赖 DOM/React），本组件作为薄层：直接渲染该函数生成的内联 SVG 字符串。
// 这样 P2-9 复盘 HTML 导出能复同一份绘制逻辑，避免维护两份。
// ============================================================

import React from 'react'
import {
  buildRadarSvgString,
  type BuildRadarSvgOptions,
  type RadarSeries
} from '../../../../shared/radar-svg'

export type { RadarSeries }
export interface RadarChartProps extends BuildRadarSvgOptions {}

/**
 * 纯 SVG 雷达图（薄层包装 shared/radar-svg.ts 的 buildRadarSvgString）。
 * props 纯（不依赖 theme hook、颜色由调用方传入）。
 */
export function RadarChart({
  labels,
  series,
  max,
  size,
  labelColor,
  gridColor,
  axisColor
}: RadarChartProps): JSX.Element {
  const svg = buildRadarSvgString({ labels, series, max, size, labelColor, gridColor, axisColor })
  // 通过 dangerouslySetInnerHTML 注入完整 <svg>，浏览器解析器会按 foreign content
  // 正确处理 SVG 命名空间，避免在 React 中重复实现几何逻辑。
  return (
    <div
      style={{ maxWidth: '100%', display: 'flex', justifyContent: 'center' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}