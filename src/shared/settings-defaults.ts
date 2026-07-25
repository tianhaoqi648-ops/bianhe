// ============================================================
// settings-defaults.ts — 重置类别常量与标签
//
// 设计：
// - 配置类（dedup/tagDisplay/candidates）：通过删除 settings 表对应 key 实现
// - 数据类（topics/events/drawSessions/importBatches/auditLogs）：通过清空对应业务表实现
// - 配置类默认勾选，数据类默认不勾选且需二次确认
// ============================================================

/** 配置类重置类别（对应 settings key） */
export type ConfigResetCategory = 'dedup' | 'tagDisplay' | 'candidates';

/** 数据类重置类别（对应业务表） */
export type DataResetCategory =
  | 'topics'
  | 'events'
  | 'drawSessions'
  | 'importBatches'
  | 'auditLogs';

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
  candidates: ['system.candidates']
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
  'auditLogs'
];

/** 配置类列表 */
export const CONFIG_RESET_CATEGORIES: ConfigResetCategory[] = [
  'dedup',
  'tagDisplay',
  'candidates'
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
  topics: '题库数据',
  events: '赛事数据',
  drawSessions: '抽取记录',
  importBatches: '导入批次记录',
  auditLogs: '审计日志'
};

/** 类别详细描述（用于 Modal 副标题） */
export const RESET_CATEGORY_DESCRIPTIONS: Record<ResetCategory, string> = {
  dedup: '文本匹配阈值、AI 语义配置、API Key',
  tagDisplay: '5 个场景 × 4 个类别的标签显示开关与白名单',
  candidates: '通过「加入候选」扩展的题型/领域/难度/来源/来源类型值',
  topics: '所有用户导入与官方辩题记录（可选保留官方题库）',
  events: '赛事、轮次、队伍、队伍历史（级联删除）',
  drawSessions: '抽取会话与抽取明细（级联删除）',
  importBatches: '导入批次元数据记录（不含辩题数据本身）',
  auditLogs: '系统操作审计日志（不可恢复）'
};

/** 官方题库相关 settings keys（重置时按子选项决定是否保留） */
export const OFFICIAL_TOPIC_SETTINGS_KEYS = [
  'official_topics_seeded',
  'official_topics_version',
  'official_topics_count'
] as const;
