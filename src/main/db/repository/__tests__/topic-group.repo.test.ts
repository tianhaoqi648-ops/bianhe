// ============================================================
// topic-group.repo.test.ts — 题组仓库测试
//
// 背景：better-sqlite3 为 Electron ABI 编译，vitest(Node ABI) 无法直接加载
// （见 judge-history.repo.test.ts / match.repo.test.ts 注释），因此 mock getDb()
// 返回内存桩。用 vi.hoisted 共享状态，避免 vi.mock 提升导致 TDZ 引用。
//
// 覆盖：默认题库种子(幂等) / 题组 CRUD / 成员增删查(activeOnly) /
//       join topics 取题 / 赛事绑定增删查 / 默认归入 / findAllForBackup。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  // 内存数据：三张题组表 + 一个精简的 topics 桩（供 join 过滤 status / 取 title）
  const groups = new Map<string, Record<string, unknown>>()
  const items = new Map<string, { group_id: string; topic_id: string }>()
  const bindings = new Map<string, { event_id: string; group_id: string }>()
  const roundGroups = new Map<string, { round_id: string; group_id: string }>()
  const topics = new Map<string, Record<string, unknown>>()
  const bankConfigs = new Map<string, string>()
  const eventIds = new Set<string>()
  // 故障注入：对这些 topic_id 的 topic_group_items 写入抛错，用于验证批量写事务回滚
  let failIds = new Set<string>()

  function handle(sql: string, mode: 'run' | 'get' | 'all', args: unknown[]): unknown {
    const s = sql.trim()

    if (/^INSERT\s+(OR\s+IGNORE\s+)?INTO\s+topic_groups/i.test(s)) {
      // 两种形态：
      //   createGroup/ensureDefault：VALUES (?, ?, N, ?)，is_default 为字面量，args=[id, name, createdAt]
      //   ensureGroupById：VALUES (?, ?, ?, ?)，is_default 为占位符，args=[id, name, isDefault, createdAt]
      const m = s.match(/VALUES\s*\(\s*\?\s*,\s*\?\s*,\s*(\d+)\s*,\s*\?/i)
      const [id, name] = args as [string, string]
      let isDefault = 0
      let createdAt: unknown = args[2]
      if (m) {
        isDefault = Number(m[1])
      } else {
        isDefault = Number(args[2])
        createdAt = args[3]
      }
      groups.set(String(id), {
        id: String(id),
        name: String(name),
        is_default: isDefault,
        created_at: createdAt ?? null
      })
      return { changes: 1 }
    }
    if (/^INSERT\s+(OR\s+IGNORE\s+)?INTO\s+topic_group_items/i.test(s)) {
      const [gid, tid] = args as [string, string]
      // 故障注入：命中列表的 topic_id 抛错，使事务回滚
      if (failIds.has(String(tid))) {
        throw new Error('intentional failure injection: topic_group_items insert failed')
      }
      const key = `${gid}\u0000${tid}`
      const existed = items.has(key)
      if (!existed) items.set(key, { group_id: gid, topic_id: tid })
      return { changes: existed ? 0 : 1 }
    }
    if (/^INSERT\s+(OR\s+IGNORE\s+)?INTO\s+event_topic_groups/i.test(s)) {
      const [eid, gid] = args as [string, string]
      const key = `${eid}\u0000${gid}`
      const existed = bindings.has(key)
      if (!existed) bindings.set(key, { event_id: eid, group_id: gid })
      return { changes: existed ? 0 : 1 }
    }
    if (/^INSERT\s+(OR\s+IGNORE\s+)?INTO\s+round_topic_groups/i.test(s)) {
      const [rid, gid] = args as [string, string]
      const key = `${rid}\u0000${gid}`
      const existed = roundGroups.has(key)
      if (!existed) roundGroups.set(key, { round_id: rid, group_id: gid })
      return { changes: existed ? 0 : 1 }
    }
    if (/^UPDATE\s+topic_groups\s+SET\s+name\s*=\s*\?/i.test(s)) {
      const [name, id] = args as [string, string]
      const g = groups.get(id)
      if (!g) return { changes: 0 }
      g.name = name
      return { changes: 1 }
    }
    if (/^DELETE\s+FROM\s+topic_groups\s+WHERE\s+id\s*=\s*\?/i.test(s)) {
      const [id] = args as [string]
      if (!groups.has(id)) return { changes: 0 }
      groups.delete(id)
      for (const key of items.keys()) if (key.startsWith(`${id}\u0000`)) items.delete(key)
      for (const key of bindings.keys()) if (key.endsWith(`\u0000${id}`)) bindings.delete(key)
      return { changes: 1 }
    }
    if (/^DELETE\s+FROM\s+topic_group_items\s+WHERE\s+group_id\s*=\s*\?\s+AND\s+topic_id\s*=\s*\?/i.test(s)) {
      const [gid, tid] = args as [string, string]
      // 故障注入：命中列表的 topic_id 删除抛错，使事务回滚
      if (failIds.has(String(tid))) {
        throw new Error('intentional failure injection: topic_group_items delete failed')
      }
      const key = `${gid}\u0000${tid}`
      const existed = items.has(key)
      items.delete(key)
      return { changes: existed ? 1 : 0 }
    }
    if (/^DELETE\s+FROM\s+event_topic_groups\s+WHERE\s+event_id\s*=\s*\?\s+AND\s+group_id\s*=\s*\?/i.test(s)) {
      const [eid, gid] = args as [string, string]
      const key = `${eid}\u0000${gid}`
      const existed = bindings.has(key)
      bindings.delete(key)
      return { changes: existed ? 1 : 0 }
    }
    if (/^DELETE\s+FROM\s+round_topic_groups\s+WHERE\s+round_id\s*=\s*\?\s+AND\s+group_id\s*=\s*\?/i.test(s)) {
      const [rid, gid] = args as [string, string]
      const key = `${rid}\u0000${gid}`
      const existed = roundGroups.has(key)
      roundGroups.delete(key)
      return { changes: existed ? 1 : 0 }
    }
    if (/^UPDATE\s+events\s+SET\s+bank_config\s*=\s*\?\s+WHERE\s+id\s*=\s*\?/i.test(s)) {
      const [json, eid] = args as [string, string]
      if (!eventIds.has(String(eid))) return { changes: 0 }
      bankConfigs.set(String(eid), String(json))
      return { changes: 1 }
    }

    // ---- SELECT ----
    if (/^SELECT\s+\*\s+FROM\s+topic_groups\s+WHERE\s+id\s*=\s*\?/i.test(s)) {
      return groups.get(String(args[0]))
    }
    if (/^SELECT\s+\*\s+FROM\s+topic_groups\s+ORDER\s+BY/i.test(s)) {
      return Array.from(groups.values()).sort((a, b) =>
        (Number(b.is_default) - Number(a.is_default)) ||
        String(a.created_at).localeCompare(String(b.created_at)) ||
        String(a.id).localeCompare(String(b.id))
      )
    }
    if (/^SELECT\s+\*\s+FROM\s+topic_groups$/i.test(s)) {
      return Array.from(groups.values())
    }
    if (/^SELECT\s+topic_id\s+FROM\s+topic_group_items\s+WHERE\s+group_id\s*=\s*\?$/i.test(s)) {
      const [gid] = args as [string]
      return Array.from(items.values())
        .filter((i) => i.group_id === gid)
        .map((i) => ({ topic_id: i.topic_id }))
    }
    if (/SELECT\s+tgi\.topic_id\s+AS\s+topic_id/.test(s)) {
      const [gid] = args as [string]
      return Array.from(items.values())
        .filter((i) => i.group_id === gid)
        .filter((i) => {
          const t = topics.get(i.topic_id)
          return t && t.status === 'active'
        })
        .map((i) => ({ topic_id: i.topic_id }))
    }
    if (/JOIN\s+topics\s+t\s+ON\s+t\.id\s*=\s*tgi\.topic_id/.test(s)) {
      const [gid] = args as [string]
      const list = Array.from(items.values())
        .filter((i) => i.group_id === gid)
        .map((i) => topics.get(i.topic_id))
        .filter((t): t is Record<string, unknown> => !!t)
      list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      return list
    }
    if (/SELECT\s+tg\.\*\s+FROM\s+event_topic_groups\s+etg/.test(s)) {
      const [eid] = args as [string]
      const list = Array.from(bindings.values())
        .filter((b) => b.event_id === eid)
        .map((b) => groups.get(b.group_id))
        .filter((g): g is Record<string, unknown> => !!g)
      list.sort((a, b) =>
        (Number(b.is_default) - Number(a.is_default)) ||
        String(a.created_at).localeCompare(String(b.created_at))
      )
      return list
    }
    if (/^SELECT\s+event_id\s+FROM\s+event_topic_groups\s+WHERE\s+group_id\s*=\s*\?/i.test(s)) {
      const [gid] = args as [string]
      return Array.from(bindings.values())
        .filter((b) => b.group_id === gid)
        .map((b) => ({ event_id: b.event_id }))
    }
    if (/SELECT\s+tg\.\*\s+FROM\s+round_topic_groups\s+rtg/.test(s)) {
      const [rid] = args as [string]
      const list = Array.from(roundGroups.values())
        .filter((b) => b.round_id === rid)
        .map((b) => groups.get(b.group_id))
        .filter((g): g is Record<string, unknown> => !!g)
      list.sort(
        (a, b) =>
          (Number(b.is_default) - Number(a.is_default)) ||
          String(a.created_at).localeCompare(String(b.created_at))
      )
      return list
    }
    if (/^SELECT\s+round_id\s+FROM\s+round_topic_groups\s+WHERE\s+group_id\s*=\s*\?/i.test(s)) {
      const [gid] = args as [string]
      return Array.from(roundGroups.values())
        .filter((b) => b.group_id === gid)
        .map((b) => ({ round_id: b.round_id }))
    }
    if (/^SELECT\s+bank_config\s+FROM\s+events\s+WHERE\s+id\s*=\s*\?/i.test(s)) {
      const [eid] = args as [string]
      const cfg = bankConfigs.get(String(eid))
      return cfg === undefined ? undefined : { bank_config: cfg }
    }
    if (/^SELECT\s+\*\s+FROM\s+topic_group_items$/i.test(s)) {
      return Array.from(items.values())
    }
    if (/^SELECT\s+\*\s+FROM\s+event_topic_groups$/i.test(s)) {
      return Array.from(bindings.values())
    }
    if (/^SELECT\s+\*\s+FROM\s+round_topic_groups$/i.test(s)) {
      return Array.from(roundGroups.values())
    }

    if (mode === 'run') return { changes: 0 }
    if (mode === 'get') return undefined
    return []
  }

  const prepare = (sql: string) => {
    const st = (mode: 'run' | 'get' | 'all', args: unknown[]) => handle(sql, mode, args)
    return {
      run: (...a: unknown[]) => st('run', a) as { changes: number },
      get: (...a: unknown[]) => st('get', a),
      all: (...a: unknown[]) => st('all', a) as unknown[]
    }
  }

  return {
    prepare,
    /** better-sqlite3 事务桩：近似模拟回滚语义 —— 执行前快照内存数据，
     *   fn 抛错则恢复快照（等价于 rollback 丢弃前 N-1），成功则保留变更。 */
    transaction<T = void>(fn: () => T): () => T {
      return () => {
        const snapGroups = new Map(groups)
        const snapItems = new Map(items)
        const snapBindings = new Map(bindings)
        const snapRound = new Map(roundGroups)
        const snapCfg = new Map(bankConfigs)
        const snapEvents = new Set(eventIds)
        try {
          return fn()
        } catch (e) {
          restoreMap(groups, snapGroups)
          restoreMap(items, snapItems)
          restoreMap(bindings, snapBindings)
          restoreMap(roundGroups, snapRound)
          restoreMap(bankConfigs, snapCfg)
          eventIds.clear()
          for (const v of snapEvents) eventIds.add(v)
          throw e
        }
      }
    },
    reset() {
      groups.clear()
      items.clear()
      bindings.clear()
      roundGroups.clear()
      topics.clear()
      bankConfigs.clear()
      eventIds.clear()
      failIds = new Set<string>()
    },
    /** 注入写入故障：之后对这些 topic_id 的 topic_group_items 写入会抛错 */
    failOn(ids: string[]) {
      failIds = new Set(ids)
    },
    seedTopic(row: Record<string, unknown>) {
      topics.set(String(row.id), { ...row })
    },
    seedEvent(id: string) {
      eventIds.add(id)
    }
  }
})

// 把快照 map 的键值回写进目标 map（先清空再填充，避免残留）
function restoreMap<K, V>(target: Map<K, V>, snap: Map<K, V>): void {
  target.clear()
  for (const [k, v] of snap) target.set(k, v)
}

vi.mock('../../index', () => ({
  getDb: () => ({
    prepare: (sql: string) => h.prepare(sql),
    transaction: (fn: () => unknown) => h.transaction(fn)
  })
}))

import { topicGroupRepo } from '../topic-group.repo'

function seedTopic(id: string, over: Record<string, unknown> = {}): void {
  h.seedTopic({
    id,
    title: `题-${id}`,
    type: null,
    domain: null,
    difficulty: null,
    source: null,
    source_type: null,
    tags: '["a"]',
    status: 'active',
    created_at: `2026-08-01T00:00:00.000Z`,
    ...over
  })
}

beforeEach(() => {
  h.reset()
})

describe('默认题库种子（幂等）', () => {
  it('空库时 getDefault 创建「默认题库」并标记 isDefault', () => {
    const def = topicGroupRepo.getDefault()
    expect(def.id).toBe('default-group')
    expect(def.name).toBe('默认题库')
    expect(def.isDefault).toBe(true)
  })

  it('getDefault 重复调用幂等，不重复建组', () => {
    const def1 = topicGroupRepo.getDefault()
    const def2 = topicGroupRepo.getDefault()
    expect(def2.id).toBe(def1.id)
    // 仅有一个默认组
    const all = topicGroupRepo.list()
    expect(all.filter((g) => g.isDefault)).toHaveLength(1)
    expect(all[0].isDefault).toBe(true) // 默认组排最前
  })
})

describe('题组 CRUD', () => {
  it('createGroup 新建非默认题组，list 默认题组在前', () => {
    topicGroupRepo.getDefault() // 先保证默认组存在
    const g = topicGroupRepo.createGroup('备赛题库')
    expect(g.id).toBeTruthy()
    expect(g.name).toBe('备赛题库')
    expect(g.isDefault).toBe(false)

    const all = topicGroupRepo.list()
    expect(all).toHaveLength(2)
    expect(all[0].isDefault).toBe(true)
    expect(all.some((x) => x.id === g.id)).toBe(true)
  })

  it('rename 更新名称；不存在返回 undefined', () => {
    const g = topicGroupRepo.createGroup('旧名')
    const updated = topicGroupRepo.rename(g.id, '新名')
    expect(updated?.name).toBe('新名')
    expect(topicGroupRepo.rename('nonexistent', 'x')).toBeUndefined()
  })

  it('delete 删除题组；默认题库不可删', () => {
    const g = topicGroupRepo.createGroup('待删')
    seedTopic('t1')
    topicGroupRepo.addTopicsToGroup(g.id, ['t1'])
    expect(topicGroupRepo.delete(g.id)).toBe(true)
    expect(topicGroupRepo.listTopicIdsByGroup(g.id)).toHaveLength(0)
    // 默认题库删除应抛错
    expect(() => topicGroupRepo.delete('default-group')).toThrow()
  })
})

describe('ensureGroupById（T7 赛事包导入还原题库）', () => {
  it('按 id 创建缺失题库并记录定义', () => {
    topicGroupRepo.getDefault() // 保证默认组存在
    const g = topicGroupRepo.ensureGroupById(
      'grp-import',
      'A库',
      false,
      '2026-08-01T00:00:00.000Z'
    )
    expect(g.id).toBe('grp-import')
    expect(g.name).toBe('A库')
    expect(g.isDefault).toBe(false)
    expect(g.createdAt).toBe('2026-08-01T00:00:00.000Z')

    // list 可见
    expect(topicGroupRepo.list().some((x) => x.id === 'grp-import')).toBe(true)
  })

  it('已存在的题库幂等返回，不覆盖 name（保留目标库权威）', () => {
    const g = topicGroupRepo.createGroup('既有')
    // 用不同 name 再次 ensure，应返回既有且不改名
    const again = topicGroupRepo.ensureGroupById(g.id, '新名', true)
    expect(again.id).toBe(g.id)
    expect(again.name).toBe('既有')
    expect(again.isDefault).toBe(false)
    // 未新增
    expect(topicGroupRepo.list().length).toBe(1)
  })
})

describe('题组成员', () => {
  it('addTopicsToGroup / removeTopicsFromGroup / listTopicIdsByGroup', () => {
    seedTopic('t1', { status: 'active' })
    seedTopic('t2', { status: 'active' })
    seedTopic('t3', { status: 'archived' })

    const g = topicGroupRepo.createGroup('组A')

    // 加入 3 个题（含重复 id）
    const added = topicGroupRepo.addTopicsToGroup(g.id, ['t1', 't2', 't3', 't1'])
    expect(added).toBe(3)

    const ids = topicGroupRepo.listTopicIdsByGroup(g.id)
    expect(ids).toEqual(expect.arrayContaining(['t1', 't2', 't3']))
    expect(ids).toHaveLength(3)

    // activeOnly 只返回 active 题
    const activeOnly = topicGroupRepo.listTopicIdsByGroup(g.id, { activeOnly: true })
    expect(activeOnly).toEqual(expect.arrayContaining(['t1', 't2']))
    expect(activeOnly).not.toContain('t3')

    // 移除
    const removed = topicGroupRepo.removeTopicsFromGroup(g.id, ['t1'])
    expect(removed).toBe(1)
    expect(topicGroupRepo.listTopicIdsByGroup(g.id)).toEqual(
      expect.arrayContaining(['t2', 't3'])
    )
  })

  it('listTopicsByGroup join topics 返回完整题目信息', () => {
    seedTopic('t1', { title: 'AI 是否应拥有著作权', type: '价值辩', tags: '["科技"]' })
    const g = topicGroupRepo.createGroup('组A')
    topicGroupRepo.addTopicsToGroup(g.id, ['t1'])

    const topics = topicGroupRepo.listTopicsByGroup(g.id)
    expect(topics).toHaveLength(1)
    expect(topics[0].title).toBe('AI 是否应拥有著作权')
    expect(topics[0].type).toBe('价值辩')
    expect(topics[0].tags).toEqual(['科技'])
  })
})

describe('赛事绑定', () => {
  it('bindEventGroups / listGroupsByEvent / listEventIdsByGroup', () => {
    topicGroupRepo.getDefault()
    const ga = topicGroupRepo.createGroup('组A')
    const gb = topicGroupRepo.createGroup('组B')

    const added = topicGroupRepo.bindEventGroups('e1', [ga.id, gb.id, ga.id])
    expect(added).toBe(2)

    const groups = topicGroupRepo.listGroupsByEvent('e1')
    expect(groups).toHaveLength(2)
    // 普通组依次为绑定的组A/组B（默认组未绑定到 e1）
    expect(groups.some((g) => g.id === ga.id)).toBe(true)
    expect(groups.some((g) => g.id === gb.id)).toBe(true)

    const eventIds = topicGroupRepo.listEventIdsByGroup(ga.id)
    expect(eventIds).toEqual(['e1'])

    // 解绑
    expect(topicGroupRepo.unbindEventGroup('e1', ga.id)).toBe(true)
    expect(topicGroupRepo.listGroupsByEvent('e1')).toHaveLength(1)
    expect(topicGroupRepo.unbindEventGroup('e1', ga.id)).toBe(false)
  })
})

describe('默认归入', () => {
  it('ensureTopicInDefaultGroup / ensureTopicsInDefaultGroup 把新题写入默认题库', () => {
    seedTopic('t1')
    seedTopic('t2')
    const n1 = topicGroupRepo.ensureTopicsInDefaultGroup(['t1', 't2'])
    expect(n1).toBe(2)
    // 单题便捷封装
    seedTopic('t3')
    topicGroupRepo.ensureTopicInDefaultGroup('t3')

    const ids = topicGroupRepo.listTopicIdsByGroup('default-group')
    expect(ids).toEqual(expect.arrayContaining(['t1', 't2', 't3']))
    // 重复归入幂等（不会重复插入）
    expect(topicGroupRepo.ensureTopicsInDefaultGroup(['t1'])).toBe(0)
  })
})

describe('批量增减 / 整体复制/移动（T1）', () => {
  it('batchAddToGroups 把一组题加入多个题库（去重，忽略已存在成员）', () => {
    topicGroupRepo.getDefault()
    const ga = topicGroupRepo.createGroup('组A')
    const gb = topicGroupRepo.createGroup('组B')
    seedTopic('t1')
    seedTopic('t2')
    topicGroupRepo.addTopicsToGroup(ga.id, ['t1']) // 预置：ga 已有 t1

    // t1 已存在于 ga 会被跳过，其余新增
    const added = topicGroupRepo.batchAddToGroups(['t1', 't2'], [ga.id, gb.id])
    expect(added).toBe(3) // ga: +t2 →1; gb: +t1,+t2 →2

    expect(topicGroupRepo.listTopicIdsByGroup(ga.id)).toEqual(
      expect.arrayContaining(['t1', 't2'])
    )
    expect(topicGroupRepo.listTopicIdsByGroup(gb.id)).toEqual(
      expect.arrayContaining(['t1', 't2'])
    )

    // 重复调用幂等
    expect(topicGroupRepo.batchAddToGroups(['t1'], [ga.id])).toBe(0)
    // 空数组 no-op
    expect(topicGroupRepo.batchAddToGroups([], [ga.id])).toBe(0)
    expect(topicGroupRepo.batchAddToGroups(['t1'], [])).toBe(0)
  })

  it('batchRemoveFromGroup 从某题库批量移除一组题', () => {
    topicGroupRepo.getDefault()
    const ga = topicGroupRepo.createGroup('组A')
    seedTopic('t1')
    seedTopic('t2')
    seedTopic('t3')
    topicGroupRepo.addTopicsToGroup(ga.id, ['t1', 't2', 't3'])

    const removed = topicGroupRepo.batchRemoveFromGroup(ga.id, ['t1', 't3', 't1'])
    expect(removed).toBe(2)
    expect(topicGroupRepo.listTopicIdsByGroup(ga.id)).toEqual(['t2'])

    // 空数组 no-op
    expect(topicGroupRepo.batchRemoveFromGroup(ga.id, [])).toBe(0)
  })

  it('copyGroupToGroup 把源题库全部题复制到多目标（去重，源保留）', () => {
    topicGroupRepo.getDefault()
    const src = topicGroupRepo.createGroup('源')
    const ga = topicGroupRepo.createGroup('组A')
    const gb = topicGroupRepo.createGroup('组B')
    seedTopic('t1')
    seedTopic('t2')
    topicGroupRepo.addTopicsToGroup(src.id, ['t1', 't2'])
    // ga 预置包含 t1，复制时 t1 应跳过
    topicGroupRepo.addTopicsToGroup(ga.id, ['t1'])

    const result = topicGroupRepo.copyGroupToGroup(src.id, [ga.id, gb.id])
    expect(result).toEqual([
      { groupId: ga.id, added: 1 }, // 仅 t2 新增
      { groupId: gb.id, added: 2 } // t1、t2 都新增
    ])
    // 源保持不变
    expect(topicGroupRepo.listTopicIdsByGroup(src.id)).toEqual(
      expect.arrayContaining(['t1', 't2'])
    )
    expect(topicGroupRepo.listTopicIdsByGroup(ga.id)).toEqual(
      expect.arrayContaining(['t1', 't2'])
    )
  })

  it('copyGroupToGroup 同库目标跳过；空源返回各目标 0', () => {
    topicGroupRepo.getDefault()
    const src = topicGroupRepo.createGroup('源')
    const ga = topicGroupRepo.createGroup('组A')
    seedTopic('t1')
    topicGroupRepo.addTopicsToGroup(src.id, ['t1'])

    // 同库 target 被跳过（不包含在结果里）
    const onlySelf = topicGroupRepo.copyGroupToGroup(src.id, [src.id])
    expect(onlySelf).toEqual([])

    // 混合：自加 + 合法目标
    const mixed = topicGroupRepo.copyGroupToGroup(src.id, [src.id, ga.id])
    expect(mixed).toEqual([{ groupId: ga.id, added: 1 }])

    // 空源：返回每个目标 added=0
    const empty = topicGroupRepo.createGroup('空源')
    expect(topicGroupRepo.copyGroupToGroup(empty.id, [ga.id])).toEqual([
      { groupId: ga.id, added: 0 }
    ])
  })

  it('moveGroupToGroup 复制到目标后清空源；同库跳过', () => {
    topicGroupRepo.getDefault()
    const src = topicGroupRepo.createGroup('源')
    const ga = topicGroupRepo.createGroup('组A')
    const gb = topicGroupRepo.createGroup('组B')
    seedTopic('t1')
    seedTopic('t2')
    topicGroupRepo.addTopicsToGroup(src.id, ['t1', 't2'])
    // ga 预置包含 t1，移动时 t1 跳过复制但源仍被清空
    topicGroupRepo.addTopicsToGroup(ga.id, ['t1'])

    const result = topicGroupRepo.moveGroupToGroup(src.id, [ga.id, gb.id, src.id])
    // 同库 src 跳过
    expect(result).toEqual([
      { groupId: ga.id, added: 1 },
      { groupId: gb.id, added: 2 }
    ])
    // 源被清空
    expect(topicGroupRepo.listTopicIdsByGroup(src.id)).toHaveLength(0)
    expect(topicGroupRepo.listTopicIdsByGroup(ga.id)).toEqual(
      expect.arrayContaining(['t1', 't2'])
    )
    expect(topicGroupRepo.listTopicIdsByGroup(gb.id)).toEqual(
      expect.arrayContaining(['t1', 't2'])
    )
  })

  it('moveGroupToGroup 仅同库目标时返回空且不动源', () => {
    topicGroupRepo.getDefault()
    const src = topicGroupRepo.createGroup('源')
    seedTopic('t1')
    topicGroupRepo.addTopicsToGroup(src.id, ['t1'])

    expect(topicGroupRepo.moveGroupToGroup(src.id, [src.id])).toEqual([])
    expect(topicGroupRepo.listTopicIdsByGroup(src.id)).toEqual(['t1'])
  })
})

describe('轮次库绑定（round_topic_groups）', () => {
  it('bindRoundGroups / unbindRoundGroup / listGroupsByRound / listRoundsByGroup', () => {
    topicGroupRepo.getDefault()
    const ga = topicGroupRepo.createGroup('组A')
    const gb = topicGroupRepo.createGroup('组B')

    // 幂等绑定（含重复 id）
    const added = topicGroupRepo.bindRoundGroups('r1', [ga.id, gb.id, ga.id])
    expect(added).toBe(2)

    const groups = topicGroupRepo.listGroupsByRound('r1')
    expect(groups).toHaveLength(2)
    expect(groups.some((g) => g.id === ga.id)).toBe(true)
    expect(groups.some((g) => g.id === gb.id)).toBe(true)

    // 反向查轮次
    expect(topicGroupRepo.listRoundsByGroup(ga.id)).toEqual(['r1'])

    // 解绑
    expect(topicGroupRepo.unbindRoundGroup('r1', ga.id)).toBe(true)
    expect(topicGroupRepo.listGroupsByRound('r1')).toHaveLength(1)
    expect(topicGroupRepo.unbindRoundGroup('r1', ga.id)).toBe(false)
  })

  it('空 groupIds 为 no-op', () => {
    expect(topicGroupRepo.bindRoundGroups('r1', [])).toBe(0)
  })
})

describe('赛事选题模式读写（events.bank_config）', () => {
  it('未配置时回退默认 single 模式', () => {
    h.seedEvent('e1')
    expect(topicGroupRepo.getEventBankConfig('e1')).toEqual({ mode: 'single' })
  })

  it('setEventBankConfig 写入并可读回（含优先级顺序与轮次库）', () => {
    h.seedEvent('e1')
    const written = topicGroupRepo.setEventBankConfig('e1', {
      mode: 'priority',
      priorityOrder: ['g1', 'g2', 'g3']
    })
    expect(written).toEqual({ mode: 'priority', priorityOrder: ['g1', 'g2', 'g3'] })
    expect(topicGroupRepo.getEventBankConfig('e1')).toEqual({
      mode: 'priority',
      priorityOrder: ['g1', 'g2', 'g3']
    })

    // by_round 含轮次库映射
    topicGroupRepo.setEventBankConfig('e1', {
      mode: 'by_round',
      roundBanks: { round1: ['g1'], round2: ['g2'] }
    })
    expect(topicGroupRepo.getEventBankConfig('e1')).toEqual({
      mode: 'by_round',
      roundBanks: { round1: ['g1'], round2: ['g2'] }
    })
  })

  it('事件不存在时 set 返回 undefined', () => {
    expect(topicGroupRepo.setEventBankConfig('not-exist', { mode: 'union' })).toBeUndefined()
  })
})

describe('批量写事务化（gov Task3：任一条失败整批回滚）', () => {
  it('addTopicsToGroup 插入：第 2 条失败 → 前 1 条一并回滚（不留 t1）', () => {
    const g = topicGroupRepo.createGroup('组A')
    seedTopic('t1')
    seedTopic('t2')
    h.failOn(['t2'])
    expect(() => topicGroupRepo.addTopicsToGroup(g.id, ['t1', 't2'])).toThrow(
      'failure injection'
    )
    expect(topicGroupRepo.listTopicIdsByGroup(g.id)).toHaveLength(0)
  })

  it('removeTopicsFromGroup 删除：第 2 条失败 → 前 1 条删除回滚（t1/t2 都在）', () => {
    const g = topicGroupRepo.createGroup('组A')
    seedTopic('t1')
    seedTopic('t2')
    // 先正常插入（故障注入未开启）
    expect(topicGroupRepo.addTopicsToGroup(g.id, ['t1', 't2'])).toBe(2)
    // 开启故障注入：t2 的删除会抛错
    h.failOn(['t2'])
    expect(() => topicGroupRepo.removeTopicsFromGroup(g.id, ['t1', 't2'])).toThrow(
      'failure injection'
    )
    // t1 的删除被回滚，两条都保留
    expect(topicGroupRepo.listTopicIdsByGroup(g.id)).toEqual(
      expect.arrayContaining(['t1', 't2'])
    )
  })

  it('addTopicsToGroup 正常批量成功', () => {
    const g = topicGroupRepo.createGroup('组A')
    seedTopic('t1')
    seedTopic('t2')
    expect(topicGroupRepo.addTopicsToGroup(g.id, ['t1', 't2'])).toBe(2)
    expect(topicGroupRepo.listTopicIdsByGroup(g.id)).toEqual(
      expect.arrayContaining(['t1', 't2'])
    )
  })

  it('bindEventGroups 正常批量成功 / 空数组 no-op', () => {
    topicGroupRepo.getDefault()
    const ga = topicGroupRepo.createGroup('组A')
    const gb = topicGroupRepo.createGroup('组B')
    const added = topicGroupRepo.bindEventGroups('e1', [ga.id, gb.id])
    expect(added).toBe(2)
    expect(topicGroupRepo.listGroupsByEvent('e1')).toHaveLength(2)
    expect(topicGroupRepo.bindEventGroups('e1', [])).toBe(0)
  })
})

describe('findAllForBackup', () => {
  it('返回四张表原始行（含轮次库绑定表，默认题库）', () => {
    topicGroupRepo.getDefault()
    const ga = topicGroupRepo.createGroup('组A')
    seedTopic('t1')
    topicGroupRepo.addTopicsToGroup(ga.id, ['t1'])
    topicGroupRepo.bindEventGroups('e1', [ga.id])
    topicGroupRepo.bindRoundGroups('r1', [ga.id])

    const data = topicGroupRepo.findAllForBackup()
    expect(data.topic_groups).toHaveLength(2)
    expect(data.topic_groups.some((g) => g.is_default === 1)).toBe(true)
    expect(data.topic_group_items).toHaveLength(1)
    expect(data.event_topic_groups).toHaveLength(1)
    expect(data.event_topic_groups[0].event_id).toBe('e1')
    expect(data.round_topic_groups).toHaveLength(1)
    expect(data.round_topic_groups[0]).toEqual({ round_id: 'r1', group_id: ga.id })
  })
})