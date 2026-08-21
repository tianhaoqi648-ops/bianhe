// ============================================================
// radar-svg.ts — 五维/多维能力雷达图纯函数（P2-9 复盘可视化导出）
//
// 把 P0-2 RadarChart.tsx 的几何绘制逻辑抽成【不依赖 DOM / React】的纯函数
// buildRadarSvgString：输入 labels/series 等结构化参数，返回自包含的内联
// SVG 字符串，可被两处复用：
//   1. 渲染端 React 组件（RadarChart.tsx 作为薄层直接嵌入返回的 SVG）
//   2. 复盘 HTML 导出模板（shared/replay-html.ts）烘焙进单文件 HTML
// 避免同一份雷达绘制逻辑被维护两份。
// ============================================================

/** 一组雷达序列（如正方/反方或单方） */
export interface RadarSeries {
  name: string
  scores: number[]
  color: string
  /** 多边形填充透明度（多组叠加时可降低避免遮挡，默认 0.08） */
  fillOpacity?: number
}

/** buildRadarSvgString 选项（与 RadarChart props 对齐） */
export interface BuildRadarSvgOptions {
  labels: string[]
  series: RadarSeries[]
  /** 分制上限，默认 10 */
  max?: number
  /** SVG 边长(px)，默认 280 */
  size?: number
  labelColor?: string
  gridColor?: string
  axisColor?: string
}

/** 半径外预留空间（用于维度名 + 分值标注） */
const RADAR_PADDING = 54

/** 维度名等文本的 HTML 转义（注入 SVG 字符串时防破坏结构/注入） */
function escText(v: unknown): string {
  return String(v ?? '').replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'
  )
}

/**
 * 生成内联 SVG 雷达图字符串。
 * 网格：25/50/75/100% 同心多边形；轴线从中心指向各维度。
 * 每组序列一个实边多边形，顶点绘制小圆点并标注分值；维度名标注在最外侧。
 * 与 P0-2 RadarChart 几何一致：seriesPoints 按各序列实际分值绘制（分值不同半径不同，反映能力高低）。
 */
export function buildRadarSvgString({
  labels,
  series,
  max = 10,
  size = 280,
  labelColor = '#888',
  gridColor = '#ddd',
  axisColor = '#eee'
}: BuildRadarSvgOptions): string {
  const n = labels.length
  if (n === 0 || series.length === 0) return ''

  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - RADAR_PADDING
  const safeMax = max > 0 ? max : 1

  const angleOf = (i: number): number => (2 * Math.PI * i) / n - Math.PI / 2
  const pointAt = (i: number, ratio: number): [number, number] => {
    const a = angleOf(i)
    return [cx + radius * ratio * Math.cos(a), cy + radius * ratio * Math.sin(a)]
  }
  const polyPoints = (ratio: number): string =>
    labels.map((_, i) => pointAt(i, ratio).map((v) => v.toFixed(2)).join(',')).join(' ')

  /** 按各序列实际分值构建多边形顶点（分值不同半径不同，反映能力高低） */
  const seriesPoints = (scores: number[]): string =>
    labels
      .map((_, i) => {
        const ratio = Math.min((scores[i] ?? 0) / safeMax, 1)
        return pointAt(i, ratio).map((v) => v.toFixed(2)).join(',')
      })
      .join(' ')

  const parts: string[] = []

  // 网格环
  const gridRings = [0.25, 0.5, 0.75, 1].map((r) => polyPoints(r))
  gridRings.forEach((pts) => {
    parts.push(`<polygon points="${pts}" fill="none" stroke="${gridColor}" stroke-width="1"/>`)
  })

  // 轴线
  labels.forEach((_, i) => {
    const [x2, y2] = pointAt(i, 1)
    parts.push(
      `<line x1="${cx.toFixed(2)}" y1="${cy.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${axisColor}" stroke-width="1"/>`
    )
  })

  // 各序列多边形（按实际分值绘制）
  series.forEach((s) => {
    const fill = s.fillOpacity ?? 0.08
    parts.push(
      `<polygon points="${seriesPoints(s.scores)}" fill="${s.color}" fill-opacity="${fill}" stroke="${s.color}" stroke-width="1.5" stroke-linejoin="round"/>`
    )
  })

  // 序列顶点分值标注
  series.forEach((s) => {
    labels.forEach((_, i) => {
      const ratio = Math.min((s.scores[i] ?? 0) / safeMax, 1)
      const [px, py] = pointAt(i, ratio)
      parts.push(
        `<g><circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="2.5" fill="${s.color}"/>` +
          `<text x="${px.toFixed(2)}" y="${(py - 5).toFixed(2)}" font-size="9" fill="${s.color}" text-anchor="middle">${Math.round(s.scores[i] ?? 0)}</text></g>`
      )
    })
  })

  // 维度名标注（最外侧）
  labels.forEach((label, i) => {
    const [lx, ly] = pointAt(i, 1.32)
    const anchor = Math.abs(lx - cx) < 4 ? 'middle' : lx > cx ? 'start' : 'end'
    const dx = lx > cx ? 2 : lx < cx ? -2 : 0
    parts.push(
      `<text x="${(lx + dx).toFixed(2)}" y="${(ly + 3).toFixed(2)}" font-size="10" fill="${labelColor}" text-anchor="${anchor}">${escText(label)}</text>`
    )
  })

  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="能力雷达图" style="max-width:100%;display:block">` +
    parts.join('') +
    `</svg>`
  )
}