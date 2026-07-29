// ============================================================
// format.repo.ts — 赛制 CRUD
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type { DebateFormat, DebateFormatData, BackupImportStrategy } from '../../../shared/types'
import { bulkInsert } from './utils'

interface FormatRow {
  id: string
  name: string
  description: string | null
  is_preset: number
  format_data: string
  created_at: string
  updated_at: string
}

/**
 * 反序列化：DB row -> DebateFormat
 * - formatData: JSON 字符串 -> 对象
 *
 * 容错：format_data 字段损坏时返回 null，调用方（listAll / getById）应跳过 null 结果。
 */
function rowToFormat(row: FormatRow): DebateFormat | null {
  let formatData: DebateFormatData
  try {
    formatData = JSON.parse(row.format_data) as DebateFormatData
  } catch {
    // P2-3: format_data 损坏，跳过该行（返回 null）
    return null
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isPreset: row.is_preset === 1,
    formatData,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export const formatRepo = {
  listAll(): DebateFormat[] {
    const rows = getDb().prepare('SELECT * FROM debate_formats ORDER BY is_preset DESC, name ASC').all() as FormatRow[]
    // P2-3: 过滤掉 format_data 损坏的行（rowToFormat 返回 null）
    return rows.map(rowToFormat).filter((f): f is DebateFormat => f !== null)
  },

  getById(id: string): DebateFormat | null {
    const row = getDb().prepare('SELECT * FROM debate_formats WHERE id = ?').get(id) as FormatRow | undefined
    // P2-3: rowToFormat 可能因 format_data 损坏返回 null
    if (!row) return null
    return rowToFormat(row)
  },

  create(opts: { name: string; description?: string; formatData: DebateFormatData }): DebateFormat {
    const now = new Date().toISOString()
    const format: DebateFormat = {
      id: uuidv4(),
      name: opts.name,
      description: opts.description ?? null,
      isPreset: false,
      formatData: opts.formatData,
      createdAt: now,
      updatedAt: now
    }
    getDb().prepare(`
      INSERT INTO debate_formats (id, name, description, is_preset, format_data, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `).run(format.id, format.name, format.description, JSON.stringify(format.formatData), format.createdAt, format.updatedAt)
    return format
  },

  update(id: string, opts: { name?: string; description?: string; formatData?: DebateFormatData }): DebateFormat | null {
    const existing = this.getById(id)
    if (!existing) return null
    if (existing.isPreset) throw new Error('内置预设赛制不可修改')
    const now = new Date().toISOString()
    const updated: DebateFormat = {
      ...existing,
      name: opts.name ?? existing.name,
      description: opts.description ?? existing.description,
      formatData: opts.formatData ?? existing.formatData,
      updatedAt: now
    }
    getDb().prepare(`
      UPDATE debate_formats
      SET name = ?, description = ?, format_data = ?, updated_at = ?
      WHERE id = ?
    `).run(updated.name, updated.description, JSON.stringify(updated.formatData), now, id)
    return updated
  },

  delete(id: string): boolean {
    const existing = this.getById(id)
    if (!existing) return false
    if (existing.isPreset) throw new Error('内置预设赛制不可删除')
    const result = getDb().prepare('DELETE FROM debate_formats WHERE id = ?').run(id)
    return result.changes > 0
  },

  upsertPreset(preset: { id: string; name: string; description: string; formatData: DebateFormatData }): void {
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO debate_formats (id, name, description, is_preset, format_data, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        format_data = excluded.format_data,
        updated_at = excluded.updated_at
    `).run(preset.id, preset.name, preset.description, JSON.stringify(preset.formatData), now, now)
  },

  importFormat(data: { name: string; description?: string; formatData: DebateFormatData }): DebateFormat {
    return this.create(data)
  },

  exportFormat(id: string): { name: string; description: string; formatData: DebateFormatData } | null {
    const fmt = this.getById(id)
    if (!fmt) return null
    return {
      name: fmt.name,
      description: fmt.description ?? '',
      formatData: fmt.formatData
    }
  },

  duplicateFormat(id: string, newName?: string): DebateFormat | null {
    const src = this.getById(id)
    if (!src) return null
    return this.create({
      name: newName ?? `${src.name} 副本`,
      description: src.description ?? undefined,
      formatData: src.formatData
    })
  },

  clearAllCustom(): number {
    const result = getDb().prepare('DELETE FROM debate_formats WHERE is_preset = 0').run()
    return result.changes
  },

  /** 备份用：返回 debate_formats 全部行（DB 原始格式，format_data 为 JSON 字符串） */
  findAllForBackup(): Record<string, unknown>[] {
    return getDb().prepare('SELECT * FROM debate_formats').all() as Record<string, unknown>[]
  },

  /** 批量恢复 debate_formats 表。调用方需在外层事务内执行。 */
  bulkRestore(
    rows: Array<Record<string, unknown>>,
    strategy: BackupImportStrategy
  ): number {
    return bulkInsert('debate_formats', rows, strategy)
  }
}
