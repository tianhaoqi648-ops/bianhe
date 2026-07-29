import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'
import type { AuditLogDetail, BackupImportStrategy } from '../../../shared/types'
import { bulkInsert } from './utils'

// ============================================================
// 类型定义
// ============================================================

export interface AuditLog {
  id: string
  action: string | null
  target_type: string | null
  target_id: string | null
  operator: string | null
  detail: AuditLogDetail | null // 应用层用对象，DB 存 JSON 字符串
  created_at: string | null
}

/** DB audit_log 表的原始行类型（detail 为 JSON 字符串，未反序列化） */
export interface AuditLogRow {
  id: string
  action: string | null
  target_type: string | null
  target_id: string | null
  operator: string | null
  detail: string | null // DB 存 JSON 字符串
  created_at: string | null
}

export interface Setting {
  key: string
  value: any // 应用层用任意值，DB 存 JSON 字符串
}

export interface AuditLogFilter {
  action?: string
  target_type?: string
  operator?: string
  startTime?: string // ISO 8601，>= created_at
  endTime?: string // ISO 8601，<= created_at
  page?: number // 1-based
  pageSize?: number
}

export type AuditLogCreateInput = {
  action: string
  target_type: string
  target_id: string
  operator: string
  detail?: Record<string, any>
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 反序列化：DB row -> AuditLog
 * - detail: JSON 字符串 -> 对象
 *
 * 容错：detail 字段损坏时返回 null，避免单条坏数据导致整列查询失败。
 */
function rowToAuditLog(row: AuditLogRow): AuditLog {
  let detail: AuditLogDetail | null = null
  if (row.detail) {
    try {
      detail = JSON.parse(row.detail)
    } catch {
      detail = null
    }
  }
  return {
    ...row,
    detail
  }
}

/**
 * 根据 AuditLogFilter 动态构建 WHERE 子句与参数列表。
 * - action / target_type / operator：等值过滤
 * - startTime / endTime：created_at 范围过滤（>= / <=）
 */
function buildWhereClause(filter?: AuditLogFilter): { where: string; params: any[] } {
  const conditions: string[] = []
  const params: any[] = []
  if (filter?.action) {
    conditions.push('action = ?')
    params.push(filter.action)
  }
  if (filter?.target_type) {
    conditions.push('target_type = ?')
    params.push(filter.target_type)
  }
  if (filter?.operator) {
    conditions.push('operator = ?')
    params.push(filter.operator)
  }
  if (filter?.startTime) {
    conditions.push('created_at >= ?')
    params.push(filter.startTime)
  }
  if (filter?.endTime) {
    conditions.push('created_at <= ?')
    params.push(filter.endTime)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params }
}

// ============================================================
// 操作日志 CRUD
// ============================================================

/**
 * 新增一条操作日志。
 *
 * - id 用 uuid v4 生成
 * - created_at 自动生成 = new Date().toISOString()
 * - detail 用 JSON.stringify 转字符串存储（为空时存 null）
 * - 返回完整 AuditLog 对象（detail 反序列化回对象）
 */
function addLog(input: AuditLogCreateInput): AuditLog {
  const db = getDb()
  const id = uuidv4()
  const createdAt = new Date().toISOString()
  const detailStr = input.detail ? JSON.stringify(input.detail) : null

  const stmt = db.prepare(`
    INSERT INTO audit_log (id, action, target_type, target_id, operator, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    id,
    input.action,
    input.target_type,
    input.target_id,
    input.operator,
    detailStr,
    createdAt
  )

  return rowToAuditLog({
    id,
    action: input.action,
    target_type: input.target_type,
    target_id: input.target_id,
    operator: input.operator,
    detail: detailStr,
    created_at: createdAt
  })
}

/**
 * 列表查询操作日志。
 *
 * - 动态 WHERE：action / target_type / operator 等值过滤；created_at 范围过滤
 * - 分页：默认 page=1, pageSize=20，按 created_at DESC
 * - 同时执行 COUNT 查询
 * - 反序列化每条记录的 detail
 */
function listLogs(filter?: AuditLogFilter): { items: AuditLog[]; total: number } {
  const db = getDb()
  const { where, params } = buildWhereClause(filter)
  const page = filter?.page && filter.page > 0 ? filter.page : 1
  const pageSize = filter?.pageSize && filter.pageSize > 0 ? filter.pageSize : 20
  const offset = (page - 1) * pageSize

  // 1. 查列表（分页）
  const listSql = `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  const rows = db.prepare(listSql).all(...params, pageSize, offset) as AuditLogRow[]

  // 2. 查总数
  const countSql = `SELECT COUNT(*) AS total FROM audit_log ${where}`
  const countRow = db.prepare(countSql).get(...params) as { total: number } | undefined
  const total = countRow ? Number(countRow.total) : 0

  return {
    items: rows.map(rowToAuditLog),
    total
  }
}

/**
 * 按 id 删除单条操作日志。返回是否删除成功。
 */
function deleteLog(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM audit_log WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

/**
 * 清理操作日志。
 *
 * - beforeDate 提供：删除 `created_at < beforeDate` 的记录
 * - beforeDate 不提供：清空全部 audit_log 记录
 *
 * 返回删除的条数。
 */
function clearLogs(beforeDate?: string): number {
  const db = getDb()
  let result
  if (beforeDate) {
    const stmt = db.prepare('DELETE FROM audit_log WHERE created_at < ?')
    result = stmt.run(beforeDate)
  } else {
    const stmt = db.prepare('DELETE FROM audit_log')
    result = stmt.run()
  }
  return result.changes
}

// ============================================================
// 系统设置 CRUD
// ============================================================

/**
 * 读取一个配置项。
 *
 * - 找到：返回 JSON.parse(value)
 * - 未找到：返回 undefined
 *
 * 容错：value 损坏时返回 undefined，避免抛错中断调用方。
 */
function getSetting(key: string): any | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const row = stmt.get(key) as { value: string } | undefined
  if (!row) {
    return undefined
  }
  try {
    return JSON.parse(row.value)
  } catch {
    // P2-4: value 损坏，回退 undefined
    return undefined
  }
}

/**
 * 写入一个配置项（upsert）。
 *
 * - 使用 INSERT OR REPLACE
 * - value 用 JSON.stringify 转字符串存储
 */
function setSetting(key: string, value: any): void {
  const db = getDb()
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  stmt.run(key, JSON.stringify(value))
}

/**
 * 读取全部配置项，组装成 { key: value } 对象。每个 value 都 JSON.parse。
 *
 * 容错：单条 value 损坏时跳过该 key，不影响其他配置项。
 */
function getAllSettings(): Record<string, any> {
  const db = getDb()
  const stmt = db.prepare('SELECT key, value FROM settings')
  const rows = stmt.all() as Array<{ key: string; value: string }>
  const result: Record<string, any> = {}
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value)
    } catch {
      // P2-4: value 损坏，跳过该 key
    }
  }
  return result
}

/**
 * 删除一个配置项。返回是否删除成功。
 */
function deleteSetting(key: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM settings WHERE key = ?')
  const result = stmt.run(key)
  return result.changes > 0
}

/**
 * 批量删除配置项（事务）。返回实际删除的条数。
 * 用于「一键恢复初始设置」按类别清空。
 */
function deleteSettingsByKeys(keys: string[]): number {
  if (keys.length === 0) return 0
  const db = getDb()
  const stmt = db.prepare('DELETE FROM settings WHERE key = ?')
  let deleted = 0
  const tx = db.transaction((ks: string[]) => {
    for (const k of ks) {
      deleted += stmt.run(k).changes
    }
  })
  tx(keys)
  return deleted
}

// ============================================================
// 备份与恢复（全量数据导入导出）
// ============================================================

/**
 * 备份用：一次性返回 audit_log + settings 两张表的全部行（DB 原始格式）。
 *
 * 注意：此方法同时被 `audit_history` 类别（audit_log）和 `settings` 类别（settings）使用，
 * 调用方按需取用对应字段。
 */
function findAllForBackup(): {
  audit_log: Record<string, unknown>[]
  settings: Record<string, unknown>[]
} {
  const db = getDb()
  return {
    audit_log: db.prepare('SELECT * FROM audit_log').all() as Record<string, unknown>[],
    settings: db.prepare('SELECT * FROM settings').all() as Record<string, unknown>[]
  }
}

/**
 * 批量恢复 audit_log / settings 表。调用方需在外层事务内执行。
 */
function bulkRestore(
  table: 'audit_log' | 'settings',
  rows: Array<Record<string, unknown>>,
  strategy: BackupImportStrategy
): number {
  return bulkInsert(table, rows, strategy)
}

// ============================================================
// 导出
// ============================================================

export const auditRepo = {
  // 操作日志 CRUD
  addLog,
  listLogs,
  deleteLog,
  clearLogs,
  // 系统设置 CRUD
  getSetting,
  setSetting,
  getAllSettings,
  deleteSetting,
  deleteSettingsByKeys,
  // 备份与恢复
  findAllForBackup,
  bulkRestore
}
