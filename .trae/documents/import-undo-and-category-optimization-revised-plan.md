# 导入可撤销与题库分类优化 — 修订版实施计划

> **配套原 spec**：[import-undo-and-category-optimization-design.md](./import-undo-and-category-optimization-design.md)
> **修订日期**：2026-07-26
> **状态**：3 迭代设计已与用户逐节确认；本文档整合 spec 修订要点 + bite-sized 实施步骤
> **执行模式**：每迭代独立 commit，每迭代完成后跑 `npm run typecheck && npm test`

---

## 0. 修订背景

### 0.1 原 spec 的实施进度

| 阶段 | 模块 | 状态 |
|---|---|---|
| 1 | A 数据基础 | ✅ 已完成（constants.ts / migrations / candidate-service.ts） |
| 2 | B 导入批次与撤销 | ⏳ 进行中 ~55%（主进程 IPC + repo 已写，preload/UI 未做） |
| 3 | C 新值映射 | ❌ 未开始 |
| 4 | D + E 分类与列表 | ❌ 未开始 |

### 0.2 审阅发现的 14 项问题

#### P0 - 阻塞当前实施的硬伤
1. preload 层 `importAPI` 未暴露 `revokeBatch/listBatches`，主进程已写的 IPC 无法被渲染进程调用
2. `ImportTopicsModal.tsx` `handleImport` 仍调用 `{topics, checkDuplicates: true}`，未传 `fileName`
3. `ImportTopicsModal.tsx` 缺 notification 撤销按钮 + Step 3 撤销入口
4. `topic.ipc.ts` 未注册 `TOPIC_COUNT_BY_DIMENSION` handler（阶段 4 前置）

#### P1 - 设计与代码层面问题
5. `import-engine.ts` SYSTEM_CANDIDATES 类型仍是 4 字段，与 spec 4.0「5 字段（含 source_type）」不一致
6. `ImportBatch` 类型在 shared/types.ts 与 import-batch.repo.ts 双定义导致语义混淆
7. `import.ipc.ts` 的 `importedPlaceholderToReal` 是死代码
8. `listBatches` 默认 limit=100 可能不够

#### P2 - spec 缺失或模糊
9. `SYSTEM_GET_CANDIDATES` IPC 未注册（spec 4.7 明确要求）
10. `listAllTags` 未实现（spec 5.1.1 明确要求）
11. `'__unset__'` 翻译为 IS NULL 未实现（spec 5.1.2 明确要求）
12. 撤销后前端刷新机制未明确

#### P3 - 实施顺序
13. 阶段 2 无法独立 commit（preload+UI 未完成，IPC handler 无法被调用）
14. 阶段 3 与阶段 2 在 ImportTopicsModal 上强耦合

### 0.3 修订方案：3 迭代重构

| 迭代 | 内容 | 验证 |
|---|---|---|
| **迭代 1** | 阶段 2 剩余 + 修复 P0/P1 阻塞 | preload+UI+IPC 闭环，可端到端撤销 |
| **迭代 2** | 阶段 3 新值映射 + SYSTEM_GET_CANDIDATES IPC | 预览页可映射，加入候选可持久化 |
| **迭代 3** | 阶段 4 分类与列表 + listAllTags + `'__unset__'` | 分类树 8 维可用，跨页全选可用 |

---

## 1. 迭代 1 — 端到端闭环

### 1.1 preload/index.ts 扩展 importAPI

**文件**：`src/preload/index.ts`

`importAPI` 对象新增：

```typescript
revokeBatch: (batchId: string) =>
  invoke<{ deletedCount: number }>(IPC_CHANNELS.IMPORT_REVOKE_BATCH, batchId),
listBatches: () => invoke<ImportBatch[]>(IPC_CHANNELS.IMPORT_LIST_BATCHES)
```

需要在文件顶部从 `../../shared/types` import `ImportBatch`、`ImportExecuteRequest` 类型（如未 import）。

### 1.2 preload/index.d.ts 同步 ImportAPI 接口

**文件**：`src/preload/index.d.ts`

`ImportAPI` 接口同步加：

```typescript
revokeBatch: (batchId: string) => Promise<ApiResponse<{ deletedCount: number }>>
listBatches: () => Promise<ApiResponse<ImportBatch[]>>
```

### 1.3 ImportTopicsModal.tsx 传 fileName + 撤销按钮

**文件**：`src/renderer/src/components/ImportTopicsModal.tsx`

#### 1.3.1 handleImport 传 fileName

当前 `handleImport` 在 L164-L167 调用 execute 时未传 fileName。改为：

```typescript
const res = await window.importAPI.execute({
  topics: parsed.topics,
  checkDuplicates: true,
  fileName  // 已在 L183 提取 basename，需要前移
})
```

需要把 L183 的 `filePath?.split(/[\\/]/).pop()` basename 提取逻辑移到 `handleImport` 函数开头，或在调用 execute 之前计算。

#### 1.3.2 导入成功 notification 带「撤销导入」按钮

替换 L173 的 `messageApi.success`：

```typescript
if (res.data.batchId) {
  const notifKey = `import-undo-${Date.now()}`
  messageApi.open({
    key: notifKey,
    type: 'success',
    content: `成功导入 ${res.data.imported} 条辩题`,
    duration: 8,
    btn: (
      <Button
        size="small"
        danger
        onClick={async () => {
          try {
            const revokeRes = await window.importAPI.revokeBatch(res.data.batchId!)
            if (!revokeRes.success) throw new Error(revokeRes.error)
            messageApi.destroy(notifKey)
            messageApi.success(`已撤销本次导入（删除 ${revokeRes.data!.deletedCount} 条）`)
            onSuccess?.()
            onClose()
          } catch (e) {
            messageApi.error(e instanceof Error ? e.message : '撤销失败')
          }
        }}
      >
        撤销导入
      </Button>
    )
  })
} else {
  messageApi.success(`成功导入 ${res.data.imported} 条辩题`)
}
```

需要从 antd import `Button`（已有）和 message（已有）。

#### 1.3.3 Step 3 完成页加撤销入口

在 Step 3 的 `Result` extra 按钮区追加「撤销本次导入」次级按钮：

```typescript
const handleRevokeFromResult = () => {
  if (!importResult?.batchId) return
  Modal.confirm({
    title: '确认撤销本次导入？',
    content: `将删除本次导入的 ${importResult.imported} 条辩题，不可恢复`,
    okText: '撤销导入',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const res = await window.importAPI.revokeBatch(importResult.batchId!)
      if (!res.success) throw new Error(res.error)
      messageApi.success(`已撤销（删除 ${res.data!.deletedCount} 条）`)
      onSuccess?.()
      onClose()
      resetState()
    }
  })
}

// Step 3 渲染中追加按钮：
<Button danger onClick={handleRevokeFromResult} icon={<UndoOutlined />}>
  撤销本次导入
</Button>
```

需 import `UndoOutlined` from `@ant-design/icons`。

### 1.4 新建 ImportHistoryModal.tsx

**文件（新建）**：`src/renderer/src/components/ImportHistoryModal.tsx`

#### Props

```typescript
export interface ImportHistoryModalProps {
  open: boolean
  onClose: () => void
  /** 撤销成功时触发，调用方应刷新题库列表 */
  onSuccess: () => void
  /** 「查看此批次」点击时调用，传入 batchId 用于设置 store.filter.batch_id */
  onViewBatch: (batchId: string) => void
}
```

#### 内部 state

```typescript
const [batches, setBatches] = useState<ImportBatch[]>([])
const [loading, setLoading] = useState(false)
const [revoking, setRevoking] = useState<string | null>(null)
```

#### 数据加载

```typescript
const fetchBatches = async () => {
  setLoading(true)
  try {
    const res = await window.importAPI.listBatches()
    if (res.success && res.data) setBatches(res.data)
  } finally {
    setLoading(false)
  }
}

useEffect(() => {
  if (open) fetchBatches()
}, [open])
```

#### 表格列设计

| 列 | dataIndex | 渲染 |
|---|---|---|
| 文件名 | file_name | Text ellipsis，tooltip 完整名 |
| 导入时间 | imported_at | dayjs 格式化为 `YYYY-MM-DD HH:mm` |
| 导入/重复/失败 | — | `${imported_count} / ${duplicates_count} / ${failed_count}` |
| 当前剩余 | remainingCount | Badge，颜色按 remainingCount=0 灰色 |
| 操作 | — | 「查看此批次」+「撤销整批」（Popconfirm 二次确认） |

#### 撤销逻辑

```typescript
const handleRevoke = async (batchId: string) => {
  setRevoking(batchId)
  try {
    const res = await window.importAPI.revokeBatch(batchId)
    if (!res.success) throw new Error(res.error)
    messageApi.success(`已撤销（删除 ${res.data!.deletedCount} 条）`)
    onSuccess()
    await fetchBatches()
  } catch (e) {
    messageApi.error(e instanceof Error ? e.message : '撤销失败')
  } finally {
    setRevoking(null)
  }
}
```

#### 「查看此批次」逻辑

```typescript
const handleView = (batchId: string) => {
  onViewBatch(batchId)
  onClose()
}
```

#### 空状态

`batches.length === 0` 时显示 Empty：「暂无导入记录」

### 1.5 TopicLibrary.tsx 工具栏加「导入历史」按钮

**文件**：`src/renderer/src/pages/TopicLibrary.tsx`

```typescript
// 新增 state
const [importHistoryOpen, setImportHistoryOpen] = useState(false)

// 工具栏 Space 内新增按钮（在「导入辩题」按钮旁）
<Button
  icon={<HistoryOutlined />}
  onClick={() => setImportHistoryOpen(true)}
>
  导入历史
</Button>

// 顶部新增 ImportHistoryModal
<ImportHistoryModal
  open={importHistoryOpen}
  onClose={() => setImportHistoryOpen(false)}
  onSuccess={() => store.fetchList()}
  onViewBatch={(batchId) => {
    store.setFilter({ batch_id: batchId, page: 1 })
  }}
/>

// import 新增
import ImportHistoryModal from '../components/ImportHistoryModal'
import { HistoryOutlined } from '@ant-design/icons'
```

注意：`batch_id` 维度在迭代 3 才扩展，此处先用 `setFilter({ batch_id })` 直接筛选，列表会正确显示该批次题。

### 1.6 topic.ipc.ts 注册 TOPIC_COUNT_BY_DIMENSION handler

**文件**：`src/main/ipc/topic.ipc.ts`

```typescript
import { topicRepo, type CountableDimension } from '../db/repository/topic.repo'

ipcMain.handle(
  IPC_CHANNELS.TOPIC_COUNT_BY_DIMENSION,
  async (_e, dimension: CountableDimension): Promise<ApiResponse<Array<{ value: string; count: number }>>> => {
    try {
      const data = topicRepo.countByDimension(dimension)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)
```

preload/index.ts 的 topicAPI 同步加 `countByDimension`，preload/index.d.ts 的 TopicAPI 接口同步加：

```typescript
countByDimension: (dimension: 'type' | 'domain' | 'difficulty' | 'source' | 'source_type' | 'status' | 'batch_id') =>
  Promise<ApiResponse<Array<{ value: string; count: number }>>>
```

### 1.7 修复 ImportBatch 类型双定义

**文件**：`src/main/db/repository/import-batch.repo.ts`

删除本地 `ImportBatch` 接口和 `ImportBatchRow`，改为：

```typescript
import type { ImportBatch } from '../../../shared/types'

/** DB 原始行类型（与 ImportBatch 字段一致） */
interface ImportBatchRow {
  id: string
  file_name: string
  total_count: number
  imported_count: number
  duplicates_count: number
  failed_count: number
  imported_at: string
  notes: string | null
}
```

`rowToBatch` 返回 `ImportBatch`（不含 remainingCount，可选字段为 undefined）。
`createBatch` / `getBatchById` / `listBatches` 返回类型统一为 `ImportBatch`。
`src/main/ipc/import.ipc.ts#L255-L258` 的 `as any` cast 移除，直接 `ImportBatch[]`。

### 1.8 删除 importedPlaceholderToReal 死代码

**文件**：`src/main/ipc/import.ipc.ts`

- 删除 L117 `const importedPlaceholderToReal = new Map<string, string>()`
- 删除 L162-L166 createMany 后的写入映射循环
- 保留 groupMembersByTopicId（去重逻辑必需）

简化后 createMany 调用：

```typescript
try {
  const created = topicRepo.createMany(topicsToImport)
  imported = created.length
} catch (e) {
  failed = topicsToImport.length
  console.error('[import.ipc] createMany failed:', e)
}
```

### 1.9 listBatches limit 提高

**文件**：`src/main/db/repository/import-batch.repo.ts`

```typescript
function listBatches(limit = 500): ImportBatch[] {
  // ...
}
```

### 1.10 迭代 1 验证清单

```bash
npm run typecheck
npm test
npm run dev
```

端到端手动验证：
1. 导入 100 条 → notification 出现「撤销导入」按钮 → 点击 → 题库回到导入前
2. Step 3 完成页点击「撤销本次导入」→ Modal.confirm → 确认 → 撤销成功
3. 题库工具栏点「导入历史」→ 弹窗列出批次 → 点「查看此批次」→ 列表筛到该批次
4. 导入历史弹窗点「撤销整批」→ Popconfirm → 确认 → 列表刷新 + 题库刷新
5. 调用 `window.topicAPI.countByDimension('type')` 返回全库分布

### 1.11 迭代 1 Commit

```
feat(import): complete batch undo end-to-end with history modal

- preload: expose revokeBatch/listBatches in importAPI
- ImportTopicsModal: pass fileName, add undo notification + Step 3 revoke button
- ImportHistoryModal: new component with batch list, view, revoke
- TopicLibrary: add import history toolbar button
- topic.ipc: register TOPIC_COUNT_BY_DIMENSION handler
- import-batch.repo: unify ImportBatch type with shared/types
- import.ipc: remove dead importedPlaceholderToReal code
- listBatches: raise default limit 100 → 500
```

---

## 2. 迭代 2 — 新值映射

### 2.1 类型定义（shared/types.ts）

```typescript
import type { CandidateField } from './constants'

/** 新值映射动作 */
export type ValueMappingAction = 'keep' | 'map' | 'add'

/** 单条映射规则 */
export interface ValueMappingRule {
  action: ValueMappingAction
  /** action='map' 时必填，目标候选值 */
  target?: string
}

/** 完整映射结构 */
export type ValueMapping = Partial<Record<CandidateField, Record<string, ValueMappingRule>>>

/** 检测到的新值（按字段分组，含出现次数） */
export interface UnknownValueItem {
  field: CandidateField
  values: Array<{ value: string; count: number }>
}
```

`ParsedResult` 加可选字段：

```typescript
export interface ParsedResult {
  topics: TopicCreateInput[]
  mapping: Record<string, string>
  warnings: string[]
  /** 检测到的非系统候选值（按字段分组） */
  unknownValues?: UnknownValueItem[]
}
```

`ImportExecuteRequest` 加可选字段：

```typescript
export interface ImportExecuteRequest {
  topics: TopicCreateInput[]
  checkDuplicates?: boolean
  fileName?: string
  /** 新值映射规则（渲染进程已应用 map 改写 topics，主进程仅需持久化 add） */
  valueMapping?: ValueMapping
}
```

### 2.2 import-engine.ts 改造

**文件**：`src/main/services/import-engine.ts`

#### 2.2.1 SYSTEM_CANDIDATES 扩为 5 字段

L59-L64 改为：

```typescript
import { SYSTEM_CANDIDATES as SYSTEM_CANDIDATES_SRC, type CandidateField } from '../../shared/constants'

export const SYSTEM_CANDIDATES: Record<CandidateField, string[]> = {
  type: [...SYSTEM_CANDIDATES_SRC.type],
  domain: [...SYSTEM_CANDIDATES_SRC.domain],
  difficulty: [...SYSTEM_CANDIDATES_SRC.difficulty],
  source: [...SYSTEM_CANDIDATES_SRC.source],
  source_type: [...SYSTEM_CANDIDATES_SRC.source_type]
}
```

`FIELD_LABEL` 同步加 `source_type: '来源类型'`。

#### 2.2.2 ParsedResult 接口同步

import-engine 内部 ParsedResult 改为从 `../../shared/types` import 或同步加 `unknownValues?` 字段。

#### 2.2.3 collectUnknownValues 实现

```typescript
/**
 * 收集所有 topics 中字段值不在 SYSTEM_CANDIDATES 内的项。
 * 同值去重并累加出现次数。
 * null/空字符串跳过，不算"新值"。
 */
function collectUnknownValues(topics: TopicCreateInput[]): UnknownValueItem[] {
  const fields: CandidateField[] = ['type', 'domain', 'difficulty', 'source', 'source_type']
  const result: UnknownValueItem[] = []
  for (const field of fields) {
    const counter = new Map<string, number>()
    for (const t of topics) {
      const v = (t as any)[field] as string | null | undefined
      if (!v || typeof v !== 'string') continue
      if (SYSTEM_CANDIDATES[field].includes(v)) continue
      counter.set(v, (counter.get(v) ?? 0) + 1)
    }
    if (counter.size > 0) {
      result.push({
        field,
        values: Array.from(counter.entries())
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count)
      })
    }
  }
  return result
}
```

#### 2.2.4 parseExcelOrCsv / parseDocx 末尾调用

两个 parse 函数返回前追加：

```typescript
const unknownValues = collectUnknownValues(topics)
return { topics, mapping, warnings, unknownValues }
```

原 `collectValueMismatchWarnings` 函数保留（生成 warnings 文本），新函数返回结构化数据。两者并行。

### 2.3 SYSTEM_GET_CANDIDATES IPC

#### 2.3.1 IPC_CHANNELS 新增

`src/shared/types.ts`：

```typescript
SYSTEM_GET_CANDIDATES: 'system:getCandidates'
```

#### 2.3.2 新建 src/main/ipc/system.ipc.ts

```typescript
import { ipcMain } from 'electron'
import { IPC_CHANNELS, type ApiResponse } from '../../shared/types'
import { getMergedCandidates } from '../services/candidate-service'
import type { CandidateField } from '../../shared/constants'

export function registerSystemIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_GET_CANDIDATES,
    async (): Promise<ApiResponse<Record<CandidateField, string[]>>> => {
      try {
        const data = getMergedCandidates()
        return { success: true, data }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
```

#### 2.3.3 main/index.ts 注册

```typescript
import { registerSystemIpc } from './ipc/system.ipc'
// 在 registerAllIpc() 调用 registerSystemIpc()
```

#### 2.3.4 preload 扩展

`src/preload/index.ts` `settingsAPI` 加：

```typescript
getCandidates: () => invoke(IPC_CHANNELS.SYSTEM_GET_CANDIDATES)
```

`src/preload/index.d.ts` `SettingsAPI` 同步加：

```typescript
getCandidates: () => Promise<ApiResponse<Record<string, string[]>>>
```

### 2.4 新建 ValueMappingPanel.tsx

**文件（新建）**：`src/renderer/src/components/import/ValueMappingPanel.tsx`

#### Props

```typescript
interface ValueMappingPanelProps {
  unknownValues: UnknownValueItem[]
  candidateOptions: Record<CandidateField, string[]>
  onMappingChange: (mapping: ValueMapping) => void
}
```

#### 内部 state

```typescript
const [mapping, setMapping] = useState<ValueMapping>({})
const [actionState, setActionState] = useState<Record<string, Record<string, ValueMappingAction>>>({})
const [mapTarget, setMapTarget] = useState<Record<string, Record<string, string>>>({})
```

#### UI 结构

```
┌─ 检测到 N 个新值，分布在 M 个字段 ─────────────────┐
│                                                    │
│  类型 (2 个新值)                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ 老国辩 ×3           →  [Select: 保留原值 ▼]  │  │
│  │ 1-入门 ×2           →  [Select: 保留原值 ▼]  │  │
│  │                       (选 map 时下方出现下拉) │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  来源 (1 个新值)                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ 自定义赛事 ×5       →  [Select: 保留原值 ▼]  │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  [全部保留]  [全部加入候选]                         │
└────────────────────────────────────────────────────┘
```

#### 关键交互

- 默认 action = 'keep'
- 选「映射到...」→ 下方出现候选值下拉，必选目标值
- 选「加入候选」→ 无需额外输入
- 顶部总览动态计算「N 个新值，M 个字段」
- 底部批量：「全部保留」清空 mapping，「全部加入候选」全部设为 add
- 不做「全部映射」（目标值不统一）

#### 渲染规则

```typescript
unknownValues.map(item => {
  const field = item.field
  const options = candidateOptions[field]
  return (
    <Section title={`${FIELD_LABEL[field]} (${item.values.length} 个新值)`}>
      {item.values.map(({ value, count }) => (
        <Row>
          <Tag>{value} ×{count}</Tag>
          <ArrowRightOutlined />
          <Select
            value={actionState[field]?.[value] ?? 'keep'}
            onChange={(action) => handleActionChange(field, value, action)}
            options={[
              { value: 'keep', label: '保留原值' },
              { value: 'map', label: '映射到...' },
              { value: 'add', label: '加入候选' }
            ]}
          />
          {actionState[field]?.[value] === 'map' && (
            <Select
              placeholder="选择目标候选值"
              value={mapTarget[field]?.[value]}
              onChange={(target) => handleMapTargetChange(field, value, target)}
              options={options.map(o => ({ value: o, label: o }))}
            />
          )}
        </Row>
      ))}
    </Section>
  )
})
```

### 2.5 新建 utils/valueMapping.ts

**文件（新建）**：`src/renderer/src/utils/valueMapping.ts`

```typescript
import type { TopicCreateInput, ValueMapping, CandidateField } from '../../../shared/types'

/** 应用映射规则到单条 topic。keep: 不改写；map: 改写字段值为 target；add: 不改写 */
export function applyMapping(topic: TopicCreateInput, mapping: ValueMapping): TopicCreateInput {
  const result = { ...topic }
  for (const field of Object.keys(mapping) as CandidateField[]) {
    const valueMap = mapping[field]
    if (!valueMap) continue
    const currentValue = (result as any)[field] as string | null | undefined
    if (!currentValue) continue
    const rule = valueMap[currentValue]
    if (!rule) continue
    if (rule.action === 'map' && rule.target) {
      (result as any)[field] = rule.target
    }
  }
  return result
}

/** 批量应用映射 */
export function applyMappingToTopics(
  topics: TopicCreateInput[],
  mapping: ValueMapping
): TopicCreateInput[] {
  if (!mapping || Object.keys(mapping).length === 0) return topics
  return topics.map(t => applyMapping(t, mapping))
}

/** 校验映射是否完整（所有 map 动作都有 target） */
export function isMappingValid(mapping: ValueMapping): boolean {
  for (const field of Object.keys(mapping) as CandidateField[]) {
    const rules = mapping[field]
    if (!rules) continue
    for (const rule of Object.values(rules)) {
      if (rule.action === 'map' && !rule.target) return false
    }
  }
  return true
}
```

### 2.6 ImportTopicsModal 集成

**文件**：`src/renderer/src/components/ImportTopicsModal.tsx`

#### 2.6.1 新增 state

```typescript
import ValueMappingPanel from './import/ValueMappingPanel'
import { applyMappingToTopics, isMappingValid } from '../utils/valueMapping'
import type { ValueMapping } from '../../../shared/types'
import type { CandidateField } from '../../../shared/constants'

const [valueMapping, setValueMapping] = useState<ValueMapping>({})
const [mergedCandidates, setMergedCandidates] = useState<Record<CandidateField, string[]> | null>(null)
```

#### 2.6.2 打开 modal 时拉取候选

```typescript
useEffect(() => {
  if (open) {
    window.settingsAPI.getCandidates().then(res => {
      if (res.success && res.data) {
        setMergedCandidates(res.data as Record<CandidateField, string[]>)
      }
    })
  }
}, [open])
```

#### 2.6.3 Step 2 预览页渲染 ValueMappingPanel

在预览表格上方条件渲染：

```typescript
{parsed?.unknownValues && parsed.unknownValues.length > 0 && mergedCandidates && (
  <div style={{ marginBottom: 16 }}>
    <Alert
      message="检测到新值"
      description={
        <ValueMappingPanel
          unknownValues={parsed.unknownValues}
          candidateOptions={mergedCandidates}
          onMappingChange={setValueMapping}
        />
      }
      type="info"
      showIcon
    />
  </div>
)}
```

#### 2.6.4 handleImport 应用映射 + 传 valueMapping

```typescript
const handleImport = async () => {
  if (!parsed || parsed.topics.length === 0) return
  if (!isMappingValid(valueMapping)) {
    messageApi.error('请为所有「映射到...」选择目标候选值')
    return
  }
  setImporting(true)
  try {
    const finalTopics = applyMappingToTopics(parsed.topics, valueMapping)
    const res = await window.importAPI.execute({
      topics: finalTopics,
      checkDuplicates: true,
      fileName,
      valueMapping
    })
    // ...其余不变
  }
}
```

### 2.7 import.ipc.ts IMPORT_EXECUTE 处理 add 动作

**文件**：`src/main/ipc/import.ipc.ts`

在创建 batch 之后、createMany 之前，统一处理 `req.valueMapping` 的 add 动作：

```typescript
import { addCandidateValue } from '../services/candidate-service'
import type { CandidateField } from '../../shared/constants'

// ...在 createBatch 之后：

if (req.valueMapping) {
  for (const field of Object.keys(req.valueMapping) as CandidateField[]) {
    const valueMap = req.valueMapping[field]
    if (!valueMap) continue
    for (const [originValue, rule] of Object.entries(valueMap)) {
      if (rule.action === 'add') {
        try {
          addCandidateValue(field, originValue)
        } catch (e) {
          console.error(`[import.ipc] addCandidateValue failed for ${field}/${originValue}:`, e)
        }
      }
    }
  }
}

// ...继续 createMany
```

注意：渲染进程已 applyMapping 改写过 topics 的 map 字段，主进程不重复处理 map。add 动作仅持久化候选值，不改写 topics 字段值（保留原值入库）。

### 2.8 迭代 2 验证清单

```bash
npm run typecheck
npm test
npm run dev
```

端到端手动验证：
1. 构造含「1-入门」「老国辩」「自定义赛事」的 xlsx
2. 预览页 Step 2 显示 ValueMappingPanel，列出 3 个新值
3. 默认全部「保留原值」
4. 将「1-入门」改为「映射到 入门级」、「老国辩」改为「加入候选」、「自定义赛事」保留
5. 确认导入 → 入库后「1-入门」改为「入门级」，其余原值入库
6. 重启应用 → 重新导入同文件 → 「老国辩」不再出现在 unknownValues（已加入候选）
7. ValueMappingPanel 选「映射到...」但未选目标值 → 确认导入按钮禁用 + 提示
8. 点「全部加入候选」→ 所有新值 action=add → 导入后全部持久化

### 2.9 迭代 2 Commit

```
feat(import): add value mapping for unknown candidates on import

- types: add ValueMapping/ValueMappingRule/UnknownValueItem types
- import-engine: extend SYSTEM_CANDIDATES to 5 fields, add collectUnknownValues
- system.ipc: new IPC SYSTEM_GET_CANDIDATES with settingsAPI.getCandidates
- ValueMappingPanel: new component with keep/map/add actions + batch ops
- valueMapping utils: applyMapping/applyMappingToTopics/isMappingValid
- ImportTopicsModal: render ValueMappingPanel, apply mapping before execute
- import.ipc: persist 'add' actions to candidate-service before createMany
```

---

## 3. 迭代 3 — 分类与列表优化

### 3.1 topic.repo.ts 改造

**文件**：`src/main/db/repository/topic.repo.ts`

#### 3.1.1 新增 listAllTags

```typescript
/**
 * 全库聚合所有 tags，返回每个 tag 的出现次数。
 * 用于分类树 tags 维度的全库候选值。
 */
function listAllTags(): Array<{ value: string; count: number }> {
  const db = getDb()
  const rows = db.prepare(
    "SELECT tags FROM topics WHERE status = 'active' AND tags IS NOT NULL"
  ).all() as Array<{ tags: string | null }>
  const counter = new Map<string, number>()
  for (const row of rows) {
    if (!row.tags) continue
    try {
      const tags: unknown = JSON.parse(row.tags)
      if (!Array.isArray(tags)) continue
      for (const t of tags) {
        if (typeof t === 'string' && t) {
          counter.set(t, (counter.get(t) ?? 0) + 1)
        }
      }
    } catch {
      // 跳过损坏的 JSON
    }
  }
  return Array.from(counter.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
}
```

导出加入 `listAllTags`。

#### 3.1.2 buildWhereClause 支持 `'__unset__'`

L137-L147 改为：

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

注意：`tags` 字段不能用此机制（数组字段），本期不支持「未设置 tags」筛选。

#### 3.1.3 countByDimension 兼容 `'__unset__'`

现有实现已将 NULL 映射为 `'(未设置)'`，前端点击该节点时传 `'__unset__'`，repo 翻译为 IS NULL。无需修改 countByDimension，仅前端调用方需把 `'(未设置)'` 节点的 value 转为 `'__unset__'`。

### 3.2 topic.ipc.ts 新增 TOPIC_LIST_ALL_TAGS handler

**文件**：`src/main/ipc/topic.ipc.ts`

```typescript
ipcMain.handle(
  IPC_CHANNELS.TOPIC_LIST_ALL_TAGS,
  async (_e): Promise<ApiResponse<Array<{ value: string; count: number }>>> => {
    try {
      const data = topicRepo.listAllTags()
      return { success: true, data }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)
```

`shared/types.ts` IPC_CHANNELS 加 `TOPIC_LIST_ALL_TAGS: 'topic:listAllTags'`。
preload/index.ts `topicAPI` 加 `listAllTags`，preload/index.d.ts `TopicAPI` 接口同步加。

### 3.3 TopicLibrary.tsx DIMENSIONS 扩展至 8 维

**文件**：`src/renderer/src/pages/TopicLibrary.tsx`

#### 3.3.1 类型与常量

```typescript
import { SYSTEM_CANDIDATES } from '../../../shared/constants'
import type { CandidateField } from '../../../shared/constants'

type DimensionKey = 'type' | 'domain' | 'difficulty' | 'source' | 'source_type' | 'status' | 'tags' | 'batch_id'

interface DimensionMeta {
  key: DimensionKey
  label: string
  icon: React.ReactNode
  source: 'system' | 'ipc_count' | 'ipc_tags' | 'ipc_batches' | 'static'
  staticOptions?: Array<{ label: string; value: string }>
}

const DIMENSIONS: DimensionMeta[] = [
  { key: 'type', label: '类型', icon: <TagOutlined />, source: 'system' },
  { key: 'domain', label: '领域', icon: <GlobalOutlined />, source: 'system' },
  { key: 'difficulty', label: '难度', icon: <FireOutlined />, source: 'system' },
  { key: 'source', label: '来源', icon: <DatabaseOutlined />, source: 'system' },
  { key: 'source_type', label: '来源类型', icon: <SafetyCertificateOutlined />, source: 'system' },
  {
    key: 'status', label: '状态', icon: <CheckCircleOutlined />, source: 'static',
    staticOptions: [
      { label: '正常', value: 'active' },
      { label: '收藏', value: 'favorited' },
      { label: '黑名单', value: 'blacklisted' }
    ]
  },
  { key: 'tags', label: '标签', icon: <TagsOutlined />, source: 'ipc_tags' },
  { key: 'batch_id', label: '导入批次', icon: <UploadOutlined />, source: 'ipc_batches' }
]
```

#### 3.3.2 维度数据加载

```typescript
interface DimensionItem {
  value: string  // 筛选用 value（'(未设置)' 翻译为 '__unset__'）
  count: number
  label: string  // 显示文本
  title?: string  // tooltip
}

const [dimensionData, setDimensionData] = useState<DimensionItem[]>([])
const [dimensionLoading, setDimensionLoading] = useState(false)

useEffect(() => {
  setDimensionLoading(true)
  setDimensionData([])
  const meta = DIMENSIONS.find(d => d.key === dimension)!

  if (meta.source === 'system' || meta.source === 'static') {
    window.topicAPI.countByDimension(dimension as any).then(res => {
      if (!res.success || !res.data) {
        setDimensionData([])
        setDimensionLoading(false)
        return
      }
      const valueToLabel = meta.source === 'static'
        ? Object.fromEntries((meta.staticOptions ?? []).map(o => [o.value, o.label]))
        : {}
      setDimensionData(res.data.map(r => ({
        value: r.value === '(未设置)' ? '__unset__' : r.value,
        count: r.count,
        label: r.value === '(未设置)' ? '(未设置)' : (valueToLabel[r.value] ?? r.value)
      })))
      setDimensionLoading(false)
    })
  } else if (meta.source === 'ipc_tags') {
    window.topicAPI.listAllTags().then(res => {
      if (!res.success || !res.data) {
        setDimensionData([])
        setDimensionLoading(false)
        return
      }
      setDimensionData(res.data.map(r => ({ value: r.value, count: r.count, label: r.value })))
      setDimensionLoading(false)
    })
  } else if (meta.source === 'ipc_batches') {
    window.importAPI.listBatches().then(res => {
      if (!res.success || !res.data) {
        setDimensionData([])
        setDimensionLoading(false)
        return
      }
      const nameCount = new Map<string, number>()
      setDimensionData(res.data.map(b => {
        const baseName = b.file_name
        const seen = nameCount.get(baseName) ?? 0
        nameCount.set(baseName, seen + 1)
        return {
          value: b.id,
          count: b.remainingCount ?? 0,
          label: seen > 0 ? `${baseName} (${seen + 1})` : baseName,
          title: `${baseName}\n导入时间: ${b.imported_at}\n剩余: ${b.remainingCount ?? 0}`
        }
      }))
      setDimensionLoading(false)
    })
  }
}, [dimension])
```

#### 3.3.3 treeData 渲染

```typescript
const treeData: DataNode[] = useMemo(() => {
  return [
    { key: '__all__', title: '__all__' },
    ...dimensionData.map(item => ({
      key: item.value,
      title: item.label
    }))
  ]
}, [dimension, dimensionData])
```

#### 3.3.4 renderTreeNode 改造

```typescript
const renderTreeNode = (node: DataNode) => {
  const meta = DIMENSIONS.find(d => d.key === dimension)!
  const key = String(node.key)

  if (key === '__all__') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <FolderOutlined style={{ color: token.colorPrimary }} />
        <span style={{ fontWeight: 500 }}>全部</span>
        <Badge count={store.total} showZero color={token.colorPrimary} overflowCount={9999} />
      </span>
    )
  }

  const item = dimensionData.find(d => d.value === key)
  const count = item?.count ?? 0
  const label = item?.label ?? key

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={item?.title}>
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

#### 3.3.5 节点点击 → setFilter

```typescript
const handleCategorySelect = (keys: Key[]) => {
  const k = keys[0] as string | undefined
  setSelectedCategory(k ?? '__all__')
  if (!k || k === '__all__') {
    store.setFilter({ [dimension]: undefined } as any)
  } else if (k === '__unset__') {
    store.setFilter({ [dimension]: '__unset__' } as any)
  } else {
    store.setFilter({ [dimension]: k } as any)
  }
}
```

注意：`tags` 维度点击节点时设置 `store.filter.tags = [value]`（数组语义）。

### 3.4 面包屑

```typescript
import { Breadcrumb } from 'antd'

const breadcrumbItems = useMemo(() => {
  const meta = DIMENSIONS.find(d => d.key === dimension)!
  const items: Array<{ title: React.ReactNode; onClick?: () => void }> = [
    { title: <a onClick={() => handleResetToAll()}>全部</a> }
  ]
  if (selectedCategory !== '__all__') {
    const item = dimensionData.find(d => d.value === selectedCategory)
    items.push({
      title: <span>{meta.label} / {item?.label ?? selectedCategory}</span>
    })
  }
  return items
}, [dimension, selectedCategory, dimensionData])

const handleResetToAll = () => {
  setSelectedCategory('__all__')
  store.setFilter({ [dimension]: undefined } as any)
}

<Breadcrumb items={breadcrumbItems} style={{ marginBottom: 12 }} />
```

### 3.5 重置筛选按钮

```typescript
const hasFilterPanelActive = useMemo(() => {
  return Object.entries(store.filter).some(([k, v]) => {
    if (k === 'page' || k === 'pageSize' || k === dimension) return false
    if (v === undefined || v === '') return false
    if (Array.isArray(v) && v.length === 0) return false
    return true
  })
}, [store.filter, dimension])

{hasFilterPanelActive && (
  <Button
    icon={<CloseCircleOutlined />}
    onClick={() => {
      store.resetFilter()
    }}
  >
    重置筛选
  </Button>
)}
```

需在 topicStore 中确认 `resetFilter` 是否仅清 FilterPanel 字段，不动 dimension。如未实现，需扩展 store。

### 3.6 topicStore 全选标志位

**文件**：`src/renderer/src/stores/topicStore.ts`

#### 3.6.1 state 扩展

```typescript
interface TopicStoreState {
  // ...既有字段
  /** 跨页全选标志位：true 表示当前 filter 下的所有题都被选中（除 exceptIds 外） */
  allSelectedInFilter: boolean
  /** 跨页全选时的例外黑名单 */
  exceptIds: Set<string>
  // ...既有方法
  selectPage: (pageItems: Topic[]) => void
  selectAllInFilter: () => void
  unselectInAllMode: (id: string) => void
  removeFromExcept: (id: string) => void
  isSelected: (id: string) => boolean
}
```

#### 3.6.2 方法实现

```typescript
selectPage: (pageItems) => {
  const s = get()
  if (s.allSelectedInFilter) {
    set({ allSelectedInFilter: false, exceptIds: new Set() })
  }
  const pageIds = pageItems.map(t => t.id)
  const allSelected = pageIds.length > 0 && pageIds.every(id => s.selectedIds.includes(id))
  if (allSelected) {
    set({ selectedIds: s.selectedIds.filter(id => !pageIds.includes(id)) })
  } else {
    set({ selectedIds: Array.from(new Set([...s.selectedIds, ...pageIds])) })
  }
},

selectAllInFilter: () => {
  set({ allSelectedInFilter: true, exceptIds: new Set(), selectedIds: [] })
},

unselectInAllMode: (id) => {
  set(s => {
    const newExcept = new Set(s.exceptIds)
    newExcept.add(id)
    return { exceptIds: newExcept }
  })
},

removeFromExcept: (id) => {
  set(s => {
    const newExcept = new Set(s.exceptIds)
    newExcept.delete(id)
    return { exceptIds: newExcept }
  })
},

isSelected: (id) => {
  const s = get()
  if (s.allSelectedInFilter) {
    return !s.exceptIds.has(id)
  }
  return s.selectedIds.includes(id)
},

clearSelection: () => {
  set({ allSelectedInFilter: false, exceptIds: new Set(), selectedIds: [] })
}
```

### 3.7 TopicCard 选中状态

**文件**：`src/renderer/src/components/TopicCard.tsx`

```typescript
const isSelected = useTopicStore(s => s.isSelected(topic.id))
const unselectInAllMode = useTopicStore(s => s.unselectInAllMode)
const removeFromExcept = useTopicStore(s => s.removeFromExcept)
const toggleSelect = useTopicStore(s => s.toggleSelect)
const allSelectedInFilter = useTopicStore(s => s.allSelectedInFilter)

const handleToggle = () => {
  if (allSelectedInFilter) {
    if (isSelected) {
      unselectInAllMode(topic.id)
    } else {
      removeFromExcept(topic.id)
    }
  } else {
    toggleSelect(topic.id)
  }
}
```

### 3.8 跨页全选 Alert

```typescript
const pageIds = store.items.map(t => t.id)
const currentPageAllSelected = pageIds.length > 0 && pageIds.every(id => store.isSelected(id))

{currentPageAllSelected && store.total > store.items.length && !store.allSelectedInFilter && (
  <Alert
    message={`已选当前页 ${store.selectedIds.length} 条。还有 ${store.total - store.selectedIds.length} 条未选中（共 ${store.total} 条）`}
    type="info"
    showIcon
    action={
      <Button size="small" type="link" onClick={() => store.selectAllInFilter()}>
        选中全部 {store.total} 条
      </Button>
    }
    style={{ marginBottom: 8 }}
  />
)}

{store.allSelectedInFilter && (
  <Alert
    message={`已选中全部 ${store.total} 条${store.exceptIds.size > 0 ? `（已取消 ${store.exceptIds.size} 条）` : ''}`}
    type="success"
    showIcon
    action={
      <Button size="small" type="link" onClick={() => store.clearSelection()}>
        清除选择
      </Button>
    }
    style={{ marginBottom: 8 }}
  />
)}
```

### 3.9 批量操作改造

**文件**：`src/renderer/src/pages/TopicLibrary.tsx`

```typescript
const getSelectedIdsForBatchOp = async (): Promise<string[]> => {
  if (store.allSelectedInFilter) {
    const res = await window.topicAPI.list({
      ...store.filter,
      page: 1,
      pageSize: 100000
    })
    if (!res.success || !res.data) return []
    const allIds = res.data.items.map(t => t.id)
    return allIds.filter(id => !store.exceptIds.has(id))
  }
  return store.selectedIds
}

const handleBatchDelete = async () => {
  const ids = await getSelectedIdsForBatchOp()
  if (ids.length === 0) return
  Modal.confirm({
    title: `确认批量删除 ${ids.length} 条辩题？`,
    content: store.allSelectedInFilter
      ? `跨页全选模式下，将删除除 ${store.exceptIds.size} 条外的全部 ${ids.length} 条`
      : '删除后不可恢复',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await store.batchRemove(ids)
      messageApi.success(`已删除 ${ids.length} 条`)
      store.clearSelection()
      store.fetchList()
    }
  })
}
```

类似改造 `handleBatchAddTag`、`handleBatchChangeType`、`handleBatchChangeDifficulty`。

### 3.10 迭代 3 验证清单

```bash
npm run typecheck
npm test
npm run dev
```

端到端手动验证：
1. 题库 500 条 → 切换各维度 → 各分类计数之和 = 总数（含「(未设置)」节点）
2. 切到「导入批次」维度 → 看到批次节点（文件名+计数）→ 点击 → 筛选到该批次
3. 选「类型 → 价值辩」→ 面包屑显示「全部 / 类型 / 价值辩」→ 点「全部」回到默认
4. FilterPanel 设难度=进阶级 + 关键词"AI" → 点「重置筛选」→ FilterPanel 字段清空，分类树维度与选中保留
5. 分页 20/页 → 全选当前页 → 提示「还有 480 条未选」→ 点「选中全部 500 条」→ allSelectedInFilter=true
6. 跨页全选模式下取消 1 条 → exceptIds.size=1 → 切换分页保持状态 → 点「清除选择」退出
7. 切到「状态」维度 → 节点显示「正常 / 收藏 / 黑名单」→ 点击「正常」→ 筛选 status='active'
8. 切到「类型」维度 → 点击「(未设置)」节点 → 筛选 type IS NULL 的题
9. 跨页全选后点批量删除 → Modal.confirm 显示「跨页全选模式，将删除除 X 条外的全部 Y 条」

### 3.11 迭代 3 Commit

```
feat(library): 8-dimension category tree with breadcrumb and bulk select

- topic.repo: add listAllTags, support '__unset__' → IS NULL in buildWhereClause
- topic.ipc: register TOPIC_LIST_ALL_TAGS handler
- TopicLibrary: extend DIMENSIONS to 8 (add source_type/status/tags/batch_id)
- TopicLibrary: use dimensionData state for full-db counts
- TopicLibrary: add breadcrumb navigation + reset filter button
- topicStore: add allSelectedInFilter flag + exceptIds blacklist + isSelected helper
- TopicCard: use store.isSelected for selection state
- TopicLibrary: cross-page select Alert + batch ops use getSelectedIdsForBatchOp
```

---

## 4. 总体假设与决策

### 4.1 数据假设

- 系统候选值 `SYSTEM_CANDIDATES` 已在 `src/shared/constants.ts` 定义（5 字段：type/domain/difficulty/source/source_type）
- `auditRepo.getSetting/setSetting` 可用于持久化 JSON settings（键 `system.candidates`）
- topics 表已通过 migration 添加 `batch_id TEXT` 字段并建立索引
- import_batch 表已通过 migration 创建

### 4.2 设计决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 批次撤销语义 | 任意批次可整批移除 | 简单直接，符合用户预期 |
| import_batch 表设计 | 不存 topicIds 列表 | 通过 topics.batch_id 反向查询，避免冗余 |
| 批次节点显示 | 文件名主显 + 同名加后缀 (2)、(3) | 避免歧义 |
| 新值默认动作 | keep（保留原值） | 最小侵入，用户主动改 map/add |
| add 持久化 | 永久加入候选 | 写入 settings 表 system.candidates |
| 新值检测范围 | 5 字段（含 source_type） | 与 SYSTEM_CANDIDATES 对齐 |
| null/空值处理 | 跳过，不算"新值" | 避免误报 |
| 跨页全选语义 | 筛选项下全部 | 符合常见表格交互习惯 |
| 跨页全选实现 | allSelectedInFilter 标志位 + exceptIds 黑名单 | 比 ids 数组存全量更高效 |
| (未设置) 节点 | value=`'__unset__'`，翻译为 IS NULL | 与具体值筛选统一接口 |
| 分类树计数 | 全库统计（countByDimension） | 修复原「仅当前页」问题 |

### 4.3 兼容性

- 原 `auditRepo.getSetting('system.candidates')` 返回结构不变，新增字段自动合并
- 旧 import_batch 表结构兼容，仅 listBatches limit 提高
- 跨页全选的 selectedIds 数组模式与 allSelectedInFilter 模式可共存

### 4.4 性能考虑

- countByDimension 使用 SQL GROUP BY，全库 5000 条约 < 10ms
- listAllTags 在 JS 层聚合，5000 条约 < 30ms
- createMany 使用事务批量插入，1000 条约 < 200ms
- 跨页全选时 list pageSize=100000 拉取所有 id 仅用于批量操作，正常使用无影响

### 4.5 不在本计划范围

- ❌ dedup-engine 重构（保留现有 findDuplicates 实现）
- ❌ import_batch 表添加更多字段（如 source_file_path、file_hash）
- ❌ 撤销后自动恢复原批次记录（撤销即删除批次）
- ❌ 「未设置 tags」筛选
- ❌ 批量操作进度条（小批量同步执行即可）

---

## 5. 执行顺序与依赖

```
迭代 1（端到端闭环）
  ├─ preload/index.ts + index.d.ts（1.1, 1.2）
  ├─ ImportTopicsModal.tsx（1.3）
  ├─ ImportHistoryModal.tsx 新建（1.4）
  ├─ TopicLibrary.tsx 按钮（1.5）
  ├─ topic.ipc.ts handler（1.6）
  ├─ import-batch.repo.ts 类型修复（1.7）
  ├─ import.ipc.ts 删死代码（1.8）
  ├─ listBatches limit（1.9）
  └─ 验证 + commit（1.10, 1.11）

迭代 2（新值映射，依赖迭代 1 的 ImportTopicsModal 改造）
  ├─ types.ts 类型（2.1）
  ├─ import-engine.ts 改造（2.2）
  ├─ system.ipc.ts + IPC_CHANNELS（2.3）
  ├─ ValueMappingPanel.tsx 新建（2.4）
  ├─ utils/valueMapping.ts 新建（2.5）
  ├─ ImportTopicsModal 集成（2.6）
  ├─ import.ipc.ts 处理 add（2.7）
  └─ 验证 + commit（2.8, 2.9）

迭代 3（分类与列表，依赖迭代 1 的 listBatches 与 countByDimension）
  ├─ topic.repo.ts（3.1）
  ├─ topic.ipc.ts listAllTags（3.2）
  ├─ TopicLibrary.tsx 8 维 + 面包屑 + 重置（3.3, 3.4, 3.5）
  ├─ topicStore.ts 跨页全选（3.6）
  ├─ TopicCard.tsx 选中状态（3.7）
  ├─ 跨页全选 Alert + 批量操作（3.8, 3.9）
  └─ 验证 + commit（3.10, 3.11）
```

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| preload 暴露的 API 类型与主进程返回不匹配 | TS 编译失败 | 严格按 shared/types.ts 类型对齐，preload/index.d.ts 与主进程 handler 返回类型一致 |
| 跨页全选切换分页时状态丢失 | UX 体验差 | allSelectedInFilter + exceptIds 模式天然支持跨页保持 |
| ValueMappingPanel 在大量新值时性能差 | UI 卡顿 | 单次导入新值通常 < 20 个，性能无问题；如需可加虚拟滚动 |
| listAllTags 在 tags 数据损坏时崩溃 | 全库聚合失败 | try-catch 跳过损坏 JSON，不影响其他 tags |
| 撤销批次时该批次题已被用户手动修改过 | 数据丢失 | 撤销前 Modal.confirm 明确提示「将删除该批次所有题」，无差别删除 |
| 跨页全选批量删除 1000+ 条耗时 | UI 阻塞 | topicRepo.batchRemove 已用事务，1000 条约 < 500ms |

---

## 7. 后续可能的扩展（不在本计划范围）

- 撤销后恢复（软删除 + 回收站）
- 批次合并（多个批次视为一个）
- 新值映射的撤销（导入后修改映射规则）
- 分类树拖拽排序
- 自定义维度（用户配置的分类字段）
- 候选值管理界面（在设置中查看/编辑 system.candidates）
