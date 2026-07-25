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
  ApiResponse
} from '../../../shared/types';

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
  // 当前赛事下的轮次和队伍
  rounds: Round[];
  teams: Team[];
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

  setCurrentEvent: (e: Event | null) => void;
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

export const useEventStore = create<EventState>((set) => ({
  events: [],
  total: 0,
  loading: false,
  currentEvent: null,
  rounds: [],
  teams: [],
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
    return extractError<Event>(res);
  },

  updateEvent: async (id, data) => {
    const res = await window.eventAPI.updateEvent(id, data);
    return extractError<Event>(res);
  },

  deleteEvent: async (id) => {
    const res = await window.eventAPI.deleteEvent(id);
    extractError(res);
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
    return extractError<Round>(res);
  },

  updateRound: async (id, data) => {
    const res = await window.eventAPI.updateRound(id, data);
    return extractError<Round>(res);
  },

  deleteRound: async (id) => {
    const res = await window.eventAPI.deleteRound(id);
    extractError(res);
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
    return extractError<Team>(res);
  },

  updateTeam: async (id, data) => {
    const res = await window.eventAPI.updateTeam(id, data);
    return extractError<Team>(res);
  },

  deleteTeam: async (id) => {
    const res = await window.eventAPI.deleteTeam(id);
    extractError(res);
    return true;
  },

  setCurrentEvent: (e) => set({ currentEvent: e })
}));
