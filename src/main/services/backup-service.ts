// ============================================================
// services/backup-service.ts — 全量数据备份与恢复编排
//
// 职责：按类别聚合各 repo 的备份方法，组装 BackupPackage，
//       并提供预览/导入/导出文件操作。
//
// 与 backup/index.ts（数据库文件级备份）的区别：
//   - backup/index.ts：复制 .db 文件，用于崩溃恢复
//   - backup-service.ts：JSON 格式业务数据导入导出，用于迁移/分享
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { dirname } from 'path'
import { getDb } from '../db/index'
import { topicRepo } from '../db/repository/topic.repo'
import { eventRepo } from '../db/repository/event.repo'
import { drawRepo } from '../db/repository/draw.repo'
import { formatRepo } from '../db/repository/format.repo'
import { bellAssetRepo } from '../db/repository/bell-asset.repo'
import { auditRepo } from '../db/repository/audit.repo'
import { timerSessionRepo } from '../db/repository/timer-session.repo'
import { importBatchRepo } from '../db/repository/import-batch.repo'
import { batchEditHistoryRepo } from '../db/repository/batch-edit-history.repo'
import { undoLogRepo } from '../db/repository/undo-log.repo'
import { judgeHistoryRepo } from '../db/repository/judge-history.repo'
import {
  findForBackup as badgeFindForBackup,
  encodeBadgeFiles as badgeEncodeBadgeFiles,
  restoreBackup as badgeRestoreBackup
} from './badge-storage'
import {
  BACKUP_CATEGORIES,
  BACKUP_RESTORE_ORDER,
  SUPPORTED_BACKUP_VERSION
} from '../../shared/constants'
import type {
  BackupParams,
  BackupImportParams,
  BackupPackage,
  BackupPreviewResult,
  BackupImportResult,
  BackupCategory,
  BadgeItem,
  TeamBadgeMap
} from '../../shared/types'
import { bulkInsert, clearTable, TABLE_COLUMNS } from '../db/repository/utils'
import { version as APP_VERSION } from '../../../package.json'

/**
 * 导出备份：按勾选类别聚合各 repo 数据，返回 BackupPackage 对象。
 *
 * 注意：
 * - tables 字段中除了真实表数据，还会包含 `bell_files` 字典（key 为相对路径文件名，value 为 base64）
 *   仅在 categories 包含 'formats_bells' 时填充
 * - 各表行保留 DB 原始格式（JSON 列未反序列化），便于导入时直接还原
 *
 * P2-10: 全程包裹在 db.transaction() 中，确保各表读取的一致性快照。
 *        避免导出过程中其他写入导致 tables 各表数据不一致（如 topics 已读但 events 被并发改写）。
 *
 * P4 性能注意（未修复）：bellAssetRepo.findAllForBackup() 内部调用 existsSync 检查
 *   音频文件存在性，encodeBellFiles() 内部调用 readFileSync 读取音频文件本体，
 *   这些文件 I/O 在 DB 事务内执行会拉长事务持锁时间。
 *   彻底修复需在 repo 层新增"纯 DB 读取"方法（不含 existsSync），并将文件 I/O 移到事务外，
 *   涉及 bell-asset.repo.ts 改造，规模较大，且功能正确性不受影响，暂留注释标记。
 */
export function exportBackup(params: BackupParams): BackupPackage {
  const db = getDb()
  const tables: Record<string, unknown> = {}
  const cats = params.categories

  const tx = db.transaction(() => {
    if (cats.includes('topics')) {
      tables.topics = topicRepo.findAllForBackup()
      tables.topic_custom_fields = topicRepo.findAllCustomFieldsForBackup()
    }

    if (cats.includes('events')) {
      const data = eventRepo.findAllForBackup()
      Object.assign(tables, data)
    }

    if (cats.includes('draw_records')) {
      const data = drawRepo.findAllForBackup()
      Object.assign(tables, data)
    }

    if (cats.includes('timer')) {
      const data = timerSessionRepo.findAllForBackup()
      Object.assign(tables, data)
    }

    if (cats.includes('formats_bells')) {
      tables.debate_formats = formatRepo.findAllForBackup()
      tables.bell_assets = bellAssetRepo.findAllForBackup()
      // bell_files 是文件名字典（不含表数据），用于还原音频文件本体
      tables.bell_files = bellAssetRepo.encodeBellFiles()
    }

    if (cats.includes('settings')) {
      tables.settings = auditRepo.findAllForBackup().settings
    }

    if (cats.includes('audit_history')) {
      const auditData = auditRepo.findAllForBackup()
      tables.audit_log = auditData.audit_log
      tables.import_batch = importBatchRepo.findAllForBackup()
      const batchData = batchEditHistoryRepo.findAllForBackup()
      tables.batch_edit_history = batchData.batch_edit_history
      tables.batch_edit_history_item = batchData.batch_edit_history_item
      tables.undo_log = undoLogRepo.findAllForBackup()
    }

    if (cats.includes('judge_history')) {
      tables.judge_history = judgeHistoryRepo.findAllForBackup()
    }

    if (cats.includes('badges')) {
      const badgeData = badgeFindForBackup()
      // badges 为 index.json 注册表（条目数组）；team_bindings 为队伍→队徽绑定；
      // badge_files 为自定义队徽文件的 { 文件名: base64 } 字典（用于还原文件本体）
      tables.badges = badgeData.registry
      tables.team_bindings = badgeData.bindings
      tables.badge_files = badgeEncodeBadgeFiles(badgeData.fileNames)
    }
  })
  tx()

  return {
    version: SUPPORTED_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    categories: cats,
    tables: tables as BackupPackage['tables']
  }
}

/**
 * 备份文件大小上限：100 MB。
 * P4-7: 读取前校验文件大小，避免读取超大文件导致内存溢出。
 */
const BACKUP_FILE_MAX_BYTES = 100 * 1024 * 1024

/**
 * 安全读取备份文件：先 statSync 校验大小，再 readFileSync。
 * @throws 文件超过 100MB 或不存在时抛错
 */
function readBackupFile(filePath: string): string {
  const stat = statSync(filePath)
  if (stat.size > BACKUP_FILE_MAX_BYTES) {
    throw new Error(
      `备份文件过大（${(stat.size / 1024 / 1024).toFixed(1)} MB），上限为 ${BACKUP_FILE_MAX_BYTES / 1024 / 1024} MB`
    )
  }
  return readFileSync(filePath, 'utf-8')
}

/**
 * 预览导入：读取备份文件并解析头部信息 + 各表行数。
 * 不写库，仅用于 UI 展示。
 *
 * @throws 当备份版本不支持时抛错
 */
export function previewImport(filePath: string): BackupPreviewResult {
  const raw = readBackupFile(filePath)
  let pkg: BackupPackage
  try {
    pkg = JSON.parse(raw) as BackupPackage
  } catch (e) {
    throw new Error('备份文件格式无效，请选择正确的 .json 备份文件')
  }
  if (pkg.version !== SUPPORTED_BACKUP_VERSION) {
    throw new Error(
      `不支持的备份版本：${pkg.version}，当前支持：${SUPPORTED_BACKUP_VERSION}`
    )
  }
  const tableCounts: Record<string, number> = {}
  for (const [key, value] of Object.entries(pkg.tables)) {
    if (Array.isArray(value)) {
      tableCounts[key] = value.length
    } else if (typeof value === 'object' && value !== null) {
      // bell_files 字典：key 数量即为文件数
      tableCounts[key] = Object.keys(value as Record<string, unknown>).length
    }
  }
  return {
    version: pkg.version,
    exportedAt: pkg.exportedAt,
    appVersion: pkg.appVersion,
    categories: pkg.categories,
    tableCounts
  }
}

/**
 * 执行全量导入。
 *
 * 流程：
 *   1. 解析 JSON 文件，校验版本
 *   2. 仅导入用户勾选 + 备份中存在的类别
 *   3. 按外键依赖顺序（BACKUP_RESTORE_ORDER）排序类别
 *   4. clear_rebuild 策略：先反向清空对应表（先子表后父表）
 *   5. 按顺序调用 bulkInsert 写入
 *   6. 若包含 formats_bells，调用 bellAssetRepo.decodeBellFiles 还原音频文件
 *   7. 全程包裹在单个事务中，单条失败整批回滚
 *
 * @returns { inserted, skipped, overwritten, bellFilesRestored }
 */
export function importBackup(params: BackupImportParams): BackupImportResult {
  const raw = readBackupFile(params.filePath)
  // P4 修复：JSON.parse 包裹 try/catch，提供友好错误提示
  let pkg: BackupPackage
  try {
    pkg = JSON.parse(raw) as BackupPackage
  } catch {
    throw new Error('备份文件格式无效，请选择正确的 .json 备份文件')
  }
  if (pkg.version !== SUPPORTED_BACKUP_VERSION) {
    throw new Error(`不支持的备份版本：${pkg.version}`)
  }

  // 仅导入用户勾选 + 备份中存在的类别
  const catsToImport = params.categories.filter((c) => pkg.categories.includes(c))
  // 按外键依赖顺序排序
  const orderedCats = BACKUP_RESTORE_ORDER.filter((c) =>
    (catsToImport as readonly string[]).includes(c)
  ) as BackupCategory[]

  let inserted = 0
  let skipped = 0
  let overwritten = 0
  let bellFilesRestored = 0
  let badgeFilesRestored = 0

  const db = getDb()
  // Bug P1-4: clear_rebuild 策略下临时禁用外键约束，
  // 防止清空选中类别表时 CASCADE 级联删除未选类别关联数据。
  // 注意：PRAGMA foreign_keys 在事务内为 no-op，必须在事务外切换。
  const needFkToggle = params.strategy === 'clear_rebuild'
  if (needFkToggle) {
    db.pragma('foreign_keys = false')
  }
  const tx = db.transaction(() => {
    // clear_rebuild 策略：先反向清空对应表（先子表后父表）
    if (params.strategy === 'clear_rebuild') {
      for (const cat of orderedCats) {
        const config = BACKUP_CATEGORIES.find((c) => c.key === cat)
        if (!config) continue
        // 反向清空（先子表后父表）
        for (const table of [...config.tables].reverse()) {
          // 仅清空实际 DB 表；badges 类别的 badges/team_bindings/badge_files 为
          // 文件型虚拟表（非 TABLE_COLUMNS 白名单内），需跳过，由 restoreBackup 统一还原。
          if (pkg.tables[table] && TABLE_COLUMNS[table]) {
            clearTable(table)
          }
        }
      }
    }

    // 按顺序插入
    for (const cat of orderedCats) {
      const config = BACKUP_CATEGORIES.find((c) => c.key === cat)
      if (!config) continue
      for (const table of config.tables) {
        const rows = pkg.tables[table]
        // 跳过空表 / 非数组表 / 非 DB 白名单内的文件型虚拟表（如 badges 三张虚拟表）
        if (!Array.isArray(rows) || rows.length === 0 || !TABLE_COLUMNS[table]) continue
        // bell_assets 表：剥离 file_missing 标记字段（仅用于备份展示，非 DB 实际列）
        // 缺失音频文件的行仍按原 row 数据导入，不报错；下次导出时会重新检查文件存在性
        const cleanRows =
          table === 'bell_assets'
            ? (rows as Array<Record<string, unknown>>).map((row) => {
                const { file_missing: _unused, ...rest } = row
                void _unused
                return rest
              })
            : (rows as Array<Record<string, unknown>>)
        const count = bulkInsert(table, cleanRows, params.strategy)
        // 统计：clear_rebuild 策略下 changes 等于插入数；
        //       skip_existing 下 changes 等于实际插入数，差额为跳过数；
        //       overwrite_existing 下 changes 反映了 replace 次数（即覆盖+新增），统一计入 overwritten
        if (params.strategy === 'clear_rebuild') {
          inserted += count
        } else if (params.strategy === 'skip_existing') {
          inserted += count
          skipped += rows.length - count
        } else {
          // overwrite_existing
          overwritten += count
        }
      }
    }
  })
  try {
    tx()
  } finally {
    // Bug P1-4: 无论事务成功或失败都恢复外键约束，避免影响后续操作
    if (needFkToggle) {
      db.pragma('foreign_keys = true')
    }
  }

  // P2-11: bell_files 文件写入移到 DB 事务外。
  // 原因：decodeBellFiles 执行磁盘文件 I/O，放在 DB 事务内会拉长事务持锁时间，
  //       且文件写入失败不应回滚已成功的 DB 导入（DB 记录已就位，文件可后续补齐）。
  //       顺序：先完成 DB 事务（含 bell_assets 表导入），再写音频文件本体。
  if (
    (catsToImport as readonly string[]).includes('formats_bells') &&
    pkg.tables.bell_files
  ) {
    bellFilesRestored = bellAssetRepo.decodeBellFiles(
      pkg.tables.bell_files as Record<string, string>,
      params.strategy
    )
  }

  // 队徽库还原同样移到 DB 事务外（磁盘文件 I/O）：
  // 先完成 DB 事务，再写队徽文件 + index.json + team-bindings.json，
  // 文件写入失败不应回滚已成功的 DB 导入。
  if (
    (catsToImport as readonly string[]).includes('badges') &&
    pkg.tables.badges
  ) {
    badgeFilesRestored = badgeRestoreBackup(
      {
        registry: pkg.tables.badges as BadgeItem[],
        bindings: pkg.tables.team_bindings as TeamBadgeMap | undefined,
        files: pkg.tables.badge_files as Record<string, string> | undefined
      },
      undefined,
      params.strategy
    )
  }

  return { inserted, skipped, overwritten, bellFilesRestored, badgeFilesRestored }
}

/**
 * 写入备份文件到指定路径。
 * 自动创建父目录。
 */
export function writeBackupFile(filePath: string, pkg: BackupPackage): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, JSON.stringify(pkg, null, 2), 'utf-8')
}

/**
 * 获取各类别本地数据条数统计。
 *
 * 遍历 BACKUP_CATEGORIES，对每个类别下的所有表执行 COUNT(*) 求和，
 * 用于 BackupExportModal 在每个类别卡片下方展示"共 N 条"。
 *
 * 单表查询失败时跳过（如表不存在），不影响其他类别统计。
 *
 * @returns { [categoryKey]: totalRowCount }
 */
export function getBackupStats(): Record<string, number> {
  const stats: Record<string, number> = {}
  const db = getDb()
  for (const cat of BACKUP_CATEGORIES) {
    let total = 0
    // badges 为文件型数据（非 DB 表），单独统计注册表 + 绑定数量
    if (cat.key === 'badges') {
      try {
        const badgeData = badgeFindForBackup()
        total = badgeData.registry.length + Object.keys(badgeData.bindings).length
      } catch (e) {
        console.warn('[backup-service] getBackupStats: 队徽统计失败', e)
      }
      stats[cat.key] = total
      continue
    }
    for (const table of cat.tables) {
      // P4 修复：表名白名单校验，防止 cat.tables 配置错误导致 SQL 注入
      if (!TABLE_COLUMNS[table]) {
        console.warn(`[backup-service] Unknown table: ${table}, skipping`)
        continue
      }
      try {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as
          | { n: number }
          | undefined
        if (row && typeof row.n === 'number') {
          total += row.n
        }
      } catch (e) {
        // 表不存在或查询失败时跳过该表
        console.warn(`[backup-service] getBackupStats: 查询表 ${table} 失败`, e)
      }
    }
    stats[cat.key] = total
  }
  return stats
}
