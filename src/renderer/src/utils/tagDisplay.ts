import type {
  TagCategory,
  TagDisplayConfig,
  TagDisplayScene,
  SceneTagConfig
} from '../../../shared/types';

/** 单场景默认配置：所有类别开启，所有 selectedValues 为空（显示全部） */
export const DEFAULT_SCENE_CONFIG: SceneTagConfig = {
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

/** 默认配置：5 个场景全部使用默认（全开 + 显示全部） */
export const DEFAULT_TAG_DISPLAY_CONFIG: TagDisplayConfig = {
  scenes: {
    library: { ...DEFAULT_SCENE_CONFIG },
    drawResult: { ...DEFAULT_SCENE_CONFIG },
    bigScreen: { ...DEFAULT_SCENE_CONFIG },
    filter: { ...DEFAULT_SCENE_CONFIG },
    dedup: { ...DEFAULT_SCENE_CONFIG }
  }
};

const SCENE_KEYS: TagDisplayScene[] = ['library', 'drawResult', 'bigScreen', 'filter', 'dedup'];
const CATEGORY_KEYS: TagCategory[] = ['type', 'difficulty', 'source_type', 'custom'];

/** 判断是否为旧格式（v3 单场景 / v2 enabled+selectedTags / v1 hiddenValues+bigScreenOverrides） */
function isLegacyConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  // v3 旧格式（直接含 categoryEnabled / selectedValues，无 scenes）
  if ('categoryEnabled' in r || 'selectedValues' in r) return true;
  // v2 旧格式
  if ('enabled' in r && 'selectedTags' in r) return true;
  // v1 旧格式
  if ('hiddenValues' in r || 'bigScreenOverrides' in r) return true;
  // 新格式但 scenes 不是对象 → 视为旧/损坏
  if ('scenes' in r && (typeof r.scenes !== 'object' || r.scenes === null)) return true;
  return false;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string');
}

/** 合并单场景配置与默认值 */
function mergeScene(raw: unknown): SceneTagConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SCENE_CONFIG };
  const r = raw as Record<string, unknown>;
  const ce = (r.categoryEnabled ?? {}) as Record<string, unknown>;
  const sv = (r.selectedValues ?? {}) as Record<string, unknown>;
  return {
    categoryEnabled: {
      type: asBool(ce.type, DEFAULT_SCENE_CONFIG.categoryEnabled.type),
      difficulty: asBool(ce.difficulty, DEFAULT_SCENE_CONFIG.categoryEnabled.difficulty),
      source_type: asBool(ce.source_type, DEFAULT_SCENE_CONFIG.categoryEnabled.source_type),
      custom: asBool(ce.custom, DEFAULT_SCENE_CONFIG.categoryEnabled.custom)
    },
    selectedValues: {
      type: asStrArr(sv.type),
      difficulty: asStrArr(sv.difficulty),
      source_type: asStrArr(sv.source_type),
      custom: asStrArr(sv.custom)
    }
  };
}

/** 合并完整配置与默认值，确保所有场景与字段存在 */
function mergeWithDefaults(raw: unknown): TagDisplayConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_TAG_DISPLAY_CONFIG;
  const r = raw as Record<string, unknown>;
  const scenesRaw = (r.scenes ?? {}) as Record<string, unknown>;
  const scenes = {} as Record<TagDisplayScene, SceneTagConfig>;
  SCENE_KEYS.forEach((scene) => {
    scenes[scene] = mergeScene(scenesRaw[scene]);
  });
  return { scenes };
}

/**
 * 从 settings store 读取配置，缺省时返回默认配置。
 * 向后兼容：旧格式（v1/v2/v3）保守转为默认（5 场景全开 + 全部白名单空）。
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
 * 过滤单个标签值（按场景配置）
 * @returns 通过过滤的值（类别关闭或不在 selectedValues 中则返回 null）
 */
export function filterTag(
  config: TagDisplayConfig,
  value: string | null | undefined,
  category: TagCategory,
  scene: TagDisplayScene
): string | null {
  if (!value) return null;
  const sceneCfg = config.scenes[scene];
  if (!sceneCfg.categoryEnabled[category]) return null;
  const selected = sceneCfg.selectedValues[category];
  // selectedValues 为空 = 显示全部
  if (selected.length === 0) return value;
  return selected.includes(value) ? value : null;
}

/**
 * 过滤标签数组（按场景配置）
 * @returns 过滤后的数组（类别关闭返回空数组，selectedValues 空返回原数组，非空只保留选中的）
 */
export function filterTags(
  config: TagDisplayConfig,
  tags: string[] | null | undefined,
  category: TagCategory,
  scene: TagDisplayScene
): string[] {
  if (!tags || tags.length === 0) return [];
  const sceneCfg = config.scenes[scene];
  if (!sceneCfg.categoryEnabled[category]) return [];
  const selected = sceneCfg.selectedValues[category];
  // selectedValues 为空 = 显示全部
  if (selected.length === 0) return tags;
  return tags.filter((t) => selected.includes(t));
}

// 导出常量供 UI 使用
export { SCENE_KEYS, CATEGORY_KEYS };
