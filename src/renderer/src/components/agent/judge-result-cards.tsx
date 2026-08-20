// ============================================================
// judge-result-cards.tsx — AI 裁判结果卡片（2026-08-18）
//
// 从 ToolCallCard.tsx 抽出的 5 个 AI 裁判结果卡片组件（2026-08-18 移除 rewrite_speech，T3.1 增 judge_match），
// 供两处复用：
//   1. Agent 聊天流的 ToolCallCard（工具调用结果卡片）
//   2. AI 裁判工作台独立页面（JudgeArena）
//
// 包含：结果接口定义、卡片组件、JudgeResultCardByTool 切换器。
// STAGE_NAMES 由 shared/debate-stages.ts 的 STAGE_DEFINITIONS 派生。
// 评委显示：不显示真人名，按 judgeId 映射为风格类别（judgeCategoryOf）。
// ============================================================

import React, { useState } from 'react'
import { Alert, Typography, Tag, Progress, theme } from 'antd'
import { STAGE_DEFINITIONS } from '../../../../shared/debate-stages'
import { getJudgeById } from '../../../../shared/ai-judges'

/** 按 judgeId 映射评委风格类别（不显示真人名）；查不到兜底「AI 裁判」 */
export function judgeCategoryOf(judgeId: string | undefined): string {
  if (!judgeId) return 'AI 裁判'
  return getJudgeById(judgeId)?.category ?? 'AI 裁判'
}

// ---------- 结果接口（与 main/agent/tools/*.tool.ts 对齐） ----------

/** judge_debate 单维评分 */
export interface JudgeDimensionScore {
  key: string
  name: string
  affScore: number
  negScore: number
  comment: string
}

/** judge_debate 成功结果 */
export interface JudgeDebateResult {
  judgeId: string
  judgeName: string
  topic: string
  verdict: { winner: 'aff' | 'neg'; confidence: number; reason: string }
  dimensions: JudgeDimensionScore[]
  summary: string
  /** 批3：环节分段判定（可选） */
  stageVerdicts?: Array<{
    stage: string
    winner: 'aff' | 'neg'
    confidence: number
    comment: string
  }>
}

/** judge_match 整场评审结果（与 main agent/tools/judge-match.tool.ts 的 JudgeMatchResult 对齐） */
export interface JudgeMatchResult {
  judgeId: string
  judgeName: string
  topic: string
  /** 素材足以判定时为对象；素材不足时为 null（配合 success:true + insufficientReason） */
  verdict: { winner: 'aff' | 'neg'; confidence: number; reason: string } | null
  dimensions: Array<{ key: string; name: string; affScore: number; negScore: number; comment: string }>
  summary: string
  stageVerdicts?: Array<{
    stage: string
    winner: 'aff' | 'neg'
    confidence: number
    comment: string
  }>
  bestSpeaker?: string | null
  /** 素材不足时的原因（verdict 为 null 时提供） */
  insufficientReason?: string
}

/** judge_speech 结果 */
export interface JudgeSpeechResult {
  judgeId: string
  judgeName: string
  topic: string
  stage: string
  side: 'aff' | 'neg'
  dimensions: Array<{ key: string; name: string; score: number; comment: string }>
  gaps: Array<{ severity: 'high' | 'medium' | 'low'; description: string; evidence?: string }>
  improvements: Array<{ target: string; suggestion: string }>
  summary: string
}

/** detect_stage 结果 */
export interface DetectStageResult {
  stage: string
  confidence: number
  reasons: string
}

/** simulate_opponent 结果 */
export interface SimulateOpponentResult {
  judgeId: string
  judgeName: string
  topic: string
  side: 'aff' | 'neg'
  attackMode: string
  weaknessSummary: string
  attackPoints: Array<{
    layer: 'fact' | 'theory' | 'value'
    point: string
    target: string
    defenseHint: string
  }>
}

// ---------- 映射（STAGE_NAMES 由 STAGE_DEFINITIONS 派生） ----------

/** 环节类型 → 展示名（shared/debate-stages.ts 派生） */
export const STAGE_NAMES: Record<string, string> = Object.fromEntries(
  STAGE_DEFINITIONS.map((s) => [s.type, s.name])
)

/** severity → Tag 颜色 */
const GAP_SEVERITY_COLOR: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'default'
}

/** 攻击方式 → 展示名与颜色 */
const ATTACK_MODE_META: Record<string, { label: string; color: string }> = {
  cross_exam: { label: '质询盘问', color: 'geekblue' },
  rebuttal: { label: '驳论攻击', color: 'volcano' },
  free_debate: { label: '自由辩突袭', color: 'purple' }
}

/** 攻击层次 → Tag 颜色 */
const LAYER_COLOR: Record<string, string> = {
  fact: 'blue',
  theory: 'green',
  value: 'purple'
}

// ---------- 卡片组件 ----------

/**
 * judge_debate 工具结果卡片。
 * 头部：评委 + 胜负 Tag + 置信度；环节判定区（可选）；五维双方分数对比 + 评语；评委风格总评。
 */
export function JudgeResultCard({ result }: { result: JudgeDebateResult }): JSX.Element {
  const { token } = theme.useToken()
  const { topic, verdict, dimensions, summary, stageVerdicts } = result
  const affWon = verdict.winner === 'aff'

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        borderRadius: 6,
        backgroundColor: token.colorPrimaryBg,
        border: `1px solid ${token.colorPrimaryBorder}`
      }}
    >
      {/* 头部：评委 + 胜负 + 置信度 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
          flexWrap: 'wrap'
        }}
      >
        <Typography.Text strong style={{ fontSize: 13 }}>
          ⚖️ {judgeCategoryOf(result.judgeId)} · 判定
        </Typography.Text>
        <Tag color={affWon ? 'blue' : 'orange'}>{affWon ? '正方胜' : '反方胜'}</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          置信度 {Math.round(verdict.confidence * 100)}%
        </Typography.Text>
      </div>

      {topic ? (
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
        >
          辩题：{topic}
        </Typography.Text>
      ) : null}
      {verdict.reason ? (
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, display: 'block', marginBottom: 8 }}
        >
          {verdict.reason}
        </Typography.Text>
      ) : null}

      {/* 批3：环节判定区（仅提供分段时显示） */}
      {stageVerdicts && stageVerdicts.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4 }}>
            环节判定
          </div>
          {stageVerdicts.map((sv, i) => {
            const svAffWon = sv.winner === 'aff'
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  marginBottom: 4,
                  flexWrap: 'wrap'
                }}
              >
                <span style={{ color: token.colorTextSecondary }}>
                  {STAGE_NAMES[sv.stage] ?? sv.stage}
                </span>
                <Tag color={svAffWon ? 'blue' : 'orange'}>{svAffWon ? '正方胜' : '反方胜'}</Tag>
                <span style={{ color: token.colorTextSecondary }}>
                  {Math.round(sv.confidence * 100)}%
                </span>
                {sv.comment ? (
                  <span style={{ color: token.colorText }}>{sv.comment}</span>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* 五维双方评分对比 */}
      {dimensions.map((d) => (
        <div key={d.key} style={{ marginBottom: 6 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              marginBottom: 2
            }}
          >
            <span>{d.name}</span>
            <span>
              <span style={{ color: token.colorInfo }}>正 {d.affScore}</span>
              {' / '}
              <span style={{ color: token.colorWarning }}>反 {d.negScore}</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Progress
              percent={d.affScore * 10}
              size="small"
              strokeColor={token.colorInfo}
              style={{ flex: 1, margin: 0 }}
            />
            <Progress
              percent={d.negScore * 10}
              size="small"
              strokeColor={token.colorWarning}
              style={{ flex: 1, margin: 0 }}
            />
          </div>
          {d.comment ? (
            <div
              style={{
                fontSize: 12,
                color: token.colorTextSecondary,
                marginTop: 2,
                whiteSpace: 'pre-wrap'
              }}
            >
              {d.comment}
            </div>
          ) : null}
        </div>
      ))}

      {/* 评委风格总评 */}
      {summary ? (
        <Typography.Paragraph
          style={{
            fontSize: 12,
            color: token.colorText,
            marginTop: 8,
            marginBottom: 0,
            whiteSpace: 'pre-wrap'
          }}
        >
          {summary}
        </Typography.Paragraph>
      ) : null}
    </div>
  )
}

/**
 * judge_match 整场评审结果卡片。
 * 复用 JudgeResultCard 的判定/环节/五维/总评展示，并额外展示全场最佳辩手。
 */
export function JudgeMatchResultCard({ result }: { result: JudgeMatchResult }): JSX.Element {
  const { token } = theme.useToken()

  // 素材不足以判定：verdict 为 null（success:true + insufficientReason）
  if (!result.verdict) {
    const reason = result.insufficientReason?.trim()
    return (
      <div
        style={{
          marginTop: 8,
          padding: 8,
          borderRadius: 6,
          backgroundColor: token.colorPrimaryBg,
          border: `1px solid ${token.colorWarningBorder}`
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
            flexWrap: 'wrap'
          }}
        >
          <Typography.Text strong style={{ fontSize: 13 }}>
            ⚖️ {judgeCategoryOf(result.judgeId)} · 判定
          </Typography.Text>
          <Tag color="orange">无法判定</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            素材不足
          </Typography.Text>
        </div>
        {result.topic ? (
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
          >
            辩题：{result.topic}
          </Typography.Text>
        ) : null}
        <Alert
          type="warning"
          showIcon
          message="素材不足，无法判定"
          description={
            reason ??
            '素材过短或与辩题无关，无法进行有效判定。请补充完整的辩论录音/转写后再试。'
          }
          style={{ fontSize: 12 }}
        />
      </div>
    )
  }

  const bestSpeaker = result.bestSpeaker
  return (
    <div>
      <JudgeResultCard result={result as unknown as JudgeDebateResult} />
      {bestSpeaker ? (
        <div style={{ marginTop: 6, fontSize: 12, color: token.colorText }}>
          全场最佳辩手：<Typography.Text strong>{bestSpeaker}</Typography.Text>
        </div>
      ) : null}
    </div>
  )
}

/**
 * judge_speech 单方稿评估结果卡片。
 * 展示：评委 + 环节 + 立场；五维单方评分；漏洞清单（severity Tag 可展开）；改进建议；总评。
 */
export function JudgeSpeechResultCard({ result }: { result: JudgeSpeechResult }): JSX.Element {
  const { token } = theme.useToken()
  const { topic, stage, side, dimensions, gaps, improvements, summary } = result
  const [gapsExpanded, setGapsExpanded] = useState(false)

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        borderRadius: 6,
        backgroundColor: token.colorPrimaryBg,
        border: `1px solid ${token.colorPrimaryBorder}`
      }}
    >
      {/* 头部：评委 + 环节 + 立场 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
          flexWrap: 'wrap'
        }}
      >
        <Typography.Text strong style={{ fontSize: 13 }}>
          📝 {judgeCategoryOf(result.judgeId)} · 评估
        </Typography.Text>
        <Tag color="geekblue">{STAGE_NAMES[stage] ?? stage}</Tag>
        <Tag color={side === 'aff' ? 'blue' : 'orange'}>{side === 'aff' ? '正方稿' : '反方稿'}</Tag>
      </div>

      {topic ? (
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
        >
          辩题：{topic}
        </Typography.Text>
      ) : null}

      {/* 五维单方评分 */}
      {dimensions.map((d) => (
        <div key={d.key} style={{ marginBottom: 6 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              marginBottom: 2
            }}
          >
            <span>{d.name}</span>
            <span>{d.score}/10</span>
          </div>
          <Progress
            percent={d.score * 10}
            size="small"
            strokeColor={d.score >= 7 ? token.colorSuccess : d.score >= 5 ? token.colorWarning : token.colorError}
            style={{ margin: 0 }}
          />
          {d.comment ? (
            <div
              style={{
                fontSize: 12,
                color: token.colorTextSecondary,
                marginTop: 2,
                whiteSpace: 'pre-wrap'
              }}
            >
              {d.comment}
            </div>
          ) : null}
        </div>
      ))}

      {/* 漏洞清单 */}
      {gaps.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>漏洞清单</span>
            <Typography.Link
              style={{ fontSize: 12, color: token.colorPrimary, cursor: 'pointer' }}
              onClick={() => setGapsExpanded((v) => !v)}
            >
              {gapsExpanded ? '收起' : `展开（${gaps.length} 条）`}
            </Typography.Link>
          </div>
          {gapsExpanded && (
            <div style={{ marginTop: 4 }}>
              {gaps.map((g, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    marginBottom: 4,
                    backgroundColor: token.colorFillQuaternary,
                    borderRadius: 4,
                    padding: '4px 8px',
                    wordBreak: 'break-word',
                    lineHeight: 1.5
                  }}
                >
                  <Tag color={GAP_SEVERITY_COLOR[g.severity]} style={{ marginRight: 6 }}>
                    {g.severity === 'high' ? '高' : g.severity === 'medium' ? '中' : '低'}
                  </Tag>
                  {g.description}
                  {g.evidence ? (
                    <div style={{ color: token.colorTextSecondary, marginTop: 2 }}>
                      原文：{g.evidence}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* 改进建议 */}
      {improvements.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4 }}>
            改进建议
          </div>
          {improvements.map((imp, i) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 4, lineHeight: 1.5 }}>
              <Typography.Text strong style={{ fontSize: 12 }}>
                {imp.target}：
              </Typography.Text>
              {imp.suggestion}
            </div>
          ))}
        </div>
      ) : null}

      {/* 总评 */}
      {summary ? (
        <Typography.Paragraph
          style={{
            fontSize: 12,
            color: token.colorText,
            marginTop: 8,
            marginBottom: 0,
            whiteSpace: 'pre-wrap'
          }}
        >
          {summary}
        </Typography.Paragraph>
      ) : null}
    </div>
  )
}

/**
 * detect_stage 环节识别结果卡片。
 * 展示：识别出的环节类型 + 置信度 + 判断依据；置信度 < 0.8 时提示用户确认。
 */
export function DetectStageResultCard({ result }: { result: DetectStageResult }): JSX.Element {
  const { token } = theme.useToken()
  const { stage, confidence, reasons } = result
  const lowConfidence = confidence < 0.8

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        borderRadius: 6,
        backgroundColor: token.colorPrimaryBg,
        border: `1px solid ${token.colorPrimaryBorder}`
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
          flexWrap: 'wrap'
        }}
      >
        <Typography.Text strong style={{ fontSize: 13 }}>
          🔍 环节识别
        </Typography.Text>
        <Tag color="geekblue">{STAGE_NAMES[stage] ?? stage}</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          置信度 {Math.round(confidence * 100)}%
        </Typography.Text>
        {lowConfidence ? (
          <Tag color="orange">建议确认</Tag>
        ) : (
          <Tag color="green">识别明确</Tag>
        )}
      </div>
      {reasons ? (
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, display: 'block', whiteSpace: 'pre-wrap' }}
        >
          {reasons}
        </Typography.Text>
      ) : null}
      {lowConfidence ? (
        <Typography.Text
          style={{ fontSize: 12, display: 'block', marginTop: 4, color: token.colorWarning }}
        >
          置信度较低：建议在评估稿子时明确指定环节类型（如"这是立论稿"）。
        </Typography.Text>
      ) : null}
    </div>
  )
}

/**
 * simulate_opponent 模拟对方攻击结果卡片。
 * 展示：评委 + 攻击方式 + 立场；总体弱点；攻击点按 layer 分组（默认折叠），
 * 每条含攻击内容 + 针对部分 + 防守建议。
 */
export function SimulateOpponentCard({ result }: { result: SimulateOpponentResult }): JSX.Element {
  const { token } = theme.useToken()
  const { topic, side, attackMode, weaknessSummary, attackPoints } = result
  const [pointsExpanded, setPointsExpanded] = useState(false)
  const modeMeta = ATTACK_MODE_META[attackMode] ?? { label: attackMode, color: 'default' }

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        borderRadius: 6,
        backgroundColor: token.colorPrimaryBg,
        border: `1px solid ${token.colorPrimaryBorder}`
      }}
    >
      {/* 头部：评委 + 攻击方式 + 立场 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
          flexWrap: 'wrap'
        }}
      >
        <Typography.Text strong style={{ fontSize: 13 }}>
          ⚔️ {judgeCategoryOf(result.judgeId)} · 模拟攻击
        </Typography.Text>
        <Tag color={modeMeta.color}>{modeMeta.label}</Tag>
        <Tag color={side === 'aff' ? 'blue' : 'orange'}>{side === 'aff' ? '攻正方稿' : '攻反方稿'}</Tag>
      </div>

      {topic ? (
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
        >
          辩题：{topic}
        </Typography.Text>
      ) : null}

      {/* 总体弱点 */}
      {weaknessSummary ? (
        <Typography.Text
          style={{ fontSize: 12, display: 'block', marginBottom: 6, whiteSpace: 'pre-wrap' }}
        >
          <Typography.Text strong style={{ fontSize: 12 }}>
            总体弱点：
          </Typography.Text>
          {weaknessSummary}
        </Typography.Text>
      ) : null}

      {/* 攻击点列表（默认折叠） */}
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: token.colorTextSecondary }}>攻击点</span>
          <Typography.Link
            style={{ fontSize: 12, color: token.colorPrimary, cursor: 'pointer' }}
            onClick={() => setPointsExpanded((v) => !v)}
          >
            {pointsExpanded ? '收起' : `展开（${attackPoints.length} 条）`}
          </Typography.Link>
        </div>
        {pointsExpanded && (
          <div style={{ marginTop: 4 }}>
            {attackPoints.map((p, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  marginBottom: 6,
                  backgroundColor: token.colorFillQuaternary,
                  borderRadius: 4,
                  padding: '6px 8px',
                  wordBreak: 'break-word',
                  lineHeight: 1.5
                }}
              >
                <Tag color={LAYER_COLOR[p.layer]} style={{ marginRight: 6 }}>
                  {p.layer === 'fact' ? '事实' : p.layer === 'theory' ? '理论' : '价值'}
                </Tag>
                {p.point}
                {p.target ? (
                  <div style={{ color: token.colorTextSecondary, marginTop: 2 }}>
                    针对：{p.target}
                  </div>
                ) : null}
                {p.defenseHint ? (
                  <div style={{ color: token.colorSuccess, marginTop: 2 }}>
                    防守建议：{p.defenseHint}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- 切换器 ----------

/** JudgeResultCardByTool Props */
export interface JudgeResultCardByToolProps {
  toolName: string
  result: unknown
}

/**
 * 按工具名渲染对应结果卡片（未知工具/非裁判工具返回 null）。
 * ToolCallCard 与 JudgeArena 页面共用。
 */
export function JudgeResultCardByTool({
  toolName,
  result
}: JudgeResultCardByToolProps): JSX.Element | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { success?: boolean }
  if (r.success === false) return null

  switch (toolName) {
    case 'judge_match':
      return <JudgeMatchResultCard result={result as JudgeMatchResult} />
    case 'judge_debate':
      return <JudgeResultCard result={result as JudgeDebateResult} />
    case 'judge_speech':
      return <JudgeSpeechResultCard result={result as JudgeSpeechResult} />
    case 'detect_stage':
      return <DetectStageResultCard result={result as DetectStageResult} />
    case 'simulate_opponent':
      return <SimulateOpponentCard result={result as SimulateOpponentResult} />
    default:
      return null
  }
}
