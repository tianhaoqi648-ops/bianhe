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

export function registerAllIpc(): void {
  registerSystemIpc()
  registerTopicIpc()
  registerEventIpc()
  registerDrawIpc()
  registerAuditIpc()
  registerImportIpc()
  registerExportIpc()
  registerDedupIpc()
  console.log('[main] All IPC handlers registered')
}
