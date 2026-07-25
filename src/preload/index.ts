// ============================================================
// preload/index.ts — 通过 contextBridge 暴露安全 API 到渲染进程
//
// 暴露 6 个 API 对象：topicAPI / eventAPI / drawAPI / auditAPI / settingsAPI / importAPI
// 每个方法内部调用 ipcRenderer.invoke(channel, ...args) 返回 Promise。
// 渲染进程通过 window.topicAPI.list() 等方式调用。
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '../shared/types'

/**
 * 通用 invoke 封装：自动展开参数。
 */
function invoke<T>(channel: string, ...args: any[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args)
}

// ============================================================
// 题库 API
// ============================================================
const topicAPI = {
  list: (filter?: any) => invoke(IPC_CHANNELS.TOPIC_LIST, filter),
  get: (id: string) => invoke(IPC_CHANNELS.TOPIC_GET, id),
  create: (data: any) => invoke(IPC_CHANNELS.TOPIC_CREATE, data),
  update: (id: string, data: any) => invoke(IPC_CHANNELS.TOPIC_UPDATE, id, data),
  delete: (id: string) => invoke(IPC_CHANNELS.TOPIC_DELETE, id),
  batchDelete: (ids: string[]) => invoke(IPC_CHANNELS.TOPIC_BATCH_DELETE, ids),
  updateStatus: (id: string, status: string) =>
    invoke(IPC_CHANNELS.TOPIC_UPDATE_STATUS, id, status),
  updateWeight: (id: string, weight: number) =>
    invoke(IPC_CHANNELS.TOPIC_UPDATE_WEIGHT, id, weight),
  count: (filter?: any) => invoke(IPC_CHANNELS.TOPIC_COUNT, filter)
}

// ============================================================
// 赛事 API（含轮次、队伍、队伍历史）
// ============================================================
const eventAPI = {
  // event
  listEvents: (filter?: any) => invoke(IPC_CHANNELS.EVENT_LIST, filter),
  getEvent: (id: string) => invoke(IPC_CHANNELS.EVENT_GET, id),
  createEvent: (data: any) => invoke(IPC_CHANNELS.EVENT_CREATE, data),
  updateEvent: (id: string, data: any) => invoke(IPC_CHANNELS.EVENT_UPDATE, id, data),
  deleteEvent: (id: string) => invoke(IPC_CHANNELS.EVENT_DELETE, id),
  // round
  listRoundsByEvent: (eventId: string) => invoke(IPC_CHANNELS.ROUND_LIST_BY_EVENT, eventId),
  getRound: (id: string) => invoke(IPC_CHANNELS.ROUND_GET, id),
  createRound: (data: any) => invoke(IPC_CHANNELS.ROUND_CREATE, data),
  updateRound: (id: string, data: any) => invoke(IPC_CHANNELS.ROUND_UPDATE, id, data),
  deleteRound: (id: string) => invoke(IPC_CHANNELS.ROUND_DELETE, id),
  // team
  listTeamsByEvent: (eventId: string) => invoke(IPC_CHANNELS.TEAM_LIST_BY_EVENT, eventId),
  getTeam: (id: string) => invoke(IPC_CHANNELS.TEAM_GET, id),
  createTeam: (data: any) => invoke(IPC_CHANNELS.TEAM_CREATE, data),
  updateTeam: (id: string, data: any) => invoke(IPC_CHANNELS.TEAM_UPDATE, id, data),
  deleteTeam: (id: string) => invoke(IPC_CHANNELS.TEAM_DELETE, id),
  // team history
  listTeamHistory: (teamId: string) => invoke(IPC_CHANNELS.TEAM_HISTORY_LIST, teamId),
  listTeamHistoryByEvent: (eventId: string) =>
    invoke(IPC_CHANNELS.TEAM_HISTORY_LIST_BY_EVENT, eventId),
  addTeamHistory: (data: any) => invoke(IPC_CHANNELS.TEAM_HISTORY_ADD, data),
  deleteTeamHistory: (id: string) => invoke(IPC_CHANNELS.TEAM_HISTORY_DELETE, id)
}

// ============================================================
// 抽取 API
// ============================================================
const drawAPI = {
  execute: (params: any) => invoke(IPC_CHANNELS.DRAW_EXECUTE, params),
  listSessions: (filter?: any) => invoke(IPC_CHANNELS.DRAW_LIST_SESSIONS, filter),
  getSession: (id: string) => invoke(IPC_CHANNELS.DRAW_GET_SESSION, id),
  deleteSession: (id: string) => invoke(IPC_CHANNELS.DRAW_DELETE_SESSION, id),
  listDrawnTopicIds: (eventId: string) =>
    invoke(IPC_CHANNELS.DRAW_LIST_DRAWN_TOPIC_IDS, eventId),
  redo: (oldSessionId: string, params: any) =>
    invoke(IPC_CHANNELS.DRAW_REDO, oldSessionId, params)
}

// ============================================================
// 审计 API
// ============================================================
const auditAPI = {
  listLogs: (filter?: any) => invoke(IPC_CHANNELS.AUDIT_LIST_LOGS, filter),
  addLog: (input: any) => invoke(IPC_CHANNELS.AUDIT_ADD_LOG, input),
  deleteLog: (id: string) => invoke(IPC_CHANNELS.AUDIT_DELETE_LOG, id),
  clearLogs: (beforeDate?: string) => invoke(IPC_CHANNELS.AUDIT_CLEAR_LOGS, beforeDate),
  exportLogs: (req: any) => invoke(IPC_CHANNELS.AUDIT_EXPORT_LOGS, req)
}

// ============================================================
// 系统设置 API
// ============================================================
const settingsAPI = {
  get: (key: string) => invoke(IPC_CHANNELS.SETTINGS_GET, key),
  set: (key: string, value: any) => invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  getAll: () => invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
  delete: (key: string) => invoke(IPC_CHANNELS.SETTINGS_DELETE, key)
}

// ============================================================
// 导入 API
// ============================================================
const importAPI = {
  parseFile: (filePath: string, fileType: 'xlsx' | 'csv' | 'docx') =>
    invoke(IPC_CHANNELS.IMPORT_PARSE_FILE, filePath, fileType),
  execute: (req: any) => invoke(IPC_CHANNELS.IMPORT_EXECUTE, req),
  findDuplicates: (topics: any[], options?: any) =>
    invoke(IPC_CHANNELS.IMPORT_FIND_DUPLICATES, topics, options)
}

// ============================================================
// 导出 API
// ============================================================
const exportAPI = {
  exportTopics: (req: any) => invoke(IPC_CHANNELS.EXPORT_TOPICS, req),
  exportDrawSessions: (req: any) => invoke(IPC_CHANNELS.EXPORT_DRAW_SESSIONS, req),
  exportEventPackage: (req: any) => invoke(IPC_CHANNELS.EXPORT_EVENT_PACKAGE, req)
}

// ============================================================
// 去重检查 API
// ============================================================
const dedupAPI = {
  run: (options?: any) => invoke(IPC_CHANNELS.DEDUP_RUN, options),
  deleteTopics: (ids: string[]) => invoke(IPC_CHANNELS.DEDUP_DELETE_TOPICS, ids)
}

// ============================================================
// 通用文件选择 API
// ============================================================
const fileAPI = {
  /** 调用主进程 dialog.showOpenDialog 选择单个文件，返回文件路径或 null */
  pickFile: (
    filters?: Array<{ name: string; extensions: string[] }>
  ) => invoke<string | null>('system:pickFile', filters)
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
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore
  window.topicAPI = topicAPI
  // @ts-ignore
  window.eventAPI = eventAPI
  // @ts-ignore
  window.drawAPI = drawAPI
  // @ts-ignore
  window.auditAPI = auditAPI
  // @ts-ignore
  window.settingsAPI = settingsAPI
  // @ts-ignore
  window.importAPI = importAPI
  // @ts-ignore
  window.exportAPI = exportAPI
  // @ts-ignore
  window.dedupAPI = dedupAPI
  // @ts-ignore
  window.fileAPI = fileAPI
}
