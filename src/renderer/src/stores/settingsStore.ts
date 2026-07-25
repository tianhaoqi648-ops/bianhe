import { create } from 'zustand';
import type { ApiResponse, ResetDataRequest, ResetDataResponse } from '../../../shared/types';
import {
  CONFIG_RESET_KEYS,
  OFFICIAL_TOPIC_SETTINGS_KEYS,
  type ConfigResetCategory,
  type ResetCategory
} from '../../../shared/settings-defaults';

/** 数据类重置选项（与 ResetDataRequest.dataOptions 一致） */
export interface DataResetOptions {
  topics?: { keepOfficial: boolean };
  events?: boolean;
  drawSessions?: boolean;
  importBatches?: boolean;
  auditLogs?: boolean;
}

interface SettingsState {
  /** 内存中的全部设置（key -> value） */
  settings: Record<string, any>;
  loading: boolean;
  error: string | null;

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
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  loading: false,
  error: null,

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

    return data;
  }
}));

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
