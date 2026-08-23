// ============================================================
// coach-match.tool.test.ts — coach_match 整场分环节教练复盘工具测试（2026-08-23）
//
// Mock：llm-client 的 chat（逐环节 + 汇总各一次）。
// 覆盖：入参校验（topic/body）/ 按环节分组逐环节诊断 + 整场汇总 /
//      时间线空 status 退化为单一全场组 / 缺 config / 环节失败 / 汇总失败 / 写历史
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolExecutionContext, LLMConfig } from '@shared/agent-types'
import { coachMatchTool } from '../coach-match.tool'

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

const VALID_CONFIG: LLMConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}
const ctxWithConfig: ToolExecutionContext = { config: VALID_CONFIG }

// 时间线有 3 个环节，完整成功需要 3 次环节调用 + 1 次汇总 = 4 次
// 对不关心调用次数的用例，用持久 mock（每个调用都返回同一合法 JSON，
// 其 summary 字段同时满足汇总解析），避免 Once 链数量不足。
function mockAllStageReviews(): void {
  mockChat.mockResolvedValue({ role: 'assistant', content: STAGE_REVIEW_JSON })
}

const STAGE_REVIEW_JSON = JSON.stringify({
  shortboards: [
    { area: '立论', point: '判准没论证', practiceHint: '练：补判准论证' },
    { area: '攻防', point: '防守偏弱', practiceHint: '练：防守卡' }
  ],
  practiceDirections: ['打磨判准', '备防守卡'],
  rewriteExample: '我的判准是……（示范）',
  summary: '本环节立论成立但判准薄弱。'
})

const MATCH_SUMMARY_JSON = JSON.stringify({ summary: '整场而言，质询环节对判准防守偏弱，其余环节较稳。' })

const TIMELINE = [
  { stage: 'opening', stageName: '立论', side: '正方', speaker: '一辩', content: '我方判准是……第一论点……' },
  { stage: 'cross_exam', stageName: '质询', side: '反方', speaker: '三辩', content: '请问您的判准为何成立？' },
  { stage: 'free_debate', stageName: '自由辩论', content: '自由辩互相攻防……' }
]

const VALID_ARGS = {
  topic: '网络让人更亲近还是更疏远',
  side: 'aff' as const,
  timeline: TIMELINE
}

beforeEach(() => {
  mockChat.mockReset()
  mockJudgeHistoryCreate.mockReset()
})

describe('coach_match：入参校验', () => {
  it('缺少 topic → success:false，不调 LLM', async () => {
    const res = await coachMatchTool.execute({ side: 'aff', transcript: 't' } as never, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('timeline 与 transcript 均缺失/空 → success:false', async () => {
    const res = await coachMatchTool.execute({ topic: 't', side: 'aff' } as never, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })
})

describe('coach_match：LLM 调用与解析', () => {
  it('按环节分组逐环节诊断 + 整场汇总（每环节一次 + 汇总一次）', async () => {
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: STAGE_REVIEW_JSON })
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: STAGE_REVIEW_JSON })
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: STAGE_REVIEW_JSON })
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: MATCH_SUMMARY_JSON })
    const res = await coachMatchTool.execute(VALID_ARGS, ctxWithConfig)

    if (!res.success) throw new Error(res.error)
    expect(res.judgeId).toBe('hu-jianbiao')
    expect(res.stageReviews).toHaveLength(3)
    expect(res.stageReviews[0].stageName).toBe('立论')
    expect(res.stageReviews[0].stage).toBe('opening')
    expect(res.stageReviews[0].shortboards).toHaveLength(2)
    expect(res.stageReviews[1].stageName).toBe('质询')
    expect(res.stageReviews[1].stage).toBe('cross_exam')
    expect(res.summary).toContain('质询环节对判准防守偏弱')

    // 调用次数 = 环节数 + 汇总 = 4
    expect(mockChat).toHaveBeenCalledTimes(4)

    // 校验 prompt：第一个环节 user 含立论内容与教练复盘要求；汇总 call user 含整场内容
    const [stageMessages] = mockChat.mock.calls[0]
    const stageUser = stageMessages.find((m: { role: string }) => m.role === 'user')
    expect(stageUser.content).toContain('立论')
    expect(stageUser.content).toContain('我方判准是')
    expect(stageUser.content).toContain('shortboards')

    const [summaryMessages] = mockChat.mock.calls[3]
    const summaryUser = summaryMessages.find((m: { role: string }) => m.role === 'user')
    expect(summaryUser.content).toContain('整场分环节内容')
    expect(summaryUser.content).toContain('自由辩论')
  })

  it('时间线无环节标注（只有 transcript）→ 退化为单一"全场"组 + 整场汇总', async () => {
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: STAGE_REVIEW_JSON })
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: MATCH_SUMMARY_JSON })
    const res = await coachMatchTool.execute(
      { topic: VALID_ARGS.topic, side: 'aff', transcript: '整场转写全文……' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.stageReviews).toHaveLength(1)
    expect(res.stageReviews[0].stageName).toBe('全场')
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('缺 ctx.config → success:false，不调 LLM', async () => {
    const res = await coachMatchTool.execute(VALID_ARGS)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('指定教练人设生效', async () => {
    mockAllStageReviews()
    const res = await coachMatchTool.execute(
      { ...VALID_ARGS, judgeId: 'huang-zhizhong' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.judgeName).toBe('价值流')
  })
})

describe('coach_match：异常处理', () => {
  it('某环节输出非法 → success:false 且不写历史', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '不是JSON' })
    const res = await coachMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockJudgeHistoryCreate).not.toHaveBeenCalled()
  })

  it('整场汇总结失败（汇总 JSON 无 summary）→ success:false', async () => {
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: STAGE_REVIEW_JSON })
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: STAGE_REVIEW_JSON })
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: STAGE_REVIEW_JSON })
    mockChat.mockResolvedValueOnce({ role: 'assistant', content: '{"keyPoints":[]}' })
    const res = await coachMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })
})

describe('coach_match：写评审历史', () => {
  it('成功时写 coach_match 历史（tool_name/side/topic/result），失败态不写', async () => {
    mockAllStageReviews()
    const ok = await coachMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(ok.success).toBe(true)
    expect(mockJudgeHistoryCreate).toHaveBeenCalledTimes(1)
    const input = mockJudgeHistoryCreate.mock.calls[0][0]
    expect(input.toolName).toBe('coach_match')
    expect(input.judgeId).toBe('hu-jianbiao')
    expect(input.side).toBe('aff')
    expect(input.topic).toBe(VALID_ARGS.topic)
    expect(input.resultJson).toMatchObject({ success: true, side: 'aff' })

    mockChat.mockResolvedValue({ role: 'assistant', content: '坏JSON' })
    const fail = await coachMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(fail.success).toBe(false)
    expect(mockJudgeHistoryCreate).toHaveBeenCalledTimes(1)
  })

  it('历史写入失败静默忽略，不打断工具返回', async () => {
    mockAllStageReviews()
    mockJudgeHistoryCreate.mockImplementation(() => {
      throw new Error('db down')
    })
    const res = await coachMatchTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
  })
})