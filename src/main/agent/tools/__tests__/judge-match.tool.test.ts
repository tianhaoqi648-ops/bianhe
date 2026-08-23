// ============================================================
// judge-match.tool.test.ts — judge_match 工具测试（赛事实景深化 T3.1，2026-08-19）
//
// Mock 策略：mock llm-client 的 chat（整场评审由 LLM 完成），其余（人设取用/
// prompt 构造/时间线校验/JSON 解析/兜底与过滤）走真实代码。
//
// 覆盖：
//   - timeline 校验：content 空拒绝（不调 LLM）
//   - bestSpeaker 缺省给 null
//   - stageVerdicts 非法项被过滤
//   - buildMatchUserPrompt 的时间线格式（含 [环节][发言人] 与 mm:ss）
//   - 无 timeline 退化用 transcript 全文
//   - 缺 topic / 缺 timeline 与 transcript → success:false
//   - 合法 JSON 解析出 verdict/dimensions/bestSpeaker/summary
//   - 缺 ctx.config → success:false（不调 LLM）
//   - 指定 judgeId 使用对应评委
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolExecutionContext, LLMConfig } from '@shared/agent-types'
import {
  judgeMatchTool,
  validateTimeline,
  normalizeBestSpeaker,
  filterStageVerdicts,
  parseJudgeMatchResult,
  JUDGE_MATCH_INSUFFICIENT_CODE
} from '../judge-match.tool'
import { buildMatchUserPrompt } from '../judge-common'

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
const TIMELINE = [
  {
    stageName: '立论',
    side: '正方',
    speaker: '一辩',
    tsMs: 60_000,
    content: '正方一辩陈词：网络缩短了物理距离……'
  },
  {
    stageName: '立论',
    side: '反方',
    speaker: '一辩',
    tsMs: 180_000,
    content: '反方一辩陈词：网络让真实互动减少……'
  },
  {
    stageName: '自由辩论',
    side: '反方',
    speaker: 3,
    tsMs: 420_000,
    content: '反方三辩的补充：……'
  }
]

const VALID_ARGS = {
  topic: '网络让人更亲近还是更疏远',
  timeline: TIMELINE
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
  bestSpeaker: '正方三辩',
  summary: '整体而言，正方更完整……'
})

const ctxWithConfig: ToolExecutionContext = { config: VALID_CONFIG }

beforeEach(() => {
  mockChat.mockReset()
  mockJudgeHistoryCreate.mockReset()
})

// ---------- 纯函数：时间线校验 / 兜底 / 过滤 ----------

describe('judge_match 纯函数：validateTimeline', () => {
  it('content 为空 → 拒绝', () => {
    expect(
      validateTimeline([{ content: '有内容' }, { content: '   ' }]).ok
    ).toBe(false)
  })

  it('content 非空 → 通过', () => {
    expect(validateTimeline([{ content: 'a' }, { content: 'b' }]).ok).toBe(true)
  })

  it('undefined / 空数组 → 视为通过（退化 transcript）', () => {
    expect(validateTimeline(undefined).ok).toBe(true)
    expect(validateTimeline([]).ok).toBe(true)
  })

  it('非数组 → 拒绝', () => {
    expect(validateTimeline({} as never).ok).toBe(false)
  })
})

describe('judge_match 纯函数：normalizeBestSpeaker', () => {
  it('缺省 / null / 空串 → null', () => {
    expect(normalizeBestSpeaker(undefined)).toBeNull()
    expect(normalizeBestSpeaker(null)).toBeNull()
    expect(normalizeBestSpeaker('   ')).toBeNull()
  })

  it('有值 → 去空串返回字符串', () => {
    expect(normalizeBestSpeaker('正方三辩')).toBe('正方三辩')
    expect(normalizeBestSpeaker(3)).toBe('3')
  })
})

describe('judge_match 纯函数：filterStageVerdicts', () => {
  it('非法项（非法 stage / 非法 winner / 越界 confidence / 空 comment）被过滤', () => {
    const filtered = filterStageVerdicts([
      { stage: 'opening', winner: 'aff', confidence: 0.8, comment: '合法' },
      { stage: 'banter', winner: 'aff', confidence: 0.8, comment: '非法 stage' },
      { stage: 'closing', winner: 'draw', confidence: 0.8, comment: '非法 winner' },
      { stage: 'rebuttal', winner: 'neg', confidence: 1.5, comment: '越界 confidence' },
      { stage: 'closing', winner: 'neg', confidence: 0.5, comment: '' }
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered![0]).toMatchObject({ stage: 'opening', winner: 'aff' })
  })

  it('非数组 / 空数组 / 全非法 → undefined', () => {
    expect(filterStageVerdicts(undefined)).toBeUndefined()
    expect(filterStageVerdicts([])).toBeUndefined()
    expect(filterStageVerdicts([{ stage: 'foo', winner: 'aff', confidence: 1, comment: 'c' }])).toBeUndefined()
  })
})

// ---------- buildMatchUserPrompt 时间线格式化 ----------

describe('judge_match：buildMatchUserPrompt 时间线格式', () => {
  it('含 [环节名][发言人][mm:ss] 且保持时间顺序（不按正反方聚合）', () => {
    const prompt = buildMatchUserPrompt({
      topic: VALID_ARGS.topic,
      timeline: TIMELINE
    })
    expect(prompt).toContain('[立论][一辩][01:00]：正方一辩陈词')
    expect(prompt).toContain('[立论][一辩][03:00]：反方一辩陈词')
    expect(prompt).toContain('[自由辩论][3][07:00]：反方三辩的补充')
    // 时间线保持先后顺序：第一个是正方立论，紧接反方立论（未被聚合）
    const body = prompt.slice(prompt.indexOf('【全场实录】'))
    expect(body.indexOf('正方一辩陈词')).toBeLessThan(body.indexOf('反方一辩陈词'))
  })

  it('无 timeline 时退化用 transcript 全文', () => {
    const prompt = buildMatchUserPrompt({
      topic: VALID_ARGS.topic,
      transcript: '整场转录全文……'
    })
    expect(prompt).toContain('整场转录全文')
    expect(prompt).toContain('转录全文')
  })

  it('含 formatHint 时写入赛制参考', () => {
    const prompt = buildMatchUserPrompt({
      topic: 't',
      timeline: [{ content: 'x' }],
      formatHint: '新国辩制'
    })
    expect(prompt).toContain('赛制参考：新国辩制')
  })
})

// ---------- 素材不足治理 ----------

describe('judge_match：素材不足时如实拒绝', () => {
  it('buildMatchUserPrompt 含不足指引（素材不足 / insufficientReason）', () => {
    const prompt = buildMatchUserPrompt({
      topic: VALID_ARGS.topic,
      transcript: '这是什么环节？'
    })
    expect(prompt).toContain('素材不足')
    expect(prompt).toContain('insufficientReason')
    expect(prompt).toContain('verdict": null')
    expect(prompt).toContain('强行评分')
  })

  it('解析 verdict:null + insufficientReason → 返回不足态（不抛五维缺失错误）', () => {
    const raw = JSON.stringify({
      verdict: null,
      insufficientReason: '转写内容过短/与辩题无关，无法进行有效判定'
    })
    const res = parseJudgeMatchResult(raw)
    expect(res.verdict).toBeNull()
    expect(res.insufficientReason).toContain('转写内容过短')
    expect(res.dimensions).toEqual([])
    expect(res.stageVerdicts).toBeUndefined()
    expect(res.bestSpeaker).toBeNull()
    expect(JUDGE_MATCH_INSUFFICIENT_CODE).toBe('insufficient_material')
  })

  it('verdict 缺失但带了 insufficientReason → 同样判定为不足态', () => {
    const raw = JSON.stringify({ insufficientReason: '录音仅一句话，无法判断胜负' })
    const res = parseJudgeMatchResult(raw)
    expect(res.verdict).toBeNull()
    expect(res.insufficientReason).toContain('无法判断胜负')
    expect(res.dimensions).toEqual([])
  })

  it('verdict:null 但 insufficientReason 为空 → 回退默认文案', () => {
    const res = parseJudgeMatchResult(JSON.stringify({ verdict: null, insufficientReason: '   ' }))
    expect(res.verdict).toBeNull()
    expect(res.insufficientReason).toBe('素材不足，无法进行有效判定')
  })

  it('回归：完整 verdict + 五维 JSON 仍通过原结构校验', () => {
    const res = parseJudgeMatchResult(VALID_JSON)
    expect(res.verdict).toEqual({ winner: 'aff', confidence: 0.7, reason: '正方在核心交锋点完成有效回应' })
    expect(res.dimensions).toHaveLength(5)
    expect(res.bestSpeaker).toBe('正方三辩')
    expect(res.insufficientReason).toBeUndefined()
  })
})

// ---------- 工具执行 ----------

describe('judge_match：入参校验', () => {
  it('缺少 topic → success:false，不调 LLM', async () => {
    const res = await judgeMatchTool.execute(
      { timeline: TIMELINE } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('timeline 与 transcript 都缺失 → success:false', async () => {
    const res = await judgeMatchTool.execute({ topic: 't' }, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('timeline 某项 content 为空 → success:false，不调 LLM', async () => {
    const res = await judgeMatchTool.execute(
      { topic: 't', timeline: [{ content: 'a' }, { content: '   ' }] },
      ctxWithConfig
    )
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })
})

describe('judge_match：LLM 调用与解析', () => {
  it('缺 ctx.config → success:false，不调 LLM', async () => {
    const res = await judgeMatchTool.execute(VALID_ARGS)
    expect(res.success).toBe(false)
    if (res.success) throw new Error('unreachable')
    expect(res.error).toContain('LLM 配置')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('chat 返回合法 JSON → 解析出 verdict/dimensions/bestSpeaker/summary', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(mockChat).toHaveBeenCalledTimes(1)
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('攻防流')

    if (!res.success) throw new Error(res.error)
    expect(res.judgeId).toBe('hu-jianbiao')
    expect(res.judgeName).toBe('攻防流')
    expect(res.verdict).toEqual({ winner: 'aff', confidence: 0.7, reason: '正方在核心交锋点完成有效回应' })
    expect(res.dimensions).toHaveLength(5)
    expect(res.bestSpeaker).toBe('正方三辩')
    expect(res.summary).toContain('正方更完整')
  })

  it('bestSpeaker 缺省 → null', async () => {
    const noBest = JSON.stringify({
      verdict: { winner: 'neg', confidence: 0.6, reason: 'r' },
      dimensions: [
        { key: 'logicDepth', affScore: 8, negScore: 6, comment: 'c' },
        { key: 'logicRigor', affScore: 7, negScore: 7, comment: 'c' },
        { key: 'rebuttal', affScore: 8, negScore: 5, comment: 'c' },
        { key: 'expressiveness', affScore: 6, negScore: 8, comment: 'c' },
        { key: 'teamwork', affScore: 7, negScore: 6, comment: 'c' }
      ],
      summary: 's'
    })
    mockChat.mockResolvedValue({ role: 'assistant', content: noBest })
    const res = await judgeMatchTool.execute(VALID_ARGS, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    expect(res.bestSpeaker).toBeNull()
  })

  it('指定 judgeId 使用对应评委', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeMatchTool.execute(
      { ...VALID_ARGS, judgeId: 'xiong-hao' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.judgeName).toBe('建构流')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('建构流')
  })

  it('退化 transcript：合法 JSON 正常解析', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeMatchTool.execute(
      { topic: 't', transcript: '整场转录全文……' },
      ctxWithConfig
    )
    expect(res.success).toBe(true)
  })
})

describe('judge_match：异常处理', () => {
  it('chat 返回非 JSON → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '我不是 JSON' })
    const res = await judgeMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('chat 抛 LLMError → success:false', async () => {
    const { LLMError } = await import('../../llm-client')
    mockChat.mockRejectedValue(new LLMError('rate_limit', '限流了'))
    const res = await judgeMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toContain('rate_limit')
  })
})

describe('judge_match：写评审历史', () => {
  it('成功时调用 judgeHistoryRepo.create 并含 tool_name/result', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
    expect(mockJudgeHistoryCreate).toHaveBeenCalledTimes(1)
    const input = mockJudgeHistoryCreate.mock.calls[0][0]
    expect(input.toolName).toBe('judge_match')
    expect(input.judgeId).toBe('hu-jianbiao')
    expect(input.topic).toBe(VALID_ARGS.topic)
    expect(input.resultJson).toMatchObject({ success: true, verdict: { winner: 'aff' } })
    expect(input.eventId).toBeUndefined()
    expect(input.roundId).toBeUndefined()
    expect(input.matchId).toBeUndefined()
  })

  it('失败态不写历史', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '非 JSON' })
    const res = await judgeMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockJudgeHistoryCreate).not.toHaveBeenCalled()
  })

  it('历史写入失败静默忽略，不打断工具返回', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    mockJudgeHistoryCreate.mockImplementation(() => {
      throw new Error('db down')
    })
    const res = await judgeMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
  })
})