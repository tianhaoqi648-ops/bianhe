// ============================================================
// badge-storage.test.ts — 队徽库存储纯逻辑单测（P1-6）
//
// 覆盖：内置队徽注册 / 上传 / 删除 / 读取 dataUrl / 队伍绑定。
// 所有函数走注入的临时目录，避免触碰真实 userData。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '' }
}))

import {
  listBadges,
  searchBadges,
  uploadBadge,
  deleteBadge,
  getBadgeDataUrl,
  setTeamBadge,
  getTeamBadge,
  clearTeamBadge,
  findForBackup,
  encodeBadgeFiles,
  restoreBackup
} from '../badge-storage'

let dir: string
let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'badges-test-'))
  dir = path.join(tmpRoot, 'badges')
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('listBadges（首次初始化为内置）', () => {
  it('首次列出包含内置队徽', () => {
    const badges = listBadges(dir)
    expect(badges.length).toBeGreaterThan(0)
    expect(badges.every((b) => b.kind === 'builtin')).toBe(true)
    expect(getBadgeDataUrl(badges[0].id, dir)).toContain('data:image/svg+xml')
  })

  it('searchBadges 支持关键字过滤', () => {
    listBadges(dir)
    const found = searchBadges('清华', dir)
    expect(found.some((b) => b.name.includes('清华'))).toBe(true)
  })
})

describe('upload / delete', () => {
  it('上传自定义队徽并写入文件', () => {
    const item = uploadBadge({ name: '校徽A', fileName: 'a.png', base64: Buffer.from('pngdata').toString('base64') }, dir)
    expect(item.kind).toBe('custom')
    expect(item.fileName).toMatch(/\.png$/)
    expect(fs.existsSync(path.join(dir, item.fileName))).toBe(true)
    // 出现自定义条目
    const badges = listBadges(dir)
    expect(badges.some((b) => b.id === item.id)).toBe(true)
  })

  it('不支持的扩展名抛错', () => {
    expect(() => uploadBadge({ name: 'x', fileName: 'a.exe', base64: 'aGk=' }, dir)).toThrow('不支持的文件类型')
  })

  it('删除自定义队徽后索引与文件都被清理', () => {
    const item = uploadBadge({ name: '校徽B', fileName: 'b.svg', base64: Buffer.from('<svg/>').toString('base64') }, dir)
    expect(deleteBadge(item.id, dir)).toBe(true)
    expect(fs.existsSync(path.join(dir, item.fileName))).toBe(false)
    expect(listBadges(dir).some((b) => b.id === item.id)).toBe(false)
  })

  it('删除内置队徽返回 false', () => {
    const builtin = listBadges(dir)[0]
    expect(deleteBadge(builtin.id, dir)).toBe(false)
  })
})

describe('getBadgeDataUrl（自定义）', () => {
  it('返回 base64 图片 dataUrl', () => {
    const item = uploadBadge({ name: '校徽C', fileName: 'c.png', base64: Buffer.from([1, 2, 3]).toString('base64') }, dir)
    const url = getBadgeDataUrl(item.id, dir)
    expect(url).toContain('data:image/png;base64,')
  })

  it('未知 id 返回 null', () => {
    expect(getBadgeDataUrl('nope', dir)).toBeNull()
  })
})

describe('队伍绑定', () => {
  it('setTeam / getTeam / clearTeam 闭环', () => {
    const builtin = listBadges(dir)[0]
    expect(getTeamBadge('team1', dir)).toBeUndefined()
    setTeamBadge('team1', builtin.id, dir)
    expect(getTeamBadge('team1', dir)).toBe(builtin.id)
    clearTeamBadge('team1', dir)
    expect(getTeamBadge('team1', dir)).toBeUndefined()
  })
})

describe('findForBackup / encodeBadgeFiles', () => {
  it('返回注册表 + 绑定 + 自定义文件列表', () => {
    const item = uploadBadge({ name: '校徽D', fileName: 'd.png', base64: Buffer.from('pngdata').toString('base64') }, dir)
    setTeamBadge('team1', item.id, dir)

    const data = findForBackup(dir)
    // 注册表包含内置 + 自定义
    expect(data.registry.some((b) => b.id === item.id)).toBe(true)
    expect(data.bindings).toEqual({ team1: item.id })
    // fileNames 只含自定义文件，不含内置（内置无落盘文件）
    expect(data.fileNames).toEqual([item.fileName])
  })

  it('encodeBadgeFiles 将自定义文件编码为 base64 字典；缺失文件跳过', () => {
    const item = uploadBadge({ name: '校徽E', fileName: 'e.png', base64: Buffer.from('pngdata').toString('base64') }, dir)
    // 缺失文件：注册了但文件被删除 → 编码时跳过、不抛错
    const encoded = encodeBadgeFiles([item.fileName, 'gone.png'], dir)
    expect(Object.keys(encoded)).toEqual([item.fileName])
    expect(encoded[item.fileName]).toBeTruthy()
    // 还原后字节一致
    const decoded = Buffer.from(encoded[item.fileName], 'base64')
    expect(decoded.toString()).toBe('pngdata')
  })

  it('encodeBadgeFiles 阻止路径越界', () => {
    const encoded = encodeBadgeFiles(['../../outside.png'], dir)
    expect(encoded).toEqual({})
  })
})

describe('restoreBackup', () => {
  it('写回文件 + 注册表 + 绑定', () => {
    const files = { 'x.png': Buffer.from('xdata').toString('base64') }
    const registry = [
      { id: 'custom-1', name: '校徽X', kind: 'custom' as const, fileName: 'x.png' }
    ]
    const bindings = { team9: 'custom-1' }

    const written = restoreBackup({ registry, bindings, files }, dir, 'overwrite_existing')
    expect(written).toBe(1)
    expect(fs.existsSync(path.join(dir, 'x.png'))).toBe(true)
    // 注册表与绑定均已写回
    expect(listBadges(dir).some((b) => b.id === 'custom-1')).toBe(true)
    expect(getTeamBadge('team9', dir)).toBe('custom-1')
  })

  it('skip_existing 策略下已存在文件跳过', () => {
    const files = { 'keep.png': Buffer.from('new').toString('base64') }
    // 先写入同名文件（目录可能尚未创建，先确保存在）
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'keep.png'), 'old')

    const written = restoreBackup({ registry: [], bindings: {}, files }, dir, 'skip_existing')
    expect(written).toBe(0)
    expect(fs.readFileSync(path.join(dir, 'keep.png'), 'utf-8')).toBe('old')
  })

  it('缺失 registry/bindings 时仅写文件，不抛错', () => {
    const written = restoreBackup({ files: { 'y.png': Buffer.from('y').toString('base64') } }, dir)
    expect(written).toBe(1)
    expect(fs.existsSync(path.join(dir, 'y.png'))).toBe(true)
  })
})