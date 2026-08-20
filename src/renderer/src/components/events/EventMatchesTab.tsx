// ============================================================
// EventMatchesTab.tsx — 赛事内「比赛/赛果」Tab
//
// 内嵌在赛事详情里，以「比赛」为中心承载：
//   建对阵 → 配题(抽题结果计入该场) → 启动计时(带上下文) → 计入赛果 → 可选AI评审。
// 复用 eventStore(轮次/队伍) / topicStore(题库) / window.matchAPI / window.timerAPI。
// 无顶层「比赛工作台」菜单（本页是赛事内唯一入口）。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Divider,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import {
  PlusOutlined,
  PlayCircleOutlined,
  TrophyOutlined,
  RobotOutlined,
  DeleteOutlined,
  BookOutlined,
  AudioOutlined,
  FileTextOutlined,
  LoadingOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useEventStore } from '../../stores/eventStore'
import { useTopicStore } from '../../stores/topicStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToast } from '../../hooks/useToast'
import {
  describeRecordingFormatExt,
  formatMarkerTime
} from '../../../../shared/match-recording'
import { useLocalAudioSrc } from '../../utils/useLocalAudioSrc'
import MatchResultModal from './MatchResultModal'
import MatchVerdictCard from './MatchVerdictCard'
import type {
  Match,
  MatchAiReview,
  MatchWinner
} from '../../../../shared/types'

const { Text } = Typography

const STATUS_META: Record<Match['status'], { label: string; color: string }> = {
  planned: { label: '待赛果', color: 'default' },
  resulted: { label: '已亮牌', color: 'green' }
}
const WINNER_META: Record<string, string> = {
  aff: '正方胜',
  neg: '反方胜',
  draw: '平局',
  abandoned: '弃赛'
}

export default function EventMatchesTab({ eventId }: { eventId: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const eventStore = useEventStore()
  const topicStore = useTopicStore()

  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [roundFilter, setRoundFilter] = useState<string>('__all__')

  // 建对阵
  const [createOpen, setCreateOpen] = useState(false)
  const [createRound, setCreateRound] = useState<string | undefined>()
  const [teamA, setTeamA] = useState<string | undefined>()
  const [teamB, setTeamB] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)

  // 配题
  const [topicFor, setTopicFor] = useState<Match | null>(null)
  const [topicPick, setTopicPick] = useState<string | undefined>()

  // 计分亮牌
  const [resultFor, setResultFor] = useState<Match | null>(null)

  // AI 评审（整场评审：时间线/转文字 → judge_match → 回写；无 AI 时退化为手动判定）
  const [aiFor, setAiFor] = useState<Match | null>(null)
  const [aiWinner, setAiWinner] = useState<MatchWinner>('aff')
  const [aiExplain, setAiExplain] = useState<string>('')
  // 整场评审素材：每段 content（按 markers 索引对齐）+ 整场转录 + 赛制提示
  const [aiSegmentTexts, setAiSegmentTexts] = useState<string[]>([])
  const [aiTranscript, setAiTranscript] = useState<string>('')
  const [aiFormatHint, setAiFormatHint] = useState<string>('')
  const [aiRunning, setAiRunning] = useState(false)
  // 已存在 AI 评审的详情查看
  const [aiReviewFor, setAiReviewFor] = useState<Match | null>(null)

  // 亮牌详情卡（多评委明细 + 环节权重胜负牌，T4.1）
  const [verdictFor, setVerdictFor] = useState<Match | null>(null)

  // 录音标记时间线展示（T2.5：仅展示，评审逻辑留给 T3）
  const [markerFor, setMarkerFor] = useState<Match | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.matchAPI.listByEvent(eventId)
      if (res.success && res.data) setMatches(res.data)
      else toast.error(res.error || '加载比赛失败')
    } finally {
      setLoading(false)
    }
  }, [eventId, toast])

  useEffect(() => {
    void load()
    // 轮次/队伍/题库需就绪
    void eventStore.listRoundsByEvent(eventId)
    void eventStore.listTeamsByEvent(eventId)
    if (topicStore.items.length === 0) void topicStore.fetchList({ pageSize: 1000 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  const filtered = useMemo(
    () =>
      roundFilter === '__all__'
        ? matches
        : matches.filter((m) => (roundFilter === '__none__' ? !m.roundId : m.roundId === roundFilter)),
    [matches, roundFilter]
  )

  // ---- 新建对阵 ----
  const handleCreate = async () => {
    if (!teamA || !teamB) {
      toast.warning('请选择正方与反方队伍')
      return
    }
    if (teamA === teamB) {
      toast.warning('正反方不能是同一支队伍')
      return
    }
    setCreating(true)
    try {
      const res = await window.matchAPI.create({
        eventId,
        roundId: createRound ?? null,
        teamAffId: teamA,
        teamNegId: teamB
      })
      if (res.success) {
        toast.success('已创建对阵')
        setCreateOpen(false)
        setTeamA(undefined)
        setTeamB(undefined)
        setCreateRound(undefined)
        void load()
      } else {
        toast.error(res.error || '创建失败')
      }
    } finally {
      setCreating(false)
    }
  }

  // ---- 配题（抽题结果计入该场）----
  const handleAssignTopic = async () => {
    if (!topicFor || !topicPick) {
      toast.warning('请选择辩题')
      return
    }
    const res = await window.matchAPI.update(topicFor.id, { topicId: topicPick })
    if (res.success) {
      toast.success('辩题已计入该场比赛')
      setTopicFor(null)
      setTopicPick(undefined)
      void load()
    } else {
      toast.error(res.error || '配题失败')
    }
  }

  // ---- 计入赛果（由 MatchResultModal 提交多裁判评决）----
  const handleResultSaved = () => {
    void load()
  }

  // ---- AI 评审（整场评审）----
  // preload 暴露的 agent API（沿用既有 window.agent.runTool 全局桥接，不新造 IPC）
  const getAgentAPI = useCallback((): {
    runTool: (req: unknown) => Promise<{ success: boolean; code?: string; message?: string; data?: unknown }>
  } | null => {
    const w = window as unknown as {
      agent?: { runTool: (req: unknown) => Promise<{ success: boolean; code?: string; message?: string; data?: unknown }> }
    }
    return w.agent ?? null
  }, [])

  // 打开整场评审弹窗：按录音标记初始化每段 content（清空）
  const openAiReview = (m: Match) => {
    const n = m.recordingMeta?.markers?.length ?? 0
    setAiSegmentTexts(new Array<string>(n).fill(''))
    setAiTranscript('')
    setAiFormatHint('')
    setAiWinner('aff')
    setAiExplain('')
    setAiFor(m)
  }

  /** 组装 judge_match 入参（时间线优先；transcript 退化）。返回 null 表示素材不足 */
  const buildJudgeArgs = (
    m: Match
  ): { topic: string; formatHint?: string; timeline?: unknown[]; transcript?: string } | null => {
    const topic = m.topicTitle || m.eventName || ''
    const timeline = (m.recordingMeta?.markers ?? []).map((mk, i) => ({
      stage: mk.stageId || undefined,
      stageName: mk.stageName || undefined,
      side: mk.side ?? undefined,
      speaker: mk.speaker ?? undefined,
      tsMs: mk.tsMs,
      content: (aiSegmentTexts[i] ?? '').trim()
    }))
    const filledTimeline = timeline.filter((t) => t.content !== '')
    const transcript = aiTranscript.trim()

    if (filledTimeline.length === 0 && transcript === '') return null

    const args: { topic: string; formatHint?: string; timeline?: unknown[]; transcript?: string } = {
      topic: topic || (m.eventName ?? '一场辩论')
    }
    if (aiFormatHint.trim() !== '') args.formatHint = aiFormatHint.trim()
    if (filledTimeline.length > 0) args.timeline = filledTimeline
    else if (transcript !== '') args.transcript = transcript
    // 时间线与转录并存时仅用时间线（judge_match 内优先 timeline）
    return args
  }

  /** 把 judge_match 返回 data 映射为 MatchAiReview */
  const mapJudgeResult = (
    data: Record<string, unknown>,
    source: 'recording' | 'transcript'
  ): MatchAiReview => {
    const verdict = data.verdict as { winner?: 'aff' | 'neg'; reason?: string } | undefined
    const summary = typeof data.summary === 'string' ? data.summary : ''
    const reason = typeof verdict?.reason === 'string' ? verdict.reason : ''
    return {
      winner: verdict?.winner === 'aff' || verdict?.winner === 'neg' ? verdict.winner : 'draw',
      explanation: reason || summary || '（AI 评审完成，无判定说明）',
      reviewedAt: new Date().toISOString(),
      judgeName: typeof data.judgeName === 'string' ? data.judgeName : undefined,
      bestSpeaker:
        typeof data.bestSpeaker === 'string' && data.bestSpeaker !== ''
          ? data.bestSpeaker
          : null,
      dimensions: Array.isArray(data.dimensions) ? (data.dimensions as MatchAiReview['dimensions']) : null,
      stageVerdicts:
        Array.isArray(data.stageVerdicts) ? (data.stageVerdicts as MatchAiReview['stageVerdicts']) : null,
      source
    }
  }

  // 整场评审：组装入参 → judge_match → 映射 → setAiReview 写回
  const handleAiRun = async () => {
    if (!aiFor) return
    const args = buildJudgeArgs(aiFor)
    if (!args) {
      toast.warning('请至少提供一段时间线内容，或整场转录全文')
      return
    }
    const apiKey = useSettingsStore.getState().aiConfig.apiKey
    if (!apiKey) {
      toast.error('整场评审需要配置 AI API 密钥（请在设置中配置）')
      return
    }
    const api = getAgentAPI()
    if (!api) {
      toast.error('Agent 服务未就绪（window.agent 不可用）')
      return
    }
    const source: 'recording' | 'transcript' = args.timeline ? 'recording' : 'transcript'
    setAiRunning(true)
    try {
      const res = await api.runTool({
        toolName: 'judge_match',
        args,
        config: useSettingsStore.getState().aiConfig
      })
      if (res.success && res.data && typeof res.data === 'object') {
        const review = mapJudgeResult(res.data as Record<string, unknown>, source)
        const saved = await window.matchAPI.setAiReview(aiFor.id, review)
        if (saved.success) {
          toast.success('AI 整场评审已写入（不覆盖人工赛果）')
          setAiFor(null)
          void load()
        } else {
          toast.error(saved.error || 'AI 评审写入失败')
        }
      } else {
        toast.error(res.message || res.code || '整场评审失败')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setAiRunning(false)
    }
  }

  // 手动判定兜底写入（无 AI 或失败时保留）
  const handleAiReview = async () => {
    if (!aiFor) return
    const review: MatchAiReview = {
      winner: aiWinner,
      explanation: aiExplain || '（未填写说明）',
      reviewedAt: new Date().toISOString()
    }
    const res = await window.matchAPI.setAiReview(aiFor.id, review)
    if (res.success) {
      toast.success('AI 评审已写入（不覆盖人工赛果）')
      setAiFor(null)
      setAiExplain('')
      void load()
    } else {
      toast.error(res.error || 'AI 评审写入失败')
    }
  }

  // 上传 txt/md/docx 整场转录 → 读取文本填入 transcript（复用既有 fileAPI）
  const handleUploadTranscript = async () => {
    const w = window as unknown as {
      fileAPI?: {
        pickFile: (filters: Array<{ name: string; extensions: string[] }>) => Promise<{ success: boolean; data?: string | null; error?: string }>
        readTextFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
      }
    }
    const fileAPI = w.fileAPI
    if (!fileAPI) {
      toast.error('文件服务未就绪（window.fileAPI 不可用）')
      return
    }
    try {
      const picked = await fileAPI.pickFile([{ name: '整场转录文本', extensions: ['txt', 'md', 'docx'] }])
      if (!picked.success) {
        toast.error(picked.error ?? '选择文件失败')
        return
      }
      if (!picked.data) return // 用户取消
      const read = await fileAPI.readTextFile(picked.data)
      if (!read.success) {
        toast.error(read.error ?? '读取文件失败')
        return
      }
      setAiTranscript(read.data ?? '')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  // ---- 启动计时（带上下文）----
  const handleStartTimer = (m: Match) => {
    navigate('/timer', {
      state: {
        eventId: m.eventId,
        eventName: m.eventName,
        roundId: m.roundId,
        topicId: m.topicId,
        topicTitle: m.topicTitle,
        teamAffId: m.teamAffId,
        teamNegId: m.teamNegId,
        teamAffName: m.teamAffName,
        teamNegName: m.teamNegName,
        matchId: m.id
      }
    })
  }

  // ---- 时长可选录音已移除（T2.4）：录音改在计时器内进行，赛事页不再手点录音 ----

  const columns: ColumnsType<Match> = [
    {
      title: '对阵',
      key: 'matchup',
      dataIndex: 'id',
      width: 200,
      render: (_, m) => (
        <Space direction="vertical" size={0}>
          <Text strong>
            {m.teamAffName || '正方'} <Text type="secondary">vs</Text> {m.teamNegName || '反方'}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {m.matchNumber ? `第 ${m.matchNumber} 场` : ''}
          </Text>
        </Space>
      )
    },
    {
      title: '辩题',
      dataIndex: 'topicTitle',
      key: 'topic',
      ellipsis: true,
      render: (v, m) =>
        m.topicTitle ? (
          v
        ) : (
          <Button size="small" icon={<BookOutlined />} onClick={() => setTopicFor(m)}>
            配题
          </Button>
        )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 96,
      render: (s: Match['status']) => {
        const meta = STATUS_META[s] ?? STATUS_META.planned
        return <Tag color={meta.color}>{meta.label}</Tag>
      }
    },
    {
      title: '标记',
      key: 'flags',
      width: 150,
      render: (_, m) => (
        <Space size={4} wrap>
          {m.recordingMeta && (
            <>
              <Tag icon={<AudioOutlined />} color="cyan">
                录音 · {m.recordingMeta.markers.length} 段
              </Tag>
              <Button
                size="small"
                type="link"
                icon={<AudioOutlined />}
                onClick={() => setMarkerFor(m)}
              >
                时间线
              </Button>
            </>
          )}
          {m.aiReview && (
            <Tag
              icon={<RobotOutlined />}
              color="purple"
              style={{ cursor: 'pointer' }}
              onClick={() => setAiReviewFor(m)}
            >
              AI评审
            </Tag>
          )}
          {m.sessionId && <Tag color="blue">已计时</Tag>}
        </Space>
      )
    },
    {
      title: '赛果',
      key: 'result',
      width: 130,
      render: (_, m) =>
        m.winner ? (
          <Space
            direction="vertical"
            size={0}
            style={{ cursor: 'pointer' }}
            title="查看评委明细"
            onClick={() => setVerdictFor(m)}
          >
            <Text strong style={{ color: m.winner === 'aff' ? '#1677ff' : m.winner === 'neg' ? '#ff4d4f' : undefined }}>
              {WINNER_META[m.winner]}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {m.bestSpeaker ? `最佳 ${m.bestSpeaker} · ` : ''}
              {m.judgeSystem === 'percentage'
                ? `均分 ${m.affScore ?? '—'}:${m.negScore ?? '—'}`
                : `（${m.affScore ?? '—'}:${m.negScore ?? '—'}）`}
            </Text>
          </Space>
        ) : (
          <Text type="secondary">待赛果</Text>
        )
    },
    {
      title: '操作',
      key: 'action',
      width: 240,
      fixed: 'right',
      render: (_, m) => (
        <Space wrap size={4}>
          <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleStartTimer(m)}>
            启动计时
          </Button>
          <Button size="small" icon={<TrophyOutlined />} onClick={() => setResultFor(m)}>
            计入赛果
          </Button>
          <Button size="small" icon={<RobotOutlined />} onClick={() => openAiReview(m)}>
            AI评审
          </Button>
          <Popconfirm title="删除该场对阵？" okText="删除" cancelText="取消" onConfirm={() => void (async () => {
            const r = await window.matchAPI.delete(m.id)
            if (r.success) {
              toast.success('已删除')
              void load()
            } else toast.error(r.error || '删除失败')
          })()}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建对阵
        </Button>
        <Select
          style={{ width: 160 }}
          value={roundFilter}
          onChange={setRoundFilter}
          options={[
            { value: '__all__', label: '全部轮次' },
            { value: '__none__', label: '未定轮' },
            ...eventStore.rounds.map((r) => ({ value: r.id, label: r.name || `第 ${r.round_number} 轮` }))
          ]}
        />
      </Space>

      {matches.length === 0 && (
        <Alert
          type="info"
          showIcon
          message="在这里按「新建对阵」录入比赛；再「配题」计入辩题，「启动计时」进入计时，「计入赛果」收尾，可选「AI评审」。"
          style={{ marginBottom: 12 }}
        />
      )}

      <Table<Match>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        pagination={filtered.length > 10 ? { pageSize: 10, showTotal: (t) => `共 ${t} 场` } : false}
        locale={{ emptyText: <Empty description="暂未创建比赛" /> }}
      />

      {/* 新建对阵 */}
      <Modal title="新建对阵" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void handleCreate()} confirmLoading={creating}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text type="secondary">轮次：</Text>
            <Select
              allowClear placeholder="可留空"
              style={{ width: 220 }}
              value={createRound}
              onChange={(v) => setCreateRound(v)}
              options={eventStore.rounds.map((r) => ({ value: r.id, label: r.name || `第 ${r.round_number} 轮` }))}
            />
          </div>
          <div>
            <Text type="secondary">正方队伍：</Text>
            <Select
              style={{ width: 220 }} placeholder="选择正方"
              value={teamA} onChange={setTeamA}
              options={eventStore.teams.map((t) => ({ value: t.id, label: t.name }))}
            />
          </div>
          <div>
            <Text type="secondary">反方队伍：</Text>
            <Select
              style={{ width: 220 }} placeholder="选择反方"
              value={teamB} onChange={setTeamB}
              options={eventStore.teams.map((t) => ({ value: t.id, label: t.name }))}
            />
          </div>
        </Space>
      </Modal>

      {/* 配题 */}
      <Modal title="为该场配辩题" open={!!topicFor} onCancel={() => setTopicFor(null)} onOk={() => void handleAssignTopic()} okText="计入该场">
        <Select
          showSearch optionFilterProp="label" placeholder="选择辩题"
          style={{ width: '100%' }}
          value={topicPick}
          onChange={setTopicPick}
          options={topicStore.items.map((t) => ({ value: t.id, label: t.title }))}
        />
      </Modal>

      {/* 计入赛果（亮牌：多裁判评决） */}
      <MatchResultModal
        match={resultFor}
        // 队名仅作最佳辩手输入框的补全提示，不强制只能选队伍
        speakerOptions={eventStore.teams.map((t) => t.name)}
        onClose={() => setResultFor(null)}
        onSaved={handleResultSaved}
      />

      {/* 录音标记时间线（T2.5：仅展示，评审逻辑留给 T3） */}
      <Modal
        title="录音时间线"
        open={!!markerFor}
        onCancel={() => setMarkerFor(null)}
        footer={null}
        width={520}
      >
        {markerFor?.recordingMeta && (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Text type="secondary">
              {markerFor.recordingMeta.segmentMode === 'split' ? '按环节分段' : '整场一轨'} · 共{' '}
              {markerFor.recordingMeta.markers.length} 段
            </Text>

            {/* T7.5 录音回放：whole 单轨用 recordingMeta.filePath，split 按环节分片逐段播放 */}
            {markerFor.recordingMeta.segmentMode === 'split' && markerFor.recordingMeta.markers.some((mk) => mk.filePath) ? (
              <>
                {markerFor.recordingMeta.markers
                  .filter((mk) => mk.filePath)
                  .map((mk) => {
                    const fp = mk.filePath as string
                    return (
                      <div key={`${mk.stageId}-${mk.tsMs}`} style={{ width: '100%' }}>
                        <Space direction="vertical" style={{ width: '100%' }} size={2}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            <Text code>{formatMarkerTime(mk.tsMs)}</Text> {mk.stageName} · 分段回放
                          </Text>
                          <RecordingPlayer filePath={fp} />
                        </Space>
                      </div>
                    )
                  })}
                <Divider style={{ margin: '4px 0' }} />
              </>
            ) : markerFor.recordingMeta.filePath ? (
              <>
                <RecordingPlayer filePath={markerFor.recordingMeta.filePath} />
                <Divider style={{ margin: '4px 0' }} />
              </>
            ) : null}

            {markerFor.recordingMeta.markers.length === 0 && (
              <Text type="secondary">暂无环节标记。</Text>
            )}
            {markerFor.recordingMeta.markers.map((mk, i) => (
              <div key={`${mk.stageId}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <Text code style={{ width: 64 }}>{formatMarkerTime(mk.tsMs)}</Text>
                <Text strong>{mk.stageName}</Text>
                <Text type="secondary">{mk.speaker || (mk.side === 'both' ? '双方' : mk.side ?? '')}</Text>
              </div>
            ))}
          </Space>
        )}
      </Modal>

      {/* 整场 AI 评审 */}
      <Modal
        title="整场 AI 评审（不覆盖人工赛果）"
        open={!!aiFor}
        onCancel={() => setAiFor(null)}
        width={720}
        footer={[
          <Button key="manual" onClick={() => void handleAiReview()}>
            仅保存手动判定
          </Button>,
          <Button
            key="run"
            type="primary"
            loading={aiRunning}
            icon={aiRunning ? <LoadingOutlined /> : <RobotOutlined />}
            onClick={() => void handleAiRun()}
            disabled={aiRunning}
          >
            开始评审
          </Button>
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="按本场录音标记构建时间线，或提供整场转录，由 AI 评委整场评审（含环节与发言人）；无 AI API 或评审失败时可用下方「仅保存手动判定」兜底。"
          />
          {aiFor?.recordingMeta?.markers?.length ? (
            <>
              <Divider orientation="left" style={{ margin: '4px 0' }}>
                本场时间线（录音标记 · 补每段内容）
              </Divider>
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                {aiFor.recordingMeta.markers.map((mk, i) => (
                  <div key={`${mk.stageId}-${i}`} className="ant-timeline-seg">
                    <Space direction="vertical" style={{ width: '100%' }} size={2}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        <Text code>{formatMarkerTime(mk.tsMs)}</Text> {mk.stageName}
                        <Text type="secondary">
                          {mk.speaker || (mk.side === 'both' ? '双方' : mk.side ?? '')}
                        </Text>
                      </Text>
                      <Input.TextArea
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        placeholder="填写该段转文字/要点（留空则该段不参与评审）"
                        value={aiSegmentTexts[i] ?? ''}
                        onChange={(e) => {
                          const next = [...aiSegmentTexts]
                          next[i] = e.target.value
                          setAiSegmentTexts(next)
                        }}
                      />
                    </Space>
                  </div>
                ))}
              </Space>
            </>
          ) : (
            <Alert type="warning" showIcon message="该场暂无录音标记（时间线）。可改用下方整场转录进行评审。" />
          )}

          <Divider orientation="left" style={{ margin: '4px 0' }}>
            整场转录（可粘贴或上传文件）
          </Divider>
          <Input.TextArea
            rows={6}
            placeholder="粘贴整场辩论的转录全文（txt/md/docx 亦可上传读取）"
            value={aiTranscript}
            onChange={(e) => setAiTranscript(e.target.value)}
          />
          <Button icon={<FileTextOutlined />} onClick={() => void handleUploadTranscript()}>
            上传 txt / md / docx
          </Button>

          <Divider orientation="left" style={{ margin: '4px 0' }}>评审参数</Divider>
          <div>
            <Text type="secondary">赛制提示（可选）：</Text>
            <Input
              style={{ width: 320 }}
              placeholder="如：新国辩制"
              value={aiFormatHint}
              onChange={(e) => setAiFormatHint(e.target.value)}
            />
          </div>

          <Divider orientation="left" style={{ margin: '4px 0' }}>手动判定兜底（不调 AI）</Divider>
          <Space wrap>
            <Text type="secondary">建议判定：</Text>
            <Select
              style={{ width: 180 }} value={aiWinner}
              onChange={(v) => setAiWinner(v as MatchWinner)}
              options={[
                { value: 'aff', label: '正方胜' },
                { value: 'neg', label: '反方胜' },
                { value: 'draw', label: '平局' }
              ]}
            />
            <Input
              style={{ width: 320 }} placeholder="填写评审说明/判定依据"
              value={aiExplain}
              onChange={(e) => setAiExplain(e.target.value)}
            />
          </Space>
        </Space>
      </Modal>

      {/* AI 评审详情查看（已有本场评审） */}
      <Modal
        title="AI 评审结果"
        open={!!aiReviewFor}
        onCancel={() => setAiReviewFor(null)}
        footer={null}
        width={640}
      >
        {aiReviewFor?.aiReview && <AiReviewDetail match={aiReviewFor} />}
      </Modal>

      {/* 亮牌详情卡（多评委明细 + 环节权重胜负牌，T4.1） */}
      <Modal
        title={`亮牌详情：${verdictFor?.teamAffName ?? '正方'} vs ${verdictFor?.teamNegName ?? '反方'}`}
        open={!!verdictFor}
        onCancel={() => setVerdictFor(null)}
        footer={null}
        width={720}
      >
        {verdictFor && <MatchVerdictCard match={verdictFor} onClose={() => setVerdictFor(null)} />}
      </Modal>
    </div>
  )
}

/** 录音回放：用 Blob URL 播放本地录音，并显示格式描述（wav/m4a/webm） */
function RecordingPlayer({ filePath }: { filePath: string }) {
  const { src, error } = useLocalAudioSrc(filePath)
  const desc = describeRecordingFormatExt(filePath)
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={2}>
      {error ? (
        <Text type="danger">{error}</Text>
      ) : (
        <audio controls src={src ?? undefined} style={{ width: '100%' }} preload="metadata" />
      )}
      <Text type="secondary" style={{ fontSize: 12 }}>{desc}</Text>
    </Space>
  )
}

/** AI 评审结果结构化展示（维度 / 环节判定 / 最佳辩手） */
function AiReviewDetail({ match }: { match: Match }) {
  const r = match.aiReview
  if (!r) return null
  const fromTime = (s?: string) => (s ? new Date(s).toLocaleString() : '—')
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <div>
        <Text strong style={{ color: r.winner === 'aff' ? '#1677ff' : r.winner === 'neg' ? '#ff4d4f' : undefined }}>
          {r.winner === 'aff' ? '正方胜' : r.winner === 'neg' ? '反方胜' : '平局/未定'}
        </Text>
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          {r.judgeName ? `评委 ${r.judgeName} · ` : ''}
          来源 {r.source === 'recording' ? '录音时间线' : r.source === 'transcript' ? '整场转录' : '手动'} · {fromTime(r.reviewedAt)}
        </Text>
      </div>
      <Alert
        type="info"
        showIcon={false}
        message={
          <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {r.explanation}
          </Typography.Paragraph>
        }
      />
      {r.bestSpeaker && (
        <div>
          <Text strong>最佳辩手：</Text>
          <Tag color="gold">{r.bestSpeaker}</Tag>
        </div>
      )}
      {Array.isArray(r.dimensions) && r.dimensions.length > 0 && (
        <>
          <Divider orientation="left" style={{ margin: '4px 0' }}>五维评分</Divider>
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={r.dimensions}
            columns={[
              { title: '维度', dataIndex: 'name', key: 'name' },
              {
                title: '正方', dataIndex: 'affScore', key: 'aff', width: 60,
                render: (v) => <Text strong>{v}</Text>
              },
              {
                title: '反方', dataIndex: 'negScore', key: 'neg', width: 60,
                render: (v) => <Text strong>{v}</Text>
              },
              { title: '评语', dataIndex: 'comment', key: 'comment' }
            ]}
          />
        </>
      )}
      {Array.isArray(r.stageVerdicts) && r.stageVerdicts.length > 0 && (
        <>
          <Divider orientation="left" style={{ margin: '4px 0' }}>环节判定</Divider>
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            {r.stageVerdicts.map((sv, i) => (
              <div key={`${sv.stage}-${i}`}>
                <Tag>{sv.stage}</Tag>
                <Text strong style={{ color: sv.winner === 'aff' ? '#1677ff' : '#ff4d4f' }}>
                {sv.winner === 'aff' ? '正' : '反'}
                </Text>
                <Text type="secondary" style={{ marginLeft: 6 }}>
                  {Math.round((sv.confidence ?? 0) * 100)}% · {sv.comment}
                </Text>
              </div>
            ))}
          </Space>
        </>
      )}
    </Space>
  )
}