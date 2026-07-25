import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../settingsStore';
import type { ResetDataResponse } from '../../../../shared/types';

const mockDeleteBatch = vi.fn();
const mockGetAll = vi.fn();
const mockResetData = vi.fn();

(globalThis as any).window = {
  settingsAPI: {
    getAll: mockGetAll,
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    deleteBatch: mockDeleteBatch,
    getCandidates: vi.fn()
  },
  systemAPI: {
    resetData: mockResetData
  }
};

const FAKE_RESET_RESPONSE: ResetDataResponse = {
  configDeleted: 8,
  topicsDeleted: 50,
  eventsDeleted: 3,
  drawSessionsDeleted: 10,
  importBatchesDeleted: 5,
  auditLogsDeleted: 100,
  officialKept: true
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

describe('settingsStore resetAll', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        'dedup.enabled': true,
        'dedup.aiApiKey': 'sk-xxx',
        'ui.tagDisplay': { scenes: {} },
        'system.candidates': { type: ['新值'] },
        'official_topics_seeded': true,
        'official_topics_version': 'v1.0',
        'official_topics_count': 100
      },
      loading: false,
      error: null
    });
    mockResetData.mockReset();
  });

  it('仅重置配置类：调 systemAPI.resetData，内存移除对应 keys', async () => {
    mockResetData.mockResolvedValue({ success: true, data: { ...FAKE_RESET_RESPONSE, topicsDeleted: 0 } });

    const res = await useSettingsStore.getState().resetAll(
      ['dedup', 'tagDisplay'],
      {}
    );

    expect(res.configDeleted).toBe(8);
    expect(mockResetData).toHaveBeenCalledTimes(1);
    const req = mockResetData.mock.calls[0][0];
    expect(req.configKeys).toHaveLength(7); // dedup(6) + tagDisplay(1)
    expect(req.configKeys).toContain('dedup.enabled');
    expect(req.configKeys).toContain('ui.tagDisplay');
    expect(req.dataOptions).toEqual({});

    // 内存中对应 key 被移除
    const s = useSettingsStore.getState().settings;
    expect(s['dedup.enabled']).toBeUndefined();
    expect(s['dedup.aiApiKey']).toBeUndefined();
    expect(s['ui.tagDisplay']).toBeUndefined();
    // 其他类别保留
    expect(s['system.candidates']).toBeDefined();
    // 官方题库标记保留
    expect(s['official_topics_seeded']).toBe(true);
  });

  it('题库重置且保留官方：内存中 official_* 标记保留', async () => {
    mockResetData.mockResolvedValue({
      success: true,
      data: { ...FAKE_RESET_RESPONSE, officialKept: true }
    });

    await useSettingsStore.getState().resetAll([], {
      topics: { keepOfficial: true }
    });

    const req = mockResetData.mock.calls[0][0];
    expect(req.configKeys).toEqual([]);
    expect(req.dataOptions.topics).toEqual({ keepOfficial: true });

    // 官方题库标记保留
    const s = useSettingsStore.getState().settings;
    expect(s['official_topics_seeded']).toBe(true);
    expect(s['official_topics_version']).toBe('v1.0');
  });

  it('题库重置且不保留官方：内存中 official_* 标记被移除', async () => {
    mockResetData.mockResolvedValue({
      success: true,
      data: { ...FAKE_RESET_RESPONSE, officialKept: false }
    });

    await useSettingsStore.getState().resetAll([], {
      topics: { keepOfficial: false }
    });

    // 内存中 official_* 标记被移除
    const s = useSettingsStore.getState().settings;
    expect(s['official_topics_seeded']).toBeUndefined();
    expect(s['official_topics_version']).toBeUndefined();
    expect(s['official_topics_count']).toBeUndefined();
  });

  it('同时重置配置类 + 所有数据类：所有选项透传', async () => {
    mockResetData.mockResolvedValue({ success: true, data: FAKE_RESET_RESPONSE });

    const res = await useSettingsStore.getState().resetAll(
      ['dedup', 'tagDisplay', 'candidates'],
      {
        topics: { keepOfficial: true },
        events: true,
        drawSessions: true,
        importBatches: true,
        auditLogs: true
      }
    );

    expect(res.topicsDeleted).toBe(50);
    expect(res.eventsDeleted).toBe(3);
    expect(res.drawSessionsDeleted).toBe(10);
    expect(res.importBatchesDeleted).toBe(5);
    expect(res.auditLogsDeleted).toBe(100);

    const req = mockResetData.mock.calls[0][0];
    expect(req.configKeys).toHaveLength(8); // 6 + 1 + 1
    expect(req.dataOptions).toEqual({
      topics: { keepOfficial: true },
      events: true,
      drawSessions: true,
      importBatches: true,
      auditLogs: true
    });
  });

  it('主进程返回失败：抛错且不更新内存', async () => {
    mockResetData.mockResolvedValue({
      success: false,
      error: 'DB 锁定'
    });

    await expect(
      useSettingsStore.getState().resetAll(['dedup'], {})
    ).rejects.toThrow('DB 锁定');

    // 内存仍保留原值
    const s = useSettingsStore.getState().settings;
    expect(s['dedup.enabled']).toBe(true);
  });

  it('空请求：configKeys 为空数组，dataOptions 为空对象，仍调 IPC', async () => {
    mockResetData.mockResolvedValue({
      success: true,
      data: {
        configDeleted: 0,
        topicsDeleted: 0,
        eventsDeleted: 0,
        drawSessionsDeleted: 0,
        importBatchesDeleted: 0,
        auditLogsDeleted: 0,
        officialKept: true
      }
    });

    const res = await useSettingsStore.getState().resetAll([], {});
    expect(res.configDeleted).toBe(0);
    expect(mockResetData).toHaveBeenCalledTimes(1);
    expect(mockResetData.mock.calls[0][0]).toEqual({ configKeys: [], dataOptions: {} });
  });
});
