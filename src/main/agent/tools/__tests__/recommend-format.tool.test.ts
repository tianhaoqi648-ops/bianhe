// ============================================================
// recommend-format.tool.test.ts — recommend_format 工具入参校验测试（Task 51.5）
//
// 覆盖 recommend-format.tool.ts 的入参校验：
//   - teamCount 非正整数 → 抛错
//   - teamCount 缺失 → 抛错
//   - 无赛制模板 → 返回 matchScore=0
//   - 正常推荐 → 返回 formatId / matchScore / reason
//
// Mock 策略：mock formatRepo.listAll，隔离工具层校验逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DebateFormat } from '@shared/types'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockListAll } = vi.hoisted(() => ({
  mockListAll: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/db/repository/format.repo', () => ({
  formatRepo: {
    listAll: mockListAll
  }
}))

// 导入被测模块（在 mock 之后）
import { recommendFormatTool } from '../recommend-format.tool'

// ============================================================
// Mock 数据
// ============================================================

/** 构造 2 队制赛制模板 */
function make2TeamFormat(
  id: string,
  name: string,
  totalMinutes: number = 30,
  description: string = ''
): DebateFormat {
  return {
    id,
    name,
    description,
    isPreset: true,
    formatData: {
      stages: [
        { side: '正方', name: '立论', durationMs: 180000 },
        { side: '反方', name: '立论', durationMs: 180000 }
      ],
      totalDurationMs: totalMinutes * 60000
    } as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

/** 构造 4 队制赛制模板（BP 制） */
function make4TeamFormat(
  id: string,
  name: string,
  totalMinutes: number = 60
): DebateFormat {
  return {
    id,
    name,
    description: '英式议会制',
    isPreset: true,
    formatData: {
      stages: [
        { side: 'og', name: '首相发言', durationMs: 420000 },
        { side: 'oo', name: '反对党领袖', durationMs: 420000 },
        { side: 'cg', name: '副首相', durationMs: 420000 },
        { side: 'co', name: '反对党副领袖', durationMs: 420000 }
      ],
      totalDurationMs: totalMinutes * 60000
    } as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recommend_format：teamCount 校验', () => {
  it('teamCount 缺失 → 抛错', async () => {
    await expect(
      recommendFormatTool.execute({} as never)
    ).rejects.toThrow(/teamCount 必须为正整数/)
  })

  it('teamCount=0 → 抛错', async () => {
    await expect(
      recommendFormatTool.execute({ teamCount: 0 })
    ).rejects.toThrow(/teamCount 必须为正整数/)
  })

  it('teamCount 负数 → 抛错', async () => {
    await expect(
      recommendFormatTool.execute({ teamCount: -1 })
    ).rejects.toThrow(/teamCount 必须为正整数/)
  })

  it('teamCount 小数 → 抛错', async () => {
    await expect(
      recommendFormatTool.execute({ teamCount: 2.5 })
    ).rejects.toThrow(/teamCount 必须为正整数/)
  })

  it('teamCount=NaN → 抛错', async () => {
    await expect(
      recommendFormatTool.execute({ teamCount: NaN })
    ).rejects.toThrow(/teamCount 必须为正整数/)
  })
})

describe('recommend_format：无赛制模板', () => {
  it('数据库无模板 → 返回 matchScore=0', async () => {
    mockListAll.mockReturnValue([])

    const result = await recommendFormatTool.execute({ teamCount: 8 })

    expect(result.formatId).toBe('')
    expect(result.formatName).toBe('')
    expect(result.matchScore).toBe(0)
    expect(result.reason).toContain('无任何赛制模板')
  })
})

describe('recommend_format：正常推荐', () => {
  it('2 队赛事 → 推荐 2 队制赛制（完全匹配 +40）', async () => {
    mockListAll.mockReturnValue([
      make2TeamFormat('fmt-2', '标准 2 队制', 30),
      make4TeamFormat('fmt-4', 'BP 4 队制', 60)
    ])

    const result = await recommendFormatTool.execute({ teamCount: 2 })

    expect(result.formatId).toBe('fmt-2')
    expect(result.matchScore).toBeGreaterThan(0)
    expect(result.reason).toBeDefined()
  })

  it('4 队赛事 → 推荐 4 队制赛制', async () => {
    mockListAll.mockReturnValue([
      make2TeamFormat('fmt-2', '标准 2 队制', 30),
      make4TeamFormat('fmt-4', 'BP 4 队制', 60)
    ])

    const result = await recommendFormatTool.execute({ teamCount: 4 })

    expect(result.formatId).toBe('fmt-4')
    expect(result.matchScore).toBeGreaterThan(0)
  })

  it('totalTime 接近的赛制得分更高', async () => {
    mockListAll.mockReturnValue([
      make2TeamFormat('fmt-a', '赛制A', 20), // 与目标 30 差 10 分钟
      make2TeamFormat('fmt-b', '赛制B', 30)  // 与目标 30 完全匹配
    ])

    const result = await recommendFormatTool.execute({
      teamCount: 2,
      totalTime: 30
    })

    expect(result.formatId).toBe('fmt-b')
  })

  it('style 匹配的赛制得分更高', async () => {
    mockListAll.mockReturnValue([
      make2TeamFormat('fmt-a', '标准赛制', 30, '休闲风格'),
      make2TeamFormat('fmt-b', '英式赛制', 30, '正式 BP 制')
    ])

    const result = await recommendFormatTool.execute({
      teamCount: 2,
      style: 'formal'
    })

    // fmt-b 名称含「英式」，匹配 formal 关键词
    expect(result.formatId).toBe('fmt-b')
  })

  it('返回 reason 包含评分细节', async () => {
    mockListAll.mockReturnValue([make2TeamFormat('fmt-1', '标准赛制', 30)])

    const result = await recommendFormatTool.execute({
      teamCount: 2,
      totalTime: 30,
      style: 'formal'
    })

    expect(result.reason).toContain('分')
  })
})

describe('recommend_format：工具元数据', () => {
  it('name 应为 recommend_format', () => {
    expect(recommendFormatTool.name).toBe('recommend_format')
  })

  it('riskLevel 应为 low', () => {
    expect(recommendFormatTool.riskLevel).toBe('low')
  })

  it('parameters required 应含 teamCount', () => {
    expect(recommendFormatTool.parameters.required).toContain('teamCount')
  })
})
