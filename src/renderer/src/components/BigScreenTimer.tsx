// ============================================================
// BigScreenTimer.tsx — 计时器大屏覆盖层组件（v4 重构）
//
// 架构：组件式覆盖（参考 draw/BigScreen.tsx），由 TimerPage 条件渲染
// 通信：props 直传（engine 由 TimerPage 持有，BigScreenTimer 通过 props 调用）
//
// v4 改动：
// 1. 视觉对齐抽辩题大屏（水印 + 圆点 + 金色主按钮 + 滑入动画 + 渐变背景）
// 2. 独立 timer-bigscreen scope（避免与小屏 timer scope 冲突）
// 3. 本地 UI 状态（opening/closing/transitioning/isFullscreen/slideDirection）
// 4. 开启/关闭动画（fade-in-up / slide-out-left）
// 5. Space 键自由辩论切换发言方（与辨之竹一致）
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, Typography, Space, Tag } from 'antd'
import {
  FullscreenOutlined,
  FullscreenExitOutlined,
  CloseOutlined
} from '@ant-design/icons'
import type { DebateFormatData, DrawSessionItem, StageSide, TimerState, TimerTheme, BackgroundFile } from '../../../shared/types'
import type { TimerMatchup } from '../stores/timerStore'
import { useSettingsStore, getTimerBackgroundSetting } from '../stores/settingsStore'
import { resolveBackgroundCss } from '../../../shared/timer-backgrounds'
import { useHotkeys, useHotkeyScope } from '../hooks/useHotkeys'
import TeamAvatar from './TeamAvatar'
import BellPreviewStage from './BellPreviewStage'
import { formatTime } from '../utils/timer-bells'
import { collectBellsForPreview } from '../utils/bell-preview-collector'
import { HOTKEY_PRESETS, formatCombo } from '../utils/hotkey-presets'
import { kbdStyle } from '../styles/shared'
import { fontSize, radius, colorGold, colorGoldLight } from '../styles/tokens'
import { motionClass } from '../styles/motion'

const { Text } = Typography

/** 毫秒转 MM:SS 格式 */
function formatMinutes(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export interface BigScreenTimerProps {
  // ===== 计时器状态（从 engine 透传）=====
  state: TimerState
  stageName: string
  format: DebateFormatData
  matchup: TimerMatchup | null
  theme: TimerTheme | null
  graceRemainingMs?: number
  isFreeDebate: boolean
  currentStageNumber: number
  totalStages: number
  accumulatedMs: number
  eventName?: string
  /** Task 6：多队同题模式下的当前抽签 item（team_ids 非空时启用多队渲染分支） */
  multiTeamItem?: DrawSessionItem | null

  // ===== engine 控制方法（回调）=====
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onPrevStage: () => void
  onNextStage: () => void
  onAddTime: (deltaMs: number) => void
  onSwitchSide: () => void
  onFinishStage: () => void
  onFinish: () => void

  // ===== 大屏生命周期 =====
  onClose: () => void
}

const DEFAULT_THEME: TimerTheme = {
  affLabel: '正方',
  negLabel: '反方',
  affColor: '#1677ff',
  negColor: '#ff4d4f',
  accentColor: '#faad14'
}

const AFF_SIDES: ReadonlySet<StageSide> = new Set(['aff', 'og', 'cg'])
const NEG_SIDES: ReadonlySet<StageSide> = new Set(['neg', 'oo', 'co'])

export default function BigScreenTimer({
  state,
  stageName,
  theme,
  matchup,
  format,
  graceRemainingMs,
  isFreeDebate,
  eventName,
  multiTeamItem,
  currentStageNumber,
  totalStages,
  accumulatedMs,
  onStart,
  onPause,
  onResume,
  onPrevStage,
  onNextStage,
  onAddTime,
  onSwitchSide,
  onFinishStage,
  onFinish,
  onClose
}: BigScreenTimerProps) {
  // ===== 本地 UI 状态 =====
  const [isFullscreen, setIsFullscreen] = useState(false)
  const isFullscreenRef = useRef(false)
  const updateFullscreen = useCallback((next: boolean) => {
    isFullscreenRef.current = next
    setIsFullscreen(next)
  }, [])
  const [transitioning, setTransitioning] = useState(false)
  const [opening, setOpening] = useState(true)
  const [closing, setClosing] = useState(false)
  // closing ref：避免关闭动画期间 exitFullscreen 触发重复 handleClose
  const closingRef = useRef(false)

  // ===== 计时器背景：订阅 settingsStore，与小屏保持一致 =====
  const settings = useSettingsStore((s) => s.settings)
  const timerBackground = useMemo(
    () => getTimerBackgroundSetting(settings),
    [settings]
  )
  const [customBackgrounds, setCustomBackgrounds] = useState<BackgroundFile[]>([])
  const backgroundCss = useMemo(
    () => resolveBackgroundCss(timerBackground, customBackgrounds),
    [timerBackground, customBackgrounds]
  )

  // 挂载时拉取自定义背景文件列表
  useEffect(() => {
    void window.backgroundAPI.list().then((res) => {
      if (res.success && res.data) setCustomBackgrounds(res.data)
    })
  }, [])

  // ===== 大屏快捷键作用域（独立 scope，避免与小屏 timer scope 冲突）=====
  useHotkeyScope('timer-bigscreen')

  const isAnimating = opening || closing || transitioning
  const isAnimatingRef = useRef(isAnimating)
  isAnimatingRef.current = isAnimating

  // ===== 环节切换动画 =====
  const handleNextStageWithAnim = () => {
    if (transitioning) return
    setTransitioning(true)
    setTimeout(() => {
      onNextStage()
      setTransitioning(false)
    }, 200)
  }

  const handlePrevStageWithAnim = () => {
    if (transitioning) return
    setTransitioning(true)
    setTimeout(() => {
      onPrevStage()
      setTransitioning(false)
    }, 200)
  }

  // ===== 大屏开启/关闭动画 =====
  useEffect(() => {
    setOpening(true)
    const timer = setTimeout(() => setOpening(false), 400)
    return () => clearTimeout(timer)
  }, [])

  const handleClose = () => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    setTimeout(() => onClose(), 300)
  }

  // ===== 自动浏览器全屏（投屏模式）=====
  // 挂载时自动 requestFullscreen，卸载时自动 exitFullscreen
  useEffect(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {
        // 用户拒绝全屏权限或环境不支持，不阻塞大屏打开
      })
    }
    return () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  // ===== 锁定 body/html 滚动（防止父页面滚动条穿透到大屏）=====
  // 大屏为 position:fixed 覆盖视口，但浏览器原生滚动条无法被 z-index 覆盖，
  // 必须从源头锁定 body/html 的 overflow
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
    }
  }, [])

  // ===== Space 键特殊逻辑（与辨之竹一致）=====
  // 非自由辩论：idle→开始，running→暂停，paused→恢复
  // 自由辩论：idle→开始，running→切换发言方，paused→恢复
  const handleSpaceAction = () => {
    if (isAnimating) return
    if (state.status === 'idle') {
      onStart()
    } else if (state.status === 'paused') {
      onResume()
    } else if (state.status === 'running') {
      if (isFreeDebate) {
        onSwitchSide() // 自由辩论切换发言方
      } else {
        onPause()
      }
    }
  }

  // ===== 主按钮点击逻辑 =====
  // 主按钮始终控制计时（暂停/恢复），不切换发言方
  const handlePrimaryAction = () => {
    if (isAnimating) return
    if (state.status === 'idle') {
      onStart()
    } else if (state.status === 'running') {
      onPause()
    } else if (state.status === 'paused') {
      onResume()
    } else if (state.status === 'finished') {
      handleClose()
    }
  }

  // ===== 监听全屏状态变化 =====
  // 1. 同步 isFullscreen 状态（按钮图标切换）
  // 2. 用户按 ESC 退出浏览器全屏时，若非 closing 流程，同步关闭大屏
  useEffect(() => {
    const handler = () => {
      const isFs = !!document.fullscreenElement
      // 值变化守卫：避免 StrictMode 双挂载下交替触发
      if (isFs === isFullscreenRef.current) return
      updateFullscreen(isFs)
      // 用户主动退出浏览器全屏（非 closing 流程），同步关闭大屏
      if (!isFs && !closingRef.current) {
        handleClose()
      }
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [updateFullscreen])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }

  // ===== 快捷键注册（timer-bigscreen scope）=====
  useHotkeys([
    {
      combo: 'escape',
      description: '退出大屏',
      scope: 'timer-bigscreen',
      handler: () => {
        // P3-23 修复：动画期间忽略 escape，避免关闭动画与 escape 冲突导致重复 handleClose
        if (isAnimatingRef.current) return
        handleClose()
      }
    },
    {
      combo: 'space',
      description: '开始/切换发言方/暂停/恢复',
      scope: 'timer-bigscreen',
      handler: () => {
        if (isAnimatingRef.current) return
        handleSpaceAction()
      }
    },
    {
      combo: 'p',
      description: '中断（结束当前会话）',
      scope: 'timer-bigscreen',
      handler: () => {
        if (isAnimatingRef.current) return
        onFinish()
      },
      enabled: state.status !== 'idle'
    },
    {
      combo: 'arrowleft',
      description: '上一环节',
      scope: 'timer-bigscreen',
      handler: () => {
        if (isAnimatingRef.current) return
        handlePrevStageWithAnim()
      },
      enabled: state.status !== 'idle' && state.currentStageIndex > 0
    },
    {
      combo: 'arrowright',
      description: '下一环节',
      scope: 'timer-bigscreen',
      handler: () => {
        if (isAnimatingRef.current) return
        handleNextStageWithAnim()
      },
      enabled: state.status !== 'idle' && state.currentStageIndex < totalStages - 1
    },
    {
      combo: 'q',
      description: '+30秒',
      scope: 'timer-bigscreen',
      handler: () => {
        if (isAnimatingRef.current) return
        onAddTime(30 * 1000)
      },
      enabled: state.status === 'running' || state.status === 'paused'
    },
    {
      combo: 'w',
      description: '+5秒',
      scope: 'timer-bigscreen',
      handler: () => {
        if (isAnimatingRef.current) return
        onAddTime(5 * 1000)
      },
      enabled: state.status === 'running' || state.status === 'paused'
    },
    {
      combo: 'e',
      description: '时间到（结束当前环节）',
      scope: 'timer-bigscreen',
      handler: () => {
        if (isAnimatingRef.current) return
        onFinishStage()
      },
      enabled: state.status === 'running' || state.status === 'paused'
    },
    {
      combo: 'f',
      description: '切换全屏',
      scope: 'timer-bigscreen',
      handler: () => toggleFullscreen()
    },
    {
      combo: 'b',
      description: '关闭大屏',
      scope: 'timer-bigscreen',
      handler: () => {
        // P3-23 修复：动画期间忽略 b 键，与 escape 保持一致
        if (isAnimatingRef.current) return
        handleClose()
      }
    },
    {
      combo: 's',
      description: '切换发言方（备选）',
      scope: 'timer-bigscreen',
      handler: () => {
        if (isAnimatingRef.current) return
        onSwitchSide()
      },
      enabled: isFreeDebate && (state.status === 'running' || state.status === 'paused')
    }
  ])

  // ===== 衍生变量 =====
  const t = theme ?? DEFAULT_THEME
  const side = state.currentSide
  const isAffSpeaking = AFF_SIDES.has(side)
  const isNegSpeaking = NEG_SIDES.has(side)
  const isBoth = side === 'both'

  const affName = matchup?.affTeamName || t.affLabel
  const negName = matchup?.negTeamName || t.negLabel

  // Task 6.1：判断是否为 group/multi_team 模式（team_ids 非空 → 多队同题）
  const isMultiTeamMode = !!(multiTeamItem?.team_ids && multiTeamItem.team_ids.length > 0)

  // Task 7.3：从 format 读取当前环节定义，判断是否为非计时环节
  const currentStageDef = format.stages[state.currentStageIndex]
  const isUntimed = currentStageDef?.timingMode === 'untimed'
  // Task 6.6：铃声试听环节标记
  const isBellPreview = currentStageDef?.isBellPreview ?? false
  const bellPreviewBells = useMemo(
    () => (isBellPreview ? collectBellsForPreview(format) : []),
    [isBellPreview, format]
  )

  const isWarning = state.remainingMs <= 30 * 1000 && state.remainingMs > 0
  const isOvertime = state.remainingMs <= 0
  const inGrace = typeof graceRemainingMs === 'number' && graceRemainingMs > 0

  // 颜色优先级：宽限期/超时（红） > 30s 预警（黄） > 默认（白）
  const timerColor = inGrace || isOvertime
    ? '#ff4d4f'
    : isWarning
      ? t.accentColor
      : '#ffffff'

  // ===== 主按钮文案 =====
  const getPrimaryButtonText = (): string => {
    if (state.status === 'idle') return '开始计时'
    if (state.status === 'running') return '暂停'
    if (state.status === 'paused') return '恢复'
    return '结束'
  }

  // ===== 背景：优先使用计时器背景设置（preset/custom），否则回退到主题 backgroundPath =====
  // 计时器背景（preset 渐变 / custom 自定义图片）覆盖主题背景，保证小屏与大屏一致
  const backgroundStyle: CSSProperties = useMemo(() => {
    if (backgroundCss) {
      return { background: backgroundCss }
    }
    if (t.backgroundPath) {
      return {
        backgroundImage: `url(${t.backgroundPath})`,
        backgroundSize: t.backgroundFit === 'stretch' ? '100% 100%' : t.backgroundFit ?? 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }
    }
    return {}
  }, [backgroundCss, t.backgroundPath, t.backgroundFit])

  // ===== 快捷键提示（从 HOTKEY_PRESETS 动态读取，customMap 变化时自动同步）=====
  const bigscreenPresets = HOTKEY_PRESETS.filter(p => p.scope === 'timer-bigscreen')
  const hotkeyHint = bigscreenPresets
    .filter(p => ['escape', 'space', 'arrowleft', 'arrowright', 's'].includes(p.combo))
    .map(p => `${formatCombo(p.combo)} ${p.description}`)
    .join(' · ')

  return (
    <div
      className={`bigscreen-overlay ${opening ? 'fade-in-up' : ''} ${closing ? 'slide-out-left' : ''}`}
      style={{
        ...backgroundStyle,
        color: '#fff'
      }}
    >
      {/* 顶部：赛事名 · 环节名 · 圆点指示器 · 控制按钮 */}
      <div
        style={{
          width: '100%',
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 'clamp(8px, 1vw, 12px)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          zIndex: 2
        }}
      >
        <div style={{ fontSize: 'clamp(16px, 2vw, 26px)', color: '#bfbfbf', fontWeight: 500 }}>
          {eventName ?? '辩论赛'} · {stageName}
        </div>

        {/* 圆点指示器 */}
        <div className="bigscreen-stage-dots" style={{ margin: 0 }}>
          {Array.from({ length: totalStages }).map((_, index) => {
            const isCompleted = index < currentStageNumber - 1
            const isCurrent = index === currentStageNumber - 1
            return (
              <div
                key={index}
                className={`bigscreen-stage-dot ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}
              />
            )
          })}
        </div>

        <Space size={8}>
          <Button
            type="text"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={(e) => { e.currentTarget.blur(); toggleFullscreen() }}
            style={{ color: '#fff', fontSize: fontSize.h3 }}
          />
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={(e) => { e.currentTarget.blur(); handleClose() }}
            style={{ color: '#fff', fontSize: fontSize.h3 }}
          />
        </Space>
      </div>

      {/* 中部：水印 + 队伍对阵 + 倒计时（key 强制重挂载触发滑入动画） */}
      <div
        key={state.currentStageIndex}
        className="fade-in"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        {/* 环节序号大字水印 */}
        <div
          key={state.currentStageIndex}
          className="bigscreen-stage-watermark watermark-scale-in"
        >
          {String(currentStageNumber).padStart(2, '0')}
        </div>

        {/* 队伍对阵 — 铃声试听环节隐藏（与铃声演示无关） */}
        {/* Task 6.2：group/multi_team 模式渲染多队网格，versus 模式保持现有显示 */}
        {!isBellPreview && (
          isMultiTeamMode ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: '100%',
                margin: 'clamp(8px, 2vh, 20px) 0',
                zIndex: 1,
                gap: 'clamp(8px, 1.5vh, 16px)'
              }}
            >
              {/* 辩题标题（大字号，沿用 bigscreen-topic-title 样式） */}
              <div className="bigscreen-topic-title">
                {multiTeamItem!.topic_title ?? '（未设置辩题）'}
              </div>

              {/* 同题队伍区域标题（小字号灰色） */}
              <div style={{ fontSize: 'clamp(14px, 1.5vw, 20px)', color: '#bfbfbf', fontWeight: 500 }}>
                同题队伍（共 {multiTeamItem!.team_ids!.length} 队）
              </div>

              {/* 队伍网格：≤4 队 2 列，>4 队 3 列 */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${multiTeamItem!.team_ids!.length <= 4 ? 2 : 3}, 1fr)`,
                  gap: 'clamp(12px, 1.5vw, 20px)',
                  width: '100%',
                  maxWidth: '1200px',
                  marginTop: 'clamp(8px, 1vh, 12px)'
                }}
              >
                {multiTeamItem!.team_ids!.map((teamId, i) => {
                  const teamName = multiTeamItem!.team_names?.[i] ?? '未知队伍'
                  const stance = multiTeamItem!.team_stances?.[i]
                  return (
                    <div
                      key={teamId}
                      style={{
                        padding: 'clamp(16px, 2vw, 28px) clamp(16px, 2vw, 24px)',
                        borderRadius: radius.xxl,
                        background: 'rgba(255, 255, 255, 0.08)',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        textAlign: 'center',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 'clamp(6px, 0.8vh, 12px)'
                      }}
                    >
                      {stance && (
                        <Tag
                          color={stance === '正方' ? 'gold' : 'silver'}
                          style={{
                            fontSize: 'clamp(12px, 1.2vw, 16px)',
                            margin: 0,
                            paddingInline: 'clamp(8px, 0.8vw, 12px)',
                            borderRadius: '4px',
                            lineHeight: 1.6
                          }}
                        >
                          {stance}
                        </Tag>
                      )}
                      <div
                        style={{
                          fontSize: 'clamp(20px, 2.5vw, 36px)',
                          fontWeight: 700,
                          color: '#fff',
                          wordBreak: 'break-word'
                        }}
                      >
                        {teamName}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            width: '100%',
            margin: isFreeDebate ? 'clamp(8px, 1.5vh, 12px) 0' : 'clamp(8px, 2vh, 20px) 0',
            gap: 'clamp(16px, 4vw, 48px)',
            zIndex: 1
          }}
        >
          <div
            style={{
              opacity: isNegSpeaking && !isAffSpeaking && !isBoth ? 0.3 : 1,
              transition: 'all 0.3s ease',
              background: isAffSpeaking || isBoth ? `${t.affColor}25` : 'transparent',
              borderRadius: radius.xxl,
              padding: isFreeDebate ? 'clamp(24px, 3vw, 48px)' : 'clamp(12px, 2vh, 24px)',
              textAlign: 'center',
              flex: isFreeDebate ? 1 : 'unset',
              transform: isFreeDebate && isAffSpeaking ? 'scale(1.05)' : 'scale(1)'
            }}
          >
            <TeamAvatar name={affName} color={t.affColor} logo={matchup?.affLogo} size={isFreeDebate ? 120 : 96} />
            <div style={{ fontSize: 'clamp(32px, 5vw, 56px)', fontWeight: 700, color: t.affColor, marginTop: 'clamp(4px, 1vh, 12px)' }}>
              {affName}
            </div>
            <div style={{ fontSize: 'clamp(16px, 2vw, 24px)', color: '#bfbfbf' }}>{t.affLabel}</div>
            {/* 自由辩论双计时器（正方） */}
            {isFreeDebate && (
              <div
                className="bigscreen-team-timer"
                style={{ color: isAffSpeaking ? t.affColor : '#666' }}
              >
                {formatTime(state.affRemainingMs ?? 0)}
              </div>
            )}
          </div>

          <div style={{ fontSize: 'clamp(40px, 6vw, 72px)', color: '#ffd666', fontWeight: 300 }}>VS</div>

          <div
            style={{
              opacity: isAffSpeaking && !isNegSpeaking && !isBoth ? 0.3 : 1,
              transition: 'all 0.3s ease',
              background: isNegSpeaking || isBoth ? `${t.negColor}25` : 'transparent',
              borderRadius: radius.xxl,
              padding: isFreeDebate ? 'clamp(24px, 3vw, 48px)' : 'clamp(12px, 2vh, 24px)',
              textAlign: 'center',
              flex: isFreeDebate ? 1 : 'unset',
              transform: isFreeDebate && isNegSpeaking ? 'scale(1.05)' : 'scale(1)'
            }}
          >
            <TeamAvatar name={negName} color={t.negColor} logo={matchup?.negLogo} size={isFreeDebate ? 120 : 96} />
            <div style={{ fontSize: 'clamp(32px, 5vw, 56px)', fontWeight: 700, color: t.negColor, marginTop: 'clamp(4px, 1vh, 12px)' }}>
              {negName}
            </div>
            <div style={{ fontSize: 'clamp(16px, 2vw, 24px)', color: '#bfbfbf' }}>{t.negLabel}</div>
            {/* 自由辩论双计时器（反方） */}
            {isFreeDebate && (
              <div
                className="bigscreen-team-timer"
                style={{ color: isNegSpeaking ? t.negColor : '#666' }}
              >
                {formatTime(state.negRemainingMs ?? 0)}
              </div>
            )}
          </div>
        </div>
          )
        )}

        {/* 倒计时大字 - 非自由辩论且非计时环节时不显示，改为"进行中"指示器 */}
        {!isFreeDebate && !isUntimed && (
          <div style={{ textAlign: 'center', zIndex: 1, position: 'relative' }}>
            {/* P3.1 Task 2：金色倒计时环 SVG circle 光环 */}
            {(() => {
              // 环形进度参数：SVG viewBox 100x100，circle r=42（留出 stroke-width=8 的空间）
              const R = 42
              const CIRCUMFERENCE = 2 * Math.PI * R // ≈ 263.89
              const totalMs = currentStageDef?.durationMs ?? 0
              // progress: 1 = 满时间，0 = 时间到（环闭合）
              const progress = totalMs > 0 ? Math.max(0, Math.min(1, state.remainingMs / totalMs)) : 0
              // stroke-dashoffset: remainingMs 减少时 offset 增大，环逐渐缩短
              const dashOffset = CIRCUMFERENCE * (1 - progress)

              // 颜色渐变：剩余 ≥30s 金色，<30s 渐变 warning，<5s 渐变 error + pulse
              const remainingSec = state.remainingMs / 1000
              const isCritical = remainingSec > 0 && remainingSec < 5
              const isWarn = remainingSec >= 5 && remainingSec < 30
              // stroke 渐变起止色
              const strokeFrom = isCritical ? '#ff4d4f' : isWarn ? '#faad14' : colorGold
              const strokeTo = isCritical ? '#ff7875' : isWarn ? '#ffc53d' : colorGoldLight
              const gradientId = 'bigscreen-timer-ring'

              return (
                <div
                  style={{
                    position: 'relative',
                    width: 'clamp(320px, 70vmin, 720px)',
                    height: 'clamp(320px, 70vmin, 720px)',
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  className={isCritical ? motionClass.pulse : ''}
                >
                  <svg
                    viewBox="0 0 100 100"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      transform: 'rotate(-90deg)', // 从顶部开始
                      filter: `drop-shadow(0 0 16px ${strokeFrom})`
                    }}
                  >
                    <defs>
                      <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={strokeFrom} />
                        <stop offset="100%" stopColor={strokeTo} />
                      </linearGradient>
                    </defs>
                    {/* 底环（淡色背景轨道） */}
                    <circle
                      cx="50"
                      cy="50"
                      r={R}
                      fill="none"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth="8"
                    />
                    {/* 进度环 */}
                    <circle
                      cx="50"
                      cy="50"
                      r={R}
                      fill="none"
                      stroke={`url(#${gradientId})`}
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={CIRCUMFERENCE}
                      strokeDashoffset={dashOffset}
                      style={{
                        transition: 'stroke-dashoffset 0.3s linear, stroke 0.3s ease'
                      }}
                    />
                  </svg>
                  {/* 中央倒计时数字 */}
                  <div
                    className="bigscreen-timer-digits"
                    style={{
                      fontSize: 'clamp(64px, 14vmin, 180px)',
                      color: timerColor,
                      textShadow: inGrace || isOvertime ? '0 0 24px rgba(255,77,79,0.6)' : 'none',
                      fontWeight: 700,
                      zIndex: 1
                    }}
                  >
                    {formatTime(state.remainingMs)}
                  </div>
                </div>
              )
            })()}
            {inGrace && (
              <Text style={{ color: '#ff4d4f', fontSize: 'clamp(14px, 1.5vw, 22px)', marginTop: 'clamp(4px, 1vh, 12px)', display: 'block' }}>
                宽限期内 · 剩余 {Math.ceil((graceRemainingMs ?? 0) / 1000)}s
              </Text>
            )}

            {/* 累计时间 + 当前环节名 + 状态 */}
            <div style={{ marginTop: 'clamp(8px, 2vh, 20px)' }}>
              <Text style={{ color: '#999', fontSize: 'clamp(14px, 1.5vw, 22px)' }}>
                累计 {formatMinutes(accumulatedMs)} / 总时长 {formatMinutes(format.totalDurationMs)}
              </Text>
              <div style={{ marginTop: 'clamp(4px, 1vh, 12px)' }}>
                <Text style={{ color: t.accentColor, fontSize: 'clamp(16px, 2vw, 26px)', fontWeight: 500 }}>
                  {stageName}
                </Text>
              </div>
              <Text style={{ color: '#999', fontSize: 'clamp(12px, 1.2vw, 18px)', marginTop: 'clamp(4px, 1vh, 12px)', display: 'block' }}>
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
        )}

        {/* Task 7.3：非计时环节中央显示"进行中"指示器（铃声试听环节除外，由 BellPreviewStage 接管） */}
        {!isFreeDebate && isUntimed && !isBellPreview && (
          <div style={{ textAlign: 'center', zIndex: 1 }}>
            <div
              style={{
                fontSize: 'clamp(72px, 14vw, 180px)',
                fontWeight: 700,
                color: t.accentColor,
                letterSpacing: '0.1em',
                textShadow: '0 0 24px rgba(250,173,20,0.4)'
              }}
            >
              进行中
            </div>
            <Text style={{ color: '#999', fontSize: 'clamp(14px, 1.5vw, 22px)', marginTop: 'clamp(8px, 2vh, 20px)', display: 'block' }}>
              非计时环节
            </Text>
            <div style={{ marginTop: 'clamp(4px, 1vh, 12px)' }}>
              <Text style={{ color: t.accentColor, fontSize: 'clamp(16px, 2vw, 26px)', fontWeight: 500 }}>
                {stageName}
              </Text>
            </div>
            <Text style={{ color: '#999', fontSize: 'clamp(12px, 1.2vw, 18px)', marginTop: 'clamp(4px, 1vh, 12px)', display: 'block' }}>
              状态：
              {state.status === 'running'
                ? '进行中'
                : state.status === 'paused'
                  ? '已暂停'
                  : state.status === 'finished'
                    ? '已结束'
                    : '待开始'}
            </Text>
          </div>
        )}

        {/* Task 6.6：铃声试听环节 — 大屏渲染 BellPreviewStage size="large" */}
        {!isFreeDebate && isUntimed && isBellPreview && (
          <div
            style={{
              width: '100%',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              zIndex: 1,
              minHeight: 0
            }}
          >
            <BellPreviewStage bells={bellPreviewBells} size="large" />
          </div>
        )}

        {/* 自由辩论时显示中央发言方提示 */}
        {isFreeDebate && (
          <div style={{ textAlign: 'center', zIndex: 1, marginTop: 'clamp(8px, 2vh, 20px)' }}>
            <div style={{ fontSize: 'clamp(20px, 2.5vw, 32px)', color: '#bfbfbf', fontWeight: 500 }}>
              当前发言方
            </div>
            <div
              style={{
                fontSize: 'clamp(32px, 5vw, 56px)',
                fontWeight: 700,
                color: isAffSpeaking ? t.affColor : isNegSpeaking ? t.negColor : '#fff',
                marginTop: 'clamp(4px, 1vh, 12px)'
              }}
            >
              {isAffSpeaking ? affName : isNegSpeaking ? negName : '—'}
            </div>
            <div style={{ marginTop: 'clamp(8px, 1.5vh, 16px)', color: '#999', fontSize: 'clamp(14px, 1.5vw, 20px)' }}>
              按 <kbd style={kbdStyle}>Space</kbd> 切换发言方
            </div>
          </div>
        )}
      </div>

      {/* 底部：主按钮 + 副按钮 + 快捷键提示 */}
      <div
        style={{
          width: '100%',
          flexShrink: 0,
          paddingTop: 'clamp(8px, 1.5vh, 14px)',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          zIndex: 2
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 24,
            marginBottom: 'clamp(4px, 1vh, 10px)'
          }}
        >
          {/* 左侧副按钮：上一环节 */}
          <Button
            size="large"
            disabled={isAnimating || state.status === 'idle' || state.currentStageIndex === 0}
            onClick={(e) => { e.currentTarget.blur(); handlePrevStageWithAnim() }}
            style={{ minWidth: 'clamp(100px, 12vw, 140px)', height: 'clamp(40px, 6vh, 56px)', fontSize: 'clamp(13px, 1.4vw, 18px)', borderColor: 'rgba(255,255,255,0.3)', color: '#fff', background: 'rgba(255,255,255,0.05)' }}
          >
            上一环节
          </Button>

          {/* 金色主按钮（pulse 动画） */}
          <Button
            className="bigscreen-primary-btn pulse-primary btn-press"
            size="large"
            disabled={isAnimating}
            onClick={(e) => { e.currentTarget.blur(); handlePrimaryAction() }}
          >
            {getPrimaryButtonText()}
          </Button>

          {/* 右侧副按钮：时间到 */}
          <Button
            size="large"
            disabled={isAnimating || (state.status !== 'running' && state.status !== 'paused')}
            onClick={(e) => { e.currentTarget.blur(); onFinishStage() }}
            style={{ minWidth: 'clamp(100px, 12vw, 140px)', height: 'clamp(40px, 6vh, 56px)', fontSize: 'clamp(13px, 1.4vw, 18px)', borderColor: 'rgba(255,77,79,0.5)', color: '#ff4d4f', background: 'rgba(255,77,79,0.05)' }}
          >
            时间到
          </Button>
        </div>

        {/* 快捷键提示（从 HOTKEY_PRESETS 动态生成，跟随 customMap 变化） */}
        <div style={{ textAlign: 'center' }}>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'clamp(11px, 1vw, 13px)' }}>
            {hotkeyHint}
          </Text>
        </div>
      </div>
    </div>
  )
}
