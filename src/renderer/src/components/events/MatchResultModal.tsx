// ============================================================
// MatchResultModal.tsx — 比赛「亮牌」赛果录入（多裁判评决）
//
// 重建为真实辩论赛的评决模型（用户决策）：
//   - 评决制度可切换：three_votes 三轮投票制 / percentage 百分制
//   - 动态添加/删除裁判（缺省 3 名奇数）
//   - 三票制每裁判：印象票 + 正方/反方环节总分 + 决胜票
//   - 百分制每裁判：正方分 + 反方分（0-100）
//   - 每裁判可选投「最佳辩手」，最终按众数亮牌
//   - 实时预览按 shared/match-result.computeMatchResult 计算胜负（与主进程同口径）
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Card, Divider, Input, InputNumber, Modal, Radio, Select, Space, Tag, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { computeMatchResult } from '../../../../shared/match-result'
import type { Match, MatchJudgeSystem, MatchWinner } from '../../../../shared/types'
import { useToast } from '../../hooks/useToast'

const { Text } = Typography

interface JudgeDraft {
  key: string
  name: string
  impression: 'aff' | 'neg' | null
  decision: 'aff' | 'neg' | null
  aff: number | null
  neg: number | null
  bestSpeaker: string | null
}

let keySeq = 0
const nextKey = () => `j${++keySeq}_${Date.now()}`

/** 解析最佳辩手组合串 "正方一辩·张三" → { side, position, name }；无法解析时整体当作姓名 */
function parseBestSpeaker(v: string | null): { side: string; position: string; name: string } {
  if (!v) return { side: '', position: '', name: '' }
  const s = String(v).trim()
  const m = s.match(/^(正方|反方)(一辩|二辩|三辩|四辩|自由辩手)(?:·(.*))?$/)
  if (!m) return { side: '', position: '', name: s }
  return { side: m[1], position: m[2], name: (m[3] ?? '').trim() }
}

/** 组合最佳辩手：{side}{position}[·name]，留空返回 ''，可仅填姓名 */
function composeBestSpeaker(p: { side: string; position: string; name: string }): string {
  const base = `${p.side || ''}${p.position || ''}`
  const name = (p.name || '').trim()
  if (!base && !name) return ''
  return name ? `${base ? `${base}·` : ''}${name}` : base
}

function newJudge(name = ''): JudgeDraft {
  return { key: nextKey(), name, impression: null, decision: null, aff: null, neg: null, bestSpeaker: null }
}

const MVP_TEXT: Record<MatchWinner, string> = {
  aff: '正方胜',
  neg: '反方胜',
  draw: '平局',
  abandoned: '弃赛'
}

export interface MatchResultModalProps {
  match: Match | null
  /** 候选最佳辩手（通常为参赛队伍名） */
  speakerOptions: string[]
  onClose: () => void
  onSaved: () => void
}

export default function MatchResultModal({ match, speakerOptions, onClose, onSaved }: MatchResultModalProps) {
  const toast = useToast()
  const [system, setSystem] = useState<MatchJudgeSystem>('three_votes')
  const [judges, setJudges] = useState<JudgeDraft[]>([newJudge('裁判1'), newJudge('裁判2'), newJudge('裁判3')])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (match) {
      setSystem(match.judgeSystem === 'percentage' ? 'percentage' : 'three_votes')
      const existing = match.judges && match.judges.length ? match.judges.map((j) => {
        const v = (match.votes ?? []).find((x) => x.judgeId === j.id)
        return {
          key: nextKey(),
          name: j.name,
          impression: v?.impressionVote ?? null,
          decision: v?.decisionVote ?? null,
          aff: v?.affTotal ?? null,
          neg: v?.negTotal ?? null,
          bestSpeaker: v?.bestSpeaker ?? null
        }
      }) : [newJudge('裁判1'), newJudge('裁判2'), newJudge('裁判3')]
      setJudges(existing)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id])

  const preview = useMemo(
    () => computeMatchResult(system, judges),
    [system, judges]
  )

  const update = (key: string, patch: Partial<JudgeDraft>) =>
    setJudges((prev) => prev.map((j) => (j.key === key ? { ...j, ...patch } : j)))

  const addJudge = () => setJudges((prev) => [...prev, newJudge(`裁判${prev.length + 1}`)])
  const removeJudge = (key: string) =>
    setJudges((prev) => (prev.length <= 1 ? prev : prev.filter((j) => j.key !== key)))

  const handleSubmit = async () => {
    if (!match) return
    const dirt = judges.filter((j) => !j.name.trim())
    if (dirt.length) {
      toast.warning('请为每名裁判填写姓名（或删除空行）')
      return
    }
    setSaving(true)
    try {
      const payload: {
        winner: MatchWinner
        judges: Array<{
          name: string
          vote: {
            judgeSystem: MatchJudgeSystem
            impressionVote: 'aff' | 'neg' | null
            decisionVote: 'aff' | 'neg' | null
            affTotal: number | null
            negTotal: number | null
            bestSpeaker: string | null
          }
        }>
      } = {
        winner: preview.winner as MatchWinner,
        judges: judges.map((j) => ({
          name: j.name.trim(),
          vote: {
            judgeSystem: system,
            impressionVote: system === 'three_votes' ? j.impression : null,
            decisionVote: system === 'three_votes' ? j.decision : null,
            affTotal: j.aff,
            negTotal: j.neg,
            bestSpeaker: j.bestSpeaker
          }
        }))
      }
      const res = await window.matchAPI.setResult(match.id, payload)
      if (res.success) {
        toast.success('赛果已亮牌')
        onSaved()
        onClose()
      } else {
        toast.error(res.error || '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  // 最佳辩手 = 持方 + 辩位（正反方几辩），姓名可选；组合为 "正方一辩·张三"
  const speakerSelect = (value: string | null, onChange: (v: string | null) => void) => {
    const parsed = parseBestSpeaker(value)
    const rebuild = (p: { side: string; position: string; name: string }) => onChange(composeBestSpeaker(p) || null)
    const sideOpts = [
      { value: '正方', label: match?.teamAffName ? `正方·${match.teamAffName}` : '正方' },
      { value: '反方', label: match?.teamNegName ? `反方·${match.teamNegName}` : '反方' }
    ]
    const posOpts = ['一辩', '二辩', '三辩', '四辩', '自由辩手'].map((p) => ({ value: p, label: p }))
    return (
      <Space size={4} wrap>
        <Select
          size="small" style={{ width: 96 }} placeholder="持方" allowClear
          value={parsed.side || undefined}
          onChange={(s) => rebuild({ ...parsed, side: s ?? '' })}
          options={sideOpts}
        />
        <Select
          size="small" style={{ width: 78 }} placeholder="辩位" allowClear
          value={parsed.position || undefined}
          onChange={(p) => rebuild({ ...parsed, position: p ?? '' })}
          options={posOpts}
        />
        <AutoComplete
          size="small" style={{ width: 104 }} placeholder="姓名(可选)" allowClear
          value={parsed.name}
          onChange={(n) => rebuild({ ...parsed, name: n ?? '' })}
          options={speakerOptions.map((s) => ({ value: s, label: s }))}
        />
      </Space>
    )
  }

  return (
    <Modal
      title={`亮牌：${match?.teamAffName ?? '正方'} vs ${match?.teamNegName ?? '反方'}`}
      width={680}
      open={!!match}
      onCancel={onClose}
      onOk={() => void handleSubmit()}
      okText={saving ? '保存中…' : '亮牌'}
      confirmLoading={saving}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Text>评决制度</Text>
          <Radio.Group
            value={system}
            onChange={(e) => setSystem(e.target.value as MatchJudgeSystem)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'three_votes', label: '三轮投票制（印象/环节/决胜）' },
              { value: 'percentage', label: '百分制' }
            ]}
          />
        </Space>

        {judges.map((j) => (
          <Card size="small" key={j.key} style={{ marginBottom: 8 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
              <Input
                style={{ width: 110 }} size="small" placeholder="裁判姓名"
                value={j.name} onChange={(e) => update(j.key, { name: e.target.value })}
              />
              {system === 'three_votes' ? (
                <>
                  <Select size="small" style={{ width: 110 }} placeholder="印象票"
                    value={j.impression ?? undefined}
                    onChange={(v) => update(j.key, { impression: v })}
                    options={[{ value: 'aff', label: '印象·正方' }, { value: 'neg', label: '印象·反方' }]}
                  />
                  <span>
                    分 <Text type="secondary">正</Text>
                    <InputNumber size="small" min={0} max={100} style={{ width: 64 }} value={j.aff ?? undefined}
                      onChange={(v) => update(j.key, { aff: v ?? null })} />
                    <Text type="secondary">反</Text>
                    <InputNumber size="small" min={0} max={100} style={{ width: 64 }} value={j.neg ?? undefined}
                      onChange={(v) => update(j.key, { neg: v ?? null })} />
                  </span>
                  <Select size="small" style={{ width: 110 }} placeholder="决胜票"
                    value={j.decision ?? undefined}
                    onChange={(v) => update(j.key, { decision: v })}
                    options={[{ value: 'aff', label: '决胜·正方' }, { value: 'neg', label: '决胜·反方' }]}
                  />
                </>
              ) : (
                <span>
                  分 <Text type="secondary">正</Text>
                  <InputNumber size="small" min={0} max={100} style={{ width: 64 }} value={j.aff ?? undefined}
                    onChange={(v) => update(j.key, { aff: v ?? null })} />
                  <Text type="secondary">反</Text>
                  <InputNumber size="small" min={0} max={100} style={{ width: 64 }} value={j.neg ?? undefined}
                    onChange={(v) => update(j.key, { neg: v ?? null })} />
                </span>
              )}
              {speakerSelect(j.bestSpeaker, (v) => update(j.key, { bestSpeaker: v }))}
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeJudge(j.key)} disabled={judges.length <= 1} />
            </Space>
          </Card>
        ))}

        <Button size="small" icon={<PlusOutlined />} onClick={addJudge}>添加裁判</Button>

        <Divider style={{ margin: '8px 0' }} />
        {/* 实时胜负牌预览 */}
        <div>
          <Text type="secondary" style={{ marginRight: 8 }}>胜负牌预览</Text>
          {preview.votes ? (
            <>
              <Tag color={preview.winner === 'aff' ? 'blue' : preview.winner === 'neg' ? 'red' : 'default'}>
                {MVP_TEXT[preview.winner]}（{preview.votes.aff}:{preview.votes.neg}
                {preview.votes.impression.aff + preview.votes.impression.neg + preview.votes.stage.aff + preview.votes.stage.neg + preview.votes.decision.aff + preview.votes.decision.neg > 0 ? '' : ''}）
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                印象 {preview.votes.impression.aff}:{preview.votes.impression.neg} ·
                环节 {preview.votes.stage.aff}:{preview.votes.stage.neg} ·
                决胜 {preview.votes.decision.aff}:{preview.votes.decision.neg}
              </Text>
            </>
          ) : (
            <Tag color={preview.winner === 'aff' ? 'blue' : preview.winner === 'neg' ? 'red' : 'default'}>
              {MVP_TEXT[preview.winner]}（均分 {preview.affScore ?? '—'}:{preview.negScore ?? '—'}）
            </Tag>
          )}
          {preview.bestSpeaker && <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>最佳辩手：{preview.bestSpeaker}</Text>}
        </div>

        <Text type="secondary" style={{ fontSize: 12 }}>
          环节权重按赛制计；本页先按整场总分亮牌，环节级明细在计时/AI 评审中扩充。
        </Text>
      </Space>
    </Modal>
  )
}