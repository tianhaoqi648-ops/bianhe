import { describe, it, expect } from 'vitest'
import {
  mergeGroupTopics,
  markDrawn,
  countDrawn,
  allowRepeatFromEvent,
  allowRepeatToFlag,
  filterEventTopics,
  buildQuickCreateInput,
  canUnbindEventGroup,
  buildEventBankConfig,
  planRoundBankSync,
  computeBankBindConflicts,
  type EventTopicItem
} from '../eventTopicBank'
import type { GroupTopic } from '../../../../shared/types'

const makeTopic = (id: string, title = `辩题${id}`): GroupTopic => ({
  id,
  title,
  type: null,
  domain: null,
  difficulty: null,
  source: null,
  source_type: null,
  tags: null,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z'
})

describe('mergeGroupTopics', () => {
  it('合并多个题组并保留顺序', () => {
    const a = [makeTopic('1'), makeTopic('2')]
    const b = [makeTopic('3')]
    const merged = mergeGroupTopics([a, b])
    expect(merged.map((t) => t.id)).toEqual(['1', '2', '3'])
  })

  it('跨组同 id 辩题去重（保留首次出现）', () => {
    const a = [makeTopic('1'), makeTopic('2')]
    const b = [makeTopic('2'), makeTopic('4')]
    const merged = mergeGroupTopics([a, b])
    expect(merged.map((t) => t.id)).toEqual(['1', '2', '4'])
    expect(merged).toHaveLength(3)
  })

  it('空输入 / 空数组不报错', () => {
    expect(mergeGroupTopics([])).toEqual([])
    expect(mergeGroupTopics([[], []])).toEqual([])
  })
})

describe('markDrawn', () => {
  it('命中已抽，未命中未抽', () => {
    const topics = [makeTopic('1'), makeTopic('2'), makeTopic('3')]
    const items = markDrawn(topics, ['1', '3'])
    expect(items.map((i) => [i.id, i.drawn])).toEqual([
      ['1', true],
      ['2', false],
      ['3', true]
    ])
  })

  it('空已抽集合 → 全部未抽', () => {
    const items = markDrawn([makeTopic('1')], [])
    expect(items[0].drawn).toBe(false)
  })

  it('保留原字段结构', () => {
    const t = makeTopic('1')
    const items = markDrawn([t], ['1'])
    expect(items[0]).toMatchObject({ id: '1', title: t.title, drawn: true })
  })
})

describe('countDrawn', () => {
  it('统计已抽题数', () => {
    const items: EventTopicItem[] = [
      { ...makeTopic('1'), drawn: true },
      { ...makeTopic('2'), drawn: false },
      { ...makeTopic('3'), drawn: true }
    ]
    expect(countDrawn(items)).toBe(2)
  })

  it('空列表返回 0', () => {
    expect(countDrawn([])).toBe(0)
  })
})

describe('filterEventTopics', () => {
  const mkItem = (over = {}): EventTopicItem => ({
    ...makeTopic('1'),
    drawn: false,
    type: '立论',
    domain: '社会',
    difficulty: '中',
    status: 'active',
    tags: ['热点'],
    ...over
  })

  it('无条件返回全部', () => {
    const list = [mkItem({ id: '1' }), mkItem({ id: '2', title: '辩题二' })]
    expect(filterEventTopics(list, {})).toHaveLength(2)
  })

  it('关键词子串匹配（忽略大小写与首尾空白）', () => {
    const list = [mkItem({ title: '人工智能伦理' }), mkItem({ title: '科技发展' })]
    expect(filterEventTopics(list, { keyword: '  人工智能  ' })).toHaveLength(1)
    expect(filterEventTopics(list, { keyword: 'AI' })).toHaveLength(0)
  })

  it('维度筛选取交集', () => {
    const list = [
      mkItem({ id: '1', type: '立论', domain: '社会' }),
      mkItem({ id: '2', type: '质询', domain: '社会' }),
      mkItem({ id: '3', type: '立论', domain: '教育' })
    ]
    expect(filterEventTopics(list, { type: '立论' })).toHaveLength(2)
    expect(filterEventTopics(list, { type: '立论', domain: '社会' })).toHaveLength(1)
  })

  it('状态筛选', () => {
    const list = [mkItem({ id: '1', status: 'active' }), mkItem({ id: '2', status: 'blacklisted' })]
    expect(filterEventTopics(list, { status: 'blacklisted' })).toHaveLength(1)
  })

  it('标签筛选（命中即显示）', () => {
    const list = [mkItem({ id: '1', tags: ['热点', '社会'] }), mkItem({ id: '2', tags: null })]
    expect(filterEventTopics(list, { tag: '热点' })).toHaveLength(1)
    expect(filterEventTopics(list, { tag: '不存在' })).toHaveLength(0)
  })

  it('泛型：直接传入无 drawn 字段的全局 Topic 结构也可筛选', () => {
    const list = [
      { ...makeTopic('1'), type: '立论', tags: ['热点'], status: 'active' },
      { ...makeTopic('2'), type: '质询', tags: null, status: 'blacklisted' }
    ]
    expect(filterEventTopics(list, { type: '立论' })).toHaveLength(1)
    expect(filterEventTopics(list, { tag: '热点' })).toHaveLength(1)
  })
})

describe('buildQuickCreateInput（页内快速新建辩题草稿 → 全局题库入参）', () => {
  it('标题去首尾空白', () => {
    expect(buildQuickCreateInput({ title: '  人工智能伦理  ' }).title).toBe('人工智能伦理')
  })

  it('标签按中英文逗号切分、去空白去空项；无标签写 null', () => {
    const input = buildQuickCreateInput({ title: 'x', tags: ' 热点，社会, , 教育' })
    expect(input.tags).toEqual(['热点', '社会', '教育'])
    expect(buildQuickCreateInput({ title: 'x', tags: '  ' }).tags).toBeNull()
    expect(buildQuickCreateInput({ title: 'x' }).tags).toBeNull()
  })

  it('类型/领域/难度为空归一化为 null', () => {
    expect(
      buildQuickCreateInput({ title: 'x', type: '', domain: undefined, difficulty: null })
    ).toMatchObject({ type: null, domain: null, difficulty: null })
  })

  it('保留填写值', () => {
    expect(
      buildQuickCreateInput({
        title: 'x',
        type: '立论',
        domain: '社会',
        difficulty: '高',
        tags: '热点'
      })
    ).toMatchObject({ title: 'x', type: '立论', domain: '社会', difficulty: '高', tags: ['热点'] })
  })
})

describe('canUnbindEventGroup', () => {
  it('多绑定时可解绑其中一个', () => {
    expect(canUnbindEventGroup(['a', 'b'], 'a')).toBe(true)
  })

  it('仅剩一个绑定时不可解绑（至少保留一个）', () => {
    expect(canUnbindEventGroup(['a'], 'a')).toBe(false)
  })

  it('空集合不满足守卫', () => {
    expect(canUnbindEventGroup([], 'a')).toBe(false)
    expect(canUnbindEventGroup([], undefined)).toBe(false)
  })
})

describe('allowRepeat 开关映射', () => {
  it('allowRepeatFromEvent 正确识别 1/0/undefined', () => {
    expect(allowRepeatFromEvent(1)).toBe(true)
    expect(allowRepeatFromEvent(0)).toBe(false)
    expect(allowRepeatFromEvent(undefined)).toBe(false)
  })

  it('allowRepeatToFlag 布尔 → 1/0', () => {
    expect(allowRepeatToFlag(true)).toBe(1)
    expect(allowRepeatToFlag(false)).toBe(0)
  })
})

describe('buildEventBankConfig（选题模式草稿 → 可写配置）', () => {
  it('single：priorityOrder 仅取首库', () => {
    const cfg = buildEventBankConfig({
      mode: 'single',
      priorityGroupIds: ['a', 'b'],
      roundBanks: {}
    })
    expect(cfg).toEqual({ mode: 'single', priorityOrder: ['a'] })
  })

  it('single：未选库时只写 mode（回退全库）', () => {
    expect(buildEventBankConfig({ mode: 'single', priorityGroupIds: [], roundBanks: {} })).toEqual({
      mode: 'single'
    })
  })

  it('priority：全序保留', () => {
    const cfg = buildEventBankConfig({
      mode: 'priority',
      priorityGroupIds: ['b', 'a', '', 'c'],
      roundBanks: {}
    })
    expect(cfg).toEqual({ mode: 'priority', priorityOrder: ['b', 'a', 'c'] })
  })

  it('union：无附加字段', () => {
    expect(
      buildEventBankConfig({ mode: 'union', priorityGroupIds: ['a'], roundBanks: {} })
    ).toEqual({ mode: 'union' })
  })

  it('by_round：roundBanks 去重保序并剔除空 id', () => {
    const cfg = buildEventBankConfig({
      mode: 'by_round',
      priorityGroupIds: [],
      roundBanks: { r1: ['a', 'b', 'a', ''], r2: ['c'] }
    })
    expect(cfg).toEqual({ mode: 'by_round', roundBanks: { r1: ['a', 'b'], r2: ['c'] } })
  })
})

describe('computeBankBindConflicts（T6 中途换库重复提醒）', () => {
  it('无交集时无冲突', () => {
    const report = computeBankBindConflicts(
      [
        { id: 'a', name: '库A', topicIds: ['1', '2'] },
        { id: 'b', name: '库B', topicIds: ['3'] }
      ],
      ['9', '8']
    )
    expect(report.hasConflict).toBe(false)
    expect(report.conflicts).toEqual([])
    expect(report.total).toBe(0)
  })

  it('命中已抽题：按库分组并给出冲突题 id', () => {
    const report = computeBankBindConflicts(
      [
        { id: 'a', name: '库A', topicIds: ['1', '2', '3'] },
        { id: 'b', name: '库B', topicIds: ['2', '4'] },
        { id: 'c', name: '库C', topicIds: ['5'] }
      ],
      ['2', '4']
    )
    expect(report.hasConflict).toBe(true)
    expect(report.conflicts).toHaveLength(2)
    expect(report.conflicts[0]).toEqual({
      groupId: 'a',
      groupName: '库A',
      drawnIds: ['2'],
      count: 1
    })
    expect(report.conflicts[1]).toEqual({
      groupId: 'b',
      groupName: '库B',
      drawnIds: ['2', '4'],
      count: 2
    })
    // 总冲突数跨库按题去重：{2,4}
    expect(report.total).toBe(2)
  })

  it('跨库同一已抽题只统计一次（去重）', () => {
    const report = computeBankBindConflicts(
      [
        { id: 'a', name: '库A', topicIds: ['1', '2'] },
        { id: 'b', name: '库B', topicIds: ['2', '3'] }
      ],
      ['2']
    )
    expect(report.total).toBe(1)
    expect(report.conflicts.map((c) => c.groupId)).toEqual(['a', 'b'])
  })

  it('库内重复题 id 去重；无 name 回退到 id', () => {
    const report = computeBankBindConflicts(
      [{ id: 'a', topicIds: ['1', '1', '1'] }],
      ['1']
    )
    expect(report.conflicts[0].drawnIds).toEqual(['1'])
    expect(report.conflicts[0].count).toBe(1)
    expect(report.conflicts[0].groupName).toBe('a')
  })

  it('空输入不报错', () => {
    expect(computeBankBindConflicts([], ['1'])).toEqual({
      conflicts: [],
      total: 0,
      hasConflict: false
    })
    expect(
      computeBankBindConflicts([{ id: 'a', topicIds: [] }], [])
    ).toEqual({ conflicts: [], total: 0, hasConflict: false })
  })
})

describe('planRoundBankSync（by_round 下 round_topic_groups 增删计划）', () => {
  it('目标与当前一致时无操作', () => {
    expect(
      planRoundBankSync({ r1: ['a', 'b'] }, { r1: ['a', 'b'] })
    ).toEqual([])
  })

  it('需绑定新增 + 解绑移除', () => {
    const ops = planRoundBankSync({ r1: ['a', 'c'] }, { r1: ['a', 'b', 'b'] })
    expect(ops).toEqual([{ roundId: 'r1', bind: ['c'], unbind: ['b'] }])
  })

  it('目标为空 → 清空当前；新轮次当前为空 → 全部绑定', () => {
    const ops = planRoundBankSync({ r1: [], r2: ['x'] }, { r1: ['a'], r2: [] })
    const byRound = Object.fromEntries(ops.map((o) => [o.roundId, o]))
    expect(byRound.r1).toEqual({ roundId: 'r1', bind: [], unbind: ['a'] })
    expect(byRound.r2).toEqual({ roundId: 'r2', bind: ['x'], unbind: [] })
  })

  it('仅出现于当前但不属于目标的轮次会被清空（避免残留）', () => {
    const ops = planRoundBankSync({}, { rOld: ['a'] })
    expect(ops).toEqual([{ roundId: 'rOld', bind: [], unbind: ['a'] }])
  })
})