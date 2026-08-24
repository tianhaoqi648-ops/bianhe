// ============================================================
// topic-group.ipc.test.ts — 题组（题库）IPC 桥接测试
//
// 覆盖 registerTopicGroupIpc 注册的全部通道（mock topicGroupRepo）：
//   - handler 注册：每个 IPC_CHANNELS 都有对应 handle
//   - 参数校验：缺失/非法参数 → ApiResponse.error（不调用 repo）
//   - 数据路由：合法输入 → 正确调用 repo 并透传返回值
//   - 错误兜底：repo 抛错（如删除默认题库）→ ApiResponse.error
//
// Mock 策略：mock electron.ipcMain.handle 捕获 handler，mock topicGroupRepo 隔离数据层。
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
    mockList: vi.fn(),
    mockCreateGroup: vi.fn(),
    mockRename: vi.fn(),
    mockDelete: vi.fn(),
    mockGetDefault: vi.fn(),
    mockListTopicsByGroup: vi.fn(),
    mockAddTopicsToGroup: vi.fn(),
    mockRemoveTopicsFromGroup: vi.fn(),
    mockListGroupsByEvent: vi.fn(),
    mockBindEventGroups: vi.fn(),
    mockUnbindEventGroup: vi.fn(),
    mockBatchAddToGroups: vi.fn(),
    mockBatchRemoveFromGroup: vi.fn(),
    mockCopyGroupToGroup: vi.fn(),
    mockMoveGroupToGroup: vi.fn(),
    // Governance-8.3：bind/unbind 已改走 withUndoLog，mock 主进程 getDb + undoLogRepo
    mockCreateLog: vi.fn(() => 'log-1'),
    mockDb: {
      prepare: vi.fn(() => ({ run: () => ({ changes: 1 }), get: () => undefined, all: () => [] })),
      transaction: vi.fn()
    }
  }
})

// withUndoLog 事务桩：同步执行回调
mocks.mockDb.transaction.mockImplementation((fn: () => unknown) => {
  const out = fn()
  return () => out
})

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.mockHandle }
}))

vi.mock('../../db/repository/topic-group.repo', () => ({
  topicGroupRepo: {
    list: mocks.mockList,
    createGroup: mocks.mockCreateGroup,
    rename: mocks.mockRename,
    delete: mocks.mockDelete,
    getDefault: mocks.mockGetDefault,
    listTopicsByGroup: mocks.mockListTopicsByGroup,
    addTopicsToGroup: mocks.mockAddTopicsToGroup,
    removeTopicsFromGroup: mocks.mockRemoveTopicsFromGroup,
    listGroupsByEvent: mocks.mockListGroupsByEvent,
    bindEventGroups: mocks.mockBindEventGroups,
    unbindEventGroup: mocks.mockUnbindEventGroup,
    batchAddToGroups: mocks.mockBatchAddToGroups,
    batchRemoveFromGroup: mocks.mockBatchRemoveFromGroup,
    copyGroupToGroup: mocks.mockCopyGroupToGroup,
    moveGroupToGroup: mocks.mockMoveGroupToGroup
  }
}))

// Governance-8.3：withUndoLog 依赖 getDb + undoLogRepo.createLog
vi.mock('../../db', () => ({
  getDb: () => mocks.mockDb
}))

vi.mock('../../db/repository/undo-log.repo', () => ({
  undoLogRepo: { createLog: mocks.mockCreateLog }
}))

import { IPC_CHANNELS } from '../../../shared/types'
import { registerTopicGroupIpc } from '../topic-group.ipc'

// ============================================================
// 测试用例
// ============================================================

const CHANNELS = [
  IPC_CHANNELS.GROUP_TOPIC_LIST,
  IPC_CHANNELS.GROUP_TOPIC_CREATE,
  IPC_CHANNELS.GROUP_TOPIC_RENAME,
  IPC_CHANNELS.GROUP_TOPIC_DELETE,
  IPC_CHANNELS.GROUP_TOPIC_GET_DEFAULT,
  IPC_CHANNELS.GROUP_TOPIC_LIST_TOPICS,
  IPC_CHANNELS.GROUP_TOPIC_ADD_TOPICS,
  IPC_CHANNELS.GROUP_TOPIC_REMOVE_TOPICS,
  IPC_CHANNELS.GROUP_TOPIC_LIST_BY_EVENT,
  IPC_CHANNELS.GROUP_TOPIC_BIND_EVENT,
  IPC_CHANNELS.GROUP_TOPIC_UNBIND_EVENT,
  IPC_CHANNELS.GROUP_TOPIC_BATCH_ADD,
  IPC_CHANNELS.GROUP_TOPIC_BATCH_REMOVE,
  IPC_CHANNELS.GROUP_TOPIC_COPY_GROUP,
  IPC_CHANNELS.GROUP_TOPIC_MOVE_GROUP
]

beforeEach(() => {
  mocks.clearHandlers()
  vi.clearAllMocks()
  registerTopicGroupIpc()
})

/** 调用指定通道的 handler（handler 为同步返回 ApiResponse） */
function call(channel: string, ...args: unknown[]): {
  success: boolean
  data?: unknown
  error?: string
} {
  const handler = mocks.getHandler(channel)
  if (!handler) throw new Error(`handler not registered for channel ${channel}`)
  return handler(undefined, ...args) as {
    success: boolean
    data?: unknown
    error?: string
  }
}

describe('registerTopicGroupIpc：通道注册', () => {
  it('应注册全部题组通道', () => {
    for (const ch of CHANNELS) {
      expect(mocks.getHandler(ch)).toBeTypeOf('function')
    }
  })
})

describe('题组：list / getDefault', () => {
  it('list 透传 repo.list', () => {
    mocks.mockList.mockReturnValue([{ id: 'default-group', name: '默认题库', isDefault: true }])
    const res = call(IPC_CHANNELS.GROUP_TOPIC_LIST)
    expect(res).toEqual({ success: true, data: [{ id: 'default-group', name: '默认题库', isDefault: true }] })
    expect(mocks.mockList).toHaveBeenCalled()
  })

  it('getDefault 透传 repo.getDefault', () => {
    mocks.mockGetDefault.mockReturnValue({ id: 'default-group', name: '默认题库', isDefault: true })
    const res = call(IPC_CHANNELS.GROUP_TOPIC_GET_DEFAULT)
    expect(res.success).toBe(true)
    expect(res.data).toMatchObject({ id: 'default-group', isDefault: true })
  })
})

describe('题组：createGroup / rename / delete', () => {
  it('createGroup 合法输入 → 调用 repo.createGroup 并透传', () => {
    mocks.mockCreateGroup.mockReturnValue({ id: 'g1', name: '备赛题库', isDefault: false })
    const res = call(IPC_CHANNELS.GROUP_TOPIC_CREATE, { name: '  备赛题库  ' })
    expect(res.success).toBe(true)
    expect(res.data).toMatchObject({ id: 'g1', name: '备赛题库' })
    // trim 后传给 repo
    expect(mocks.mockCreateGroup).toHaveBeenCalledWith('备赛题库')
  })

  it('createGroup 空 name → error 且不调用 repo', () => {
    const res = call(IPC_CHANNELS.GROUP_TOPIC_CREATE, { name: '   ' })
    expect(res.success).toBe(false)
    expect(mocks.mockCreateGroup).not.toHaveBeenCalled()
  })

  it('rename 合法输入 → 调用 repo.rename；不存在时返回 error', () => {
    mocks.mockRename.mockReturnValue({ id: 'g1', name: '新名', isDefault: false })
    expect(call(IPC_CHANNELS.GROUP_TOPIC_RENAME, { id: 'g1', name: '新名' }).success).toBe(true)

    mocks.mockRename.mockReturnValue(undefined)
    const res = call(IPC_CHANNELS.GROUP_TOPIC_RENAME, { id: 'missing', name: 'x' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('不存在')
  })

  it('delete 删除默认题库 → repo 抛错转为 ApiResponse.error', () => {
    mocks.mockDelete.mockImplementation(() => {
      throw new Error('不能删除默认题库')
    })
    const res = call(IPC_CHANNELS.GROUP_TOPIC_DELETE, 'default-group')
    expect(res.success).toBe(false)
    expect(res.error).toContain('不能删除默认题库')
  })

  it('delete 普通题组 → 透传 repo.delete 的 boolean', () => {
    mocks.mockDelete.mockReturnValue(true)
    expect(call(IPC_CHANNELS.GROUP_TOPIC_DELETE, 'g1')).toEqual({ success: true, data: true })
  })

  it('delete 空 id → error', () => {
    const res = call(IPC_CHANNELS.GROUP_TOPIC_DELETE, '')
    expect(res.success).toBe(false)
    expect(mocks.mockDelete).not.toHaveBeenCalled()
  })
})

describe('成员：listTopicsByGroup / add / remove', () => {
  it('listTopicsByGroup 透传 repo', () => {
    mocks.mockListTopicsByGroup.mockReturnValue([{ id: 't1', title: '题1', status: 'active' }])
    const res = call(IPC_CHANNELS.GROUP_TOPIC_LIST_TOPICS, 'g1')
    expect(res.success).toBe(true)
    expect(res.data).toHaveLength(1)
    expect(mocks.mockListTopicsByGroup).toHaveBeenCalledWith('g1')
  })

  it('addTopicsToGroup 可多选 → 透传 repo，返回新增数', () => {
    mocks.mockAddTopicsToGroup.mockReturnValue(3)
    const res = call(IPC_CHANNELS.GROUP_TOPIC_ADD_TOPICS, { groupId: 'g1', topicIds: ['t1', 't2', 't3'] })
    expect(res).toEqual({ success: true, data: 3 })
    expect(mocks.mockAddTopicsToGroup).toHaveBeenCalledWith('g1', ['t1', 't2', 't3'])
  })

  it('addTopicsToGroup 空数组 → no-op，调用 repo 返回 0', () => {
    mocks.mockAddTopicsToGroup.mockReturnValue(0)
    const res = call(IPC_CHANNELS.GROUP_TOPIC_ADD_TOPICS, { groupId: 'g1', topicIds: [] })
    expect(res).toEqual({ success: true, data: 0 })
    expect(mocks.mockAddTopicsToGroup).toHaveBeenCalledWith('g1', [])
  })

  it('removeTopicsFromGroup 透传 repo', () => {
    mocks.mockRemoveTopicsFromGroup.mockReturnValue(2)
    const res = call(IPC_CHANNELS.GROUP_TOPIC_REMOVE_TOPICS, { groupId: 'g1', topicIds: ['t1', 't2'] })
    expect(res).toEqual({ success: true, data: 2 })
    expect(mocks.mockRemoveTopicsFromGroup).toHaveBeenCalledWith('g1', ['t1', 't2'])
  })
})

describe('赛事绑定：listGroupsByEvent / bind / unbind', () => {
  it('listGroupsByEvent 透传 repo', () => {
    mocks.mockListGroupsByEvent.mockReturnValue([{ id: 'g1', name: '组A', isDefault: false }])
    const res = call(IPC_CHANNELS.GROUP_TOPIC_LIST_BY_EVENT, 'e1')
    expect(res.success).toBe(true)
    expect(res.data).toHaveLength(1)
    expect(mocks.mockListGroupsByEvent).toHaveBeenCalledWith('e1')
  })

  it('bindEventGroups 可多选 → 透传 repo，返回新增数', () => {
    mocks.mockListGroupsByEvent.mockReturnValue([])
    mocks.mockBindEventGroups.mockReturnValue(2)
    const res = call(IPC_CHANNELS.GROUP_TOPIC_BIND_EVENT, { eventId: 'e1', groupIds: ['g1', 'g2'] })
    expect(res.success).toBe(true)
    expect(res.data).toBe(2)
    expect(mocks.mockBindEventGroups).toHaveBeenCalledWith('e1', ['g1', 'g2'])
  })

  it('bindEventGroups 空 groupIds → no-op，调用 repo 返回 0', () => {
    mocks.mockListGroupsByEvent.mockReturnValue([])
    mocks.mockBindEventGroups.mockReturnValue(0)
    const res = call(IPC_CHANNELS.GROUP_TOPIC_BIND_EVENT, { eventId: 'e1', groupIds: [] })
    expect(res.success).toBe(true)
    expect(res.data).toBe(0)
    expect(mocks.mockBindEventGroups).toHaveBeenCalledWith('e1', [])
  })

  it('unbindEventGroup 透传 repo，返回 boolean', () => {
    mocks.mockListGroupsByEvent.mockReturnValue([])
    mocks.mockUnbindEventGroup.mockReturnValue(true)
    const res = call(IPC_CHANNELS.GROUP_TOPIC_UNBIND_EVENT, { eventId: 'e1', groupId: 'g1' })
    expect(res.success).toBe(true)
    expect(res.data).toBe(true)
    expect(mocks.mockUnbindEventGroup).toHaveBeenCalledWith('e1', 'g1')
  })
})

describe('批量增减 / 整体复制 / 整体移动（T1）', () => {
  it('batchAddToGroups 透传 repo，返回新增数', () => {
    mocks.mockBatchAddToGroups.mockReturnValue(3)
    const res = call(IPC_CHANNELS.GROUP_TOPIC_BATCH_ADD, {
      topicIds: ['t1', 't2'],
      groupIds: ['g1', 'g2']
    })
    expect(res).toEqual({ success: true, data: 3 })
    expect(mocks.mockBatchAddToGroups).toHaveBeenCalledWith(['t1', 't2'], ['g1', 'g2'])
  })

  it('batchAddToGroups 空 topicIds/groupIds 数组 → 仍透传 repo（no-op 由 repo 保证）', () => {
    mocks.mockBatchAddToGroups.mockReturnValue(0)
    expect(call(IPC_CHANNELS.GROUP_TOPIC_BATCH_ADD, { topicIds: [], groupIds: ['g1'] })).toEqual({
      success: true,
      data: 0
    })
    expect(call(IPC_CHANNELS.GROUP_TOPIC_BATCH_ADD, { topicIds: ['t1'], groupIds: [] })).toEqual({
      success: true,
      data: 0
    })
  })

  it('batchAddToGroups 非法参数 → error 且不调用 repo', () => {
    expect(call(IPC_CHANNELS.GROUP_TOPIC_BATCH_ADD, { topicIds: 'x', groupIds: ['g1'] }).success).toBe(false)
    expect(call(IPC_CHANNELS.GROUP_TOPIC_BATCH_ADD, undefined).success).toBe(false)
    expect(mocks.mockBatchAddToGroups).not.toHaveBeenCalled()
  })

  it('batchRemoveFromGroup 透传 repo，返回移除数', () => {
    mocks.mockBatchRemoveFromGroup.mockReturnValue(2)
    const res = call(IPC_CHANNELS.GROUP_TOPIC_BATCH_REMOVE, { groupId: 'g1', topicIds: ['t1', 't2'] })
    expect(res).toEqual({ success: true, data: 2 })
    expect(mocks.mockBatchRemoveFromGroup).toHaveBeenCalledWith('g1', ['t1', 't2'])
  })

  it('batchRemoveFromGroup 空 groupId → error 且不调用 repo', () => {
    const res = call(IPC_CHANNELS.GROUP_TOPIC_BATCH_REMOVE, { groupId: '', topicIds: ['t1'] })
    expect(res.success).toBe(false)
    expect(mocks.mockBatchRemoveFromGroup).not.toHaveBeenCalled()
  })

  it('copyGroupToGroup 透传 repo，返回各目标新增数', () => {
    mocks.mockCopyGroupToGroup.mockReturnValue([
      { groupId: 'g1', added: 1 },
      { groupId: 'g2', added: 2 }
    ])
    const res = call(IPC_CHANNELS.GROUP_TOPIC_COPY_GROUP, {
      srcGroupId: 'src',
      targetGroupIds: ['g1', 'g2']
    })
    expect(res).toEqual({
      success: true,
      data: [
        { groupId: 'g1', added: 1 },
        { groupId: 'g2', added: 2 }
      ]
    })
    expect(mocks.mockCopyGroupToGroup).toHaveBeenCalledWith('src', ['g1', 'g2'])
  })

  it('copyGroupToGroup 非法参数 → error 且不调用 repo', () => {
    expect(call(IPC_CHANNELS.GROUP_TOPIC_COPY_GROUP, { srcGroupId: '', targetGroupIds: ['g1'] }).success).toBe(false)
    expect(call(IPC_CHANNELS.GROUP_TOPIC_COPY_GROUP, { srcGroupId: 'src', targetGroupIds: 'g1' }).success).toBe(false)
    expect(mocks.mockCopyGroupToGroup).not.toHaveBeenCalled()
  })

  it('moveGroupToGroup 透传 repo，返回各目标新增数', () => {
    mocks.mockMoveGroupToGroup.mockReturnValue([{ groupId: 'g1', added: 2 }])
    const res = call(IPC_CHANNELS.GROUP_TOPIC_MOVE_GROUP, {
      srcGroupId: 'src',
      targetGroupIds: ['g1']
    })
    expect(res).toEqual({ success: true, data: [{ groupId: 'g1', added: 2 }] })
    expect(mocks.mockMoveGroupToGroup).toHaveBeenCalledWith('src', ['g1'])
  })

  it('moveGroupToGroup 非法参数 → error 且不调用 repo', () => {
    expect(call(IPC_CHANNELS.GROUP_TOPIC_MOVE_GROUP, { srcGroupId: '', targetGroupIds: ['g1'] }).success).toBe(false)
    expect(call(IPC_CHANNELS.GROUP_TOPIC_MOVE_GROUP, undefined).success).toBe(false)
    expect(mocks.mockMoveGroupToGroup).not.toHaveBeenCalled()
  })
})