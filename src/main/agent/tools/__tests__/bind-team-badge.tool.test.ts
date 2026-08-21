// ============================================================
// bind-team-badge.tool.test.ts — bind_team_badge 工具测试（T6）
//
// Mock 策略：mock badge-storage.setTeamBadge，验证调用与风险等级。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { mockSetTeamBadge } = vi.hoisted(() => ({ mockSetTeamBadge: vi.fn() }))

vi.mock('../../../services/badge-storage', () => ({ setTeamBadge: mockSetTeamBadge }))

import { bindTeamBadgeTool } from '../bind-team-badge.tool'

beforeEach(() => {
  mockSetTeamBadge.mockImplementation(() => {
    /* noop */
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('bind_team_badge：工具元数据', () => {
  it('name 应为 bind_team_badge', () => {
    expect(bindTeamBadgeTool.name).toBe('bind_team_badge')
  })
  it('riskLevel 应为 high（写文件需确认）', () => {
    expect(bindTeamBadgeTool.riskLevel).toBe('high')
  })
  it('parameters required 应含 teamId 与 badgeId', () => {
    expect(bindTeamBadgeTool.parameters.required).toContain('teamId')
    expect(bindTeamBadgeTool.parameters.required).toContain('badgeId')
  })
})

describe('bind_team_badge：入参校验', () => {
  it('teamId 缺失 → 抛错', async () => {
    await expect(
      bindTeamBadgeTool.execute({ teamId: '', badgeId: 'b1' })
    ).rejects.toThrow(/teamId 不能为空/)
  })
  it('badgeId 缺失 → 抛错', async () => {
    await expect(
      bindTeamBadgeTool.execute({ teamId: 't1', badgeId: '' })
    ).rejects.toThrow(/badgeId 不能为空/)
  })
})

describe('bind_team_badge：绑定队伍队徽', () => {
  it('调用 setTeamBadge(teamId, badgeId) 并返回 bound:true', async () => {
    const result = await bindTeamBadgeTool.execute({ teamId: 't1', badgeId: 'builtin-univ-pku' })
    expect(mockSetTeamBadge).toHaveBeenCalledWith('t1', 'builtin-univ-pku')
    expect(result).toEqual({ teamId: 't1', badgeId: 'builtin-univ-pku', bound: true })
  })
})