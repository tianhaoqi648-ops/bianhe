// ============================================================
// formatStore.ts — 赛制 Zustand store
// ============================================================

import { create } from 'zustand';
import { undoManager, registerStoreRefresher } from '../utils/undo-manager';
import type { DebateFormat, DebateFormatData } from '../../../shared/types';

// 注册 formatStore 的刷新函数（undo/redo 后调用，确保渲染层赛制列表与 DB 一致）
registerStoreRefresher('format', () => {
  void useFormatStore.getState().fetchAll();
});

interface FormatStoreState {
  formats: DebateFormat[];
  loading: boolean;
  error: string | null;
  selectedFormatId: string | null;

  fetchAll: () => Promise<void>;
  selectFormat: (id: string | null) => void;
  createFormat: (opts: { name: string; description?: string; formatData: DebateFormatData }) => Promise<DebateFormat | null>;
  updateFormat: (id: string, opts: { name?: string; description?: string; formatData?: DebateFormatData }) => Promise<DebateFormat | null>;
  deleteFormat: (id: string) => Promise<boolean>;
  /** 导入赛制（从 JSON 重建） */
  importFormat: (data: { name: string; description?: string; formatData: DebateFormatData }) => Promise<DebateFormat | null>;
  /** 导出赛制为 JSON（不修改 store，仅返回数据） */
  exportFormat: (id: string) => Promise<{ name: string; description: string; formatData: DebateFormatData } | null>;
  /** 复制赛制（另存为副本） */
  duplicateFormat: (id: string, newName?: string) => Promise<DebateFormat | null>;
}

export const useFormatStore = create<FormatStoreState>((set, get) => ({
  formats: [],
  loading: false,
  error: null,
  selectedFormatId: null,

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const res = await window.formatAPI.list();
      if (res.success && res.data) {
        set({ formats: res.data, loading: false });
      } else {
        set({ loading: false, error: res.error ?? '加载失败' });
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '加载失败' });
    }
  },

  selectFormat: (id) => set({ selectedFormatId: id }),

  createFormat: async (opts) => {
    try {
      const res = await window.formatAPI.create(opts);
      if (res.success && res.data) {
        set((s) => ({ formats: [...s.formats, res.data!] }));
        undoManager.pushEntry({
          storeName: 'format',
          action: 'create',
          targetType: 'format',
          targetId: res.data!.id,
          label: `创建赛制 ${res.data!.name}`,
          logId: res._undoLogId ?? undefined
        });
        return res.data;
      }
      set({ error: res.error ?? '创建失败' });
      return null;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '创建失败' });
      return null;
    }
  },

  updateFormat: async (id, opts) => {
    try {
      const res = await window.formatAPI.update(id, opts);
      if (res.success && res.data) {
        set((s) => ({
          formats: s.formats.map((f) => (f.id === id ? res.data! : f))
        }));
        undoManager.pushEntry({
          storeName: 'format',
          action: 'update',
          targetType: 'format',
          targetId: id,
          label: '更新赛制',
          logId: res._undoLogId ?? undefined
        });
        return res.data;
      }
      set({ error: res.error ?? '更新失败' });
      return null;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '更新失败' });
      return null;
    }
  },

  deleteFormat: async (id) => {
    try {
      const res = await window.formatAPI.delete(id);
      if (res.success && res.data) {
        set((s) => ({ formats: s.formats.filter((f) => f.id !== id) }));
        undoManager.pushEntry({
          storeName: 'format',
          action: 'delete',
          targetType: 'format',
          targetId: id,
          label: '删除赛制',
          logId: res._undoLogId ?? undefined
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  importFormat: async (data) => {
    try {
      const res = await window.formatAPI.importFormat(data);
      if (res.success && res.data) {
        set((s) => ({ formats: [...s.formats, res.data!] }));
        undoManager.pushEntry({
          storeName: 'format',
          action: 'create',
          targetType: 'format',
          targetId: res.data!.id,
          label: `导入赛制 ${res.data!.name}`,
          logId: res._undoLogId ?? undefined
        });
        return res.data;
      }
      set({ error: res.error ?? '导入失败' });
      return null;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '导入失败' });
      return null;
    }
  },

  exportFormat: async (id) => {
    try {
      const res = await window.formatAPI.exportFormat(id);
      if (res.success && res.data) {
        return res.data;
      }
      set({ error: res.error ?? '导出失败' });
      return null;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '导出失败' });
      return null;
    }
  },

  duplicateFormat: async (id, newName) => {
    // 复制 = 导出 + 导入
    const exported = await get().exportFormat(id);
    if (!exported) return null;
    return get().importFormat({
      name: newName ?? `${exported.name} 副本`,
      description: exported.description || undefined,
      formatData: exported.formatData
    });
  }
}));
