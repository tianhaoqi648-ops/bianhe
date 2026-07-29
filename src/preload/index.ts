// ============================================================
// preload/index.ts — 通过 contextBridge 暴露安全 API 到渲染进程
//
// 暴露 6 个 API 对象：topicAPI / eventAPI / drawAPI / auditAPI / settingsAPI / importAPI
// 每个方法内部调用 ipcRenderer.invoke(channel, ...args) 返回 Promise。
// 渲染进程通过 window.topicAPI.list() 等方式调用。
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC_CHANNELS,
  type TopicFilter,
  type TopicCreateInput,
  type TopicUpdateInput,
  type EventFilter,
  type EventCreateInput,
  type EventUpdateInput,
  type RoundCreateInput,
  type RoundUpdateInput,
  type TeamCreateInput,
  type TeamUpdateInput,
  type TeamHistoryCreateInput,
  type TeamGroup,
  type TeamGroupCreateInput,
  type TeamGroupUpdateInput,
  type RandomAssignGroupParams,
  type RandomAssignGroupResult,
  type DrawParams,
  type SessionFilter,
  type AuditLogFilter,
  type AuditLogCreateInput,
  type ImportExecuteRequest,
  type ImportBatch,
  type ExportTopicsRequest,
  type ExportDrawSessionsRequest,
  type ExportEventPackageRequest,
  type ImportEventPackageRequest,
  type ImportEventPackageResult,
  type ImportEventPackagePreviewResult,
  type ExportLogsRequest,
  type DedupOptions,
  type DuplicateGroup,
  type Topic,
  type ResetDataRequest,
  type ResetDataResponse,
  type CustomField,
  type CustomFieldType,
  type BatchEditExecuteRequest,
  type BatchEditExecuteResult,
  type BatchEditRevertResult,
  type BatchEditHistory,
  type UndoRequest,
  type UndoResult,
  type RedoRequest,
  type RedoResult,
  type UndoLogEntry,
  type ApiResponse,
  type DebateFormat,
  type DebateFormatData,
  type TimerSession,
  type TimerRecord,
  type BackgroundFile,
  type DbMode,
  type ErrorLogInput,
  type BackupInfo,
  type BackupParams,
  type BackupImportParams,
  type BackupExportResult,
  type BackupPreviewResult,
  type BackupImportResult,
  type Event,
  type Round,
  type Team,
  type TeamHistory,
  type DrawResult,
  type DrawSessionDetail,
  type DrawSessionItem,
  type AuditLog,
  type ParsedResult,
  type ImportExecuteResult,
  type ExportResult,
  type ExportLogsResult,
  type DedupRunResult
} from '../shared/types'
import type { BellAsset, StageSide, TimerTheme } from '../shared/debate-formats/types'

/**
 * 通用 invoke 封装：自动展开参数。
 * 使用 unknown[] 而非 any[]，迫使调用方在必要时显式断言类型。
 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args)
}

// ============================================================
// 题库 API
// ============================================================
const topicAPI = {
  list: (filter?: TopicFilter) =>
    invoke<ApiResponse<{ items: Topic[]; total: number }>>(IPC_CHANNELS.TOPIC_LIST, filter),
  get: (id: string) => invoke<ApiResponse<Topic | undefined>>(IPC_CHANNELS.TOPIC_GET, id),
  create: (data: TopicCreateInput) => invoke<ApiResponse<Topic>>(IPC_CHANNELS.TOPIC_CREATE, data),
  update: (id: string, data: TopicUpdateInput) =>
    invoke<ApiResponse<Topic | null>>(IPC_CHANNELS.TOPIC_UPDATE, id, data),
  delete: (id: string) => invoke<ApiResponse<void>>(IPC_CHANNELS.TOPIC_DELETE, id),
  batchDelete: (ids: string[]) => invoke<ApiResponse<void>>(IPC_CHANNELS.TOPIC_BATCH_DELETE, ids),
  updateStatus: (id: string, status: string) =>
    invoke<ApiResponse<Topic | null>>(IPC_CHANNELS.TOPIC_UPDATE_STATUS, id, status),
  updateWeight: (id: string, weight: number) =>
    invoke<ApiResponse<Topic | null>>(IPC_CHANNELS.TOPIC_UPDATE_WEIGHT, id, weight),
  count: (filter?: TopicFilter) => invoke<ApiResponse<number>>(IPC_CHANNELS.TOPIC_COUNT, filter),
  countByDimension: (
    dimension: string
  ) => invoke<Array<{ value: string; count: number }>>(IPC_CHANNELS.TOPIC_COUNT_BY_DIMENSION, dimension),
  listAllTags: () =>
    invoke<Array<{ value: string; count: number }>>(IPC_CHANNELS.TOPIC_LIST_ALL_TAGS),
  /** 批量拉取系统字段的 distinct 值（用于 FilterPanel 候选值合并） */
  listValues: (fields: string[]) =>
    invoke<Record<string, Array<{ value: string; count: number }>>>(
      IPC_CHANNELS.TOPIC_LIST_VALUES,
      fields
    ),
  /** 聚合某个 tags 类型自定义字段的全部 tag 值与出现次数 */
  listCustomFieldTags: (fieldKey: string) =>
    invoke<Array<{ value: string; count: number }>>(
      IPC_CHANNELS.TOPIC_LIST_CUSTOM_FIELD_TAGS,
      fieldKey
    )
}

// ============================================================
// 赛事 API（含轮次、队伍、队伍历史）
// ============================================================
const eventAPI = {
  // event
  listEvents: (filter?: EventFilter) =>
    invoke<ApiResponse<{ items: Event[]; total: number }>>(IPC_CHANNELS.EVENT_LIST, filter),
  getEvent: (id: string) => invoke<ApiResponse<Event | undefined>>(IPC_CHANNELS.EVENT_GET, id),
  createEvent: (data: EventCreateInput) => invoke<ApiResponse<Event>>(IPC_CHANNELS.EVENT_CREATE, data),
  updateEvent: (id: string, data: EventUpdateInput) =>
    invoke<ApiResponse<Event | null>>(IPC_CHANNELS.EVENT_UPDATE, id, data),
  deleteEvent: (id: string) => invoke<ApiResponse<void>>(IPC_CHANNELS.EVENT_DELETE, id),
  // round
  listRoundsByEvent: (eventId: string) => invoke<ApiResponse<Round[]>>(IPC_CHANNELS.ROUND_LIST_BY_EVENT, eventId),
  getRound: (id: string) => invoke<ApiResponse<Round | undefined>>(IPC_CHANNELS.ROUND_GET, id),
  createRound: (data: RoundCreateInput) => invoke<ApiResponse<Round>>(IPC_CHANNELS.ROUND_CREATE, data),
  updateRound: (id: string, data: RoundUpdateInput) =>
    invoke<ApiResponse<Round | null>>(IPC_CHANNELS.ROUND_UPDATE, id, data),
  deleteRound: (id: string) => invoke<ApiResponse<void>>(IPC_CHANNELS.ROUND_DELETE, id),
  // team
  listTeamsByEvent: (eventId: string) => invoke<ApiResponse<Team[]>>(IPC_CHANNELS.TEAM_LIST_BY_EVENT, eventId),
  getTeam: (id: string) => invoke<ApiResponse<Team | undefined>>(IPC_CHANNELS.TEAM_GET, id),
  createTeam: (data: TeamCreateInput) => invoke<ApiResponse<Team>>(IPC_CHANNELS.TEAM_CREATE, data),
  updateTeam: (id: string, data: TeamUpdateInput) =>
    invoke<ApiResponse<Team | null>>(IPC_CHANNELS.TEAM_UPDATE, id, data),
  deleteTeam: (id: string) => invoke<ApiResponse<void>>(IPC_CHANNELS.TEAM_DELETE, id),
  // team history
  listTeamHistory: (teamId: string) => invoke<ApiResponse<TeamHistory[]>>(IPC_CHANNELS.TEAM_HISTORY_LIST, teamId),
  listTeamHistoryByEvent: (eventId: string) =>
    invoke<ApiResponse<TeamHistory[]>>(IPC_CHANNELS.TEAM_HISTORY_LIST_BY_EVENT, eventId),
  addTeamHistory: (data: TeamHistoryCreateInput) =>
    invoke<ApiResponse<TeamHistory>>(IPC_CHANNELS.TEAM_HISTORY_ADD, data),
  deleteTeamHistory: (id: string) => invoke<ApiResponse<boolean>>(IPC_CHANNELS.TEAM_HISTORY_DELETE, id),
  // team group（赛事分组）
  listGroups: (eventId: string) =>
    invoke<ApiResponse<TeamGroup[]>>(IPC_CHANNELS.TEAM_GROUP_LIST, eventId),
  createGroup: (data: TeamGroupCreateInput) =>
    invoke<ApiResponse<TeamGroup>>(IPC_CHANNELS.TEAM_GROUP_CREATE, data),
  updateGroup: (id: string, patch: TeamGroupUpdateInput) =>
    invoke<ApiResponse<TeamGroup>>(IPC_CHANNELS.TEAM_GROUP_UPDATE, id, patch),
  deleteGroup: (id: string) => invoke<ApiResponse<void>>(IPC_CHANNELS.TEAM_GROUP_DELETE, id),
  /** 将队伍分配到分组（groupId=null 表示移出分组） */
  assignTeamToGroup: (teamId: string, groupId: string | null) =>
    invoke<ApiResponse<boolean>>(IPC_CHANNELS.TEAM_ASSIGN_GROUP, teamId, groupId),
  /** 随机分组：将赛事下的队伍随机分配到多个分组 */
  randomAssignGroups: (params: RandomAssignGroupParams) =>
    invoke<ApiResponse<RandomAssignGroupResult>>(
      IPC_CHANNELS.TEAM_RANDOM_ASSIGN_GROUP,
      params
    ),
  /** 导入赛事包（Task 4 实现 IPC handler，当前为占位） */
  importEventPackage: (req: ImportEventPackageRequest) =>
    invoke<ApiResponse<ImportEventPackageResult>>(IPC_CHANNELS.IMPORT_EVENT_PACKAGE, req),
  /** 预览赛事包（解析 JSON 返回摘要，不写库） */
  previewEventPackage: (filePath: string) =>
    invoke<ApiResponse<ImportEventPackagePreviewResult>>(
      IPC_CHANNELS.IMPORT_EVENT_PACKAGE_PREVIEW,
      filePath
    )
}

// ============================================================
// 抽取 API
// ============================================================
const drawAPI = {
  execute: (params: DrawParams) => invoke<ApiResponse<DrawResult>>(IPC_CHANNELS.DRAW_EXECUTE, params),
  listSessions: (filter?: SessionFilter) =>
    invoke<ApiResponse<{ items: DrawSessionDetail[]; total: number }>>(IPC_CHANNELS.DRAW_LIST_SESSIONS, filter),
  getSession: (id: string) =>
    invoke<ApiResponse<DrawSessionDetail | undefined>>(IPC_CHANNELS.DRAW_GET_SESSION, id),
  deleteSession: (id: string) => invoke<ApiResponse<boolean>>(IPC_CHANNELS.DRAW_DELETE_SESSION, id),
  listDrawnTopicIds: (eventId: string) =>
    invoke<ApiResponse<string[]>>(IPC_CHANNELS.DRAW_LIST_DRAWN_TOPIC_IDS, eventId),
  redo: (oldSessionId: string, params: DrawParams) =>
    invoke<ApiResponse<DrawResult>>(IPC_CHANNELS.DRAW_REDO, oldSessionId, params),
  /** 确认抽取结果：写入队伍历史 + 标记 session 已确认 */
  confirmDrawSession: (sessionId: string) =>
    invoke<ApiResponse<DrawSessionDetail | undefined>>(IPC_CHANNELS.DRAW_CONFIRM_SESSION, sessionId),
  /** Task 6.7：按 topic_id 查询最近一条多队模式抽取明细（大屏多队渲染用） */
  getItemByTopicId: (topicId: string) =>
    invoke<ApiResponse<DrawSessionItem | undefined>>(IPC_CHANNELS.DRAW_GET_ITEM_BY_TOPIC, topicId)
}

// ============================================================
// 审计 API
// ============================================================
const auditAPI = {
  listLogs: (filter?: AuditLogFilter) =>
    invoke<ApiResponse<{ items: AuditLog[]; total: number }>>(IPC_CHANNELS.AUDIT_LIST_LOGS, filter),
  addLog: (input: AuditLogCreateInput) => invoke<ApiResponse<AuditLog>>(IPC_CHANNELS.AUDIT_ADD_LOG, input),
  deleteLog: (id: string) => invoke<ApiResponse<boolean>>(IPC_CHANNELS.AUDIT_DELETE_LOG, id),
  clearLogs: (beforeDate?: string) => invoke<ApiResponse<number>>(IPC_CHANNELS.AUDIT_CLEAR_LOGS, beforeDate),
  exportLogs: (req: ExportLogsRequest) =>
    invoke<ApiResponse<ExportLogsResult>>(IPC_CHANNELS.AUDIT_EXPORT_LOGS, req)
}

// ============================================================
// 系统设置 API
// 注：settings 的 value 可为任意可序列化结构，使用 unknown 替代 any
// ============================================================
const settingsAPI = {
  get: (key: string) => invoke<ApiResponse<unknown>>(IPC_CHANNELS.SETTINGS_GET, key),
  set: (key: string, value: unknown) =>
    invoke<ApiResponse<{ key: string; value: unknown }>>(IPC_CHANNELS.SETTINGS_SET, key, value),
  getAll: () => invoke<ApiResponse<Record<string, unknown>>>(IPC_CHANNELS.SETTINGS_GET_ALL),
  delete: (key: string) => invoke<ApiResponse<{ key: string }>>(IPC_CHANNELS.SETTINGS_DELETE, key),
  deleteBatch: (keys: string[]) => invoke<ApiResponse<number>>(IPC_CHANNELS.SETTINGS_DELETE_BATCH, keys),
  getCandidates: () =>
    invoke<ApiResponse<Record<string, string[]>>>(IPC_CHANNELS.SYSTEM_GET_CANDIDATES)
}

// ============================================================
// 导入 API
// ============================================================
const importAPI = {
  parseFile: (filePath: string, fileType: 'xlsx' | 'csv' | 'docx') =>
    invoke<ApiResponse<ParsedResult>>(IPC_CHANNELS.IMPORT_PARSE_FILE, filePath, fileType),
  execute: (req: ImportExecuteRequest) =>
    invoke<ApiResponse<ImportExecuteResult>>(IPC_CHANNELS.IMPORT_EXECUTE, req),
  findDuplicates: (topics: Topic[], options?: DedupOptions) =>
    invoke<ApiResponse<DuplicateGroup[]>>(IPC_CHANNELS.IMPORT_FIND_DUPLICATES, topics, options),
  revokeBatch: (batchId: string) =>
    invoke<ApiResponse<{ deletedCount: number }>>(IPC_CHANNELS.IMPORT_REVOKE_BATCH, batchId),
  listBatches: () => invoke<ApiResponse<ImportBatch[]>>(IPC_CHANNELS.IMPORT_LIST_BATCHES),
  applyFieldMapping: (
    parsed: import('../shared/types').ParsedResult,
    fieldMapping: import('../shared/types').FieldMapping
  ) =>
    invoke<ApiResponse<import('../shared/types').ParsedResult>>(
      IPC_CHANNELS.IMPORT_APPLY_FIELD_MAPPING,
      parsed,
      fieldMapping
    )
}

// ============================================================
// 导出 API
// ============================================================
const exportAPI = {
  exportTopics: (req: ExportTopicsRequest) =>
    invoke<ApiResponse<ExportResult>>(IPC_CHANNELS.EXPORT_TOPICS, req),
  exportDrawSessions: (req: ExportDrawSessionsRequest) =>
    invoke<ApiResponse<ExportResult>>(IPC_CHANNELS.EXPORT_DRAW_SESSIONS, req),
  exportEventPackage: (req: ExportEventPackageRequest) =>
    invoke<ApiResponse<ExportResult>>(IPC_CHANNELS.EXPORT_EVENT_PACKAGE, req)
}

// ============================================================
// 去重检查 API
// ============================================================
const dedupAPI = {
  run: (options?: DedupOptions) => invoke<ApiResponse<DedupRunResult>>(IPC_CHANNELS.DEDUP_RUN, options),
  deleteTopics: (ids: string[]) =>
    invoke<ApiResponse<{ deleted: number }>>(IPC_CHANNELS.DEDUP_DELETE_TOPICS, ids)
}

// ============================================================
// 通用文件选择 API
// ============================================================
const fileAPI = {
  /** 调用主进程 dialog.showOpenDialog 选择单个文件，返回文件路径或 null */
  pickFile: (
    filters?: Array<{ name: string; extensions: string[] }>
  ) => invoke<ApiResponse<string | null>>(IPC_CHANNELS.SYSTEM_PICK_FILE, filters)
}

// ============================================================
// 系统级 API（数据重置等）
// ============================================================
const systemAPI = {
  /**
   * 统一数据重置入口。
   * 配置类：删除 settings keys；数据类：清空对应业务表。
   * 返回各表删除行数。
   */
  resetData: (req: ResetDataRequest) =>
    invoke<ApiResponse<ResetDataResponse>>(IPC_CHANNELS.SYSTEM_RESET_DATA, req)
}

// ============================================================
// 自定义字段 API
// ============================================================
const customFieldAPI = {
  list: () => invoke<ApiResponse<CustomField[]>>(IPC_CHANNELS.CUSTOM_FIELD_LIST),
  create: (label: string, type: CustomFieldType) =>
    invoke<ApiResponse<CustomField>>(IPC_CHANNELS.CUSTOM_FIELD_CREATE, label, type),
  update: (
    fieldKey: string,
    patch: Partial<Pick<CustomField, 'field_label' | 'sort_order'>>
  ) => invoke<ApiResponse<CustomField | null>>(IPC_CHANNELS.CUSTOM_FIELD_UPDATE, fieldKey, patch),
  delete: (fieldKey: string) => invoke<ApiResponse<void>>(IPC_CHANNELS.CUSTOM_FIELD_DELETE, fieldKey)
}

// ============================================================
// 批量编辑 API
// ============================================================
const batchEditAPI = {
  execute: (req: BatchEditExecuteRequest) =>
    invoke<ApiResponse<BatchEditExecuteResult>>(IPC_CHANNELS.BATCH_EDIT_EXECUTE, req),
  revert: (historyId: string) =>
    invoke<ApiResponse<BatchEditRevertResult>>(IPC_CHANNELS.BATCH_EDIT_REVERT, historyId),
  listHistory: () =>
    invoke<ApiResponse<BatchEditHistory[]>>(IPC_CHANNELS.BATCH_EDIT_LIST_HISTORY)
}

// ============================================================
// 撤销/重做 API
// ============================================================
const undoAPI = {
  undo: (req?: UndoRequest) => invoke<ApiResponse<UndoResult>>(IPC_CHANNELS.SYSTEM_UNDO, req),
  redo: (req?: RedoRequest) => invoke<ApiResponse<RedoResult>>(IPC_CHANNELS.SYSTEM_REDO, req),
  listUndoLog: (limit?: number) =>
    invoke<ApiResponse<UndoLogEntry[]>>(IPC_CHANNELS.SYSTEM_LIST_UNDO_LOG, limit),
  clearUndoLog: () => invoke<ApiResponse<number>>(IPC_CHANNELS.SYSTEM_CLEAR_UNDO_LOG)
}

// ============================================================
// 辩论赛制 API
// ============================================================
const formatAPI = {
  list: () => invoke<ApiResponse<DebateFormat[]>>(IPC_CHANNELS.FORMAT_LIST),
  get: (id: string) => invoke<ApiResponse<DebateFormat | null>>(IPC_CHANNELS.FORMAT_GET, id),
  create: (opts: { name: string; description?: string; formatData: DebateFormatData }) =>
    invoke<ApiResponse<DebateFormat>>(IPC_CHANNELS.FORMAT_CREATE, opts),
  update: (id: string, opts: { name?: string; description?: string; formatData?: DebateFormatData }) =>
    invoke<ApiResponse<DebateFormat | null>>(IPC_CHANNELS.FORMAT_UPDATE, id, opts),
  delete: (id: string) => invoke<ApiResponse<boolean>>(IPC_CHANNELS.FORMAT_DELETE, id),
  seedPresets: () => invoke<ApiResponse<number>>(IPC_CHANNELS.FORMAT_SEED_PRESETS),
  /** 导入赛制（从 JSON 重建） */
  importFormat: (data: { name: string; description?: string; formatData: DebateFormatData }) =>
    invoke<ApiResponse<DebateFormat>>(IPC_CHANNELS.FORMAT_IMPORT, data),
  /** 导出赛制为可序列化 JSON */
  exportFormat: (id: string) =>
    invoke<ApiResponse<{ name: string; description: string; formatData: DebateFormatData } | null>>(
      IPC_CHANNELS.FORMAT_EXPORT,
      id
    )
}

// ============================================================
// 计时器 API
// ============================================================
const timerAPI = {
  createSession: (opts: {
    formatId: string
    formatSnapshot: DebateFormatData
    label?: string
    eventId?: string
    roundId?: string
    teamAffId?: string
    teamNegId?: string
    topicId?: string
    eventName?: string
    teamAffName?: string
    teamNegName?: string
    topicTitle?: string
  }) => invoke<ApiResponse<TimerSession>>(IPC_CHANNELS.TIMER_CREATE_SESSION, opts),
  getSession: (id: string) => invoke<ApiResponse<TimerSession | null>>(IPC_CHANNELS.TIMER_GET_SESSION, id),
  listSessions: (limit?: number) => invoke<ApiResponse<TimerSession[]>>(IPC_CHANNELS.TIMER_LIST_SESSIONS, limit),
  updateSession: (id: string, opts: Partial<Pick<TimerSession, 'status' | 'startedAt' | 'endedAt' | 'currentStageIndex' | 'currentSide' | 'remainingMs' | 'stageRemainingCache' | 'affRemainingMs' | 'negRemainingMs'>>) =>
    invoke<ApiResponse<TimerSession | null>>(IPC_CHANNELS.TIMER_UPDATE_SESSION, id, opts),
  deleteSession: (id: string) => invoke<ApiResponse<boolean>>(IPC_CHANNELS.TIMER_DELETE_SESSION, id),
  listRecords: (sessionId: string) => invoke<ApiResponse<TimerRecord[]>>(IPC_CHANNELS.TIMER_LIST_RECORDS, sessionId),
  /** 结束会话：状态置为 finished + 写 endedAt */
  finishSession: (id: string, endedAt: string) =>
    invoke<ApiResponse<TimerSession | null>>(IPC_CHANNELS.TIMER_FINISH_SESSION, id, endedAt),
  /** 新增计时记录（环节开始时调用） */
  addRecord: (opts: {
    sessionId: string
    stageIndex: number
    stageName: string
    side: StageSide
    durationMs: number
    startedAt: string
  }) => invoke<ApiResponse<TimerRecord>>(IPC_CHANNELS.TIMER_ADD_RECORD, opts),
  /** 完成计时记录（环节结束时调用，写 actualMs/endedAt/pauseCount） */
  finishRecord: (
    sessionId: string,
    stageIndex: number,
    actualMs: number,
    endedAt: string,
    pauseCount: number
  ) => invoke<ApiResponse<void>>(IPC_CHANNELS.TIMER_FINISH_RECORD, sessionId, stageIndex, actualMs, endedAt, pauseCount),
  /** 导出会话的所有计时记录 */
  exportRecords: (sessionId: string) =>
    invoke<ApiResponse<TimerRecord[]>>(IPC_CHANNELS.TIMER_EXPORT_RECORDS, sessionId),
  /** 获取计时器主题配置 */
  getTheme: () => invoke<ApiResponse<TimerTheme>>(IPC_CHANNELS.TIMER_THEME_GET),
  /** 更新计时器主题配置（部分字段） */
  setTheme: (theme: Partial<TimerTheme>) =>
    invoke<ApiResponse<TimerTheme>>(IPC_CHANNELS.TIMER_THEME_SET, theme)
}

// ============================================================
// 自定义铃声 API
// P4-22: 统一 bellAPI 各方法泛型为 ApiResponse<...>，与 index.d.ts 类型声明对齐
// ============================================================
const bellAPI = {
  /** 列出所有自定义铃声 */
  list: () => invoke<ApiResponse<BellAsset[]>>(IPC_CHANNELS.BELL_ASSET_LIST),
  /** 上传铃声：renderer 读取文件为 base64 后传入 */
  upload: (opts: { name: string; fileName: string; base64: string; mimeType: string }) =>
    invoke<ApiResponse<BellAsset>>(IPC_CHANNELS.BELL_ASSET_UPLOAD, opts),
  /** 删除铃声（同时删除文件） */
  delete: (id: string) => invoke<ApiResponse<boolean>>(IPC_CHANNELS.BELL_ASSET_DELETE, id),
  /** 获取铃声 data URL（用于 <audio> 播放） */
  getDataUrl: (id: string) =>
    invoke<ApiResponse<string | null>>(IPC_CHANNELS.BELL_ASSET_GET_DATA_URL, id),
  /** 试听铃声：返回文件绝对路径，由渲染进程 HTML5 Audio 播放 */
  playBell: (bellId: string) =>
    invoke<ApiResponse<{ filePath: string }>>(IPC_CHANNELS.BELL_PLAY, bellId),
  /** 停止试听：通知主进程（实际停止由渲染进程完成） */
  stopBell: () => invoke<ApiResponse<boolean>>(IPC_CHANNELS.BELL_STOP)
}

// ============================================================
// 计时器背景图片 API
// ============================================================
const backgroundAPI = {
  /** 上传背景图片：renderer 读取文件为 base64 后传入 */
  upload: (fileName: string, base64: string) =>
    invoke<ApiResponse<{ id: string; fileName: string; fileUrl: string }>>(
      IPC_CHANNELS.BACKGROUND_UPLOAD,
      { fileName, base64 }
    ),
  /** 列出所有自定义背景图片 */
  list: () => invoke<ApiResponse<BackgroundFile[]>>(IPC_CHANNELS.BACKGROUND_LIST),
  /** 按 id 删除背景图片 */
  delete: (id: string) => invoke<ApiResponse<void>>(IPC_CHANNELS.BACKGROUND_DELETE, id)
}

// ============================================================
// P3.4 稳定性扩展：db:status / logs / backup
//
// 这些 API 通过 contextBridge.exposeInMainWorld('electron', extendedElectronAPI)
// 与 @electron-toolkit/preload 的 electronAPI 合并暴露，渲染进程通过
// window.electron.dbStatus / window.electron.logs / window.electron.backup 访问。
// ============================================================

const dbStatusAPI = {
  /** 订阅 db 模式变化（persistent / memory），返回取消订阅函数 */
  onChange(cb: (mode: DbMode) => void): () => void {
    const listener = (_: unknown, mode: DbMode): void => cb(mode)
    ipcRenderer.on(IPC_CHANNELS.DB_STATUS, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DB_STATUS, listener)
    }
  },
  /** 查询当前 db 模式（通过 invoke，初始 mount 时拉取一次） */
  getMode(): Promise<DbMode> {
    return ipcRenderer.invoke(IPC_CHANNELS.DB_GET_MODE)
  }
}

const logsAPI = {
  /** 写入错误日志到主进程文件（自动轮转） */
  writeError(error: ErrorLogInput): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.DB_LOGS_WRITE, error)
  }
}

const backupAPI = {
  /** 立即执行一次备份 */
  run(): Promise<ApiResponse<{ ok: true }>> {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_RUN)
  },
  /** 列出所有备份（按时间倒序） */
  list(): Promise<ApiResponse<BackupInfo[]>> {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_LIST)
  },
  /** 恢复指定备份（覆盖当前 db 文件，需重启应用生效） */
  restore(filename: string): Promise<ApiResponse<{ ok: true }>> {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_RESTORE, filename)
  },
  /** 删除指定备份 */
  delete(filename: string): Promise<ApiResponse<{ ok: true }>> {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_DELETE, filename)
  },
  /** 全量导出：选择保存位置 + 写入 JSON 备份文件 */
  export(params: BackupParams): Promise<ApiResponse<BackupExportResult>> {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_EXPORT, params)
  },
  /** 预览导入文件 */
  previewImport(filePath: string): Promise<ApiResponse<BackupPreviewResult>> {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_PREVIEW_IMPORT, filePath)
  },
  /** 执行全量导入 */
  import(params: BackupImportParams): Promise<ApiResponse<BackupImportResult>> {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_IMPORT, params)
  },
  /** 获取各类别本地数据条数统计（用于备份弹窗展示） */
  stats(): Promise<ApiResponse<Record<string, number>>> {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_STATS)
  }
}

/**
 * 合并 @electron-toolkit/preload 的 electronAPI 与本文件扩展的稳定性 API。
 *
 * 用 Object.assign 创建新对象，避免污染库导出；
 * 通过 declaration merging（见 shared/types.ts）扩展 ElectronAPI 接口类型。
 *
 * 类型显式标注为 ElectronAPI（已通过 declaration merging 包含 dbStatus/logs/backup），
 * 避免类型推断丢失。
 */
const extendedElectronAPI: typeof electronAPI = Object.assign({}, electronAPI, {
  dbStatus: dbStatusAPI,
  logs: logsAPI,
  backup: backupAPI
})

// ============================================================
// 暴露到渲染进程
// ============================================================
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', extendedElectronAPI)
    contextBridge.exposeInMainWorld('topicAPI', topicAPI)
    contextBridge.exposeInMainWorld('eventAPI', eventAPI)
    contextBridge.exposeInMainWorld('drawAPI', drawAPI)
    contextBridge.exposeInMainWorld('auditAPI', auditAPI)
    contextBridge.exposeInMainWorld('settingsAPI', settingsAPI)
    contextBridge.exposeInMainWorld('importAPI', importAPI)
    contextBridge.exposeInMainWorld('exportAPI', exportAPI)
    contextBridge.exposeInMainWorld('dedupAPI', dedupAPI)
    contextBridge.exposeInMainWorld('fileAPI', fileAPI)
    contextBridge.exposeInMainWorld('systemAPI', systemAPI)
    contextBridge.exposeInMainWorld('customFieldAPI', customFieldAPI)
    contextBridge.exposeInMainWorld('batchEditAPI', batchEditAPI)
    contextBridge.exposeInMainWorld('undoAPI', undoAPI)
    contextBridge.exposeInMainWorld('formatAPI', formatAPI)
    contextBridge.exposeInMainWorld('timerAPI', timerAPI)
    contextBridge.exposeInMainWorld('bellAPI', bellAPI)
    contextBridge.exposeInMainWorld('backgroundAPI', backgroundAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // 非 contextIsolated 场景（如浏览器测试环境）：通过类型化 cast 直接挂到 window
  // index.d.ts 中已为 Window 接口声明这些字段；由于 .d.ts 是模块（含 export），
  // 其 declare global 在 tsconfig.node.json 上下文中不会自动加载，
  // 因此这里用本地类型别名显式扩展 Window，保证类型安全且无需 @ts-ignore
  type GlobalWindow = Window & {
    electron: typeof extendedElectronAPI
    topicAPI: typeof topicAPI
    eventAPI: typeof eventAPI
    drawAPI: typeof drawAPI
    auditAPI: typeof auditAPI
    settingsAPI: typeof settingsAPI
    importAPI: typeof importAPI
    exportAPI: typeof exportAPI
    dedupAPI: typeof dedupAPI
    fileAPI: typeof fileAPI
    systemAPI: typeof systemAPI
    customFieldAPI: typeof customFieldAPI
    batchEditAPI: typeof batchEditAPI
    undoAPI: typeof undoAPI
    formatAPI: typeof formatAPI
    timerAPI: typeof timerAPI
    bellAPI: typeof bellAPI
    backgroundAPI: typeof backgroundAPI
  }
  const w = window as unknown as GlobalWindow
  w.electron = extendedElectronAPI
  w.topicAPI = topicAPI
  w.eventAPI = eventAPI
  w.drawAPI = drawAPI
  w.auditAPI = auditAPI
  w.settingsAPI = settingsAPI
  w.importAPI = importAPI
  w.exportAPI = exportAPI
  w.dedupAPI = dedupAPI
  w.fileAPI = fileAPI
  w.systemAPI = systemAPI
  w.customFieldAPI = customFieldAPI
  w.batchEditAPI = batchEditAPI
  w.undoAPI = undoAPI
  w.formatAPI = formatAPI
  w.timerAPI = timerAPI
  w.bellAPI = bellAPI
  w.backgroundAPI = backgroundAPI
}
