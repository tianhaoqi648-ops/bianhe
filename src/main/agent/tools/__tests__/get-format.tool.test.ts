// ============================================================
// get-format.tool.test.ts — get_format 工具入参校验测试
//
// 覆盖 get-format.tool.ts 的查询逻辑与分支：
//   - formatId 非空 + 命中 → 返回 DebateFormat
//   - formatId 非空 + 未命中 → 返回 { found: false, message }
//   - formatId 缺省 + 有预设 → 返回 listAll 首条
//   - formatId 缺省 + 空库 → 返回 { found: false, message }
//   - formatId=空串 → 视同缺省走 listAll 分支
//   - repo 抛错 → 工具抛错
//
// Mock 策略：mock formatRepo.getById 与 listAll，隔离工具层分支逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DebateFormat } from '@shared/types'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockGetById, mockListAll } = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockListAll: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/db/repository/format.repo', () => ({
  formatRepo: {
    getById: mockGetById,
    listAll: mockListAll
  }
}))

// 导入被测模块（在 mock 之后）
import { getFormatTool } from '../get-format.tool'

// ============================================================
// Mock 数据
// ============================================================

/** 构造一条 DebateFormat */
function makeFormat(id: string, name: string, isPreset = true): DebateFormat {
  return {
    id,
    name,
    description: '测试赛制',
    isPreset,
    formatData: {
      stages: [
        { id: 's1', name: '立论', side: 'aff', durationMs: 180000, bells: [] },
        { id: 's2', name: '驳论', side: 'neg', durationMs: 180000, bells: [] }
      ],
      totalDurationMs: 360000
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockListAll.mockReturnValue([])
  mockGetById.mockReturnValue(null)
})

describe('get_format：按 formatId 查询命中', () => {
  it('formatId 非空 + 命中 → 返回 DebateFormat', async () => {
    const fmt = makeFormat('fmt-1', '标准赛制')
    mockGetById.mockReturnValue(fmt)

    const result = await getFormatTool.execute({ formatId: 'fmt-1' })

    expect(result).toEqual(fmt)
    expect(mockGetById).toHaveBeenCalledWith('fmt-1')
    // 命中分支不应调用 listAll
    expect(mockListAll).not.toHaveBeenCalled()
  })
})

describe('get_format：按 formatId 查询未命中', () => {
  it('formatId 非空 + 未命中 → 返回 { found: false, message }', async () => {
    mockGetById.mockReturnValue(null)

    const result = await getFormatTool.execute({ formatId: 'no-such-fmt' })

    expect(result).toEqual({ found: false, message: '未找到 ID 为 no-such-fmt 的赛制' })
    expect(mockListAll).not.toHaveBeenCalled()
  })
})

describe('get_format：formatId 缺省 → 返回默认赛制', () => {
  it('有预设 → 返回 listAll 首条', async () => {
    const f1 = makeFormat('preset-1', '英式辩论')
    const f2 = makeFormat('preset-2', '中式辩论')
    mockListAll.mockReturnValue([f1, f2])

    const result = await getFormatTool.execute({})

    expect(result).toEqual(f1)
    expect(mockGetById).not.toHaveBeenCalled()
  })

  it('空库 → 返回 { found: false, message }', async () => {
    mockListAll.mockReturnValue([])

    const result = await getFormatTool.execute({})

    expect(result).toEqual({ found: false, message: '当前数据库中无任何赛制模板' })
  })

  it('formatId=空串 → 视同缺省走 listAll 分支', async () => {
    const f1 = makeFormat('preset-1', '英式辩论')
    mockListAll.mockReturnValue([f1])

    const result = await getFormatTool.execute({ formatId: '' })

    expect(result).toEqual(f1)
    expect(mockGetById).not.toHaveBeenCalled()
  })
})

describe('get_format：repo 错误透传', () => {
  it('getById 抛错 → 工具抛出同一错误', async () => {
    mockGetById.mockImplementation(() => {
      throw new Error('DB 读取失败')
    })

    await expect(
      getFormatTool.execute({ formatId: 'fmt-x' })
    ).rejects.toThrow(/DB 读取失败/)
  })

  it('listAll 抛错 → 工具抛出同一错误', async () => {
    mockListAll.mockImplementation(() => {
      throw new Error('DB 列表查询失败')
    })

    await expect(
      getFormatTool.execute({})
    ).rejects.toThrow(/DB 列表查询失败/)
  })
})

describe('get_format：工具元数据', () => {
  it('name 应为 get_format', () => {
    expect(getFormatTool.name).toBe('get_format')
  })

  it('riskLevel 应为 low', () => {
    expect(getFormatTool.riskLevel).toBe('low')
  })

  it('parameters 无必填字段', () => {
    expect(getFormatTool.parameters.required ?? []).toEqual([])
  })
})
