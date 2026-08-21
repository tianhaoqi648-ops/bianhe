// ============================================================
// judge-debate.tool.test.ts — judge_debate 工具测试（AI 裁判功能 2026-08-18）
//
// Mock 策略：mock llm-client 的 chat（评委评分由 LLM 完成），
// 工具其余部分（人设取用/prompt 构造/JSON 解析/异常处理）走真实代码。
//
// 覆盖：
//   - 必填参数缺失 → success:false
//   - chat 返回合法 JSON → 结果解析正确（verdict/dimensions/summary）
//   - chat 返回带 ```json 围栏 → 仍正确解析
//   - chat 返回非 JSON → success:false
//   - 返回 JSON 缺字段 → success:false
//   - 缺 ctx.config → success:false（不调 chat）
//   - chat 抛 LLMError → success:false
//   - 未知 judgeId 回落默认评委（胡渐彪）
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolExecutionContext, LLMConfig } from '@shared/agent-types'
import { judgeDebateTool } from '../judge-debate.tool'

// ---------- mock llm-client ----------
const { mockChat, mockJudgeHistoryCreate } = vi.hoisted(() => ({
  mockChat: vi.fn(),
  mockJudgeHistoryCreate: vi.fn()
}))

vi.mock('../../llm-client', () => ({
  chat: mockChat,
  chatStream: vi.fn(),
  LLMError: class LLMError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
}))

vi.mock('../../../db/repository/judge-history.repo', () => ({
  judgeHistoryRepo: { create: mockJudgeHistoryCreate }
}))

// ---------- fixtures ----------
const VALID_ARGS = {
  topic: '网络让人更亲近还是更疏远',
  affSpeech: '正方一辩陈词：网络缩短了物理距离……',
  negSpeech: '反方一辩陈词：网络让真实互动减少……'
}

const VALID_CONFIG: LLMConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const VALID_JSON = JSON.stringify({
  verdict: { winner: 'aff', confidence: 0.7, reason: '正方在核心交锋点完成有效回应' },
  dimensions: [
    { key: 'logicDepth', affScore: 8, negScore: 6, comment: '正方立论有层次' },
    { key: 'logicRigor', affScore: 7, negScore: 7, comment: '双方逻辑均完整' },
    { key: 'rebuttal', affScore: 8, negScore: 5, comment: '反方多处未正面回应' },
    { key: 'expressiveness', affScore: 6, negScore: 8, comment: '反方表达感染力更强' },
    { key: 'teamwork', affScore: 7, negScore: 6, comment: '正方口径一致' }
  ],
  summary: '整体而言，正方更完整……'
})

const ctxWithConfig: ToolExecutionContext = { config: VALID_CONFIG }

beforeEach(() => {
  mockChat.mockReset()
  mockJudgeHistoryCreate.mockReset()
})

describe('judge_debate：入参校验', () => {
  it('缺少 topic → success:false，不调 LLM', async () => {
    const res = await judgeDebateTool.execute(
      { affSpeech: 'a', negSpeech: 'b' } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('缺少 affSpeech → success:false', async () => {
    const res = await judgeDebateTool.execute(
      { topic: 't', negSpeech: 'b' } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
  })

  it('缺少 negSpeech → success:false', async () => {
    const res = await judgeDebateTool.execute(
      { topic: 't', affSpeech: 'a' } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
  })
})

describe('judge_debate：LLM 调用与解析', () => {
  it('缺 ctx.config → success:false，不调 LLM', async () => {
    const res = await judgeDebateTool.execute(VALID_ARGS)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.error).toContain('LLM 配置')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('chat 返回合法 JSON → 解析出 verdict/dimensions/summary', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(mockChat).toHaveBeenCalledTimes(1)
    // 确认传入了评委人设 prompt（默认胡渐彪）
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('胡渐彪')
    expect(system.content).toContain('白纸理论')

    if (!res.success) throw new Error(res.error)
    expect(res.judgeId).toBe('hu-jianbiao')
    expect(res.judgeName).toBe('胡渐彪')
    expect(res.verdict).toEqual({ winner: 'aff', confidence: 0.7, reason: '正方在核心交锋点完成有效回应' })
    expect(res.dimensions).toHaveLength(5)
    expect(res.dimensions[0]).toMatchObject({ key: 'logicDepth', name: '立论深度', affScore: 8, negScore: 6 })
    expect(res.summary).toContain('正方更完整')
  })

  it('chat 返回带 ```json 围栏 → 正确解析', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '```json\n' + VALID_JSON + '\n```' })
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
  })

  it('未知 judgeId 回落默认评委（胡渐彪）', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeDebateTool.execute(
      { ...VALID_ARGS, judgeId: 'not-exist' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.judgeId).toBe('hu-jianbiao')
  })

  it('指定 judgeId 使用对应评委', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeDebateTool.execute(
      { ...VALID_ARGS, judgeId: 'huang-zhizhong' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.judgeName).toBe('黄执中')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('黄执中')
  })
})

describe('judge_debate：异常处理', () => {
  it('chat 返回非 JSON → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '我不是 JSON' })
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('JSON 缺维度字段 → success:false', async () => {
    const bad = JSON.stringify({
      verdict: { winner: 'aff', confidence: 0.6, reason: 'r' },
      dimensions: [
        { key: 'logicDepth', affScore: 8, negScore: 6, comment: 'c' }
        // 缺其余 4 维
      ],
      summary: 's'
    })
    mockChat.mockResolvedValue({ role: 'assistant', content: bad })
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('verdict.winner 非法 → success:false', async () => {
    const bad = JSON.stringify({
      verdict: { winner: 'draw', confidence: 0.6, reason: 'r' },
      dimensions: [
        { key: 'logicDepth', affScore: 8, negScore: 6, comment: 'c' },
        { key: 'logicRigor', affScore: 7, negScore: 7, comment: 'c' },
        { key: 'rebuttal', affScore: 8, negScore: 5, comment: 'c' },
        { key: 'expressiveness', affScore: 6, negScore: 8, comment: 'c' },
        { key: 'teamwork', affScore: 7, negScore: 6, comment: 'c' }
      ],
      summary: 's'
    })
    mockChat.mockResolvedValue({ role: 'assistant', content: bad })
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('chat 抛 LLMError → success:false', async () => {
    const { LLMError } = await import('../../llm-client')
    mockChat.mockRejectedValue(new LLMError('rate_limit', '限流了'))
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toContain('rate_limit')
  })
})

// ---------- 分段模式（批3） ----------

const VALID_STAGES = {
  ...VALID_ARGS,
  affStages: [{ stage: 'opening' as const, content: '正方立论段……' }],
  negStages: [{ stage: 'rebuttal' as const, content: '反方驳论段……' }]
}

/** VALID_JSON + stageVerdicts */
const VALID_STAGE_JSON = JSON.stringify({
  verdict: { winner: 'aff', confidence: 0.7, reason: '正方在核心交锋点完成有效回应' },
  dimensions: [
    { key: 'logicDepth', affScore: 8, negScore: 6, comment: '正方立论有层次' },
    { key: 'logicRigor', affScore: 7, negScore: 7, comment: '双方逻辑均完整' },
    { key: 'rebuttal', affScore: 8, negScore: 5, comment: '反方多处未正面回应' },
    { key: 'expressiveness', affScore: 6, negScore: 8, comment: '反方表达感染力更强' },
    { key: 'teamwork', affScore: 7, negScore: 6, comment: '正方口径一致' }
  ],
  summary: '整体而言，正方更完整……',
  stageVerdicts: [
    { stage: 'opening', winner: 'aff', confidence: 0.8, comment: '正方立论框架更完整' },
    { stage: 'rebuttal', winner: 'neg', confidence: 0.65, comment: '反方拆解更有力' }
  ]
})

describe('judge_debate：分段模式（批3）', () => {
  it('传分段 → prompt 含分段标注与逐段指令，解析出 stageVerdicts', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_STAGE_JSON })
    const res = await judgeDebateTool.execute(VALID_STAGES, ctxWithConfig)

    if (!res.success) throw new Error(res.error)
    expect(res.stageVerdicts).toHaveLength(2)
    expect(res.stageVerdicts![0]).toMatchObject({
      stage: 'opening',
      winner: 'aff',
      confidence: 0.8
    })
    expect(res.stageVerdicts![1].comment).toContain('反方拆解')

    const [messages] = mockChat.mock.calls[0]
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('【分段标注】')
    expect(user.content).toContain('[立论]（opening）')
    expect(user.content).toContain('[驳论]（rebuttal）')
    expect(user.content).toContain('stageVerdicts')
  })

  it('不传分段 → 现有行为不变（无分段标注、结果无 stageVerdicts）', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    expect(res.stageVerdicts).toBeUndefined()
    const [messages] = mockChat.mock.calls[0]
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).not.toContain('【分段标注】')
  })

  it('分段结构非法（stage 非法 / content 空）→ success:false，不调 LLM', async () => {
    const badStage = await judgeDebateTool.execute(
      { ...VALID_ARGS, affStages: [{ stage: 'foo' as never, content: 'x' }] },
      ctxWithConfig
    )
    expect(badStage.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()

    const badContent = await judgeDebateTool.execute(
      { ...VALID_ARGS, negStages: [{ stage: 'opening', content: '  ' }] },
      ctxWithConfig
    )
    expect(badContent.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('空数组视为未提供 → prompt 无分段标注', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeDebateTool.execute(
      { ...VALID_ARGS, affStages: [], negStages: [] },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    const [messages] = mockChat.mock.calls[0]
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).not.toContain('【分段标注】')
  })

  it('stageVerdicts 解析：非法项跳过，保留合法项', async () => {
    const json = JSON.stringify({
      verdict: { winner: 'aff', confidence: 0.6, reason: 'r' },
      dimensions: [
        { key: 'logicDepth', affScore: 8, negScore: 6, comment: 'c' },
        { key: 'logicRigor', affScore: 7, negScore: 7, comment: 'c' },
        { key: 'rebuttal', affScore: 8, negScore: 5, comment: 'c' },
        { key: 'expressiveness', affScore: 6, negScore: 8, comment: 'c' },
        { key: 'teamwork', affScore: 7, negScore: 6, comment: 'c' }
      ],
      summary: 's',
      stageVerdicts: [
        { stage: 'opening', winner: 'aff', confidence: 0.8, comment: '合法' },
        { stage: 'banter', winner: 'aff', confidence: 0.8, comment: '非法 stage' },
        { stage: 'closing', winner: 'draw', confidence: 0.8, comment: '非法 winner' },
        { stage: 'rebuttal', winner: 'neg', confidence: 1.5, comment: '越界 confidence' },
        { stage: 'closing', winner: 'neg', confidence: 0.5, comment: '' }
      ]
    })
    mockChat.mockResolvedValue({ role: 'assistant', content: json })
    const res = await judgeDebateTool.execute(VALID_STAGES, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    expect(res.stageVerdicts).toHaveLength(1)
    expect(res.stageVerdicts![0]).toMatchObject({ stage: 'opening', winner: 'aff' })
  })

  it('分段 + 指定评委人设生效', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_STAGE_JSON })
    const res = await judgeDebateTool.execute(
      { ...VALID_STAGES, judgeId: 'huang-zhizhong' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.judgeName).toBe('黄执中')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('黄执中')
  })
})

describe('judge_debate：写评审历史', () => {
  it('成功时调用 judgeHistoryRepo.create 并含 tool_name/result', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
    expect(mockJudgeHistoryCreate).toHaveBeenCalledTimes(1)
    const input = mockJudgeHistoryCreate.mock.calls[0][0]
    expect(input.judgeId).toBe('hu-jianbiao')
    expect(input.toolName).toBe('judge_debate')
    expect(input.topic).toBe(VALID_ARGS.topic)
    expect(input.resultJson).toMatchObject({ success: true, verdict: { winner: 'aff' } })
    expect(input.eventId).toBeUndefined()
    expect(input.roundId).toBeUndefined()
    expect(input.matchId).toBeUndefined()
  })

  it('失败态不写历史', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '非 JSON' })
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockJudgeHistoryCreate).not.toHaveBeenCalled()
  })

  it('历史写入失败静默忽略，不打断工具返回', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    mockJudgeHistoryCreate.mockImplementation(() => {
      throw new Error('db down')
    })
    const res = await judgeDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
  })
})
