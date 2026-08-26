import { describe, it, expect } from 'vitest'
import {
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  SUPPORTED_VERSIONS,
  validateBackupPackage,
  migratePackage,
  buildExportMetadata,
  planEventScopedRead
} from '../protocol/backup-protocol'
import { BACKUP_CATEGORIES, BACKUP_RESTORE_ORDER, BackupCategoryKey } from '@shared/constants'

describe('core backup-protocol: 常量', () => {
  it('bianhe-backup-v1 协议常量', () => {
    expect(PROTOCOL_VERSION).toBe('1')
    expect(SCHEMA_VERSION).toBe('1')
    expect(SUPPORTED_VERSIONS).toContain('1.0')
  })
})

describe('core backup-protocol: validateBackupPackage', () => {
  it('合法 v1 包通过；未知版本拒绝；缺 tables 拒绝', () => {
    expect(validateBackupPackage({ version: '1.0', tables: { topics: [{}] } }).ok).toBe(true)
    expect(validateBackupPackage({ version: '2.0', tables: {} }).ok).toBe(false)
    expect(validateBackupPackage({ version: '1.0' }).ok).toBe(false)
    expect(validateBackupPackage(null).ok).toBe(false)
  })

  it('非数组表值（桌面包 bell_files 字典）→ warning 不拒绝', () => {
    const r = validateBackupPackage({ version: '1.0', tables: { bell_files: { 'a.mp3': 'x' } } })
    expect(r.ok).toBe(true)
    expect(r.warnings[0]).toContain('bell_files')
  })
})

describe('core backup-protocol: migratePackage / buildExportMetadata / planEventScopedRead', () => {
  it('migratePackage 当前原样返回（MIGRATIONS 未注册）', () => {
    const r = migratePackage({ version: '1.0', schemaVersion: '1', tables: {} })
    expect(r.applied).toEqual([])
    expect((r.data as any).version).toBe('1.0')
  })

  it('buildExportMetadata 统计条数，非数组计 0', () => {
    expect(buildExportMetadata({ topics: [{}, {}], bell_files: { a: 'x' } }).counts).toEqual({
      topics: 2,
      bell_files: 0
    })
  })

  it('planEventScopedRead 分片（_in 上限 10）', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `e${i}`)
    expect(planEventScopedRead(ids, 10)).toHaveLength(2)
    expect(planEventScopedRead(ids, 10)[0]).toHaveLength(10)
    expect(planEventScopedRead([])).toEqual([])
    expect(planEventScopedRead(null)).toEqual([])
  })
})

describe('端侧 restore-order 结构性不变量（桌面 12 类，Cross-End Golden #5）', () => {
  // 最小父类依赖边表（与 constants.ts 注释一致；未声明边的类别视为独立不检查——宁弱不假失败）
  const CATEGORY_EDGES: Array<[BackupCategoryKey, BackupCategoryKey]> = [
    ['topics', 'draw_records'], // draw_session_items/team_history 引用 topics
    ['events', 'draw_records'], // team_history 引用 events
    ['draw_records', 'match_records'], // matches 依赖 draw_records
    ['topics', 'topic_groups'], // topic_group_items 引用 topics
    ['events', 'topic_groups'] // event_topic_groups 引用 events
  ]
  // 同类别内父表→子表（父表须先于子表出现在该类的 tables 列表）
  const TABLE_EDGES: Array<[BackupCategoryKey, string, string]> = [
    ['topics', 'topics', 'topic_custom_fields'],
    ['events', 'events', 'rounds'],
    ['events', 'events', 'team_groups'],
    ['events', 'events', 'teams'],
    ['draw_records', 'draw_sessions', 'draw_session_items'],
    ['timer', 'timer_sessions', 'timer_records'],
    ['match_records', 'match_judges', 'match_judge_votes'],
    ['agent_sessions', 'agent_sessions', 'agent_messages'],
    ['badges', 'badges', 'team_bindings'],
    ['badges', 'badges', 'badge_files'],
    ['topic_groups', 'topic_groups', 'topic_group_items'],
    ['topic_groups', 'topic_groups', 'event_topic_groups'],
    ['topic_groups', 'topic_groups', 'round_topic_groups']
  ]

  it('BACKUP_RESTORE_ORDER 是类别键的合法排列', () => {
    const keys = BACKUP_CATEGORIES.map((c) => c.key)
    expect(BACKUP_RESTORE_ORDER.length).toBe(keys.length)
    expect(new Set(BACKUP_RESTORE_ORDER).size).toBe(keys.length)
    for (const k of keys) expect(BACKUP_RESTORE_ORDER).toContain(k)
  })

  it('类别级依赖：父类先于子类恢复', () => {
    for (const [parent, child] of CATEGORY_EDGES) {
      const pi = BACKUP_RESTORE_ORDER.indexOf(parent)
      const ci = BACKUP_RESTORE_ORDER.indexOf(child)
      expect(pi).toBeGreaterThanOrEqual(0)
      expect(ci).toBeGreaterThanOrEqual(0)
      expect(pi).toBeLessThan(ci)
    }
  })

  it('表级依赖：同类内父表先于子表', () => {
    const tablesByCat = new Map(BACKUP_CATEGORIES.map((c) => [c.key, c.tables]))
    for (const [cat, parent, child] of TABLE_EDGES) {
      const tables = tablesByCat.get(cat)
      expect(tables, `类别 ${cat} 应存在`).toBeDefined()
      const list = tables as readonly string[]
      expect(list.indexOf(parent)).toBeLessThan(list.indexOf(child))
    }
  })
})
