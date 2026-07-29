import { create } from 'zustand';
import type {
  DrawParams,
  DrawResult,
  DrawSession,
  DrawSessionDetail,
  SessionFilter,
  ApiResponse
} from '../../../shared/types';
import { undoManager, registerStoreRefresher } from '../utils/undo-manager';

interface SessionListResponse {
  items: DrawSession[];
  total: number;
}

interface DrawState {
  // 抽取参数（赛事现场反复调整用）
  drawParams: DrawParams | null;
  // 最近一次抽取结果
  lastResult: DrawResult | null;
  // 历史会话列表
  sessions: DrawSession[];
  total: number;
  loading: boolean;
  // 当前查看的会话详情
  currentSession: DrawSessionDetail | null;
  error: string | null;

  setDrawParams: (p: DrawParams | null) => void;
  /** 直接覆盖 lastResult（用于 confirmDrawSession 后用更新后的 session 替换原 session） */
  setLastResult: (r: DrawResult | null) => void;
  execute: (params: DrawParams) => Promise<DrawResult | null>;
  redo: (oldSessionId: string, params: DrawParams) => Promise<DrawResult | null>;

  listSessions: (filter?: SessionFilter) => Promise<void>;
  getSession: (id: string) => Promise<DrawSessionDetail | null>;
  deleteSession: (id: string) => Promise<boolean>;
  listDrawnTopicIds: (eventId: string) => Promise<string[]>;
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

// 注册 drawStore 的刷新函数：undo execute 后重新拉取 sessions
registerStoreRefresher('draw', () => {
  void useDrawStore.getState().listSessions();
});

export const useDrawStore = create<DrawState>((set) => ({
  drawParams: null,
  lastResult: null,
  sessions: [],
  total: 0,
  loading: false,
  currentSession: null,
  error: null,

  setDrawParams: (p) => set({ drawParams: p }),

  setLastResult: (r) => set({ lastResult: r }),

  execute: async (params) => {
    const res = await window.drawAPI.execute(params);
    const data = extractError<DrawResult>(res);
    set({ lastResult: data });
    undoManager.pushEntry({
      storeName: 'draw',
      action: 'execute',
      targetType: 'session',
      targetId: data.session.id,
      label: `执行抽取（${params.topic_count} 题）`,
      logId: res._undoLogId ?? undefined
    });
    return data;
  },

  redo: async (oldSessionId, params) => {
    const res = await window.drawAPI.redo(oldSessionId, params);
    const data = extractError<DrawResult>(res);
    set({ lastResult: data });
    // Critical-2 修复：redo 必须入 undo 栈。
    // IPC handler 已用 withUndoLog 包裹（action='redraw'），DB 中有 undo_log 记录，
    // 若不入栈会导致 undo 栈与 DB 失同步。
    undoManager.pushEntry({
      storeName: 'draw',
      action: 'redraw',
      targetType: 'session',
      targetId: data.session.id,
      label: `重抽（${params.topic_count} 题）`,
      logId: res._undoLogId ?? undefined
    });
    return data;
  },

  listSessions: async (filter) => {
    set({ loading: true, error: null });
    try {
      const res = await window.drawAPI.listSessions(filter);
      const data = extractError<SessionListResponse>(res);
      set({ sessions: data.items, total: data.total, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  getSession: async (id) => {
    const res = await window.drawAPI.getSession(id);
    const data = extractError<DrawSessionDetail>(res);
    set({ currentSession: data });
    return data;
  },

  deleteSession: async (id) => {
    const res = await window.drawAPI.deleteSession(id);
    extractError(res);
    return true;
  },

  listDrawnTopicIds: async (eventId) => {
    const res = await window.drawAPI.listDrawnTopicIds(eventId);
    return extractError<string[]>(res) ?? [];
  }
}));
