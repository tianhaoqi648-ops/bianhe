// ============================================================
// FreeDebateProgressBar.tsx — 自由辩论双进度条
//
// 渲染：左右对称双进度条，左侧蓝色（正方），右侧红色（反方），
// 居中竖线分隔。当前发言方进度条满色，另一方半透明。
//
// 进度计算：progress = remainingMs / totalMs（剩余时间占比）。
// 正方条贴右（靠近分隔线）向左收缩；反方条贴左（靠近分隔线）向右收缩。
// ============================================================

import { memo } from 'react'
import { theme as antdTheme, Tooltip } from 'antd'
import { spacing, fontSize, radius, shadow } from '../../styles/tokens'
import { formatTime } from '../../utils/timer-bells'

export interface FreeDebateProgressBarProps {
  /** 正方剩余时间（毫秒） */
  proRemainingMs: number
  /** 反方剩余时间（毫秒） */
  conRemainingMs: number
  /** 单方总时长（毫秒），用于计算占比 */
  totalMs: number
  /** 当前发言方：'aff' | 'neg' */
  activeSide: 'aff' | 'neg' | 'both' | 'og' | 'oo' | 'cg' | 'co' | null
  /** 正方标签（可选，默认"正方"） */
  proLabel?: string
  /** 反方标签（可选，默认"反方"） */
  conLabel?: string
}

function FreeDebateProgressBarImpl({
  proRemainingMs,
  conRemainingMs,
  totalMs,
  activeSide,
  proLabel = '正方',
  conLabel = '反方'
}: FreeDebateProgressBarProps) {
  const { token } = antdTheme.useToken()
  const proColor = token.colorPrimary
  const conColor = token.colorError

  // 剩余时间占比（0~100），超时按 0 显示
  const proPercent = totalMs > 0
    ? Math.min(100, Math.max(0, (Math.max(0, proRemainingMs) / totalMs) * 100))
    : 0
  const conPercent = totalMs > 0
    ? Math.min(100, Math.max(0, (Math.max(0, conRemainingMs) / totalMs) * 100))
    : 0

  const isProActive = activeSide === 'aff'
  const isConActive = activeSide === 'neg'

  return (
    <div
      style={{
        width: '100%',
        padding: `${spacing.sm} ${spacing.lg}`,
        marginTop: spacing.md
      }}
    >
      {/* 标签行 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.xs,
          fontSize: fontSize.caption,
          color: token.colorTextSecondary
        }}
      >
        <span style={{ color: isProActive ? proColor : token.colorTextSecondary, fontWeight: isProActive ? 600 : 400 }}>
          {proLabel} · {formatTime(Math.max(0, proRemainingMs))}
        </span>
        <span style={{ color: isConActive ? conColor : token.colorTextSecondary, fontWeight: isConActive ? 600 : 400 }}>
          {conLabel} · {formatTime(Math.max(0, conRemainingMs))}
        </span>
      </div>

      {/* 双进度条容器 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          height: 16,
          borderRadius: radius.md,
          overflow: 'hidden',
          background: token.colorFillSecondary
        }}
      >
        {/* 左侧（正方）：贴右对齐，向左收缩 */}
        <Tooltip title={`${proLabel}剩余 ${formatTime(Math.max(0, proRemainingMs))}`}>
          <div
            style={{
              flex: '1 1 50%',
              height: '100%',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              paddingRight: 1
            }}
          >
            <div
              style={{
                width: `${proPercent}%`,
                height: '100%',
                background: proColor,
                opacity: isProActive ? 1 : 0.4,
                transition: 'width 0.1s linear, opacity 0.2s ease',
                boxShadow: isProActive ? `0 0 6px ${proColor}55` : 'none'
              }}
            />
          </div>
        </Tooltip>

        {/* 居中竖线分隔 */}
        <div
          style={{
            width: 2,
            height: '100%',
            background: token.colorBgElevated,
            boxShadow: shadow.sm,
            flex: '0 0 auto',
            zIndex: 1
          }}
        />

        {/* 右侧（反方）：贴左对齐，向右收缩 */}
        <Tooltip title={`${conLabel}剩余 ${formatTime(Math.max(0, conRemainingMs))}`}>
          <div
            style={{
              flex: '1 1 50%',
              height: '100%',
              display: 'flex',
              justifyContent: 'flex-start',
              alignItems: 'center',
              paddingLeft: 1
            }}
          >
            <div
              style={{
                width: `${conPercent}%`,
                height: '100%',
                background: conColor,
                opacity: isConActive ? 1 : 0.4,
                transition: 'width 0.1s linear, opacity 0.2s ease',
                boxShadow: isConActive ? `0 0 6px ${conColor}55` : 'none'
              }}
            />
          </div>
        </Tooltip>
      </div>
    </div>
  )
}

const FreeDebateProgressBar = memo(FreeDebateProgressBarImpl)
export default FreeDebateProgressBar
