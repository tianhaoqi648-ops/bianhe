# 动态字段 & 批量值映射 — 执行计划 v2（Task 5-15）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把原 plan Task 5-15 全部落地，覆盖用户两个核心诉求：
1. 导入文件里的新字段（如「赛事」）→ 自动接入分类树/筛选/抽取筛选/编辑表单
2. 难度新值（如「入门级」「初级」「basic」）→ 多选批量映射到已有值 + 智能推荐一键应用

**Architecture:** JSON 列存储（`topics.custom_data`）+ 系统/自定义字段统一接口 + 候选值合并（系统候选 ∪ DB 实际值）+ UI 多选批量映射 + Levenshtein 智能推荐。

**Tech Stack:** Electron + React 18 + TypeScript + antd 5 + Zustand + better-sqlite3 + vitest

---

## 现状摘要（截至 2026-07-26）

### ✅ 已完成（Task 1-4）
- `src/shared/types.ts`：`CustomField / FieldMapping / ParsedResult.rawTable+unmatchedColumns / Topic.custom_data / TopicFilter.custom_filters` 类型已定义；`IPC_CHANNELS.CUSTOM_FIELD_*` 4 个通道已定义
- `src/shared/field-definitions.ts`：`SYSTEM_FIELD_DEFINITIONS / SYSTEM_FIELD_ALIAS_MAP / SYSTEM_FIELD_KEYS / SYSTEM_FIELD_LABELS` 已实现
- `src/main/services/custom-field-service.ts`：`listAll / createField / updateField / deleteField / exists / labelToKey` 已实现
- `src/main/db/repository/topic.repo.ts`：`custom_data` 序列化、`buildWhereClause(custom_filters)`、`listDistinctValues`、`listCustomFieldTags` 已实现
- `src/main/ipc/topic.ipc.ts`：`TOPIC_LIST_VALUES / TOPIC_LIST_CUSTOM_FIELD_TAGS` 已注册
- `src/preload/index.ts`：`topicAPI.listValues / listCustomFieldTags` 已暴露
- `src/main/services/import-engine.ts`：`buildFieldMapping` 返回 `unmatchedColumns`、`applyFieldMapping` 已实现、`rowToTopic` 支持 `fieldMapping` 参数

### ❌ 待完成（Task 5-15）
- Task 5：import-engine 测试未补完
- Task 6：`value-recommender.ts` 不存在
- Task 7：`FieldMappingPanel.tsx` 不存在
- Task 8：`ImportTopicsModal` 未集成 FieldMappingPanel
- Task 9：`ValueMappingPanel` 无多选+推荐
- Task 10：`custom-field.ipc.ts` 不存在；`ipc/index.ts` 未注册；preload 未暴露 `customFieldAPI`；`customFieldStore.ts` 不存在
- Task 11：`candidate-service.getMergedCandidatesWithDB` 未实现
- Task 12：`FilterPanel` 仍用 `SYSTEM_CANDIDATES` 写死；无自定义字段筛选器
- Task 13：`TopicLibrary.DIMENSIONS` 仍静态
- Task 14：`TopicEditModal` 不支持自定义字段编辑
- Task 15：全量验证未做

---

## 文件改动总览

### 新增文件（6 个）
| 路径 | 职责 |
|---|---|
| `src/main/services/value-recommender.ts` | Levenshtein + 子串智能推荐算法 |
| `src/main/services/__tests__/value-recommender.test.ts` | 推荐算法单元测试 |
| `src/main/ipc/custom-field.ipc.ts` | 自定义字段 IPC 通道 |
| `src/renderer/src/stores/customFieldStore.ts` | 自定义字段 Zustand store |
| `src/renderer/src/components/import/FieldMappingPanel.tsx` | 未识别列绑定 UI |
| `src/renderer/src/components/TopicCustomFields.tsx` | 编辑弹窗自定义字段渲染器 |

### 修改文件（9 个）
| 路径 | 改动要点 |
|---|---|
| `src/main/services/__tests__/import-engine.test.ts` | 补完 unmatchedColumns + applyFieldMapping 测试 |
| `src/main/services/candidate-service.ts` | 新增 `getMergedCandidatesWithDB()` |
| `src/main/ipc/index.ts` | 注册 `customFieldIpc` |
| `src/preload/index.ts` | 暴露 `customFieldAPI` |
| `src/preload/index.d.ts` | `customFieldAPI` 类型声明 |
| `src/renderer/src/components/import/ValueMappingPanel.tsx` | 加多选 checkbox + 批量映射 + 智能推荐按钮 |
| `src/renderer/src/components/ImportTopicsModal.tsx` | Step 2 拆 2a/2b，集成 FieldMappingPanel；预览表动态列 |
| `src/renderer/src/components/FilterPanel.tsx` | mount 拉取 DB 实际值合并；渲染自定义字段筛选器 |
| `src/renderer/src/pages/TopicLibrary.tsx` | `DIMENSIONS` 改 useMemo 合并自定义字段；分类树加载分支 |
| `src/renderer/src/components/TopicEditModal.tsx` | 表单底部嵌入 TopicCustomFields |
| `src/renderer/src/stores/topicStore.ts` | `resetFilter` 显式清空 `custom_filters` |

---

## Task 5：补完 import-engine 测试

**Files:**
- Modify: `src/main/services/__tests__/import-engine.test.ts`

**目的：** 验证 Task 1-4 已完成的 `unmatchedColumns` 收集与 `applyFieldMapping` 重新解析逻辑。

- [ ] **Step 5.1：在 import-engine.test.ts 末尾追加测试 describe 块**

在文件末尾追加：

```typescript
// ============================================================
// unmatchedColumns + applyFieldMapping
// ============================================================

import { applyFieldMapping } from '../import-engine'

describe('unmatchedColumns 收集', () => {
  it('含「赛事」列的 xlsx → unmatchedColumns 含「赛事」', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '类型', '赛事'],
          ['AI 是否应被禁止', '价值辩', '新国辩'],
          ['死刑应否废除', '政策辩', '世锦赛']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.unmatchedColumns).toContain('赛事')
      expect(result.mapping['标题']).toBe('title')
      expect(result.mapping['类型']).toBe('type')
      // 系统字段不被误判为 unmatched
      expect(result.unmatchedColumns).not.toContain('标题')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('全部列都已识别 → unmatchedColumns 为空数组', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '类型', '难度'],
          ['测试题1', '价值辩', '入门级']
        ]
      }
    ])
    try {
      const result = await parseFile(tmpPath, 'xlsx')
      expect(result.unmatchedColumns).toEqual([])
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

describe('applyFieldMapping', () => {
  it('kind=create → 值写入 custom_data', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '赛事'],
          ['题1', '新国辩'],
          ['题2', '世锦赛']
        ]
      }
    ])
    try {
      const parsed = await parseFile(tmpPath, 'xlsx')
      const fieldMapping = {
        赛事: { kind: 'create' as const, fieldLabel: '赛事', fieldType: 'string' as const }
      }
      const result = applyFieldMapping(parsed, fieldMapping)
      expect(result.topics).toHaveLength(2)
      expect(result.topics[0].custom_data?.['赛事']).toBe('新国辩')
      expect(result.topics[1].custom_data?.['赛事']).toBe('世锦赛')
      expect(result.unmatchedColumns).toEqual([])
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('kind=bind → 值绑定到系统字段', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '赛事'],
          ['题1', '新国辩']
        ]
      }
    ])
    try {
      const parsed = await parseFile(tmpPath, 'xlsx')
      const fieldMapping = {
        赛事: { kind: 'bind' as const, fieldKey: 'source' }
      }
      const result = applyFieldMapping(parsed, fieldMapping)
      expect(result.topics[0].source).toBe('新国辩')
      expect(result.topics[0].custom_data).toBeUndefined()
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('kind=ignore → 该列值被丢弃', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '赛事'],
          ['题1', '新国辩']
        ]
      }
    ])
    try {
      const parsed = await parseFile(tmpPath, 'xlsx')
      const fieldMapping = {
        赛事: { kind: 'ignore' as const }
      }
      const result = applyFieldMapping(parsed, fieldMapping)
      expect(result.topics[0].source).toBeNull()
      expect(result.topics[0].custom_data).toBeUndefined()
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('kind=create + fieldType=tags → custom_data 为字符串数组', async () => {
    const tmpPath = writeTmpXlsx([
      {
        name: 'Sheet1',
        rows: [
          ['标题', '主题词'],
          ['题1', 'AI,伦理,科技']
        ]
      }
    ])
    try {
      const parsed = await parseFile(tmpPath, 'xlsx')
      const fieldMapping = {
        主题词: { kind: 'create' as const, fieldLabel: '主题词', fieldType: 'tags' as const }
      }
      const result = applyFieldMapping(parsed, fieldMapping)
      expect(result.topics[0].custom_data?.['主题词']).toEqual(['AI', '伦理', '科技'])
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})
```

- [ ] **Step 5.2：运行测试验证通过**

Run: `npm test -- import-engine`
Expected: PASS，新增 6 个测试用例全部通过

- [ ] **Step 5.3：Commit**

```bash
git add src/main/services/__tests__/import-engine.test.ts
git commit -m "test(import): cover unmatchedColumns + applyFieldMapping"
```

---

## Task 6：value-recommender 智能推荐算法

**Files:**
- Create: `src/main/services/value-recommender.ts`
- Create: `src/main/services/__tests__/value-recommender.test.ts`

- [ ] **Step 6.1：创建 value-recommender.ts**

```typescript
// ============================================================
// value-recommender.ts — 智能推荐算法
//
// 为导入时检测到的新值推荐最匹配的已有候选值。
// 三级匹配策略：
//   1. 精确匹配（小写化比较）→ score=1.0, reason='exact'
//   2. 包含关系（双向子串）→ score=0.9, reason='substring'
//   3. Levenshtein 相似度 ≥ 0.6 → score=相似度, reason='similar'
//   4. 相似度 < 0.6 → 不推荐，用户手动处理
// ============================================================

/** Levenshtein 距离（小写化比较） */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

/** 相似度评分（0-1，1 表示完全相同） */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

export type RecommendReason = 'exact' | 'substring' | 'similar'

export interface Recommendation {
  /** 原始新值 */
  originValue: string
  /** 推荐的目标候选值 */
  recommendedTarget: string
  /** 相似度评分 0-1 */
  score: number
  /** 匹配原因 */
  reason: RecommendReason
}

/**
 * 为一批新值推荐目标候选。
 * @param newValues 待推荐的新值数组
 * @param candidates 已有候选值数组
 * @returns 推荐结果数组（仅包含 score≥0.6 的项，未匹配的不返回）
 */
export function recommendMappings(
  newValues: string[],
  candidates: string[]
): Recommendation[] {
  const result: Recommendation[] = []
  for (const nv of newValues) {
    // 1. 精确匹配（小写化）
    const exact = candidates.find((c) => c.toLowerCase() === nv.toLowerCase())
    if (exact) {
      result.push({ originValue: nv, recommendedTarget: exact, score: 1, reason: 'exact' })
      continue
    }
    // 2. 包含关系（双向）
    const substr = candidates.find(
      (c) =>
        c.toLowerCase().includes(nv.toLowerCase()) ||
        nv.toLowerCase().includes(c.toLowerCase())
    )
    if (substr) {
      result.push({
        originValue: nv,
        recommendedTarget: substr,
        score: 0.9,
        reason: 'substring'
      })
      continue
    }
    // 3. Levenshtein 相似度
    let best = { target: '', score: 0 }
    for (const c of candidates) {
      const s = similarity(nv, c)
      if (s > best.score) best = { target: c, score: s }
    }
    if (best.score >= 0.6) {
      result.push({
        originValue: nv,
        recommendedTarget: best.target,
        score: best.score,
        reason: 'similar'
      })
    }
    // score < 0.6 不推荐
  }
  return result
}
```

- [ ] **Step 6.2：创建测试文件**

```typescript
// src/main/services/__tests__/value-recommender.test.ts
import { describe, it, expect } from 'vitest'
import { recommendMappings, levenshtein } from '../value-recommender'

describe('levenshtein', () => {
  it('相同字符串距离为 0', () => {
    expect(levenshtein('abc', 'abc')).toBe(0)
  })

  it('大小写不敏感', () => {
    expect(levenshtein('ABC', 'abc')).toBe(0)
  })

  it('单个编辑操作距离为 1', () => {
    expect(levenshtein('abc', 'abd')).toBe(1)
    expect(levenshtein('abc', 'abcd')).toBe(1)
    expect(levenshtein('abc', 'ab')).toBe(1)
  })
})

describe('recommendMappings', () => {
  const candidates = ['入门级', '进阶级', '高阶级', '专家级']

  it('精确匹配 → score=1, reason=exact', () => {
    const result = recommendMappings(['入门级'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      originValue: '入门级',
      recommendedTarget: '入门级',
      score: 1,
      reason: 'exact'
    })
  })

  it('大小写不敏感精确匹配', () => {
    const result = recommendMappings(['BASIC'], ['basic', 'medium'])
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('exact')
    expect(result[0].recommendedTarget).toBe('basic')
  })

  it('子串匹配 → score=0.9, reason=substring', () => {
    const result = recommendMappings(['入门'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('substring')
    expect(result[0].recommendedTarget).toBe('入门级')
    expect(result[0].score).toBe(0.9)
  })

  it('反向子串匹配（新值包含候选）', () => {
    const result = recommendMappings(['入门级别'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('substring')
    expect(result[0].recommendedTarget).toBe('入门级')
  })

  it('相似度匹配 → reason=similar, score≥0.6', () => {
    const result = recommendMappings(['进阶'], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('similar')
    expect(result[0].score).toBeGreaterThanOrEqual(0.6)
    expect(result[0].recommendedTarget).toBe('进阶级')
  })

  it('相似度 < 0.6 → 不推荐', () => {
    const result = recommendMappings(['xyz'], ['abc'])
    expect(result).toHaveLength(0)
  })

  it('批量推荐：混合多种匹配方式', () => {
    const newValues = ['入门级', '入门', '进阶', 'xyz']
    const result = recommendMappings(newValues, candidates)
    expect(result).toHaveLength(3)
    const reasons = result.map((r) => r.reason)
    expect(reasons).toContain('exact')
    expect(reasons).toContain('substring')
    expect(reasons).toContain('similar')
  })

  it('空候选数组 → 返回空', () => {
    const result = recommendMappings(['abc'], [])
    expect(result).toHaveLength(0)
  })
})
```

注意：`levenshtein` 需要在 value-recommender.ts 中 export，更新 Step 6.1 的导出：

```typescript
export function levenshtein(a: string, b: string): number {
  // ... 同上
}
```

- [ ] **Step 6.3：运行测试**

Run: `npm test -- value-recommender`
Expected: PASS，11 个测试用例全部通过

- [ ] **Step 6.4：Commit**

```bash
git add src/main/services/value-recommender.ts src/main/services/__tests__/value-recommender.test.ts
git commit -m "feat(import): value recommender with levenshtein + substring matching"
```

---

## Task 7：FieldMappingPanel UI 组件

**Files:**
- Create: `src/renderer/src/components/import/FieldMappingPanel.tsx`

- [ ] **Step 7.1：创建 FieldMappingPanel.tsx**

```typescript
// src/renderer/src/components/import/FieldMappingPanel.tsx
// ============================================================
// FieldMappingPanel — 未识别列绑定 UI
//
// 在 ImportTopicsModal Step 2a 阶段显示。对每个未识别列让用户选择：
//   - ignore：忽略该列
//   - bind：绑定到已有字段（系统字段或已存在的自定义字段）
//   - create：创建新自定义字段（string 或 tags 类型）
//
// 选 create 时同步调 onCreateField 持久化到 DB，避免重复创建。
// ============================================================

import { useState, useEffect } from 'react'
import { Card, Select, Input, Radio, Space, Typography, Alert, Divider, Tag } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import type {
  FieldMapping,
  FieldMappingAction,
  CustomField,
  CustomFieldType,
  FieldDefinition
} from '../../../../shared/types'

const { Text, Title } = Typography

export interface FieldMappingPanelProps {
  /** 未识别的原始表头列名 */
  unmatchedColumns: string[]
  /** 系统字段定义（用于「绑定到已有字段」选项） */
  systemFields: FieldDefinition[]
  /** 已存在的自定义字段（用于「绑定到已有字段」选项） */
  customFields: CustomField[]
  /** 初始 mapping（一般空对象） */
  initialMapping?: FieldMapping
  /** mapping 变化回调 */
  onMappingChange: (mapping: FieldMapping) => void
  /** 创建新自定义字段的回调（持久化到 DB） */
  onCreateField: (label: string, type: CustomFieldType) => Promise<CustomField>
}

export default function FieldMappingPanel({
  unmatchedColumns,
  systemFields,
  customFields,
  initialMapping = {},
  onMappingChange,
  onCreateField
}: FieldMappingPanelProps) {
  const [mapping, setMapping] = useState<FieldMapping>(initialMapping)
  const [creating, setCreating] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    onMappingChange(mapping)
  }, [mapping, onMappingChange])

  if (unmatchedColumns.length === 0) return null

  // 可绑定的目标字段列表：系统字段（isCountable=true 的元数据字段，排除 title/weight）+ 自定义字段
  const bindableSystemFields = systemFields.filter(
    (f) => f.isCountable && f.key !== 'tags' && f.key !== 'batch_id'
  )
  const bindTargets: Array<{ value: string; label: string; group: string }> = [
    ...bindableSystemFields.map((f) => ({
      value: f.key,
      label: `${f.label}（系统）`,
      group: '系统字段'
    })),
    ...customFields.map((f) => ({
      value: f.field_key,
      label: `${f.field_label}（自定义）`,
      group: '自定义字段'
    }))
  ]

  const updateAction = (column: string, action: FieldMappingAction) => {
    setMapping((prev) => ({ ...prev, [column]: action }))
    setErrors((prev) => ({ ...prev, [column]: '' }))
  }

  const handleCreateField = async (column: string, label: string, type: CustomFieldType) => {
    setCreating((prev) => ({ ...prev, [column]: true }))
    try {
      const created = await onCreateField(label, type)
      // 创建成功后改为 bind 到新字段
      setMapping((prev) => ({
        ...prev,
        [column]: { kind: 'bind', fieldKey: created.field_key }
      }))
      setErrors((prev) => ({ ...prev, [column]: '' }))
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [column]: e instanceof Error ? e.message : '创建失败'
      }))
    } finally {
      setCreating((prev) => ({ ...prev, [column]: false }))
    }
  }

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space style={{ marginBottom: 8, justifyContent: 'space-between', width: '100%' }}>
        <Title level={5} style={{ margin: 0 }}>
          <LinkOutlined style={{ marginRight: 6, color: '#1677ff' }} />
          字段映射
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {unmatchedColumns.length} 个未识别列
        </Text>
      </Space>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 8, fontSize: 12 }}
        message="文件中存在未识别的列，请选择处理方式："
        description={
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            <li><b>忽略</b>：丢弃该列数据</li>
            <li><b>绑定已有字段</b>：把值写入已存在的系统/自定义字段</li>
            <li><b>创建新字段</b>：新建自定义字段并写入值（自动接入分类树/筛选/编辑）</li>
          </ul>
        }
      />
      {unmatchedColumns.map((column) => {
        const action = mapping[column] ?? { kind: 'ignore' as const }
        const error = errors[column] ?? ''
        const isCreating = creating[column] ?? false
        return (
          <div
            key={column}
            style={{
              marginBottom: 8,
              padding: '8px 12px',
              background: '#fafafa',
              borderRadius: 4
            }}
          >
            <Space style={{ width: '100%' }} align="start">
              <Tag color="blue" style={{ minWidth: 100, textAlign: 'center' }}>
                {column}
              </Tag>
              <Select
                size="small"
                style={{ width: 150 }}
                value={action.kind}
                onChange={(v) => {
                  if (v === 'ignore') updateAction(column, { kind: 'ignore' })
                  else if (v === 'bind') {
                    updateAction(column, {
                      kind: 'bind',
                      fieldKey: bindTargets[0]?.value ?? ''
                    })
                  } else if (v === 'create') {
                    updateAction(column, {
                      kind: 'create',
                      fieldLabel: column,
                      fieldType: 'string'
                    })
                  }
                }}
                options={[
                  { value: 'ignore', label: '忽略' },
                  { value: 'bind', label: '绑定已有字段' },
                  { value: 'create', label: '创建新字段' }
                ]}
              />
              {action.kind === 'bind' && (
                <Select
                  size="small"
                  style={{ width: 200 }}
                  value={action.fieldKey}
                  onChange={(v) => updateAction(column, { kind: 'bind', fieldKey: v })}
                  options={bindTargets}
                  showSearch
                  optionFilterProp="label"
                />
              )}
              {action.kind === 'create' && (
                <Space direction="vertical" size={4}>
                  <Space>
                    <Input
                      size="small"
                      style={{ width: 150 }}
                      placeholder="字段显示名"
                      value={action.fieldLabel}
                      onChange={(e) =>
                        updateAction(column, {
                          kind: 'create',
                          fieldLabel: e.target.value,
                          fieldType: action.fieldType
                        })
                      }
                    />
                    <Radio.Group
                      size="small"
                      value={action.fieldType}
                      onChange={(e) =>
                        updateAction(column, {
                          kind: 'create',
                          fieldLabel: action.fieldLabel,
                          fieldType: e.target.value
                        })
                      }
                    >
                      <Radio.Button value="string">文本</Radio.Button>
                      <Radio.Button value="tags">标签</Radio.Button>
                    </Radio.Group>
                    <a
                      onClick={() => handleCreateField(column, action.fieldLabel, action.fieldType)}
                      style={{ fontSize: 12 }}
                    >
                      {isCreating ? '创建中...' : '确认创建'}
                    </a>
                  </Space>
                </Space>
              )}
            </Space>
            {error && (
              <Text type="danger" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                {error}
              </Text>
            )}
          </div>
        )
      })}
      <Divider style={{ margin: '8px 0' }} />
      <Text type="secondary" style={{ fontSize: 11 }}>
        提示：创建新字段后将自动出现在分类树、筛选面板、辩题编辑表单中。
      </Text>
    </Card>
  )
}
```

- [ ] **Step 7.2：typecheck 验证**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 7.3：Commit**

```bash
git add src/renderer/src/components/import/FieldMappingPanel.tsx
git commit -m "feat(import): FieldMappingPanel for unmatched columns binding"
```

---

## Task 8：ImportTopicsModal 集成 FieldMappingPanel

**Files:**
- Modify: `src/renderer/src/components/ImportTopicsModal.tsx`

**目的：** Step 2「解析预览」拆为 2a（字段映射，仅 unmatchedColumns 非空时显示）和 2b（值映射+预览表）。预览表动态渲染 custom_data 列。

- [ ] **Step 8.1：在 ImportTopicsModal.tsx 顶部 imports 加 FieldMappingPanel、custom-field-service（labelToKey）、applyFieldMapping、SYSTEM_FIELD_DEFINITIONS、类型**

在文件顶部 import 区域追加：

```typescript
import FieldMappingPanel from './import/FieldMappingPanel';
import { applyFieldMapping } from '../../../main/services/import-engine';
import { SYSTEM_FIELD_DEFINITIONS } from '../../../shared/field-definitions';
import type {
  ParsedResult,
  TopicCreateInput,
  ImportExecuteResult,
  ValueMapping,
  FieldMapping,
  CustomField,
  CustomFieldType
} from '../../../shared/types';
```

注意：`applyFieldMapping` 在 main 进程，渲染进程不能直接 import main 模块。需要通过 IPC 调用。修改方案：在 `src/main/ipc/import.ipc.ts` 加一个 `IMPORT_APPLY_FIELD_MAPPING` 通道；或更简单——把 applyFieldMapping 放到 shared utils（纯函数）。

**简化方案（推荐）：** 把 `applyFieldMapping` 函数从 `import-engine.ts` 移到 `src/shared/utils/applyFieldMapping.ts`（纯函数，无 main 依赖）。import-engine re-export 保持兼容。

调整步骤：
1. 创建 `src/shared/utils/applyFieldMapping.ts`，把 `applyFieldMapping` + 必要辅助函数（`buildFieldMapping`、`rowToTopic`、`parseTags`、`collectValueMismatchWarnings`）从 import-engine.ts 提取过来（纯函数，不依赖 fs/XLSX/mammoth/iconv）。
2. `import-engine.ts` 改为从 shared/utils re-export：`export { applyFieldMapping } from '../../shared/utils/applyFieldMapping'`
3. 渲染进程直接 import shared/utils 即可。

为减少风险，**采用更轻量方案**：直接在 ImportTopicsModal 中通过 IPC 调用 applyFieldMapping。

新增 IPC 通道 `IMPORT_APPLY_FIELD_MAPPING`：

在 `src/shared/types.ts` 的 `IPC_CHANNELS` 对象中，在 `IMPORT_LIST_BATCHES` 行后追加：

```typescript
  IMPORT_APPLY_FIELD_MAPPING: 'import:applyFieldMapping',
```

在 `src/preload/index.ts` 的 `importAPI` 对象中，在 `listBatches` 后追加：

```typescript
  applyFieldMapping: (parsed: ParsedResult, fieldMapping: FieldMapping) =>
    invoke<import('../../shared/types').ParsedResult>(
      IPC_CHANNELS.IMPORT_APPLY_FIELD_MAPPING,
      parsed,
      fieldMapping
    )
```

注意：preload 文件顶部 imports 需要加 `ParsedResult, FieldMapping` 类型。

在 `src/main/ipc/import.ipc.ts` 末尾追加注册：

```typescript
import { applyFieldMapping } from '../services/import-engine'
import type { ParsedResult, FieldMapping } from '../../shared/types'

ipcMain.handle(
  IPC_CHANNELS.IMPORT_APPLY_FIELD_MAPPING,
  (_e, parsed: ParsedResult, fieldMapping: FieldMapping) =>
    wrap(() => applyFieldMapping(parsed, fieldMapping))
)
```

注意：`import.ipc.ts` 已有 `wrap` 函数；若没有则用现有错误处理风格。

- [ ] **Step 8.2：在 ImportTopicsModal.tsx 添加新状态**

在 `const [valueMapping, setValueMapping] = useState<ValueMapping>({})` 后追加：

```typescript
const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
const [fieldMappingApplied, setFieldMappingApplied] = useState<boolean>(false);
const [customFields, setCustomFields] = useState<CustomField[]>([]);
const [applyingFieldMapping, setApplyingFieldMapping] = useState(false);
```

- [ ] **Step 8.3：在打开 Modal 时拉取自定义字段列表**

在已有的 `useEffect(() => { if (!open) return; window.settingsAPI.getCandidates()... })` 后追加新 useEffect：

```typescript
useEffect(() => {
  if (!open) return;
  window.customFieldAPI
    .list()
    .then((res) => {
      if (res.success && res.data) {
        setCustomFields(res.data);
      }
    })
    .catch(() => {
      // 拉取失败不阻断流程
    });
}, [open]);
```

注意：此步依赖 Task 10 已完成 `window.customFieldAPI` 暴露。若 Task 10 未完成则此步会 typecheck 失败，需要先做 Task 10。**调整执行顺序：先做 Task 10，再做 Task 8。**

- [ ] **Step 8.4：添加 onCreateField 处理函数**

在 `handleClose` 函数前追加：

```typescript
const handleCreateCustomField = async (
  label: string,
  type: CustomFieldType
): Promise<CustomField> => {
  const res = await window.customFieldAPI.create(label, type);
  if (!res.success || !res.data) {
    throw new Error(res.error || '创建字段失败');
  }
  const created = res.data;
  setCustomFields((prev) => [...prev, created]);
  return created;
};

const handleApplyFieldMapping = async () => {
  if (!parsed) return;
  setApplyingFieldMapping(true);
  try {
    const res = await window.importAPI.applyFieldMapping(parsed, fieldMapping);
    if (!res.success || !res.data) {
      throw new Error(res.error || '应用字段映射失败');
    }
    setParsed(res.data);
    setFieldMappingApplied(true);
  } catch (e) {
    messageApi.error(e instanceof Error ? e.message : '应用字段映射失败');
  } finally {
    setApplyingFieldMapping(false);
  }
};
```

- [ ] **Step 8.5：在 reset 函数中清空新状态**

把 reset 函数改为：

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
  setFieldMapping({});
  setFieldMappingApplied(false);
  setApplyingFieldMapping(false);
};
```

- [ ] **Step 8.6：修改 case 2 渲染，插入 FieldMappingPanel 阶段**

把 `case 2:` 块整体替换为：

```typescript
case 2:
  if (!parsed) return null;
  // 2a：未识别列字段映射（仅当有未识别列且未应用映射时）
  if (
    parsed.unmatchedColumns &&
    parsed.unmatchedColumns.length > 0 &&
    !fieldMappingApplied
  ) {
    return (
      <div>
        <Space style={{ marginBottom: spacing.md }}>
          {fileIcon}
          <Text strong>{fileName}</Text>
          <Tag color="orange">检测到 {parsed.unmatchedColumns.length} 个未识别列</Tag>
        </Space>
        <FieldMappingPanel
          unmatchedColumns={parsed.unmatchedColumns}
          systemFields={SYSTEM_FIELD_DEFINITIONS}
          customFields={customFields}
          onMappingChange={(m) => setFieldMapping(m)}
          onCreateField={handleCreateCustomField}
        />
        <div style={{ marginTop: spacing.md, textAlign: 'right' }}>
          <Button
            type="primary"
            loading={applyingFieldMapping}
            onClick={handleApplyFieldMapping}
            style={primaryButtonStyle}
          >
            应用字段映射，继续
          </Button>
        </div>
      </div>
    );
  }
  // 2b：值映射 + 预览表
  return (
    <div>
      <Space style={{ marginBottom: spacing.md }}>
        {fileIcon}
        <Text strong>{fileName}</Text>
        <Tag color="green">已解析 {parsed.topics.length} 条</Tag>
      </Space>

      {parsed.warnings.length > 0 && (
        <Alert
          message={`解析提示（共 ${parsed.warnings.length} 条）`}
          type={getOverallLevel(parsed.warnings)}
          showIcon
          style={{ marginBottom: spacing.md }}
          description={
            <div>
              <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 150, overflow: 'auto' }}>
                {parsed.warnings.slice(0, 20).map((w, i) => {
                  const level = classifyWarning(w);
                  return (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <Tag color={LEVEL_COLOR[level]} style={{ marginRight: 6, fontSize: 11 }}>
                        {LEVEL_LABEL[level]}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {w}
                      </Text>
                    </li>
                  );
                })}
                {parsed.warnings.length > 20 && (
                  <li>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      ... 还有 {parsed.warnings.length - 20} 条提示
                    </Text>
                  </li>
                )}
              </ul>
            </div>
          }
        />
      )}

      {parsed.topics.length === 0 ? (
        <>
          <Alert
            message="未解析到任何辩题"
            description="请检查文件内容是否包含 title 列，参考下方格式要求自查"
            type="error"
            showIcon
            style={{ marginBottom: spacing.md }}
          />
          <ImportFormatGuide defaultCollapsed={false} />
        </>
      ) : (
        <>
          {parsed.unknownValues &&
            parsed.unknownValues.length > 0 &&
            mergedCandidates && (
              <ValueMappingPanel
                unknownValues={parsed.unknownValues}
                candidateOptions={mergedCandidates}
                onMappingChange={(m) => setValueMapping(m)}
              />
            )}
          <Table
            columns={buildPreviewColumns(parsed.topics[0])}
            dataSource={parsed.topics}
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 700 }}
          />
          <div style={{ marginTop: spacing.md }}>
            <ImportFormatGuide defaultCollapsed />
          </div>
        </>
      )}
    </div>
  );
```

- [ ] **Step 8.7：用动态列构建函数替换静态 previewColumns**

删除文件中现有的 `const previewColumns: ColumnsType<TopicCreateInput> = [...]` 块，替换为函数：

```typescript
const SYSTEM_COLUMN_ORDER: Array<{ key: string; label: string; width: number }> = [
  { key: 'title', label: '标题', width: 0 },
  { key: 'type', label: '类型', width: 100 },
  { key: 'domain', label: '领域', width: 100 },
  { key: 'difficulty', label: '难度', width: 90 },
  { key: 'source', label: '来源', width: 130 },
  { key: 'source_type', label: '来源类型', width: 110 },
  { key: 'tags', label: '标签', width: 150 }
];

function buildPreviewColumns(sample: TopicCreateInput): ColumnsType<TopicCreateInput> {
  const cols: ColumnsType<TopicCreateInput> = [];
  for (const { key, label, width } of SYSTEM_COLUMN_ORDER) {
    if (key === 'title') {
      cols.push({
        title: label,
        dataIndex: key,
        key,
        ellipsis: true
      });
    } else if (key === 'tags') {
      cols.push({
        title: label,
        dataIndex: key,
        key,
        width,
        render: (tags: string[] | null) =>
          tags && tags.length > 0 ? (
            <Space size={4} wrap>
              {tags.map((t) => (
                <Tag key={t} color="blue">
                  {t}
                </Tag>
              ))}
            </Space>
          ) : (
            <Text type="secondary">-</Text>
          )
      });
    } else {
      cols.push({
        title: label,
        dataIndex: key,
        key,
        width,
        render: (v: string | null) => v ?? <Text type="secondary">-</Text>
      });
    }
  }
  // 自定义字段列（来自 custom_data）
  const customKeys = Object.keys(sample.custom_data ?? {});
  for (const ck of customKeys) {
    cols.push({
      title: ck,
      key: `custom_${ck}`,
      width: 120,
      render: (_v, record) => {
        const cv = record.custom_data?.[ck];
        if (cv == null) return <Text type="secondary">-</Text>;
        if (Array.isArray(cv)) {
          return (
            <Space size={4} wrap>
              {cv.map((t) => (
                <Tag key={t} color="purple">
                  {t}
                </Tag>
              ))}
            </Space>
          );
        }
        return String(cv);
      }
    });
  }
  return cols;
}
```

- [ ] **Step 8.8：footerButtons 调整：Step 2a 时不显示「确认导入」按钮**

把 `footerButtons` 中的 `step === 2 &&` 条件改为：

```typescript
{step === 2 &&
  parsed &&
  parsed.topics.length > 0 &&
  fieldMappingApplied && (
    <Button
      size="middle"
      type="primary"
      loading={importing}
      onClick={handleImport}
      style={primaryButtonStyle}
    >
      确认导入 {parsed.topics.length} 条
    </Button>
  )}
```

- [ ] **Step 8.9：typecheck + 手动验证**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 8.10：Commit**

```bash
git add src/renderer/src/components/ImportTopicsModal.tsx src/shared/types.ts src/preload/index.ts src/main/ipc/import.ipc.ts
git commit -m "feat(import): integrate FieldMappingPanel into ImportTopicsModal flow"
```

---

## Task 9：ValueMappingPanel 多选批量 + 智能推荐

**Files:**
- Modify: `src/renderer/src/components/import/ValueMappingPanel.tsx`

- [ ] **Step 9.1：扩展 imports + 类型**

在 ValueMappingPanel.tsx 顶部 import 中追加 `Checkbox, Tooltip, Modal` 和 `ThunderboltOutlined`：

```typescript
import { useState, useMemo } from 'react'
import {
  Card,
  Tag,
  Select,
  Space,
  Button,
  Typography,
  Divider,
  Alert,
  Checkbox,
  Tooltip,
  Modal
} from 'antd'
import {
  SwapOutlined,
  PlusCircleOutlined,
  MinusCircleOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
```

在文件顶部 import 区域追加推荐算法 import：

```typescript
import { recommendMappings, type Recommendation } from '../../../../main/services/value-recommender'
```

注意：与 Task 8 同样问题，渲染进程不能直接 import main 模块。**调整：把 `value-recommender.ts` 移到 `src/shared/utils/value-recommender.ts`**（纯函数无 main 依赖），import-engine 不需要 re-export。

执行：把 `src/main/services/value-recommender.ts` 移动到 `src/shared/utils/value-recommender.ts`；把测试文件移到 `src/shared/utils/__tests__/value-recommender.test.ts`。

更新 ValueMappingPanel import：

```typescript
import { recommendMappings, type Recommendation } from '../../../shared/utils/value-recommender'
```

- [ ] **Step 9.2：扩展组件 state**

在 `const [mapping, setMapping] = useState<ValueMapping>(initialMapping)` 后追加：

```typescript
const [selectedValues, setSelectedValues] = useState<Record<CandidateField, Set<string>>>(
  {} as Record<CandidateField, Set<string>>
)
const [recommendations, setRecommendations] = useState<
  Record<CandidateField, Recommendation[]>
>({} as Record<CandidateField, Recommendation[]>)
```

- [ ] **Step 9.3：添加多选/批量/推荐辅助函数**

在 `updateMapping` 函数后追加：

```typescript
const toggleSelect = (field: CandidateField, value: string) => {
  setSelectedValues((prev) => {
    const next = { ...prev }
    const set = new Set(next[field] ?? [])
    if (set.has(value)) set.delete(value)
    else set.add(value)
    next[field] = set
    return next
  })
}

const handleSmartRecommend = (field: CandidateField, values: Array<{ value: string; count: number }>) => {
  const newValues = values.map((v) => v.value)
  const recs = recommendMappings(newValues, candidateOptions[field])
  setRecommendations((prev) => ({ ...prev, [field]: recs }))
  // 自动应用所有推荐：用户可逐条撤销
  const next: ValueMapping = { ...mapping }
  if (!next[field]) next[field] = {}
  for (const r of recs) {
    next[field]![r.originValue] = { action: 'map', target: r.recommendedTarget }
  }
  updateMapping(next)
}

const handleBatchMap = (field: CandidateField) => {
  const selected = selectedValues[field]
  if (!selected || selected.size === 0) return
  // 弹 Modal 让用户选目标值
  let target = candidateOptions[field][0] ?? ''
  Modal.confirm({
    title: `批量映射 ${selected.size} 个新值到...`,
    content: (
      <Select
        style={{ width: '100%', marginTop: 8 }}
        defaultValue={target}
        onChange={(v) => (target = v)}
        options={candidateOptions[field].map((c) => ({ value: c, label: c }))}
        showSearch
      />
    ),
    onOk: () => {
      const next: ValueMapping = { ...mapping }
      if (!next[field]) next[field] = {}
      for (const v of selected) {
        next[field]![v] = { action: 'map', target }
      }
      updateMapping(next)
      setSelectedValues((prev) => ({ ...prev, [field]: new Set() }))
    }
  })
}

const handleApplySingleRecommend = (field: CandidateField, rec: Recommendation) => {
  const next: ValueMapping = { ...mapping }
  if (!next[field]) next[field] = {}
  next[field]![rec.originValue] = { action: 'map', target: rec.recommendedTarget }
  updateMapping(next)
}
```

注意：`Modal.confirm` 的 content 用 React 节点可行，但 Select 的受控需要 useRef 或 useState。简化方案：用 `Modal.confirm` + `prompt` 不优雅，改为弹一个 `<Modal>` 组件用 state 控制。**简化实现**：直接用 `window.prompt` 让用户输入目标值（不优雅但可用）。或更优雅——加一个内部 state 控制的批量映射 Modal。

**采用简化方案：** 用 Modal.confirm 的 content 渲染 Select，用 closure 捕获选择值。但 antd Modal.confirm 的 content 不会响应重新渲染。**最简实现：** 加一个内部 state `batchMapModal: { field: CandidateField; open: boolean }` 和 `batchMapTarget: string`，渲染一个普通 `<Modal>` 组件。

更新实现：

```typescript
const [batchMapModal, setBatchMapModal] = useState<{
  field: CandidateField | null
  open: boolean
}>({ field: null, open: false })
const [batchMapTarget, setBatchMapTarget] = useState<string>('')

const handleBatchMap = (field: CandidateField) => {
  const selected = selectedValues[field]
  if (!selected || selected.size === 0) return
  setBatchMapTarget(candidateOptions[field][0] ?? '')
  setBatchMapModal({ field, open: true })
}

const confirmBatchMap = () => {
  if (!batchMapModal.field || !batchMapTarget) return
  const field = batchMapModal.field
  const selected = selectedValues[field]
  if (!selected) return
  const next: ValueMapping = { ...mapping }
  if (!next[field]) next[field] = {}
  for (const v of selected) {
    next[field]![v] = { action: 'map', target: batchMapTarget }
  }
  updateMapping(next)
  setSelectedValues((prev) => ({ ...prev, [field]: new Set() }))
  setBatchMapModal({ field: null, open: false })
}
```

- [ ] **Step 9.4：每行新值前加 Checkbox**

把现有渲染 `{item.values.map(({ value, count }) => { ... })}` 改为：

```typescript
{item.values.map(({ value, count }) => {
  const rule = mapping[item.field]?.[value]
  const action = rule?.action ?? 'keep'
  const isSelected = selectedValues[item.field]?.has(value) ?? false
  const rec = recommendations[item.field]?.find((r) => r.originValue === value)
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
      <Checkbox
        checked={isSelected}
        onChange={(e) => toggleSelect(item.field, value)}
      />
      <Tag color="orange" style={{ minWidth: 80, textAlign: 'center' }}>
        {value}
      </Tag>
      <Text type="secondary" style={{ fontSize: 11 }}>×{count}</Text>
      {rec && (
        <Tooltip title={`推荐匹配度 ${(rec.score * 100).toFixed(0)}%`}>
          <Tag
            color="gold"
            style={{ cursor: 'pointer', fontSize: 11 }}
            onClick={() => handleApplySingleRecommend(item.field, rec)}
          >
            <ThunderboltOutlined /> 推荐→{rec.recommendedTarget}
          </Tag>
        </Tooltip>
      )}
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
```

- [ ] **Step 9.5：每个字段分组底部加批量工具栏**

在 `{item.values.map(...)}` 渲染块后、`</div>` 闭合前追加：

```typescript
<Space style={{ marginTop: 4, marginLeft: 8 }}>
  <Button
    size="small"
    icon={<ThunderboltOutlined />}
    onClick={() => handleSmartRecommend(item.field, item.values)}
  >
    智能推荐
  </Button>
  <Button
    size="small"
    disabled={!selectedValues[item.field] || selectedValues[item.field].size === 0}
    onClick={() => handleBatchMap(item.field)}
  >
    批量映射选中项（{selectedValues[item.field]?.size ?? 0}）
  </Button>
  <Button
    size="small"
    type="link"
    disabled={!selectedValues[item.field] || selectedValues[item.field].size === 0}
    onClick={() =>
      setSelectedValues((prev) => ({ ...prev, [item.field]: new Set() }))
    }
  >
    清空选中
  </Button>
</Space>
```

- [ ] **Step 9.6：在组件末尾渲染批量映射 Modal**

在 `<Card>` 闭合前（最后）追加：

```typescript
<Modal
  title={batchMapModal.field ? `批量映射 ${FIELD_LABEL[batchMapModal.field]}` : ''}
  open={batchMapModal.open}
  onOk={confirmBatchMap}
  onCancel={() => setBatchMapModal({ field: null, open: false })}
  okText="确认映射"
  cancelText="取消"
>
  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
    将把 {selectedValues[batchMapModal.field ?? 'type']?.size ?? 0} 个新值映射到：
  </Text>
  <Select
    style={{ width: '100%' }}
    value={batchMapTarget}
    onChange={setBatchMapTarget}
    options={
      batchMapModal.field
        ? candidateOptions[batchMapModal.field].map((c) => ({ value: c, label: c }))
        : []
    }
    showSearch
  />
</Modal>
```

- [ ] **Step 9.7：typecheck 验证**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 9.8：Commit**

```bash
git add src/renderer/src/components/import/ValueMappingPanel.tsx src/shared/utils/value-recommender.ts src/shared/utils/__tests__/value-recommender.test.ts src/main/services/__tests__/value-recommender.test.ts
git commit -m "feat(import): batch mapping + smart recommendations in ValueMappingPanel"
```

注意：移动 value-recommender 文件后，原 main/services 下的文件需删除。

---

## Task 10：custom-field IPC + Zustand store + preload

**Files:**
- Create: `src/main/ipc/custom-field.ipc.ts`
- Create: `src/renderer/src/stores/customFieldStore.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**注意：** 本 Task 必须在 Task 8 之前完成（Task 8 依赖 `window.customFieldAPI`）。

- [ ] **Step 10.1：创建 custom-field.ipc.ts**

```typescript
// src/main/ipc/custom-field.ipc.ts
import { ipcMain } from 'electron'
import { customFieldService } from '../services/custom-field-service'
import { IPC_CHANNELS, type ApiResponse, type CustomField, type CustomFieldType } from '../../shared/types'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    return { success: true, data: fn() }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerCustomFieldIpc(): void {
  ipcMain.handle(IPC_CHANNELS.CUSTOM_FIELD_LIST, () =>
    wrap(() => customFieldService.listAll())
  )

  ipcMain.handle(
    IPC_CHANNELS.CUSTOM_FIELD_CREATE,
    (_e, label: string, type: CustomFieldType) =>
      wrap(() => customFieldService.createField(label, type))
  )

  ipcMain.handle(
    IPC_CHANNELS.CUSTOM_FIELD_UPDATE,
    (
      _e,
      fieldKey: string,
      patch: Partial<Pick<CustomField, 'field_label' | 'sort_order'>>
    ) => wrap(() => customFieldService.updateField(fieldKey, patch))
  )

  ipcMain.handle(IPC_CHANNELS.CUSTOM_FIELD_DELETE, (_e, fieldKey: string) =>
    wrap(() => customFieldService.deleteField(fieldKey))
  )
}
```

- [ ] **Step 10.2：在 ipc/index.ts 注册**

```typescript
import { registerCustomFieldIpc } from './custom-field.ipc'

export function registerAllIpc(): void {
  registerSystemIpc()
  registerTopicIpc()
  registerEventIpc()
  registerDrawIpc()
  registerAuditIpc()
  registerImportIpc()
  registerExportIpc()
  registerDedupIpc()
  registerCustomFieldIpc()
  console.log('[main] All IPC handlers registered')
}
```

- [ ] **Step 10.3：在 preload/index.ts 暴露 customFieldAPI**

在 preload/index.ts 顶部 imports 中追加类型：

```typescript
import {
  // ...现有 imports
  type CustomField,
  type CustomFieldType
} from '../shared/types'
```

在 `systemAPI` 对象定义后追加：

```typescript
// ============================================================
// 自定义字段 API
// ============================================================
const customFieldAPI = {
  list: () => invoke<CustomField[]>(IPC_CHANNELS.CUSTOM_FIELD_LIST),
  create: (label: string, type: CustomFieldType) =>
    invoke<CustomField>(IPC_CHANNELS.CUSTOM_FIELD_CREATE, label, type),
  update: (
    fieldKey: string,
    patch: Partial<Pick<CustomField, 'field_label' | 'sort_order'>>
  ) => invoke<void>(IPC_CHANNELS.CUSTOM_FIELD_UPDATE, fieldKey, patch),
  delete: (fieldKey: string) => invoke<void>(IPC_CHANNELS.CUSTOM_FIELD_DELETE, fieldKey)
}
```

在 `contextBridge.exposeInMainWorld` 块中追加：

```typescript
contextBridge.exposeInMainWorld('customFieldAPI', customFieldAPI)
```

在非 contextIsolated 分支的 `GlobalWindow` 类型和赋值中也追加：

```typescript
type GlobalWindow = Window & {
  // ...现有
  customFieldAPI: typeof customFieldAPI
}
const w = window as unknown as GlobalWindow
// ...现有
w.customFieldAPI = customFieldAPI
```

- [ ] **Step 10.4：在 preload/index.d.ts 添加 customFieldAPI 类型声明**

打开 `src/preload/index.d.ts`，在 `interface Window` 中追加：

```typescript
customFieldAPI: {
  list: () => Promise<import('../shared/types').CustomField[]>
  create: (
    label: string,
    type: import('../shared/types').CustomFieldType
  ) => Promise<import('../shared/types').CustomField>
  update: (
    fieldKey: string,
    patch: Partial<Pick<import('../shared/types').CustomField, 'field_label' | 'sort_order'>>
  ) => Promise<void>
  delete: (fieldKey: string) => Promise<void>
}
```

- [ ] **Step 10.5：创建 customFieldStore.ts**

```typescript
// src/renderer/src/stores/customFieldStore.ts
import { create } from 'zustand'
import type { CustomField, CustomFieldType, ApiResponse } from '../../../shared/types'

interface CustomFieldState {
  fields: CustomField[]
  loading: boolean
  error: string | null

  fetchAll: () => Promise<void>
  create: (label: string, type: CustomFieldType) => Promise<CustomField | null>
  update: (
    fieldKey: string,
    patch: Partial<Pick<CustomField, 'field_label' | 'sort_order'>>
  ) => Promise<boolean>
  remove: (fieldKey: string) => Promise<boolean>
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T
  throw new Error(res.error || '未知错误')
}

export const useCustomFieldStore = create<CustomFieldState>((set, get) => ({
  fields: [],
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null })
    try {
      const res = await window.customFieldAPI.list()
      const data = extractError<CustomField[]>(res)
      set({ fields: data, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  create: async (label, type) => {
    try {
      const res = await window.customFieldAPI.create(label, type)
      const created = extractError<CustomField>(res)
      set((s) => ({ fields: [...s.fields, created] }))
      return created
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  update: async (fieldKey, patch) => {
    try {
      const res = await window.customFieldAPI.update(fieldKey, patch)
      extractError(res)
      set((s) => ({
        fields: s.fields.map((f) =>
          f.field_key === fieldKey ? { ...f, ...patch } : f
        )
      }))
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return false
    }
  },

  remove: async (fieldKey) => {
    try {
      const res = await window.customFieldAPI.delete(fieldKey)
      extractError(res)
      set((s) => ({ fields: s.fields.filter((f) => f.field_key !== fieldKey) }))
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return false
    }
  }
}))
```

- [ ] **Step 10.6：typecheck 验证**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 10.7：Commit**

```bash
git add src/main/ipc/custom-field.ipc.ts src/main/ipc/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/stores/customFieldStore.ts
git commit -m "feat(custom-field): IPC + Zustand store + preload exposure"
```

---

## Task 11：candidate-service 加 listDBFieldValues 合并

**Files:**
- Modify: `src/main/services/candidate-service.ts`
- Modify: `src/main/ipc/system.ipc.ts`（如果 SYSTEM_GET_CANDIDATES 在这里）

- [ ] **Step 11.1：在 candidate-service.ts 新增 getMergedCandidatesWithDB**

在文件末尾追加：

```typescript
import { topicRepo } from '../db/repository/topic.repo'

/**
 * 获取合并后的候选值（系统候选 + 用户扩展 + DB 实际值）。
 * 用于 FilterPanel 等需要展示「所有可选值」的场景。
 * DB 实际值追加在最后，去重。
 */
export function getMergedCandidatesWithDB(): Record<CandidateField, string[]> {
  const system = getMergedCandidates()
  const dbValues = topicRepo.listDistinctValues([
    'type',
    'domain',
    'difficulty',
    'source',
    'source_type'
  ])
  const merged: Record<CandidateField, string[]> = { ...system }
  for (const k of Object.keys(dbValues) as CandidateField[]) {
    const set = new Set([...(system[k] ?? []), ...dbValues[k].map((r) => r.value)])
    merged[k] = Array.from(set)
  }
  return merged
}
```

注意：import 需要放在文件顶部，不能放在末尾。修改为：在文件顶部 import 区追加 `import { topicRepo } from '../db/repository/topic.repo'`，然后函数定义放文件末尾。

- [ ] **Step 11.2：在 system.ipc.ts 修改 SYSTEM_GET_CANDIDATES handler 用合并版本**

打开 `src/main/ipc/system.ipc.ts`，找到 `SYSTEM_GET_CANDIDATES` 的 handler，把 `getMergedCandidates()` 改为 `getMergedCandidatesWithDB()`：

```typescript
import { getMergedCandidatesWithDB } from '../services/candidate-service'

ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_CANDIDATES, () => {
  return { success: true, data: getMergedCandidatesWithDB() }
})
```

- [ ] **Step 11.3：typecheck + 运行已有测试**

Run: `npm run typecheck && npm test`
Expected: 无错误，所有测试通过

- [ ] **Step 11.4：Commit**

```bash
git add src/main/services/candidate-service.ts src/main/ipc/system.ipc.ts
git commit -m "feat(candidate): merge DB distinct values into system candidates"
```

---

## Task 12：FilterPanel 候选合并 + 自定义字段筛选器

**Files:**
- Modify: `src/renderer/src/components/FilterPanel.tsx`
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`（传入 customFields 和 customFieldOptions props）

- [ ] **Step 12.1：FilterPanel 改造为动态候选 + 自定义字段渲染**

整体替换 FilterPanel.tsx（保留原结构，加动态候选拉取和自定义字段筛选器）：

在文件顶部 imports 中追加：

```typescript
import { useEffect, useState } from 'antd';  // 已有
import { useCustomFieldStore } from '../stores/customFieldStore';
import type { CustomField } from '../../../shared/types';
```

注意：`useEffect` 和 `useState` 已在 React 中，需要确认 import 来源。把第一行 `import { Input, Select, ... } from 'antd'` 之外的 React hooks import 补上。

在 `FilterPanelProps` 接口中追加：

```typescript
export interface FilterPanelProps {
  // ... 现有
  /** 自定义字段元数据（由父组件 TopicLibrary 传入） */
  customFields?: CustomField[]
  /** 自定义字段候选值：fieldKey → 候选值数组 */
  customFieldOptions?: Record<string, string[]>
}
```

在组件函数签名中接收新 props：

```typescript
export default function FilterPanel({
  filter,
  onChange,
  onReset,
  tagOptions = [],
  includeKeywords = [],
  excludeKeywords = [],
  onIncludeKeywordsChange,
  onExcludeKeywordsChange,
  customFields = [],
  customFieldOptions = {}
}: FilterPanelProps) {
```

在组件内（在 `const cfg = loadTagDisplayConfig(settings)` 前）追加 DB 值合并 state：

```typescript
const [dbMergedOptions, setDbMergedOptions] = useState<{
  type: string[]
  domain: string[]
  difficulty: string[]
  source: string[]
  source_type: string[]
} | null>(null)

useEffect(() => {
  window.topicAPI
    .listValues(['type', 'domain', 'difficulty', 'source', 'source_type'])
    .then((res) => {
      if (res.success && res.data) {
        const merged = {
          type: Array.from(new Set([...SYSTEM_CANDIDATES.type, ...res.data.type?.map((r) => r.value) ?? []])),
          domain: Array.from(new Set([...SYSTEM_CANDIDATES.domain, ...res.data.domain?.map((r) => r.value) ?? []])),
          difficulty: Array.from(new Set([...SYSTEM_CANDIDATES.difficulty, ...res.data.difficulty?.map((r) => r.value) ?? []])),
          source: Array.from(new Set([...SYSTEM_CANDIDATES.source, ...res.data.source?.map((r) => r.value) ?? []])),
          source_type: Array.from(new Set([...SYSTEM_CANDIDATES.source_type, ...res.data.source_type?.map((r) => r.value) ?? []]))
        }
        setDbMergedOptions(merged)
      }
    })
    .catch(() => {
      // 拉取失败用 SYSTEM_CANDIDATES 兜底
    })
}, [])
```

把 `TYPE_OPTIONS / DOMAIN_OPTIONS / ...` 的使用改为动态：

```typescript
const TYPE_OPTS = dbMergedOptions?.type ?? TYPE_OPTIONS
const DOMAIN_OPTS = dbMergedOptions?.domain ?? DOMAIN_OPTIONS
const DIFFICULTY_OPTS = dbMergedOptions?.difficulty ?? DIFFICULTY_OPTIONS
const SOURCE_OPTS = dbMergedOptions?.source ?? SOURCE_OPTIONS
const SOURCE_TYPE_OPTS = dbMergedOptions?.source_type ?? SOURCE_TYPE_OPTIONS
```

注意：原 `typeOpts / diffOpts / sourceTypeOpts` 用 `filterOptions(TYPE_OPTIONS, ...)`，改为 `filterOptions(TYPE_OPTS, ...)` 等。

把渲染中 `DOMAIN_OPTIONS.map(...)` 等改为 `DOMAIN_OPTS.map(...)`，`SOURCE_OPTIONS.map(...)` 改为 `SOURCE_OPTS.map(...)`。

- [ ] **Step 12.2：在面板底部渲染自定义字段筛选器**

在「标签筛选」块后、「已选摘要 + 重置」前追加：

```typescript
{customFields.length > 0 && (
  <>
    <Divider orientation="left" plain style={{ margin: `${spacing.sm} 0` }}>
      自定义字段
    </Divider>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
      {customFields.map((cf) => {
        const opts = customFieldOptions[cf.field_key] ?? []
        return (
          <Field key={cf.field_key} label={cf.field_label}>
            {cf.field_type === 'tags' ? (
              <Select
                size="small"
                allowClear
                mode="multiple"
                maxTagCount="responsive"
                placeholder="全部"
                style={{ width: '100%' }}
                value={(filter.custom_filters?.[cf.field_key] as unknown as string[]) ?? []}
                onChange={(v) => {
                  const next = { ...filter.custom_filters }
                  if (v && (v as string[]).length > 0) {
                    next[cf.field_key] = (v as string[]).join(',')
                  } else {
                    delete next[cf.field_key]
                  }
                  onChange({ custom_filters: next })
                }}
                options={opts.map((o) => ({ label: o, value: o }))}
              />
            ) : (
              <Select
                size="small"
                allowClear
                placeholder="全部"
                style={{ width: '100%' }}
                value={filter.custom_filters?.[cf.field_key] ?? undefined}
                onChange={(v) => {
                  const next = { ...filter.custom_filters }
                  if (v) next[cf.field_key] = v
                  else delete next[cf.field_key]
                  onChange({ custom_filters: next })
                }}
                options={opts.map((o) => ({ label: o, value: o }))}
              />
            )}
          </Field>
        )
      })}
    </div>
  </>
)}
```

注意：`custom_filters` 类型是 `Record<string, string>`，tags 多选需用逗号拼接（与 buildWhereClause 的实现一致——但当前 buildWhereClause 只支持单值 = 比较，多值 tags 字段需要 IN 查询或 json_each）。**简化：自定义字段 tags 类型在筛选面板用单选**（与 string 相同），多选不支持。

调整：tags 类型也用单选 Select。简化实现。

- [ ] **Step 12.3：TopicLibrary.tsx 传 customFields + customFieldOptions 给 FilterPanel**

在 TopicLibrary.tsx 中找到 FilterPanel 使用处，加 props：

```typescript
import { useCustomFieldStore } from '../stores/customFieldStore'

// 组件内
const customFields = useCustomFieldStore((s) => s.fields)
const fetchAllCustomFields = useCustomFieldStore((s) => s.fetchAll)
const [customFieldOptions, setCustomFieldOptions] = useState<Record<string, string[]>>({})

useEffect(() => {
  fetchAllCustomFields()
}, [fetchAllCustomFields])

useEffect(() => {
  // 拉取每个 string 类型自定义字段的 distinct 值（用 listValues 或新 IPC）
  if (customFields.length === 0) return
  // 用 topicAPI.listValues 拉取（需支持自定义字段，但当前 listDistinctValues 已支持任意合法字段名）
  // 简化：用 countByDimension 拉取每个字段的值分布
  Promise.all(
    customFields.map((cf) =>
      cf.field_type === 'tags'
        ? window.topicAPI.listCustomFieldTags(cf.field_key).then((res) => ({
            fieldKey: cf.field_key,
            values: res.success && res.data ? res.data.map((r) => r.value) : []
          }))
        : window.topicAPI.countByDimension(cf.field_key).then((res) => ({
            fieldKey: cf.field_key,
            values: res.success && res.data ? res.data.map((r) => r.value) : []
          }))
    )
  ).then((results) => {
    const opts: Record<string, string[]> = {}
    for (const r of results) opts[r.fieldKey] = r.values
    setCustomFieldOptions(opts)
  })
}, [customFields])
```

在 `<FilterPanel ... />` 调用处追加：

```typescript
<FilterPanel
  // ... 现有 props
  customFields={customFields}
  customFieldOptions={customFieldOptions}
/>
```

- [ ] **Step 12.4：topicStore.setFilter 透传 custom_filters**

`setFilter` 用 spread 已经能透传，但 `resetFilter` 中的 `DEFAULT_FILTER` 不含 `custom_filters`，会自动清除。无需修改 topicStore.ts。

- [ ] **Step 12.5：typecheck + 运行测试**

Run: `npm run typecheck && npm test`
Expected: 无错误，所有测试通过

- [ ] **Step 12.6：Commit**

```bash
git add src/renderer/src/components/FilterPanel.tsx src/renderer/src/pages/TopicLibrary.tsx
git commit -m "feat(filter): merge DB values + render custom field filters"
```

---

## Task 13：TopicLibrary DIMENSIONS 加载自定义字段

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

**目的：** 把 DIMENSIONS 从静态常量改为 useMemo 合并系统 8 维 + 自定义字段；分类树加载分支处理自定义字段。

- [ ] **Step 13.1：找到 TopicLibrary.tsx 中 DIMENSIONS 定义**

打开 `src/renderer/src/pages/TopicLibrary.tsx`，找到 `DIMENSIONS` 常量定义（类似 `const DIMENSIONS: DimensionMeta[] = [...]`）。

- [ ] **Step 13.2：把 DIMENSIONS 改为 useMemo 合并自定义字段**

把 `const DIMENSIONS = [...]` 改为：

```typescript
const SYSTEM_DIMENSIONS: DimensionMeta[] = [
  // ... 原 DIMENSIONS 数组内容
]

const dimensions = useMemo<DimensionMeta[]>(() => {
  const customDims: DimensionMeta[] = customFields.map((f) => ({
    key: f.field_key,
    label: f.field_label,
    icon: f.field_type === 'tags' ? <TagsOutlined /> : <TagOutlined />,
    source: f.field_type === 'tags' ? 'ipc_custom_tags' : 'ipc_custom_count'
  }))
  return [...SYSTEM_DIMENSIONS, ...customDims]
}, [customFields])
```

注意：需 import `useMemo` 和 `TagsOutlined, TagOutlined` 图标。`DimensionMeta` 类型需支持 `'ipc_custom_count' | 'ipc_custom_tags'` 作为 source 值。

- [ ] **Step 13.3：分类树数据加载 useEffect 加分支**

找到加载分类树数据的 useEffect（dispatch 不同 source），在 switch/if 中追加：

```typescript
case 'ipc_custom_count':
  // 自定义 string 字段：用 countByDimension 拉取值分布
  window.topicAPI
    .countByDimension(dim.key)
    .then((res) => {
      if (res.success && res.data) {
        // 把 null/空值映射为 '__unset__' → 显示为「(未设置)」
        const nodes = res.data.map((r) => ({
          key: `${dim.key}:${r.value ?? '__unset__'}`,
          label: r.value ?? '(未设置)',
          count: r.count
        }))
        // 更新对应 dim 的 nodes
        // ...具体 setState 视实现而定
      }
    })
  break
case 'ipc_custom_tags':
  // 自定义 tags 字段：用 listCustomFieldTags 拉取 tag 分布
  window.topicAPI
    .listCustomFieldTags(dim.key)
    .then((res) => {
      if (res.success && res.data) {
        // ...同上
      }
    })
  break
```

具体实现需根据 TopicLibrary 现有结构填充。

- [ ] **Step 13.4：选中分类节点的 setFilter 逻辑加 custom_filters 分支**

找到点击分类节点的回调函数，在已有 `switch(dim.source)` 中追加：

```typescript
case 'ipc_custom_count':
case 'ipc_custom_tags':
  store.setFilter({
    custom_filters: { [dim.key]: nodeKey }
  })
  break
```

注意：`nodeKey` 含 `__unset__` 时由 buildWhereClause 翻译为 IS NULL。

- [ ] **Step 13.5：typecheck 验证**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 13.6：Commit**

```bash
git add src/renderer/src/pages/TopicLibrary.tsx
git commit -m "feat(library): load custom fields into dimension tree and filter"
```

---

## Task 14：TopicEditModal 自定义字段编辑

**Files:**
- Create: `src/renderer/src/components/TopicCustomFields.tsx`
- Modify: `src/renderer/src/components/TopicEditModal.tsx`

- [ ] **Step 14.1：创建 TopicCustomFields.tsx**

```typescript
// src/renderer/src/components/TopicCustomFields.tsx
// ============================================================
// TopicCustomFields — 辩题编辑弹窗中的自定义字段渲染器
//
// 接收 customFields 元数据和当前 custom_data 值，渲染表单项：
//   - string 类型：Input 或 Select（options 来自 DB 实际值）
//   - tags 类型：Select mode="tags"
// ============================================================

import { useEffect, useState } from 'react'
import { Form, Select, Input, Divider, Spin } from 'antd'
import type { CustomField, CustomFieldValue } from '../../../shared/types'

export interface TopicCustomFieldsProps {
  customFields: CustomField[]
  /** 当前 custom_data 值（用作 Form initialValue） */
  value?: Record<string, CustomFieldValue> | null
  /** 自定义字段候选值：fieldKey → 候选值数组（由父组件传入） */
  customFieldOptions?: Record<string, string[]>
}

export default function TopicCustomFields({
  customFields,
  value,
  customFieldOptions = {}
}: TopicCustomFieldsProps) {
  if (customFields.length === 0) return null

  return (
    <>
      <Divider orientation="left" plain>
        自定义字段
      </Divider>
      {customFields.map((cf) => {
        const opts = customFieldOptions[cf.field_key] ?? []
        const fieldName = ['custom_data', cf.field_key]
        if (cf.field_type === 'tags') {
          return (
            <Form.Item key={cf.field_key} label={cf.field_label} name={fieldName}>
              <Select
                mode="tags"
                allowClear
                placeholder="输入或选择标签"
                options={opts.map((o) => ({ label: o, value: o }))}
              />
            </Form.Item>
          )
        }
        // string 类型：若有候选值用 Select，否则用 Input
        if (opts.length > 0) {
          return (
            <Form.Item key={cf.field_key} label={cf.field_label} name={fieldName}>
              <Select
                allowClear
                placeholder="选择或输入"
                showSearch
                options={opts.map((o) => ({ label: o, value: o }))}
              />
            </Form.Item>
          )
        }
        return (
          <Form.Item key={cf.field_key} label={cf.field_label} name={fieldName}>
            <Input placeholder="输入值" />
          </Form.Item>
        )
      })}
    </>
  )
}
```

- [ ] **Step 14.2：在 TopicEditModal.tsx 嵌入 TopicCustomFields**

在 TopicEditModal.tsx 顶部 import 中追加：

```typescript
import TopicCustomFields from './TopicCustomFields'
import { useCustomFieldStore } from '../stores/customFieldStore'
```

在组件函数内追加：

```typescript
const customFields = useCustomFieldStore((s) => s.fields)
const fetchAllCustomFields = useCustomFieldStore((s) => s.fetchAll)
const [customFieldOptions, setCustomFieldOptions] = useState<Record<string, string[]>>({})

useEffect(() => {
  fetchAllCustomFields()
}, [fetchAllCustomFields])

useEffect(() => {
  if (customFields.length === 0) return
  Promise.all(
    customFields.map((cf) =>
      cf.field_type === 'tags'
        ? window.topicAPI.listCustomFieldTags(cf.field_key).then((res) => ({
            fieldKey: cf.field_key,
            values: res.success && res.data ? res.data.map((r) => r.value) : []
          }))
        : window.topicAPI.countByDimension(cf.field_key).then((res) => ({
            fieldKey: cf.field_key,
            values: res.success && res.data ? res.data.map((r) => r.value) : []
          }))
    )
  ).then((results) => {
    const opts: Record<string, string[]> = {}
    for (const r of results) opts[r.fieldKey] = r.values
    setCustomFieldOptions(opts)
  })
}, [customFields])
```

在 Form 内系统字段表单项之后、提交按钮之前追加：

```typescript
<TopicCustomFields
  customFields={customFields}
  value={topic?.custom_data}
  customFieldOptions={customFieldOptions}
/>
```

- [ ] **Step 14.3：computeInitialValues 加 custom_data**

找到 `computeInitialValues` 函数，在编辑模式返回值中追加 `custom_data: topic.custom_data ?? {}`，新建模式追加 `custom_data: {}`。

- [ ] **Step 14.4：表单提交时把 custom_data 传给 update**

找到表单 onFinish 处理函数，确认 `custom_data` 字段已包含在 form values 中（Form.Item name 用 `['custom_data', field_key]`，antd 会自动嵌套为 `custom_data: { field_key: value }`）。在调用 `window.topicAPI.update(id, values)` 时，确保 `custom_data` 被传递。

- [ ] **Step 14.5：typecheck 验证**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 14.6：Commit**

```bash
git add src/renderer/src/components/TopicCustomFields.tsx src/renderer/src/components/TopicEditModal.tsx
git commit -m "feat(edit): support editing custom fields in TopicEditModal"
```

---

## Task 15：全量测试 + E2E 验证 + 最终 commit

- [ ] **Step 15.1：运行类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 15.2：运行全部单元测试**

Run: `npm test`
Expected: 全部通过；新增测试用例：
- `import-engine.test.ts`：6 个新测试（unmatchedColumns + applyFieldMapping）
- `value-recommender.test.ts`：11 个测试（levenshtein + recommendMappings）

- [ ] **Step 15.3：启动应用**

Run: `npm run dev`
Expected: 应用正常启动，DB 初始化、IPC 注册、官方题库加载均无错误

- [ ] **Step 15.4：手动 E2E 验证 9 场景**

1. **场景 1**：导入含「赛事」列的 Excel → Step 2a 出现 FieldMappingPanel → 选「创建新字段」→ 输入「赛事」+ 文本类型 → 点确认创建 → 点「应用字段映射，继续」→ 预览表显示「赛事」列 → 完成导入
2. **场景 2**：导入含「入门级」「初级」「basic」难度的 Excel → Step 2b ValueMappingPanel 显示 → 多选 3 个新值 → 点「批量映射选中项」→ 选目标「入门级」→ 确认 → 3 个值都映射到「入门级」
3. **场景 3**：导入含「进阶」难度的 Excel → 点「智能推荐」按钮 → 「进阶」旁出现 ✨ 推荐徽章「推荐→进阶级」→ 点击徽章 → 单条映射应用
4. **场景 4**：题库页左侧分类树出现「赛事」维度 → 点击「赛事 / 新国辩」→ 列表筛选正确
5. **场景 5**：FilterPanel「类型」选项含 DB 实际值（如保留的新值）
6. **场景 6**：FilterPanel 显示「赛事」Select → 选「新国辩」→ 列表筛选正确
7. **场景 7**：抽取页 DrawConfigPanel 显示「赛事」筛选（复用 FilterPanel，自动受益）
8. **场景 8**：编辑某题 → 弹窗底部出现「赛事」字段 → 修改值 → 保存 → 重新打开仍正确
9. **场景 9**：在「设置 - 自定义字段」中删除「赛事」→ 分类树/筛选/编辑都消失；旧题 custom_data 仍保留但不显示

- [ ] **Step 15.5：修复 E2E 中发现的问题（如有）**

记录问题 → 修复 → 回归测试

- [ ] **Step 15.6：最终 commit**

```bash
git add .
git commit -m "feat(import): dynamic custom fields & batch value mapping - full implementation"
```

---

## 依赖与执行顺序

```
Task 5 (import-engine 测试) ─┐
                            ├─→ Task 7 (FieldMappingPanel)
Task 6 (recommender) ───────┤                        │
                            │                        ↓
                            │              Task 8 (ImportTopicsModal 集成)
                            │                        │
                            ↓                        ↓
Task 10 (customField IPC) ──┼────────────→ Task 9 (ValueMappingPanel 多选)
                            │
                            ├─→ Task 12 (FilterPanel)
                            ├─→ Task 13 (TopicLibrary)
                            └─→ Task 14 (TopicEditModal)

Task 11 (listDBFieldValues) ─→ Task 12 (FilterPanel 候选合并)

Task 15 (全量验证) ← 依赖所有前置 Task
```

**执行顺序建议：**
1. **批次 1**：Task 5 + Task 6 + Task 10 + Task 11（互不依赖，可并行）
2. **批次 2**：Task 7 + Task 9（依赖批次 1 的 5/6/10）
3. **批次 3**：Task 8 + Task 12 + Task 13 + Task 14（依赖批次 1/2）
4. **批次 4**：Task 15（最终验证）

---

## 假设与风险（沿用原 plan）

1. JSON 列存储方案不变；自定义字段类型仅 string/tags
2. labelToKey 中文保留原值（不引入 pinyin 库）
3. 删除自定义字段不清理 topics.custom_data 旧值（避免大批量 UPDATE）
4. 自定义字段不进入 SYSTEM_CANDIDATES 持久化机制，候选值由 DB 实际值动态拉取
5. 「恢复初始设置」未清理 custom_fields 表 → 在 Task 15 后追加小修复（可选）

---

## Self-Review 结果

✅ **Spec coverage：**
- 用户诉求 1「新字段接入分类/筛选/抽取筛选/编辑」→ Task 7/8/10/12/13/14 覆盖
- 用户诉求 2「难度新值批量映射」→ Task 9 覆盖
- 智能推荐 → Task 6 + Task 9 集成
- 候选值合并 → Task 11 + Task 12 集成

✅ **Placeholder scan：** 无 TBD/TODO，每个 Step 含具体文件路径与代码块。Task 13.3 中「具体实现需根据 TopicLibrary 现有结构填充」属于需要现场查看的细节，但已给出明确逻辑分支。

✅ **Type consistency：**
- `CustomField / FieldMapping / FieldMappingAction / Recommendation` 在 Task 1 已定义
- `customFieldAPI` 在 preload/index.ts 和 index.d.ts 中签名一致
- `getMergedCandidatesWithDB` 返回类型与 `getMergedCandidates` 一致
- `TopicFilter.custom_filters` 类型为 `Record<string, string>`，与 buildWhereClause 实现匹配

✅ **Scope check：** Task 5-15 共 11 个 Task，依赖关系清晰，按 4 批次执行可控制风险。
