// ============================================================
// IPC 共享类型定义
//
// 此文件不依赖 main 或 renderer 任何模块，确保两侧都能安全引用。
// 业务实体类型在此独立声明，与 repository 中类型保持结构兼容。
// 主进程内部仍用 repository 类型，IPC 边界处 TypeScript 自动做结构化类型检查。
// ============================================================

import type { CandidateField } from './constants'
import type { DebateFormatData, StageSide, TimerTheme } from './debate-formats/types'
import type { AgentAPI } from './agent-types'

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
  /** 持方快照：正方/反方 */
  stance?: string | null
  /** 冗余快照：辩题标题（辩题被删除后历史仍可显示原标题，避免显示"已删除辩题"） */
  topic_title?: string | null
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
  /** 冗余快照：辩题标题（可选，缺省时仓库自动从 topics 回填） */
  topic_title?: string | null
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
    /** Agent 对话 API（AI Agent v1.3.0，通过 'agent:event' 通道推送流式事件） */
    agent?: AgentAPI
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
  | 'judge_history'
  | 'badges'

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
  /** 备份恢复时还原的队徽文件数（badges 类别） */
  badgeFilesRestored: number
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

// ---------- 比赛（match）：一轮下的对阵，链路承载（抽题→计时→录音→赛果→AI评审） ----------

/** 比赛状态机 */
export type MatchStatus = 'planned' | 'resulted'
/** 赛果（人工评审权威）：aff 正方胜 / neg 反方胜 / draw 平 / abandoned 弃赛 */
export type MatchWinner = 'aff' | 'neg' | 'draw' | 'abandoned'
/** 评决制度：三票制（印象/环节/决胜） 或 百分制（可切换，用户决策） */
export type MatchJudgeSystem = 'three_votes' | 'percentage'

/** 录音环节/发言人标记（整轨按切换顺序累积，供 AI 评审区分环节与发言人，如"辨之竹"） */
export interface MatchRecordingMarker {
  /** 距录音起点毫秒 */
  tsMs: number
  stageId: string
  stageName: string
  side: StageSide | null
  /** 发言辩手（赛制配置，如"正方一辩"） */
  speaker: string | null
  /** 分片文件绝对路径（仅 segmentMode='split' 时该环节单独成轨才有值） */
  filePath?: string | null
}

/** 录音元信息（落盘路径 + 分段模式 + 环节/发言人标记） */
export interface MatchRecordingMeta {
  /** 录音文件绝对路径 */
  filePath: string
  /** 分段模式：whole 整轨 / split 按环节分段 */
  segmentMode: 'whole' | 'split'
  /** 环节/发言人标记 */
  markers: MatchRecordingMarker[]
}

/** 单环节评分（环节加权可配置，缺省等权） */
export interface MatchStageScore {
  stageId: string
  stageName: string
  weight: number
  aff: number
  neg: number
}

/** 裁判 */
export interface MatchJudge {
  id: string
  matchId: string
  name: string
  sortOrder: number
  isAi: boolean
  createdAt: string
}

/** 裁判评决（每裁判每场一条） */
export interface MatchJudgeVote {
  id: string
  matchId: string
  judgeId: string
  judgeSystem: MatchJudgeSystem
  /** 印象票：aff/neg（三票制） */
  impressionVote: 'aff' | 'neg' | null
  /** 决胜票：aff/neg（三票制） */
  decisionVote: 'aff' | 'neg' | null
  /** 正方/反方得分：三票制=环节加权累计；百分制=直接分 */
  affTotal: number | null
  negTotal: number | null
  /** 环节明细 */
  stageScores: MatchStageScore[] | null
  /** 该裁判投出的最佳辩手 */
  bestSpeaker: string | null
  comment: string | null
  createdAt: string
  updatedAt: string
}

/** AI 评审单人五维双方评分（保存 judge_match 输出） */
export interface MatchAiDimensionScore {
  /** 维度 key（对应 FIVE_DIMENSIONS） */
  key: string
  /** 维度展示名 */
  name: string
  /** 正方得分 0-10 */
  affScore: number
  /** 反方得分 0-10 */
  negScore: number
  /** 该维度评语 */
  comment: string
}

/** AI 评审按环节逐段判定（保存 judge_match 的 stageVerdicts） */
export interface MatchAiStageVerdict {
  /** 环节类型（六类之一） */
  stage: string
  /** 该环节胜方 */
  winner: 'aff' | 'neg'
  /** 置信度 0-1 */
  confidence: number
  /** 一句评语 */
  comment: string
}

/** 单场可选的 AI 评审结果（不覆盖人工赛果） */
export interface MatchAiReview {
  /** 建议判定：aff/neg/draw */
  winner: MatchWinner | null
  /** 双方得分（可选） */
  affScore?: number | null
  negScore?: number | null
  /** 环节评估明细（可选） */
  stageReview?: MatchStageScore[] | null
  /** 判定说明 / 摘要 */
  explanation: string
  /** 疑似最佳辩手（可选） */
  bestSpeaker?: string | null
  /** 五维双方评分（可选，保存 judge_match 完整输出） */
  dimensions?: MatchAiDimensionScore[] | null
  /** 按环节逐段判定（可选，保存 judge_match 的 stageVerdicts） */
  stageVerdicts?: MatchAiStageVerdict[] | null
  /** 评审素材来源：整场录音/时间线 或 转文字全文 */
  source?: 'recording' | 'transcript'
  /** 使用的人设评委姓名（含回落，可选） */
  judgeName?: string
  /** 评审时间 ISO */
  reviewedAt: string
}

export interface Match {
  id: string
  eventId: string
  roundId: string | null
  /** 轮内序号（展示用） */
  matchNumber: number | null
  teamAffId: string | null
  teamNegId: string | null
  /** 辩题 id（抽题后填入） */
  topicId: string | null
  /** 持方快照 */
  stanceAff: string | null
  stanceNeg: string | null
  /** 使用赛制 id（环节/权重/发言人来源） */
  formatId: string | null
  /** 评决制度（三票制/百分制） */
  judgeSystem: MatchJudgeSystem
  /** 关联的抽取对阵项（DrawSessionItem.id），实现"抽题结果计入该轮比赛" */
  drawItemId: string | null
  /** 关联的计时会话（从比赛启动计时时回写） */
  sessionId: string | null
  /** 可选录音引用（旧字段，保留兼容） */
  recordingRef: string | null
  /** 录音元信息（路径+分段模式+环节/发言人标记） */
  recordingMeta: MatchRecordingMeta | null
  status: MatchStatus
  // 赛果（多裁判聚合，linquan）
  winner: MatchWinner | null
  affScore: number | null
  negScore: number | null
  bestSpeaker: string | null
  notes: string | null
  /** 可选 AI 评审（JSON 序列化） */
  aiReview: MatchAiReview | null
  createdAt: string
  updatedAt: string
  /** 裁判（完整读取时预载） */
  judges?: MatchJudge[]
  /** 评决（完整读取时预载） */
  votes?: MatchJudgeVote[]
  // 冗余快照
  teamAffName: string | null
  teamNegName: string | null
  topicTitle: string | null
  eventName: string | null
  roundName: string | null
}

export interface MatchCreateInput {
  eventId: string
  roundId?: string | null
  teamAffId?: string | null
  teamNegId?: string | null
  topicId?: string | null
  stanceAff?: string | null
  stanceNeg?: string | null
  matchNumber?: number | null
  formatId?: string | null
  judgeSystem?: MatchJudgeSystem
}

export interface MatchUpdateInput {
  teamAffId?: string | null
  teamNegId?: string | null
  topicId?: string | null
  stanceAff?: string | null
  stanceNeg?: string | null
  formatId?: string | null
  judgeSystem?: MatchJudgeSystem
  drawItemId?: string | null
  recordingRef?: string | null
  recordingMeta?: MatchRecordingMeta | null
}

/** 计入赛果（多裁判 + 亮牌） */
export interface MatchSetResultInput {
  winner: MatchWinner
  affScore?: number | null
  negScore?: number | null
  bestSpeaker?: string | null
  notes?: string | null
  /** 裁判列表（重建该场比赛的裁判与评决） */
  judges?: Array<{
    id?: string
    name: string
    isAi?: boolean
    vote?: MatchJudgeVoteInput
  }>
}

/** 单裁判评决入参 */
export interface MatchJudgeVoteInput {
  judgeSystem?: MatchJudgeSystem
  impressionVote?: 'aff' | 'neg' | null
  decisionVote?: 'aff' | 'neg' | null
  affTotal?: number | null
  negTotal?: number | null
  stageScores?: MatchStageScore[] | null
  bestSpeaker?: string | null
  comment?: string | null
}

// ---------- AI 裁判「录音转文字」（整场评审原料，2026-08-20） ----------

/** 转写引擎选择：'local-first' 本地 whisper 优先 + API 兜底 / 'local' 仅本地 / 'api' 仅 API */
export type SttEngine = 'local-first' | 'local' | 'api'

/** 录音转写请求（录音文件 + 可选环节/发言人标记 + 引擎/模型选择） */
export interface SttRequest {
  /** 录音文件绝对路径（wav：整段切片 / webm·m4a：整段转写为一段） */
  filePath: string
  /** 环节/发言人标记（wav 按 atMs 用 JS 字节切片；webm/m4a 仅作标注不切片） */
  markers?: Array<{ stage: string; speaker?: string; atMs: number }>
  /** 引擎选择（缺省读 settings stt.engine，再缺省 local-first） */
  engine?: SttEngine
  /** 本地引擎实现：'whisper'|'funasr'（缺省读 settings stt.localEngine，再缺省 whisper） */
  localEngine?: SttLocalEngine
  /** whisper 模型名（如 'base'/'small'；缺省读 settings stt.model，再缺省 base） */
  model?: string
  /**
   * AI 转写兜底所需的镜像配置（baseURL/apiKey/model）。
   * API 兜底时优先用它；未传才回读 settings 表（agent.llm / ai.*）。
   * 渲染端可把 localStorage 里的 AI 配置带过来，避免依赖 settings 表。
   */
  aiConfig?: { baseURL?: string; apiKey?: string; model?: string }
}

/** 转写出的一个文本段（可对上环节/发言人/时间） */
export interface SttSegment {
  stage?: string
  speaker?: string
  atMs?: number
  text: string
}

/** 转写引擎安装/下载状态（本地 whisper.cpp + 模型） */
export interface SttEngineStatus {
  /** binary + 模型齐备 */
  installed: boolean
  /** whisper 二进制存在 */
  binaryOk: boolean
  /** 对应模型文件存在且体积 > 0 */
  modelOk: boolean
  /** 当前检测的模型名 */
  model?: string
  binaryPath?: string
  modelPath?: string
  /** 模型文件体积（字节） */
  fileSize?: number
  /** 是否有下载进行中 */
  downloading: boolean
  /** 下载进度 0-100（download 进行中时有效） */
  progress?: number
  /** 最近错误信息 */
  error?: string
}

/** ffmpeg 转码器安装/下载状态（按需下载到 userData/stt/，用于把 m4a/webm 转成 16k mono wav） */
export interface SttFfmpegStatus {
  /** ffmpeg 二进制已安装 */
  installed: boolean
  /** 已安装时的绝对路径 */
  path?: string
  /** 已安装时的体积（字节） */
  fileSize?: number
  /** 是否有下载进行中 */
  downloading: boolean
  /** 下载进度 0-100（download 进行中时有效） */
  progress?: number
  /** 最近错误信息 */
  error?: string
}

/** settings 表里 STT 引擎选择 key（值：local-first/local/api） */
export const STT_ENGINE_KEY = 'stt.engine'
/** settings 表里 STT whisper 模型名 key（值：base/small/...） */
export const STT_MODEL_KEY = 'stt.model'
/** userData 下转写引擎与模型目录名 */
export const STT_DIR_NAME = 'stt'

// ---- 本地引擎「实现选择」维度（与 STT_ENGINE_KEY 的策略维度正交）----
// STT_ENGINE_KEY 决定是否用 API 兜底（local-first/local/api）；STT_LOCAL_ENGINE_KEY
// 决定本地实现用哪个引擎（whisper.cpp / funasr python）。两者互不冲突，分别持久化。

/** 本地转写引擎实现：'whisper'（默认，whisper.cpp embedded）| 'funasr'（python funasr 环境） */
export type SttLocalEngine = 'whisper' | 'funasr'
/** settings 表里「本地引擎实现」key（值：whisper/funasr；缺省 whisper） */
export const STT_LOCAL_ENGINE_KEY = 'stt.localEngine'
/** settings 表里 FunASR 模型名 key（值：FUNASR_MODELS 之一；缺省 paraformer-zh） */
export const STT_FUNASR_MODEL_KEY = 'stt.funasrModel'

/** whisper.cpp 候选模型清单（本地 .bin 模型；small 起中文效果更好，medium 更大更准） */
export const WHISPER_MODELS = ['base', 'small', 'medium'] as const
/** FunASR 候选模型清单（经由本机 python funasr 环境按需拉取） */
export const FUNASR_MODELS = ['paraformer-zh', 'sensevoicesmall-zh'] as const

/** FunASR 本地转写引擎安装/运行环境状态（T7） */
export interface SttFunAsrStatus {
  /** 运行环境齐备：本机能跑 python + import funasr（模型由 funasr 首次运行时自动拉取） */
  envOk: boolean
  /** envOk 前提下模型可用（funasr 由 AutoModel 运行时拉取） */
  modelOk: boolean
  /** 当前检测的模型名 */
  model?: string
  /** 是否有下载进行中（当前未实现 funasr 模型手动下载，恒 false） */
  downloading: boolean
  /** 下载进度 0-100（unused） */
  progress?: number
  /** 最近错误信息（含未安装运行环境的引导文案） */
  error?: string
  /** 是否已检测到本机 Python（UI 据此区分「没装 Python」还是「有 Python 但缺 funasr 包」） */
  hasPython?: boolean
  /** 缺失的推理依赖（torch/torchaudio/torchvision），envOk=false 且为「缺依赖」时非空，
   *   UI 据此读取并展示缺失项；探针环境异常时为空数组 */
  missingDeps?: string[]
}

/** FunASR 一键安装运行环境的结果（T-安装） */
export interface SttFunAsrInstallResult {
  /** 是否安装成功（以 pip 退出码为准，不得伪造） */
  ok: boolean
  /** true 表示未检测到 Python（需先安装 Python）；unset/false 表示 Python 存在但 pip 安装失败/成功 */
  needPython?: boolean
  /** 成功时的提示，或失败时的报错/引导文案 */
  detail?: string
}

/** 手动导入本地 whisper 模型的结果（离线兜底） */
export interface SttImportResult {
  ok: boolean
  /** 成功时推断出的模型名（ggml-<model>.bin 中间段，去 .bin） */
  model?: string
  /** 成功时复制到的目标绝对路径 */
  path?: string
  /** 失败时的提示信息（用户取消返回 ok:false 且无 error，不计为错误） */
  error?: string
}

/** stt 目录诊断信息（「设置 → AI 转写」展示 stt 目录与模型/ffmpeg 是否在位，以及更新后数据缺失时引导找回） */
export interface SttDirDiagnostics {
  /** 当前生效的转写目录完整路径（用户配置 stt.dir 或缺省 userData/stt） */
  path: string
  /** whisper 二进制（手动指定或 stt 目录下）是否存在 */
  hasWhisperCli: boolean
  /** ffmpeg 转码器（ffmpegPath() 指向的文件）是否存在 */
  hasFfmpeg: boolean
  /** stt 目录 models/ 下的模型子目录名数组（目录读失败为空数组） */
  models: string[]
}

// ---------- 通道名常量 ----------
// 命名规范：'<domain>:<action>'，例 'topic:list'、'draw:execute'

/** recordings 目录下的一份录音 */
export interface RecordingMeta {
  fileName: string
  size: number
  modifiedAt: string
}

export interface RecordingSaveResult {
  ok: boolean
  path?: string
  size?: number
  code?: string
  message?: string
}

// ==================== P1-6 赛程 Excel 导入导出 / 队徽库 ====================

/**
 * 一条赛程记录（对应 Excel 一行，亦为 diff / apply 的最小单元）。
 * 身份键 = roundName + '#' + matchNumber。
 */
export interface ScheduleRow {
  roundName: string | null
  matchNumber: number | null
  /** 正方队伍名 */
  teamAff: string
  /** 反方队伍名 */
  teamNeg: string
  /** 辩题标题 */
  topic: string
  /** 日期：导出/导入均保留，供在 Excel 编排参考；因无对应存储列，导入时参与展示但不参与 diff/apply */
  date: string
  /** 场地：同 date，仅展示 */
  venue: string
  /** 状态快照（planned/resulted），导出展示用 */
  status: string
}

/** 变更预览中的单条差异动作 */
export interface ScheduleDiffAction {
  kind: 'add' | 'update' | 'delete'
  /** 唯一键 roundName#matchNumber */
  key: string
  row: ScheduleRow
  /** update/delete 时对应的既有比赛 id */
  matchId?: string
}

/** 赛程导入变更预览：将新增/将更新/将删除/不变 */
export interface ScheduleDiffPreview {
  added: ScheduleDiffAction[]
  updated: ScheduleDiffAction[]
  deleted: ScheduleDiffAction[]
  unchanged: number
  warnings: string[]
}

/** 赛程导入确认应用后的结果统计 */
export interface ScheduleApplyResult {
  appliedAdd: number
  appliedUpdate: number
  appliedDelete: number
  /** 因队伍/辩题无法解析而跳过的行数 */
  skipped: number
  warnings: string[]
}

/** 队徽条目（内置或自定义） */
export interface BadgeItem {
  id: string
  name: string
  /** builtin=内置、custom=用户上传 */
  kind: 'builtin' | 'custom'
  /** 相对文件名：builtin 为内嵌标识；custom 为 userData/badges 下的文件名 */
  fileName: string
  created_at?: string
}

/** 队伍 → 队徽绑定（存 userData/badges/team-bindings.json） */
export interface TeamBadgeMap {
  [teamId: string]: string | null
}

export interface ExportScheduleRequest {
  eventId: string
}

// ---------- AI 裁判历史（judge_history，T1/T2） ----------

/**
 * 一条 AI 裁判结果历史记录。
 * 对应 judge_history 表，工具执行成功自动落库，跨页/重启保留。
 */
export interface JudgeHistoryRecord {
  id: string
  createdAt: string
  /** 可空绑定：当前绑定的赛事/轮次/场次 */
  eventId: string | null
  roundId: string | null
  matchId: string | null
  /** 评委（当前选中的评委） */
  judgeId: string
  /** 裁判工具名（judge_match / judge_debate / judge_speech / detect_stage / simulate_opponent） */
  toolName: string
  /** 环节（快照） */
  stage: string | null
  /** 持方（aff / neg，快照） */
  side: string | null
  /** 辩题（快照） */
  topic: string | null
  /** 工具成功输出（对象，存库为 JSON 文本） */
  resultJson: Record<string, unknown> | null
  /** 失败信息（按 spec 仅存成功结果，备用） */
  error: string | null
}

/** 创建裁判历史的入参（id / createdAt 可省略，主进程自动补）。 */
export interface JudgeHistoryCreateInput {
  id?: string
  createdAt?: string
  eventId?: string | null
  roundId?: string | null
  matchId?: string | null
  judgeId: string
  toolName: string
  stage?: string | null
  side?: string | null
  topic?: string | null
  resultJson?: Record<string, unknown> | null
  error?: string | null
}

/** 历史列表筛选（仅当字段非空时作为查询条件）。 */
export interface JudgeHistoryFilter {
  eventId?: string | null
  roundId?: string | null
  matchId?: string | null
  toolName?: string | null
}

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
  SYSTEM_READ_TEXT_FILE: 'system:readTextFile',
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

  // match（比赛：赛道内一轮下的对阵，承载 抽题→计时→录音→赛果→AI评审）
  MATCH_CREATE: 'match:create',
  MATCH_GET: 'match:get',
  MATCH_LIST_BY_EVENT: 'match:listByEvent',
  MATCH_LIST_BY_ROUND: 'match:listByRound',
  MATCH_UPDATE: 'match:update',
  MATCH_SET_RESULT: 'match:setResult',
  MATCH_SET_AI_REVIEW: 'match:setAiReview',
  MATCH_LINK_SESSION: 'match:linkSession',
  MATCH_DELETE: 'match:delete',

  // recording（比赛/计时可选录音，userData/recordings/）
  RECORDING_SAVE: 'recording:save',
  RECORDING_LIST: 'recording:list',
  RECORDING_DELETE: 'recording:delete',
  RECORDING_READ: 'recording:read',
  RECORDING_PICK_DIR: 'recording:pickDir',
  RECORDING_GET_DIR: 'recording:getDir',
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
  DB_LOGS_WRITE: 'logs:write',
  // updater（应用内自动更新）
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_SET_AUTO_CHECK: 'updater:setAutoCheck',
  UPDATER_GET_META: 'updater:getMeta',
  UPDATER_STATUS_CHANGE: 'updater:statusChange',
  // stt（AI 裁判录音转文字：整场评审原料）
  STT_TRANSCRIBE: 'stt:transcribe',
  STT_STATUS: 'stt:status',
  STT_FUNASR_STATUS: 'stt:funasr-status',
  STT_FUNASR_INSTALL: 'stt:funasr-install',
  STT_DOWNLOAD: 'stt:download',
  STT_CANCEL: 'stt:cancel-download',
  STT_REMOVE: 'stt:remove',
  STT_IMPORT_MODEL: 'stt:import-model',
  STT_WHISPER_PICK: 'stt:whisper-pick',
  STT_WHISPER_CLEAR: 'stt:whisper-clear',
  STT_DIAGNOSTICS: 'stt:diagnostics',
  // ffmpeg 转码器（按需下载，把 m4a/webm 转 16k mono wav 供本地 whisper 转写）
  STT_FFMPEG_STATUS: 'stt:ffmpeg-status',
  STT_FFMPEG_DOWNLOAD: 'stt:ffmpeg-download',
  STT_FFMPEG_CANCEL: 'stt:ffmpeg-cancel',
  STT_FFMPEG_REMOVE: 'stt:ffmpeg-remove',
  STT_FFMPEG_PICK: 'stt:ffmpeg-pick',
  STT_FFMPEG_CLEAR: 'stt:ffmpeg-clear',
  // 复盘报告导出（P0-3：AI 裁判录音一键复盘导出 Markdown）
  REPORT_EXPORT_JUDGE: 'report:exportJudge',
  // 复盘 html 可视化导出（P2-9：自包含 HTML，含雷达图可视化）
  REPORT_EXPORT_JUDGE_HTML: 'report:exportJudgeHtml',
  // 赛程 Excel（P1-6：与 complete-event-import-export 的赛事「包」导入导出是不同的能力）
  SCHEDULE_EXPORT: 'schedule:export',
  SCHEDULE_IMPORT_PARSE: 'schedule:importParse',
  SCHEDULE_IMPORT_APPLY: 'schedule:importApply',
  // 队徽库（P1-6：内置/上传/搜索 · 队伍绑定，存 userData/badges）
  BADGE_LIST: 'badge:list',
  BADGE_UPLOAD: 'badge:upload',
  BADGE_DELETE: 'badge:delete',
  BADGE_GET_DATA_URL: 'badge:getDataUrl',
  BADGE_SET_TEAM: 'badge:setTeam',
  BADGE_GET_TEAM: 'badge:getTeam',
  BADGE_CLEAR_TEAM: 'badge:clearTeam',
  // AI 裁判历史（judge_history，T1/T2：持久化裁判工具结果，跨页/重启保留）
  JUDGE_LIST_HISTORY: 'judge:listHistory',
  JUDGE_GET_HISTORY: 'judge:getHistory',
  JUDGE_SAVE_HISTORY: 'judge:saveHistory',
  JUDGE_DELETE_HISTORY: 'judge:deleteHistory'
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

// ---------- 复盘报告导出（P0-3 录音一键复盘导出） ----------

/** 复盘报告导出请求：渲染端组装好 markdown 字符串，主进程负责选路径 + 写文件 */
export interface ExportJudgeReportRequest {
  /** 默认文件名（不带扩展名，主进程追加 .md） */
  defaultName: string
  /** 组装好的 markdown 复盘报告内容 */
  content: string
}

export interface ExportJudgeReportResult {
  /** 实际保存的绝对路径 */
  filePath: string
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
  /** 关联的比赛（matches）id：从赛事某轮「比赛」启动的计时会回写该字段，便于归集到该场 */
  matchId?: string | null
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
  /** 每队总时长池（后手）：正方池剩余（毫秒）。带 teamPoolMinutes 的赛制使用 */
  affPoolRemainingMs?: number | null
  /** 每队总时长池（后手）：反方池剩余（毫秒）。带 teamPoolMinutes 的赛制使用 */
  negPoolRemainingMs?: number | null
  /** 自由辩论发言次数：正方（自由辩论环节开始后累计） */
  affSpeechCount?: number | null
  /** 自由辩论发言次数：反方（自由辩论环节开始后累计） */
  negSpeechCount?: number | null
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
  /** 每队总时长池（后手）：正方池剩余（毫秒）。带 teamPoolMinutes 赛制时使用 */
  affPoolRemainingMs?: number
  /** 每队总时长池（后手）：反方池剩余（毫秒）。带 teamPoolMinutes 赛制时使用 */
  negPoolRemainingMs?: number
  /** 自由辩论发言次数：正方（自由辩论环节开始后累计） */
  affSpeechCount?: number
  /** 自由辩论发言次数：反方（自由辩论环节开始后累计） */
  negSpeechCount?: number
  /** 各环节最近离开时的 remainingMs 缓存，key=stageIndex，value=remainingMs。
   *  用于 prevStage 完全保留策略。
   *  自由辩论环节下，value 为 { aff, neg } 双方独立时间；其他环节为 number */
  stageRemainingMsCache?: Record<number, StageCacheValue>
}

// ---------- 应用内自动更新（electron-updater） ----------

/** 更新检查状态 */
export type UpdateStatus =
  | 'idle' // 空闲（初始/未检查）
  | 'checking' // 检查中
  | 'available' // 发现新版本
  | 'not-available' // 已是最新版本
  | 'downloading' // 下载中
  | 'downloaded' // 下载完成
  | 'error' // 错误

/** 新版本元信息 */
export interface UpdateInfo {
  /** 新版本号，如 "1.2.0" */
  version: string
  /** Release Notes（可能为 markdown 字符串） */
  releaseNotes: string
  /** GitHub Release 页面 URL */
  releaseUrl: string
}

/** 下载进度 */
export interface UpdateProgress {
  /** 进度百分比 0-100 */
  percent: number
  /** 已下载字节数 */
  transferred: number
  /** 总字节数 */
  total: number
  /** 下载速度（字节/秒） */
  bytesPerSecond: number
}

/** 状态变更广播 payload */
export interface UpdateStatusPayload {
  status: UpdateStatus
  info?: UpdateInfo
  progress?: UpdateProgress
  error?: string
}
