// ============================================================
// RevealAnimation.tsx — 抽辩揭晓动画组件（P3.1 Task 1）
//
// 提供 4 种揭晓模式：
// - flip: 3D 翻牌（rotateY 0→180deg + perspective）
// - tear: 撕开效果（两层重叠 + clip-path 动画）
// - spotlight: 聚光灯扫描（radial-gradient mask + translate）
// - fade: 渐显（opacity + translateY，复用 motion.ts 的 motionClass.fadeIn）
//
// 默认 duration：flip=800 / tear=1000 / spotlight=1200 / fade=300
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { colorGold, colorGoldLight } from '../../styles/tokens'
import { motionClass } from '../../styles/motion'

/** 揭晓模式 */
export type RevealMode = 'flip' | 'tear' | 'spotlight' | 'fade'

/** 各模式默认时长（毫秒） */
const DEFAULT_DURATION: Record<RevealMode, number> = {
  flip: 800,
  tear: 1000,
  spotlight: 1200,
  fade: 300
}

export interface RevealAnimationProps {
  /** 揭晓模式 */
  mode: RevealMode
  /** 被揭晓的内容（动画结束后展示） */
  children: ReactNode
  /** 动画时长（毫秒），默认按 mode 取 DEFAULT_DURATION */
  duration?: number
  /** 动画结束时回调 */
  onComplete?: () => void
  /** 背面 / 揭晓前占位内容（仅 flip 模式有效），默认显示金色渐变 + 辩盒 logo */
  backFace?: ReactNode
}

/**
 * RevealAnimation — 通用揭晓动画组件。
 *
 * 使用方式：
 *   <RevealAnimation mode="flip">
 *     <TopicCard />
 *   </RevealAnimation>
 *
 * 父组件可通过 key 重新挂载触发动画：
 *   <RevealAnimation key={currentIdx} mode={mode} />
 */
export default function RevealAnimation({
  mode,
  children,
  duration,
  onComplete,
  backFace
}: RevealAnimationProps) {
  const actualDuration = duration ?? DEFAULT_DURATION[mode]
  const [revealed, setRevealed] = useState(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    setRevealed(false)
    const timer = setTimeout(() => {
      setRevealed(true)
      onCompleteRef.current?.()
    }, actualDuration)
    return () => clearTimeout(timer)
  }, [actualDuration, mode])

  // ===== flip 模式：3D 翻牌 =====
  if (mode === 'flip') {
    return (
      <div
        style={{
          perspective: 1000,
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 80
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            minHeight: 80,
            transformStyle: 'preserve-3d',
            transition: `transform ${actualDuration}ms cubic-bezier(0.45, 0.05, 0.55, 0.95)`,
            transform: revealed ? 'rotateY(180deg)' : 'rotateY(0deg)'
          }}
        >
          {/* 背面（初始可见，金色渐变 + 辩盒 logo） */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `linear-gradient(135deg, ${colorGold} 0%, ${colorGoldLight} 100%)`,
              color: '#fff',
              fontWeight: 700,
              fontSize: 'clamp(24px, 3vw, 40px)',
              letterSpacing: 4,
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(232, 160, 19, 0.4)'
            }}
          >
            {backFace ?? (
              <span style={{ textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                辩盒
              </span>
            )}
          </div>
          {/* 正面（揭晓后可见） */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center'
            }}
          >
            {children}
          </div>
        </div>
      </div>
    )
  }

  // ===== tear 模式：撕开效果 =====
  if (mode === 'tear') {
    // 上层从中间撕开向两侧移动：用 clip-path polygon 动画
    // 0%: polygon(0 0, 100% 0, 100% 100%, 0 100%)（覆盖全部）
    // 100%: polygon(0 0, 0 0, 0 100%, 0 100%) + translateX(-50%)（左半向左移）
    // 为简化：上层整体收缩 + 左右两半向两侧分离
    const halfDuration = actualDuration / 2
    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 80,
          overflow: 'hidden'
        }}
      >
        {/* 下层：揭晓内容（始终存在，被上层覆盖） */}
        <div
          className={motionClass.fadeIn}
          style={{ position: 'absolute', inset: 0, animationDuration: `${actualDuration}ms` }}
        >
          {children}
        </div>
        {/* 上层：金色封面，从中间撕开向两侧移动 */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: '50%',
            background: `linear-gradient(135deg, ${colorGold} 0%, ${colorGoldLight} 100%)`,
            transition: `transform ${halfDuration}ms cubic-bezier(0.55, 0.085, 0.68, 0.53)`,
            transform: revealed ? 'translateX(-100%)' : 'translateX(0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 'clamp(20px, 2.5vw, 32px)',
            boxShadow: '2px 0 12px rgba(0,0,0,0.2)'
          }}
        >
          {!revealed && <span>辩</span>}
        </div>
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            width: '50%',
            background: `linear-gradient(135deg, ${colorGoldLight} 0%, ${colorGold} 100%)`,
            transition: `transform ${halfDuration}ms cubic-bezier(0.55, 0.085, 0.68, 0.53)`,
            transform: revealed ? 'translateX(100%)' : 'translateX(0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 'clamp(20px, 2.5vw, 32px)',
            boxShadow: '-2px 0 12px rgba(0,0,0,0.2)'
          }}
        >
          {!revealed && <span>盒</span>}
        </div>
      </div>
    )
  }

  // ===== spotlight 模式：聚光灯扫描 =====
  if (mode === 'spotlight') {
    // 用 mask radial-gradient + translate 实现聚光灯从左到右扫描
    // revealed 前：mask 圆点在左外侧（内容隐藏）
    // revealed 后：mask 圆点移到右外侧（mask 全部 transparent → 内容全显）
    // 实现策略：用两层 div，上层为 mask 层（translateX 动画），下层为内容
    const spotStyle: React.CSSProperties = {
      position: 'absolute',
      inset: 0,
      transition: `transform ${actualDuration}ms cubic-bezier(0.45, 0.05, 0.55, 0.95), opacity ${actualDuration}ms ease`,
      transform: revealed ? 'translateX(100%)' : 'translateX(-100%)',
      opacity: revealed ? 0 : 1,
      pointerEvents: 'none',
      backgroundImage: `radial-gradient(circle 120px at 50% 50%, ${colorGold}55 0%, transparent 70%)`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover'
    }
    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 80,
          overflow: 'hidden'
        }}
      >
        <div className={motionClass.fadeIn} style={{ position: 'absolute', inset: 0, animationDuration: `${actualDuration}ms` }}>
          {children}
        </div>
        {/* 聚光灯扫描层：从左到右移动覆盖内容，移出后内容渐显 */}
        <div style={spotStyle} />
      </div>
    )
  }

  // ===== fade 模式：渐显（默认） =====
  return (
    <div
      className={motionClass.fadeIn}
      style={{ animationDuration: `${actualDuration}ms`, width: '100%', height: '100%' }}
    >
      {children}
    </div>
  )
}
