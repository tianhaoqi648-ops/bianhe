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
  mockJudgeHistoryCreate.mockReset()
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
    if (!('attackPoints' in res)) throw new Error('unexpected legacy result')
    expect(res.attackMode).toBe('cross_exam')
    expect(res.judgeName).toBe('攻防流')
    expect(res.weaknessSummary).toContain('判准')
    expect(res.attackPoints).toHaveLength(2)
    expect(res.attackPoints[0]).toMatchObject({ layer: 'theory', target: '第一段判准' })

    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('攻防流')
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
    if (!('attackMode' in res)) throw new Error('unexpected legacy result')
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
    if (!('attackMode' in res)) throw new Error('unexpected legacy result')
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
    expect(res.judgeName).toBe('价值流')
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
    if (!('attackPoints' in res)) throw new Error('unexpected legacy result')
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

describe('simulate_opponent：写评审历史', () => {
  it('成功时调用 judgeHistoryRepo.create 并含 tool_name/side/result', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: JSON.stringify({
        weaknessSummary: '判准未论证',
        attackPoints: [
          { layer: 'theory', point: 'p', target: 't', defenseHint: 'd' }
        ]
      })
    })
    const res = await simulateOpponentTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
    expect(mockJudgeHistoryCreate).toHaveBeenCalledTimes(1)
    const input = mockJudgeHistoryCreate.mock.calls[0][0]
    expect(input.toolName).toBe('simulate_opponent')
    expect(input.judgeId).toBe('hu-jianbiao')
    expect(input.side).toBe('aff')
    expect(input.topic).toBe(VALID_ARGS.topic)
    expect(input.resultJson).toMatchObject({ success: true, side: 'aff' })
    expect(input.eventId).toBeUndefined()
    expect(input.matchId).toBeUndefined()
  })

  it('失败态不写历史', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '非 JSON' })
    const res = await simulateOpponentTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockJudgeHistoryCreate).not.toHaveBeenCalled()
  })

  it('历史写入失败静默忽略，不打断工具返回', async () => {
    mockChat.mockResolvedValue({
      role: 'assistant',
      content: JSON.stringify({
        weaknessSummary: '判准未论证',
        attackPoints: [{ layer: 'fact', point: 'p', target: 't', defenseHint: 'd' }]
      })
    })
    mockJudgeHistoryCreate.mockImplementation(() => {
      throw new Error('db down')
    })
    const res = await simulateOpponentTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(true)
  })
})

// ============================================================
// 陪练回合制（2026-08-23）
// ============================================================

describe('simulate_opponent：陪练回合制（发起/下一轮）', () => {
  it('提供 difficulty → 进入回合制，返回本轮攻击文本（mode sparring_turn）', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '请问对方辩友，您的判准为何成立？' })
    const res = await simulateOpponentTool.execute(
      { ...VALID_ARGS, difficulty: 'national' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    if (!('opponentAttack' in res)) throw new Error('unexpected sparring result')
    expect(res.mode).toBe('sparring_turn')
    expect(res.difficulty).toBe('national')
    expect(res.roundIndex).toBe(1)
    expect(res.opponentAttack).toContain('判准')

    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('陪练对手')
    expect(system.content).toContain('国家级赛事辩手')
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('正方一辩')
  })

  it('提供 history → 下一轮 roundIndex 递增，把历史轮次写入 prompt', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '第二轮的质询……' })
    const res = await simulateOpponentTool.execute(
      {
        ...VALID_ARGS,
        difficulty: 'intermediate',
        history: [{ opponent: '第一轮攻击', userReply: '我的第一轮答辩' }]
      },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    if (!('opponentAttack' in res)) throw new Error('unexpected sparring result')
    expect(res.mode).toBe('sparring_turn')
    expect(res.roundIndex).toBe(2)

    const [messages] = mockChat.mock.calls[0]
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('第 1 轮')
    expect(user.content).toContain('第一轮攻击')
    expect(user.content).toContain('我的第一轮答辩')
  })

  it('提供 scope=具体环节 → system 与 user 均注入"只在该环节内应对"', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '质询连问……' })
    const res = await simulateOpponentTool.execute(
      { ...VALID_ARGS, difficulty: 'intermediate', scope: 'crossfire' },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    if (!('opponentAttack' in res)) throw new Error('unexpected sparring result')
    expect(res.mode).toBe('sparring_turn')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('不要跳到其他环节')
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('环节范围')
    expect(user.content).toContain('质询')
  })

  it('回合制返回空文本 → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '   ' })
    const res = await simulateOpponentTool.execute(
      { ...VALID_ARGS, difficulty: 'novice' },
      ctxWithConfig
    )
    expect(res.success).toBe(false)
  })
})

describe('simulate_opponent：陪练回合制（结束并汇总）', () => {
  const FINALIZE_JSON = JSON.stringify({
    summary: '整体在判准回应上失守，但论点拆解进步明显。',
    keyPoints: [
      { point: '判准被反复追打', tip: '先给出判准成立的论证' },
      { point: '归谬化解及时', tip: '继续预设数据边界' }
    ]
  })

  it('finalize=true → 返回对抗汇总（mode sparring_finalize）', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: FINALIZE_JSON })
    const res = await simulateOpponentTool.execute(
      {
        ...VALID_ARGS,
        difficulty: 'intermediate',
        history: [{ opponent: 'q1', userReply: 'a1' }, { opponent: 'q2', userReply: 'a2' }],
        finalize: true
      },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    if (!('roundsPlayed' in res)) throw new Error('unexpected finalize result')
    expect(res.mode).toBe('sparring_finalize')
    expect(res.roundsPlayed).toBe(2)
    expect(res.summary).toContain('判准回应上失守')
    expect(res.keyPoints).toHaveLength(2)

    const [messages] = mockChat.mock.calls[0]
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('第 2 轮')
  })

  it('finalize 返回无 summary → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '{"keyPoints":[]}' })
    const res = await simulateOpponentTool.execute(
      { ...VALID_ARGS, difficulty: 'novice', finalize: true },
      ctxWithConfig
    )
    expect(res.success).toBe(false)
  })

  it('finalize 非 JSON → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '不是JSON' })
    const res = await simulateOpponentTool.execute(
      { ...VALID_ARGS, difficulty: 'novice', finalize: true },
      ctxWithConfig
    )
    expect(res.success).toBe(false)
  })
})
