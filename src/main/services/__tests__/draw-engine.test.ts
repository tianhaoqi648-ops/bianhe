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
  topicRepoListTopicsMock,
  listTopicIdsByGroupMock,
  tgGetEventBankConfigMock,
  tgListGroupsByEventMock,
  tgListGroupsByRoundMock
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
  const listDrawnTopicIdsByEvent = vi.fn<() => string[]>(() => [])
  const listTeamHistory = vi.fn<(teamId: string) => Array<{ topic_id: string }>>(() => [])
  // Task 10: addTeamHistory 实际调用在 IPC 层，draw-engine 不应调用
  const addTeamHistory = vi.fn(() => undefined)

  // Task 10: 暴露 listTopics mock，便于 allow_repeat 测试临时覆盖返回 2 道题
  const listTopics = vi.fn((filter?: any) => {
    let items = [...topics]
    if (filter?.status) items = items.filter((t) => t.status === filter.status)
    return { items, total: items.length }
  })

  // T5: 抽题选库——按题组取 topic ids（默认全量，测试可覆盖为仅组内题）
  const listTopicIdsByGroup = vi.fn((_groupId: string) =>
    topics.map((t) => t.id)
  )

  // T2: 赛事选题模式配置（默认 single 未配置，保证未配置时全库候选）
  const tgGetEventBankConfig = vi.fn((_eventId: string): EventBankConfig => ({ mode: 'single' }))
  // T2: 事件绑定的题库（默认无绑定）
  const tgListGroupsByEvent = vi.fn((_eventId: string): TopicGroup[] => [])
  // T2: 轮次绑定的题库（默认无绑定）
  const tgListGroupsByRound = vi.fn((_roundId: string): TopicGroup[] => [])

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
    topicRepoListTopicsMock: listTopics,
    listTopicIdsByGroupMock: listTopicIdsByGroup,
    tgGetEventBankConfigMock: tgGetEventBankConfig,
    tgListGroupsByEventMock: tgListGroupsByEvent,
    tgListGroupsByRoundMock: tgListGroupsByRound
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

// ---- mock topic-group.repo（T5 抽题选库 + T2 选题模式解析）----
vi.mock('../../db/repository/topic-group.repo', () => ({
  topicGroupRepo: {
    listTopicIdsByGroup: listTopicIdsByGroupMock,
    getEventBankConfig: tgGetEventBankConfigMock,
    listGroupsByEvent: tgListGroupsByEventMock,
    listGroupsByRound: tgListGroupsByRoundMock
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
  resolveBankTopicIds,
  InsufficientTopicsError,
  applyExclusions,
  applyDifficultyOverride,
  applySourceMixRatio,
  selectTopics,
  assertSufficientTopics,
  buildSessionSettings,
  buildAuditDetail
} from '../draw-engine'
import {
  weightedRandomSelect,
  weightedRandomSelectWithReplacement,
  getDifficultyDistribution,
  coinFlip
} from '../probability'
import type { ResolveBankContext } from '../draw-engine'
import type { EventBankConfig, TopicGroup } from '../../db/repository/topic-group.repo'
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

// ============================================================
// T5 抽题选库：drawTopics 按题组（group_id）过滤候选
// ============================================================
describe('drawTopics: 抽题选库（group_id）', () => {
  beforeEach(() => {
    createSessionMock.mockClear()
    addLogMock.mockClear()
    listGroupsByEventMock.mockClear()
    listTeamsByEventMock.mockClear()
    listDrawnTopicIdsByEventMock.mockClear()
    listTeamHistoryMock.mockClear()
    addTeamHistoryMock.mockClear()
    topicRepoListTopicsMock.mockClear()
    listTopicIdsByGroupMock.mockClear()
    // 默认恢复全量候选（未覆盖时按原实现返回全部 topic ids）
    listTopicIdsByGroupMock.mockImplementation((groupId: string) =>
      // 组 id 含 'official' 标签则只返回官方题，便于测试观察
      groupId === 'group-official'
        ? ['topic-official-0', 'topic-official-1', 'topic-official-2', 'topic-official-3', 'topic-official-4']
        : ['topic-official-0', 'topic-official-1', 'topic-official-2', 'topic-official-3', 'topic-official-4', 'topic-custom-0', 'topic-custom-1', 'topic-custom-2', 'topic-custom-3', 'topic-custom-4']
    )
  })

  it('传 group_id → 仅组内题可作为候选（本次只从官方题中抽）', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 3,
      include_stance: false,
      group_id: 'group-official'
    })

    expect(listTopicIdsByGroupMock).toHaveBeenCalledWith('group-official')
    // 只从官方 5 道中抽 3 道
    expect(result.topics).toHaveLength(3)
    for (const t of result.topics) {
      expect(t.source_type).toBe('官方')
      expect(t.id.startsWith('topic-official-')).toBe(true)
    }
  })

  it('组内候选不足且 allow_repeat=false 时抛 InsufficientTopicsError（叠加受限）', () => {
    // 组内只有 2 道题，需要 4 道
    listTopicIdsByGroupMock.mockImplementationOnce(() => ['topic-official-0', 'topic-official-1'])

    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 4,
        include_stance: false,
        allow_repeat: false,
        group_id: 'group-official'
      })
    ).toThrow(InsufficientTopicsError)
  })

  it('组内候选不足但 allow_repeat=true 走有放回（仍然抽够 4 道且来自组内）', () => {
    // 组内只有 2 道题
    listTopicIdsByGroupMock.mockImplementationOnce(() => ['topic-official-0', 'topic-official-1'])

    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 4,
      include_stance: false,
      allow_repeat: true,
      group_id: 'group-official'
    })

    expect(result.topics).toHaveLength(4)
    const uniqueIds = new Set(result.topics.map((t) => t.id))
    // 有放回：仍来自组内这 2 道，必有重复
    expect(uniqueIds.size).toBeLessThanOrEqual(2)
    for (const t of result.topics) {
      expect(['topic-official-0', 'topic-official-1']).toContain(t.id)
    }
  })

  it('不传 group_id（默认）→ 不调用 listTopicIdsByGroup，行为不变（全库候选）', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 3,
      include_stance: false
    })

    expect(listTopicIdsByGroupMock).not.toHaveBeenCalled()
    expect(result.topics).toHaveLength(3)
  })
})

// ============================================================
// T2 多库选题模式解析（single/union/priority/by_round）
// ============================================================

// 构造纯函数用的注入 ctx（不依赖模块 mock，便于直接单测 resolveBankTopicIds）
function makeBankCtx(opts: {
  config?: EventBankConfig
  groupsByEvent?: string[]
  groupsByRound?: string[]
  topicsByGroup?: Record<string, string[]>
} = {}): ResolveBankContext {
  return {
    getEventBankConfig: () => opts.config ?? { mode: 'single' },
    listGroupsByEvent: () =>
      (opts.groupsByEvent ?? []).map((id) => ({ id, name: id, isDefault: false, createdAt: null })),
    listGroupsByRound: () =>
      (opts.groupsByRound ?? []).map((id) => ({ id, name: id, isDefault: false, createdAt: null })),
    listTopicIdsByGroup: (gid) => opts.topicsByGroup?.[gid] ?? []
  }
}

describe('resolveBankTopicIds 纯函数：多库选题模式解析', () => {
  it('single：取 priorityOrder[0] 的题库', () => {
    const ctx = makeBankCtx({
      config: { mode: 'single', priorityOrder: ['bankA', 'bankB'] },
      topicsByGroup: { bankA: ['t1', 't2'], bankB: ['t3'] }
    })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', topic_count: 9, include_stance: false },
      ctx
    )
    expect(ids).toEqual(['t1', 't2'])
  })

  it('single：无 priorityOrder 回退全库（null）', () => {
    const ctx = makeBankCtx({ config: { mode: 'single' } })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', topic_count: 3, include_stance: false },
      ctx
    )
    expect(ids).toBeNull()
  })

  it('union：事件绑定题库的并集（去重）', () => {
    const ctx = makeBankCtx({
      config: { mode: 'union' },
      groupsByEvent: ['bankA', 'bankB'],
      topicsByGroup: { bankA: ['t1', 't2'], bankB: ['t2', 't3'] }
    })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', topic_count: 9, include_stance: false },
      ctx
    )
    expect(ids).toEqual(['t1', 't2', 't3'])
  })

  it('union：事件无绑定题库时回退全库（null）', () => {
    const ctx = makeBankCtx({ config: { mode: 'union' }, groupsByEvent: [] })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', topic_count: 3, include_stance: false },
      ctx
    )
    expect(ids).toBeNull()
  })

  it('priority：前库不足时用下一库补足（达到题数即停）', () => {
    const ctx = makeBankCtx({
      config: { mode: 'priority', priorityOrder: ['bankA', 'bankB', 'bankC'] },
      topicsByGroup: { bankA: ['t1'], bankB: ['t2', 't3'], bankC: ['t4'] }
    })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', topic_count: 3, include_stance: false },
      ctx
    )
    // bankA 只有 1 题不足 3，补 bankB（2 题）后达到 3 → 不取 bankC
    expect(ids).toEqual(['t1', 't2', 't3'])
  })

  it('priority：首库已足则只取首库', () => {
    const ctx = makeBankCtx({
      config: { mode: 'priority', priorityOrder: ['bankA', 'bankB'] },
      topicsByGroup: { bankA: ['t1', 't2', 't3'], bankB: ['t4'] }
    })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', topic_count: 2, include_stance: false },
      ctx
    )
    expect(ids).toEqual(['t1', 't2', 't3'])
  })

  it('priority：无 priorityOrder 退化为 union（事件绑定并集）', () => {
    const ctx = makeBankCtx({
      config: { mode: 'priority' },
      groupsByEvent: ['bankA', 'bankB'],
      topicsByGroup: { bankA: ['t1'], bankB: ['t2'] }
    })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', topic_count: 9, include_stance: false },
      ctx
    )
    expect(ids).toEqual(['t1', 't2'])
  })

  it('by_round：命中 round 绑定的题库并集', () => {
    const ctx = makeBankCtx({
      config: { mode: 'by_round' },
      groupsByRound: ['bankA', 'bankB'],
      topicsByGroup: { bankA: ['t1'], bankB: ['t2'] }
    })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', round_id: 'round-1', topic_count: 9, include_stance: false },
      ctx
    )
    expect(ids).toEqual(['t1', 't2'])
  })

  it('by_round：无轮次绑定时退化为 single（priorityOrder[0]）', () => {
    const ctx = makeBankCtx({
      config: { mode: 'by_round', priorityOrder: ['bankA'] },
      topicsByGroup: { bankA: ['t1'] }
    })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', round_id: 'round-1', topic_count: 9, include_stance: false },
      ctx
    )
    expect(ids).toEqual(['t1'])
  })

  it('by_round：无轮次绑定且无 priorityOrder 时退化为 union', () => {
    const ctx = makeBankCtx({
      config: { mode: 'by_round' },
      groupsByEvent: ['bankA', 'bankB'],
      topicsByGroup: { bankA: ['t1'], bankB: ['t2'] }
    })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', round_id: 'round-1', topic_count: 9, include_stance: false },
      ctx
    )
    expect(ids).toEqual(['t1', 't2'])
  })

  it('by_round：无 round_id 走单库/并集回退，不按轮次解析', () => {
    const ctx = makeBankCtx({
      config: { mode: 'by_round', priorityOrder: ['bankA'] },
      topicsByGroup: { bankA: ['t1'] }
    })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', topic_count: 9, include_stance: false },
      ctx
    )
    expect(ids).toEqual(['t1'])
  })

  it('无效/缺省模式回退全库（null）', () => {
    const ctx = makeBankCtx({ config: { mode: 'single' } })
    const ids = resolveBankTopicIds(
      { event_id: 'e1', topic_count: 3, include_stance: false },
      ctx
    )
    expect(ids).toBeNull()
  })
})

describe('drawTopics: 多库选题模式（T2）', () => {
  beforeEach(() => {
    createSessionMock.mockClear()
    addLogMock.mockClear()
    listGroupsByEventMock.mockClear()
    listTeamsByEventMock.mockClear()
    listDrawnTopicIdsByEventMock.mockClear()
    listTeamHistoryMock.mockClear()
    addTeamHistoryMock.mockClear()
    topicRepoListTopicsMock.mockClear()
    listTopicIdsByGroupMock.mockClear()
    tgGetEventBankConfigMock.mockClear()
    tgListGroupsByEventMock.mockClear()
    tgListGroupsByRoundMock.mockClear()
    // 恢复各 mock 默认态
    tgGetEventBankConfigMock.mockReturnValue({ mode: 'single' })
    tgListGroupsByEventMock.mockReturnValue([])
    tgListGroupsByRoundMock.mockReturnValue([])
    listTopicIdsByGroupMock.mockReturnValue([
      'topic-official-0', 'topic-official-1', 'topic-official-2', 'topic-official-3', 'topic-official-4',
      'topic-custom-0', 'topic-custom-1', 'topic-custom-2', 'topic-custom-3', 'topic-custom-4'
    ])
  })

  it('single：未传 group_id 时按 priorityOrder[0] 过滤（仅官方题）', () => {
    tgGetEventBankConfigMock.mockReturnValue({ mode: 'single', priorityOrder: ['bankA'] })
    listTopicIdsByGroupMock.mockReturnValue(['topic-official-0', 'topic-official-1', 'topic-official-2'])

    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 3,
      include_stance: false
    })

    expect(listTopicIdsByGroupMock).toHaveBeenCalledWith('bankA')
    expect(result.topics).toHaveLength(3)
    for (const t of result.topics) expect(t.source_type).toBe('官方')
  })

  it('union：按事件绑定题库并集过滤（官方+自定义均在）', () => {
    tgGetEventBankConfigMock.mockReturnValue({ mode: 'union' })
    tgListGroupsByEventMock.mockReturnValue([
      { id: 'bankA', name: 'A库', isDefault: false, createdAt: null },
      { id: 'bankB', name: 'B库', isDefault: false, createdAt: null }
    ])

    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 3,
      include_stance: false
    })

    // listGroupsByEvent 与 listTopicIdsByGroup 均被调用
    expect(tgListGroupsByEventMock).toHaveBeenCalledWith('event-1')
    expect(listTopicIdsByGroupMock).toHaveBeenCalledWith('bankA')
    expect(listTopicIdsByGroupMock).toHaveBeenCalledWith('bankB')
    expect(result.topics).toHaveLength(3)
  })

  it('priority：前库不足时补后（只用足量的前几个库）', () => {
    tgGetEventBankConfigMock.mockReturnValue({ mode: 'priority', priorityOrder: ['bankA', 'bankB'] })
    // 首次调用 bankA 只给 2 道（官方），需要 4 道不足 → 补 bankB
    listTopicIdsByGroupMock.mockImplementation((gid: string) =>
      gid === 'bankA'
        ? ['topic-official-0', 'topic-official-1']
        : ['topic-official-2', 'topic-official-3', 'topic-custom-0', 'topic-custom-1']
    )

    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 4,
      include_stance: false
    })

    // 应同时用到 bankA 与 bankB
    expect(listTopicIdsByGroupMock).toHaveBeenCalledWith('bankA')
    expect(listTopicIdsByGroupMock).toHaveBeenCalledWith('bankB')
    expect(result.topics).toHaveLength(4)
  })

  it('by_round：命中 round 绑定的题库并集', () => {
    tgGetEventBankConfigMock.mockReturnValue({ mode: 'by_round' })
    tgListGroupsByRoundMock.mockReturnValue([
      { id: 'bankA', name: 'A库', isDefault: false, createdAt: null },
      { id: 'bankB', name: 'B库', isDefault: false, createdAt: null }
    ])

    const result = drawTopics({
      event_id: 'event-1',
      round_id: 'round-1',
      topic_count: 3,
      include_stance: false
    })

    expect(tgListGroupsByRoundMock).toHaveBeenCalledWith('round-1')
    expect(result.topics).toHaveLength(3)
  })

  it('缺省模式（single 无库）→ 未配置时行为与现状一致（全库候选，不限制题库）', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 3,
      include_stance: false
    })

    // 未配置 priorityOrder，single 回退全库：无需按题库过滤
    expect(listTopicIdsByGroupMock).not.toHaveBeenCalled()
    expect(result.topics).toHaveLength(3)
  })

  it('显式 group_id 优先：越过选题模式，仍按该题库单一过滤', () => {
    tgGetEventBankConfigMock.mockReturnValue({ mode: 'union', priorityOrder: ['bankOther'] })
    listTopicIdsByGroupMock.mockReturnValue(['topic-custom-0', 'topic-custom-1', 'topic-custom-2'])

    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 3,
      include_stance: false,
      group_id: 'bankExplicit'
    })

    expect(listTopicIdsByGroupMock).toHaveBeenCalledWith('bankExplicit')
    // 未触发 union 的 listGroupsByEvent
    expect(tgListGroupsByEventMock).not.toHaveBeenCalled()
    expect(result.topics).toHaveLength(3)
    for (const t of result.topics) expect(t.id.startsWith('topic-custom-')).toBe(true)
  })
})

// ============================================================
// Task 5.1：抽题引擎纯函数补齐（applyExclusions / applyDifficultyOverride /
//            applySourceMixRatio / 概率边界与统计合理性）
// ============================================================

function makePoolTopic(id: string, title: string, sourceType: string, difficulty = '进阶级'): Topic {
  return {
    id,
    title,
    type: null,
    domain: null,
    difficulty,
    source: null,
    source_type: sourceType,
    tags: null,
    weight: 1,
    status: 'active',
    batch_id: null,
    created_at: '',
    updated_at: ''
  }
}

describe('Task5.1: applyExclusions（不可重复 / 历史排除）', () => {
  beforeEach(() => {
    listDrawnTopicIdsByEventMock.mockClear()
    listTeamHistoryMock.mockClear()
    listDrawnTopicIdsByEventMock.mockReturnValue([])
    listTeamHistoryMock.mockReturnValue([])
  })

  it('排除本赛事已抽的辩题', () => {
    listDrawnTopicIdsByEventMock.mockReturnValue(['t1', 't2'])
    const candidates = [
      makePoolTopic('t1', '题1', '官方'),
      makePoolTopic('t2', '题2', '官方'),
      makePoolTopic('t3', '题3', '官方')
    ]
    const result = applyExclusions(candidates, { event_id: 'e1', topic_count: 3, include_stance: false })
    expect(result.map((t) => t.id)).toEqual(['t3'])
    expect(listDrawnTopicIdsByEventMock).toHaveBeenCalledWith('e1')
  })

  it('排除参与队伍的历史辩题（listTeamHistory 汇总 topic_id）', () => {
    listTeamHistoryMock.mockImplementation((_teamId: string) => [
      { topic_id: 't2' },
      { topic_id: 't4' }
    ])
    const candidates = [
      makePoolTopic('t1', '题1', '官方'),
      makePoolTopic('t2', '题2', '官方'),
      makePoolTopic('t3', '题3', '官方'),
      makePoolTopic('t4', '题4', '官方')
    ]
    const result = applyExclusions(candidates, {
      event_id: 'e1',
      topic_count: 4,
      include_stance: false,
      teams: [{ id: 'team-a' } as any, { id: 'team-b' } as any]
    })
    expect(result.map((t) => t.id)).toEqual(['t1', 't3'])
    // 每支队伍都查询一次历史
    expect(listTeamHistoryMock).toHaveBeenCalledTimes(2)
  })

  it('无队伍无历史时不排除任何题', () => {
    const candidates = [makePoolTopic('t1', '题1', '官方'), makePoolTopic('t2', '题2', '官方')]
    const result = applyExclusions(candidates, { event_id: 'e1', topic_count: 2, include_stance: false })
    expect(result.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(listTeamHistoryMock).not.toHaveBeenCalled()
  })
})

describe('Task5.1: applyDifficultyOverride（难度筛选）', () => {
  it('无 override / 无 round → 返回原候选池（不过滤难度）', () => {
    const candidates = [
      makePoolTopic('t1', '题1', '官方', '入门级'),
      makePoolTopic('t2', '题2', '官方', '进阶级')
    ]
    expect(applyDifficultyOverride(candidates, undefined, 2)).toBe(candidates)
    expect(applyDifficultyOverride(candidates, { id: 'r1' } as any, 2)).toBe(candidates)
  })

  it('决赛 override → 只抽专业级（分布 专业:1）', () => {
    const candidates = [
      makePoolTopic('t1', '题1', '官方', '入门级'),
      makePoolTopic('t2', '题2', '官方', '进阶级'),
      makePoolTopic('t3', '题3', '官方', '专业级'),
      makePoolTopic('t4', '题4', '官方', '专业级')
    ]
    const round = { id: 'r1', difficulty_override: '决赛' } as any
    const result = applyDifficultyOverride(candidates, round, 2)
    expect(result).toHaveLength(2)
    for (const t of result) expect(t.difficulty).toBe('专业级')
  })

  it('getDifficultyDistribution 关键词匹配', () => {
    expect(getDifficultyDistribution('小组赛')).toEqual({ 入门级: 0.6, 进阶级: 0.4, 专业级: 0 })
    expect(getDifficultyDistribution('半决赛')).toEqual({ 入门级: 0, 进阶级: 0.6, 专业级: 0.4 })
    expect(getDifficultyDistribution('总决赛')).toEqual({ 入门级: 0, 进阶级: 0, 专业级: 1 })
  })
})

describe('Task5.1: applySourceMixRatio（来源比例分层抽样）', () => {
  function pool(official: number, custom: number): Topic[] {
    const r: Topic[] = []
    for (let i = 0; i < official; i++) r.push(makePoolTopic(`o-${i}`, `官方题${i}`, '官方'))
    for (let i = 0; i < custom; i++) r.push(makePoolTopic(`c-${i}`, `自定义题${i}`, '自定义'))
    return r
  }

  it('count <= 0 返回空', () => {
    const res = applySourceMixRatio(pool(5, 5), { official: 0.5, custom: 0.5 }, 0)
    expect(res.picked).toEqual([])
    expect(res.actualRatio).toEqual({ official: 0, custom: 0 })
  })

  it('按 0.5/0.5 抽偶数数量 → 官方/自定义各半', () => {
    const res = applySourceMixRatio(pool(10, 10), { official: 0.5, custom: 0.5 }, 4)
    expect(res.picked).toHaveLength(4)
    const officialCount = res.picked.filter((t) => t.source_type === '官方').length
    const customCount = res.picked.length - officialCount
    expect(officialCount).toBe(2)
    expect(customCount).toBe(2)
  })

  it('子池不足时从另一子池补足（总量仍达标）', () => {
    // 官方仅 1 题，需要 4 题 → 不足部分由自定义补足
    const res = applySourceMixRatio(pool(1, 10), { official: 0.7, custom: 0.3 }, 4)
    expect(res.picked).toHaveLength(4)
  })

  it('空候选池返回空', () => {
    const res = applySourceMixRatio([], { official: 0.5, custom: 0.5 }, 3)
    expect(res.picked).toEqual([])
    expect(res.actualRatio).toEqual({ official: 0, custom: 0 })
  })
})

describe('Task5.1: 概率边界数量（0 / 1 / N）', () => {
  const items = [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 1 },
    { id: 'c', weight: 1 },
    { id: 'd', weight: 1 }
  ]

  it('weightedRandomSelect count=0 → []', () => {
    expect(weightedRandomSelect(items, 0)).toEqual([])
  })

  it('weightedRandomSelect count=1 → 1 个', () => {
    expect(weightedRandomSelect(items, 1)).toHaveLength(1)
  })

  it('weightedRandomSelect count >= 池大小 → 返回全部（打乱）', () => {
    const res = weightedRandomSelect(items, 4)
    expect(res).toHaveLength(4)
    expect(new Set(res.map((x) => x.id)).size).toBe(4)
  })

  it('weightedRandomSelect 空池抛错', () => {
    expect(() => weightedRandomSelect([], 1)).toThrow('候选池为空')
  })

  it('weightedRandomSelectWithReplacement count 可大于池大小（有放回）', () => {
    const res = weightedRandomSelectWithReplacement(items, 10)
    expect(res).toHaveLength(10)
  })

  it('weightedRandomSelectWithReplacement 空池/零数 → []', () => {
    expect(weightedRandomSelectWithReplacement([], 3)).toEqual([])
    expect(weightedRandomSelectWithReplacement(items, 0)).toEqual([])
  })
})

describe('Task5.1: 随机概率基本合理（统计近似）', () => {
  it('加权抽取符合权重占比（放宽容差，随机性伴随小抖动）', () => {
    // A 权重 1，B 权重 3，单次抽 1，A 理论约 25%
    const items = [
      { id: 'A', weight: 1 },
      { id: 'B', weight: 3 }
    ]
    const N = 4000
    let aCount = 0
    for (let i = 0; i < N; i++) {
      const picked = weightedRandomSelect(items, 1)
      if (picked[0].id === 'A') aCount++
    }
    const ratio = aCount / N
    expect(ratio).toBeGreaterThan(0.18) // 距 0.25 允许 ±0.07
    expect(ratio).toBeLessThan(0.32)
  })

  it('等权重多轮抽取各自均有机会命中', () => {
    const items = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 1 }
    ]
    const hit = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const picked = weightedRandomSelect(items, 1)
      hit.add(picked[0].id)
    }
    // 3 个元素在 300 轮里应都被抽到过
    expect(hit.size).toBe(3)
  })

  it('coinFlip 约各半（统计近似）', () => {
    const N = 2000
    let t = 0
    for (let i = 0; i < N; i++) if (coinFlip()) t++
    const ratio = t / N
    expect(ratio).toBeGreaterThan(0.4)
    expect(ratio).toBeLessThan(0.6)
  })
})

// ============================================================
// Task 11: Selection Stage 纯函数（selectTopics）+ 题池校验（assertSufficientTopics）
// ============================================================

describe('Task11: selectTopics（Selection Stage 加权随机/去重）', () => {
  function makeTopics(n: number): Topic[] {
    return Array.from({ length: n }, (_, i) => makePoolTopic(`sel-${i}`, `题${i}`, '官方'))
  }

  it('普通模式：无放回加权抽取，结果不重复', () => {
    const pool = makeTopics(6)
    const picked = selectTopics(pool, 4)
    expect(picked).toHaveLength(4)
    expect(new Set(picked.map((t) => t.id)).size).toBe(4)
    // 全部来自候选池
    for (const t of picked) {
      expect(pool.map((p) => p.id)).toContain(t.id)
    }
  })

  it('allowRepeat=true 且无 sourceMixConsumed：有放回可抽超池数量', () => {
    const pool = makeTopics(2)
    const picked = selectTopics(pool, 4, { allowRepeat: true })
    expect(picked).toHaveLength(4)
    // 有放回：总量 4 但唯一 id ≤ 2
    expect(new Set(picked.map((t) => t.id)).size).toBeLessThanOrEqual(2)
  })

  it('sourceMixConsumed=true：直接截取前 count 道，不二次抽样', () => {
    const pool = makeTopics(5)
    const picked = selectTopics(pool, 3, {
      sourceMixConsumed: true,
      allowRepeat: true
    })
    expect(picked).toHaveLength(3)
    expect(picked.map((t) => t.id)).toEqual(['sel-0', 'sel-1', 'sel-2'])
  })

  it('allowRepeat=true + sourceMixConsumed=true：截取且不重复抽样', () => {
    const pool = makeTopics(2)
    // 即使 allowRepeat，sourceMixConsumed 时也仅截取池内经来源比例抽样后的结果
    const picked = selectTopics(pool, 2, { allowRepeat: true, sourceMixConsumed: true })
    expect(picked).toHaveLength(2)
  })

  it('普通模式 count=0 → 空数组', () => {
    expect(selectTopics(makeTopics(3), 0)).toEqual([])
  })

  it('普通模式 count=池大小 → 返回全部（去重）', () => {
    const picked = selectTopics(makeTopics(4), 4)
    expect(new Set(picked.map((t) => t.id)).size).toBe(4)
  })
})

describe('Task11: assertSufficientTopics（题池充足性 gate）', () => {
  function makeTopics(n: number): Topic[] {
    return Array.from({ length: n }, (_, i) => makePoolTopic(`g-${i}`, `题${i}`, '官方'))
  }

  it('候选充足且允许重复：不抛错', () => {
    expect(() => assertSufficientTopics(makeTopics(3), 2, true)).not.toThrow()
    expect(() => assertSufficientTopics(makeTopics(5), 2, false)).not.toThrow()
  })

  it('候选不足且不允许重复：抛 InsufficientTopicsError', () => {
    expect(() => assertSufficientTopics(makeTopics(2), 4, false)).toThrow(
      InsufficientTopicsError
    )
  })

  it('候选不足但 allowRepeat=true：跳过检查不抛错', () => {
    expect(() => assertSufficientTopics(makeTopics(2), 4, true)).not.toThrow()
  })

  it('未传 allowRepeat（默认 false）：不足时抛错', () => {
    expect(() => assertSufficientTopics(makeTopics(2), 4)).toThrow(
      InsufficientTopicsError
    )
  })

  it('错误携带候选/需求数量信息', () => {
    try {
      assertSufficientTopics(makeTopics(2), 5, false)
      // 不应走到这里
      expect(true).toBe(false)
    } catch (e) {
      const err = e as InsufficientTopicsError
      expect(err.candidateCount).toBe(2)
      expect(err.requiredCount).toBe(5)
    }
  })
})

// ============================================================
// Task 11: Persistence 数据准备纯函数（settings / audit detail）
// ============================================================

describe('Task11: buildSessionSettings（Persistence settings 准备）', () => {
  const base = {
    event_id: 'event-1',
    round_id: 'round-1',
    topic_count: 3,
    include_stance: true,
    draw_mode: 'versus' as const,
    teams_per_topic: null,
    is_test: false,
    allow_repeat: false
  }

  it('versus 模式：group_ids 置空、teams_per_topic 置空', () => {
    const s = buildSessionSettings({ ...base, group_ids: ['g1'] })
    expect(s.group_ids).toBeNull()
    expect(s.teams_per_topic).toBeNull()
    expect(s.round_difficulty_override).toBeNull()
  })

  it('group 模式：保留 group_ids、teams_per_topic 置空', () => {
    const s = buildSessionSettings({ ...base, draw_mode: 'group', group_ids: ['g1', 'g2'] })
    expect(s.group_ids).toEqual(['g1', 'g2'])
    expect(s.teams_per_topic).toBeNull()
  })

  it('multi_team 模式：teams_per_topic 生效、group_ids 置空', () => {
    const s = buildSessionSettings({ ...base, draw_mode: 'multi_team', teams_per_topic: 3 })
    expect(s.teams_per_topic).toBe(3)
    expect(s.group_ids).toBeNull()
  })

  it('透传实际比例、难度 override、测试/重复标记', () => {
    const s = buildSessionSettings({
      ...base,
      actual_ratio: { official: 0.7, custom: 0.3 },
      round_difficulty_override: '决赛',
      source_mix_ratio: { official: 0.7, custom: 0.3 },
      solo_team_id: 'solo-1',
      is_test: true,
      allow_repeat: true
    })
    expect(s.actual_ratio).toEqual({ official: 0.7, custom: 0.3 })
    expect(s.source_mix_ratio).toEqual({ official: 0.7, custom: 0.3 })
    expect(s.round_difficulty_override).toBe('决赛')
    expect(s.solo_team_id).toBe('solo-1')
    expect(s.is_test).toBe(true)
    expect(s.allow_repeat).toBe(true)
  })
})

describe('Task11: buildAuditDetail（Persistence 审计 detail 准备）', () => {
  const base = {
    event_id: 'event-1',
    round_id: 'round-1',
    topic_count: 3,
    include_stance: true,
    team_count: 0,
    picked_topic_ids: ['t1', 't2', 't3'],
    session_id: 'session-1',
    draw_mode: 'versus' as const,
    teams_per_topic: null,
    is_test: false,
    allow_repeat: false
  }

  it('versus：group_ids/teams_per_topic 置空，保留 picked_topic_ids', () => {
    const d = buildAuditDetail({ ...base, team_count: 4 })
    expect(d.group_ids).toBeNull()
    expect(d.teams_per_topic).toBeNull()
    expect(d.picked_topic_ids).toEqual(['t1', 't2', 't3'])
    expect(d.team_count).toBe(4)
    expect(d.session_id).toBe('session-1')
  })

  it('group：保留 group_ids', () => {
    const d = buildAuditDetail({ ...base, draw_mode: 'group', group_ids: ['g1'] })
    expect(d.group_ids).toEqual(['g1'])
    expect(d.teams_per_topic).toBeNull()
  })

  it('multi_team：teams_per_topic 生效', () => {
    const d = buildAuditDetail({ ...base, draw_mode: 'multi_team', teams_per_topic: 3 })
    expect(d.teams_per_topic).toBe(3)
    expect(d.group_ids).toBeNull()
  })

  it('透传实际比例/难度/测试/重复标记', () => {
    const d = buildAuditDetail({
      ...base,
      actual_ratio: { official: 0.5, custom: 0.5 },
      source_mix_ratio: { official: 0.5, custom: 0.5 },
      is_test: true,
      allow_repeat: true,
      solo_team_id: 'solo-1'
    })
    expect(d.actual_ratio).toEqual({ official: 0.5, custom: 0.5 })
    expect(d.source_mix_ratio).toEqual({ official: 0.5, custom: 0.5 })
    expect(d.is_test).toBe(true)
    expect(d.allow_repeat).toBe(true)
    expect(d.solo_team_id).toBe('solo-1')
  })
})
