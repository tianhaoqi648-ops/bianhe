import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../settingsStore';

const mockDeleteBatch = vi.fn();
const mockGetAll = vi.fn();
(globalThis as any).window = {
  settingsAPI: {
    getAll: mockGetAll,
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    deleteBatch: mockDeleteBatch,
    getCandidates: vi.fn()
  }
};

describe('settingsStore deleteBatch / resetByCategories', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        'dedup.enabled': true,
        'dedup.aiApiKey': 'sk-xxx',
        'ui.tagDisplay': { scenes: {} },
        'system.candidates': { type: ['新值'] },
        'official_topics_seeded': true
      },
      loading: false,
      error: null
    });
    mockDeleteBatch.mockReset();
    mockGetAll.mockReset();
    mockGetAll.mockResolvedValue({ success: true, data: {} });
  });

  it('deleteBatch 调用 IPC 并从内存移除 keys', async () => {
    mockDeleteBatch.mockResolvedValue({ success: true, data: 2 });
    const n = await useSettingsStore.getState().deleteBatch([
      'dedup.enabled',
      'ui.tagDisplay'
    ]);
    expect(n).toBe(2);
    expect(mockDeleteBatch).toHaveBeenCalledWith(['dedup.enabled', 'ui.tagDisplay']);
    const s = useSettingsStore.getState().settings;
    expect(s['dedup.enabled']).toBeUndefined();
    expect(s['ui.tagDisplay']).toBeUndefined();
    expect(s['official_topics_seeded']).toBe(true); // 保留
  });

  it('deleteBatch 返回 IPC 实际删除条数', async () => {
    mockDeleteBatch.mockResolvedValue({ success: true, data: 5 });
    const n = await useSettingsStore.getState().deleteBatch([
      'dedup.enabled',
      'dedup.aiApiKey'
    ]);
    expect(n).toBe(5);
  });

  it('resetByCategories 映射 keys 并调用 deleteBatch', async () => {
    mockDeleteBatch.mockResolvedValue({ success: true, data: 6 });
    const n = await useSettingsStore.getState().resetByCategories(['dedup']);
    expect(n).toBe(6);
    // dedup 类别映射 6 个 key
    expect(mockDeleteBatch).toHaveBeenCalledTimes(1);
    const calledKeys = mockDeleteBatch.mock.calls[0][0] as string[];
    expect(calledKeys).toHaveLength(6);
    expect(calledKeys).toContain('dedup.enabled');
    expect(calledKeys).toContain('dedup.aiApiKey');
    expect(calledKeys).toContain('dedup.aiThreshold');
  });

  it('resetByCategories 多类别去重 keys', async () => {
    mockDeleteBatch.mockResolvedValue({ success: true, data: 8 });
    await useSettingsStore.getState().resetByCategories([
      'dedup',
      'tagDisplay',
      'candidates'
    ]);
    const calledKeys = mockDeleteBatch.mock.calls[0][0] as string[];
    // 6 + 1 + 1 = 8
    expect(calledKeys).toHaveLength(8);
    expect(calledKeys).toContain('ui.tagDisplay');
    expect(calledKeys).toContain('system.candidates');
  });

  it('resetByCategories 单类别 tagDisplay', async () => {
    mockDeleteBatch.mockResolvedValue({ success: true, data: 1 });
    const n = await useSettingsStore.getState().resetByCategories(['tagDisplay']);
    expect(n).toBe(1);
    const calledKeys = mockDeleteBatch.mock.calls[0][0] as string[];
    expect(calledKeys).toEqual(['ui.tagDisplay']);
  });

  it('resetByCategories 空类别返回 0 不调 IPC', async () => {
    const n = await useSettingsStore.getState().resetByCategories([]);
    expect(n).toBe(0);
    expect(mockDeleteBatch).not.toHaveBeenCalled();
  });

  it('resetByCategories 后内存中对应 key 被移除', async () => {
    mockDeleteBatch.mockResolvedValue({ success: true, data: 6 });
    await useSettingsStore.getState().resetByCategories(['dedup']);
    const s = useSettingsStore.getState().settings;
    expect(s['dedup.enabled']).toBeUndefined();
    expect(s['dedup.aiApiKey']).toBeUndefined();
    // 其他类别保留
    expect(s['ui.tagDisplay']).toBeDefined();
    expect(s['system.candidates']).toBeDefined();
    expect(s['official_topics_seeded']).toBe(true);
  });
});
