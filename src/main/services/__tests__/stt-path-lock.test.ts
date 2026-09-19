// ============================================================
// stt-path-lock.test.ts — M1：STT 输入路径锁定（真实 FS + 真实录音目录）
//
// resolveSttRecordingPath 与 PLAY/READ 的 basename 锁定策略一致：
//   - 合法 basename / 任意来源绝对路径 / 穿越路径 → 全部归一为「录音目录 + basename」
//   - 归一结果永不逃逸 recordingsDir（平台无关）
//
// 平台语义差异（Phase 1.2-fix CI Test Adaptation）：
//   - POSIX 上 path.basename 不识别 '\' 为分隔符——Windows 风格串（C:\x\y.ext、
//     ..\..\a.webm）在 Linux 上保留为「字面文件名」归一进 recordingsDir；
//     这仍是安全的锁定（字面名不逃逸），因此 Linux 分支断言「位于录音目录内」
//     而非「Windows basename 提取」。Windows 分支保留 basename 提取断言。
//   - 安全判断统一使用 path.relative 关系断言（防 /recordings2 前缀攻击），
//     不使用脆弱的 startsWith。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const isWin = process.platform === 'win32'

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

/** 真正的路径关系判断：resolved 必须位于 recordingsDir 内（防 /recordings2 前缀攻击）。 */
function assertLockedInsideRecordingsDir(resolved: string): void {
  const rel = path.relative(recordingsDir(), path.resolve(resolved))
  expect(rel).not.toBe('')
  // 严格父目录判断：Linux 上 Windows 穿越串的字面名（如 ..\..\a.webm）
  // 本身以 '..' 字符开头，但不是父目录遍历——只有 rel 恰为 '..' 或
  // 以 '..' + 分隔符开头才是真正逃逸
  expect(rel === '..' || rel.startsWith('..' + path.sep)).toBe(false)
  expect(path.isAbsolute(rel)).toBe(false)
}

describe('M1：STT 输入路径锁定（resolveSttRecordingPath）', () => {
  it('合法 basename → 归一为录音目录内路径，且 readRecordingFile 命中真实文件', async () => {
    fs.writeFileSync(path.join(recordingsDir(), 'a.webm'), Buffer.from('stt-audio'))
    const resolved = await resolveSttRecordingPath('a.webm')
    expect(resolved).toBe(path.join(recordingsDir(), 'a.webm'))
    assertLockedInsideRecordingsDir(resolved)
    // 集成：归一路径可被读取端消费
    expect(fs.existsSync(resolved)).toBe(true)
  })

  it('POSIX 绝对路径 /tmp/evil.webm → 锁定到录音目录（不逃逸）', async () => {
    const resolved = await resolveSttRecordingPath('/tmp/evil.webm')
    expect(resolved).toBe(path.join(recordingsDir(), 'evil.webm'))
    assertLockedInsideRecordingsDir(resolved)
  })

  it('Windows 绝对路径 C:\\Windows\\evil.wav → 锁定到录音目录（平台感知）', async () => {
    const resolved = await resolveSttRecordingPath('C:\\Windows\\evil.wav')
    if (isWin) {
      // Windows：path.basename 识别 '\' → 提取 evil.wav
      expect(resolved).toBe(path.join(recordingsDir(), 'evil.wav'))
    } else {
      // Linux：'\' 不是 POSIX 分隔符 → 整串保留为字面文件名（仍锁定在录音目录内）
      expect(resolved).toBe(path.join(recordingsDir(), 'C:\\Windows\\evil.wav'))
    }
    assertLockedInsideRecordingsDir(resolved)
  })

  it('相对穿越 ../a.webm 与 ..\\..\\a.webm → 均锁定在录音目录内（平台感知）', async () => {
    const r1 = await resolveSttRecordingPath('../a.webm')
    const r2 = await resolveSttRecordingPath('..\\..\\a.webm')
    // POSIX 穿越：两平台 basename 均提取 a.webm
    expect(r1).toBe(path.join(recordingsDir(), 'a.webm'))
    if (isWin) {
      // Windows：'\' 为分隔符 → basename 提取
      expect(r2).toBe(path.join(recordingsDir(), 'a.webm'))
    } else {
      // Linux：'\' 非分隔符 → 字面文件名（不逃逸）
      expect(r2).toBe(path.join(recordingsDir(), '..\\..\\a.webm'))
    }
    assertLockedInsideRecordingsDir(r1)
    assertLockedInsideRecordingsDir(r2)
  })

  it('混合分隔符与 dot segments → 归一到录音目录内（平台感知）', async () => {
    const resolved = await resolveSttRecordingPath('..\\./sub/../mixed.webm')
    if (isWin) {
      expect(resolved).toBe(path.join(recordingsDir(), 'mixed.webm'))
    } else {
      // POSIX：最后 '/' 后为 mixed.webm，两平台形态恰好一致
      expect(resolved).toBe(path.join(recordingsDir(), 'mixed.webm'))
    }
    assertLockedInsideRecordingsDir(resolved)
  })

  it('集成：旧绝对路径（他处录音根，POSIX 风格）传入 STT 归一后命中当前录音目录同名文件', async () => {
    // 模拟换机场景：旧机器的绝对路径指向不存在的位置。
    // 采用 POSIX 风格绝对路径保证两平台 basename 提取一致（Windows 风格串
    // 的锁定语义已由上方用例覆盖）。
    const legacyAbs = '/OldRoot/recordings/a.webm'
    fs.writeFileSync(path.join(recordingsDir(), 'a.webm'), Buffer.from('current-root'))
    const resolved = await resolveSttRecordingPath(legacyAbs)
    expect(resolved).toBe(path.join(recordingsDir(), 'a.webm'))
    assertLockedInsideRecordingsDir(resolved)
    // 归一后可读（这正是 M1 修复的跨机 ENOENT 场景）
    const buf = await readRecordingFile(resolved)
    expect(buf!.toString('utf8')).toBe('current-root')
  })
})
