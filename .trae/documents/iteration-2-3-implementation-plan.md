# 导入新值映射 + 题库分类与列表优化 — 实施计划

> **For agentic workers:** 本计划已与用户多轮确认。每个 Step 含完整代码片段与验证命令，按顺序执行即可。每完成 Step 立即勾选 `- [ ]` → `- [x]`。
>
> **配套设计**：[import-undo-and-category-optimization-revised-plan.md](./import-undo-and-category-optimization-revised-plan.md)
> **执行模式**：每迭代独立 commit，每迭代完成后跑 `npm run typecheck && npm test`
> **状态基线**：迭代1 已完成（preload+UI+IPC 闭环 + 修复 P0/P1 阻塞）；迭代2.1（types.ts）+ 迭代2.2（import-engine collectUnknownValues）已完成

---

## 总体目标

1. **迭代 2 剩余**：在导入预览页对新值（非系统候选值）做 keep/map/add 三种动作；map 改写 topics，add 持久化到 settings 表
2. **迭代 3**：分类树扩展为 8 维（含 source_type / status / tags / batch_id），全库计数，面包屑导航 + 重置筛选 + 跨页全选 + 批量操作改造

## 文件结构总览

**新增文件**：
- `src/main/ipc/system.ipc.ts`（已存在，扩展 SYSTEM_GET_CANDIDATES）
- `src/renderer/src/components/import/ValueMappingPanel.tsx` — 新值映射面板
- `src/renderer/src/utils/valueMapping.ts` — 映射应用工具
- `src/renderer/src/utils/__tests__/valueMapping.test.ts`
- `src/renderer/src/stores/__tests__/topicStore.test.ts`

**修改文件**：
- `src/preload/index.ts` + `src/preload/index.d.ts` — 扩展 settingsAPI.getCandidates / topicAPI.listAllTags
- `src/main/db/repository/topic.repo.ts` — 新增 listAllTags + buildWhereClause 支持 `__unset__`
- `src/main/ipc/topic.ipc.ts` — 注册 TOPIC_LIST_ALL_TAGS
- `src/main/ipc/import.ipc.ts` — 处理 valueMapping.add
- `src/renderer/src/components/ImportTopicsModal.tsx` — 集成 ValueMappingPanel
- `src/renderer/src/stores/topicStore.ts` — 跨页全选 state + 方法
- `src/renderer/src/components/TopicCard.tsx` — 使用 store.isSelected
- `src/renderer/src/pages/TopicLibrary.tsx` — 8 维分类树 + 面包屑 + 重置 + Alert + 批量改造
- `src/shared/types.ts` — IPC_CHANNELS 加 TOPIC_LIST_ALL_TAGS

---

## 迭代 2 剩余 — 新值映射（7 个任务）

### Task 2.3: SYSTEM_GET_CANDIDATES IPC

**Files:**
- Modify: `src/main/ipc/system.ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**说明**：`SYSTEM_GET_CANDIDATES: 'system:getCandidates'` 已在 `src/shared/types.ts` 的 IPC_CHANNELS 中定义；`candidate-service.ts` 已实现 `getMergedCandidates()`。

- [ ] **Step 1: 在 system.ipc.ts 注册 SYSTEM_GET_CANDIDATES handler**

修改 `src/main/ipc/system.ipc.ts`，在 `registerSystemIpc` 内追加：

```typescript
import { getMergedCandidates } from '../services/candidate-service'
import type { CandidateField } from '../../shared/constants'

// 在 registerSystemIpc 函数内 SYSTEM_PICK_FILE handler 之后追加：
ipcMain.handle(
  IPC_CHANNELS.SYSTEM_GET_CANDIDATES,
  (): Record<CandidateField, string[]> => {
    return getMergedCandidates()
  }
)
```

- [ ] **Step 2: preload/index.ts settingsAPI 加 getCandidates**

修改 `src/preload/index.ts` 的 `settingsAPI` 对象，追加：

```typescript
const settingsAPI = {
  get: (key: string) => invoke(IPC_CHANNELS.SETTINGS_GET, key),
  set: (key: string, value: unknown) => invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  getAll: () => invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
  delete: (key: string) => invoke(IPC_CHANNELS.SETTINGS_DELETE, key),
  getCandidates: () =>
    invoke<Record<string, string[]>>(IPC_CHANNELS.SYSTEM_GET_CANDIDATES)
}
```

- [ ] **Step 3: preload/index.d.ts SettingsAPI 接口同步**

修改 `src/preload/index.d.ts`，在 `SettingsAPI` 接口追加：

```typescript
getCandidates: () => Promise<ApiResponse<Record<string, string[]>>>
```

- [ ] **Step 4: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 2.4: 新建 ValueMappingPanel.tsx

**Files:**
- Create: `src/renderer/src/components/import/ValueMappingPanel.tsx`

- [ ] **Step 1: 创建文件骨架 + Props 接口**

```typescript
// src/renderer/src/components/import/ValueMappingPanel.tsx
import { useState, useMemo } from 'react'
import { Card, Tag, Select, Space, Button, Typography, Divider, Alert } from 'antd'
import { SwapOutlined, PlusCircleOutlined, MinusCircleOutlined } from '@ant-design/icons'
import type {
  UnknownValueItem,
  ValueMapping,
  ValueMappingAction,
  ValueMappingRule,
  CandidateField
} from '../../../../shared/types'

const { Text, Title } = Typography

/** 字段中文标签（与 import-engine FIELD_LABEL 保持一致） */
const FIELD_LABEL: Record<CandidateField, string> = {
  type: '类型',
  domain: '领域',
  difficulty: '难度',
  source: '来源',
  source_type: '来源类型'
}

export interface ValueMappingPanelProps {
  /** 解析检测到的新值 */
  unknownValues: UnknownValueItem[]
  /** 当前合并后的候选值（系统候选 + 用户扩展） */
  candidateOptions: Record<CandidateField, string[]>
  /** 初始 mapping（一般空对象） */
  initialMapping?: ValueMapping
  /** mapping 变化回调 */
  onMappingChange: (mapping: ValueMapping) => void
}

export default function ValueMappingPanel({
  unknownValues,
  candidateOptions,
  initialMapping = {},
  onMappingChange
}: ValueMappingPanelProps) {
  const [mapping, setMapping] = useState<ValueMapping>(initialMapping)

  // 计算总览
  const totalValues = useMemo(
    () => unknownValues.reduce((sum, item) => sum + item.values.length, 0),
    [unknownValues]
  )
  const mappedCount = useMemo(() => {
    let count = 0
    for (const field of Object.keys(mapping) as CandidateField[]) {
      const valueMap = mapping[field]
      if (!valueMap) continue
      for (const origin of Object.keys(valueMap)) {
        if (valueMap[origin]?.action !== 'keep') count++
      }
    }
    return count
  }, [mapping])

  // 内部更新 + 回调
  const updateMapping = (next: ValueMapping) => {
    setMapping(next)
    onMappingChange(next)
  }

  const handleActionChange = (
    field: CandidateField,
    originValue: string,
    action: ValueMappingAction
  ) => {
    const next: ValueMapping = { ...mapping }
    if (!next[field]) next[field] = {}
    const rule: ValueMappingRule = { action }
    if (action === 'map') {
      // 默认 target 设为该字段第一个候选值（用户可改）
      rule.target = candidateOptions[field][0] ?? ''
    }
    next[field]![originValue] = rule
    updateMapping(next)
  }

  const handleMapTargetChange = (
    field: CandidateField,
    originValue: string,
    target: string
  ) => {
    const next: ValueMapping = { ...mapping }
    if (!next[field]) next[field] = {}
    next[field]![originValue] = { action: 'map', target }
    updateMapping(next)
  }

  // 批量操作
  const handleAllKeep = () => updateMapping({})
  const handleAllAdd = () => {
    const next: ValueMapping = {}
    for (const item of unknownValues) {
      next[item.field] = {}
      for (const { value } of item.values) {
        next[item.field]![value] = { action: 'add' }
      }
    }
    updateMapping(next)
  }

  if (unknownValues.length === 0) return null

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space style={{ marginBottom: 8, justifyContent: 'space-between', width: '100%' }}>
        <Title level={5} style={{ margin: 0 }}>
          <SwapOutlined style={{ marginRight: 6, color: '#faad14' }} />
          新值映射
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {unknownValues.length} 个字段 / {totalValues} 个新值，已处理 {mappedCount} 个
        </Text>
      </Space>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 8, fontSize: 12 }}
        message="导入文件中存在部分字段值不在系统候选内（如新赛事、新难度），可在导入前批量处理："
        description={
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            <li><b>保留</b>：原样入库（后续在筛选面板可能选不到该值）</li>
            <li><b>映射到...</b>：改写为已有候选值（如把"入门"改为"入门级"）</li>
            <li><b>加入候选</b>：原样入库 + 永久加入系统候选（重启后仍可用）</li>
          </ul>
        }
      />
      {unknownValues.map((item) => (
        <div key={item.field} style={{ marginBottom: 8 }}>
          <Divider style={{ margin: '8px 0' }} orientation="left" plain>
            <Text strong style={{ fontSize: 13 }}>
              {FIELD_LABEL[item.field]}（{item.values.length} 个新值）
            </Text>
          </Divider>
          {item.values.map(({ value, count }) => {
            const rule = mapping[item.field]?.[value]
            const action = rule?.action ?? 'keep'
            return (
              <div
                key={`${item.field}-${value}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 4,
                  padding: '4px 8px',
                  background: '#fafafa',
                  borderRadius: 4
                }}
              >
                <Tag color="orange" style={{ minWidth: 80, textAlign: 'center' }}>
                  {value}
                </Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>×{count}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>→</Text>
                <Select
                  size="small"
                  style={{ width: 110 }}
                  value={action}
                  onChange={(v) => handleActionChange(item.field, value, v)}
                  options={[
                    { value: 'keep', label: '保留' },
                    { value: 'map', label: '映射到...' },
                    { value: 'add', label: '加入候选' }
                  ]}
                />
                {action === 'map' && (
                  <Select
                    size="small"
                    style={{ width: 130 }}
                    value={rule?.target ?? ''}
                    onChange={(v) => handleMapTargetChange(item.field, value, v)}
                    options={candidateOptions[item.field].map((c) => ({
                      value: c,
                      label: c
                    }))}
                    showSearch
                  />
                )}
              </div>
            )
          })}
        </div>
      ))}
      <Divider style={{ margin: '8px 0' }} />
      <Space>
        <Button size="small" icon={<MinusCircleOutlined />} onClick={handleAllKeep}>
          全部保留
        </Button>
        <Button size="small" icon={<PlusCircleOutlined />} onClick={handleAllAdd}>
          全部加入候选
        </Button>
      </Space>
    </Card>
  )
}
```

- [ ] **Step 2: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 2.5: 新建 utils/valueMapping.ts

**Files:**
- Create: `src/renderer/src/utils/valueMapping.ts`
- Create: `src/renderer/src/utils/__tests__/valueMapping.test.ts`

- [ ] **Step 1: 实现 valueMapping.ts**

```typescript
// src/renderer/src/utils/valueMapping.ts
import type {
  TopicCreateInput,
  ValueMapping,
  CandidateField
} from '../../../shared/types'

/**
 * 对单条 topic 应用映射：action='map' 时把 field 值改写为 target。
 * keep/add 不改写（add 由主进程持久化）。
 */
export function applyMapping(
  topic: TopicCreateInput,
  mapping: ValueMapping
): TopicCreateInput {
  if (!mapping || Object.keys(mapping).length === 0) return topic
  const result = { ...topic }
  for (const field of Object.keys(mapping) as CandidateField[]) {
    const valueMap = mapping[field]
    if (!valueMap) continue
    const current = (result as any)[field] as string | null | undefined
    if (!current) continue
    const rule = valueMap[current]
    if (rule?.action === 'map' && rule.target) {
      ;(result as any)[field] = rule.target
    }
  }
  return result
}

/** 批量应用映射；空 mapping 直接返回原数组 */
export function applyMappingToTopics(
  topics: TopicCreateInput[],
  mapping: ValueMapping
): TopicCreateInput[] {
  if (!mapping || Object.keys(mapping).length === 0) return topics
  return topics.map((t) => applyMapping(t, mapping))
}

/**
 * 校验映射完整性：所有 action='map' 必须有 target 且非空。
 * 返回 { valid, invalidFields }
 */
export function isMappingValid(mapping: ValueMapping): {
  valid: boolean
  invalidFields: Array<{ field: CandidateField; value: string }>
} {
  const invalidFields: Array<{ field: CandidateField; value: string }> = []
  for (const field of Object.keys(mapping) as CandidateField[]) {
    const valueMap = mapping[field]
    if (!valueMap) continue
    for (const value of Object.keys(valueMap)) {
      const rule = valueMap[value]
      if (rule?.action === 'map' && !rule.target) {
        invalidFields.push({ field, value })
      }
    }
  }
  return { valid: invalidFields.length === 0, invalidFields }
}
```

- [ ] **Step 2: 新建测试文件**

```typescript
// src/renderer/src/utils/__tests__/valueMapping.test.ts
import { describe, it, expect } from 'vitest'
import { applyMapping, applyMappingToTopics, isMappingValid } from '../valueMapping'
import type { TopicCreateInput, ValueMapping } from '../../../../shared/types'

const makeTopic = (overrides: Partial<TopicCreateInput> = {}): TopicCreateInput => ({
  title: 'test',
  type: null,
  domain: null,
  difficulty: null,
  source: null,
  source_type: '自定义',
  tags: null,
  ...overrides
})

describe('applyMapping', () => {
  it('空 mapping 返回原 topic', () => {
    const t = makeTopic({ difficulty: '入门' })
    expect(applyMapping(t, {})).toEqual(t)
  })

  it('map 动作改写字段值', () => {
    const t = makeTopic({ difficulty: '入门' })
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map', target: '入门级' } }
    }
    expect(applyMapping(t, mapping).difficulty).toBe('入门级')
  })

  it('keep 动作不改写', () => {
    const t = makeTopic({ difficulty: '入门' })
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'keep' } }
    }
    expect(applyMapping(t, mapping).difficulty).toBe('入门')
  })

  it('add 动作不改写（主进程负责持久化）', () => {
    const t = makeTopic({ type: '哲思辩' })
    const mapping: ValueMapping = {
      type: { 哲思辩: { action: 'add' } }
    }
    expect(applyMapping(t, mapping).type).toBe('哲思辩')
  })

  it('未匹配的字段值保持原值', () => {
    const t = makeTopic({ difficulty: '专业级' })
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map', target: '入门级' } }
    }
    expect(applyMapping(t, mapping).difficulty).toBe('专业级')
  })

  it('null 字段不报错', () => {
    const t = makeTopic({ difficulty: null })
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map', target: '入门级' } }
    }
    expect(applyMapping(t, mapping).difficulty).toBeNull()
  })
})

describe('applyMappingToTopics', () => {
  it('批量应用', () => {
    const topics = [
      makeTopic({ difficulty: '入门' }),
      makeTopic({ difficulty: '进阶' }),
      makeTopic({ difficulty: '入门级' })
    ]
    const mapping: ValueMapping = {
      difficulty: {
        入门: { action: 'map', target: '入门级' },
        进阶: { action: 'map', target: '进阶级' }
      }
    }
    const result = applyMappingToTopics(topics, mapping)
    expect(result[0].difficulty).toBe('入门级')
    expect(result[1].difficulty).toBe('进阶级')
    expect(result[2].difficulty).toBe('入门级')
  })

  it('空 mapping 返回原数组引用', () => {
    const topics = [makeTopic()]
    expect(applyMappingToTopics(topics, {})).toBe(topics)
  })
})

describe('isMappingValid', () => {
  it('空 mapping 有效', () => {
    expect(isMappingValid({}).valid).toBe(true)
  })

  it('所有 map 都有 target 时有效', () => {
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map', target: '入门级' } }
    }
    expect(isMappingValid(mapping).valid).toBe(true)
  })

  it('map 缺失 target 无效', () => {
    const mapping: ValueMapping = {
      difficulty: { 入门: { action: 'map' } }
    }
    const result = isMappingValid(mapping)
    expect(result.valid).toBe(false)
    expect(result.invalidFields).toHaveLength(1)
    expect(result.invalidFields[0]).toEqual({ field: 'difficulty', value: '入门' })
  })

  it('keep/add 不影响有效性', () => {
    const mapping: ValueMapping = {
      type: { 新类型: { action: 'add' } },
      difficulty: { 入门: { action: 'keep' } }
    }
    expect(isMappingValid(mapping).valid).toBe(true)
  })
})
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npm test -- valueMapping`
Expected: PASS（11 个测试全通过）

- [ ] **Step 4: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 2.6: ImportTopicsModal 集成 ValueMappingPanel

**Files:**
- Modify: `src/renderer/src/components/ImportTopicsModal.tsx`

- [ ] **Step 1: 顶部新增 import**

在 `ImportTopicsModal.tsx` 顶部 import 区追加：

```typescript
import { useEffect, useState } from 'react';  // 已有 useState，需追加 useEffect
import ValueMappingPanel from './import/ValueMappingPanel';
import { applyMappingToTopics, isMappingValid } from '../utils/valueMapping';
import type {
  ParsedResult,
  TopicCreateInput,
  ImportExecuteResult,
  ValueMapping,
  CandidateField
} from '../../../shared/types';
```

注意：原文件第 1 行 `import { useState } from 'react';` 改为 `import { useState, useEffect } from 'react';`。

- [ ] **Step 2: 新增 state**

在组件内（已有 `parsed` / `importing` state 后）追加：

```typescript
const [valueMapping, setValueMapping] = useState<ValueMapping>({});
const [mergedCandidates, setMergedCandidates] = useState<Record<CandidateField, string[]> | null>(null);
```

- [ ] **Step 3: open 时拉取候选值**

新增 useEffect：

```typescript
useEffect(() => {
  if (!open) return;
  window.settingsAPI.getCandidates().then((res) => {
    if (res.success && res.data) {
      setMergedCandidates(res.data as Record<CandidateField, string[]>);
    }
  });
}, [open]);
```

- [ ] **Step 4: reset 时清空 valueMapping**

在 `reset` 函数内追加 `setValueMapping({});`：

```typescript
const reset = () => {
  setStep(0);
  setFilePath(null);
  setFileType(null);
  setParsed(null);
  setImportResult(null);
  setParsing(false);
  setImporting(false);
  setValueMapping({});
};
```

- [ ] **Step 5: Step 2 预览页条件渲染 ValueMappingPanel**

在 `case 2:` 内、`parsed.warnings.length > 0 &&` Alert 之后、`parsed.topics.length === 0 ?` 之前，插入：

```typescript
{parsed.unknownValues &&
  parsed.unknownValues.length > 0 &&
  mergedCandidates && (
    <ValueMappingPanel
      unknownValues={parsed.unknownValues}
      candidateOptions={mergedCandidates}
      onMappingChange={(m) => setValueMapping(m)}
    />
  )}
```

- [ ] **Step 6: handleImport 应用映射 + 传 valueMapping**

修改 `handleImport` 函数。在 `if (!parsed || parsed.topics.length === 0) return;` 之后、调用 `execute` 之前，插入校验与映射应用：

```typescript
const handleImport = async () => {
  if (!parsed || parsed.topics.length === 0) return;
  // 校验映射
  const { valid, invalidFields } = isMappingValid(valueMapping);
  if (!valid) {
    const desc = invalidFields
      .map((f) => `${f.field}: "${f.value}" 未选择目标值`)
      .join('；');
    messageApi.error(`映射不完整：${desc}`);
    return;
  }
  setImporting(true);
  try {
    const currentFileName = filePath ? filePath.split(/[\\/]/).pop() : '';
    const finalTopics = applyMappingToTopics(parsed.topics, valueMapping);
    const res = await window.importAPI.execute({
      topics: finalTopics,
      checkDuplicates: true,
      fileName: currentFileName,
      valueMapping
    });
    // ...其余逻辑保持不变
```

注意：原 `const res = await window.importAPI.execute({ topics: parsed.topics, ... })` 改为使用 `finalTopics` 并追加 `valueMapping` 字段。

- [ ] **Step 7: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 2.7: import.ipc.ts 处理 add 动作

**Files:**
- Modify: `src/main/ipc/import.ipc.ts`

- [ ] **Step 1: import addCandidateValue + CandidateField**

在 `import.ipc.ts` 顶部 import 区追加：

```typescript
import { addCandidateValue } from '../services/candidate-service'
import type { CandidateField } from '../../shared/constants'
```

- [ ] **Step 2: 在 createBatch 之后、createMany 之前处理 valueMapping.add**

修改 `IMPORT_EXECUTE` handler。在第 65 行 `const batch = importBatchRepo.createBatch(...)` 之后、第 74 行 `const { items: existing } = ...` 之前，插入：

```typescript
// 处理 valueMapping.add：永久加入候选值（渲染进程已应用 map 改写 topics）
if (req.valueMapping) {
  for (const field of Object.keys(req.valueMapping) as CandidateField[]) {
    const valueMap = req.valueMapping[field]
    if (!valueMap) continue
    for (const originValue of Object.keys(valueMap)) {
      const rule = valueMap[originValue]
      if (rule?.action === 'add') {
        try {
          addCandidateValue(field, originValue)
        } catch (e) {
          console.error(
            `[import.ipc] addCandidateValue failed for ${field}/${originValue}:`,
            e
          )
          // 不影响主流程
        }
      }
    }
  }
}
```

- [ ] **Step 3: 修改解构提取 valueMapping**

原第 58 行 `const { topics, checkDuplicates = true, fileName } = req` 改为：

```typescript
const { topics, checkDuplicates = true, fileName, valueMapping } = req
```

并在 Step 2 的代码块中直接使用 `valueMapping` 替代 `req.valueMapping`：

```typescript
if (valueMapping) {
  for (const field of Object.keys(valueMapping) as CandidateField[]) {
    const valueMap = valueMapping[field]
    if (!valueMap) continue
    for (const originValue of Object.keys(valueMap)) {
      const rule = valueMap[originValue]
      if (rule?.action === 'add') {
        try {
          addCandidateValue(field, originValue)
        } catch (e) {
          console.error(`[import.ipc] addCandidateValue failed for ${field}/${originValue}:`, e)
        }
      }
    }
  }
}
```

- [ ] **Step 4: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 2.8: 迭代 2 验证清单

- [ ] **Step 1: typecheck + test**

Run: `npm run typecheck && npm test`
Expected: PASS（测试数应 +11，新增 valueMapping 测试）

- [ ] **Step 2: 启动 dev 验证**

Run: `npm run dev`
Expected: 应用正常启动，DB 初始化、IPC 注册、官方题库加载均成功

- [ ] **Step 3: 端到端手动验证（8 个场景）**

1. 构造含新值的 xlsx（如 difficulty 列填 "入门"/"进阶"/"专家"）→ 预览页显示 ValueMappingPanel
2. 测试 keep 动作 → 入库后 difficulty 字段保持原值
3. 测试 map 动作（"入门" → "入门级"）→ 入库后 difficulty 为 "入门级"
4. 测试 add 动作 → 入库后该值出现在系统候选
5. 重启应用 → settings 表持久化的候选值仍可用（在 FilterPanel 中能选到）
6. 测试 isMappingValid 拦截：选 "映射到..." 但不清空 target，应正常入库；选 map 后清空 target 应被拦截
7. 测试「全部保留」按钮 → mapping 清空
8. 测试「全部加入候选」按钮 → 所有新值标记为 add

---

### Task 2.9: 迭代 2 Commit

- [ ] **Step 1: git add + commit**

```bash
git add src/main/ipc/system.ipc.ts src/main/ipc/import.ipc.ts src/preload/ src/renderer/src/components/import/ src/renderer/src/components/ImportTopicsModal.tsx src/renderer/src/utils/valueMapping.ts src/renderer/src/utils/__tests__/valueMapping.test.ts
git commit -m "feat(import): add value mapping for unknown candidates on import"
```

---

## 迭代 3 — 分类与列表优化（11 个任务）

### Task 3.1: topic.repo.ts 改造（listAllTags + __unset__）

**Files:**
- Modify: `src/main/db/repository/topic.repo.ts`
- Modify: `src/main/db/repository/__tests__/topic.repo.test.ts`

- [ ] **Step 1: 新增 listAllTags 函数**

在 `src/main/db/repository/topic.repo.ts` 的 `countByDimension` 函数之后、`export const topicRepo` 之前，追加：

```typescript
/**
 * 聚合所有 status='active' 且 tags 非空的主题标签。
 * 返回 [{ value, count }]，按 count 降序。
 *
 * 实现：SQL 拉取 tags JSON 字符串，JS 层 JSON.parse + 计数。
 * 损坏的 JSON 跳过（不影响整体聚合）。
 */
function listAllTags(): Array<{ value: string; count: number }> {
  const db = getDb()
  const rows = db
    .prepare(`SELECT tags FROM topics WHERE status = 'active' AND tags IS NOT NULL`)
    .all() as Array<{ tags: string }>

  const counter = new Map<string, number>()
  for (const row of rows) {
    try {
      const tags = JSON.parse(row.tags) as unknown
      if (!Array.isArray(tags)) continue
      for (const tag of tags) {
        if (typeof tag !== 'string') continue
        counter.set(tag, (counter.get(tag) ?? 0) + 1)
      }
    } catch {
      // 损坏 JSON 跳过
    }
  }

  return Array.from(counter.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
}
```

- [ ] **Step 2: export 加入 listAllTags**

修改 `export const topicRepo = { ... }` 对象，在 `countByDimension` 之后追加 `listAllTags`：

```typescript
export const topicRepo = {
  createTopic,
  createMany,
  getTopicById,
  listTopics,
  updateTopic,
  deleteTopic,
  batchDeleteTopics,
  deleteByBatch,
  updateStatus,
  updateWeight,
  countByFilter,
  countByDimension,
  listAllTags
}
```

- [ ] **Step 3: buildWhereClause 支持 `__unset__` 翻译为 IS NULL**

修改 `buildWhereClause` 函数中 `scalarFields` 循环（约 L138-148），在 `const value = filter[key]` 之后、`conditions.push` 之前插入 `__unset__` 分支：

```typescript
for (const { key, column } of scalarFields) {
  if (column === 'type' && filter.types?.length) continue
  if (column === 'domain' && filter.domains?.length) continue
  if (column === 'difficulty' && filter.difficulties?.length) continue
  const value = filter[key]
  if (value !== undefined) {
    if (value === '__unset__') {
      conditions.push(`${column} IS NULL`)
    } else {
      conditions.push(`${column} = ?`)
      params.push(value)
    }
  }
}
```

- [ ] **Step 4: 单元测试**

在 `src/main/db/repository/__tests__/topic.repo.test.ts` 追加测试（如文件不存在则新建）。需先了解现有测试模式，参考文件确认 mock 结构后追加：

```typescript
describe('listAllTags', () => {
  it('聚合所有 active 主题的标签，按 count 降序', () => {
    // 准备：插入 3 条 topic
    topicRepo.createTopic({ title: 't1', tags: ['A', 'B'], source_type: '自定义' })
    topicRepo.createTopic({ title: 't2', tags: ['A', 'C'], source_type: '自定义' })
    topicRepo.createTopic({ title: 't3', tags: ['A'], source_type: '自定义' })

    const result = topicRepo.listAllTags()
    const aCount = result.find((r) => r.value === 'A')?.count
    const bCount = result.find((r) => r.value === 'B')?.count
    expect(aCount).toBe(3)
    expect(bCount).toBe(1)
    // 降序：A 应在 B 之前
    expect(result.findIndex((r) => r.value === 'A')).toBeLessThan(
      result.findIndex((r) => r.value === 'B')
    )
  })

  it('损坏的 JSON 被跳过不抛错', () => {
    // 直接 raw insert 一条损坏 JSON
    const db = getDb()
    db.prepare(
      `INSERT INTO topics (id, title, tags, weight, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('bad-id', 'bad', '{not json', 1.0, 'active', new Date().toISOString(), new Date().toISOString())
    expect(() => topicRepo.listAllTags()).not.toThrow()
  })
})

describe('buildWhereClause __unset__', () => {
  it('__unset__ 翻译为 IS NULL', () => {
    // 通过 listTopics 验证：filter.difficulty = '__unset__' 应返回 difficulty IS NULL 的题
    const { items } = topicRepo.listTopics({ difficulty: '__unset__' })
    expect(items.every((t) => t.difficulty === null)).toBe(true)
  })

  it('正常值仍走 = ? 路径', () => {
    const topic = topicRepo.createTopic({
      title: 'with-diff',
      difficulty: '入门级',
      source_type: '自定义'
    })
    const { items } = topicRepo.listTopics({ difficulty: '入门级' })
    expect(items.some((t) => t.id === topic.id)).toBe(true)
  })
})
```

注意：测试文件的具体 import 与 mock 结构需先读现有文件确认。

- [ ] **Step 5: typecheck + test 验证**

Run: `npm run typecheck && npm test`
Expected: PASS

---

### Task 3.2: TOPIC_LIST_ALL_TAGS IPC

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/ipc/topic.ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: shared/types.ts IPC_CHANNELS 加 TOPIC_LIST_ALL_TAGS**

在 `src/shared/types.ts` 的 `IPC_CHANNELS` 对象中，`TOPIC_COUNT_BY_DIMENSION` 之后追加：

```typescript
TOPIC_LIST_ALL_TAGS: 'topic:listAllTags',
```

- [ ] **Step 2: topic.ipc.ts 注册 handler**

在 `src/main/ipc/topic.ipc.ts` 的 `registerTopicIpc` 函数末尾追加：

```typescript
ipcMain.handle(IPC_CHANNELS.TOPIC_LIST_ALL_TAGS, () =>
  wrap(() => topicRepo.listAllTags())
)
```

- [ ] **Step 3: preload/index.ts topicAPI 加 listAllTags**

修改 `src/preload/index.ts` 的 `topicAPI` 对象，在 `countByDimension` 之后追加：

```typescript
listAllTags: () =>
  invoke<Array<{ value: string; count: number }>>(IPC_CHANNELS.TOPIC_LIST_ALL_TAGS)
```

- [ ] **Step 4: preload/index.d.ts TopicAPI 接口同步**

修改 `src/preload/index.d.ts` 的 `TopicAPI` 接口，在 `countByDimension` 之后追加：

```typescript
listAllTags: () => Promise<ApiResponse<Array<{ value: string; count: number }>>>
```

- [ ] **Step 5: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 3.3: TopicLibrary 8 维分类树

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

**说明**：当前 `DIMENSIONS` 只有 4 维（type/domain/difficulty/source），分类计数仅基于当前页（不准确）。改造后扩为 8 维（含 source_type/status/tags/batch_id），全库计数通过 IPC 拉取。

- [ ] **Step 1: 类型与常量定义**

在 `TopicLibrary.tsx` 顶部 import 区追加：

```typescript
import { Breadcrumb } from 'antd';
import type { BreadcrumbProps } from 'antd';
import {
  // ...原有 icons
  FieldTimeOutlined,
  NumberOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import type { CandidateField } from '../../../shared/constants';
import type { ImportBatch } from '../../../shared/types';
```

替换 `DIMENSIONS` 常量：

```typescript
interface DimensionMeta {
  key: DimensionKey
  label: string
  icon: React.ReactNode
  /** 数据来源 */
  source:
    | 'system'        // 走 countByDimension IPC（type/domain/difficulty/source/source_type/status/batch_id）
    | 'ipc_tags'      // 走 listAllTags IPC
    | 'ipc_batches'   // 走 listBatches IPC
}

type DimensionKey =
  | 'type'
  | 'domain'
  | 'difficulty'
  | 'source'
  | 'source_type'
  | 'status'
  | 'tags'
  | 'batch_id'

const DIMENSIONS: DimensionMeta[] = [
  { key: 'type', label: '类型', icon: <TagOutlined />, source: 'system' },
  { key: 'domain', label: '领域', icon: <GlobalOutlined />, source: 'system' },
  { key: 'difficulty', label: '难度', icon: <FireOutlined />, source: 'system' },
  { key: 'source', label: '来源', icon: <DatabaseOutlined />, source: 'system' },
  { key: 'source_type', label: '来源类型', icon: <SafetyCertificateOutlined />, source: 'system' },
  { key: 'status', label: '状态', icon: <CheckCircleOutlined />, source: 'system' },
  { key: 'tags', label: '标签', icon: <NumberOutlined />, source: 'ipc_tags' },
  { key: 'batch_id', label: '导入批次', icon: <FileTextOutlined />, source: 'ipc_batches' }
]
```

- [ ] **Step 2: dimensionData state**

在组件内 `selectedCategory` state 之后追加：

```typescript
const [dimensionData, setDimensionData] = useState<Array<{ value: string; count: number }>>([])
const [dimensionLoading, setDimensionLoading] = useState(false)
```

- [ ] **Step 3: useEffect 维度数据加载**

在已有的 `useEffect` 依赖 dimension 变化的逻辑之后，新增一个 useEffect：

```typescript
useEffect(() => {
  const meta = DIMENSIONS.find((d) => d.key === dimension)!
  setDimensionLoading(true)
  ;(async () => {
    try {
      if (meta.source === 'system') {
        const res = await window.topicAPI.countByDimension(dimension as any)
        if (res.success && res.data) {
          // 将 NULL 值的 '(未设置)' 翻译为 '__unset__'，便于 setFilter 时识别
          setDimensionData(
            res.data.map((item) => ({
              value: item.value === '(未设置)' ? '__unset__' : item.value,
              count: item.count
            }))
          )
        }
      } else if (meta.source === 'ipc_tags') {
        const res = await window.topicAPI.listAllTags()
        if (res.success && res.data) {
          setDimensionData(res.data)
        }
      } else if (meta.source === 'ipc_batches') {
        const res = await window.importAPI.listBatches()
        if (res.success && res.data) {
          // 处理同名批次加后缀
          const nameCount = new Map<string, number>()
          const result: Array<{ value: string; count: number }> = []
          for (const b of res.data) {
            const baseName = b.file_name || '(未命名)'
            const seen = nameCount.get(baseName) ?? 0
            nameCount.set(baseName, seen + 1)
            const displayName = seen === 0 ? baseName : `${baseName} (${seen + 1})`
            result.push({ value: b.id, count: b.remainingCount ?? 0 })
            // 用 displayName 单独存储，避免 id 暴露
            ;(result[result.length - 1] as any).label = displayName
          }
          setDimensionData(result)
        }
      }
    } catch (e) {
      console.error('[TopicLibrary] load dimension data failed:', e)
      setDimensionData([])
    } finally {
      setDimensionLoading(false)
    }
  })()
}, [dimension])
```

- [ ] **Step 4: treeData 渲染改造**

替换原 `treeData` useMemo：

```typescript
const treeData: DataNode[] = useMemo(() => {
  const meta = DIMENSIONS.find((d) => d.key === dimension)!
  const totalCount = dimensionData.reduce((sum, item) => sum + item.count, 0)
  return [
    {
      key: '__all__',
      title: '__all__'
    },
    ...dimensionData.map((item) => ({
      key: item.value,
      title: meta.source === 'ipc_batches' ? (item as any).label : item.value,
      isLeaf: true
    }))
  ]
}, [dimension, dimensionData])
```

- [ ] **Step 5: renderTreeNode 改造**

替换原 `renderTreeNode` 函数：

```typescript
const renderTreeNode = (node: DataNode) => {
  const meta = DIMENSIONS.find((d) => d.key === dimension)!
  const key = String(node.key)
  if (key === '__all__') {
    const totalCount = dimensionData.reduce((sum, item) => sum + item.count, 0)
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <FolderOutlined style={{ color: token.colorPrimary }} />
        <span style={{ fontWeight: 500 }}>全部</span>
        <Badge
          count={totalCount}
          showZero
          color={token.colorPrimary}
          overflowCount={9999}
          style={{ marginLeft: 4 }}
        />
      </span>
    )
  }
  const item = dimensionData.find((d) => d.value === key)
  const count = item?.count ?? 0
  const label =
    meta.source === 'ipc_batches' ? (item as any)?.label : key === '__unset__' ? '(未设置)' : key
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>{meta.icon}</span>
      <span>{label}</span>
      <Badge
        count={count}
        showZero
        overflowCount={9999}
        style={{
          marginLeft: 4,
          backgroundColor: count > 0 ? token.colorPrimaryBg : '#f0f0f0',
          color: count > 0 ? token.colorPrimary : token.colorTextSecondary,
          boxShadow: 'none'
        }}
      />
    </span>
  )
}
```

- [ ] **Step 6: 节点点击 setFilter（含 __unset__ 与 tags 特殊处理）**

替换原 `useEffect(() => { ... }, [selectedCategory, dimension])`：

```typescript
useEffect(() => {
  if (selectedCategory === '__all__') {
    store.setFilter({ [dimension]: undefined } as any)
  } else if (selectedCategory === '__unset__') {
    // __unset__ 在 buildWhereClause 中翻译为 IS NULL
    store.setFilter({ [dimension]: '__unset__' } as any)
  } else if (dimension === 'tags') {
    // tags 维度特殊：单值数组
    store.setFilter({ tags: [selectedCategory] } as any)
  } else {
    store.setFilter({ [dimension]: selectedCategory } as any)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedCategory, dimension])
```

- [ ] **Step 7: 移除原 FilterPanel 静态 options 依赖**

原 `DIMENSIONS` 中的 `options: TYPE_OPTIONS` 字段已被新结构替代，FilterPanel import 中的 `TYPE_OPTIONS` 等保留（FilterPanel 自身仍需要），但 TopicLibrary 不再使用。无需删除 import。

- [ ] **Step 8: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 3.4: 面包屑导航

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

- [ ] **Step 1: 新增 breadcrumbItems useMemo**

在 `dimensionData` state 之后追加：

```typescript
const breadcrumbItems: BreadcrumbProps['items'] = useMemo(() => {
  const meta = DIMENSIONS.find((d) => d.key === dimension)!
  const items: BreadcrumbProps['items'] = [
    {
      title: <a onClick={() => handleResetToAll()}>全部</a>
    }
  ]
  if (selectedCategory !== '__all__') {
    let label: string
    if (selectedCategory === '__unset__') {
      label = '(未设置)'
    } else if (dimension === 'batch_id') {
      const item = dimensionData.find((d) => d.value === selectedCategory)
      label = (item as any)?.label ?? selectedCategory
    } else {
      label = selectedCategory
    }
    items.push({
      title: <span>{meta.label}: {label}</span>
    })
  }
  return items
}, [dimension, selectedCategory, dimensionData])
```

- [ ] **Step 2: 实现 handleResetToAll**

在 `handleDimensionChange` 之后追加：

```typescript
const handleResetToAll = () => {
  setSelectedCategory('__all__')
  // setFilter 由 useEffect 自动触发
}
```

- [ ] **Step 3: 在分类树上方渲染 Breadcrumb**

在 `<Sider>` 内 `<Text strong>分类维度</Text>` 标题区下方、`<Segmented>` 之前，插入：

```tsx
<Breadcrumb items={breadcrumbItems} style={{ marginBottom: 8, fontSize: 12 }} />
```

- [ ] **Step 4: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 3.5: 重置筛选按钮

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

- [ ] **Step 1: hasFilterPanelActive useMemo**

在 `breadcrumbItems` 之后追加：

```typescript
const hasFilterPanelActive = useMemo(() => {
  const f = store.filter
  // 排除 page/pageSize/dimension 字段（这些不属于 FilterPanel 控制的字段）
  // 检查 FilterPanel 控制的字段：types/domains/difficulties/source/source_type/status/tags（数组）/keyword
  return !!(
    f.types?.length ||
    f.domains?.length ||
    f.difficulties?.length ||
    (f.tags && f.tags.length > 0) ||
    f.keyword
  )
}, [store.filter])
```

注意：FilterPanel 自身控制的是多选数组 + keyword；单值字段（type/domain/...）由分类树控制，不计入此判断。

- [ ] **Step 2: 条件渲染重置按钮**

在 `<Button icon={<FilterOutlined />}>筛选</Button>` 之后追加：

```tsx
{hasFilterPanelActive && (
  <Button
    icon={<CloseCircleOutlined />}
    onClick={() => {
      // 重置 FilterPanel 字段，但保留 dimension + selectedCategory
      store.setFilter({
        types: undefined,
        domains: undefined,
        difficulties: undefined,
        tags: undefined,
        keyword: undefined,
        source: undefined,
        source_type: undefined,
        status: undefined
      })
    }}
  >
    重置筛选
  </Button>
)}
```

- [ ] **Step 3: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 3.6: topicStore 跨页全选

**Files:**
- Modify: `src/renderer/src/stores/topicStore.ts`
- Create: `src/renderer/src/stores/__tests__/topicStore.test.ts`

- [ ] **Step 1: state 扩展**

修改 `TopicState` 接口，在 `selectedIds: string[]` 之后追加：

```typescript
// 跨页全选模式：篮选项下全部选中，exceptIds 黑名单排除
allSelectedInFilter: boolean
exceptIds: string[]
```

并追加方法签名：

```typescript
selectAllInFilter: () => void
unselectInAllMode: (id: string) => void
removeFromExcept: (id: string) => void
isSelected: (id: string) => boolean
getSelectedIdsForBatchOp: () => Promise<string[]>
```

- [ ] **Step 2: state 初始值**

在 `create<TopicState>((set, get) => ({ ... }))` 内追加：

```typescript
allSelectedInFilter: false,
exceptIds: [],
```

- [ ] **Step 3: 实现 selectAllInFilter / unselectInAllMode / removeFromExcept / isSelected**

追加方法实现：

```typescript
selectAllInFilter: () =>
  set({ allSelectedInFilter: true, exceptIds: [], selectedIds: [] }),

unselectInAllMode: (id: string) =>
  set((s) => ({
    exceptIds: s.exceptIds.includes(id) ? s.exceptIds : [...s.exceptIds, id]
  })),

removeFromExcept: (id: string) =>
  set((s) => ({
    exceptIds: s.exceptIds.filter((x) => x !== id)
  })),

isSelected: (id: string) => {
  const s = get()
  if (s.allSelectedInFilter) return !s.exceptIds.includes(id)
  return s.selectedIds.includes(id)
},
```

- [ ] **Step 4: 改造 toggleSelect / clearSelection**

```typescript
toggleSelect: (id) =>
  set((s) => {
    if (s.allSelectedInFilter) {
      // 全选模式下：toggle 即在 exceptIds 中加/减
      if (s.exceptIds.includes(id)) {
        return { exceptIds: s.exceptIds.filter((x) => x !== id) }
      }
      return { exceptIds: [...s.exceptIds, id] }
    }
    return {
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id]
    }
  }),

clearSelection: () =>
  set({ selectedIds: [], allSelectedInFilter: false, exceptIds: [] }),
```

- [ ] **Step 5: 实现 getSelectedIdsForBatchOp**

```typescript
getSelectedIdsForBatchOp: async () => {
  const s = get()
  if (s.allSelectedInFilter) {
    // 拉取篮选项下全部 id，过滤 exceptIds
    const res = await window.topicAPI.list({
      ...s.filter,
      page: 1,
      pageSize: 100000
    })
    if (!res.success || !res.data) return []
    const exceptSet = new Set(s.exceptIds)
    return res.data.items.map((t) => t.id).filter((id) => !exceptSet.has(id))
  }
  return s.selectedIds
},
```

- [ ] **Step 6: 新建测试文件**

```typescript
// src/renderer/src/stores/__tests__/topicStore.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTopicStore } from '../topicStore'

// mock window.topicAPI
const mockList = vi.fn()
;(globalThis as any).window = {
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
}

describe('topicStore 跨页全选', () => {
  beforeEach(() => {
    useTopicStore.setState({
      selectedIds: [],
      allSelectedInFilter: false,
      exceptIds: []
    })
  })

  it('selectAllInFilter 进入跨页全选模式', () => {
    useTopicStore.getState().selectAllInFilter()
    const s = useTopicStore.getState()
    expect(s.allSelectedInFilter).toBe(true)
    expect(s.exceptIds).toEqual([])
    expect(s.selectedIds).toEqual([])
  })

  it('isSelected 在全选模式下排除 exceptIds', () => {
    useTopicStore.getState().selectAllInFilter()
    useTopicStore.getState().unselectInAllMode('topic-1')
    expect(useTopicStore.getState().isSelected('topic-1')).toBe(false)
    expect(useTopicStore.getState().isSelected('topic-2')).toBe(true)
  })

  it('removeFromExcept 重新选中', () => {
    useTopicStore.getState().selectAllInFilter()
    useTopicStore.getState().unselectInAllMode('topic-1')
    useTopicStore.getState().removeFromExcept('topic-1')
    expect(useTopicStore.getState().isSelected('topic-1')).toBe(true)
  })

  it('toggleSelect 在全选模式下操作 exceptIds', () => {
    useTopicStore.getState().selectAllInFilter()
    useTopicStore.getState().toggleSelect('topic-1')
    expect(useTopicStore.getState().exceptIds).toContain('topic-1')
    useTopicStore.getState().toggleSelect('topic-1')
    expect(useTopicStore.getState().exceptIds).not.toContain('topic-1')
  })

  it('clearSelection 重置所有', () => {
    useTopicStore.getState().selectAllInFilter()
    useTopicStore.getState().unselectInAllMode('x')
    useTopicStore.getState().clearSelection()
    const s = useTopicStore.getState()
    expect(s.allSelectedInFilter).toBe(false)
    expect(s.exceptIds).toEqual([])
    expect(s.selectedIds).toEqual([])
  })

  it('getSelectedIdsForBatchOp 全选模式拉取全量并过滤 exceptIds', async () => {
    mockList.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 't1' },
          { id: 't2' },
          { id: 't3' }
        ]
      }
    })
    useTopicStore.setState({ filter: { page: 1, pageSize: 20 } })
    useTopicStore.getState().selectAllInFilter()
    useTopicStore.getState().unselectInAllMode('t2')
    const ids = await useTopicStore.getState().getSelectedIdsForBatchOp()
    expect(ids).toEqual(['t1', 't3'])
  })

  it('getSelectedIdsForBatchOp 普通模式返回 selectedIds', async () => {
    useTopicStore.setState({ selectedIds: ['a', 'b'] })
    const ids = await useTopicStore.getState().getSelectedIdsForBatchOp()
    expect(ids).toEqual(['a', 'b'])
    expect(mockList).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 7: typecheck + test 验证**

Run: `npm run typecheck && npm test`
Expected: PASS

---

### Task 3.7: TopicCard 选中状态改造

**Files:**
- Modify: `src/renderer/src/components/TopicCard.tsx`
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

- [ ] **Step 1: TopicCard 使用 store.isSelected 替代 selectedIds.includes**

读 `src/renderer/src/components/TopicCard.tsx`，找到 props 中 `selected` 字段的来源。在 TopicLibrary.tsx 中改为：

```typescript
<TopicCard
  key={t.id}
  topic={t}
  selected={store.isSelected(t.id)}
  onSelect={(id, sel) => {
    if (store.allSelectedInFilter) {
      // 全选模式：toggleSelect 操作 exceptIds
      store.toggleSelect(id)
    } else {
      sel ? store.select(id) : store.deselect(id)
    }
  }}
  onEdit={handleEdit}
  onDelete={handleDelete}
  onToggleStatus={handleToggleStatus}
  onWeightChange={handleWeightChange}
/>
```

- [ ] **Step 2: 列表视图同步改造**

修改 `store.items.map((t) => { ... })` 列表视图块：

```typescript
{store.items.map((t) => {
  const isSelected = store.isSelected(t.id)
  return (
    <div
      key={t.id}
      style={{
        position: 'relative',
        background: isSelected ? token.colorPrimaryBg : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.2s ease'
      }}
      onClick={() => store.toggleSelect(t.id)}
    >
      {/* ... 原 TopicListItem 渲染保持不变 */}
    </div>
  )
})}
```

- [ ] **Step 3: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 3.8: 跨页全选 Alert

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

- [ ] **Step 1: 计算 currentPageAllSelected**

在 `hasFilterPanelActive` 之后追加：

```typescript
const currentPageAllSelected = useMemo(() => {
  if (store.items.length === 0) return false
  if (store.allSelectedInFilter) return true // 已全选
  return store.items.every((t) => store.isSelected(t.id))
}, [store.items, store.allSelectedInFilter, store.selectedIds, store.exceptIds])
```

- [ ] **Step 2: 在 FilterPanel 上方渲染 Alert**

在 `{filterOpen && <FilterPanel ... />}` 之前，插入：

```tsx
{/* 跨页全选提示 */}
{currentPageAllSelected &&
  !store.allSelectedInFilter &&
  store.total > store.items.length && (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      message={`已选当前页 ${store.items.length} 条，还有 ${store.total - store.items.length} 条未选中`}
      action={
        <Button size="small" type="primary" onClick={() => store.selectAllInFilter()}>
          选中全部 {store.total} 条
        </Button>
      }
    />
  )}

{store.allSelectedInFilter && (
  <Alert
    type="success"
    showIcon
    style={{ marginBottom: 12 }}
    message={`已选中全部 ${store.total} 条（已取消 ${store.exceptIds.length} 条）`}
    action={
      <Button size="small" onClick={() => store.clearSelection()}>
        清除选择
      </Button>
    }
  />
)}
```

- [ ] **Step 3: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 3.9: 批量操作改造

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

- [ ] **Step 1: 改造 hasSelection 判断**

修改 `const hasSelection = store.selectedIds.length > 0;`：

```typescript
const hasSelection = store.allSelectedInFilter || store.selectedIds.length > 0
```

- [ ] **Step 2: 改造 handleBatchDelete**

```typescript
const handleBatchDelete = async () => {
  if (!hasSelection) return
  const isCrossPage = store.allSelectedInFilter
  const selectedCount = isCrossPage
    ? store.total - store.exceptIds.length
    : store.selectedIds.length

  Modal.confirm({
    title: isCrossPage
      ? `确认跨页批量删除 ${selectedCount} 条辩题？`
      : `确认批量删除 ${store.selectedIds.length} 条辩题？`,
    content: isCrossPage
      ? `跨页全选模式：将删除除已取消 ${store.exceptIds.length} 条外的全部 ${store.total} 条中的 ${selectedCount} 条，不可恢复`
      : '删除后不可恢复',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const ids = await store.getSelectedIdsForBatchOp()
      if (ids.length === 0) {
        messageApi.warning('没有可删除的项')
        return
      }
      await store.batchRemove(ids)
      messageApi.success(`已删除 ${ids.length} 条`)
      store.clearSelection()
      store.fetchList()
    }
  })
}
```

- [ ] **Step 3: 改造 handleBatchAddTag / handleBatchChangeType / handleBatchChangeDifficulty**

将三个函数统一改造为使用 `getSelectedIdsForBatchOp`：

```typescript
const handleBatchAddTag = async () => {
  if (!batchTagValue.trim() || !hasSelection) return
  messageApi.loading({ content: '处理中...', key: 'batchTag', duration: 0 })
  try {
    const ids = await store.getSelectedIdsForBatchOp()
    // 拉取每条 topic 的当前 tags（避免只用 store.items 的当前页数据）
    const res = await window.topicAPI.list({
      ...store.filter,
      page: 1,
      pageSize: 100000,
      // 全选模式已包含筛选条件；普通模式 ids 是显式列表
    })
    if (!res.success || !res.data) throw new Error('拉取失败')

    const idSet = new Set(ids)
    const toUpdate = res.data.items.filter((t) => idSet.has(t.id))
    for (const t of toUpdate) {
      const newTags = Array.from(new Set([...(t.tags ?? []), batchTagValue.trim()]))
      await store.update(t.id, { tags: newTags })
    }
    messageApi.success({ content: `已批量打标签（${ids.length} 条）`, key: 'batchTag' })
    setBatchTagInput(false)
    setBatchTagValue('')
    store.clearSelection()
    store.fetchList()
  } catch (e) {
    messageApi.error({ content: e instanceof Error ? e.message : '失败', key: 'batchTag' })
  }
}

const handleBatchChangeType = async (newType: string) => {
  if (!hasSelection) return
  messageApi.loading({ content: '处理中...', key: 'batchType', duration: 0 })
  try {
    const ids = await store.getSelectedIdsForBatchOp()
    for (const id of ids) {
      await store.update(id, { type: newType })
    }
    messageApi.success({ content: `已批量修改类型（${ids.length} 条）`, key: 'batchType' })
    store.clearSelection()
    store.fetchList()
  } catch (e) {
    messageApi.error({ content: e instanceof Error ? e.message : '失败', key: 'batchType' })
  }
}

const handleBatchChangeDifficulty = async (newDiff: string) => {
  if (!hasSelection) return
  messageApi.loading({ content: '处理中...', key: 'batchDiff', duration: 0 })
  try {
    const ids = await store.getSelectedIdsForBatchOp()
    for (const id of ids) {
      await store.update(id, { difficulty: newDiff })
    }
    messageApi.success({ content: `已批量修改难度（${ids.length} 条）`, key: 'batchDiff' })
    store.clearSelection()
    store.fetchList()
  } catch (e) {
    messageApi.error({ content: e instanceof Error ? e.message : '失败', key: 'batchDiff' })
  }
}
```

- [ ] **Step 4: 顶部工具栏选中数显示改造**

修改 `{hasSelection && (<> ... </>)}` 块内的"已选 X 项"显示：

```typescript
{hasSelection && (
  <>
    <Text type="secondary">
      {store.allSelectedInFilter
        ? `已选全部 ${store.total} 条（取消 ${store.exceptIds.length} 条）`
        : `已选 ${store.selectedIds.length} 项`}
    </Text>
    <Dropdown menu={{ items: batchMenuItems }} trigger={['click']}>
      <Button>批量操作</Button>
    </Dropdown>
    <Button type="link" onClick={() => store.clearSelection()}>
      取消选择
    </Button>
  </>
)}
```

- [ ] **Step 5: 浮动操作栏同步改造**

修改 `<Affix>` 内的 `floatActionBarStyle` 块：

```typescript
<Badge
  count={
    store.allSelectedInFilter
      ? store.total - store.exceptIds.length
      : store.selectedIds.length
  }
  style={{ backgroundColor: token.colorPrimary }}
/>
<Text strong>
  {store.allSelectedInFilter
    ? `已选全部 ${store.total} 条`
    : `已选 ${store.selectedIds.length} 项`}
</Text>
```

- [ ] **Step 6: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS

---

### Task 3.10: 迭代 3 验证清单

- [ ] **Step 1: typecheck + test**

Run: `npm run typecheck && npm test`
Expected: PASS（测试数 +7 topicStore.test）

- [ ] **Step 2: 启动 dev 验证**

Run: `npm run dev`
Expected: 应用正常启动，IPC 注册成功（含 TOPIC_LIST_ALL_TAGS / SYSTEM_GET_CANDIDATES）

- [ ] **Step 3: 端到端手动验证（9 个场景）**

1. 切换 8 个维度，每个维度的分类树计数与全库一致（非当前页）
2. 「导入批次」维度显示文件名，同名批次加 (2) 后缀
3. 点分类节点 → 列表筛到该分类；点「全部」面包屑 → 退回全部
4. FilterPanel 设置筛选条件 → 出现「重置筛选」按钮 → 点击后筛选清空、分类维度保留
5. 当前页全选后出现「选中全部 N 条」Alert → 点击 → 进入跨页全选模式
6. 跨页全选模式下取消某条 → Alert 显示「已取消 X 条」→ 重新点该条 → 重新选中
7. 「状态」维度点击「active」节点 → 列表筛到该状态
8. 任意维度点「(未设置)」节点 → 列表筛到该字段为 NULL 的题
9. 跨页全选模式下点「批量删除」→ Modal.confirm 显示「跨页全选模式，将删除除 X 条外的全部 Y 条」→ 确认 → 删除成功

---

### Task 3.11: 迭代 3 Commit

- [ ] **Step 1: git add + commit**

```bash
git add src/main/db/repository/ src/main/ipc/ src/preload/ src/renderer/src/pages/TopicLibrary.tsx src/renderer/src/stores/ src/renderer/src/components/TopicCard.tsx src/shared/types.ts
git commit -m "feat(library): 8-dimension category tree with breadcrumb and bulk select"
```

---

## 自检清单

- [ ] **迭代 2 全部 commit 完成**（git log 含 1 个 feat(import) 提交）
- [ ] **迭代 3 全部 commit 完成**（git log 含 1 个 feat(library) 提交）
- [ ] **typecheck 全量通过**
- [ ] **测试全量通过**（原 251 + valueMapping 11 + topicStore 7 = 269）
- [ ] **现有功能无回归**：题库 CRUD / 抽取 / 赛事管理 / 标签显示配置 / 导入撤销

---

## 风险与边界情况

1. **Task 3.3 batch_id 维度数据**：listBatches 默认 limit=500，足够覆盖个人使用；超 500 批次时分类树会截断（可接受）。
2. **Task 3.6 Set 序列化**：当前 store 未使用 persist 中间件，`exceptIds: string[]` 用数组即可；如未来加 persist 无需特殊处理。
3. **Task 3.9 大批量操作性能**：1000+ 条批量删除时 `getSelectedIdsForBatchOp` list pageSize=100000 拉取约 < 200ms，batchDelete 事务约 < 500ms，UI 不阻塞。
4. **Task 3.3 ipc_batches 同名批次**：用 `(item as any).label` 存储显示名，与 `value`（batch.id）分离，避免 id 暴露给用户。
5. **Task 3.5 重置筛选范围**：仅清 FilterPanel 控制的字段（types/domains/difficulties/tags/keyword/source/source_type/status），保留 dimension + selectedCategory 控制的单值字段。这与用户的分类筛选预期一致。
