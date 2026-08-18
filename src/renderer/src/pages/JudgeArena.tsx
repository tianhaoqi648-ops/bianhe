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

import { useMemo, useState } from 'react'
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
  theme
} from 'antd'
import {
  AuditOutlined,
  AimOutlined,
  EditOutlined,
  ExperimentOutlined,
  ThunderboltOutlined,
  CloseOutlined
} from '@ant-design/icons'
import PageHeader from '../components/common/PageHeader'
import { JUDGES } from '../../../shared/ai-judges'
import { STAGE_DEFINITIONS, type DebateStageType } from '../../../shared/debate-stages'
import { useSettingsStore } from '../stores/settingsStore'
import {
  JudgeResultCardByTool,
  STAGE_NAMES
} from '../components/agent/judge-result-cards'
import {
  getAvailableActions,
  currentSpeech,
  type JudgeArenaFormState,
  type JudgeAction
} from './judgeArenaLogic'

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

/** 攻击方式选项 */
const ATTACK_MODE_OPTIONS = [
  { value: 'cross_exam', label: '质询盘问' },
  { value: 'rebuttal', label: '驳论攻击' },
  { value: 'free_debate', label: '自由辩突袭' }
]

/** 操作按钮元数据 */
const ACTION_BUTTONS: Array<{ action: JudgeAction; label: string; icon: React.ReactNode; tooltip: string }> = [
  { action: 'judge_speech', label: '评估单方稿', icon: <ExperimentOutlined />, tooltip: '按评委人设评估己方稿子：五维评分 + 漏洞清单 + 改进建议' },
  { action: 'simulate_opponent', label: '模拟对方攻击', icon: <AimOutlined />, tooltip: '以评委思维模拟对方攻击（质询/驳论/自由辩突袭）' },
  { action: 'rewrite_speech', label: '改写稿子', icon: <EditOutlined />, tooltip: '按评委辩风改写稿子，保留论证骨架' },
  { action: 'judge_debate', label: '整场评审', icon: <AuditOutlined />, tooltip: '评审完整辩论（需双方辩词），含五维评分与胜负判定' }
]

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
  const [focus, setFocus] = useState('')

  // ---------- 执行状态 ----------
  const [results, setResults] = useState<ArenaResult[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  /** 操作按钮点击分发 */
  const handleAction = (action: JudgeAction): void => {
    const base = { topic: topic.trim() }
    switch (action) {
      case 'judge_speech':
        void runJudge('judge_speech', { ...base, stage, side, speech: currentSpeechText, judgeId }, '评估单方稿')
        break
      case 'simulate_opponent':
        void runJudge('simulate_opponent', { ...base, side, speech: currentSpeechText, judgeId, attackMode }, '模拟对方攻击')
        break
      case 'rewrite_speech':
        void runJudge(
          'rewrite_speech',
          { ...base, stage, side, speech: currentSpeechText, judgeId, ...(focus.trim() ? { focus: focus.trim() } : {}) },
          '改写稿子'
        )
        break
      case 'judge_debate':
        void runJudge('judge_debate', { ...base, affSpeech, negSpeech, judgeId }, '整场评审')
        break
      case 'detect_stage':
        void runJudge('detect_stage', { speech: currentSpeechText, topic: topic.trim() }, '环节识别')
        break
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
      <PageHeader title="AI 裁判" subtitle="评委人设驱动的备赛工作台：评估稿子 · 模拟攻击 · 改写优化 · 整场评审" />

      {/* 表单区 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        {/* 辩题 */}
        <Typography.Text strong style={{ fontSize: 13 }}>辩题</Typography.Text>
        <Input
          placeholder="输入辩题，如：网络让人更亲近还是更疏远"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          style={{ marginTop: 6, marginBottom: 14 }}
        />

        {/* 评委选择：5 位评委卡片 */}
        <Typography.Text strong style={{ fontSize: 13 }}>评委人设</Typography.Text>
        <Radio.Group
          value={judgeId}
          onChange={(e) => setJudgeId(e.target.value)}
          style={{ display: 'block', marginTop: 6, marginBottom: 14 }}
        >
          <Space wrap>
            {JUDGES.map((j) => (
              <Radio.Button key={j.id} value={j.id}>
                {j.name} · {j.category}
              </Radio.Button>
            ))}
          </Space>
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

        {/* 立场 + 稿子输入 */}
        <div style={{ marginBottom: 14 }}>
          <Radio.Group value={side} onChange={(e) => setSide(e.target.value)} style={{ marginBottom: 8 }}>
            <Radio.Button value="aff">正方稿</Radio.Button>
            <Radio.Button value="neg">反方稿</Radio.Button>
          </Radio.Group>
          <Input.TextArea
            rows={6}
            placeholder={side === 'aff' ? '粘贴正方稿（立论/驳论/质询/总结等）' : '粘贴反方稿（立论/驳论/质询/总结等）'}
            value={side === 'aff' ? affSpeech : negSpeech}
            onChange={(e) =>
              side === 'aff' ? setAffSpeech(e.target.value) : setNegSpeech(e.target.value)
            }
          />
        </div>

        {/* 扩展选项：攻击方式 / 改写侧重 */}
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 220 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              改写侧重
            </Typography.Text>
            <Input
              size="small"
              placeholder="可选，如：让立论更严密"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              style={{ flex: 1 }}
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
          <Spin /> <span style={{ marginLeft: 8 }}>正在执行 {judge.name} 判定中…</span>
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
                  {r.toolName === 'judge_debate' || r.toolName === 'judge_speech' ? (
                    <span style={{ marginLeft: 8, color: token.colorTextSecondary, fontSize: 12 }}>
                      {STAGE_NAMES[stage ?? ''] ? `${STAGE_NAMES[stage ?? '']} · ` : ''}
                      {side === 'aff' ? '正方' : '反方'}稿
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
