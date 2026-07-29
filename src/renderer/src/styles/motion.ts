// ============================================================
// motion.ts — 动效系统
//
// 定义页面切换、列表入场、卡片交互等动效的关键帧名称与时长。
// 关键帧定义见 index.css，此处仅导出引用名称。
//
// 模块导出两套互补 API：
// - 旧版（bianhe- 前缀）：motion / duration / easing / pageTransition 等，
//   供已落地的页面与组件继续使用。
// - 新版（P2 Task 9）：keyframes / motionClass / staggerDelay，
//   提供「animation 简写字符串 + CSS class 名 + stagger 工具」三件套，
//   配合 index.css 中无前缀的 @keyframes（fade-in / slide-up / scale-in / pulse /
//   shimmer / progress-pulse）使用，便于在组件中以 className 或 style 直接套用。
// ============================================================

/** 关键帧名称（对应 index.css 中的 @keyframes 定义） */
export const motion = {
  fadeIn: 'bianhe-fade-in',
  slideUp: 'bianhe-slide-up',
  scaleIn: 'bianhe-scale-in'
} as const

/** 动效时长（毫秒）
 *
 * 三档分级：
 * - fast(150)：轻档 — 按钮 hover/press、卡片 hover 等微交互
 * - normal(250)：中档 — 卡片入场、列表错落、页面切换
 * - slow(400)：中档/重档 — 大屏滑入、模态弹层
 * - heavy(600)：重档上限 — 弹性进入、水印缩放等强调动效
 */
export const duration = {
  fast: 150,
  normal: 250,
  slow: 400,
  heavy: 600
} as const

/** 动效缓动函数 */
export const easing = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
} as const

/** 页面切换淡入：opacity 0 → 1 + translateY(8px) → 0 */
export const pageTransition: React.CSSProperties = {
  animation: `${motion.fadeIn} ${duration.normal}ms ${easing.easeOut}`
}

/** 列表项入场：opacity 0 → 1 + translateY(16px) → 0 */
export const listEnter: React.CSSProperties = {
  animation: `${motion.slideUp} ${duration.normal}ms ${easing.easeOut}`
}

/** 卡片入场：opacity 0 → 1 + scale(0.96) → 1 */
export const cardEnter: React.CSSProperties = {
  animation: `${motion.scaleIn} ${duration.normal}ms ${easing.easeOut}`
}

/** [轻档] 通用过渡 — 用于按钮 hover/press、卡片 hover 等微交互 */
export const lightTransition: React.CSSProperties = {
  transition: `all ${duration.fast}ms ${easing.easeOut}`
}

/** [中档] 通用过渡 — 用于卡片入场、列表项状态切换等 */
export const normalTransition: React.CSSProperties = {
  transition: `all ${duration.normal}ms ${easing.easeOut}`
}

/** [重档] 弹性动画 — 用于水印缩放、强调元素进入 */
export const heavyAnimation: React.CSSProperties = {
  animation: `${motion.fadeIn} ${duration.heavy}ms ${easing.spring}`
}

/** 卡片 hover 微交互样式对象
 *
 * 配合 `.card-hover` className 使用：style 对象提供基础过渡，
 * className 提供 hover 时的 transform / boxShadow。
 */
export const cardHoverStyle: React.CSSProperties = {
  transition: `all ${duration.fast}ms ${easing.easeOut}`
}

/** 生成 staggered 延迟样式（用于列表项依次入场）
 *
 * @param index 项的索引（0-based）
 * @param step 每项的延迟（毫秒），默认 50
 * @returns animationDelay CSS 属性对象
 */
export function staggered(index: number, step = 50): React.CSSProperties {
  return {
    animationDelay: `${index * step}ms`
  }
}

// ============================================================
// P2 Task 9 — 通用动效三件套
//
// 与上述旧版 API 并存：keyframes 提供 animation 简写字符串，
// motionClass 提供对应的全局 CSS class 名（定义见 index.css 末尾），
// staggerDelay 提供列表错落入场的延迟字符串。
// ============================================================

/** 关键帧 animation 简写字符串（对应 index.css 中无前缀的 @keyframes） */
export const keyframes = {
  fadeIn: 'fade-in 0.3s ease forwards',
  slideUp: 'slide-up 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
  scaleIn: 'scale-in 0.2s ease forwards',
  pulse: 'pulse 1.5s ease-in-out infinite',
  shimmer: 'shimmer 2s linear infinite',
  progressPulse: 'progress-pulse 0.3s ease'
} as const

/** CSS class 名（用于注入全局样式，定义见 index.css 末尾） */
export const motionClass = {
  fadeIn: 'motion-fade-in',
  slideUp: 'motion-slide-up',
  scaleIn: 'motion-scale-in',
  pulse: 'motion-pulse'
} as const

/** staggered 工具：返回第 i 项的 animation-delay
 *
 * @param i 项的索引（0-based）
 * @param base 每项的延迟（秒），默认 0.08
 * @returns animation-delay 字符串，如 `0.16s`
 */
export function staggerDelay(i: number, base = 0.08): string {
  return `${i * base}s`
}
