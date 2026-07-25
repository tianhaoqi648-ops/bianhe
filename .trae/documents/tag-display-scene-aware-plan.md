# 标签显示配置：5 场景独立精细化控制实施计划

## Summary

将当前的"全局 4 类别开关 + 每类白名单"升级为"5 场景独立 × 4 类别开关 + 每类白名单"的精细化控制。5 个场景：题库浏览 / 抽取结果 / 大屏投影 / 筛选面板 / 去重检查。每个场景独立配置 4 个类别（题型 / 难度 / 来源类型 / 自定义标签）的开关与白名单，互不影响。配置弹窗以 Tab 切换场景。

## Current State Analysis

### 当前数据结构（src/shared/types.ts:293-319）
```ts
export type TagCategory = 'type' | 'difficulty' | 'source_type' | 'custom';
export interface TagDisplayConfig {
  categoryEnabled: { type; difficulty; source_type; custom };
  selectedValues: { type; difficulty; source_type; custom };
}
```
- 全局一套配置，4 类别开关 + 每类白名单
- 不分场景

### 当前 6 个标签展示场景盘点（来自 Phase 1）

| 场景 | 文件 / 组件 | 当前行为 |
|---|---|---|
| 1. 题库浏览 | TopicCard.tsx（TopicCard 网格 + TopicListItem 列表） | ✓ 应用全局配置 |
| 2. 抽取结果 | DrawResultCard.tsx | ✓ 应用全局配置 |
| 3. 大屏投影 | BigScreen.tsx | ✓ 应用全局配置 |
| 4. 筛选面板 | FilterPanel.tsx | ⚠ 仅 custom 类别应用 |
| 5. 去重检查 | DedupResultModal.tsx:222 | ✗ 未应用（直接渲染 source 文字） |
| 编辑弹窗 | TopicEditModal.tsx | 明确不应用（设计排除） |
| 导入预览 | ImportTopicsModal.tsx | 不应用（编辑场景延伸） |

### 已知不一致点
- FilterPanel 维度候选（type/difficulty/source/source_type Select）未应用配置，仅 custom 类别应用
- DedupResultModal 直接渲染 source 文字，未走 filterTag

## Proposed Changes

### 1. 数据结构升级（src/shared/types.ts）

```ts
/** 标签类别 */
export type TagCategory = 'type' | 'difficulty' | 'source_type' | 'custom';

/** 标签显示场景 */
export type TagDisplayScene =
  | 'library'      // 题库浏览
  | 'drawResult'   // 抽取结果
  | 'bigScreen'    // 大屏投影
  | 'filter'       // 筛选面板
  | 'dedup';       // 去重检查

/** 单场景配置：4 类别开关 + 每类白名单 */
export interface SceneTagConfig {
  categoryEnabled: { type: boolean; difficulty: boolean; source_type: boolean; custom: boolean };
  selectedValues: { type: string[]; difficulty: string[]; source_type: string[]; custom: string[] };
}

/** 标签显示配置（settings 表 key='ui.tagDisplay'） */
export interface TagDisplayConfig {
  scenes: Record<TagDisplayScene, SceneTagConfig>;
}
```

向后兼容：旧格式（v3 单场景 / v2 enabled+selectedTags / v1 hiddenValues）一律降级为默认（5 场景全开 + 全部白名单空）。

### 2. 工具函数（src/renderer/src/utils/tagDisplay.ts）

```ts
export const DEFAULT_SCENE_CONFIG: SceneTagConfig = {
  categoryEnabled: { type: true, difficulty: true, source_type: true, custom: true },
  selectedValues: { type: [], difficulty: [], source_type: [], custom: [] }
};

export const DEFAULT_TAG_DISPLAY_CONFIG: TagDisplayConfig = {
  scenes: {
    library:    { ...DEFAULT_SCENE_CONFIG, ... },
    drawResult: { ...DEFAULT_SCENE_CONFIG, ... },
    bigScreen:  { ...DEFAULT_SCENE_CONFIG, ... },  // 大屏默认仍开启全部，用户可关闭
    filter:     { ...DEFAULT_SCENE_CONFIG, ... },
    dedup:      { ...DEFAULT_SCENE_CONFIG, ... }
  }
};

export function loadTagDisplayConfig(settings): TagDisplayConfig
export function filterTag(config, value, category, scene): string | null
export function filterTags(config, tags, category, scene): string[]
```

- `filterTag` / `filterTags` 新增 `scene` 参数，从 `config.scenes[scene]` 取出该场景配置后再过滤
- 旧调用方需要补传 scene 参数

### 3. 配置弹窗（src/renderer/src/components/TagDisplaySettingsModal.tsx）

UI 结构：
```
[Alert 说明]
┌──────────────────────────────────────────┐
│ [Tab: 题库浏览][抽取结果][大屏投影][筛选][去重] │
├──────────────────────────────────────────┤
│ 当前 Tab：题库浏览                          │
│ ┌──────────────────────────────────────┐ │
│ │ 题型              共 N 个候选值 [Switch]│ │
│ │ [Select 多选] 不选=显示全部            │ │
│ ├──────────────────────────────────────┤ │
│ │ 难度              共 N 个候选值 [Switch]│ │
│ │ [Select 多选] 不选=显示全部            │ │
│ ├──────────────────────────────────────┤ │
│ │ 来源类型          共 N 个候选值 [Switch]│ │
│ │ [Select 多选] 不选=显示全部            │ │
│ ├──────────────────────────────────────┤ │
│ │ 自定义标签        共 N 个候选值 [Switch]│ │
│ │ [Select 多选] 不选=显示全部            │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
[恢复默认] [取消] [保存]
```

- 5 个 Tab 对应 5 个场景
- 每个 Tab 内容相同（4 类别区块）
- 候选值（题库汇总）所有 Tab 共用，避免重复请求
- "恢复默认" 重置当前 Tab 场景的配置（不重置其他 Tab）

### 4. 接入点调整（5 个场景）

| 文件 | 修改 |
|---|---|
| `src/renderer/src/components/TopicCard.tsx` 网格视图 | `filterTag(cfg, topic.type, 'type', 'library')` 等，加 scene='library' |
| `src/renderer/src/components/TopicCard.tsx` 列表视图 | 同上，scene='library' |
| `src/renderer/src/components/draw/DrawResultCard.tsx` | scene='drawResult' |
| `src/renderer/src/components/draw/BigScreen.tsx` | scene='bigScreen' |
| `src/renderer/src/components/FilterPanel.tsx` | scene='filter'，并扩展：维度候选 Select（type/difficulty/source_type）也应用配置（custom 已应用） |
| `src/renderer/src/components/DedupResultModal.tsx` | 新接入：scene='dedup'，对 source 文字显示走 filterTag('source_type')（注意：原代码用 source 字段，需评估是否改为 source_type 或新增 source 控制） |

### 5. DedupResultModal 特殊处理

当前代码（行 222）显示 `topic.source ?? '未知来源'`（如"新国辩"），不是 source_type。两个选择：
- **方案 A（推荐）**：保持显示 source 文字，但用 filterTag(config, topic.source_type, 'source_type', 'dedup') 决定整个来源区块是否显示。即：去重场景下若用户关闭 source_type 类别，则不显示来源文字。
- 方案 B：DedupResultModal 不显示 source_type，仅显示 source 文字，且 source 不受 tagDisplay 控制（保持原状）。

计划采用方案 A：用 source_type 类别开关控制 source 文字的显隐。

### 6. Settings 入口文案（src/renderer/src/pages/Settings.tsx）

调整为："按场景（题库浏览/抽取结果/大屏投影/筛选面板/去重检查）独立配置 4 类别（题型/难度/来源类型/自定义标签）开关与白名单。"

## File Structure

| 文件 | 责任 |
|---|---|
| `src/shared/types.ts` | 定义 TagDisplayScene / SceneTagConfig / TagDisplayConfig 类型 |
| `src/renderer/src/utils/tagDisplay.ts` | 配置加载 + filterTag/filterTags（带 scene 参数） |
| `src/renderer/src/utils/__tests__/tagDisplay.test.ts` | 单元测试（覆盖 5 场景 × 4 类别） |
| `src/renderer/src/components/TagDisplaySettingsModal.tsx` | 配置弹窗（5 Tab 切换场景） |
| `src/renderer/src/components/TopicCard.tsx` | 题库浏览（网格 + 列表），scene='library' |
| `src/renderer/src/components/draw/DrawResultCard.tsx` | 抽取结果卡片，scene='drawResult' |
| `src/renderer/src/components/draw/BigScreen.tsx` | 大屏投影，scene='bigScreen' |
| `src/renderer/src/components/FilterPanel.tsx` | 筛选面板（含维度候选），scene='filter' |
| `src/renderer/src/components/DedupResultModal.tsx` | 去重检查，scene='dedup'（新增接入） |
| `src/renderer/src/pages/Settings.tsx` | 配置入口文案 |

## Assumptions & Decisions

1. **5 个场景**：题库浏览（library）/ 抽取结果（drawResult）/ 大屏投影（bigScreen）/ 筛选面板（filter）/ 去重检查（dedup）
2. **4 个类别**：题型（type）/ 难度（difficulty）/ 来源类型（source_type）/ 自定义标签（custom），与现有保持一致
3. **场景间独立**：每个场景独立配置 4 类别开关 + 每类白名单，互不影响
4. **默认配置**：所有 5 个场景所有类别开启 + 白名单为空（显示全部）
5. **UI 形式**：Tab 切换场景，每个 Tab 内 4 类别区块（与当前 TagDisplaySettingsModal 内的区块结构一致）
6. **候选值共用**：所有场景共享同一份候选值（从题库汇总），避免每个场景重复拉取
7. **DedupResultModal 接入**：用 source_type 类别开关控制 source 文字显隐（方案 A）
8. **FilterPanel 扩展**：原仅 custom 类别应用配置，现在 type/difficulty/source_type 候选 Select 也按配置过滤（类别关时不显示该 Select，白名单非空只显示选中的候选）
9. **编辑弹窗 / 导入预览**：明确不应用配置（设计排除）
10. **向后兼容**：检测到任何旧格式字段 → 降级为默认（5 场景全开 + 全部白名单空）
11. **大屏默认**：默认开启全部（与之前一致），用户可手动关闭大屏的某些类别

## Verification

### 单元测试（src/renderer/src/utils/__tests__/tagDisplay.test.ts）
- 默认配置：5 场景全开 + 4 类别白名单空
- loadTagDisplayConfig：无配置 / 字符串 / 对象 / 损坏 JSON / 旧格式 v1/v2/v3 兼容 / 部分字段缺失
- filterTag：5 场景 × 4 类别 × 3 状态（类别关 / 白名单空 / 白名单非空）+ 空值
- filterTags：同上

### 类型检查
- `npm run typecheck` 通过

### 全量测试
- `npm test -- --run` 所有测试通过

### 端到端验证清单（手动）
1. 应用启动无错误
2. 题库管理页：默认所有标签显示
3. Settings → 题库管理 Tab → 标签显示配置 → 弹窗显示 5 个 Tab
4. 在"题库浏览"Tab 关闭"自定义标签" → 保存 → 题库页自定义标签消失，其他类别保留
5. 在"抽取结果"Tab 选择"题型=价值辩" → 保存 → 抽取结果卡片只显示"价值辩"题型标签，题库页不受影响
6. 在"大屏投影"Tab 关闭"难度" → 保存 → 大屏不显示难度标签，其他场景不受影响
7. 在"筛选面板"Tab 关闭"题型" → 保存 → 筛选面板"题型"Select 消失
8. 在"去重检查"Tab 关闭"来源类型" → 保存 → DedupResultModal 中 source 文字不显示
9. 切换 Tab 时各场景配置互不影响
10. 重启应用 → 配置持久化生效
11. 编辑弹窗（新增/编辑辩题）→ 所有字段正常显示和编辑，不受配置影响
12. 导入预览 → 显示全部字段，不受配置影响

## Implementation Tasks

### Task 1: 重写类型定义 + 工具函数 + 测试（TDD）
**文件**：
- 修改 `src/shared/types.ts`：新增 TagDisplayScene / SceneTagConfig，重写 TagDisplayConfig
- 重写 `src/renderer/src/utils/tagDisplay.ts`：DEFAULT_TAG_DISPLAY_CONFIG、loadTagDisplayConfig、filterTag（带 scene）、filterTags（带 scene）
- 重写 `src/renderer/src/utils/__tests__/tagDisplay.test.ts`：覆盖 5 场景 × 4 类别

### Task 2: 重写 TagDisplaySettingsModal 弹窗（5 Tab）
**文件**：
- 重写 `src/renderer/src/components/TagDisplaySettingsModal.tsx`：Tab 切换场景，每 Tab 内 4 类别区块

### Task 3: 调整 TopicCard 接入 scene='library'
**文件**：
- 修改 `src/renderer/src/components/TopicCard.tsx`：网格 + 列表视图调用加 scene='library'

### Task 4: 调整 DrawResultCard 接入 scene='drawResult'
**文件**：
- 修改 `src/renderer/src/components/draw/DrawResultCard.tsx`

### Task 5: 调整 BigScreen 接入 scene='bigScreen'
**文件**：
- 修改 `src/renderer/src/components/draw/BigScreen.tsx`

### Task 6: 调整 FilterPanel 接入 scene='filter' + 扩展维度候选
**文件**：
- 修改 `src/renderer/src/components/FilterPanel.tsx`：custom 类别 + type/difficulty/source_type 候选都按场景配置过滤

### Task 7: 新接入 DedupResultModal scene='dedup'
**文件**：
- 修改 `src/renderer/src/components/DedupResultModal.tsx`：用 filterTag(cfg, topic.source_type, 'source_type', 'dedup') 控制 source 文字显隐

### Task 8: 调整 Settings 页文案 + 最终验证
**文件**：
- 修改 `src/renderer/src/pages/Settings.tsx`：更新描述文案
- 运行 `npm run typecheck` + `npm test -- --run`
