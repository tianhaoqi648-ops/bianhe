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
import { Card, Button, Space, Input, Typography, Alert, Row, Col, Modal, Drawer, List, Tag, Popconfirm, Progress, Tooltip, Select, theme as antdTheme } from 'antd'
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
  SoundOutlined,
  AudioOutlined
} from '@ant-design/icons'
import { useFormatStore } from '../stores/formatStore'
import { useTimerStore } from '../stores/timerStore'
import { useSettingsStore, getTimerBackgroundSetting, getBgmSetting, getTimeoutTtsSetting } from '../stores/settingsStore'
import type { TimerMatchup } from '../stores/timerStore'
import { useTimerEngine } from '../utils/useTimerEngine'
import { buildTimeoutSpeech, speakTimeout } from '../utils/timeout-tts'
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
import { useTimerRecorder } from '../utils/useTimerRecorder'
import { useWavRecorder } from '../utils/useWavRecorder'
import {
  buildMarker,
  buildWholeMeta,
  buildSplitMeta,
  buildRecordingFileName,
  resolveSegmentMode,
  resolveRecordingFormat,
  RECORDING_SEGMENT_KEY,
  RECORDING_FORMAT_KEY,
  type RecordingFormat
} from '../../../shared/match-recording'
import { resolveBackgroundCss } from '../../../shared/timer-backgrounds'
import type { TimerTheme, BackgroundFile, DrawSessionItem, MatchRecordingMarker, Event as SharedEvent, Round as SharedRound, Match as SharedMatch, DebateFormat } from '../../../shared/types'
import type { StageDef, BellDef, StageSide } from '../../../shared/debate-formats/types'

/**
 * P2-43 修复：DrawPage → TimerPage 跳转上下文
 * 抽辩题完成后通过 location.state 传递抽取结果，TimerPage 在创建计时会话时
 * 透传给 timerAPI.createSession，并初始化 matchup 队名展示
 */
export interface TimerPageLocationState {
  sessionId?: string
  eventId?: string
  roundId?: string
  matchId?: string
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

// === T6.1 赛事·轮次·场次绑定的内部特殊轮次选项 ===
const ROUND_ALL = '__all'
const ROUND_NONE = '__none'
function roundOptionLabel(r: SharedRound): string {
  return r.name?.trim() || (r.round_number != null ? `第${r.round_number}轮` : '未命名轮次')
}

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
  // P2-8：超时语音警告设置（enabled / volume）
  const timeoutTts = useMemo(
    () => getTimeoutTtsSetting(settings),
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
  // 历史会话加载时覆盖当前赛制显示：兼容 formatId 不在当前格式列表中的会话快照
  const [historyFormat, setHistoryFormat] = useState<DebateFormat | null>(null)
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
  // 关联的比赛 id（从跳转上下文取得；录音结束据此写回 matches.recording_meta）
  const matchIdRef = useRef<string | null>(null)
  useEffect(() => {
    const state = location.state as TimerPageLocationState | null
    if (!state) return
    drawStateRef.current = state
    matchIdRef.current = state.matchId ?? null
    if (state.matchId) setBoundBanner(state)
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
    () => historyFormat ?? (formats.find((f) => f.id === selectedFormatId) ?? null),
    [historyFormat, formats, selectedFormatId]
  )

  const formatSnapshot = selectedFormat?.formatData ?? null

  // === 稳定化 format 引用：未选赛制时用稳定的空对象，避免每次渲染新建导致 engine useCallback 重建 ===
  const stableFormat = useMemo(
    () => formatSnapshot ?? { stages: [], totalDurationMs: 0 },
    [formatSnapshot]
  )

  // === 状态指纹守卫：避免 onStateChange 在状态未变化时重复触发 updateSessionState 导致死循环 ===
  const lastStateFingerprintRef = useRef<string>('')

  // ============================================================
  // 计时录音（T2）：环节/发言人标记 + 可选分段 + 落盘写回 match
  // ============================================================
  // T7.3：按「录音格式」选择实现。两个 recorder hook 无条件挂载（hook 规则），
  // 运行期经 activeRecorder 由 recFormatRef 选其一做 start/stop。
  const webmRecorder = useTimerRecorder()
  const wavRecorder = useWavRecorder()
  // 当前录音格式（开始录音时读取 settings recording.format，缺失默认 'wav'）
  const recFormatRef = useRef<RecordingFormat>('wav')
  const recorder = recFormatRef.current === 'wav' ? wavRecorder : webmRecorder
  // 用户是否处于"录音会话"（start 后到 stop 前恒为 true；split 期间切换分片保持 true）
  const recSessionRef = useRef(false)
  const [recOn, setRecOn] = useState(false)
  // 分段模式（开始录音时读取设置）
  const recSegmentModeRef = useRef<'whole' | 'split'>('whole')
  // 录音会话起点（标记 tsMs 用；split 全程不重置，保证时间线连续）
  const recSessionStartMsRef = useRef(0)
  // 当前音轨是否在采集中（MediaRecorder active）
  const recTapeActiveRef = useRef(false)
  // 环节标记缓冲（whole/split 共用；split 时各标记附带分片 filePath）
  const markersRef = useRef<MatchRecordingMarker[]>([])
  // split 切换分片的并发/再入保护
  const recSwitchingRef = useRef(false)

  // ---- 开始录音会话 ----
  const startRecordingSession = async () => {
    if (recSessionRef.current) return
    recSessionRef.current = true
    markersRef.current = []
    recSwitchingRef.current = false
    let mode: 'whole' | 'split' = 'whole'
    try {
      const res = await window.settingsAPI.get(RECORDING_SEGMENT_KEY)
      if (res.success) mode = resolveSegmentMode(res.data)
    } catch {
      /* 默认 whole */
    }
    recSegmentModeRef.current = mode
    // T7.3：开始录音时读取当前录音格式（缺失默认 'wav'），本次会话固定该格式
    try {
      const fRes = await window.settingsAPI.get(RECORDING_FORMAT_KEY)
      recFormatRef.current = fRes.success ? resolveRecordingFormat(fRes.data) : 'wav'
    } catch {
      recFormatRef.current = 'wav'
    }
    // T7.3/T7-m4a：按格式选实现；m4a 走 MediaRecorder audio/mp4，wav 走 Web Audio
    const fmt = recFormatRef.current
    let ok: boolean
    if (fmt === 'wav') {
      ok = await wavRecorder.start()
    } else {
      ok = await webmRecorder.start(fmt === 'm4a' ? 'm4a' : 'webm')
    }
    recTapeActiveRef.current = ok
    if (!ok) {
      recSessionRef.current = false
      toast.error(fmt === 'wav' ? (wavRecorder.error || '无法开始录音（请检查麦克风权限）') : (webmRecorder.error || '无法开始录音（请检查麦克风权限）'))
      return
    }
    recSessionStartMsRef.current = Date.now()
    setRecOn(true)
    // 若计时已在某环节进行中，为当前环节立即打一条初始标记
    const curStage = stableFormat.stages[engine.state.currentStageIndex]
    if (curStage && engine.state.status !== 'idle') {
      markersRef.current.push(buildMarker(curStage, 0))
    }
    toast.info(`开始录音（${mode === 'split' ? '按环节分段' : '整场一轨'}）`)
  }

  // ---- 停止录音会话（取回音频、落盘、写回 match） ----
  const stopRecordingSession = async () => {
    recSessionRef.current = false
    setRecOn(false)
    const matchId = matchIdRef.current
    const markers = markersRef.current
    const isSplit = recSegmentModeRef.current === 'split'

    // 取回当前音轨（split 时最后一段也在这里落库）
    const out = await recorder.stop()
    recTapeActiveRef.current = false
    if (!out) {
      toast.error('未取回录音数据')
      return
    }

    try {
      if (!isSplit) {
        // 整场一轨：一次性落盘
        const fileName = buildRecordingFileName(matchId ?? undefined, Date.now(), out.mimeType, undefined, recFormatRef.current)
        const saved = await window.recordingAPI.save(fileName, out.data)
        if (!saved.success || !saved.data?.ok || !saved.data.path) {
          toast.error(saved.data?.message || saved.error || '录音保存失败')
          return
        }
        const meta = buildWholeMeta(saved.data.path, markers)
        if (matchId) {
          await window.matchAPI.update(matchId, { recordingMeta: meta, recordingRef: saved.data.path })
        } else {
          toast.success('录音已保存（未关联比赛）')
          return
        }
        toast.success('录音已保存并关联本场')
        return
      }

      // 按环节分段：当前音轨归属最近一个标记的环节
      let list = markers
      let target = list[list.length - 1]
      if (!target) {
        // 从未进入环节（录音中途无环节切换）：用当前环节兜底补一条标记
        const stage = stableFormat.stages[engine.state.currentStageIndex]
        if (stage) {
          const m = buildMarker(stage, Date.now() - recSessionStartMsRef.current)
          list = [...list, m]
          markersRef.current = list
          target = m
        }
      }
      if (target) {
        const segName = buildRecordingFileName(matchId ?? undefined, Date.now(), out.mimeType, target.stageId, recFormatRef.current)
        const saved = await window.recordingAPI.save(segName, out.data)
        if (saved.success && saved.data?.ok && saved.data.path) {
          target.filePath = saved.data.path
        }
      }
      const meta = buildSplitMeta(list)
      if (matchId) {
        await window.matchAPI.update(matchId, { recordingMeta: meta, recordingRef: meta.filePath || null })
      }
      toast.success(matchId ? '录音分片已保存并关联本场' : '录音分片已保存（未关联比赛）')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '录音保存失败')
    }
  }

  // ---- 录音开关（开始/停止） ----
  const handleToggleRecording = async () => {
    if (recSessionRef.current) await stopRecordingSession()
    else await startRecordingSession()
  }

  // ---- 进入新环节：追加环节/发言人标记（split 时按环节切分音轨） ----
  const handleStageEnter = async (stageIndex: number) => {
    if (!recSessionRef.current) return
    const stage = stableFormat.stages[stageIndex]
    if (!stage) return
    const tsMs = Date.now() - recSessionStartMsRef.current
    const marker = buildMarker(stage, tsMs)
    if (recSegmentModeRef.current === 'split' && !recSwitchingRef.current && recTapeActiveRef.current) {
      // 把当前音轨存为"上一环节"的分片，再启动本环节新音轨
      recSwitchingRef.current = true
      try {
        const prevMarker = markersRef.current[markersRef.current.length - 1]
        const out = await recorder.stop()
        recTapeActiveRef.current = false
        if (out && prevMarker) {
          const segName = buildRecordingFileName(matchIdRef.current ?? undefined, Date.now(), out.mimeType, prevMarker.stageId, recFormatRef.current)
          const saved = await window.recordingAPI.save(segName, out.data)
          if (saved.success && saved.data?.ok && saved.data.path) {
            prevMarker.filePath = saved.data.path
          }
        }
        const segFmt = recFormatRef.current
        let ok: boolean
        if (segFmt === 'wav') {
          ok = await wavRecorder.start()
        } else {
          ok = await webmRecorder.start(segFmt === 'm4a' ? 'm4a' : 'webm')
        }
        recTapeActiveRef.current = ok
      } finally {
        recSwitchingRef.current = false
      }
    }
    markersRef.current.push(marker)
  }

  // P2-8：镜像引擎 currentSide，供 onBell 闭包读取最新发言方（避免 TDZ/闭包过期）
  const timerSideRef = useRef<string | null>(null)

  const engine = useTimerEngine({
    format: stableFormat,
    callbacks: {
      onBell: (stageIdx, bell) => {
        void playBell(bell)
        // P2-8：到点 / 某方超时本地语音播报
        if (bell.atMs === 0 && timeoutTts.enabled) {
          const stage = stableFormat.stages[stageIdx]
          const msg = buildTimeoutSpeech(
            stage?.side as StageSide | undefined,
            timerSideRef.current as StageSide | undefined
          )
          speakTimeout(msg, timeoutTts.volume)
        }
      },
      onStageStart: (stageIdx) => {
        void handleStageEnter(stageIdx)
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
          negRemainingMs: state.negRemainingMs ?? null,
          // 持久化每队总时长池剩余
          affPoolRemainingMs: state.affPoolRemainingMs ?? null,
          negPoolRemainingMs: state.negPoolRemainingMs ?? null,
          // 持久化自由辩论发言次数
          affSpeechCount: state.affSpeechCount ?? null,
          negSpeechCount: state.negSpeechCount ?? null
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
  // 每帧同步最新发言方到 ref（供 onBell 内 TTS 播报读取）
  timerSideRef.current = engine.state.currentSide

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
      matchId: ctx?.matchId,
      eventName: ctx?.eventName,
      teamAffId: ctx?.teamAffId,
      teamNegId: ctx?.teamNegId,
      topicId: ctx?.topicId,
      topicTitle: ctx?.topicTitle,
      teamAffName: ctx?.teamAffName,
      teamNegName: ctx?.teamNegName
    })
    if (session) {
      // 从赛事「比赛」启动计时：把会话与比赛双向关联（matches.session_id ←→ timer_sessions.match_id）
      if (ctx?.matchId) {
        void window.matchAPI.linkSession(ctx.matchId, session.id)
      }
      // 防止 useEffect([currentSession, engine]) 误调用 restoreState 覆盖 running 状态
      prevSessionIdRef.current = session.id
      engine.start(session.id)
      toast.success('计时开始')
    }
  }, [selectedFormat, createSession, engine, toast])

  // === T6.1 计时器「赛事 → 轮次 → 场次」绑定（路由未带 matchId 时可用） ===
  // 路由自带 matchId（从赛事「启动计时」进入）时显示当前场次提示，而非选择器
  const [boundBanner, setBoundBanner] = useState<TimerPageLocationState | null>(null)
  const [boundEvents, setBoundEvents] = useState<SharedEvent[]>([])
  const [boundRounds, setBoundRounds] = useState<SharedRound[]>([])
  const [boundMatches, setBoundMatches] = useState<SharedMatch[]>([])
  const [selEventId, setSelEventId] = useState<string>()
  const [selRoundId, setSelRoundId] = useState<string>()
  const [selMatchId, setSelMatchId] = useState<string>()
  const [boundLoading, setBoundLoading] = useState(false)

  const adjustableMatches = useMemo(
    () => boundMatches.filter((m) => m.status !== 'resulted'),
    [boundMatches]
  )
  const visibleMatches = useMemo(() => {
    if (!selEventId) return []
    if (!selRoundId || selRoundId === ROUND_ALL) return adjustableMatches
    if (selRoundId === ROUND_NONE) return adjustableMatches.filter((m) => !m.roundId)
    return adjustableMatches.filter((m) => m.roundId === selRoundId)
  }, [selEventId, selRoundId, adjustableMatches])

  const loadBoundEvents = useCallback(async () => {
    try {
      const res = await window.eventAPI.listEvents({ pageSize: 1000 })
      if (res.success && res.data) setBoundEvents(res.data.items)
    } catch {
      /* 忽略加载失败 */
    }
  }, [])

  useEffect(() => {
    void loadBoundEvents()
  }, [loadBoundEvents])

  const handleBoundEventChange = async (eventId: string) => {
    setSelEventId(eventId || undefined)
    setSelRoundId(undefined)
    setSelMatchId(undefined)
    setBoundRounds([])
    setBoundMatches([])
    if (!eventId) return
    setBoundLoading(true)
    try {
      const [roundsRes, matchesRes] = await Promise.all([
        window.eventAPI.listRoundsByEvent(eventId),
        window.matchAPI.listByEvent(eventId)
      ])
      if (roundsRes.success) setBoundRounds(roundsRes.data ?? [])
      if (matchesRes.success) setBoundMatches(matchesRes.data ?? [])
    } finally {
      setBoundLoading(false)
    }
  }

  const handleBoundRoundChange = (roundId: string) => {
    setSelRoundId(roundId)
    setSelMatchId(undefined)
  }

  // 选中场次后写入本地上下文 ref：matchIdRef 供录音写回 / startSession 关联
  const handleBindMatch = (matchId: string) => {
    const m = boundMatches.find((x) => x.id === matchId)
    if (!m) return
    setSelMatchId(matchId)
    matchIdRef.current = m.id
    // 把该场 eventId/roundId/topicId 等写入 drawStateRef，供 handleStart(startSession) 透传
    drawStateRef.current = {
      ...(drawStateRef.current ?? {}),
      eventId: m.eventId,
      roundId: m.roundId ?? undefined,
      matchId: m.id,
      topicId: m.topicId ?? undefined,
      eventName: m.eventName ?? undefined,
      teamAffName: m.teamAffName ?? undefined,
      teamNegName: m.teamNegName ?? undefined
    }
    if (m.teamAffName) setAffName(m.teamAffName)
    if (m.teamNegName) setNegName(m.teamNegName)
    toast.success(`已绑定比赛：${m.teamAffName ?? '正方'} vs ${m.teamNegName ?? '反方'}`)
  }

  const handleUnbindMatch = () => {
    setSelMatchId(undefined)
    matchIdRef.current = null
    setAffName('')
    setNegName('')
    if (drawStateRef.current) {
      const { eventId, roundId, matchId, topicId, eventName, teamAffName, teamNegName, ...rest } = drawStateRef.current
      drawStateRef.current = { ...rest } as TimerPageLocationState
    }
  }

  const currentStage = formatSnapshot?.stages[engine.state.currentStageIndex]

  // === 每队总时长池（后手）：带 teamPoolMinutes 的赛制展示双方池剩余，pool 环节高亮扣除方 ===
  const hasTeamPool = !!formatSnapshot?.teamPoolMinutes
  const currentPoolTeam = hasTeamPool && currentStage?.poolTeam ? currentStage.poolTeam : null

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

  // 历史会话点击加载 → 断点续计：联动赛制/对阵/环节/剩余恢复
  const handleLoadHistorySession = useCallback(async (id: string) => {
    const doLoad = async () => {
      // 加载前清理当前运行上下文，避免与目标会话串扰
      if (recSessionRef.current) await stopRecordingSession()
      if (engine.state.status === 'running') engine.pause()

      const session = await loadSession(id)
      if (!session) {
        toast.error('加载会话失败')
        return
      }
      // 1) 切赛制：优先用格式列表中的真实赛制；否则用会话快照合成（保证主区/倒计时口径 = 该会话）
      const matched = formats.find((f) => f.id === session.formatId)
      if (matched) {
        selectFormat(matched.id)
        setHistoryFormat(null)
      } else {
        selectFormat(null)
        setHistoryFormat({
          id: session.formatId ?? session.id,
          name: session.label ?? `${session.formatSnapshot?.stages.length ?? 0} 环节赛制`,
          description: null,
          isPreset: false,
          formatData: session.formatSnapshot,
          createdAt: session.createdAt,
          updatedAt: session.createdAt
        })
      }
      // 2) 回填对阵/辩题（优先用会话冗余快照）
      if (session.teamAffName) setAffName(session.teamAffName)
      if (session.teamNegName) setNegName(session.teamNegName)
      drawStateRef.current = {
        ...(drawStateRef.current ?? {}),
        eventId: session.eventId ?? undefined,
        roundId: session.roundId ?? undefined,
        matchId: session.matchId ?? undefined,
        topicId: session.topicId ?? undefined,
        eventName: session.eventName ?? undefined,
        teamAffId: session.teamAffId ?? undefined,
        teamNegId: session.teamNegId ?? undefined,
        teamAffName: session.teamAffName ?? undefined,
        teamNegName: session.teamNegName ?? undefined,
        topicTitle: session.topicTitle ?? undefined
      }
      // 3) 恢复断点：由下方 useEffect([currentSession, engine]) 统一调用 engine.restoreState
      // 4) 反馈 + 关抽屉
      const stageCount = session.formatSnapshot?.stages.length ?? 0
      const fmtName = matched?.name ?? `${stageCount} 环节`
      const remain = session.remainingMs ?? session.formatSnapshot?.stages[session.currentStageIndex]?.durationMs ?? 0
      toast.success(`已恢复：${fmtName} · 环节 ${session.currentStageIndex + 1} · 剩余 ${formatTime(Math.max(0, remain))}`)
      setHistoryOpen(false)
    }

    if (engine.state.status === 'running' || recSessionRef.current) {
      Modal.confirm({
        title: '切换历史会话',
        content: '当前计时/录音进行中，加载历史将切换到所选会话。确定继续？',
        okText: '继续加载',
        cancelText: '取消',
        onOk: () => void doLoad()
      })
    } else {
      void doLoad()
    }
  }, [loadSession, toast, engine, formats, selectFormat, stopRecordingSession])

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

          {/* T6.1 赛事·轮次·场次绑定：路由未带 matchId 时显示选择器，已带入则展示当前场次 */}
          {boundBanner?.matchId ? (
            <Card title="当前场次" size="small" style={{ marginBottom: spacing.md }}>
              <Text>
                {boundBanner.teamAffName ?? '正方'} <Tag color="purple">VS</Tag> {boundBanner.teamNegName ?? '反方'}
              </Text>
            </Card>
          ) : (
            <Card title="绑定比赛（可选）" size="small" style={{ marginBottom: spacing.md }}>
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Select
                  placeholder="选择赛事"
                  style={{ width: '100%' }}
                  loading={boundLoading}
                  value={selEventId}
                  onChange={(v) => void handleBoundEventChange(v)}
                  options={boundEvents.map((e) => ({ label: e.name, value: e.id }))}
                  showSearch
                  optionFilterProp="label"
                />
                <Select
                  placeholder="选择轮次（可全部/未定轮）"
                  style={{ width: '100%' }}
                  disabled={!selEventId}
                  value={selRoundId}
                  onChange={handleBoundRoundChange}
                  options={[
                    { label: '全部轮次', value: ROUND_ALL },
                    { label: '未定轮', value: ROUND_NONE },
                    ...boundRounds.map((r) => ({ label: roundOptionLabel(r), value: r.id }))
                  ]}
                  showSearch
                  optionFilterProp="label"
                />
                <Select
                  placeholder="选择场次（比赛）"
                  style={{ width: '100%' }}
                  disabled={!selEventId || !selRoundId}
                  loading={boundLoading}
                  value={selMatchId}
                  onChange={handleBindMatch}
                  options={visibleMatches.map((m) => ({
                    label: `${m.teamAffName ?? '正方'} vs ${m.teamNegName ?? '反方'}${m.roundName ? `（${m.roundName}）` : ''}`,
                    value: m.id
                  }))}
                  showSearch
                  optionFilterProp="label"
                  notFoundContent="暂无可绑定场次"
                />
                {selMatchId && (
                  <Space size="small">
                    <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                      已绑定：{boundMatches.find((m) => m.id === selMatchId)?.teamAffName ?? '正方'} vs{' '}
                      {boundMatches.find((m) => m.id === selMatchId)?.teamNegName ?? '反方'}
                    </Text>
                    <Button size="small" type="link" onClick={handleUnbindMatch}>解绑</Button>
                  </Space>
                )}
                <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                  {selMatchId
                    ? '录音停止后会自动写回该场；开始计时时关联本场比赛。'
                    : '可为本场计时预绑定比赛，便于录音与赛果回写。'}
                </Text>
              </Space>
            </Card>
          )}

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
                renderItem={(stage: StageDef, idx: number) => {
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
                              {stage.poolTeam && (
                                <Tag color={stage.poolTeam === 'aff' ? 'processing' : 'error'} style={{ marginInlineStart: 0 }}>
                                  {stage.poolTeam === 'aff' ? '正方池' : '反方池'}
                                </Tag>
                              )}
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
              {/* 计时录音开关（T2）：环节切换自动打标记，停止时落盘写回 match */}
              <Button
                type={recOn ? 'primary' : 'default'}
                danger={recOn}
                icon={<AudioOutlined />}
                loading={recorder.starting}
                onClick={(e) => { e.currentTarget.blur(); void handleToggleRecording() }}
              >
                {recOn ? '停止录音' : '开始录音'}
              </Button>
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

                    {/* 每队总时长池（后手）：展示双方池剩余，当前 pool 环节高亮扣除方 */}
                    {hasTeamPool && (
                      <div style={{ textAlign: 'center', marginTop: spacing.md }}>
                        <Space size="middle">
                          <Tag color={currentPoolTeam === 'aff' ? 'processing' : 'default'} style={{ fontSize: fontSize.caption, marginInlineEnd: 0 }}>
                            正方池 {formatTime(Math.max(0, engine.state.affPoolRemainingMs ?? 0))}
                          </Tag>
                          <Tag color={currentPoolTeam === 'neg' ? 'error' : 'default'} style={{ fontSize: fontSize.caption, marginInlineEnd: 0 }}>
                            反方池 {formatTime(Math.max(0, engine.state.negPoolRemainingMs ?? 0))}
                          </Tag>
                        </Space>
                        <Text type="secondary" style={{ display: 'block', fontSize: fontSize.caption, marginTop: spacing.xs }}>
                          {currentPoolTeam
                            ? `当前从「${currentPoolTeam === 'aff' ? '正方' : '反方'}池」扣除`
                            : '当前环节不占用总池（自由辩论各 4 分钟）'}
                        </Text>
                      </div>
                    )}

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
                      <>
                        <FreeDebateProgressBar
                          proRemainingMs={engine.state.affRemainingMs ?? engine.state.remainingMs}
                          conRemainingMs={engine.state.negRemainingMs ?? engine.state.remainingMs}
                          totalMs={currentStage.durationMs}
                          activeSide={engine.state.currentSide}
                        />
                        {/* 自由辩论发言次数：正/反方各自累计 */}
                        <div style={{ textAlign: 'center', marginTop: spacing.sm }}>
                          <Space size="middle">
                            <Tag color="processing" style={{ fontSize: fontSize.caption, marginInlineEnd: 0 }}>
                              正方发言 {engine.state.affSpeechCount ?? 0} 次
                            </Tag>
                            <Tag color="error" style={{ fontSize: fontSize.caption, marginInlineEnd: 0 }}>
                              反方发言 {engine.state.negSpeechCount ?? 0} 次
                            </Tag>
                          </Space>
                        </div>
                      </>
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
          renderItem={(session) => {
            const fmtStages = session.formatSnapshot?.stages ?? []
            const fmtName = fmtStages.length ? `${fmtStages.length} 环节` : '未知赛制'
            const firstStageName = fmtStages[0]?.name
            const vs = session.teamAffName || session.teamNegName
              ? `${session.teamAffName ?? '正方'} vs ${session.teamNegName ?? '反方'}`
              : null
            const isFinished = session.status === 'finished'
            const actionLabel = session.status === 'running' || session.status === 'paused' ? '加载/继续' : '加载'
            return (
              <List.Item
                actions={[
                  isFinished
                    ? <Button key="fin" size="small" type="link" disabled>已结束</Button>
                    : <Button key="load" size="small" type="link" onClick={(e) => { e.currentTarget.blur(); void handleLoadHistorySession(session.id) }}>{actionLabel}</Button>
                ]}
              >
                <List.Item.Meta
                  title={session.label ?? (vs ? vs : `会话 ${session.id.slice(0, 8)}…`)}
                  description={
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Space size="small" wrap>
                        <Tag color={isFinished ? 'green' : session.status === 'running' ? 'blue' : 'default'}>
                          {session.status === 'running' ? '进行中' : session.status === 'paused' ? '已暂停' : isFinished ? '已结束' : '空闲'}
                        </Tag>
                        <Tag color="geekblue">{fmtName}{firstStageName ? ` · ${firstStageName}` : ''}</Tag>
                        {!!vs && (
                          <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                            {vs}
                          </Text>
                        )}
                      </Space>
                      {!!session.topicTitle && (
                        <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                          辩题：{session.topicTitle}
                        </Text>
                      )}
                      <Text type="secondary" style={{ fontSize: fontSize.caption }}>
                        第 {session.currentStageIndex + 1} 环节
                        {session.remainingMs != null ? ` · 剩余 ${formatTime(Math.max(0, session.remainingMs))}` : ''}
                        {session.startedAt ? ` · 开始：${new Date(session.startedAt).toLocaleString()}` : ''}
                      </Text>
                    </Space>
                  }
                />
              </List.Item>
            )
          }}
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
