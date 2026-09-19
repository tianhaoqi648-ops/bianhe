// ============================================================
// backup-restore-guard.test.ts — Me3-fix T9：
// restore 录音守卫走真实 IPC 路径（registerBackupIpc → handler →
// 真实 restoreBackup → recording-active flag）。
// backup-service 仅被 backup.ipc 的 import/export handler 引用，
// 与本测试无关，mock 掉以避免拉起真实 DB 依赖链。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const h = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn() },
  handleCalls: new Map<string, unknown>()
}))

vi.mock('electron', () => ({
  app: h.mockApp,
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      h.handleCalls.set(channel, handler)
    })
  },
  dialog: {}
}))

vi.mock('../../services/backup-service', () => ({
  exportBackup: vi.fn(),
  previewImport: vi.fn(),
  importBackup: vi.fn(),
  writeBackupFile: vi.fn(),
  getBackupStats: vi.fn()
}))

// mock 之后 import
import { IPC_CHANNELS } from '../../../shared/types'
import { registerBackupIpc } from '../backup.ipc'
import { setRecordingActive } from '../../services/recording-active'

let tmpUserData = ''

describe('Me3-fix T9：backup:restore 录音守卫（真 IPC → 真 restoreBackup）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.handleCalls.clear()
    tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bianhe-t9-'))
    h.mockApp.getPath.mockImplementation((key: string) => {
      if (key === 'userData') return tmpUserData
      throw new Error(`unexpected getPath: ${key}`)
    })
    registerBackupIpc()
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpUserData, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  function restoreHandler(): (filename: string) => Promise<{ success: boolean; error?: string }> {
    const handler = h.handleCalls.get(IPC_CHANNELS.BACKUP_RESTORE) as
      | ((filename: string) => Promise<{ success: boolean; error?: string }>)
      | undefined
    expect(handler, 'BACKUP_RESTORE handler 未注册').toBeTruthy()
    return handler!
  }

  it('录音中经 IPC 恢复 → success:false + 明确错误，DB 未替换', async () => {
    const backupsDir = path.join(tmpUserData, 'backups')
    fs.mkdirSync(backupsDir, { recursive: true })
    fs.writeFileSync(path.join(backupsDir, 'backup-0.db'), 'backup-content')
    fs.writeFileSync(path.join(tmpUserData, 'debate-drawer.db'), 'current-db')

    setRecordingActive(true)
    const res = await restoreHandler()(null, 'backup-0.db')
    expect(res.success).toBe(false)
    expect(res.error).toContain('当前正在录音')
    // DB 未被替换（fail-safe：restore 未发生）
    expect(fs.readFileSync(path.join(tmpUserData, 'debate-drawer.db'), 'utf8')).toBe('current-db')
  })

  it('非录音状态经 IPC 恢复 → success:true，DB 被替换', async () => {
    const backupsDir = path.join(tmpUserData, 'backups')
    fs.mkdirSync(backupsDir, { recursive: true })
    fs.writeFileSync(path.join(backupsDir, 'backup-0.db'), 'backup-content')

    setRecordingActive(false)
    const res = await restoreHandler()(null, 'backup-0.db')
    expect(res.success).toBe(true)
    expect(fs.readFileSync(path.join(tmpUserData, 'debate-drawer.db'), 'utf8')).toBe('backup-content')
  })
})
