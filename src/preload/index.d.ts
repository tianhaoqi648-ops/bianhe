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
  TeamGroup,
  TeamGroupCreateInput,
  TeamGroupUpdateInput,
  RandomAssignGroupParams,
  RandomAssignGroupResult,
  DrawSession,
  DrawSessionDetail,
  DrawSessionItem,
  DrawParams,
  DrawResult,
  SessionFilter,
  AuditLog,
  AuditLogFilter,
  AuditLogCreateInput,
  ImportExecuteRequest,
  ImportExecuteResult,
  ImportBatch,
  ImportEventPackageRequest,
  ImportEventPackageResult,
  ImportEventPackagePreviewResult,
  ParsedResult,
  FieldMapping,
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
  ResetDataResponse,
  CustomField,
  CustomFieldType,
  BatchEditExecuteRequest,
  BatchEditExecuteResult,
  BatchEditRevertResult,
  BatchEditHistory,
  UndoRequest,
  UndoResult,
  RedoRequest,
  RedoResult,
  UndoLogEntry,
  DebateFormat,
  DebateFormatData,
  TimerSession,
  TimerRecord,
  BackgroundFile,
  UpdateStatusPayload
} from '../shared/types'
import type { BellAsset, StageSide, TimerTheme } from '../shared/debate-formats/types'

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
  // team group（赛事分组）
  listGroups: (eventId: string) => Promise<ApiResponse<TeamGroup[]>>
  createGroup: (data: TeamGroupCreateInput) => Promise<ApiResponse<TeamGroup>>
  updateGroup: (id: string, patch: TeamGroupUpdateInput) => Promise<ApiResponse<TeamGroup>>
  deleteGroup: (id: string) => Promise<ApiResponse<void>>
  /** 将队伍分配到分组（groupId=null 表示移出分组） */
  assignTeamToGroup: (teamId: string, groupId: string | null) => Promise<ApiResponse<boolean>>
  /** 随机分组：将赛事下的队伍随机分配到多个分组 */
  randomAssignGroups: (
    params: RandomAssignGroupParams
  ) => Promise<ApiResponse<RandomAssignGroupResult>>
  /** 导入赛事包（Task 4 实现 IPC handler，当前为占位） */
  importEventPackage: (
    req: ImportEventPackageRequest
  ) => Promise<ApiResponse<ImportEventPackageResult>>
  /** 预览赛事包（解析 JSON 返回摘要，不写库） */
  previewEventPackage: (
    filePath: string
  ) => Promise<ApiResponse<ImportEventPackagePreviewResult>>
}

export interface DrawAPI {
  execute: (params: DrawParams) => Promise<ApiResponse<DrawResult>>
  listSessions: (filter?: SessionFilter) => Promise<ApiResponse<SessionListResponse>>
  getSession: (id: string) => Promise<ApiResponse<DrawSessionDetail | undefined>>
  deleteSession: (id: string) => Promise<ApiResponse<boolean>>
  listDrawnTopicIds: (eventId: string) => Promise<ApiResponse<string[]>>
  redo: (oldSessionId: string, params: DrawParams) => Promise<ApiResponse<DrawResult>>
  /** 确认抽取结果：写入队伍历史 + 标记 session 已确认。
   *  返回更新后的 session 详情（含 settings.confirmed=true） */
  confirmDrawSession: (sessionId: string) => Promise<ApiResponse<DrawSessionDetail | undefined>>
  /** Task 6.7：按 topic_id 查询最近一条多队模式抽取明细（大屏多队渲染用） */
  getItemByTopicId: (topicId: string) => Promise<ApiResponse<DrawSessionItem | undefined>>
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
  /** 应用字段映射到 ParsedResult（处理未识别列） */
  applyFieldMapping: (
    parsed: ParsedResult,
    fieldMapping: FieldMapping
  ) => Promise<ApiResponse<ParsedResult>>
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
  /** 调用主进程 dialog.showOpenDialog 选择单个文件，返回 ApiResponse 包裹的文件路径或 null */
  pickFile: (
    filters?: Array<{ name: string; extensions: string[] }>
  ) => Promise<ApiResponse<string | null>>
}

export interface SystemAPI {
  /**
   * 统一数据重置入口。
   * 配置类：删除 settings keys；数据类：清空对应业务表。
   * 返回各表删除行数。
   */
  resetData: (req: ResetDataRequest) => Promise<ApiResponse<ResetDataResponse>>
}

export interface CustomFieldAPI {
  list: () => Promise<ApiResponse<CustomField[]>>
  create: (label: string, type: CustomFieldType) => Promise<ApiResponse<CustomField>>
  update: (
    fieldKey: string,
    patch: Partial<Pick<CustomField, 'field_label' | 'sort_order'>>
  ) => Promise<ApiResponse<void>>
  delete: (fieldKey: string) => Promise<ApiResponse<void>>
}

export interface BatchEditAPI {
  /** 执行批量编辑（事务 + 快照 + 历史） */
  execute: (
    req: BatchEditExecuteRequest
  ) => Promise<ApiResponse<BatchEditExecuteResult>>
  /** 撤销一次批量编辑 */
  revert: (historyId: string) => Promise<ApiResponse<BatchEditRevertResult>>
  /** 列出最近 20 条批量编辑历史 */
  listHistory: () => Promise<ApiResponse<BatchEditHistory[]>>
}

export interface UndoAPI {
  /** 撤销最近一步操作（或指定 logId） */
  undo: (req?: UndoRequest) => Promise<ApiResponse<UndoResult>>
  /** 重做（占位，本阶段返回"暂未实现"） */
  redo: (req?: RedoRequest) => Promise<ApiResponse<RedoResult>>
  /** 列出最近 N 条 undo_log（默认 50） */
  listUndoLog: (limit?: number) => Promise<ApiResponse<UndoLogEntry[]>>
  /** 清空 undo_log 表（数据重置时调用） */
  clearUndoLog: () => Promise<ApiResponse<number>>
}

export interface FormatAPI {
  list: () => Promise<ApiResponse<DebateFormat[]>>
  get: (id: string) => Promise<ApiResponse<DebateFormat | null>>
  create: (opts: { name: string; description?: string; formatData: DebateFormatData }) => Promise<ApiResponse<DebateFormat>>
  update: (id: string, opts: { name?: string; description?: string; formatData?: DebateFormatData }) => Promise<ApiResponse<DebateFormat | null>>
  delete: (id: string) => Promise<ApiResponse<boolean>>
  seedPresets: () => Promise<ApiResponse<number>>
  /** 导入赛制（从 JSON 重建） */
  importFormat: (data: { name: string; description?: string; formatData: DebateFormatData }) => Promise<ApiResponse<DebateFormat>>
  /** 导出赛制为可序列化 JSON */
  exportFormat: (id: string) => Promise<ApiResponse<{ name: string; description: string; formatData: DebateFormatData } | null>>
}

export interface TimerAPI {
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
  }) => Promise<ApiResponse<TimerSession>>
  getSession: (id: string) => Promise<ApiResponse<TimerSession | null>>
  listSessions: (limit?: number) => Promise<ApiResponse<TimerSession[]>>
  updateSession: (id: string, opts: Partial<Pick<TimerSession, 'status' | 'startedAt' | 'endedAt' | 'currentStageIndex' | 'currentSide' | 'remainingMs' | 'stageRemainingCache' | 'affRemainingMs' | 'negRemainingMs'>>) => Promise<ApiResponse<TimerSession | null>>
  deleteSession: (id: string) => Promise<ApiResponse<boolean>>
  listRecords: (sessionId: string) => Promise<ApiResponse<TimerRecord[]>>
  /** 结束会话：状态置为 finished + 写 endedAt */
  finishSession: (id: string, endedAt: string) => Promise<ApiResponse<TimerSession | null>>
  /** 新增计时记录（环节开始时调用） */
  addRecord: (opts: {
    sessionId: string
    stageIndex: number
    stageName: string
    side: StageSide
    durationMs: number
    startedAt: string
  }) => Promise<ApiResponse<TimerRecord>>
  /** 完成计时记录（环节结束时调用，写 actualMs/endedAt/pauseCount） */
  finishRecord: (
    sessionId: string,
    stageIndex: number,
    actualMs: number,
    endedAt: string,
    pauseCount: number
  ) => Promise<ApiResponse<void>>
  /** 导出会话的所有计时记录 */
  exportRecords: (sessionId: string) => Promise<ApiResponse<TimerRecord[]>>
  /** 获取计时器主题配置 */
  getTheme: () => Promise<ApiResponse<TimerTheme>>
  /** 更新计时器主题配置（部分字段） */
  setTheme: (theme: Partial<TimerTheme>) => Promise<ApiResponse<TimerTheme>>
}

export interface BellAPI {
  /** 列出所有自定义铃声 */
  list: () => Promise<ApiResponse<BellAsset[]>>
  /** 上传铃声：renderer 读取文件为 base64 后传入 */
  upload: (opts: { name: string; fileName: string; base64: string; mimeType: string }) => Promise<ApiResponse<BellAsset>>
  /** 删除铃声（同时删除文件） */
  delete: (id: string) => Promise<ApiResponse<boolean>>
  /** 获取铃声 data URL（用于 <audio> 播放） */
  getDataUrl: (id: string) => Promise<ApiResponse<string | null>>
  /** 试听铃声：返回文件绝对路径，由渲染进程 HTML5 Audio 播放 */
  playBell: (bellId: string) => Promise<ApiResponse<{ filePath: string }>>
  /** 停止试听：通知主进程（实际停止由渲染进程完成） */
  stopBell: () => Promise<ApiResponse<boolean>>
}

export interface BackgroundAPI {
  /** 上传背景图片：renderer 读取文件为 base64 后传入 */
  upload: (
    fileName: string,
    base64: string
  ) => Promise<ApiResponse<{ id: string; fileName: string; fileUrl: string }>>
  /** 列出所有自定义背景图片 */
  list: () => Promise<ApiResponse<BackgroundFile[]>>
  /** 按 id 删除背景图片 */
  delete: (id: string) => Promise<ApiResponse<void>>
}

export interface UpdaterAPI {
  /** 检查更新（结果通过 onStatusChange 广播） */
  check: () => Promise<ApiResponse<void>>
  /** 下载更新（macOS 走 shell.openExternal，Windows/Linux 后台下载） */
  download: (releaseUrl?: string) => Promise<ApiResponse<void>>
  /** 退出并安装（仅 Windows/Linux） */
  install: () => Promise<ApiResponse<void>>
  /** 设置启动时自动检查开关 */
  setAutoCheck: (value: boolean) => Promise<ApiResponse<{ ok: true }>>
  /** 订阅状态变更，返回取消订阅函数 */
  onStatusChange: (cb: (payload: UpdateStatusPayload) => void) => () => void
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
    customFieldAPI: CustomFieldAPI
    batchEditAPI: BatchEditAPI
    undoAPI: UndoAPI
    formatAPI: FormatAPI
    timerAPI: TimerAPI
    bellAPI: BellAPI
    backgroundAPI: BackgroundAPI
    updaterAPI: UpdaterAPI
  }
}

export {}
