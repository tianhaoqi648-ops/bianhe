// ============================================================
// TimerDisplay.tsx — 双队对阵展示（辨之竹风格）
//
// 队名首字圆形头像 fallback + 当前发言方高亮 + 30s 预警 + 超时红色 + 宽限期警告
// ============================================================

import { Typography, Space } from 'antd'
import type { StageSide, TimerState, TimerTheme } from '../../../shared/types'
import type { TimerMatchup } from '../stores/timerStore'
import { formatTime } from '../utils/timer-bells'
import TeamAvatar from './TeamAvatar'
import { spacing, radius, fontSize } from '../styles/tokens'

const { Title, Text } = Typography

interface TimerDisplayProps {
  state: TimerState
  stageName: string
  /** 主题色配置，为空时使用默认蓝红主题 */
  theme?: TimerTheme | null
  /** 对阵展示信息（队名 + 可选 logo data URL），为空时使用主题 affLabel/negLabel */
  matchup?: TimerMatchup | null
  /** 当前发言方，默认取 state.currentSide */
  currentSide?: StageSide
  /** 宽限期剩余毫秒（>0 表示处于宽限期），用于红色警告展示 */
  graceRemainingMs?: number
  /** 当前环节是否为自由辩论（决定是否显示双计时器并列 UI） */
  isFreeDebate?: boolean
}

const DEFAULT_THEME: TimerTheme = {
  affLabel: '正方',
  negLabel: '反方',
  affColor: '#1677ff',
  negColor: '#ff4d4f',
  accentColor: '#faad14'
}

/** 正方侧集合（用于发言方高亮判断） */
const AFF_SIDES: ReadonlySet<StageSide> = new Set(['aff', 'og', 'cg'])
/** 反方侧集合 */
const NEG_SIDES: ReadonlySet<StageSide> = new Set(['neg', 'oo', 'co'])

export default function TimerDisplay({
  state,
  stageName,
  theme,
  matchup,
  currentSide,
  graceRemainingMs,
  isFreeDebate
}: TimerDisplayProps) {
  const t = theme ?? DEFAULT_THEME
  const side: StageSide = currentSide ?? state.currentSide

  const isAffSpeaking = AFF_SIDES.has(side)
  const isNegSpeaking = NEG_SIDES.has(side)
  const isBoth = side === 'both'

  // 空字符串视为未设置，回退到主题标签
  const affName = matchup?.affTeamName || t.affLabel
  const negName = matchup?.negTeamName || t.negLabel

  const isWarning = state.remainingMs <= 30 * 1000 && state.remainingMs > 0
  const isOvertime = state.remainingMs <= 0
  const inGrace = typeof graceRemainingMs === 'number' && graceRemainingMs > 0

  // 颜色优先级：宽限期/超时（红） > 30s 预警（黄） > 默认
  const timerColor = inGrace || isOvertime
    ? '#ff4d4f'
    : isWarning
      ? t.accentColor
      : '#262626'

  return (
    <div style={{ textAlign: 'center', padding: '24px 16px' }}>
      {/* 双队对阵 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24
        }}
      >
        <div
          style={{
            flex: 1,
            opacity: isNegSpeaking && !isAffSpeaking && !isBoth ? 0.3 : 1,
            transition: 'opacity 0.3s',
            background: isAffSpeaking || isBoth ? `${t.affColor}15` : 'transparent',
            borderRadius: radius.lg,
            padding: spacing.md
          }}
        >
          <Space direction="vertical" size={4} align="center" style={{ width: '100%' }}>
            <TeamAvatar name={affName} color={t.affColor} logo={matchup?.affLogo} />
            <Text strong style={{ color: t.affColor, fontSize: fontSize.h3 }}>
              {affName}
            </Text>
            <Text type="secondary" style={{ fontSize: fontSize.caption }}>
              {t.affLabel}
            </Text>
          </Space>
        </div>

        <div style={{ padding: '0 16px' }}>
          <Title level={2} style={{ margin: 0, color: '#bfbfbf' }}>
            VS
          </Title>
        </div>

        <div
          style={{
            flex: 1,
            opacity: isAffSpeaking && !isNegSpeaking && !isBoth ? 0.3 : 1,
            transition: 'opacity 0.3s',
            background: isNegSpeaking || isBoth ? `${t.negColor}15` : 'transparent',
            borderRadius: radius.lg,
            padding: spacing.md
          }}
        >
          <Space direction="vertical" size={4} align="center" style={{ width: '100%' }}>
            <TeamAvatar name={negName} color={t.negColor} logo={matchup?.negLogo} />
            <Text strong style={{ color: t.negColor, fontSize: fontSize.h3 }}>
              {negName}
            </Text>
            <Text type="secondary" style={{ fontSize: fontSize.caption }}>
              {t.negLabel}
            </Text>
          </Space>
        </div>
      </div>

      {/* 自由辩论双计时器（双方独立计时，仅 isFreeDebate=true 时显示） */}
      {isFreeDebate && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, padding: '0 32px' }}>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              opacity: isAffSpeaking ? 1 : 0.3,
              background: isAffSpeaking ? `${t.affColor}15` : 'transparent',
              borderRadius: radius.lg,
              padding: spacing.md
            }}
          >
            <Text style={{ color: t.affColor, fontSize: fontSize.body }}>正方剩余</Text>
            <div
              style={{
                fontSize: 80,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: isAffSpeaking ? t.affColor : '#bfbfbf',
                fontFamily: 'monospace',
                lineHeight: 1.2
              }}
            >
              {formatTime(state.affRemainingMs ?? 0)}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              opacity: isNegSpeaking ? 1 : 0.3,
              background: isNegSpeaking ? `${t.negColor}15` : 'transparent',
              borderRadius: radius.lg,
              padding: spacing.md
            }}
          >
            <Text style={{ color: t.negColor, fontSize: fontSize.body }}>反方剩余</Text>
            <div
              style={{
                fontSize: 80,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: isNegSpeaking ? t.negColor : '#bfbfbf',
                fontFamily: 'monospace',
                lineHeight: 1.2
              }}
            >
              {formatTime(state.negRemainingMs ?? 0)}
            </div>
          </div>
        </div>
      )}

      {/* 当前环节 */}
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: fontSize.h4 }}>
          当前环节
        </Text>
        <Title level={3} style={{ margin: '4px 0', color: t.accentColor }}>
          {stageName}
        </Title>
      </div>

      {/* 倒计时 */}
      <div>
        <div
          style={{
            fontSize: '120px',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: timerColor,
            lineHeight: 1,
            fontFamily: 'monospace'
          }}
        >
          {formatTime(state.remainingMs)}
        </div>
        {inGrace && (
          <Text type="danger" style={{ fontSize: fontSize.caption }}>
            宽限期内 · 剩余 {Math.ceil((graceRemainingMs ?? 0) / 1000)}s
          </Text>
        )}
        {isFreeDebate && (
          <Text style={{ display: 'block', marginTop: 8, color: t.accentColor }}>
            当前发言方：{isAffSpeaking ? '正方' : '反方'}（按 S 切换）
          </Text>
        )}
        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          状态：
          {state.status === 'running'
            ? '计时中'
            : state.status === 'paused'
              ? '已暂停'
              : state.status === 'finished'
                ? '已结束'
                : '待开始'}
        </Text>
      </div>
    </div>
  )
}
