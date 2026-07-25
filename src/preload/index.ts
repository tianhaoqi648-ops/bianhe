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
  type DrawParams,
  type SessionFilter,
  type AuditLogFilter,
  type AuditLogCreateInput,
  type ImportExecuteRequest,
  type ImportBatch,
  type ExportTopicsRequest,
  type ExportDrawSessionsRequest,
  type ExportEventPackageRequest,
  type ExportLogsRequest,
  type DedupOptions,
  type DuplicateGroup,
  type Topic
} from '../shared/types'

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
  list: (filter?: TopicFilter) => invoke(IPC_CHANNELS.TOPIC_LIST, filter),
  get: (id: string) => invoke(IPC_CHANNELS.TOPIC_GET, id),
  create: (data: TopicCreateInput) => invoke(IPC_CHANNELS.TOPIC_CREATE, data),
  update: (id: string, data: TopicUpdateInput) =>
    invoke(IPC_CHANNELS.TOPIC_UPDATE, id, data),
  delete: (id: string) => invoke(IPC_CHANNELS.TOPIC_DELETE, id),
  batchDelete: (ids: string[]) => invoke(IPC_CHANNELS.TOPIC_BATCH_DELETE, ids),
  updateStatus: (id: string, status: string) =>
    invoke(IPC_CHANNELS.TOPIC_UPDATE_STATUS, id, status),
  updateWeight: (id: string, weight: number) =>
    invoke(IPC_CHANNELS.TOPIC_UPDATE_WEIGHT, id, weight),
  count: (filter?: TopicFilter) => invoke(IPC_CHANNELS.TOPIC_COUNT, filter),
  countByDimension: (
    dimension: 'type' | 'domain' | 'difficulty' | 'source' | 'source_type' | 'status' | 'batch_id'
  ) => invoke<Array<{ value: string; count: number }>>(IPC_CHANNELS.TOPIC_COUNT_BY_DIMENSION, dimension),
  listAllTags: () =>
    invoke<Array<{ value: string; count: number }>>(IPC_CHANNELS.TOPIC_LIST_ALL_TAGS)
}

// ============================================================
// 赛事 API（含轮次、队伍、队伍历史）
// ============================================================
const eventAPI = {
  // event
  listEvents: (filter?: EventFilter) => invoke(IPC_CHANNELS.EVENT_LIST, filter),
  getEvent: (id: string) => invoke(IPC_CHANNELS.EVENT_GET, id),
  createEvent: (data: EventCreateInput) => invoke(IPC_CHANNELS.EVENT_CREATE, data),
  updateEvent: (id: string, data: EventUpdateInput) =>
    invoke(IPC_CHANNELS.EVENT_UPDATE, id, data),
  deleteEvent: (id: string) => invoke(IPC_CHANNELS.EVENT_DELETE, id),
  // round
  listRoundsByEvent: (eventId: string) => invoke(IPC_CHANNELS.ROUND_LIST_BY_EVENT, eventId),
  getRound: (id: string) => invoke(IPC_CHANNELS.ROUND_GET, id),
  createRound: (data: RoundCreateInput) => invoke(IPC_CHANNELS.ROUND_CREATE, data),
  updateRound: (id: string, data: RoundUpdateInput) =>
    invoke(IPC_CHANNELS.ROUND_UPDATE, id, data),
  deleteRound: (id: string) => invoke(IPC_CHANNELS.ROUND_DELETE, id),
  // team
  listTeamsByEvent: (eventId: string) => invoke(IPC_CHANNELS.TEAM_LIST_BY_EVENT, eventId),
  getTeam: (id: string) => invoke(IPC_CHANNELS.TEAM_GET, id),
  createTeam: (data: TeamCreateInput) => invoke(IPC_CHANNELS.TEAM_CREATE, data),
  updateTeam: (id: string, data: TeamUpdateInput) =>
    invoke(IPC_CHANNELS.TEAM_UPDATE, id, data),
  deleteTeam: (id: string) => invoke(IPC_CHANNELS.TEAM_DELETE, id),
  // team history
  listTeamHistory: (teamId: string) => invoke(IPC_CHANNELS.TEAM_HISTORY_LIST, teamId),
  listTeamHistoryByEvent: (eventId: string) =>
    invoke(IPC_CHANNELS.TEAM_HISTORY_LIST_BY_EVENT, eventId),
  addTeamHistory: (data: TeamHistoryCreateInput) =>
    invoke(IPC_CHANNELS.TEAM_HISTORY_ADD, data),
  deleteTeamHistory: (id: string) => invoke(IPC_CHANNELS.TEAM_HISTORY_DELETE, id)
}

// ============================================================
// 抽取 API
// ============================================================
const drawAPI = {
  execute: (params: DrawParams) => invoke(IPC_CHANNELS.DRAW_EXECUTE, params),
  listSessions: (filter?: SessionFilter) => invoke(IPC_CHANNELS.DRAW_LIST_SESSIONS, filter),
  getSession: (id: string) => invoke(IPC_CHANNELS.DRAW_GET_SESSION, id),
  deleteSession: (id: string) => invoke(IPC_CHANNELS.DRAW_DELETE_SESSION, id),
  listDrawnTopicIds: (eventId: string) =>
    invoke(IPC_CHANNELS.DRAW_LIST_DRAWN_TOPIC_IDS, eventId),
  redo: (oldSessionId: string, params: DrawParams) =>
    invoke(IPC_CHANNELS.DRAW_REDO, oldSessionId, params)
}

// ============================================================
// 审计 API
// ============================================================
const auditAPI = {
  listLogs: (filter?: AuditLogFilter) => invoke(IPC_CHANNELS.AUDIT_LIST_LOGS, filter),
  addLog: (input: AuditLogCreateInput) => invoke(IPC_CHANNELS.AUDIT_ADD_LOG, input),
  deleteLog: (id: string) => invoke(IPC_CHANNELS.AUDIT_DELETE_LOG, id),
  clearLogs: (beforeDate?: string) => invoke(IPC_CHANNELS.AUDIT_CLEAR_LOGS, beforeDate),
  exportLogs: (req: ExportLogsRequest) => invoke(IPC_CHANNELS.AUDIT_EXPORT_LOGS, req)
}

// ============================================================
// 系统设置 API
// 注：settings 的 value 可为任意可序列化结构，使用 unknown 替代 any
// ============================================================
const settingsAPI = {
  get: (key: string) => invoke(IPC_CHANNELS.SETTINGS_GET, key),
  set: (key: string, value: unknown) => invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  getAll: () => invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
  delete: (key: string) => invoke(IPC_CHANNELS.SETTINGS_DELETE, key),
  deleteBatch: (keys: string[]) => invoke(IPC_CHANNELS.SETTINGS_DELETE_BATCH, keys),
  getCandidates: () =>
    invoke<Record<string, string[]>>(IPC_CHANNELS.SYSTEM_GET_CANDIDATES)
}

// ============================================================
// 导入 API
// ============================================================
const importAPI = {
  parseFile: (filePath: string, fileType: 'xlsx' | 'csv' | 'docx') =>
    invoke(IPC_CHANNELS.IMPORT_PARSE_FILE, filePath, fileType),
  execute: (req: ImportExecuteRequest) => invoke(IPC_CHANNELS.IMPORT_EXECUTE, req),
  findDuplicates: (topics: Topic[], options?: DedupOptions) =>
    invoke<DuplicateGroup[]>(IPC_CHANNELS.IMPORT_FIND_DUPLICATES, topics, options),
  revokeBatch: (batchId: string) =>
    invoke<{ deletedCount: number }>(IPC_CHANNELS.IMPORT_REVOKE_BATCH, batchId),
  listBatches: () => invoke<ImportBatch[]>(IPC_CHANNELS.IMPORT_LIST_BATCHES)
}

// ============================================================
// 导出 API
// ============================================================
const exportAPI = {
  exportTopics: (req: ExportTopicsRequest) => invoke(IPC_CHANNELS.EXPORT_TOPICS, req),
  exportDrawSessions: (req: ExportDrawSessionsRequest) =>
    invoke(IPC_CHANNELS.EXPORT_DRAW_SESSIONS, req),
  exportEventPackage: (req: ExportEventPackageRequest) =>
    invoke(IPC_CHANNELS.EXPORT_EVENT_PACKAGE, req)
}

// ============================================================
// 去重检查 API
// ============================================================
const dedupAPI = {
  run: (options?: DedupOptions) => invoke(IPC_CHANNELS.DEDUP_RUN, options),
  deleteTopics: (ids: string[]) => invoke(IPC_CHANNELS.DEDUP_DELETE_TOPICS, ids)
}

// ============================================================
// 通用文件选择 API
// ============================================================
const fileAPI = {
  /** 调用主进程 dialog.showOpenDialog 选择单个文件，返回文件路径或 null */
  pickFile: (
    filters?: Array<{ name: string; extensions: string[] }>
  ) => invoke<string | null>(IPC_CHANNELS.SYSTEM_PICK_FILE, filters)
}

// ============================================================
// 暴露到渲染进程
// ============================================================
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('topicAPI', topicAPI)
    contextBridge.exposeInMainWorld('eventAPI', eventAPI)
    contextBridge.exposeInMainWorld('drawAPI', drawAPI)
    contextBridge.exposeInMainWorld('auditAPI', auditAPI)
    contextBridge.exposeInMainWorld('settingsAPI', settingsAPI)
    contextBridge.exposeInMainWorld('importAPI', importAPI)
    contextBridge.exposeInMainWorld('exportAPI', exportAPI)
    contextBridge.exposeInMainWorld('dedupAPI', dedupAPI)
    contextBridge.exposeInMainWorld('fileAPI', fileAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // 非 contextIsolated 场景（如浏览器测试环境）：通过类型化 cast 直接挂到 window
  // index.d.ts 中已为 Window 接口声明这些字段；由于 .d.ts 是模块（含 export），
  // 其 declare global 在 tsconfig.node.json 上下文中不会自动加载，
  // 因此这里用本地类型别名显式扩展 Window，保证类型安全且无需 @ts-ignore
  type GlobalWindow = Window & {
    electron: typeof electronAPI
    topicAPI: typeof topicAPI
    eventAPI: typeof eventAPI
    drawAPI: typeof drawAPI
    auditAPI: typeof auditAPI
    settingsAPI: typeof settingsAPI
    importAPI: typeof importAPI
    exportAPI: typeof exportAPI
    dedupAPI: typeof dedupAPI
    fileAPI: typeof fileAPI
  }
  const w = window as unknown as GlobalWindow
  w.electron = electronAPI
  w.topicAPI = topicAPI
  w.eventAPI = eventAPI
  w.drawAPI = drawAPI
  w.auditAPI = auditAPI
  w.settingsAPI = settingsAPI
  w.importAPI = importAPI
  w.exportAPI = exportAPI
  w.dedupAPI = dedupAPI
  w.fileAPI = fileAPI
}
