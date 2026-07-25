# 标签显示简化配置 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将标签显示配置从复杂的"4 类别开关 + 值黑名单 + 大屏独立配置"简化为"总开关 + 多选标签值（混合模式）"，所有场景统一一套配置。

**Architecture:** 在 settings 表存一个 JSON 配置（key=`ui.tagDisplay`），复用现有 `settingsAPI` IPC 通道。简化 `TagDisplayConfig` 类型为 `{ enabled, selectedTags }`，重写 `tagDisplay.ts` 工具函数，重写 `TagDisplaySettingsModal` UI（总开关 + 多选标签值），调整 4 个接入点（TopicCard / DrawResultCard / BigScreen / FilterPanel）使用新 API。向后兼容旧配置读取。

**Tech Stack:** React 18 + TypeScript + Ant Design 5 + Zustand + Vitest

---

## 当前状态分析

### 已有实现（需简化）
- [src/shared/types.ts:291-324](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/shared/types.ts#L291-L324) — 旧类型 `TagCategory` / `DisplayScene` / `TagDisplayConfig`（3 字段：categoryEnabled / hiddenValues / bigScreenOverrides）
- [src/renderer/src/utils/tagDisplay.ts](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/utils/tagDisplay.ts) — 旧工具函数（5 个：loadTagDisplayConfig / getEffectiveConfig / isCategoryVisible / filterDimensionTag / filterCustomTags）
- [src/renderer/src/components/TagDisplaySettingsModal.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/components/TagDisplaySettingsModal.tsx) — 旧弹窗 UI（2 Tab：全局 + 大屏，每 Tab 4 类别区块）
- 4 个接入点已使用旧 API

### 用户需求
1. **总开关**：是否显示标签（开 = 显示，关 = 不显示任何标签）
2. **多选标签值（混合模式）**：
   - 总开关开 + 多选为空 → 显示全部标签
   - 总开关开 + 多选有值 → 只显示选中的标签
   - 总开关关 → 不显示任何标签
3. **全部场景统一一套配置**：删除大屏独立配置
4. **在现有基础上调整**：保留代码结构，重写内部逻辑

### 关键决策
1. **候选值来源**：从题库汇总所有标签值（type / difficulty / source_type / tags 4 类），在多选中按类别分组展示（用 `<OptGroup>` 提升可读性），但选择时统一处理
2. **向后兼容**：读取旧配置时自动转换为新格式——旧配置所有 categoryEnabled 为 true 且 hiddenValues 全空 → 新配置 `enabled=true, selectedTags=[]`；其他情况保守转为 `enabled=true, selectedTags=[]`（即显示全部，相当于重置）
3. **删除 scene 参数**：所有场景使用同一套配置，工具函数不再需要 `DisplayScene` 参数
4. **统一过滤函数**：所有标签值（type / difficulty / source_type / tags）使用同一个 `filterTag` / `filterTags` 函数，不再区分维度

---

## 文件结构

### 修改文件
| 文件 | 修改要点 |
|---|---|
| `src/shared/types.ts` | 简化 `TagDisplayConfig` 为 `{ enabled, selectedTags }`；删除 `TagCategory`、`DisplayScene` 类型 |
| `src/renderer/src/utils/tagDisplay.ts` | 重写：默认配置、加载（含向后兼容）、`filterTag`、`filterTags` |
| `src/renderer/src/utils/__tests__/tagDisplay.test.ts` | 重写测试用例 |
| `src/renderer/src/components/TagDisplaySettingsModal.tsx` | 重写 UI：总开关 + 多选标签值（按类别分组） |
| `src/renderer/src/components/TopicCard.tsx` | 调用新 `filterTag` / `filterTags`，删除 scene 参数 |
| `src/renderer/src/components/draw/DrawResultCard.tsx` | 同上 |
| `src/renderer/src/components/draw/BigScreen.tsx` | 同上（删除大屏独立配置逻辑） |
| `src/renderer/src/components/FilterPanel.tsx` | 调整为：总开关关时不显示标签筛选；多选有值时只显示选中的候选 |
| `src/renderer/src/pages/Settings.tsx` | 微调入口卡片描述文案 |

### 不修改
- `src/main/ipc/audit.ipc.ts` — settings IPC 通用，无需改动
- `src/preload/index.ts` — settingsAPI 已暴露，无需改动
- `src/renderer/src/stores/settingsStore.ts` — 通用 CRUD，无需改动
- `src/renderer/src/App.tsx` — 启动加载 settings 逻辑保留

---

## Task 1: 简化类型定义 + 重写工具函数（TDD）

**Files:**
- Modify: `src/shared/types.ts` (291-324 行)
- Modify: `src/renderer/src/utils/tagDisplay.ts` (整体重写)
- Modify: `src/renderer/src/utils/__tests__/tagDisplay.test.ts` (整体重写)

- [ ] **Step 1: 重写测试用例**

将 `src/renderer/src/utils/__tests__/tagDisplay.test.ts` 整体替换为：

```typescript
import { describe, it, expect } from 'vitest';
import type { TagDisplayConfig } from '../../../../shared/types';
import {
  DEFAULT_TAG_DISPLAY_CONFIG,
  loadTagDisplayConfig,
  filterTag,
  filterTags
} from '../tagDisplay';

describe('tagDisplay utils', () => {
  describe('DEFAULT_TAG_DISPLAY_CONFIG', () => {
    it('默认开启显示', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.enabled).toBe(true);
    });

    it('默认 selectedTags 为空数组（显示全部）', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.selectedTags).toEqual([]);
    });
  });

  describe('loadTagDisplayConfig', () => {
    it('无配置时返回默认', () => {
      expect(loadTagDisplayConfig({})).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('字符串配置正确解析', () => {
      const settings = {
        'ui.tagDisplay': JSON.stringify({ enabled: false, selectedTags: ['价值辩'] })
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.enabled).toBe(false);
      expect(cfg.selectedTags).toEqual(['价值辩']);
    });

    it('对象配置直接合并', () => {
      const settings = {
        'ui.tagDisplay': { enabled: true, selectedTags: ['入门级'] }
      };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.enabled).toBe(true);
      expect(cfg.selectedTags).toEqual(['入门级']);
    });

    it('损坏的 JSON 返回默认', () => {
      const settings = { 'ui.tagDisplay': '{not valid json' };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg).toEqual(DEFAULT_TAG_DISPLAY_CONFIG);
    });

    it('向后兼容旧格式（categoryEnabled + hiddenValues + bigScreenOverrides）转换为默认', () => {
      const oldConfig = {
        categoryEnabled: { type: true, difficulty: true, source: true, customTags: true },
        hiddenValues: { type: [], difficulty: [], source: [], customTags: [] },
        bigScreenOverrides: { categoryEnabled: { type: false, difficulty: false, source: false, customTags: false } }
      };
      const settings = { 'ui.tagDisplay': oldConfig };
      const cfg = loadTagDisplayConfig(settings);
      // 旧格式无 enabled 字段，保守转为默认（显示全部）
      expect(cfg.enabled).toBe(true);
      expect(cfg.selectedTags).toEqual([]);
    });

    it('部分字段缺失时合并默认值', () => {
      const settings = { 'ui.tagDisplay': { enabled: true } };
      const cfg = loadTagDisplayConfig(settings);
      expect(cfg.enabled).toBe(true);
      expect(cfg.selectedTags).toEqual([]);
    });
  });

  describe('filterTag', () => {
    it('enabled=false 返回 null', () => {
      const config: TagDisplayConfig = { enabled: false, selectedTags: [] };
      expect(filterTag(config, '价值辩')).toBe(null);
    });

    it('enabled=true + selectedTags 空 = 显示全部（返回原值）', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTag(config, '价值辩')).toBe('价值辩');
      expect(filterTag(config, '入门级')).toBe('入门级');
    });

    it('enabled=true + selectedTags 非空 = 只显示选中的', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: ['价值辩', '入门级'] };
      expect(filterTag(config, '价值辩')).toBe('价值辩');
      expect(filterTag(config, '入门级')).toBe('入门级');
      expect(filterTag(config, '事实辩')).toBe(null);
    });

    it('空值返回 null', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTag(config, '')).toBe(null);
      expect(filterTag(config, null)).toBe(null);
      expect(filterTag(config, undefined)).toBe(null);
    });
  });

  describe('filterTags', () => {
    it('enabled=false 返回空数组', () => {
      const config: TagDisplayConfig = { enabled: false, selectedTags: [] };
      expect(filterTags(config, ['成长', '环境'])).toEqual([]);
    });

    it('enabled=true + selectedTags 空 = 返回全部', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTags(config, ['成长', '环境'])).toEqual(['成长', '环境']);
    });

    it('enabled=true + selectedTags 非空 = 只保留选中的', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: ['成长', '入门级'] };
      expect(filterTags(config, ['成长', '996', '环境', '入门级'])).toEqual(['成长', '入门级']);
    });

    it('null/undefined 返回空数组', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTags(config, null)).toEqual([]);
      expect(filterTags(config, undefined)).toEqual([]);
    });

    it('空数组返回空数组', () => {
      const config: TagDisplayConfig = { enabled: true, selectedTags: [] };
      expect(filterTags(config, [])).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/renderer/src/utils/__tests__/tagDisplay.test.ts`
Expected: FAIL（旧实现没有 filterTag / filterTags 函数）

- [ ] **Step 3: 修改 shared/types.ts 简化类型**

在 [src/shared/types.ts:291-324](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/shared/types.ts#L291-L324) 将整个"标签显示配置"区块替换为：

```typescript
// ---------- 标签显示配置 ----------

/**
 * 标签显示配置（存储在 settings 表 key='ui.tagDisplay'）
 *
 * 行为：
 * - enabled=false：不显示任何标签
 * - enabled=true + selectedTags 空：显示全部标签
 * - enabled=true + selectedTags 非空：只显示选中的标签
 */
export interface TagDisplayConfig {
  /** 总开关：是否显示标签 */
  enabled: boolean;
  /** 选中的标签值（白名单）。空数组=显示全部，非空=只显示选中的 */
  selectedTags: string[];
}
```

删除 `TagCategory` 和 `DisplayScene` 类型导出。

- [ ] **Step 4: 重写 tagDisplay.ts**

将 `src/renderer/src/utils/tagDisplay.ts` 整体替换为：

```typescript
import type { TagDisplayConfig } from '../../../shared/types';

/** 默认配置：开启显示，selectedTags 为空（显示全部） */
export const DEFAULT_TAG_DISPLAY_CONFIG: TagDisplayConfig = {
  enabled: true,
  selectedTags: []
};

/** 合并用户配置与默认值，确保所有字段存在 */
function mergeWithDefaults(partial: Partial<TagDisplayConfig> | unknown): TagDisplayConfig {
  if (!partial || typeof partial !== 'object') {
    return DEFAULT_TAG_DISPLAY_CONFIG;
  }
  const p = partial as Partial<TagDisplayConfig>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_TAG_DISPLAY_CONFIG.enabled,
    selectedTags: Array.isArray(p.selectedTags)
      ? p.selectedTags.filter((t) => typeof t === 'string')
      : []
  };
}

/** 判断是否为旧格式配置（含 categoryEnabled 字段） */
function isLegacyConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  return 'categoryEnabled' in (raw as Record<string, unknown>);
}

/**
 * 从 settings store 读取配置，缺省时返回默认配置。
 * 向后兼容：旧格式配置（categoryEnabled/hiddenValues/bigScreenOverrides）保守转为默认（显示全部）。
 */
export function loadTagDisplayConfig(settings: Record<string, unknown>): TagDisplayConfig {
  const raw = settings['ui.tagDisplay'];
  if (!raw) return DEFAULT_TAG_DISPLAY_CONFIG;

  // 字符串配置：JSON 解析
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (isLegacyConfig(parsed)) return DEFAULT_TAG_DISPLAY_CONFIG;
      return mergeWithDefaults(parsed);
    } catch {
      return DEFAULT_TAG_DISPLAY_CONFIG;
    }
  }

  // 对象配置
  if (typeof raw === 'object' && raw !== null) {
    if (isLegacyConfig(raw)) return DEFAULT_TAG_DISPLAY_CONFIG;
    return mergeWithDefaults(raw);
  }

  return DEFAULT_TAG_DISPLAY_CONFIG;
}

/**
 * 过滤单个标签值
 * @returns 通过过滤的值（enabled=false 或不在 selectedTags 中则返回 null）
 */
export function filterTag(
  config: TagDisplayConfig,
  value: string | null | undefined
): string | null {
  if (!config.enabled) return null;
  if (!value) return null;
  // selectedTags 为空 = 显示全部
  if (config.selectedTags.length === 0) return value;
  return config.selectedTags.includes(value) ? value : null;
}

/**
 * 过滤标签数组
 * @returns 过滤后的数组（enabled=false 返回空数组，selectedTags 空返回原数组，非空只保留选中的）
 */
export function filterTags(
  config: TagDisplayConfig,
  tags: string[] | null | undefined
): string[] {
  if (!config.enabled) return [];
  if (!tags || tags.length === 0) return [];
  // selectedTags 为空 = 显示全部
  if (config.selectedTags.length === 0) return tags;
  return tags.filter((t) => config.selectedTags.includes(t));
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/renderer/src/utils/__tests__/tagDisplay.test.ts`
Expected: PASS（15 tests）

- [ ] **Step 6: 提交**

```bash
git add src/shared/types.ts src/renderer/src/utils/tagDisplay.ts src/renderer/src/utils/__tests__/tagDisplay.test.ts
git commit -m "refactor: simplify TagDisplayConfig to enabled + selectedTags"
```

---

## Task 2: 重写 TagDisplaySettingsModal 弹窗

**Files:**
- Modify: `src/renderer/src/components/TagDisplaySettingsModal.tsx` (整体重写)

- [ ] **Step 1: 重写弹窗组件**

将 `src/renderer/src/components/TagDisplaySettingsModal.tsx` 整体替换为：

```typescript
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Switch,
  Typography,
  Space,
  Empty,
  Alert,
  Button,
  Spin,
  Select,
  message
} from 'antd';
import { TagsOutlined } from '@ant-design/icons';
import type { TagDisplayConfig } from '../../../shared/types';
import { useTopicStore } from '../stores/topicStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  DEFAULT_TAG_DISPLAY_CONFIG,
  loadTagDisplayConfig
} from '../utils/tagDisplay';
import { spacing } from '../styles/tokens';

const { Text } = Typography;

const SETTING_KEY = 'ui.tagDisplay';

// 候选值分组定义
const GROUP_DEFS: Array<{
  key: string;
  label: string;
  field: 'type' | 'difficulty' | 'source_type' | 'tags';
  prefix?: string;
}> = [
  { key: 'type', label: '题型', field: 'type' },
  { key: 'difficulty', label: '难度', field: 'difficulty' },
  { key: 'source_type', label: '来源类型', field: 'source_type' },
  { key: 'tags', label: '自定义标签', field: 'tags', prefix: '#' }
];

export interface TagDisplaySettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function TagDisplaySettingsModal({
  open,
  onClose
}: TagDisplaySettingsModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const topicStore = useTopicStore();
  const settingsStore = useSettingsStore();
  const [config, setConfig] = useState<TagDisplayConfig>(DEFAULT_TAG_DISPLAY_CONFIG);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // 加载配置 + 拉取候选值
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        await topicStore.fetchList({ page: 1, pageSize: 1000 });
        const cfg = loadTagDisplayConfig(settingsStore.settings);
        setConfig(cfg);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 从题库汇总所有候选值，按类别分组
  const groupedOptions = useMemo(() => {
    const groups: Record<string, Set<string>> = {
      type: new Set<string>(),
      difficulty: new Set<string>(),
      source_type: new Set<string>(),
      tags: new Set<string>()
    };
    topicStore.items.forEach((t) => {
      if (t.type) groups.type.add(t.type);
      if (t.difficulty) groups.difficulty.add(t.difficulty);
      if (t.source_type) groups.source_type.add(t.source_type);
      (t.tags ?? []).forEach((tag) => groups.tags.add(tag));
    });
    return GROUP_DEFS.map((g) => ({
      label: g.label,
      prefix: g.prefix,
      options: Array.from(groups[g.field]).sort().map((v) => ({
        label: g.prefix ? `${g.prefix}${v}` : v,
        value: v
      }))
    }));
  }, [topicStore.items]);

  const totalCandidates = useMemo(
    () => groupedOptions.reduce((sum, g) => sum + g.options.length, 0),
    [groupedOptions]
  );

  const handleToggleEnabled = (enabled: boolean) => {
    setConfig((prev) => ({ ...prev, enabled }));
  };

  const handleSelectedTagsChange = (values: string[]) => {
    setConfig((prev) => ({ ...prev, selectedTags: values }));
  };

  const handleReset = () => {
    setConfig(DEFAULT_TAG_DISPLAY_CONFIG);
    messageApi.info('已恢复默认配置（显示全部标签），需点击"保存"后生效');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsStore.set(SETTING_KEY, config);
      messageApi.success('标签显示配置已保存');
      onClose();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <TagsOutlined style={{ color: '#1677ff' }} />
          <span>标签显示配置</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={620}
      destroyOnClose
      maskClosable={!saving}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={handleSave}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <Button onClick={handleReset} disabled={saving}>
            恢复默认
          </Button>
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
    >
      {contextHolder}
      <Spin spinning={loading}>
        <Alert
          message="配置说明"
          description={
            <ul style={{ paddingLeft: 20, margin: 0 }}>
              <li>总开关关闭：所有位置不显示任何标签</li>
              <li>总开关开启 + 未选择标签：显示全部标签</li>
              <li>总开关开启 + 选择了标签：只显示选中的标签</li>
              <li>隐藏标签仅影响 UI 展示，不影响数据与抽题范围</li>
            </ul>
          }
          type="info"
          showIcon
          banner
          style={{ marginBottom: spacing.md }}
        />

        {/* 总开关 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: `${spacing.sm} 0`,
            marginBottom: spacing.md,
            borderBottom: '1px solid #f0f0f0'
          }}
        >
          <Space>
            <Text strong>显示标签</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              总开关
            </Text>
          </Space>
          <Switch
            checked={config.enabled}
            onChange={handleToggleEnabled}
            checkedChildren="开"
            unCheckedChildren="关"
          />
        </div>

        {/* 多选标签值 */}
        <div style={{ opacity: config.enabled ? 1 : 0.5 }}>
          <Space direction="vertical" size={spacing.xs} style={{ width: '100%', marginBottom: spacing.sm }}>
            <Text strong>显示哪些标签</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              不选=显示全部；选中后只显示选中的（共 {totalCandidates} 个候选值）
            </Text>
          </Space>
          {totalCandidates === 0 ? (
            <Empty description="题库中暂无标签数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Select
              mode="multiple"
              allowClear
              placeholder="不选=显示全部标签"
              style={{ width: '100%' }}
              value={config.selectedTags}
              onChange={handleSelectedTagsChange}
              disabled={!config.enabled}
              maxTagCount="responsive"
              options={groupedOptions}
              optionFilterProp="label"
            />
          )}
        </div>

        {/* 当前选中预览 */}
        {config.enabled && config.selectedTags.length > 0 && (
          <Alert
            style={{ marginTop: spacing.md }}
            type="success"
            showIcon
            message={`已选择 ${config.selectedTags.length} 个标签，将只显示这些标签`}
            description={
              <Text style={{ fontSize: 12 }}>
                {config.selectedTags.map((t) => `#${t}`).join(' ')}
              </Text>
            }
          />
        )}
        {config.enabled && config.selectedTags.length === 0 && (
          <Alert
            style={{ marginTop: spacing.md }}
            type="info"
            showIcon
            message="将显示全部标签"
          />
        )}
        {!config.enabled && (
          <Alert
            style={{ marginTop: spacing.md }}
            type="warning"
            showIcon
            message="已关闭标签显示，所有位置将不显示任何标签"
          />
        )}
      </Spin>
    </Modal>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 在 Task 3-6 完成前会有错误（旧调用方仍引用已删除的函数），暂忽略，先继续后续 Task

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/TagDisplaySettingsModal.tsx
git commit -m "refactor: rewrite TagDisplaySettingsModal with master switch + multi-select"
```

---

## Task 3: 调整 TopicCard 接入新 API

**Files:**
- Modify: `src/renderer/src/components/TopicCard.tsx`

- [ ] **Step 1: 修改 imports**

在 [src/renderer/src/components/TopicCard.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/components/TopicCard.tsx) 顶部，将：

```typescript
import {
  loadTagDisplayConfig,
  filterDimensionTag,
  filterCustomTags
} from '../utils/tagDisplay';
```

替换为：

```typescript
import { loadTagDisplayConfig, filterTag, filterTags } from '../utils/tagDisplay';
```

- [ ] **Step 2: 修改网格视图标签区块**

将网格视图中的 IIFE 块（原 `标签行（应用显示配置）`）：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const typeTag = filterDimensionTag(cfg, topic.type, 'type', 'library');
  const diffTag = filterDimensionTag(cfg, topic.difficulty, 'difficulty', 'library');
  const sourceTag = filterDimensionTag(cfg, topic.source_type, 'source', 'library');
  const customTags = filterCustomTags(cfg, topic.tags, 'library');
  const hasDimTags = typeTag || diffTag || sourceTag || isFavorited || isBlacklisted;
  return (
    <>
      {hasDimTags && (
        <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {typeTag && <Tag color="geekblue">{typeTag}</Tag>}
          {diffTag && (
            <Tag
              style={{
                background: DIFFICULTY_GRADIENT[diffTag] ?? undefined,
                color: '#fff',
                border: 'none'
              }}
            >
              {diffTag}
            </Tag>
          )}
          {sourceTag && (
            <Tag color={SOURCE_TYPE_COLOR[sourceTag] ?? 'default'}>{sourceTag}</Tag>
          )}
          {isFavorited && (
            <Tag icon={<StarFilled />} color="gold">
              收藏
            </Tag>
          )}
          {isBlacklisted && (
            <Tag icon={<StopOutlined />} color="error">
              黑名单
            </Tag>
          )}
        </div>
      )}
      {customTags.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {customTags.map((t) => (
            <Tag key={t} style={{ marginBottom: 2 }}>
              #{t}
            </Tag>
          ))}
        </div>
      )}
    </>
  );
})()}
```

替换为：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const typeTag = filterTag(cfg, topic.type);
  const diffTag = filterTag(cfg, topic.difficulty);
  const sourceTag = filterTag(cfg, topic.source_type);
  const customTags = filterTags(cfg, topic.tags);
  const hasDimTags = typeTag || diffTag || sourceTag || isFavorited || isBlacklisted;
  return (
    <>
      {hasDimTags && (
        <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {typeTag && <Tag color="geekblue">{typeTag}</Tag>}
          {diffTag && (
            <Tag
              style={{
                background: DIFFICULTY_GRADIENT[diffTag] ?? undefined,
                color: '#fff',
                border: 'none'
              }}
            >
              {diffTag}
            </Tag>
          )}
          {sourceTag && (
            <Tag color={SOURCE_TYPE_COLOR[sourceTag] ?? 'default'}>{sourceTag}</Tag>
          )}
          {isFavorited && (
            <Tag icon={<StarFilled />} color="gold">
              收藏
            </Tag>
          )}
          {isBlacklisted && (
            <Tag icon={<StopOutlined />} color="error">
              黑名单
            </Tag>
          )}
        </div>
      )}
      {customTags.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {customTags.map((t) => (
            <Tag key={t} style={{ marginBottom: 2 }}>
              #{t}
            </Tag>
          ))}
        </div>
      )}
    </>
  );
})()}
```

- [ ] **Step 3: 修改 TopicListItem 列表视图**

将 TopicListItem 中的 IIFE 块：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const typeTag = filterDimensionTag(cfg, topic.type, 'type', 'library');
  const diffTag = filterDimensionTag(cfg, topic.difficulty, 'difficulty', 'library');
  const customTags = filterCustomTags(cfg, topic.tags, 'library').slice(0, 3);
  return (
    <>
      {typeTag && <Tag color="geekblue">{typeTag}</Tag>}
      {diffTag && (
        <Tag
          style={{
            background: DIFFICULTY_GRADIENT[diffTag] ?? undefined,
            color: '#fff',
            border: 'none'
          }}
        >
          {diffTag}
        </Tag>
      )}
      {topic.source && <Tag>{topic.source}</Tag>}
      {customTags.map((t) => (
        <Tag key={t}>#{t}</Tag>
      ))}
    </>
  );
})()}
```

替换为：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const typeTag = filterTag(cfg, topic.type);
  const diffTag = filterTag(cfg, topic.difficulty);
  const sourceTag = filterTag(cfg, topic.source);
  const customTags = filterTags(cfg, topic.tags).slice(0, 3);
  return (
    <>
      {typeTag && <Tag color="geekblue">{typeTag}</Tag>}
      {diffTag && (
        <Tag
          style={{
            background: DIFFICULTY_GRADIENT[diffTag] ?? undefined,
            color: '#fff',
            border: 'none'
          }}
        >
          {diffTag}
        </Tag>
      )}
      {sourceTag && <Tag>{sourceTag}</Tag>}
      {customTags.map((t) => (
        <Tag key={t}>#{t}</Tag>
      ))}
    </>
  );
})()}
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: 仅有 DrawResultCard / BigScreen / FilterPanel 的错误（TopicCard 已通过）

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/TopicCard.tsx
git commit -m "refactor: TopicCard uses new filterTag/filterTags API"
```

---

## Task 4: 调整 DrawResultCard 接入新 API

**Files:**
- Modify: `src/renderer/src/components/draw/DrawResultCard.tsx`

- [ ] **Step 1: 修改 imports**

在 [src/renderer/src/components/draw/DrawResultCard.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/components/draw/DrawResultCard.tsx) 顶部，将：

```typescript
import {
  loadTagDisplayConfig,
  filterDimensionTag,
  filterCustomTags
} from '../../utils/tagDisplay';
```

替换为：

```typescript
import { loadTagDisplayConfig, filterTag, filterTags } from '../../utils/tagDisplay';
```

- [ ] **Step 2: 修改标签渲染区块**

将 DrawResultCard 中的 IIFE 块：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const typeTag = filterDimensionTag(cfg, topic.type, 'type', 'drawResult');
  const diffTag = filterDimensionTag(cfg, topic.difficulty, 'difficulty', 'drawResult');
  const sourceTag = filterDimensionTag(cfg, topic.source, 'source', 'drawResult');
  const customTags = filterCustomTags(cfg, topic.tags, 'drawResult');
  return (
    <>
      {typeTag && <Tag color="geekblue">{typeTag}</Tag>}
      {diffTag && (
        <Tag color={DIFFICULTY_COLOR[diffTag] ?? 'default'}>{diffTag}</Tag>
      )}
      {sourceTag && <Tag>{sourceTag}</Tag>}
      {customTags.map((t) => (
        <Tag key={t}>#{t}</Tag>
      ))}
    </>
  );
})()}
```

替换为：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const typeTag = filterTag(cfg, topic.type);
  const diffTag = filterTag(cfg, topic.difficulty);
  const sourceTag = filterTag(cfg, topic.source);
  const customTags = filterTags(cfg, topic.tags);
  return (
    <>
      {typeTag && <Tag color="geekblue">{typeTag}</Tag>}
      {diffTag && (
        <Tag color={DIFFICULTY_COLOR[diffTag] ?? 'default'}>{diffTag}</Tag>
      )}
      {sourceTag && <Tag>{sourceTag}</Tag>}
      {customTags.map((t) => (
        <Tag key={t}>#{t}</Tag>
      ))}
    </>
  );
})()}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 仅有 BigScreen / FilterPanel 的错误

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/draw/DrawResultCard.tsx
git commit -m "refactor: DrawResultCard uses new filterTag/filterTags API"
```

---

## Task 5: 调整 BigScreen 接入新 API（删除大屏独立配置逻辑）

**Files:**
- Modify: `src/renderer/src/components/draw/BigScreen.tsx`

- [ ] **Step 1: 修改 imports**

在 [src/renderer/src/components/draw/BigScreen.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/components/draw/BigScreen.tsx) 顶部，将：

```typescript
import {
  loadTagDisplayConfig,
  filterDimensionTag,
  filterCustomTags
} from '../../utils/tagDisplay';
```

替换为：

```typescript
import { loadTagDisplayConfig, filterTag, filterTags } from '../../utils/tagDisplay';
```

- [ ] **Step 2: 修改标签显示区 IIFE 块**

将 BigScreen 中"标签显示区"的 IIFE 块：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const typeTag = filterDimensionTag(cfg, currentTopic.type, 'type', 'bigscreen');
  const diffTag = filterDimensionTag(cfg, currentTopic.difficulty, 'difficulty', 'bigscreen');
  const sourceTag = filterDimensionTag(cfg, currentTopic.source_type, 'source', 'bigscreen');
  const customTags = filterCustomTags(cfg, currentTopic.tags, 'bigscreen');
  const visibleTags: Array<{ key: string; label: string; color?: string }> = [];
  if (typeTag) visibleTags.push({ key: 'type', label: typeTag, color: 'geekblue' });
  if (diffTag) visibleTags.push({ key: 'diff', label: diffTag, color: 'orange' });
  if (sourceTag) visibleTags.push({ key: 'source', label: sourceTag, color: 'purple' });
  customTags.forEach((t) => visibleTags.push({ key: `tag-${t}`, label: `#${t}` }));

  if (visibleTags.length === 0) return null;

  return (
    <div ...>
      {visibleTags.map((t) => (
        <span key={t.key} ...>
          {t.label}
        </span>
      ))}
    </div>
  );
})()}
```

替换为（删除 bigscreen 场景参数，统一使用全局配置）：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const typeTag = filterTag(cfg, currentTopic.type);
  const diffTag = filterTag(cfg, currentTopic.difficulty);
  const sourceTag = filterTag(cfg, currentTopic.source_type);
  const customTags = filterTags(cfg, currentTopic.tags);
  const visibleTags: Array<{ key: string; label: string; color?: string }> = [];
  if (typeTag) visibleTags.push({ key: 'type', label: typeTag, color: 'geekblue' });
  if (diffTag) visibleTags.push({ key: 'diff', label: diffTag, color: 'orange' });
  if (sourceTag) visibleTags.push({ key: 'source', label: sourceTag, color: 'purple' });
  customTags.forEach((t) => visibleTags.push({ key: `tag-${t}`, label: `#${t}` }));

  if (visibleTags.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 12,
        marginTop: 16,
        fontSize: 18,
        position: 'relative',
        zIndex: 1
      }}
    >
      {visibleTags.map((t) => (
        <span
          key={t.key}
          style={{
            padding: '4px 16px',
            borderRadius: 16,
            background: t.color ? 'rgba(22,119,255,0.2)' : 'rgba(255,255,255,0.1)',
            border: `1px solid ${t.color ? 'rgba(22,119,255,0.4)' : 'rgba(255,255,255,0.2)'}`,
            color: 'rgba(255,255,255,0.9)'
          }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
})()}
```

**注意**：默认配置 `enabled=true, selectedTags=[]` 时，大屏会显示所有标签（与之前默认隐藏行为不同）。这是用户明确选择"全部场景统一一套配置"的结果。如果用户希望大屏默认不显示，可在配置中关闭总开关或选择不显示。

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 仅有 FilterPanel 的错误

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/draw/BigScreen.tsx
git commit -m "refactor: BigScreen uses new filterTag/filterTags API (unified config)"
```

---

## Task 6: 调整 FilterPanel 接入新 API

**Files:**
- Modify: `src/renderer/src/components/FilterPanel.tsx`

- [ ] **Step 1: 修改 imports**

在 [src/renderer/src/components/FilterPanel.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/components/FilterPanel.tsx) 顶部，将：

```typescript
import { loadTagDisplayConfig } from '../utils/tagDisplay';
```

替换为：

```typescript
import { loadTagDisplayConfig } from '../utils/tagDisplay';
```

（import 不变，但内部使用方式改变）

- [ ] **Step 2: 修改候选标签过滤逻辑**

将 FilterPanel 函数体中的：

```typescript
// 根据标签显示配置过滤候选标签（隐藏的标签不出现在下拉中，但用户已选值保留）
const cfg = loadTagDisplayConfig(settings);
const visibleTagOptions =
  cfg.hiddenValues.customTags.length > 0
    ? tagOptions.filter((t) => !cfg.hiddenValues.customTags.includes(t))
    : tagOptions;
```

替换为：

```typescript
// 根据标签显示配置过滤候选标签
// - 总开关关：不显示标签筛选区
// - selectedTags 空：显示全部候选
// - selectedTags 非空：只显示选中的候选
const cfg = loadTagDisplayConfig(settings);
const visibleTagOptions = cfg.enabled
  ? (cfg.selectedTags.length > 0
      ? tagOptions.filter((t) => cfg.selectedTags.includes(t))
      : tagOptions)
  : [];
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS（全部错误已消除）

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/FilterPanel.tsx
git commit -m "refactor: FilterPanel uses new tag display config (master switch aware)"
```

---

## Task 7: 调整 Settings 页文案 + 最终验证

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx` (微调文案)

- [ ] **Step 1: 调整入口卡片文案**

在 [src/renderer/src/pages/Settings.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/pages/Settings.tsx) 中找到"标签显示配置"卡片的 Paragraph，将：

```typescript
<Paragraph type="secondary" style={{ marginBottom: 0 }}>
  控制辩题卡片、抽取结果、大屏投影、筛选面板中各类标签的显示与隐藏。
  可按类别开关，也可按值隐藏特定标签。隐藏仅影响 UI 展示，不影响数据。
</Paragraph>
```

替换为：

```typescript
<Paragraph type="secondary" style={{ marginBottom: 0 }}>
  控制辩题卡片、抽取结果、大屏投影、筛选面板中标签的显示。总开关 + 多选标签值，
  隐藏仅影响 UI 展示，不影响数据与抽题范围。
</Paragraph>
```

- [ ] **Step 2: 类型检查 + 全部测试**

Run: `npm run typecheck`
Expected: PASS

Run: `npm test`
Expected: 全部测试通过（原 90 个中除 tagDisplay 测试改为 15 个外，其他 67 个保持通过 → 共 82 个通过）

- [ ] **Step 3: 启动应用端到端验证**

Run: `npm run dev`

验证清单：
- [ ] 应用启动无错误
- [ ] 题库管理页：辩题卡片正常显示所有标签（默认配置：总开关开 + selectedTags 空 = 显示全部）
- [ ] 进入 Settings → 题库管理 Tab → 看到"标签显示配置"卡片 → 点击按钮 → 弹窗显示
- [ ] 弹窗：总开关 + 多选标签值（按题型/难度/来源类型/自定义标签分组）
- [ ] 关闭总开关 → 保存 → 题库页所有标签消失
- [ ] 开启总开关 + 不选任何标签 → 保存 → 题库页显示全部标签
- [ ] 开启总开关 + 选择"价值辩"+"入门级" → 保存 → 题库页只显示这两类标签
- [ ] 抽取辩题 → 抽取结果卡片应用同一套配置
- [ ] 进入大屏 → 应用同一套配置（不再有独立配置）
- [ ] 筛选面板 → 总开关关时不显示标签筛选区；selectedTags 非空时只显示选中的候选
- [ ] 重启应用 → 配置持久化生效
- [ ] 旧配置自动转换为新格式（显示全部）

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/pages/Settings.tsx
git commit -m "docs: update Settings page description for simplified tag display config"
```

- [ ] **Step 5: 最终全量验证**

Run: `npm run typecheck && npm test`
Expected: 全部通过

```bash
git log --oneline -10
```
Expected: 看到 7 个 refactor/docs/feat 提交

---

## 假设与决策

1. **决策：混合模式（白名单 + 默认显示全部）** — 用户明确选择"默认显示全部，选中后只显示选中的"。`selectedTags=[]` 表示显示全部，非空表示白名单
2. **决策：候选值按类别分组** — 多选下拉使用 `<OptGroup>` 按"题型/难度/来源类型/自定义标签"分组展示，提升可读性，但选择时统一处理
3. **决策：删除大屏独立配置** — 用户选择"全部场景统一一套配置"，大屏使用同一套配置
4. **决策：向后兼容** — 读取旧格式配置（含 categoryEnabled 字段）时，保守转为默认（显示全部），避免数据丢失
5. **决策：FilterPanel 总开关关时隐藏标签筛选** — 与其他场景一致，总开关关时不显示标签相关 UI
6. **不实现** — 不保留按类别（4 类）的细粒度开关；不保留值黑名单模式；不保留大屏独立配置
7. **行为变化** — 大屏默认行为从"不显示任何标签"变为"显示全部标签"（与全局配置一致）。用户如希望大屏不显示，可关闭总开关（但这会同时影响其他场景）。这是用户选择"统一一套配置"的必然结果

## 验证步骤

完成所有 Task 后执行：

1. `npm run typecheck` — 无错误
2. `npm test` — 全部通过
3. `npm run dev` — 应用启动无错误
4. 手动验证清单（见 Task 7 Step 3）
5. `git log --oneline -10` — 应有 7 个提交

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 旧配置用户升级后大屏突然显示标签 | 文档说明行为变化；用户可手动关闭总开关 |
| selectedTags 非空时新增标签不显示 | UI 提示"未选=显示全部"；用户需主动管理选中列表 |
| 候选值过多导致下拉卡顿 | Select 组件支持搜索（optionFilterProp="label"），maxTagCount="responsive" |
| 用户已选标签被从题库删除 | selectedTags 保留删除的值不影响逻辑（filterTags 自动过滤不存在的值） |
