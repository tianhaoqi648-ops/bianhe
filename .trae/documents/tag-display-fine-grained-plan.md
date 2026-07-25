# 标签显示配置精细化改造实施计划

## Goal

将"总开关 + 单一多选"的标签显示配置升级为"4 类别开关 + 每类多选标签值（白名单）"的精细化控制，作用于题库浏览/抽取结果/大屏投影/筛选面板 4 个展示场景，编辑弹窗 TopicEditModal 不受影响，便于用户在展示时按类别精简标签。

## Architecture

数据结构从 `{ enabled, selectedTags }` 升级为 `{ categoryEnabled, selectedValues }`，按 4 个类别（type / difficulty / source_type / custom）独立控制开关与白名单。工具函数 `filterTag` / `filterTags` 接受 `category` 参数。4 个展示场景调用新 API，TopicEditModal 保持原状不接入配置。向后兼容旧格式（含 `enabled`/`categoryEnabled`/`hiddenValues` 等历史字段）保守转为默认。

## Tech Stack

- React 18 + TypeScript + Ant Design 5
- Zustand 状态管理（settingsStore）
- Vitest 单元测试
- 纯函数工具模块设计（TDD）

## Current State Analysis

### 当前数据结构（src/shared/types.ts:291-306）
```ts
export interface TagDisplayConfig {
  enabled: boolean;          // 总开关
  selectedTags: string[];    // 跨类别的白名单
}
```

### 当前工具函数（src/renderer/src/utils/tagDisplay.ts）
- `filterTag(config, value)` - 不区分类别，统一过滤
- `filterTags(config, tags)` - 不区分类别，统一过滤数组
- 缺点：无法按类别开关，无法对"题型"和"难度"分别控制

### 各场景当前行为
| 场景 | 文件 | 当前接入 |
|---|---|---|
| 题库浏览-网格 | TopicCard.tsx | filterTag/filterTags（无类别） |
| 题库浏览-列表 | TopicCard.tsx | filterTag/filterTags（无类别） |
| 编辑弹窗 | TopicEditModal.tsx | 不接入（保持原状） |
| 抽取结果 | DrawResultCard.tsx | filterTag/filterTags（无类别） |
| 大屏投影 | BigScreen.tsx | filterTag/filterTags（无类别） |
| 筛选面板 | FilterPanel.tsx | 仅过滤自定义标签候选 |

### 已知不一致点（本计划顺带修正）
- `source_type` vs `source` 字段使用不一致：
  - TopicCard 网格视图用 `topic.source_type` ✓
  - TopicCard 列表视图用 `topic.source` ✗
  - DrawResultCard 用 `topic.source` ✗
  - BigScreen 用 `topic.source_type` ✓
  - 计划：列表视图和抽取结果改为 `topic.source_type`，与"来源类型"语义对齐

## Proposed Changes

### 1. 数据结构（src/shared/types.ts）

删除 `TagDisplayConfig` 旧定义，新增：

```ts
/** 标签类别（受 tagDisplay 配置控制） */
export type TagCategory = 'type' | 'difficulty' | 'source_type' | 'custom';

/**
 * 标签显示配置（存储在 settings 表 key='ui.tagDisplay'）
 *
 * 行为：
 * - categoryEnabled[cat]=false：不显示该类别任何标签
 * - categoryEnabled[cat]=true + selectedValues[cat] 空：显示该类别全部
 * - categoryEnabled[cat]=true + selectedValues[cat] 非空：只显示选中的
 */
export interface TagDisplayConfig {
  categoryEnabled: {
    type: boolean;
    difficulty: boolean;
    source_type: boolean;
    custom: boolean;
  };
  selectedValues: {
    type: string[];
    difficulty: string[];
    source_type: string[];
    custom: string[];
  };
}
```

### 2. 工具函数（src/renderer/src/utils/tagDisplay.ts）

```ts
export const DEFAULT_TAG_DISPLAY_CONFIG: TagDisplayConfig = {
  categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
  selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
};

export function loadTagDisplayConfig(settings: Record<string, unknown>): TagDisplayConfig
export function filterTag(config, value, category: TagCategory): string | null
export function filterTags(config, tags, category: TagCategory): string[]
```

**向后兼容**：检测旧格式（含 `enabled` / `categoryEnabled` / `hiddenValues` / `bigScreenOverrides` 任意字段）→ 保守转为默认。

### 3. 配置弹窗（src/renderer/src/components/TagDisplaySettingsModal.tsx）

UI 结构：
```
[Alert 说明]
┌─────────────────────────────────────────┐
│ 题型                  共 N 个候选值 [Switch]│
│ [Select 多选] 不选=显示全部              │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ 难度                  共 N 个候选值 [Switch]│
│ [Select 多选] 不选=显示全部              │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ 来源类型              共 N 个候选值 [Switch]│
│ [Select 多选] 不选=显示全部              │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ 自定义标签            共 N 个候选值 [Switch]│
│ [Select 多选] 不选=显示全部              │
└─────────────────────────────────────────┘
[恢复默认] [取消] [保存]
```

每个类别独立：
- Switch 控制该类别开关
- Switch 关闭时下方 Select 禁用
- Switch 开启 + 未选 = 显示全部
- Switch 开启 + 选了 = 只显示选中的

### 4. 接入点调整（4 个场景）

| 文件 | 修改 |
|---|---|
| TopicCard.tsx 网格视图 | `filterTag(cfg, topic.type, 'type')` 等，加 category 参数 |
| TopicCard.tsx 列表视图 | 同上 + 修复 `topic.source` → `topic.source_type` |
| DrawResultCard.tsx | 加 category 参数 + 修复 `topic.source` → `topic.source_type` |
| BigScreen.tsx | 加 category 参数 |
| FilterPanel.tsx | 自定义标签候选过滤改用 `cfg.categoryEnabled.custom` + `cfg.selectedValues.custom` |

### 5. Settings 入口文案（src/renderer/src/pages/Settings.tsx）

调整描述文案为："按类别（题型/难度/来源类型/自定义标签）开关 + 每类多选标签值"。

## Assumptions & Decisions

1. **作用范围**：4 个展示场景（题库浏览/抽取结果/大屏/筛选面板），TopicEditModal 编辑弹窗不接入配置
2. **4 个类别**：题型（type）/ 难度（difficulty）/ 来源类型（source_type）/ 自定义标签（custom）
3. **不包含 `source`（来源）字段**：保持现有行为，source 仍是普通文本展示（如题库卡片底部）或不受配置控制的 Tag
4. **白名单模式**：每类 selectedValues 为空 = 显示全部；非空 = 只显示选中的（比黑名单更直观）
5. **默认配置**：所有类别开启、所有 selectedValues 为空（即默认显示全部）
6. **向后兼容**：检测到任何旧格式字段 → 保守转为默认配置（显示全部），不尝试迁移
7. **大屏不独立**：4 个场景共用同一套配置，不再有 bigScreenOverrides
8. **修复 source vs source_type 不一致**：列表视图和抽取结果改为使用 `source_type`

## Verification

### 单元测试（src/renderer/src/utils/__tests__/tagDisplay.test.ts）
- 默认配置正确性
- loadTagDisplayConfig：无配置/字符串/对象/损坏 JSON/旧格式兼容/部分字段缺失
- filterTag：4 个类别分别测试开关关闭、白名单空、白名单非空、空值
- filterTags：4 个类别分别测试开关关闭、白名单空、白名单非空、空数组

### 类型检查
- `npm run typecheck` 通过

### 全量测试
- `npm test -- --run` 所有测试通过

### 端到端验证清单（手动）
1. 应用启动无错误
2. 题库管理页：辩题卡片显示所有类别标签（默认）
3. Settings → 题库管理 Tab → 标签显示配置卡片 → 点击按钮 → 弹窗显示 4 个类别区块
4. 关闭"自定义标签"开关 → 保存 → 题库页自定义标签消失，其他类别标签保留
5. 开启"题型" + 选择"价值辩" → 保存 → 题库页只显示"价值辩"题型标签
6. 抽取辩题 → 抽取结果卡片应用同一套配置
7. 进入大屏 → 应用同一套配置
8. 筛选面板 → 类别关闭时不显示该类别候选；白名单非空时只显示选中的候选
9. 重启应用 → 配置持久化生效
10. 编辑弹窗（新增/编辑辩题）→ 所有字段正常显示和编辑，不受配置影响
