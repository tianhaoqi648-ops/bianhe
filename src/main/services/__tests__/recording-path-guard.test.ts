// ============================================================
// recording-path-guard.test.ts — 录音读取路径收紧（任意绝对路径注入防护）
//
// 覆盖 src/main/services/recording-storage.ts 的安全加固：
//   - readRecordingFile / recordingFileExists 一律取 basename 锁定到
//     recordingsDir 内（与 saveRecording/deleteRecording 一致）
//   - 合法场景：saveRecording 写入的文件，其绝对路径回传后可读、存在性为真
//   - 注入场景：/etc/shadow、C:\Windows\system32\config 等绝对路径 → 读不到
//   - 相对路径注入（..\..\）→ basename 归一后命中 recordingsDir → 读不到
//
// 用 vi.mock('electron') 把 userData 指向系统临时目录，真实 fs 验证。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ---- mock electron.app.getPath -> 临时目录 ----
const { mockApp } = vi.hoisted(() => ({ mockApp: { getPath: vi.fn() } }))
vi.mock('electron', () => ({ app: mockApp }))

// ---- mock settings 读取（recordingsDir() 经 auditRepo.getSetting 读配置）----
// 未配置 → null → recordingsDir() 回退 userData/recordings
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    getSetting: vi.fn(() => null),
    setSetting: vi.fn()
  }
}))

import { saveRecording, readRecordingFile, recordingFileExists } from '../recording-storage'

let tmpUserData: string

beforeEach(() => {
  tmpUserData = path.join(
    os.tmpdir(),
    `recording-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  fs.mkdirSync(tmpUserData, { recursive: true })
  mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath key: ${key}`)
  })
})

afterEach(() => {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.clearAllMocks()
})

describe('recording 路径收紧（readRecordingFile / recordingFileExists 锁定录音目录）', () => {
  it('合法场景：saveRecording 写入后，绝对路径回传可读且存在性为真', async () => {
    const { path: savedPath } = await saveRecording('match-abc-001.webm', Buffer.from('hello'))
    expect(path.basename(savedPath)).toBe('match-abc-001.webm')

    const buf = await readRecordingFile(savedPath)
    expect(buf).not.toBeNull()
    expect(buf!.toString('utf8')).toBe('hello')

    expect(await recordingFileExists(savedPath)).toBe(true)
  })

  it('注入场景：绝对路径 /etc/shadow → 读不到（锁定在录音目录内）', async () => {
    await saveRecording('match-abc-002.webm', Buffer.from('x'))
    const buf = await readRecordingFile('/etc/shadow')
    expect(buf).toBeNull()
    expect(await recordingFileExists('/etc/shadow')).toBe(false)
  })

  it('注入场景：Windows 系统目录绝对路径 → 读不到', async () => {
    await saveRecording('match-abc-003.webm', Buffer.from('x'))
    const buf = await readRecordingFile('C:\\Windows\\system32\\config\\SAM')
    expect(buf).toBeNull()
    expect(await recordingFileExists('C:\\Windows\\system32\\config\\SAM')).toBe(false)
  })

  it('注入场景：绝对路径指向真实存在的敏感文件 → 仍读不到（basename 化后不存在于录音目录）', async () => {
    await saveRecording('match-abc-004.webm', Buffer.from('x'))
    // 在临时区造一个真实存在的"敏感"文件（不依赖 CI 环境的真实系统文件）
    const sensitive = path.join(tmpUserData, 'sensitive-secret.txt')
    fs.writeFileSync(sensitive, 'top-secret')
    const buf = await readRecordingFile(sensitive)
    expect(buf).toBeNull()
    expect(await recordingFileExists(sensitive)).toBe(false)
  })

  it('注入场景：相对路径 ..\\..\\ 穿越 → basename 归一后读不到', async () => {
    await saveRecording('match-abc-005.webm', Buffer.from('x'))
    const buf = await readRecordingFile('..\\..\\sensitive-secret.txt')
    expect(buf).toBeNull()
    expect(await recordingFileExists('../../sensitive-secret.txt')).toBe(false)
  })

  it('不存在的合法文件名 → 读不到（正常行为不变）', async () => {
    await saveRecording('match-abc-006.webm', Buffer.from('x'))
    const buf = await readRecordingFile('match-not-exist.webm')
    expect(buf).toBeNull()
    expect(await recordingFileExists('match-not-exist.webm')).toBe(false)
  })
})
