import { describe, it, expect } from 'vitest'
import { applyMapping, applyMappingToTopics, isMappingValid } from '../valueMapping'
import type { TopicCreateInput, ValueMapping } from '../../../../shared/types'

const makeTopic = (overrides: Partial<TopicCreateInput> = {}): TopicCreateInput => ({
  title: 'test',
  type: null,
  domain: null,
  difficulty: null,
  source: null,
  source_type: '自定义',
  tags: null,
  ...overrides
})

describe('applyMapping', () => {
  it('空 mapping 返回原 topic', () => {
    const t = makeTopic({ difficulty: '入门' })
    expect(applyMapping(t, {})).toEqual(t)
  })

  it('map 动作改写字段值', () => {
    const t = makeTopic({ difficulty: '入门' })
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map', target: '入门级' } }
    }
    expect(applyMapping(t, mapping).difficulty).toBe('入门级')
  })

  it('keep 动作不改写', () => {
    const t = makeTopic({ difficulty: '入门' })
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'keep' } }
    }
    expect(applyMapping(t, mapping).difficulty).toBe('入门')
  })

  it('add 动作不改写（主进程负责持久化）', () => {
    const t = makeTopic({ type: '哲思辩' })
    const mapping: ValueMapping = {
      type: { 哲思辩: { action: 'add' } }
    }
    expect(applyMapping(t, mapping).type).toBe('哲思辩')
  })

  it('未匹配的字段值保持原值', () => {
    const t = makeTopic({ difficulty: '专业级' })
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map', target: '入门级' } }
    }
    expect(applyMapping(t, mapping).difficulty).toBe('专业级')
  })

  it('null 字段不报错', () => {
    const t = makeTopic({ difficulty: null })
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map', target: '入门级' } }
    }
    expect(applyMapping(t, mapping).difficulty).toBeNull()
  })
})

describe('applyMappingToTopics', () => {
  it('批量应用', () => {
    const topics = [
      makeTopic({ difficulty: '入门' }),
      makeTopic({ difficulty: '进阶' }),
      makeTopic({ difficulty: '入门级' })
    ]
    const mapping: ValueMapping = {
      difficulty: {
        入门: { action: 'map', target: '入门级' },
        进阶: { action: 'map', target: '进阶级' }
      }
    }
    const result = applyMappingToTopics(topics, mapping)
    expect(result[0].difficulty).toBe('入门级')
    expect(result[1].difficulty).toBe('进阶级')
    expect(result[2].difficulty).toBe('入门级')
  })

  it('空 mapping 返回原数组引用', () => {
    const topics = [makeTopic()]
    expect(applyMappingToTopics(topics, {})).toBe(topics)
  })
})

describe('isMappingValid', () => {
  it('空 mapping 有效', () => {
    expect(isMappingValid({}).valid).toBe(true)
  })

  it('所有 map 都有 target 时有效', () => {
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map', target: '入门级' } }
    }
    expect(isMappingValid(mapping).valid).toBe(true)
  })

  it('map 缺失 target 无效', () => {
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map' } }
    }
    const result = isMappingValid(mapping)
    expect(result.valid).toBe(false)
    expect(result.invalidFields).toHaveLength(1)
    expect(result.invalidFields[0]).toEqual({ field: 'difficulty', value: '入门' })
  })

  it('keep/add 不影响有效性', () => {
    const mapping: ValueMapping = {
      type: { 新类型: { action: 'add' } },
      difficulty: { 入门: { action: 'keep' } }
    }
    expect(isMappingValid(mapping).valid).toBe(true)
  })
})
