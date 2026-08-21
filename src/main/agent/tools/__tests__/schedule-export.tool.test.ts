// ============================================================
// schedule-export.tool.test.ts — export_event_schedule 工具测试（T5）
//
// Mock 策略：
//   - mock electron app.getPath('userData') → 临时目录，验证默认导出目录
//   - mock eventRepo / matchRepo 与 schedule-io（buildScheduleRows / buildScheduleWorkbookBuffer）
//   - 通过真实 fs 断言 xlsx 文件已落盘，返回路径与行数正确
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// ============================================================
// vi.hoisted：提升 mock 函数
// ============================================================
const { mockGetPath, mockGetEventById, mockListByEvent, mockBuildRows, mockBuildBuffer } =
  vi.hoisted(() => ({
    mockGetPath: vi.fn(),
    mockGetEventById: vi.fn(),
    mockListByEvent: vi.fn(),
    mockBuildRows: vi.fn(),
    mockBuildBuffer: vi.fn()
  }))

// ============================================================
// Mock 依赖
// ============================================================
vi.mock('electron', () => ({ app: { getPath: mockGetPath } }))
vi.mock('@main/db/repository/event.repo', () => ({ eventRepo: { getEventById: mockGetEventById } }))
vi.mock('@main/db/repository/match.repo', () => ({ matchRepo: { listByEvent: mockListByEvent } }))
vi.mock('../../../services/schedule-io', () => ({
  buildScheduleRows: mockBuildRows,
  buildScheduleWorkbookBuffer: mockBuildBuffer
}))

import { scheduleExportTool } from '../schedule-export.tool'

// ============================================================
// 测试环境
// ============================================================
let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-export-test-'))
  mockGetPath.mockReturnValue(tmpRoot)
  mockGetEventById.mockReturnValue({ id: 'evt-1', name: '决赛' })
  // 2 场比赛 → 2 行
  const rows = [
    { roundName: '第一轮', matchNumber: 1, teamAff: 'A', teamNeg: 'B', topic: 't1', status: 'planned' },
    { roundName: '第一轮', matchNumber: 2, teamAff: 'C', teamNeg: 'D', topic: 't2', status: 'planned' }
  ]
  mockBuildRows.mockReturnValue(rows)
  mockBuildBuffer.mockReturnValue(Buffer.from('xlsx-bytes'))
  mockListByEvent.mockReturnValue([])
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  vi.clearAllMocks()
})

// ============================================================
// 测试用例
// ============================================================
describe('export_event_schedule：工具元数据', () => {
  it('name 应为 export_event_schedule', () => {
    expect(scheduleExportTool.name).toBe('export_event_schedule')
  })
  it('riskLevel 应为 low', () => {
    expect(scheduleExportTool.riskLevel).toBe('low')
  })
  it('parameters required 应含 eventId', () => {
    expect(scheduleExportTool.parameters.required).toContain('eventId')
  })
})

describe('export_event_schedule：入参校验', () => {
  it('eventId 缺失 → 抛错', async () => {
    await expect(scheduleExportTool.execute({ eventId: '' })).rejects.toThrow(/eventId 不能为空/)
  })
  it('赛事不存在 → 抛错', async () => {
    mockGetEventById.mockReturnValue(null)
    await expect(scheduleExportTool.execute({ eventId: 'nope' })).rejects.toThrow(/不存在/)
  })
})

describe('export_event_schedule：导出文件', () => {
  it('指定 outPath 时写入该路径并返回行数', async () => {
    const outPath = path.join(tmpRoot, 'custom', 'my.xlsx')
    const result = await scheduleExportTool.execute({ eventId: 'evt-1', outPath })
    expect(result.count).toBe(2)
    expect(fs.existsSync(result.filePath)).toBe(true)
    expect(fs.readFileSync(result.filePath).equals(Buffer.from('xlsx-bytes'))).toBe(true)
    expect(mockBuildBuffer).toHaveBeenCalledTimes(1)
  })

  it('outPath 缺省时写入默认导出目录 userData/exports', async () => {
    const result = await scheduleExportTool.execute({ eventId: 'evt-1' })
    // 默认目录 = userData/exports
    expect(result.filePath.startsWith(path.join(tmpRoot, 'exports'))).toBe(true)
    expect(fs.existsSync(result.filePath)).toBe(true)
    expect(result.filePath).toMatch(/\.xlsx$/)
    expect(result.count).toBe(2)
  })
})