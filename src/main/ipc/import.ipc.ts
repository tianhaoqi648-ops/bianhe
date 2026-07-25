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

        // 一次性批量构造本次新题的临时 Topic 对象（唯一占位 id）
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
          created_at: '',
          updated_at: ''
        }))

        // 批量去重：新题 + 库内已存在，单次 findDuplicates 调用
        // 候选集包含所有新题，使新题之间的互相重复也能被检测
        const allTopics: Topic[] = checkDuplicates
          ? [...newTopics, ...existing]
          : []
        const dupGroups =
          checkDuplicates && allTopics.length >= 2
            ? await findDuplicates(allTopics)
            : []

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

        // 占位 id → 已导入新题的真实 id（用于检测新题之间的重复）
        const importedPlaceholderToReal = new Map<string, string>()

        // 按顺序处理每条新题：
        //   若任一同组成员是已存在题或本次已导入的新题 → 重复，跳过
        //   否则插入数据库，并记录占位 id → 真实 id 映射
        // 这等价于原 incremental 循环的行为（首条导入，后续重复跳过）
        for (let i = 0; i < topics.length; i++) {
          const t = topics[i]
          const placeholderId = `__new_${i}__`
          try {
            if (checkDuplicates) {
              const memberIds = groupMembersByTopicId.get(placeholderId) ?? []
              const conflictIds: string[] = []
              for (const mid of memberIds) {
                if (mid.startsWith('__new_')) {
                  // 仅当该占位 id 对应新题已被导入时算冲突
                  const realId = importedPlaceholderToReal.get(mid)
                  if (realId) conflictIds.push(realId)
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
            const created = topicRepo.createTopic({
              title: t.title,
              type: t.type ?? null,
              domain: t.domain ?? null,
              difficulty: t.difficulty ?? null,
              source: t.source ?? null,
              source_type: t.source_type ?? '自定义',
              tags: t.tags ?? null
            })
            importedPlaceholderToReal.set(placeholderId, created.id)
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
