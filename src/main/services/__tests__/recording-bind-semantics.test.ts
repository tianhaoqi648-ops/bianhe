// ============================================================
// recording-bind-semantics.test.ts — M2 修正版：bind 语义与文件归位
//
// 覆盖：
//   T2  固化产品语义 A：applyBindAction remove 仅解绑（列表过滤），
//       录音文件保留在录音目录（回归锚，防止未来误改为删文件）
//   T7  deleteRecording 真实返回：存在→true / 不存在→true（幂等）/
//       fs 失败→false（不再吞错恒 true）
//   M2' ensureRecordingsInDir：外部文件拷入录音目录（basename 唯一化）/
//       目录内文件不重复拷贝 / 纯 basename 输入不拷 / 拷贝失败保留原路径
//   Case 4 无关文件不被删除
//
// 真实 FS + node:sqlite 无关（纯文件系统与纯函数）。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { BoundRecording, RecordingBindAction } from '../../../shared/types'

const { mockApp, mockGetSetting } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn() },
  mockGetSetting: vi.fn(() => null as string | null)
}))

vi.mock('electron', () => ({
  app: mockApp,
  ipcMain: { handle: vi.fn() },
  dialog: {},
  BrowserWindow: class {}
}))
vi.mock('../../db/repository/audit.repo', () => ({
  auditRepo: {
    getSetting: () => mockGetSetting(),
    setSetting: vi.fn()
  }
}))
vi.mock('../../index', () => ({ getDb: () => ({ prepare: vi.fn() }) }))

import {
  deleteRecording,
  ensureRecordingsInDir
} from '../recording-storage'
import { applyBindAction } from '../../ipc/recording.ipc'

let tmpUserData: string
let recDir: string

function makeRecording(id: string, filePath: string): BoundRecording {
  return { id, kind: 'whole', filePath, markers: [] }
}

beforeEach(() => {
  tmpUserData = path.join(
    os.tmpdir(),
    `rec-bind-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  recDir = path.join(tmpUserData, 'recordings')
  fs.mkdirSync(recDir, { recursive: true })
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
  vi.restoreAllMocks()
})

describe('T2：bind remove 产品语义固化（仅解绑，文件保留）', () => {
  it('remove 后列表过滤且录音文件保留在磁盘（回归锚）', () => {
    const filePath = path.join(recDir, 'a.webm')
    fs.writeFileSync(filePath, Buffer.from('keep-me'))
    const current: BoundRecording[] = [makeRecording('rec-1', filePath)]

    const action: RecordingBindAction = { kind: 'remove', matchId: 'm-1', id: 'rec-1' }
    const next = applyBindAction(current, action)

    // DB 语义：列表已移除该绑定
    expect(next).toEqual([])
    // 文件语义：仍保留在录音目录（A 语义——不删文件）
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, 'utf8')).toBe('keep-me')
  })

  it('remove 不存在的 id：列表不变（幂等）', () => {
    const current: BoundRecording[] = [makeRecording('rec-1', path.join(recDir, 'a.webm'))]
    const next = applyBindAction(current, { kind: 'remove', matchId: 'm-1', id: 'no-such' })
    expect(next).toHaveLength(1)
  })
})

describe('T7：deleteRecording 真实返回（不再吞错恒 true）', () => {
  it('存在的文件 → 删除成功返回 true，文件消失', async () => {
    const filePath = path.join(recDir, 'del.webm')
    fs.writeFileSync(filePath, Buffer.from('x'))
    const ok = await deleteRecording(filePath)
    expect(ok).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('不存在的文件 → 幂等成功返回 true（force 语义）', async () => {
    const ok = await deleteRecording(path.join(recDir, 'not-exist.webm'))
    expect(ok).toBe(true)
  })

  it('filesystem 失败 → 返回 false（不伪装成功）', async () => {
    const filePath = path.join(recDir, 'busy.webm')
    fs.writeFileSync(filePath, Buffer.from('x'))
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(new Error('EBUSY'))
    const ok = await deleteRecording(filePath)
    expect(ok).toBe(false)
    // 文件仍在（失败未删）
    expect(fs.existsSync(filePath)).toBe(true)
    rmSpy.mockRestore()
  })
})

describe('M2\u2019：ensureRecordingsInDir（外部绑定文件拷入录音目录）', () => {
  it('外部目录文件 → 拷入录音目录并改写 filePath 为 basename', async () => {
    const external = path.join(tmpUserData, 'external-src.webm')
    fs.writeFileSync(external, Buffer.from('external-audio'))
    const recs = [makeRecording('rec-ext', external)]

    const out = await ensureRecordingsInDir(recs)

    expect(out[0].filePath).toBe('external-src.webm')
    expect(fs.existsSync(path.join(recDir, 'external-src.webm'))).toBe(true)
    expect(fs.readFileSync(path.join(recDir, 'external-src.webm'), 'utf8')).toBe('external-audio')
  })

  it('录音目录内文件 → 不重复拷贝，filePath 归一为 basename', async () => {
    const inner = path.join(recDir, 'inner.webm')
    fs.writeFileSync(inner, Buffer.from('inner'))
    const beforeCount = fs.readdirSync(recDir).length
    const out = await ensureRecordingsInDir([makeRecording('rec-in', inner)])
    expect(out[0].filePath).toBe('inner.webm')
    expect(fs.readdirSync(recDir).length).toBe(beforeCount)
  })

  it('纯 basename 输入（M3 后形态）→ 不拷贝，原样保留', async () => {
    fs.writeFileSync(path.join(recDir, 'bare.webm'), Buffer.from('bare'))
    const out = await ensureRecordingsInDir([makeRecording('rec-bare', 'bare.webm')])
    expect(out[0].filePath).toBe('bare.webm')
    expect(fs.existsSync(path.join(recDir, 'bare.webm'))).toBe(true)
  })

  it('拷贝失败 → 保留原 filePath（不阻断绑定，exists 门控兜底）', async () => {
    const external = path.join(tmpUserData, 'broken-src.webm')
    // 不实际创建外部文件 → copyFile ENOENT → 失败分支
    const recs = [makeRecording('rec-broken', external)]
    const out = await ensureRecordingsInDir(recs)
    expect(out[0].filePath).toBe(external) // 原路径保留
    expect(fs.existsSync(path.join(recDir, 'broken-src.webm'))).toBe(false)
  })

  it('同名冲突 → 唯一化文件名（不覆盖已有文件）', async () => {
    const external = path.join(tmpUserData, 'dup-src.webm')
    fs.writeFileSync(external, Buffer.from('new-content'))
    fs.writeFileSync(path.join(recDir, 'dup-src.webm'), Buffer.from('old-content'))
    const out = await ensureRecordingsInDir([makeRecording('rec-dup', external)])
    // 新文件带时间戳后缀，旧文件内容未被覆盖
    expect(out[0].filePath).not.toBe('dup-src.webm')
    expect(out[0].filePath).toContain('dup-src')
    expect(fs.readFileSync(path.join(recDir, 'dup-src.webm'), 'utf8')).toBe('old-content')
    expect(fs.readFileSync(path.join(recDir, out[0].filePath), 'utf8')).toBe('new-content')
  })

  it('Case 4：无关文件不被删除（拷入只增不改删）', async () => {
    const keep = path.join(recDir, 'keep.webm')
    fs.writeFileSync(keep, Buffer.from('keep'))
    const external = path.join(tmpUserData, 'src.webm')
    fs.writeFileSync(external, Buffer.from('src'))
    await ensureRecordingsInDir([makeRecording('rec-s', external)])
    expect(fs.existsSync(keep)).toBe(true)
    expect(fs.readFileSync(keep, 'utf8')).toBe('keep')
  })
})
