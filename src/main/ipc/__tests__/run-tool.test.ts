// ============================================================
// run-tool.test.ts — agent:run-tool 纯逻辑测试（AI 裁判工作台 2026-08-18）
//
// 覆盖：白名单校验 / config 缺失 / 工具未注册 / 成功执行 / abort 取消 / 异常兜底。
// mock：tool-registry 的 getDefinition / execute。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RunToolRequest, LLMConfig } from '@shared/agent-types'

const { mockGetDefinition, mockExecute } = vi.hoisted(() => ({
  mockGetDefinition: vi.fn(),
  mockExecute: vi.fn()
}))

vi.mock('../../agent/tool-registry', () => ({
  getDefinition: mockGetDefinition,
  execute: mockExecute,
  register: vi.fn(),
  get: vi.fn(),
  getRiskLevel: vi.fn(),
  list: vi.fn(),
  toOpenAITools: vi.fn(),
  clear: vi.fn()
}))

import { runJudgeTool, JUDGE_TOOL_NAMES } from '../run-tool'

const VALID_CONFIG: LLMConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini'
}

function makeReq(overrides: Partial<RunToolRequest> = {}): RunToolRequest {
  return {
    toolName: 'judge_speech',
    args: { topic: 't', stage: 'opening' },
    config: VALID_CONFIG,
    ...overrides
  }
}

beforeEach(() => {
  mockGetDefinition.mockReset()
  mockExecute.mockReset()
  mockGetDefinition.mockImplementation((name: string) => ({ name } as never))
})

describe('白名单校验', () => {
  it('5 个裁判工具全在白名单内', () => {
    expect(JUDGE_TOOL_NAMES).toEqual([
      'judge_debate',
      'judge_speech',
      'detect_stage',
      'simulate_opponent',
      'rewrite_speech'
    ])
  })

  it('白名单外工具 → forbidden_tool，不执行', async () => {
    const res = await runJudgeTool(makeReq({ toolName: 'create_topic' }))
    expect(res.success).toBe(false)
    expect(res.code).toBe('forbidden_tool')
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('config 校验', () => {
  it('config 缺失 → no_api_key', async () => {
    const res = await runJudgeTool(makeReq({ config: undefined as never }))
    expect(res.success).toBe(false)
    expect(res.code).toBe('no_api_key')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('apiKey 为空 → no_api_key', async () => {
    const res = await runJudgeTool(
      makeReq({ config: { ...VALID_CONFIG, apiKey: '' } as never })
    )
    expect(res.success).toBe(false)
    expect(res.code).toBe('no_api_key')
  })
})

describe('工具存在性', () => {
  it('工具未注册 → not_found', async () => {
    mockGetDefinition.mockReturnValue(undefined)
    const res = await runJudgeTool(makeReq())
    expect(res.success).toBe(false)
    expect(res.code).toBe('not_found')
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('执行与取消', () => {
  it('成功执行 → 返回数据', async () => {
    mockExecute.mockResolvedValue({ success: true, dimensions: [] })
    const res = await runJudgeTool(makeReq())
    expect(res.success).toBe(true)
    expect(res.code).toBe('ok')
    expect(res.data).toMatchObject({ success: true })
    // 透传 config/signal 到 execute
    expect(mockExecute).toHaveBeenCalledWith(
      'judge_speech',
      { topic: 't', stage: 'opening' },
      expect.objectContaining({ config: VALID_CONFIG })
    )
  })

  it('abort 后返回 cancelled（即使 execute 已返回）', async () => {
    mockExecute.mockResolvedValue({ success: true })
    const controller = new AbortController()
    controller.abort()
    const res = await runJudgeTool(makeReq(), controller.signal)
    expect(res.success).toBe(false)
    expect(res.code).toBe('cancelled')
  })

  it('abort 时 execute 抛错 → cancelled', async () => {
    mockExecute.mockRejectedValue(new Error('aborted'))
    const controller = new AbortController()
    controller.abort()
    const res = await runJudgeTool(makeReq(), controller.signal)
    expect(res.success).toBe(false)
    expect(res.code).toBe('cancelled')
  })

  it('execute 抛错 → error 兜底', async () => {
    mockExecute.mockRejectedValue(new Error('工具内部错误'))
    const res = await runJudgeTool(makeReq())
    expect(res.success).toBe(false)
    expect(res.code).toBe('error')
    expect(res.message).toContain('工具内部错误')
  })
})
