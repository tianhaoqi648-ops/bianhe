// ============================================================
// ToolCallCard.tsx — Agent 工具调用卡片组件（AI Agent v1.3.0 Week 4 Task 21 / Week 8 Task 49）
//
// 职责：
// 1. 渲染单次工具调用的状态卡片（loading / success / error）
//    - loading：antd Spin + 「调用中...」
//    - success：绿色 CheckCircleFilled + 「已完成」
//    - error：红色 CloseCircleFilled + 「失败」
// 2. 入参默认折叠，点击展开查看 JSON（monospace pre 块）
// 3. 结果默认折叠（success）；错误信息默认展开红色文字（error）
// 4. loading 时不显示结果区
// 5. Task 49.2：针对 recommend_format 工具渲染赛制推荐卡片（含「应用此赛制」按钮）
//
// 依赖：
// - antd Card / Spin / Typography / Button / Progress / theme.useToken()
// - @ant-design/icons CheckCircleFilled / CloseCircleFilled
// - AgentUIToolCall 类型来自 stores/agentStore
// - useFormatStore（应用赛制）+ useAgentStore（pendingNavigation 跳转 FormatEditor）
//
// 设计要点：
// - 卡片宽度 100%，占满 assistant 消息气泡内宽度
// - 边框颜色用 token.colorBorderSecondary
// - JSON pre 块统一样式：colorFillQuaternary 背景 / monospace / maxHeight 200
// - 展开/折叠按钮用 Typography.Link 风格，颜色 colorPrimary
// ============================================================

import React, { useState } from 'react'
import { Card, Spin, Typography, Button, Progress, Tag, theme } from 'antd'
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons'
import type { AgentUIToolCall } from '../../stores/agentStore'
import { useFormatStore } from '../../stores/formatStore'
import { useAgentStore } from '../../stores/agentStore'
import { useToast } from '../../hooks/useToast'

/** recommend_format 工具返回值结构（与 main/agent/tools/recommend-format.tool.ts 对齐） */
interface RecommendFormatResult {
  formatId: string
  formatName: string
  matchScore: number
  reason: string
}

/** ToolCallCard Props */
export interface ToolCallCardProps {
  toolCall: AgentUIToolCall
}

/**
 * ToolCallCard — Agent 工具调用卡片
 *
 * 显示工具名 + 状态图标，入参/结果可折叠展开。
 * loading 时左侧 Spin；success 绿色 ✓；error 红色 ✗ 且错误信息默认展开。
 * Task 49.2：recommend_format 成功时额外渲染赛制推荐卡片，含「应用此赛制」按钮。
 */
export function ToolCallCard({ toolCall }: ToolCallCardProps): JSX.Element {
  const { token } = theme.useToken()
  const { toolName, args, status, result, error } = toolCall

  // 入参默认折叠
  const [argsExpanded, setArgsExpanded] = useState(false)
  // 结果默认折叠；error 状态默认展开
  const [resultExpanded, setResultExpanded] = useState(status === 'error')

  // 状态图标 + 文案
  let statusIcon: React.ReactNode
  let statusText: string
  if (status === 'loading') {
    statusIcon = <Spin size="small" />
    statusText = '调用中...'
  } else if (status === 'success') {
    statusIcon = <CheckCircleFilled style={{ color: token.colorSuccess }} />
    statusText = '已完成'
  } else {
    statusIcon = <CloseCircleFilled style={{ color: token.colorError }} />
    statusText = '失败'
  }

  // JSON pre 块统一样式
  const jsonBlockStyle: React.CSSProperties = {
    backgroundColor: token.colorFillQuaternary,
    borderRadius: 6,
    padding: 8,
    fontSize: 12,
    fontFamily: 'monospace',
    overflow: 'auto',
    maxHeight: 200,
    margin: 0
  }

  // 展开/折叠按钮样式（Typography.Link 风格）
  const toggleStyle: React.CSSProperties = {
    color: token.colorPrimary,
    cursor: 'pointer',
    fontSize: 12,
    userSelect: 'none'
  }

  // 标签样式
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: token.colorTextSecondary
  }

  return (
    <Card
      size="small"
      style={{
        width: '100%',
        borderColor: token.colorBorderSecondary
      }}
      styles={{ body: { padding: '8px 12px' } }}
    >
      {/* 状态行：图标 + 工具名 + 状态文案 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {statusIcon}
        <span style={{ fontFamily: 'monospace', fontSize: 13 }}>🔧 {toolName}</span>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {statusText}
        </Typography.Text>
      </div>

      {/* 入参区：默认折叠 */}
      <div style={{ marginTop: 8 }}>
        <span style={labelStyle}>入参</span>{' '}
        <Typography.Link style={toggleStyle} onClick={() => setArgsExpanded((v) => !v)}>
          {argsExpanded ? '收起' : '展开'}
        </Typography.Link>
        {argsExpanded && (
          <pre style={{ ...jsonBlockStyle, marginTop: 4 }}>
            {JSON.stringify(args, null, 2)}
          </pre>
        )}
      </div>

      {/* 结果区：仅 status !== 'loading' 时显示 */}
      {status !== 'loading' && (
        <div style={{ marginTop: 8 }}>
          {status === 'success' ? (
            <>
              <span style={labelStyle}>结果</span>{' '}
              <Typography.Link
                style={toggleStyle}
                onClick={() => setResultExpanded((v) => !v)}
              >
                {resultExpanded ? '收起' : '展开'}
              </Typography.Link>
              {resultExpanded && (
                <pre style={{ ...jsonBlockStyle, marginTop: 4 }}>
                  {result === undefined ? '无返回值' : JSON.stringify(result, null, 2)}
                </pre>
              )}
            </>
          ) : (
            <>
              <span style={labelStyle}>错误</span>{' '}
              <Typography.Link
                style={toggleStyle}
                onClick={() => setResultExpanded((v) => !v)}
              >
                {resultExpanded ? '收起' : '展开'}
              </Typography.Link>
              {resultExpanded && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    color: token.colorError,
                    backgroundColor: token.colorErrorBg,
                    borderRadius: 6,
                    padding: 8,
                    wordBreak: 'break-word',
                    lineHeight: 1.5
                  }}
                >
                  {error ?? '未知错误'}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Task 49.2：recommend_format 成功时渲染赛制推荐卡片 */}
      {toolName === 'recommend_format' && status === 'success' && result ? (
        <RecommendFormatCard result={result as RecommendFormatResult} />
      ) : null}

      {/* AI 裁判：judge_debate 成功时渲染评分卡片 */}
      {toolName === 'judge_debate' &&
      status === 'success' &&
      result &&
      (result as { success?: boolean }).success !== false ? (
        <JudgeResultCard result={result as JudgeDebateResult} />
      ) : null}

      {/* AI 裁判：judge_speech 成功时渲染单方稿评估卡片 */}
      {toolName === 'judge_speech' &&
      status === 'success' &&
      result &&
      (result as { success?: boolean }).success !== false ? (
        <JudgeSpeechResultCard result={result as JudgeSpeechResult} />
      ) : null}

      {/* AI 裁判：detect_stage 成功时渲染环节识别卡片 */}
      {toolName === 'detect_stage' &&
      status === 'success' &&
      result &&
      (result as { success?: boolean }).success !== false ? (
        <DetectStageResultCard result={result as DetectStageResult} />
      ) : null}

      {/* AI 裁判：simulate_opponent 成功时渲染模拟攻击卡片 */}
      {toolName === 'simulate_opponent' &&
      status === 'success' &&
      result &&
      (result as { success?: boolean }).success !== false ? (
        <SimulateOpponentCard result={result as SimulateOpponentResult} />
      ) : null}

      {/* AI 裁判：rewrite_speech 成功时渲染改写稿卡片 */}
      {toolName === 'rewrite_speech' &&
      status === 'success' &&
      result &&
      (result as { success?: boolean }).success !== false ? (
        <RewriteSpeechCard result={result as RewriteSpeechResult} />
      ) : null}
    </Card>
  )
}

/**
 * recommend_format 工具结果卡片（Task 49.2）。
 *
 * 在 ToolCallCard 末尾追加一个赛制推荐展示区：
 *   - 赛制名称 + matchScore 进度条
 *   - 推荐理由
 *   - 「应用此赛制」按钮：调用 formatStore.selectFormat + 设置 pendingNavigation 跳转 FormatEditor
 *
 * 当 formatId 为空字符串时（数据库无赛制模板），按钮置灰并提示「无可用赛制」。
 */
function RecommendFormatCard({ result }: { result: RecommendFormatResult }): JSX.Element {
  const { token } = theme.useToken()
  const toast = useToast()
  const { formatId, formatName, matchScore, reason } = result
  const hasFormat = formatId && formatId.length > 0

  // 「应用此赛制」按钮：选中赛制并跳转 FormatEditor
  const handleApply = (): void => {
    if (!hasFormat) return
    useFormatStore.getState().selectFormat(formatId)
    useAgentStore.getState().setPendingNavigation('/format-editor')
    toast.success(`已应用赛制「${formatName}」`)
  }

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          🏆 {hasFormat ? formatName : '无匹配赛制'}
        </Typography.Text>
        {hasFormat && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            匹配度 {matchScore}/100
          </Typography.Text>
        )}
      </div>
      {hasFormat && (
        <Progress
          percent={matchScore}
          size="small"
          status={matchScore >= 70 ? 'success' : matchScore >= 40 ? 'active' : 'exception'}
          style={{ marginBottom: 8, marginTop: 4 }}
        />
      )}
      <Typography.Paragraph
        style={{
          fontSize: 12,
          color: token.colorTextSecondary,
          marginBottom: 8,
          whiteSpace: 'pre-wrap'
        }}
      >
        {reason}
      </Typography.Paragraph>
      <Button
        type="primary"
        size="small"
        disabled={!hasFormat}
        onClick={handleApply}
        aria-label="应用此赛制"
      >
        {hasFormat ? '应用此赛制' : '无可用赛制'}
      </Button>
    </div>
  )
}

// ---------- AI 裁判结果卡片（2026-08-18） ----------

/** judge_debate 单维评分（与 main/agent/tools/judge-debate.tool.ts 对齐） */
interface JudgeDimensionScore {
  key: string
  name: string
  affScore: number
  negScore: number
  comment: string
}

/** judge_debate 成功结果（与工具返回结构对齐） */
interface JudgeDebateResult {
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

/**
 * judge_debate 工具结果卡片（AI 裁判功能 2026-08-18）。
 *
 * 在 ToolCallCard 内渲染 AI 裁判评分结果：
 *   - 头部：评委姓名 + 胜负 Tag（正方胜/反方胜）+ 置信度
 *   - 五维双方分数对比（正蓝/反橙双进度条）+ 每维评语
 *   - 尾部：评委风格总评（summary）
 *
 * 仿 RecommendFormatCard 的配色与结构（colorPrimaryBg 底 + 边框）。
 */
function JudgeResultCard({ result }: { result: JudgeDebateResult }): JSX.Element {
  const { token } = theme.useToken()
  const { judgeName, topic, verdict, dimensions, summary, stageVerdicts } = result
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
          ⚖️ {judgeName} 判定
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

// ---------- 单方稿评估 / 环节识别卡片（AI 裁判演进 批1 2026-08-18） ----------

/** judge_speech 结果（与 judge-speech.tool.ts 对齐） */
interface JudgeSpeechResult {
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

/** detect_stage 结果（与 detect-stage.tool.ts 对齐） */
interface DetectStageResult {
  stage: string
  confidence: number
  reasons: string
}

/** 环节类型 → 展示名（与 shared/debate-stages.ts 对齐的轻量映射） */
const STAGE_NAMES: Record<string, string> = {
  opening: '立论',
  rebuttal: '驳论',
  cross_exam: '质询',
  cross_summary: '质询小结',
  free_debate: '自由辩论',
  closing: '总结陈词'
}

/** severity → Tag 颜色 */
const GAP_SEVERITY_COLOR: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'default'
}

/**
 * judge_speech 单方稿评估结果卡片。
 * 展示：评委 + 环节 + 立场；五维单方评分（进度条）；漏洞清单（severity Tag + 可展开原文）；
 * 改进建议；评委风格总评。
 */
function JudgeSpeechResultCard({ result }: { result: JudgeSpeechResult }): JSX.Element {
  const { token } = theme.useToken()
  const { judgeName, topic, stage, side, dimensions, gaps, improvements, summary } = result
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
          📝 {judgeName} 评估
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
function DetectStageResultCard({ result }: { result: DetectStageResult }): JSX.Element {
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

// ---------- 模拟攻击 / 稿子改写卡片（AI 裁判演进 批2 2026-08-18） ----------

/** simulate_opponent 结果（与 simulate-opponent.tool.ts 对齐） */
interface SimulateOpponentResult {
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

/** rewrite_speech 结果（与 rewrite-speech.tool.ts 对齐） */
interface RewriteSpeechResult {
  judgeId: string
  judgeName: string
  topic: string
  stage: string
  side: 'aff' | 'neg'
  rewrittenSpeech: string
  changeNotes: Array<{ target: string; change: string }>
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

/**
 * simulate_opponent 模拟对方攻击结果卡片。
 * 展示：评委 + 攻击方式 + 立场；总体弱点；攻击点按 layer 分组（默认折叠），
 * 每条含攻击内容 + 针对部分 + 防守建议。
 */
function SimulateOpponentCard({ result }: { result: SimulateOpponentResult }): JSX.Element {
  const { token } = theme.useToken()
  const { judgeName, topic, side, attackMode, weaknessSummary, attackPoints } = result
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
          ⚔️ {judgeName} 模拟攻击
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

/**
 * rewrite_speech 稿子改写结果卡片。
 * 展示：评委 + 环节 + 立场；改写稿全文（默认折叠展开）；改动清单。
 */
function RewriteSpeechCard({ result }: { result: RewriteSpeechResult }): JSX.Element {
  const { token } = theme.useToken()
  const { judgeName, topic, stage, side, rewrittenSpeech, changeNotes } = result
  const [speechExpanded, setSpeechExpanded] = useState(false)

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
          ✏️ {judgeName} 改写稿
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

      {/* 改写稿全文（默认折叠） */}
      <div style={{ marginTop: 4 }}>
        <Typography.Link
          style={{ fontSize: 12, color: token.colorPrimary, cursor: 'pointer' }}
          onClick={() => setSpeechExpanded((v) => !v)}
        >
          {speechExpanded ? '收起改写稿' : '展开改写稿'}
        </Typography.Link>
        {speechExpanded && (
          <Typography.Paragraph
            style={{
              fontSize: 12,
              color: token.colorText,
              marginTop: 6,
              marginBottom: 8,
              whiteSpace: 'pre-wrap',
              backgroundColor: token.colorFillQuaternary,
              borderRadius: 6,
              padding: 8,
              wordBreak: 'break-word',
              lineHeight: 1.6
            }}
          >
            {rewrittenSpeech}
          </Typography.Paragraph>
        )}
      </div>

      {/* 改动清单 */}
      {changeNotes.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4 }}>
            改动清单
          </div>
          {changeNotes.map((n, i) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 4, lineHeight: 1.5 }}>
              <Typography.Text strong style={{ fontSize: 12 }}>
                {n.target}：
              </Typography.Text>
              {n.change}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
