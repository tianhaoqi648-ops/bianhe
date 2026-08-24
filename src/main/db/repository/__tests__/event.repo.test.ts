// ============================================================
// event.repo.test.ts — eventRepo.createEvent 自动绑定默认题库
//
// 背景：like other repository tests, better-sqlite3 为 Electron ABI 编译，
// vitest(Node ABI) 无法直接加载，因此 mock getDb() 返回内存桩（vi.hoisted 共享）。
//
// 覆盖（T3：新建赛事自动绑定默认题库）：
//   - createEvent 成功后调用 topicGroupRepo.getDefault() + bindEventGroups
//   - 绑定的是「默认题库」default-group
//   - 绑定失败时 createEvent 抛出（事务回滚，保证创建即绑定一致性）
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

/** 构造合法 EventCreateInput（name 之外字段显式传 null，与 create-event.tool 一致）。 */
function makeInput(name: string) {
  return { name, start_date: null, end_date: null, status: null }
}

// ============================================================
// Mock 依赖（与 topic-group.repo.test.ts 相同的 getDb 桩策略）
// ============================================================

const h = vi.hoisted(() => {
  let eventRow: Record<string, unknown> | undefined
  // getEventStats 聚合查询 mock 数据（rounds/teams/draw_sessions 三条分组 SQL 各回各表）
  let roundStats: Array<{ event_id: string; cnt: number }> = []
  let teamStats: Array<{ event_id: string; cnt: number }> = []
  let doneStats: Array<{ event_id: string; cnt: number }> = []

  const prepare = (sql: string) => {
    const s = sql.trim()
    return {
      run: (..._args: unknown[]) => {
        // 仅支持 INSERT 语义，其它 run 返回 0 行
        if (!/^INSERT\s+INTO\s+events/i.test(s)) return { changes: 0 }
        return { changes: 1 }
      },
      get: (..._args: unknown[]) => {
        // getEventById 的内部查询
        if (/^SELECT\s+\*\s+FROM\s+events/i.test(s)) return eventRow
        return undefined
      },
      all: (..._args: unknown[]) => {
        // getEventStats 聚合查询：各表返回对应 mock 数据
        if (/FROM\s+draw_sessions/i.test(s)) return doneStats
        if (/FROM\s+rounds\b/i.test(s)) return roundStats
        if (/FROM\s+teams\b/i.test(s)) return teamStats
        return []
      }
    }
  }

  return {
    prepare,
    /** better-sqlite3 事务桩：直接执行传入的同步 fn */
    transaction<T = void>(fn: () => T): () => T {
      return fn
    },
    reset() {
      eventRow = undefined
      roundStats = []
      teamStats = []
      doneStats = []
    },
    setEventRow(row: Record<string, unknown> | undefined) {
      eventRow = row
    },
    setRoundStats(rows: Array<{ event_id: string; cnt: number }>) {
      roundStats = rows
    },
    setTeamStats(rows: Array<{ event_id: string; cnt: number }>) {
      teamStats = rows
    },
    setDoneStats(rows: Array<{ event_id: string; cnt: number }>) {
      doneStats = rows
    }
  }
})

vi.mock('../../index', () => ({
  getDb: () => ({
    prepare: (sql: string) => h.prepare(sql),
    transaction: (fn: () => unknown) => h.transaction(fn)
  })
}))

const d = vi.hoisted(() => ({
  mockGetDefault: vi.fn(),
  mockBindEventGroups: vi.fn()
}))

vi.mock('../topic-group.repo', () => ({
  topicGroupRepo: {
    getDefault: d.mockGetDefault,
    bindEventGroups: d.mockBindEventGroups
  }
}))

// 导入被测模块（在 mock 之后）
import { eventRepo } from '../event.repo'

const MAJOR_LEAGUE = {
  id: 'event-1',
  name: '测试赛',
  start_date: null,
  end_date: null,
  status: null,
  created_at: '2026-08-01T00:00:00.000Z',
  allow_repeat: 0
}

beforeEach(() => {
  vi.clearAllMocks()
  h.reset()
  // 默认题库默认就绪
  d.mockGetDefault.mockReturnValue({ id: 'default-group', name: '默认题库', isDefault: true })
  d.mockBindEventGroups.mockReturnValue(1)
  // getEventById 返回插入后的行
  h.setEventRow({ ...MAJOR_LEAGUE })
})

describe('createEvent：自动绑定默认题库', () => {
  it('创建赛事后绑定默认题库 default-group，不影响返回结果', () => {
    const created = eventRepo.createEvent(makeInput('测试赛'))

    expect(d.mockGetDefault).toHaveBeenCalledTimes(1)
    // 赛事 id 由 uuidv4 生成，用 expect.any(String) 断言「该新赛事」绑定默认题库
    expect(d.mockBindEventGroups).toHaveBeenCalledWith(expect.any(String), ['default-group'])
    // 返回 getEventById 的行
    expect(created).toMatchObject({ id: 'event-1', name: '测试赛' })
  })

  it('默认题库不存在时 getDefault 幂等创建后再绑定', () => {
    // getDefault 内部会幂等建组，这里模拟它成功返回默认题库
    d.mockGetDefault.mockReturnValue({ id: 'default-group', name: '默认题库', isDefault: true })

    eventRepo.createEvent(makeInput('测试赛'))

    expect(d.mockBindEventGroups).toHaveBeenCalledWith(expect.any(String), ['default-group'])
  })

  it('重复调用 createEvent 每次只绑定一次（不重复绑）', () => {
    eventRepo.createEvent(makeInput('赛A'))
    eventRepo.createEvent(makeInput('赛B'))

    expect(d.mockGetDefault).toHaveBeenCalledTimes(2)
    expect(d.mockBindEventGroups).toHaveBeenCalledTimes(2)
  })

  it('绑定失败时 createEvent 抛出错误（事务回滚，不产生半态赛事）', () => {
    d.mockGetDefault.mockImplementation(() => {
      throw new Error('默认题库不可用')
    })

    expect(() => eventRepo.createEvent(makeInput('测试赛'))).toThrow(/默认题库不可用/)
  })
})

describe('getEventStats：批量统计聚合', () => {
  it('多赛事分别聚合轮次/队伍/已完成轮数，并全部出现在返回 Map 中', () => {
    h.setRoundStats([
      { event_id: 'evt-a', cnt: 3 },
      { event_id: 'evt-b', cnt: 1 }
    ])
    h.setTeamStats([
      { event_id: 'evt-a', cnt: 8 },
      { event_id: 'evt-b', cnt: 4 }
    ])
    // 已完成轮数 = 有抽取会话（round_id 命中）的去重轮次数
    h.setDoneStats([
      { event_id: 'evt-a', cnt: 2 },
      { event_id: 'evt-b', cnt: 1 }
    ])

    const map = eventRepo.getEventStats(['evt-a', 'evt-b'])
    expect(map.size).toBe(2)
    expect(map.get('evt-a')).toEqual({
      event_id: 'evt-a',
      round_count: 3,
      team_count: 8,
      done_session_count: 2
    })
    expect(map.get('evt-b')).toEqual({
      event_id: 'evt-b',
      round_count: 1,
      team_count: 4,
      done_session_count: 1
    })
  })

  it('某赛事无数据（不在聚合结果中）时计数为 0，但仍保留在 Map（前端优雅降级）', () => {
    h.setRoundStats([{ event_id: 'evt-a', cnt: 5 }])
    // teamStats / doneStats 不设 → 该赛事队伍与已完成轮数为 0

    const map = eventRepo.getEventStats(['evt-a', 'evt-missing'])
    expect(map.get('evt-a')).toEqual({
      event_id: 'evt-a',
      round_count: 5,
      team_count: 0,
      done_session_count: 0
    })
    expect(map.get('evt-missing')).toEqual({
      event_id: 'evt-missing',
      round_count: 0,
      team_count: 0,
      done_session_count: 0
    })
  })

  it('空 eventIds 返回空 Map，不触发查询', () => {
    expect(eventRepo.getEventStats([]).size).toBe(0)
  })
})