import { create } from 'zustand';
import type {
  Topic,
  TopicFilter,
  TopicCreateInput,
  TopicUpdateInput,
  ApiResponse
} from '../../../shared/types';

interface TopicListResponse {
  items: Topic[];
  total: number;
}

interface TopicState {
  // 列表数据
  items: Topic[];
  total: number;
  loading: boolean;
  // 筛选条件
  filter: TopicFilter;
  // 视图模式
  viewMode: 'list' | 'grid';
  // 选中项（批量操作）
  selectedIds: string[];
  // 错误信息
  error: string | null;

  // actions
  setFilter: (filter: Partial<TopicFilter>) => void;
  resetFilter: () => void;
  setViewMode: (mode: 'list' | 'grid') => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  select: (id: string) => void;
  deselect: (id: string) => void;
  clearSelection: () => void;

  fetchList: (overrideFilter?: Partial<TopicFilter>) => Promise<void>;
  fetchCount: () => Promise<number>;
  create: (data: TopicCreateInput) => Promise<Topic | null>;
  update: (id: string, data: TopicUpdateInput) => Promise<Topic | null>;
  remove: (id: string) => Promise<boolean>;
  batchRemove: (ids: string[]) => Promise<boolean>;
  updateStatus: (id: string, status: string) => Promise<boolean>;
  updateWeight: (id: string, weight: number) => Promise<boolean>;
}

const DEFAULT_FILTER: TopicFilter = {
  page: 1,
  pageSize: 20
};

// 统一错误提取
function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

export const useTopicStore = create<TopicState>((set, get) => ({
  items: [],
  total: 0,
  loading: false,
  filter: { ...DEFAULT_FILTER },
  viewMode: 'grid',
  selectedIds: [],
  error: null,

  setFilter: (partial) =>
    set((s) => ({
      filter: { ...s.filter, ...partial, page: partial.page ?? 1 }
    })),
  resetFilter: () => set({ filter: { ...DEFAULT_FILTER } }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id]
    })),
  select: (id: string) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id) ? s.selectedIds : [...s.selectedIds, id]
    })),
  deselect: (id: string) =>
    set((s) => ({
      selectedIds: s.selectedIds.filter((x) => x !== id)
    })),
  clearSelection: () => set({ selectedIds: [] }),

  fetchList: async (overrideFilter?: Partial<TopicFilter>) => {
    if (overrideFilter) {
      set((s) => ({
        filter: { ...s.filter, ...overrideFilter, page: overrideFilter.page ?? 1 }
      }));
    }
    set({ loading: true, error: null });
    try {
      const res = await window.topicAPI.list(get().filter);
      const data = extractError<TopicListResponse>(res);
      set({ items: data.items, total: data.total, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  fetchCount: async () => {
    const res = await window.topicAPI.count(get().filter);
    return extractError<number>(res);
  },

  create: async (data) => {
    const res = await window.topicAPI.create(data);
    return extractError<Topic>(res);
  },

  update: async (id, data) => {
    const res = await window.topicAPI.update(id, data);
    return extractError<Topic>(res);
  },

  remove: async (id) => {
    const res = await window.topicAPI.delete(id);
    extractError(res);
    return true;
  },

  batchRemove: async (ids) => {
    const res = await window.topicAPI.batchDelete(ids);
    extractError(res);
    return true;
  },

  updateStatus: async (id, status) => {
    const res = await window.topicAPI.updateStatus(id, status);
    extractError(res);
    return true;
  },

  updateWeight: async (id, weight) => {
    const res = await window.topicAPI.updateWeight(id, weight);
    extractError(res);
    return true;
  }
}));
