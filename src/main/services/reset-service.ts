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
import { batchEditHistoryRepo } from '../db/repository/batch-edit-history.repo'
import { undoLogRepo } from '../db/repository/undo-log.repo'
import { formatRepo } from '../db/repository/format.repo'
import { timerSessionRepo } from '../db/repository/timer-session.repo'
import { bellAssetRepo } from '../db/repository/bell-asset.repo'
import { getDb } from '../db'
import { OFFICIAL_TOPIC_SETTINGS_KEYS } from '../../shared/settings-defaults'
import type { ResetDataRequest, ResetDataResponse } from '../../shared/types'

export function resetData(req: ResetDataRequest): ResetDataResponse {
  const db = getDb()
  return db.transaction(() => {
  const res: ResetDataResponse = {
    configDeleted: 0,
    topicsDeleted: 0,
    eventsDeleted: 0,
    drawSessionsDeleted: 0,
    importBatchesDeleted: 0,
    auditLogsDeleted: 0,
    batchEditHistoryDeleted: 0,
    undoLogDeleted: 0,
    timerSessionsDeleted: 0,
    timerRecordsDeleted: 0,
    debateFormatsDeleted: 0,
    customBellsDeleted: 0,
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

  // 7. 批量编辑历史（主表 + 明细，CASCADE 删除）
  if (req.dataOptions.batchEditHistory) {
    res.batchEditHistoryDeleted = batchEditHistoryRepo.clearAll()
  }

  // 8. 撤销历史（undo_log 表）
  if (req.dataOptions.undoLog) {
    res.undoLogDeleted = undoLogRepo.clearAll()
  }

  // 9. 计时会话（timer_sessions 表）
  if (req.dataOptions.timerSessions) {
    res.timerSessionsDeleted = timerSessionRepo.clearAll()
  }

  // 10. 计时记录（timer_records 表，独立于会话可单独清空）
  if (req.dataOptions.timerRecords) {
    res.timerRecordsDeleted = timerSessionRepo.clearAllRecords()
  }

  // 11. 自定义赛制（仅 is_preset=0，保留内置预设）
  if (req.dataOptions.debateFormats) {
    res.debateFormatsDeleted = formatRepo.clearAllCustom()
  }

  // 12. 自定义铃声（bell_assets 表 + userData/bells/ 文件）
  if (req.dataOptions.customBells) {
    res.customBellsDeleted = bellAssetRepo.clearAll()
  }

  // 13. 写一条审计日志记录本次重置操作（在清空 audit_logs 之后再写）
  try {
    auditRepo.addLog({
      action: 'system',
      target_type: 'reset',
      target_id: 'reset-data',
      operator: 'user',
      detail: {
        action: 'reset_data',
        ...res,
        timestamp: new Date().toISOString()
      }
    })
  } catch {
    // 审计日志失败不影响主流程
  }

    return res
  })()
}
