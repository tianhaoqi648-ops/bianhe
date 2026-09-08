// ============================================================
// core/schema/backup.ts — 备份 schema（Bianhe Core 单真源）
//
// 源：桌面抽辩题 src/shared/types.ts L586-651（Backup 族）
// 【双源登记】与 shared/types.ts 同名类型结构一致、独立声明；改动需同步两处。
// 铁律：零外部 import（仅 core 内部）。
// ============================================================

export type BackupCategory =
  | 'topics'
  | 'events'
  | 'draw_records'
  | 'match_records'
  | 'timer'
  | 'formats_bells'
  | 'settings'
  | 'audit_history'
  | 'judge_history'
  | 'agent_sessions'
  | 'badges'
  | 'topic_groups'

export type BackupImportStrategy = 'clear_rebuild' | 'skip_existing' | 'overwrite_existing'

export interface BackupParams {
  categories: BackupCategory[]
}

export interface BackupImportParams {
  filePath: string
  strategy: BackupImportStrategy
  /** 仅导入这些类别 */
  categories: BackupCategory[]
}

export interface BackupPackage {
  version: string
  exportedAt: string
  appVersion: string
  categories: BackupCategory[]
  tables: Record<string, any[]> | Record<string, Record<string, string>>
}

export interface BackupPreviewResult {
  version: string
  exportedAt: string
  appVersion: string
  categories: BackupCategory[]
  tableCounts: Record<string, number>
}

export interface BackupExportResult {
  filePath: string
  totalRecords: number
  bellFilesCount: number
}

export interface BackupImportResult {
  inserted: number
  skipped: number
  overwritten: number
  bellFilesRestored: number
  /** 备份恢复时还原的队徽文件数（badges 类别） */
  badgeFilesRestored: number
  /** 恢复后外键检查是否发现孤立引用（true = 部分恢复/数据不完整） */
  fkInvalid: boolean
  /** 孤立引用条数 */
  fkViolationCount: number
  /** 孤立引用详情 */
  fkViolations: string[]
}
