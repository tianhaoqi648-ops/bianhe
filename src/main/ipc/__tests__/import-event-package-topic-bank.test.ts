// ============================================================
// import-event-package-topic-bank.test.ts — 赛事包导入恢复题库（T7）
//
// 覆盖 IMPORT_EVENT_PACKAGE 中「恢复赛事题库」的纯逻辑接线：
//   - 按包内定义 topicGroups 幂等创建被引用的缺失题库（ensureGroupById）
//   - 恢复赛事→题库绑定（bindEventGroups）
//   - 恢复轮次→题库绑定（bindRoundGroups，group_id 映射到新轮次）
//   - 恢复题库成员（addTopicsToGroup，仅 topic 已在库内者关联）
//   - 无定义/不可恢复的题库组不绑定（避免外键违约）
//
// Mock 策略：mock ipcMain.handle 捕获 handler + mock 各 repo + mock fs 读包。
//   getDb().prepare('SELECT id FROM topics') 返回候选 topic，模拟库内已有辩题。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

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
    mockReadFile: vi.fn(),
    mockListEvents: vi.fn(),
    mockCreateEvent: vi.fn(),
    mockCreateGroup: vi.fn(),
    mockCreateTeam: vi.fn(),
    mockAssignTeamToGroup: vi.fn(),
    mockCreateRound: vi.fn(),
    mockCreateSession: vi.fn(),
    mockAddTeamHistory: vi.fn(),
    mockEnsureGroupById: vi.fn(),
    mockBindEventGroups: vi.fn(),
    mockBindRoundGroups: vi.fn(),
    mockAddTopicsToGroup: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.mockHandle }
}))

// import.ipc 在模块顶层还 import 了 readFile，需一起 mock
vi.mock('fs/promises', () => ({
  readFile: mocks.mockReadFile
}))

vi.mock('../../services/import-engine', () => ({
  parseFile: vi.fn(),
  applyFieldMapping: vi.fn()
}))

vi.mock('../../services/dedup-engine', () => ({
  findDuplicates: vi.fn()
}))

vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: { listTopics: vi.fn(), createMany: vi.fn() }
}))

vi.mock('../../db/repository/topic-group.repo', () => ({
  topicGroupRepo: {
    addTopicsToGroup: mocks.mockAddTopicsToGroup,
    ensureTopicsInDefaultGroup: vi.fn(),
    ensureGroupById: mocks.mockEnsureGroupById,
    bindEventGroups: mocks.mockBindEventGroups,
    bindRoundGroups: mocks.mockBindRoundGroups,
    getDefault: vi.fn(() => ({ id: 'default-group', name: '默认题库', isDefault: true, created_at: '2026-01-01T00:00:00.000Z' }))
  }
}))

vi.mock('../../db/repository/import-batch.repo', () => ({
  importBatchRepo: { createBatch: vi.fn(), updateBatchStats: vi.fn(), deleteBatch: vi.fn() }
}))

vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: { addLog: vi.fn() }
}))

vi.mock('../../db/repository/event.repo', () => ({
  eventRepo: {
    listEvents: mocks.mockListEvents,
    createEvent: mocks.mockCreateEvent,
    createGroup: mocks.mockCreateGroup,
    createTeam: mocks.mockCreateTeam,
    assignTeamToGroup: mocks.mockAssignTeamToGroup,
    createRound: mocks.mockCreateRound,
    addTeamHistory: mocks.mockAddTeamHistory,
    deleteEvent: vi.fn()
  }
}))

vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: { createSession: mocks.mockCreateSession }
}))

vi.mock('../../db/index', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      // 库内已有辩题集合：topic-1 / topic-2
      if (sql.includes('FROM topics')) {
        return { all: () => [{ id: 'topic-1' }, { id: 'topic-2' }] }
      }
      return { all: () => [], get: () => undefined, run: () => ({ changes: 1 }) }
    },
    transaction: (fn: () => unknown) => () => fn()
  })
}))

vi.mock('../../services/candidate-service', () => ({
  addCandidateValue: vi.fn()
}))

import { IPC_CHANNELS } from '../../../shared/types'
import { registerImportIpc } from '../import.ipc'

const PACKAGE_JSON = {
  event: { id: 'evt-old', name: '赛事A', start_date: null, end_date: null, status: 'active' },
  rounds: [{ id: 'r-old', event_id: 'evt-old', name: '小组赛', round_number: 1 }],
  teams: [],
  groups: [],
  teamHistory: [],
  drawSessions: [],
  eventTopicGroupIds: ['default-group', 'grpA'],
  roundTopicGroupIds: { 'r-old': ['grpA', 'grpB'] },
  topicGroups: [
    { id: 'default-group', name: '默认题库', is_default: 1, created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'grpA', name: 'A库', is_default: 0, created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'grpB', name: 'B库', is_default: 0, created_at: '2026-01-01T00:00:00.000Z' }
  ],
  topicGroupItems: [
    { group_id: 'grpA', topic_id: 'topic-1' },
    { group_id: 'grpA', topic_id: 'topic-missing' }, // 库内无此 topic → 跳过
    { group_id: 'grpB', topic_id: 'topic-2' },
    { group_id: 'unknown-group', topic_id: 'topic-1' } // 题库无定义、不可恢复 → 跳过
  ]
}

async function importPackage(strategy: string): Promise<{ data: any }> {
  const handler = mocks.getHandler(IPC_CHANNELS.IMPORT_EVENT_PACKAGE)
  if (!handler) throw new Error('IMPORT_EVENT_PACKAGE handler not registered')
  const req = { filePath: '/tmp/pkg.json', conflictStrategy: strategy }
  const res = (await handler(undefined, req)) as { data: any }
  if (!res.data) throw new Error('import failed')
  return res
}

beforeEach(() => {
  mocks.clearHandlers()
  vi.clearAllMocks()
  registerImportIpc()

  mocks.mockReadFile.mockResolvedValue(JSON.stringify(PACKAGE_JSON))
  mocks.mockListEvents.mockReturnValue({ items: [], total: 0 })
  mocks.mockCreateEvent.mockReturnValue({ id: 'new-event-id', name: '赛事A' })
  mocks.mockCreateRound.mockReturnValue({ id: 'new-round-id' })
  mocks.mockEnsureGroupById.mockImplementation((id: string) => ({ id }))
  mocks.mockBindEventGroups.mockReturnValue(1)
  mocks.mockBindRoundGroups.mockReturnValue(1)
  mocks.mockAddTopicsToGroup.mockReturnValue(1)
})

describe('赛事包导入恢复题库（T7）', () => {
  it('幂等创建缺失题库、恢复赛事/轮次绑定、仅关联库内已存在的成员', async () => {
    const { data } = await importPackage('rename')

    // 三个被引用题库（default-group/grpA/grpB）均按定义幂等创建
    expect(mocks.mockEnsureGroupById).toHaveBeenCalledTimes(3)
    expect(mocks.mockEnsureGroupById).toHaveBeenCalledWith('default-group', '默认题库', true, '2026-01-01T00:00:00.000Z')
    expect(mocks.mockEnsureGroupById).toHaveBeenCalledWith('grpA', 'A库', false, '2026-01-01T00:00:00.000Z')
    expect(mocks.mockEnsureGroupById).toHaveBeenCalledWith('grpB', 'B库', false, '2026-01-01T00:00:00.000Z')

    // 赛事绑定：new-event-id 绑定到 default-group + grpA
    expect(mocks.mockBindEventGroups).toHaveBeenCalledWith('new-event-id', ['default-group', 'grpA'])

    // 轮次绑定：映射到 new-round-id，绑定 grpA + grpB
    expect(mocks.mockBindRoundGroups).toHaveBeenCalledWith('new-round-id', ['grpA', 'grpB'])

    // 成员：仅库内已有的 topic；不可恢复的组被跳过
    expect(mocks.mockAddTopicsToGroup).toHaveBeenCalledTimes(2)
    expect(mocks.mockAddTopicsToGroup).toHaveBeenCalledWith('grpA', ['topic-1'])
    expect(mocks.mockAddTopicsToGroup).toHaveBeenCalledWith('grpB', ['topic-2'])

    expect(data.eventId).toBe('new-event-id')
  })

  it('包内不含题库字段时静默跳过，不破坏既有导入', async () => {
    mocks.mockReadFile.mockResolvedValue(
      JSON.stringify({
        event: { id: 'evt-old', name: '赛事B' },
        rounds: [],
        teams: [],
        groups: [],
        teamHistory: [],
        drawSessions: []
      })
    )

    const { data } = await importPackage('rename')

    expect(mocks.mockEnsureGroupById).not.toHaveBeenCalled()
    // createEvent 仍会为默认题库做一次绑定（Governance-6：创建即绑定默认题库）；
    // 但包的题库恢复逻辑被跳过，故以下包驱动绑定不应发生
    expect(mocks.mockBindEventGroups).toHaveBeenCalledTimes(1)
    expect(mocks.mockBindRoundGroups).not.toHaveBeenCalled()
    expect(mocks.mockAddTopicsToGroup).not.toHaveBeenCalled()
    expect(data.eventId).toBe('new-event-id')
    expect(data.roundCount).toBe(0)
  })
})