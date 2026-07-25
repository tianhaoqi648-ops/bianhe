// ============================================================
// custom-field-service.test.ts — 自定义字段服务单元测试
//
// 用 vi.mock 模拟 getDb 返回的 prepared statement 接口，
// 验证 custom-field-service 的 CRUD 编排逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---- mock 数据存储 ----

interface MockRow {
  field_key: string
  field_label: string
  field_type: 'string' | 'tags'
  sort_order: number
  created_at: string
}

let mockRows: MockRow[] = []

// prepare 工厂：根据 SQL 返回 stub
function makePrepare() {
  return (sql: string) => {
    const trimmed = sql.trim()
    // 注意：更具体的 SQL 模式必须先匹配，否则 startsWith 会误匹配
    // exists 的 SQL（含 OR field_label）必须在 createField 的 SQL 之前判断
    if (
      trimmed.startsWith('SELECT field_key FROM topic_custom_fields WHERE field_key = ? OR field_label = ?')
    ) {
      return {
        get: (keyOrLabel: string) =>
          mockRows.find((r) => r.field_key === keyOrLabel || r.field_label === keyOrLabel) ??
          undefined,
        all: () => [],
        run: () => {}
      }
    }
    if (trimmed.startsWith('SELECT field_key FROM topic_custom_fields WHERE field_key = ?')) {
      return {
        get: (key: string) => mockRows.find((r) => r.field_key === key) ?? undefined,
        all: () => [],
        run: () => {}
      }
    }
    if (trimmed.startsWith('SELECT MAX(sort_order)')) {
      return {
        get: () => ({
          m: mockRows.length > 0 ? Math.max(...mockRows.map((r) => r.sort_order)) : null
        }),
        all: () => [],
        run: () => {}
      }
    }
    if (trimmed.startsWith('SELECT field_key, field_label')) {
      return {
        all: () => [...mockRows].sort((a, b) => a.sort_order - b.sort_order),
        get: () => undefined,
        run: () => {}
      }
    }
    if (trimmed.startsWith('INSERT INTO topic_custom_fields')) {
      return {
        run: (
          field_key: string,
          field_label: string,
          field_type: string,
          sort_order: number,
          created_at: string
        ) => {
          mockRows.push({
            field_key,
            field_label,
            field_type: field_type as 'string' | 'tags',
            sort_order,
            created_at
          })
        },
        get: () => undefined,
        all: () => []
      }
    }
    if (trimmed.startsWith('UPDATE topic_custom_fields SET')) {
      return {
        run: (...params: any[]) => {
          const key = params[params.length - 1] as string
          const row = mockRows.find((r) => r.field_key === key)
          if (!row) return
          if (sql.includes('field_label = ?') && sql.includes('sort_order = ?')) {
            row.field_label = params[0] as string
            row.sort_order = params[1] as number
          } else if (sql.includes('field_label = ?')) {
            row.field_label = params[0] as string
          } else if (sql.includes('sort_order = ?')) {
            row.sort_order = params[0] as number
          }
        },
        get: () => undefined,
        all: () => []
      }
    }
    if (trimmed.startsWith('DELETE FROM topic_custom_fields')) {
      return {
        run: (key: string) => {
          mockRows = mockRows.filter((r) => r.field_key !== key)
        },
        get: () => undefined,
        all: () => []
      }
    }
    return { run: () => {}, get: () => undefined, all: () => [] }
  }
}

vi.mock('../../db', () => ({
  getDb: () => ({ prepare: makePrepare() })
}))

import { customFieldService, labelToKey } from '../custom-field-service'

describe('custom-field-service', () => {
  beforeEach(() => {
    mockRows = []
  })

  describe('labelToKey', () => {
    it('英文转 lowercase', () => {
      expect(labelToKey('Competition')).toBe('competition')
      expect(labelToKey('EVENT_NAME')).toBe('event_name')
    })

    it('中文保留原值', () => {
      expect(labelToKey('赛事')).toBe('赛事')
      expect(labelToKey('组别')).toBe('组别')
    })

    it('空字符串抛错', () => {
      expect(() => labelToKey('')).toThrow('不能为空')
      expect(() => labelToKey('   ')).toThrow('不能为空')
    })

    it('混合中英文保留原值', () => {
      expect(labelToKey('赛事event')).toBe('赛事event')
    })
  })

  describe('createField', () => {
    it('正常创建 string 类型字段', () => {
      const f = customFieldService.createField('赛事', 'string')
      expect(f.field_key).toBe('赛事')
      expect(f.field_label).toBe('赛事')
      expect(f.field_type).toBe('string')
      expect(f.sort_order).toBe(0)
      expect(f.created_at).toBeTruthy()
    })

    it('正常创建 tags 类型字段', () => {
      const f = customFieldService.createField('Themes', 'tags')
      expect(f.field_key).toBe('themes')
      expect(f.field_type).toBe('tags')
    })

    it('重复创建抛错', () => {
      customFieldService.createField('赛事', 'string')
      expect(() => customFieldService.createField('赛事', 'string')).toThrow('已存在')
    })

    it('英文 label 大小写不同但 key 相同也抛错', () => {
      customFieldService.createField('Event', 'string')
      expect(() => customFieldService.createField('EVENT', 'string')).toThrow('已存在')
    })

    it('sort_order 自增', () => {
      const f1 = customFieldService.createField('A', 'string')
      const f2 = customFieldService.createField('B', 'string')
      const f3 = customFieldService.createField('C', 'string')
      expect(f1.sort_order).toBe(0)
      expect(f2.sort_order).toBe(1)
      expect(f3.sort_order).toBe(2)
    })
  })

  describe('listAll', () => {
    it('按 sort_order 排序', () => {
      customFieldService.createField('C', 'string') // order 0
      customFieldService.createField('A', 'string') // order 1
      customFieldService.createField('B', 'string') // order 2
      const all = customFieldService.listAll()
      expect(all.map((f) => f.field_label)).toEqual(['C', 'A', 'B'])
    })

    it('空表返回空数组', () => {
      expect(customFieldService.listAll()).toEqual([])
    })
  })

  describe('updateField', () => {
    it('更新 label', () => {
      customFieldService.createField('赛事', 'string')
      customFieldService.updateField('赛事', { field_label: '比赛' })
      const all = customFieldService.listAll()
      expect(all[0].field_label).toBe('比赛')
      expect(all[0].field_key).toBe('赛事') // key 不变
    })

    it('更新 sort_order', () => {
      customFieldService.createField('A', 'string') // key='a', order 0
      customFieldService.createField('B', 'string') // key='b', order 1
      // updateField 第一个参数是 field_key（labelToKey('B')='b'），不是 label
      customFieldService.updateField('b', { sort_order: -1 })
      const all = customFieldService.listAll()
      expect(all[0].field_label).toBe('B')
    })

    it('空 patch 不报错', () => {
      customFieldService.createField('A', 'string')
      expect(() => customFieldService.updateField('A', {})).not.toThrow()
    })
  })

  describe('deleteField', () => {
    it('删除后 listAll 不含', () => {
      customFieldService.createField('赛事', 'string')
      customFieldService.deleteField('赛事')
      expect(customFieldService.listAll()).toHaveLength(0)
    })

    it('删除不存在的字段不报错', () => {
      expect(() => customFieldService.deleteField('不存在')).not.toThrow()
    })
  })

  describe('exists', () => {
    it('按 field_key 查询', () => {
      customFieldService.createField('赛事', 'string')
      expect(customFieldService.exists('赛事')).toBe(true)
      expect(customFieldService.exists('组别')).toBe(false)
    })

    it('按 field_label 查询', () => {
      customFieldService.createField('Event', 'string') // key='event'
      expect(customFieldService.exists('Event')).toBe(true) // label 匹配
      expect(customFieldService.exists('event')).toBe(true) // key 匹配
    })
  })
})
