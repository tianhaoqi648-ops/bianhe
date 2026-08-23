// ============================================================
// JudgeArena.tsx — 辩盒「三角色」备赛工作台（2026-08-23）
//
// 顶部 Tabs 切换三角色：
//   裁判 judge   ：双方评审（judge_debate）+ 整场评审（judge_match）/ 写回 / 导出，判分为准
//   陪练 sparring：回合制对练（simulate_opponent）——发起→对方攻击→用户答辩→下一轮→结束并汇总
//   复盘 coach    ：教练诊断（judge_speech）——四维短板 / 可练方向 / 示范改写，成长向不判分
//   detect_stage 仅作辅助小工具（放在裁判 Tab 角落），不出现在三角色主流程。
//
// 与 Agent 聊天流的关系：
//   - 聊天流：LLM 自主选工具（judge_* 等 5 工具已注册）
//   - 本页面：通过 agent:run-tool 直接调工具（白名单裁判工具），
//     结果卡片复用 judge-result-cards.tsx（与 ToolCallCard 同源）
//
// 设计要点：
//   - 无 apiKey 时全部按钮禁用（config 取 settingsStore.aiConfig）
//   - 同时只跑一个操作（running 状态 + 「取消」→ agent:cancel-tool）
//   - 历史区按当前角色过滤与标注（前端用工具名推导角色，不动 DB）
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  Tabs,
  Empty,
  Segmented,
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
  DownloadOutlined,
  FlagOutlined,
  AudioMutedOutlined
} from '@ant-design/icons'
import PageHeader from '../components/common/PageHeader'
import { JUDGES, SPARRING_DIFFICULTIES, getJudgeAnonLabel, type DebaterRole, type SparringDifficulty } from '../../../shared/ai-judges'
import { STAGE_DEFINITIONS, type DebateStageType } from '../../../shared/debate-stages'
import type {
  Event,
  Match,
  MatchAiReview,
  Round,
  SttEngine,
  SttSegment,
  JudgeHistoryRecord,
  JudgeHistoryCreateInput,
  JudgeHistoryFilter,
  BoundRecording
} from '../../../shared/types'
import { STT_ENGINE_KEY, STT_MODEL_KEY } from '../../../shared/types'
import { buildJudgeReplayHtml } from '../../../shared/replay-html'
import { useSettingsStore } from '../stores/settingsStore'
import { useToast } from '../hooks/useToast'
import {
  JudgeResultCardByTool,
  CoachReviewCard,
  CoachMatchCard,
  SparringFinalizeCard,
  LiveDebateFinalizeCard,
  STAGE_NAMES,
  type JudgeMatchResult,
  type CoachReviewResult,
  type CoachMatchResult,
  type SparringTurnResult,
  type SparringFinalizeResult,
  type LiveDebateFinalizeResult
} from '../components/agent/judge-result-cards'
import { useWavRecorder } from '../utils/useWavRecorder'
import { currentSpeech, type JudgeArenaFormState } from './judgeArenaLogic'
import {
  buildJudgeHistoryInput,
  judgeMatchCanWriteBack,
  mapJudgeMatchToMatchAiReview,
  judgeHistoryToolLabel,
  roleOfTool,
  JUDGE_ROLE_LABELS,
  type JudgeHistoryRole
} from './judgeHistoryLogic'
import {
  resolveJudgePreBind,
  type JudgePreBindIntent,
  type JudgePreBindSources
} from './judgePreBindLogic'
import RecordingBindPanel from '../components/agent/RecordingBindPanel'
import {
  withExists,
  missingRecordings,
  hasAvailableRecording,
  allRecordingsMissing,
  markersForRecording,
  assembleSegsFromTracks,
  orderByTs,
  filenameOf,
  labelOfRecording,
  type RecordingExistsMap,
  type TranscribedTrack
} from '../utils/matchRecordingKit'

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
  /** 源录音文件缺失占位（如实反映缺失态，不阻塞其余段评审） */
  missing?: boolean
  /** 来源录音 id */
  sourceId?: string
}

/** 陪练已完成的一个轮次（对方攻击 + 用户答辩） */
interface SparringRound {
  opponent: string
  reply: string
}

// ---------- 实时对辩（Task 4） ----------
/** 实时对辩环节 */
type LivePhase = 'constructive' | 'crossfire' | 'free' | 'summary'
/** 实时对辩已完成的一个轮次（环节 + 对方发言 + 用户回应） */
interface LiveRound {
  phase: LivePhase
  opponent: string
  userReply: string
}
/** 实时对辩环节顺序 */
const LIVE_PHASE_ORDER: LivePhase[] = ['constructive', 'crossfire', 'free', 'summary']
/** 实时对辩环节 → 展示名 */
const LIVE_PHASE_NAME: Record<LivePhase, string> = {
  constructive: '申论',
  crossfire: '质询',
  free: '自由辩论',
  summary: '总结'
}
/** 实时对辩：下一环节（已是最后一个则回到总结收敛） */
function nextLivePhase(phase: LivePhase): LivePhase {
  const idx = LIVE_PHASE_ORDER.indexOf(phase)
  if (idx < 0 || idx >= LIVE_PHASE_ORDER.length - 1) return 'summary'
  return LIVE_PHASE_ORDER[idx + 1]
}

/**
 * 评审风格说明（仅风格视角，不含任何人物身份/履历信息）。按 category 映射。
 */
const STYLE_BRIEFS: Record<string, string> = {
  攻防流: '聚焦交锋效率与攻防纪律：关注反驳是否到位、立论是否被有效拆解，对方未回应的观点视为成立',
  价值流: '重视价值立意与切入角度：能否重新定义辩题、刷新看待问题的视角，表达感染力权重较高',
  '价值+知识': '兼顾价值深度与知识含量：论证需有思维高度与视野广度，表达清晰有说服力',
  学理流: '强调立论的理论深度与独立思考：从概念与前提处检验论证是否站得住，注重风度与学养',
  建构流: '倡导知识增量型论证：论证应带来新认知而非重复存量，条理清晰、温和而有说服力'
}

/** 三角色 Tabs 配置 */
const ROLE_TABS: Array<{ key: DebaterRole; label: string; hint: string }> = [
  { key: 'judge', label: '裁判', hint: '判定正反胜负，五维对比评分' },
  { key: 'sparring', label: '陪练', hint: '回合制对抗，练防守与临场应变' },
  { key: 'coach', label: '复盘', hint: '教练诊断稿子短板，指明可练方向' }
]

/** 持方枚举 → 中文 */
function sideName(side: string | null | undefined): string {
  if (side === 'aff') return '正方'
  if (side === 'neg') return '反方'
  return ''
}

/** 把整场时间线组装为连续文本（供 整场整体粘贴 / 复盘 / 陪练上下文 复用） */
function timelineToText(timeline: MatchTimelineSeg[]): string {
  return timeline
    .map((seg, i) => {
      const stageLabel = seg.stageName || STAGE_NAMES[seg.stage ?? ''] || seg.stage || `第 ${i + 1} 段`
      const who = [sideName(seg.side), seg.speaker ?? ''].filter(Boolean).join('·')
      const head = [stageLabel, who].filter(Boolean).join('（')
      const content = seg.content.trim() === '' ? '' : seg.content.trim()
      if (content === '') return ''
      return head.trim() === '' ? content : `${head}）\n${content}`
    })
    .filter((s) => s !== '')
    .join('\n\n')
}

/** 依据发言人文本 + 场次头名/立场快照 推断归属阵营；识别不出返回 null */
function inferSideOfSpeaker(speaker: string | null | undefined, match: Match | null): 'aff' | 'neg' | null {
  const sp = (speaker ?? '').trim()
  if (sp === '') return null
  if (/正方|^aff|aff[·．.]/.test(sp)) return 'aff'
  if (/反方|^neg|neg[·．.]/.test(sp)) return 'neg'
  const keys: Array<{ side: 'aff' | 'neg'; keywords: string[] }> = [
    { side: 'aff', keywords: [match?.teamAffName ?? '', match?.stanceAff ?? ''] },
    { side: 'neg', keywords: [match?.teamNegName ?? '', match?.stanceNeg ?? ''] }
  ]
  for (const k of keys) {
    for (const kw of k.keywords) {
      if (kw && kw.trim() !== '' && sp.includes(kw.trim())) return k.side
    }
  }
  return null
}

/** 自动归边：把整场时间线中发言人可识别的段补上 side（保留已手动设置的 side） */
function autoAssignTimelineSides(timeline: MatchTimelineSeg[], match: Match | null): MatchTimelineSeg[] {
  return timeline.map((seg) => (seg.side != null ? seg : { ...seg, side: inferSideOfSpeaker(seg.speaker, match) }))
}

/** 组装整场复盘 Markdown（P0-3，原逻辑保留） */
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

  lines.push(`## 二、五维评分`)
  if (data?.dimensions && data.dimensions.length > 0) {
    lines.push(`| 维度 | 正方（${aff}） | 反方（${neg}） | 评语 |`)
    lines.push(`| --- | --- | --- | --- |`)
    data.dimensions.forEach((d) => {
      lines.push(
        `| ${d.name || d.key || '维度'} | ${d.affScore} | ${d.negScore} | ${(d.comment || '').replace(/\n/g, ' ')} |`
      )
    })
  } else {
    lines.push('> 暂无五维评分数据。')
  }
  lines.push('')

  lines.push(`## 三、逐环节点评`)
  if (data?.stageVerdicts && data.stageVerdicts.length > 0) {
    data.stageVerdicts.forEach((sv) => {
      const winLabel = sv.winner === 'aff' ? `正方（${aff}）` : sv.winner === 'neg' ? `反方（${neg}）` : '平局'
      lines.push(`### ${STAGE_NAMES[sv.stage] || sv.stage || '环节'}`)
      lines.push(`- 胜方：${winLabel}（置信度 ${sv.confidence != null ? Math.round(sv.confidence * 100) : '?'}%）`)
      if (sv.comment) lines.push(`- 点评：${sv.comment}`)
      lines.push('')
    })
  } else {
    lines.push('> 暂无逐环节点评数据。')
    lines.push('')
  }

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

/** 教练人设选择卡片（Judge/Coach/Sparring 共用选风格） */
function OpponentStylePicker({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (v: string) => void
  label: string
}): JSX.Element {
  const { token } = theme.useToken()
  return (
    <div>
      <Typography.Text strong style={{ fontSize: 13 }}>
        {label}
      </Typography.Text>
      <Radio.Group value={value} onChange={(e) => onChange(e.target.value)} style={{ display: 'block', marginTop: 6, marginBottom: 12 }}>
        {JUDGES.map((j) => {
          const brief = STYLE_BRIEFS[j.category] ?? ''
          const briefShort = brief.length > 58 ? `${brief.slice(0, 58)}…` : brief
          return (
            <div
              key={j.id}
              onClick={() => onChange(j.id)}
              title={[STYLE_BRIEFS[j.category] ?? '', j.judgePriorities?.top ? `最看重：${j.judgePriorities.top}` : '']
                .filter(Boolean)
                .join('\n')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 10px',
                marginBottom: 5,
                borderRadius: 6,
                border: `1px solid ${value === j.id ? token.colorPrimary : token.colorBorderSecondary}`,
                backgroundColor: value === j.id ? token.colorPrimaryBg : token.colorBgContainer,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <input type="radio" checked={value === j.id} onChange={() => onChange(j.id)} style={{ margin: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  {j.category}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', lineHeight: 1.5, marginTop: 2 }}>
                  {briefShort}
                </Typography.Text>
              </div>
            </div>
          )
        })}
      </Radio.Group>
    </div>
  )
}

/** 三角色统一的「块」分组（T5：输入来源 / 录音与转写 / 发起与结果） */
function RoleSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  const { token } = theme.useToken()
  return (
    <div
      style={{
        marginBottom: 14,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 8,
        padding: 10
      }}
    >
      <Typography.Text strong style={{ fontSize: 12, color: token.colorPrimary }}>
        {title}
      </Typography.Text>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  )
}

/** 三角色共用的「赛事-轮次-场次」绑定选择器（消除重复入口，T5） */
function EventBindingSelects({
  events,
  rounds,
  matchList,
  boundEventId,
  boundRoundId,
  boundMatchId,
  boundMatch,
  onEventChange,
  onRoundChange,
  onMatchChange
}: {
  events: Event[]
  rounds: Round[]
  matchList: Match[]
  boundEventId?: string
  boundRoundId?: string
  boundMatchId?: string
  boundMatch: Match | null
  onEventChange: (v?: string) => void
  onRoundChange: (v?: string) => void
  onMatchChange: (v?: string) => void
}): JSX.Element {
  const { token } = theme.useToken()
  return (
    <div>
      <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>赛事绑定</Typography.Text>
      <div style={{ display: 'flex', gap: 8, marginTop: 2, marginBottom: 4, flexWrap: 'wrap' }}>
        <Select allowClear placeholder="选择赛事" style={{ minWidth: 150 }} value={boundEventId}
          onChange={(v) => onEventChange(v)}
          options={events.map((e) => ({ value: e.id, label: e.name }))} />
        <Select allowClear placeholder="选择轮次" style={{ minWidth: 140 }} value={boundRoundId} disabled={!boundEventId}
          onChange={(v) => onRoundChange(v)}
          options={rounds.map((r) => ({ value: r.id, label: r.name || `第 ${r.round_number ?? '?'} 轮` }))} />
        <Select allowClear placeholder="选择场次" style={{ minWidth: 220 }} value={boundMatchId} disabled={!boundEventId}
          onChange={(v) => onMatchChange(v)}
          options={matchList.map((m) => ({ value: m.id, label: `${m.teamAffName ?? '正方'} vs ${m.teamNegName ?? '反方'}` }))} />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', color: token.colorTextSecondary, marginBottom: 4 }}>
        {boundMatch ? `已绑定场次：${boundMatch.teamAffName ?? '正方'} vs ${boundMatch.teamNegName ?? '反方'}` : '未绑定赛事/场次，结果仅就地查看'}
      </Typography.Text>
    </div>
  )
}

/** 未配置 API Key 的提示条（三角色共用） */
function ApiKeyAlert(): JSX.Element {
  return (
    <Alert type="warning" showIcon style={{ marginTop: 12 }} message="未配置 API Key"
      description="请先在设置页「AI 助手」中配置 LLM 连接，再使用该功能。" />
  )
}

export default function JudgeArena(): JSX.Element {
  const { token } = theme.useToken()

  // ---------- 三角色（当前 Tab） ----------
  const [activeRole, setActiveRole] = useState<DebaterRole>('judge')

  // ---------- 共享表单状态 ----------
  const [topic, setTopic] = useState('')
  const [judgeId, setJudgeId] = useState('hu-jianbiao')
  const [side, setSide] = useState<'aff' | 'neg'>('aff')
  const [stage, setStage] = useState<DebateStageType | undefined>(undefined)
  /** 裁判 Tab：整场评审(whole) / 分环节评审(stage) 两模式 */
  const [judgeMode, setJudgeMode] = useState<'whole' | 'stage'>('whole')

  // ---------- 裁判 Tab ----------
  const [affSpeech, setAffSpeech] = useState('')
  const [negSpeech, setNegSpeech] = useState('')
  /** 整场评审（手动无录音场景）：整体粘贴整场稿全文 */
  const [matchTranscript, setMatchTranscript] = useState('')
  const [results, setResults] = useState<ArenaResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [transcribing, setTranscribing] = useState(false)

  // ---------- 陪练 Tab ----------
  const [difficulty, setDifficulty] = useState<SparringDifficulty>('intermediate')
  const [sparringSpeech, setSparringSpeech] = useState('')
  /** 陪练可选整稿/整场上下文（注入 simulate_opponent，让对手针对整场内容攻击） */
  const [sparringContext, setSparringContext] = useState('')
  const [sparringRounds, setSparringRounds] = useState<SparringRound[]>([])
  /** 当前等待用户答辩的对方攻击 */
  const [currentAttack, setCurrentAttack] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sparringFinalize, setSparringFinalize] = useState<SparringFinalizeResult | null>(null)
  const sparringStarted = currentAttack !== null || sparringRounds.length > 0

  // ---------- 陪练 Tab：实时对辩（Task 4） ----------
  const [sparringMode, setSparringMode] = useState<'turn' | 'live'>('turn')
  /** 陪练/对辩环节范围：全程 或 指定环节（round 与 live 共用） */
  const [sparringScope, setSparringScope] = useState<'full' | LivePhase>('full')
  const [liveRounds, setLiveRounds] = useState<LiveRound[]>([])
  const [livePhase, setLivePhase] = useState<LivePhase>('constructive')
  const [liveOpponent, setLiveOpponent] = useState<LiveRound['opponent'] | null>(null)
  const [liveReply, setLiveReply] = useState('')
  const [liveTranscribing, setLiveTranscribing] = useState(false)
  const [liveFinalize, setLiveFinalize] = useState<LiveDebateFinalizeResult | null>(null)
  const liveStarted = liveOpponent !== null || liveRounds.length > 0
  const liveMic = useWavRecorder()

  // ---------- 复盘 Tab ----------
  const [coachSpeech, setCoachSpeech] = useState('')
  const [coachStage, setCoachStage] = useState<DebateStageType | undefined>(undefined)
  /** 复盘模式：全程（分环节，coach_match）/ 单环节手动（judge_speech） */
  const [coachMode, setCoachMode] = useState<'whole' | 'manual'>('whole')
  const [coachResult, setCoachResult] = useState<ArenaResult | null>(null)

  // ---------- 赛事绑定（T6.2） ----------
  const [events, setEvents] = useState<Event[]>([])
  const [rounds, setRounds] = useState<Round[]>([])
  const [matchList, setMatchList] = useState<Match[]>([])
  const [boundEventId, setBoundEventId] = useState<string | undefined>(undefined)
  const [boundRoundId, setBoundRoundId] = useState<string | undefined>(undefined)
  const [boundMatchId, setBoundMatchId] = useState<string | undefined>(undefined)
  const [boundMatch, setBoundMatch] = useState<Match | null>(null)
  const [timeline, setTimeline] = useState<MatchTimelineSeg[]>([])

  // ---------- 本场录音（多录音，T3 缺失态 / T4 多段组装） ----------
  const [recList, setRecList] = useState<BoundRecording[] | null>(null)
  const [recExists, setRecExists] = useState<RecordingExistsMap>({})
  const [recChecked, setRecChecked] = useState(false)

  const toast = useToast()

  // ---------- 评审历史（T3） ----------
  const [history, setHistory] = useState<JudgeHistoryRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null)

  // ---------- 配置 ----------
  const apiKey = useSettingsStore((s) => s.aiConfig.apiKey)
  const aiConfig = useSettingsStore((s) => s.aiConfig)
  const apiKeyConfigured = apiKey.length > 0

  // 当前选中风格（默认胡渐彪）
  const judge = useMemo(() => JUDGES.find((j) => j.id === judgeId) ?? JUDGES[0], [judgeId])

  // 按钮启用矩阵（裁判 Tab）
  const formState: JudgeArenaFormState = {
    topic,
    stage,
    side,
    affSpeech,
    negSpeech,
    apiKeyConfigured
  }
  const currentSpeechText = currentSpeech(formState)

  // 当前角色可用的历史（前端按工具名推导角色；detect_stage → helper，不在三角色主流程）
  const visibleHistory = useMemo(
    () => history.filter((h) => roleOfTool(h.toolName) === (activeRole as unknown as JudgeHistoryRole)),
    [history, activeRole]
  )

  // ---------- 赛事绑定逻辑（T6.2） ----------
  useEffect(() => {
    const w = window as unknown as { eventAPI?: { listEvents: (filter?: unknown) => Promise<{ success: boolean; data?: { items?: Event[] } }> } }
    const api = w.eventAPI
    if (!api) return
    void api
      .listEvents()
      .then((res) => {
        if (res.success && Array.isArray(res.data?.items)) setEvents(res.data?.items ?? [])
      })
      .catch(() => {
        // 忽略赛事加载失败
      })
  }, [])

  const location = useLocation()

  // ---------- 预绑定（T4） ----------
  const appliedPreBindRef = useRef(false)
  useEffect(() => {
    if (appliedPreBindRef.current) return
    const st = location.state as JudgePreBindIntent | null
    const sp = new URLSearchParams(location.search)
    const intent: JudgePreBindIntent = {
      eventId: st?.eventId ?? sp.get('eventId'),
      roundId: st?.roundId ?? sp.get('roundId'),
      matchId: st?.matchId ?? sp.get('matchId'),
      role: st?.role ?? (sp.get('role') as DebaterRole | undefined)
    }
    if (intent.role === 'judge' || intent.role === 'sparring' || intent.role === 'coach') {
      setActiveRole(intent.role)
    }
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
      if (!resolved.matchId || !resolved.boundMatch) return
      setBoundEventId(resolved.eventId ?? event.id)
      setBoundRoundId(resolved.roundId)
      setBoundMatchId(resolved.matchId)
      setBoundMatch(resolved.boundMatch)
      setTimeline([])
    })()
  }, [events, location])

  const boundMatchRef = useMemo(() => boundMatch, [boundMatch])

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

  const handleRoundChange = (val?: string): void => setBoundRoundId(val)

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
    setTimeline([])
  }

  /** 拉取本场录音列表并对每份做文件存在性校验（T3/T4）。绑定任意场次后自动调用。 */
  const loadMatchRecordings = useCallback(async (matchId: string): Promise<void> => {
    setRecList(null)
    setRecChecked(false)
    const w = window as unknown as {
      recordingAPI?: {
        listForMatch: (id: string) => Promise<{ success: boolean; data?: BoundRecording[] | null }>
        exists: (fp: string) => Promise<{ success: boolean; data?: boolean }>
      }
    }
    const api = w.recordingAPI
    if (!api) return
    try {
      const res = await api.listForMatch(matchId)
      const list = res.success && Array.isArray(res.data) ? res.data : null
      setRecList(list)
      // 逐份 exists 校验，确保缺失/被删除的引用如实反映（不再「filePath 存在即可用」）
      const map: Record<string, boolean> = {}
      if (list) {
        for (const r of list) {
          const e = await api.exists(r.filePath)
          map[r.id] = e.success ? !!e.data : true
        }
      }
      setRecExists(map)
    } finally {
      setRecChecked(true)
    }
  }, [])

  // 绑定场次变化 → 重载本场录音与存在性；解绑 → 清空
  useEffect(() => {
    if (boundMatchId) void loadMatchRecordings(boundMatchId)
    else {
      setRecList(null)
      setRecExists({})
      setRecChecked(false)
    }
  }, [boundMatchId, loadMatchRecordings])

  // ---------- 评审历史（T3） ----------
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

  const refreshHistory = useCallback((): void => {
    const api = judgeHistoryApi()
    if (!api) return
    setHistoryLoading(true)
    const filter: JudgeHistoryFilter | undefined = boundMatchId
      ? { eventId: boundEventId ?? null, roundId: boundRoundId ?? null, matchId: boundMatchId ?? null }
      : undefined
    api
      .listHistory(filter)
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setHistory(res.data ?? [])
      })
      .catch(() => {
        // 加载失败静默
      })
      .finally(() => setHistoryLoading(false))
  }, [judgeHistoryApi, boundEventId, boundRoundId, boundMatchId])

  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  /** 裁判工具成功结果自动落库（静默失败） */
  const saveResultHistory = (toolName: string, result: unknown): void => {
    const api = judgeHistoryApi()
    if (!api) return
    const speechTool =
      toolName === 'judge_speech' || toolName === 'coach_match' || toolName === 'simulate_opponent' || toolName === 'judge_live' || toolName === 'detect_stage'
    const input = buildJudgeHistoryInput({
      toolName,
      result,
      eventId: boundEventId ?? null,
      roundId: boundRoundId ?? null,
      matchId: boundMatchId ?? null,
      judgeId: judge.id,
      stage: toolName === 'judge_speech' || toolName === 'simulate_opponent' ? (stage ?? null) : null,
      side: speechTool ? side : null,
      topic: topic.trim() || boundMatchRef?.topicTitle || null
    })
    api
      .saveHistory(input)
      .then(() => refreshHistory())
      .catch(() => {
        // 落库失败静默忽略
      })
  }

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
    const w = window as unknown as { matchAPI?: { setAiReview: (id: string, r: MatchAiReview) => Promise<{ success: boolean; error?: string }> } }
    const res = await w.matchAPI?.setAiReview(boundMatchId, review)
    if (res?.success) {
      toast.success('AI 整场评审已写回该场（不覆盖人工赛果）')
    } else {
      toast.error(res?.error || 'AI 评审写回失败')
    }
  }

  const handleLoadMarkers = (): void => {
    const list = recList ?? []
    const items = withExists(list, recExists)
    if (!hasAvailableRecording(items)) {
      toast.warning(missingRecordings(items).length > 0 ? '本场录音文件已缺失/被删除，无法载入标记。请在「录音绑定」中重选或移除' : '该场暂无可用录音标记')
      return
    }
    const segs: MatchTimelineSeg[] = []
    let missingCount = 0
    for (const it of orderByTs(items)) {
      if (!it.exists) {
        missingCount++
        const missingSeg: MatchTimelineSeg = { stageName: labelOfRecording(it.recording), content: '', missing: true, sourceId: it.id }
        segs.push(missingSeg)
        continue
      }
      const marks = it.recording.markers ?? []
      if (marks.length === 0) {
        segs.push({ stageName: labelOfRecording(it.recording), content: '', sourceId: it.id })
      } else {
        for (const mk of marks) {
          segs.push({
            stage: mk.stageId || undefined,
            stageName: mk.stageName || undefined,
            side: mk.side ?? null,
            speaker: mk.speaker ?? null,
            tsMs: mk.tsMs,
            content: '',
            sourceId: it.id
          })
        }
      }
    }
    setTimeline(segs)
    toast.success(`已载入本场 ${segs.length} 段录音标记${missingCount > 0 ? `（${missingCount} 份缺失已跳过）` : ''}`)
  }

  /** 自动归边：按发言人/头名/立场 推断阵营，填充到时间线 side */
  const handleAutoAssignSides = (): void => {
    const next = autoAssignTimelineSides(timeline, boundMatchRef)
    setTimeline(next)
    const assigned = next.filter((t) => t.side != null).length
    toast.success(`已更新归边：${assigned}/${next.length} 段已归属正方或反方`)
  }

  /** 把本场时间线转写填入整体整场稿 / 复盘 / 陪练上下文 */
  const handleFillWholeText = (setter: (v: string) => void): void => {
    const text = timelineToText(timeline).trim()
    if (text === '') {
      toast.warning('本场时间线尚无可用转写内容（请先录音转文字或补各段文本）')
      return
    }
    setter(text)
    toast.success('已从本场整场转写填入')
  }

  /** 对指定录音文件执行 STT 转写：读取引擎配置 → 调 sttAPI.transcribe → 返回分段或 null（错误/空在内部提示） */
  const runRecordingTranscription = async (
    filePath: string,
    markers?: Array<{ stage: string; speaker?: string; atMs: number }>
  ): Promise<SttSegment[] | null> => {
    let engine: SttEngine | undefined
    let model: string | undefined
    try {
      engine = (await useSettingsStore.getState().get(STT_ENGINE_KEY)) as SttEngine | undefined
      model = (await useSettingsStore.getState().get(STT_MODEL_KEY)) as string | undefined
    } catch {
      // 读取失败忽略
    }
    setTranscribing(true)
    setError(null)
    try {
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
        filePath,
        markers,
        engine,
        model,
        aiConfig: { baseURL: aiConfig.baseURL, apiKey: aiConfig.apiKey, model: 'whisper-1' }
      })
      if (!res.success) {
        setError(`${res.error ?? '转写失败'}${effEngine.includes('api') ? '（如需本地转写，请到 设置→AI 转写 下载转写引擎）' : ''}`)
        return null
      }
      const segs = res.data ?? []
      if (segs.length === 0) {
        toast.warning('转写结果为空，请检查录音内容')
        return null
      }
      toast.success(`转写完成：${segs.length} 段（${effEngine === 'api' ? 'AI API' : effEngine === 'local' || effEngine === 'local-first(local)' ? '本地引擎' : 'AI API（本地引擎未装，已自动兜底）'}）`)
      return segs
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setTranscribing(false)
    }
  }

  /** 本场所有存在录音依次转写，按顺序归并组装时间线（T4 多段）；缺失份标缺失但不阻塞其余 */
  const handleTranscribeRecording = async (): Promise<void> => {
    const list = recList ?? []
    const items = withExists(list, recExists)
    if (!hasAvailableRecording(items)) {
      toast.warning(missingRecordings(items).length > 0 ? '本场录音文件已缺失/被删除，无法转写。请在「录音绑定」中重选或移除' : '该场暂未绑定录音，请先在「录音绑定」中添加')
      setTimeline([])
      return
    }
    const tracks: TranscribedTrack[] = []
    const ordered = orderByTs(items)
    for (const it of ordered) {
      if (!it.exists) {
        tracks.push({ recording: it.recording, missing: true })
        continue
      }
      const segs = await runRecordingTranscription(it.recording.filePath, markersForRecording(it.recording))
      if (!segs) {
        toast.warning(`「${filenameOf(it.recording.filePath)}」转写出错，已跳过（不影响其余录音）`)
        continue
      }
      tracks.push({ recording: it.recording, segs })
    }
    const assembled = assembleSegsFromTracks(tracks).map((s): MatchTimelineSeg => ({
      stage: s.stage,
      stageName: s.stageName,
      side: s.side ?? null,
      speaker: s.speaker ?? null,
      tsMs: s.tsMs,
      content: s.content,
      missing: s.missing,
      sourceId: s.sourceId
    }))
    const usable = assembled.filter((t) => !t.missing)
    if (assembled.length === 0) {
      toast.warning('转写结果为空，请检查录音内容')
      setTimeline([])
      return
    }
    setTimeline(assembled)
    toast.success(`已按 ${usable.length} 份录音组装整场时间线（${assembled.filter((t) => t.content.trim() !== '').length} 段有内容${assembled.some((t) => t.missing) ? '，缺失部分已跳过' : ''}）`)
  }

  /** 复盘：把本场所有存在录音依次转写、归并填入 coachSpeech（缺失份跳过） */
  const handleCoachTranscribeRecording = async (): Promise<void> => {
    const list = recList ?? []
    const items = withExists(list, recExists)
    if (!hasAvailableRecording(items)) {
      toast.warning(missingRecordings(items).length > 0 ? '本场录音已缺失/被删除，无法转写' : '该场暂未绑定录音，请先在「录音绑定」中添加')
      return
    }
    let text = ''
    let usableCount = 0
    let missingCount = 0
    for (const it of orderByTs(items)) {
      if (!it.exists) {
        missingCount++
        continue
      }
      const segs = await runRecordingTranscription(it.recording.filePath, markersForRecording(it.recording))
      if (!segs) continue
      usableCount++
      text += (segs.map((s) => s.text).filter(Boolean).join('').trim()) + '\n'
    }
    const finalText = text.trim()
    if (finalText === '') {
      toast.warning('转写结果为空，请检查录音内容')
      return
    }
    setCoachSpeech(finalText)
    toast.success(`本场录音已按 ${usableCount} 份转入复盘${missingCount > 0 ? `（${missingCount} 份缺失已跳过）` : ''}`)
  }

  /** 复盘：选择本地音频文件（wav/mp3/m4a/flac）直转录写填入 coachSpeech */
  const handlePickRecordingTranscribe = async (): Promise<void> => {
    const w = window as unknown as {
      fileAPI?: {
        pickFile: (f: Array<{ name: string; extensions: string[] }>) => Promise<{ success: boolean; data?: string | null; error?: string }>
      }
    }
    const fileAPI = w.fileAPI
    if (!fileAPI) {
      setError('文件服务未就绪（window.fileAPI 不可用）')
      return
    }
    try {
      const picked = await fileAPI.pickFile([{ name: '录音文件', extensions: ['wav', 'mp3', 'm4a', 'flac'] }])
      if (!picked.success) {
        setError(picked.error ?? '选择录音文件失败')
        return
      }
      if (!picked.data) return
      const segs = await runRecordingTranscription(picked.data)
      if (!segs) return
      const text = segs.map((s) => s.text).filter(Boolean).join('').trim()
      setCoachSpeech(text)
      toast.success('所选录音已转写并填入复盘内容')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleTimelineContent = (index: number, value: string): void => {
    setTimeline((prev) => prev.map((t, i) => (i === index ? { ...t, content: value } : t)))
  }

  // ---------- 裁判 / 整场：工具执行 ----------

  /** 执行一个裁判工具（results 归裁判 Tab；写历史） */
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
      const res = await api.runTool({ toolName, args, config: aiConfig })
      if (res.success) {
        setResults((prev) => [...prev, { id: `${toolName}-${Date.now()}`, toolName, actionLabel, result: res.data }])
        saveResultHistory(toolName, res.data)
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

  const handleJudgeDebate = (): void => {
    void runJudge('judge_debate', { topic: topic.trim(), affSpeech, negSpeech, judgeId }, '双方评审')
  }

  const handleJudgeMatch = async (): Promise<void> => {
    const filled = timeline.filter((t) => t.content.trim() !== '')
    const transcript = matchTranscript.trim()
    if (filled.length === 0 && transcript === '') {
      toast.warning('请先为时间线补充转文字，或在「整体粘贴整场稿」中粘贴全文，再发起整场评审')
      return
    }
    const baseTopic = boundMatchRef?.topicTitle ?? topic.trim() ?? `${boundMatchRef?.teamAffName ?? '正方'} vs ${boundMatchRef?.teamNegName ?? '反方'}`
    const segs = filled.map((t) => ({ stage: t.stage, stageName: t.stageName, side: t.side ?? undefined, speaker: t.speaker ?? undefined, tsMs: t.tsMs, content: t.content }))
    const args: Record<string, unknown> = { topic: baseTopic, judgeId }
    if (segs.length > 0) {
      args.timeline = segs
    } else {
      args.transcript = transcript
    }
    await runJudge('judge_match', args, '整场评审')
  }

  const handleDetectStage = (): void => {
    void runJudge('detect_stage', { speech: currentSpeechText, topic: topic.trim() }, '环节识别')
  }

  /** 分环节评审：单方复盘便利（judge_speech 可选，结果写入裁判结果区） */
  const handleJudgeSingleReview = (): void => {
    const speech = currentSpeech(formState).trim()
    if (speech === '') {
      toast.warning('请先填写要复盘的单方稿（正方/反方）')
      return
    }
    void runJudge('judge_speech', { topic: topic.trim(), stage, side, speech, judgeId }, '单方复盘')
  }

  const lastJudgeMatchResult = useMemo<unknown | null>(() => {
    for (let i = results.length - 1; i >= 0; i--) {
      const r = results[i]
      if (r.toolName === 'judge_match' && !r.error) return r.result
    }
    return null
  }, [results])

  const handleWriteBack = async (): Promise<void> => {
    if (!boundMatchId) { toast.warning('未绑定场次，无法写回'); return }
    if (!lastJudgeMatchResult || typeof lastJudgeMatchResult !== 'object') {
      toast.warning('尚未执行整场评审（judge_match），请先执行后再写回'); return
    }
    const source: MatchAiReview['source'] = timeline.some((t) => t.content.trim() !== '') ? 'recording' : 'transcript'
    const review = mapJudgeMatchToMatchAiReview(lastJudgeMatchResult, source)
    if (!review) { toast.warning('本次整场评审素材不足、无法判定，暂无有效赛果可写回'); return }
    const w = window as unknown as { matchAPI?: { setAiReview: (id, r) => Promise<{ success: boolean; error?: string }> } }
    const res = await w.matchAPI?.setAiReview(boundMatchId, review)
    if (res?.success) toast.success('AI 整场评审已写回该场（不覆盖人工赛果）')
    else toast.error(res?.error || 'AI 评审写回失败')
  }

  const handleExportReport = async (): Promise<void> => {
    if (!lastJudgeMatchResult) { toast.warning('请先完成整场评审（judge_match），再导出复盘'); return }
    const { content, defaultName } = buildJudgeReportMarkdown(
      timeline,
      lastJudgeMatchResult,
      boundMatchRef?.teamAffName,
      boundMatchRef?.teamNegName,
      boundMatchRef?.topicTitle
    )
    const w = window as unknown as { reportAPI?: { exportJudge: (req: { defaultName: string; content: string }) => Promise<{ success: boolean; data?: { filePath: string } | null; error?: string }> } }
    const api = w.reportAPI
    if (!api) { toast.error('导出服务未就绪（window.reportAPI 不可用）'); return }
    try {
      const res = await api.exportJudge({ defaultName, content })
      if (!res.success) { toast.error(res.error ?? '导出复盘报告失败'); return }
      if (res.data?.filePath) toast.success(`复盘报告已导出：${res.data.filePath}`)
    } catch (e) {
      toast.error(`导出复盘报告失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleExportReviewHtml = async (): Promise<void> => {
    if (!lastJudgeMatchResult) { toast.warning('请先完成整场评审（judge_match），再导出复盘'); return }
    const { content, defaultName } = buildJudgeReplayHtml(
      timeline,
      lastJudgeMatchResult,
      boundMatchRef?.teamAffName,
      boundMatchRef?.teamNegName,
      boundMatchRef?.topicTitle
    )
    const w = window as unknown as { reportAPI?: { exportJudgeHtml: (req: { defaultName: string; content: string }) => Promise<{ success: boolean; data?: { filePath: string } | null; error?: string }> } }
    const api = w.reportAPI
    if (!api) { toast.error('导出服务未就绪（window.reportAPI 不可用）'); return }
    try {
      const res = await api.exportJudgeHtml({ defaultName, content })
      if (!res.success) { toast.error(res.error ?? '导出 HTML 复盘失败'); return }
      if (res.data?.filePath) toast.success(`HTML 复盘已导出：${res.data.filePath}`)
    } catch (e) {
      toast.error(`导出 HTML 复盘失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleCancel = (): void => {
    const api = getAgentAPI()
    if (api) void api.cancelTool().catch(() => {})
    setRunning(false)
  }

  // ---------- 陪练：回合制执行 ----------

  /** 通用：调 simulate_opponent（回合制 turn/finalize 共用） */
  const runSparringCall = async (
    args: Record<string, unknown>,
    onSuccess: (data: unknown) => void,
    onError: (msg: string) => void
  ): Promise<void> => {
    if (running) return
    const api = getAgentAPI()
    if (!api) { onError('Agent 服务未就绪（window.agent 不可用）'); return }
    setRunning(true)
    setError(null)
    try {
      const res = await api.runTool({ toolName: 'simulate_opponent', args, config: aiConfig })
      if (res.success) {
        saveResultHistory('simulate_opponent', res.data)
        onSuccess(res.data)
      } else {
        onError(res.message ?? `工具执行失败（${res.code ?? 'unknown'}）`)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  /** 发起 / 下一轮：追加历史后可拿到新一轮攻击 */
  const proceedSparringRound = (completed: SparringRound[]): Promise<SparringTurnResult> =>
    new Promise<SparringTurnResult>((resolve, reject) => {
      void runSparringCall(
        {
          topic: topic.trim(),
          side,
          speech: sparringSpeech.trim(),
          judgeId,
          difficulty,
          context: sparringContext.trim() || undefined,
          history: completed.length > 0 ? completed : undefined,
          scope: sparringScope === 'full' ? undefined : sparringScope
        },
        (data) => {
          const d = data as SparringTurnResult
          if (d && d.mode === 'sparring_turn') resolve(d)
          else reject(new Error('陪练返回格式异常'))
        },
        reject
      )
    })

  /** 发起陪练（第一轮） */
  const handleSparringStart = (): void => {
    if (sparringStarted) {
      setSparringRounds([])
      setCurrentAttack(null)
      setReplyText('')
      setSparringFinalize(null)
    }
    void (async () => {
      try {
        const turn = await proceedSparringRound([])
        setCurrentAttack(turn.opponentAttack)
        setSparringRounds([])
        setSparringFinalize(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  /** 答辩 + 下一轮 */
  const handleSparringNext = (): void => {
    const reply = replyText.trim()
    if (reply === '') { toast.warning('请先填写你的答辩，再进入下一轮'); return }
    if (!currentAttack) return
    const completed: SparringRound[] = [...sparringRounds, { opponent: currentAttack, reply }]
    void (async () => {
      try {
        const turn = await proceedSparringRound(completed)
        setSparringRounds(completed)
        setCurrentAttack(turn.opponentAttack)
        setReplyText('')
        setSparringFinalize(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  /** 结束并汇总 */
  const handleSparringFinalize = (): void => {
    if (!currentAttack && sparringRounds.length === 0) { toast.warning('尚无对抗内容可汇总'); return }
    const reply = replyText.trim()
    const completed: SparringRound[] =
      currentAttack !== null
        ? [...sparringRounds, { opponent: currentAttack, reply: reply || '（未答辩）' }]
        : sparringRounds
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          runSparringCall(
            {
              topic: topic.trim(),
              side,
              speech: sparringSpeech.trim(),
              judgeId,
              difficulty,
              context: sparringContext.trim() || undefined,
              history: completed,
              finalize: true,
              scope: sparringScope === 'full' ? undefined : sparringScope
            },
            (data) => {
              setSparringFinalize(data as SparringFinalizeResult)
              setSparringRounds(completed)
              setCurrentAttack(null)
              setReplyText('')
              resolve()
            },
            reject
          )
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  // ---------- 陪练 Tab：实时对辩执行（Task 4） ----------

  /** 通用：调 judge_live（换轮/汇总共用，写历史 toolName=judge_live） */
  const runLiveCall = async (
    args: Record<string, unknown>,
    onSuccess: (data: unknown) => void,
    onError: (msg: string) => void
  ): Promise<void> => {
    if (running) return
    const api = getAgentAPI()
    if (!api) { onError('Agent 服务未就绪（window.agent 不可用）'); return }
    setRunning(true)
    setError(null)
    try {
      const res = await api.runTool({ toolName: 'judge_live', args, config: aiConfig })
      if (res.success) {
        saveResultHistory('judge_live', res.data)
        onSuccess(res.data)
      } else {
        onError(res.message ?? `工具执行失败（${res.code ?? 'unknown'}）`)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  /** 发起实时对辩（第一轮，环节=申论；指定环节范围时直接进入该环节） */
  const handleLiveStart = (): void => {
    const startPhase = sparringScope === 'full' ? 'constructive' : sparringScope
    if (liveStarted) {
      setLiveRounds([])
      setLiveOpponent(null)
      setLiveReply('')
      setLiveFinalize(null)
      setLivePhase(startPhase)
    }
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          runLiveCall(
            {
              topic: topic.trim(),
              side,
              speech: sparringSpeech.trim(),
              judgeId,
              difficulty,
              context: sparringContext.trim() || undefined,
              phase: startPhase,
              history: undefined,
              scope: sparringScope === 'full' ? undefined : sparringScope
            },
            (data) => {
              const d = data as { speech?: string }
              setLivePhase(startPhase)
              setLiveOpponent(typeof d.speech === 'string' ? d.speech : '')
              setLiveRounds([])
              setLiveFinalize(null)
              resolve()
            },
            reject
          )
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  /** 实时对辩语音输入：点击开始录音，再点停止并转文字（录音期间按钮呈锁定态） */
  const handleLiveMicToggle = async (): Promise<void> => {
    // 正在转写或在录音中 → 停止并转文字
    if (liveMic.recording) {
      const payload = await liveMic.stop()
      if (!payload || payload.data.byteLength === 0) {
        toast.warning('未录到有效录音，请重试')
        return
      }
      // 落盘临时 wav → 复用 sttAPI.transcribe（wav 无标记 → 整段转写为一段文本）
      setLiveTranscribing(true)
      setError(null)
      try {
        const saved = await window.recordingAPI.save(`live-${Date.now()}.wav`, payload.data)
        if (!saved.success || !saved.data?.path) {
          setError(saved.error ?? '录音保存失败，无法转写')
          return
        }
        const engine = (await useSettingsStore.getState().get(STT_ENGINE_KEY)) as SttEngine | undefined
        const model = (await useSettingsStore.getState().get(STT_MODEL_KEY)) as string | undefined
        const res = await window.sttAPI.transcribe({
          filePath: saved.data.path,
          engine,
          model,
          aiConfig: { baseURL: aiConfig.baseURL, apiKey: aiConfig.apiKey, model: 'whisper-1' }
        })
        if (!res.success) {
          setError(`${res.error ?? '语音转文字失败'}（可改为手动输入文本）`)
          return
        }
        const text = (res.data ?? []).map((s) => s.text).filter(Boolean).join('').trim()
        if (text === '') {
          toast.warning('未能识别出有效语音内容，可改为手动输入')
          return
        }
        setLiveReply(text)
        toast.success('语音已转文字')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLiveTranscribing(false)
      }
      return
    }
    // 开始录音
    if (liveTranscribing) {
      toast.warning('正在处理上一段语音，请稍候')
      return
    }
    const ok = await liveMic.start()
    if (!ok && liveMic.error) {
      setError(liveMic.error)
      return
    }
  }

  /** 下一轮 / 推进到下一环节：把本轮回应追加进历史，再让对手按新环节发言 */
  const handleLiveNext = (): void => {
    const reply = liveReply.trim()
    if (reply === '') { toast.warning('请先输入或录制你的回应（文本或语音），再进入下一轮'); return }
    if (!liveOpponent) return
    const completed: LiveRound[] = [...liveRounds, { phase: livePhase, opponent: liveOpponent, userReply: reply }]
    // 指定环节范围时锁定该环节（不自动推进），否则正常推进到下一环节
    const nextPhase: LivePhase = sparringScope === 'full' ? nextLivePhase(livePhase) : sparringScope
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          runLiveCall(
            {
              topic: topic.trim(),
              side,
              speech: sparringSpeech.trim(),
              judgeId,
              difficulty,
              context: sparringContext.trim() || undefined,
              phase: nextPhase,
              history: completed,
              scope: sparringScope === 'full' ? undefined : sparringScope
            },
            (data) => {
              const d = data as { phase?: LivePhase; speech?: string }
              setLiveRounds(completed)
              setLivePhase((d.phase && LIVE_PHASE_ORDER.includes(d.phase) ? d.phase : nextPhase))
              setLiveOpponent(typeof d.speech === 'string' ? d.speech : '')
              setLiveReply('')
              setLiveFinalize(null)
              resolve()
            },
            reject
          )
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  /** 结束实时对辩并汇总（对抗要点卡片） */
  const handleLiveFinalize = (): void => {
    if (!liveOpponent && liveRounds.length === 0) { toast.warning('尚无对抗内容可汇总'); return }
    const reply = liveReply.trim()
    const completed: LiveRound[] =
      liveOpponent !== null
        ? [...liveRounds, { phase: livePhase, opponent: liveOpponent, userReply: reply || '（未作答）' }]
        : liveRounds
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          runLiveCall(
            {
              topic: topic.trim(),
              side,
              speech: sparringSpeech.trim(),
              judgeId,
              difficulty,
              context: sparringContext.trim() || undefined,
              history: completed,
              finalize: true,
              scope: sparringScope === 'full' ? undefined : sparringScope
            },
            (data) => {
              setLiveFinalize(data as LiveDebateFinalizeResult)
              setLiveRounds(completed)
              setLiveOpponent(null)
              setLiveReply('')
              resolve()
            },
            reject
          )
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  /** 上传单方稿文件 → 填入当前"稿子"输入 */
  const handleUploadSpeech = (setter: (v: string) => void): void => {
    void (async () => {
      const w = window as unknown as {
        fileAPI?: {
          pickFile: (f: Array<{ name: string; extensions: string[] }>) => Promise<{ success: boolean; data?: string | null; error?: string }>
          readTextFile: (fp: string) => Promise<{ success: boolean; data?: string; error?: string }>
        }
      }
      const fileAPI = w.fileAPI
      if (!fileAPI) { setError('文件服务未就绪（window.fileAPI 不可用）'); return }
      try {
        const picked = await fileAPI.pickFile([{ name: '辩词文本', extensions: ['txt', 'md', 'docx'] }])
        if (!picked.success) { setError(picked.error ?? '选择文件失败'); return }
        if (!picked.data) return
        const read = await fileAPI.readTextFile(picked.data)
        if (!read.success) { setError(read.error ?? '读取文件失败'); return }
        setter(read.data ?? '')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  // ---------- 复盘：教练诊断执行 ----------
  const handleCoachReview = (): void => {
    if (coachSpeech.trim() === '') { toast.warning('请先粘贴要复盘的单方稿/内容'); return }
    if (running) return
    const api = getAgentAPI()
    if (!api) { setError('Agent 服务未就绪（window.agent 不可用）'); return }
    setRunning(true)
    setError(null)
    void api
      .runTool({
        toolName: 'judge_speech',
        args: { topic: topic.trim(), stage: coachStage, side, speech: coachSpeech.trim(), judgeId },
        config: aiConfig
      })
      .then((res) => {
        if (res.success) {
          setCoachResult({ id: `judge_speech-${Date.now()}`, toolName: 'judge_speech', actionLabel: '教练复盘', result: res.data })
          saveResultHistory('judge_speech', res.data)
        } else {
          setError(res.message ?? `工具执行失败（${res.code ?? 'unknown'}）`)
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRunning(false))
  }

  // ---------- 复盘：整场分环节执行（coach_match） ----------
  const handleCoachMatch = (): void => {
    if (running) return
    const api = getAgentAPI()
    if (!api) { setError('Agent 服务未就绪（window.agent 不可用）'); return }
    // 输入来源：优先本场时间线（按环节拆分），否则回退 coachSpeech 整稿
    const tl = timeline.filter((t) => t.content.trim() !== '')
    const timelineArgs =
      tl.length > 0
        ? tl.map((s) => ({
            stage: s.stage,
            stageName: s.stageName,
            side: s.side ?? undefined,
            speaker: s.speaker ?? undefined,
            tsMs: s.tsMs,
            content: s.content
          }))
        : undefined
    const transcriptArg = timelineArgs ? undefined : (coachSpeech.trim() || undefined)
    if (!timelineArgs && !transcriptArg) {
      toast.warning('请先粘贴整场内容（或载入本场录音转写）再执行全程分环节复盘')
      return
    }
    setRunning(true)
    setError(null)
    void api
      .runTool({
        toolName: 'coach_match',
        args: {
          topic: topic.trim(),
          side,
          judgeId,
          timeline: timelineArgs,
          transcript: transcriptArg
        },
        config: aiConfig
      })
      .then((res) => {
        if (res.success) {
          setCoachResult({ id: `coach_match-${Date.now()}`, toolName: 'coach_match', actionLabel: '整场分环节复盘', result: res.data })
          saveResultHistory('coach_match', res.data)
        } else {
          setError(res.message ?? `工具执行失败（${res.code ?? 'unknown'}）`)
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRunning(false))
  }

  const canJudgeDebate = topic.trim() !== '' && affSpeech.trim() !== '' && negSpeech.trim() !== '' && apiKeyConfigured
  const canDetectStage = currentSpeechText.trim() !== '' && apiKeyConfigured
  const canSparringStart = topic.trim() !== '' && sparringSpeech.trim() !== '' && apiKeyConfigured
  const canLiveStart = topic.trim() !== '' && apiKeyConfigured
  /** 单环节手动（judge_speech）：需辩题 + 粘贴稿 */
  const canCoachSingle = topic.trim() !== '' && coachSpeech.trim() !== '' && apiKeyConfigured
  /** 全程分环节（coach_match）：需辩题 + 时间线有转写 或 粘贴整场稿 */
  const canCoachWhole =
    topic.trim() !== '' &&
    (timeline.some((t) => t.content.trim() !== '') || coachSpeech.trim() !== '') &&
    apiKeyConfigured
  const canCoach = coachMode === 'whole' ? canCoachWhole : canCoachSingle

  // ---------- 本场录音派生状态（T3 缺失态） ----------
  const recItems = useMemo(() => withExists(recList ?? [], recExists), [recList, recExists])
  const recHasAvailable = useMemo(() => hasAvailableRecording(recItems), [recItems])
  const recMissingCount = useMemo(() => missingRecordings(recItems).length, [recItems])
  const recAllMissing = useMemo(() => allRecordingsMissing(recItems), [recItems])
  /** 本场全部录音的环节/发言人标记总数（「载入本场录音标记」按钮标注用） */
  const recMarkerCount = useMemo(() => (recList ?? []).reduce((n, r) => n + (r.markers?.length ?? 0), 0), [recList])

  // ---------- 渲染 ----------
  return (
    <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
      <PageHeader title="辩盒 · 备赛工作台" subtitle="裁判判定 · 陪练对战 · 复盘打磨，三角色一个入口" />

      <Tabs
        activeKey={activeRole}
        onChange={(k) => setActiveRole(k as DebaterRole)}
        items={ROLE_TABS.map((t) => ({
          key: t.key,
          label: (
            <span>
              {t.label}
              <span style={{ marginLeft: 6, fontSize: 12, color: activeRole === t.key ? 'inherit' : token.colorTextTertiary }}>
                {t.hint}
              </span>
            </span>
          )
        }))}
      />

      {/* ================= 裁判 Tab ================= */}
      {activeRole === 'judge' ? (
        <div>
          <RoleSection title="输入来源">
            <Segmented
              value={judgeMode}
              onChange={(v) => setJudgeMode(v as 'whole' | 'stage')}
              options={[
                { value: 'whole', label: '整场评审' },
                { value: 'stage', label: '分环节评审' }
              ]}
              style={{ marginBottom: 10 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10, lineHeight: 1.6 }}>
              {judgeMode === 'whole'
                ? '整场评审：载入本场录音与转写 → 自动归边，或直接整体粘贴整场稿全文，由 AI 裁判整场判定胜负与五维。'
                : '分环节评审：选定或自动识别环节后，分别粘贴该环节的正方稿 / 反方稿判定胜负与五维；可选追加「单方复盘」。'}
            </Typography.Text>

            <EventBindingSelects
              events={events}
              rounds={rounds}
              matchList={matchList}
              boundEventId={boundEventId}
              boundRoundId={boundRoundId}
              boundMatchId={boundMatchId}
              boundMatch={boundMatch}
              onEventChange={(v) => void handleEventChange(v)}
              onRoundChange={handleRoundChange}
              onMatchChange={(v) => handleMatchChange(v)}
            />

            <div style={{ marginTop: 10 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>辩题</Typography.Text>
              <Input placeholder="输入辩题，如：网络让人更亲近还是更疏远" value={topic}
                onChange={(e) => setTopic(e.target.value)} style={{ marginTop: 6, marginBottom: 10 }} />
            </div>

            {judgeMode === 'stage' ? (
              <div style={{ marginBottom: 8 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>环节</Typography.Text>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <Select allowClear placeholder="选择环节类型" style={{ minWidth: 200, flex: 1 }} value={stage}
                    onChange={(v) => setStage(v as DebateStageType | undefined)}
                    options={STAGE_DEFINITIONS.map((s) => ({ value: s.type, label: `${s.name}（${s.description}）` }))} />
                  <Button icon={<ThunderboltOutlined />} disabled={!canDetectStage || running} onClick={handleDetectStage}>自动识别</Button>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                  「自动识别」为辅助工具，仅用于辨识稿子所属环节。
                </Typography.Text>
              </div>
            ) : null}

            <OpponentStylePicker value={judgeId} onChange={setJudgeId} label="评委风格（判定口径）" />
            {!apiKeyConfigured ? <ApiKeyAlert /> : null}
          </RoleSection>

          {judgeMode === 'whole' ? (
            <RoleSection title="录音与转写">
              {boundMatch ? (
                <>
                  <RecordingBindPanel
                    matchId={boundMatch.id}
                    recordings={recList}
                    existsMap={recExists}
                    busy={running || transcribing}
                    onChanged={() => { if (boundMatchId) void loadMatchRecordings(boundMatchId) }}
                  />

                  {recChecked && recMissingCount > 0 && !recAllMissing ? (
                    <Alert type="warning" showIcon style={{ marginTop: 8 }} message={`本场有 ${recMissingCount} 份录音缺失/已删除`}
                      description="缺失部分不影响其余份的载入/转写；可在上方「录音绑定」中重选或移除缺失项后再操作。" />
                  ) : null}
                  {recChecked && recAllMissing ? (
                    <Alert type="error" showIcon style={{ marginTop: 8 }} message="本场录音文件全部缺失/已删除"
                      description="相关录音功能已禁用。请在「录音绑定」中重新选择或移除缺失项，或改用下方「整体粘贴整场稿」。" />
                  ) : null}

                  <Space wrap style={{ marginTop: 10 }}>
                    <Button disabled={running || transcribing || !recChecked || !recHasAvailable} onClick={handleLoadMarkers} icon={<UploadOutlined />}>
                      {recMarkerCount > 0 ? `载入本场录音标记（${recMarkerCount} 段）` : '载入本场录音标记'}
                    </Button>
                    <Button type="primary" loading={transcribing} disabled={transcribing || running || !recChecked || !recHasAvailable}
                      onClick={() => void handleTranscribeRecording()} icon={<AudioOutlined />}>
                      {recHasAvailable ? '本场录音转文字' : '本场无可用录音'}
                    </Button>
                    <Button disabled={running || transcribing || timeline.length === 0} onClick={handleAutoAssignSides} icon={<AimOutlined />}>
                      自动归边
                    </Button>
                    <Button disabled={running || transcribing || timeline.length === 0} onClick={() => handleFillWholeText(setMatchTranscript)} icon={<DownloadOutlined />}>
                      转写填入整场稿
                    </Button>
                  </Space>

                  {recChecked && recList !== null && recList.length === 0 ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                      该场暂未绑定录音，可在上方「录音绑定」添加，或改用下方「整体粘贴整场稿」评审。
                    </Typography.Text>
                  ) : null}

                  {timeline.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                        整场时间线（补充各段转文字；「自动归边」可把发言归属到正方/反方，也可在右侧手动改）
                      </Typography.Text>
                      {timeline.map((seg, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6, fontSize: 12 }}>
                          <div style={{ minWidth: 118, paddingTop: 5 }}>
                            <Tag color={seg.missing ? 'red' : undefined}>{seg.missing ? '缺失' : seg.stageName || seg.stage || `段 ${i + 1}`}</Tag>
                            <Select
                              allowClear
                              size="small"
                              style={{ width: 72, marginTop: 4 }}
                              placeholder="归边"
                              value={seg.side ?? undefined}
                              disabled={seg.missing}
                              onChange={(v) => {
                                const sv = v as 'aff' | 'neg' | null | undefined
                                const nt = timeline.map((t, j) => (j === i ? { ...t, side: sv === 'aff' || sv === 'neg' ? sv : null } : t))
                                setTimeline(nt)
                              }}
                              options={[ { value: 'aff', label: '正方' }, { value: 'neg', label: '反方' } ]}
                            />
                            <div style={{ color: token.colorTextSecondary, fontSize: 11, lineHeight: 1.4 }}>
                              {[seg.side === 'aff' ? '正方' : seg.side === 'neg' ? '反方' : '', seg.missing ? '缺失' : seg.speaker ?? ''].filter(Boolean).join(' · ')}
                              {seg.tsMs != null ? ` · ${Math.round(seg.tsMs / 1000)}s` : ''}
                            </div>
                          </div>
                          <Input.TextArea rows={2} value={seg.content} placeholder={seg.missing ? '（录音缺失，此段占位，可手动粘贴内容）' : '粘贴该段转文字…'} onChange={(e) => handleTimelineContent(i, e.target.value)} style={{ flex: 1, fontSize: 12 }} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  未绑定场次时不提供录音转写；可在下方「整体粘贴整场稿」评审。
                </Typography.Text>
              )}
            </RoleSection>
          ) : null}

          <RoleSection title="发起与结果">
            {judgeMode === 'whole' ? (
              <>
                <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>整体粘贴整场稿（无录音场景）</Typography.Text>
                <Input.TextArea rows={5} placeholder="粘贴整场稿全文（可含正方/反方各环节内容，或整场转写文本）。与上方时间线二选一即可发起整场评审。"
                  value={matchTranscript} onChange={(e) => setMatchTranscript(e.target.value)} style={{ marginBottom: 10 }} />
                <Space wrap>
                  <Button type="primary" disabled={transcribing || running || !apiKeyConfigured || (timeline.filter((t) => t.content.trim() !== '').length === 0 && matchTranscript.trim() === '')}
                    loading={running} onClick={() => void handleJudgeMatch()} icon={<AuditOutlined />}>整场评审</Button>
                  <Button disabled={running || transcribing || !boundMatchId || !lastJudgeMatchResult} onClick={() => void handleWriteBack()} icon={<ThunderboltOutlined />}>写回该场 AI 评审</Button>
                  <Button disabled={running || transcribing || !lastJudgeMatchResult} onClick={() => void handleExportReport()} icon={<DownloadOutlined />}>导出复盘</Button>
                  <Button disabled={running || transcribing || !lastJudgeMatchResult} onClick={() => void handleExportReviewHtml()} icon={<DownloadOutlined />}>导出 HTML 复盘</Button>
                </Space>
              </>
            ) : (
              <>
                <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>双方稿</Typography.Text>
                <Input.TextArea rows={4} placeholder="粘贴该环节正方稿" value={affSpeech}
                  onChange={(e) => setAffSpeech(e.target.value)} style={{ marginBottom: 8 }} />
                <Input.TextArea rows={4} placeholder="粘贴该环节反方稿" value={negSpeech}
                  onChange={(e) => setNegSpeech(e.target.value)} style={{ marginBottom: 8 }} />
                <Space wrap>
                  <Button type="primary" icon={<AuditOutlined />} disabled={!canJudgeDebate || running} loading={running}
                    onClick={handleJudgeDebate}>双方评审</Button>
                </Space>
                <Divider style={{ margin: '12px 0' }} />
                <div>
                  <Typography.Text strong style={{ fontSize: 13 }}>单方复盘（可选）</Typography.Text>
                  <Radio.Group value={side} onChange={(e) => setSide(e.target.value)} style={{ display: 'block', marginTop: 6, marginBottom: 8 }}>
                    <Radio.Button value="aff">正方稿</Radio.Button>
                    <Radio.Button value="neg">反方稿</Radio.Button>
                  </Radio.Group>
                  <Button type="primary" ghost icon={<ExperimentOutlined />}
                    disabled={running || currentSpeechText.trim() === '' || !apiKeyConfigured}
                    loading={running} onClick={handleJudgeSingleReview}>单方复盘</Button>
                </div>
              </>
            )}

            {error ? <Alert type="error" showIcon closable style={{ marginTop: 12, marginBottom: 12 }} message="执行失败" description={error} onClose={() => setError(null)} /> : null}
            {running ? (
              <div style={{ textAlign: 'center', padding: 16, color: token.colorTextSecondary }}>
                <Spin /> <span style={{ marginLeft: 8 }}>{transcribing ? '正在转写本场录音…' : '正在执行裁判判定…'}</span>
              </div>
            ) : null}
            {results.length > 0 ? (
              <div>
                {results.map((r) => (
                  <Card key={r.id} size="small" title={<span style={{ fontSize: 13 }}>{r.actionLabel}</span>} style={{ marginBottom: 12 }}>
                    <JudgeResultCardByTool toolName={r.toolName} result={r.result} />
                  </Card>
                ))}
              </div>
            ) : null}
            {results.length === 0 && !running ? (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <Empty description="裁判：「整场评审」载入本场转写/粘贴整场稿判定胜负并写回导出；「分环节评审」粘贴正反方稿判定胜负；绑定赛事可写回/导出。" />
              </div>
            ) : null}
          </RoleSection>
        </div>
      ) : null}

      {/* ================= 陪练 Tab ================= */}
      {activeRole === 'sparring' ? (
        <div>
          <RoleSection title="输入来源">
            <Segmented
              value={sparringMode}
              onChange={(v) => setSparringMode(v as 'turn' | 'live')}
              options={[
                { value: 'turn', label: '回合制' },
                { value: 'live', label: '实时对辩' }
              ]}
              style={{ marginBottom: 6 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10, lineHeight: 1.6 }}>
              {sparringMode === 'turn'
                ? '回合制：逐轮「对方攻击 → 你的答辩」，可贴稿发起，适合练防守。'
                : '实时对辩：按 申论→质询→自由辩论→总结 四环节推进，文本或语音回应，适合练临场应变。'}
            </Typography.Text>

            <Typography.Text strong style={{ fontSize: 13 }}>辩题</Typography.Text>
            <Input placeholder="输入辩题，如：网络让人更亲近还是更疏远" value={topic}
              onChange={(e) => setTopic(e.target.value)} style={{ marginTop: 6, marginBottom: 10 }} />

            <div style={{ marginBottom: 10 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>你的立场</Typography.Text>
              <Radio.Group value={side} onChange={(e) => setSide(e.target.value)} style={{ display: 'block', marginTop: 6 }}>
                <Radio.Button value="aff">正方</Radio.Button>
                <Radio.Button value="neg">反方</Radio.Button>
              </Radio.Group>
            </div>

            <div style={{ marginBottom: 10 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>对手风格</Typography.Text>
              <Select style={{ width: '100%', marginTop: 6 }} value={judgeId} onChange={setJudgeId} options={JUDGES.map((j) => ({ value: j.id, label: getJudgeAnonLabel(j.id) }))} />
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                以该风格原型扮演对方，攻击倾向自然带出该评审审美。
              </Typography.Text>
            </div>

            <div style={{ marginBottom: 10 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>对手难度</Typography.Text>
              <Radio.Group value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={{ display: 'block', marginTop: 6 }}>
                {SPARRING_DIFFICULTIES.map((d) => (
                  <Radio.Button key={d.value} value={d.value}>{d.name}</Radio.Button>
                ))}
              </Radio.Group>
            </div>

            <div style={{ marginBottom: 10 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>环节范围</Typography.Text>
              <Segmented
                value={sparringScope}
                onChange={(v) => setSparringScope(v as 'full' | LivePhase)}
                options={[
                  { value: 'full', label: '全程' },
                  { value: 'constructive', label: '申论' },
                  { value: 'crossfire', label: '质询' },
                  { value: 'free', label: '自由辩论' },
                  { value: 'summary', label: '总结' }
                ]}
                style={{ display: 'block', marginTop: 6, marginBottom: 4 }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', lineHeight: 1.5 }}>
                全程：对手按完整节奏攻击/对辩；指定环节：对手只在该环节语境内应对（质询=连问你答、自由辩=快速攻防…），适合专项训练。
              </Typography.Text>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>你的稿子{sparringMode === 'live' ? '（可选）' : ''}</Typography.Text>
                <Button size="small" icon={<UploadOutlined />} onClick={() => handleUploadSpeech(setSparringSpeech)}>上传稿子</Button>
              </div>
              <Input.TextArea rows={5} placeholder={sparringMode === 'live'
                ? '可选：粘贴你的基础立论/稿子，实时对辩对手将据此与整场上下文发言。'
                : '粘贴你的基础立论/稿子，陪练对手将基于此发起攻击'}
                value={sparringSpeech} onChange={(e) => setSparringSpeech(e.target.value)} />
            </div>

            <div>
              <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>整稿 / 整场上下文（可选）</Typography.Text>
              <Input.TextArea rows={4} placeholder="可选：粘贴整份立论或本场整场转写。提供后对手会紧扣这份上下文的立论结构与漏洞发起针对性攻击。"
                value={sparringContext} onChange={(e) => setSparringContext(e.target.value)} />
            </div>

            {!apiKeyConfigured ? <ApiKeyAlert /> : null}
          </RoleSection>

          <RoleSection title="录音与转写">
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6, lineHeight: 1.6 }}>
              可从绑定本场转写填入上下文，让对手针对整场内容攻击；实时对辩支持麦克风录音转文字回应。
            </Typography.Text>
            <Space wrap>
              {boundMatch ? (
                <Button size="small" icon={<DownloadOutlined />} disabled={running || timeline.filter((t) => t.content.trim() !== '').length === 0}
                  onClick={() => handleFillWholeText(setSparringContext)}>从本场转写填入上下文</Button>
              ) : null}
            </Space>
          </RoleSection>

          <RoleSection title="发起与结果">
            <Space wrap>
              {sparringMode === 'turn' ? (
                <Button type="primary" icon={<AimOutlined />} disabled={!canSparringStart || running}
                  loading={running} onClick={handleSparringStart}>
                  {sparringStarted ? '重新发起陪练' : '发起陪练'}
                </Button>
              ) : (
                <Button type="primary" icon={<AimOutlined />} disabled={!canLiveStart || running}
                  loading={running} onClick={handleLiveStart}>
                  {liveStarted ? '重新开始实时对辩' : '开始实时对辩'}
                </Button>
              )}
            </Space>

            {error ? <Alert type="error" showIcon closable style={{ marginTop: 12, marginBottom: 12 }} message="执行失败" description={error} onClose={() => setError(null)} /> : null}

            {/* 回合制对话流（消息列表） */}
            {sparringMode === 'turn' && (sparringStarted || sparringRounds.length > 0) ? (
              <Card size="small" title={<span style={{ fontSize: 13 }}>陪练对抗</span>} style={{ marginTop: 12, marginBottom: 12 }}>
                {sparringRounds.map((r, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4 }}>第 {i + 1} 轮</div>
                    <div style={{ fontSize: 12, marginBottom: 6, padding: '6px 8px', borderRadius: 6, backgroundColor: token.colorFillQuaternary, whiteSpace: 'pre-wrap' }}>
                      <Typography.Text strong style={{ fontSize: 12 }}>对方攻击：</Typography.Text>
                      {r.opponent}
                    </div>
                    <div style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, backgroundColor: token.colorPrimaryBg, whiteSpace: 'pre-wrap' }}>
                      <Typography.Text strong style={{ fontSize: 12 }}>你的答辩：</Typography.Text>
                      {r.reply}
                    </div>
                  </div>
                ))}
                {currentAttack ? (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4 }}>
                      第 {sparringRounds.length + 1} 轮 · 对方攻击
                    </div>
                    <div style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, backgroundColor: token.colorFillQuaternary, whiteSpace: 'pre-wrap' }}>
                      {currentAttack}
                    </div>
                    <Input.TextArea rows={3} placeholder="输入你的答辩…" value={replyText} style={{ marginTop: 8 }} onChange={(e) => setReplyText(e.target.value)} />
                    <Space wrap style={{ marginTop: 8 }}>
                      <Button type="primary" ghost icon={<ThunderboltOutlined />} disabled={running} loading={running} onClick={handleSparringNext}>答辩并进入下一轮</Button>
                      <Button icon={<FlagOutlined />} disabled={running} onClick={handleSparringFinalize}>结束并汇总</Button>
                    </Space>
                  </div>
                ) : null}
                {!currentAttack && sparringRounds.length > 0 && !sparringFinalize ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>对抗已结束，可查看下方汇总或重新发起。</Typography.Text>
                ) : null}
                {sparringFinalize ? (
                  <div style={{ marginTop: 8 }}>
                    <SparringFinalizeCard result={sparringFinalize} />
                  </div>
                ) : null}
              </Card>
            ) : null}
            {sparringMode === 'turn' && !sparringStarted ? (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <Empty description="陪练 · 回合制：填辩题、立场、对手风格与难度 → 发起后逐轮「对方攻击 → 你的答辩」→ 结束并汇总对抗要点；可选注入整稿/整场上下文让攻击更具针对性。" />
              </div>
            ) : null}

            {/* 实时对辩看板 */}
            {sparringMode === 'live' ? (
              <Card size="small" title={<span style={{ fontSize: 13 }}>实时对辩</span>} style={{ marginTop: 12 }}>
                {!liveFinalize ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      推进方向：
                    </Typography.Text>
                    {LIVE_PHASE_ORDER.map((ph, i) => {
                      const active = ph === livePhase
                      const passed = liveRounds.some((r) => r.phase === ph)
                      return (
                        <span key={ph} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Tag color={active ? 'blue' : passed ? 'green' : 'default'} style={{ marginRight: 0 }}>
                            {LIVE_PHASE_NAME[ph]}
                          </Tag>
                          {i < LIVE_PHASE_ORDER.length - 1 ? <span style={{ color: token.colorTextTertiary }}>→</span> : null}
                        </span>
                      )
                    })}
                  </div>
                ) : null}

                {liveRounds.map((r, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4 }}>
                      第 {i + 1} 轮【{LIVE_PHASE_NAME[r.phase] ?? r.phase}】
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 6, padding: '6px 8px', borderRadius: 6, backgroundColor: token.colorFillQuaternary, whiteSpace: 'pre-wrap' }}>
                      <Typography.Text strong style={{ fontSize: 12 }}>对方发言：</Typography.Text>
                      {r.opponent}
                    </div>
                    <div style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, backgroundColor: token.colorPrimaryBg, whiteSpace: 'pre-wrap' }}>
                      <Typography.Text strong style={{ fontSize: 12 }}>你的回应：</Typography.Text>
                      {r.userReply}
                    </div>
                  </div>
                ))}

                {liveOpponent ? (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4 }}>
                      第 {liveRounds.length + 1} 轮【{LIVE_PHASE_NAME[livePhase] ?? livePhase}】· 对方发言
                    </div>
                    <div style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, backgroundColor: token.colorFillQuaternary, whiteSpace: 'pre-wrap' }}>
                      {liveOpponent}
                    </div>
                  </div>
                ) : !liveStarted ? (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, backgroundColor: token.colorFillQuaternary, color: token.colorTextTertiary }}>
                      对方发言流将在此展示 —— 点击上方「开始实时对辩」后，对手按 申论→质询→自由辩论→总结 四环节依次发言。
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                      实时对辩转写 = 录音（麦克风）→ STT 语音转文字 → 自动填入下方回应框；也可直接手动输入文本。
                    </Typography.Text>
                  </div>
                ) : null}

                <Input.TextArea
                  rows={3}
                  placeholder={liveStarted ? '输入你的回应…（也可点右侧麦克风录音转文字）' : '先开始实时对辩，对方发言后在此输入你的回应'}
                  value={liveReply}
                  onChange={(e) => setLiveReply(e.target.value)}
                />
                <Space wrap style={{ marginTop: 8 }}>
                  <Button
                    type="primary"
                    ghost
                    icon={<ThunderboltOutlined />}
                    disabled={running || !liveOpponent || liveReply.trim() === ''}
                    loading={running}
                    onClick={handleLiveNext}
                  >
                    回应并进入下一环节
                  </Button>
                  <Button
                    icon={liveMic.recording ? <AudioMutedOutlined /> : <AudioOutlined />}
                    danger={liveMic.recording}
                    loading={liveTranscribing}
                    disabled={running || liveTranscribing || !liveStarted}
                    onClick={() => void handleLiveMicToggle()}
                    title={!liveStarted ? '先开始实时对辩' : liveMic.recording ? '点击停止并转文字' : '开始录音，再点停止转文字'}
                  >
                    {liveMic.recording ? '录音中…点击停止转文字' : liveTranscribing ? '转写中…' : '麦克风录入'}
                  </Button>
                  <Button icon={<FlagOutlined />} disabled={running || !liveStarted} onClick={handleLiveFinalize}>
                    结束并汇总
                  </Button>
                </Space>

                {liveOpponent === null && liveRounds.length > 0 && !liveFinalize ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    实时对辩已结束，可查看下方汇总或重新开始。
                  </Typography.Text>
                ) : null}

                {liveFinalize ? (
                  <div style={{ marginTop: 8 }}>
                    <LiveDebateFinalizeCard result={liveFinalize} />
                  </div>
                ) : null}
              </Card>
            ) : null}
          </RoleSection>
        </div>
      ) : null}

      {/* ================= 复盘 Tab ================= */}
      {activeRole === 'coach' ? (
        <div>
          <RoleSection title="输入来源">
            <Segmented
              value={coachMode}
              onChange={(v) => setCoachMode(v as 'whole' | 'manual')}
              options={[
                { value: 'whole', label: '全程（分环节）' },
                { value: 'manual', label: '单环节手动' }
              ]}
              style={{ marginBottom: 10 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10, lineHeight: 1.6 }}>
              {coachMode === 'whole'
                ? '全程（分环节）：按本场时间线/整稿的环节（立论/驳论/质询/自由辩/结辩…）拆分，对每个环节分别给出四维短板与可练方向，再整场汇总。'
                : '单环节手动：粘贴某一环节的单方稿，由教练给出成长向诊断（四维短板 / 可练方向 / 示范改写）。'}
            </Typography.Text>
            <EventBindingSelects
              events={events}
              rounds={rounds}
              matchList={matchList}
              boundEventId={boundEventId}
              boundRoundId={boundRoundId}
              boundMatchId={boundMatchId}
              boundMatch={boundMatch}
              onEventChange={(v) => void handleEventChange(v)}
              onRoundChange={handleRoundChange}
              onMatchChange={(v) => handleMatchChange(v)}
            />

            <div style={{ marginTop: 10 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>辩题</Typography.Text>
              <Input placeholder="输入辩题（可选）" value={topic}
                onChange={(e) => setTopic(e.target.value)} style={{ marginTop: 6, marginBottom: 10 }} />
            </div>

            <div style={{ marginBottom: 8 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>你的立场</Typography.Text>
              <Radio.Group value={side} onChange={(e) => setSide(e.target.value)} style={{ display: 'block', marginTop: 6 }}>
                <Radio.Button value="aff">正方</Radio.Button>
                <Radio.Button value="neg">反方</Radio.Button>
              </Radio.Group>
            </div>

            {coachMode === 'manual' ? (
              <div style={{ marginBottom: 8 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>环节（可选）</Typography.Text>
                <Select allowClear placeholder="选择环节类型" style={{ width: '100%', marginTop: 6 }} value={coachStage}
                  onChange={(v) => setCoachStage(v as DebateStageType | undefined)}
                  options={STAGE_DEFINITIONS.map((s) => ({ value: s.type, label: `${s.name}（${s.description}）` }))} />
              </div>
            ) : null}

            <OpponentStylePicker value={judgeId} onChange={setJudgeId} label="教练风格（复盘口径）" />
            {!apiKeyConfigured ? <ApiKeyAlert /> : null}
          </RoleSection>

          <RoleSection title="录音与转写">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                {coachMode === 'whole' ? '整场内容 / 整稿' : '单方稿 / 整场内容'}
              </Typography.Text>
              <Button size="small" icon={<UploadOutlined />} onClick={() => handleUploadSpeech(setCoachSpeech)}>上传稿子</Button>
              <Button size="small" icon={<AudioOutlined />} loading={transcribing} disabled={running || transcribing}
                onClick={() => void handlePickRecordingTranscribe()}>选择录音文件</Button>
              {boundMatch ? (
                <>
                  <Button size="small" type="primary" ghost icon={<AudioOutlined />} loading={transcribing}
                    disabled={running || transcribing || !recChecked || !recHasAvailable}
                    onClick={() => void handleCoachTranscribeRecording()}>
                    {recHasAvailable ? '本场录音转文字' : '本场无可用录音'}
                  </Button>
                  <Button size="small" icon={<DownloadOutlined />} disabled={running || timeline.filter((t) => t.content.trim() !== '').length === 0}
                    onClick={() => handleFillWholeText(setCoachSpeech)}>载入本场整场转写</Button>
                </>
              ) : null}
            </div>
            {boundMatch && recChecked && recMissingCount > 0 ? (
              <Alert type="warning" showIcon style={{ marginBottom: 6 }} message={`本场有 ${recMissingCount} 份录音缺失/已删除，转写将跳过缺失部分`} />
            ) : null}
            <Input.TextArea rows={6} placeholder={coachMode === 'whole'
              ? '粘贴要复盘整场内容（本场整场转写或整稿，按环节自动拆分逐段诊断）；来源可选用 上传稿子 / 选择录音文件 / 本场录音转文字 / 手动粘贴'
              : '粘贴要复盘的单方稿、本场整场转写或一段内容（立论/驳论/结辩等）；来源可选用 上传稿子 / 选择录音文件 / 本场录音转文字 / 手动粘贴'}
              value={coachSpeech} onChange={(e) => setCoachSpeech(e.target.value)} />
          </RoleSection>

          <RoleSection title="发起与结果">
            <Space wrap>
              <Button type="primary" icon={<ExperimentOutlined />} disabled={!canCoach || running} loading={running}
                onClick={coachMode === 'whole' ? handleCoachMatch : handleCoachReview}>
                {coachMode === 'whole' ? '全程分环节复盘' : '教练诊断'}
              </Button>
              {running ? <Button danger icon={<CloseOutlined />} onClick={handleCancel}>取消</Button> : null}
            </Space>

            {error ? <Alert type="error" showIcon closable style={{ marginTop: 12, marginBottom: 12 }} message="执行失败" description={error} onClose={() => setError(null)} /> : null}

            {coachResult ? (
              <Card size="small" title={<span style={{ fontSize: 13 }}>{coachResult.actionLabel}</span>} style={{ marginTop: 12, marginBottom: 12 }}>
                {coachResult.toolName === 'coach_match' ? (
                  <CoachMatchCard result={coachResult.result as unknown as CoachMatchResult} />
                ) : (
                  <CoachReviewCard result={coachResult.result as unknown as CoachReviewResult} />
                )}
              </Card>
            ) : null}

            {!coachResult && !running ? (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <Empty description="复盘：来源支持 上传稿子(txt/md/docx) / 选择录音文件(wav/mp3/m4a/flac 转文字) / 本场录音转文字 / 手动粘贴 → 教练给出立论/反驳/表达/攻防四维短板、可练方向与示范改写（不判分）。「全程（分环节）」按整场时间线/整稿按环节拆分逐段诊断，结果绑定该场。" />
              </div>
            ) : null}
          </RoleSection>
        </div>
      ) : null}

      {/* ================= 评审历史（按当前角色过滤） ================= */}
      <Card
        size="small"
        title={
          <span style={{ fontSize: 13 }}>
            {JUDGE_ROLE_LABELS[activeRole as unknown as JudgeHistoryRole]} · 历史
            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {boundMatchId ? '当前绑定的比赛场次' : '全部记录'}
            </Typography.Text>
          </span>
        }
        extra={<Button size="small" icon={<ExperimentOutlined />} loading={historyLoading} onClick={() => refreshHistory()}>刷新</Button>}
        style={{ marginBottom: 16 }}
      >
        {historyLoading && visibleHistory.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 12, color: token.colorTextSecondary }}><Spin size="small" /> 加载中…</div>
        ) : visibleHistory.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            暂无「{JUDGE_ROLE_LABELS[activeRole as unknown as JudgeHistoryRole]}」相关记录。对应工具执行成功后会自动保存在这里。
          </Typography.Text>
        ) : (
          <div>
            {visibleHistory.map((h) => {
              const expanded = expandedHistoryId === h.id
              const judgeLabel = judgeHistoryToolLabel(h.toolName)
              const canWriteBack = boundMatchId && judgeMatchCanWriteBack(h)
              const winnerLabel = canWriteBack
                ? (() => {
                    const v = (h.resultJson as { verdict?: { winner?: 'aff' | 'neg' } } | null)?.verdict?.winner
                    return v === 'aff' ? '正方胜' : '反方胜'
                  })()
                : ''
              return (
                <div key={h.id} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Typography.Link style={{ fontSize: 13 }} onClick={() => setExpandedHistoryId(expanded ? null : h.id)}>
                      {expanded ? '收起' : '查看'}
                    </Typography.Link>
                    <Tag color={activeRole === 'judge' ? 'blue' : activeRole === 'sparring' ? 'purple' : 'green'} style={{ marginRight: 0, fontSize: 12 }}>
                      {JUDGE_ROLE_LABELS[roleOfTool(h.toolName)]}
                    </Tag>
                    <Tag style={{ marginRight: 0, fontSize: 12 }}>{judgeLabel}</Tag>
                    {h.stage ? <Tag color="geekblue">{STAGE_NAMES[h.stage] ?? h.stage}</Tag> : null}
                    {h.side ? <Tag color={h.side === 'aff' ? 'blue' : 'orange'}>{h.side === 'aff' ? '正方' : '反方'}</Tag> : null}
                    {h.toolName === 'judge_match' && canWriteBack ? <Tag color="green">{winnerLabel}</Tag> : null}
                    <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1, minWidth: 0 }}>{h.topic || '（未填写辩题）'}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{h.createdAt ? new Date(h.createdAt).toLocaleString() : ''}</Typography.Text>
                    {h.toolName === 'judge_match' ? (
                      <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} disabled={!canWriteBack}
                        title={canWriteBack ? '写回该场 AI 评审（不覆盖人工赛果）' : '未绑定场次或该历史无有效判定'}
                        onClick={() => void handleWriteBackFromHistory(h)}>写回该场</Button>
                    ) : null}
                    <Button size="small" danger icon={<CloseOutlined />} title="删除这条评审历史" onClick={() => void handleDeleteHistory(h.id)} />
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
    </div>
  )
}