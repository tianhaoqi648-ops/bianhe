import { create } from 'zustand';
import type { ApiResponse, ResetDataRequest, ResetDataResponse } from '../../../shared/types';
import {
  CONFIG_RESET_KEYS,
  OFFICIAL_TOPIC_SETTINGS_KEYS,
  type ConfigResetCategory,
  type ResetCategory
} from '../../../shared/settings-defaults';
import {
  DEFAULT_TIMER_BACKGROUND,
  TIMER_BACKGROUND_KEY,
  mergeTimerBackground,
  type TimerBackgroundSetting
} from '../../../shared/timer-backgrounds';
import { undoManager, registerStoreRefresher } from '../utils/undo-manager';
import type { LLMConfig } from '../../../shared/agent-types';

/** BGM 设置类型 */
export interface BgmSetting {
  /** 音量 0-100 */
  volume: number;
  /** 默认曲目 */
  defaultTrack: 'ethereal' | 'solemn' | 'stirring';
}

/** BGM 设置在 settings 中的 key */
export const BGM_KEY = 'bgm';

/** BGM 设置默认值 */
export const DEFAULT_BGM_SETTING: BgmSetting = {
  volume: 50,
  defaultTrack: 'ethereal'
};

/** 主题模式：亮色 / 暗色 / 跟随系统 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** localStorage 持久化的 UI 设置 key（统一命名空间，便于后续扩展） */
const UI_LS_KEY = 'bianhe-settings';

/** localStorage 持久化的 UI 引导状态（onboardingCompleted / showWorkflowCard / sampleDataPrompted） */
interface OnboardingUIState {
  themeMode: ThemeMode;
  onboardingCompleted: boolean;
  showWorkflowCard: boolean;
  sampleDataPrompted: boolean;
}

/**
 * 从 localStorage 读取持久化的 UI 设置（themeMode + 引导相关字段）。
 * 在 node 测试环境 / 访问异常时安全回退到默认值。
 */
function loadPersistedUI(): OnboardingUIState {
  const fallback: OnboardingUIState = {
    themeMode: 'system',
    onboardingCompleted: false,
    showWorkflowCard: true,
    sampleDataPrompted: false
  };
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(UI_LS_KEY);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    const m = obj?.themeMode;
    const result: OnboardingUIState = {
      themeMode: m === 'light' || m === 'dark' || m === 'system' ? m : 'system',
      onboardingCompleted: obj?.onboardingCompleted === true,
      showWorkflowCard: obj?.showWorkflowCard !== false, // 默认 true（未设置时显示）
      sampleDataPrompted: obj?.sampleDataPrompted === true
    };
    return result;
  } catch {
    return fallback;
  }
}

/**
 * 将任意 UI 字段写入 localStorage（合并写，保护其他字段）。
 */
function persistUIField(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    let obj: Record<string, unknown> = {};
    try {
      const raw = window.localStorage.getItem(UI_LS_KEY);
      if (raw) obj = JSON.parse(raw) || {};
    } catch {
      obj = {};
    }
    obj[key] = value;
    window.localStorage.setItem(UI_LS_KEY, JSON.stringify(obj));
  } catch {
    // localStorage 不可用时静默失败（不影响内存中的状态）
  }
}

/** AI 助手默认配置（DeepSeek 为默认服务商） */
const DEFAULT_AI_CONFIG: LLMConfig = {
  provider: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat'
};

/**
 * 从 localStorage 读取持久化的 AI 助手配置（aiConfig + aiEnabled）。
 * 复用 UI_LS_KEY 命名空间，与 themeMode 等偏好合并存储。
 * 在 node 测试环境 / 访问异常时安全回退到默认值。
 */
function loadAISettings(): { aiConfig: LLMConfig; aiEnabled: boolean } {
  const fallback = { aiConfig: { ...DEFAULT_AI_CONFIG }, aiEnabled: true };
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(UI_LS_KEY);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    const cfg = obj?.aiConfig;
    const aiConfig: LLMConfig =
      cfg && typeof cfg === 'object' ? { ...DEFAULT_AI_CONFIG, ...cfg } : { ...DEFAULT_AI_CONFIG };
    const aiEnabled = typeof obj?.aiEnabled === 'boolean' ? obj.aiEnabled : true;
    return { aiConfig, aiEnabled };
  } catch {
    return fallback;
  }
}

/** 数据类重置选项（与 ResetDataRequest.dataOptions 一致） */
export interface DataResetOptions {
  topics?: { keepOfficial: boolean };
  events?: boolean;
  drawSessions?: boolean;
  importBatches?: boolean;
  auditLogs?: boolean;
  batchEditHistory?: boolean;
  undoLog?: boolean;
}

interface SettingsState {
  /** 内存中的全部设置（key -> value） */
  settings: Record<string, any>;
  loading: boolean;
  error: string | null;
  /** 主题模式（UI 偏好，localStorage 持久化；默认 'system' 跟随系统） */
  themeMode: ThemeMode;
  /** 引导是否已完成（首次启动 Tour 完成或跳过后置 true；持久化 localStorage） */
  onboardingCompleted: boolean;
  /** 是否显示工作流引导卡（完成所有步骤后自动置 false；持久化 localStorage） */
  showWorkflowCard: boolean;
  /** 是否已询问过示例数据填充（询问后无论用户选择都置 true，避免重复打扰） */
  sampleDataPrompted: boolean;
  /** AI 助手配置（LLM 连接信息，localStorage 持久化） */
  aiConfig: LLMConfig;
  /** AI 助手开关（默认 true，可关闭回滚） */
  aiEnabled: boolean;

  /** 拉取全部 settings */
  fetchAll: () => Promise<void>;
  /** 读取单个 key */
  get: (key: string) => Promise<any>;
  /** 写入单个 key，同时更新内存 */
  set: (key: string, value: any) => Promise<boolean>;
  /** 删除单个 key，同时从内存中移除 */
  delete: (key: string) => Promise<boolean>;
  /** 批量删除 keys，同步更新内存 */
  deleteBatch: (keys: string[]) => Promise<number>;
  /** 按类别重置（语义化封装，内部映射 keys 调 deleteBatch） */
  resetByCategories: (categories: ResetCategory[]) => Promise<number>;
  /**
   * 统一数据重置入口：配置类 + 数据类。
   * - 配置类：根据 configCategories 计算 keys 并集
   * - 数据类：透传 dataOptions（topics/events/drawSessions/importBatches/auditLogs）
   * - 同步更新内存：移除已删除的配置 key；题库重置不保留官方时同步移除 official_* 标记
   * 返回各表删除行数详情。
   */
  resetAll: (
    configCategories: ConfigResetCategory[],
    dataOptions: DataResetOptions
  ) => Promise<ResetDataResponse>;
  /** 设置主题模式（同步写入 localStorage + 更新内存） */
  setThemeMode: (mode: ThemeMode) => void;
  /** 设置引导完成状态（同步写入 localStorage + 更新内存） */
  setOnboardingCompleted: (v: boolean) => void;
  /** 设置工作流卡显隐（同步写入 localStorage + 更新内存） */
  setShowWorkflowCard: (v: boolean) => void;
  /** 设置示例数据询问标记（同步写入 localStorage + 更新内存） */
  setSampleDataPrompted: (v: boolean) => void;
  /** 更新 AI 配置（部分更新，合并到现有 aiConfig 并持久化） */
  setAIConfig: (partial: Partial<LLMConfig>) => void;
  /** 切换 AI 助手开关（同步写入 localStorage + 更新内存） */
  setAIEnabled: (enabled: boolean) => void;
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

// 注册 settingsStore 的刷新函数：undo 后重新拉取全部 settings
registerStoreRefresher('settings', () => {
  void useSettingsStore.getState().fetchAll();
});

export const useSettingsStore = create<SettingsState>((set, get) => {
  // 启动时同步从 localStorage 读取，避免首屏闪烁
  const persisted = loadPersistedUI();
  const aiSettings = loadAISettings();
  return {
  settings: {},
  loading: false,
  error: null,
  themeMode: persisted.themeMode,
  onboardingCompleted: persisted.onboardingCompleted,
  showWorkflowCard: persisted.showWorkflowCard,
  sampleDataPrompted: persisted.sampleDataPrompted,
  aiConfig: aiSettings.aiConfig,
  aiEnabled: aiSettings.aiEnabled,

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const res = await window.settingsAPI.getAll();
      const data = extractError<Record<string, any>>(res);
      set({ settings: data, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  get: async (key) => {
    const res = await window.settingsAPI.get(key);
    return extractError<any>(res);
  },

  set: async (key, value) => {
    const res = await window.settingsAPI.set(key, value);
    extractError(res);
    // 同步更新内存
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
    undoManager.pushEntry({
      storeName: 'settings',
      action: 'set',
      targetType: 'setting',
      targetId: key,
      label: `修改设置 ${key}`,
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  delete: async (key) => {
    const res = await window.settingsAPI.delete(key);
    extractError(res);
    set((s) => {
      const next = { ...s.settings };
      delete next[key];
      return { settings: next };
    });
    undoManager.pushEntry({
      storeName: 'settings',
      action: 'deleteKey',
      targetType: 'setting',
      targetId: key,
      label: `删除设置 ${key}`,
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  deleteBatch: async (keys) => {
    const res = await window.settingsAPI.deleteBatch(keys);
    const deleted = extractError<number>(res);
    // 从内存 map 移除对应 key
    set((s) => {
      const next = { ...s.settings };
      for (const k of keys) delete next[k];
      return { settings: next };
    });
    undoManager.pushEntry({
      storeName: 'settings',
      action: 'deleteBatch',
      targetType: 'setting',
      targetId: null,
      label: `批量删除 ${keys.length} 项设置`,
      logId: res._undoLogId ?? undefined
    });
    return deleted;
  },

  resetByCategories: async (categories) => {
    const keys = Array.from(
      new Set(categories.flatMap((c) => CONFIG_RESET_KEYS[c] ?? []))
    );
    if (keys.length === 0) return 0;
    return await get().deleteBatch(keys);
  },

  resetAll: async (configCategories, dataOptions) => {
    // 1. 计算 configKeys 并集
    const configKeys = Array.from(
      new Set(configCategories.flatMap((c) => CONFIG_RESET_KEYS[c] ?? []))
    );

    // 2. 调主进程统一重置入口
    const req: ResetDataRequest = { configKeys, dataOptions };
    const res = await window.systemAPI.resetData(req);
    const data = extractError<ResetDataResponse>(res);

    // 3. 同步更新内存：移除已删除的配置 key
    const keysToRemove = new Set<string>(configKeys);
    // 题库不保留官方时，official_* 标记在主进程也被删除，同步从内存移除
    if (dataOptions.topics && !dataOptions.topics.keepOfficial) {
      for (const k of OFFICIAL_TOPIC_SETTINGS_KEYS) keysToRemove.add(k);
    }
    if (keysToRemove.size > 0) {
      set((s) => {
        const next = { ...s.settings };
        for (const k of keysToRemove) delete next[k];
        return { settings: next };
      });
    }

    // 4. 若清空了 undo_log，同步清空渲染进程的 undoManager 栈
    if (dataOptions.undoLog) {
      undoManager.clearStack();
    }

    return data;
  },

  setThemeMode: (mode) => {
    set({ themeMode: mode });
    persistUIField('themeMode', mode);
  },

  setOnboardingCompleted: (v) => {
    set({ onboardingCompleted: v });
    persistUIField('onboardingCompleted', v);
  },

  setShowWorkflowCard: (v) => {
    set({ showWorkflowCard: v });
    persistUIField('showWorkflowCard', v);
  },

  setSampleDataPrompted: (v) => {
    set({ sampleDataPrompted: v });
    persistUIField('sampleDataPrompted', v);
  },

  setAIConfig: (partial) => {
    const merged = { ...get().aiConfig, ...partial };
    set({ aiConfig: merged });
    persistUIField('aiConfig', merged);
  },

  setAIEnabled: (enabled) => {
    set({ aiEnabled: enabled });
    persistUIField('aiEnabled', enabled);
  }
};
});

/** 工具函数：读取布尔型配置（默认 false） */
export function getBoolSetting(settings: Record<string, any>, key: string): boolean {
  return settings[key] === true || settings[key] === 'true';
}

/** 工具函数：读取数值型配置（带默认值） */
export function getNumberSetting(
  settings: Record<string, any>,
  key: string,
  defaultValue: number
): number {
  const v = settings[key];
  if (v == null) return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

/** 工具函数：读取字符串型配置（带默认值） */
export function getStringSetting(
  settings: Record<string, any>,
  key: string,
  defaultValue: string
): string {
  const v = settings[key];
  return v == null ? defaultValue : String(v);
}

/**
 * 工具函数：读取计时器背景设置（带默认值合并）。
 * settings 中无值或非法时回退到 DEFAULT_TIMER_BACKGROUND（深蓝渐变）。
 */
export function getTimerBackgroundSetting(
  settings: Record<string, any>
): TimerBackgroundSetting {
  const raw = settings[TIMER_BACKGROUND_KEY];
  return mergeTimerBackground(raw as Partial<TimerBackgroundSetting> | null | undefined);
}

/**
 * 工具函数：读取 BGM 设置（带默认值合并）。
 * settings 中无值或非法时回退到 DEFAULT_BGM_SETTING。
 */
export function getBgmSetting(settings: Record<string, any>): BgmSetting {
  const raw = settings[BGM_KEY];
  if (!raw || typeof raw !== 'object') return DEFAULT_BGM_SETTING;
  const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume)
    ? Math.max(0, Math.min(100, raw.volume))
    : DEFAULT_BGM_SETTING.volume;
  const defaultTrack: BgmSetting['defaultTrack'] =
    raw.defaultTrack === 'ethereal' || raw.defaultTrack === 'solemn' || raw.defaultTrack === 'stirring'
      ? raw.defaultTrack
      : DEFAULT_BGM_SETTING.defaultTrack;
  return { volume, defaultTrack };
}

/** 计时器背景默认值（导出供组件使用） */
export { DEFAULT_TIMER_BACKGROUND, TIMER_BACKGROUND_KEY };
