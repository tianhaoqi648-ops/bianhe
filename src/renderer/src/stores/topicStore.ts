import { create } from 'zustand';
import type {
  Topic,
  TopicFilter,
  TopicCreateInput,
  TopicUpdateInput,
  ApiResponse
} from '../../../shared/types';
import { undoManager, registerStoreRefresher } from '../utils/undo-manager';

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
  // 跨页全选模式：篮选项下全部选中，exceptIds 黑名单排除
  allSelectedInFilter: boolean;
  exceptIds: string[];
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
  selectAllInFilter: () => void;
  unselectInAllMode: (id: string) => void;
  removeFromExcept: (id: string) => void;
  isSelected: (id: string) => boolean;
  getSelectedIdsForBatchOp: () => Promise<string[]>;
  selectPage: (ids: string[]) => void;

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

// 注册 topicStore 的刷新函数（undo 后调用，确保渲染层数据与 DB 一致）
// 注意：需在 create store 之前注册，但因 useTopicStore 引用未定义，使用前置声明
// 实际通过 void useTopicStore.getState().fetchList() 调用，需在文件加载完毕后才能成功
// 这里采用 lazy 引用模式：refresher 内部访问 useTopicStore
registerStoreRefresher('topic', () => {
  // 触发当前 filter 下的列表重新拉取（fetchList 内部使用 get().filter）
  void useTopicStore.getState().fetchList();
});

export const useTopicStore = create<TopicState>((set, get) => ({
  items: [],
  total: 0,
  loading: false,
  filter: { ...DEFAULT_FILTER },
  viewMode: 'grid',
  selectedIds: [],
  allSelectedInFilter: false,
  exceptIds: [],
  error: null,

  setFilter: (partial) =>
    set((s) => ({
      filter: { ...s.filter, ...partial, page: partial.page ?? 1 }
    })),
  resetFilter: () => set({ filter: { ...DEFAULT_FILTER } }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  toggleSelect: (id) =>
    set((s) => {
      if (s.allSelectedInFilter) {
        // 全选模式下：toggle 即在 exceptIds 中加/减
        if (s.exceptIds.includes(id)) {
          return { exceptIds: s.exceptIds.filter((x) => x !== id) };
        }
        return { exceptIds: [...s.exceptIds, id] };
      }
      return {
        selectedIds: s.selectedIds.includes(id)
          ? s.selectedIds.filter((x) => x !== id)
          : [...s.selectedIds, id]
      };
    }),
  select: (id: string) =>
    set((s) => {
      if (s.allSelectedInFilter) {
        // 全选模式下：select 即从 exceptIds 移除
        return { exceptIds: s.exceptIds.filter((x) => x !== id) };
      }
      return {
        selectedIds: s.selectedIds.includes(id) ? s.selectedIds : [...s.selectedIds, id]
      };
    }),
  deselect: (id: string) =>
    set((s) => {
      if (s.allSelectedInFilter) {
        // 全选模式下：deselect 即加入 exceptIds
        return s.exceptIds.includes(id) ? s : { exceptIds: [...s.exceptIds, id] };
      }
      return { selectedIds: s.selectedIds.filter((x) => x !== id) };
    }),
  clearSelection: () =>
    set({ selectedIds: [], allSelectedInFilter: false, exceptIds: [] }),
  selectAllInFilter: () =>
    set({ allSelectedInFilter: true, exceptIds: [], selectedIds: [] }),
  unselectInAllMode: (id: string) =>
    set((s) => ({
      exceptIds: s.exceptIds.includes(id) ? s.exceptIds : [...s.exceptIds, id]
    })),
  removeFromExcept: (id: string) =>
    set((s) => ({
      exceptIds: s.exceptIds.filter((x) => x !== id)
    })),
  isSelected: (id: string) => {
    const s = get();
    if (s.allSelectedInFilter) return !s.exceptIds.includes(id);
    return s.selectedIds.includes(id);
  },
  // 选中当前页：退出跨页全选模式，重置为显式 selectedIds
  selectPage: (ids: string[]) =>
    set({ allSelectedInFilter: false, exceptIds: [], selectedIds: ids }),

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
    const created = extractError<Topic>(res);
    undoManager.pushEntry({
      storeName: 'topic',
      action: 'create',
      targetType: 'topic',
      targetId: created.id,
      label: '创建辩题',
      logId: res._undoLogId ?? undefined
    });
    return created;
  },

  update: async (id, data) => {
    const res = await window.topicAPI.update(id, data);
    const updated = extractError<Topic>(res);
    undoManager.pushEntry({
      storeName: 'topic',
      action: 'update',
      targetType: 'topic',
      targetId: id,
      label: `更新辩题 ${id.slice(0, 8)}`,
      logId: res._undoLogId ?? undefined
    });
    return updated;
  },

  remove: async (id) => {
    const res = await window.topicAPI.delete(id);
    extractError(res);
    undoManager.pushEntry({
      storeName: 'topic',
      action: 'delete',
      targetType: 'topic',
      targetId: id,
      label: '删除辩题',
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  batchRemove: async (ids) => {
    const res = await window.topicAPI.batchDelete(ids);
    extractError(res);
    undoManager.pushEntry({
      storeName: 'topic',
      action: 'batchDelete',
      targetType: 'topic',
      targetId: null,
      label: `批量删除 ${ids.length} 条辩题`,
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  updateStatus: async (id, status) => {
    const res = await window.topicAPI.updateStatus(id, status);
    extractError(res);
    undoManager.pushEntry({
      storeName: 'topic',
      action: 'updateStatus',
      targetType: 'topic',
      targetId: id,
      label: '修改辩题状态',
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  updateWeight: async (id, weight) => {
    const res = await window.topicAPI.updateWeight(id, weight);
    extractError(res);
    undoManager.pushEntry({
      storeName: 'topic',
      action: 'updateWeight',
      targetType: 'topic',
      targetId: id,
      label: '修改辩题权重',
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  // P4-20 已知限制：使用 pageSize:100000 作为"全量"拉取的 workaround
  // 当筛选结果超过 10 万条时，批量操作（删除/导出）将静默截断，无法覆盖剩余项
  // 后续应提供专门的 listIds IPC（仅返回 id 数组，避免序列化全字段的开销）
  getSelectedIdsForBatchOp: async () => {
    const s = get();
    if (s.allSelectedInFilter) {
      // 拉取篮选项下全部 id，过滤 exceptIds
      // 注：pageSize:100000 为临时方案，超大数据集下存在截断风险（见 P4-20）
      const res = await window.topicAPI.list({
        ...s.filter,
        page: 1,
        pageSize: 100000
      });
      if (!res.success || !res.data) return [];
      const exceptSet = new Set(s.exceptIds);
      return res.data.items.map((t) => t.id).filter((id) => !exceptSet.has(id));
    }
    return s.selectedIds;
  }
}));
