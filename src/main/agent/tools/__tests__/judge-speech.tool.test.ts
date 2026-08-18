// ============================================================
// judge-speech.tool.test.ts — judge_speech 单方稿评估工具测试（批1 2026-08-18）
//
// Mock：llm-client 的 chat（评委评分由 LLM 完成）。
// 覆盖：入参校验 / 合法 JSON 解析 / 围栏容错 / 缺字段 / 缺 config / LLM 抛错 / 人设与环节注入
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolExecutionContext, LLMConfig } from '@shared/agent-types'
import { judgeSpeechTool } from '../judge-speech.tool'

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }))

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
  dimensions: [
    { key: 'logicDepth', score: 7, comment: '框架清晰' },
    { key: 'logicRigor', score: 8, comment: '链条完整' },
    { key: 'rebuttal', score: 5, comment: '未预判反驳' },
    { key: 'expressiveness', score: 6, comment: '可更精炼' },
    { key: 'teamwork', score: 7, comment: '衔接不足' }
  ],
  gaps: [
    { severity: 'high', description: '判准未论证', evidence: '第2段' },
    { severity: 'medium', description: '第二论点缺论据' }
  ],
  improvements: [
    { target: '判准', suggestion: '补充论证' },
    { target: '第二论点', suggestion: '加数据' }
  ],
  summary: '整体立论成立，但判准薄弱。'
})

const ctxWithConfig: ToolExecutionContext = { config: VALID_CONFIG }

beforeEach(() => {
  mockChat.mockReset()
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

  it('合法 JSON → 解析出 dimensions/gaps/improvements/summary，并注入评委与环节要点', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)

    if (!res.success) throw new Error(res.error)
    expect(res.judgeId).toBe('hu-jianbiao')
    expect(res.judgeName).toBe('胡渐彪')
    expect(res.stage).toBe('opening')
    expect(res.side).toBe('aff')
    expect(res.dimensions).toHaveLength(5)
    expect(res.dimensions[0]).toMatchObject({ key: 'logicDepth', score: 7 })
    expect(res.gaps).toHaveLength(2)
    expect(res.gaps[0]).toMatchObject({ severity: 'high', evidence: '第2段' })
    expect(res.improvements).toHaveLength(2)
    expect(res.summary).toContain('判准薄弱')

    // 校验 prompt 注入：评委人设 + 环节评审要点（立论） + 立场
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('胡渐彪')
    expect(system.content).toContain('立论')
    expect(system.content).toContain('判准')
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('正方')
    expect(user.content).toContain('正方一辩：我方判准是')
  })

  it('带 ```json 围栏 → 正确解析', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '```json\n' + VALID_JSON + '\n```' })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
  })

  it('指定评委人设生效', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await judgeSpeechTool.execute(
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

describe('judge_speech：异常处理', () => {
  it('非 JSON → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '不是JSON' })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('dimensions 缺维度 → success:false', async () => {
    const bad = JSON.stringify({
      dimensions: [{ key: 'logicDepth', score: 7, comment: 'c' }],
      gaps: [],
      improvements: [],
      summary: 's'
    })
    mockChat.mockResolvedValue({ role: 'assistant', content: bad })
    const res = await judgeSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('score 越界 → success:false', async () => {
    const bad = JSON.stringify({
      dimensions: [
        { key: 'logicDepth', score: 11, comment: 'c' },
        { key: 'logicRigor', score: 8, comment: 'c' },
        { key: 'rebuttal', score: 5, comment: 'c' },
        { key: 'expressiveness', score: 6, comment: 'c' },
        { key: 'teamwork', score: 7, comment: 'c' }
      ],
      gaps: [],
      improvements: [],
      summary: 's'
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
