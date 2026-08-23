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
  UpdateStatusPayload,
  Match,
  MatchCreateInput,
  MatchUpdateInput,
  MatchSetResultInput,
  MatchAiReview,
  RecordingMeta,
  RecordingSaveResult,
  BoundRecording,
  RecordingBindAction,
  SttRequest,
  SttSegment,
  SttEngineStatus,
  SttImportResult,
  SttFfmpegStatus,
 type SttFunAsrStatus,
  type ScheduleDiffPreview,
  type ScheduleApplyResult,
  type BadgeItem,
  JudgeHistoryRecord,
  JudgeHistoryCreateInput,
  JudgeHistoryFilter,
  TopicGroup,
  GroupTopic,
  TopicGroupCreateInput,
  TopicGroupRenameInput,
  TopicGroupAddTopicsInput,
  TopicGroupRemoveTopicsInput,
  TopicGroupBatchAddInput,
  TopicGroupBatchRemoveInput,
  TopicGroupCopyInput,
  GroupCopyResult,
  EventBindGroupsInput,
  EventUnbindGroupInput,
  EventBankConfig,
  EventSetBankConfigInput,
  RoundBindGroupsInput,
  RoundUnbindGroupInput
} from '../shared/types'
import type { ExportJudgeReportRequest, ExportJudgeReportResult } from '../shared/types'
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

export interface ReportAPI {
  /** 导出复盘报告为 Markdown：主进程弹 saveDialog + 写文件；用户取消返回 data:null */
  exportJudge: (
    req: ExportJudgeReportRequest
  ) => Promise<ApiResponse<ExportJudgeReportResult | null>>
  /** 导出复盘为自包含 HTML（P2-9，含内联雷达图可视化）：主进程弹 saveDialog + 写文件；用户取消返回 data:null */
  exportJudgeHtml: (
    req: ExportJudgeReportRequest
  ) => Promise<ApiResponse<ExportJudgeReportResult | null>>
}

/** 赛程 Excel 导入导出（P1-6：与赛事「包」导入导出不同） */
export interface ScheduleAPI {
  /** 导出当前赛程为 xlsx：主进程弹保存对话框；用户取消返回 data:null */
  exportSchedule: (eventId: string) => Promise<ApiResponse<ExportResult | null>>
  /** 解析导入 xlsx → 「新增/更新/删除」变更预览（不写库） */
  importParse: (
    eventId: string,
    filePath: string
  ) => Promise<ApiResponse<ScheduleDiffPreview>>
  /** 确认后应用变更到比赛 */
  importApply: (
    eventId: string,
    preview: ScheduleDiffPreview
  ) => Promise<ApiResponse<ScheduleApplyResult>>
}

/** 队徽库（P1-6：内置/上传/搜索 · 队伍绑定，存 userData/badges） */
export interface BadgeAPI {
  /** 列出队徽库；可传关键字过滤（不含则返回全部） */
  list: (keyword?: string) => Promise<ApiResponse<BadgeItem[]>>
  /** 上传队徽：renderer 读取图片为 base64 后传入 */
  upload: (opts: { name: string; fileName: string; base64: string }) => Promise<ApiResponse<BadgeItem>>
  /** 删除自定义队徽 */
  delete: (id: string) => Promise<ApiResponse<boolean>>
  /** 取队徽 dataUrl（供 <img> 渲染） */
  getDataUrl: (id: string) => Promise<ApiResponse<string | null>>
  /** 绑定队伍 → 队徽 */
  setTeam: (teamId: string, badgeId: string) => Promise<ApiResponse<boolean>>
  /** 读取队伍已绑定队徽 id（未设置返回 null） */
  getTeam: (teamId: string) => Promise<ApiResponse<string | null | undefined>>
  /** 解绑队伍队徽 */
  clearTeam: (teamId: string) => Promise<ApiResponse<boolean>>
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
  /** 读取稿子文本文件内容（txt/md/docx，限 2MB；AI 裁判工作台 2026-08-18） */
  readTextFile: (filePath: string) => Promise<ApiResponse<string>>
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
  /** 获取应用运行元信息（是否打包环境） */
  getMeta: () => Promise<ApiResponse<{ isPackaged: boolean }>>
  /** 订阅状态变更，返回取消订阅函数 */
  onStatusChange: (cb: (payload: UpdateStatusPayload) => void) => () => void
}

export interface MatchAPI {
  create: (input: MatchCreateInput) => Promise<ApiResponse<Match | null>>
  get: (id: string) => Promise<ApiResponse<Match | null>>
  listByEvent: (eventId: string) => Promise<ApiResponse<Match[]>>
  listByRound: (roundId: string) => Promise<ApiResponse<Match[]>>
  update: (id: string, input: MatchUpdateInput) => Promise<ApiResponse<Match | null>>
  setResult: (id: string, input: MatchSetResultInput) => Promise<ApiResponse<Match | null>>
  setAiReview: (id: string, review: MatchAiReview) => Promise<ApiResponse<Match | null>>
  linkSession: (id: string, sessionId: string) => Promise<ApiResponse<Match | null>>
  delete: (id: string) => Promise<ApiResponse<boolean>>
}

export interface RecordingAPI {
  save: (fileName: string, data: ArrayBuffer | Uint8Array) => Promise<ApiResponse<RecordingSaveResult>>
  list: () => Promise<ApiResponse<RecordingMeta[]>>
  read: (filePath: string) =>
    Promise<ApiResponse<{ ok: boolean; base64?: string; fileName?: string; error?: string }>>
  delete: (fileName: string) => Promise<ApiResponse<boolean>>
  pickDir: () => Promise<ApiResponse<string | null>>
  getDir: () => Promise<ApiResponse<{ configured: string | null; effective: string }>>
  /** 多录音模型（T3/T4）：校验某份录音文件是否真实存在（缺失/被删除时用于禁用依赖它的操作） */
  exists: (filePath: string) => Promise<ApiResponse<boolean>>
  /** 多录音模型：列出某场比赛的有序录音列表（BoundRecording[]） */
  listForMatch: (matchId: string) => Promise<ApiResponse<BoundRecording[] | null>>
  /** 多录音模型：对一场比赛的录音列表做 增/删/换/整组 绑定（add/remove/replace/set） */
  bind: (action: RecordingBindAction) => Promise<ApiResponse<BoundRecording[] | null>>
}

export interface SttAPI {
  transcribe: (req: SttRequest) => Promise<ApiResponse<SttSegment[]>>
  status: (model?: string) => Promise<ApiResponse<SttEngineStatus>>
  funasrStatus: () => Promise<SttFunAsrStatus>
  funasrInstall: () => Promise<SttFunAsrInstallResult>
  download: (model: string) => Promise<ApiResponse<{ ok: true }>>
  cancelDownload: () => Promise<ApiResponse<{ ok: true }>>
  remove: () => Promise<ApiResponse<{ ok: true }>>
  importLocalModel: () => Promise<SttImportResult>
  ffmpegStatus: () => Promise<SttFfmpegStatus>
  downloadFfmpeg: () => Promise<SttFfmpegStatus>
  cancelFfmpeg: () => Promise<SttFfmpegStatus>
  removeFfmpeg: () => Promise<SttFfmpegStatus>
  pickWhisperCli: () => Promise<SttEngineStatus>
  clearWhisperCli: () => Promise<SttEngineStatus>
  pickFfmpegPath: () => Promise<SttFfmpegStatus>
  clearFfmpegPath: () => Promise<SttFfmpegStatus>
  /** 查询 stt 目录与模型/ffmpeg 在位状况（用于展示与丢失找回） */
  sttDirDiagnostics: () => Promise<ApiResponse<SttDirDiagnostics>>
}

/** AI 裁判历史（judge_history，T1/T2） */
export interface JudgeAPI {
  /** 列表查询；可按 eventId/roundId/matchId/toolName 筛选，按 created_at 倒序 */
  listHistory: (filter?: JudgeHistoryFilter) => Promise<ApiResponse<JudgeHistoryRecord[]>>
  /** 按 id 取单条历史 */
  getHistory: (id: string) => Promise<ApiResponse<JudgeHistoryRecord | undefined>>
  /** 保存一条裁判历史（工具成功结果） */
  saveHistory: (input: JudgeHistoryCreateInput) => Promise<ApiResponse<JudgeHistoryRecord>>
  /** 删除单条历史 */
  deleteHistory: (id: string) => Promise<ApiResponse<boolean>>
}

/** 题组（题库）API（赛事题库 T2 桥接） */
export interface GroupTopicAPI {
  /** 列出全部题组（默认题库在最前） */
  list: () => Promise<ApiResponse<TopicGroup[]>>
  /** 获取默认题库（幂等保证存在） */
  getDefaultTopicGroup: () => Promise<ApiResponse<TopicGroup>>
  /** 新建题组 */
  createGroup: (input: TopicGroupCreateInput) => Promise<ApiResponse<TopicGroup>>
  /** 重命名题组 */
  renameGroup: (input: TopicGroupRenameInput) => Promise<ApiResponse<TopicGroup>>
  /** 删除题组（默认题库返回失败） */
  deleteGroup: (id: string) => Promise<ApiResponse<boolean>>
  /** 列出某题组内的完整辩题 */
  listTopicsByGroup: (groupId: string) => Promise<ApiResponse<GroupTopic[]>>
  /** 往题组加入若干辩题（可多选） */
  addTopicsToGroup: (input: TopicGroupAddTopicsInput) => Promise<ApiResponse<number>>
  /** 从题组移除若干辩题 */
  removeTopicsFromGroup: (input: TopicGroupRemoveTopicsInput) => Promise<ApiResponse<number>>
  /** 批量把一组题同时加入多个题库（去重，忽略已存在成员） */
  batchAddToGroups: (input: TopicGroupBatchAddInput) => Promise<ApiResponse<number>>
  /** 从某题库批量移除若干辩题 */
  batchRemoveFromGroup: (input: TopicGroupBatchRemoveInput) => Promise<ApiResponse<number>>
  /** 整库复制：把源题库全部题复制到多个目标题库（去重，同库跳过） */
  copyGroupToGroup: (input: TopicGroupCopyInput) => Promise<ApiResponse<GroupCopyResult[]>>
  /** 整库移动：把源题库全部题移到多个目标题库，随后清空源 */
  moveGroupToGroup: (input: TopicGroupCopyInput) => Promise<ApiResponse<GroupCopyResult[]>>
  /** 列出某赛事绑定的题组 */
  listGroupsByEvent: (eventId: string) => Promise<ApiResponse<TopicGroup[]>>
  /** 给赛事绑定若干题组（可多选） */
  bindEventGroups: (input: EventBindGroupsInput) => Promise<ApiResponse<number>>
  /** 解绑赛事与某个题组的关联 */
  unbindEventGroup: (input: EventUnbindGroupInput) => Promise<ApiResponse<boolean>>
  /** 读赛事选题模式配置（缺省回退 single） */
  getEventBankConfig: (eventId: string) => Promise<ApiResponse<EventBankConfig>>
  /** 写赛事选题模式配置 */
  setEventBankConfig: (input: EventSetBankConfigInput) => Promise<ApiResponse<EventBankConfig | undefined>>
  /** 列出某轮次绑定的题组 */
  listGroupsByRound: (roundId: string) => Promise<ApiResponse<TopicGroup[]>>
  /** 给轮次绑定若干题组（可多选） */
  bindRoundGroups: (input: RoundBindGroupsInput) => Promise<ApiResponse<number>>
  /** 解绑轮次与某个题组的关联 */
  unbindRoundGroup: (input: RoundUnbindGroupInput) => Promise<ApiResponse<boolean>>
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
    scheduleAPI: ScheduleAPI
    badgeAPI: BadgeAPI
    reportAPI: ReportAPI
    dedupAPI: DedupAPI
    fileAPI: FileAPI
    systemAPI: SystemAPI
    customFieldAPI: CustomFieldAPI
    batchEditAPI: BatchEditAPI
    undoAPI: UndoAPI
    formatAPI: FormatAPI
    timerAPI: TimerAPI
    matchAPI: MatchAPI
    recordingAPI: RecordingAPI
    bellAPI: BellAPI
    backgroundAPI: BackgroundAPI
    updaterAPI: UpdaterAPI
    sttAPI: SttAPI
    judgeAPI: JudgeAPI
    groupAPI: GroupTopicAPI
  }
}

export {}
