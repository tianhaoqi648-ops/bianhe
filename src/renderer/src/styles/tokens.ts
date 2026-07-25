// ============================================================
// tokens.ts — 设计 Token 常量
//
// 统一管理 spacing / radius / shadow / gradient 等设计常量，
// 替代散落在各页面的魔法数字（如 padding:12, borderRadius:8 等）。
// 与 antd theme token 互补：antd token 控制 UI 组件，本文件控制布局。
// ============================================================

/** 间距系统（4px 基准） */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32
} as const

/** 圆角系统 */
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16,
  pill: 999
} as const

/** 阴影系统（与 antd boxShadow 一致风格） */
export const shadow = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.04)',
  md: '0 2px 8px rgba(0, 0, 0, 0.06)',
  lg: '0 4px 12px rgba(0, 0, 0, 0.08)',
  xl: '0 8px 24px rgba(0, 0, 0, 0.12)',
  primary: '0 4px 12px rgba(22, 119, 255, 0.4)',
  primaryHover: '0 6px 16px rgba(22, 119, 255, 0.5)',
  cardHover: '0 4px 12px rgba(22, 119, 255, 0.15)',
  selected: '0 4px 12px rgba(22, 119, 255, 0.15)'
} as const

/** 渐变系统 */
export const gradient = {
  // 品牌色渐变（Logo / 主按钮 hover）
  brand: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)',
  // 内容区背景渐变
  contentBg: 'linear-gradient(180deg, #fafbff 0%, #f0f2f5 100%)',
  // 大屏背景渐变（深蓝氛围）
  bigscreen: 'linear-gradient(135deg, #0c1e3e 0%, #1a3a6c 50%, #0c1e3e 100%)',
  // 抽取动画遮罩径向渐变
  drawOverlay: 'radial-gradient(circle, rgba(22,119,255,0.15) 0%, rgba(0,0,0,0.85) 70%)',
  // 难度色板（入门/进阶/专业）
  difficultyEasy: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)',
  difficultyMid: 'linear-gradient(135deg, #faad14 0%, #ffd666 100%)',
  difficultyHard: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)',
  // 来源色板
  sourceOfficial: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)',
  sourceCustom: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)'
} as const

/** 字体系统 */
export const fontFamily = {
  sans: "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace"
} as const

/** 过渡曲线 */
export const transition = {
  fast: 'all 0.15s ease',
  base: 'all 0.2s ease',
  slow: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
  bounce: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
} as const

/** z-index 层级 */
export const zIndex = {
  base: 1,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modal: 1040,
  overlay: 9999,
  bigscreen: 9999
} as const
