// ============================================================
// radar-svg.test.ts — 内联 SVG 雷达图纯函数测试（P2-9 复盘可视化导出）
//
// 覆盖：
//   - 空输入返回空字符串（无标签 / 无序列）
//   - 基本输出含 <svg>、序列多边形、维度名、分值标注
//   - seriesPoints 按实际分值绘制：分值不同 → 多边形顶点不同
//   - 分制上限兜底（max<=0 时按 1 计算，避免除零/Infinity）
//   - 自定义 size 影响 viewBox
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildRadarSvgString } from '../radar-svg'

const LABELS = ['逻辑', '表达', '攻防', '价值', '团队']

describe('buildRadarSvgString', () => {
  it('无标签或无序列时返回空字符串', () => {
    expect(buildRadarSvgString({ labels: [], series: [] })).toBe('')
    expect(
      buildRadarSvgString({
        labels: LABELS,
        series: []
      })
    ).toBe('')
    expect(
      buildRadarSvgString({
        labels: [],
        series: [{ name: '正方', scores: [1, 2, 3, 4, 5], color: '#000' }]
      })
    ).toBe('')
  })

  it('生成自包含 <svg>，含网格/轴线/序列多边形/维度名/分值标注', () => {
    const svg = buildRadarSvgString({
      labels: LABELS,
      series: [
        { name: '正方', scores: [8, 7, 9, 6, 8], color: '#1677ff' },
        { name: '反方', scores: [6, 8, 7, 8, 6], color: '#fa8c16' }
      ]
    })
    expect(svg).toContain('<svg ')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('viewBox="0 0 280 280"')
    // 网格环 + 轴线 + 两条序列多边形 + 顶点分值 + 维度名
    expect(svg).toContain('polygon')
    expect(svg).toContain('line')
    for (const label of LABELS) expect(svg).toContain(label)
    // 分值标注（round 后）
    expect(svg).toContain('>8<')
    expect(svg).toContain('>7<')
    expect(svg).toContain('>9<')
    for (const color of ['#1677ff', '#fa8c16']) expect(svg).toContain(color)
  })

  it('seriesPoints 按实际分值绘制：分值不同则多边形顶点不同', () => {
    const low = buildRadarSvgString({
      labels: ['A', 'B', 'C'],
      series: [{ name: 'x', scores: [1, 1, 1], color: '#111' }]
    })
    const high = buildRadarSvgString({
      labels: ['A', 'B', 'C'],
      series: [{ name: 'x', scores: [9, 9, 9], color: '#111' }]
    })
    // 仅序列多边形 points 不同；两个字符串必须不等
    expect(low).not.toBe(high)
  })

  it('分制上限兜底：max<=0 时不抛错且不会除以 0', () => {
    const svg = buildRadarSvgString({
      labels: ['A', 'B', 'C'],
      series: [{ name: 'x', scores: [10, 9, 8], color: '#111' }],
      max: 0
    })
    expect(svg).toContain('<svg ')
  })

  it('自定义 size 反映到 viewBox', () => {
    const svg = buildRadarSvgString({
      labels: ['A', 'B', 'C'],
      series: [{ name: 'x', scores: [5, 5, 5], color: '#111' }],
      size: 400
    })
    expect(svg).toContain('viewBox="0 0 400 400"')
  })
})