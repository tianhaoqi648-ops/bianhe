// ============================================================
// IPC 共享类型定义
//
// 此文件不依赖 main 或 renderer 任何模块，确保两侧都能安全引用。
// 业务实体类型在此独立声明，与 repository 中类型保持结构兼容。
// 主进程内部仍用 repository 类型，IPC 边界处 TypeScript 自动做结构化类型检查。
// ============================================================

import type { CandidateField } from './constants'

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
}

export interface Event {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  status: string | null
  created_at: string | null
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
}

export interface EventUpdateInput {
  name?: string
  start_date?: string | null
  end_date?: string | null
  status?: string | null
}

export interface Round {
  id: string
  event_id: string
  name: string | null
  round_number: number | null
  difficulty_override: string | null
  topic_count: number | null
}

export interface RoundCreateInput {
  event_id: string
  name?: string | null
  round_number?: number | null
  difficulty_override?: string | null
  topic_count?: number | null
}

export interface RoundUpdateInput {
  name?: string | null
  round_number?: number | null
  difficulty_override?: string | null
  topic_count?: number | null
}

export interface Team {
  id: string
  name: string
  event_id: string
}

export interface TeamCreateInput {
  name: string
  event_id: string
}

export interface TeamUpdateInput {
  name?: string
}

export interface TeamHistory {
  id: string
  team_id: string
  topic_id: string
  event_id: string
  played_at: string | null
}

export interface TeamHistoryCreateInput {
  team_id: string
  topic_id: string
  event_id: string
  played_at?: string | null
}

export interface DrawSessionSettings {
  source_mix_ratio?: number
  difficulty_override?: Record<string, number>
  include_stance?: boolean
  team_pairs?: Array<{ team_a_id: string; team_b_id: string }>
  filter?: TopicFilter
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
}

// ---------- 统一响应封装 ----------

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export type ApiResult<T = unknown> = ApiResponse<T>

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
  // export
  EXPORT_TOPICS: 'export:topics',
  EXPORT_DRAW_SESSIONS: 'export:drawSessions',
  EXPORT_EVENT_PACKAGE: 'export:eventPackage',
  // dedup
  DEDUP_RUN: 'dedup:run',
  DEDUP_DELETE_TOPICS: 'dedup:deleteTopics',
  // system
  SYSTEM_PICK_FILE: 'system:pickFile',
  SYSTEM_GET_CANDIDATES: 'system:getCandidates'
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
