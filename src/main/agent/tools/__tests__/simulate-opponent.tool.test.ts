// ============================================================
// simulate-opponent.tool.test.ts — simulate_opponent 模拟攻击工具测试（批2 2026-08-18）
//
// Mock：llm-client 的 chat。
// 覆盖：入参校验 / 三种 attackMode 解析 + prompt 注入 / layer 非法条目跳过 /
//       空 attackPoints 失败 / 缺 config / 非 JSON / LLMError
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolExecutionContext, LLMConfig } from '@shared/agent-types'
import { simulateOpponentTool } from '../simulate-opponent.tool'

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

function makeResultJson(attackPoints: unknown[]): string {
  return JSON.stringify({
    weaknessSummary: '判准未经论证',
    attackPoints
  })
}

const VALID_ATTACK_POINTS = [
  {
    layer: 'theory',
    point: '请问对方辩友，您的判准为什么成立？',
    target: '第一段判准',
    defenseHint: '补充判准成立的论证'
  },
  {
    layer: 'fact',
    point: '第二论点数据来源是什么？',
    target: '第二论点',
    defenseHint: '补充数据出处'
  }
]

beforeEach(() => {
  mockChat.mockReset()
})

describe('simulate_opponent：入参校验', () => {
  it('缺少 topic/speech → success:false，不调 LLM', async () => {
    const res = await simulateOpponentTool.execute(
      { side: 'aff', speech: '稿' } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('attackMode 非法 → success:false', async () => {
    const res = await simulateOpponentTool.execute(
      { ...VALID_ARGS, attackMode: 'banter' } as never,
      ctxWithConfig
    )
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })
})

describe('simulate_opponent：LLM 调用与解析', () => {
  it('缺 ctx.config → success:false，不调 LLM', async () => {
    const res = await simulateOpponentTool.execute(VALID_ARGS)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('默认 attackMode=cross_exam，解析攻击点并注入评委人设与质询说明', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: makeResultJson(VALID_ATTACK_POINTS)
    })
    const res = await simulateOpponentTool.execute(VALID_ARGS, ctxWithConfig)

    if (!res.success) throw new Error(res.error)
    expect(res.attackMode).toBe('cross_exam')
    expect(res.judgeName).toBe('胡渐彪')
    expect(res.weaknessSummary).toContain('判准')
    expect(res.attackPoints).toHaveLength(2)
    expect(res.attackPoints[0]).toMatchObject({ layer: 'theory', target: '第一段判准' })

    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('胡渐彪')
    expect(system.content).toContain('站在对方立场')
    expect(system.content).toContain('质询')
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('正方')
    expect(user.content).toContain('正方一辩')
  })

  it('attackMode=rebuttal → prompt 含驳论说明，结果保留模式', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: makeResultJson(VALID_ATTACK_POINTS)
    })
    const res = await simulateOpponentTool.execute(
      { ...VALID_ARGS, attackMode: 'rebuttal' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.attackMode).toBe('rebuttal')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('驳论')
  })

  it('attackMode=free_debate → prompt 含自由辩突袭说明', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: makeResultJson(VALID_ATTACK_POINTS)
    })
    const res = await simulateOpponentTool.execute(
      { ...VALID_ARGS, attackMode: 'free_debate' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.attackMode).toBe('free_debate')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('突袭')
  })

  it('指定评委人设生效', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: makeResultJson(VALID_ATTACK_POINTS)
    })
    const res = await simulateOpponentTool.execute(
      { ...VALID_ARGS, judgeId: 'huang-zhizhong' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    expect(res.judgeName).toBe('黄执中')
  })
})

describe('simulate_opponent：异常处理', () => {
  it('layer 非法条目被跳过，其余保留', async () => {
    const bad = makeResultJson([
      ...VALID_ATTACK_POINTS,
      { layer: 'banter', point: '无效', target: 'x', defenseHint: 'y' }
    ])
    mockChat.mockResolvedValue({ role: 'assistant', content: bad })
    const res = await simulateOpponentTool.execute(VALID_ARGS, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    expect(res.attackPoints).toHaveLength(2)
  })

  it('attackPoints 为空数组 → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: makeResultJson([]) })
    const res = await simulateOpponentTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('attackPoints 缺失 → success:false', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: '{"weaknessSummary":"w"}'
    })
    const res = await simulateOpponentTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('非 JSON → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '不是JSON' })
    const res = await simulateOpponentTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('chat 抛 LLMError → success:false', async () => {
    const { LLMError } = await import('../../llm-client')
    mockChat.mockRejectedValue(new LLMError('rate_limit', '限流'))
    const res = await simulateOpponentTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })
})
