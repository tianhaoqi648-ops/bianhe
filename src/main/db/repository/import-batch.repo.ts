// ============================================================
// import-batch.repo.ts — 导入批次记录仓库
//
// 每次导入创建一条 import_batch 记录，关联 topics.batch_id。
// 支持撤销整批导入：deleteByBatch + deleteBatch 事务。
// 不存储 topicIds 列表，按 batch_id 反查 topics 表即可。
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type { ImportBatch } from '../../../shared/types'

/** DB import_batch 表的原始行类型 */
export interface ImportBatchRow {
  id: string
  file_name: string
  total_count: number
  imported_count: number
  duplicates_count: number
  failed_count: number
  imported_at: string
  notes: string | null
}

// ImportBatch 类型从 shared/types.ts 引入，避免双定义
// remainingCount 在 repo 层不填充，由 IPC 层 listBatches 时追加

export interface ImportBatchCreateInput {
  file_name: string
  total_count: number
  imported_count: number
  duplicates_count: number
  failed_count: number
  notes?: string | null
}

export interface ImportBatchUpdateInput {
  imported_count?: number
  duplicates_count?: number
  failed_count?: number
  notes?: string | null
}

function rowToBatch(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    file_name: row.file_name,
    total_count: row.total_count,
    imported_count: row.imported_count,
    duplicates_count: row.duplicates_count,
    failed_count: row.failed_count,
    imported_at: row.imported_at,
    notes: row.notes
  }
}

/**
 * 创建批次记录。返回创建的对象。
 */
function createBatch(data: ImportBatchCreateInput): ImportBatch {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO import_batch
      (id, file_name, total_count, imported_count, duplicates_count,
       failed_count, imported_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.file_name,
    data.total_count,
    data.imported_count,
    data.duplicates_count,
    data.failed_count,
    now,
    data.notes ?? null
  )
  const created = getBatchById(id)
  if (!created) {
    throw new Error(`[importBatchRepo] createBatch: insert succeeded but row not found, id=${id}`)
  }
  return created
}

/**
 * 按 id 查询批次。
 */
function getBatchById(id: string): ImportBatch | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM import_batch WHERE id = ?').get(id) as
    | ImportBatchRow
    | undefined
  return row ? rowToBatch(row) : undefined
}

/**
 * 列出所有批次，按导入时间倒序。默认上限 500 条。
 */
function listBatches(limit = 500): ImportBatch[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM import_batch ORDER BY imported_at DESC LIMIT ?')
    .all(limit) as ImportBatchRow[]
  return rows.map(rowToBatch)
}

/**
 * 更新批次统计（导入完成后回填真实 imported_count 等）。
 */
function updateBatchStats(id: string, data: ImportBatchUpdateInput): boolean {
  const db = getDb()
  const setColumns: string[] = []
  const params: any[] = []
  if (data.imported_count !== undefined) {
    setColumns.push('imported_count = ?')
    params.push(data.imported_count)
  }
  if (data.duplicates_count !== undefined) {
    setColumns.push('duplicates_count = ?')
    params.push(data.duplicates_count)
  }
  if (data.failed_count !== undefined) {
    setColumns.push('failed_count = ?')
    params.push(data.failed_count)
  }
  if (data.notes !== undefined) {
    setColumns.push('notes = ?')
    params.push(data.notes)
  }
  if (setColumns.length === 0) return false
  params.push(id)
  return db.prepare(`UPDATE import_batch SET ${setColumns.join(', ')} WHERE id = ?`).run(...params)
    .changes > 0
}

/**
 * 删除批次记录。返回是否删除成功。
 * 注意：不会自动删除关联的 topics，调用方需先 deleteByBatch。
 */
function deleteBatch(id: string): boolean {
  const db = getDb()
  return db.prepare('DELETE FROM import_batch WHERE id = ?').run(id).changes > 0
}

/**
 * 统计某批次当前剩余的题数（用户可能已单独删除部分）。
 */
function countTopicsByBatch(batchId: string): number {
  const db = getDb()
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM topics WHERE batch_id = ?')
    .get(batchId) as { n: number } | undefined
  return Number(row?.n ?? 0)
}

export const importBatchRepo = {
  createBatch,
  getBatchById,
  listBatches,
  updateBatchStats,
  deleteBatch,
  countTopicsByBatch
}
