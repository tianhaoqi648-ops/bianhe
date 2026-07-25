// ============================================================
// import.ipc.ts — 导入相关 IPC handler
//
// 注册通道：
//   import:parseFile        解析文件（xlsx/csv/docx）
//   import:execute          执行导入（含库内去重检查 + 批次记录 + 事务插入）
//   import:findDuplicates   对给定列表做去重检测（不写库）
//   import:revokeBatch      撤销整批导入（删除批次 + 关联 topics）
//   import:listBatches      列出所有导入批次（带剩余题数）
//
// 导入流程（重写版）：
//   1. 创建 import_batch 占位记录（imported_count=0）
//   2. 拉取全量已有辩题用于去重比对
//   3. 一次性批量构造本次新题的临时 Topic 对象（占位 id）
//   4. findDuplicates 批量检测新题之间 + 与库内的重复
//   5. 遍历 topics，跳过重复项，非重复项构造 topicsToImport 并设置 batch_id
//   6. topicRepo.createMany 事务批量插入非重复项
//   7. 回填 import_batch 真实统计
//   8. 写入 action='import' 审计日志（target_id=batch.id）
// ============================================================

import { ipcMain } from 'electron'
import { parseFile } from '../services/import-engine'
import type { FileType, ParsedResult } from '../services/import-engine'
import { findDuplicates } from '../services/dedup-engine'
import type { DedupOptions, DuplicateGroup } from '../services/dedup-engine'
import { topicRepo } from '../db/repository/topic.repo'
import type { Topic, TopicCreateInput } from '../db/repository/topic.repo'
import { importBatchRepo } from '../db/repository/import-batch.repo'
import { auditRepo } from '../db/repository/audit.repo'
import { addCandidateValue } from '../services/candidate-service'
import type { CandidateField } from '../../shared/constants'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ImportBatch,
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

  // 执行导入：检查库内重复 → 批量插入非重复项 → 记录批次
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_EXECUTE,
    async (_e, req: ImportExecuteRequest): Promise<ApiResponse<ImportExecuteResult>> => {
      try {
        const { topics, checkDuplicates = true, fileName, valueMapping } = req
        const duplicateGroups: ImportExecuteResult['duplicateGroups'] = []
        let imported = 0
        let duplicates = 0
        let failed = 0

        // 1. 创建批次记录（占位，imported_count=0）
        const batch = importBatchRepo.createBatch({
          file_name: fileName ?? '未命名文件',
          total_count: topics.length,
          imported_count: 0,
          duplicates_count: 0,
          failed_count: 0
        })

        // 1.5 持久化「加入候选」动作：在 createMany 之前完成，
        // 这样同一批次内若有多个相同新值，第一次 add 后续自动去重；
        // 用户重启后仍可在筛选/抽取筛选中看到这些新候选。
        // try-catch 单独捕获，失败不阻断主流程（仅记录日志）。
        if (valueMapping) {
          try {
            for (const field of Object.keys(valueMapping) as CandidateField[]) {
              const valueMap = valueMapping[field]
              if (!valueMap) continue
              for (const originValue of Object.keys(valueMap)) {
                const rule = valueMap[originValue]
                if (rule?.action === 'add') {
                  addCandidateValue(field, originValue)
                }
              }
            }
          } catch (e) {
            console.error('[import.ipc] addCandidateValue failed:', e)
          }
        }

        // 2. 拉取全量已有辩题用于去重比对
        const { items: existing } = topicRepo.listTopics({ page: 1, pageSize: 100000 })

        // 3. 一次性批量构造本次新题的临时 Topic 对象（唯一占位 id）
        // 替代原 O(n²) 每条单独 findDuplicates 的实现
        const newTopics: Topic[] = topics.map((t, i) => ({
          id: `__new_${i}__`,
          title: t.title,
          type: t.type ?? null,
          domain: t.domain ?? null,
          difficulty: t.difficulty ?? null,
          source: t.source ?? null,
          source_type: t.source_type ?? null,
          tags: t.tags ?? null,
          weight: 1.0,
          status: 'active',
          batch_id: null,
          created_at: '',
          updated_at: ''
        }))

        // 4. 批量去重：新题 + 库内已存在，单次 findDuplicates 调用
        // 候选集包含所有新题，使新题之间的互相重复也能被检测
        const allTopics: Topic[] = checkDuplicates ? [...newTopics, ...existing] : []
        const dupGroups =
          checkDuplicates && allTopics.length >= 2 ? await findDuplicates(allTopics) : []

        // 构建占位 id → 同组其他成员 id 列表 的映射
        const groupMembersByTopicId = new Map<string, string[]>()
        for (const g of dupGroups) {
          const ids = g.topics.map((p) => p.id)
          for (const id of ids) {
            if (!groupMembersByTopicId.has(id)) {
              groupMembersByTopicId.set(id, [])
            }
            for (const otherId of ids) {
              if (otherId !== id) {
                groupMembersByTopicId.get(id)!.push(otherId)
              }
            }
          }
        }

        // 占位 id → 已导入新题的真实 id 映射已废弃（旧逻辑残留死代码）。
        // 新题之间的去重改由「同组其他 __new_ 占位 id 直接判为冲突」实现，
        // 第一题入库后，同组后续题在循环到时会因 mid.startsWith('__new_') 进入冲突分支。

        // 5. 遍历 topics，跳过重复项，非重复项构造 topicsToImport 并设置 batch_id
        const topicsToImport: TopicCreateInput[] = []
        for (let i = 0; i < topics.length; i++) {
          const t = topics[i]
          const placeholderId = `__new_${i}__`
          if (checkDuplicates) {
            const memberIds = groupMembersByTopicId.get(placeholderId) ?? []
            const conflictIds: string[] = []
            for (const mid of memberIds) {
              if (mid.startsWith('__new_')) {
                // 同组其他新题视为冲突（避免新题之间重复入库）
                // 第一题入库时同组后续题还未处理 → 不冲突；后续题遇到已入库的同组题 → 冲突
                if (mid !== placeholderId) conflictIds.push(mid)
              } else {
                // 库内已存在题
                conflictIds.push(mid)
              }
            }
            if (conflictIds.length > 0) {
              duplicates++
              duplicateGroups.push({
                title: t.title,
                existingIds: conflictIds
              })
              continue
            }
          }
          topicsToImport.push({
            title: t.title,
            type: t.type ?? null,
            domain: t.domain ?? null,
            difficulty: t.difficulty ?? null,
            source: t.source ?? null,
            source_type: t.source_type ?? '自定义',
            tags: t.tags ?? null,
            batch_id: batch.id
          })
        }

        // 6. 批量插入（事务包装，失败回滚）
        try {
          const created = topicRepo.createMany(topicsToImport)
          imported = created.length
        } catch (e) {
          // createMany 内部事务失败会回滚，所有题都不会入库
          failed = topicsToImport.length
          console.error('[import.ipc] createMany failed:', e)
        }

        // 7. 回填批次真实统计
        importBatchRepo.updateBatchStats(batch.id, {
          imported_count: imported,
          duplicates_count: duplicates,
          failed_count: failed
        })

        // 8. 写入审计日志（target_id=batch.id，便于回溯）
        auditRepo.addLog({
          action: 'import',
          target_type: 'topic',
          target_id: batch.id,
          operator: 'renderer',
          detail: {
            imported,
            duplicates,
            failed,
            total: topics.length,
            batchId: batch.id,
            fileName: batch.file_name
          }
        })

        return {
          success: true,
          data: { imported, duplicates, failed, duplicateGroups, batchId: batch.id }
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

  // 撤销整批导入：删除批次 + 关联 topics
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_REVOKE_BATCH,
    async (_e, batchId: string): Promise<ApiResponse<{ deletedCount: number }>> => {
      try {
        const batch = importBatchRepo.getBatchById(batchId)
        if (!batch) {
          return { success: false, error: '批次不存在' }
        }
        const deletedCount = topicRepo.deleteByBatch(batchId)
        importBatchRepo.deleteBatch(batchId)
        auditRepo.addLog({
          action: 'import_revoke',
          target_type: 'topic',
          target_id: batchId,
          operator: 'renderer',
          detail: { deletedCount, fileName: batch.file_name }
        })
        return { success: true, data: { deletedCount } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 列出所有导入批次（带剩余题数）
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_LIST_BATCHES,
    async (_e): Promise<ApiResponse<ImportBatch[]>> => {
      try {
        const batches = importBatchRepo.listBatches()
        // 附加每个批次当前剩余的题数（用户可能已单独删除部分）
        const withCounts: ImportBatch[] = batches.map((b) => ({
          ...b,
          remainingCount: importBatchRepo.countTopicsByBatch(b.id)
        }))
        return { success: true, data: withCounts }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
