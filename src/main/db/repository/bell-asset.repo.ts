// ============================================================
// bell-asset.repo.ts — bell_assets 表 CRUD
//
// 职责：管理自定义铃声资源的元数据（文件本体由 bell-storage 服务管理）
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import * as path from 'node:path'
import { getDb } from '../index'
import { readBellFile, getBellFullPath } from '../../services/bell-storage'
import { existsSync, writeFileSync } from 'fs'
import type { BellAsset } from '../../../shared/debate-formats/types'
import type { BackupImportStrategy } from '../../../shared/types'
import { bulkInsert } from './utils'

interface BellAssetRow {
  id: string
  name: string
  file_path: string
  file_size: number
  mime_type: string
  duration_ms: number | null
  created_at: string
}

function rowToAsset(row: BellAssetRow): BellAsset {
  return {
    id: row.id,
    name: row.name,
    filePath: row.file_path,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    durationMs: row.duration_ms ?? undefined,
    createdAt: row.created_at
  }
}

export const bellAssetRepo = {
  listAll(): BellAsset[] {
    const rows = getDb().prepare('SELECT * FROM bell_assets ORDER BY created_at DESC').all() as BellAssetRow[]
    return rows.map(rowToAsset)
  },

  getById(id: string): BellAsset | null {
    const row = getDb().prepare('SELECT * FROM bell_assets WHERE id = ?').get(id) as BellAssetRow | undefined
    return row ? rowToAsset(row) : null
  },

  create(opts: { name: string; fileName: string; buffer: Buffer; mimeType: string }): BellAsset {
    const id = uuidv4()
    const now = new Date().toISOString()
    // P3: 先写 DB 记录，再写文件；文件写入失败时删除 DB 记录，避免产生孤立文件。
    // 生成存储文件名（与 saveBellFile 一致的逻辑：扩展名白名单校验 + 时间戳防重名）
    const ext = path.extname(opts.fileName).toLowerCase()
    const allowedExtensions = ['.mp3', '.wav', '.ogg']
    if (!allowedExtensions.includes(ext)) {
      throw new Error('Unsupported file type. Only .mp3, .wav, .ogg are allowed')
    }
    const base = path.basename(opts.fileName, ext)
    const storedFileName = `${base}-${Date.now()}${ext}`
    const asset: BellAsset = {
      id,
      name: opts.name,
      filePath: storedFileName,
      fileSize: opts.buffer.length,
      mimeType: opts.mimeType,
      createdAt: now
    }
    // 1. 先插入 DB 记录
    getDb().prepare(`
      INSERT INTO bell_assets (id, name, file_path, file_size, mime_type, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(asset.id, asset.name, asset.filePath, asset.fileSize, asset.mimeType, asset.durationMs ?? null, asset.createdAt)
    // 2. 写文件；失败时回滚 DB 记录并重新抛出
    try {
      writeFileSync(getBellFullPath(storedFileName), opts.buffer)
    } catch (e) {
      try {
        getDb().prepare('DELETE FROM bell_assets WHERE id = ?').run(id)
      } catch (delErr) {
        console.error('[bellAssetRepo] create: 回滚 DB 记录失败', delErr)
      }
      throw e
    }
    return asset
  },

  delete(id: string): boolean {
    // 单库单动作：仅删除 bell_assets 行。
    // 文件（userData/bells/）删除与失败审计由调用方编排（Governance Task 6）。
    const db = getDb()
    let deletedRows = 0
    const tx = db.transaction(() => {
      const result = db.prepare('DELETE FROM bell_assets WHERE id = ?').run(id)
      deletedRows = result.changes
    })
    tx()
    return deletedRows > 0
  },

  getDataUrl(id: string): string | null {
    const asset = bellAssetRepo.getById(id)
    if (!asset) return null
    const buffer = readBellFile(asset.filePath)
    if (!buffer) return null
    return `data:${asset.mimeType};base64,${buffer.toString('base64')}`
  },

  clearAll(): number {
    // 单库单动作：仅清空 bell_assets 表。
    // 文件（userData/bells/）清理与失败审计由调用方编排（Governance Task 6）。
    const db = getDb()
    let deletedRows = 0
    const tx = db.transaction(() => {
      deletedRows = db.prepare('DELETE FROM bell_assets').run().changes
    })
    tx()
    return deletedRows
  },

  /**
   * 备份用：返回 bell_assets 全部行（DB 原始格式）。
   *
   * 额外标记 `file_missing: boolean` 字段，表示该行引用的音频文件是否在磁盘上缺失：
   * - true  → 音频文件不存在（孤立记录），bell_files 字典不会包含该文件
   * - false → 音频文件存在，bell_files 字典会包含对应 base64
   *
   * 注意：file_missing 仅用于备份标记，不是 bell_assets 表的实际列；
   * 导入时由 backup-service.ts 在调用 bulkInsert 前剥离该字段。
   */
  findAllForBackup(): Record<string, unknown>[] {
    const rows = getDb().prepare('SELECT * FROM bell_assets').all() as Record<string, unknown>[]
    for (const row of rows) {
      const filePath = row.file_path as string | undefined
      // P4-8: 改用 existsSync 检查文件存在性，避免 readBellFile 将整个音频文件读入内存。
      // 备份场景仅需知道文件是否存在（决定是否标记 file_missing），文件内容由 encodeBellFiles 读取。
      let exists = false
      if (filePath != null) {
        try {
          exists = existsSync(getBellFullPath(filePath))
        } catch {
          exists = false
        }
      }
      row.file_missing = !exists
    }
    return rows
  },

  /** 批量恢复 bell_assets 表。调用方需在外层事务内执行。 */
  bulkRestore(
    rows: Array<Record<string, unknown>>,
    strategy: BackupImportStrategy
  ): number {
    return bulkInsert('bell_assets', rows, strategy)
  },

  /**
   * 编码铃声文件：读取所有 bell_assets 引用的音频文件，返回 { 文件名: Base64 } 字典。
   * - key 为 bell_assets.file_path（相对路径文件名）
   * - 缺失文件跳过（不抛错），保证导出流程不被孤立记录阻断
   *   缺失标记通过 findAllForBackup() 在 bell_assets 行上以 file_missing=true 形式输出
   * @returns { [relativePath]: base64String }
   */
  encodeBellFiles(): Record<string, string> {
    const result: Record<string, string> = {}
    const assets = bellAssetRepo.listAll()
    for (const asset of assets) {
      const buffer = readBellFile(asset.filePath)
      if (buffer) {
        result[asset.filePath] = buffer.toString('base64')
      }
    }
    return result
  },

  /**
   * 解码铃声文件：将 Base64 字典写回 userData/bells/ 目录。
   *
   * 策略行为：
   *   - skip_existing：文件已存在则跳过，避免覆盖
   *   - overwrite_existing / clear_rebuild：直接覆盖写
   *
   * 注意：导入后 bell_assets.file_path 仍指向原相对路径文件名；
   * 此处只是把音频文件本体还原到磁盘，使 file_path 能被 readBellFile 解析到。
   *
   * @returns 写入条数（已存在且策略为 skip 时计入跳过，不返回）
   */
  decodeBellFiles(
    bellFiles: Record<string, string>,
    strategy: BackupImportStrategy
  ): number {
    let written = 0
    for (const [relativePath, base64] of Object.entries(bellFiles)) {
      const fullPath = getBellFullPath(relativePath)
      // skip_existing 策略下文件已存在则跳过
      if (strategy === 'skip_existing' && existsSync(fullPath)) {
        continue
      }
      try {
        const buffer = Buffer.from(base64, 'base64')
        // 备份恢复场景必须保持原文件名（bell_assets.file_path 引用相对路径文件名），
        // 因此直接写文件，不走 saveBellFile 的时间戳防重名逻辑。
        // getBellFullPath 内部已调用 getBellsDir()，会确保父目录存在。
        writeFileSync(fullPath, buffer)
        written++
      } catch (e) {
        console.warn('[bellAssetRepo] decodeBellFiles: 写入铃声文件失败', relativePath, e)
      }
    }
    return written
  }
}
