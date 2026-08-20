// ============================================================
// MatchVerdictCard.tsx — 亮牌详情卡：多评委明细 + 环节权重胜负牌
//
// 只读回看一场已亮牌（status='resulted'）比赛的多评委评决：
//   顶部胜负牌（三票制票数 / 百分制均分，与主进程 computeMatchResult 同口径）
//   + 每裁判明细（印象票/环节分/决胜票/最佳辩手/点评）
//   + 每裁判环节分值表（权重 normalizeStageWeights 展示）
//   + 汇总最佳辩手。
// 无 judges/votes 时显示「暂无评委明细」。
// ============================================================

import { useMemo } from 'react'
import { Alert, Card, Divider, Empty, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { computeMatchResult } from '../../../../shared/match-result'
import { normalizeStageWeights } from '../../../../shared/debate-formats/utils'
import type { Match, MatchJudgeVote } from '../../../../shared/types'

const { Text } = Typography

const WINNER_TEXT: Record<Match['winner'] & string, string> = {
  aff: '正方胜',
  neg: '反方胜',
  draw: '平局',
  abandoned: '弃赛'
}

const SIDE_TEXT: Record<string, string> = { aff: '正方', neg: '反方' }

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

export default function MatchVerdictCard({ match, onClose }: { match: Match; onClose: () => void }) {
  void onClose
  const judges = match.judges ?? []
  const votes = match.votes ?? []
  const hasDetail = match.status === 'resulted' && judges.length > 0 && votes.length > 0

  const summary = useMemo(
    () => computeMatchResult(match.judgeSystem, votes),
    [match.judgeSystem, votes]
  )

  if (!hasDetail) {
    return <Empty description="暂无评委明细" />
  }

  const voteOf = (judgeId: string): MatchJudgeVote | undefined => votes.find((v) => v.judgeId === judgeId)

  const isThree = match.judgeSystem !== 'percentage'
  const winner = match.winner

  const detailColumns: ColumnsType<{ key: string; name: string; vote?: MatchJudgeVote }> = [
    { title: '裁判', dataIndex: 'name', key: 'name', width: 110 },
    {
      title: '印象票',
      key: 'impression',
      width: 80,
      render: (_, r) => {
        const v = r.vote
        if (!isThree || !v?.impressionVote) return <Text type="secondary">—</Text>
        return (
          <Text style={{ color: v.impressionVote === 'aff' ? '#1677ff' : '#ff4d4f' }}>
            {SIDE_TEXT[v.impressionVote]}
          </Text>
        )
      }
    },
    {
      title: '环节分',
      key: 'score',
      width: 90,
      render: (_, r) => {
        const v = r.vote
        if (v?.affTotal == null || v.negTotal == null) return <Text type="secondary">—</Text>
        return (
          <Text>
            <Text style={{ color: '#1677ff' }} strong>{fmt(v.affTotal)}</Text>
            <Text type="secondary">:</Text>
            <Text style={{ color: '#ff4d4f' }} strong>{fmt(v.negTotal)}</Text>
          </Text>
        )
      }
    },
    {
      title: '决胜票',
      key: 'decision',
      width: 80,
      render: (_, r) => {
        const v = r.vote
        if (!isThree || !v?.decisionVote) return <Text type="secondary">—</Text>
        return (
          <Text style={{ color: v.decisionVote === 'aff' ? '#1677ff' : '#ff4d4f' }}>
            {SIDE_TEXT[v.decisionVote]}
          </Text>
        )
      }
    },
    {
      title: '最佳辩手',
      key: 'best',
      width: 110,
      render: (_, r) => (r.vote?.bestSpeaker ? <Tag color="gold">{r.vote.bestSpeaker}</Tag> : <Text type="secondary">—</Text>)
    },
    {
      title: '点评',
      key: 'comment',
      render: (_, r) => (r.vote?.comment ? <Text style={{ whiteSpace: 'pre-wrap' }}>{r.vote.comment}</Text> : <Text type="secondary">—</Text>)
    }
  ]

  const detailRows = judges.map((j) => ({ key: j.id, name: j.name, vote: voteOf(j.id) }))

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {/* 顶部胜负牌 */}
      <Card size="small">
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Text strong style={{ fontSize: 16, color: winner === 'aff' ? '#1677ff' : winner === 'neg' ? '#999' : undefined }}>
            {match.teamAffName || '正方'}
          </Text>
          <Text type="secondary">vs</Text>
          <Text strong style={{ fontSize: 16, color: winner === 'neg' ? '#ff4d4f' : winner === 'aff' ? '#999' : undefined }}>
            {match.teamNegName || '反方'}
          </Text>
          <Tag color={winner === 'aff' ? 'blue' : winner === 'neg' ? 'red' : winner === 'draw' ? 'orange' : 'default'}>
            {WINNER_TEXT[winner ?? 'draw']}
          </Tag>
        </Space>
        <Divider style={{ margin: '10px 0' }} />
        {isThree && summary.votes ? (
          <Space direction="vertical" size={2}>
            <Text strong style={{ fontSize: 14 }}>
              票数 正方{fmt(summary.votes.aff)} : {fmt(summary.votes.neg)}反方
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              印象 {fmt(summary.votes.impression.aff)}:{fmt(summary.votes.impression.neg)} ·{' '}
              环节 {fmt(summary.votes.stage.aff)}:{fmt(summary.votes.stage.neg)} ·{' '}
              决胜 {fmt(summary.votes.decision.aff)}:{fmt(summary.votes.decision.neg)}
            </Text>
          </Space>
        ) : (
          <Text strong style={{ fontSize: 14 }}>
            均分 正方{match.affScore ?? '—'} : {match.negScore ?? '—'}反方
          </Text>
        )}
      </Card>

      {/* 每裁判明细 */}
      <Table<{ key: string; name: string; vote?: MatchJudgeVote }>
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={detailRows}
        columns={detailColumns}
      />

      {/* 每裁判环节分值表 */}
      {detailRows.some((r) => r.vote?.stageScores?.length) && (
        <>
          <Divider orientation="left" style={{ margin: '4px 0' }}>环节分值</Divider>
          {detailRows
            .filter((r) => r.vote?.stageScores?.length)
            .map((r) => {
              const ss = r.vote!.stageScores!
              const weights = normalizeStageWeights(ss.map((s) => ({ id: s.stageId, weight: s.weight })))
              const stageColumns: ColumnsType<(typeof ss)[number]> = [
                {
                  title: '环节（权重）',
                  dataIndex: 'stageName',
                  key: 'stage',
                  width: 180,
                  render: (v, s) => (weights[s.stageId] !== 1 ? `${v} ×${fmt(weights[s.stageId])}` : v)
                },
                {
                  title: '正方', dataIndex: 'aff', key: 'aff', width: 80,
                  render: (vv) => <Text strong style={{ color: '#1677ff' }}>{fmt(vv)}</Text>
                },
                {
                  title: '反方', dataIndex: 'neg', key: 'neg', width: 80,
                  render: (vv) => <Text strong style={{ color: '#ff4d4f' }}>{fmt(vv)}</Text>
                }
              ]
              return (
                <Card key={r.key} size="small" title={r.name} style={{ marginBottom: 8 }}>
                  <Table rowKey="stageId" size="small" pagination={false} dataSource={ss} columns={stageColumns} />
                </Card>
              )
            })}
        </>
      )}

      {/* 点评未覆盖行内展示的补充说明 + 汇总最佳辩手 */}
      {match.bestSpeaker && (
        <div>
          <Text strong>最佳辩手：</Text>
          <Tag color="gold">{match.bestSpeaker}</Tag>
        </div>
      )}
      {match.notes && (
        <Alert type="info" showIcon={false} message={match.notes} />
      )}
    </Space>
  )
}