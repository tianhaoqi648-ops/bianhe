// ============================================================
// ipc/index.ts — IPC 注册聚合入口
//
// 在主进程 app.whenReady 之后、createWindow 之前调用 registerAllIpc()。
// ============================================================

import { registerTopicIpc } from './topic.ipc'
import { registerEventIpc } from './event.ipc'
import { registerDrawIpc } from './draw.ipc'
import { registerAuditIpc } from './audit.ipc'
import { registerImportIpc } from './import.ipc'
import { registerExportIpc } from './export.ipc'
import { registerDedupIpc } from './dedup.ipc'
import { registerSystemIpc } from './system.ipc'
import { registerCustomFieldIpc } from './custom-field.ipc'
import { registerBatchEditIpc } from './batch-edit.ipc'
import { registerUndoIpc } from './undo.ipc'
import { registerFormatIpc } from './format.ipc'
import { registerTimerIpc } from './timer.ipc'
import { registerBellAssetIpc } from './bell-asset.ipc'
import { registerBellPlayIpc } from './bell-play.ipc'
import { registerTimerThemeIpc } from './timer-theme.ipc'
import { registerMatchIpc } from './match.ipc'
import { registerRecordingIpc } from './recording.ipc'
import { registerBackgroundIpc } from './background.ipc'
import { registerBackupIpc } from './backup.ipc'
import { registerUpdaterIpc } from './updater.ipc'
import { registerTranscriptionIpc } from './transcription.ipc'
import { registerReportIpc } from './report.ipc'
import { registerScheduleIpc } from './schedule.ipc'
import { registerBadgeIpc } from './badge.ipc'
import { registerJudgeIpc } from './judge.ipc'
import { registerTopicGroupIpc } from './topic-group.ipc'

export function registerAllIpc(): void {
  registerSystemIpc()
  registerTopicIpc()
  registerEventIpc()
  registerDrawIpc()
  registerAuditIpc()
  registerImportIpc()
  registerExportIpc()
  registerDedupIpc()
  registerCustomFieldIpc()
  registerBatchEditIpc()
  registerUndoIpc()
  registerFormatIpc()
  registerTimerIpc()
  registerBellAssetIpc()
  registerBellPlayIpc()
  registerTimerThemeIpc()
  registerMatchIpc()
  registerRecordingIpc()
  registerBackgroundIpc()
  registerBackupIpc()
  registerUpdaterIpc()
  registerTranscriptionIpc()
  registerReportIpc()
  registerScheduleIpc()
  registerBadgeIpc()
  registerJudgeIpc()
  registerTopicGroupIpc()
  console.log('[main] All IPC handlers registered')
}
