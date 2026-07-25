// ============================================================
// topic-repo.test.ts — topic.repo 自定义字段相关逻辑单元测试
//
// 覆盖 Task 4 新增逻辑：
//   - isValidIdentifier：合法/非法字段名校验
//   - buildWhereClause：custom_filters 拼接、__unset__ 处理、SQL 注入防护
//   - countByDimension：系统字段 vs 自定义字段分支、非法字段名抛错
//   - listDistinctValues：仅系统字段、非法字段名跳过
//   - listCustomFieldTags：tags 数组聚合、单值字符串处理、损坏 JSON 跳过
//   - rowToTopic：custom_data 反序列化（含损坏 JSON 兜底）
//
// 用 vi.mock 模拟 getDb 返回的 prepared statement 接口，
// 验证 topic.repo 的 SQL 拼接与编排逻辑（不依赖真实 better-sqlite3）。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---- mock 数据存储 ----

/** 捕获 prepare 调用，便于断言 SQL 与参数 */
let prepareCalls: Array<{ sql: string; params: any[] }> = []

/** 通用 stub：返回 run/all/get 三方法，并捕获参数 */
function makeStub(behavior: {
  all?: (...params: any[]) => any[]
  get?: (...params: any[]) => any
  run?: (...params: any[]) => void
}) {
  return (sql: string) => {
    return {
      run: (...params: any[]) => {
        prepareCalls.push({ sql, params })
        behavior.run?.(...params)
      },
      all: (...params: any[]) => {
        prepareCalls.push({ sql, params })
        return behavior.all ? behavior.all(...params) : []
      },
      get: (...params: any[]) => {
        prepareCalls.push({ sql, params })
        return behavior.get ? behavior.get(...params) : undefined
      }
    }
  }
}

let mockAllBehavior: (...params: any[]) => any[] = () => []
let mockGetBehavior: (...params: any[]) => any = () => undefined

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: makeStub({
      all: (...p: any[]) => mockAllBehavior(...p),
      get: (...p: any[]) => mockGetBehavior(...p)
    }),
    transaction: (fn: (x: any) => any) => (x: any) => fn(x)
  })
}))

import {
  topicRepo,
  buildWhereClause,
  isValidIdentifier
} from '../../db/repository/topic.repo'

describe('isValidIdentifier', () => {
  it('英文/数字/下划线合法', () => {
    expect(isValidIdentifier('type')).toBe(true)
    expect(isValidIdentifier('source_type')).toBe(true)
    expect(isValidIdentifier('event123')).toBe(true)
  })

  it('中文字符合法', () => {
    expect(isValidIdentifier('赛事')).toBe(true)
    expect(isValidIdentifier('组别')).toBe(true)
  })

  it('混合中英文合法', () => {
    expect(isValidIdentifier('赛事event')).toBe(true)
  })

  it('空字符串非法', () => {
    expect(isValidIdentifier('')).toBe(false)
  })

  it('含特殊字符非法（SQL 注入尝试）', () => {
    expect(isValidIdentifier("type; DROP TABLE--")).toBe(false)
    expect(isValidIdentifier('type OR 1=1')).toBe(false)
    expect(isValidIdentifier("type' OR '1'='1")).toBe(false)
    expect(isValidIdentifier('type--')).toBe(false)
    expect(isValidIdentifier('type/*')).toBe(false)
  })

  it('非字符串非法', () => {
    expect(isValidIdentifier(null as unknown as string)).toBe(false)
    expect(isValidIdentifier(undefined as unknown as string)).toBe(false)
    expect(isValidIdentifier(123 as unknown as string)).toBe(false)
  })
})

describe('buildWhereClause custom_filters', () => {
  it('无 custom_filters 时不拼接 json_extract', () => {
    const { where, params } = buildWhereClause({ type: '价值辩' })
    expect(where).not.toContain('json_extract')
    expect(where).toContain('type = ?')
    expect(params).toEqual(['价值辩'])
  })

  it('单个 custom_filters 生成 json_extract 等值条件', () => {
    const { where, params } = buildWhereClause({
      custom_filters: { competition: '新国辩' }
    })
    expect(where).toContain("json_extract(custom_data, '$.competition') = ?")
    expect(params).toEqual(['新国辩'])
  })

  it('多个 custom_filters 生成 AND 连接', () => {
    const { where, params } = buildWhereClause({
      custom_filters: { competition: '新国辩', group: 'A组' }
    })
    expect(where).toContain("json_extract(custom_data, '$.competition') = ?")
    expect(where).toContain("json_extract(custom_data, '$.group') = ?")
    expect(params).toEqual(['新国辩', 'A组'])
  })

  it("值 '__unset__' 翻译为 IS NULL（支持「(未设置)」节点筛选）", () => {
    const { where, params } = buildWhereClause({
      custom_filters: { competition: '__unset__' }
    })
    expect(where).toContain("json_extract(custom_data, '$.competition') IS NULL")
    expect(params).toEqual([])
  })

  it('非法字段名被跳过（防 SQL 注入）', () => {
    const { where, params } = buildWhereClause({
      custom_filters: {
        "evil'; DROP TABLE topics--": 'whatever',
        competition: '新国辩'
      }
    })
    // 非法字段不出现在 SQL 中
    expect(where).not.toContain('DROP TABLE')
    expect(where).not.toContain('evil')
    // 合法字段仍生效
    expect(where).toContain("json_extract(custom_data, '$.competition')")
    expect(params).toEqual(['新国辩'])
  })

  it('与系统字段筛选共存', () => {
    const { where, params } = buildWhereClause({
      type: '价值辩',
      difficulty: '入门级',
      custom_filters: { competition: '新国辩' }
    })
    expect(where).toContain('type = ?')
    expect(where).toContain('difficulty = ?')
    expect(where).toContain("json_extract(custom_data, '$.competition') = ?")
    expect(params).toEqual(['价值辩', '入门级', '新国辩'])
  })
})

describe('countByDimension', () => {
  beforeEach(() => {
    prepareCalls = []
    mockAllBehavior = () => [
      { value: '价值辩', count: 234 },
      { value: null, count: 10 }
    ]
  })

  it('系统字段走列查询路径', () => {
    topicRepo.countByDimension('type')
    const call = prepareCalls.find((c) => c.sql.includes('FROM topics'))
    expect(call).toBeDefined()
    expect(call!.sql).toContain('SELECT type AS value')
    expect(call!.sql).toContain('GROUP BY type')
    expect(call!.sql).not.toContain('json_extract')
  })

  it('自定义字段走 json_extract 路径', () => {
    topicRepo.countByDimension('competition')
    const call = prepareCalls.find((c) => c.sql.includes('FROM topics'))
    expect(call).toBeDefined()
    expect(call!.sql).toContain("json_extract(custom_data, '$.competition') AS value")
    expect(call!.sql).toContain('GROUP BY value')
  })

  it('中文字段名走 json_extract 路径', () => {
    topicRepo.countByDimension('赛事')
    const call = prepareCalls.find((c) => c.sql.includes('FROM topics'))
    expect(call).toBeDefined()
    expect(call!.sql).toContain("json_extract(custom_data, '$.赛事')")
  })

  it('非法字段名抛错（防 SQL 注入）', () => {
    expect(() => topicRepo.countByDimension("type'; DROP TABLE--")).toThrow(
      '非法字段名'
    )
  })

  it('NULL 值聚合为 "(未设置)"', () => {
    mockAllBehavior = () => [
      { value: '价值辩', count: 234 },
      { value: null, count: 10 }
    ]
    const result = topicRepo.countByDimension('type')
    expect(result).toEqual([
      { value: '价值辩', count: 234 },
      { value: '(未设置)', count: 10 }
    ])
  })
})

describe('listDistinctValues', () => {
  beforeEach(() => {
    prepareCalls = []
  })

  it('仅查询系统字段，跳过自定义字段名', () => {
    mockAllBehavior = () => [{ value: '价值辩', count: 234 }]
    const result = topicRepo.listDistinctValues([
      'type',
      'competition', // 自定义字段，应被跳过
      "evil; DROP TABLE--" // 非法，应被跳过
    ])
    // 仅 type 有结果
    expect(Object.keys(result)).toEqual(['type'])
    expect(result.type).toEqual([{ value: '价值辩', count: 234 }])
    // 不应出现 competition 或 DROP TABLE 的 SQL
    const allSql = prepareCalls.map((c) => c.sql).join('\n')
    expect(allSql).not.toContain('competition')
    expect(allSql).not.toContain('DROP TABLE')
  })

  it('过滤 NULL 与空字符串（WHERE ... IS NOT NULL AND ... != ""）', () => {
    mockAllBehavior = () => []
    topicRepo.listDistinctValues(['type', 'difficulty', 'source'])
    for (const call of prepareCalls) {
      expect(call.sql).toMatch(/IS NOT NULL AND \w+ != ''/)
    }
  })

  it('空数组入参返回空对象', () => {
    const result = topicRepo.listDistinctValues([])
    expect(result).toEqual({})
  })

  it('系统字段 SQL 包含 GROUP BY', () => {
    mockAllBehavior = () => []
    topicRepo.listDistinctValues(['type'])
    const call = prepareCalls[0]
    expect(call.sql).toContain('GROUP BY type')
    expect(call.sql).toContain('ORDER BY count DESC')
  })
})

describe('listCustomFieldTags', () => {
  beforeEach(() => {
    prepareCalls = []
  })

  it('聚合 tags 数组字段（多行 JSON.parse）', () => {
    // 模拟两行数据：[\"初赛\",\"复赛\"] 和 [\"复赛\",\"决赛\"]
    mockAllBehavior = () => [
      { raw: JSON.stringify(['初赛', '复赛']) },
      { raw: JSON.stringify(['复赛', '决赛']) }
    ]
    const result = topicRepo.listCustomFieldTags('event_tags')
    // 初赛:1, 复赛:2, 决赛:1，按 count 降序
    expect(result).toEqual([
      { value: '复赛', count: 2 },
      { value: '初赛', count: 1 },
      { value: '决赛', count: 1 }
    ])
  })

  it('单值字符串字段也聚合（兼容 string 类型误用此方法）', () => {
    mockAllBehavior = () => [
      { raw: JSON.stringify('新国辩') },
      { raw: JSON.stringify('新国辩') },
      { raw: JSON.stringify('华语辩论') }
    ]
    const result = topicRepo.listCustomFieldTags('competition')
    expect(result).toEqual([
      { value: '新国辩', count: 2 },
      { value: '华语辩论', count: 1 }
    ])
  })

  it('损坏 JSON 行跳过，不影响其他行', () => {
    mockAllBehavior = () => [
      { raw: '{invalid json' },
      { raw: JSON.stringify(['初赛']) },
      { raw: null }
    ]
    const result = topicRepo.listCustomFieldTags('event_tags')
    expect(result).toEqual([{ value: '初赛', count: 1 }])
  })

  it('空字符串 tag 被过滤', () => {
    mockAllBehavior = () => [
      { raw: JSON.stringify(['', '初赛', '']) }
    ]
    const result = topicRepo.listCustomFieldTags('event_tags')
    expect(result).toEqual([{ value: '初赛', count: 1 }])
  })

  it('非法字段名抛错（防 SQL 注入）', () => {
    expect(() => topicRepo.listCustomFieldTags("evil'; DROP TABLE--")).toThrow(
      '非法字段名'
    )
  })

  it('SQL 走 json_extract 路径', () => {
    mockAllBehavior = () => []
    topicRepo.listCustomFieldTags('event_tags')
    const call = prepareCalls[0]
    expect(call.sql).toContain("json_extract(custom_data, '$.event_tags')")
    expect(call.sql).toContain("WHERE status = 'active' AND custom_data IS NOT NULL")
  })
})

describe('rowToTopic custom_data 反序列化（通过 getTopicById 间接验证）', () => {
  beforeEach(() => {
    prepareCalls = []
  })

  it('合法 JSON 对象反序列化为 custom_data 对象', () => {
    mockGetBehavior = () => ({
      id: 't1',
      title: '题1',
      type: '价值辩',
      domain: null,
      difficulty: null,
      source: null,
      source_type: '自定义',
      tags: JSON.stringify(['经典']),
      weight: 1,
      status: 'active',
      batch_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      custom_data: JSON.stringify({ competition: '新国辩', group: 'A组' })
    })
    const topic = topicRepo.getTopicById('t1')
    expect(topic).toBeDefined()
    expect(topic!.custom_data).toEqual({ competition: '新国辩', group: 'A组' })
  })

  it('custom_data 为 null 时返回 null', () => {
    mockGetBehavior = () => ({
      id: 't1',
      title: '题1',
      type: null,
      domain: null,
      difficulty: null,
      source: null,
      source_type: null,
      tags: null,
      weight: 1,
      status: 'active',
      batch_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      custom_data: null
    })
    const topic = topicRepo.getTopicById('t1')
    expect(topic!.custom_data).toBeNull()
  })

  it('损坏 JSON 兜底为 null（不影响其他字段）', () => {
    mockGetBehavior = () => ({
      id: 't1',
      title: '题1',
      type: '价值辩',
      domain: null,
      difficulty: null,
      source: null,
      source_type: null,
      tags: null,
      weight: 1,
      status: 'active',
      batch_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      custom_data: '{invalid json'
    })
    const topic = topicRepo.getTopicById('t1')
    // custom_data 兜底为 null
    expect(topic!.custom_data).toBeNull()
    // 其他字段正常
    expect(topic!.title).toBe('题1')
    expect(topic!.type).toBe('价值辩')
  })

  it('JSON 数组（非法结构）兜底为 null', () => {
    mockGetBehavior = () => ({
      id: 't1',
      title: '题1',
      type: null,
      domain: null,
      difficulty: null,
      source: null,
      source_type: null,
      tags: null,
      weight: 1,
      status: 'active',
      batch_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      custom_data: JSON.stringify(['not', 'an', 'object'])
    })
    const topic = topicRepo.getTopicById('t1')
    expect(topic!.custom_data).toBeNull()
  })
})
