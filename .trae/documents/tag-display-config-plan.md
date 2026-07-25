# 标签显示可配置化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能全局统一控制辩题"自定义 tags"和"维度标签（题型/难度/来源）"在题库卡片、抽取结果卡片、大屏投影、筛选面板四处的显示——按类别开关 + 按值黑名单隐藏，仅 UI 隐藏不影响数据/抽题。

**Architecture:** 在 settings 表存一个 JSON 配置（key=`ui.tagDisplay`），复用现有 `settingsAPI` IPC 通道（无需后端改动）。新增纯函数工具模块 `tagDisplay.ts` 负责按配置过滤标签数组，所有展示组件订阅 `useSettingsStore` 并调用工具函数。新增 `TagDisplaySettingsModal` 弹窗作为统一配置入口，挂在 Settings 页新 Tab 上。

**Tech Stack:** React 18 + TypeScript + Ant Design 5 + Zustand + Vitest（纯函数单测）

---

## 当前状态分析

### 已存在的基础设施（无需改动）
- `IPC_CHANNELS.SETTINGS_GET/SET/GET_ALL/DELETE` — [src/shared/types.ts:341-344](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/shared/types.ts#L341-L344)
- Settings IPC handlers — [src/main/ipc/audit.ipc.ts:112-121](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/main/ipc/audit.ipc.ts#L112-L121)
- `settingsAPI` 已暴露到 window — [src/preload/index.ts:127-132](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/preload/index.ts#L127-L132)
- `useSettingsStore` 完整 CRUD — [src/renderer/src/stores/settingsStore.ts](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/stores/settingsStore.ts)
- `settings` 表（key/value 结构）

### 当前标签显示位置（需修改）
| 位置 | 文件 | 行号 | 当前行为 |
|---|---|---|---|
| 题库网格视图卡片 | `src/renderer/src/components/TopicCard.tsx` | 145-185 | 硬编码显示 type/difficulty/source_type + 全部 tags |
| 题库列表视图项 | `src/renderer/src/components/TopicCard.tsx` | 319-321 | tags 仅显示前 3 个 |
| 抽取结果卡片 | `src/renderer/src/components/draw/DrawResultCard.tsx` | 56-62 | 仅显示 type/difficulty/source，**不显示 tags** |
| 大屏投影模式 | `src/renderer/src/components/draw/BigScreen.tsx` | - | **完全不显示任何标签** |
| 筛选面板标签区 | `src/renderer/src/components/FilterPanel.tsx` | 185-216 | 显示全部 tagOptions（无过滤） |

### 关键决策
1. **存储**：settings 表 key=`ui.tagDisplay`，value 为 JSON 字符串。复用现有 IPC，零后端改动
2. **数据结构**：黑名单模式（用户勾选"要隐藏的值"），新增标签默认可见，符合用户预期
3. **默认配置**：所有类别开启 + hiddenValues 各类为空数组（不隐藏任何值）→ 升级后行为完全不变
4. **大屏特殊**：因当前不显示任何标签，默认 `bigScreenOverrides` 把所有类别关闭，保持原简洁行为；用户可手动开启
5. **加载时机**：App 启动时 `settingsStore.fetchAll()` 已在 Settings 页调用，但其他页面未必。需在 `App.tsx` 根组件统一加载一次
6. **值候选来源**：弹窗内通过 `topicAPI.list({ page:1, pageSize: 1000 })` 拉一页，汇总 type/difficulty/source_type/tags 全部候选值

---

## 文件结构

### 新建文件
| 文件 | 职责 |
|---|---|
| `src/renderer/src/utils/tagDisplay.ts` | 纯函数模块：类型定义、默认配置、过滤函数、配置读取函数 |
| `src/renderer/src/utils/__tests__/tagDisplay.test.ts` | 纯函数单元测试 |
| `src/renderer/src/components/TagDisplaySettingsModal.tsx` | 标签显示配置弹窗（类别开关 + 值黑名单） |

### 修改文件
| 文件 | 修改要点 |
|---|---|
| `src/shared/types.ts` | 添加 `TagCategory`、`TagDisplayConfig` 类型导出 |
| `src/renderer/src/App.tsx` | 启动时调用 `settingsStore.fetchAll()`（如尚未加载） |
| `src/renderer/src/pages/Settings.tsx` | 新增"标签显示" Tab，挂载配置弹窗入口 |
| `src/renderer/src/components/TopicCard.tsx` | 网格视图 + `TopicListItem` 列表视图应用配置 |
| `src/renderer/src/components/draw/DrawResultCard.tsx` | 应用配置 + 新增 tags 显示能力 |
| `src/renderer/src/components/draw/BigScreen.tsx` | 新增标签显示区（受配置控制） |
| `src/renderer/src/components/FilterPanel.tsx` | 过滤 tagOptions 候选 |

---

## Task 1: 定义类型 + 创建纯函数工具模块（TDD）

**Files:**
- Create: `src/renderer/src/utils/tagDisplay.ts`
- Create: `src/renderer/src/utils/__tests__/tagDisplay.test.ts`
- Modify: `src/shared/types.ts` (在 `IPC_CHANNELS` 之前新增类型定义块)

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/src/utils/__tests__/tagDisplay.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TAG_DISPLAY_CONFIG,
  filterDimensionTag,
  filterCustomTags,
  getEffectiveConfig,
  isCategoryVisible,
  type TagDisplayConfig
} from '../tagDisplay';

describe('tagDisplay utils', () => {
  const config: TagDisplayConfig = {
    categoryEnabled: {
      type: true,
      difficulty: true,
      source: true,
      customTags: true
    },
    hiddenValues: {
      type: ['价值辩'],
      difficulty: [],
      source: ['自定义'],
      customTags: ['996']
    },
    bigScreenOverrides: {
      categoryEnabled: {
        type: false,
        difficulty: false,
        source: false,
        customTags: false
      }
    }
  };

  describe('DEFAULT_TAG_DISPLAY_CONFIG', () => {
    it('所有类别默认开启', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled).toEqual({
        type: true,
        difficulty: true,
        source: true,
        customTags: true
      });
    });

    it('hiddenValues 默认全部为空数组', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.hiddenValues).toEqual({
        type: [],
        difficulty: [],
        source: [],
        customTags: []
      });
    });

    it('bigScreenOverrides 默认全部关闭', () => {
      expect(DEFAULT_TAG_DISPLAY_CONFIG.bigScreenOverrides.categoryEnabled).toEqual({
        type: false,
        difficulty: false,
        source: false,
        customTags: false
      });
    });
  });

  describe('isCategoryVisible', () => {
    it('类别开启时返回 true', () => {
      expect(isCategoryVisible(config, 'type', 'library')).toBe(true);
    });

    it('类别关闭时返回 false', () => {
      const c: TagDisplayConfig = {
        ...config,
        categoryEnabled: { ...config.categoryEnabled, type: false }
      };
      expect(isCategoryVisible(c, 'type', 'library')).toBe(false);
    });

    it('大屏场景应用 bigScreenOverrides', () => {
      expect(isCategoryVisible(config, 'type', 'bigscreen')).toBe(false);
    });

    it('大屏场景未覆盖的类别使用全局配置', () => {
      const c: TagDisplayConfig = {
        ...config,
        bigScreenOverrides: {
          categoryEnabled: { type: false, difficulty: false, source: false, customTags: false }
        }
      };
      // customTags 在 bigScreenOverrides 中关闭
      expect(isCategoryVisible(c, 'customTags', 'bigscreen')).toBe(false);
    });
  });

  describe('filterDimensionTag', () => {
    it('类别关闭时返回 null', () => {
      const c: TagDisplayConfig = {
        ...config,
        categoryEnabled: { ...config.categoryEnabled, difficulty: false }
      };
      expect(filterDimensionTag(c, '入门级', 'difficulty', 'library')).toBe(null);
    });

    it('值在黑名单中返回 null', () => {
      expect(filterDimensionTag(config, '价值辩', 'type', 'library')).toBe(null);
    });

    it('值不在黑名单中返回原值', () => {
      expect(filterDimensionTag(config, '事实辩', 'type', 'library')).toBe('事实辩');
    });

    it('空值返回 null', () => {
      expect(filterDimensionTag(config, '', 'type', 'library')).toBe(null);
      expect(filterDimensionTag(config, null, 'type', 'library')).toBe(null);
      expect(filterDimensionTag(config, undefined, 'type', 'library')).toBe(null);
    });

    it('大屏场景应用 bigScreenOverrides', () => {
      // 大屏 type 关闭
      expect(filterDimensionTag(config, '事实辩', 'type', 'bigscreen')).toBe(null);
    });
  });

  describe('filterCustomTags', () => {
    it('类别关闭时返回空数组', () => {
      const c: TagDisplayConfig = {
        ...config,
        categoryEnabled: { ...config.categoryEnabled, customTags: false }
      };
      expect(filterCustomTags(c, ['成长', '环境'], 'library')).toEqual([]);
    });

    it('过滤黑名单中的标签', () => {
      expect(filterCustomTags(config, ['成长', '996', '环境'], 'library')).toEqual(['成长', '环境']);
    });

    it('null/undefined 返回空数组', () => {
      expect(filterCustomTags(config, null, 'library')).toEqual([]);
      expect(filterCustomTags(config, undefined, 'library')).toEqual([]);
    });

    it('大屏场景应用 bigScreenOverrides', () => {
      // 大屏 customTags 关闭
      expect(filterCustomTags(config, ['成长', '环境'], 'bigscreen')).toEqual([]);
    });
  });

  describe('getEffectiveConfig', () => {
    it('library 场景返回原配置', () => {
      const result = getEffectiveConfig(config, 'library');
      expect(result.categoryEnabled).toEqual(config.categoryEnabled);
    });

    it('bigscreen 场景合并 bigScreenOverrides', () => {
      const result = getEffectiveConfig(config, 'bigscreen');
      expect(result.categoryEnabled).toEqual({
        type: false,
        difficulty: false,
        source: false,
        customTags: false
      });
    });

    it('bigScreenOverrides 部分覆盖时未覆盖字段使用全局', () => {
      const c: TagDisplayConfig = {
        ...config,
        bigScreenOverrides: {
          categoryEnabled: { type: false, difficulty: false, source: false, customTags: true }
        }
      };
      const result = getEffectiveConfig(c, 'bigscreen');
      expect(result.categoryEnabled.customTags).toBe(true);
      expect(result.categoryEnabled.type).toBe(false);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/renderer/src/utils/__tests__/tagDisplay.test.ts`
Expected: FAIL with "Cannot find module '../tagDisplay'"

- [ ] **Step 3: 在 shared/types.ts 添加类型定义**

在 [src/shared/types.ts:290 之前（IPC_CHANNELS 之前）](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/shared/types.ts#L290) 插入：

```typescript
// ---------- 标签显示配置 ----------

/** 维度标签类别（系统维度） */
export type TagCategory = 'type' | 'difficulty' | 'source' | 'customTags';

/** 显示场景：题库/抽取结果/大屏 */
export type DisplayScene = 'library' | 'drawResult' | 'bigscreen';

/** 标签显示配置（存储在 settings 表 key='ui.tagDisplay'） */
export interface TagDisplayConfig {
  /** 类别开关（全局） */
  categoryEnabled: {
    type: boolean;
    difficulty: boolean;
    source: boolean;
    customTags: boolean;
  };
  /** 值黑名单：用户勾选要隐藏的具体值（新增值默认可见） */
  hiddenValues: {
    type: string[];
    difficulty: string[];
    source: string[];
    customTags: string[];
  };
  /** 大屏场景覆盖（大屏当前默认不显示任何标签，用户可手动开启） */
  bigScreenOverrides: {
    categoryEnabled: {
      type: boolean;
      difficulty: boolean;
      source: boolean;
      customTags: boolean;
    };
  };
}
```

- [ ] **Step 4: 创建 tagDisplay.ts 工具模块**

创建 `src/renderer/src/utils/tagDisplay.ts`：

```typescript
import type { TagCategory, TagDisplayConfig, DisplayScene } from '../../../shared/types';

/** 默认配置：所有类别开启，所有黑名单为空，大屏全部关闭 */
export const DEFAULT_TAG_DISPLAY_CONFIG: TagDisplayConfig = {
  categoryEnabled: {
    type: true,
    difficulty: true,
    source: true,
    customTags: true
  },
  hiddenValues: {
    type: [],
    difficulty: [],
    source: [],
    customTags: []
  },
  bigScreenOverrides: {
    categoryEnabled: {
      type: false,
      difficulty: false,
      source: false,
      customTags: false
    }
  }
};

/** 从 settings store 读取配置，缺省时返回默认配置 */
export function loadTagDisplayConfig(
  settings: Record<string, unknown>
): TagDisplayConfig {
  const raw = settings['ui.tagDisplay'];
  if (!raw) return DEFAULT_TAG_DISPLAY_CONFIG;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return mergeWithDefaults(parsed);
    } catch {
      return DEFAULT_TAG_DISPLAY_CONFIG;
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    return mergeWithDefaults(raw as Partial<TagDisplayConfig>);
  }
  return DEFAULT_TAG_DISPLAY_CONFIG;
}

/** 合并用户配置与默认值，确保所有字段存在 */
function mergeWithDefaults(partial: Partial<TagDisplayConfig>): TagDisplayConfig {
  return {
    categoryEnabled: {
      type: partial.categoryEnabled?.type ?? DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.type,
      difficulty: partial.categoryEnabled?.difficulty ?? DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.difficulty,
      source: partial.categoryEnabled?.source ?? DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.source,
      customTags: partial.categoryEnabled?.customTags ?? DEFAULT_TAG_DISPLAY_CONFIG.categoryEnabled.customTags
    },
    hiddenValues: {
      type: partial.hiddenValues?.type ?? [],
      difficulty: partial.hiddenValues?.difficulty ?? [],
      source: partial.hiddenValues?.source ?? [],
      customTags: partial.hiddenValues?.customTags ?? []
    },
    bigScreenOverrides: {
      categoryEnabled: {
        type: partial.bigScreenOverrides?.categoryEnabled?.type ?? false,
        difficulty: partial.bigScreenOverrides?.categoryEnabled?.difficulty ?? false,
        source: partial.bigScreenOverrides?.categoryEnabled?.source ?? false,
        customTags: partial.bigScreenOverrides?.categoryEnabled?.customTags ?? false
      }
    }
  };
}

/** 获取某场景下的有效配置（大屏场景合并 bigScreenOverrides） */
export function getEffectiveConfig(
  config: TagDisplayConfig,
  scene: DisplayScene
): TagDisplayConfig {
  if (scene === 'bigscreen') {
    return {
      ...config,
      categoryEnabled: {
        type: config.bigScreenOverrides.categoryEnabled.type,
        difficulty: config.bigScreenOverrides.categoryEnabled.difficulty,
        source: config.bigScreenOverrides.categoryEnabled.source,
        customTags: config.bigScreenOverrides.categoryEnabled.customTags
      }
    };
  }
  return config;
}

/** 判断某类别在某场景下是否可见 */
export function isCategoryVisible(
  config: TagDisplayConfig,
  category: TagCategory,
  scene: DisplayScene
): boolean {
  const effective = getEffectiveConfig(config, scene);
  return effective.categoryEnabled[category];
}

/**
 * 过滤维度标签值
 * @returns 通过过滤的值（类别关闭或在黑名单中则返回 null）
 */
export function filterDimensionTag(
  config: TagDisplayConfig,
  value: string | null | undefined,
  category: TagCategory,
  scene: DisplayScene
): string | null {
  if (!value) return null;
  if (!isCategoryVisible(config, category, scene)) return null;
  const effective = getEffectiveConfig(config, scene);
  if (effective.hiddenValues[category].includes(value)) return null;
  return value;
}

/**
 * 过滤自定义 tags 数组
 * @returns 过滤后的数组（类别关闭返回空数组，黑名单中的值被移除）
 */
export function filterCustomTags(
  config: TagDisplayConfig,
  tags: string[] | null | undefined,
  scene: DisplayScene
): string[] {
  if (!tags || tags.length === 0) return [];
  if (!isCategoryVisible(config, 'customTags', scene)) return [];
  const effective = getEffectiveConfig(config, scene);
  return tags.filter((t) => !effective.hiddenValues.customTags.includes(t));
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/renderer/src/utils/__tests__/tagDisplay.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 6: 提交**

```bash
git add src/shared/types.ts src/renderer/src/utils/tagDisplay.ts src/renderer/src/utils/__tests__/tagDisplay.test.ts
git commit -m "feat: add TagDisplayConfig type and pure utility functions"
```

---

## Task 2: 创建 TagDisplaySettingsModal 配置弹窗

**Files:**
- Create: `src/renderer/src/components/TagDisplaySettingsModal.tsx`

- [ ] **Step 1: 创建弹窗组件**

创建 `src/renderer/src/components/TagDisplaySettingsModal.tsx`：

```typescript
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Form,
  Switch,
  Typography,
  Divider,
  Space,
  Tag,
  Empty,
  Alert,
  Tabs,
  Button,
  Spin,
  message
} from 'antd';
import { TagsOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import type { TagCategory, TagDisplayConfig } from '../../../shared/types';
import { useTopicStore } from '../stores/topicStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  DEFAULT_TAG_DISPLAY_CONFIG,
  loadTagDisplayConfig
} from '../utils/tagDisplay';
import { spacing } from '../styles/tokens';

const { Text, Title } = Typography;

const SETTING_KEY = 'ui.tagDisplay';

const CATEGORY_LABELS: Record<TagCategory, string> = {
  type: '题型',
  difficulty: '难度',
  source: '来源',
  customTags: '自定义标签'
};

const CATEGORY_COLORS: Record<TagCategory, string> = {
  type: 'geekblue',
  difficulty: 'orange',
  source: 'purple',
  customTags: 'default'
};

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
      // 拉取较大页用于汇总候选值（最多 1000 条）
      await topicStore.fetchList({ page: 1, pageSize: 1000 });
      // 加载已有配置
      const cfg = loadTagDisplayConfig(settingsStore.settings);
      setConfig(cfg);
      setLoading(false);
    })();
  }, [open]);

  // 从题库汇总所有候选值
  const candidates = useMemo(() => {
    const typeSet = new Set<string>();
    const diffSet = new Set<string>();
    const sourceSet = new Set<string>();
    const tagsSet = new Set<string>();
    topicStore.items.forEach((t) => {
      if (t.type) typeSet.add(t.type);
      if (t.difficulty) diffSet.add(t.difficulty);
      if (t.source_type) sourceSet.add(t.source_type);
      (t.tags ?? []).forEach((tag) => tagsSet.add(tag));
    });
    return {
      type: Array.from(typeSet).sort(),
      difficulty: Array.from(diffSet).sort(),
      source: Array.from(sourceSet).sort(),
      customTags: Array.from(tagsSet).sort()
    };
  }, [topicStore.items]);

  // 切换类别开关
  const toggleCategory = (cat: TagCategory, value: boolean, isBigScreen = false) => {
    setConfig((prev) => {
      if (isBigScreen) {
        return {
          ...prev,
          bigScreenOverrides: {
            categoryEnabled: {
              ...prev.bigScreenOverrides.categoryEnabled,
              [cat]: value
            }
          }
        };
      }
      return {
        ...prev,
        categoryEnabled: {
          ...prev.categoryEnabled,
          [cat]: value
        }
      };
    });
  };

  // 切换值黑名单（点击 tag 切换隐藏/显示）
  const toggleValueHidden = (cat: TagCategory, value: string) => {
    setConfig((prev) => {
      const list = prev.hiddenValues[cat];
      const next = list.includes(value)
        ? list.filter((v) => v !== value)
        : [...list, value];
      return {
        ...prev,
        hiddenValues: {
          ...prev.hiddenValues,
          [cat]: next
        }
      };
    });
  };

  const handleReset = () => {
    setConfig(DEFAULT_TAG_DISPLAY_CONFIG);
    messageApi.info('已恢复默认配置，需点击"保存"后生效');
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

  // 渲染单类别区块
  const renderCategoryBlock = (
    cat: TagCategory,
    isBigScreen = false
  ) => {
    const enabled = isBigScreen
      ? config.bigScreenOverrides.categoryEnabled[cat]
      : config.categoryEnabled[cat];
    const values = candidates[cat];
    const hiddenList = isBigScreen ? [] : config.hiddenValues[cat];

    return (
      <div style={{ marginBottom: spacing.lg }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.sm
          }}
        >
          <Space>
            <Tag color={CATEGORY_COLORS[cat]}>{CATEGORY_LABELS[cat]}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {values.length} 个候选值
            </Text>
          </Space>
          <Switch
            size="small"
            checked={enabled}
            onChange={(v) => toggleCategory(cat, v, isBigScreen)}
            checkedChildren="显示"
            unCheckedChildren="隐藏"
          />
        </div>

        {enabled && !isBigScreen && (
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
              点击标签切换显示/隐藏（隐藏的标签不会出现在 UI 上，但辩题仍可被抽取）
            </Text>
            {values.length === 0 ? (
              <Empty description="暂无候选值" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {values.map((v) => {
                  const hidden = hiddenList.includes(v);
                  return (
                    <Tag
                      key={v}
                      style={{
                        cursor: 'pointer',
                        opacity: hidden ? 0.4 : 1,
                        textDecoration: hidden ? 'line-through' : 'none',
                        userSelect: 'none'
                      }}
                      onClick={() => toggleValueHidden(cat, v)}
                      icon={hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                    >
                      {cat === 'customTags' ? `#${v}` : v}
                    </Tag>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {enabled && isBigScreen && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            大屏模式：仅控制是否显示该类别，沿用全局隐藏值配置
          </Text>
        )}
      </div>
    );
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
      width={680}
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
          description="全局控制标签在各处的显示。隐藏标签仅影响 UI 展示，不影响数据与抽题范围。大屏模式默认全部关闭以保持简洁，可手动开启。"
          type="info"
          showIcon
          banner
          style={{ marginBottom: spacing.md }}
        />

        <Tabs
          items={[
            {
              key: 'global',
              label: '全局显示（题库/抽取结果）',
              children: (
                <div>
                  {(['type', 'difficulty', 'source', 'customTags'] as TagCategory[]).map((cat) => (
                    <div key={cat}>
                      {renderCategoryBlock(cat)}
                      <Divider style={{ margin: '8px 0' }} />
                    </div>
                  ))}
                </div>
              )
            },
            {
              key: 'bigscreen',
              label: '大屏投影',
              children: (
                <div>
                  <Alert
                    message="大屏模式独立配置"
                    description="大屏投影默认不显示任何标签以保持简洁。如需在大屏上显示某类标签，请开启对应开关。隐藏值沿用全局配置。"
                    type="warning"
                    showIcon
                    banner
                    style={{ marginBottom: spacing.md }}
                  />
                  {(['type', 'difficulty', 'source', 'customTags'] as TagCategory[]).map((cat) => (
                    <div key={cat}>
                      {renderCategoryBlock(cat, true)}
                      <Divider style={{ margin: '8px 0' }} />
                    </div>
                  ))}
                </div>
              )
            }
          ]}
        />
      </Spin>
    </Modal>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS（无错误）

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/TagDisplaySettingsModal.tsx
git commit -m "feat: add TagDisplaySettingsModal component"
```

---

## Task 3: 在 Settings 页接入配置入口

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx` (新增 Tab + 弹窗挂载)

- [ ] **Step 1: 修改 Settings.tsx**

在 [src/renderer/src/pages/Settings.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/pages/Settings.tsx) 中：

**1. 添加 import**（在 ImportTopicsModal import 后）：

```typescript
import TagDisplaySettingsModal from '../components/TagDisplaySettingsModal';
import { TagsOutlined } from '@ant-design/icons';
```

**2. 添加 state**（在 `const [dedupOpen, setDedupOpen] = useState(false);` 后）：

```typescript
const [tagDisplayOpen, setTagDisplayOpen] = useState(false);
```

**3. 在 `renderLibraryTab` 函数末尾（紧邻 return 前）添加"标签显示"卡片**：

```typescript
const renderLibraryTab = () => (
    <div>
      {/* 已有的统计卡片 */}
      {/* 已有的官方题库卡片 */}
      {/* 已有的题库导入卡片 */}
      {/* 已有的题库导出卡片 */}

      <Card
        size="small"
        title={
          <Space>
            <TagsOutlined style={{ color: '#1677ff' }} />
            <span>标签显示配置</span>
          </Space>
        }
        style={{ marginTop: spacing.md }}
        extra={
          <Button
            type="primary"
            size="small"
            icon={<TagsOutlined />}
            onClick={() => setTagDisplayOpen(true)}
          >
            配置标签显示
          </Button>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          控制辩题卡片、抽取结果、大屏投影、筛选面板中各类标签的显示与隐藏。
          可按类别开关，也可按值隐藏特定标签。隐藏仅影响 UI 展示，不影响数据。
        </Paragraph>
      </Card>
    </div>
  );
```

**4. 在主 return 的 `<DedupResultModal>` 之后添加弹窗**：

```typescript
      {/* 标签显示配置弹窗 */}
      <TagDisplaySettingsModal
        open={tagDisplayOpen}
        onClose={() => setTagDisplayOpen(false)}
      />
```

- [ ] **Step 2: 运行类型检查 + 启动验证**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run dev`（手动打开 Settings → 题库管理 Tab，应能看到"标签显示配置"卡片与按钮）
Expected: 应用正常启动，按钮点击弹窗正常显示

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/pages/Settings.tsx
git commit -m "feat: integrate TagDisplaySettingsModal into Settings page"
```

---

## Task 4: 接入 TopicCard（网格视图 + 列表视图）

**Files:**
- Modify: `src/renderer/src/components/TopicCard.tsx` (145-185 行 + 319-321 行)

- [ ] **Step 1: 添加 imports**

在 [src/renderer/src/components/TopicCard.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/components/TopicCard.tsx) 顶部添加：

```typescript
import { useSettingsStore } from '../stores/settingsStore';
import { loadTagDisplayConfig, filterDimensionTag, filterCustomTags } from '../utils/tagDisplay';
```

- [ ] **Step 2: 修改网格视图主组件（145-185 行标签区块）**

将原 145-185 行：

```typescript
{/* 标签行 */}
<div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
  {topic.type && <Tag color="geekblue">{topic.type}</Tag>}
  {topic.difficulty && (
    <Tag style={{ background: DIFFICULTY_GRADIENT[topic.difficulty] ?? undefined, color: '#fff', border: 'none' }}>
      {topic.difficulty}
    </Tag>
  )}
  {topic.source_type && (
    <Tag color={SOURCE_TYPE_COLOR[topic.source_type] ?? 'default'}>
      {topic.source_type}
    </Tag>
  )}
  {isFavorited && (<Tag icon={<StarFilled />} color="gold">收藏</Tag>)}
  {isBlacklisted && (<Tag icon={<StopOutlined />} color="error">黑名单</Tag>)}
</div>

{/* 自定义标签 */}
{topic.tags && topic.tags.length > 0 && (
  <div style={{ marginBottom: 8 }}>
    {topic.tags.map((t) => (
      <Tag key={t} style={{ marginBottom: 2 }}>#{t}</Tag>
    ))}
  </div>
)}
```

替换为：

```typescript
{/* 标签行（应用显示配置） */}
{(() => {
  const settings = useSettingsStore.getState().settings;
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
            <Tag style={{ background: DIFFICULTY_GRADIENT[diffTag] ?? undefined, color: '#fff', border: 'none' }}>
              {diffTag}
            </Tag>
          )}
          {sourceTag && (
            <Tag color={SOURCE_TYPE_COLOR[sourceTag] ?? 'default'}>{sourceTag}</Tag>
          )}
          {isFavorited && (<Tag icon={<StarFilled />} color="gold">收藏</Tag>)}
          {isBlacklisted && (<Tag icon={<StopOutlined />} color="error">黑名单</Tag>)}
        </div>
      )}
      {customTags.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {customTags.map((t) => (
            <Tag key={t} style={{ marginBottom: 2 }}>#{t}</Tag>
          ))}
        </div>
      )}
    </>
  );
})()}
```

**重要说明**：上面用 IIFE + `useSettingsStore.getState()` 是为了在函数组件内最小侵入。但更规范做法是用 `useSettingsStore()` hook 订阅。改为：

在 `TopicCard` 函数组件顶部（紧跟其他 useState 之后）添加：

```typescript
const settings = useSettingsStore((s) => s.settings);
```

然后把上面的 IIFE 改为使用这个 `settings` 变量（删掉 `useSettingsStore.getState()` 行）。

实际改动：在 `TopicCard` 函数体顶部添加 `const settings = useSettingsStore((s) => s.settings);`，然后标签区块改为：

```typescript
{/* 标签行（应用显示配置） */}
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
            <Tag style={{ background: DIFFICULTY_GRADIENT[diffTag] ?? undefined, color: '#fff', border: 'none' }}>
              {diffTag}
            </Tag>
          )}
          {sourceTag && (
            <Tag color={SOURCE_TYPE_COLOR[sourceTag] ?? 'default'}>{sourceTag}</Tag>
          )}
          {isFavorited && (<Tag icon={<StarFilled />} color="gold">收藏</Tag>)}
          {isBlacklisted && (<Tag icon={<StopOutlined />} color="error">黑名单</Tag>)}
        </div>
      )}
      {customTags.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {customTags.map((t) => (
            <Tag key={t} style={{ marginBottom: 2 }}>#{t}</Tag>
          ))}
        </div>
      )}
    </>
  );
})()}
```

- [ ] **Step 3: 修改列表视图 TopicListItem（319-321 行）**

找到 `TopicListItem` 组件，在函数体顶部添加：

```typescript
const settings = useSettingsStore((s) => s.settings);
```

把原 319-321 行：

```typescript
(topic.tags ?? []).slice(0, 3).map((t) => (
  <Tag key={t}>#{t}</Tag>
))
```

替换为：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const customTags = filterCustomTags(cfg, topic.tags, 'library').slice(0, 3);
  return customTags.map((t) => (
    <Tag key={t}>#{t}</Tag>
  ));
})()}
```

同样，列表视图中如有 type/difficulty/source_type 标签显示，也要应用 `filterDimensionTag`（如有）。

- [ ] **Step 4: 类型检查 + 启动验证**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run dev`（打开题库页，验证标签正常显示，进入 Settings 改配置后回到题库页验证隐藏生效）
Expected: 配置生效，UI 正确响应

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/TopicCard.tsx
git commit -m "feat: apply tag display config to TopicCard (grid + list view)"
```

---

## Task 5: 接入 DrawResultCard（新增 tags 显示）

**Files:**
- Modify: `src/renderer/src/components/draw/DrawResultCard.tsx` (56-62 行 + 新增 tags 显示)

- [ ] **Step 1: 添加 imports**

在 [src/renderer/src/components/draw/DrawResultCard.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/components/draw/DrawResultCard.tsx) 顶部添加：

```typescript
import { useSettingsStore } from '../../stores/settingsStore';
import { loadTagDisplayConfig, filterDimensionTag, filterCustomTags } from '../../utils/tagDisplay';
```

- [ ] **Step 2: 修改 DrawResultCard 组件**

在 `DrawResultCard` 函数体顶部添加：

```typescript
const settings = useSettingsStore((s) => s.settings);
```

把原 56-62 行（type/difficulty/source 标签区块）：

```typescript
{topic.type && <Tag color="geekblue">{topic.type}</Tag>}
{topic.difficulty && (
  <Tag style={{ background: ..., color: '#fff', border: 'none' }}>
    {topic.difficulty}
  </Tag>
)}
{topic.source && (
  <Tag color={...}>{topic.source}</Tag>
)}
```

替换为：

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
        <Tag style={{ background: DIFFICULTY_GRADIENT[diffTag] ?? undefined, color: '#fff', border: 'none' }}>
          {diffTag}
        </Tag>
      )}
      {sourceTag && (
        <Tag color={SOURCE_TYPE_COLOR[sourceTag] ?? 'default'}>{sourceTag}</Tag>
      )}
      {customTags.map((t) => (
        <Tag key={t}>#{t}</Tag>
      ))}
    </>
  );
})()}
```

注：保留对原 `DIFFICULTY_GRADIENT`、`SOURCE_TYPE_COLOR` 常量的引用——如未定义，从 TopicCard.tsx 复制到本文件顶部（或抽到共享样式文件）。如已存在则直接使用。

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS（如有未定义常量错误，按提示修复）

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/draw/DrawResultCard.tsx
git commit -m "feat: apply tag display config to DrawResultCard and add custom tags display"
```

---

## Task 6: 接入 BigScreen 大屏模式（新增标签显示能力）

**Files:**
- Modify: `src/renderer/src/components/draw/BigScreen.tsx`

- [ ] **Step 1: 添加 imports**

在 [src/renderer/src/components/draw/BigScreen.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/components/draw/BigScreen.tsx) 顶部添加：

```typescript
import { useSettingsStore } from '../../stores/settingsStore';
import { loadTagDisplayConfig, filterDimensionTag, filterCustomTags } from '../../utils/tagDisplay';
import { Tag as AntTag } from 'antd';
```

- [ ] **Step 2: 在 BigScreen 组件中读取配置**

在 `BigScreen` 函数体顶部添加：

```typescript
const settings = useSettingsStore((s) => s.settings);
```

- [ ] **Step 3: 在辩题展示区下方添加标签显示区**

在 BigScreen 渲染 `currentTopic.title` 与持方对阵之间或之后（具体位置根据现有结构定位）添加：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  const typeTag = filterDimensionTag(cfg, currentTopic.type, 'type', 'bigscreen');
  const diffTag = filterDimensionTag(cfg, currentTopic.difficulty, 'difficulty', 'bigscreen');
  const sourceTag = filterDimensionTag(cfg, currentTopic.source_type, 'source', 'bigscreen');
  const customTags = filterCustomTags(cfg, currentTopic.tags, 'bigscreen');
  const visibleTags: Array<{ key: string; label: string; color?: string }> = [];
  if (typeTag) visibleTags.push({ key: 'type', label: typeTag, color: 'geekblue' });
  if (diffTag) visibleTags.push({ key: 'diff', label: diffTag });
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
        fontSize: 18
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

**说明**：默认配置（bigScreenOverrides 全 false）下 `visibleTags.length === 0`，返回 null，保持原大屏行为不变。

- [ ] **Step 4: 类型检查 + 启动验证**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run dev`（执行抽取 → 进入大屏 → 默认无标签；进入 Settings 开启大屏 type → 重新进入大屏 → 应显示 type 标签）
Expected: 默认无标签显示，开启后正确显示

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/draw/BigScreen.tsx
git commit -m "feat: apply tag display config to BigScreen with optional tag display"
```

---

## Task 7: 接入 FilterPanel（候选标签过滤）

**Files:**
- Modify: `src/renderer/src/components/FilterPanel.tsx` (185-216 行)

- [ ] **Step 1: 添加 imports**

在 [src/renderer/src/components/FilterPanel.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/components/FilterPanel.tsx) 顶部添加：

```typescript
import { useSettingsStore } from '../stores/settingsStore';
import { loadTagDisplayConfig } from '../utils/tagDisplay';
```

- [ ] **Step 2: 修改 FilterPanel 组件**

在 `FilterPanel` 函数体顶部添加：

```typescript
const settings = useSettingsStore((s) => s.settings);
```

在标签筛选区（185-216 行）应用过滤。原代码：

```typescript
{tagOptions.length > 0 && (
  <Form.Item label="标签">
    <Select
      mode="multiple"
      placeholder="选择标签"
      value={filter.tags}
      onChange={(v) => onChange({ tags: v as string[] | undefined })}
      ...
    >
      {tagOptions.map((t) => (
        <Option key={t} value={t}>#{t}</Option>
      ))}
    </Select>
  </Form.Item>
)}
```

修改为：

```typescript
{(() => {
  const cfg = loadTagDisplayConfig(settings);
  // 过滤掉被隐藏的标签候选
  const visibleTagOptions = cfg.hiddenValues.customTags.length > 0
    ? tagOptions.filter((t) => !cfg.hiddenValues.customTags.includes(t))
    : tagOptions;
  if (visibleTagOptions.length === 0) return null;
  return (
    <Form.Item label="标签">
      <Select
        mode="multiple"
        placeholder="选择标签"
        value={filter.tags}
        onChange={(v) => onChange({ tags: v as string[] | undefined })}
        tagRender={(props) => (
          <Tag closable={props.closable} onClose={props.onClose} style={{ marginRight: 2 }}>
            #{props.value}
          </Tag>
        )}
        style={{ width: '100%' }}
      >
        {visibleTagOptions.map((t) => (
          <Option key={t} value={t}>#{t}</Option>
        ))}
      </Select>
    </Form.Item>
  );
})()}
```

**说明**：筛选面板的标签候选列表过滤掉被隐藏的标签值。但用户已选中的标签值不会被强制清除（仅候选下拉不再显示）。

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/FilterPanel.tsx
git commit -m "feat: apply tag display config to FilterPanel candidate options"
```

---

## Task 8: App.tsx 启动时加载 settings + 最终验证

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 修改 App.tsx 启动加载 settings**

在 [src/renderer/src/App.tsx](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/App.tsx) 中：

在 `App` 函数体顶部添加 useEffect：

```typescript
import { useEffect } from 'react';
import { useSettingsStore } from './stores/settingsStore';

function App() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll);
  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);
  // ... 其余代码不变
}
```

**说明**：确保用户在任何页面看到标签前，settings 已加载完毕。如 App.tsx 已有 useEffect，谨慎合并。

- [ ] **Step 2: 类型检查 + 全部测试**

Run: `npm run typecheck`
Expected: PASS

Run: `npm test`
Expected: 全部 67 + 新增 12 = 79 tests 通过

- [ ] **Step 3: 启动应用端到端验证**

Run: `npm run dev`

验证清单：
- [ ] 应用启动无错误
- [ ] 题库管理页：辩题卡片正常显示所有标签
- [ ] 进入 Settings → 题库管理 Tab → 看到"标签显示配置"卡片 → 点击按钮 → 弹窗正常显示
- [ ] 弹窗内"全局显示" Tab：4 个类别开关 + 标签候选点击切换隐藏
- [ ] 弹窗内"大屏投影" Tab：4 个类别开关默认全关
- [ ] 点击"恢复默认" → 配置重置
- [ ] 保存配置 → 关闭弹窗 → 回到题库页 → 验证隐藏的标签不再显示
- [ ] 抽取辩题 → 抽取结果卡片应用配置（默认全显示，含自定义 tags）
- [ ] 抽取后进入大屏 → 默认无标签 → 进入 Settings 开启大屏 type → 重新大屏 → 显示 type 标签
- [ ] 筛选面板 → 隐藏的标签不出现在候选下拉中
- [ ] 重启应用 → 配置持久化生效

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: load settings on app startup for tag display config"
```

- [ ] **Step 5: 最终全量验证**

Run: `npm run typecheck && npm test`
Expected: 全部通过

```bash
git log --oneline -10
```
Expected: 看到 8 个 feat 提交

---

## 假设与决策

1. **假设**：用户当前题库数据中的 type/difficulty/source_type 字段值有限（如 type 通常是"价值辩/事实辩/政策辩"等几种），点击切换隐藏可行。如候选值超过 50 个，UI 会自动 wrap 不出现布局问题。
2. **决策**：黑名单模式（hiddenValues）而非白名单——新增标签默认可见，符合用户预期。
3. **决策**：大屏场景独立配置（bigScreenOverrides），因为大屏当前不显示任何标签，与全局"全开"默认值冲突，独立配置更合理。
4. **决策**：不在每个页面单独提供配置入口，统一在 Settings 页配置，避免重复 UI。
5. **决策**：FilterPanel 仅过滤候选下拉，不强制清除用户已选但被隐藏的标签（兼容性考虑）。
6. **决策**：DrawResultCard 新增 tags 显示（之前不显示），与"按类别+按值"控制要求一致——默认配置下 tags 会显示，用户可关闭 customTags 类别隐藏。
7. **不实现**：不新增标签管理页（统一查看/重命名/合并标签），不在本次范围内。
8. **不实现**：不修改后端 IPC（settings IPC 已存在），不修改数据库 schema（settings 表 key-value 结构已足够）。

## 验证步骤

完成所有 Task 后执行：

1. `npm run typecheck` — 主进程 + 渲染进程均无错误
2. `npm test` — 全部测试通过（原 67 + 新增 12 = 79）
3. `npm run dev` — 应用启动无错误
4. 手动验证清单（见 Task 8 Step 3）
5. `git log --oneline -10` — 应有 8 个 feat 提交

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 用户已选标签被隐藏后筛选状态异常 | FilterPanel 不强制清除已选值，仅过滤候选下拉 |
| 配置加载延迟导致首次渲染闪烁 | App.tsx 启动时 fetchAll，DEFAULT_CONFIG 兜底 |
| 大屏标签显示破坏布局 | 默认全部关闭，用户主动开启后字号 18px + flex-wrap 适应 |
| 候选值过多导致弹窗过长 | Tag 自动 wrap，弹窗 max-height 自动滚动（Modal 默认行为） |
| TopicListItem IIFE 性能 | 列表项数量有限（默认 20 条/页），性能影响可忽略 |
