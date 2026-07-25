// ============================================================
// reset-service.ts — 数据重置统一编排服务
//
// 职责：
// 1. 配置类：调 auditRepo.deleteSettingsByKeys 删除 settings key
// 2. 数据类：调各 repo 的 clearAll 方法清空对应表
// 3. 题库子选项 keepOfficial=false 时额外删除 3 个 official_* 标记
// 4. 写一条审计日志记录重置操作（在清空 audit_logs 之后再写，保留本次重置痕迹）
// ============================================================

import { topicRepo } from '../db/repository/topic.repo'
import { eventRepo } from '../db/repository/event.repo'
import { drawRepo } from '../db/repository/draw.repo'
import { importBatchRepo } from '../db/repository/import-batch.repo'
import { auditRepo } from '../db/repository/audit.repo'
import { OFFICIAL_TOPIC_SETTINGS_KEYS } from '../../shared/settings-defaults'
import type { ResetDataRequest, ResetDataResponse } from '../../shared/types'

export function resetData(req: ResetDataRequest): ResetDataResponse {
  const res: ResetDataResponse = {
    configDeleted: 0,
    topicsDeleted: 0,
    eventsDeleted: 0,
    drawSessionsDeleted: 0,
    importBatchesDeleted: 0,
    auditLogsDeleted: 0,
    officialKept: true
  }

  // 1. 配置类：删除 settings key
  if (req.configKeys.length > 0) {
    res.configDeleted = auditRepo.deleteSettingsByKeys(req.configKeys)
  }

  // 2. 题库（含子选项）
  if (req.dataOptions.topics) {
    res.topicsDeleted = topicRepo.clearAll({
      keepOfficial: req.dataOptions.topics.keepOfficial
    })
    res.officialKept = req.dataOptions.topics.keepOfficial
    // 不保留官方题库时，额外删除 3 个 official_* 标记（重启后重新 seed）
    if (!req.dataOptions.topics.keepOfficial) {
      auditRepo.deleteSettingsByKeys([...OFFICIAL_TOPIC_SETTINGS_KEYS])
    }
  }

  // 3. 赛事（级联删除 rounds/teams/team_history/draw_sessions/draw_session_items）
  if (req.dataOptions.events) {
    res.eventsDeleted = eventRepo.clearAllEvents()
  }

  // 4. 抽取记录（级联删除 items）
  if (req.dataOptions.drawSessions) {
    res.drawSessionsDeleted = drawRepo.clearAllSessions()
  }

  // 5. 导入批次记录
  if (req.dataOptions.importBatches) {
    res.importBatchesDeleted = importBatchRepo.clearAll()
  }

  // 6. 审计日志（清空，但保留本次重置操作日志）
  if (req.dataOptions.auditLogs) {
    res.auditLogsDeleted = auditRepo.clearLogs()
  }

  // 7. 写一条审计日志记录本次重置操作（在清空 audit_logs 之后再写）
  try {
    auditRepo.addLog({
      action: 'system',
      target_type: 'reset',
      target_id: 'reset-data',
      operator: 'user',
      detail: {
        action: 'reset_data',
        configDeleted: res.configDeleted,
        topicsDeleted: res.topicsDeleted,
        eventsDeleted: res.eventsDeleted,
        drawSessionsDeleted: res.drawSessionsDeleted,
        importBatchesDeleted: res.importBatchesDeleted,
        auditLogsDeleted: res.auditLogsDeleted,
        officialKept: res.officialKept,
        timestamp: new Date().toISOString()
      }
    })
  } catch {
    // 审计日志失败不影响主流程
  }

  return res
}
