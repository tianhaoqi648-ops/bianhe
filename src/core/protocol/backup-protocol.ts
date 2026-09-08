// ============================================================
// core/protocol/backup-protocol.ts — bianhe-backup-v1 备份协议（Bianhe Core 单真源）
//
// 源：小程序 cloud/functions/common/pure/backup-protocol.js 协议级部分（Phase 7.6）
// 只含协议级逻辑；端侧类别→表映射（CATEGORY_TABLES/BACKUP_RESTORE_ORDER/SOURCE/APP_VERSION）
// 由各端维护（桌面 12 类 vs Mini 8 类），不进 Core。
// 铁律：零外部 import。
// ============================================================

export const PROTOCOL_VERSION = '1'
export const SCHEMA_VERSION = '1'
/** 跨端互通的备份格式版本（桌面 SUPPORTED_BACKUP_VERSION '1.0'） */
export const SUPPORTED_VERSIONS = ['1.0']

/**
 * 校验备份包结构（跨端互读兼容）：
 * - version 必须在 SUPPORTED_VERSIONS 内，否则拒绝（ok=false + error）
 * - tables 必须存在且为对象
 * - 非数组表值（桌面包 bell_files/badge_files 为 {文件名:base64} 字典）→ 降级 warning，不拒绝
 */
export function validateBackupPackage(data: unknown): { ok: boolean; error?: string; warnings: string[] } {
  const warnings: string[] = []
  if (!data || typeof data !== 'object') {
    return { ok: false, error: '备份数据格式不正确（非对象）', warnings }
  }
  const pkg = data as { version?: unknown; tables?: unknown }
  if (!SUPPORTED_VERSIONS.includes(String(pkg.version))) {
    return { ok: false, error: `不支持的备份版本：${String(pkg.version)}（支持 ${SUPPORTED_VERSIONS.join('/')}）`, warnings }
  }
  if (!pkg.tables || typeof pkg.tables !== 'object') {
    return { ok: false, error: '备份数据缺少 tables 结构', warnings }
  }
  for (const [name, rows] of Object.entries(pkg.tables as Record<string, unknown>)) {
    if (!Array.isArray(rows)) {
      warnings.push(`表 ${name} 为非数组数据（${typeof rows}），导入时跳过`)
    }
  }
  return { ok: true, warnings }
}

/**
 * 版本迁移 hook（v1 → v2 预留扩展点）：
 * 当前返回原包；未来升级时在此按 MIGRATIONS 顺序逐版本迁移并记录 applied。
 * 不硬编码 version===1 永久不升级。
 */
export function migratePackage(data: object): { data: object; applied: string[] } {
  // MIGRATIONS 表：未来在此追加，如 [{ from: '1', to: '2', run: (d) => ({...}) }]
  const MIGRATIONS: Array<{ from: string; to: string; run: (d: any) => any }> = []
  const applied: string[] = []
  let current = data
  for (const m of MIGRATIONS) {
    if (String((current as any).schemaVersion) === m.from) {
      current = m.run(current)
      applied.push(`${m.from}->${m.to}`)
    }
  }
  return { data: current, applied }
}

/** 构建导出 metadata（各表条数统计）。 */
export function buildExportMetadata(tables: Record<string, unknown>): { counts: Record<string, number> } {
  const counts: Record<string, number> = {}
  for (const [name, rows] of Object.entries(tables || {})) {
    counts[name] = Array.isArray(rows) ? rows.length : 0
  }
  return { counts }
}

/**
 * 事件子表导出的分片查询计划（云数据库 `_.in` 上限 10）。
 */
export function planEventScopedRead(eventIds: string[] | null | undefined, chunkSize = 10): string[][] {
  if (!Array.isArray(eventIds) || eventIds.length === 0) return []
  const plans: string[][] = []
  for (let i = 0; i < eventIds.length; i += chunkSize) {
    plans.push(eventIds.slice(i, i + chunkSize))
  }
  return plans
}
