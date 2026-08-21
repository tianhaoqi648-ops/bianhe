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
  type Match,
  type MatchCreateInput,
  type MatchUpdateInput,
  type MatchSetResultInput,
  type MatchAiReview,
  type RecordingMeta,
  type RecordingSaveResult,
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
  type DedupRunResult,
  type UpdateStatusPayload,
  type SttRequest,
  type SttSegment,
  type SttEngineStatus,
  type SttImportResult,
  type SttFfmpegStatus,
  type SttFunAsrStatus,
  type SttFunAsrInstallResult,
  type SttDirDiagnostics,
  type ScheduleDiffPreview,
  type ScheduleApplyResult,
  type BadgeItem,
  type JudgeHistoryRecord,
  type JudgeHistoryCreateInput,
  type JudgeHistoryFilter
} from '../shared/types'
import type { ExportJudgeReportRequest, ExportJudgeReportResult } from '../shared/types'
import type { BellAsset, StageSide, TimerTheme } from '../shared/debate-formats/types'
import type {
  ChatRequest,
  ChatEvent,
  AgentAPI,
  AgentSession,
  AgentMessageRecord,
  ToolConfirmRule,
  ToolConfirmResult,
  TestConnectionResult,
  LLMConfig,
  RunToolRequest,
  RunToolResult
} from '../shared/agent-types'

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
// 赛程 Excel API（P1-6：与赛事「包」导入导出是不同的能力）
// ============================================================
const scheduleAPI = {
  /** 导出当前赛程为 xlsx：主进程弹保存对话框；用户取消返回 data:null */
  exportSchedule: (eventId: string) =>
    invoke<ApiResponse<ExportResult | null>>(IPC_CHANNELS.SCHEDULE_EXPORT, { eventId }),
  /** 解析导入 xlsx → 「新增/更新/删除」变更预览（不写库） */
  importParse: (eventId: string, filePath: string) =>
    invoke<ApiResponse<ScheduleDiffPreview>>(IPC_CHANNELS.SCHEDULE_IMPORT_PARSE, { eventId, filePath }),
  /** 确认后应用变更到比赛 */
  importApply: (eventId: string, preview: ScheduleDiffPreview) =>
    invoke<ApiResponse<ScheduleApplyResult>>(IPC_CHANNELS.SCHEDULE_IMPORT_APPLY, { eventId, preview })
}

// ============================================================
// 队徽库 API（P1-6：内置/上传/搜索 · 队伍绑定，存 userData/badges）
// ============================================================
const badgeAPI = {
  /** 列出队徽库；可传关键字过滤（不含则返回全部） */
  list: (keyword?: string) =>
    invoke<ApiResponse<BadgeItem[]>>(IPC_CHANNELS.BADGE_LIST, keyword),
  /** 上传队徽：renderer 读取图片为 base64 后传入 */
  upload: (opts: { name: string; fileName: string; base64: string }) =>
    invoke<ApiResponse<BadgeItem>>(IPC_CHANNELS.BADGE_UPLOAD, opts),
  /** 删除自定义队徽 */
  delete: (id: string) =>
    invoke<ApiResponse<boolean>>(IPC_CHANNELS.BADGE_DELETE, id),
  /** 取队徽 dataUrl（供 <img> 渲染） */
  getDataUrl: (id: string) =>
    invoke<ApiResponse<string | null>>(IPC_CHANNELS.BADGE_GET_DATA_URL, id),
  /** 绑定队伍 → 队徽 */
  setTeam: (teamId: string, badgeId: string) =>
    invoke<ApiResponse<boolean>>(IPC_CHANNELS.BADGE_SET_TEAM, { teamId, badgeId }),
  /** 读取队伍已绑定队徽 id（未设置返回 null） */
  getTeam: (teamId: string) =>
    invoke<ApiResponse<string | null | undefined>>(IPC_CHANNELS.BADGE_GET_TEAM, teamId),
  /** 解绑队伍队徽 */
  clearTeam: (teamId: string) =>
    invoke<ApiResponse<boolean>>(IPC_CHANNELS.BADGE_CLEAR_TEAM, teamId)
}

// ============================================================
// 复盘报告导出 API（P0-3 录音一键复盘导出；P2-9 复盘 html 可视化导出）
// ============================================================
const reportAPI = {
  /** 导出复盘报告为 Markdown：主进程弹 saveDialog + 写文件；用户取消返回 data:null */
  exportJudge(req: ExportJudgeReportRequest): Promise<ApiResponse<ExportJudgeReportResult | null>> {
    return invoke<ApiResponse<ExportJudgeReportResult | null>>(
      IPC_CHANNELS.REPORT_EXPORT_JUDGE,
      req
    )
  },
  /** 导出复盘为自包含 HTML（P2-9，含内联雷达图可视化）：主进程弹 saveDialog + 写文件；用户取消返回 data:null */
  exportJudgeHtml(req: ExportJudgeReportRequest): Promise<ApiResponse<ExportJudgeReportResult | null>> {
    return invoke<ApiResponse<ExportJudgeReportResult | null>>(
      IPC_CHANNELS.REPORT_EXPORT_JUDGE_HTML,
      req
    )
  }
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
  ) => invoke<ApiResponse<string | null>>(IPC_CHANNELS.SYSTEM_PICK_FILE, filters),
  /** 读取稿子文本文件内容（txt/md/docx，限 2MB；AI 裁判工作台 2026-08-18） */
  readTextFile: (filePath: string) =>
    invoke<ApiResponse<string>>(IPC_CHANNELS.SYSTEM_READ_TEXT_FILE, filePath)
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
    matchId?: string
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
  updateSession: (id: string, opts: Partial<Pick<TimerSession, 'status' | 'startedAt' | 'endedAt' | 'currentStageIndex' | 'currentSide' | 'remainingMs' | 'stageRemainingCache' | 'affRemainingMs' | 'negRemainingMs' | 'affPoolRemainingMs' | 'negPoolRemainingMs' | 'affSpeechCount' | 'negSpeechCount'>>) =>
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
// 比赛 API（matches：赛事→轮次下的对阵，承载 抽题→计时→录音→赛果→AI评审）
// ============================================================
const matchAPI = {
  create: (input: MatchCreateInput) => invoke<ApiResponse<Match | null>>(IPC_CHANNELS.MATCH_CREATE, input),
  get: (id: string) => invoke<ApiResponse<Match | null>>(IPC_CHANNELS.MATCH_GET, id),
  listByEvent: (eventId: string) => invoke<ApiResponse<Match[]>>(IPC_CHANNELS.MATCH_LIST_BY_EVENT, eventId),
  listByRound: (roundId: string) => invoke<ApiResponse<Match[]>>(IPC_CHANNELS.MATCH_LIST_BY_ROUND, roundId),
  update: (id: string, input: MatchUpdateInput) => invoke<ApiResponse<Match | null>>(IPC_CHANNELS.MATCH_UPDATE, id, input),
  setResult: (id: string, input: MatchSetResultInput) => invoke<ApiResponse<Match | null>>(IPC_CHANNELS.MATCH_SET_RESULT, id, input),
  setAiReview: (id: string, review: MatchAiReview) => invoke<ApiResponse<Match | null>>(IPC_CHANNELS.MATCH_SET_AI_REVIEW, id, review),
  linkSession: (id: string, sessionId: string) => invoke<ApiResponse<Match | null>>(IPC_CHANNELS.MATCH_LINK_SESSION, id, sessionId),
  delete: (id: string) => invoke<ApiResponse<boolean>>(IPC_CHANNELS.MATCH_DELETE, id)
}

// ============================================================
// 录音 API（比赛/计时可选录音，userData/recordings/）
// ============================================================
const recordingAPI = {
  save: (fileName: string, data: ArrayBuffer | Uint8Array) =>
    invoke<ApiResponse<RecordingSaveResult>>(IPC_CHANNELS.RECORDING_SAVE, fileName, data),
  list: () => invoke<ApiResponse<RecordingMeta[]>>(IPC_CHANNELS.RECORDING_LIST),
  read: (filePath: string) =>
    invoke<ApiResponse<{ ok: boolean; base64?: string; fileName?: string; error?: string }>>(
      IPC_CHANNELS.RECORDING_READ,
      filePath
    ),
  delete: (fileName: string) => invoke<ApiResponse<boolean>>(IPC_CHANNELS.RECORDING_DELETE, fileName),
  pickDir: () => invoke<ApiResponse<string | null>>(IPC_CHANNELS.RECORDING_PICK_DIR),
  getDir: () => invoke<ApiResponse<{ configured: string | null; effective: string }>>(IPC_CHANNELS.RECORDING_GET_DIR)
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
// 应用内自动更新 API（electron-updater）
//
// macOS 平台 download 会走 shell.openExternal 降级路径（主进程 IPC 层处理），
// 渲染进程无需关心平台差异，只需在 UI 上根据 isMacos 调整按钮文案。
// ============================================================
const updaterAPI = {
  /** 检查更新（主进程查询 GitHub Releases，结果通过 onStatusChange 广播） */
  check(): Promise<ApiResponse<void>> {
    return invoke<ApiResponse<void>>(IPC_CHANNELS.UPDATER_CHECK)
  },
  /** 下载更新（macOS 走 shell.openExternal 打开浏览器，Windows/Linux 后台下载） */
  download(releaseUrl?: string): Promise<ApiResponse<void>> {
    return invoke<ApiResponse<void>>(IPC_CHANNELS.UPDATER_DOWNLOAD, releaseUrl)
  },
  /** 退出并安装更新（仅 Windows/Linux 有效） */
  install(): Promise<ApiResponse<void>> {
    return invoke<ApiResponse<void>>(IPC_CHANNELS.UPDATER_INSTALL)
  },
  /** 设置启动时自动检查开关（持久化到 settings 表） */
  setAutoCheck(value: boolean): Promise<ApiResponse<{ ok: true }>> {
    return invoke<ApiResponse<{ ok: true }>>(IPC_CHANNELS.UPDATER_SET_AUTO_CHECK, value)
  },
  /** 获取应用运行元信息（是否打包环境，用于判断是否执行更新检查） */
  getMeta(): Promise<ApiResponse<{ isPackaged: boolean }>> {
    return invoke<ApiResponse<{ isPackaged: boolean }>>(IPC_CHANNELS.UPDATER_GET_META)
  },
  /** 订阅状态变更（主进程通过 webContents.send 推送），返回取消订阅函数 */
  onStatusChange(cb: (payload: UpdateStatusPayload) => void): () => void {
    const listener = (_: unknown, payload: UpdateStatusPayload): void => cb(payload)
    ipcRenderer.on(IPC_CHANNELS.UPDATER_STATUS_CHANGE, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATUS_CHANGE, listener)
    }
  }
}

// ============================================================
// 录音转文字（STT）API（AI 裁判整场评审原料 2026-08-20）
// 转写引擎首次使用时按需下载到 userData/stt/，不增大安装包。
// ============================================================
const sttAPI = {
  /** 对录音执行 分段→转文字，返回 SttSegment[] */
  transcribe(req: SttRequest): Promise<ApiResponse<SttSegment[]>> {
    return invoke<ApiResponse<SttSegment[]>>(IPC_CHANNELS.STT_TRANSCRIBE, req)
  },
  /** 查询转写引擎安装/下载状态（optional 指定模型） */
  status(model?: string): Promise<ApiResponse<SttEngineStatus>> {
    return invoke<ApiResponse<SttEngineStatus>>(IPC_CHANNELS.STT_STATUS, model)
  },
  /** 查询 FunASR 本地引擎运行环境状态（envOk/modelOk 等） */
  funasrStatus(): Promise<SttFunAsrStatus> {
    return invoke<SttFunAsrStatus>(IPC_CHANNELS.STT_FUNASR_STATUS)
  },
  /** 一键安装 FunASR 运行环境（自动检测 python + pip install funasr） */
  funasrInstall(): Promise<SttFunAsrInstallResult> {
    return invoke<SttFunAsrInstallResult>(IPC_CHANNELS.STT_FUNASR_INSTALL)
  },
  /** 下载转写引擎（二进制 + 模型）到 userData/stt/ */
  download(model: string): Promise<ApiResponse<{ ok: true }>> {
    return invoke<ApiResponse<{ ok: true }>>(IPC_CHANNELS.STT_DOWNLOAD, model)
  },
  /** 取消进行中的下载 */
  cancelDownload(): Promise<ApiResponse<{ ok: true }>> {
    return invoke<ApiResponse<{ ok: true }>>(IPC_CHANNELS.STT_CANCEL)
  },
  /** 删除已下载的转写引擎 */
  remove(): Promise<ApiResponse<{ ok: true }>> {
    return invoke<ApiResponse<{ ok: true }>>(IPC_CHANNELS.STT_REMOVE)
  },
  /** 手动导入本地 whisper 模型（ggml-<model>.bin，离线兜底） */
  importLocalModel(): Promise<SttImportResult> {
    return invoke<SttImportResult>(IPC_CHANNELS.STT_IMPORT_MODEL)
  },
  /** 查询 ffmpeg 转码器安装/下载状态 */
  ffmpegStatus(): Promise<SttFfmpegStatus> {
    return invoke<SttFfmpegStatus>(IPC_CHANNELS.STT_FFMPEG_STATUS)
  },
  /** 下载 ffmpeg 转码器（非 win32-x64 平台返回带 error 状态，不抛错） */
  downloadFfmpeg(): Promise<SttFfmpegStatus> {
    return invoke<SttFfmpegStatus>(IPC_CHANNELS.STT_FFMPEG_DOWNLOAD)
  },
  /** 取消进行中的 ffmpeg 下载 */
  cancelFfmpeg(): Promise<SttFfmpegStatus> {
    return invoke<SttFfmpegStatus>(IPC_CHANNELS.STT_FFMPEG_CANCEL)
  },
  /** 删除已下载的 ffmpeg 转码器 */
  removeFfmpeg(): Promise<SttFfmpegStatus> {
    return invoke<SttFfmpegStatus>(IPC_CHANNELS.STT_FFMPEG_REMOVE)
  },
  /** 手动选择本机已有的 whisper 转写器（whisper-cli） */
  pickWhisperCli(): Promise<SttEngineStatus> {
    return invoke<SttEngineStatus>(IPC_CHANNELS.STT_WHISPER_PICK)
  },
  /** 清除手动 whisper 转写器路径 */
  clearWhisperCli(): Promise<SttEngineStatus> {
    return invoke<SttEngineStatus>(IPC_CHANNELS.STT_WHISPER_CLEAR)
  },
  /** 手动选择本机已有的 ffmpeg（离线兜底） */
  pickFfmpegPath(): Promise<SttFfmpegStatus> {
    return invoke<SttFfmpegStatus>(IPC_CHANNELS.STT_FFMPEG_PICK)
  },
  /** 清除手动指定的 ffmpeg 路径 */
  clearFfmpegPath(): Promise<SttFfmpegStatus> {
    return invoke<SttFfmpegStatus>(IPC_CHANNELS.STT_FFMPEG_CLEAR)
  },
  /** 查询 stt 目录与模型/ffmpeg 在位状况（用于展示与丢失找回） */
  sttDirDiagnostics(): Promise<ApiResponse<SttDirDiagnostics>> {
    return invoke<ApiResponse<SttDirDiagnostics>>(IPC_CHANNELS.STT_DIAGNOSTICS)
  }
}

// ============================================================
// AI 裁判历史 API（judge_history，T1/T2）
// 裁判工具执行成功后自动落库；支持按绑定筛选、重开、删除。
// ============================================================
const judgeAPI = {
  /** 列表查询；可按 eventId/roundId/matchId/toolName 筛选，按 created_at 倒序 */
  listHistory: (filter?: JudgeHistoryFilter) =>
    invoke<ApiResponse<JudgeHistoryRecord[]>>(IPC_CHANNELS.JUDGE_LIST_HISTORY, filter),
  /** 按 id 取单条历史 */
  getHistory: (id: string) =>
    invoke<ApiResponse<JudgeHistoryRecord | undefined>>(IPC_CHANNELS.JUDGE_GET_HISTORY, id),
  /** 保存一条裁判历史（工具成功结果） */
  saveHistory: (input: JudgeHistoryCreateInput) =>
    invoke<ApiResponse<JudgeHistoryRecord>>(IPC_CHANNELS.JUDGE_SAVE_HISTORY, input),
  /** 删除单条历史 */
  deleteHistory: (id: string) =>
    invoke<ApiResponse<boolean>>(IPC_CHANNELS.JUDGE_DELETE_HISTORY, id)
}

// ============================================================
// Agent 对话 API（AI Agent v1.3.0）
//
// 流式事件通过 IPC 'agent:event' 通道推送，onEvent 回调转发给渲染进程。
// chat 返回取消函数：移除事件监听 + 发送 cancel 信号。
//
// SubTask 30.4：扩展 session 与 config 命名空间，
// 支持多会话持久化与工具确认规则配置。
// ============================================================
const agentAPI: AgentAPI = {
  /**
   * 发起 Agent 对话
   * @param request 对话请求
   * @param onEvent 流式事件回调
   * @returns 取消函数（调用后取消订阅事件 + 发送 cancel 信号）
   */
  chat(request: ChatRequest, onEvent: (event: ChatEvent) => void): () => void {
    const handler = (_event: unknown, data: ChatEvent): void => onEvent(data)
    // 2026-08-18：移除全局 removeAllListeners——多会话并发时，A 会话完成/取消会
    // 误删 B 会话的 handler。每个 chat 注册独立 handler，取消函数仅移除自身。
    ipcRenderer.on('agent:event', handler)
    // 异步发起调用，不阻塞
    ipcRenderer.invoke('agent:chat', request).catch((err) => {
      onEvent({
        type: 'error',
        sessionId: request.sessionId ?? '',
        code: 'unknown',
        message: err?.message ?? String(err)
      })
    })
    // 返回取消函数：仅取消本会话（2026-08-18 按 sessionId 维度）
    return () => {
      ipcRenderer.removeListener('agent:event', handler)
      ipcRenderer.invoke('agent:cancel', request.sessionId ?? '').catch(() => {
        // 取消请求失败可忽略（主进程 may 已无该会话的 controller）
      })
    }
  },
  /**
   * 测试 LLM 连接（不进入 agent 循环）。
   * 主进程通过 agent:test-connection handler 直接调用 chat 一次最小请求。
   * @param config LLM 连接配置
   * @returns 测试结果
   */
  testConnection(config: LLMConfig): Promise<TestConnectionResult> {
    return ipcRenderer.invoke('agent:test-connection', config)
  },
  /**
   * 取消指定会话进行中的对话（2026-08-18：按会话维度取消，支持多会话并发）。
   * @param sessionId 会话 id；缺失时取消当前窗口全部进行中的对话（兼容旧调用）
   */
  cancel(sessionId?: string): Promise<void> {
    return ipcRenderer.invoke('agent:cancel', sessionId)
  },
  /**
   * 直接调用裁判工具（AI 裁判工作台，2026-08-18）。
   * 白名单：judge_debate / judge_speech / detect_stage / simulate_opponent。
   */
  runTool(req: RunToolRequest): Promise<RunToolResult> {
    return ipcRenderer.invoke('agent:run-tool', req)
  },
  /** 取消当前进行中的 runTool 调用（AI 裁判工作台「取消」按钮） */
  cancelTool(): Promise<void> {
    return ipcRenderer.invoke('agent:cancel-tool')
  },
  /**
   * 回传工具人工确认结果（Task 32 / 41.4）。
   * 主进程 agent-loop.ts 内已注册 'agent:confirm-result' IPC handler，
   * 调用后会从 pendingConfirms Map 中取出对应 Promise 并 resolve。
   */
  confirmResult(result: ToolConfirmResult): Promise<void> {
    return ipcRenderer.invoke('agent:confirm-result', result).then(() => undefined)
  },
  /**
   * 导出指定会话为 Markdown / JSON 文件（Task 46）。
   * 主进程 'agent:export-session' handler 内调用 dialog.showSaveDialog 让用户选路径，
   * 用户取消保存时返回 { success: true, data: null }，前端据此区分取消与失败。
   */
  exportSession(payload: {
    sessionId: string
    format: 'markdown' | 'json'
  }): Promise<ApiResponse<{ filePath: string; size: number } | null>> {
    return invoke<ApiResponse<{ filePath: string; size: number } | null>>(
      'agent:export-session',
      payload
    )
  },
  // ---------- 会话管理（SubTask 30.4 / Task 41.3） ----------
  session: {
    /** 列出全部会话（按 updatedAt DESC） */
    list(): Promise<ApiResponse<AgentSession[]>> {
      return invoke('agent:session:list')
    },
    /** 创建新会话 */
    create(title: string): Promise<ApiResponse<AgentSession>> {
      return invoke('agent:session:create', { title })
    },
    /** 重命名会话 */
    rename(id: string, title: string): Promise<ApiResponse<boolean>> {
      return invoke('agent:session:rename', { id, title })
    },
    /** 删除会话（事务级联清理消息） */
    delete(id: string): Promise<ApiResponse<boolean>> {
      return invoke('agent:session:delete', { id })
    },
    /** 清空全部会话（事务级联清理全部消息，不可恢复） */
    clearAll(): Promise<ApiResponse<boolean>> {
      return invoke('agent:session:clear-all')
    },
    /** 加载会话详情（session + messages） */
    load(
      id: string
    ): Promise<ApiResponse<{ session: AgentSession; messages: AgentMessageRecord[] }>> {
      return invoke('agent:session:load', { id })
    },
    /** 跨会话搜索（title / lastMessageText） */
    search(keyword: string): Promise<ApiResponse<AgentSession[]>> {
      return invoke('agent:session:search', { keyword })
    },
    /**
     * 追加一条消息到指定会话（Task 41.3）。
     * 主进程 agent-session.ipc.ts 内注册 'agent:session:add-message' handler，
     * 调用 agentMessageRepo.add 写入 agent_messages 表。
     */
    addMessage(
      sessionId: string,
      message: Omit<AgentMessageRecord, 'id' | 'createdAt' | 'seq' | 'sessionId'>
    ): Promise<ApiResponse<AgentMessageRecord>> {
      return invoke('agent:session:add-message', { sessionId, message })
    },
    /**
     * 更新会话最近一条消息的预览文本与时间（Task 41.3）。
     * 同步刷新 updatedAt，保证会话列表按最新活动排序。
     */
    updateLastMessage(sessionId: string, text: string): Promise<ApiResponse<boolean>> {
      return invoke('agent:session:update-last-message', { sessionId, text })
    }
  },
  // ---------- Agent 配置（SubTask 30.4） ----------
  config: {
    /** 读取工具确认规则（无配置时返回默认规则） */
    getConfirmRules(): Promise<ApiResponse<ToolConfirmRule[]>> {
      return invoke('agent:config:get-confirm-rules')
    },
    /** 保存工具确认规则到 settings 表 */
    setConfirmRules(rules: ToolConfirmRule[]): Promise<ApiResponse<boolean>> {
      return invoke('agent:config:set-confirm-rules', { rules })
    }
  }
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
    contextBridge.exposeInMainWorld('scheduleAPI', scheduleAPI)
    contextBridge.exposeInMainWorld('badgeAPI', badgeAPI)
    contextBridge.exposeInMainWorld('reportAPI', reportAPI)
    contextBridge.exposeInMainWorld('dedupAPI', dedupAPI)
    contextBridge.exposeInMainWorld('fileAPI', fileAPI)
    contextBridge.exposeInMainWorld('systemAPI', systemAPI)
    contextBridge.exposeInMainWorld('customFieldAPI', customFieldAPI)
    contextBridge.exposeInMainWorld('batchEditAPI', batchEditAPI)
    contextBridge.exposeInMainWorld('undoAPI', undoAPI)
    contextBridge.exposeInMainWorld('formatAPI', formatAPI)
    contextBridge.exposeInMainWorld('timerAPI', timerAPI)
    contextBridge.exposeInMainWorld('matchAPI', matchAPI)
    contextBridge.exposeInMainWorld('recordingAPI', recordingAPI)
    contextBridge.exposeInMainWorld('bellAPI', bellAPI)
    contextBridge.exposeInMainWorld('backgroundAPI', backgroundAPI)
    contextBridge.exposeInMainWorld('updaterAPI', updaterAPI)
    contextBridge.exposeInMainWorld('agent', agentAPI)
    contextBridge.exposeInMainWorld('sttAPI', sttAPI)
    contextBridge.exposeInMainWorld('judgeAPI', judgeAPI)
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
    scheduleAPI: typeof scheduleAPI
    badgeAPI: typeof badgeAPI
    reportAPI: typeof reportAPI
    dedupAPI: typeof dedupAPI
    fileAPI: typeof fileAPI
    systemAPI: typeof systemAPI
    customFieldAPI: typeof customFieldAPI
    batchEditAPI: typeof batchEditAPI
    undoAPI: typeof undoAPI
    formatAPI: typeof formatAPI
    timerAPI: typeof timerAPI
    matchAPI: typeof matchAPI
    recordingAPI: typeof recordingAPI
    bellAPI: typeof bellAPI
    backgroundAPI: typeof backgroundAPI
    updaterAPI: typeof updaterAPI
    agent: typeof agentAPI
    sttAPI: typeof sttAPI
    judgeAPI: typeof judgeAPI
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
  w.scheduleAPI = scheduleAPI
  w.badgeAPI = badgeAPI
  w.reportAPI = reportAPI
  w.dedupAPI = dedupAPI
  w.fileAPI = fileAPI
  w.systemAPI = systemAPI
  w.customFieldAPI = customFieldAPI
  w.batchEditAPI = batchEditAPI
  w.undoAPI = undoAPI
  w.formatAPI = formatAPI
  w.timerAPI = timerAPI
  w.matchAPI = matchAPI
  w.recordingAPI = recordingAPI
  w.bellAPI = bellAPI
  w.backgroundAPI = backgroundAPI
  w.updaterAPI = updaterAPI
  w.agent = agentAPI
  w.sttAPI = sttAPI
  w.judgeAPI = judgeAPI
}
