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
  AuditOutlined,
  DeleteOutlined,
  BookOutlined,
  AudioOutlined,
  ExportOutlined,
  ImportOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useEventStore } from '../../stores/eventStore'
import { useTopicStore } from '../../stores/topicStore'
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
  ScheduleDiffPreview,
  ScheduleApplyResult
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

  // ---- 赛程 Excel 导出 / 导入（P1-6）----
  const [exporting, setExporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<ScheduleDiffPreview | null>(null)
  const [importPath, setImportPath] = useState<string | null>(null)
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<ScheduleApplyResult | null>(null)

  const handleExportSchedule = async () => {
    setExporting(true)
    try {
      const res = await window.scheduleAPI.exportSchedule(eventId)
      if (res.success && res.data) toast.success(`已导出 ${res.data.count} 场赛程`)
      else if (res.success && !res.data) toast.info('已取消导出')
      else toast.error(res.error || '导出失败')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  const handleImportSchedule = async () => {
    const picked = await window.fileAPI.pickFile([{ name: 'Excel', extensions: ['xlsx'] }])
    if (!picked.success) {
      toast.error(picked.error ?? '选择文件失败')
      return
    }
    if (!picked.data) return // 用户取消
    const res = await window.scheduleAPI.importParse(eventId, picked.data)
    if (!res.success) {
      toast.error(res.error || '导入解析失败')
      return
    }
    setImportPath(picked.data)
    setImportWarnings(res.data?.warnings ?? [])
    setImportPreview(res.data ?? { added: [], updated: [], deleted: [], unchanged: 0, warnings: [] })
    setApplyResult(null)
    setImportOpen(true)
  }

  const handleApplyImport = async () => {
    if (!importPreview) return
    setApplying(true)
    try {
      const res = await window.scheduleAPI.importApply(eventId, importPreview)
      if (res.success && res.data) {
        setApplyResult(res.data)
        setImportWarnings(res.data.warnings)
        toast.success(`已新增 ${res.data.appliedAdd} / 更新 ${res.data.appliedUpdate} / 删除 ${res.data.appliedDelete}`)
        void load()
      } else {
        toast.error(res.error || '应用失败')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

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

  /** 打开 AI 裁判工作台并预绑定当前赛事-轮次-场次（T4） */
  const handleOpenJudgeArena = (m: Match): void => {
    navigate('/judge', {
      state: {
        eventId: m.eventId,
        roundId: m.roundId ?? null,
        matchId: m.id,
        eventName: m.eventName
      }
    })
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
          <Button size="small" icon={<AuditOutlined />} onClick={() => handleOpenJudgeArena(m)}>
            打开AI裁判台
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
        <Button icon={<ExportOutlined />} loading={exporting} onClick={() => void handleExportSchedule()}>
          导出赛程
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => void handleImportSchedule()}>
          导入赛程
        </Button>
        <Button
          type="link"
          size="small"
          onClick={() => {
            // 导出一次即可得到可编辑模板，导入前先提示工作流
            toast.info('导出赛程为 xlsx → 在 Excel 中调整 → 「导入赛程」预览变更后确认应用')
          }}
        >
          怎么用？
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

      {/* 赛程 Excel 导入变更预览（P1-6） */}
      <Modal
        title="赛程导入变更预览"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        width={760}
        okText="确认应用"
        okButtonProps={{ danger: true }}
        confirmLoading={applying}
        onOk={() => void handleApplyImport()}
        footer={
          applyResult
            ? [<Button key="close" onClick={() => setImportOpen(false)}>关闭</Button>]
            : undefined
        }
      >
        {importPreview && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {(importWarnings.length > 0 || (importPreview.warnings ?? []).length > 0) && (
              <Alert
                type="warning"
                showIcon
                message={`文件：${importPath ?? ''}`}
                description={<div style={{ maxHeight: 120, overflow: 'auto' }}>
                  {[...(importPreview.warnings ?? []), ...importWarnings].filter((v, i, a) => a.indexOf(v) === i).map((w, i) => <div key={i}>· {w}</div>)}
                </div>}
              />
            )}
            {applyResult ? (
              <Alert
                type="success"
                showIcon
                message="已应用"
                description={`新增 ${applyResult.appliedAdd} · 更新 ${applyResult.appliedUpdate} · 删除 ${applyResult.appliedDelete} · 跳过 ${applyResult.skipped}`}
              />
            ) : (
              <>
                <div>
                  <Tag color="green">将新增 {importPreview.added.length}</Tag>
                  <Tag color="blue">将更新 {importPreview.updated.length}</Tag>
                  <Tag color="red">将删除 {importPreview.deleted.length}</Tag>
                  <Tag>不变 {importPreview.unchanged}</Tag>
                </div>
                {importPreview.added.length + importPreview.updated.length + importPreview.deleted.length === 0 && (
                  <Alert type="info" showIcon message="导入与当前赛程一致，无变更。" />
                )}
                {importPreview.added.length > 0 && (
                  <DiffTable title="将新增" color="green" rows={importPreview.added.map((a) => ({ key: a.key, ...a.row }))} />
                )}
                {importPreview.updated.length > 0 && (
                  <DiffTable title="将更新" color="blue" rows={importPreview.updated.map((a) => ({ key: a.key, ...a.row }))} />
                )}
                {importPreview.deleted.length > 0 && (
                  <DiffTable title="将删除" color="red" rows={importPreview.deleted.map((a) => ({ key: a.key, ...a.row }))} />
                )}
              </>
            )}
          </Space>
        )}
      </Modal>
    </div>
  )
}

/** 变更预览分组表格 */
function DiffTable({
  title,
  color,
  rows
}: {
  title: string
  color: string
  rows: Array<{ key: string; roundName: string | null; matchNumber: number | null; teamAff: string; teamNeg: string; topic: string }>
}) {
  return (
    <div>
      <Text strong style={{ color: color === 'red' ? '#ff4d4f' : color === 'blue' ? '#1677ff' : undefined }}>
        {title}
      </Text>
      <Table
        rowKey="key"
        size="small"
        style={{ marginTop: 4 }}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '轮次', dataIndex: 'roundName', key: 'roundName', width: 90, render: (v) => v || '—' },
          { title: '场次', dataIndex: 'matchNumber', key: 'matchNumber', width: 60 },
          { title: '对阵', key: 'matchup', render: (_, r) => `${r.teamAff || '正方'} vs ${r.teamNeg || '反方'}` },
          { title: '辩题', dataIndex: 'topic', key: 'topic', ellipsis: true, render: (v) => v || '—' }
        ]}
      />
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