// ============================================================
// IPC 共享类型定义
//
// 此文件不依赖 main 或 renderer 任何模块，确保两侧都能安全引用。
// 业务实体类型在此独立声明，与 repository 中类型保持结构兼容。
// 主进程内部仍用 repository 类型，IPC 边界处 TypeScript 自动做结构化类型检查。
// ============================================================

import type { CandidateField } from './constants'
import type { DebateFormatData, StageSide, TimerTheme } from './debate-formats/types'

// ---------- 自定义字段相关类型 ----------

/** 自定义字段值类型（字符串或字符串数组） */
export type CustomFieldValue = string | string[]

/** 自定义字段类型 */
export type CustomFieldType = 'string' | 'tags' | 'number'

/** 自定义字段元数据（对应 topic_custom_fields 表行） */
export interface CustomField {
  /** 字段唯一 key（snake_case 或中文，用作 custom_data JSON 的键） */
  field_key: string
  /** 显示名 */
  field_label: string
  /** 字段类型 */
  field_type: CustomFieldType
  /** 排序序号 */
  sort_order: number
  /** 创建时间 ISO 字符串 */
  created_at: string
}

/** 字段定义（系统字段 + 自定义字段统一结构，用于导入字段映射 UI） */
export interface FieldDefinition {
  /** 字段 key（系统字段如 'type'，自定义字段如 'competition'） */
  key: string
  /** 显示名 */
  label: string
  /** 字段类型 */
  type: CustomFieldType
  /** 表头别名（仅系统字段预填，自定义字段为空数组） */
  aliases: string[]
  /** 是否系统字段（true 不能删除） */
  isSystem: boolean
  /** 是否可按维度统计（tags 类型用 listAllTags 或 listCustomFieldTags） */
  isCountable: boolean
  /** 字段描述（可选，用于 UI 提示） */
  description?: string
}

/** 导入时未识别列 → 字段绑定动作 */
export type FieldMappingAction =
  | { kind: 'ignore' }                                                     // 忽略该列
  | { kind: 'bind'; fieldKey: string }                                     // 绑定到已有字段（系统或自定义）
  | { kind: 'create'; fieldLabel: string; fieldType: CustomFieldType }     // 创建新自定义字段

/** 完整字段映射：原始列名 → 动作 */
export type FieldMapping = Record<string, FieldMappingAction>

// ---------- 业务实体（结构等价于 repository 中的类型） ----------

export interface Topic {
  id: string
  title: string
  type: string | null
  domain: string | null
  difficulty: string | null
  source: string | null
  source_type: string | null
  tags: string[] | null
  weight: number
  status: string
  batch_id: string | null
  created_at: string
  updated_at: string
  /** 自定义字段值（key → value），来自 topics.custom_data JSON 列 */
  custom_data?: Record<string, CustomFieldValue> | null
}

export interface TopicFilter {
  type?: string
  domain?: string
  difficulty?: string
  source?: string
  source_type?: string
  status?: string
  tags?: string[]
  keyword?: string
  page?: number
  pageSize?: number
  batch_id?: string
  // 多选字段（与上面单值字段二选一使用，数组优先）
  types?: string[]
  domains?: string[]
  difficulties?: string[]
  /** 自定义字段筛选：fieldKey → 目标值（仅支持 string 类型字段，tags 类型用 tags 数组语义） */
  custom_filters?: Record<string, string>
}

export interface TopicCreateInput {
  title: string
  type?: string | null
  domain?: string | null
  difficulty?: string | null
  source?: string | null
  source_type?: string | null
  tags?: string[] | null
  weight?: number
  status?: string
  batch_id?: string | null
  /** 自定义字段值 */
  custom_data?: Record<string, CustomFieldValue> | null
}

export interface TopicUpdateInput {
  title?: string
  type?: string | null
  domain?: string | null
  difficulty?: string | null
  source?: string | null
  source_type?: string | null
  tags?: string[] | null
  weight?: number
  status?: string
  /** 自定义字段值（整体覆盖） */
  custom_data?: Record<string, CustomFieldValue> | null
}

export interface Event {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  status: string | null
  created_at: string | null
  /** 是否允许辩题重复（0=不允许, 1=允许，对应有放回抽样） */
  allow_repeat?: number
}

export interface EventFilter {
  status?: string
  page?: number
  pageSize?: number
}

export interface EventCreateInput {
  name: string
  start_date?: string | null
  end_date?: string | null
  status?: string | null
  /** 是否允许辩题重复（0=不允许, 1=允许），未传时默认 0 */
  allow_repeat?: number
}

export interface EventUpdateInput {
  name?: string
  start_date?: string | null
  end_date?: string | null
  status?: string | null
  /** 是否允许辩题重复（0=不允许, 1=允许） */
  allow_repeat?: number
}

export interface Round {
  id: string
  event_id: string
  name: string | null
  round_number: number | null
  difficulty_override: string | null
  topic_count: number | null
  /** 是否为循环赛轮次（DB 中存为 0/1，应用层使用 boolean） */
  is_round_robin?: boolean
}

export interface RoundCreateInput {
  event_id: string
  name?: string | null
  round_number?: number | null
  difficulty_override?: string | null
  topic_count?: number | null
  is_round_robin?: boolean
}

export interface RoundUpdateInput {
  name?: string | null
  round_number?: number | null
  difficulty_override?: string | null
  topic_count?: number | null
  is_round_robin?: boolean
}

export interface Team {
  id: string
  name: string
  event_id: string
  /** 所属分组 id（可空，未分组为 null） */
  group_id?: string | null
}

export interface TeamCreateInput {
  name: string
  event_id: string
  /** 所属分组 id（null 表示不分组） */
  group_id?: string | null
}

export interface TeamUpdateInput {
  name?: string
  /** 所属分组 id（null 表示移出分组） */
  group_id?: string | null
}

/** 队伍分组（赛事维度，用于多队同题抽取） */
export interface TeamGroup {
  id: string
  event_id: string
  name: string
  sort_order: number
  created_at: string
}

export interface TeamGroupCreateInput {
  event_id: string
  name: string
  sort_order?: number
}

export interface TeamGroupUpdateInput {
  name?: string
  sort_order?: number
}

/** 随机分组请求参数 */
export interface RandomAssignGroupParams {
  event_id: string;
  strategy: 'by_group_count' | 'by_team_count';
  count: number;
  group_names?: string[];
  overwrite: boolean;
  dry_run?: boolean;
}

/** 随机分组结果 */
export interface RandomAssignGroupResult {
  groups_plan: Array<{ name: string; team_ids: string[]; team_names: string[] }>;
  groups_created: number;
  teams_assigned: number;
}

export interface TeamHistory {
  id: string
  team_id: string
  topic_id: string
  event_id: string
  played_at: string | null
  /** 关联抽取会话 id，用于确认结果时关联去重（重抽时先按 session_id 删旧再写新） */
  session_id?: string | null
}

export interface TeamHistoryCreateInput {
  team_id: string
  topic_id: string
  event_id: string
  played_at?: string | null
  /** 关联抽取会话 id（可选，由"确定抽取结果"流程写入） */
  session_id?: string | null
  /** 持方快照：正方/反方（确认抽取结果时从 DrawSessionItem.stance_a/stance_b 复制） */
  stance?: string | null
}

export interface DrawSessionSettings {
  source_mix_ratio?: number
  difficulty_override?: Record<string, number>
  include_stance?: boolean
  team_pairs?: Array<{ team_a_id: string; team_b_id: string }>
  filter?: TopicFilter
  /** 抽取结果是否已确认写入队伍历史 */
  confirmed?: boolean
  /** 单人持方模式：记录抽取时使用的队伍 id */
  solo_team_id?: string | null
  /** 抽取模式：'versus' 对战（默认）/ 'group' 分组同题 / 'multi_team' 多队同题 */
  draw_mode?: 'versus' | 'group' | 'multi_team'
  /** group 模式下参与抽取的分组 id 列表 */
  group_ids?: string[]
  /** multi_team 模式下每道题同题的队伍数（>=2） */
  teams_per_topic?: number
  /** 实际抽取的题数（由 draw-engine 写入，group/multi_team 模式下可能覆盖用户传入值） */
  topic_count?: number
  /** 测试模式标记：true 表示该 session 为测试抽取，不写入队伍历史 */
  is_test?: boolean
}

export interface DrawSession {
  id: string
  event_id: string
  round_id: string | null
  draw_time: string | null
  operator: string | null
  settings: DrawSessionSettings | null
}

export interface DrawSessionItem {
  id: string
  session_id: string
  topic_id: string
  team_a_id: string | null
  team_b_id: string | null
  stance_a: string | null
  stance_b: string | null
  /** 冗余快照：辩题标题（避免硬删除后显示 ID 片段） */
  topic_title?: string | null
  /** 冗余快照：A 方队伍名 */
  team_a_name?: string | null
  /** 冗余快照：B 方队伍名 */
  team_b_name?: string | null
  /** 多队同题模式下的队伍 id 列表（versus 模式为空，仍使用 team_a_id/team_b_id）。
   *  DB 中存为 JSON 字符串，应用层使用数组。 */
  team_ids?: string[] | null
  /** 多队持方快照（与 team_ids 一一对应）。DB 中存为 JSON 字符串，应用层使用数组。 */
  team_stances?: string[] | null
  /** 队伍名快照（与 team_ids 一一对应）。DB 中存为 JSON 字符串，应用层使用数组。 */
  team_names?: string[] | null
  /** 分组模式下的所属分组 id */
  group_id?: string | null
}

export interface DrawSessionDetail extends DrawSession {
  items: DrawSessionItem[]
}

export interface SessionFilter {
  event_id?: string
  round_id?: string
  operator?: string
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}

export interface AuditLogDetail {
  action?: string
  count?: number
  ids?: string[]
  reason?: string
  [key: string]: unknown
}

export interface AuditLog {
  id: string
  action: string | null
  target_type: string | null
  target_id: string | null
  operator: string | null
  detail: AuditLogDetail | null
  created_at: string | null
}

export interface AuditLogFilter {
  action?: string
  target_type?: string
  operator?: string
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}

export interface AuditLogCreateInput {
  action: string
  target_type: string
  target_id: string
  operator: string
  detail?: Record<string, any>
}

// ---------- 抽取引擎相关类型 ----------

export interface SourceMixRatio {
  /** 官方题源占比，0~1 */
  official: number
  /** 自定义题源占比，0~1 */
  custom: number
}

export interface DrawParams {
  event_id: string
  round_id?: string | null
  topic_count: number
  include_stance: boolean
  teams?: Team[]
  filters?: TopicFilter
  source_mix_ratio?: SourceMixRatio
  operator?: string
  /** 单人持方模式：传一支队伍 id，引擎为每道题随机分配正反方 */
  solo_team_id?: string
  /** 抽取模式：'versus' 对战（默认）/ 'group' 分组同题 / 'multi_team' 多队同题 */
  draw_mode?: 'versus' | 'group' | 'multi_team'
  /** group 模式下参与抽取的分组 id 列表 */
  group_ids?: string[]
  /** multi_team 模式下每道题同题的队伍数（>=2） */
  teams_per_topic?: number
  /**
   * v6 新增：标记 teams 是否来自用户 TeamPairing 配置。
   * - true：teams 来自 TeamPairing 扁平化，multi_team 引擎应保留配对顺序，不 shuffle
   * - false 或未传：teams 来自 eventStore 或其他来源，multi_team 引擎应 shuffle
   * - group 模式不使用此标记（总是 shuffle 同组队伍，确保随机对阵）
   */
  user_pairing?: boolean
  /** 测试模式：跳过 applyExclusions、不写 team_history、settings.is_test=true、自动 allow_repeat */
  test_mode?: boolean
  /** 允许辩题重复：跳过题池不足检查，使用有放回抽样 */
  allow_repeat?: boolean
  /** P3.1 Task 1：揭晓动画模式（仅客户端使用，引擎忽略此字段） */
  reveal_mode?: 'flip' | 'tear' | 'spotlight' | 'fade'
}

export interface DrawResult {
  session: DrawSessionDetail
  topics: Topic[]
  actual_ratio?: { official: number; custom: number }
}

// ---------- 去重引擎相关类型 ----------

export type DuplicateReason = 'exact' | 'levenshtein' | 'keyword' | 'ai'

export interface DuplicateGroup {
  id: string
  topics: Topic[]
  similarity: number
  reason: DuplicateReason
}

export interface DedupOptions {
  levenshteinThreshold?: number
  keywordThreshold?: number
  aiThreshold?: number
  similarityFn?: (a: Topic, b: Topic) => Promise<number>
}

// ---------- 导入引擎相关类型 ----------

export type FileType = 'xlsx' | 'csv' | 'docx'

export interface ParsedResult {
  topics: TopicCreateInput[]
  mapping: Record<string, string>
  warnings: string[]
  /** 检测到的非系统候选值（按字段分组） */
  unknownValues?: UnknownValueItem[]
  /** 未识别的原始表头列名（未在系统字段别名表中命中），由 FieldMappingPanel 让用户绑定 */
  unmatchedColumns?: string[]
  /** 原始表格数据（xlsx/csv/docx 表格分支填充），供 applyFieldMapping 重新解析使用 */
  rawTable?: RawTableData
}

/** 原始表格数据：表头 + 数据行（rows[0] 通常为表头） */
export interface RawTableData {
  headers: string[]
  rows: any[][]
}

// ---------- 统一响应封装 ----------

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  /**
   * 撤销日志 ID（仅写操作返回）。
   * - string：成功创建 undo_log，可用于精确撤销/重做
   * - null：payload 超限或其他原因未入栈，该操作不可撤销
   * - undefined：非写操作（如 list/get/count），无 undo_log
   *
   * C1 修复：渲染进程据 logId 判断是否入栈，避免与 DB 失同步。
   */
  _undoLogId?: string | null
}

export type ApiResult<T = unknown> = ApiResponse<T>

// ---------- P3.4 稳定性扩展：ElectronAPI 增强类型 ----------

/** 数据库模式：'persistent' 持久化 / 'memory' 临时（降级） */
export type DbMode = 'persistent' | 'memory'

/** 错误日志输入（与主进程 logs/index.ts ErrorLogInput 对齐） */
export interface ErrorLogInput {
  name: string
  message: string
  stack: string
  timestamp: string
}

/** 备份文件信息 */
export interface BackupInfo {
  filename: string
  size: number
  mtime: string
}

/**
 * db:status 监听 API。
 * - onChange(cb): 订阅 db 模式变化，返回取消订阅函数
 * - getMode(): 同步查询当前 db 模式（通过 invoke）
 */
export interface DbStatusAPI {
  onChange(cb: (mode: DbMode) => void): () => void
  getMode(): Promise<DbMode>
}

/** 错误日志 API */
export interface LogsAPI {
  writeError(error: ErrorLogInput): Promise<void>
}

/** 备份 API */
export interface BackupAPI {
  run(): Promise<ApiResponse<{ ok: true }>>
  list(): Promise<ApiResponse<BackupInfo[]>>
  restore(filename: string): Promise<ApiResponse<{ ok: true }>>
  delete(filename: string): Promise<ApiResponse<{ ok: true }>>
  /** 全量导出：选择保存位置 + 写入 JSON 备份文件 */
  export(params: BackupParams): Promise<ApiResponse<BackupExportResult>>
  /** 预览导入文件 */
  previewImport(filePath: string): Promise<ApiResponse<BackupPreviewResult>>
  /** 执行全量导入 */
  import(params: BackupImportParams): Promise<ApiResponse<BackupImportResult>>
  /** 获取各类别本地数据条数统计（用于备份弹窗展示） */
  stats(): Promise<ApiResponse<Record<string, number>>>
}

/**
 * 通过声明合并扩展 @electron-toolkit/preload 的 ElectronAPI 接口。
 *
 * 主进程 preload 通过 contextBridge.exposeInMainWorld('electron', extendedElectronAPI)
 * 暴露这些 API，渲染进程可通过 window.electron.dbStatus / .logs / .backup 访问。
 * 字段声明为可选（?:），便于在测试环境或不暴露时不报错。
 */
declare module '@electron-toolkit/preload' {
  interface ElectronAPI {
    dbStatus?: DbStatusAPI
    logs?: LogsAPI
    backup?: BackupAPI
  }
}

// ---------- 全量数据备份与恢复 ----------

export type BackupCategory =
  | 'topics'
  | 'events'
  | 'draw_records'
  | 'timer'
  | 'formats_bells'
  | 'settings'
  | 'audit_history'

export type BackupImportStrategy = 'clear_rebuild' | 'skip_existing' | 'overwrite_existing'

export interface BackupParams {
  categories: BackupCategory[]
}

export interface BackupImportParams {
  filePath: string
  strategy: BackupImportStrategy
  /** 仅导入这些类别 */
  categories: BackupCategory[]
}

export interface BackupPackage {
  version: string
  exportedAt: string
  appVersion: string
  categories: BackupCategory[]
  tables: Record<string, any[]> | Record<string, Record<string, string>>
}

export interface BackupPreviewResult {
  version: string
  exportedAt: string
  appVersion: string
  categories: BackupCategory[]
  tableCounts: Record<string, number>
}

export interface BackupExportResult {
  filePath: string
  totalRecords: number
  bellFilesCount: number
}

export interface BackupImportResult {
  inserted: number
  skipped: number
  overwritten: number
  bellFilesRestored: number
}

// ---------- 标签显示配置 ----------

/** 标签类别（受 tagDisplay 配置控制） */
export type TagCategory = 'type' | 'difficulty' | 'source_type' | 'custom';

/** 标签显示场景 */
export type TagDisplayScene =
  | 'library'      // 题库浏览
  | 'drawResult'   // 抽取结果
  | 'bigScreen'    // 大屏投影
  | 'filter'       // 筛选面板
  | 'dedup';       // 去重检查

/** 单场景配置：4 类别开关 + 每类白名单 */
export interface SceneTagConfig {
  /** 各类别开关 */
  categoryEnabled: {
    type: boolean;
    difficulty: boolean;
    source_type: boolean;
    custom: boolean;
  };
  /** 各类别选中的标签值（白名单）。空数组=显示该类别全部，非空=只显示选中的 */
  selectedValues: {
    type: string[];
    difficulty: string[];
    source_type: string[];
    custom: string[];
  };
}

/**
 * 标签显示配置（存储在 settings 表 key='ui.tagDisplay'）
 *
 * 行为（每个场景独立）：
 * - categoryEnabled[cat]=false：不显示该类别任何标签
 * - categoryEnabled[cat]=true + selectedValues[cat] 空：显示该类别全部
 * - categoryEnabled[cat]=true + selectedValues[cat] 非空：只显示选中的
 */
export interface TagDisplayConfig {
  /** 5 个场景独立配置 */
  scenes: Record<TagDisplayScene, SceneTagConfig>;
}

// ---------- 通道名常量 ----------
// 命名规范：'<domain>:<action>'，例 'topic:list'、'draw:execute'

export const IPC_CHANNELS = {
  // topic
  TOPIC_LIST: 'topic:list',
  TOPIC_GET: 'topic:get',
  TOPIC_CREATE: 'topic:create',
  TOPIC_UPDATE: 'topic:update',
  TOPIC_DELETE: 'topic:delete',
  TOPIC_BATCH_DELETE: 'topic:batchDelete',
  TOPIC_UPDATE_STATUS: 'topic:updateStatus',
  TOPIC_UPDATE_WEIGHT: 'topic:updateWeight',
  TOPIC_COUNT: 'topic:count',
  TOPIC_COUNT_BY_DIMENSION: 'topic:countByDimension',
  TOPIC_LIST_ALL_TAGS: 'topic:listAllTags',
  TOPIC_LIST_VALUES: 'topic:listValues',
  TOPIC_LIST_CUSTOM_FIELD_TAGS: 'topic:listCustomFieldTags',
  // event
  EVENT_LIST: 'event:list',
  EVENT_GET: 'event:get',
  EVENT_CREATE: 'event:create',
  EVENT_UPDATE: 'event:update',
  EVENT_DELETE: 'event:delete',
  // round
  ROUND_LIST_BY_EVENT: 'round:listByEvent',
  ROUND_GET: 'round:get',
  ROUND_CREATE: 'round:create',
  ROUND_UPDATE: 'round:update',
  ROUND_DELETE: 'round:delete',
  // team
  TEAM_LIST_BY_EVENT: 'team:listByEvent',
  TEAM_GET: 'team:get',
  TEAM_CREATE: 'team:create',
  TEAM_UPDATE: 'team:update',
  TEAM_DELETE: 'team:delete',
  // team group（赛事分组，多队同题抽取）
  TEAM_GROUP_LIST: 'group:list',
  TEAM_GROUP_CREATE: 'group:create',
  TEAM_GROUP_UPDATE: 'group:update',
  TEAM_GROUP_DELETE: 'group:delete',
  TEAM_ASSIGN_GROUP: 'team:assignGroup',
  TEAM_RANDOM_ASSIGN_GROUP: 'team:randomAssignGroup',
  // team_history
  TEAM_HISTORY_LIST: 'teamHistory:list',
  TEAM_HISTORY_LIST_BY_EVENT: 'teamHistory:listByEvent',
  TEAM_HISTORY_ADD: 'teamHistory:add',
  TEAM_HISTORY_DELETE: 'teamHistory:delete',
  // draw
  DRAW_EXECUTE: 'draw:execute',
  DRAW_LIST_SESSIONS: 'draw:listSessions',
  DRAW_GET_SESSION: 'draw:getSession',
  DRAW_DELETE_SESSION: 'draw:deleteSession',
  DRAW_LIST_DRAWN_TOPIC_IDS: 'draw:listDrawnTopicIds',
  DRAW_REDO: 'draw:redo',
  DRAW_CONFIRM_SESSION: 'draw:confirmSession',
  /** Task 6.7：按 topic_id 查询最近一条多队模式（team_ids 非空）的抽取明细，供大屏多队渲染 */
  DRAW_GET_ITEM_BY_TOPIC: 'draw:getItemByTopicId',
  // audit
  AUDIT_LIST_LOGS: 'audit:listLogs',
  AUDIT_ADD_LOG: 'audit:addLog',
  AUDIT_DELETE_LOG: 'audit:deleteLog',
  AUDIT_CLEAR_LOGS: 'audit:clearLogs',
  AUDIT_EXPORT_LOGS: 'audit:exportLogs',
  // settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_DELETE: 'settings:delete',
  SETTINGS_DELETE_BATCH: 'settings:deleteBatch',
  // import
  IMPORT_PARSE_FILE: 'import:parseFile',
  IMPORT_EXECUTE: 'import:execute',
  IMPORT_FIND_DUPLICATES: 'import:findDuplicates',
  IMPORT_REVOKE_BATCH: 'import:revokeBatch',
  IMPORT_LIST_BATCHES: 'import:listBatches',
  IMPORT_APPLY_FIELD_MAPPING: 'import:applyFieldMapping',
  IMPORT_EVENT_PACKAGE: 'import:eventPackage',
  IMPORT_EVENT_PACKAGE_PREVIEW: 'import:eventPackagePreview',
  // export
  EXPORT_TOPICS: 'export:topics',
  EXPORT_DRAW_SESSIONS: 'export:drawSessions',
  EXPORT_EVENT_PACKAGE: 'export:eventPackage',
  // dedup
  DEDUP_RUN: 'dedup:run',
  DEDUP_DELETE_TOPICS: 'dedup:deleteTopics',
  // system
  SYSTEM_PICK_FILE: 'system:pickFile',
  SYSTEM_GET_CANDIDATES: 'system:getCandidates',
  SYSTEM_RESET_DATA: 'system:resetData',
  // custom field
  CUSTOM_FIELD_LIST: 'customField:list',
  CUSTOM_FIELD_CREATE: 'customField:create',
  CUSTOM_FIELD_UPDATE: 'customField:update',
  CUSTOM_FIELD_DELETE: 'customField:delete',
  // batch edit
  BATCH_EDIT_EXECUTE: 'batchEdit:execute',
  BATCH_EDIT_REVERT: 'batchEdit:revert',
  BATCH_EDIT_LIST_HISTORY: 'batchEdit:listHistory',
  // undo/redo
  SYSTEM_UNDO: 'system:undo',
  SYSTEM_REDO: 'system:redo',
  SYSTEM_LIST_UNDO_LOG: 'system:listUndoLog',
  SYSTEM_CLEAR_UNDO_LOG: 'system:clearUndoLog',
  // format
  FORMAT_LIST: 'format:list',
  FORMAT_GET: 'format:get',
  FORMAT_CREATE: 'format:create',
  FORMAT_UPDATE: 'format:update',
  FORMAT_DELETE: 'format:delete',
  FORMAT_SEED_PRESETS: 'format:seedPresets',
  // timer
  TIMER_CREATE_SESSION: 'timer:createSession',
  TIMER_GET_SESSION: 'timer:getSession',
  TIMER_LIST_SESSIONS: 'timer:listSessions',
  TIMER_UPDATE_SESSION: 'timer:updateSession',
  TIMER_DELETE_SESSION: 'timer:deleteSession',
  TIMER_LIST_RECORDS: 'timer:listRecords',
  TIMER_FINISH_SESSION: 'timer:finishSession',
  TIMER_ADD_RECORD: 'timer:addRecord',
  TIMER_FINISH_RECORD: 'timer:finishRecord',
  TIMER_EXPORT_RECORDS: 'timer:exportRecords',
  TIMER_THEME_GET: 'timer:themeGet',
  TIMER_THEME_SET: 'timer:themeSet',
  BELL_ASSET_LIST: 'bell:list',
  BELL_ASSET_UPLOAD: 'bell:upload',
  BELL_ASSET_DELETE: 'bell:delete',
  BELL_ASSET_GET_DATA_URL: 'bell:getDataUrl',
  BELL_PLAY: 'bell:play',
  BELL_STOP: 'bell:stop',
  // background (计时器自定义背景图片)
  BACKGROUND_UPLOAD: 'background:upload',
  BACKGROUND_LIST: 'background:list',
  BACKGROUND_DELETE: 'background:delete',
  FORMAT_IMPORT: 'format:import',
  FORMAT_EXPORT: 'format:export',
  // backup (DB 文件级备份与恢复)
  BACKUP_RUN: 'backup:run',
  BACKUP_LIST: 'backup:list',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_DELETE: 'backup:delete',
  // backup (全量数据备份与恢复)
  BACKUP_EXPORT: 'backup:export',
  BACKUP_PREVIEW_IMPORT: 'backup:previewImport',
  BACKUP_IMPORT: 'backup:import',
  BACKUP_STATS: 'backup:stats',
  // db 状态与错误日志
  DB_STATUS: 'db:status',
  DB_GET_MODE: 'db:get-mode',
  DB_LOGS_WRITE: 'logs:write'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

// ---------- 请求参数类型（多参数场景） ----------

export interface ImportExecuteRequest {
  topics: TopicCreateInput[]
  /** 是否在导入前对库内已有辩题做去重检查（默认 true） */
  checkDuplicates?: boolean
  /** 导入文件名（用于批次记录） */
  fileName?: string
  /** 新值映射规则（渲染进程已应用 map 改写 topics，主进程仅需持久化 add） */
  valueMapping?: ValueMapping
}

export interface ImportExecuteResult {
  imported: number
  duplicates: number
  failed: number
  duplicateGroups: Array<{
    title: string
    existingIds: string[]
  }>
  /** 本次导入的批次 id（用于撤销） */
  batchId?: string
}

/** 导入批次记录 */
export interface ImportBatch {
  id: string
  file_name: string
  total_count: number
  imported_count: number
  duplicates_count: number
  failed_count: number
  imported_at: string
  notes: string | null
  /** 当前剩余题数（listBatches 时返回，用户可能已单独删除部分） */
  remainingCount?: number
}

// ---------- 新值映射（导入时处理非系统候选值） ----------

/** 新值映射动作 */
export type ValueMappingAction = 'keep' | 'map' | 'add'

/** 单条映射规则 */
export interface ValueMappingRule {
  action: ValueMappingAction
  /** action='map' 时必填，目标候选值 */
  target?: string
}

/** 完整映射结构：field → 原值 → 规则 */
export type ValueMapping = Partial<Record<CandidateField, Record<string, ValueMappingRule>>>

/** 检测到的新值（按字段分组，含出现次数） */
export interface UnknownValueItem {
  field: CandidateField
  values: Array<{ value: string; count: number }>
}

export interface ExportLogsRequest {
  filter?: AuditLogFilter
  format: 'csv' | 'json'
}

export interface ExportLogsResult {
  filePath: string
  count: number
}

// ---------- 导出相关类型 ----------

export type ExportFormat = 'xlsx' | 'csv' | 'json'

export interface ExportTopicsRequest {
  /** 筛选条件，留空则导出全部 */
  filter?: TopicFilter
  /** 导出格式 */
  format: ExportFormat
}

export interface ExportDrawSessionsRequest {
  /** 筛选条件，留空则导出全部 */
  filter?: SessionFilter
  /** 导出格式 */
  format: ExportFormat
}

export interface ExportEventPackageRequest {
  /** 赛事 id */
  eventId: string
}

export interface ExportResult {
  filePath: string
  count: number
}

/** 赛事包导入请求（Task 4 实现 IPC handler） */
export interface ImportEventPackageRequest {
  /** 导入文件路径（JSON） */
  filePath: string
  /** 冲突处理策略：skip 跳过 / overwrite 先删后建 / rename 加后缀 */
  conflictStrategy?: 'skip' | 'overwrite' | 'rename'
}

/** 赛事包导入结果摘要（Task 4 实现） */
export interface ImportEventPackageResult {
  /** 导入的赛事 id */
  eventId: string
  /** 导入的轮次数 */
  roundCount: number
  /** 导入的队伍数 */
  teamCount: number
  /** 导入的分组数 */
  groupCount: number
  /** 冲突处理策略实际应用情况 */
  strategy: 'skip' | 'overwrite' | 'rename'
  /** 若 rename，原赛事名 */
  originalName?: string
  /** 若 rename，新赛事名 */
  renamedTo?: string
}

/** 赛事包预览结果（导入前解析 JSON 得到的摘要，用于 ImportEventModal 展示） */
export interface ImportEventPackagePreviewResult {
  /** 赛事名 */
  eventName: string
  /** 轮次数 */
  roundCount: number
  /** 队伍数 */
  teamCount: number
  /** 分组数 */
  groupCount: number
  /** 抽取会话数 */
  drawSessionCount: number
  /** 队伍历史记录数 */
  teamHistoryCount: number
  /** 是否与库内已有赛事同名（冲突检测） */
  hasConflict: boolean
  /** 导出时间（ISO 字符串，可选） */
  exportedAt?: string
}

// ---------- 去重检查相关类型 ----------

export interface DedupRunResult {
  groups: DuplicateGroup[]
  totalCount: number
  duplicateCount: number
}

// ---------- 路由跳转上下文 ----------

export interface DrawPageLocationState {
  eventId?: string
  roundId?: string
}

// ---------- 数据重置相关类型 ----------

/** 数据重置请求（前端 → 主进程） */
export interface ResetDataRequest {
  /** 配置类要重置的 settings keys 并集（来自 dedup/tagDisplay/candidates/hotkeys/timerTheme） */
  configKeys: string[]
  /** 数据类重置选项 */
  dataOptions: {
    /** 题库：keepOfficial=true 保留官方题库，false 清空全部 */
    topics?: { keepOfficial: boolean }
    /** 赛事（级联删除 rounds/teams/team_history/draw_sessions/draw_session_items） */
    events?: boolean
    /** 抽取会话（级联删除 items） */
    drawSessions?: boolean
    /** 导入批次元数据记录 */
    importBatches?: boolean
    /** 审计日志 */
    auditLogs?: boolean
    /** 批量编辑历史（含明细，级联删除） */
    batchEditHistory?: boolean
    /** 撤销历史（undo_log 表） */
    undoLog?: boolean
    /** 计时会话（timer_sessions 表） */
    timerSessions?: boolean
    /** 计时记录（timer_records 表） */
    timerRecords?: boolean
    /** 自定义赛制（仅 is_preset=0，保留内置预设） */
    debateFormats?: boolean
    /** 自定义铃声（bell_assets 表 + userData/bells/ 文件） */
    customBells?: boolean
  }
}

/** 数据重置响应（主进程 → 前端） */
export interface ResetDataResponse {
  /** 配置类：删除的 settings key 数量 */
  configDeleted: number
  /** 数据类：各表删除行数 */
  topicsDeleted: number
  eventsDeleted: number
  drawSessionsDeleted: number
  importBatchesDeleted: number
  auditLogsDeleted: number
  /** 批量编辑历史删除行数（主表行数；明细由 CASCADE 删除） */
  batchEditHistoryDeleted: number
  /** 撤销历史删除行数（undo_log 表） */
  undoLogDeleted: number
  /** 计时会话删除行数 */
  timerSessionsDeleted: number
  /** 计时记录删除行数 */
  timerRecordsDeleted: number
  /** 自定义赛制删除行数（不含预设） */
  debateFormatsDeleted: number
  /** 自定义铃声删除行数 */
  customBellsDeleted: number
  /** 题库子选项是否保留了官方题库 */
  officialKept: boolean
}

// ---------- 批量编辑相关类型 ----------

/**
 * 单字段编辑动作。
 * - field：系统字段名（type/domain/difficulty/source/source_type/status/weight/tags）
 *          或自定义字段 key
 * - mode：
 *   - replace：替换字段值
 *   - append：仅 tags 类型字段追加（去重）
 *   - clear：清空字段值（设为 null）
 * - value：目标值（mode='clear' 时忽略）
 *   - tags 类型：string[]
 *   - weight 类型：number
 *   - 其他：string
 */
export interface BatchEditFieldAction {
  /** 目标字段 key */
  field: string
  /** 编辑模式 */
  mode: 'replace' | 'append' | 'clear'
  /** 目标值（mode='clear' 时忽略） */
  value?: string | string[] | number
}

/** 批量编辑执行请求 */
export interface BatchEditExecuteRequest {
  /** 目标 topic id 列表（已由 store.getSelectedIdsForBatchOp 解析） */
  topicIds: string[]
  /** 字段编辑动作列表 */
  actions: BatchEditFieldAction[]
}

/** 批量编辑执行结果 */
export interface BatchEditExecuteResult {
  /** 历史记录 id（用于撤销） */
  historyId: string
  /** 实际更新的 topic 数量 */
  affectedCount: number
  /** 实际应用变更的字段数 */
  fieldCount: number
}

/** 批量编辑历史记录（主表） */
export interface BatchEditHistory {
  id: string
  executed_at: string
  topic_count: number
  field_count: number
  summary: string | null
  reverted: boolean
  reverted_at: string | null
}

/** 批量编辑历史明细项 */
export interface BatchEditHistoryItem {
  id: string
  history_id: string
  topic_id: string
  before_values: Record<string, unknown> | null
  after_values: Record<string, unknown> | null
}

/** 批量编辑撤销结果 */
export interface BatchEditRevertResult {
  /** 实际恢复的 topic 数量（可能因 topic 已删除而少于原 topic_count） */
  restoredCount: number
}

// ---------- 撤销/重做相关类型 ----------

/** undo_log 表行（主进程内部使用） */
export interface UndoLogEntry {
  id: string
  created_at: string
  store_name: 'topic' | 'event' | 'draw' | 'customField' | 'settings'
  action: string
  target_type: string
  target_id: string | null
  before_data: unknown | null
  after_data: unknown | null
  payload_size: number
  label: string | null
  /**
   * 撤销时间戳（ISO 字符串）。null 表示该 log 未被撤销；
   * 非 null 表示已被 executeUndo 标记撤销，可用于 executeRedo 重做。
   */
  undone_at: string | null
}

/** 渲染进程入栈的简化条目（不含 id/created_at，由主进程生成） */
export interface UndoStackEntry {
  storeName: UndoLogEntry['store_name']
  action: string
  targetType: string
  targetId: string | null
  /** 用户可读摘要，用于 UndoToast 显示 */
  label: string
  /** 主进程 undo_log 表的 id，撤销时回传 */
  logId?: string
}

/** system:undo 请求 */
export interface UndoRequest {
  /** 指定撤销某条 log；为空时撤销最新一条 */
  logId?: string
}

/** system:undo 响应 */
export interface UndoResult {
  /** 被撤销的 log id */
  logId: string
  /** 反向操作影响的行数 */
  affectedCount: number
  /** 撤销的 store 名（用于渲染进程触发对应 store 刷新） */
  storeName: UndoLogEntry['store_name']
  /** 摘要 */
  label: string
}

/** system:redo 请求 */
export interface RedoRequest {
  /** 指定重做某条 log；为空时重做最近一次被撤销的操作 */
  logId?: string
}

/** system:redo 响应（结构同 UndoResult） */
export type RedoResult = UndoResult

// ---------- 赛制与计时器相关类型 ----------

export type {
  DebateFormatData,
  StageDef,
  StageSide,
  BellDef,
  BellSound,
  BellAsset,
  TimerTheme
} from './debate-formats/types'

export interface DebateFormat {
  id: string
  name: string
  description?: string | null
  isPreset: boolean
  formatData: DebateFormatData
  createdAt: string
  updatedAt: string
}

/** 计时器自定义背景图片元数据（对应 userData/backgrounds/ 目录下文件） */
export interface BackgroundFile {
  /** 文件名前缀 UUID（用于删除定位） */
  id: string
  /** 原始文件名（含扩展名） */
  fileName: string
  /** file:// 协议 URL，可直接用于 CSS background-image */
  fileUrl: string
  /** 文件大小（字节） */
  fileSize: number
  /** 创建时间 ISO 字符串 */
  createdAt: string
}

export type TimerSessionStatus = 'idle' | 'running' | 'paused' | 'finished'

/** 环节时间缓存值。
 *  - 非自由辩论环节：number（remainingMs）
 *  - 自由辩论环节：{ aff: number; neg: number }（双方独立时间） */
export type StageCacheValue = number | { aff: number; neg: number }

export interface TimerSession {
  id: string
  eventId?: string | null
  roundId?: string | null
  teamAffId?: string | null
  teamNegId?: string | null
  topicId?: string | null
  formatId: string | null
  formatSnapshot: DebateFormatData
  status: TimerSessionStatus
  startedAt?: string | null
  endedAt?: string | null
  currentStageIndex: number
  currentSide: StageSide | null
  remainingMs?: number | null
  themeSnapshot?: TimerTheme | null
  label?: string | null
  createdAt: string
  /** 各环节最近离开时的时间缓存。
   *  - 非自由辩论环节：number
   *  - 自由辩论环节：{ aff: number; neg: number } */
  stageRemainingCache?: Record<number, StageCacheValue> | null
  /** 自由辩论环节：正方剩余时间（毫秒）。仅 isFreeDebate=true 环节使用 */
  affRemainingMs?: number | null
  /** 自由辩论环节：反方剩余时间（毫秒）。仅 isFreeDebate=true 环节使用 */
  negRemainingMs?: number | null
  /** 冗余快照：赛事名称（删除事件后仍可显示） */
  eventName?: string | null
  /** 冗余快照：正方队伍名称（删除队伍后仍可显示） */
  teamAffName?: string | null
  /** 冗余快照：反方队伍名称（删除队伍后仍可显示） */
  teamNegName?: string | null
  /** 冗余快照：辩题标题（删除辩题后仍可显示） */
  topicTitle?: string | null
}

export interface TimerRecord {
  id: string
  sessionId: string
  stageIndex: number
  stageName: string
  side: StageSide
  durationMs: number
  actualMs?: number | null
  startedAt: string
  endedAt?: string | null
  pauseCount: number
}

export interface TimerState {
  sessionId: string
  status: TimerSessionStatus
  currentStageIndex: number
  currentSide: StageSide
  remainingMs: number
  elapsedMs: number
  pausedAt?: string | null
  lastBellIndex: number
  /** 自由辩论环节：正方剩余时间（毫秒）。仅在 isFreeDebate=true 的环节使用 */
  affRemainingMs?: number
  /** 自由辩论环节：反方剩余时间（毫秒）。仅在 isFreeDebate=true 的环节使用 */
  negRemainingMs?: number
  /** 各环节最近离开时的 remainingMs 缓存，key=stageIndex，value=remainingMs。
   *  用于 prevStage 完全保留策略。
   *  自由辩论环节下，value 为 { aff, neg } 双方独立时间；其他环节为 number */
  stageRemainingMsCache?: Record<number, StageCacheValue>
}
