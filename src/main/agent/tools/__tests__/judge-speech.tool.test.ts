// ============================================================
// judge-speech.tool.test.ts — judge_speech 教练复盘工具测试（2026-08-23）
//
// Mock：llm-client 的 chat（教练诊断由 LLM 完成）。
// 覆盖：入参校验 / 合法 JSON 解析 / 围栏容错 / 缺字段 / 缺 config / LLM 抛错 / 人设与环节注入
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolExecutionContext, LLMConfig } from '@shared/agent-types'
import { judgeSpeechTool } from '../judge-speech.tool'

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

const VALID_ARGS = {
  topic: '网络让人更亲近还是更疏远',
  stage: 'opening' as const,
  side: 'aff' as const,
  speech: '正方一辩：我方判准是……第一论点……第二论点……'
}

const VALID_CONFIG: LLMConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const VALID_JSON = JSON.stringify({
  shortboards: [
    { area: '立论', point: '判准只给了定义没给论证', practiceHint: '练：先写判准成立的论证' },
    { area: '反驳', point: '对预设反驳回应不充分', practiceHint: '练：预判对方最可能的攻击' },
    { area: '表达', point: '长句堆叠、重点不突出', practiceHint: '练：结论先行' },
    { area: '攻防', point: '被质询时易被带偏', practiceHint: '练：先判问题类型再回应' }
  ],
  practiceDirections: ['打磨判准论证', '针对预判攻击备防守卡'],
  rewriteExample: '我的判准是……（示范改写）',
  summary: '整体立论成立，但判准薄弱，建议先补论证，提升交锋守势。'
})

const ctxWithConfig: ToolExecutionContext = { config: VALID_CONFIG }

beforeEach(() => {
  mockChat.mockReset()
  mockJudgeHistoryCreate.mockReset()
})

describe('judge_speech：入参校验', () => {
  it('缺少 topic/speech → success:false，不调 LLM', async () => {
    const res = await judgeSpeechTool.execute(
      { stage: 'opening', side: 'aff', speech: '稿' } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('stage 非法 → success:false', async () => {
    const res = await judgeSpeechTool.execute(
      { topic: 't', stage: 'bad-stage', side: 'aff', speech: '稿' } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })
})

describe('judge_speech：LLM 调用与解析', () => {
  it('缺 ctx.config → success:false', async () => {
    const res = await judgeSpeechTool.execute(VALID_ARGS)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('合法 JSON → 解析出四维短板/可练方向/示范改写/总评，并注入教练与环节要点', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)

    if (!res.success) throw new Error(res.error)
    expect(res.judgeId).toBe('hu-jianbiao')
    expect(res.judgeName).toBe('攻防流')
    expect(res.stage).toBe('opening')
    expect(res.side).toBe('aff')
    expect(res.shortboards).toHaveLength(4)
    expect(res.shortboards[0]).toMatchObject({ area: '立论', point: '判准只给了定义没给论证' })
    expect(res.practiceDirections).toHaveLength(2)
    expect(res.rewriteExample).toContain('示范改写')
    expect(res.summary).toContain('判准薄弱')

    // 校验 prompt 注入：教练定位（buildCoachPrompt）+ 环节要点（立论）+ 立场
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('攻防流')
    expect(system.content).toContain('反思教练')
    expect(system.content.toLowerCase()).not.toContain('judge_debate')
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('正方')
    expect(user.content).toContain('立论')
  })

  it('带 ```json 围栏 → 正确解析', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '```json\n' + VALID_JSON + '\n```' })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
  })

  it('指定教练人设生效', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeSpeechTool.execute(
      { ...VALID_ARGS, judgeId: 'huang-zhizhong' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.judgeName).toBe('价值流')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('价值流')
  })
})

describe('judge_speech：异常处理', () => {
  it('非 JSON → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '不是JSON' })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('shortboards 无有效条目 → success:false', async () => {
    const bad = JSON.stringify({
      shortboards: [{ area: '开杠', point: 'x' }],
      practiceDirections: [],
      rewriteExample: 'r',
      summary: 's'
    })
    mockChat.mockResolvedValue({ role: 'assistant', content: bad })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('rewriteExample 缺失 → success:false', async () => {
    const bad = JSON.stringify({
      shortboards: [{ area: '立论', point: 'p', practiceHint: 'p' }],
      practiceDirections: [],
      summary: 's'
    })
    mockChat.mockResolvedValue({ role: 'assistant', content: bad })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('summary 缺失 → success:false', async () => {
    const bad = JSON.stringify({
      shortboards: [{ area: '立论', point: 'p', practiceHint: 'p' }],
      practiceDirections: [],
      rewriteExample: 'r'
    })
    mockChat.mockResolvedValue({ role: 'assistant', content: bad })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('chat 抛 LLMError → success:false', async () => {
    const { LLMError } = await import('../../llm-client')
    mockChat.mockRejectedValue(new LLMError('network', '网络错误'))
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })
})

describe('judge_speech：写评审历史', () => {
  it('成功时调用 judgeHistoryRepo.create 并含 tool_name/stage/side/result', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
    expect(mockJudgeHistoryCreate).toHaveBeenCalledTimes(1)
    const input = mockJudgeHistoryCreate.mock.calls[0][0]
    expect(input.toolName).toBe('judge_speech')
    expect(input.judgeId).toBe('hu-jianbiao')
    expect(input.stage).toBe('opening')
    expect(input.side).toBe('aff')
    expect(input.topic).toBe(VALID_ARGS.topic)
    expect(input.resultJson).toMatchObject({ success: true, stage: 'opening' })
    expect(input.eventId).toBeUndefined()
    expect(input.matchId).toBeUndefined()
  })

  it('失败态不写历史', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '非 JSON' })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockJudgeHistoryCreate).not.toHaveBeenCalled()
  })

  it('历史写入失败静默忽略，不打断工具返回', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    mockJudgeHistoryCreate.mockImplementation(() => {
      throw new Error('db down')
    })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
  })
})