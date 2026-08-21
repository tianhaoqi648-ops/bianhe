// ============================================================
// JudgeArena.tsx — AI 裁判工作台页面（2026-08-18）
//
// 表单驱动的裁判工作台：选评委 → 选环节（支持自动识别）→ 粘贴稿子 →
// 点按钮执行（单方稿评估/模拟攻击/改写/整场评审）→ 结果页内卡片展示。
//
// 与 Agent 聊天流的关系：
//   - 聊天流：LLM 自主选工具（judge_* 等 5 工具已注册）
//   - 本页面：通过 agent:run-tool 直接调工具（白名单 5 个裁判工具），
//     结果卡片复用 judge-result-cards.tsx（与 ToolCallCard 同源）
//
// 设计要点：
//   - 无 apiKey 时全部按钮禁用（config 取 settingsStore.aiConfig）
//   - 同时只跑一个操作（running 状态 + 「取消」按钮 → agent:cancel-tool）
//   - 环节「自动识别」：detect_stage 识别当前稿子环节并回填下拉
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Typography,
  Button,
  Input,
  Select,
  Radio,
  Space,
  Card,
  Alert,
  Spin,
  Divider,
  Tag,
  theme
} from 'antd'
import {
  AuditOutlined,
  AimOutlined,
  ExperimentOutlined,
  ThunderboltOutlined,
  CloseOutlined,
  UploadOutlined,
  AudioOutlined,
  DownloadOutlined
} from '@ant-design/icons'
import PageHeader from '../components/common/PageHeader'
import { JUDGES } from '../../../shared/ai-judges'
import { STAGE_DEFINITIONS, type DebateStageType } from '../../../shared/debate-stages'
import type {
  Event,
  Match,
  MatchAiReview,
  Round,
  SttEngine,
  JudgeHistoryRecord,
  JudgeHistoryCreateInput,
  JudgeHistoryFilter
} from '../../../shared/types'
import { STT_ENGINE_KEY, STT_MODEL_KEY } from '../../../shared/types'
import { buildJudgeReplayHtml } from '../../../shared/replay-html'
import { useSettingsStore } from '../stores/settingsStore'
import { useToast } from '../hooks/useToast'
import {
  JudgeResultCardByTool,
  STAGE_NAMES,
  type JudgeMatchResult
} from '../components/agent/judge-result-cards'
import {
  getAvailableActions,
  currentSpeech,
  type JudgeArenaFormState,
  type JudgeAction
} from './judgeArenaLogic'
import {
  buildJudgeHistoryInput,
  judgeMatchCanWriteBack,
  mapJudgeMatchToMatchAiReview,
  judgeHistoryToolLabel
} from './judgeHistoryLogic'
import {
  resolveJudgePreBind,
  type JudgePreBindIntent,
  type JudgePreBindSources
} from './judgePreBindLogic'

/** preload 暴露的 agent API（window.agent 类型未在 index.d.ts 声明，用 cast） */
function getAgentAPI(): { runTool: (req: unknown) => Promise<{ success: boolean; code?: string; message?: string; data?: unknown }>; cancelTool: () => Promise<void> } | null {
  const w = window as unknown as { agent?: { runTool: (req: unknown) => Promise<{ success: boolean; code?: string; message?: string; data?: unknown }>; cancelTool: () => Promise<void> } }
  return w.agent ?? null
}

/** 单次操作记录（结果区展示） */
interface ArenaResult {
  id: string
  toolName: string
  actionLabel: string
  result: unknown
  error?: string
}

/** 整场时间线片段（由录音环节/发言人标记载入，content 由用户补转文字） */
interface MatchTimelineSeg {
  stage?: string
  stageName?: string
  side?: string | null
  speaker?: string | null
  tsMs?: number
  content: string
}

/** 攻击方式选项 */
const ATTACK_MODE_OPTIONS = [
  { value: 'cross_exam', label: '质询盘问' },
  { value: 'rebuttal', label: '驳论攻击' },
  { value: 'free_debate', label: '自由辩突袭' }
]

/**
 * 评审风格说明（2026-08-18：仅风格视角，不含任何人物身份/履历信息）。
 * 按 category 映射，供评委风格卡片展示。
 */
const STYLE_BRIEFS: Record<string, string> = {
  攻防流: '聚焦交锋效率与攻防纪律：关注反驳是否到位、立论是否被有效拆解，对方未回应的观点视为成立',
  价值流: '重视价值立意与切入角度：能否重新定义辩题、刷新看待问题的视角，表达感染力权重较高',
  '价值+知识': '兼顾价值深度与知识含量：论证需有思维高度与视野广度，表达清晰有说服力',
  学理流: '强调立论的理论深度与独立思考：从概念与前提处检验论证是否站得住，注重风度与学养',
  建构流: '倡导知识增量型论证：论证应带来新认知而非重复存量，条理清晰、温和而有说服力'
}

/** 操作按钮元数据（2026-08-18：移除改写稿子；按钮改名单方评审/双方评审） */
const ACTION_BUTTONS: Array<{ action: JudgeAction; label: string; icon: React.ReactNode; tooltip: string }> = [
  { action: 'judge_speech', label: '单方评审', icon: <ExperimentOutlined />, tooltip: '按评委风格评估当前立场稿子：五维评分 + 漏洞清单 + 改进建议' },
  { action: 'simulate_opponent', label: '模拟对方攻击', icon: <AimOutlined />, tooltip: '以评委思维模拟对方攻击（质询/驳论/自由辩突袭）' },
  { action: 'judge_debate', label: '双方评审', icon: <AuditOutlined />, tooltip: '分别录入正、反方完整辩词后，双方一起评审（胜负判定 + 五维对比）' }
]

/** 持方枚举 → 中文（复盘报告用） */
function sideName(side: string | null | undefined): string {
  if (side === 'aff') return '正方'
  if (side === 'neg') return '反方'
  return ''
}

/**
 * P0-3：把「转写分段 + 整场评审结果」组装成结构化复盘报告（Markdown）。
 * 对缺失数据做空态兜底（不抛错），保证任何情况下都能导出一份结构完整的报告。
 */
function buildJudgeReportMarkdown(
  timeline: MatchTimelineSeg[],
  result: unknown,
  affName?: string | null,
  negName?: string | null,
  topicTitle?: string | null
): { content: string; defaultName: string } {
  const lines: string[] = []
  const data = result && typeof result === 'object' ? (result as JudgeMatchResult) : null

  const topic = topicTitle?.trim() || data?.topic?.trim() || '(未填写辩题)'
  const aff = affName?.trim() || '正方'
  const neg = negName?.trim() || '反方'
  const winnerLabel = data?.verdict
    ? data.verdict.winner === 'aff'
      ? `正方（${aff}）`
      : data.verdict.winner === 'neg'
        ? `反方（${neg}）`
        : '平局'
    : '素材不足，未判定'

  lines.push(`# 辩论复盘报告`)
  lines.push('')
  lines.push(`- **辩题**：${topic}`)
  lines.push(`- **对阵**：${aff}（正方） vs ${neg}（反方）`)
  lines.push(`- **评委**：${data?.judgeName ? `「${data.judgeName}」` : 'AI 裁判'}`)
  lines.push(`- **判定结果**：${winnerLabel}`)
  if (data?.bestSpeaker) lines.push(`- **最佳辩手**：${data.bestSpeaker}`)
  lines.push(`- **评审时间**：${new Date().toLocaleString()}`)
  lines.push('')

  // 转写时间线
  const filledSegs = timeline.filter((t) => t.content.trim() !== '')
  lines.push(`## 一、全场转写（${filledSegs.length} 段）`)
  if (filledSegs.length === 0) {
    lines.push('> 暂无可用转写内容。')
  } else {
    filledSegs.forEach((seg, i) => {
      const stageLabel = STAGE_NAMES[seg.stage ?? ''] || seg.stageName || seg.stage || `第 ${i + 1} 段`
      const who = [sideName(seg.side), seg.speaker].filter(Boolean).join(' · ')
      lines.push(`### ${stageLabel}${who ? ` — ${who}` : ''}`)
      if (seg.tsMs != null) lines.push(`> 时间：${Math.round(seg.tsMs / 1000)}s`)
      lines.push(seg.content.trim())
      lines.push('')
    })
  }

  // 五维评分
  lines.push(`## 二、五维评分`)
  if (data?.dimensions && data.dimensions.length > 0) {
    lines.push(`| 维度 | 正方（${aff}） | 反方（${neg}） | 评语 |`)
    lines.push(`| --- | --- | --- | --- |`)
    data.dimensions.forEach((d) => {
      lines.push(
        `| ${d.name || d.key || '维度'} | ${d.affScore} | ${d.negScore} | ${(d.comment || '').replace(/\n/g, ' ')  } |`
      )
    })
  } else {
    lines.push('> 暂无五维评分数据。')
  }
  lines.push('')

  // 逐环节点评
  lines.push(`## 三、逐环节点评`)
  if (data?.stageVerdicts && data.stageVerdicts.length > 0) {
    data.stageVerdicts.forEach((sv) => {
      const winLabel = sv.winner === 'aff' ? `正方（${aff}）` : sv.winner === 'neg' ? `反方（${neg}）` : '平局'
      lines.push(`### ${STAGE_NAMES[sv.stage] || sv.stage || '环节'}`)
      lines.push(`- 胜方：${winLabel}（置信度 ${sv.confidence != null ? Math.round(sv.confidence * 100) : '?'}%）`)
      if (sv.comment) {
        lines.push(`- 点评：${sv.comment}`)
      }
      lines.push('')
    })
  } else {
    lines.push('> 暂无逐环节点评数据。')
    lines.push('')
  }

  // AI 总结建议
  lines.push(`## 四、AI 建议与总结`)
  if (data?.verdict?.reason?.trim()) {
    lines.push(`**判定理由**：${data.verdict.reason.trim()}`)
    lines.push('')
  }
  if (data?.insufficientReason?.trim()) {
    lines.push(`> 素材不足说明：${data.insufficientReason.trim()}`)
    lines.push('')
  }
  if (data?.summary?.trim()) {
    lines.push(data.summary.trim())
  } else {
    lines.push('> 暂无总结内容。')
  }
  lines.push('')

  const safeAff = aff.replace(/[\\/:*?"<>|]/g, '')
  const safeNeg = neg.replace(/[\\/:*?"<>|]/g, '')
  const defaultName = `辩论复盘_${safeAff}_vs_${safeNeg}_${new Date().toISOString().slice(0, 10)}`
  return { content: lines.join('\n'), defaultName }
}

export default function JudgeArena(): JSX.Element {
  const { token } = theme.useToken()

  // ---------- 表单状态 ----------
  const [topic, setTopic] = useState('')
  const [judgeId, setJudgeId] = useState('hu-jianbiao')
  const [stage, setStage] = useState<DebateStageType | undefined>(undefined)
  const [side, setSide] = useState<'aff' | 'neg'>('aff')
  const [affSpeech, setAffSpeech] = useState('')
  const [negSpeech, setNegSpeech] = useState('')
  const [attackMode, setAttackMode] = useState('cross_exam')

  // ---------- 赛事绑定（T6.2：赛事→轮次→场次，可选） ----------
  const [events, setEvents] = useState<Event[]>([])
  const [rounds, setRounds] = useState<Round[]>([])
  const [matchList, setMatchList] = useState<Match[]>([])
  const [boundEventId, setBoundEventId] = useState<string | undefined>(undefined)
  const [boundRoundId, setBoundRoundId] = useState<string | undefined>(undefined)
  const [boundMatchId, setBoundMatchId] = useState<string | undefined>(undefined)
  const [boundMatch, setBoundMatch] = useState<Match | null>(null)
  /** 由该场录音标记载入的时间线素材（content 需用户补转文字） */
  const [timeline, setTimeline] = useState<MatchTimelineSeg[]>([])

  const toast = useToast()

  // ---------- 执行状态 ----------
  const [results, setResults] = useState<ArenaResult[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 「本场录音转文字」进行中（独立于 runTool 的 running） */
  const [transcribing, setTranscribing] = useState(false)

  // ---------- 评审历史（T3） ----------
  const [history, setHistory] = useState<JudgeHistoryRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  /** 当前展开查看的历史条目 id（只读重开） */
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null)

  // ---------- 配置 ----------
  const apiKey = useSettingsStore((s) => s.aiConfig.apiKey)
  const aiConfig = useSettingsStore((s) => s.aiConfig)
  const apiKeyConfigured = apiKey.length > 0

  // 当前选中评委（默认胡渐彪）
  const judge = useMemo(() => JUDGES.find((j) => j.id === judgeId) ?? JUDGES[0], [judgeId])

  // 按钮启用矩阵
  const formState: JudgeArenaFormState = {
    topic,
    stage,
    side,
    affSpeech,
    negSpeech,
    apiKeyConfigured
  }
  const available = getAvailableActions(formState)
  const currentSpeechText = currentSpeech(formState)

  // ---------- 赛事绑定逻辑（T6.2） ----------
  // 进入页面时加载赛事列表（复用 window.eventAPI）
  useEffect(() => {
    const w = window as unknown as {
      eventAPI?: {
        listEvents: (filter?: unknown) => Promise<{ success: boolean; data?: { items?: Event[] } }>
      }
    }
    const api = w.eventAPI
    if (!api) return
    void api
      .listEvents()
      .then((res) => {
        if (res.success && Array.isArray(res.data?.items)) setEvents(res.data?.items ?? [])
      })
      .catch(() => {
        // 忽略赛事加载失败，绑定区保持为空
      })
  }, [])

  // T4 预绑定：从路由读取当前路由位置，供下方 effect 读取 state/query
  const location = useLocation()

  // ---------- 预绑定（T4）：从路由 state/query 读三元组，events 就绪后校验并选中三级 ----------
  // 只有预绑定到已存在事件/轮次/场次才选中；ID 对不上则静默回退「未绑定」（不报错不弹窗）。
  const appliedPreBindRef = useRef(false)
  useEffect(() => {
    if (appliedPreBindRef.current) return
    const st = location.state as JudgePreBindIntent | null
    const sp = new URLSearchParams(location.search)
    const intent: JudgePreBindIntent = {
      eventId: st?.eventId ?? sp.get('eventId'),
      roundId: st?.roundId ?? sp.get('roundId'),
      matchId: st?.matchId ?? sp.get('matchId')
    }
    // 赛事未就绪或 eventId 不存在 → 等待 events 加载 / 静默回退
    const event = events.find((e) => e.id === intent.eventId)
    if (!event) return
    appliedPreBindRef.current = true
    const w = window as unknown as {
      eventAPI?: { listRoundsByEvent: (id: string) => Promise<{ success: boolean; data?: Round[] }> }
      matchAPI?: { listByEvent: (id: string) => Promise<{ success: boolean; data?: Match[] }> }
    }
    void (async () => {
      const [rRes, mRes] = await Promise.all([
        w.eventAPI?.listRoundsByEvent(event.id),
        w.matchAPI?.listByEvent(event.id)
      ])
      const loadedRounds: Round[] = rRes?.success && Array.isArray(rRes.data) ? rRes.data : []
      const loadedMatches: Match[] = mRes?.success && Array.isArray(mRes.data) ? mRes.data : []
      setRounds(loadedRounds)
      setMatchList(loadedMatches)
      const sources: JudgePreBindSources = { rounds: loadedRounds, matches: loadedMatches }
      const resolved = resolveJudgePreBind(intent, sources)
      if (!resolved.matchId || !resolved.boundMatch) return // 场次对不上 → 静默回退未绑定
      setBoundEventId(resolved.eventId ?? event.id)
      setBoundRoundId(resolved.roundId)
      setBoundMatchId(resolved.matchId)
      setBoundMatch(resolved.boundMatch)
      setTimeline([])
    })()
  }, [events, location])

  // 缓存同步：绑定状态或 match 变化后刷新本场快照（含 teamNames/recordingMeta/markers）
  const boundMatchRef = useMemo(() => boundMatch, [boundMatch])

  /** 选择赛事 → 加载轮次 + 全部场次；清空下级绑定 */
  const handleEventChange = async (val?: string): Promise<void> => {
    setBoundEventId(val)
    setBoundRoundId(undefined)
    setBoundMatchId(undefined)
    setBoundMatch(null)
    setTimeline([])
    setRounds([])
    setMatchList([])
    if (!val) return
    const w = window as unknown as {
      eventAPI?: { listRoundsByEvent: (id: string) => Promise<{ success: boolean; data?: Round[] }> }
      matchAPI?: { listByEvent: (id: string) => Promise<{ success: boolean; data?: Match[] }> }
    }
    const results = await Promise.all([
      w.eventAPI?.listRoundsByEvent(val),
      w.matchAPI?.listByEvent(val)
    ])
    const [rRes, mRes] = results
    if (rRes?.success && Array.isArray(rRes.data)) setRounds(rRes.data ?? [])
    if (mRes?.success && Array.isArray(mRes.data)) setMatchList(mRes.data ?? [])
  }

  /** 选择轮次（仅记录 roundId 用于上下文；场次不受轮次过滤） */
  const handleRoundChange = (val?: string): void => {
    setBoundRoundId(val)
  }

  /** 选择场次 → 保存 boundMatchId + 上下文（eventId/roundId/topicId/teamNames） */
  const handleMatchChange = (val?: string): void => {
    const m = matchList.find((x) => x.id === val)
    if (!m) {
      setBoundMatchId(undefined)
      setBoundMatch(null)
      setTimeline([])
      return
    }
    setBoundMatchId(m.id)
    setBoundMatch(m)
    // 切换场次后清空旧时间线素材
    setTimeline([])
  }

  // ---------- 评审历史（T3） ----------

  /** preload 暴露的 judgeAPI（window.judgeAPI 类型已在 index.d.ts 声明） */
  const judgeHistoryApi = useCallback(() => {
    const w = window as unknown as {
      judgeAPI?: {
        listHistory: (filter?: JudgeHistoryFilter) => Promise<{ success: boolean; data?: JudgeHistoryRecord[] | null; error?: string }>
        saveHistory: (input: JudgeHistoryCreateInput) => Promise<{ success: boolean; data?: JudgeHistoryRecord | null; error?: string }>
        deleteHistory: (id: string) => Promise<{ success: boolean; error?: string }>
      }
    }
    return w.judgeAPI ?? null
  }, [])

  /** 刷新评审历史：绑定场次时按 binding 筛选，未绑定则列出全部（失败静默） */
  const refreshHistory = useCallback((): void => {
    const api = judgeHistoryApi()
    if (!api) return
    setHistoryLoading(true)
    const filter: JudgeHistoryFilter | undefined = boundMatchId
      ? {
          eventId: boundEventId ?? null,
          roundId: boundRoundId ?? null,
          matchId: boundMatchId ?? null
        }
      : undefined
    api
      .listHistory(filter)
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setHistory(res.data ?? [])
      })
      .catch(() => {
        // 加载失败静默，历史区保持为空
      })
      .finally(() => setHistoryLoading(false))
  }, [judgeHistoryApi, boundEventId, boundRoundId, boundMatchId])

  // 挂载 + 绑定变化时刷新历史（未绑定即全部）
  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  /** 裁判工具成功结果自动落库（静默失败，不打断流程） */
  const saveResultHistory = (toolName: string, result: unknown): void => {
    const api = judgeHistoryApi()
    if (!api) return
    const speechTool = toolName === 'judge_speech' || toolName === 'simulate_opponent' || toolName === 'detect_stage'
    const input = buildJudgeHistoryInput({
      toolName,
      result,
      eventId: boundEventId ?? null,
      roundId: boundRoundId ?? null,
      matchId: boundMatchId ?? null,
      judgeId: judge.id,
      // 环节/持方快照：仅面向单方稿的工具记录表单中的环节与持方
      stage: toolName === 'judge_speech' || toolName === 'simulate_opponent' ? (stage ?? null) : null,
      side: speechTool ? side : null,
      topic: topic.trim() || boundMatchRef?.topicTitle || null
    })
    api
      .saveHistory(input)
      .then(() => refreshHistory())
      .catch(() => {
        // 落库失败静默忽略，不打断评审流程
      })
  }

  /** 删除单条评审历史 */
  const handleDeleteHistory = async (id: string): Promise<void> => {
    const api = judgeHistoryApi()
    if (!api) return
    try {
      const res = await api.deleteHistory(id)
      if (res.success) {
        setHistory((prev) => prev.filter((h) => h.id !== id))
        if (expandedHistoryId === id) setExpandedHistoryId(null)
        toast.success('评审历史已删除')
      } else {
        toast.error(res.error || '删除评审历史失败')
      }
    } catch (e) {
      toast.error(`删除评审历史失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 从一条 judge_match 历史写回该场 AI 评审（复用映射口径；不覆盖人工赛果） */
  const handleWriteBackFromHistory = async (record: JudgeHistoryRecord): Promise<void> => {
    if (!boundMatchId) {
      toast.warning('未绑定场次，无法写回')
      return
    }
    if (!judgeMatchCanWriteBack(record)) {
      toast.warning('该历史无有效判定（素材不足或非整场评审），无法写回')
      return
    }
    const review = mapJudgeMatchToMatchAiReview(record.resultJson, 'transcript')
    if (!review) {
      toast.warning('该历史无可写回的有效赛果')
      return
    }
    const w = window as unknown as {
      matchAPI?: { setAiReview: (id: string, r: MatchAiReview) => Promise<{ success: boolean; error?: string }> }
    }
    const res = await w.matchAPI?.setAiReview(boundMatchId, review)
    if (res?.success) {
      toast.success('AI 整场评审已写回该场（不覆盖人工赛果）')
    } else {
      toast.error(res?.error || 'AI 评审写回失败')
    }
  }

  /** 载入本场录音标记 → 时间线素材（content 留空供用户补转文字） */
  const handleLoadMarkers = (): void => {
    const markers = boundMatchRef?.recordingMeta?.markers
    if (!markers || markers.length === 0) {
      toast.warning('该场暂无录音环节标记')
      return
    }
    const segs: MatchTimelineSeg[] = markers.map((mk) => ({
      stage: mk.stageId || undefined,
      stageName: mk.stageName || undefined,
      side: mk.side ?? null,
      speaker: mk.speaker ?? null,
      tsMs: mk.tsMs,
      content: ''
    }))
    setTimeline(segs)
    toast.success(`已载入本场 ${segs.length} 段录音标记`)
  }

  /** 本场录音 → 转文字：取 recordingMeta.filePath + markers，调 sttAPI.transcribe，组装时间线 */
  const handleTranscribeRecording = async (): Promise<void> => {
    const meta = boundMatchRef?.recordingMeta
    if (!meta?.filePath) {
      toast.warning('该场暂未录制到录音文件（recordingMeta.filePath 为空）')
      return
    }
    const markers = (meta.markers ?? []).map((mk) => ({
      stage: mk.stageName ?? mk.stageId ?? '未命名环节',
      speaker: mk.speaker ?? undefined,
      atMs: mk.tsMs
    }))
    // 引擎/模型偏好：缺省读 settings（后端仅在 req 未传时回读）
    let engine: SttEngine | undefined
    let model: string | undefined
    try {
      engine = (await useSettingsStore.getState().get(STT_ENGINE_KEY)) as SttEngine | undefined
      model = (await useSettingsStore.getState().get(STT_MODEL_KEY)) as string | undefined
    } catch {
      // 读取失败忽略，走后端缺省
    }
    setTranscribing(true)
    setError(null)
    try {
      // 预检本地引擎，给用户清晰的兜底说明
      const statusRes = await window.sttAPI.status(model)
      const localReady = statusRes.success ? !!statusRes.data?.installed : false
      const effEngine = engine === 'api'
        ? 'api'
        : engine === 'local'
          ? 'local'
          : localReady
            ? 'local-first(local)'
            : 'local-first(api)'

      const res = await window.sttAPI.transcribe({
        filePath: meta.filePath,
        markers,
        engine,
        model,
        aiConfig: {
          baseURL: aiConfig.baseURL,
          apiKey: aiConfig.apiKey,
          model: 'whisper-1'
        }
      })
      if (!res.success) {
        // 明确引导：本地未装 → 去下载；无 API → 提示去配置
        setError(`${res.error ?? '转写失败'}${effEngine.includes('api') ? '（如需本地转写，请到 设置→AI 转写 下载转写引擎）' : ''}`)
        return
      }
      const segs = res.data ?? []
      if (segs.length === 0) {
        toast.warning('转写结果为空，请检查录音内容')
        return
      }
      // 组装整场时间线（沿用 timeline 结构，content 直接填转文字）
      setTimeline(
        segs.map((s) => ({
          stage: s.stage,
          stageName: s.stage,
          side: undefined,
          speaker: s.speaker ?? null,
          tsMs: s.atMs,
          content: s.text
        }))
      )
      toast.success(`转写完成：${segs.length} 段（${effEngine === 'api'
        ? 'AI API'
        : effEngine === 'local' || effEngine === 'local-first(local)'
          ? '本地引擎'
          : 'AI API（本地引擎未装，已自动兜底）'}）`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTranscribing(false)
    }
  }

  /** 更新时间线某段转文字 */
  const handleTimelineContent = (index: number, value: string): void => {
    setTimeline((prev) => prev.map((t, i) => (i === index ? { ...t, content: value } : t)))
  }

  /** 整场评审（judge_match）：以时间线为素材，需至少一段 content 非空 */
  const handleJudgeMatch = async (): Promise<void> => {
    const filled = timeline.filter((t) => t.content.trim() !== '')
    if (filled.length === 0) {
      toast.warning('请先为时间线中至少一段补充转文字内容，再发起整场评审')
      return
    }
    const baseTopic =
      boundMatchRef?.topicTitle ??
      topic.trim() ??
      `${boundMatchRef?.teamAffName ?? '正方'} vs ${boundMatchRef?.teamNegName ?? '反方'}`
    const segs = filled.map((t) => ({
      stage: t.stage,
      stageName: t.stageName,
      side: t.side ?? undefined,
      speaker: t.speaker ?? undefined,
      tsMs: t.tsMs,
      content: t.content
    }))
    await runJudge('judge_match', { topic: baseTopic, timeline: segs, judgeId }, '整场评审')
  }

  /** 获取最近一次 judge_match 结果 */
  const lastJudgeMatchResult = useMemo<unknown | null>(() => {
    for (let i = results.length - 1; i >= 0; i--) {
      const r = results[i]
      if (r.toolName === 'judge_match' && !r.error) return r.result
    }
    return null
  }, [results])

  /** 写回该场 AI 评审（复用 EventMatchesTab 映射口径；不覆盖人工赛果） */
  const handleWriteBack = async (): Promise<void> => {
    if (!boundMatchId) {
      toast.warning('未绑定场次，无法写回')
      return
    }
    if (!lastJudgeMatchResult || typeof lastJudgeMatchResult !== 'object') {
      toast.warning('尚未执行整场评审（judge_match），请先执行后再写回')
      return
    }
    // 素材不足以判定的整场评审（verdict===null）无可写回的赛果，直接中止
    const source: MatchAiReview['source'] = timeline.some((t) => t.content.trim() !== '')
      ? 'recording'
      : 'transcript'
    const review = mapJudgeMatchToMatchAiReview(lastJudgeMatchResult, source)
    if (!review) {
      toast.warning('本次整场评审素材不足、无法判定，暂无有效赛果可写回')
      return
    }
    const w = window as unknown as {
      matchAPI?: { setAiReview: (id: string, r: MatchAiReview) => Promise<{ success: boolean; error?: string }> }
    }
    const res = await w.matchAPI?.setAiReview(boundMatchId, review)
    if (res?.success) {
      toast.success('AI 整场评审已写回该场（不覆盖人工赛果）')
    } else {
      toast.error(res?.error || 'AI 评审写回失败')
    }
  }

  /** 一键导出复盘报告（P0-3）：组装 Markdown → IPC 弹保存对话框 + 写 .md 文件 */
  const handleExportReport = async (): Promise<void> => {
    if (!lastJudgeMatchResult) {
      toast.warning('请先完成整场评审（judge_match），再导出复盘')
      return
    }
    const affName = boundMatchRef?.teamAffName
    const negName = boundMatchRef?.teamNegName
    const topicTitle = boundMatchRef?.topicTitle
    const { content, defaultName } = buildJudgeReportMarkdown(
      timeline,
      lastJudgeMatchResult,
      affName,
      negName,
      topicTitle
    )
    const w = window as unknown as {
      reportAPI?: {
        exportJudge: (req: {
          defaultName: string
          content: string
        }) => Promise<{ success: boolean; data?: { filePath: string } | null; error?: string }>
      }
    }
    const api = w.reportAPI
    if (!api) {
      toast.error('导出服务未就绪（window.reportAPI 不可用）')
      return
    }
    try {
      const res = await api.exportJudge({ defaultName, content })
      if (!res.success) {
        toast.error(res.error ?? '导出复盘报告失败')
        return
      }
      if (res.data?.filePath) {
        toast.success(`复盘报告已导出：${res.data.filePath}`)
      }
      // res.data === null 表示用户取消保存，此处不报错也不提示
    } catch (e) {
      toast.error(`导出复盘报告失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 导出复盘为自包含 HTML（P2-9）：组装 HTML → IPC 弹保存对话框 + 写 .html 文件 */
  const handleExportReviewHtml = async (): Promise<void> => {
    if (!lastJudgeMatchResult) {
      toast.warning('请先完成整场评审（judge_match），再导出复盘')
      return
    }
    const affName = boundMatchRef?.teamAffName
    const negName = boundMatchRef?.teamNegName
    const topicTitle = boundMatchRef?.topicTitle
    const { content, defaultName } = buildJudgeReplayHtml(
      timeline,
      lastJudgeMatchResult,
      affName,
      negName,
      topicTitle
    )
    const w = window as unknown as {
      reportAPI?: {
        exportJudgeHtml: (req: {
          defaultName: string
          content: string
        }) => Promise<{ success: boolean; data?: { filePath: string } | null; error?: string }>
      }
    }
    const api = w.reportAPI
    if (!api) {
      toast.error('导出服务未就绪（window.reportAPI 不可用）')
      return
    }
    try {
      const res = await api.exportJudgeHtml({ defaultName, content })
      if (!res.success) {
        toast.error(res.error ?? '导出 HTML 复盘失败')
        return
      }
      if (res.data?.filePath) {
        toast.success(`HTML 复盘已导出：${res.data.filePath}`)
      }
      // res.data === null 表示用户取消保存，此处不报错也不提示
    } catch (e) {
      toast.error(`导出 HTML 复盘失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 执行一个裁判工具 */
  const runJudge = async (toolName: string, args: Record<string, unknown>, actionLabel: string): Promise<void> => {
    if (running) return
    const api = getAgentAPI()
    if (!api) {
      setError('Agent 服务未就绪（window.agent 不可用）')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const res = await api.runTool({
        toolName,
        args,
        config: aiConfig
      })
      if (res.success) {
        setResults((prev) => [
          ...prev,
          { id: `${toolName}-${Date.now()}`, toolName, actionLabel, result: res.data }
        ])
        // 自动落库：裁判工具成功结果写入历史（失败静默，不打断流程）
        saveResultHistory(toolName, res.data)
        // 特殊：detect_stage 成功后回填环节
        if (toolName === 'detect_stage' && res.data && typeof res.data === 'object') {
          const detected = (res.data as { stage?: DebateStageType }).stage
          if (detected) setStage(detected)
        }
      } else {
        setError(res.message ?? `工具执行失败（${res.code ?? 'unknown'}）`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  /** 取消当前操作 */
  const handleCancel = (): void => {
    const api = getAgentAPI()
    if (api) {
      void api.cancelTool().catch(() => {
        // 忽略取消异常
      })
    }
    setRunning(false)
  }

  /** 上传稿子文件（txt/md/docx）→ 读取内容 → 填入当前立场 TextArea */
  const handleUpload = async (): Promise<void> => {
    const w = window as unknown as {
      fileAPI?: {
        pickFile: (filters: Array<{ name: string; extensions: string[] }>) => Promise<{ success: boolean; data?: string | null; error?: string }>
        readTextFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
      }
    }
    const fileAPI = w.fileAPI
    if (!fileAPI) {
      setError('文件服务未就绪（window.fileAPI 不可用）')
      return
    }
    try {
      const picked = await fileAPI.pickFile([{ name: '辩词文本', extensions: ['txt', 'md', 'docx'] }])
      if (!picked.success) {
        setError(picked.error ?? '选择文件失败')
        return
      }
      if (!picked.data) return // 用户取消
      const read = await fileAPI.readTextFile(picked.data)
      if (!read.success) {
        setError(read.error ?? '读取文件失败')
        return
      }
      if (side === 'aff') {
        setAffSpeech(read.data ?? '')
      } else {
        setNegSpeech(read.data ?? '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 操作按钮点击分发 */
  const handleAction = (action: JudgeAction): void => {
    const base = { topic: topic.trim() }
    switch (action) {
      case 'judge_speech':
        void runJudge('judge_speech', { ...base, stage, side, speech: currentSpeechText, judgeId }, '单方评审')
        break
      case 'simulate_opponent':
        void runJudge('simulate_opponent', { ...base, side, speech: currentSpeechText, judgeId, attackMode }, '模拟对方攻击')
        break
      case 'judge_debate':
        void runJudge('judge_debate', { ...base, affSpeech, negSpeech, judgeId }, '双方评审')
        break
      case 'detect_stage':
        void runJudge('detect_stage', { speech: currentSpeechText, topic: topic.trim() }, '环节识别')
        break
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
      <PageHeader title="AI 裁判" subtitle="风格化备赛工作台：单方评审 · 双方评审 · 模拟攻击 · 环节识别" />

      {/* 表单区 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        {/* 赛事绑定：赛事 → 轮次 → 场次（可空；未绑定时原就地查看行为不变） */}
        <Typography.Text strong style={{ fontSize: 13 }}>赛事绑定</Typography.Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, marginBottom: 4, flexWrap: 'wrap' }}>
          <Select
            allowClear
            placeholder="选择赛事"
            style={{ minWidth: 150 }}
            value={boundEventId}
            onChange={(v) => void handleEventChange(v)}
            options={events.map((e) => ({ value: e.id, label: e.name }))}
          />
          <Select
            allowClear
            placeholder="选择轮次"
            style={{ minWidth: 140 }}
            value={boundRoundId}
            disabled={!boundEventId}
            onChange={(v) => handleRoundChange(v)}
            options={rounds.map((r) => ({
              value: r.id,
              label: r.name || `第 ${r.round_number ?? '?'} 轮`
            }))}
          />
          <Select
            allowClear
            placeholder="选择场次"
            style={{ minWidth: 220 }}
            value={boundMatchId}
            disabled={!boundEventId}
            onChange={(v) => void handleMatchChange(v)}
            options={matchList.map((m) => ({
              value: m.id,
              label: `${m.teamAffName ?? '正方'} vs ${m.teamNegName ?? '反方'}`
            }))}
          />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {boundMatch ? `已绑定场次：${boundMatch.teamAffName ?? '正方'} vs ${boundMatch.teamNegName ?? '反方'}` : '未绑定赛事/场次，评审结果仅就地查看'}
        </Typography.Text>

        {/* 场次素材：载入录音标记 → 时间线 + 整场评审 + 写回 */}
        {boundMatch ? (
          <div style={{ marginBottom: 14 }}>
            <Space wrap style={{ marginBottom: 8 }}>
              <Button
                disabled={running || transcribing || !boundMatch.recordingMeta?.markers?.length}
                onClick={handleLoadMarkers}
                icon={<UploadOutlined />}
              >
                {boundMatch.recordingMeta?.markers?.length ? `载入本场录音标记（${boundMatch.recordingMeta.markers.length} 段）` : '本场无录音标记'}
              </Button>
              <Button
                type="primary"
                loading={transcribing}
                disabled={transcribing || running || !boundMatch.recordingMeta?.filePath}
                onClick={() => void handleTranscribeRecording()}
                icon={<AudioOutlined />}
              >
                {boundMatch.recordingMeta?.filePath ? '本场录音转文字' : '本场无录音'}
              </Button>
              <Button
                type="primary"
                ghost
                disabled={transcribing || running || !apiKeyConfigured || timeline.filter((t) => t.content.trim() !== '').length === 0}
                loading={running}
                onClick={() => void handleJudgeMatch()}
                icon={<AuditOutlined />}
              >
                整场评审（judge_match）
              </Button>
              <Button
                disabled={running || transcribing || !lastJudgeMatchResult}
                onClick={() => void handleWriteBack()}
                icon={<ThunderboltOutlined />}
              >
                写回该场 AI 评审
              </Button>
              <Button
                disabled={running || transcribing || !lastJudgeMatchResult}
                onClick={() => void handleExportReport()}
                icon={<DownloadOutlined />}
              >
                导出复盘
              </Button>
              <Button
                disabled={running || transcribing || !lastJudgeMatchResult}
                onClick={() => void handleExportReviewHtml()}
                icon={<DownloadOutlined />}
              >
                导出 HTML 复盘
              </Button>
            </Space>
            {timeline.length > 0 ? (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  整场时间线（为每段补充转文字 content，至少一段非空才能发起整场评审）
                </Typography.Text>
                {timeline.map((seg, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      marginBottom: 6,
                      fontSize: 12
                    }}
                  >
                    <div style={{ minWidth: 110, paddingTop: 5 }}>
                      <Tag>{seg.stageName || seg.stage || `段 ${i + 1}`}</Tag>
                      <div style={{ color: token.colorTextSecondary, fontSize: 11, lineHeight: 1.4 }}>
                        {[seg.side === 'aff' ? '正方' : seg.side === 'neg' ? '反方' : '', seg.speaker ?? '']
                          .filter(Boolean)
                          .join(' · ')}
                        {seg.tsMs != null ? ` · ${Math.round(seg.tsMs / 1000)}s` : ''}
                      </div>
                    </div>
                    <Input.TextArea
                      rows={2}
                      value={seg.content}
                      placeholder="粘贴该段转文字…"
                      onChange={(e) => handleTimelineContent(i, e.target.value)}
                      style={{ flex: 1, fontSize: 12 }}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 辩题 */}
        <Typography.Text strong style={{ fontSize: 13 }}>辩题</Typography.Text>
        <Input
          placeholder="输入辩题，如：网络让人更亲近还是更疏远"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          style={{ marginTop: 6, marginBottom: 14 }}
        />

        {/* 评委选择：5 种评委风格卡片（含具体描述；不显示真人名） */}
        <Typography.Text strong style={{ fontSize: 13 }}>评委风格</Typography.Text>
        <Radio.Group
          value={judgeId}
          onChange={(e) => setJudgeId(e.target.value)}
          style={{ display: 'block', marginTop: 6, marginBottom: 14 }}
        >
          {JUDGES.map((j) => {
            const brief = STYLE_BRIEFS[j.category] ?? ''
            const briefShort = brief.length > 58 ? `${brief.slice(0, 58)}…` : brief
            const priorities = j.judgePriorities
            return (
              <div
                key={j.id}
                onClick={() => setJudgeId(j.id)}
                title={[
                  STYLE_BRIEFS[j.category] ?? '',
                  priorities?.top ? `最看重：${priorities.top}` : '',
                  priorities?.secondary ? `其次：${priorities.secondary}` : ''
                ]
                  .filter(Boolean)
                  .join('\n')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  marginBottom: 6,
                  borderRadius: 6,
                  border: `1px solid ${
                    judgeId === j.id ? token.colorPrimary : token.colorBorderSecondary
                  }`,
                  backgroundColor: judgeId === j.id ? token.colorPrimaryBg : token.colorBgContainer,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <input
                  type="radio"
                  checked={judgeId === j.id}
                  onChange={() => setJudgeId(j.id)}
                  style={{ margin: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      {j.category}
                    </Typography.Text>
                    {j.tags?.slice(0, 3).map((t) => (
                      <Tag key={t} style={{ marginRight: 0, fontSize: 11 }}>
                        {t}
                      </Tag>
                    ))}
                  </div>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, display: 'block', lineHeight: 1.5, marginTop: 2 }}
                  >
                    {briefShort}
                  </Typography.Text>
                </div>
              </div>
            )
          })}
        </Radio.Group>

        {/* 环节选择 + 自动识别 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            环节
          </Typography.Text>
          <Select
            allowClear
            placeholder="选择环节类型"
            style={{ minWidth: 200, flex: 1 }}
            value={stage}
            onChange={(v) => setStage(v as DebateStageType | undefined)}
            options={STAGE_DEFINITIONS.map((s) => ({ value: s.type, label: `${s.name}（${s.description}）` }))}
          />
          <Button
            icon={<ThunderboltOutlined />}
            disabled={!available.includes('detect_stage') || running}
            onClick={() => handleAction('detect_stage')}
          >
            自动识别
          </Button>
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: -8, marginBottom: 14 }}>
          环节仅「单方评审 / 模拟对方攻击」需要；「双方评审」请直接录入正、反方完整辩词。
        </Typography.Text>

        {/* 立场 + 稿子输入（支持粘贴或上传文件 txt/md/docx） */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Radio.Group value={side} onChange={(e) => setSide(e.target.value)}>
              <Radio.Button value="aff">正方稿</Radio.Button>
              <Radio.Button value="neg">反方稿</Radio.Button>
            </Radio.Group>
            <Button
              size="small"
              icon={<UploadOutlined />}
              disabled={running}
              onClick={handleUpload}
            >
              上传稿子
            </Button>
          </div>
          <Input.TextArea
            rows={6}
            placeholder={side === 'aff' ? '粘贴正方完整辩词（全部环节），或点「上传稿子」选择文件' : '粘贴反方完整辩词（全部环节），或点「上传稿子」选择文件'}
            value={side === 'aff' ? affSpeech : negSpeech}
            onChange={(e) =>
              side === 'aff' ? setAffSpeech(e.target.value) : setNegSpeech(e.target.value)
            }
          />
        </div>

        {/* 扩展选项：攻击方式 */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              攻击方式
            </Typography.Text>
            <Select
              size="small"
              style={{ minWidth: 140 }}
              value={attackMode}
              onChange={setAttackMode}
              options={ATTACK_MODE_OPTIONS}
            />
          </div>
        </div>

        {/* 操作按钮 */}
        <Divider style={{ margin: '12px 0' }} />
        <Space wrap>
          {ACTION_BUTTONS.map((b) => (
            <Button
              key={b.action}
              type="primary"
              ghost
              icon={b.icon}
              disabled={!available.includes(b.action) || running}
              loading={running}
              onClick={() => handleAction(b.action)}
              title={b.tooltip}
            >
              {b.label}
            </Button>
          ))}
          {running ? (
            <Button danger icon={<CloseOutlined />} onClick={handleCancel}>
              取消
            </Button>
          ) : null}
        </Space>
        {!apiKeyConfigured ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message="未配置 API Key"
            description="请先在设置页「AI 助手」中配置 LLM 连接，再使用 AI 裁判功能。"
          />
        ) : null}
      </Card>

      {/* 结果区 */}
      {error ? (
        <Alert
          type="error"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          message="执行失败"
          description={error}
          onClose={() => setError(null)}
        />
      ) : null}

      {running ? (
        <div style={{ textAlign: 'center', padding: 24, color: token.colorTextSecondary }}>
          <Spin /> <span style={{ marginLeft: 8 }}>{transcribing ? '正在转写本场录音…' : `正在执行 ${judge.category} 判定中…`}</span>
        </div>
      ) : null}

      {results.length > 0 ? (
        <div>
          {results.map((r) => (
            <Card
              key={r.id}
              size="small"
              title={
                <span style={{ fontSize: 13 }}>
                  {r.actionLabel}
                  {r.toolName === 'judge_speech' ? (
                    <span style={{ marginLeft: 8, color: token.colorTextSecondary, fontSize: 12 }}>
                      {STAGE_NAMES[stage ?? ''] ? `${STAGE_NAMES[stage ?? '']} · ` : ''}
                      {side === 'aff' ? '正方' : '反方'}稿
                    </span>
                  ) : null}
                  {r.toolName === 'judge_debate' ? (
                    <span style={{ marginLeft: 8, color: token.colorTextSecondary, fontSize: 12 }}>
                      正反方完整辩词
                    </span>
                  ) : null}
                </span>
              }
              style={{ marginBottom: 12 }}
            >
              <JudgeResultCardByTool toolName={r.toolName} result={r.result} />
            </Card>
          ))}
        </div>
      ) : null}

      {/* 评审历史（T3：只读查看 + 删除 + judge_match 写回该场；不在此页重新触发 LLM） */}
      <Card
        size="small"
        title={
          <span style={{ fontSize: 13 }}>
            评审历史
            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {boundMatchId ? '当前绑定的比赛场次' : '全部记录'}
            </Typography.Text>
          </span>
        }
        extra={
          <Button size="small" icon={<ExperimentOutlined />} loading={historyLoading} onClick={() => refreshHistory()}>
            刷新
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        {historyLoading && history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 12, color: token.colorTextSecondary }}>
            <Spin size="small" /> 加载中…
          </div>
        ) : history.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            暂无评审历史。裁判工具执行成功后会自动保存在这里，跨页面/重启保留。
          </Typography.Text>
        ) : (
          <div>
            {history.map((h) => {
              const expanded = expandedHistoryId === h.id
              const judgeLabel = judgeHistoryToolLabel(h.toolName)
              const canWriteBack = boundMatchId && judgeMatchCanWriteBack(h)
              const winnerLabel = canWriteBack
                ? (() => {
                    const v = (h.resultJson as { verdict?: { winner?: 'aff' | 'neg' } } | null)
                      ?.verdict?.winner
                    return v === 'aff' ? '正方胜' : '反方胜'
                  })()
                : ''
              return (
                <div
                  key={h.id}
                  style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 6,
                    padding: '8px 10px',
                    marginBottom: 8
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Typography.Link
                      style={{ fontSize: 13 }}
                      onClick={() => setExpandedHistoryId(expanded ? null : h.id)}
                    >
                      {expanded ? '收起' : '查看'}
                    </Typography.Link>
                    <Tag style={{ marginRight: 0, fontSize: 12 }}>{judgeLabel}</Tag>
                    {h.stage ? <Tag color="geekblue">{STAGE_NAMES[h.stage] ?? h.stage}</Tag> : null}
                    {h.side ? <Tag color={h.side === 'aff' ? 'blue' : 'orange'}>{h.side === 'aff' ? '正方' : '反方'}</Tag> : null}
                    {h.toolName === 'judge_match' && canWriteBack ? (
                      <Tag color="green">{winnerLabel}</Tag>
                    ) : null}
                    <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
                      {h.topic || '（未填写辩题）'}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {h.createdAt ? new Date(h.createdAt).toLocaleString() : ''}
                    </Typography.Text>
                    {h.toolName === 'judge_match' ? (
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        icon={<ThunderboltOutlined />}
                        disabled={!canWriteBack}
                        title={canWriteBack ? '写回该场 AI 评审（不覆盖人工赛果）' : '未绑定场次或该历史无有效判定'}
                        onClick={() => void handleWriteBackFromHistory(h)}
                      >
                        写回该场
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      danger
                      icon={<CloseOutlined />}
                      title="删除这条评审历史"
                      onClick={() => void handleDeleteHistory(h.id)}
                    />
                  </div>
                  {expanded ? (
                    <div style={{ marginTop: 6 }}>
                      <JudgeResultCardByTool toolName={h.toolName} result={h.resultJson} />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* 使用提示 */}
      {results.length === 0 && !running ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, textAlign: 'center', marginTop: 24 }}>
          填写辩题 → 选评委 → 粘贴稿子（可先「自动识别」环节）→ 点按钮执行。
          结果会展示在本区，可连续执行多个操作。
        </Typography.Paragraph>
      ) : null}
    </div>
  )
}
