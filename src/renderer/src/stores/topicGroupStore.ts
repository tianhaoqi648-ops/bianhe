import { create } from 'zustand';
import type { TopicGroup, GroupTopic, ApiResponse } from '../../../shared/types';
import { buildGroupMemberMaps } from './topicGroupFileOps';
import { registerStoreRefresher } from '../utils/undo-manager';

/**
 * 题组（题库）管理 store（赛事题库 T3）。
 * 管理与复用全局题组：列表 / 新建 / 重命名 / 删除（默认题库不可删）。
 * 题组成员、成员辩题选择等查询由 UI 直接经 window.groupAPI 调用，
 * 这里仅收敛「题组集合」的读写，供题组管理界面与后续赛事题库页复用。
 */

/** 统一错误提取 */
function extractData<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

/**
 * 「默认题库」删除守卫。
 * 默认题库承载「新题默认归入」语义，全局唯一且不可删除，UI 据此禁用删除。
 * 导出以便单测。
 */
export function canDeleteTopicGroup(group: Pick<TopicGroup, 'isDefault'>): boolean {
  return !group.isDefault;
}

interface TopicGroupState {
  groups: TopicGroup[];
  loading: boolean;
  error: string | null;

  // ---- topic↔group 成员映射（T2：供题库行徽标 + 按题库筛选） ----
  /** groupId → 成员 topicId 列表 */
  memberTopicIdsByGroup: Record<string, string[]>;
  /** topicId → 所属题组名列表（徽标） */
  topicToGroupNameMap: Record<string, string[]>;
  /** 全量成员映射是否已加载完成 */
  memberMappingLoaded: boolean;
  memberMappingLoading: boolean;

  fetchGroups: () => Promise<void>;
  /** 全量重建 topic↔group 成员映射（逐库 listTopicsByGroup 聚合） */
  loadMemberMapping: () => Promise<void>;
  createGroup: (name: string) => Promise<TopicGroup | null>;
  renameGroup: (id: string, name: string) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
}

export const useTopicGroupStore = create<TopicGroupState>((set) => ({
  groups: [],
  loading: false,
  error: null,

  memberTopicIdsByGroup: {},
  topicToGroupNameMap: {},
  memberMappingLoaded: false,
  memberMappingLoading: false,

  fetchGroups: async () => {
    set({ loading: true, error: null });
    try {
      const res = await window.groupAPI.list();
      set({ groups: sortGroups(extractData<TopicGroup[]>(res)), loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadMemberMapping: async () => {
    set({ memberMappingLoading: true, error: null });
    try {
      const groupRes = await window.groupAPI.list();
      const groups = sortGroups(extractData<TopicGroup[]>(groupRes));
      const membersByGroup: Record<string, GroupTopic[]> = {};
      await Promise.all(
        groups.map(async (g) => {
          try {
            const res = await window.groupAPI.listTopicsByGroup(g.id);
            membersByGroup[g.id] = res.success && res.data ? res.data : [];
          } catch {
            membersByGroup[g.id] = [];
          }
        })
      );
      const { memberTopicIdsByGroup, topicToGroupNameMap } = buildGroupMemberMaps(
        groups,
        membersByGroup
      );
      set({
        groups,
        memberTopicIdsByGroup,
        topicToGroupNameMap,
        memberMappingLoaded: true,
        memberMappingLoading: false
      });
    } catch (e) {
      set({
        memberMappingLoading: false,
        error: e instanceof Error ? e.message : String(e)
      });
    }
  },

  createGroup: async (name) => {
    try {
      const res = await window.groupAPI.createGroup({ name });
      const created = extractData<TopicGroup>(res);
      // 增量插入（默认题库由 repo 排最前，这里借助重新排序：默认前 + 其余追加）
      set((s) => ({
        groups: sortGroups([...s.groups, created])
      }));
      return created;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  renameGroup: async (id, name) => {
    try {
      const res = await window.groupAPI.renameGroup({ id, name });
      const updated = extractData<TopicGroup>(res);
      set((s) => ({
        groups: sortGroups(s.groups.map((g) => (g.id === id ? updated : g)))
      }));
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  deleteGroup: async (id) => {
    try {
      const res = await window.groupAPI.deleteGroup(id);
      extractData<boolean>(res);
      set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }));
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }
}));

/** 排序辅助：默认题库在前，其余按名称升序（保证完成后列表稳定可测）。 */
function sortGroups(groups: TopicGroup[]): TopicGroup[] {
  return [...groups].sort((a, b) =>
    Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)
  );
}

/**
 * Governance-8.3：事件/轮次题库绑定与 bank 配置接入 undo 后，撤销/重做该 topicGroup
 * store 的日志，需重载题组成员映射（含赛事绑定关系），保证跨组件一致性。
 */
registerStoreRefresher('topicGroup', () => {
  void useTopicGroupStore.getState().loadMemberMapping();
});