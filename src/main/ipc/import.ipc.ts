// ============================================================
// import.ipc.ts — 导入相关 IPC handler
//
// 注册通道：
//   import:parseFile        解析文件（xlsx/csv/docx）
//   import:execute          执行导入（含库内去重检查）
//   import:findDuplicates   对给定列表做去重检测（不写库）
//
// 导入流程：
//   1. 拉取全量已有辩题用于去重比对
//   2. 逐条对入参 topics 与库内 + 已导入项做 findDuplicates
//   3. 重复项跳过，非重复项调用 topicRepo.createTopic
//   4. 写入 action='import' 审计日志
// ============================================================

import { ipcMain } from 'electron'
import { parseFile } from '../services/import-engine'
import type { FileType, ParsedResult } from '../services/import-engine'
import { findDuplicates } from '../services/dedup-engine'
import type { DedupOptions, DuplicateGroup } from '../services/dedup-engine'
import { topicRepo } from '../db/repository/topic.repo'
import type { Topic } from '../db/repository/topic.repo'
import { auditRepo } from '../db/repository/audit.repo'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ImportExecuteRequest,
  type ImportExecuteResult
} from '../../shared/types'

export function registerImportIpc(): void {
  // 解析文件（parseFile 为 async，需 await）
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PARSE_FILE,
    async (_e, filePath: string, fileType: FileType): Promise<ApiResponse<ParsedResult>> => {
      try {
        const data = await parseFile(filePath, fileType)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 执行导入：检查库内重复 → 插入非重复项
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_EXECUTE,
    async (_e, req: ImportExecuteRequest): Promise<ApiResponse<ImportExecuteResult>> => {
      try {
        const { topics, checkDuplicates = true } = req
        const duplicateGroups: ImportExecuteResult['duplicateGroups'] = []
        let imported = 0
        let duplicates = 0
        let failed = 0

        // 拉取全量已有辩题用于去重比对（pageSize=100000）
        const { items: existing } = topicRepo.listTopics({ page: 1, pageSize: 100000 })

        // 跟踪本次已成功导入的项，用于后续条目的去重比对
        const importedThisRun: Topic[] = []

        for (const t of topics) {
          try {
            if (checkDuplicates) {
              // 构造本次新题的临时 Topic 对象
              const newTopic: Topic = {
                id: '__new__',
                title: t.title,
                type: t.type ?? null,
                domain: t.domain ?? null,
                difficulty: t.difficulty ?? null,
                source: t.source ?? null,
                source_type: t.source_type ?? null,
                tags: t.tags ?? null,
                weight: 1.0,
                status: 'active',
                created_at: '',
                updated_at: ''
              }
              // 候选集 = 库内已存在 + 本次已导入
              const candidates: Topic[] = [...existing, ...importedThisRun]
              const groups = await findDuplicates([newTopic, ...candidates])
              // 若新题与任一已有题被归组，记为重复
              const hit = groups.find((g) => g.topics.some((p) => p.id === '__new__'))
              if (hit) {
                duplicates++
                duplicateGroups.push({
                  title: t.title,
                  existingIds: hit.topics
                    .filter((p) => p.id !== '__new__')
                    .map((p) => p.id)
                })
                continue
              }
            }
            const created = topicRepo.createTopic({
              title: t.title,
              type: t.type ?? null,
              domain: t.domain ?? null,
              difficulty: t.difficulty ?? null,
              source: t.source ?? null,
              source_type: t.source_type ?? '自定义',
              tags: t.tags ?? null
            })
            importedThisRun.push(created)
            imported++
          } catch {
            failed++
            // 单条失败不影响整体导入
          }
        }

        auditRepo.addLog({
          action: 'import',
          target_type: 'topic',
          target_id: 'bulk',
          operator: 'renderer',
          detail: { imported, duplicates, failed, total: topics.length }
        })

        return {
          success: true,
          data: { imported, duplicates, failed, duplicateGroups }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 对给定辩题列表做去重检测（不写库）
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_FIND_DUPLICATES,
    async (
      _e,
      topics: Topic[],
      options?: DedupOptions
    ): Promise<ApiResponse<DuplicateGroup[]>> => {
      try {
        const data = await findDuplicates(topics, options)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
