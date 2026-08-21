// ============================================================
// backup-service.test.ts — 全量数据一键导入导出单元测试
//
// 覆盖 Task 8.1 backup-service 的核心函数：
//   - exportBackup：按 categories 聚合各 repo 数据组装 BackupPackage
//   - previewImport：读取备份文件并解析头部 + 各表行数
//   - importBackup：按 strategy 与 categories 调用 bulkInsert/clearTable
//   - writeBackupFile：写入备份 JSON 文件
//
// 用 vi.mock 模拟所有 repository 与 utils，验证编排逻辑（不依赖真实 better-sqlite3）。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ---- mock 所有 repo ----
vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: {
    findAllForBackup: vi.fn<() => Array<Record<string, unknown>>>(),
    findAllCustomFieldsForBackup: vi.fn<() => Array<Record<string, unknown>>>(),
    bulkRestoreTopics: vi.fn(),
    bulkRestoreCustomFields: vi.fn()
  }
}))
vi.mock('../../db/repository/event.repo', () => ({
  eventRepo: {
    findAllForBackup: vi.fn()
  }
}))
vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: {
    findAllForBackup: vi.fn()
  }
}))
vi.mock('../../db/repository/format.repo', () => ({
  formatRepo: {
    findAllForBackup: vi.fn<() => Array<Record<string, unknown>>>()
  }
}))
vi.mock('../../db/repository/bell-asset.repo', () => ({
  bellAssetRepo: {
    findAllForBackup: vi.fn<() => Array<Record<string, unknown>>>(),
    encodeBellFiles: vi.fn<() => Record<string, string>>(),
    decodeBellFiles: vi.fn<() => number>()
  }
}))
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    findAllForBackup: vi.fn()
  }
}))
vi.mock('../../db/repository/timer-session.repo', () => ({
  timerSessionRepo: {
    findAllForBackup: vi.fn()
  }
}))
vi.mock('../../db/repository/import-batch.repo', () => ({
  importBatchRepo: {
    findAllForBackup: vi.fn<() => Array<Record<string, unknown>>>()
  }
}))
vi.mock('../../db/repository/batch-edit-history.repo', () => ({
  batchEditHistoryRepo: {
    findAllForBackup: vi.fn()
  }
}))
vi.mock('../../db/repository/undo-log.repo', () => ({
  undoLogRepo: {
    findAllForBackup: vi.fn<() => Array<Record<string, unknown>>>()
  }
}))
vi.mock('../../db/repository/judge-history.repo', () => ({
  judgeHistoryRepo: {
    findAllForBackup: vi.fn<() => Array<Record<string, unknown>>>()
  }
}))
vi.mock('../../services/badge-storage', () => ({
  findForBackup: vi.fn<() => { registry: unknown[]; bindings: Record<string, unknown>; fileNames: string[] }>(),
  encodeBadgeFiles: vi.fn<() => Record<string, string>>(),
  restoreBackup: vi.fn<() => number>()
}))

// ---- mock utils（bulkInsert / clearTable / TABLE_COLUMNS）----
// P4 修复：补充 TABLE_COLUMNS mock，供 getBackupStats 白名单校验使用
vi.mock('../../db/repository/utils', () => ({
  bulkInsert: vi.fn<
    (
      table: string,
      rows: Array<Record<string, unknown>>,
      strategy: string
    ) => number
  >(),
  clearTable: vi.fn<(table: string) => void>(),
  TABLE_COLUMNS: {
    topics: ['id'],
    topic_custom_fields: ['id'],
    events: ['id'],
    rounds: ['id'],
    team_groups: ['id'],
    teams: ['id'],
    draw_sessions: ['id'],
    draw_session_items: ['id'],
    team_history: ['id'],
    timer_sessions: ['id'],
    timer_records: ['id'],
    debate_formats: ['id'],
    bell_assets: ['id'],
    settings: ['key'],
    audit_log: ['id'],
    import_batch: ['id'],
    batch_edit_history: ['id'],
    batch_edit_history_item: ['id'],
    undo_log: ['id'],
    judge_history: ['id']
  } as Record<string, string[]>
}))

// ---- mock getDb ----
// 默认实现：transaction 立即执行回调，不抛错
const mockExec = vi.fn()
const mockPrepare = vi.fn(() => ({
  run: vi.fn(() => ({ changes: 1 })),
  all: vi.fn(() => []),
  get: vi.fn(() => undefined)
}))
const mockTransaction = vi.fn((fn: () => unknown) => () => fn())
// P1-4: backup-service.importBackup 调用 db.pragma 切换外键约束，mock 需提供 pragma 方法
const mockPragma = vi.fn(() => [])

vi.mock('../../db/index', () => ({
  getDb: vi.fn(() => ({
    transaction: mockTransaction,
    prepare: mockPrepare,
    exec: mockExec,
    pragma: mockPragma
  }))
}))

// ---- 在 mock 之后 import ----
import {
  exportBackup,
  previewImport,
  importBackup,
  writeBackupFile,
  getBackupStats
} from '../backup-service'
import { topicRepo } from '../../db/repository/topic.repo'
import { eventRepo } from '../../db/repository/event.repo'
import { drawRepo } from '../../db/repository/draw.repo'
import { formatRepo } from '../../db/repository/format.repo'
import { bellAssetRepo } from '../../db/repository/bell-asset.repo'
import { auditRepo } from '../../db/repository/audit.repo'
import { timerSessionRepo } from '../../db/repository/timer-session.repo'
import { importBatchRepo } from '../../db/repository/import-batch.repo'
import { batchEditHistoryRepo } from '../../db/repository/batch-edit-history.repo'
import { undoLogRepo } from '../../db/repository/undo-log.repo'
import { judgeHistoryRepo } from '../../db/repository/judge-history.repo'
import {
  findForBackup as badgeFindForBackup,
  encodeBadgeFiles as badgeEncodeBadgeFiles,
  restoreBackup as badgeRestoreBackup
} from '../../services/badge-storage'
import { bulkInsert, clearTable } from '../../db/repository/utils'
import { SUPPORTED_BACKUP_VERSION } from '../../../shared/constants'
import type {
  BackupParams,
  BackupImportParams,
  BackupPackage
} from '../../../shared/types'

// ============================================================
// 辅助函数
// ============================================================

/** 在系统临时目录中写入 JSON 文件，返回文件路径 */
function writeTempJson(data: unknown): string {
  const tmpDir = os.tmpdir()
  const tmpFile = path.join(
    tmpDir,
    `backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  )
  fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf-8')
  return tmpFile
}

/** 清理临时文件，失败忽略 */
function cleanup(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch {
    /* ignore */
  }
}

/**
 * 构造最小合法 BackupPackage。
 * tables 字段类型在 BackupPackage 中是联合类型（数组 | 字典），混合赋值时 TS 推断困难，
 * 因此此处将 overrides.tables 类型放宽为 any，仅用于测试构造数据。
 */
function makePkg(
  overrides: Partial<Omit<BackupPackage, 'tables'>> & {
    tables?: Record<string, unknown>
  } = {}
): BackupPackage {
  return {
    version: SUPPORTED_BACKUP_VERSION,
    exportedAt: '2026-07-29T12:00:00.000Z',
    appVersion: '1.0.0',
    categories: ['topics'],
    tables: { topics: [], topic_custom_fields: [] },
    ...overrides
  } as BackupPackage
}

// ============================================================
// 测试套件
// ============================================================

describe('backup-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重置 transaction 默认行为：立即执行回调
    mockTransaction.mockImplementation((fn: () => unknown) => () => fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================
  // exportBackup
  // ============================================================
  describe('exportBackup', () => {
    const allCategories: BackupParams['categories'] = [
      'topics',
      'events',
      'draw_records',
      'timer',
      'formats_bells',
      'settings',
      'audit_history',
      'judge_history',
      'badges'
    ]

    beforeEach(() => {
      // 为各 repo 设置默认 mock 返回值
      vi.mocked(topicRepo.findAllForBackup).mockReturnValue([
        { id: 't1', title: '题1' }
      ])
      vi.mocked(topicRepo.findAllCustomFieldsForBackup).mockReturnValue([
        { id: 'cf1', topic_id: 't1' }
      ])
      vi.mocked(eventRepo.findAllForBackup).mockReturnValue({
        events: [{ id: 'e1', name: '赛事1' }],
        rounds: [{ id: 'r1', event_id: 'e1' }],
        team_groups: [{ id: 'g1', event_id: 'e1' }],
        teams: [{ id: 'tm1', event_id: 'e1' }]
      })
      vi.mocked(drawRepo.findAllForBackup).mockReturnValue({
        draw_sessions: [{ id: 'ds1' }],
        draw_session_items: [{ id: 'dsi1' }],
        team_history: [{ id: 'th1' }]
      })
      vi.mocked(timerSessionRepo.findAllForBackup).mockReturnValue({
        timer_sessions: [{ id: 'ts1' }],
        timer_records: [{ id: 'tr1' }]
      })
      vi.mocked(formatRepo.findAllForBackup).mockReturnValue([
        { id: 'df1', name: '赛制1' }
      ])
      vi.mocked(bellAssetRepo.findAllForBackup).mockReturnValue([
        { id: 'ba1', file_path: 'bell1.mp3' }
      ])
      vi.mocked(bellAssetRepo.encodeBellFiles).mockReturnValue({
        'bell1.mp3': 'base64content'
      })
      vi.mocked(auditRepo.findAllForBackup).mockReturnValue({
        audit_log: [{ id: 'al1' }],
        settings: [{ key: 'k1', value: 'v1' }]
      })
      vi.mocked(importBatchRepo.findAllForBackup).mockReturnValue([
        { id: 'ib1' }
      ])
      vi.mocked(batchEditHistoryRepo.findAllForBackup).mockReturnValue({
        batch_edit_history: [{ id: 'beh1' }],
        batch_edit_history_item: [{ id: 'behi1' }]
      })
      vi.mocked(undoLogRepo.findAllForBackup).mockReturnValue([{ id: 'ul1' }])
      vi.mocked(judgeHistoryRepo.findAllForBackup).mockReturnValue([
        { id: 'jh1', judge_id: 'j1', result_json: '{"winner":"aff"}' }
      ])
      vi.mocked(badgeFindForBackup).mockReturnValue({
        registry: [{ id: 'custom-1', name: '校徽A', kind: 'custom', fileName: 'a.png' }],
        bindings: { team1: 'custom-1' },
        fileNames: ['a.png']
      })
      vi.mocked(badgeEncodeBadgeFiles).mockReturnValue({ 'a.png': 'base64badge' })
    })

    it('全类别导出包含所有表', () => {
      const pkg = exportBackup({ categories: allCategories })

      // 版本号正确
      expect(pkg.version).toBe(SUPPORTED_BACKUP_VERSION)
      // categories 包含全部 9 个
      expect(pkg.categories).toEqual(allCategories)
      expect(pkg.categories).toHaveLength(9)
      // tables 包含所有预期的表 key
      const expectedTables = [
        'topics',
        'topic_custom_fields',
        'events',
        'rounds',
        'team_groups',
        'teams',
        'draw_sessions',
        'draw_session_items',
        'team_history',
        'timer_sessions',
        'timer_records',
        'debate_formats',
        'bell_assets',
        'bell_files',
        'settings',
        'audit_log',
        'import_batch',
        'batch_edit_history',
        'batch_edit_history_item',
        'undo_log',
        'judge_history',
        'badges',
        'team_bindings',
        'badge_files'
      ]
      for (const t of expectedTables) {
        expect(pkg.tables).toHaveProperty(t)
      }
      // bell_files 是 Record<string, string> 类型
      expect(pkg.tables.bell_files).toEqual({ 'bell1.mp3': 'base64content' })
      // judge_history 与队徽相关表
      expect(pkg.tables.judge_history).toHaveLength(1)
      expect(pkg.tables.badges).toEqual([
        { id: 'custom-1', name: '校徽A', kind: 'custom', fileName: 'a.png' }
      ])
      expect(pkg.tables.team_bindings).toEqual({ team1: 'custom-1' })
      expect(pkg.tables.badge_files).toEqual({ 'a.png': 'base64badge' })
      // exportedAt 是合法 ISO 时间字符串
      const exportedAt = pkg.exportedAt
      expect(typeof exportedAt).toBe('string')
      expect(new Date(exportedAt).toISOString()).toBe(exportedAt)
    })

    it('部分类别导出只含对应表', () => {
      const pkg = exportBackup({ categories: ['topics'] })

      // topics 类别对应 topics + topic_custom_fields
      expect(pkg.tables).toHaveProperty('topics')
      expect(pkg.tables).toHaveProperty('topic_custom_fields')
      // 不应包含 events / draw_sessions 等
      expect(pkg.tables).not.toHaveProperty('events')
      expect(pkg.tables).not.toHaveProperty('rounds')
      expect(pkg.tables).not.toHaveProperty('draw_sessions')
      expect(pkg.tables).not.toHaveProperty('timer_sessions')
      expect(pkg.tables).not.toHaveProperty('debate_formats')
      expect(pkg.tables).not.toHaveProperty('bell_assets')
      expect(pkg.tables).not.toHaveProperty('bell_files')
      expect(pkg.tables).not.toHaveProperty('settings')
      expect(pkg.tables).not.toHaveProperty('audit_log')
      expect(pkg.tables).not.toHaveProperty('judge_history')
      expect(pkg.tables).not.toHaveProperty('badges')
      expect(pkg.tables).not.toHaveProperty('team_bindings')
      expect(pkg.tables).not.toHaveProperty('badge_files')
      // 其他 repo 不应被调用
      expect(eventRepo.findAllForBackup).not.toHaveBeenCalled()
      expect(drawRepo.findAllForBackup).not.toHaveBeenCalled()
      expect(auditRepo.findAllForBackup).not.toHaveBeenCalled()
      expect(judgeHistoryRepo.findAllForBackup).not.toHaveBeenCalled()
      expect(badgeFindForBackup).not.toHaveBeenCalled()
      expect(badgeEncodeBadgeFiles).not.toHaveBeenCalled()
    })

    it('铃声文件 Base64 编码正确', () => {
      vi.mocked(bellAssetRepo.encodeBellFiles).mockReturnValue({
        'bell1.mp3': 'base64content',
        'bell2.mp3': 'base64content2'
      })
      const pkg = exportBackup({ categories: ['formats_bells'] })

      expect(pkg.tables.bell_files).toEqual({
        'bell1.mp3': 'base64content',
        'bell2.mp3': 'base64content2'
      })
      // encodeBellFiles 应被调用一次
      expect(bellAssetRepo.encodeBellFiles).toHaveBeenCalledTimes(1)
      // 不勾选 formats_bells 时不应调用 encodeBellFiles
      vi.mocked(bellAssetRepo.encodeBellFiles).mockClear()
      exportBackup({ categories: ['topics'] })
      expect(bellAssetRepo.encodeBellFiles).not.toHaveBeenCalled()
    })
  })

  // ============================================================
  // previewImport
  // ============================================================
  describe('previewImport', () => {
    it('正确解析 version/exportedAt/categories/tableCounts', () => {
      const pkg = makePkg({
        categories: ['topics'],
        tables: {
          topics: [{ id: '1' }, { id: '2' }],
          topic_custom_fields: []
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        const result = previewImport(filePath)

        expect(result.version).toBe(SUPPORTED_BACKUP_VERSION)
        expect(result.exportedAt).toBe('2026-07-29T12:00:00.000Z')
        expect(result.appVersion).toBe('1.0.0')
        expect(result.categories).toHaveLength(1)
        expect(result.categories).toEqual(['topics'])
        expect(result.tableCounts.topics).toBe(2)
        expect(result.tableCounts.topic_custom_fields).toBe(0)
      } finally {
        cleanup(filePath)
      }
    })

    it('版本不兼容抛错', () => {
      const pkg = makePkg({ version: '2.0' })
      const filePath = writeTempJson(pkg)
      try {
        expect(() => previewImport(filePath)).toThrow('不支持的备份版本')
      } finally {
        cleanup(filePath)
      }
    })

    it('bell_files 字典类型计入 tableCounts（按 key 数量）', () => {
      const pkg = makePkg({
        categories: ['formats_bells'],
        tables: {
          debate_formats: [{ id: 'df1' }],
          bell_assets: [{ id: 'ba1' }, { id: 'ba2' }],
          bell_files: {
            'bell1.mp3': 'base64a',
            'bell2.mp3': 'base64b',
            'bell3.mp3': 'base64c'
          }
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        const result = previewImport(filePath)
        expect(result.tableCounts.bell_files).toBe(3)
        expect(result.tableCounts.bell_assets).toBe(2)
        expect(result.tableCounts.debate_formats).toBe(1)
      } finally {
        cleanup(filePath)
      }
    })
  })

  // ============================================================
  // importBackup
  // ============================================================
  describe('importBackup', () => {
    it('clear_rebuild 策略先清空再插入', () => {
      const pkg = makePkg({
        categories: ['topics'],
        tables: {
          topics: [
            { id: '1', title: '题1' },
            { id: '2', title: '题2' }
          ],
          topic_custom_fields: []
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        // bulkInsert 返回 2（两条都插入成功）
        vi.mocked(bulkInsert).mockReturnValue(2)

        const params: BackupImportParams = {
          filePath,
          strategy: 'clear_rebuild',
          categories: ['topics']
        }
        const result = importBackup(params)

        // clearTable 应被调用（针对 topics + topic_custom_fields，反向顺序）
        expect(clearTable).toHaveBeenCalled()
        const clearedTables = vi.mocked(clearTable).mock.calls.map((c) => c[0])
        // topics 类别含 topics + topic_custom_fields，都应被清空
        expect(clearedTables).toContain('topics')
        expect(clearedTables).toContain('topic_custom_fields')
        // 反向顺序：topic_custom_fields 应先于 topics 清空
        const cfIdx = clearedTables.indexOf('topic_custom_fields')
        const tIdx = clearedTables.indexOf('topics')
        expect(cfIdx).toBeLessThan(tIdx)

        // bulkInsert 被调用，strategy='clear_rebuild'
        expect(bulkInsert).toHaveBeenCalledWith(
          'topics',
          expect.arrayContaining([
            expect.objectContaining({ id: '1' }),
            expect.objectContaining({ id: '2' })
          ]),
          'clear_rebuild'
        )

        // 返回 inserted === 2
        expect(result.inserted).toBe(2)
        expect(result.skipped).toBe(0)
        expect(result.overwritten).toBe(0)
      } finally {
        cleanup(filePath)
      }
    })

    it('skip_existing 策略使用 INSERT OR IGNORE 语义', () => {
      const pkg = makePkg({
        categories: ['events'],
        tables: {
          events: [
            { id: 'e1' },
            { id: 'e2' },
            { id: 'e3' }
          ],
          rounds: [],
          team_groups: [],
          teams: []
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        // bulkInsert 返回 2（一条被跳过）
        vi.mocked(bulkInsert).mockReturnValue(2)

        const params: BackupImportParams = {
          filePath,
          strategy: 'skip_existing',
          categories: ['events']
        }
        const result = importBackup(params)

        // clearTable 未被调用
        expect(clearTable).not.toHaveBeenCalled()
        // bulkInsert 被调用，strategy='skip_existing'
        expect(bulkInsert).toHaveBeenCalledWith(
          'events',
          expect.any(Array),
          'skip_existing'
        )
        // 返回 inserted === 2, skipped === 1
        expect(result.inserted).toBe(2)
        expect(result.skipped).toBe(1)
        expect(result.overwritten).toBe(0)
      } finally {
        cleanup(filePath)
      }
    })

    it('overwrite_existing 策略使用 INSERT OR REPLACE 语义', () => {
      const pkg = makePkg({
        categories: ['events'],
        tables: {
          events: [
            { id: 'e1' },
            { id: 'e2' },
            { id: 'e3' }
          ],
          rounds: [],
          team_groups: [],
          teams: []
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        // overwrite_existing 下 bulkInsert 返回 3（覆盖+新增共 3 次）
        vi.mocked(bulkInsert).mockReturnValue(3)

        const params: BackupImportParams = {
          filePath,
          strategy: 'overwrite_existing',
          categories: ['events']
        }
        const result = importBackup(params)

        // clearTable 未被调用
        expect(clearTable).not.toHaveBeenCalled()
        // bulkInsert 被调用，strategy='overwrite_existing'
        expect(bulkInsert).toHaveBeenCalledWith(
          'events',
          expect.any(Array),
          'overwrite_existing'
        )
        // 返回 overwritten === 3
        expect(result.overwritten).toBe(3)
        expect(result.inserted).toBe(0)
        expect(result.skipped).toBe(0)
      } finally {
        cleanup(filePath)
      }
    })

    it('事务失败回滚', () => {
      const pkg = makePkg({
        categories: ['topics'],
        tables: {
          topics: [{ id: '1', title: '题1' }],
          topic_custom_fields: []
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        // bulkInsert 抛错模拟事务内失败
        vi.mocked(bulkInsert).mockImplementation(() => {
          throw new Error('模拟事务失败')
        })

        const params: BackupImportParams = {
          filePath,
          strategy: 'clear_rebuild',
          categories: ['topics']
        }
        // importBackup 应抛错
        expect(() => importBackup(params)).toThrow('模拟事务失败')
      } finally {
        cleanup(filePath)
      }
    })

    it('仅导入用户勾选的类别', () => {
      const pkg = makePkg({
        categories: ['topics', 'events'],
        tables: {
          topics: [{ id: 't1', title: '题1' }],
          topic_custom_fields: [],
          events: [{ id: 'e1' }],
          rounds: [],
          team_groups: [],
          teams: []
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        vi.mocked(bulkInsert).mockReturnValue(1)

        const params: BackupImportParams = {
          filePath,
          strategy: 'clear_rebuild',
          categories: ['topics'] // 只勾选 topics
        }
        importBackup(params)

        // bulkInsert 应只针对 topics 表调用，不应对 events 相关表调用
        const insertedTables = vi.mocked(bulkInsert).mock.calls.map((c) => c[0])
        expect(insertedTables).toContain('topics')
        expect(insertedTables).not.toContain('events')
        expect(insertedTables).not.toContain('rounds')
        expect(insertedTables).not.toContain('team_groups')
        expect(insertedTables).not.toContain('teams')

        // clearTable 也只针对 topics 类别的表
        const clearedTables = vi.mocked(clearTable).mock.calls.map((c) => c[0])
        expect(clearedTables).toContain('topics')
        expect(clearedTables).toContain('topic_custom_fields')
        expect(clearedTables).not.toContain('events')
      } finally {
        cleanup(filePath)
      }
    })

    it('judge_history 表通过 bulkInsert 还原', () => {
      const pkg = makePkg({
        categories: ['judge_history'],
        tables: {
          judge_history: [
            { id: 'jh1', judge_id: 'j1', result_json: '{"winner":"aff"}' },
            { id: 'jh2', judge_id: 'j2' }
          ]
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        vi.mocked(bulkInsert).mockReturnValue(2)

        const params: BackupImportParams = {
          filePath,
          strategy: 'clear_rebuild',
          categories: ['judge_history']
        }
        const result = importBackup(params)

        // clear + bulkInsert 针对 judge_history
        expect(clearTable).toHaveBeenCalledWith('judge_history')
        expect(bulkInsert).toHaveBeenCalledWith(
          'judge_history',
          expect.arrayContaining([
            expect.objectContaining({ id: 'jh1' }),
            expect.objectContaining({ id: 'jh2' })
          ]),
          'clear_rebuild'
        )
        expect(result.inserted).toBe(2)
        expect(result.badgeFilesRestored).toBe(0)
      } finally {
        cleanup(filePath)
      }
    })

    it('badges 类别还原：调用 restoreBackup，不对虚拟表 bulkInsert，也不 clearTable', () => {
      const pkg = makePkg({
        categories: ['badges'],
        tables: {
          badges: [{ id: 'custom-1', kind: 'custom', fileName: 'a.png' }],
          team_bindings: { team1: 'custom-1' },
          badge_files: { 'a.png': 'base64badge' }
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        vi.mocked(bulkInsert).mockReturnValue(0)
        vi.mocked(badgeRestoreBackup).mockReturnValue(1)

        const params: BackupImportParams = {
          filePath,
          strategy: 'overwrite_existing',
          categories: ['badges']
        }
        const result = importBackup(params)

        // restoreBackup 以文件/注册/绑定还原
        expect(badgeRestoreBackup).toHaveBeenCalledWith(
          {
            registry: [{ id: 'custom-1', kind: 'custom', fileName: 'a.png' }],
            bindings: { team1: 'custom-1' },
            files: { 'a.png': 'base64badge' }
          },
          undefined,
          'overwrite_existing'
        )
        // 虚拟表（badges/team_bindings/badge_files）不在 TABLE_COLUMNS 白名单内，
        // 不应触发 clearTable / bulkInsert
        expect(clearTable).not.toHaveBeenCalled()
        expect(bulkInsert).not.toHaveBeenCalled()
        expect(result.badgeFilesRestored).toBe(1)
      } finally {
        cleanup(filePath)
      }
    })

    it('备份不含 badges/未勾选 badges 时不调用 restoreBackup', () => {
      const pkg = makePkg({
        categories: ['topics'],
        tables: { topics: [], topic_custom_fields: [] }
      })
      const filePath = writeTempJson(pkg)
      try {
        const params: BackupImportParams = {
          filePath,
          strategy: 'clear_rebuild',
          categories: ['topics']
        }
        importBackup(params)
        expect(badgeRestoreBackup).not.toHaveBeenCalled()
      } finally {
        cleanup(filePath)
      }
    })

    it('铃声文件从 Base64 还原', () => {
      const pkg = makePkg({
        categories: ['formats_bells'],
        tables: {
          debate_formats: [{ id: 'df1' }],
          bell_assets: [{ id: 'ba1' }],
          bell_files: {
            'bell1.mp3': 'base64a',
            'bell2.mp3': 'base64b'
          }
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        vi.mocked(bulkInsert).mockReturnValue(1)
        vi.mocked(bellAssetRepo.decodeBellFiles).mockReturnValue(2)

        const params: BackupImportParams = {
          filePath,
          strategy: 'clear_rebuild',
          categories: ['formats_bells']
        }
        const result = importBackup(params)

        // decodeBellFiles 应被调用，传入 bell_files 字典与 strategy
        expect(bellAssetRepo.decodeBellFiles).toHaveBeenCalledWith(
          { 'bell1.mp3': 'base64a', 'bell2.mp3': 'base64b' },
          'clear_rebuild'
        )
        // 返回 bellFilesRestored === 2
        expect(result.bellFilesRestored).toBe(2)
      } finally {
        cleanup(filePath)
      }
    })

    it('备份不含 bell_files 时不调用 decodeBellFiles', () => {
      const pkg = makePkg({
        categories: ['formats_bells'],
        tables: {
          debate_formats: [{ id: 'df1' }],
          bell_assets: [{ id: 'ba1' }]
          // 注意：没有 bell_files 字段
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        vi.mocked(bulkInsert).mockReturnValue(1)

        const params: BackupImportParams = {
          filePath,
          strategy: 'clear_rebuild',
          categories: ['formats_bells']
        }
        const result = importBackup(params)

        expect(bellAssetRepo.decodeBellFiles).not.toHaveBeenCalled()
        expect(result.bellFilesRestored).toBe(0)
      } finally {
        cleanup(filePath)
      }
    })

    it('未勾选 formats_bells 时不调用 decodeBellFiles（即使备份含 bell_files）', () => {
      const pkg = makePkg({
        categories: ['topics', 'formats_bells'],
        tables: {
          topics: [{ id: 't1' }],
          topic_custom_fields: [],
          debate_formats: [],
          bell_assets: [],
          bell_files: { 'bell1.mp3': 'base64a' }
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        vi.mocked(bulkInsert).mockReturnValue(1)

        const params: BackupImportParams = {
          filePath,
          strategy: 'clear_rebuild',
          categories: ['topics'] // 未勾选 formats_bells
        }
        const result = importBackup(params)

        expect(bellAssetRepo.decodeBellFiles).not.toHaveBeenCalled()
        expect(result.bellFilesRestored).toBe(0)
      } finally {
        cleanup(filePath)
      }
    })

    it('空行表不会被调用 bulkInsert', () => {
      const pkg = makePkg({
        categories: ['topics'],
        tables: {
          topics: [],
          topic_custom_fields: []
        }
      })
      const filePath = writeTempJson(pkg)
      try {
        const params: BackupImportParams = {
          filePath,
          strategy: 'clear_rebuild',
          categories: ['topics']
        }
        const result = importBackup(params)

        // 空数组不应触发 bulkInsert
        expect(bulkInsert).not.toHaveBeenCalled()
        // 但 clear_rebuild 策略下 clearTable 仍会调用（表存在）
        expect(clearTable).toHaveBeenCalled()
        expect(result.inserted).toBe(0)
      } finally {
        cleanup(filePath)
      }
    })
  })

  // ============================================================
  // writeBackupFile
  // ============================================================
  describe('writeBackupFile', () => {
    it('正确写入 JSON 文件', () => {
      const tmpDir = os.tmpdir()
      const filePath = path.join(
        tmpDir,
        `backup-write-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
      )
      const pkg = makePkg({
        categories: ['topics'],
        tables: { topics: [{ id: 't1' }], topic_custom_fields: [] }
      })

      try {
        writeBackupFile(filePath, pkg)

        // 文件存在
        expect(fs.existsSync(filePath)).toBe(true)
        // 读回内容应与原 pkg 一致
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        expect(parsed.version).toBe(SUPPORTED_BACKUP_VERSION)
        expect(parsed.exportedAt).toBe('2026-07-29T12:00:00.000Z')
        expect(parsed.appVersion).toBe('1.0.0')
        expect(parsed.categories).toEqual(['topics'])
        expect(parsed.tables.topics).toEqual([{ id: 't1' }])
        expect(parsed.tables.topic_custom_fields).toEqual([])
      } finally {
        cleanup(filePath)
      }
    })

    it('目录不存在时自动创建', () => {
      const tmpDir = os.tmpdir()
      // 构造一个不存在的多层子目录
      const nestedDir = path.join(
        tmpDir,
        `backup-nested-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        'subdir',
        'deeper'
      )
      const filePath = path.join(nestedDir, 'backup.json')
      const pkg = makePkg()

      try {
        // 确保父目录不存在
        expect(fs.existsSync(nestedDir)).toBe(false)

        writeBackupFile(filePath, pkg)

        // 文件应被创建
        expect(fs.existsSync(filePath)).toBe(true)
        const raw = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        expect(parsed.version).toBe(SUPPORTED_BACKUP_VERSION)
      } finally {
        // 清理：删除创建的目录树
        try {
          fs.unlinkSync(filePath)
          fs.rmSync(path.dirname(filePath), { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    })
  })

  // ============================================================
  // getBackupStats
  // ============================================================
  describe('getBackupStats', () => {
    it('正确统计各类别本地条数', () => {
      // mock: 每个 COUNT 查询返回 n=2
      mockPrepare.mockImplementation(() => ({
        run: vi.fn(() => ({ changes: 1 })),
        all: vi.fn(() => []),
        get: vi.fn(() => ({ n: 2 }))
      }) as never)

      const stats = getBackupStats()

      // topics 类别有 2 张表（topics + topic_custom_fields），每张 2 条 → 总 4
      expect(stats.topics).toBe(4)
      // events 类别有 4 张表，每张 2 条 → 总 8
      expect(stats.events).toBe(8)
      // settings 类别有 1 张表 → 总 2
      expect(stats.settings).toBe(2)
      // formats_bells 类别有 2 张表 → 总 4
      expect(stats.formats_bells).toBe(4)
    })

    it('查询失败时跳过该表，不抛错', () => {
      // mock: prepare 抛错模拟表不存在
      mockPrepare.mockImplementation(() => {
        throw new Error('表不存在')
      })

      const stats = getBackupStats()

      // 所有表查询失败，总数为 0
      expect(stats.topics).toBe(0)
      expect(stats.events).toBe(0)
      expect(stats.settings).toBe(0)
    })
  })
})
