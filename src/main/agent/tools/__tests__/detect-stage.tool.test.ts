// ============================================================
// detect-stage.tool.test.ts — detect_stage 环节识别工具测试（批1 2026-08-18）
//
// Mock：llm-client 的 chat（识别由 LLM 完成）。
// 覆盖：入参校验 / 合法 JSON 解析 / 置信度边界 / 非法 stage / 缺 config / LLM 抛错
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolExecutionContext, LLMConfig } from '@shared/agent-types'
import { detectStageTool } from '../detect-stage.tool'

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
  speech: '我方认为，首先定义……其次我方判准是……第一论点……'
}

const VALID_CONFIG: LLMConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const ctxWithConfig: ToolExecutionContext = { config: VALID_CONFIG }

beforeEach(() => {
  mockChat.mockReset()
})

describe('detect_stage：入参校验', () => {
  it('缺少 speech → success:false，不调 LLM', async () => {
    const res = await detectStageTool.execute({} as never, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })
})

describe('detect_stage：LLM 调用与解析', () => {
  it('缺 ctx.config → success:false', async () => {
    const res = await detectStageTool.execute(VALID_ARGS)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('合法 JSON → 解析出 stage/confidence/reasons', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: '{"stage":"opening","confidence":0.92,"reasons":"以定义与判准开场，确立论点框架"}'
    })
    const res = await detectStageTool.execute(VALID_ARGS, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    expect(res.stage).toBe('opening')
    expect(res.confidence).toBeCloseTo(0.92)
    expect(res.reasons).toContain('判准')
  })

  it('confidence 下界（0）与上界（1）可接受', async () => {
    mockChat.mockResolvedValueOnce({
      role: 'assistant',
      content: '{"stage":"closing","confidence":0,"reasons":"r"}'
    })
    const low = await detectStageTool.execute(VALID_ARGS, ctxWithConfig)
    expect(low.success).toBe(true)

    mockChat.mockResolvedValueOnce({
      role: 'assistant',
      content: '{"stage":"closing","confidence":1,"reasons":"r"}'
    })
    const high = await detectStageTool.execute(VALID_ARGS, ctxWithConfig)
    expect(high.success).toBe(true)
  })

  it('stage 非法 → success:false', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: '{"stage":"banter","confidence":0.9,"reasons":"r"}'
    })
    const res = await detectStageTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('confidence 越界（1.5）→ success:false', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: '{"stage":"opening","confidence":1.5,"reasons":"r"}'
    })
    const res = await detectStageTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('chat 抛 LLMError → success:false', async () => {
    const { LLMError } = await import('../../llm-client')
    mockChat.mockRejectedValue(new LLMError('rate_limit', '限流'))
    const res = await detectStageTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('传入候选环节名与辩题 → prompt 包含它们', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: '{"stage":"rebuttal","confidence":0.85,"reasons":"针对对方论点展开反驳"}'
    })
    const res = await detectStageTool.execute(
      { speech: '对方观点有误……', stagesNames: ['立论', '驳论'], topic: '网络利弊' },
      ctxWithConfig
    )
    expect(res.success).toBe(true)
    const [messages] = mockChat.mock.calls[0]
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('立论')
    expect(user.content).toContain('网络利弊')
  })
})
