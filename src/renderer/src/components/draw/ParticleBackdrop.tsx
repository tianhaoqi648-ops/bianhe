// ============================================================
// ParticleBackdrop.tsx — 粒子背景系统（P3.1 Task 4）
//
// Canvas 2D 实现：金色粒子从屏幕底部缓慢上升，透明度循环。
// 用于大屏模式与揭晓动画时增强仪式感氛围。
//
// 特性：
// - 粒子数：移动端 20 / 桌面 60（通过 useMediaQuery 切换）
// - 粒子属性：x/y/vx/vy/radius/alpha（透明度循环 0.3→1→0.3）
// - 尊重 prefers-reduced-motion：开启则不渲染
// - Props: enabled / color / count
// ============================================================

import { useEffect, useRef } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'

/** 粒子默认颜色（金色，与 colorGold 同系） */
const DEFAULT_COLOR = 'rgba(212,175,55,0.6)'

/** 单个粒子的内部数据结构 */
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alpha: number
  /** 透明度变化方向：1 = 递增，-1 = 递减 */
  alphaDir: number
  /** 透明度变化速度（每帧增量） */
  alphaSpeed: number
}

export interface ParticleBackdropProps {
  /** 是否启用（false 时不渲染 canvas） */
  enabled: boolean
  /** 粒子颜色（CSS 颜色字符串），默认金色 rgba(212,175,55,0.6) */
  color?: string
  /** 粒子数量（覆盖默认的移动端/桌面自动切换） */
  count?: number
}

/**
 * ParticleBackdrop — Canvas 粒子背景。
 *
 * 使用方式：
 *   <ParticleBackdrop enabled={isBigScreen} />
 *
 * 父容器需要 position: relative，canvas 会 absolute 定位铺满父容器。
 */
export default function ParticleBackdrop({
  enabled,
  color = DEFAULT_COLOR,
  count
}: ParticleBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const isMobile = useMediaQuery('(max-width: 767px)')

  // 检查 prefers-reduced-motion（仅在挂载时检查一次，运行时变化不重新渲染）
  const prefersReducedMotion = useRef<boolean>(false)
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // 粒子数量：props.count 优先，否则按设备类型自动切换
  const targetCount = count ?? (isMobile ? 20 : 60)

  useEffect(() => {
    // 不启用或用户偏好减少动效时不渲染
    if (!enabled || prefersReducedMotion.current) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const parent = canvas.parentElement
    if (!parent) return

    // ===== 初始化 / 尺寸调整 =====
    const resize = () => {
      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()

    // ===== 创建粒子 =====
    const createParticle = (): Particle => {
      const rect = parent.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      return {
        x: Math.random() * w,
        y: h + Math.random() * 50, // 从底部以下开始
        vx: (Math.random() - 0.5) * 0.3, // 水平微移
        vy: -(0.2 + Math.random() * 0.6), // 向上缓慢上升
        radius: 1 + Math.random() * 3,
        alpha: 0.3 + Math.random() * 0.5,
        alphaDir: Math.random() > 0.5 ? 1 : -1,
        alphaSpeed: 0.003 + Math.random() * 0.005
      }
    }

    particlesRef.current = Array.from({ length: targetCount }, createParticle)

    // ===== 动画循环 =====
    const animate = () => {
      const rect = parent.getBoundingClientRect()
      const w = rect.width
      const h = rect.height

      ctx.clearRect(0, 0, w, h)

      // 解析颜色，提取 rgba 分量用于动态 alpha
      // 支持 rgba(r,g,b,a) / rgb(r,g,b) / #rrggbb 格式
      const colorMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      const r = colorMatch ? parseInt(colorMatch[1], 10) : 212
      const g = colorMatch ? parseInt(colorMatch[2], 10) : 175
      const b = colorMatch ? parseInt(colorMatch[3], 10) : 55

      const particles = particlesRef.current
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]

        // 更新位置
        p.x += p.vx
        p.y += p.vy

        // 更新透明度（循环 0.3→1→0.3）
        p.alpha += p.alphaDir * p.alphaSpeed
        if (p.alpha >= 1) {
          p.alpha = 1
          p.alphaDir = -1
        } else if (p.alpha <= 0.3) {
          p.alpha = 0.3
          p.alphaDir = 1
        }

        // 粒子飞出顶部时重置到底部
        if (p.y < -10) {
          p.x = Math.random() * w
          p.y = h + Math.random() * 20
          p.alpha = 0.3 + Math.random() * 0.3
        }

        // 水平边界包裹
        if (p.x < -10) p.x = w + 10
        if (p.x > w + 10) p.x = -10

        // 绘制粒子（带光晕效果）
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`
        ctx.fill()

        // 外层光晕（更大半径，更低透明度）
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius * 2.5, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha * 0.15})`
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    // 监听父容器尺寸变化
    const resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(parent)

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      resizeObserver.disconnect()
    }
  }, [enabled, color, targetCount])

  // 不启用或用户偏好减少动效时不渲染
  if (!enabled || prefersReducedMotion.current) return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0
      }}
      aria-hidden="true"
    />
  )
}
