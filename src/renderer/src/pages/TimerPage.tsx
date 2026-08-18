// ============================================================
// TimerPage.tsx — 计时主页
//
// 集成：赛制选择 + 计时引擎 + 铃声管理 + 双队对阵展示 +
//       主题加载 + 自由辩论切换 + 历史会话 + 大屏入口
//
// 注意（修复历史）：
// 1. 不再使用 const timerStore = useTimerStore() 全量订阅，改为 selector 订阅最小切片
// 2. matchup 写入 store 通过 useEffect([matchup, setMatchup]) 触发，setMatchup 是稳定引用
// 3. format prop 用 useMemo 稳定化，避免每次渲染新建空对象导致 engine 重建
// 4. 初始化 useEffect 使用 initedRef guard，避免 StrictMode 下双调用
// 5. onStateChange 中：updateSessionState 同步更新内存，persistSessionState 由 useDebouncedCallback 防抖持久化
// ============================================================

import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { Card, Button, Space, Input, Typography, Alert, Row, Col, Modal, Drawer, List, Tag, Popconfirm, Progress, Tooltip, theme as antdTheme } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import EmptyState from '../components/common/EmptyState'
import AccentCard from '../components/common/AccentCard'
import PageHeader from '../components/common/PageHeader'
import KbdHint from '../components/common/KbdHint'
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ForwardOutlined,
  BackwardOutlined,
  PlusCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  FullscreenOutlined,
  HistoryOutlined,
  SwapOutlined,
  PictureOutlined,
  BellOutlined,
  ExpandOutlined,
  CompressOutlined,
  SoundOutlined
} from '@ant-design/icons'
import { useFormatStore } from '../stores/formatStore'
import { useTimerStore } from '../stores/timerStore'
import { useSettingsStore, getTimerBackgroundSetting, getBgmSetting } from '../stores/settingsStore'
import type { TimerMatchup } from '../stores/timerStore'
import { useTimerEngine } from '../utils/useTimerEngine'
import { useSoundManager } from '../components/SoundManager'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'
import { useHotkeys } from '../hooks/useHotkeys'
import { hotkeyManager } from '../utils/hotkey-manager'
import TimerDisplay from '../components/TimerDisplay'
import BigScreenTimer from '../components/BigScreenTimer'
import StageProgress from '../components/StageProgress'
import FormatSelector from '../components/FormatSelector'
import TimerBackgroundPicker from '../components/TimerBackgroundPicker'
import BellPreviewModal from '../components/BellPreviewModal'
import BellPreviewStage from '../components/BellPreviewStage'
import FreeDebateProgressBar from '../components/timer/FreeDebateProgressBar'
import { collectBellsForPreview } from '../utils/bell-preview-collector'
import { pageContainerStyle } from '../styles/shared'
import { spacing, fontSize, colorPurple, radius, shadow, immersiveBg } from '../styles/tokens'
import { useToast } from '../hooks/useToast'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useStickyBg } from '../hooks/useThemeMode'
import { formatTime } from '../utils/timer-bells'
import { resolveBackgroundCss } from '../../../shared/timer-backgrounds'
import type { TimerTheme, BackgroundFile, DrawSessionItem } from '../../../shared/types'
import type { StageDef, BellDef } from '../../../shared/debate-formats/types'

/**
 * P2-43 修复：DrawPage → TimerPage 跳转上下文
 * 抽辩题完成后通过 location.state 传递抽取结果，TimerPage 在创建计时会话时
 * 透传给 timerAPI.createSession，并初始化 matchup 队名展示
 */
export interface TimerPageLocationState {
  sessionId?: string
  eventId?: string
  roundId?: string
  eventName?: string
  topicId?: string
  topicTitle?: string
  teamAffId?: string
  teamNegId?: string
  teamAffName?: string
  teamNegName?: string
  stanceAff?: string
  stanceNeg?: string
}

const { Text, Title } = Typography

export default function TimerPage() {
  // === selector 订阅 store（避免全量订阅导致 timerStore 引用每次渲染都变） ===
  const navigate = useNavigate()
  const location = useLocation()
  const formats = useFormatStore((s) => s.formats)
  const selectedFormatId = useFormatStore((s) => s.selectedFormatId)
  const fetchAllFormats = useFormatStore((s) => s.fetchAll)
  const selectFormat = useFormatStore((s) => s.selectFormat)

  const currentSession = useTimerStore((s) => s.currentSession)
  const sessions = useTimerStore((s) => s.sessions)
  const sessionsLoading = useTimerStore((s) => s.loading)
  const setMatchup = useTimerStore((s) => s.setMatchup)
  const createSession = useTimerStore((s) => s.createSession)
  const loadSession = useTimerStore((s) => s.loadSession)
  const fetchSessions = useTimerStore((s) => s.fetchSessions)
  const updateSessionState = useTimerStore((s) => s.updateSessionState)
  const persistSessionState = useTimerStore((s) => s.persistSessionState)

  // === 计时器背景：订阅 settingsStore 中的 timer.background 设置 ===
  const settings = useSettingsStore((s) => s.settings)
  const timerBackground = useMemo(
    () => getTimerBackgroundSetting(settings),
    [settings]
  )
  // P3.1 Task 5：BGM 设置（volume / defaultTrack）
  const bgmSetting = useMemo(
    () => getBgmSetting(settings),
    [settings]
  )
  // 自定义背景文件列表（由 backgroundAPI.list() 拉取，传给 resolveBackgroundCss）
  const [customBackgrounds, setCustomBackgrounds] = useState<BackgroundFile[]>([])
  // 背景选择器弹窗显隐
  const [bgPickerOpen, setBgPickerOpen] = useState(false)

  // 计算最终应用到根容器的 CSS background 字符串
  const backgroundCss = useMemo(
    () => resolveBackgroundCss(timerBackground, customBackgrounds),
    [timerBackground, customBackgrounds]
  )

  const toast = useToast()
  const { playBell, playBgm, stopBgm } = useSoundManager()
  // antd 主题 token（沉浸模式颜色 token 化）
  const { token } = antdTheme.useToken()
  // 浮动工具栏毛玻璃背景（亮 / 暗模式自适应）
  const stickyBg = useStickyBg()

  // 主题（从主进程加载）
  const [theme, setTheme] = useState<TimerTheme | null>(null)
  // 对阵队名输入（本地状态，简化为输入框）
  const [affName, setAffName] = useState('')
  const [negName, setNegName] = useState('')
  // 历史抽屉
  const [historyOpen, setHistoryOpen] = useState(false)
  // Task 20：历史 Drawer 宽度响应式 — 移动端 100%，桌面端 640
  const isMobile = useMediaQuery('(max-width: 767px)')
  // 大屏覆盖层开关（组件式覆盖，替代原 window.open 新窗口方案）
  const [bigScreenOpen, setBigScreenOpen] = useState(false)

  // P3.1 Task 5：大屏模式 BGM 自动触发
  // 进入大屏（按 F）时若 bgm.volume > 0 自动播放 BGM，退出大屏时淡出
  useEffect(() => {
    if (bigScreenOpen) {
      if (bgmSetting.volume > 0) {
        playBgm(bgmSetting.defaultTrack, { loop: true, volume: bgmSetting.volume / 100 })
      }
    } else {
      stopBgm(500)
    }
  }, [bigScreenOpen, bgmSetting, playBgm, stopBgm])
  // 铃声试听弹窗开关
  const [bellPreviewOpen, setBellPreviewOpen] = useState(false)
  // 沉浸模式开关：开启后隐藏控制面板/工具栏/左侧栏，仅保留计时器与核心按钮
  const [immersive, setImmersive] = useState(false)
  // 环节列表试听铃声状态：当前正在试听的环节 index（与 StageCard 一致样式）
  const [previewingStageIdx, setPreviewingStageIdx] = useState<number | null>(null)
  const previewTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  // 顶部「试听全部铃声」状态：与单环节试听独立，互不影响
  const [isPreviewingAll, setIsPreviewingAll] = useState(false)
  const allPreviewTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  // Task 6.7：当前 timer session 关联的多队抽取明细（team_ids 非空时大屏走多队渲染分支）
  const [multiTeamItem, setMultiTeamItem] = useState<DrawSessionItem | null>(null)

  // === 防抖持久化（500ms） ===
  const debouncedPersist = useDebouncedCallback(
    (id: string, opts: Parameters<typeof persistSessionState>[1]) => {
      void persistSessionState(id, opts)
    },
    500
  )

  // === 初始化（带 StrictMode guard，避免开发模式下双调用） ===
  const initedRef = useRef(false)
  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true
    void fetchAllFormats()
    void window.timerAPI.getTheme().then((res) => {
      if (res.success && res.data) setTheme(res.data)
    })
    void fetchSessions()
    // 拉取已上传的自定义背景文件列表
    void window.backgroundAPI.list().then((res) => {
      if (res.success && res.data) setCustomBackgrounds(res.data)
    })
  }, [fetchAllFormats, fetchSessions])

  // P2-43 修复：从 location.state 读取 DrawPage 抽辩题跳转传递的上下文
  // 初始化 affName/negName（若 state 中有值），并保留 ctx 到 ref 供 handleStart 使用
  // 消费后清除 location.state，避免后退/刷新时重复应用
  const drawStateRef = useRef<TimerPageLocationState | null>(null)
  useEffect(() => {
    const state = location.state as TimerPageLocationState | null
    if (!state) return
    drawStateRef.current = state
    if (state.teamAffName) setAffName(state.teamAffName)
    if (state.teamNegName) setNegName(state.teamNegName)
    if (state.eventName) {
      toast.info(`已从抽辩题带入：${state.eventName}${state.topicTitle ? ' · ' + state.topicTitle : ''}`)
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, navigate, location.pathname, toast])

  // 队名变化时同步到 timerStore.matchup（供其他组件/大屏读取）
  // 注意：setMatchup 是 selector 返回的稳定引用，不会触发 effect 重跑
  // P4 修复：队伍 ID 从 drawStateRef 透传，原代码硬编码 null 导致大屏无法关联队伍
  // drawStateRef 是 ref 不触发重渲染，但 affName/negName 由 useEffect 从 drawStateRef
  // 设置，useMemo 运行时 ref 已更新，因此可安全读取
  const matchup: TimerMatchup = useMemo(
    () => ({
      affTeamId: drawStateRef.current?.teamAffId ?? null,
      negTeamId: drawStateRef.current?.teamNegId ?? null,
      affTeamName: affName,
      negTeamName: negName,
      affLogo: null,
      negLogo: null
    }),
    [affName, negName]
  )

  useEffect(() => {
    setMatchup(matchup)
  }, [matchup, setMatchup])

  const selectedFormat = useMemo(
    () => formats.find((f) => f.id === selectedFormatId) ?? null,
    [formats, selectedFormatId]
  )

  const formatSnapshot = selectedFormat?.formatData ?? null

  // === 稳定化 format 引用：未选赛制时用稳定的空对象，避免每次渲染新建导致 engine useCallback 重建 ===
  const stableFormat = useMemo(
    () => formatSnapshot ?? { stages: [], totalDurationMs: 0 },
    [formatSnapshot]
  )

  // === 状态指纹守卫：避免 onStateChange 在状态未变化时重复触发 updateSessionState 导致死循环 ===
  const lastStateFingerprintRef = useRef<string>('')

  const engine = useTimerEngine({
    format: stableFormat,
    callbacks: {
      onBell: (_stageIdx, bell) => {
        playBell(bell)
      },
      onStageEnd: (stageIdx) => {
        toast.info(`环节 ${stageIdx + 1} 结束`)
      },
      onFinish: () => {
        toast.success('全部环节已完成')
      },
      onStateChange: (state) => {
        if (!currentSession) return
        const opts = {
          status: state.status,
          currentStageIndex: state.currentStageIndex,
          currentSide: state.currentSide,
          remainingMs: state.remainingMs,
          stageRemainingCache: state.stageRemainingMsCache ?? null,
          // 持久化自由辩论双方独立时间（修复：原代码遗漏导致会话恢复时双方时间丢失）
          affRemainingMs: state.affRemainingMs ?? null,
          negRemainingMs: state.negRemainingMs ?? null
        }
        // 指纹守卫：若状态未变化则跳过 updateSessionState，避免循环
        const fingerprint = JSON.stringify(opts)
        if (fingerprint === lastStateFingerprintRef.current) return
        lastStateFingerprintRef.current = fingerprint
        // 同步更新内存（UI 立即响应）
        updateSessionState(opts)
        // 防抖持久化到 DB
        void debouncedPersist(currentSession.id, opts)
      }
    }
  })

  const handleStart = useCallback(async () => {
    if (!selectedFormat) {
      toast.warning('请先选择赛制')
      return
    }
    // P2-43 修复：透传 DrawPage 跳转时通过 location.state 传入的抽辩题上下文
    // 包括 eventId/roundId/topicId/teamAffId/teamNegId 等关联字段，以及冗余快照
    const ctx = drawStateRef.current
    const session = await createSession({
      formatId: selectedFormat.id,
      formatSnapshot: selectedFormat.formatData,
      eventId: ctx?.eventId,
      roundId: ctx?.roundId,
      eventName: ctx?.eventName,
      teamAffId: ctx?.teamAffId,
      teamNegId: ctx?.teamNegId,
      topicId: ctx?.topicId,
      topicTitle: ctx?.topicTitle,
      teamAffName: ctx?.teamAffName,
      teamNegName: ctx?.teamNegName
    })
    if (session) {
      // 防止 useEffect([currentSession, engine]) 误调用 restoreState 覆盖 running 状态
      prevSessionIdRef.current = session.id
      engine.start(session.id)
      toast.success('计时开始')
    }
  }, [selectedFormat, createSession, engine, toast])

  const currentStage = formatSnapshot?.stages[engine.state.currentStageIndex]

  // === Task 6.4：铃声试听环节 — 收集所有倒计时环节的铃声（去重 + 倒序） ===
  const bellPreviewBells = useMemo(
    () =>
      currentStage?.isBellPreview && formatSnapshot
        ? collectBellsForPreview(formatSnapshot)
        : [],
    [currentStage, formatSnapshot]
  )

  // === 当前环节进度（用于右栏 Progress 条） ===
  // 已用时间 = 环节时长 - 剩余时长（超时为负值时计入累计，但 Progress 不超过 100%）
  const currentStageTotalMs = currentStage?.durationMs ?? 0
  const currentStageElapsedMs = currentStageTotalMs - engine.state.remainingMs
  const stageProgressPercent = currentStageTotalMs > 0
    ? Math.min(100, Math.max(0, (currentStageElapsedMs / currentStageTotalMs) * 100))
    : 0

  // === 计时器快捷键作用域（小屏，大屏使用独立 timer-bigscreen scope）===
  // P3-18 修复：大屏开启时释放 'timer' scope，避免 scope 栈同时包含 'timer' 和 'timer-bigscreen'。
  // 原实现仅通过 smallScreenEnabled 禁用各 hotkey 的 enabled，但 'timer' scope 仍留在栈中，
  // 导致 scope 栈不清晰。现改为：大屏关闭时 setScope('timer')，大屏开启时不设置（由 BigScreenTimer
  // 设置 timer-bigscreen scope），实现 scope 栈的清晰隔离。
  useEffect(() => {
    if (bigScreenOpen) {
      // 大屏开启：不设置 timer scope（BigScreenTimer 会设置 timer-bigscreen scope）
      return () => {}
    }
    // 大屏关闭：设置 timer scope
    hotkeyManager.setScope('timer')
    return () => hotkeyManager.releaseScope('timer')
  }, [bigScreenOpen])

  // 大屏打开时小屏快捷键全部禁用，避免冲突
  const smallScreenEnabled = !bigScreenOpen

  // === 绑定快捷键（对齐辨之竹，描述与 hotkey-presets.ts 保持一致） ===
  useHotkeys([
    {
      combo: 'space',
      description: '启动/暂停/恢复',
      scope: 'timer',
      handler: () => {
        if (engine.state.status === 'idle') {
          void handleStart()
        } else if (engine.state.status === 'running') {
          // Task 11.1：自由辩论环节 Space 切换发言方（不暂停）
          // Task 7.2：非计时环节 Space 结束当前环节（进入下一环节）
          if (currentStage?.timingMode === 'untimed') {
            engine.finishStage()
          } else if (currentStage?.isFreeDebate) {
            engine.switchSide()
          } else {
            engine.pause()
          }
        } else if (engine.state.status === 'paused') {
          engine.resume()
        }
      },
      enabled: smallScreenEnabled
    },
    {
      combo: 'p',
      description: '中断（结束当前会话）',
      scope: 'timer',
      handler: () => engine.finish(),
      enabled: smallScreenEnabled && (engine.state.status === 'running' || engine.state.status === 'paused')
    },
    {
      combo: 'arrowleft',
      description: '上一环节',
      scope: 'timer',
      handler: () => engine.prevStage(),
      enabled: smallScreenEnabled && engine.state.status !== 'idle'
    },
    {
      combo: 'arrowright',
      description: '下一环节',
      scope: 'timer',
      handler: () => engine.nextStage(),
      enabled: smallScreenEnabled && engine.state.status !== 'idle'
    },
    {
      combo: 'q',
      description: '+30秒',
      scope: 'timer',
      handler: () => engine.addTime(30_000),
      enabled: smallScreenEnabled && (engine.state.status === 'running' || engine.state.status === 'paused')
    },
    {
      combo: 'w',
      description: '+5秒',
      scope: 'timer',
      handler: () => engine.addTime(5_000),
      enabled: smallScreenEnabled && (engine.state.status === 'running' || engine.state.status === 'paused')
    },
    {
      combo: 'e',
      description: '时间到（结束当前环节）',
      scope: 'timer',
      handler: () => engine.finishStage(),
      enabled: smallScreenEnabled && (engine.state.status === 'running' || engine.state.status === 'paused')
    },
    {
      combo: 'f',
      description: '进入大屏',
      scope: 'timer',
      handler: () => setBigScreenOpen(true),
      enabled: smallScreenEnabled
    },
    {
      combo: 's',
      description: '切换发言方（仅自由辩论）',
      scope: 'timer',
      handler: () => {
        if (currentStage?.isFreeDebate) engine.switchSide()
      },
      enabled: smallScreenEnabled && !!currentStage?.isFreeDebate && (engine.state.status === 'running' || engine.state.status === 'paused')
    },
    {
      combo: 'r',
      description: '重置当前环节（二次确认）',
      scope: 'timer',
      handler: () => {
        Modal.confirm({
          title: '重置当前环节？',
          content: `将重置环节「${currentStage?.name ?? '当前'}」的时间，不影响其他环节进度。`,
          okText: '重置',
          cancelText: '取消',
          onOk: () => engine.resetStage()
        })
      },
      enabled: smallScreenEnabled && engine.state.status !== 'idle'
    },
    {
      combo: 'shift+r',
      description: '全重置（清空所有进度，二次确认）',
      scope: 'timer',
      handler: () => {
        Modal.confirm({
          title: '全重置',
          content: '将清空所有环节进度，回到初始状态。',
          okText: '全重置',
          okType: 'danger',
          cancelText: '取消',
          onOk: () => engine.reset()
        })
      },
      enabled: smallScreenEnabled && engine.state.status !== 'idle'
    }
  ])

  // === 监听 currentSession 变化：若 sessionId 变了（loadSession 触发），同步 engine state ===
  const prevSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentSession) return
    if (currentSession.id !== prevSessionIdRef.current) {
      prevSessionIdRef.current = currentSession.id
      // 仅当 engine 当前 sessionId 与 currentSession 不一致时才 restore
      if (engine.state.sessionId !== currentSession.id) {
        engine.restoreState(currentSession)
      }
    }
  }, [currentSession, engine])

  // === Task 6.7：当 currentSession.topicId 变化时，反查 draw_session_items 获取多队明细 ===
  // 若该辩题存在 team_ids 非空的抽取记录，则写入 multiTeamItem 供大屏多队渲染；
  // 否则置 null（大屏回退到 versus 双队渲染分支）。
  useEffect(() => {
    const topicId = currentSession?.topicId
    if (!topicId) {
      setMultiTeamItem(null)
      return
    }
    let cancelled = false
    void window.drawAPI.getItemByTopicId(topicId).then((res) => {
      if (cancelled) return
      if (res.success && res.data && res.data.team_ids && res.data.team_ids.length > 0) {
        setMultiTeamItem(res.data)
      } else {
        setMultiTeamItem(null)
      }
    }).catch(() => {
      if (!cancelled) setMultiTeamItem(null)
    })
    return () => { cancelled = true }
  }, [currentSession?.topicId])

  // === 沉浸模式：按 ESC 退出 ===
  useEffect(() => {
    if (!immersive) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImmersive(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [immersive])

  // === 环节列表试听铃声：卸载时清理所有定时器，避免内存泄漏与状态泄漏 ===
  // 同时清理「试听全部铃声」的定时器
  useEffect(() => {
    return () => {
      previewTimersRef.current.forEach((t) => clearTimeout(t))
      previewTimersRef.current.clear()
      allPreviewTimersRef.current.forEach((t) => clearTimeout(t))
      allPreviewTimersRef.current.clear()
    }
  }, [])

  // 计算宽限期剩余毫秒（remainingMs 为负时，宽限期 = graceMs + remainingMs）
  const graceRemainingMs: number | undefined = useMemo(() => {
    if (!currentStage?.graceMs) return undefined
    if (engine.state.remainingMs >= 0) return undefined
    const remaining = currentStage.graceMs + engine.state.remainingMs
    return remaining > 0 ? remaining : undefined
  }, [currentStage, engine.state.remainingMs])

  // 累计已用时 = 已完成环节时长总和 + 当前环节已用时
  // 当前环节已用时 = 环节时长 - 剩余时长（超时为负，加时为正，均计入累计）
  const accumulatedMs = useMemo(() => {
    if (!formatSnapshot) return 0
    const stages = formatSnapshot.stages
    let acc = 0
    for (let i = 0; i < engine.state.currentStageIndex && i < stages.length; i++) {
      acc += stages[i].durationMs
    }
    if (stages[engine.state.currentStageIndex]) {
      const currentElapsed = stages[engine.state.currentStageIndex].durationMs - engine.state.remainingMs
      acc += Math.max(0, currentElapsed)
    }
    return acc
  }, [formatSnapshot, engine.state.currentStageIndex, engine.state.remainingMs])

  // 大屏入口：组件式覆盖（替代原 window.open 新窗口方案）
  const handleOpenBigScreen = useCallback(() => {
    setBigScreenOpen(true)
  }, [])

  // 背景选择器关闭时刷新自定义背景列表（picker 内可能上传/删除了文件）
  const handleBgPickerClose = useCallback(() => {
    setBgPickerOpen(false)
    void window.backgroundAPI.list().then((res) => {
      if (res.success && res.data) setCustomBackgrounds(res.data)
    })
  }, [])

  // 历史会话点击加载
  const handleLoadHistorySession = useCallback(async (id: string) => {
    const session = await loadSession(id)
    if (session) {
      toast.success(`已加载会话：${session.id.slice(0, 8)}…`)
      setHistoryOpen(false)
    } else {
      toast.error('加载会话失败')
    }
  }, [loadSession, toast])

  // === 环节列表试听铃声：依次播放该环节 bells（按 atMs 升序，间隔约 1 秒） ===
  // 与 StageCard 中的实现保持一致；点击同一环节按钮可停止
  const handlePreviewBells = (stage: StageDef, idx: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (previewingStageIdx === idx) {
      // 停止
      previewTimersRef.current.forEach((t) => clearTimeout(t))
      previewTimersRef.current.clear()
      setPreviewingStageIdx(null)
      return
    }
    if (stage.bells.length === 0) return
    // 停止其他正在播放的
    previewTimersRef.current.forEach((t) => clearTimeout(t))
    previewTimersRef.current.clear()
    setPreviewingStageIdx(idx)
    const sortedBells = [...stage.bells].sort((a, b) => a.atMs - b.atMs)
    sortedBells.forEach((bell, bellIdx) => {
      const timer = setTimeout(() => {
        void playBell(bell)
        previewTimersRef.current.delete(timer)
        if (bellIdx === sortedBells.length - 1) {
          const clearTimer = setTimeout(() => {
            setPreviewingStageIdx(null)
            previewTimersRef.current.delete(clearTimer)
          }, 1000)
          previewTimersRef.current.add(clearTimer)
        }
      }, bellIdx * 1000)
      previewTimersRef.current.add(timer)
    })
  }

  // === 顶部「试听全部铃声」：按 atMs 升序依次播放所有环节的所有铃响点，间隔 1s ===
  // 与单环节试听独立，再次点击停止
  const totalBellsCount = useMemo(() => {
    if (!selectedFormat?.formatData.stages) return 0
    return selectedFormat.formatData.stages.reduce((sum, s) => sum + s.bells.length, 0)
  }, [selectedFormat])

  const handlePreviewAllBells = () => {
    // 再次点击：停止试听
    if (isPreviewingAll) {
      allPreviewTimersRef.current.forEach((t) => clearTimeout(t))
      allPreviewTimersRef.current.clear()
      setIsPreviewingAll(false)
      return
    }
    if (!selectedFormat?.formatData.stages) return
    const allBells: Array<{ stageIdx: number; bell: BellDef }> = []
    selectedFormat.formatData.stages.forEach((stage, idx) => {
      const sorted = [...stage.bells].sort((a, b) => a.atMs - b.atMs)
      sorted.forEach((bell) => allBells.push({ stageIdx: idx, bell }))
    })
    if (allBells.length === 0) return
    setIsPreviewingAll(true)
    // 计算每个铃声的播放时间（按 atMs 升序，环节间间隔 1s）
    let cumMs = 0
    allBells.forEach(({ stageIdx, bell }) => {
      const delay = cumMs
      void stageIdx // stageIdx 仅用于调试/扩展，此处保留以维持结构
      const t = setTimeout(() => {
        void playBell(bell)
      }, delay)
      allPreviewTimersRef.current.add(t)
      cumMs += 1000 // 每个铃声间隔 1s
    })
    // 最后一个 timer 结束后重置状态
    const endTimer = setTimeout(() => {
      setIsPreviewingAll(false)
      allPreviewTimersRef.current.clear()
    }, cumMs + 500)
    allPreviewTimersRef.current.add(endTimer)
  }

  // === 沉浸模式：条件渲染独立视图，隐藏控制面板/工具栏/左侧栏 ===
  // 计时器引擎仍由上方 useTimerEngine 驱动，沉浸视图仅读取 state 与调用 engine 方法
  if (immersive) {
    // 主按钮文案与回调：根据当前状态切换 开始/暂停/恢复
    const primaryText =
      engine.state.status === 'idle' ? '开始'
        : engine.state.status === 'running' ? '暂停'
          : engine.state.status === 'paused' ? '恢复'
            : '已结束'
    const onPrimary =
      engine.state.status === 'idle' ? () => { void handleStart() }
        : engine.state.status === 'running' ? engine.pause
          : engine.state.status === 'paused' ? engine.resume
            : undefined

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          // 沉浸模式背景：复用用户选择的背景，无则回退到深色
          background: backgroundCss || immersiveBg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          color: token.colorTextLightSolid
        }}
      >
        {/* 当前环节名 */}
        <div style={{ color: '#bfbfbf', fontSize: fontSize.h2, marginBottom: spacing.md }}>
          {currentStage?.name ?? '未选择环节'}
        </div>
        {/* Task 7.4：沉浸模式下非计时环节显示"进行中"，倒计时环节显示倒计时 */}
        {currentStage?.timingMode === 'untimed' ? (
          <div
            style={{
              fontSize: '120px',
              fontWeight: 700,
              color: theme?.accentColor ?? token.colorWarning,
              letterSpacing: '0.1em',
              textShadow: shadow.glowWarning
            }}
          >
            进行中
          </div>
        ) : (
          <div
            style={{
              fontSize: '120px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              color:
                engine.state.remainingMs <= 0
                  ? token.colorError
                  : engine.state.remainingMs <= 30 * 1000
                    ? (theme?.accentColor ?? token.colorWarning)
                    : token.colorTextLightSolid,
              // 倒计时大字：正常态无光效，超时态保留红色光效
              textShadow: engine.state.remainingMs <= 0
                ? shadow.glowError
                : 'none'
            }}
          >
            {formatTime(engine.state.remainingMs)}
          </div>
        )}
        {/* 状态提示 */}
        <div style={{ color: '#999', fontSize: fontSize.h4, marginTop: spacing.sm }}>
          {engine.state.status === 'running'
            ? '计时中'
            : engine.state.status === 'paused'
              ? '已暂停'
              : engine.state.status === 'finished'
                ? '已结束'
                : '待开始'}
        </div>
        {/* 4 个核心按钮 */}
        <Space size="large" style={{ marginTop: 48 }}>
          <Button
            size="large"
            type="primary"
            icon={
              engine.state.status === 'running'
                ? <PauseCircleOutlined />
                : <PlayCircleOutlined />
            }
            disabled={onPrimary === undefined}
            onClick={(e) => { e.currentTarget.blur(); onPrimary && onPrimary() }}
          >
            {primaryText}
          </Button>
          <Button
            size="large"
            icon={<ReloadOutlined />}
            onClick={(e) => { e.currentTarget.blur(); engine.resetStage() }}
            disabled={engine.state.status === 'idle'}
          >
            重置
          </Button>
          <Button
            size="large"
            icon={<ForwardOutlined />}
            onClick={(e) => { e.currentTarget.blur(); engine.nextStage() }}
            disabled={engine.state.status === 'idle'}
          >
            下一环节
          </Button>
          <Button
            size="large"
            icon={<CompressOutlined />}
            onClick={(e) => { e.currentTarget.blur(); setImmersive(false) }}
          >
            退出
          </Button>
        </Space>
        {/* 提示：ESC 退出 */}
        <div style={{ color: '#666', fontSize: fontSize.caption, marginTop: spacing.xxxl }}>
          按 ESC 退出沉浸模式
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        ...pageContainerStyle,
        background: backgroundCss,
        minHeight: 'calc(100vh - 56px)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <PageHeader
        title="辩论计时器"
        subtitle="赛制计时与铃声提示"
        style={{ flexShrink: 0, background: 'transparent', color: '#fff' }}
      />

      <Row gutter={spacing.lg} style={{ flex: 1, minHeight: 0, paddingBottom: spacing.xxxl + spacing.xxl }}>
        <Col xs={24} lg={8} style={{ height: '100%', overflowY: 'auto', maxHeight: 'calc(100vh - 56px - 40px - 24px - 80px)', paddingRight: spacing.xs }}>
          {/* 赛制配置 */}
          <Card id="timer-format-config" title="赛制配置" size="small" style={{ marginBottom: spacing.md }}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <FormatSelector
                formats={formats}
                value={selectedFormatId}
                onChange={selectFormat}
                disabled={engine.state.status === 'running' || engine.state.status === 'paused'}
              />
              {selectedFormat && (
                <Alert
                  type="info"
                  showIcon
                  message={selectedFormat.name}
                  description={selectedFormat.description ?? undefined}
                />
              )}
              {/* 顶部「试听全部铃声」显眼入口：未选赛制或无铃响点时禁用 */}
              <Button
                type="default"
                size="middle"
                danger={isPreviewingAll}
                icon={isPreviewingAll ? <StopOutlined /> : <SoundOutlined />}
                onClick={(e) => { e.currentTarget.blur(); handlePreviewAllBells() }}
                disabled={!selectedFormat || totalBellsCount === 0}
                block
              >
                {isPreviewingAll
                  ? '停止试听'
                  : `试听全部铃声 (共 ${totalBellsCount} 个铃响点)`}
              </Button>
              <Input
                placeholder="标签（可选，如：半决赛 第1场）"
                disabled={engine.state.status !== 'idle' && engine.state.status !== 'finished'}
              />
            </Space>
          </Card>

          {/* 对阵信息设置（简化为输入框） */}
          <Card title="对阵信息（可选）" size="small" style={{ marginBottom: spacing.md }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Input
                placeholder="正方队名（留空显示主题默认值）"
                value={affName}
                onChange={(e) => setAffName(e.target.value)}
                prefix={<Tag color="processing">正</Tag>}
              />
              <Input
                placeholder="反方队名（留空显示主题默认值）"
                value={negName}
                onChange={(e) => setNegName(e.target.value)}
                prefix={<Tag color="error">反</Tag>}
              />
              <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                队徽上传可在主题设置中配置；此处仅设置队名展示。
              </Text>
            </Space>
          </Card>

          {/* 环节列表（当前环节高亮：左侧色条 + 浅色背景 + 字重加粗） */}
          <Card title="环节列表" size="small" style={{ marginBottom: spacing.md }}>
            {!formatSnapshot ? (
              <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                请先选择赛制
              </Text>
            ) : (
              <List
                size="small"
                split={false}
                dataSource={formatSnapshot.stages}
                renderItem={(stage, idx) => {
                  const isCurrent = idx === engine.state.currentStageIndex
                  const isPast = idx < engine.state.currentStageIndex
                  return (
                    <List.Item
                      style={{
                        position: 'relative',
                        paddingLeft: spacing.md,
                        paddingRight: spacing.sm,
                        paddingTop: spacing.sm,
                        paddingBottom: spacing.sm,
                        marginBottom: spacing.xs,
                        borderRadius: radius.md,
                        background: isCurrent ? `${colorPurple}15` : 'transparent',
                        borderLeft: isCurrent
                          ? `4px solid ${colorPurple}`
                          : '4px solid transparent',
                        fontWeight: isCurrent ? 600 : 400,
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <Space direction="vertical" size={0} style={{ width: '100%' }}>
                            <Space size={4}>
                              <Text strong={isCurrent} style={{ fontSize: fontSize.body }}>
                                {idx + 1}. {stage.name}
                              </Text>
                              {stage.isFreeDebate && <Tag color="purple" style={{ marginInlineStart: 0 }}>自由</Tag>}
                            </Space>
                            <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                              {stage.timingMode === 'untimed'
                                ? '不计时'
                                : `${Math.floor(stage.durationMs / 60000)}分${Math.floor((stage.durationMs % 60000) / 1000)}秒`}
                              {isPast ? ' · 已完成' : isCurrent ? ' · 进行中' : ''}
                            </Text>
                          </Space>
                        </div>
                        <Tooltip title={stage.bells.length === 0 ? '请先添加铃响点' : (previewingStageIdx === idx ? '停止试听' : '试听铃声')}>
                          <Button
                            type="default"
                            size="small"
                            danger={previewingStageIdx === idx}
                            icon={previewingStageIdx === idx ? <StopOutlined /> : <SoundOutlined />}
                            onClick={(e) => handlePreviewBells(stage, idx, e)}
                            disabled={stage.bells.length === 0}
                          >
                            {previewingStageIdx === idx ? '停止' : '试听'}
                          </Button>
                        </Tooltip>
                      </div>
                    </List.Item>
                  )
                }}
              />
            )}
          </Card>

          {/* 控制 */}
          <Card
            title="控制"
            size="small"
          >
            <Space wrap>
              {engine.state.status === 'idle' && (
                <KbdHint kbd="Space" description="启动/暂停/恢复">
                  <Button type="primary" className="btn-press" icon={<PlayCircleOutlined />} onClick={(e) => { e.currentTarget.blur(); void handleStart() }} disabled={!selectedFormat}>
                    开始计时
                  </Button>
                </KbdHint>
              )}
              {engine.state.status === 'running' && (
                <KbdHint kbd="Space" description="启动/暂停/恢复">
                  <Button className="btn-press" icon={<PauseCircleOutlined />} onClick={(e) => { e.currentTarget.blur(); engine.pause() }}>暂停</Button>
                </KbdHint>
              )}
              {engine.state.status === 'paused' && (
                <KbdHint kbd="Space" description="启动/暂停/恢复">
                  <Button type="primary" className="btn-press" icon={<PlayCircleOutlined />} onClick={(e) => { e.currentTarget.blur(); engine.resume() }}>恢复</Button>
                </KbdHint>
              )}
              <KbdHint kbd="←" description="上一环节">
                <Button icon={<BackwardOutlined />} onClick={(e) => { e.currentTarget.blur(); engine.prevStage() }} disabled={engine.state.status === 'idle'}>上一环节</Button>
              </KbdHint>
              <KbdHint kbd="→" description="下一环节">
                <Button icon={<ForwardOutlined />} onClick={(e) => { e.currentTarget.blur(); engine.nextStage() }} disabled={engine.state.status === 'idle'}>下一环节</Button>
              </KbdHint>
              <KbdHint kbd="Q" description="+30秒">
                <Button icon={<PlusCircleOutlined />} onClick={(e) => { e.currentTarget.blur(); engine.addTime(30 * 1000) }} disabled={engine.state.status === 'idle'}>30秒</Button>
              </KbdHint>
              <KbdHint kbd="W" description="+5秒">
                <Button icon={<PlusCircleOutlined />} onClick={(e) => { e.currentTarget.blur(); engine.addTime(5 * 1000) }} disabled={engine.state.status === 'idle'}>5秒</Button>
              </KbdHint>
              <KbdHint kbd="E" description="时间到">
                <Button icon={<StopOutlined />} onClick={(e) => { e.currentTarget.blur(); engine.finishStage() }} disabled={engine.state.status === 'idle' || engine.state.status === 'finished'}>时间到</Button>
              </KbdHint>
              {(engine.state.status === 'running' || engine.state.status === 'paused') && (
                <KbdHint kbd="P" description="中断">
                  <Button danger icon={<StopOutlined />} onClick={(e) => { e.currentTarget.blur(); engine.finish() }}>结束</Button>
                </KbdHint>
              )}
              <KbdHint kbd="R" description="重置当前环节">
                <Button icon={<ReloadOutlined />} onClick={(e) => { e.currentTarget.blur(); engine.resetStage() }} disabled={engine.state.status === 'idle'}>重置环节</Button>
              </KbdHint>
              <KbdHint kbd="Shift+R" description="全重置">
                <Popconfirm
                  title="重置全场"
                  description="将清空所有进度，回到第0环节。确定继续？"
                  onConfirm={engine.reset}
                  okText="确定"
                  cancelText="取消"
                >
                  <Button danger icon={<StopOutlined />}>重置全场</Button>
                </Popconfirm>
              </KbdHint>
              {/* 自由辩论发言方切换 */}
              {currentStage?.isFreeDebate && (engine.state.status === 'running' || engine.state.status === 'paused') && (
                <KbdHint kbd="S" description="切换发言方">
                  <Button
                    icon={<SwapOutlined />}
                    onClick={(e) => { e.currentTarget.blur(); engine.switchSide() }}
                    type="dashed"
                  >
                    切换发言方（当前：
                    {engine.state.currentSide === 'aff' ? '正方' : '反方'}）
                  </Button>
                </KbdHint>
              )}
            </Space>
            {currentStage?.isFreeDebate && engine.state.status !== 'idle' && engine.state.status !== 'finished' && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: spacing.sm }}
                message="自由辩论环节"
                description="点击「切换发言方」按钮或使用快捷键在正反方之间切换。"
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16} style={{ height: '100%', overflowY: 'auto', maxHeight: 'calc(100vh - 56px - 40px - 24px - 80px)', paddingRight: spacing.xs }}>
          <AccentCard title="计时器" size="small">
            {!formatSnapshot ? (
              <EmptyState
                type="timer"
                description="请先选择赛制"
                cta={[
                  {
                    text: '选择赛制',
                    onClick: () => {
                      document
                        .getElementById('timer-format-config')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  },
                  {
                    text: '去赛制编辑器',
                    onClick: () => navigate('/format-editor')
                  }
                ]}
              />
            ) : (
              <>
                {/* 当前环节名称（大号字体，居中） */}
                <div style={{ textAlign: 'center', marginBottom: spacing.md, padding: `${spacing.sm} 0` }}>
                  <Title level={1} style={{ margin: 0, fontSize: fontSize.h1, color: colorPurple, fontWeight: 700 }}>
                    {currentStage?.name ?? '未选择环节'}
                  </Title>
                </div>

                {/* Task 6.4：铃声试听环节 — 渲染 BellPreviewStage 替代普通 untimed 界面 */}
                {currentStage?.isBellPreview ? (
                  <div style={{ padding: `${spacing.sm} 0` }}>
                    <Text
                      type="secondary"
                      style={{
                        display: 'block',
                        textAlign: 'center',
                        marginBottom: spacing.sm,
                        fontSize: fontSize.caption
                      }}
                    >
                      非计时环节 · 按 Space 结束此环节
                    </Text>
                    <BellPreviewStage bells={bellPreviewBells} />
                  </div>
                ) : currentStage?.timingMode === 'untimed' ? (
                  <div style={{ textAlign: 'center', padding: `${spacing.xl} ${spacing.md}` }}>
                    <div
                      style={{
                        fontSize: 96,
                        fontWeight: 700,
                        color: colorPurple,
                        letterSpacing: '0.1em',
                        lineHeight: 1.2
                      }}
                    >
                      进行中
                    </div>
                    <Text type="secondary" style={{ display: 'block', marginTop: spacing.md, fontSize: fontSize.h4 }}>
                      非计时环节 · 按 Space 或「时间到」结束
                    </Text>
                    <Text type="secondary" style={{ display: 'block', marginTop: spacing.sm, fontSize: fontSize.caption }}>
                      状态：
                      {engine.state.status === 'running'
                        ? '进行中'
                        : engine.state.status === 'paused'
                          ? '已暂停'
                          : engine.state.status === 'finished'
                            ? '已结束'
                            : '待开始'}
                    </Text>
                  </div>
                ) : (
                  <>
                    {/* 双方对阵卡片 + 倒计时（TimerDisplay 内置：左队 vs 右队 + VS 标识） */}
                    <TimerDisplay
                      state={engine.state}
                      stageName={currentStage?.name ?? ''}
                      theme={theme}
                      matchup={matchup}
                      graceRemainingMs={graceRemainingMs}
                      isFreeDebate={!!currentStage?.isFreeDebate}
                    />

                    {/* 进度条：当前环节已用时间 / 总时间 */}
                    <div style={{ marginTop: spacing.lg, padding: `0 ${spacing.lg}` }}>
                      <Progress
                        percent={stageProgressPercent}
                        strokeColor={colorPurple}
                        strokeWidth={10}
                        format={() => (
                          <span style={{ fontSize: fontSize.caption, color: token.colorTextSecondary }}>
                            {formatTime(Math.max(0, currentStageElapsedMs))} / {formatTime(currentStageTotalMs)}
                          </span>
                        )}
                      />
                    </div>

                    {/* Task 11：自由辩论双进度条 — 计时器下方，环节列表上方 */}
                    {currentStage?.isFreeDebate && (
                      <FreeDebateProgressBar
                        proRemainingMs={engine.state.affRemainingMs ?? engine.state.remainingMs}
                        conRemainingMs={engine.state.negRemainingMs ?? engine.state.remainingMs}
                        totalMs={currentStage.durationMs}
                        activeSide={engine.state.currentSide}
                      />
                    )}
                  </>
                )}

                {/* 环节进度 Steps */}
                <div style={{ marginTop: spacing.lg }}>
                  <StageProgress
                    format={formatSnapshot}
                    currentIndex={engine.state.currentStageIndex}
                    status={engine.state.status}
                  />
                </div>
              </>
            )}
          </AccentCard>
        </Col>
      </Row>

      {/* 底部浮动毛玻璃工具栏 */}
      <div
        style={{
          position: 'fixed',
          bottom: spacing.xl,
          left: '50%',
          transform: 'translateX(-50%)',
          ...stickyBg,
          borderRadius: radius.xl,
          boxShadow: shadow.xl,
          padding: `${spacing.md} ${spacing.xl}`,
          display: 'flex',
          alignItems: 'center',
          gap: spacing.md,
          zIndex: 100,
          border: '1px solid rgba(255, 255, 255, 0.6)'
        }}
      >
        <Button icon={<HistoryOutlined />} onClick={(e) => { e.currentTarget.blur(); setHistoryOpen(true) }}>历史</Button>
        <Button icon={<PictureOutlined />} onClick={(e) => { e.currentTarget.blur(); setBgPickerOpen(true) }}>背景</Button>
        <Button icon={<BellOutlined />} onClick={(e) => { e.currentTarget.blur(); setBellPreviewOpen(true) }}>铃声</Button>
        <KbdHint kbd="F" description="进入大屏">
          <Button icon={<FullscreenOutlined />} onClick={(e) => { e.currentTarget.blur(); handleOpenBigScreen() }}>大屏</Button>
        </KbdHint>
        <Button icon={<ExpandOutlined />} onClick={(e) => { e.currentTarget.blur(); setImmersive(true) }}>沉浸</Button>
      </div>

      {/* Task 20：历史会话 Drawer（响应式宽度：移动端 100%，桌面端 640） */}
      <Drawer
        title="历史计时会话"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={isMobile ? '100%' : 640}
        destroyOnHidden
      >
        <List
          size="small"
          loading={sessionsLoading}
          dataSource={sessions}
          locale={{ emptyText: '暂无历史会话' }}
          renderItem={(session) => (
            <List.Item
              actions={[
                <Button
                  size="small"
                  type="link"
                  onClick={(e) => { e.currentTarget.blur(); void handleLoadHistorySession(session.id) }}
                >
                  加载
                </Button>
              ]}
            >
              <List.Item.Meta
                title={session.label ?? `会话 ${session.id.slice(0, 8)}…`}
                description={
                  <Space size="small" wrap>
                    <Tag color={session.status === 'finished' ? 'green' : session.status === 'running' ? 'blue' : 'default'}>
                      {session.status === 'running' ? '进行中' : session.status === 'paused' ? '已暂停' : session.status === 'finished' ? '已结束' : '空闲'}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                      环节 {session.currentStageIndex + 1}
                    </Text>
                    {session.startedAt && (
                      <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                        开始：{new Date(session.startedAt).toLocaleString()}
                      </Text>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Drawer>

      {/* 大屏覆盖层（组件式，替代新窗口方案，共享同一个 engine 实例）*/}
      {bigScreenOpen && (
        <BigScreenTimer
          state={engine.state}
          stageName={currentStage?.name ?? ''}
          theme={theme}
          matchup={matchup}
          format={stableFormat}
          graceRemainingMs={graceRemainingMs}
          onClose={() => setBigScreenOpen(false)}
          onStart={() => { void handleStart() }}
          onPause={engine.pause}
          onResume={engine.resume}
          onPrevStage={engine.prevStage}
          onNextStage={engine.nextStage}
          onAddTime={engine.addTime}
          onSwitchSide={engine.switchSide}
          onFinishStage={engine.finishStage}
          onFinish={engine.finish}
          isFreeDebate={currentStage?.isFreeDebate ?? false}
          currentStageNumber={engine.state.currentStageIndex + 1}
          totalStages={stableFormat.stages.length}
          accumulatedMs={accumulatedMs}
          multiTeamItem={multiTeamItem}
        />
      )}

      {/* 背景选择器弹窗 */}
      <TimerBackgroundPicker open={bgPickerOpen} onClose={handleBgPickerClose} />

      {/* 铃声试听弹窗 */}
      <BellPreviewModal
        open={bellPreviewOpen}
        onClose={() => setBellPreviewOpen(false)}
        format={selectedFormat}
      />
    </div>
  )
}
