// ============================================================
// undo-service.test.ts — 撤销/重做服务单测（Task 4.5）
//
// 覆盖：
//   1. topic update 的 undo/redo 成对恢复（before/after 快照互逆）
//   2. 批量写入 undo：withUndoLog 记录正确列 → 还原 before（batchUpdate）
//   3. 新覆盖操作可撤销/重做：赛制(format)、赛事(event)、队伍(team)
//   4. 重启语义：clearUndoLogOnStartup 清空 undo_log 表
//
// 通过 mock getDb + 各 repository（与 smoke.test.ts 一致），
// 不依赖真实 better-sqlite3（其在 Node ABI 下不可加载）。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UndoLogEntry, Topic, Event, Team, DebateFormat } from '../../../shared/types'

// ---- vi.hoisted：在 vi.mock factory 之前定义共享的 mock 函数 ----
const { getDbMock, undoLogRepoMock, topicRepoMock, eventRepoMock, formatRepoMock } =
  vi.hoisted(() => {
    return {
      getDbMock: { prepare: vi.fn(), transaction: vi.fn() },
      undoLogRepoMock: {
        createLog: vi.fn(),
        getLatest: vi.fn(),
        getLatestRedoable: vi.fn(),
        getById: vi.fn(),
        markUndone: vi.fn(),
        clearUndone: vi.fn(),
        clearAll: vi.fn()
      },
      topicRepoMock: {
        updateTopic: vi.fn(),
        deleteTopic: vi.fn(),
        updateStatus: vi.fn(),
        updateWeight: vi.fn(),
        batchUpdateTopics: vi.fn()
      },
      eventRepoMock: {
        updateEvent: vi.fn(),
        updateTeam: vi.fn(),
        deleteEvent: vi.fn(),
        deleteTeam: vi.fn()
      },
      formatRepoMock: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        getById: vi.fn()
      }
    }
  })

// getDb().transaction 模拟 better-sqlite3：包装并同步执行回调
getDbMock.transaction.mockImplementation((fn: () => unknown) => () => fn())
// getDb().prepare 返回 run/get/all stub（applyXxx 走 raw insert/delete 时兜底）
getDbMock.prepare.mockImplementation((_sql: string) => ({
  run: () => ({ changes: 1 }),
  get: () => undefined,
  all: () => []
}))

vi.mock('../../db', () => ({
  getDb: () => getDbMock
}))

vi.mock('../../db/repository/undo-log.repo', () => ({
  undoLogRepo: undoLogRepoMock
}))

vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: topicRepoMock
}))

vi.mock('../../db/repository/event.repo', () => ({
  eventRepo: eventRepoMock
}))

vi.mock('../../db/repository/format.repo', () => ({
  formatRepo: formatRepoMock
}))

vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: {
    deleteSession: vi.fn(),
    getSessionById: vi.fn()
  }
}))

vi.mock('../custom-field-service', () => ({
  customFieldService: {
    deleteField: vi.fn(),
    updateField: vi.fn()
  }
}))

import {
  withUndoLog,
  executeUndo,
  executeRedo,
  clearUndoLogOnStartup,
  UNDO_ACTIONS
} from '../undo-service'

function makeTopic(id: string, title: string): Topic {
  return {
    id,
    title,
    type: '价值辩',
    domain: '科技伦理',
    difficulty: '入门级',
    source: null,
    source_type: '官方',
    tags: ['AI'],
    weight: 1,
    status: 'active',
    batch_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  }
}

function makeLog(overrides: Partial<UndoLogEntry>): UndoLogEntry {
  return {
    id: 'log-1',
    created_at: '2024-01-01T00:00:00.000Z',
    store_name: 'topic',
    action: 'update',
    target_type: 'topic',
    target_id: 't1',
    before_data: null,
    after_data: null,
    payload_size: 0,
    label: '测试',
    undone_at: null,
    ...overrides
  }
}

beforeEach(() => {
  for (const repo of [undoLogRepoMock, topicRepoMock, eventRepoMock, formatRepoMock]) {
    for (const fn of Object.values(repo)) {
      ;(fn as ReturnType<typeof vi.fn>).mockReset()
    }
  }
  undoLogRepoMock.createLog.mockReturnValue('log-1')
})

describe('topic update undo/redo 成对', () => {
  it('undo 用 before 覆盖，redo 用 after 覆盖', () => {
    const before = makeTopic('t1', '修改前题')
    const after = makeTopic('t1', '修改后题')
    undoLogRepoMock.getLatest.mockReturnValue(
      makeLog({ action: UNDO_ACTIONS.UPDATE, before_data: before, after_data: after })
    )
    topicRepoMock.updateTopic.mockReturnValue(after)

    const undoRes = executeUndo()
    expect(topicRepoMock.updateTopic).toHaveBeenCalledTimes(1)
    expect(topicRepoMock.updateTopic).toHaveBeenCalledWith('t1', {
      title: '修改前题',
      type: before.type,
      domain: before.domain,
      difficulty: before.difficulty,
      source: before.source,
      source_type: before.source_type,
      tags: before.tags,
      weight: before.weight,
      status: before.status,
      batch_id: before.batch_id,
      custom_data: null
    })
    expect(undoLogRepoMock.markUndone).toHaveBeenCalledWith('log-1')
    expect(undoRes.storeName).toBe('topic')

    // redo：重新应用 after
    undoLogRepoMock.getLatestRedoable.mockReturnValue(
      makeLog({
        id: 'log-1',
        action: UNDO_ACTIONS.UPDATE,
        before_data: before,
        after_data: after,
        undone_at: '2024-01-01T00:01:00.000Z'
      })
    )
    topicRepoMock.updateTopic.mockReset().mockReturnValue(before)

    const redoRes = executeRedo()
    expect(topicRepoMock.updateTopic).toHaveBeenCalledTimes(1)
    expect(topicRepoMock.updateTopic).toHaveBeenCalledWith('t1', {
      title: '修改后题',
      type: after.type,
      domain: after.domain,
      difficulty: after.difficulty,
      source: after.source,
      source_type: after.source_type,
      tags: after.tags,
      weight: after.weight,
      status: after.status,
      batch_id: after.batch_id,
      custom_data: null
    })
    expect(undoLogRepoMock.clearUndone).toHaveBeenCalledWith('log-1')
    expect(redoRes.storeName).toBe('topic')
  })
})

describe('批量写入 undo（withUndoLog + batchUpdate）', () => {
  it('withUndoLog 记录 store/action/target/before/after 到 undo_log', () => {
    const before = makeTopic('t1', '批量前')
    const after = makeTopic('t1', '批量后')
    const res = withUndoLog({
      storeName: 'topic',
      action: UNDO_ACTIONS.BATCH_UPDATE,
      targetType: 'topic',
      targetId: null,
      label: '批量编辑辩题',
      getBefore: () => ({ topics: [before] }),
      execute: () => ({ affectedCount: 1 }),
      getAfter: () => ({ topics: [after] })
    })

    expect(res.logId).toBe('log-1')
    expect(undoLogRepoMock.createLog).toHaveBeenCalledTimes(1)
    expect(undoLogRepoMock.createLog).toHaveBeenCalledWith({
      store_name: 'topic',
      action: 'batchUpdate',
      target_type: 'topic',
      target_id: null,
      before_data: { topics: [before] },
      after_data: { topics: [after] },
      label: '批量编辑辩题'
    })
  })

  it('payload 超限时抛错 → withUndoLog 返回 logId=null 但写操作仍提交', () => {
    undoLogRepoMock.createLog.mockImplementation(() => {
      throw new Error('[undoLog] payload too large: 2000000 bytes (limit 1048576)')
    })
    const res = withUndoLog({
      storeName: 'topic',
      action: UNDO_ACTIONS.BATCH_UPDATE,
      targetType: 'topic',
      targetId: null,
      label: '批量编辑辩题',
      getBefore: () => ({ topics: [] }),
      execute: () => ({ affectedCount: 1 }),
      getAfter: () => ({ topics: [] })
    })
    expect(res.logId).toBeNull()
    expect(res.result).toEqual({ affectedCount: 1 })
  })

  it('batchUpdate undo/redo 用 before/after 全量快照恢复', () => {
    const before = makeTopic('t1', '批量前')
    const after = makeTopic('t1', '批量后')
    const log = makeLog({
      action: UNDO_ACTIONS.BATCH_UPDATE,
      before_data: { topics: [before] },
      after_data: { topics: [after] }
    })

    undoLogRepoMock.getLatest.mockReturnValue(log)
    const undoRes = executeUndo()
    expect(topicRepoMock.updateTopic).toHaveBeenCalledWith('t1', {
      title: '批量前',
      type: before.type,
      domain: before.domain,
      difficulty: before.difficulty,
      source: before.source,
      source_type: before.source_type,
      tags: before.tags,
      weight: before.weight,
      status: before.status,
      batch_id: before.batch_id,
      custom_data: null
    })
    expect(undoRes.affectedCount).toBe(1)

    undoLogRepoMock.getLatestRedoable.mockReturnValue({ ...log, undone_at: 'x' })
    topicRepoMock.updateTopic.mockReset()
    executeRedo()
    expect(topicRepoMock.updateTopic).toHaveBeenCalledWith('t1', {
      title: '批量后',
      type: after.type,
      domain: after.domain,
      difficulty: after.difficulty,
      source: after.source,
      source_type: after.source_type,
      tags: after.tags,
      weight: after.weight,
      status: after.status,
      batch_id: after.batch_id,
      custom_data: null
    })
  })
})

describe('新覆盖操作：赛制 / 赛事 / 队伍', () => {
  it('format create undo 删除新建赛制', () => {
    const format: DebateFormat = {
      id: 'f1',
      name: '自定义赛制',
      description: null,
      isPreset: false,
      formatData: { stages: [], totalDurationMs: 0 },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    }
    undoLogRepoMock.getLatest.mockReturnValue(
      makeLog({
        store_name: 'format',
        action: UNDO_ACTIONS.CREATE,
        target_type: 'format',
        target_id: 'f1',
        before_data: null,
        after_data: format
      })
    )
    const res = executeUndo()
    expect(formatRepoMock.delete).toHaveBeenCalledWith('f1')
    expect(res.storeName).toBe('format')
  })

  it('format update undo/redo 恢复 before/after（赛制修改可撤销/重做）', () => {
    const before: DebateFormat = {
      id: 'f1', name: '旧赛制', description: null, isPreset: false,
      formatData: { stages: [], totalDurationMs: 0 }, createdAt: 'c', updatedAt: 'c'
    }
    const after: DebateFormat = {
      id: 'f1', name: '新赛制', description: '新描述', isPreset: false,
      formatData: {
        stages: [{
          id: 's', name: '立论', side: 'both', durationMs: 300000, bells: []
        }],
        totalDurationMs: 300000
      },
      createdAt: 'c', updatedAt: 'u'
    }
    const log = makeLog({
      store_name: 'format', action: UNDO_ACTIONS.UPDATE,
      target_type: 'format', target_id: 'f1',
      before_data: before, after_data: after
    })

    undoLogRepoMock.getLatest.mockReturnValue(log)
    const undoRes = executeUndo()
    expect(formatRepoMock.update).toHaveBeenCalledWith('f1', {
      name: '旧赛制', description: undefined, formatData: before.formatData
    })
    expect(undoRes.storeName).toBe('format')

    undoLogRepoMock.getLatestRedoable.mockReturnValue({ ...log, undone_at: 'x' })
    executeRedo()
    expect(formatRepoMock.update).toHaveBeenCalledWith('f1', {
      name: '新赛制', description: '新描述', formatData: after.formatData
    })
  })

  it('event update undo 恢复 before（赛事修改可撤销）', () => {
    const before: Event = {
      id: 'e1', name: '旧赛事', start_date: null, end_date: null,
      status: 'active', created_at: 'c', allow_repeat: 0
    }
    undoLogRepoMock.getLatest.mockReturnValue(
      makeLog({
        store_name: 'event', target_type: 'event', action: UNDO_ACTIONS.UPDATE,
        target_id: 'e1', before_data: before,
        after_data: { ...before, name: '新赛事' }
      })
    )
    const res = executeUndo()
    expect(eventRepoMock.updateEvent).toHaveBeenCalledWith('e1', {
      name: '旧赛事', start_date: before.start_date, end_date: before.end_date, status: before.status
    })
    expect(res.storeName).toBe('event')
  })

  it('team update undo 恢复 before（队伍修改可撤销）', () => {
    const before: Team = { id: 'tm1', name: '旧队名', event_id: 'e1', group_id: null }
    undoLogRepoMock.getLatest.mockReturnValue(
      makeLog({
        store_name: 'event', target_type: 'team', action: UNDO_ACTIONS.UPDATE,
        target_id: 'tm1', before_data: before,
        after_data: { ...before, name: '新队名' }
      })
    )
    const res = executeUndo()
    expect(eventRepoMock.updateTeam).toHaveBeenCalledWith('tm1', { name: '旧队名' })
    expect(res.storeName).toBe('event')
  })
})

describe('重启语义', () => {
  it('clearUndoLogOnStartup 清空 undo_log 表，实现跨重启历史清零', () => {
    undoLogRepoMock.clearAll.mockReturnValue(5)
    clearUndoLogOnStartup()
    expect(undoLogRepoMock.clearAll).toHaveBeenCalledTimes(1)
  })

  it('未撤销时撤销抛错；已撤销时无法重复撤销', () => {
    undoLogRepoMock.getLatest.mockReturnValue(undefined)
    expect(() => executeUndo()).toThrow('无可撤销的操作')

    undoLogRepoMock.getLatest.mockReturnValue(makeLog({ undone_at: '2024-01-01T00:00:00.000Z' }))
    expect(() => executeUndo()).toThrow('该操作已被撤销')
  })
})