// ============================================================
// smoke.test.ts — 端到端冒烟测试（不依赖真实数据库）
//
// 由于 better-sqlite3 原生模块为 Electron (ABI 125) 编译，
// 在 Node.js (ABI 127) 下 vitest 无法直接加载。
// 因此本冒烟测试分为两部分：
//
// 1. 纯服务测试（不依赖 db）：
//    - probability: weightedRandomSelect
//    - import-engine: parseFile (CSV/XLSX/DOCX fixtures)
//    - dedup-engine: findDuplicates
//
// 2. draw-engine 测试（mock 4 个 repository）：
//    - 验证 drawTopics 编排顺序、参数传递、边界处理
//    - 验证 InsufficientTopicsError 抛出条件
//    - 验证持方分配的队伍数量校验
//
// 真实的数据库集成测试需要在 Electron 环境下运行
// （npm run dev 后通过 IPC 调用验证）。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

// ============================================================
// Part 1: 纯服务测试（不需要 mock）
// ============================================================

import { weightedRandomSelect } from '../probability'
import { findDuplicates } from '../dedup-engine'
import { parseFile } from '../import-engine'
import type { Topic } from '../../db/repository/topic.repo'

const FIXTURES_DIR = path.join(__dirname, 'fixtures')

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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

describe('Part 1: 纯服务冒烟测试', () => {
  // ---- probability ----
  describe('probability: weightedRandomSelect', () => {
    it('按权重抽取指定数量', () => {
      const items = [
        { weight: 1, id: 'a' },
        { weight: 9, id: 'b' },
        { weight: 0, id: 'zero' }
      ]
      const result = weightedRandomSelect(items, 2)
      expect(result).toHaveLength(2)
      // weight=0 的 'zero' 永不应被抽到
      expect(result.map((r) => r.id)).not.toContain('zero')
    })

    it('空池抛错', () => {
      expect(() => weightedRandomSelect([], 1)).toThrow('候选池为空')
    })

    it('count >= 池大小返回全部', () => {
      const items = [
        { weight: 1, id: 'a' },
        { weight: 1, id: 'b' }
      ]
      const result = weightedRandomSelect(items, 5)
      expect(result).toHaveLength(2)
    })

    it('count <= 0 返回空', () => {
      const items = [{ weight: 1, id: 'a' }]
      expect(weightedRandomSelect(items, 0)).toEqual([])
      expect(weightedRandomSelect(items, -1)).toEqual([])
    })
  })

  // ---- import-engine ----
  describe('import-engine: parseFile', () => {
    it('解析 fixtures/topics.csv', async () => {
      const filePath = path.join(FIXTURES_DIR, 'topics.csv')
      const result = await parseFile(filePath, 'csv')

      expect(result.topics.length).toBeGreaterThan(0)
      // 表头映射正确
      expect(result.mapping['标题']).toBe('title')
      expect(result.mapping['类型']).toBe('type')
      // 第一条数据完整
      const first = result.topics[0]
      expect(first.title).toBeTruthy()
      expect(first.title.length).toBeGreaterThan(0)
      expect(first.source_type).toBe('自定义')
    })

    it('解析 fixtures/topics.xlsx', async () => {
      const filePath = path.join(FIXTURES_DIR, 'topics.xlsx')
      const result = await parseFile(filePath, 'xlsx')
      expect(result.topics.length).toBeGreaterThan(0)
    })

    it('解析 fixtures/topics-table.docx', async () => {
      const filePath = path.join(FIXTURES_DIR, 'topics-table.docx')
      const result = await parseFile(filePath, 'docx')
      expect(result.topics.length).toBeGreaterThanOrEqual(2)
      expect(result.topics[0].title).toBeTruthy()
    })

    it('文件不存在抛错', async () => {
      await expect(parseFile('nonexistent.xlsx', 'xlsx')).rejects.toThrow('文件不存在')
    })

    it('不支持的文件类型抛错', async () => {
      const filePath = path.join(FIXTURES_DIR, 'topics.csv')
      await expect(parseFile(filePath, 'pdf' as any)).rejects.toThrow('不支持的文件类型')
    })
  })

  // ---- dedup-engine ----
  describe('dedup-engine: findDuplicates', () => {
    it('检测出完全相同的辩题对', async () => {
      const topics = [
        makeTopic('d-1', '人工智能是否应该被禁止'),
        makeTopic('d-2', '人工智能是否应该被禁止'),
        makeTopic('d-3', '完全无关的另一道辩题')
      ]
      const groups = await findDuplicates(topics)
      expect(groups).toHaveLength(1)
      expect(groups[0].reason).toBe('exact')
      expect(groups[0].similarity).toBe(1.0)
      expect(groups[0].topics).toHaveLength(2)
    })

    it('空数组返回空', async () => {
      expect(await findDuplicates([])).toEqual([])
    })

    it('AI 语义层 mock', async () => {
      const topics = [
        makeTopic('1', '辩题一'),
        makeTopic('2', '辩题二')
      ]
      const groups = await findDuplicates(topics, {
        similarityFn: async () => 0.92
      })
      expect(groups).toHaveLength(1)
      expect(groups[0].reason).toBe('ai')
    })
  })
})

// ============================================================
// Part 2: draw-engine 测试（mock repository）
// ============================================================

// ---- 使用 vi.hoisted 提升 mock 数据与函数，避免 vi.mock factory 中的 TDZ ----
const { mockTopics, createSessionMock, addLogMock } = vi.hoisted(() => {
  const topics = [
    // 5 道入门级 + 5 道进阶级，6 官方 + 4 自定义
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `topic-entry-${i}`,
      title: `冒烟辩题-入门-${i}`,
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
      id: `topic-inter-${i}`,
      title: `冒烟辩题-进阶-${i}`,
      type: '价值辩',
      domain: '科技伦理',
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

  return { mockTopics: topics, createSessionMock: createSession, addLogMock: addLog }
})

// ---- mock topic.repo ----
vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: {
    listTopics: vi.fn((filter?: any) => {
      let items = [...mockTopics]
      if (filter?.status) items = items.filter((t) => t.status === filter.status)
      if (filter?.difficulty) items = items.filter((t) => t.difficulty === filter.difficulty)
      if (filter?.source_type) items = items.filter((t) => t.source_type === filter.source_type)
      return { items, total: items.length }
    })
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
    listTeamHistory: vi.fn(() => [])
  }
}))

// ---- mock draw.repo ----
vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: {
    createSession: createSessionMock,
    listDrawnTopicIdsByEvent: vi.fn(() => []) // 默认无已抽
  }
}))

// ---- mock audit.repo ----
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    addLog: addLogMock
  }
}))

// ---- 现在 import draw-engine（会在加载时使用上面的 mock）----
import { drawTopics, InsufficientTopicsError } from '../draw-engine'

describe('Part 2: draw-engine 冒烟测试（mock repository）', () => {
  beforeEach(() => {
    // 每个测试前重置 mock 调用记录
    createSessionMock.mockClear()
    addLogMock.mockClear()
  })

  it('完整抽取流程：include_stance=false', () => {
    const result = drawTopics({
      event_id: 'event-1',
      round_id: 'round-1',
      topic_count: 3,
      include_stance: false,
      operator: 'tester'
    })

    expect(result).toBeDefined()
    expect(result.topics).toHaveLength(3)
    expect(result.session).toBeDefined()
    expect(result.session.items).toHaveLength(3)

    // 验证 createSession 被调用
    expect(createSessionMock).toHaveBeenCalledTimes(1)
    const sessionInput = createSessionMock.mock.calls[0][0]
    expect(sessionInput.event_id).toBe('event-1')
    expect(sessionInput.items).toHaveLength(3)
    // include_stance=false → 持方为 null
    for (const item of sessionInput.items) {
      expect(item.team_a_id).toBeNull()
      expect(item.team_b_id).toBeNull()
      expect(item.stance_a).toBeNull()
      expect(item.stance_b).toBeNull()
    }

    // 验证 audit addLog 被调用
    expect(addLogMock).toHaveBeenCalledTimes(1)
    const logInput = (addLogMock.mock.calls as Array<Array<any>>)[0][0]
    expect(logInput.action).toBe('draw')
    expect(logInput.target_type).toBe('session')
    expect(logInput.operator).toBe('tester')
    expect(logInput.detail.topic_count).toBe(3)
    expect(logInput.detail.session_id).toBe('session-mock-1')
    expect(logInput.detail.picked_topic_ids).toHaveLength(3)
  })

  it('完整抽取流程：include_stance=true + 4 队伍', () => {
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
      operator: 'tester'
    })

    expect(result.topics).toHaveLength(2)
    expect(result.session.items).toHaveLength(2)

    // 每个 item 应有队伍配对与持方分配
    for (const item of result.session.items) {
      expect(item.team_a_id).toBeTruthy()
      expect(item.team_b_id).toBeTruthy()
      expect(item.stance_a).toMatch(/正方|反方/)
      expect(item.stance_b).toMatch(/正方|反方/)
      expect(item.stance_a).not.toBe(item.stance_b)
    }
  })

  it('题池不足抛 InsufficientTopicsError', () => {
    // mockTopics 共 10 条，要求 100 → 必然不足
    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 100,
        include_stance: false,
        operator: 'tester'
      })
    ).toThrow(InsufficientTopicsError)

    // 抛错时不应写库
    expect(createSessionMock).not.toHaveBeenCalled()
    expect(addLogMock).not.toHaveBeenCalled()
  })

  it('include_stance=true 但队伍数量为奇数抛错', () => {
    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: true,
        teams: [
          { id: 'team-1', name: '队伍一', event_id: 'event-1' },
          { id: 'team-2', name: '队伍二', event_id: 'event-1' },
          { id: 'team-3', name: '队伍三', event_id: 'event-1' }
        ],
        operator: 'tester'
      })
    ).toThrow('队伍数量必须为 ≥2 的偶数')
  })

  it('include_stance=true 但 teams 为空抛错', () => {
    expect(() =>
      drawTopics({
        event_id: 'event-1',
        topic_count: 1,
        include_stance: true,
        teams: [],
        operator: 'tester'
      })
    ).toThrow('队伍数量必须为 ≥2 的偶数')
  })

  it('单题抽取正常', () => {
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 1,
      include_stance: false,
      operator: 'tester'
    })
    expect(result.topics).toHaveLength(1)
    expect(result.session.items).toHaveLength(1)
  })

  it('source_mix_ratio 题源混合比例生效', () => {
    // 6 官方 + 4 自定义，要求 5 道，比例 0.6/0.4
    // 官方目标 = floor(5*0.6) = 3，自定义目标 = 2
    const result = drawTopics({
      event_id: 'event-1',
      topic_count: 5,
      include_stance: false,
      source_mix_ratio: { official: 0.6, custom: 0.4 },
      operator: 'tester'
    })

    expect(result.topics).toHaveLength(5)
    expect(result.actual_ratio).toBeDefined()
    // 验证实际比例计算
    const officialCount = result.topics.filter((t) => t.source_type === '官方').length
    const customCount = result.topics.filter((t) => t.source_type !== '官方').length
    expect(officialCount + customCount).toBe(5)
    expect(result.actual_ratio!.official).toBeCloseTo(officialCount / 5, 5)
    expect(result.actual_ratio!.custom).toBeCloseTo(customCount / 5, 5)
  })
})
