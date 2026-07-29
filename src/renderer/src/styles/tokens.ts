// ============================================================
// tokens.ts — 设计 Token 常量
//
// 统一管理 spacing / radius / shadow / gradient 等设计常量，
// 替代散落在各页面的魔法数字（如 padding:12, borderRadius:8 等）。
// 与 antd theme token 互补：antd token 控制 UI 组件，本文件控制布局。
// ============================================================

/**
 * 间距系统（4px 基准）
 *
 * 使用规范：
 * - xs(4)：行内紧凑间距（icon 与文字紧贴）
 * - sm(8)：行内 gap（按钮内 icon↔text、tag 之间）
 * - md(12)：组件 gap（卡片内元素之间、表单域之间）
 * - lg(16)：分区间距（卡片内段落间）
 * - xl(20)：卡片 padding
 * - xxl(24)：页面 padding
 * - xxxl(32)：section 间距
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  // 页面级 section 间距
  sectionGap: 32
} as const

/**
 * 圆角系统
 *
 * 使用规范：
 * - sm(4)：小标签 / Tag 内圆角
 * - md(6)：输入框等中型控件
 * - lg(8)：按钮
 * - xl(12)：卡片 / 弹层
 * - xxl(16)：Modal / 大型容器
 * - pill(999)：药丸标签 / 圆形头像
 */
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16,
  // 大卡片圆角
  cardLg: 12,
  pill: 999
} as const

/**
 * 阴影系统（与 antd boxShadow 一致风格）
 *
 * 使用规范：
 * - 卡片：cardRest（基础态）→ cardHover（hover 态），不要直接用 md/lg
 * - 浮动层（Affix / 抽屉边缘 / FAB）：xl
 * - 表格行：无阴影（靠 rowHoverBg 区分）
 * - 弱分隔：sm（轻浮起，如 toolbar）
 */
export const shadow = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.04)',
  md: '0 2px 8px rgba(0, 0, 0, 0.06)',
  lg: '0 4px 12px rgba(0, 0, 0, 0.08)',
  xl: '0 8px 24px rgba(0, 0, 0, 0.12)',
  primary: '0 4px 12px rgba(20, 102, 224, 0.4)',
  primaryHover: '0 6px 16px rgba(20, 102, 224, 0.5)',
  // 卡片三级阴影体系：rest → hover → active 逐级加深
  // cardRest：基础态（y=4, blur=12, 透明度=0.08）
  cardRest: '0 4px 12px rgba(0, 0, 0, 0.08)',
  // card 别名指向 cardRest（向后兼容，等值）
  card: '0 4px 12px rgba(0, 0, 0, 0.08)',
  // cardHover：hover 抬升态（y+4=8, blur+8=20, 透明度=0.12）
  cardHover: '0 8px 20px rgba(0, 0, 0, 0.12)',
  // cardActive：active 按下态（y+2=10, blur+4=24, 透明度=0.16）
  cardActive: '0 10px 24px rgba(0, 0, 0, 0.16)',
  selected: '0 4px 12px rgba(20, 102, 224, 0.15)',
  // 沉浸模式倒计时大字光效：warning / error 状态下的发光阴影
  glowWarning: '0 0 24px rgba(250, 173, 20, 0.4)',
  glowError: '0 0 24px rgba(255, 77, 79, 0.6)'
} as const

/** 渐变系统 */
export const gradient = {
  // 品牌色渐变（Logo / 主按钮 hover）
  brand: 'linear-gradient(135deg, #1466e0 0%, #6625b9 100%)',
  // 主色渐变（按钮 / 强调元素）
  primary: 'linear-gradient(135deg, #1466e0, #3a8af5)',
  // 内容区背景渐变
  contentBg: 'linear-gradient(180deg, #fafbff 0%, #f0f2f5 100%)',
  // 大屏背景渐变（深蓝氛围）
  bigscreen: 'linear-gradient(135deg, #0c1e3e 0%, #1a3a6c 50%, #0c1e3e 100%)',
  // 抽取动画遮罩径向渐变
  drawOverlay: 'radial-gradient(circle, rgba(20,102,224,0.15) 0%, rgba(0,0,0,0.85) 70%)',
  // 难度色板（入门/进阶/专业）
  difficultyEasy: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)',
  difficultyMid: 'linear-gradient(135deg, #e8a013 0%, #ffd666 100%)',
  difficultyHard: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)',
  // 来源色板
  sourceOfficial: 'linear-gradient(135deg, #1466e0 0%, #69b1ff 100%)',
  sourceCustom: 'linear-gradient(135deg, #6625b9 0%, #b37feb 100%)'
} as const

/** 字体系统 */
export const fontFamily = {
  // 保留 Inter 在前；中文字体优先级：PingFang SC > Source Han Sans CN > Microsoft YaHei
  sans: "Inter, 'PingFang SC', 'Source Han Sans CN', 'Microsoft YaHei', sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace"
} as const

/**
 * 字号阶梯（页面级标题与正文）
 *
 * 使用规范：
 * - h1(32)：页面主标题（少用，一般 PageHeader 占位）
 * - h2(24)：区域大标题 / 大屏数字
 * - h3(20)：卡片标题 / 强调数字
 * - h4(16)：小节标题
 * - body(14)：正文（默认）
 * - caption(12)：辅助说明 / 时间戳 / 标签
 */
export const fontSize = {
  h1: 32,
  h2: 24,
  h3: 20,
  h4: 16,
  body: 14,
  caption: 12
} as const

/** 行高 token（标题与正文） */
export const lineHeight = {
  title: 1.3,
  body: 1.6
} as const

/**
 * 灰阶系统（7 级，从深到浅）
 *
 * 使用规范：
 * - 950：沉浸模式最深背景（仪式感底色）
 * - 900：主文本（标题 / 正文重点）
 * - 700：次文本（描述 / 副标题）
 * - 500：辅助文本（时间戳 / 提示）
 * - 300：占位符 / 禁用态文字
 * - 200：边框 / 分割线（实线）
 * - 100：弱分割线 / 背景填充
 */
export const gray = {
  950: '#050810', // 沉浸模式最深背景
  900: '#1f1f1f', // 主文本
  700: '#595959', // 次文本
  500: '#8c8c8c', // 辅助文本
  300: '#bfbfbf', // 占位符
  200: '#d9d9d9', // 边框
  100: '#f0f0f0' // 背景
} as const

/** 系统色（主色） — 饱和度较 antd 默认降低约 10% */
export const colorPrimary = '#1466e0'
/** 赛事工作区强调色 — 饱和度较 antd 默认降低约 10% */
export const colorGold = '#e8a013'
/** 金色亮调（用于渐变末端 / 金色光环 stroke 渐变 to 端） */
export const colorGoldLight = '#ffd666'
/** 比赛工具区强调色 — 饱和度较 antd 默认降低约 10% */
export const colorPurple = '#6625b9'

/** 三色组合对象（便于循环遍历） */
export const colorSystem = {
  primary: colorPrimary,
  gold: colorGold,
  purple: colorPurple
} as const

/**
 * 玻璃态侧栏背景 — 亮色模式下也使用深色玻璃，增强「指挥台」氛围。
 *
 * - glassSidebarBg：亮色模式下侧栏深色玻璃背景（0.92 不透明度）
 * - glassSidebarBgDark：暗色模式下侧栏深色玻璃背景（0.96 不透明度，更深）
 */
export const glassSidebarBg = 'rgba(10,15,26,0.92)'
export const glassSidebarBgDark = 'rgba(10,15,26,0.96)'

/**
 * 沉浸模式与 sticky 工具栏背景 token
 *
 * - immersiveBg：沉浸模式（如抽辩题仪式感场景）统一深色背景，
 *   亮 / 暗模式均使用同一深色值，保证仪式感氛围不破坏。
 * - stickyBgLight / stickyBgDark：sticky / affix 浮层半透明背景，
 *   配合 backdrop-filter: blur(12px) 实现毛玻璃效果，分别在亮 / 暗模式下生效。
 */
export const immersiveBg = '#0a0f1a'
export const stickyBgLight = 'rgba(255,255,255,0.85)'
export const stickyBgDark = 'rgba(10,15,26,0.85)'

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
