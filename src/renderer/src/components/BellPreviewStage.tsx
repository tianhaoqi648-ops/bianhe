// ============================================================
// BellPreviewStage.tsx — 主席稿式铃声试听组件
//
// 可复用的铃声试听 UI：
//  - 列表展示所有铃响点（剩余时间 + 铃声类型 + 手动播放按钮）
//  - 主席逐条点击播放对应铃声，不记录状态、不自动连播
//  - size='normal' 用于 TimerPage，size='large' 用于大屏
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { Button, Tag, Typography } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import type { BellSound } from '../../../shared/debate-formats/types'
import { useSoundManager } from './SoundManager'
import {
  colorGold,
  colorPrimary,
  fontSize,
  spacing,
  radius,
  gray
} from '../styles/tokens'
import type { BellPreviewItem } from '../utils/bell-preview-collector'

const { Title, Text } = Typography

// 进度环几何参数（spec：半径 14px，stroke 2px）
const RING_RADIUS = 14
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS // ≈ 87.96

export interface BellPreviewStageProps {
  /** 铃声试听条目列表（已去重排序） */
  bells: BellPreviewItem[]
  /** 尺寸：normal 用于 TimerPage，large 用于大屏 */
  size?: 'normal' | 'large'
}

/** 铃声类型 → 展示标签 */
function getSoundTagLabel(sound: BellSound | `custom:${string}`): string {
  if (sound.startsWith('custom:')) return '自定义'
  switch (sound) {
    case 'beep': return '电子 beep'
    case 'bell': return '单声铃'
    case 'double_bell': return '双声铃'
    case 'time_up': return '时间到铃'
    default: return '未知'
  }
}

/** 铃声类型 → Tag 颜色 */
function getSoundTagColor(sound: BellSound | `custom:${string}`): string {
  if (sound.startsWith('custom:')) return 'purple'
  switch (sound) {
    case 'beep': return 'blue'
    case 'bell': return 'gold'
    case 'double_bell': return 'orange'
    case 'time_up': return 'red'
    default: return 'default'
  }
}

export default function BellPreviewStage({
  bells,
  size = 'normal'
}: BellPreviewStageProps) {
  const { playBell } = useSoundManager()
  const isLarge = size === 'large'

  // —— 播放进度环状态（多按钮并发，每个铃响点独立计数）——
  // key 为铃响点 id（`${atMs}-${sound}-${idx}`），value 为 0-100 进度
  const [playingProgress, setPlayingProgress] = useState<Record<string, number>>({})
  // 每个按钮独立的 RAF ID，存储在 ref 中（避免重渲染影响）
  const rafRef = useRef<Record<string, number>>({})

  /** 清除指定按钮的进度并取消其 RAF */
  const clearProgress = (id: string) => {
    if (rafRef.current[id] != null) {
      cancelAnimationFrame(rafRef.current[id])
      delete rafRef.current[id]
    }
    setPlayingProgress((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  /** 启动指定按钮的 RAF 进度动画 */
  const startProgress = (id: string, durationMs: number) => {
    if (durationMs <= 0) {
      clearProgress(id)
      return
    }
    const startTime = performance.now()
    const tick = () => {
      const elapsed = performance.now() - startTime
      const progress = Math.min(100, (elapsed / durationMs) * 100)
      setPlayingProgress((prev) => ({ ...prev, [id]: progress }))
      if (progress >= 100) {
        // 播放完毕：清除该按钮进度
        clearProgress(id)
      } else {
        rafRef.current[id] = requestAnimationFrame(tick)
      }
    }
    rafRef.current[id] = requestAnimationFrame(tick)
  }

  /** 点击播放按钮：调用 playBell 并启动进度环动画 */
  const handlePlay = (bell: BellPreviewItem, idx: number) => {
    const id = `${bell.atMs}-${bell.sound}-${idx}`
    // 重复点击：先清除该按钮的现有动画，再重新开始
    if (rafRef.current[id] != null) {
      cancelAnimationFrame(rafRef.current[id])
      delete rafRef.current[id]
    }
    // 立即设置进度为 0，提供视觉反馈
    setPlayingProgress((prev) => ({ ...prev, [id]: 0 }))
    // 调用 playBell，铃声时长通过返回值获取（自定义音用 audio.duration）
    void playBell({ atMs: bell.atMs, sound: bell.sound })
      .then((durationMs) => startProgress(id, durationMs))
      .catch(() => {
        // 播放失败：清除进度
        clearProgress(id)
      })
  }

  // 组件卸载时清理所有 RAF
  useEffect(() => {
    return () => {
      Object.values(rafRef.current).forEach((rafId) => cancelAnimationFrame(rafId))
      rafRef.current = {}
    }
  }, [])

  // size 相关样式
  const titleFontSize = isLarge ? 56 : fontSize.h1
  const rowLabelFontSize = isLarge ? 36 : fontSize.h3
  const rowTagFontSize = isLarge ? 20 : fontSize.body
  const rowMinHeight = isLarge ? 72 : 48
  const containerPadding = isLarge ? spacing.xl : spacing.lg
  const cardGap = isLarge ? spacing.md : spacing.sm
  const listMaxWidth = isLarge ? 960 : 640

  // 大屏配色（深色背景）vs 小屏配色（浅色背景）
  const textPrimary = isLarge ? '#fff' : gray[900]
  const textSecondary = isLarge ? '#bfbfbf' : gray[500]
  const cardBorderDefault = isLarge ? 'rgba(255,255,255,0.15)' : gray[200]
  const cardBgDefault = isLarge ? 'rgba(255,255,255,0.05)' : 'transparent'

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: containerPadding,
        color: textPrimary
      }}
    >
      {/* 标题 */}
      <Title
        level={2}
        style={{
          margin: 0,
          marginBottom: spacing.md,
          fontSize: titleFontSize,
          fontWeight: 700,
          color: colorGold,
          textAlign: 'center',
          letterSpacing: '0.05em'
        }}
      >
        🔔 铃声试听
      </Title>

      {/* 列表 */}
      <div
        style={{
          width: '100%',
          maxWidth: listMaxWidth,
          display: 'flex',
          flexDirection: 'column',
          gap: cardGap
        }}
      >
        {bells.length === 0 ? (
          <Text
            type="secondary"
            style={{
              textAlign: 'center',
              display: 'block',
              padding: spacing.xl,
              fontSize: rowLabelFontSize,
              color: textSecondary
            }}
          >
            当前赛制未配置铃响点
          </Text>
        ) : (
          bells.map((bell, idx) => {
            const bellId = `${bell.atMs}-${bell.sound}-${idx}`
            const progress = playingProgress[bellId] ?? 0
            const dashOffset = RING_CIRCUMFERENCE * (1 - progress / 100)
            return (
            <div
              key={bellId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: isLarge
                  ? `${spacing.md} ${spacing.xl}`
                  : `${spacing.sm} ${spacing.md}`,
                minHeight: rowMinHeight,
                borderRadius: radius.lg,
                border: `2px solid ${cardBorderDefault}`,
                background: cardBgDefault,
                transition: 'all 0.3s ease'
              }}
            >
              {/* 左侧：剩余时间标签 */}
              <div
                style={{
                  fontSize: rowLabelFontSize,
                  fontWeight: 600,
                  color: textPrimary,
                  minWidth: isLarge ? 280 : 160,
                  flex: '0 0 auto'
                }}
              >
                {bell.label}
              </div>

              {/* 中间：铃声类型 Tag */}
              <Tag
                color={getSoundTagColor(bell.sound)}
                style={{
                  margin: 0,
                  fontSize: rowTagFontSize,
                  padding: isLarge
                    ? `${spacing.xs} ${spacing.md}`
                    : `${spacing.xs} ${spacing.sm}`,
                  flex: '0 0 auto'
                }}
              >
                {getSoundTagLabel(bell.sound)}
              </Tag>

              {/* 右侧：手动播放按钮 + 播放进度环 */}
              <span
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: '0 0 auto'
                }}
              >
                <Button
                  type="text"
                  size={isLarge ? 'large' : 'small'}
                  icon={<PlayCircleOutlined />}
                  onClick={(e) => {
                    e.currentTarget.blur()
                    handlePlay(bell, idx)
                  }}
                  style={{
                    color: textSecondary
                  }}
                />
                {/* SVG 播放进度环：背景圆（灰）+ 进度圆（主色） */}
                <svg
                  viewBox="0 0 28 28"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    overflow: 'visible',
                    transform: 'rotate(-90deg)',
                    pointerEvents: 'none'
                  }}
                >
                  {/* 背景圆 */}
                  <circle
                    cx={RING_RADIUS}
                    cy={RING_RADIUS}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={cardBorderDefault}
                    strokeWidth={2}
                  />
                  {/* 进度圆（仅 progress > 0 时渲染，避免 0% 时的圆点残影） */}
                  {progress > 0 && (
                    <circle
                      cx={RING_RADIUS}
                      cy={RING_RADIUS}
                      r={RING_RADIUS}
                      fill="none"
                      stroke={colorPrimary}
                      strokeWidth={2}
                      strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                    />
                  )}
                </svg>
              </span>
            </div>
            )
          })
        )}
      </div>
    </div>
  )
}
