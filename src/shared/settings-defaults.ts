// ============================================================
// settings-defaults.ts — 设置重置类别 → keys 映射
//
// 前端和 store 共用此常量，主进程 IPC 只接受 keys 数组，
// 不需要知道类别语义。
//
// 设计：删除 key 而非写入默认值。所有读取方都有
// 「key 不存在时回退到默认值」逻辑，删除等价于重置。
// ============================================================

/** 可重置的设置类别 */
export type ResetCategory = 'dedup' | 'tagDisplay' | 'candidates';

/** 类别 → settings key 列表映射 */
export const RESET_CATEGORY_KEYS: Record<ResetCategory, string[]> = {
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

/** 全部可重置 key 的并集（用于校验和不重复） */
export const ALL_RESETTABLE_KEYS: string[] = Array.from(
  new Set(Object.values(RESET_CATEGORY_KEYS).flat())
);

/** 类别中文标签（UI 用） */
export const RESET_CATEGORY_LABELS: Record<ResetCategory, string> = {
  dedup: '去重设置',
  tagDisplay: '标签显示配置',
  candidates: '自定义候选值'
};
