// ============================================================
// rewrite-speech.tool.test.ts — rewrite_speech 稿子改写工具测试（批2 2026-08-18）
//
// Mock：llm-client 的 chat。
// 覆盖：入参校验 / stage 非法 / 合法 JSON（含 \n 转义）解析 / rewrittenSpeech 空 /
//       缺 config / 非 JSON / LLMError
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolExecutionContext, LLMConfig } from '@shared/agent-types'
import { rewriteSpeechTool } from '../rewrite-speech.tool'

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
  speech: '正方一辩：我方判准是……第一论点……'
}

const VALID_CONFIG: LLMConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const ctxWithConfig: ToolExecutionContext = { config: VALID_CONFIG }

/** 合法 JSON：rewrittenSpeech 含 \n 转义 */
const VALID_JSON = JSON.stringify({
  rewrittenSpeech: '各位评委好，我方今天的立场是……\n我方判准是……\n综上所述……',
  changeNotes: [
    { target: '第一段判准', change: '补充了判准成立的论证' },
    { target: '第二论点', change: '增加数据支撑' }
  ]
})

beforeEach(() => {
  mockChat.mockReset()
})

describe('rewrite_speech：入参校验', () => {
  it('缺少 topic/speech → success:false，不调 LLM', async () => {
    const res = await rewriteSpeechTool.execute(
      { stage: 'opening', side: 'aff', speech: '稿' } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('stage 非法 → success:false', async () => {
    const res = await rewriteSpeechTool.execute(
      { topic: 't', stage: 'bad', side: 'aff', speech: '稿' } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })
})

describe('rewrite_speech：LLM 调用与解析', () => {
  it('缺 ctx.config → success:false，不调 LLM', async () => {
    const res = await rewriteSpeechTool.execute(VALID_ARGS)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('合法 JSON → 解析出改写稿（含 \\n 转义）与改动清单，注入评委与环节要点', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await rewriteSpeechTool.execute(VALID_ARGS, ctxWithConfig)

    if (!res.success) throw new Error(res.error)
    expect(res.judgeId).toBe('hu-jianbiao')
    expect(res.judgeName).toBe('胡渐彪')
    expect(res.stage).toBe('opening')
    expect(res.rewrittenSpeech).toContain('我方判准是')
    expect(res.rewrittenSpeech).toContain('综上所述')
    expect(res.changeNotes).toHaveLength(2)
    expect(res.changeNotes[0]).toMatchObject({ target: '第一段判准' })

    // prompt 注入：评委人设 + 环节评审要点（立论判准）+ focus
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('胡渐彪')
    expect(system.content).toContain('立论')
    expect(system.content).toContain('判准')
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('正方一辩')
  })

  it('focus 参数传入 prompt', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await rewriteSpeechTool.execute(
      { ...VALID_ARGS, focus: '让立论更严密' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    const [messages] = mockChat.mock.calls[0]
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('让立论更严密')
  })

  it('指定评委人设生效', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: VALID_JSON })
    const res = await rewriteSpeechTool.execute(
      { ...VALID_ARGS, judgeId: 'huang-zhizhong' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.judgeName).toBe('黄执中')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('黄执中')
  })

  it('changeNotes 非法条目跳过', async () => {
    const json = JSON.stringify({
      rewrittenSpeech: '改写稿内容',
      changeNotes: [
        { target: '有效目标', change: '有效改动' },
        { target: '', change: '缺目标' },
        '不是对象'
      ]
    })
    mockChat.mockResolvedValue({ role: 'assistant', content: json })
    const res = await rewriteSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    expect(res.changeNotes).toHaveLength(1)
  })
})

describe('rewrite_speech：异常处理', () => {
  it('rewrittenSpeech 为空 → success:false', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: JSON.stringify({ rewrittenSpeech: '', changeNotes: [] })
    })
    const res = await rewriteSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('rewrittenSpeech 缺失 → success:false', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: JSON.stringify({ changeNotes: [] })
    })
    const res = await rewriteSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('非 JSON → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '不是JSON' })
    const res = await rewriteSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('chat 抛 LLMError → success:false', async () => {
    const { LLMError } = await import('../../llm-client')
    mockChat.mockRejectedValue(new LLMError('network', '网络错误'))
    const res = await rewriteSpeechTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })
})
