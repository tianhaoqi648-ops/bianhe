import { create } from 'zustand';
import type {
  AuditLog,
  AuditLogFilter,
  AuditLogCreateInput,
  ExportLogsRequest,
  ExportLogsResult,
  ApiResponse
} from '../../../shared/types';

interface AuditListResponse {
  items: AuditLog[];
  total: number;
}

interface AuditState {
  items: AuditLog[];
  total: number;
  loading: boolean;
  error: string | null;

  listLogs: (filter?: AuditLogFilter) => Promise<AuditLog[]>;
  addLog: (input: AuditLogCreateInput) => Promise<AuditLog | null>;
  deleteLog: (id: string) => Promise<boolean>;
  clearLogs: (beforeDate?: string) => Promise<boolean>;
  exportLogs: (req: ExportLogsRequest) => Promise<ExportLogsResult | null>;
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

export const useAuditStore = create<AuditState>((set) => ({
  items: [],
  total: 0,
  loading: false,
  error: null,

  listLogs: async (filter) => {
    set({ loading: true, error: null });
    try {
      const res = await window.auditAPI.listLogs(filter);
      const data = extractError<AuditListResponse>(res);
      set({ items: data.items, total: data.total, loading: false });
      return data.items;
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  },

  addLog: async (input) => {
    const res = await window.auditAPI.addLog(input);
    return extractError<AuditLog>(res);
  },

  deleteLog: async (id) => {
    const res = await window.auditAPI.deleteLog(id);
    extractError(res);
    return true;
  },

  clearLogs: async (beforeDate) => {
    const res = await window.auditAPI.clearLogs(beforeDate);
    extractError(res);
    return true;
  },

  exportLogs: async (req) => {
    const res = await window.auditAPI.exportLogs(req);
    return extractError<ExportLogsResult>(res);
  }
}));
