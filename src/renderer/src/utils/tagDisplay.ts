import type { TagDisplayConfig } from '../../../shared/types';

/** 默认配置：开启显示，selectedTags 为空（显示全部） */
export const DEFAULT_TAG_DISPLAY_CONFIG: TagDisplayConfig = {
  enabled: true,
  selectedTags: []
};

/** 合并用户配置与默认值，确保所有字段存在 */
function mergeWithDefaults(partial: Partial<TagDisplayConfig> | unknown): TagDisplayConfig {
  if (!partial || typeof partial !== 'object') {
    return DEFAULT_TAG_DISPLAY_CONFIG;
  }
  const p = partial as Partial<TagDisplayConfig>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_TAG_DISPLAY_CONFIG.enabled,
    selectedTags: Array.isArray(p.selectedTags)
      ? p.selectedTags.filter((t) => typeof t === 'string')
      : []
  };
}

/** 判断是否为旧格式配置（含 categoryEnabled 字段） */
function isLegacyConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  return 'categoryEnabled' in (raw as Record<string, unknown>);
}

/**
 * 从 settings store 读取配置，缺省时返回默认配置。
 * 向后兼容：旧格式配置（categoryEnabled/hiddenValues/bigScreenOverrides）保守转为默认（显示全部）。
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
 * @returns 通过过滤的值（enabled=false 或不在 selectedTags 中则返回 null）
 */
export function filterTag(
  config: TagDisplayConfig,
  value: string | null | undefined
): string | null {
  if (!config.enabled) return null;
  if (!value) return null;
  // selectedTags 为空 = 显示全部
  if (config.selectedTags.length === 0) return value;
  return config.selectedTags.includes(value) ? value : null;
}

/**
 * 过滤标签数组
 * @returns 过滤后的数组（enabled=false 返回空数组，selectedTags 空返回原数组，非空只保留选中的）
 */
export function filterTags(
  config: TagDisplayConfig,
  tags: string[] | null | undefined
): string[] {
  if (!config.enabled) return [];
  if (!tags || tags.length === 0) return [];
  // selectedTags 为空 = 显示全部
  if (config.selectedTags.length === 0) return tags;
  return tags.filter((t) => config.selectedTags.includes(t));
}
