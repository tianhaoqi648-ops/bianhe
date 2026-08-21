// ============================================================
// badge-storage.ts — 队徽库存储服务（P1-6）
//
// 职责：管理 userData/badges/ 下的队徽资源（类似 bells / backgrounds）：
//   - 内置队徽：内嵌常见 Logo（SVG），注册进 index.json（kind=builtin）
//   - 自定义队徽：上传图片落盘（kind=custom）
//   - 队伍绑定：userData/badges/team-bindings.json（teamId → badgeId）
//
// 所有函数支持注入 dir（主要为单测用临时目录）；未注入时默认 userData/badges。
// ============================================================

import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  BadgeItem,
  TeamBadgeMap,
  BackupImportStrategy
} from '../../shared/types'

/** 允许上传的队徽图片扩展名 */
const ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

/** 内置队徽：常见高校 Logo（简化 SVG），id/name/dataUrl */
const BUILTIN_BADGES: Array<{ id: string; name: string; svg: string }> = [
  {
    id: 'builtin-univ-pku',
    name: '北大 · 常规',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#4A5FC1"/><text x="32" y="41" font-size="26" text-anchor="middle" fill="#fff" font-family="SimHei">北大</text></svg>'
  },
  {
    id: 'builtin-univ-thu',
    name: '清华 · 常规',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#7A1F3D"/><text x="32" y="41" font-size="26" text-anchor="middle" fill="#fff" font-family="SimHei">清华</text></svg>'
  },
  {
    id: 'builtin-univ-fudan',
    name: '复旦 · 常规',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#0B7A3E"/><text x="32" y="41" font-size="26" text-anchor="middle" fill="#fff" font-family="SimHei">复旦</text></svg>'
  },
  {
    id: 'builtin-univ-wuhan',
    name: '武大 · 常规',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#005BAC"/><text x="32" y="41" font-size="26" text-anchor="middle" fill="#fff" font-family="SimHei">武大</text></svg>'
  },
  {
    id: 'builtin-univ-zju',
    name: '浙大 · 常规',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="6" y="6" width="52" height="52" rx="10" fill="#8C1F28"/><text x="32" y="41" font-size="26" text-anchor="middle" fill="#fff" font-family="SimHei">浙大</text></svg>'
  },
  {
    id: 'builtin-univ-nju',
    name: '南大 · 常规',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#B86B00"/><text x="32" y="41" font-size="26" text-anchor="middle" fill="#fff" font-family="SimHei">南大</text></svg>'
  },
  {
    id: 'builtin-org-seal',
    name: '通用 · 会徽',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#333"/><circle cx="32" cy="32" r="22" fill="none" stroke="#fff" stroke-width="2"/><text x="32" y="40" font-size="24" text-anchor="middle" fill="#fff" font-family="SimHei">辩</text></svg>'
  },
  {
    id: 'builtin-org-star',
    name: '通用 · 星标',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path d="M32 6l7.3 20.4L60 32l-20.7 5.6L32 58l-7.3-20.4L4 32l20.7-5.6z" fill="#F0A020"/></svg>'
  }
]

/** 内置队徽 dataUrl（data:image/svg+xml;utf8,<svg…>） */
function builtinDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** 根据文件名推断 mime */
function mimeFromExt(fileName: string): string {
  return EXT_TO_MIME[path.extname(fileName).toLowerCase()] ?? 'image/png'
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/** 索引文件路径 */
function indexPath(dir: string): string {
  return path.join(dir, 'index.json')
}

/** 绑定文件路径 */
function bindingPath(dir: string): string {
  return path.join(dir, 'team-bindings.json')
}

/** 解析默认目录（未注入时用 electron app userData） */
function resolveDir(dir?: string): string {
  const d = dir ?? path.join(app.getPath('userData'), 'badges')
  ensureDir(d)
  return d
}

function readIndex(dir: string): BadgeItem[] {
  const p = indexPath(dir)
  if (!fs.existsSync(p)) {
    const builtin: BadgeItem[] = BUILTIN_BADGES.map((b) => ({
      id: b.id,
      name: b.name,
      kind: 'builtin',
      fileName: b.id,
      created_at: new Date().toISOString()
    }))
    fs.writeFileSync(p, JSON.stringify(builtin, null, 2), 'utf-8')
    return builtin
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return Array.isArray(parsed) ? (parsed as BadgeItem[]) : []
  } catch {
    return []
  }
}

function writeIndex(dir: string, badges: BadgeItem[]): void {
  fs.writeFileSync(indexPath(dir), JSON.stringify(badges, null, 2), 'utf-8')
}

function readBindings(dir: string): TeamBadgeMap {
  const p = bindingPath(dir)
  if (!fs.existsSync(p)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return parsed && typeof parsed === 'object' ? (parsed as TeamBadgeMap) : {}
  } catch {
    return {}
  }
}

function writeBindings(dir: string, map: TeamBadgeMap): void {
  fs.writeFileSync(bindingPath(dir), JSON.stringify(map, null, 2), 'utf-8')
}

// ============================================================
// 对外 API
// ============================================================

/** 列出队徽库（内置 + 自定义） */
export function listBadges(dir?: string): BadgeItem[] {
  return readIndex(resolveDir(dir))
}

/** 按 name 搜索队徽（前端可再过滤，这里提供精确/包含匹配辅助不做；直接返回全量） */
export function searchBadges(keyword: string, dir?: string): BadgeItem[] {
  const k = (keyword ?? '').trim().toLowerCase()
  const all = listBadges(dir)
  if (!k) return all
  return all.filter((b) => b.name.toLowerCase().includes(k))
}

/** 取队徽 dataUrl（可用于 <img src>） */
export function getBadgeDataUrl(id: string, dir?: string): string | null {
  const builtin = BUILTIN_BADGES.find((b) => b.id === id)
  if (builtin) return builtinDataUrl(builtin.svg)
  const d = resolveDir(dir)
  const badges = readIndex(d)
  const item = badges.find((b) => b.id === id && b.kind === 'custom')
  if (!item) return null
  const fullPath = path.resolve(d, item.fileName)
  if (fullPath !== d && !fullPath.startsWith(d + path.sep)) return null
  if (!fs.existsSync(fullPath)) return null
  const data = fs.readFileSync(fullPath)
  return `data:${mimeFromExt(item.fileName)};base64,${data.toString('base64')}`
}

/**
 * 上传队徽：写入图片文件 + 注册进索引。
 * @param opts base64 为图片字节的 base64（渲染进程读取后传入）
 */
export function uploadBadge(
  opts: { name: string; fileName: string; base64: string },
  dir?: string
): BadgeItem {
  const name = (opts.name ?? '').trim()
  if (!name) throw new Error('队徽名称不能为空')
  const ext = path.extname(opts.fileName || '').toLowerCase()
  if (!ALLOWED_EXTS.includes(ext)) {
    throw new Error(`不支持的文件类型：仅支持 ${ALLOWED_EXTS.join(' / ')}`)
  }
  const buffer = Buffer.from(opts.base64 || '', 'base64')
  if (buffer.length === 0) throw new Error('图片内容为空')
  const d = resolveDir(dir)
  const base = path.basename(opts.fileName, ext)
  const storedName = `${base}-${Date.now()}${ext}`
  fs.writeFileSync(path.join(d, storedName), buffer)

  const badges = readIndex(d)
  const item: BadgeItem = {
    id: `custom-${Date.now()}`,
    name,
    kind: 'custom',
    fileName: storedName,
    created_at: new Date().toISOString()
  }
  badges.push(item)
  writeIndex(d, badges)
  return item
}

/** 删除自定义队徽（内置不可删） */
export function deleteBadge(id: string, dir?: string): boolean {
  const d = resolveDir(dir)
  const badges = readIndex(d)
  const idx = badges.findIndex((b) => b.id === id && b.kind === 'custom')
  if (idx < 0) return false
  const item = badges[idx]
  badges.splice(idx, 1)
  writeIndex(d, badges)
  const fullPath = path.resolve(d, item.fileName)
  if (fullPath !== d && fullPath.startsWith(d + path.sep) && fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath)
  }
  // 同步清理该队徽的绑定
  const bindings = readBindings(d)
  let changed = false
  for (const [tid, bid] of Object.entries(bindings)) {
    if (bid === id) {
      delete bindings[tid]
      changed = true
    }
  }
  if (changed) writeBindings(d, bindings)
  return true
}

/** 读取队伍已绑定的队徽 id（可为 null，绑定但无队徽时值为 null） */
export function getTeamBadge(teamId: string, dir?: string): string | null | undefined {
  return readBindings(resolveDir(dir))[teamId]
}

/** 绑定队伍 → 队徽 */
export function setTeamBadge(teamId: string, badgeId: string, dir?: string): void {
  const d = resolveDir(dir)
  const bindings = readBindings(d)
  bindings[teamId] = badgeId
  writeBindings(d, bindings)
}

/** 解绑队伍队徽 */
export function clearTeamBadge(teamId: string, dir?: string): void {
  const d = resolveDir(dir)
  const bindings = readBindings(d)
  delete bindings[teamId]
  writeBindings(d, bindings)
}

// ============================================================
// 备份 / 恢复
// ============================================================

/** 备份用：返回 index.json 注册表 + team-bindings 绑定 + 需带走的自定义文件列表 */
export function findForBackup(dir?: string): {
  registry: BadgeItem[]
  bindings: TeamBadgeMap
  fileNames: string[]
} {
  const d = resolveDir(dir)
  const registry = readIndex(d)
  const bindings = readBindings(d)
  const fileNames = registry
    .filter((b) => b.kind === 'custom' && b.fileName)
    .map((b) => b.fileName)
  return { registry, bindings, fileNames }
}

/**
 * 备份用：将自定义队徽文件编码为 { 文件名: base64 } 字典。
 * 文件缺失或路径越界时跳过（不抛错），保证导出流程不被孤立的注册项阻断。
 */
export function encodeBadgeFiles(
  fileNames: string[],
  dir?: string
): Record<string, string> {
  const d = resolveDir(dir)
  const result: Record<string, string> = {}
  for (const fileName of fileNames) {
    const fullPath = path.resolve(d, fileName)
    if (fullPath !== d && !fullPath.startsWith(d + path.sep)) continue
    if (!fs.existsSync(fullPath)) continue
    result[fileName] = fs.readFileSync(fullPath).toString('base64')
  }
  return result
}

/**
 * 备份恢复用：把队徽文件 + index.json + team-bindings.json 写回。
 * - 文件：skip_existing 下已存在则跳过，其余策略直接覆盖写
 * - index / bindings：注册表与绑定以备份为准整体写回
 * @returns 写入的队徽文件数（文件路径越界时跳过）
 */
export function restoreBackup(
  data: {
    registry?: BadgeItem[]
    bindings?: TeamBadgeMap
    files?: Record<string, string>
  },
  dir?: string,
  strategy: BackupImportStrategy = 'overwrite_existing'
): number {
  const d = resolveDir(dir)
  let written = 0
  if (data.files) {
    for (const [fileName, base64] of Object.entries(data.files)) {
      const fullPath = path.resolve(d, fileName)
      if (fullPath !== d && !fullPath.startsWith(d + path.sep)) continue
      if (strategy === 'skip_existing' && fs.existsSync(fullPath)) continue
      try {
        fs.writeFileSync(fullPath, Buffer.from(base64, 'base64'))
        written++
      } catch (e) {
        console.warn('[badge-storage] restoreBackup: 写入队徽文件失败', fileName, e)
      }
    }
  }
  if (Array.isArray(data.registry)) writeIndex(d, data.registry)
  if (data.bindings && typeof data.bindings === 'object') {
    writeBindings(d, data.bindings)
  }
  return written
}