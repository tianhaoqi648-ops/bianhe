// ============================================================
// preload/index.d.ts — 全局 Window 类型声明
//
// 让渲染进程 TS 代码能识别 window.topicAPI / eventAPI / drawAPI / auditAPI / settingsAPI / importAPI。
// 类型从 shared/types.ts 引入，确保与主进程 IPC 通道一致。
// ============================================================

import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  ApiResponse,
  Topic,
  TopicFilter,
  TopicCreateInput,
  TopicUpdateInput,
  Event,
  EventFilter,
  EventCreateInput,
  EventUpdateInput,
  Round,
  RoundCreateInput,
  RoundUpdateInput,
  Team,
  TeamCreateInput,
  TeamUpdateInput,
  TeamHistory,
  TeamHistoryCreateInput,
  DrawSession,
  DrawSessionDetail,
  DrawParams,
  DrawResult,
  SessionFilter,
  AuditLog,
  AuditLogFilter,
  AuditLogCreateInput,
  ImportExecuteRequest,
  ImportExecuteResult,
  ImportBatch,
  ParsedResult,
  ExportLogsRequest,
  ExportLogsResult,
  ExportTopicsRequest,
  ExportDrawSessionsRequest,
  ExportEventPackageRequest,
  ExportResult,
  DedupOptions,
  DedupRunResult,
  DuplicateGroup,
  ResetDataRequest,
  ResetDataResponse
} from '../shared/types'

interface TopicListResponse {
  items: Topic[]
  total: number
}

interface EventListResponse {
  items: Event[]
  total: number
}

interface SessionListResponse {
  items: DrawSessionDetail[]
  total: number
}

interface AuditLogListResponse {
  items: AuditLog[]
  total: number
}

export interface TopicAPI {
  list: (filter?: TopicFilter) => Promise<ApiResponse<TopicListResponse>>
  get: (id: string) => Promise<ApiResponse<Topic>>
  create: (data: TopicCreateInput) => Promise<ApiResponse<Topic>>
  update: (id: string, data: TopicUpdateInput) => Promise<ApiResponse<Topic>>
  delete: (id: string) => Promise<ApiResponse<boolean>>
  batchDelete: (ids: string[]) => Promise<ApiResponse<number>>
  updateStatus: (id: string, status: string) => Promise<ApiResponse<boolean>>
  updateWeight: (id: string, weight: number) => Promise<ApiResponse<boolean>>
  count: (filter?: TopicFilter) => Promise<ApiResponse<number>>
  countByDimension: (
    dimension: string
  ) => Promise<ApiResponse<Array<{ value: string; count: number }>>>
  listAllTags: () => Promise<ApiResponse<Array<{ value: string; count: number }>>>
  /** 批量拉取系统字段的 distinct 值（用于 FilterPanel 候选值合并） */
  listValues: (
    fields: string[]
  ) => Promise<ApiResponse<Record<string, Array<{ value: string; count: number }>>>>
  /** 聚合某个 tags 类型自定义字段的全部 tag 值与出现次数 */
  listCustomFieldTags: (
    fieldKey: string
  ) => Promise<ApiResponse<Array<{ value: string; count: number }>>>
}

export interface EventAPI {
  listEvents: (filter?: EventFilter) => Promise<ApiResponse<EventListResponse>>
  getEvent: (id: string) => Promise<ApiResponse<Event | undefined>>
  createEvent: (data: EventCreateInput) => Promise<ApiResponse<Event>>
  updateEvent: (id: string, data: EventUpdateInput) => Promise<ApiResponse<Event>>
  deleteEvent: (id: string) => Promise<ApiResponse<boolean>>
  listRoundsByEvent: (eventId: string) => Promise<ApiResponse<Round[]>>
  getRound: (id: string) => Promise<ApiResponse<Round | undefined>>
  createRound: (data: RoundCreateInput) => Promise<ApiResponse<Round>>
  updateRound: (id: string, data: RoundUpdateInput) => Promise<ApiResponse<Round>>
  deleteRound: (id: string) => Promise<ApiResponse<boolean>>
  listTeamsByEvent: (eventId: string) => Promise<ApiResponse<Team[]>>
  getTeam: (id: string) => Promise<ApiResponse<Team | undefined>>
  createTeam: (data: TeamCreateInput) => Promise<ApiResponse<Team>>
  updateTeam: (id: string, data: TeamUpdateInput) => Promise<ApiResponse<Team>>
  deleteTeam: (id: string) => Promise<ApiResponse<boolean>>
  listTeamHistory: (teamId: string) => Promise<ApiResponse<TeamHistory[]>>
  listTeamHistoryByEvent: (eventId: string) => Promise<ApiResponse<TeamHistory[]>>
  addTeamHistory: (data: TeamHistoryCreateInput) => Promise<ApiResponse<TeamHistory>>
  deleteTeamHistory: (id: string) => Promise<ApiResponse<boolean>>
}

export interface DrawAPI {
  execute: (params: DrawParams) => Promise<ApiResponse<DrawResult>>
  listSessions: (filter?: SessionFilter) => Promise<ApiResponse<SessionListResponse>>
  getSession: (id: string) => Promise<ApiResponse<DrawSessionDetail | undefined>>
  deleteSession: (id: string) => Promise<ApiResponse<boolean>>
  listDrawnTopicIds: (eventId: string) => Promise<ApiResponse<string[]>>
  redo: (oldSessionId: string, params: DrawParams) => Promise<ApiResponse<DrawResult>>
}

export interface AuditAPI {
  listLogs: (filter?: AuditLogFilter) => Promise<ApiResponse<AuditLogListResponse>>
  addLog: (input: AuditLogCreateInput) => Promise<ApiResponse<AuditLog>>
  deleteLog: (id: string) => Promise<ApiResponse<boolean>>
  clearLogs: (beforeDate?: string) => Promise<ApiResponse<number>>
  exportLogs: (req: ExportLogsRequest) => Promise<ApiResponse<ExportLogsResult>>
}

export interface SettingsAPI {
  // settings 的 value 可为任意可序列化结构，使用 unknown 替代 any
  get: (key: string) => Promise<ApiResponse<unknown>>
  set: (key: string, value: unknown) => Promise<ApiResponse<boolean>>
  getAll: () => Promise<ApiResponse<Record<string, unknown>>>
  delete: (key: string) => Promise<ApiResponse<boolean>>
  deleteBatch: (keys: string[]) => Promise<ApiResponse<number>>
  getCandidates: () => Promise<ApiResponse<Record<string, string[]>>>
}

export interface ImportAPI {
  parseFile: (
    filePath: string,
    fileType: 'xlsx' | 'csv' | 'docx'
  ) => Promise<ApiResponse<ParsedResult>>
  execute: (req: ImportExecuteRequest) => Promise<ApiResponse<ImportExecuteResult>>
  findDuplicates: (
    topics: Topic[],
    options?: DedupOptions
  ) => Promise<ApiResponse<DuplicateGroup[]>>
  revokeBatch: (batchId: string) => Promise<ApiResponse<{ deletedCount: number }>>
  listBatches: () => Promise<ApiResponse<ImportBatch[]>>
}

export interface ExportAPI {
  exportTopics: (req: ExportTopicsRequest) => Promise<ApiResponse<ExportResult>>
  exportDrawSessions: (
    req: ExportDrawSessionsRequest
  ) => Promise<ApiResponse<ExportResult>>
  exportEventPackage: (
    req: ExportEventPackageRequest
  ) => Promise<ApiResponse<ExportResult>>
}

export interface DedupAPI {
  run: (options?: DedupOptions) => Promise<ApiResponse<DedupRunResult>>
  deleteTopics: (ids: string[]) => Promise<ApiResponse<{ deleted: number }>>
}

export interface FileAPI {
  /** 调用主进程 dialog.showOpenDialog 选择单个文件，返回文件路径或 null */
  pickFile: (
    filters?: Array<{ name: string; extensions: string[] }>
  ) => Promise<string | null>
}

export interface SystemAPI {
  /**
   * 统一数据重置入口。
   * 配置类：删除 settings keys；数据类：清空对应业务表。
   * 返回各表删除行数。
   */
  resetData: (req: ResetDataRequest) => Promise<ApiResponse<ResetDataResponse>>
}

declare global {
  interface Window {
    electron: ElectronAPI
    topicAPI: TopicAPI
    eventAPI: EventAPI
    drawAPI: DrawAPI
    auditAPI: AuditAPI
    settingsAPI: SettingsAPI
    importAPI: ImportAPI
    exportAPI: ExportAPI
    dedupAPI: DedupAPI
    fileAPI: FileAPI
    systemAPI: SystemAPI
  }
}

export {}
