// ============================================================
// live-debate.tool.test.ts — judge_live 实时对辩工具测试（Task 4 2026-08-23）
//
// Mock：llm-client 的 chat。
// 覆盖：入参校验（topic 必填）/ phase 缺省推导 / 各环节 prompt 语气注入 /
//      换轮结果结构（role/phase/speech/nextRounds）/ 结束汇总 JSON 解析 /
//      缺 config / 空文本 / 非 JSON / 写评审历史（toolName=judge_live）。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolExecutionContext, LLMConfig } from '@shared/agent-types'
import { liveDebateTool } from '../live-debate.tool'

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
  side: 'aff' as const
}

const VALID_CONFIG: LLMConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

const ctxWithConfig: ToolExecutionContext = { config: VALID_CONFIG }

const FINALIZE_JSON = JSON.stringify({
  summary: '申论立论清晰，但质询阶段对判准的回应多次失守。',
  keyPoints: [
    { point: '质询阶段判准被反复追打', tip: '先给出判准成立的论证' },
    { point: '自由辩太快接受对方类比', tip: '先拆类比适用边界' }
  ]
})

beforeEach(() => {
  mockChat.mockReset()
  mockJudgeHistoryCreate.mockReset()
})

describe('judge_live：入参校验', () => {
  it('缺少 topic → success:false，不调 LLM', async () => {
    const res = await liveDebateTool.execute({ side: 'aff' } as never, ctxWithConfig)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })
})

describe('judge_live：换轮（实时对辩发言）', () => {
  it('缺 ctx.config → success:false，不调 LLM', async () => {
    const res = await liveDebateTool.execute(VALID_ARGS)
    expect(res.success).toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('无 history/phase → 默认申论环节，返回角色 opponent + speech + nextRounds', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '我方认为，网络让连接更紧密……（申论展开）' })
    const res = await liveDebateTool.execute(VALID_ARGS, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    if (!('speech' in res)) throw new Error('unexpected live finalize result')
    expect(res.mode).toBe('live_turn')
    expect(res.role).toBe('opponent')
    expect(res.phase).toBe('constructive')
    expect(res.roundIndex).toBe(1)
    expect(res.speech).toContain('申论')
    expect(Array.isArray(res.nextRounds)).toBe(true)
    expect(res.nextRounds).toEqual([])
    expect(res.judgeName).toBe('攻防流')

    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('攻防流')
    expect(system.content).toContain('申论')
    expect(system.content).toContain('立论展开')
  })

  it('指定 phase=crossfire → prompt 含质询语气', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '请问对方辩友，你的判准为何成立？' })
    const res = await liveDebateTool.execute({ ...VALID_ARGS, phase: 'crossfire' }, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    expect(res.phase).toBe('crossfire')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('质询')
    expect(system.content).toContain('连珠质问')
  })

  it('指定 phase=free → prompt 含快速攻防语气', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '那数据样本呢？' })
    const res = await liveDebateTool.execute({ ...VALID_ARGS, phase: 'free' }, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('自由辩论')
    expect(system.content).toContain('快速攻防')
  })

  it('指定 phase=summary → prompt 含收束语气', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '综上所述，我方立场得以充分论证。' })
    const res = await liveDebateTool.execute({ ...VALID_ARGS, phase: 'summary' }, ctxWithConfig)
    if (!res.success) throw new Error(res.error)
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('总结')
    expect(system.content).toContain('收束')
  })

  it('提供 history → 由历史尾部推导下一环节，roundIndex 递增且历史写入 prompt', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '质询第一问……' })
    const res = await liveDebateTool.execute(
      {
        ...VALID_ARGS,
        history: [{ phase: 'constructive', opponent: '申论发言', userReply: '我的申论回应' }]
      },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    if (!('roundIndex' in res)) throw new Error('unexpected finalize')
    expect(res.phase).toBe('crossfire')
    expect(res.roundIndex).toBe(2)
    const [messages] = mockChat.mock.calls[0]
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('第 1 轮')
    expect(user.content).toContain('我的申论回应')
  })

  it('指定 scope=具体环节 → 锁定该环节（即使传入 phase/history），prompt 注入锁定约束', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '质询连问……' })
    const res = await liveDebateTool.execute(
      {
        ...VALID_ARGS,
        phase: 'constructive',
        history: [{ phase: 'constructive', opponent: '申论', userReply: '申论回应' }],
        scope: 'crossfire'
      },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    if (!('speech' in res)) throw new Error('unexpected finalize')
    expect(res.mode).toBe('live_turn')
    expect(res.phase).toBe('crossfire')
    const [messages] = mockChat.mock.calls[0]
    const system = messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('连珠质问')
    expect(system.content).toContain('不要跳到其他环节')
    const user = messages.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toContain('环节范围')
  })

  it('换轮返回空文本 → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '   ' })
    const res = await liveDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })
})

describe('judge_live：结束并汇总', () => {
  it('finalize=true → 返回对抗要点（mode live_finalize）', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: FINALIZE_JSON })
    const res = await liveDebateTool.execute(
      {
        ...VALID_ARGS,
        history: [
          { phase: 'constructive', opponent: 'o1', userReply: 'a1' },
          { phase: 'crossfire', opponent: 'o2', userReply: 'a2' }
        ],
        finalize: true
      },
      ctxWithConfig
    )
    if (!res.success) throw new Error(res.error)
    if (!('roundsPlayed' in res)) throw new Error('unexpected turn result')
    expect(res.mode).toBe('live_finalize')
    expect(res.role).toBe('opponent')
    expect(res.phase).toBe('summary')
    expect(res.roundsPlayed).toBe(2)
    expect(res.summary).toContain('申论')
    expect(res.keyPoints).toHaveLength(2)
  })

  it('finalize 返回无 summary → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '{"keyPoints":[]}' })
    const res = await liveDebateTool.execute({ ...VALID_ARGS, finalize: true }, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('finalize 非 JSON → success:false', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '不是JSON' })
    const res = await liveDebateTool.execute({ ...VALID_ARGS, finalize: true }, ctxWithConfig)
    expect(res.success).toBe(false)
  })
})

describe('judge_live：异常与历史写入', () => {
  it('chat 抛 LLMError → success:false', async () => {
    const { LLMError } = await import('../../llm-client')
    mockChat.mockRejectedValue(new LLMError('rate_limit', '限流'))
    const res = await liveDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(res.success).toBe(false)
  })

  it('换轮成功时写 judge_live 历史（role 由前端 toolName 推导），失败态不写', async () => {
    mockChat.mockResolvedValue({ role: 'assistant', content: '某段发言' })
    const ok = await liveDebateTool.execute(VALID_ARGS, ctxWithConfig)
    expect(ok.success).toBe(true)
    expect(mockJudgeHistoryCreate).toHaveBeenCalledTimes(1)
    const input = mockJudgeHistoryCreate.mock.calls[0][0]
    expect(input.toolName).toBe('judge_live')
    expect(input.judgeId).toBe('hu-jianbiao')
    expect(input.side).toBe('aff')
    expect(input.topic).toBe(VALID_ARGS.topic)
    expect(input.resultJson).toMatchObject({ success: true, mode: 'live_turn', role: 'opponent' })

    mockChat.mockResolvedValue({ role: 'assistant', content: '不是JSON' })
    const fail = await liveDebateTool.execute({ ...VALID_ARGS, finalize: true }, ctxWithConfig)
    expect(fail.success).toBe(false)
    expect(mockJudgeHistoryCreate).toHaveBeenCalledTimes(1)
  })
})