// ============================================================
// draw-engine.test.ts — draw-engine 单元测试
//
// 覆盖：
//   - assignGroupStances：分组同题持方分配（含 2 队/多队、空分组）
//   - assignMultiTeamStances：多队同题持方分配（含正常/错误用例）
//   - drawTopics 主函数 draw_mode 分支：
//     - versus 模式不回归（保持原 assignStances 逻辑）
//     - group 模式正常抽取 + 错误用例
//     - multi_team 模式正常抽取 + 错误用例
//
// 使用 vitest + vi.mock 模拟 4 个 repository，参考 smoke.test.ts 模式。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- 使用 vi.hoisted 提升 mock 数据与函数，避免 vi.mock factory 中的 TDZ ----
const {
  mockTopicsSmall,
  createSessionMock,
  addLogMock,
  listGroupsByEventMock,
  listTeamsByEventMock,
  getTeamByIdMock,
  listDrawnTopicIdsByEventMock,
  listTeamHistoryMock,
  addTeamHistoryMock,
  topicRepoListTopicsMock
} = vi.hoisted(() => {
  // 10 道候选辩题：5 官方 + 5 自定义
  const topics = [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `topic-official-${i}`,
      title: `官方辩题-${i}`,
      type: '价值辩',
      domain: '科技伦理',
      difficulty: '入门级',
      source: '新国辩',
      source_type: '官方',
      tags: ['AI'],
      weight: 1.0,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `topic-custom-${i}`,
      title: `自定义辩题-${i}`,
      type: '政策辩',
      domain: '教育',
      difficulty: '进阶级',
      source: '自定义',
      source_type: '自定义',
      tags: ['社会'],
      weight: 1.0,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }))
  ]

  // 模拟分组与队伍数据
  const groups = [
    { id: 'group-1', event_id: 'event-1', name: 'A组', sort_order: 0, created_at: '' },
    { id: 'group-2', event_id: 'event-1', name: 'B组', sort_order: 1, created_at: '' }
  ]

  // 每组 4 队
  const teamsByGroupMap: Record<string, Team[]> = {
    'group-1': [
      { id: 'team-g1-1', name: 'A1队', event_id: 'event-1', group_id: 'group-1' },
      { id: 'team-g1-2', name: 'A2队', event_id: 'event-1', group_id: 'group-1' },
      { id: 'team-g1-3', name: 'A3队', event_id: 'event-1', group_id: 'group-1' },
      { id: 'team-g1-4', name: 'A4队', event_id: 'event-1', group_id: 'group-1' }
    ],
    'group-2': [
      { id: 'team-g2-1', name: 'B1队', event_id: 'event-1', group_id: 'group-2' },
      { id: 'team-g2-2', name: 'B2队', event_id: 'event-1', group_id: 'group-2' },
      { id: 'team-g2-3', name: 'B3队', event_id: 'event-1', group_id: 'group-2' },
      { id: 'team-g2-4', name: 'B4队', event_id: 'event-1', group_id: 'group-2' }
    ]
  }

  // 全部队伍扁平列表
  const allTeamsFlat = [...teamsByGroupMap['group-1'], ...teamsByGroupMap['group-2']]

  // 空分组（用于错误用例：分组下无队伍）
  const emptyGroups = [{ id: 'group-empty', event_id: 'event-1', name: '空组', sort_order: 2, created_at: '' }]

  const createSession = vi.fn((input: any) => ({
    id: 'session-mock-1',
    event_id: input.event_id,
    round_id: input.round_id ?? null,
    draw_time: new Date().toISOString(),
    operator: input.operator ?? null,
    settings: input.settings ?? null,
    items: input.items.map((it: any, idx: number) => ({
      id: `item-mock-${idx}`,
      session_id: 'session-mock-1',
      ...it
    }))
  }))

  const addLog = vi.fn(() => ({
    id: 'log-mock-1',
    action: 'draw',
    target_type: 'session',
    target_id: 'session-mock-1',
    operator: 'tester',
    detail: {},
    created_at: new Date().toISOString()
  }))

  // listGroupsByEvent mock：默认返回 2 组，可被测试覆盖
  const listGroupsByEvent = vi.fn((eventId: string) => {
    if (eventId === 'event-empty-groups') return emptyGroups
    return groups
  })

  // listTeamsByEvent mock：支持 group_id 过滤
  const listTeamsByEvent = vi.fn(
    (_eventId: string, filter?: { group_id?: string | null }) => {
      if (filter && filter.group_id !== undefined) {
        if (filter.group_id === null) {
          // 未分组队伍（测试不需要）
          return []
        }
        if (filter.group_id === 'group-empty') return []
        return teamsByGroupMap[filter.group_id] ?? []
      }
      return allTeamsFlat
    }
  )

  // getTeamById mock
  const getTeamById = vi.fn((id: string) => {
    const all = [...allTeamsFlat]
    return all.find((t) => t.id === id)
  })

  // Task 10: 暴露 applyExclusions 内部调用的 mock，用于 test_mode 跳过验证
  const listDrawnTopicIdsByEvent = vi.fn(() => [])
  const listTeamHistory = vi.fn(() => [])
  // Task 10: addTeamHistory 实际调用在 IPC 层，draw-engine 不应调用
  const addTeamHistory = vi.fn(() => undefined)

  // Task 10: 暴露 listTopics mock，便于 allow_repeat 测试临时覆盖返回 2 道题
  const listTopics = vi.fn((filter?: any) => {
    let items = [...topics]
    if (filter?.status) items = items.filter((t) => t.status === filter.status)
    return { items, total: items.length }
  })

  // Task 10: 小题库（2 道），用于 allow_repeat 候选不足场景
  const topicsSmall = [
    {
      id: 'topic-small-1',
      title: '小题库题1',
      type: '价值辩',
      domain: '科技伦理',
      difficulty: '入门级',
      source: '新国辩',
      source_type: '官方',
      tags: ['AI'],
      weight: 1.0,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'topic-small-2',
      title: '小题库题2',
      type: '政策辩',
      domain: '教育',
      difficulty: '进阶级',
      source: '自定义',
      source_type: '自定义',
      tags: ['社会'],
      weight: 1.0,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]

  return {
    mockTopics: topics,
    mockTopicsSmall: topicsSmall,
    createSessionMock: createSession,
    addLogMock: addLog,
    listGroupsByEventMock: listGroupsByEvent,
    listTeamsByEventMock: listTeamsByEvent,
    getTeamByIdMock: getTeamById,
    listDrawnTopicIdsByEventMock: listDrawnTopicIdsByEvent,
    listTeamHistoryMock: listTeamHistory,
    addTeamHistoryMock: addTeamHistory,
    topicRepoListTopicsMock: listTopics
  }
})

// ---- mock topic.repo ----
vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: {
    listTopics: topicRepoListTopicsMock
  }
}))

// ---- mock event.repo ----
vi.mock('../../db/repository/event.repo', () => ({
  eventRepo: {
    getRoundById: vi.fn((id: string) => ({
      id,
      event_id: 'event-1',
      name: '小组赛',
      round_number: 1,
      difficulty_override: '小组赛',
      topic_count: 2
    })),
    listTeamHistory: listTeamHistoryMock,
    addTeamHistory: addTeamHistoryMock,
    listGroupsByEvent: listGroupsByEventMock,
    listTeamsByEvent: listTeamsByEventMock,
    getTeamById: getTeamByIdMock
  }
}))

// ---- mock draw.repo ----
vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: {
    createSession: createSessionMock,
    listDrawnTopicIdsByEvent: listDrawnTopicIdsByEventMock
  }
}))

// ---- mock audit.repo ----
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    addLog: addLogMock
  }
}))

// ---- 现在 import draw-engine（会在加载时使用上面的 mock）----
import {
  drawTopics,
  assignGroupStances,
  assignMultiTeamStances,
  InsufficientTopicsError
} from '../draw-engine'
import type { Topic } from '../../db/repository/topic.repo'
import type { Team, TeamGroup } from '../../db/repository/event.repo'

// ============================================================
// 工具函数：构造 Topic / Team / TeamGroup
// ============================================================

function makeTopic(id: string, title: string): Topic {
  return {
    id,
    title,
    type: null,
    domain: null,
    difficulty: null,
    source: null,
    source_type: null,
    tags: null,
    weight: 1,
    status: 'active',
    batch_id: null,
    created_at: '',
    updated_at: ''
  }
}

function makeTeam(id: string, name: string, group_id: string | null = null): Team {
  return { id, name, event_id: 'event-1', group_id }
}

function makeGroup(id: string, name: string): TeamGroup {
  return { id, event_id: 'event-1', name, sort_order: 0, created_at: '' }
}

// ============================================================
// assignGroupStances 单元测试
// ============================================================

describe('assignGroupStances', () => {
  it('2 组 × 4 队 → 2 题，每题 4 队', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const groups = [makeGroup('g-1', 'A组'), makeGroup('g-2', 'B组')]
    const teamsByGroup = new Map<string, Team[]>([
      ['g-1', [makeTeam('t1', 'A1'), makeTeam('t2', 'A2'), makeTeam('t3', 'A3'), makeTeam('t4', 'A4')]],
      ['g-2', [makeTeam('t5', 'B1'), makeTeam('t6', 'B2'), makeTeam('t7', 'B3'), makeTeam('t8', 'B4')]]
    ])

    const items = assignGroupStances(topics, groups, teamsByGroup, false)

    expect(items).toHaveLength(2)
    expect(items[0].topic_id).toBe('t-1')
    expect(items[0].group_id).toBe('g-1')
    expect(items[0].team_ids).toEqual(['t1', 't2', 't3', 't4'])
    // 多队（4 > 2）不分配持方
    expect(items[0].team_a_id).toBeNull()
    expect(items[0].team_b_id).toBeNull()
    expect(items[0].stance_a).toBeNull()
    expect(items[0].stance_b).toBeNull()
    expect(items[0].topic_title).toBe('题1')

    expect(items[1].topic_id).toBe('t-2')
    expect(items[1].group_id).toBe('g-2')
    expect(items[1].team_ids).toEqual(['t5', 't6', 't7', 't8'])
  })

  it('2 队分组：随机分配正反方', () => {
    const topics = [makeTopic('t-1', '题1')]
    const groups = [makeGroup('g-1', '二人组')]
    const teamsByGroup = new Map<string, Team[]>([
      ['g-1', [makeTeam('t1', '甲'), makeTeam('t2', '乙')]]
    ])

    const items = assignGroupStances(topics, groups, teamsByGroup, false)

    expect(items).toHaveLength(1)
    expect(items[0].team_ids).toEqual(['t1', 't2'])
    expect(items[0].group_id).toBe('g-1')
    // 2 队分组：team_a_id / team_b_id 有值，stance 互斥
    expect(items[0].team_a_id).toBe('t1')
    expect(items[0].team_b_id).toBe('t2')
    expect(['正方', '反方']).toContain(items[0].stance_a)
    expect(['正方', '反方']).toContain(items[0].stance_b)
    expect(items[0].stance_a).not.toBe(items[0].stance_b)
  })

  it('题数与分组数不匹配抛错', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const groups = [makeGroup('g-1', 'A组')]
    const teamsByGroup = new Map<string, Team[]>([['g-1', [makeTeam('t1', 'A1')]]])

    expect(() => assignGroupStances(topics, groups, teamsByGroup, false)).toThrow(
      '分组模式题数与分组数不匹配'
    )
  })

  it('分组下无队伍抛错', () => {
    const topics = [makeTopic('t-1', '题1')]
    const groups = [makeGroup('g-1', '空组')]
    const teamsByGroup = new Map<string, Team[]>([['g-1', []]])

    expect(() => assignGroupStances(topics, groups, teamsByGroup, false)).toThrow('分组「空组」下无队伍')
  })
})

// ============================================================
// assignMultiTeamStances 单元测试
// ============================================================

describe('assignMultiTeamStances', () => {
  it('6 队 × 每题 3 队 → 2 题', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const teams = [
      makeTeam('t1', '队1'),
      makeTeam('t2', '队2'),
      makeTeam('t3', '队3'),
      makeTeam('t4', '队4'),
      makeTeam('t5', '队5'),
      makeTeam('t6', '队6')
    ]

    const items = assignMultiTeamStances(topics, teams, 3, false, false)

    expect(items).toHaveLength(2)
    // 每题 3 队
    expect(items[0].team_ids).toHaveLength(3)
    expect(items[1].team_ids).toHaveLength(3)
    // 两题的队伍互斥（不重复）
    const allTeamIds = [...items[0].team_ids!, ...items[1].team_ids!]
    expect(new Set(allTeamIds).size).toBe(6)
    // 字段约束
    expect(items[0].team_a_id).toBeNull()
    expect(items[0].team_b_id).toBeNull()
    expect(items[0].stance_a).toBeNull()
    expect(items[0].stance_b).toBeNull()
    expect(items[0].group_id).toBeNull()
    expect(items[0].topic_title).toBe('题1')
  })

  it('4 队 × 每题 2 队 → 2 题（2 队同题也允许）', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const teams = [makeTeam('t1', '队1'), makeTeam('t2', '队2'), makeTeam('t3', '队3'), makeTeam('t4', '队4')]

    const items = assignMultiTeamStances(topics, teams, 2, false, false)

    expect(items).toHaveLength(2)
    expect(items[0].team_ids).toHaveLength(2)
    expect(items[1].team_ids).toHaveLength(2)
    // 持方不分配
    expect(items[0].stance_a).toBeNull()
    expect(items[0].stance_b).toBeNull()
    // group_id 为 null
    expect(items[0].group_id).toBeNull()
  })

  it('teams_per_topic < 2 抛错', () => {
    const topics = [makeTopic('t-1', '题1')]
    const teams = [makeTeam('t1', '队1'), makeTeam('t2', '队2')]
    expect(() => assignMultiTeamStances(topics, teams, 1, false, false)).toThrow('每题队伍数 ≥2')
  })

  it('队伍数不能整除抛错', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const teams = [makeTeam('t1', '队1'), makeTeam('t2', '队2'), makeTeam('t3', '队3'), makeTeam('t4', '队4'), makeTeam('t5', '队5')]
    // 5 队 / 2 = 2.5，不能整除
    expect(() => assignMultiTeamStances(topics, teams, 2, false, false)).toThrow('队伍数需为每题队伍数的整数倍')
  })

  it('题数与队伍分组数不匹配抛错', () => {
    const topics = [makeTopic('t-1', '题1')] // 只 1 题
    const teams = [
      makeTeam('t1', '队1'),
      makeTeam('t2', '队2'),
      makeTeam('t3', '队3'),
      makeTeam('t4', '队4'),
      makeTeam('t5', '队5'),
      makeTeam('t6', '队6')
    ]
    // 6 队 / 3 = 2 题，但 topics 只 1 题
    expect(() => assignMultiTeamStances(topics, teams, 3, false, false)).toThrow(
      '多队同题模式题数与分组数不匹配'
    )
  })
})

// ============================================================
// drawTopics 主函数 draw_mode 分支测试
// ============================================================

describe('drawTopics: draw_mode 分支', () => {
  beforeEach(() => {
    createSessionMock.mockClear()
    addLogMock.mockClear()
    listGroupsByEventMock.mockClear()
    listTeamsByEventMock.mockClear()
  })

  // ---------- versus 模式不回归 ----------

  it('versus 模式：include_stance=false 保持原行为', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 3,
      include_stance: false,
      operator: 'tester',
      draw_mode: 'versus'
    })

    expect(result.topics).toHaveLength(3)
    expect(result.session.items).toHaveLength(3)

    // settings 应记录 draw_mode='versus'
    expect(result.session.settings?.draw_mode).toBe('versus')
    expect(result.session.settings?.group_ids).toBeNull()
    expect(result.session.settings?.teams_per_topic).toBeNull()

    // versus 不分配持方时：team_a_id / team_b_id 为 null
    for (const item of result.session.items) {
      expect(item.team_a_id).toBeNull()
      expect(item.team_b_id).toBeNull()
      expect(item.team_ids ?? null).toBeNull()
      expect(item.group_id ?? null).toBeNull()
    }

    // 验证 audit 日志记录了 draw_mode
    expect(addLogMock).toHaveBeenCalledTimes(1)
    const logInput = (addLogMock.mock.calls as Array<Array<any>>)[0][0]
    expect(logInput.detail.draw_mode).toBe('versus')
  })

  it('versus 模式：include_stance=true + 4 队伍保持原 assignStances 行为', () => {
    const teams = [
      { id: 'team-1', name: '队伍一', event_id: 'event-1' },
      { id: 'team-2', name: '队伍二', event_id: 'event-1' },
      { id: 'team-3', name: '队伍三', event_id: 'event-1' },
      { id: 'team-4', name: '队伍四', event_id: 'event-1' }
    ]

    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 2,
      include_stance: true,
      teams,
      operator: 'tester',
      draw_mode: 'versus'
    })

    expect(result.topics).toHaveLength(2)
    for (const item of result.session.items) {
      expect(item.team_a_id).toBeTruthy()
      expect(item.team_b_id).toBeTruthy()
      expect(item.stance_a).toMatch(/正方|反方/)
      expect(item.stance_b).toMatch(/正方|反方/)
      expect(item.stance_a).not.toBe(item.stance_b)
      // versus 模式不应有 team_ids / group_id
      expect(item.team_ids ?? null).toBeNull()
      expect(item.group_id ?? null).toBeNull()
    }
  })

  it('未传 draw_mode 时按 versus 解析（向后兼容）', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 1,
      include_stance: false
    })

    expect(result.session.settings?.draw_mode).toBe('versus')
  })

  // ---------- group 模式 ----------

  it('group 模式正常抽取（2 组 × 4 队 → 2 题，每题 4 队）', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 99, // 用户输入会被覆盖为分组数（2）
      include_stance: false,
      operator: 'tester',
      draw_mode: 'group',
      group_ids: ['group-1', 'group-2']
    })

    // 题数 = 分组数 = 2
    expect(result.topics).toHaveLength(2)
    expect(result.session.items).toHaveLength(2)

    // settings 记录
    expect(result.session.settings?.draw_mode).toBe('group')
    expect(result.session.settings?.group_ids).toEqual(['group-1', 'group-2'])
    expect(result.session.settings?.teams_per_topic).toBeNull()

    // 每个 item 字段约束
    const item0 = result.session.items[0]
    expect(item0.group_id).toBe('group-1')
    expect(item0.team_ids).toHaveLength(4)
    expect(item0.team_ids).toEqual(
      expect.arrayContaining(['team-g1-1', 'team-g1-2', 'team-g1-3', 'team-g1-4'])
    )
    // 4 队 > 2：不分配持方
    expect(item0.team_a_id).toBeNull()
    expect(item0.team_b_id).toBeNull()
    expect(item0.stance_a).toBeNull()
    expect(item0.stance_b).toBeNull()

    const item1 = result.session.items[1]
    expect(item1.group_id).toBe('group-2')
    expect(item1.team_ids).toHaveLength(4)

    // 验证 audit 日志
    expect(addLogMock).toHaveBeenCalledTimes(1)
    const logInput = (addLogMock.mock.calls as Array<Array<any>>)[0][0]
    expect(logInput.detail.draw_mode).toBe('group')
    expect(logInput.detail.group_ids).toEqual(['group-1', 'group-2'])
  })

  it('group 模式未选分组抛错', () => {
    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'group',
        group_ids: []
      })
    ).toThrow('请选择至少一个分组')

    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'group'
        // group_ids 未传
      })
    ).toThrow('请选择至少一个分组')

    // 抛错时不应写库
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it('group 模式分组下无队伍抛错', () => {
    expect(() =>
      drawTopics({
        event_id: 'event-empty-groups',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'group',
        group_ids: ['group-empty']
      })
    ).toThrow('分组「空组」下无队伍')

    expect(createSessionMock).not.toHaveBeenCalled()
  })

  // ---------- multi_team 模式 ----------

  it('multi_team 模式正常抽取（6 队 × 每题 3 队 → 2 题）', () => {
    // mock 默认 allTeamsFlat 共 8 队，需让本测试用例用 6 队
    // 临时覆盖 listTeamsByEvent 返回 6 队
    listTeamsByEventMock.mockImplementationOnce(
      (eventId: string, filter?: { group_id?: string | null }) => {
        if (filter && filter.group_id !== undefined) {
          if (filter.group_id === null) return []
          return []
        }
        return Array.from({ length: 6 }, (_, i) => ({
          id: `team-mt-${i}`,
          name: `队${i}`,
          event_id: eventId,
          group_id: null
        }))
      }
    )

    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 99, // 会被覆盖为 6 / 3 = 2
      include_stance: false,
      operator: 'tester',
      draw_mode: 'multi_team',
      teams_per_topic: 3
    })

    expect(result.topics).toHaveLength(2)
    expect(result.session.items).toHaveLength(2)

    // settings
    expect(result.session.settings?.draw_mode).toBe('multi_team')
    expect(result.session.settings?.teams_per_topic).toBe(3)
    expect(result.session.settings?.group_ids).toBeNull()

    // 每个 item：3 队，无持方，无分组
    const allTeamIds: string[] = []
    for (const item of result.session.items) {
      expect(item.team_ids).toHaveLength(3)
      expect(item.team_a_id).toBeNull()
      expect(item.team_b_id).toBeNull()
      expect(item.stance_a).toBeNull()
      expect(item.stance_b).toBeNull()
      expect(item.group_id).toBeNull()
      allTeamIds.push(...(item.team_ids ?? []))
    }
    // 6 个不重复的队伍
    expect(new Set(allTeamIds).size).toBe(6)

    // audit
    expect(addLogMock).toHaveBeenCalledTimes(1)
    const logInput = (addLogMock.mock.calls as Array<Array<any>>)[0][0]
    expect(logInput.detail.draw_mode).toBe('multi_team')
    expect(logInput.detail.teams_per_topic).toBe(3)
  })

  it('multi_team 模式 teams_per_topic < 2 抛错', () => {
    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'multi_team',
        teams_per_topic: 1
      })
    ).toThrow('每题队伍数 ≥2')

    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it('multi_team 模式队伍数不能整除抛错', () => {
    // allTeamsFlat 默认 8 队，8 / 3 = 2.67 不能整除
    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'multi_team',
        teams_per_topic: 3
      })
    ).toThrow('队伍数需为每题队伍数的整数倍')

    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it('multi_team 模式未传 teams_per_topic 抛错', () => {
    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'multi_team'
      })
    ).toThrow('每题队伍数 ≥2')
  })

  // ---------- group 模式题数覆盖验证 ----------

  it('group 模式下 user 传入的 topic_count 被分组数覆盖（题数与分组数相等）', () => {
    // 用户传 topic_count=99，但实际只有 2 个分组，应抽 2 题
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 99,
      include_stance: false,
      draw_mode: 'group',
      group_ids: ['group-1', 'group-2']
    })

    expect(result.session.items).toHaveLength(2)
    // settings.topic_count 应为实际值 2
    expect(result.session.settings?.topic_count).toBe(2)
  })

  // ---------- multi_team 模式题数覆盖验证 ----------

  it('multi_team 模式下 user 传入的 topic_count 被实际题数覆盖', () => {
    // 8 队 / 2 = 4 题
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 99,
      include_stance: false,
      draw_mode: 'multi_team',
      teams_per_topic: 2
    })

    expect(result.session.items).toHaveLength(4)
    expect(result.session.settings?.topic_count).toBe(4)
  })

  // ---------- 题池不足 ----------

  it('group 模式下题池不足抛 InsufficientTopicsError', () => {
    // mock 5 道候选题，但 mock listGroupsByEvent 返回更多分组
    listGroupsByEventMock.mockImplementationOnce(() => [
      { id: 'g-1', event_id: 'event-1', name: '组1', sort_order: 0, created_at: '' },
      { id: 'g-2', event_id: 'event-1', name: '组2', sort_order: 1, created_at: '' },
      { id: 'g-3', event_id: 'event-1', name: '组3', sort_order: 2, created_at: '' },
      { id: 'g-4', event_id: 'event-1', name: '组4', sort_order: 3, created_at: '' },
      { id: 'g-5', event_id: 'event-1', name: '组5', sort_order: 4, created_at: '' },
      { id: 'g-6', event_id: 'event-1', name: '组6', sort_order: 5, created_at: '' },
      { id: 'g-7', event_id: 'event-1', name: '组7', sort_order: 6, created_at: '' },
      { id: 'g-8', event_id: 'event-1', name: '组8', sort_order: 7, created_at: '' },
      { id: 'g-9', event_id: 'event-1', name: '组9', sort_order: 8, created_at: '' },
      { id: 'g-10', event_id: 'event-1', name: '组10', sort_order: 9, created_at: '' },
      { id: 'g-11', event_id: 'event-1', name: '组11', sort_order: 10, created_at: '' }
    ])
    listTeamsByEventMock.mockImplementation((_eventId, filter?) => {
      if (filter?.group_id) return [makeTeam(`team-${filter.group_id}`, `队${filter.group_id}`)]
      return []
    })

    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'group',
        group_ids: ['g-1', 'g-2', 'g-3', 'g-4', 'g-5', 'g-6', 'g-7', 'g-8', 'g-9', 'g-10', 'g-11']
      })
    ).toThrow(InsufficientTopicsError)
  })
})

// ============================================================
// 循环赛 / 非循环赛持方分配 + team_stances / team_names 快照测试
// ============================================================

describe('循环赛 isRoundRobin 持方分配 + 快照写入', () => {
  // ---------- 1. 循环赛 + group 模式 + 组内 4 队 ----------

  it('循环赛 + group 模式 + 组内 4 队：team_stances 全为空字符串，team_names 含队伍名', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const groups = [makeGroup('g-1', 'A组'), makeGroup('g-2', 'B组')]
    const teamsByGroup = new Map<string, Team[]>([
      ['g-1', [makeTeam('t1', 'A1'), makeTeam('t2', 'A2'), makeTeam('t3', 'A3'), makeTeam('t4', 'A4')]],
      ['g-2', [makeTeam('t5', 'B1'), makeTeam('t6', 'B2'), makeTeam('t7', 'B3'), makeTeam('t8', 'B4')]]
    ])

    const items = assignGroupStances(topics, groups, teamsByGroup, true)

    expect(items).toHaveLength(2)
    for (const item of items) {
      // team_ids 与 team_stances / team_names 长度均为 4
      expect(item.team_ids).toHaveLength(4)
      expect(item.team_stances).toHaveLength(4)
      expect(item.team_names).toHaveLength(4)
      // 循环赛：team_stances 全为空字符串
      expect(item.team_stances!.every((s) => s === '')).toBe(true)
      // team_names 含队伍名（非空）
      expect(item.team_names!.every((n) => typeof n === 'string' && n.length > 0)).toBe(true)
      // 循环赛：stance_a/stance_b 留空
      expect(item.stance_a).toBeNull()
      expect(item.stance_b).toBeNull()
      // team_a_id / team_b_id 也留空
      expect(item.team_a_id).toBeNull()
      expect(item.team_b_id).toBeNull()
    }
    // 验证 team_ids 与 team_names 一一对应
    expect(items[0].team_ids).toEqual(['t1', 't2', 't3', 't4'])
    expect(items[0].team_names).toEqual(['A1', 'A2', 'A3', 'A4'])
    expect(items[1].team_ids).toEqual(['t5', 't6', 't7', 't8'])
    expect(items[1].team_names).toEqual(['B1', 'B2', 'B3', 'B4'])
  })

  // ---------- 2. 非循环赛 + group 模式 + 组内 4 队 ----------

  it('非循环赛 + group 模式 + 组内 4 队：team_stances 每个元素为正方/反方', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const groups = [makeGroup('g-1', 'A组'), makeGroup('g-2', 'B组')]
    const teamsByGroup = new Map<string, Team[]>([
      ['g-1', [makeTeam('t1', 'A1'), makeTeam('t2', 'A2'), makeTeam('t3', 'A3'), makeTeam('t4', 'A4')]],
      ['g-2', [makeTeam('t5', 'B1'), makeTeam('t6', 'B2'), makeTeam('t7', 'B3'), makeTeam('t8', 'B4')]]
    ])

    const items = assignGroupStances(topics, groups, teamsByGroup, false)

    expect(items).toHaveLength(2)
    for (const item of items) {
      // team_ids / team_stances / team_names 长度均为 4
      expect(item.team_ids).toHaveLength(4)
      expect(item.team_stances).toHaveLength(4)
      expect(item.team_names).toHaveLength(4)
      // 非循环赛 4 队：每个元素为 '正方' 或 '反方'
      for (const stance of item.team_stances!) {
        expect(['正方', '反方']).toContain(stance)
      }
      // 多队（>2）：stance_a / stance_b 留空
      expect(item.stance_a).toBeNull()
      expect(item.stance_b).toBeNull()
      // team_a_id / team_b_id 留空
      expect(item.team_a_id).toBeNull()
      expect(item.team_b_id).toBeNull()
      // team_names 含队伍名
      expect(item.team_names!.every((n) => typeof n === 'string' && n.length > 0)).toBe(true)
    }
  })

  // ---------- 3. 非循环赛 + group 模式 + 组内 2 队 ----------

  it('非循环赛 + group 模式 + 组内 2 队：stance_a/stance_b 有值，team_stances 长度 2', () => {
    const topics = [makeTopic('t-1', '题1')]
    const groups = [makeGroup('g-1', '二人组')]
    const teamsByGroup = new Map<string, Team[]>([
      ['g-1', [makeTeam('t1', '甲'), makeTeam('t2', '乙')]]
    ])

    const items = assignGroupStances(topics, groups, teamsByGroup, false)

    expect(items).toHaveLength(1)
    const item = items[0]
    // 2 队：team_a_id / team_b_id 有值
    expect(item.team_a_id).toBe('t1')
    expect(item.team_b_id).toBe('t2')
    // stance_a / stance_b 有值且互斥
    expect(['正方', '反方']).toContain(item.stance_a)
    expect(['正方', '反方']).toContain(item.stance_b)
    expect(item.stance_a).not.toBe(item.stance_b)
    // team_stances 长度 2，与 stance_a / stance_b 顺序对应
    expect(item.team_stances).toHaveLength(2)
    expect(item.team_stances).toEqual([item.stance_a, item.stance_b])
    // team_names 长度 2
    expect(item.team_names).toHaveLength(2)
    expect(item.team_names).toEqual(['甲', '乙'])
  })

  // ---------- 4. 循环赛 + multi_team 模式 + 每题 3 队 ----------

  it('循环赛 + multi_team 模式 + 每题 3 队：team_stances 全为空字符串', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const teams = [
      makeTeam('t1', '队1'),
      makeTeam('t2', '队2'),
      makeTeam('t3', '队3'),
      makeTeam('t4', '队4'),
      makeTeam('t5', '队5'),
      makeTeam('t6', '队6')
    ]

    const items = assignMultiTeamStances(topics, teams, 3, true, false)

    expect(items).toHaveLength(2)
    for (const item of items) {
      // 每题 3 队
      expect(item.team_ids).toHaveLength(3)
      expect(item.team_stances).toHaveLength(3)
      expect(item.team_names).toHaveLength(3)
      // 循环赛：team_stances 全为空字符串
      expect(item.team_stances!.every((s) => s === '')).toBe(true)
      // team_names 含队伍名
      expect(item.team_names!.every((n) => typeof n === 'string' && n.length > 0)).toBe(true)
      // stance_a / stance_b 留空
      expect(item.stance_a).toBeNull()
      expect(item.stance_b).toBeNull()
    }
    // 6 队不重复
    const allTeamIds = [...items[0].team_ids!, ...items[1].team_ids!]
    expect(new Set(allTeamIds).size).toBe(6)
  })

  // ---------- 5. 非循环赛 + multi_team 模式 + 每题 3 队 ----------

  it('非循环赛 + multi_team 模式 + 每题 3 队：team_stances 前两位正反方，末位空字符串', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const teams = [
      makeTeam('t1', '队1'),
      makeTeam('t2', '队2'),
      makeTeam('t3', '队3'),
      makeTeam('t4', '队4'),
      makeTeam('t5', '队5'),
      makeTeam('t6', '队6')
    ]

    const items = assignMultiTeamStances(topics, teams, 3, false, false)

    expect(items).toHaveLength(2)
    for (const item of items) {
      // 每题 3 队
      expect(item.team_ids).toHaveLength(3)
      expect(item.team_stances).toHaveLength(3)
      expect(item.team_names).toHaveLength(3)
      // 非循环赛 3 队（奇数）：前两位一正一反，第三位为空字符串（P1-9 修复：无对手）
      expect(item.team_stances![0]).not.toBe(item.team_stances![1])
      expect(['正方', '反方']).toContain(item.team_stances![0])
      expect(['正方', '反方']).toContain(item.team_stances![1])
      expect(item.team_stances![2]).toBe('')
      // team_names 含队伍名
      expect(item.team_names!.every((n) => typeof n === 'string' && n.length > 0)).toBe(true)
      // stance_a / stance_b 留空
      expect(item.stance_a).toBeNull()
      expect(item.stance_b).toBeNull()
    }
    // 6 队不重复
    const allTeamIds = [...items[0].team_ids!, ...items[1].team_ids!]
    expect(new Set(allTeamIds).size).toBe(6)
  })
})

// ============================================================
// v6: group 模式组内随机配对
// ============================================================

describe('v6: group 模式组内随机配对', () => {
  beforeEach(() => {
    createSessionMock.mockClear()
    addLogMock.mockClear()
    listGroupsByEventMock.mockClear()
    listTeamsByEventMock.mockClear()
  })

  it('group 模式同组 4 队多次抽取应产生不同配对组合', () => {
    // mock listTeamsByEvent 返回 4 队 [A,B,C,D]
    const teams4 = [
      makeTeam('A', 'A队', 'group-test'),
      makeTeam('B', 'B队', 'group-test'),
      makeTeam('C', 'C队', 'group-test'),
      makeTeam('D', 'D队', 'group-test')
    ]
    listGroupsByEventMock.mockImplementation(() => [makeGroup('group-test', '测试组')])
    listTeamsByEventMock.mockImplementation(
      (_eventId: string, filter?: { group_id?: string | null }) => {
        if (filter?.group_id === 'group-test') return [...teams4]
        return []
      }
    )

    const pairings = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const result = drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'group',
        group_ids: ['group-test']
      })
      const item = result.session.items[0]
      expect(item.team_ids).toHaveLength(4)
      // 提取配对组合：(team_ids[0], team_ids[1]) 和 (team_ids[2], team_ids[3])
      const pair1 = [item.team_ids![0], item.team_ids![1]].sort().join('-')
      const pair2 = [item.team_ids![2], item.team_ids![3]].sort().join('-')
      const pairingKey = [pair1, pair2].sort().join('|')
      pairings.add(pairingKey)
      // 断言：每次 team_stances 相邻两位一正一反
      const stances = item.team_stances!
      for (let j = 0; j < stances.length; j += 2) {
        if (j + 1 < stances.length) {
          expect(stances[j]).not.toBe(stances[j + 1])
          expect(['正方', '反方']).toContain(stances[j])
          expect(['正方', '反方']).toContain(stances[j + 1])
        }
      }
    }
    // 断言：至少出现 2 种以上不同配对组合
    expect(pairings.size).toBeGreaterThanOrEqual(2)
  })

  it('group 模式同组 2 队 shuffle 不影响配对关系', () => {
    // 2 队 shuffle 后仍为这 2 队对打，仅持方随机
    const teams2 = [
      makeTeam('A', 'A队', 'group-test'),
      makeTeam('B', 'B队', 'group-test')
    ]
    listGroupsByEventMock.mockImplementation(() => [makeGroup('group-test', '测试组')])
    listTeamsByEventMock.mockImplementation(
      (_eventId: string, filter?: { group_id?: string | null }) => {
        if (filter?.group_id === 'group-test') return [...teams2]
        return []
      }
    )

    const pairings = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const result = drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'group',
        group_ids: ['group-test']
      })
      const item = result.session.items[0]
      expect(item.team_ids).toHaveLength(2)
      // 2 队：始终是 A 和 B 对打
      const pairKey = [...item.team_ids!].sort().join('-')
      pairings.add(pairKey)
      // stance_a / stance_b 有值且互斥
      expect(['正方', '反方']).toContain(item.stance_a)
      expect(['正方', '反方']).toContain(item.stance_b)
      expect(item.stance_a).not.toBe(item.stance_b)
    }
    // 只有一种配对组合：A-B
    expect(pairings.size).toBe(1)
    expect(pairings.has('A-B')).toBe(true)
  })

  it('group 模式同组 3 队（奇数）shuffle 后前两队配对', () => {
    // 3 队 shuffle 后前两队配对，第三队单独
    const teams3 = [
      makeTeam('A', 'A队', 'group-test'),
      makeTeam('B', 'B队', 'group-test'),
      makeTeam('C', 'C队', 'group-test')
    ]
    listGroupsByEventMock.mockImplementation(() => [makeGroup('group-test', '测试组')])
    listTeamsByEventMock.mockImplementation(
      (_eventId: string, filter?: { group_id?: string | null }) => {
        if (filter?.group_id === 'group-test') return [...teams3]
        return []
      }
    )

    const pairings = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const result = drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: false,
        draw_mode: 'group',
        group_ids: ['group-test']
      })
      const item = result.session.items[0]
      expect(item.team_ids).toHaveLength(3)
      // 3 队（奇数）：team_stances 长度 3，前两位一正一反，第三位为空字符串（P1-9 修复：无对手）
      const stances = item.team_stances!
      expect(stances).toHaveLength(3)
      // 前两位一正一反
      expect(stances[0]).not.toBe(stances[1])
      expect(['正方', '反方']).toContain(stances[0])
      expect(['正方', '反方']).toContain(stances[1])
      // 第三位无对手，持方为空字符串
      expect(stances[2]).toBe('')
      // 记录前两队的配对组合
      const pair1 = [item.team_ids![0], item.team_ids![1]].sort().join('-')
      pairings.add(pair1)
    }
    // 3 队 shuffle 后前两队配对至少出现 2 种组合（AB, AC, BC 中至少 2 种）
    expect(pairings.size).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================
// v6: multi_team 模式智能保留配置
// ============================================================

describe('v6: multi_team 模式智能保留配置', () => {
  beforeEach(() => {
    createSessionMock.mockClear()
    addLogMock.mockClear()
    listGroupsByEventMock.mockClear()
    listTeamsByEventMock.mockClear()
  })

  it('user_pairing=true 时保留 TeamPairing 配对顺序（不 shuffle）', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const teams = [
      makeTeam('A', 'A队'),
      makeTeam('B', 'B队'),
      makeTeam('C', 'C队'),
      makeTeam('D', 'D队')
    ]

    for (let i = 0; i < 50; i++) {
      const items = assignMultiTeamStances(topics, teams, 2, false, true)
      expect(items).toHaveLength(2)
      // team_ids 始终为 [A,B,C,D] 的分块：第一题 [A,B]，第二题 [C,D]
      expect(items[0].team_ids).toEqual(['A', 'B'])
      expect(items[1].team_ids).toEqual(['C', 'D'])
      // team_stances 相邻两位一正一反
      for (const item of items) {
        const stances = item.team_stances!
        expect(stances).toHaveLength(2)
        expect(stances[0]).not.toBe(stances[1])
        expect(['正方', '反方']).toContain(stances[0])
        expect(['正方', '反方']).toContain(stances[1])
      }
    }
  })

  it('user_pairing=false 时 shuffle 后随机配对', () => {
    const topics = [makeTopic('t-1', '题1'), makeTopic('t-2', '题2')]
    const teams = [
      makeTeam('A', 'A队'),
      makeTeam('B', 'B队'),
      makeTeam('C', 'C队'),
      makeTeam('D', 'D队')
    ]

    const orders = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const items = assignMultiTeamStances(topics, teams, 2, false, false)
      expect(items).toHaveLength(2)
      // 收集 team_ids 顺序
      const order = [...items[0].team_ids!, ...items[1].team_ids!].join('-')
      orders.add(order)
      // team_stances 相邻两位一正一反
      for (const item of items) {
        const stances = item.team_stances!
        expect(stances).toHaveLength(2)
        expect(stances[0]).not.toBe(stances[1])
        expect(['正方', '反方']).toContain(stances[0])
        expect(['正方', '反方']).toContain(stances[1])
      }
    }
    // 至少出现 2 种以上不同 team_ids 顺序
    expect(orders.size).toBeGreaterThanOrEqual(2)
  })

  it('user_pairing 未传（undefined）时按 false 处理（shuffle）', () => {
    // 通过 drawTopics 验证：不传 user_pairing 时，行为与 false 一致（shuffle）
    const teams = [
      makeTeam('A', 'A队'),
      makeTeam('B', 'B队'),
      makeTeam('C', 'C队'),
      makeTeam('D', 'D队')
    ]

    const orders = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const result = drawTopics({
        event_id: 'event-1',
        topic_count: 2,
        include_stance: false,
        draw_mode: 'multi_team',
        teams_per_topic: 2,
        teams
        // user_pairing 未传，应按 false 处理（shuffle）
      })
      const allIds = result.session.items.flatMap((it) => it.team_ids ?? [])
      orders.add(allIds.join('-'))
      // team_stances 相邻两位一正一反
      for (const item of result.session.items) {
        const stances = item.team_stances!
        expect(stances).toHaveLength(2)
        expect(stances[0]).not.toBe(stances[1])
        expect(['正方', '反方']).toContain(stances[0])
        expect(['正方', '反方']).toContain(stances[1])
      }
    }
    // 至少出现 2 种以上不同 team_ids 顺序（shuffle 行为）
    expect(orders.size).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================
// Task 10: test_mode & allow_repeat 测试
// ============================================================

describe('drawTopics: test_mode & allow_repeat', () => {
  beforeEach(() => {
    createSessionMock.mockClear()
    addLogMock.mockClear()
    listGroupsByEventMock.mockClear()
    listTeamsByEventMock.mockClear()
    // Task 10: 同步清理 applyExclusions / addTeamHistory / listTopics 调用记录
    listDrawnTopicIdsByEventMock.mockClear()
    listTeamHistoryMock.mockClear()
    addTeamHistoryMock.mockClear()
    topicRepoListTopicsMock.mockClear()
  })

  // ---------- test_mode=true 跳过 applyExclusions ----------

  it('test_mode=true 时跳过 applyExclusions（不调用 listDrawnTopicIdsByEvent 与 listTeamHistory）', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 2,
      include_stance: false,
      test_mode: true
    })

    // 验证 applyExclusions 内部调用的两个 repo 方法均未被调用
    expect(listDrawnTopicIdsByEventMock).not.toHaveBeenCalled()
    expect(listTeamHistoryMock).not.toHaveBeenCalled()

    // 仍然成功抽取
    expect(result.topics).toHaveLength(2)
  })

  it('test_mode 未传（默认 false）时调用 applyExclusions', () => {
    // 默认行为：applyExclusions 被调用（listDrawnTopicIdsByEvent 至少调用一次）
    drawTopics({
      event_id: 'event-1',
      topic_count: 2,
      include_stance: false
    })

    expect(listDrawnTopicIdsByEventMock).toHaveBeenCalled()
  })

  // ---------- test_mode=true 时 settings.is_test=true ----------

  it('test_mode=true 时 settings.is_test=true', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 2,
      include_stance: false,
      test_mode: true
    })

    expect(result.session.settings?.is_test).toBe(true)
  })

  it('test_mode 未传（默认 false）时 settings.is_test=false', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 2,
      include_stance: false
    })

    expect(result.session.settings?.is_test).toBe(false)
  })

  // ---------- test_mode=true 时 drawTopics 内不调用 addTeamHistory ----------

  it('test_mode=true 时 drawTopics 内不调用 eventRepo.addTeamHistory', () => {
    // 注：addTeamHistory 实际调用发生在 confirmDrawSession IPC handler，
    //     draw-engine 主函数本身不调用，此处验证该不变量
    drawTopics({
      event_id: 'event-1',
      topic_count: 2,
      include_stance: false,
      test_mode: true
    })

    expect(addTeamHistoryMock).not.toHaveBeenCalled()
  })

  // ---------- allow_repeat=true 且候选 2 道需要 4 道时返回 4 道 ----------

  it('allow_repeat=true 且候选 2 道需要 4 道时返回 4 道（可能含重复）', () => {
    // 临时覆盖 listTopics 返回 2 道题
    topicRepoListTopicsMock.mockImplementationOnce((filter?: any) => {
      let items = [...mockTopicsSmall]
      if (filter?.status) items = items.filter((t) => t.status === filter.status)
      return { items, total: items.length }
    })

    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 4,
      include_stance: false,
      allow_repeat: true
    })

    expect(result.topics).toHaveLength(4)
    // pool 只有 2 个元素，4 个结果必然有重复
    const uniqueIds = new Set(result.topics.map((t) => t.id))
    expect(uniqueIds.size).toBeLessThanOrEqual(2)
  })

  // ---------- allow_repeat=false 且候选不足时抛 InsufficientTopicsError ----------

  it('allow_repeat=false 且候选不足时抛 InsufficientTopicsError', () => {
    // 临时覆盖 listTopics 返回 2 道题
    topicRepoListTopicsMock.mockImplementationOnce((filter?: any) => {
      let items = [...mockTopicsSmall]
      if (filter?.status) items = items.filter((t) => t.status === filter.status)
      return { items, total: items.length }
    })

    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 4,
        include_stance: false,
        allow_repeat: false
      })
    ).toThrow(InsufficientTopicsError)
  })
})
