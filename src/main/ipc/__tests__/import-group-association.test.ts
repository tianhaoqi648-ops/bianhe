// ============================================================
// import-group-association.test.ts — 导入目标题组关联逻辑（赛事题库 T2）
//
// 覆盖 IMPORT_EXECUTE 中「新题关联题组」的纯逻辑接线：
//   - 指定目标题组 groupIds（可多选）→ 每个目标题组各 add 一次
//   - 未指定 → 新题默认进「默认题库」（ensureTopicsInDefaultGroup）
//   - 无新题入库（createMany 空）→ 不触发题组关联
//
// Mock 策略：mock ipcMain.handle 捕获 handler + mock 各 repo，隔离数据层。
// checkDuplicates=false 跳过去重路径，聚焦题组关联分支。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// vi.hoisted：复用 mock 函数
// ============================================================

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    mockHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getHandler(channel: string) {
      return handlers.get(channel)
    },
    clearHandlers() {
      handlers.clear()
    },
    mockListTopics: vi.fn(),
    mockCreateMany: vi.fn(),
    mockCreateBatch: vi.fn(),
    mockUpdateBatchStats: vi.fn(),
    mockAddLog: vi.fn(),
    mockAddTopicsToGroup: vi.fn(),
    mockEnsureTopicsInDefaultGroup: vi.fn(),
    mockDeleteBatch: vi.fn()
  }
})

// ============================================================
// Mock 依赖（import.ipc.ts 的所有模块导入）
// ============================================================

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.mockHandle }
}))

vi.mock('../../services/import-engine', () => ({
  parseFile: vi.fn(),
  applyFieldMapping: vi.fn()
}))

vi.mock('../../services/dedup-engine', () => ({
  findDuplicates: vi.fn()
}))

vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: {
    listTopics: mocks.mockListTopics,
    createMany: mocks.mockCreateMany
  }
}))

vi.mock('../../db/repository/topic-group.repo', () => ({
  topicGroupRepo: {
    addTopicsToGroup: mocks.mockAddTopicsToGroup,
    ensureTopicsInDefaultGroup: mocks.mockEnsureTopicsInDefaultGroup
  }
}))

vi.mock('../../db/repository/import-batch.repo', () => ({
  importBatchRepo: {
    createBatch: mocks.mockCreateBatch,
    updateBatchStats: mocks.mockUpdateBatchStats,
    deleteBatch: mocks.mockDeleteBatch
  }
}))

vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: { addLog: mocks.mockAddLog }
}))

vi.mock('../../db/repository/event.repo', () => ({
  eventRepo: { listEvents: vi.fn(), createEvent: vi.fn(), createGroup: vi.fn(), createTeam: vi.fn(), createRound: vi.fn(), assignTeamToGroup: vi.fn(), addTeamHistory: vi.fn(), deleteEvent: vi.fn() }
}))

vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: { createSession: vi.fn() }
}))

vi.mock('../../db/index', () => ({
  getDb: () => ({
    prepare: vi.fn(),
    transaction: vi.fn()
  })
}))

vi.mock('../../services/candidate-service', () => ({
  addCandidateValue: vi.fn()
}))

import { IPC_CHANNELS } from '../../../shared/types'
import { registerImportIpc } from '../import.ipc'

// ============================================================
// 工具
// ============================================================

const BATCH = { id: 'batch-1', file_name: 'test.xlsx' }

beforeEach(() => {
  mocks.clearHandlers()
  vi.clearAllMocks()
  registerImportIpc()

  mocks.mockCreateBatch.mockReturnValue(BATCH)
  mocks.mockListTopics.mockReturnValue({ items: [], total: 0 })
  mocks.mockCreateMany.mockReturnValue([{ id: 't1' }, { id: 't2' }])
  mocks.mockUpdateBatchStats.mockReturnValue(undefined)
  mocks.mockAddLog.mockReturnValue(undefined)
})

async function executeImport(req: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const handler = mocks.getHandler(IPC_CHANNELS.IMPORT_EXECUTE)
  if (!handler) throw new Error('import:execute handler not registered')
  return (await handler(undefined, req)) as { success: boolean; data?: unknown; error?: string }
}

function baseReq(): Record<string, unknown> {
  return {
    topics: [{ title: '题A' }, { title: '题B' }],
    checkDuplicates: false,
    fileName: 'test.xlsx'
  }
}

// ============================================================
// 测试用例
// ============================================================

describe('导入目标题组关联（赛事题库 T2）', () => {
  it('指定 groupIds（多选）→ 每个目标题组各 add 一次，不进默认题库', async () => {
    const res = await executeImport({ ...baseReq(), groupIds: ['g1', 'g2'] })

    expect(res.success).toBe(true)
    expect(mocks.mockAddTopicsToGroup).toHaveBeenCalledTimes(2)
    expect(mocks.mockAddTopicsToGroup).toHaveBeenCalledWith('g1', ['t1', 't2'])
    expect(mocks.mockAddTopicsToGroup).toHaveBeenCalledWith('g2', ['t1', 't2'])
    expect(mocks.mockEnsureTopicsInDefaultGroup).not.toHaveBeenCalled()
  })

  it('未指定 groupIds → 新题默认进「默认题库」', async () => {
    const res = await executeImport(baseReq())

    expect(res.success).toBe(true)
    expect(mocks.mockEnsureTopicsInDefaultGroup).toHaveBeenCalledTimes(1)
    expect(mocks.mockEnsureTopicsInDefaultGroup).toHaveBeenCalledWith(['t1', 't2'])
    expect(mocks.mockAddTopicsToGroup).not.toHaveBeenCalled()
  })

  it('createMany 无新题入库 → 不触发任何题组关联', async () => {
    mocks.mockCreateMany.mockReturnValue([])

    const res = await executeImport(baseReq())

    expect(res.success).toBe(true)
    expect(mocks.mockEnsureTopicsInDefaultGroup).not.toHaveBeenCalled()
    expect(mocks.mockAddTopicsToGroup).not.toHaveBeenCalled()
  })

  it('T2：关联题组失败 → 成功返回但带 PARTIAL_FAILURE 警示（不阻断已成功部分）', async () => {
    mocks.mockAddTopicsToGroup.mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: topic_group_members')
    })

    const res = await executeImport({ ...baseReq(), groupIds: ['g1'] })
    const data = res.data as { imported: number; warnings?: string[] }

    // 主流程（数据入库）仍成功，不阻断 renderer 展示导入结果
    expect(res.success).toBe(true)
    expect((res as { appError?: { code: string } }).appError?.code).toBe('PARTIAL_FAILURE')
    // 部分失败已被反馈到 warnings
    expect(data.imported).toBe(2)
    expect(data.warnings).toBeDefined()
    expect(data.warnings!.length).toBe(1)
    expect(data.warnings![0]).toContain('关联题组失败')
    // 失败不再被静默吞掉，仍然记录了错误日志
  })
})