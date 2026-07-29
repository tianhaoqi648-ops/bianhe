import { create } from 'zustand';
import type {
  Event,
  EventFilter,
  EventCreateInput,
  EventUpdateInput,
  Round,
  RoundCreateInput,
  RoundUpdateInput,
  Team,
  TeamCreateInput,
  TeamUpdateInput,
  TeamGroup,
  TeamGroupCreateInput,
  TeamGroupUpdateInput,
  RandomAssignGroupParams,
  RandomAssignGroupResult,
  ApiResponse
} from '../../../shared/types';
import { undoManager, registerStoreRefresher } from '../utils/undo-manager';

interface EventListResponse {
  items: Event[];
  total: number;
}

interface EventState {
  events: Event[];
  total: number;
  loading: boolean;
  // 当前选中赛事
  currentEvent: Event | null;
  // 当前赛事下的轮次、队伍与分组
  rounds: Round[];
  teams: Team[];
  groups: TeamGroup[];
  error: string | null;

  listEvents: (filter?: EventFilter) => Promise<Event[]>;
  getEvent: (id: string) => Promise<Event | null>;
  createEvent: (data: EventCreateInput) => Promise<Event | null>;
  updateEvent: (id: string, data: EventUpdateInput) => Promise<Event | null>;
  deleteEvent: (id: string) => Promise<boolean>;

  listRoundsByEvent: (eventId: string) => Promise<Round[]>;
  createRound: (data: RoundCreateInput) => Promise<Round | null>;
  updateRound: (id: string, data: RoundUpdateInput) => Promise<Round | null>;
  deleteRound: (id: string) => Promise<boolean>;

  listTeamsByEvent: (eventId: string) => Promise<Team[]>;
  createTeam: (data: TeamCreateInput) => Promise<Team | null>;
  updateTeam: (id: string, data: TeamUpdateInput) => Promise<Team | null>;
  deleteTeam: (id: string) => Promise<boolean>;

  // 队伍分组 actions
  fetchGroups: (eventId: string) => Promise<TeamGroup[]>;
  createGroup: (data: TeamGroupCreateInput) => Promise<TeamGroup | null>;
  updateGroup: (id: string, patch: TeamGroupUpdateInput) => Promise<TeamGroup | null>;
  deleteGroup: (id: string) => Promise<boolean>;
  assignTeamToGroup: (teamId: string, groupId: string | null) => Promise<boolean>;
  // 随机分组
  randomAssignGroups: (params: RandomAssignGroupParams) => Promise<RandomAssignGroupResult>;

  setCurrentEvent: (e: Event | null) => void;
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

// 注册 eventStore 的刷新函数：undo 后重新拉取 events / rounds / teams / groups
registerStoreRefresher('event', () => {
  const s = useEventStore.getState();
  // 刷新赛事列表
  void s.listEvents();
  // 若当前选中赛事，刷新其轮次、队伍与分组
  if (s.currentEvent) {
    void s.listRoundsByEvent(s.currentEvent.id);
    void s.listTeamsByEvent(s.currentEvent.id);
    void s.fetchGroups(s.currentEvent.id);
  }
});

export const useEventStore = create<EventState>((set) => ({
  events: [],
  total: 0,
  loading: false,
  currentEvent: null,
  rounds: [],
  teams: [],
  groups: [],
  error: null,

  listEvents: async (filter) => {
    const res = await window.eventAPI.listEvents(filter);
    const data = extractError<EventListResponse>(res);
    set({ events: data.items, total: data.total });
    return data.items;
  },

  getEvent: async (id) => {
    const res = await window.eventAPI.getEvent(id);
    return extractError<Event>(res);
  },

  createEvent: async (data) => {
    const res = await window.eventAPI.createEvent(data);
    const created = extractError<Event>(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'create',
      targetType: 'event',
      targetId: created.id,
      label: '创建赛事',
      logId: res._undoLogId ?? undefined
    });
    return created;
  },

  updateEvent: async (id, data) => {
    const res = await window.eventAPI.updateEvent(id, data);
    const updated = extractError<Event>(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'update',
      targetType: 'event',
      targetId: id,
      label: '更新赛事',
      logId: res._undoLogId ?? undefined
    });
    return updated;
  },

  deleteEvent: async (id) => {
    const res = await window.eventAPI.deleteEvent(id);
    extractError(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'delete',
      targetType: 'event',
      targetId: id,
      label: '删除赛事（子数据无法恢复）',
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  listRoundsByEvent: async (eventId) => {
    const res = await window.eventAPI.listRoundsByEvent(eventId);
    const data = extractError<Round[]>(res);
    set({ rounds: data });
    return data;
  },

  createRound: async (data) => {
    const res = await window.eventAPI.createRound(data);
    const created = extractError<Round>(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'create',
      targetType: 'round',
      targetId: created.id,
      label: '创建轮次',
      logId: res._undoLogId ?? undefined
    });
    return created;
  },

  updateRound: async (id, data) => {
    const res = await window.eventAPI.updateRound(id, data);
    const updated = extractError<Round>(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'update',
      targetType: 'round',
      targetId: id,
      label: '更新轮次',
      logId: res._undoLogId ?? undefined
    });
    return updated;
  },

  deleteRound: async (id) => {
    const res = await window.eventAPI.deleteRound(id);
    extractError(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'delete',
      targetType: 'round',
      targetId: id,
      label: '删除轮次',
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  listTeamsByEvent: async (eventId) => {
    const res = await window.eventAPI.listTeamsByEvent(eventId);
    const data = extractError<Team[]>(res);
    set({ teams: data });
    return data;
  },

  createTeam: async (data) => {
    const res = await window.eventAPI.createTeam(data);
    const created = extractError<Team>(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'create',
      targetType: 'team',
      targetId: created.id,
      label: '创建队伍',
      logId: res._undoLogId ?? undefined
    });
    return created;
  },

  updateTeam: async (id, data) => {
    const res = await window.eventAPI.updateTeam(id, data);
    const updated = extractError<Team>(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'update',
      targetType: 'team',
      targetId: id,
      label: '更新队伍',
      logId: res._undoLogId ?? undefined
    });
    return updated;
  },

  deleteTeam: async (id) => {
    const res = await window.eventAPI.deleteTeam(id);
    extractError(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'delete',
      targetType: 'team',
      targetId: id,
      label: '删除队伍',
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  // ---------- 队伍分组 actions ----------
  fetchGroups: async (eventId) => {
    const res = await window.eventAPI.listGroups(eventId);
    const data = extractError<TeamGroup[]>(res);
    set({ groups: data });
    return data;
  },

  createGroup: async (data) => {
    const res = await window.eventAPI.createGroup(data);
    const created = extractError<TeamGroup>(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'create',
      targetType: 'team_group',
      targetId: created.id,
      label: '创建分组',
      logId: res._undoLogId ?? undefined
    });
    return created;
  },

  updateGroup: async (id, patch) => {
    const res = await window.eventAPI.updateGroup(id, patch);
    const updated = extractError<TeamGroup>(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'update',
      targetType: 'team_group',
      targetId: id,
      label: '更新分组',
      logId: res._undoLogId ?? undefined
    });
    return updated;
  },

  deleteGroup: async (id) => {
    const res = await window.eventAPI.deleteGroup(id);
    extractError(res);
    undoManager.pushEntry({
      storeName: 'event',
      action: 'delete',
      targetType: 'team_group',
      targetId: id,
      label: '删除分组',
      logId: res._undoLogId ?? undefined
    });
    return true;
  },

  assignTeamToGroup: async (teamId, groupId) => {
    const res = await window.eventAPI.assignTeamToGroup(teamId, groupId);
    extractError(res);
    return true;
  },

  randomAssignGroups: async (params) => {
    const res = await window.eventAPI.randomAssignGroups(params);
    const result = extractError<RandomAssignGroupResult>(res);
    // 成功后刷新 groups 和 teams 状态
    const state = useEventStore.getState();
    await Promise.all([
      state.fetchGroups(params.event_id),
      state.listTeamsByEvent(params.event_id)
    ]);
    return result;
  },

  setCurrentEvent: (e) => set({ currentEvent: e })
}));
