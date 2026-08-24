// ============================================================
// tool-registry-permission.test.ts — 一次性授权 grant 门控（governance Task 9）
//
// 覆盖：
//   1. read 工具直接放行（无需授权）
//   2. write / dangerous 未提供 grant → 被拒（抛 ToolPermissionError，含原因），且不执行工具体
//   3. deny/未确认 → 同样被拒（未提供 grantId）
//   4. 提供正确 grant（session + tool + argsHash + 未过期 + tier 匹配）→ 放行，且一次性消费
//   5. 错误 session / 错误 tool / 错误 argsHash / 已过期 grant → 均拒绝，且不执行工具体
//   6. 不再信任调用方自行声明的 grants:[{tier}]（未登记 grant 仍拒绝）
//   7. 未知工具行为：getTier 回退 'read'，execute 抛 Tool not found
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ToolDefinition, ToolPermissionTier, ToolExecutionContext } from '@shared/agent-types'
import {
  register,
  clear,
  execute,
  getTier,
  createGrant,
  clearGrants,
  ToolPermissionError
} from '../tool-registry'

/** 构造一个无副作用的 stub 工具，execute 记录是否被调用 */
function makeStubTool(name: string, tier: ToolPermissionTier) {
  const spy = vi.fn().mockResolvedValue(`${name}:ok`)
  const tool: ToolDefinition = {
    name,
    description: `stub ${name}`,
    parameters: { type: 'object', properties: {} },
    riskLevel: 'low',
    tier,
    execute: spy
  }
  return { tool, spy }
}

beforeEach(() => {
  clear()
})

afterEach(() => {
  clearGrants()
  clear()
})

describe('read 工具：直接放行', () => {
  it('read 工具无 grantId 亦可执行', async () => {
    const { tool, spy } = makeStubTool('get_info', 'read')
    register(tool)
    const res = await execute('get_info', {})
    expect(res).toBe('get_info:ok')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('write / dangerous 未授权：被拒且不执行', () => {
  it.each([
    ['write_tool', 'write'],
    ['danger_tool', 'dangerous']
  ])('%s（%s）未提供 grant → 抛 ToolPermissionError，且不执行工具体', async (name, tier) => {
    const { tool, spy } = makeStubTool(name, tier as ToolPermissionTier)
    register(tool)

    await expect(execute(name, {})).rejects.toBeInstanceOf(ToolPermissionError)
    // 权限拒绝信息应包含 tier 与授权方式说明，并注明缺少 grantId 的原因
    await expect(execute(name, {})).rejects.toMatchObject({
      tier,
      code: 'permission_denied',
      reason: expect.stringContaining('grantId'),
      howToGrant: expect.stringMatching(/确认|设置页/)
    })
    // 关键：不允许执行 → 工具体未被调用
    expect(spy).not.toHaveBeenCalled()
  })

  it('deny/未确认（空 ctx）→ 仍被拒，不执行', async () => {
    const { tool, spy } = makeStubTool('write_tool', 'write')
    register(tool)
    await expect(execute('write_tool', {}, {})).rejects.toBeInstanceOf(ToolPermissionError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('不再信任调用方自行声明的 grants:[{tier}]（未登记 grant）→ 仍被拒', async () => {
    const { tool, spy } = makeStubTool('danger_tool', 'dangerous')
    register(tool)
    // 按旧方式声明 tier 但未提供登记过的 grantId —— 不应放行
    await expect(
      execute('danger_tool', {}, { grants: [{ tier: 'dangerous' }] } as ToolExecutionContext)
    ).rejects.toBeInstanceOf(ToolPermissionError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('grantId 指向不存在的 grant → 被拒，不执行', async () => {
    const { tool, spy } = makeStubTool('write_tool', 'write')
    register(tool)
    await expect(execute('write_tool', {}, { grantId: 'no-such-grant' })).rejects.toMatchObject({
      reason: expect.stringContaining('不存在或已使用')
    })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('grant 正确：放行并一次性消费', () => {
  it('session + tool + argsHash + 未过期 + tier 全部匹配 → 执行', async () => {
    const { tool, spy } = makeStubTool('write_tool', 'write')
    register(tool)
    const args = { name: '赛事X' }
    const grant = createGrant({ sessionId: 's1', toolName: 'write_tool', args, tier: 'write' })

    // 校验异常时也应暴露 grantId（供调用方自校验），但此处校验通过
    const res = await execute('write_tool', args, {
      sessionId: 's1',
      grantId: grant.grantId
    })
    expect(res).toBe('write_tool:ok')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('dangerous 工具提供匹配 grant → 执行', async () => {
    const { tool, spy } = makeStubTool('danger_tool', 'dangerous')
    register(tool)
    const args = { url: 'https://example.com' }
    const grant = createGrant({ toolName: 'danger_tool', args, tier: 'dangerous' })
    const res = await execute('danger_tool', args, { grantId: grant.grantId })
    expect(res).toBe('danger_tool:ok')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('grant 一次性：校验成功后被消费，再次用同一 grantId → 被拒，不执行', async () => {
    const { tool, spy } = makeStubTool('write_tool', 'write')
    register(tool)
    const args = { name: '赛事X' }
    const grant = createGrant({ toolName: 'write_tool', args, tier: 'write' })

    const res = await execute('write_tool', args, { grantId: grant.grantId })
    expect(res).toBe('write_tool:ok')
    expect(spy).toHaveBeenCalledTimes(1)

    // 同一 grant 再次使用 → 已被消费，拒绝
    await expect(execute('write_tool', args, { grantId: grant.grantId })).rejects.toMatchObject({
      reason: expect.stringContaining('已被消费')
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('grant 不匹配：均拒绝且不执行', () => {
  it('错误 sessionId → 拒绝，不执行', async () => {
    const { tool, spy } = makeStubTool('write_tool', 'write')
    register(tool)
    const args = { name: '赛事X' }
    const grant = createGrant({ sessionId: 's1', toolName: 'write_tool', args, tier: 'write' })
    await expect(
      execute('write_tool', args, { sessionId: 's2', grantId: grant.grantId })
    ).rejects.toMatchObject({ reason: expect.stringContaining('会话') })
    expect(spy).not.toHaveBeenCalled()
  })

  it('错误 toolName → 拒绝，不执行', async () => {
    const a = makeStubTool('write_a', 'write')
    const b = makeStubTool('write_b', 'write')
    register(a.tool)
    register(b.tool)
    const grant = createGrant({ toolName: 'write_b', args: {}, tier: 'write' })
    await expect(execute('write_a', {}, { grantId: grant.grantId })).rejects.toMatchObject({
      reason: expect.stringContaining('不一致')
    })
    expect(a.spy).not.toHaveBeenCalled()
  })

  it('错误 argsHash（参数被偷换）→ 拒绝，不执行', async () => {
    const { tool, spy } = makeStubTool('write_tool', 'write')
    register(tool)
    const grant = createGrant({ toolName: 'write_tool', args: { name: 'A' }, tier: 'write' })
    // 本次调用携带不同参数（{name:'B'}）
    await expect(execute('write_tool', { name: 'B' }, { grantId: grant.grantId })).rejects.toMatchObject(
      { reason: expect.stringContaining('参数') }
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('已过期 grant → 拒绝，不执行', async () => {
    const { tool, spy } = makeStubTool('write_tool', 'write')
    register(tool)
    // ttlMs 为负 → expiresAt 在过去，立即过期
    const grant = createGrant({ toolName: 'write_tool', args: {}, tier: 'write', ttlMs: -1000 })
    await expect(execute('write_tool', {}, { grantId: grant.grantId })).rejects.toMatchObject({
      reason: expect.stringContaining('过期')
    })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('未知工具行为', () => {
  it('getTier 对未注册工具回退 read（缺省只读）', () => {
    clear()
    expect(getTier('no_such_tool')).toBe('read')
  })

  it('execute 对未注册工具抛 Tool not found', async () => {
    clear()
    await expect(execute('no_such_tool', {})).rejects.toThrow(/Tool not found/)
  })
})