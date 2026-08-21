// ============================================================
// list-badges.tool.test.ts — list_badges 工具测试（T6）
//
// Mock 策略：mock badge-storage.searchBadges，验证 keyword 透传与返回映射。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { mockSearchBadges } = vi.hoisted(() => ({ mockSearchBadges: vi.fn() }))

vi.mock('../../../services/badge-storage', () => ({ searchBadges: mockSearchBadges }))

import { listBadgesTool } from '../list-badges.tool'

beforeEach(() => {
  mockSearchBadges.mockReturnValue([
    { id: 'builtin-univ-pku', name: '北大 · 常规', kind: 'builtin' },
    { id: 'custom-1', name: '校徽A', kind: 'custom' }
  ])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('list_badges：工具元数据', () => {
  it('name 应为 list_badges', () => {
    expect(listBadgesTool.name).toBe('list_badges')
  })
  it('riskLevel 应为 low', () => {
    expect(listBadgesTool.riskLevel).toBe('low')
  })
})

describe('list_badges：列出队徽', () => {
  it('无 keyword 时列出全部并映射为 id/name/kind', async () => {
    const result = await listBadgesTool.execute({})
    expect(mockSearchBadges).toHaveBeenCalledWith('')
    expect(result.count).toBe(2)
    expect(result.badges).toEqual([
      { id: 'builtin-univ-pku', name: '北大 · 常规', kind: 'builtin' },
      { id: 'custom-1', name: '校徽A', kind: 'custom' }
    ])
  })

  it('带 keyword 时透传给 searchBadges 过滤', async () => {
    await listBadgesTool.execute({ keyword: '清华' })
    expect(mockSearchBadges).toHaveBeenCalledWith('清华')
  })
})