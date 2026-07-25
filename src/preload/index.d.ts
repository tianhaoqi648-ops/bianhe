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
  Event,
  EventFilter,
  Round,
  Team,
  TeamHistory,
  DrawSession,
  DrawSessionDetail,
  SessionFilter,
  AuditLog,
  AuditLogFilter,
  ImportExecuteRequest,
  ImportExecuteResult,
  ParsedResult,
  ExportLogsRequest,
  ExportLogsResult,
  ExportTopicsRequest,
  ExportDrawSessionsRequest,
  ExportEventPackageRequest,
  ExportResult,
  DedupRunResult
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
  create: (data: any) => Promise<ApiResponse<Topic>>
  update: (id: string, data: any) => Promise<ApiResponse<Topic>>
  delete: (id: string) => Promise<ApiResponse<boolean>>
  batchDelete: (ids: string[]) => Promise<ApiResponse<number>>
  updateStatus: (id: string, status: string) => Promise<ApiResponse<boolean>>
  updateWeight: (id: string, weight: number) => Promise<ApiResponse<boolean>>
  count: (filter?: TopicFilter) => Promise<ApiResponse<number>>
}

export interface EventAPI {
  listEvents: (filter?: EventFilter) => Promise<ApiResponse<EventListResponse>>
  getEvent: (id: string) => Promise<ApiResponse<Event | undefined>>
  createEvent: (data: any) => Promise<ApiResponse<Event>>
  updateEvent: (id: string, data: any) => Promise<ApiResponse<Event>>
  deleteEvent: (id: string) => Promise<ApiResponse<boolean>>
  listRoundsByEvent: (eventId: string) => Promise<ApiResponse<Round[]>>
  getRound: (id: string) => Promise<ApiResponse<Round | undefined>>
  createRound: (data: any) => Promise<ApiResponse<Round>>
  updateRound: (id: string, data: any) => Promise<ApiResponse<Round>>
  deleteRound: (id: string) => Promise<ApiResponse<boolean>>
  listTeamsByEvent: (eventId: string) => Promise<ApiResponse<Team[]>>
  getTeam: (id: string) => Promise<ApiResponse<Team | undefined>>
  createTeam: (data: any) => Promise<ApiResponse<Team>>
  updateTeam: (id: string, data: any) => Promise<ApiResponse<Team>>
  deleteTeam: (id: string) => Promise<ApiResponse<boolean>>
  listTeamHistory: (teamId: string) => Promise<ApiResponse<TeamHistory[]>>
  listTeamHistoryByEvent: (eventId: string) => Promise<ApiResponse<TeamHistory[]>>
  addTeamHistory: (data: any) => Promise<ApiResponse<TeamHistory>>
  deleteTeamHistory: (id: string) => Promise<ApiResponse<boolean>>
}

export interface DrawAPI {
  execute: (params: any) => Promise<ApiResponse<any>>
  listSessions: (filter?: SessionFilter) => Promise<ApiResponse<SessionListResponse>>
  getSession: (id: string) => Promise<ApiResponse<DrawSessionDetail | undefined>>
  deleteSession: (id: string) => Promise<ApiResponse<boolean>>
  listDrawnTopicIds: (eventId: string) => Promise<ApiResponse<string[]>>
  redo: (oldSessionId: string, params: any) => Promise<ApiResponse<any>>
}

export interface AuditAPI {
  listLogs: (filter?: AuditLogFilter) => Promise<ApiResponse<AuditLogListResponse>>
  addLog: (input: any) => Promise<ApiResponse<AuditLog>>
  deleteLog: (id: string) => Promise<ApiResponse<boolean>>
  clearLogs: (beforeDate?: string) => Promise<ApiResponse<number>>
  exportLogs: (req: ExportLogsRequest) => Promise<ApiResponse<ExportLogsResult>>
}

export interface SettingsAPI {
  get: (key: string) => Promise<ApiResponse<any>>
  set: (key: string, value: any) => Promise<ApiResponse<boolean>>
  getAll: () => Promise<ApiResponse<Record<string, any>>>
  delete: (key: string) => Promise<ApiResponse<boolean>>
}

export interface ImportAPI {
  parseFile: (
    filePath: string,
    fileType: 'xlsx' | 'csv' | 'docx'
  ) => Promise<ApiResponse<ParsedResult>>
  execute: (req: ImportExecuteRequest) => Promise<ApiResponse<ImportExecuteResult>>
  findDuplicates: (topics: any[], options?: any) => Promise<ApiResponse<any>>
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
  run: (options?: any) => Promise<ApiResponse<DedupRunResult>>
  deleteTopics: (ids: string[]) => Promise<ApiResponse<{ deleted: number }>>
}

export interface FileAPI {
  /** 调用主进程 dialog.showOpenDialog 选择单个文件，返回文件路径或 null */
  pickFile: (
    filters?: Array<{ name: string; extensions: string[] }>
  ) => Promise<string | null>
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
  }
}

export {}
