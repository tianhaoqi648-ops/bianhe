// ============================================================
// custom-field-service.ts — 自定义字段元数据服务
//
// 提供 topic_custom_fields 表的 CRUD 操作：
//   - listAll：列出所有自定义字段（按 sort_order 排序）
//   - createField：创建新字段（label → field_key 自动转换）
//   - updateField：更新 label / sort_order
//   - deleteField：删除字段（不清理 topics.custom_data 旧值）
//   - labelToKey：label → field_key 转换工具
//
// 注意：本服务不负责 topics.custom_data 的读写，那由 topic.repo 处理。
// ============================================================

import { getDb } from '../db'
import type { CustomField, CustomFieldType } from '../../shared/types'

/**
 * 将字段显示名转换为 field_key。
 * - 全英文/数字/下划线：转 lowercase
 * - 含中文或其他：保留原值（SQLite json_extract 支持任意字符串键）
 */
export function labelToKey(label: string): string {
  const trimmed = label.trim()
  if (trimmed.length === 0) {
    throw new Error('字段名不能为空')
  }
  if (/^[A-Za-z0-9_]+$/.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  return trimmed
}

/** 列出所有自定义字段，按 sort_order 升序、field_key 字典序为次序 */
function listAll(): CustomField[] {
  return getDb()
    .prepare(
      `SELECT field_key, field_label, field_type, sort_order, created_at
       FROM topic_custom_fields
       ORDER BY sort_order ASC, field_key ASC`
    )
    .all() as CustomField[]
}

/**
 * 创建新自定义字段。
 * @param label 字段显示名
 * @param type  字段类型 'string' | 'tags'
 * @returns 新建的 CustomField 完整记录
 * @throws 字段名重复时抛错
 */
function createField(label: string, type: CustomFieldType): CustomField {
  const field_key = labelToKey(label)
  const db = getDb()

  const existing = db
    .prepare('SELECT field_key FROM topic_custom_fields WHERE field_key = ?')
    .get(field_key) as { field_key: string } | undefined
  if (existing) {
    throw new Error(`字段 "${label}" 已存在（key: ${field_key}）`)
  }

  const maxRow = db
    .prepare('SELECT MAX(sort_order) AS m FROM topic_custom_fields')
    .get() as { m: number | null } | undefined
  const nextOrder = (maxRow?.m ?? -1) + 1
  const created_at = new Date().toISOString()

  db.prepare(
    `INSERT INTO topic_custom_fields (field_key, field_label, field_type, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(field_key, label, type, nextOrder, created_at)

  return {
    field_key,
    field_label: label,
    field_type: type,
    sort_order: nextOrder,
    created_at
  }
}

/**
 * 更新字段元数据（label / sort_order）。
 * 不允许修改 field_key 与 field_type，避免数据语义错乱。
 */
function updateField(
  field_key: string,
  patch: Partial<Pick<CustomField, 'field_label' | 'sort_order'>>
): void {
  const db = getDb()
  const sets: string[] = []
  const params: (string | number)[] = []

  if (patch.field_label !== undefined) {
    sets.push('field_label = ?')
    params.push(patch.field_label)
  }
  if (patch.sort_order !== undefined) {
    sets.push('sort_order = ?')
    params.push(patch.sort_order)
  }
  if (sets.length === 0) return

  params.push(field_key)
  db.prepare(
    `UPDATE topic_custom_fields SET ${sets.join(', ')} WHERE field_key = ?`
  ).run(...params)
}

/**
 * 删除自定义字段。
 * 注意：不清理 topics.custom_data 中的旧值，避免大批量 UPDATE；
 *       旧值在用户下次编辑时自然清理或保留为「孤儿值」（不影响筛选）。
 */
function deleteField(field_key: string): void {
  getDb().prepare('DELETE FROM topic_custom_fields WHERE field_key = ?').run(field_key)
}

/** 检查字段是否存在（按 field_key 或 field_label） */
function exists(fieldKeyOrLabel: string): boolean {
  const db = getDb()
  const row = db
    .prepare(
      'SELECT field_key FROM topic_custom_fields WHERE field_key = ? OR field_label = ?'
    )
    .get(fieldKeyOrLabel, fieldKeyOrLabel) as { field_key: string } | undefined
  return row !== undefined
}

export const customFieldService = {
  listAll,
  createField,
  updateField,
  deleteField,
  exists,
  labelToKey
}
