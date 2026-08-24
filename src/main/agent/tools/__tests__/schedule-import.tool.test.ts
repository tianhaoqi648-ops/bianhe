// ============================================================
// schedule-import.tool.test.ts — import_event_schedule 工具测试（T5）
//
// Mock 策略：
//   - mock eventRepo / matchRepo / topicRepo 与 schedule-io 各纯函数
//   - apply=false：仅返回 diff 预览，applyScheduleDiff 与 matchRepo.create 均不调用
//   - apply=true：调用 applyScheduleDiff，并在 ops.create 上落到 matchRepo.create
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================
const {
  mockGetEventById,
  mockListMatches,
  mockListTeams,
  mockListRounds,
  mockListTopics,
  mockParseXlsx,
  mockComputeDiff,
  mockScheduleKey,
  mockBuildRows,
  mockApplyDiff,
  mockMatchCreate,
  mockMatchUpdate,
  mockMatchDelete,
  mockGetDb
} = vi.hoisted(() => ({
  mockGetEventById: vi.fn(),
  mockListMatches: vi.fn(),
  mockListTeams: vi.fn(),
  mockListRounds: vi.fn(),
  mockListTopics: vi.fn(),
  mockParseXlsx: vi.fn(),
  mockComputeDiff: vi.fn(),
  mockScheduleKey: vi.fn(),
  mockBuildRows: vi.fn(),
  mockApplyDiff: vi.fn(),
  mockMatchCreate: vi.fn(),
  mockMatchUpdate: vi.fn(),
  mockMatchDelete: vi.fn(),
  mockGetDb: vi.fn()
}))

const PREVIEW = {
  added: [{ kind: 'add', key: '第一轮#1', row: {} }],
  updated: [],
  deleted: [],
  unchanged: 0,
  warnings: []
}

const APPLY_RESULT = { appliedAdd: 1, appliedUpdate: 0, appliedDelete: 0, skipped: 0, warnings: [] }

// ============================================================
// Mock 依赖
// ============================================================
vi.mock('@main/db/repository/event.repo', () => ({
  eventRepo: {
    getEventById: mockGetEventById,
    listTeamsByEvent: mockListTeams,
    listRoundsByEvent: mockListRounds
  }
}))
vi.mock('@main/db/repository/match.repo', () => ({
  matchRepo: {
    listByEvent: mockListMatches,
    create: mockMatchCreate,
    update: mockMatchUpdate,
    delete: mockMatchDelete
  }
}))
vi.mock('@main/db/repository/topic.repo', () => ({
  topicRepo: { listTopics: mockListTopics }
}))
// @main/db 依赖 better-sqlite3（Electron ABI，vitest(Node ABI) 无法加载），
// 此处仅 mock getDb，事务接线由 schedule-io 原子边界承担，不在此断言。
vi.mock('@main/db', () => ({
  getDb: mockGetDb
}))
vi.mock('../../../services/schedule-io', () => ({
  parseScheduleXlsx: mockParseXlsx,
  computeScheduleDiff: mockComputeDiff,
  scheduleKey: mockScheduleKey,
  buildScheduleRows: mockBuildRows,
  applyScheduleDiff: mockApplyDiff
}))

import { scheduleImportTool } from '../schedule-import.tool'

// ============================================================
// 测试环境
// ============================================================
beforeEach(() => {
  mockGetEventById.mockReturnValue({ id: 'evt-1', name: '决赛' })
  mockListMatches.mockReturnValue([])
  mockListTeams.mockReturnValue([])
  mockListRounds.mockReturnValue([])
  mockListTopics.mockReturnValue({ items: [] })
  mockBuildRows.mockReturnValue([])
  mockScheduleKey.mockImplementation((r) => `${r.roundName ?? ''}#${r.matchNumber ?? ''}`)
  mockParseXlsx.mockReturnValue({ rows: [], warnings: [] })
  mockComputeDiff.mockReturnValue(PREVIEW)
  mockApplyDiff.mockReturnValue(APPLY_RESULT)
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// 测试用例
// ============================================================
describe('import_event_schedule：工具元数据', () => {
  it('name 应为 import_event_schedule', () => {
    expect(scheduleImportTool.name).toBe('import_event_schedule')
  })
  it('riskLevel 应为 high（写库需确认）', () => {
    expect(scheduleImportTool.riskLevel).toBe('high')
  })
  it('parameters required 应含 eventId 与 filePath', () => {
    expect(scheduleImportTool.parameters.required).toContain('eventId')
    expect(scheduleImportTool.parameters.required).toContain('filePath')
  })
  it('description 应说明 apply:true 才会写入且会被确认', () => {
    expect(scheduleImportTool.description).toMatch(/apply/)
    expect(scheduleImportTool.description).toMatch(/确认/)
  })
})

describe('import_event_schedule：入参校验', () => {
  it('eventId 缺失 → 抛错', async () => {
    await expect(
      scheduleImportTool.execute({ eventId: '', filePath: '/a.xlsx' })
    ).rejects.toThrow(/eventId 不能为空/)
  })
  it('filePath 缺失 → 抛错', async () => {
    await expect(
      scheduleImportTool.execute({ eventId: 'evt-1', filePath: '' })
    ).rejects.toThrow(/filePath 不能为空/)
  })
  it('赛事不存在 → 抛错', async () => {
    mockGetEventById.mockReturnValue(null)
    await expect(
      scheduleImportTool.execute({ eventId: 'nope', filePath: '/a.xlsx' })
    ).rejects.toThrow(/不存在/)
  })
})

describe('import_event_schedule：apply=false 不写库', () => {
  it('仅返回 diff 预览且 applied=false', async () => {
    const result = await scheduleImportTool.execute({ eventId: 'evt-1', filePath: '/a.xlsx' })
    expect(result.applied).toBe(false)
    expect(result.preview).toEqual(PREVIEW)
    expect(result.applyResult).toBeUndefined()
  })
  it('不调用 applyScheduleDiff 也不写库（matchRepo.create 未调用）', async () => {
    await scheduleImportTool.execute({ eventId: 'evt-1', filePath: '/a.xlsx' })
    expect(mockApplyDiff).not.toHaveBeenCalled()
    expect(mockMatchCreate).not.toHaveBeenCalled()
  })
})

describe('import_event_schedule：apply=true 应用变更', () => {
  it('调用 applyScheduleDiff 并返回 applied=true + applyResult', async () => {
    const result = await scheduleImportTool.execute({
      eventId: 'evt-1',
      filePath: '/a.xlsx',
      apply: true
    })
    expect(mockApplyDiff).toHaveBeenCalledTimes(1)
    expect(result.applied).toBe(true)
    expect(result.applyResult).toEqual(APPLY_RESULT)
  })

  it('ops.create 会落到 matchRepo.create（写库接线正确）', async () => {
    // 捕获 applyScheduleDiff 的 context，手动触发 ops.create 验证写库接线
    let capturedCtx: { ops?: { create: (d: never) => void } } = {}
    mockApplyDiff.mockImplementation((_preview, ctx: { ops?: { create: (d: never) => void } }) => {
      capturedCtx = ctx
      return APPLY_RESULT
    })
    await scheduleImportTool.execute({ eventId: 'evt-1', filePath: '/a.xlsx', apply: true })
    expect(capturedCtx.ops).toBeDefined()
    capturedCtx.ops!.create({} as never)
    expect(mockMatchCreate).toHaveBeenCalled()
  })
})