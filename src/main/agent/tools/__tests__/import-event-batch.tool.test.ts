// ============================================================
// import-event-batch.tool.test.ts — import_event_batch 工具入参校验测试（Task 51.5）
//
// 覆盖 import-event-batch.tool.ts 的入参校验：
//   - filePath 缺失 / 空 → 抛错
//   - fileType 非法 → 抛错
//   - fieldMapping 缺失 → 返回 needFieldMapping=true + columns
//   - fieldMapping.teamName 空 → 返回 needFieldMapping=true + columns
//   - 队伍名列不在表头 → 抛错
//   - 正常导入 → 返回 eventId / teamCount / roundCount
//
// Mock 策略：mock parseFile 与 eventRepo，隔离工具层校验逻辑。
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================

const { mockParseFile, mockCreateEvent, mockCreateTeam } = vi.hoisted(() => ({
  mockParseFile: vi.fn(),
  mockCreateEvent: vi.fn(),
  mockCreateTeam: vi.fn()
}))

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@main/services/import-engine', () => ({
  parseFile: mockParseFile
}))

vi.mock('@main/db/repository/event.repo', () => ({
  eventRepo: {
    createEvent: mockCreateEvent,
    createTeam: mockCreateTeam
  }
}))

// 导入被测模块（在 mock 之后）
import { importEventBatchTool } from '../import-event-batch.tool'

// ============================================================
// Mock 数据
// ============================================================

/** 模拟 parseFile 返回（含 rawTable） */
function makeParsedResult(headers: string[] = ['队伍名', '赛事名'], rows: unknown[][] = []) {
  return {
    topics: [],
    mapping: { 队伍名: 'teamName', 赛事名: 'eventName' },
    rawTable: {
      headers,
      rows: rows.length > 0 ? rows : [
        ['清华队', ''],
        ['北大队', ''],
        ['复旦队', '']
      ]
    }
  }
}

// ============================================================
// 测试用例
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockParseFile.mockResolvedValue(makeParsedResult())
  mockCreateEvent.mockReturnValue({ id: 'event-1', name: '测试赛事' })
  mockCreateTeam.mockImplementation(() => ({ id: 'team-x', name: '', event_id: 'event-1' }))
})

describe('import_event_batch：filePath 校验', () => {
  it('filePath 缺失 → 抛错', async () => {
    await expect(
      importEventBatchTool.execute({
        filePath: '',
        fileType: 'xlsx'
      })
    ).rejects.toThrow(/filePath 不能为空/)
  })

  it('filePath 为空白 → 抛错', async () => {
    await expect(
      importEventBatchTool.execute({
        filePath: '   ',
        fileType: 'xlsx'
      })
    ).rejects.toThrow(/filePath 不能为空/)
  })
})

describe('import_event_batch：fileType 校验', () => {
  it('fileType 非法 → 抛错', async () => {
    await expect(
      importEventBatchTool.execute({
        filePath: '/path/to/file.xlsx',
        fileType: 'pdf' as never
      })
    ).rejects.toThrow(/fileType 必须为/)
  })

  it('fileType=xlsx 合法', async () => {
    mockParseFile.mockResolvedValue(makeParsedResult())
    const result = await importEventBatchTool.execute({
      filePath: '/path/to/file.xlsx',
      fileType: 'xlsx',
      fieldMapping: { teamName: '队伍名' }
    })
    expect(result).not.toHaveProperty('needFieldMapping')
  })

  it('fileType=csv 合法', async () => {
    mockParseFile.mockResolvedValue(makeParsedResult())
    const result = await importEventBatchTool.execute({
      filePath: '/path/to/file.csv',
      fileType: 'csv',
      fieldMapping: { teamName: '队伍名' }
    })
    expect(result).not.toHaveProperty('needFieldMapping')
  })

  it('fileType=docx 合法', async () => {
    mockParseFile.mockResolvedValue(makeParsedResult())
    const result = await importEventBatchTool.execute({
      filePath: '/path/to/file.docx',
      fileType: 'docx',
      fieldMapping: { teamName: '队伍名' }
    })
    expect(result).not.toHaveProperty('needFieldMapping')
  })
})

describe('import_event_batch：fieldMapping 缺失分支', () => {
  it('fieldMapping 缺失 → 返回 needFieldMapping=true + columns', async () => {
    mockParseFile.mockResolvedValue(makeParsedResult(['队伍名', '赛事名']))

    const result = await importEventBatchTool.execute({
      filePath: '/path/to/file.xlsx',
      fileType: 'xlsx'
    })

    expect(result.needFieldMapping).toBe(true)
    expect(result.columns).toBeDefined()
    expect(result.columns).toContain('队伍名')
    expect(result.columns).toContain('赛事名')
    expect(result.message).toBeDefined()
    // 不应创建赛事
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })

  it('fieldMapping.teamName 为空 → 返回 needFieldMapping=true', async () => {
    mockParseFile.mockResolvedValue(makeParsedResult(['队伍名', '赛事名']))

    const result = await importEventBatchTool.execute({
      filePath: '/path/to/file.xlsx',
      fileType: 'xlsx',
      fieldMapping: { teamName: '' }
    })

    expect(result.needFieldMapping).toBe(true)
    expect(result.columns).toContain('队伍名')
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })
})

describe('import_event_batch：队伍名列校验', () => {
  it('队伍名列不在表头 → 抛错', async () => {
    mockParseFile.mockResolvedValue(makeParsedResult(['队名', '赛事名']))

    await expect(
      importEventBatchTool.execute({
        filePath: '/path/to/file.xlsx',
        fileType: 'xlsx',
        fieldMapping: { teamName: '不存在的列' }
      })
    ).rejects.toThrow(/不在文件表头中/)
  })

  it('rawTable 为空 → 抛错', async () => {
    mockParseFile.mockResolvedValue({
      topics: [],
      mapping: {},
      rawTable: { headers: [], rows: [] }
    })

    await expect(
      importEventBatchTool.execute({
        filePath: '/path/to/file.xlsx',
        fileType: 'xlsx',
        fieldMapping: { teamName: '队伍名' }
      })
    ).rejects.toThrow(/rawTable 为空/)
  })
})

describe('import_event_batch：正常导入', () => {
  it('成功导入 → 返回 eventId / teamCount / roundCount', async () => {
    mockParseFile.mockResolvedValue(
      makeParsedResult(['队伍名', '赛事名'], [['清华队'], ['北大队'], ['复旦队']])
    )
    mockCreateEvent.mockReturnValue({ id: 'event-xyz', name: '导入赛事' })

    const result = await importEventBatchTool.execute({
      filePath: '/path/to/events.xlsx',
      fileType: 'xlsx',
      fieldMapping: { teamName: '队伍名', eventName: '自定义赛事名' }
    })

    expect(result.eventId).toBe('event-xyz')
    expect(result.teamCount).toBe(3)
    expect(result.roundCount).toBe(0)
    // 验证 createEvent 用了 fieldMapping.eventName
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: '自定义赛事名' })
    )
    // 验证 createTeam 被调用 3 次
    expect(mockCreateTeam).toHaveBeenCalledTimes(3)
  })

  it('eventName 缺省时从文件名推断', async () => {
    mockParseFile.mockResolvedValue(
      makeParsedResult(['队伍名'], [['A队'], ['B队']])
    )
    mockCreateEvent.mockReturnValue({ id: 'event-1', name: 'events' })

    await importEventBatchTool.execute({
      filePath: '/path/to/events.xlsx',
      fileType: 'xlsx',
      fieldMapping: { teamName: '队伍名' }
    })

    // 应使用文件名（去扩展名）作为赛事名
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'events' })
    )
  })

  it('重复队伍名去重', async () => {
    mockParseFile.mockResolvedValue(
      makeParsedResult(['队伍名'], [['A队'], ['A队'], ['B队'], ['A队']])
    )
    mockCreateEvent.mockReturnValue({ id: 'event-1', name: 'test' })

    const result = await importEventBatchTool.execute({
      filePath: '/path/to/file.xlsx',
      fileType: 'xlsx',
      fieldMapping: { teamName: '队伍名' }
    })

    // 去重后仅 2 支队伍
    expect(result.teamCount).toBe(2)
    expect(mockCreateTeam).toHaveBeenCalledTimes(2)
  })
})

describe('import_event_batch：工具元数据', () => {
  it('name 应为 import_event_batch', () => {
    expect(importEventBatchTool.name).toBe('import_event_batch')
  })

  it('riskLevel 应为 high', () => {
    expect(importEventBatchTool.riskLevel).toBe('high')
  })

  it('parameters required 应含 filePath 与 fileType', () => {
    expect(importEventBatchTool.parameters.required).toContain('filePath')
    expect(importEventBatchTool.parameters.required).toContain('fileType')
  })
})
