// ============================================================
// export-event-package-topic-bank.test.ts — 赛事包导出携带题库（T7）
//
// 覆盖 EXPORT_EVENT_PACKAGE 中「赛事题库随包导出」的纯逻辑接线：
//   - 包内携带 eventTopicGroupIds（赛事绑定的题库 id）
//   - 包内携带 roundTopicGroupIds（轮次→题库绑定，roundId -> groupIds）
//   - 包内携带 topicGroups（被引用题库定义，含 is_default/created_at）
//   - 包内携带 topicGroupItems（被引用题库成员）
//   - count 统计包含题库三部分
//
// Mock 策略：与 import-group-association.test.ts 一致——
//   mock ipcMain.handle 捕获 handler + mock 各 repo + mock dialog/writeFile。
//   只隔离导出 handler，验证打包结构与写盘 JSON 内容。
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
    mockGetEventById: vi.fn(),
    mockListRoundsByEvent: vi.fn(),
    mockListTeamsByEvent: vi.fn(),
    mockListGroupsByEvent: vi.fn(), // team_groups
    mockListTeamHistoryByEvent: vi.fn(),
    mockListSessions: vi.fn(),
    mockListGroupsByEvent2: vi.fn(), // topicGroupRepo.listGroupsByEvent
    mockListGroupsByRound: vi.fn(),
    mockListTopicIdsByGroup: vi.fn(),
    mockShowSaveDialog: vi.fn(),
    mockWriteFile: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.mockHandle },
  dialog: { showSaveDialog: mocks.mockShowSaveDialog },
  BrowserWindow: class {}
}))

vi.mock('fs/promises', () => ({
  writeFile: mocks.mockWriteFile
}))

vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: { listTopics: vi.fn() }
}))

vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: { listSessions: mocks.mockListSessions }
}))

vi.mock('../../db/repository/event.repo', () => ({
  eventRepo: {
    getEventById: mocks.mockGetEventById,
    listRoundsByEvent: mocks.mockListRoundsByEvent,
    listTeamsByEvent: mocks.mockListTeamsByEvent,
    listGroupsByEvent: mocks.mockListGroupsByEvent,
    listTeamHistoryByEvent: mocks.mockListTeamHistoryByEvent,
    getTeamById: vi.fn()
  }
}))

vi.mock('../../db/repository/topic-group.repo', () => ({
  topicGroupRepo: {
    listGroupsByEvent: mocks.mockListGroupsByEvent2,
    listGroupsByRound: mocks.mockListGroupsByRound,
    listTopicIdsByGroup: mocks.mockListTopicIdsByGroup
  }
}))

vi.mock('../utils', () => ({
  getActiveWindow: vi.fn(() => ({}))
}))

import { IPC_CHANNELS } from '../../../shared/types'
import { registerExportIpc } from '../export.ipc'

function makeGroup(id: string, name: string, isDefault = false) {
  return { id, name, isDefault, createdAt: '2026-01-01T00:00:00.000Z' }
}

async function exportPackage(req: Record<string, unknown>): Promise<{ data: any; pkg: any }> {
  const handler = mocks.getHandler(IPC_CHANNELS.EXPORT_EVENT_PACKAGE)
  if (!handler) throw new Error('EXPORT_EVENT_PACKAGE handler not registered')
  const res = (await handler(undefined, req)) as { data: { filePath: string; count: number }; error?: string }
  if (!res.data) throw new Error('export failed: ' + (res.error ?? 'no data'))
  const pkg = JSON.parse(mocks.mockWriteFile.mock.calls[0][1] as string)
  return { data: res.data, pkg }
}

beforeEach(() => {
  mocks.clearHandlers()
  vi.clearAllMocks()
  registerExportIpc()

  mocks.mockGetEventById.mockReturnValue({ id: 'evt1', name: '测试赛事' })
  mocks.mockListRoundsByEvent.mockReturnValue([{ id: 'r1', event_id: 'evt1' }])
  mocks.mockListTeamsByEvent.mockReturnValue([])
  mocks.mockListGroupsByEvent.mockReturnValue([])
  mocks.mockListTeamHistoryByEvent.mockReturnValue([])
  mocks.mockListSessions.mockReturnValue({ items: [{ id: 's1' }], total: 1 })
  mocks.mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/event.json' })
  mocks.mockWriteFile.mockResolvedValue(undefined)
})

describe('赛事包导出携带题库（T7）', () => {
  it('包内包含赛事绑定/轮次绑定/题组定义/题组成员', async () => {
    // 事件绑定了 默认题库 + A 库
    mocks.mockListGroupsByEvent2.mockReturnValue([
      makeGroup('default-group', '默认题库', true),
      makeGroup('grpA', 'A 库')
    ])
    // 轮次 r1 绑定 A 库 + B 库
    mocks.mockListGroupsByRound.mockImplementation((roundId: string) => {
      if (roundId === 'r1') return [makeGroup('grpA', 'A 库'), makeGroup('grpB', 'B 库')]
      return []
    })
    // 成员
    mocks.mockListTopicIdsByGroup.mockImplementation((gid: string) => {
      if (gid === 'grpA') return ['topic-1', 'topic-2']
      if (gid === 'grpB') return ['topic-3']
      if (gid === 'default-group') return ['topic-1']
      return []
    })

    const { pkg } = await exportPackage({ eventId: 'evt1' })

    // 赛事绑定题库 id
    expect(pkg.eventTopicGroupIds).toEqual(['default-group', 'grpA'])
    // 轮次绑定
    expect(pkg.roundTopicGroupIds).toEqual({ r1: ['grpA', 'grpB'] })
    // 被引用题库定义（default-group + grpA + grpB）
    expect(pkg.topicGroups).toHaveLength(3)
    const defaults = pkg.topicGroups.filter((g: any) => g.id === 'default-group')
    expect(defaults[0].is_default).toBe(1)
    const grpB = pkg.topicGroups.find((g: any) => g.id === 'grpB')
    expect(grpB.name).toBe('B 库')
    // 成员（default-group + grpA + grpB 三个库）
    expect(pkg.topicGroupItems).toEqual(
      expect.arrayContaining([
        { group_id: 'default-group', topic_id: 'topic-1' },
        { group_id: 'grpA', topic_id: 'topic-2' },
        { group_id: 'grpB', topic_id: 'topic-3' }
      ])
    )
    expect(pkg.topicGroupItems).toHaveLength(4)
    // listGroupsByEvent（赛事绑定）与 listGroupsByRound（轮次绑定）各查询一次
    expect(mocks.mockListGroupsByEvent2).toHaveBeenCalledWith('evt1')
    expect(mocks.mockListGroupsByRound).toHaveBeenCalledWith('r1')
  })

  it('赛事无任何题库绑定时包内含空数组且 count 不含题库', async () => {
    mocks.mockListGroupsByEvent2.mockReturnValue([])
    mocks.mockListGroupsByRound.mockReturnValue([])
    mocks.mockListTopicIdsByGroup.mockReturnValue([])

    const { data, pkg } = await exportPackage({ eventId: 'evt1' })

    expect(pkg.eventTopicGroupIds).toEqual([])
    expect(pkg.roundTopicGroupIds).toEqual({})
    expect(pkg.topicGroups).toEqual([])
    expect(pkg.topicGroupItems).toEqual([])
    // count = 1(event) + 1(round) + 1(session)，题库三部分为空不叠加
    expect(data.count).toBe(3)
  })
})