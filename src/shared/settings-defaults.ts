// ============================================================
// settings-defaults.ts — 重置类别常量与标签
//
// 设计：
// - 配置类（dedup/tagDisplay/candidates）：通过删除 settings 表对应 key 实现
// - 数据类（topics/events/drawSessions/importBatches/auditLogs）：通过清空对应业务表实现
// - 配置类默认勾选，数据类默认不勾选且需二次确认
// ============================================================

/** 配置类重置类别（对应 settings key） */
export type ConfigResetCategory =
  | 'dedup'
  | 'tagDisplay'
  | 'candidates'
  | 'hotkeys'
  | 'timerTheme'
  | 'timerBackground'
  | 'recording'
  | 'autoUpdate'
  | 'stt';

/** 数据类重置类别（对应业务表） */
export type DataResetCategory =
  | 'topics'
  | 'events'
  | 'drawSessions'
  | 'importBatches'
  | 'auditLogs'
  | 'batchEditHistory'
  | 'undoLog'
  | 'timerSessions'
  | 'timerRecords'
  | 'debateFormats'
  | 'customBells';

/** 所有重置类别联合 */
export type ResetCategory = ConfigResetCategory | DataResetCategory;

/** 配置类对应的 settings keys */
export const CONFIG_RESET_KEYS: Record<ConfigResetCategory, string[]> = {
  // 去重设置：6 个 key
  dedup: [
    'dedup.enabled',
    'dedup.levenshteinThreshold',
    'dedup.keywordThreshold',
    'dedup.aiEnabled',
    'dedup.aiApiKey',
    'dedup.aiThreshold'
  ],
  // 标签显示配置：1 个 key（删除后 loadTagDisplayConfig 回退到 DEFAULT_TAG_DISPLAY_CONFIG）
  tagDisplay: ['ui.tagDisplay'],
  // 自定义候选值：1 个 key（删除后 getMergedCandidates 回退到 SYSTEM_CANDIDATES）
  candidates: ['system.candidates'],
  // 快捷键设置：2 个 key
  // 注意：与 src/renderer/src/utils/hotkey-config.ts 中 HOTKEY_SETTING_KEY / HOTKEY_MASTER_KEY 保持一致
  // 为避免 shared 层 → renderer 层循环依赖，这里硬编码字符串字面量
  hotkeys: ['hotkeys.custom', 'hotkeys.enabled'],
  // 计时器主题配置：1 个 key（删除后回退到默认主题）
  timerTheme: ['timer.theme'],
  // 计时器背景配置：1 个 key（删除后回退到默认背景 深蓝渐变）
  // 与 src/shared/timer-backgrounds.ts 中 TIMER_BACKGROUND_KEY 保持一致
  timerBackground: ['timer.background'],
  // 录音设置：3 个 key
  // 与 src/shared/match-recording.ts 中 RECORDING_DIR_KEY / RECORDING_SEGMENT_KEY / RECORDING_FORMAT_KEY 保持一致
  // 为避免 shared 层 → renderer 层循环依赖，这里硬编码字符串字面量
  recording: ['recording.dir', 'recording.segmentMode', 'recording.format'],
  // 自动更新设置：1 个 key（删除后回退到默认开启）
  autoUpdate: ['auto_update_check'],
  // 转写引擎设置：1 个 key（删除后回退到默认 userData/stt）
  // 与 src/shared/match-recording.ts 中 STT_DIR_KEY 保持一致
  stt: ['stt.dir']
};

/**
 * @deprecated 请使用 CONFIG_RESET_KEYS。保留别名以兼容旧引用，
 * 将在后续 Task 中逐步迁移。
 */
export const RESET_CATEGORY_KEYS = CONFIG_RESET_KEYS;

/** 数据类列表（用于 UI 分组与遍历） */
export const DATA_RESET_CATEGORIES: DataResetCategory[] = [
  'topics',
  'events',
  'drawSessions',
  'importBatches',
  'auditLogs',
  'batchEditHistory',
  'undoLog',
  'timerSessions',
  'timerRecords',
  'debateFormats',
  'customBells'
];

/** 配置类列表 */
export const CONFIG_RESET_CATEGORIES: ConfigResetCategory[] = [
  'dedup',
  'tagDisplay',
  'candidates',
  'hotkeys',
  'timerTheme',
  'timerBackground',
  'recording',
  'autoUpdate'
];

/** 全部可重置 key 的并集（仅配置类） */
export const ALL_RESETTABLE_KEYS: string[] = Array.from(
  new Set(Object.values(CONFIG_RESET_KEYS).flat())
);

/** 题库重置子选项 */
export interface TopicsResetOptions {
  /** true=保留官方题库（仅删 source_type != '官方'），false=清空全部 */
  keepOfficial: boolean;
}

/** 类别中文标签（UI 用） */
export const RESET_CATEGORY_LABELS: Record<ResetCategory, string> = {
  dedup: '去重设置',
  tagDisplay: '标签显示配置',
  candidates: '自定义候选值',
  hotkeys: '快捷键设置',
  timerTheme: '计时器主题',
  timerBackground: '计时器背景',
  recording: '录音设置',
  autoUpdate: '自动更新',
  stt: '转写引擎',
  topics: '题库数据',
  events: '赛事数据',
  drawSessions: '抽取记录',
  importBatches: '导入批次记录',
  auditLogs: '审计日志',
  batchEditHistory: '批量编辑历史',
  undoLog: '撤销历史',
  timerSessions: '计时会话',
  timerRecords: '计时记录',
  debateFormats: '自定义赛制',
  customBells: '自定义铃声'
};

/** 类别详细描述（用于 Modal 副标题） */
export const RESET_CATEGORY_DESCRIPTIONS: Record<ResetCategory, string> = {
  dedup: '文本匹配阈值、AI 语义配置、API Key',
  tagDisplay: '5 个场景 × 4 个类别的标签显示开关与白名单',
  candidates: '通过「加入候选」扩展的题型/领域/难度/来源/来源类型值',
  hotkeys: '自定义快捷键组合、禁用状态、总开关',
  timerTheme: '正反方称谓、主题色、背景图配置（回退到默认蓝红主题）',
  timerBackground: '计时器小屏与大屏的背景（回退到默认深蓝渐变）',
  recording: '录音存放目录、分段模式、录音格式（回退：默认目录/整场一轨/wav）',
  autoUpdate: '启动时自动检查更新开关（回退：开启）',
  stt: '转写引擎存放目录（回退：默认 userData/stt）',
  topics: '所有用户导入与官方辩题记录（可选保留官方题库）',
  events: '赛事、轮次、队伍、队伍历史（级联删除）',
  drawSessions: '抽取会话与抽取明细（级联删除）',
  importBatches: '导入批次元数据记录（不含辩题数据本身）',
  auditLogs: '系统操作审计日志（不可恢复）',
  batchEditHistory: '批量编辑操作的历史快照记录（撤销后不可恢复）',
  undoLog: '撤销/重做操作历史记录（清空后无法继续撤销已执行的操作）',
  timerSessions: '历史计时会话记录（不含辩题/赛事数据）',
  timerRecords: '计时会话内的环节明细记录',
  debateFormats: '用户自定义赛制（内置预设不会被删除）',
  customBells: '上传的自定义铃声文件（内置 beep/bell 不受影响）'
};

/** 官方题库相关 settings keys（重置时按子选项决定是否保留） */
export const OFFICIAL_TOPIC_SETTINGS_KEYS = [
  'official_topics_seeded',
  'official_topics_version',
  'official_topics_count'
] as const;
