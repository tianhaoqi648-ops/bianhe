import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTopicGroupStore, canDeleteTopicGroup } from '../topicGroupStore';

// Mock window.groupAPI
const mockList = vi.fn();
const mockCreateGroup = vi.fn();
const mockRenameGroup = vi.fn();
const mockDeleteGroup = vi.fn();

(globalThis as any).window = {
  groupAPI: {
    list: mockList,
    getDefaultTopicGroup: vi.fn(),
    createGroup: mockCreateGroup,
    renameGroup: mockRenameGroup,
    deleteGroup: mockDeleteGroup,
    listTopicsByGroup: vi.fn(),
    addTopicsToGroup: vi.fn(),
    removeTopicsFromGroup: vi.fn(),
    listGroupsByEvent: vi.fn(),
    bindEventGroups: vi.fn(),
    unbindEventGroup: vi.fn()
  }
};

const DEF = { id: 'default-group', name: '默认题库', isDefault: true, createdAt: null };
const G1 = { id: 'g1', name: '备赛题库', isDefault: false, createdAt: null };

function ok<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

beforeEach(() => {
  vi.clearAllMocks();
  useTopicGroupStore.setState({ groups: [], loading: false, error: null });
});

describe('topicGroupStore：题组列表', () => {
  it('fetchGroups 拉取并将默认题库置前', async () => {
    mockList.mockResolvedValue(ok([G1, DEF]));
    await useTopicGroupStore.getState().fetchGroups();
    const { groups, loading } = useTopicGroupStore.getState();
    expect(groups[0].id).toBe('default-group');
    expect(groups).toHaveLength(2);
    expect(loading).toBe(false);
  });

  it('fetchGroups 失败写入 error', async () => {
    mockList.mockResolvedValue({ success: false, error: '网络错误' });
    await useTopicGroupStore.getState().fetchGroups();
    expect(useTopicGroupStore.getState().error).toBe('网络错误');
  });
});

describe('topicGroupStore：新建 / 重命名 / 删除', () => {
  it('createGroup 成功后加入列表并重新排序（默认在前）', async () => {
    useTopicGroupStore.setState({ groups: [DEF] });
    mockCreateGroup.mockResolvedValue(ok(G1));
    const created = await useTopicGroupStore.getState().createGroup('备赛题库');
    expect(created).toEqual(G1);
    expect(mockCreateGroup).toHaveBeenCalledWith({ name: '备赛题库' });
    const ids = useTopicGroupStore.getState().groups.map((g) => g.id);
    expect(ids[0]).toBe('default-group');
  });

  it('renameGroup 更新对应项并保持默认在前', async () => {
    useTopicGroupStore.setState({ groups: [DEF, G1] });
    mockRenameGroup.mockResolvedValue(ok({ ...G1, name: '新名' }));
    const okRes = await useTopicGroupStore.getState().renameGroup('g1', '新名');
    expect(okRes).toBe(true);
    expect(mockRenameGroup).toHaveBeenCalledWith({ id: 'g1', name: '新名' });
    expect(useTopicGroupStore.getState().groups[1].name).toBe('新名');
  });

  it('deleteGroup 成功后移除该题组', async () => {
    useTopicGroupStore.setState({ groups: [DEF, G1] });
    mockDeleteGroup.mockResolvedValue(ok(true));
    const res = await useTopicGroupStore.getState().deleteGroup('g1');
    expect(res).toBe(true);
    expect(mockDeleteGroup).toHaveBeenCalledWith('g1');
    expect(useTopicGroupStore.getState().groups.map((g) => g.id)).toEqual(['default-group']);
  });
});

describe('canDeleteTopicGroup：默认题库不可删规则', () => {
  it('默认题库不可删', () => {
    expect(canDeleteTopicGroup(DEF)).toBe(false);
  });

  it('普通题组可删', () => {
    expect(canDeleteTopicGroup(G1)).toBe(true);
  });
});