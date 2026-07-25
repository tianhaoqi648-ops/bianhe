// ============================================================
// reset-service.test.ts — 数据重置服务单元测试
//
// 通过 vi.mock 模拟所有 repository，验证 resetData 编排逻辑：
// 1. 配置类：调 auditRepo.deleteSettingsByKeys
// 2. 数据类：调各 repo 的 clearAll 方法
// 3. 题库子选项 keepOfficial=false 时额外删除 official_* 标记
// 4. 写一条审计日志
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- mock 所有 repo ----
vi.mock('../../db/repository/topic.repo', () => ({
  topicRepo: {
    clearAll: vi.fn<(opts: { keepOfficial: boolean }) => number>()
  }
}))
vi.mock('../../db/repository/event.repo', () => ({
  eventRepo: { clearAllEvents: vi.fn<() => number>() }
}))
vi.mock('../../db/repository/draw.repo', () => ({
  drawRepo: { clearAllSessions: vi.fn<() => number>() }
}))
vi.mock('../../db/repository/import-batch.repo', () => ({
  importBatchRepo: { clearAll: vi.fn<() => number>() }
}))
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    deleteSettingsByKeys: vi.fn<(keys: string[]) => number>(),
    clearLogs: vi.fn<(beforeDate?: string) => number>(),
    addLog: vi.fn()
  }
}))

import { resetData } from '../reset-service'
import { topicRepo } from '../../db/repository/topic.repo'
import { eventRepo } from '../../db/repository/event.repo'
import { drawRepo } from '../../db/repository/draw.repo'
import { importBatchRepo } from '../../db/repository/import-batch.repo'
import { auditRepo } from '../../db/repository/audit.repo'
import type { ResetDataRequest } from '../../../shared/types'

describe('reset-service resetData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(topicRepo.clearAll).mockReturnValue(50)
    vi.mocked(eventRepo.clearAllEvents).mockReturnValue(3)
    vi.mocked(drawRepo.clearAllSessions).mockReturnValue(10)
    vi.mocked(importBatchRepo.clearAll).mockReturnValue(5)
    vi.mocked(auditRepo.clearLogs).mockReturnValue(100)
    vi.mocked(auditRepo.deleteSettingsByKeys).mockReturnValue(8)
  })

  it('仅重置配置类：调用 deleteSettingsByKeys，不调用数据 repo', () => {
    const req: ResetDataRequest = {
      configKeys: ['dedup.enabled', 'ui.tagDisplay'],
      dataOptions: {}
    }
    const res = resetData(req)
    expect(res.configDeleted).toBe(8)
    expect(res.topicsDeleted).toBe(0)
    expect(auditRepo.deleteSettingsByKeys).toHaveBeenCalledWith([
      'dedup.enabled',
      'ui.tagDisplay'
    ])
    expect(topicRepo.clearAll).not.toHaveBeenCalled()
  })

  it('重置题库且保留官方题库：keepOfficial=true，不删除 official_* 标记', () => {
    const req: ResetDataRequest = {
      configKeys: [],
      dataOptions: { topics: { keepOfficial: true } }
    }
    const res = resetData(req)
    expect(res.topicsDeleted).toBe(50)
    expect(res.officialKept).toBe(true)
    expect(topicRepo.clearAll).toHaveBeenCalledWith({ keepOfficial: true })
    // 不应删除 official_* 标记
    expect(auditRepo.deleteSettingsByKeys).not.toHaveBeenCalled()
  })

  it('重置题库且不保留官方题库：删除 official_* 标记', () => {
    const req: ResetDataRequest = {
      configKeys: [],
      dataOptions: { topics: { keepOfficial: false } }
    }
    const res = resetData(req)
    expect(res.topicsDeleted).toBe(50)
    expect(res.officialKept).toBe(false)
    expect(auditRepo.deleteSettingsByKeys).toHaveBeenCalledWith([
      'official_topics_seeded',
      'official_topics_version',
      'official_topics_count'
    ])
  })

  it('同时重置所有数据类：所有 repo 被调用一次', () => {
    const req: ResetDataRequest = {
      configKeys: [],
      dataOptions: {
        topics: { keepOfficial: true },
        events: true,
        drawSessions: true,
        importBatches: true,
        auditLogs: true
      }
    }
    const res = resetData(req)
    expect(res.topicsDeleted).toBe(50)
    expect(res.eventsDeleted).toBe(3)
    expect(res.drawSessionsDeleted).toBe(10)
    expect(res.importBatchesDeleted).toBe(5)
    expect(res.auditLogsDeleted).toBe(100)
    expect(topicRepo.clearAll).toHaveBeenCalledTimes(1)
    expect(eventRepo.clearAllEvents).toHaveBeenCalledTimes(1)
    expect(drawRepo.clearAllSessions).toHaveBeenCalledTimes(1)
    expect(importBatchRepo.clearAll).toHaveBeenCalledTimes(1)
    expect(auditRepo.clearLogs).toHaveBeenCalledTimes(1)
  })

  it('写一条审计日志记录重置操作', () => {
    const req: ResetDataRequest = {
      configKeys: ['dedup.enabled'],
      dataOptions: { topics: { keepOfficial: true } }
    }
    resetData(req)
    expect(auditRepo.addLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system',
        target_type: 'reset',
        target_id: 'reset-data'
      })
    )
  })

  it('空请求：所有计数为 0，仍写审计日志', () => {
    const req: ResetDataRequest = {
      configKeys: [],
      dataOptions: {}
    }
    const res = resetData(req)
    expect(res.configDeleted).toBe(0)
    expect(res.topicsDeleted).toBe(0)
    expect(res.eventsDeleted).toBe(0)
    expect(res.drawSessionsDeleted).toBe(0)
    expect(res.importBatchesDeleted).toBe(0)
    expect(res.auditLogsDeleted).toBe(0)
    expect(res.officialKept).toBe(true)
    expect(auditRepo.addLog).toHaveBeenCalledTimes(1)
  })
})
