// ============================================================
// tool-registry-permission.test.ts — 默认只读权限门控（AI Agent v1.5.0）
//
// 覆盖：
//   1. read 工具直接放行（无需授权）
//   2. write / dangerous 未授权被拒：抛 ToolPermissionError（含 tier），且不执行工具体
//   3. 授权后放行：按 toolName 或按 tier 声明 grants 均可执行
//   4. 未知工具行为：getTier 回退 'read'，execute 抛 Tool not found
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ToolDefinition, ToolPermissionTier } from '@shared/agent-types'
import { register, clear, execute, getTier, ToolPermissionError } from '../tool-registry'

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
  clear()
})

describe('read 工具：直接放行', () => {
  it('read 工具无 grants 即可执行', async () => {
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
  ])('%s（%s）未授权 → 抛 ToolPermissionError，且不执行工具体', async (name, tier) => {
    const { tool, spy } = makeStubTool(name, tier as ToolPermissionTier)
    register(tool)

    await expect(execute(name, {})).rejects.toBeInstanceOf(ToolPermissionError)
    // 权限拒绝信息应包含 tier 与授权方式说明
    await expect(execute(name, {})).rejects.toMatchObject({
      tier,
      code: 'permission_denied',
      howToGrant: expect.stringMatching(/确认|设置页/)
    })
    // 关键：不允许执行 → 工具体未被调用
    expect(spy).not.toHaveBeenCalled()
  })

  it('write 工具传空数组 grants → 仍被拒', async () => {
    const { tool, spy } = makeStubTool('write_tool', 'write')
    register(tool)
    await expect(execute('write_tool', {}, { grants: [] })).rejects.toBeInstanceOf(
      ToolPermissionError
    )
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('授权后放行', () => {
  it('按 toolName 精确授权 write 工具 → 执行', async () => {
    const { tool, spy } = makeStubTool('write_tool', 'write')
    register(tool)
    const res = await execute('write_tool', {}, { grants: [{ toolName: 'write_tool' }] })
    expect(res).toBe('write_tool:ok')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('按 tier 授权 dangerous 工具 → 执行', async () => {
    const { tool, spy } = makeStubTool('danger_tool', 'dangerous')
    register(tool)
    const res = await execute('danger_tool', {}, { grants: [{ tier: 'dangerous' }] })
    expect(res).toBe('danger_tool:ok')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('授权了别的 write 工具名 → 本工具仍被拒', async () => {
    const { tool, spy } = makeStubTool('write_a', 'write')
    register(tool)
    await expect(
      execute('write_a', {}, { grants: [{ toolName: 'write_b' }] })
    ).rejects.toBeInstanceOf(ToolPermissionError)
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