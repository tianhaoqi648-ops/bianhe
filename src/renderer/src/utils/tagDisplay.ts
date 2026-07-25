import type { TagCategory, TagDisplayConfig } from '../../../shared/types';

/** 默认配置：所有类别开启，所有 selectedValues 为空（显示全部） */
export const DEFAULT_TAG_DISPLAY_CONFIG: TagDisplayConfig = {
  categoryEnabled: {
    type: true,
    difficulty: true,
    source_type: true,
    custom: true
  },
  selectedValues: {
    type: [],
    difficulty: [],
    source_type: [],
    custom: []
  }
};

const CATEGORY_KEYS: TagCategory[] = ['type', 'difficulty', 'source_type', 'custom'];

/** 判断是否为旧格式（v1: categoryEnabled.source/customTags/hiddenValues/bigScreenOverrides；v2: enabled/selectedTags） */
function isLegacyConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  // v2 旧格式
  if ('enabled' in r && 'selectedTags' in r) return true;
  // v1 旧格式
  if ('hiddenValues' in r || 'bigScreenOverrides' in r) return true;
  // v1 旧 categoryEnabled（含 source/customTags 而非 source_type/custom）
  if (r.categoryEnabled && typeof r.categoryEnabled === 'object') {
    const ce = r.categoryEnabled as Record<string, unknown>;
    if ('source' in ce || 'customTags' in ce) return true;
  }
  return false;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string');
}

/** 合并用户配置与默认值，确保所有字段存在 */
function mergeWithDefaults(raw: unknown): TagDisplayConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_TAG_DISPLAY_CONFIG;
  const r = raw as Record<string, unknown>;
  const ce = (r.categoryEnabled ?? {}) as Record<string, unknown>;
  const sv = (r.selectedValues ?? {}) as Record<string, unknown>;
  return {
    categoryEnabled: {
      type: asBool(ce.type, DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.type),
      difficulty: asBool(ce.difficulty, DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.difficulty),
      source_type: asBool(ce.source_type, DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.source_type),
      custom: asBool(ce.custom, DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.custom)
    },
    selectedValues: {
      type: asStrArr(sv.type),
      difficulty: asStrArr(sv.difficulty),
      source_type: asStrArr(sv.source_type),
      custom: asStrArr(sv.custom)
    }
  };
}

/**
 * 从 settings store 读取配置，缺省时返回默认配置。
 * 向后兼容：旧格式（v1 / v2）保守转为默认（显示全部）。
 */
export function loadTagDisplayConfig(settings: Record<string, unknown>): TagDisplayConfig {
  const raw = settings['ui.tagDisplay'];
  if (!raw) return DEFAULT_TAG_DISPLAY_CONFIG;

  // 字符串配置：JSON 解析
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (isLegacyConfig(parsed)) return DEFAULT_TAG_DISPLAY_CONFIG;
      return mergeWithDefaults(parsed);
    } catch {
      return DEFAULT_TAG_DISPLAY_CONFIG;
    }
  }

  // 对象配置
  if (typeof raw === 'object' && raw !== null) {
    if (isLegacyConfig(raw)) return DEFAULT_TAG_DISPLAY_CONFIG;
    return mergeWithDefaults(raw);
  }

  return DEFAULT_TAG_DISPLAY_CONFIG;
}

/**
 * 过滤单个标签值
 * @returns 通过过滤的值（类别关闭或不在 selectedValues 中则返回 null）
 */
export function filterTag(
  config: TagDisplayConfig,
  value: string | null | undefined,
  category: TagCategory
): string | null {
  if (!value) return null;
  if (!config.categoryEnabled[category]) return null;
  const selected = config.selectedValues[category];
  // selectedValues 为空 = 显示全部
  if (selected.length === 0) return value;
  return selected.includes(value) ? value : null;
}

/**
 * 过滤标签数组
 * @returns 过滤后的数组（类别关闭返回空数组，selectedValues 空返回原数组，非空只保留选中的）
 */
export function filterTags(
  config: TagDisplayConfig,
  tags: string[] | null | undefined,
  category: TagCategory
): string[] {
  if (!tags || tags.length === 0) return [];
  if (!config.categoryEnabled[category]) return [];
  const selected = config.selectedValues[category];
  // selectedValues 为空 = 显示全部
  if (selected.length === 0) return tags;
  return tags.filter((t) => selected.includes(t));
}

// 导出 CATEGORY_KEYS 供 UI 使用
export { CATEGORY_KEYS };
