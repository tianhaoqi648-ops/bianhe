// ============================================================
// stt-path-lock.test.ts — M1：STT 输入路径锁定（真实 FS + 真实录音目录）
//
// resolveSttRecordingPath 与 PLAY/READ 的 basename 锁定策略一致：
//   - 合法 basename / 任意来源绝对路径 / 穿越路径 → 全部归一为「录音目录 + basename」
//   - 归一结果永不逃逸 recordingsDir
//   - 归一后 readRecordingFile 可命中真实文件（集成）
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const { mockApp, mockGetSetting } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn() },
  mockGetSetting: vi.fn(() => null as string | null)
}))

vi.mock('electron', () => ({ app: mockApp }))
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    getSetting: () => mockGetSetting(),
    setSetting: vi.fn()
  }
}))

import { resolveSttRecordingPath } from '../transcription'
import { readRecordingFile } from '../../services/recording-storage'

let tmpUserData: string

beforeEach(() => {
  tmpUserData = path.join(
    os.tmpdir(),
    `stt-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  fs.mkdirSync(path.join(tmpUserData, 'recordings'), { recursive: true })
  mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return tmpUserData
    throw new Error(`unexpected getPath key: ${key}`)
  })
  mockGetSetting.mockReturnValue(null)
})

afterEach(() => {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

function recordingsDir(): string {
  return path.join(tmpUserData, 'recordings')
}

describe('M1：STT 输入路径锁定（resolveSttRecordingPath）', () => {
  it('合法 basename → 归一为录音目录内路径，且 readRecordingFile 命中真实文件', async () => {
    fs.writeFileSync(path.join(recordingsDir(), 'a.webm'), Buffer.from('stt-audio'))
    const resolved = await resolveSttRecordingPath('a.webm')
    expect(resolved).toBe(path.join(recordingsDir(), 'a.webm'))
    // 集成：归一路径可被读取端消费
    expect(fs.existsSync(resolved)).toBe(true)
  })

  it('POSIX 绝对路径 /tmp/evil.webm → 锁定到录音目录（不逃逸）', async () => {
    const resolved = await resolveSttRecordingPath('/tmp/evil.webm')
    expect(resolved).toBe(path.join(recordingsDir(), 'evil.webm'))
    expect(resolved.startsWith(recordingsDir())).toBe(true)
  })

  it('Windows 绝对路径 C:\\Windows\\evil.wav → 锁定到录音目录', async () => {
    const resolved = await resolveSttRecordingPath('C:\\Windows\\evil.wav')
    expect(resolved).toBe(path.join(recordingsDir(), 'evil.wav'))
    expect(resolved.startsWith(recordingsDir())).toBe(true)
  })

  it('相对穿越 ../a.webm 与 ..\\..\\a.webm → basename 归一，不逃逸录音目录', async () => {
    const r1 = await resolveSttRecordingPath('../a.webm')
    const r2 = await resolveSttRecordingPath('..\\..\\a.webm')
    expect(r1).toBe(path.join(recordingsDir(), 'a.webm'))
    expect(r2).toBe(path.join(recordingsDir(), 'a.webm'))
    expect(r1.startsWith(recordingsDir())).toBe(true)
    expect(r2.startsWith(recordingsDir())).toBe(true)
  })

  it('混合分隔符与 dot segments → 归一到录音目录内', async () => {
    const resolved = await resolveSttRecordingPath('..\\./sub/../mixed.webm')
    expect(resolved).toBe(path.join(recordingsDir(), 'mixed.webm'))
    expect(resolved.startsWith(recordingsDir())).toBe(true)
  })

  it('集成：旧绝对路径（他处录音根）传入 STT 归一后命中当前录音目录同名文件', async () => {
    // 模拟换机场景：旧机器的绝对路径指向不存在的位置
    const legacyAbs = 'C:\\Users\\OldUser\\AppData\\Roaming\\辩盒\\recordings\\a.webm'
    fs.writeFileSync(path.join(recordingsDir(), 'a.webm'), Buffer.from('current-root'))
    const resolved = await resolveSttRecordingPath(legacyAbs)
    expect(resolved).toBe(path.join(recordingsDir(), 'a.webm'))
    // 归一后可读（这正是 M1 修复的跨机 ENOENT 场景）
    const buf = await readRecordingFile(resolved)
    expect(buf!.toString('utf8')).toBe('current-root')
  })
})
