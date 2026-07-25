import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTopicStore } from '../topicStore';

// mock window.topicAPI
const mockList = vi.fn();
(globalThis as any).window = {
  topicAPI: {
    list: mockList,
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchDelete: vi.fn(),
    count: vi.fn(),
    countByDimension: vi.fn(),
    listAllTags: vi.fn(),
    updateStatus: vi.fn(),
    updateWeight: vi.fn()
  }
};

describe('topicStore 跨页全选', () => {
  beforeEach(() => {
    useTopicStore.setState({
      selectedIds: [],
      allSelectedInFilter: false,
      exceptIds: []
    });
    mockList.mockReset();
  });

  it('selectAllInFilter 进入跨页全选模式', () => {
    useTopicStore.getState().selectAllInFilter();
    const s = useTopicStore.getState();
    expect(s.allSelectedInFilter).toBe(true);
    expect(s.exceptIds).toEqual([]);
    expect(s.selectedIds).toEqual([]);
  });

  it('isSelected 在全选模式下排除 exceptIds', () => {
    useTopicStore.getState().selectAllInFilter();
    useTopicStore.getState().unselectInAllMode('topic-1');
    expect(useTopicStore.getState().isSelected('topic-1')).toBe(false);
    expect(useTopicStore.getState().isSelected('topic-2')).toBe(true);
  });

  it('removeFromExcept 重新选中', () => {
    useTopicStore.getState().selectAllInFilter();
    useTopicStore.getState().unselectInAllMode('topic-1');
    useTopicStore.getState().removeFromExcept('topic-1');
    expect(useTopicStore.getState().isSelected('topic-1')).toBe(true);
  });

  it('toggleSelect 在全选模式下操作 exceptIds', () => {
    useTopicStore.getState().selectAllInFilter();
    useTopicStore.getState().toggleSelect('topic-1');
    expect(useTopicStore.getState().exceptIds).toContain('topic-1');
    useTopicStore.getState().toggleSelect('topic-1');
    expect(useTopicStore.getState().exceptIds).not.toContain('topic-1');
  });

  it('clearSelection 重置所有', () => {
    useTopicStore.getState().selectAllInFilter();
    useTopicStore.getState().unselectInAllMode('x');
    useTopicStore.getState().clearSelection();
    const s = useTopicStore.getState();
    expect(s.allSelectedInFilter).toBe(false);
    expect(s.exceptIds).toEqual([]);
    expect(s.selectedIds).toEqual([]);
  });

  it('getSelectedIdsForBatchOp 全选模式拉取全量并过滤 exceptIds', async () => {
    mockList.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
        total: 3
      }
    });
    useTopicStore.setState({ filter: { page: 1, pageSize: 20 } });
    useTopicStore.getState().selectAllInFilter();
    useTopicStore.getState().unselectInAllMode('t2');
    const ids = await useTopicStore.getState().getSelectedIdsForBatchOp();
    expect(ids).toEqual(['t1', 't3']);
  });

  it('getSelectedIdsForBatchOp 普通模式返回 selectedIds', async () => {
    useTopicStore.setState({ selectedIds: ['a', 'b'] });
    const ids = await useTopicStore.getState().getSelectedIdsForBatchOp();
    expect(ids).toEqual(['a', 'b']);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('selectPage 退出跨页全选模式', () => {
    useTopicStore.getState().selectAllInFilter();
    useTopicStore.getState().selectPage(['t1', 't2']);
    const s = useTopicStore.getState();
    expect(s.allSelectedInFilter).toBe(false);
    expect(s.exceptIds).toEqual([]);
    expect(s.selectedIds).toEqual(['t1', 't2']);
  });

  it('select/deselect 在全选模式下操作 exceptIds', () => {
    useTopicStore.getState().selectAllInFilter();
    useTopicStore.getState().deselect('topic-1');
    expect(useTopicStore.getState().exceptIds).toContain('topic-1');
    useTopicStore.getState().select('topic-1');
    expect(useTopicStore.getState().exceptIds).not.toContain('topic-1');
  });
});
