// ============================================================
// import.ipc.ts — 导入相关 IPC handler
//
// 注册通道：
//   import:parseFile        解析文件（xlsx/csv/docx）
//   import:execute          执行导入（含库内去重检查 + 批次记录 + 事务插入）
//   import:findDuplicates   对给定列表做去重检测（不写库）
//   import:revokeBatch      撤销整批导入（删除批次 + 关联 topics）
//   import:listBatches      列出所有导入批次（带剩余题数）
//   import:eventPackage     导入赛事包（JSON，含三种冲突策略）
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
import { readFile } from 'fs/promises'
import { parseFile, applyFieldMapping } from '../services/import-engine'
import type { FileType, ParsedResult } from '../services/import-engine'
import { findDuplicates } from '../services/dedup-engine'
import type { DedupOptions, DuplicateGroup } from '../services/dedup-engine'
import { topicRepo } from '../db/repository/topic.repo'
import type { Topic, TopicCreateInput } from '../db/repository/topic.repo'
import { topicGroupRepo } from '../db/repository/topic-group.repo'
import { importBatchRepo } from '../db/repository/import-batch.repo'
import { auditRepo } from '../db/repository/audit.repo'
import { eventRepo } from '../db/repository/event.repo'
import { drawRepo } from '../db/repository/draw.repo'
import { createEvent as createEventWithDefaultGroup } from '../services/event-service'
import { getDb } from '../db/index'
import { addCandidateValue } from '../services/candidate-service'
import type { CandidateField } from '../../shared/constants'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ImportBatch,
  type ImportExecuteRequest,
  type ImportExecuteResult,
  type FieldMapping,
  type ImportEventPackageRequest,
  type ImportEventPackageResult,
  type ImportEventPackagePreviewResult
} from '../../shared/types'

/**
 * P2-23：参数校验辅助函数。
 * 校验失败时抛出友好错误，由各 handler 的 try/catch 捕获并转为 ApiResponse.error 返回前端。
 */
function assertParam(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/** 校验非空字符串 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  assertParam(typeof value === 'string' && value.length > 0, `参数 ${name} 必须为非空字符串`)
}

export function registerImportIpc(): void {
  // 解析文件（parseFile 为 async，需 await）
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PARSE_FILE,
    async (_e, filePath: string, fileType: FileType): Promise<ApiResponse<ParsedResult>> => {
      try {
        assertNonEmptyString(filePath, 'filePath')
        assertParam(
          fileType === 'xlsx' || fileType === 'csv' || fileType === 'docx',
          '参数 fileType 必须为 xlsx/csv/docx 之一'
        )
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
        assertParam(req && typeof req === 'object', '参数 req 必须为对象')
        assertParam(Array.isArray(req.topics), '参数 topics 必须为数组')
        const { topics, checkDuplicates = true, fileName, valueMapping, groupIds } = req
        // P2-33: 入口校验空 topics 数组，避免创建空批次记录
        if (!topics || topics.length === 0) {
          return { success: false, error: '没有可导入的辩题数据' }
        }
        const duplicateGroups: ImportExecuteResult['duplicateGroups'] = []
        let imported = 0
        let duplicates = 0
        let failed = 0
        // T2：部分失败/警示收集。主流程不阻断，但反馈给用户（见下方 return）。
        const warnings: string[] = []

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
        // P3-5: pageSize=100000 作为全量拉取的 workaround（topicRepo 无 listAll 方法）
        const { items: existing } = topicRepo.listTopics({ page: 1, pageSize: 100000 })

        // 3. 一次性批量构造本次新题的临时 Topic 对象（唯一占位 id）
        // 替代原 O(n²) 每条单独 findDuplicates 的实现
        // P3-3/P4-16: weight 使用 t.weight ?? 1.0 兜底，保留用户在导入数据中指定的权重，
        // 避免硬编码 1.0 覆盖用户输入（影响后续加权抽取的概率分布）
        const newTopics: Topic[] = topics.map((t, i) => ({
          id: `__new_${i}__`,
          title: t.title,
          type: t.type ?? null,
          domain: t.domain ?? null,
          difficulty: t.difficulty ?? null,
          source: t.source ?? null,
          source_type: t.source_type ?? null,
          tags: t.tags ?? null,
          weight: t.weight ?? 1.0,
          status: t.status ?? 'active',
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

        // 占位 id → 已导入新题的真实 id 映射。
        // Bug 1.2: 跟踪已导入新题的占位 ID，仅把"已导入的同组新题"作为冲突，
        // 避免新题之间互相加入 conflictIds 导致同组所有新题全部被跳过。
        const importedPlaceholders = new Set<string>()

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
                // Bug 1.2: 只把已导入的同组新题视为冲突（避免新题之间互相重复入库）
                // 第一题入库时同组后续题还未处理 → 不冲突；后续题遇到已入库的同组题 → 冲突
                if (mid !== placeholderId && importedPlaceholders.has(mid)) {
                  conflictIds.push(mid)
                }
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
            // P3-4: source_type 改为 null 兜底，避免硬编码 '自定义' 覆盖用户意图
            source_type: t.source_type ?? null,
            tags: t.tags ?? null,
            batch_id: batch.id
          })
          // Bug 1.2: 标记该占位 ID 已导入，后续同组新题遇到时才视为冲突
          importedPlaceholders.add(placeholderId)
        }

        // 6. 批量插入（事务包装，失败回滚）
        let createdIds: string[] = []
        try {
          const created = topicRepo.createMany(topicsToImport)
          createdIds = created.map((t) => t.id)
          imported = created.length
        } catch (e) {
          // createMany 内部事务失败会回滚，所有题都不会入库
          failed = topicsToImport.length
          console.error('[import.ipc] createMany failed:', e)
          // Bug P1-6: 清理孤立的占位批次记录，避免残留 failed_count=total_count 的批次
          try {
            importBatchRepo.deleteBatch(batch.id)
          } catch (e2) {
            console.error('[import.ipc] deleteBatch on createMany failure failed:', e2)
          }
        }

        // 6.1 新题关联题组（赛事题库 T2 桥接）：
        //   - 指定目标题组 groupIds（可多选）→ 新题关联到每个目标题组
        //   - 未指定 → 新题默认进「默认题库」
        // T2 修复：失败不阻断主流程（本次批量导入已成功），但把部分失败
        // 反馈到 warnings / PARTIAL_FAILURE，而非静默仅 console.error。
        if (imported > 0 && createdIds.length > 0) {
          try {
            if (groupIds && groupIds.length > 0) {
              for (const gid of groupIds) {
                topicGroupRepo.addTopicsToGroup(gid, createdIds)
              }
            } else {
              topicGroupRepo.ensureTopicsInDefaultGroup(createdIds)
            }
          } catch (e) {
            console.error('[import.ipc] topic group association failed:', e)
            const reason = e instanceof Error ? e.message : String(e)
            warnings.push(`辩题已成功导入，但关联题组失败：${reason}`)
          }
        }

        // Bug 2.2: 7. 回填批次真实统计（失败不阻断返回，仅记录日志）
        try {
          importBatchRepo.updateBatchStats(batch.id, {
            imported_count: imported,
            duplicates_count: duplicates,
            failed_count: failed
          })
        } catch (e) {
          console.error('[import.ipc] updateBatchStats failed:', e)
        }

        // Bug 2.2: 8. 写入审计日志（失败不阻断返回，仅记录日志）
        try {
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
        } catch (e) {
          console.error('[import.ipc] addLog failed:', e)
        }

        return {
          success: true,
          data: { imported, duplicates, failed, duplicateGroups, batchId: batch.id, warnings },
          // T2：存在部分失败时透出 PARTIAL_FAILURE（成功导入但题组关联未完全成功）。
          // success 保持 true——主流程（数据入库）已成功，不阻断 renderer 展示导入结果。
          ...(warnings.length > 0
            ? {
                appError: {
                  name: 'AppError',
                  code: 'PARTIAL_FAILURE' as const,
                  message: warnings.join('；'),
                  userMessage: warnings.join('；')
                }
              }
            : {})
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
        assertNonEmptyString(batchId, 'batchId')
        const batch = importBatchRepo.getBatchById(batchId)
        if (!batch) {
          return { success: false, error: '批次不存在' }
        }
        // Bug 2.3: 使用事务方法确保 topics 和 batch 记录在同一事务中删除
        const deletedCount = importBatchRepo.revokeBatchTransaction(batchId)
        // Bug 2.2: 审计日志失败不阻断返回
        try {
          auditRepo.addLog({
            action: 'import_revoke',
            target_type: 'topic',
            target_id: batchId,
            operator: 'renderer',
            detail: { deletedCount, fileName: batch.file_name }
          })
        } catch (e) {
          console.error('[import.ipc] addLog failed:', e)
        }
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
        // Bug 5.23: 使用批量查询避免 N+1，一次 GROUP BY 拿到所有批次的剩余题数
        const counts = importBatchRepo.countTopicsByBatches(batches.map((b) => b.id))
        const withCounts: ImportBatch[] = batches.map((b) => ({
          ...b,
          remainingCount: counts[b.id] ?? 0
        }))
        return { success: true, data: withCounts }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 应用字段映射：把未识别列根据用户选择应用到 ParsedResult
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_APPLY_FIELD_MAPPING,
    (_e, parsed: ParsedResult, fieldMapping: FieldMapping): ApiResponse<ParsedResult> => {
      try {
        assertParam(parsed && typeof parsed === 'object', '参数 parsed 必须为对象')
        assertParam(fieldMapping && typeof fieldMapping === 'object', '参数 fieldMapping 必须为对象')
        const result = applyFieldMapping(parsed, fieldMapping)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // ---------- 赛事包导入 ----------
  // 流程：读取 JSON → 冲突检测（同名赛事）→ 按策略处理 → 事务性创建赛事及关联数据
  // 策略：
  //   skip      赛事已存在则跳过（返回 error）
  //   overwrite 先删后建（依赖 events ON DELETE CASCADE 级联删除关联数据）
  //   rename    赛事名加后缀 (导入) / (导入 2) / (导入 3) ... 直到不重名
  //
  // 事务性：使用 db.transaction 包装所有写操作，失败整体回滚。
  // ID 重映射：事件/分组/队伍/轮次/会话均生成新 id，关联外键同步重映射。
  // 外键过滤：team_history.topic_id 与 draw_session_items.topic_id 必须指向现有 topics，
  //          缺失对应 topic 的记录会被静默跳过（避免 FK 违约）。

  // 预览：读取 JSON 并返回摘要（不写库），供 ImportEventModal 展示
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_EVENT_PACKAGE_PREVIEW,
    async (_e, filePath: string): Promise<ApiResponse<ImportEventPackagePreviewResult>> => {
      try {
        assertNonEmptyString(filePath, 'filePath')
        let raw: string
        try {
          // P3-6: 改用 fs.promises.readFile 异步读取，避免阻塞主进程（大文件场景）
          raw = await readFile(filePath, 'utf-8')
        } catch {
          return { success: false, error: '无法读取文件：' + filePath }
        }

        let pkg: EventPackagePayload
        try {
          pkg = JSON.parse(raw)
        } catch {
          return { success: false, error: 'JSON 解析失败，文件格式不正确' }
        }

        if (!pkg.event || typeof pkg.event.name !== 'string') {
          return { success: false, error: '无效的赛事包格式：缺少 event.name' }
        }

        // 冲突检测
        const { items: existingEvents } = eventRepo.listEvents({
          page: 1,
          pageSize: 100000
        })
        const hasConflict = existingEvents.some((e) => e.name === pkg.event.name)

        return {
          success: true,
          data: {
            eventName: pkg.event.name,
            roundCount: pkg.rounds?.length ?? 0,
            teamCount: pkg.teams?.length ?? 0,
            groupCount: pkg.groups?.length ?? 0,
            drawSessionCount: pkg.drawSessions?.length ?? 0,
            teamHistoryCount: pkg.teamHistory?.length ?? 0,
            eventTopicGroupCount: pkg.eventTopicGroupIds?.length ?? 0,
            roundTopicGroupCount: Object.keys(pkg.roundTopicGroupIds ?? {}).length,
            topicGroupCount: pkg.topicGroups?.length ?? 0,
            topicGroupItemCount: pkg.topicGroupItems?.length ?? 0,
            hasConflict,
            exportedAt: pkg.exportedAt
          }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_EVENT_PACKAGE,
    async (
      _e,
      req: ImportEventPackageRequest
    ): Promise<ApiResponse<ImportEventPackageResult>> => {
      try {
        assertParam(req && typeof req === 'object', '参数 req 必须为对象')
        assertNonEmptyString(req.filePath, 'filePath')
        const strategy = req.conflictStrategy ?? 'rename'

        // 1. 读取并解析 JSON 文件
        let raw: string
        try {
          // P3-6: 改用 fs.promises.readFile 异步读取，避免阻塞主进程（大文件场景）
          raw = await readFile(req.filePath, 'utf-8')
        } catch {
          return { success: false, error: '无法读取文件：' + req.filePath }
        }

        let pkg: EventPackagePayload
        try {
          pkg = JSON.parse(raw)
        } catch {
          return { success: false, error: 'JSON 解析失败，文件格式不正确' }
        }

        if (!pkg.event || typeof pkg.event.name !== 'string') {
          return { success: false, error: '无效的赛事包格式：缺少 event.name' }
        }

        const originalName = pkg.event.name
        const rounds = pkg.rounds ?? []
        const teams = pkg.teams ?? []
        const groups = pkg.groups ?? []
        const teamHistory = pkg.teamHistory ?? []
        const drawSessions = pkg.drawSessions ?? []

        // 2. 冲突检测（按赛事名匹配）
        const { items: existingEvents } = eventRepo.listEvents({
          page: 1,
          pageSize: 100000
        })
        const existingNames = new Set(existingEvents.map((e) => e.name))
        const conflictingEvent = existingEvents.find((e) => e.name === originalName)

        let finalName = originalName
        let renamedTo: string | undefined
        let originalNameForResult: string | undefined

        if (conflictingEvent) {
          if (strategy === 'skip') {
            return {
              success: false,
              error: `赛事"${originalName}"已存在，按 skip 策略跳过导入`
            }
          }
          if (strategy === 'overwrite') {
            // 先删后建：deleteEvent 会级联删除 rounds/teams/team_groups/team_history/draw_sessions/draw_session_items
            // Bug P0-2: 删除操作移入下方 db.transaction 内执行，确保后续事务失败时原始赛事数据可回滚
          }
          if (strategy === 'rename') {
            // 加后缀直到不重名：(导入) → (导入 2) → (导入 3) ...
            let n = 1
            let candidate = `${originalName} (导入)`
            while (existingNames.has(candidate)) {
              n++
              candidate = `${originalName} (导入 ${n})`
            }
            finalName = candidate
            renamedTo = candidate
            originalNameForResult = originalName
          }
        }

        // 3. 事务性导入（失败整体回滚）
        const db = getDb()
        const doImport = db.transaction((): ImportEventPackageResult => {
          // Bug P0-2: overwrite 策略下在事务内删除冲突赛事，
          // 确保后续创建失败时原始赛事数据随事务回滚，避免数据丢失。
          // deleteEvent 会级联删除 rounds/teams/team_groups/team_history/draw_sessions/draw_session_items
          if (conflictingEvent && strategy === 'overwrite') {
            eventRepo.deleteEvent(conflictingEvent.id)
          }
          // 3.1 预拉所有 topic id（用于 team_history / draw_session_items FK 校验）
          const allTopicIds = new Set<string>(
            (
              db.prepare('SELECT id FROM topics').all() as Array<{ id: string }>
            ).map((r) => r.id)
          )

          // 3.2 创建赛事
          const newEvent = createEventWithDefaultGroup({
            name: finalName,
            start_date: pkg.event.start_date ?? null,
            end_date: pkg.event.end_date ?? null,
            status: pkg.event.status ?? null
          })

          // 3.3 创建分组（先于队伍，teams.group_id 引用 team_groups）
          const groupIdMap = new Map<string, string>()
          for (const g of groups) {
            const newGroup = eventRepo.createGroup({
              event_id: newEvent.id,
              name: g.name,
              sort_order: g.sort_order ?? 0
            })
            groupIdMap.set(g.id, newGroup.id)
          }

          // 3.4 创建队伍（并重映射 group_id）
          const teamIdMap = new Map<string, string>()
          for (const t of teams) {
            const newTeam = eventRepo.createTeam({
              name: t.name,
              event_id: newEvent.id
            })
            teamIdMap.set(t.id, newTeam.id)
            // 分配分组（若原 group_id 在包内）
            if (t.group_id && groupIdMap.has(t.group_id)) {
              eventRepo.assignTeamToGroup(newTeam.id, groupIdMap.get(t.group_id)!)
            }
          }

          // 3.5 创建轮次
          const roundIdMap = new Map<string, string>()
          for (const r of rounds) {
            const newRound = eventRepo.createRound({
              event_id: newEvent.id,
              name: r.name ?? null,
              round_number: r.round_number ?? null,
              difficulty_override: r.difficulty_override ?? null,
              topic_count: r.topic_count ?? null
            })
            roundIdMap.set(r.id, newRound.id)
          }

          // 3.6 创建抽取会话（先于 team_history，因 team_history.session_id 关联会话）
          // session_id 在 team_history 表中无 FK 约束，但语义上需保持映射
          const sessionIdMap = new Map<string, string>()
          for (const s of drawSessions) {
            const items = s.items ?? []
            // 过滤掉 topic_id 不存在的 item（避免 FK 违约）
            const validItems = items.filter((it) => allTopicIds.has(it.topic_id))
            if (validItems.length === 0) continue

            const newSession = drawRepo.createSession({
              event_id: newEvent.id,
              round_id: s.round_id ? (roundIdMap.get(s.round_id) ?? null) : null,
              draw_time: s.draw_time ?? undefined,
              operator: s.operator ?? undefined,
              settings: s.settings ?? undefined,
              items: validItems.map((it) => ({
                topic_id: it.topic_id,
                team_a_id: it.team_a_id ? (teamIdMap.get(it.team_a_id) ?? null) : null,
                team_b_id: it.team_b_id ? (teamIdMap.get(it.team_b_id) ?? null) : null,
                stance_a: it.stance_a ?? null,
                stance_b: it.stance_b ?? null,
                topic_title: it.topic_title ?? null,
                team_a_name: it.team_a_name ?? null,
                team_b_name: it.team_b_name ?? null,
                team_ids: it.team_ids ?? null,
                group_id: it.group_id ? (groupIdMap.get(it.group_id) ?? null) : null
              }))
            })
            sessionIdMap.set(s.id, newSession.id)
          }

          // 3.7 创建队伍历史（过滤 team/topic 不存在的记录）
          for (const h of teamHistory) {
            if (!allTopicIds.has(h.topic_id)) continue
            const newTeamId = teamIdMap.get(h.team_id)
            if (!newTeamId) continue
            eventRepo.addTeamHistory({
              team_id: newTeamId,
              topic_id: h.topic_id,
              event_id: newEvent.id,
              played_at: h.played_at ?? null,
              session_id: h.session_id ? (sessionIdMap.get(h.session_id) ?? null) : null,
              stance: h.stance ?? null
            })
          }

          // 3.8 恢复赛事题库（T7）：
          //   - 按包内定义（topicGroups）按原 id 幂等创建「被引用但缺失」的题库（topic_groups），
          //     已存在则不覆盖（ensureGroupById）；无定义引用的题库跳过（无法恢复）。
          //   - 恢复赛事→题库绑定（event_topic_groups，INSERT OR IGNORE 去重，不与既有绑定冲突）。
          //   - 恢复轮次→题库绑定（round_topic_groups，group_id 重映射到包内新轮次）。
          //   - 恢复题库成员（topic_group_items，仅 topic 已存在于库内时关联，避免 FK 违约）。
          const eventTopicGroupIds = pkg.eventTopicGroupIds ?? []
          const roundTopicGroupIds = pkg.roundTopicGroupIds ?? {}
          const topicGroups = pkg.topicGroups ?? []
          const topicGroupItems = pkg.topicGroupItems ?? []
          const referencedGroupIds = new Set<string>([
            ...eventTopicGroupIds,
            ...Object.values(roundTopicGroupIds).flat()
          ])
          if (referencedGroupIds.size > 0) {
            const defMap = new Map(topicGroups.map((g) => [g.id, g]))
            const restorableGroupIds = new Set<string>()
            for (const gid of referencedGroupIds) {
              const def = defMap.get(gid)
              if (!def) continue
              topicGroupRepo.ensureGroupById(gid, def.name, !!def.is_default, def.created_at ?? null)
              restorableGroupIds.add(gid)
            }
            // 赛事绑定（createEvent 已自动绑定默认题库，这里幂等补全包内其余绑定）
            if (eventTopicGroupIds.length > 0) {
              topicGroupRepo.bindEventGroups(
                newEvent.id,
                eventTopicGroupIds.filter((g) => restorableGroupIds.has(g))
              )
            }
            // 轮次绑定（映射到包内新轮次 id）
            for (const [srcRoundId, groupIds] of Object.entries(roundTopicGroupIds)) {
              const newRoundId = roundIdMap.get(srcRoundId)
              if (!newRoundId) continue
              topicGroupRepo.bindRoundGroups(
                newRoundId,
                groupIds.filter((g) => restorableGroupIds.has(g))
              )
            }
            // 题库成员（仅 topic 已存在于库内；按题库分组后批量幂等插入）
            if (topicGroupItems.length > 0) {
              const pendingByGroup = new Map<string, string[]>()
              for (const it of topicGroupItems) {
                if (!restorableGroupIds.has(it.group_id)) continue
                if (!allTopicIds.has(it.topic_id)) continue
                const arr = pendingByGroup.get(it.group_id) ?? []
                arr.push(it.topic_id)
                pendingByGroup.set(it.group_id, arr)
              }
              for (const [gid, topicIds] of pendingByGroup) {
                topicGroupRepo.addTopicsToGroup(gid, topicIds)
              }
            }
          }

          return {
            eventId: newEvent.id,
            roundCount: rounds.length,
            teamCount: teams.length,
            groupCount: groups.length,
            strategy,
            originalName: originalNameForResult,
            renamedTo
          }
        })

        const result = doImport()
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}

// ============================================================
// 赛事包 JSON 结构类型（仅本文件内部使用，不导出）
// ============================================================

interface EventPackagePayload {
  event: {
    id: string
    name: string
    start_date?: string | null
    end_date?: string | null
    status?: string | null
  }
  rounds?: Array<{
    id: string
    event_id: string
    name?: string | null
    round_number?: number | null
    difficulty_override?: string | null
    topic_count?: number | null
  }>
  teams?: Array<{
    id: string
    name: string
    event_id: string
    group_id?: string | null
  }>
  groups?: Array<{
    id: string
    event_id: string
    name: string
    sort_order?: number
    created_at?: string
  }>
  teamHistory?: Array<{
    id: string
    team_id: string
    topic_id: string
    event_id: string
    played_at?: string | null
    session_id?: string | null
    stance?: string | null
  }>
  drawSessions?: Array<{
    id: string
    event_id: string
    round_id?: string | null
    draw_time?: string | null
    operator?: string | null
    settings?: Record<string, unknown> | null
    items?: Array<{
      id?: string
      session_id?: string
      topic_id: string
      team_a_id?: string | null
      team_b_id?: string | null
      stance_a?: string | null
      stance_b?: string | null
      topic_title?: string | null
      team_a_name?: string | null
      team_b_name?: string | null
      team_ids?: string[] | null
      group_id?: string | null
    }>
  }>
  // T7：赛事题库随包
  eventTopicGroupIds?: string[]
  roundTopicGroupIds?: Record<string, string[]>
  topicGroups?: Array<{
    id: string
    name: string
    is_default?: number
    created_at?: string | null
  }>
  topicGroupItems?: Array<{
    group_id: string
    topic_id: string
  }>
  exportedAt?: string
}
