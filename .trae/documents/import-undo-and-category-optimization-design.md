# 导入可撤销与题库分类优化 设计文档

> **Spec 类型**：单一 spec，分 4 阶段实施
> **创建日期**：2026-07-26
> **状态**：待用户审阅

---

## 1. 背景与目标

### 1.1 用户反馈与需求

1. **导入可撤销**：导入后发现文件选错或内容有问题，希望可以一键撤销整批导入
2. **题库管理分类优化**：
   - 分类树数目统计有误（子节点显示当前页数量，与「全部」节点显示的全库总数对不上）
   - 点击分类进入筛选后没有便捷的返回方式
   - 缺少全选功能（特别是跨页场景）
3. **按导入文件分类**：在分类树增加「导入批次」维度，可定位到某次导入的所有题
4. **新值映射**：导入时遇到不在系统候选值内的新字段值（如新赛事、新难度），让用户决定保留/映射到已有值/加入候选

### 1.2 目标

- 导入流程支持按批次撤销（任意批次，不限时间）
- 分类树统计真实反映全库分布
- 分类树扩展维度：来源类型、状态、标签、导入批次
- 分类交互优化：面包屑返回 + 显式重置按钮
- 列表全选：当前页 + 跨页提示（篮选项下全部）
- 新值映射：预览页批量映射，永久加入候选值

---

## 2. 现状分析

### 2.1 导入流程缺口

| 维度 | 现状 | 缺口 |
|---|---|---|
| 入库方式 | `import.ipc.ts:109-150` 逐条 `topicRepo.createTopic` | 无事务包装，无 createMany |
| 元数据 | `audit_log.detail` 仅存 `{imported, duplicates, failed, total}` | 无文件名、批次 id、importedIds |
| topic 表 | schema.sql:12-25 无 batch_id/source_file | 无法按批次分组 |
| 撤销 | 仅 `Modal.confirm` 二次确认 | 无 undo、无回收站 |

### 2.2 题库管理缺口

- **分类统计**：[TopicLibrary.tsx:130-148](file:///f:/E-drive-25765/python项目/杂项目/抽辩题/src/renderer/src/pages/TopicLibrary.tsx#L130-L148) `treeData` 注释明确写「仅当前页，可作为粗略指示」
- **维度**：仅 type/domain/difficulty/source 四个，缺 source_type/status/tags/批次
- **分类交互**：左侧 Tree 无面包屑，无显式重置按钮（需手动逐项清空）
- **全选**：仅在 `TopicListItem` 行点击切换选择，无表头 checkbox，无跨页
- **候选值不一致**：FilterPanel 候选值与 import-engine.ts SYSTEM_CANDIDATES 不一致（难度 3 vs 5 项，来源 5 vs 6 项，领域值不同）

### 2.3 schema 迁移机制

- 现状：`src/main/db/migrations/` 目录仅有 `.gitkeep`，schema 靠 `CREATE TABLE IF NOT EXISTS` 幂等创建
- 问题：新增字段无法靠 IF NOT EXISTS 添加，旧库不会自动加列
- 解决：在 db 初始化流程增加 `runMigrations()` 步骤，使用 `ALTER TABLE ADD COLUMN` + 异常捕获（SQLite 不支持 IF NOT EXISTS for ADD COLUMN）

---

## 3. 整体方案

### 3.1 五大模块

| 模块 | 描述 |
|---|---|
| **A. 数据基础** | schema 迁移机制 + 候选值单一来源 |
| **B. 导入批次与撤销** | import_batch 表 + topics.batch_id + createMany + revokeBatch + 导入历史 UI |
| **C. 新值映射** | ParsedResult 增 unknownValues + 预览页映射 UI + 永久加入候选 |
| **D. 分类统计修复** | countByDimension 全库 GROUP BY |
| **E. 分类与列表交互** | 分类树扩展 + 面包屑 + 全选 + 重置按钮 |

### 3.2 实施分阶段（每阶段独立 commit）

- **阶段 1**：模块 A（数据基础）
- **阶段 2**：模块 B（导入批次与撤销）
- **阶段 3**：模块 C（新值映射）
- **阶段 4**：模块 D + E（分类统计与交互优化）

---

## 4. 详细设计

### 4.1 模块 A：数据基础

#### A1. Schema 迁移机制

**文件**：`src/main/db/migrations/index.ts`（新建）

```typescript
import type { Database } from 'better-sqlite3'

/**
 * 迁移记录表：追踪已执行的迁移
 */
export function ensureMigrationTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

/**
 * 执行所有未应用的迁移。
 * 每个迁移用 try/catch 包裹 ALTER TABLE，避免重复执行报错。
 */
export function runMigrations(db: Database): void {
  ensureMigrationTable(db)
  const applied = new Set(
    db.prepare('SELECT id FROM __migrations').all().map((r: any) => r.id)
  )
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    m.up(db)
    db.prepare('INSERT INTO __migrations (id, applied_at) VALUES (?, ?)').run(
      m.id,
      new Date().toISOString()
    )
  }
}

interface Migration {
  id: string
  up: (db: Database) => void
}

const MIGRATIONS: Migration[] = [
  {
    id: '20260726_add_batch_id_to_topics',
    up: (db) => {
      // SQLite 不支持 ADD COLUMN IF NOT EXISTS，用异常捕获
      try {
        db.exec('ALTER TABLE topics ADD COLUMN batch_id TEXT')
      } catch {
        /* 字段已存在 */
      }
      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_topics_batch_id ON topics(batch_id)')
      } catch {
        /* 索引已存在 */
      }
    }
  },
  {
    id: '20260726_create_import_batch_table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS import_batch (
          id              TEXT PRIMARY KEY,
          file_name       TEXT NOT NULL,
          total_count     INTEGER NOT NULL,
          imported_count  INTEGER NOT NULL,
          duplicates_count INTEGER NOT NULL DEFAULT 0,
          failed_count    INTEGER NOT NULL DEFAULT 0,
          imported_at     TEXT NOT NULL,
          notes           TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_import_batch_imported_at
          ON import_batch(imported_at DESC);
      `)
    }
  }
]
```

**文件**：`src/main/db/index.ts`（修改）

在 `initDb()` 中 `runSchema()` 后追加 `runMigrations(db)` 调用。

#### A2. 候选值单一来源

**文件**：`src/shared/constants.ts`（新建）

```typescript
/**
 * 系统候选值单一来源——FilterPanel、import-engine、settings 全部引用此处。
 * 避免历史不一致：FilterPanel 难度 3 项 vs import-engine 难度 5 项。
 *
 * 用户可通过「加入候选」机制扩展这些数组（持久化到 settings 表 key='system.candidates'，
 * 启动时合并到此处导出的数组）。
 */
export const SYSTEM_CANDIDATES = {
  type: ['价值辩', '政策辩', '事实辩', '哲理辩', '娱乐辩'],
  domain: [
    '社会热点', '科技伦理', '教育文化', '法律政策',
    '经济商业', '环保公益', '情感人际'
  ],
  difficulty: ['入门级', '进阶级', '专业级'],
  source: ['新国辩', '华语辩论世界杯', '老友赛', '世锦赛', '年度原创'],
  source_type: ['官方', '自定义']
} as const

export type CandidateField = keyof typeof SYSTEM_CANDIDATES
```

**改动点**：
- `src/renderer/src/components/FilterPanel.tsx:10-22`：删除本地常量，改为 `import { SYSTEM_CANDIDATES } from '../../../shared/constants'`
- `src/main/services/import-engine.ts:54-74`：删除 `SYSTEM_CANDIDATES`，改为 `import { SYSTEM_CANDIDATES } from '../../shared/constants'`
- `src/renderer/src/pages/TopicLibrary.tsx:44-49,66-71`：DIMENSIONS 的 options 全部改为引用 SYSTEM_CANDIDATES

#### A3. 动态候选值合并

**文件**：`src/main/services/candidate-service.ts`（新建）

```typescript
import { SYSTEM_CANDIDATES, type CandidateField } from '../../shared/constants'
import { settingsRepo } from '../db/repository/settings.repo'

/**
 * 合并系统候选值 + 用户扩展候选值（存于 settings 表 key='system.candidates'）。
 * 启动时由 db 初始化后调用一次，运行时通过 IPC 提供 getMergedCandidates()。
 */
export function getMergedCandidates(): Record<CandidateField, string[]> {
  const userExtra = settingsRepo.getJSON<Record<CandidateField, string[]>>(
    'system.candidates'
  ) ?? { type: [], domain: [], difficulty: [], source: [], source_type: [] }

  const merged: Record<CandidateField, string[]> = {} as any
  for (const field of Object.keys(SYSTEM_CANDIDATES) as CandidateField[]) {
    const base = [...SYSTEM_CANDIDATES[field]]
    const extra = userExtra[field] ?? []
    for (const v of extra) {
      if (!base.includes(v)) base.push(v)
    }
    merged[field] = base
  }
  return merged
}

export function addCandidateValue(field: CandidateField, value: string): void {
  const current = getMergedCandidates()
  if (current[field].includes(value)) return
  const userExtra = settingsRepo.getJSON<Record<CandidateField, string[]>>(
    'system.candidates'
  ) ?? { type: [], domain: [], difficulty: [], source: [], source_type: [] }
  userExtra[field] = [...(userExtra[field] ?? []), value]
  settingsRepo.setJSON('system.candidates', userExtra)
}
```

---

### 4.2 模块 B：导入批次与撤销

#### B1. import_batch.repo.ts

**文件**：`src/main/db/repository/import-batch.repo.ts`（新建）

```typescript
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../index'

export interface ImportBatch {
  id: string
  file_name: string
  total_count: number
  imported_count: number
  duplicates_count: number
  failed_count: number
  imported_at: string
  notes: string | null
}

export interface ImportBatchCreateInput {
  file_name: string
  total_count: number
  imported_count: number
  duplicates_count: number
  failed_count: number
  notes?: string | null
}

function createBatch(data: ImportBatchCreateInput): ImportBatch {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO import_batch
      (id, file_name, total_count, imported_count, duplicates_count,
       failed_count, imported_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.file_name, data.total_count, data.imported_count,
    data.duplicates_count, data.failed_count, now, data.notes ?? null
  )
  return getBatchById(id)!
}

function getBatchById(id: string): ImportBatch | undefined {
  const row = getDb().prepare('SELECT * FROM import_batch WHERE id = ?').get(id) as any
  return row ? rowToBatch(row) : undefined
}

function listBatches(limit = 100): ImportBatch[] {
  const rows = getDb().prepare(
    'SELECT * FROM import_batch ORDER BY imported_at DESC LIMIT ?'
  ).all(limit) as any[]
  return rows.map(rowToBatch)
}

function deleteBatch(id: string): boolean {
  return getDb().prepare('DELETE FROM import_batch WHERE id = ?').run(id).changes > 0
}

function countTopicsByBatch(batchId: string): number {
  const row = getDb().prepare(
    'SELECT COUNT(*) AS n FROM topics WHERE batch_id = ?'
  ).get(batchId) as any
  return Number(row?.n ?? 0)
}

function rowToBatch(row: any): ImportBatch {
  return {
    id: row.id,
    file_name: row.file_name,
    total_count: row.total_count,
    imported_count: row.imported_count,
    duplicates_count: row.duplicates_count,
    failed_count: row.failed_count,
    imported_at: row.imported_at,
    notes: row.notes
  }
}

export const importBatchRepo = {
  createBatch,
  getBatchById,
  listBatches,
  deleteBatch,
  countTopicsByBatch
}
```

#### B2. topic.repo.ts 增加 batchId 字段与 createMany

**文件**：`src/main/db/repository/topic.repo.ts`（修改）

`Topic` / `TopicRow` / `TopicCreateInput` 类型增加 `batch_id?: string | null`。

新增 `createMany` 方法（事务包装）：

```typescript
function createMany(items: TopicCreateInput[]): Topic[] {
  if (items.length === 0) return []
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT INTO topics (
      id, title, type, domain, difficulty, source, source_type,
      tags, weight, status, batch_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMany = db.transaction((its: TopicCreateInput[]): Topic[] => {
    const results: Topic[] = []
    for (const data of its) {
      const id = uuidv4()
      const tagsJson = data.tags ? JSON.stringify(data.tags) : null
      stmt.run(
        id, data.title, data.type ?? null, data.domain ?? null,
        data.difficulty ?? null, data.source ?? null, data.source_type ?? null,
        tagsJson, data.weight ?? 1.0, data.status ?? 'active',
        data.batch_id ?? null, now, now
      )
      const created = getTopicById(id)
      if (created) results.push(created)
    }
    return results
  })
  return insertMany(items)
}
```

`buildWhereClause` 增加 `batch_id` 支持：

```typescript
// 在 scalarFields 数组中追加
{ key: 'batch_id', column: 'batch_id' }
```

新增 `deleteByBatch` 方法：

```typescript
function deleteByBatch(batchId: string): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM topics WHERE batch_id = ?')
  const deleteMany = db.transaction((bid: string): number => {
    return stmt.run(bid).changes
  })
  return deleteMany(batchId)
}
```

导出新增 `createMany` 和 `deleteByBatch`。

#### B3. import.ipc.ts 改造

**文件**：`src/main/ipc/import.ipc.ts`（修改）

`IMPORT_EXECUTE` handler 改造：

```typescript
ipcMain.handle(
  IPC_CHANNELS.IMPORT_EXECUTE,
  async (_e, req: ImportExecuteRequest): Promise<ApiResponse<ImportExecuteResult>> => {
    try {
      const { topics, checkDuplicates = true, fileName } = req
      // ... 现有去重逻辑保留 ...

      // 创建批次记录（先占位，导入完成后更新）
      const batch = importBatchRepo.createBatch({
        file_name: fileName ?? '未命名文件',
        total_count: topics.length,
        imported_count: 0,        // 占位
        duplicates_count: 0,
        failed_count: 0
      })

      // 用 createMany 批量插入非重复项
      const topicsToImport: TopicCreateInput[] = []
      for (let i = 0; i < topics.length; i++) {
        const t = topics[i]
        const placeholderId = `__new_${i}__`
        if (checkDuplicates) {
          const conflictIds = /* 现有去重逻辑 */
          if (conflictIds.length > 0) {
            duplicates++
            duplicateGroups.push({ title: t.title, existingIds: conflictIds })
            continue
          }
        }
        topicsToImport.push({ ...t, batch_id: batch.id })
      }

      // 批量插入（事务包装，失败回滚）
      let imported = 0
      let failed = 0
      try {
        const created = topicRepo.createMany(topicsToImport)
        imported = created.length
      } catch (e) {
        failed = topicsToImport.length
        // createMany 内部事务失败会回滚，所有题都不会入库
      }

      // 更新批次统计
      // （这里用 UPDATE 而非重新创建，因为 batch.id 已经在 topics.batch_id 中引用）
      db.prepare(`
        UPDATE import_batch
        SET imported_count = ?, duplicates_count = ?, failed_count = ?
        WHERE id = ?
      `).run(imported, duplicates, failed, batch.id)

      auditRepo.addLog({
        action: 'import',
        target_type: 'topic',
        target_id: batch.id,    // 改为 batch id，便于回溯
        operator: 'renderer',
        detail: {
          imported, duplicates, failed, total: topics.length,
          batchId: batch.id,
          fileName: batch.file_name
        }
      })

      return {
        success: true,
        data: { imported, duplicates, failed, duplicateGroups, batchId: batch.id }
      }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)

// 新增：撤销批次导入
ipcMain.handle(
  IPC_CHANNELS.IMPORT_REVOKE_BATCH,
  async (_e, batchId: string): Promise<ApiResponse<{ deletedCount: number }>> => {
    try {
      const batch = importBatchRepo.getBatchById(batchId)
      if (!batch) {
        return { success: false, error: '批次不存在' }
      }
      const deletedCount = topicRepo.deleteByBatch(batchId)
      importBatchRepo.deleteBatch(batchId)
      auditRepo.addLog({
        action: 'import_revoke',
        target_type: 'topic',
        target_id: batchId,
        operator: 'renderer',
        detail: { deletedCount, fileName: batch.file_name }
      })
      return { success: true, data: { deletedCount } }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)

// 新增：列出所有导入批次
ipcMain.handle(
  IPC_CHANNELS.IMPORT_LIST_BATCHES,
  async (_e): Promise<ApiResponse<ImportBatch[]>> => {
    try {
      const batches = importBatchRepo.listBatches()
      // 附加每个批次当前剩余的题数（用户可能已单独删除部分）
      const withCounts = batches.map(b => ({
        ...b,
        remainingCount: importBatchRepo.countTopicsByBatch(b.id)
      }))
      return { success: true, data: withCounts as any }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)
```

#### B4. shared/types.ts 类型扩展

```typescript
// IPC_CHANNELS 增加
IMPORT_REVOKE_BATCH: 'import:revokeBatch',
IMPORT_LIST_BATCHES: 'import:listBatches',

// ImportExecuteRequest 增加 fileName
export interface ImportExecuteRequest {
  topics: TopicCreateInput[]
  checkDuplicates?: boolean
  fileName?: string  // 新增
}

// ImportExecuteResult 增加 batchId
export interface ImportExecuteResult {
  imported: number
  duplicates: number
  failed: number
  duplicateGroups: Array<{ title: string; existingIds: string[] }>
  batchId?: string  // 新增
}

// 新增类型
export interface ImportBatch {
  id: string
  file_name: string
  total_count: number
  imported_count: number
  duplicates_count: number
  failed_count: number
  imported_at: string
  notes: string | null
  remainingCount?: number  // 当前剩余题数（listBatches 时返回）
}

// Topic / TopicCreateInput 增加 batch_id
export interface Topic {
  // ... 原有字段
  batch_id: string | null  // 新增
}
export interface TopicCreateInput {
  // ... 原有字段
  batch_id?: string | null  // 新增
}
export interface TopicFilter {
  // ... 原有字段
  batch_id?: string  // 新增
}
```

#### B5. preload/index.ts 暴露 API

```typescript
importAPI: {
  parseFile: (path, type) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PARSE_FILE, path, type),
  execute: (req) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_EXECUTE, req),
  findDuplicates: (topics, opts) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_FIND_DUPLICATES, topics, opts),
  revokeBatch: (batchId) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_REVOKE_BATCH, batchId),  // 新增
  listBatches: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_LIST_BATCHES)  // 新增
}
```

#### B6. ImportTopicsModal.tsx 改造

- Step 3「完成」页面增加「撤销本次导入」按钮
- 调用 `window.importAPI.execute` 时传入 `fileName`
- 导入成功后 `messageApi.success` 改为带 undo 的 notification：

```tsx
const handleImport = async () => {
  // ...
  const res = await window.importAPI.execute({
    topics: parsed.topics,
    checkDuplicates: true,
    fileName  // 新增
  })
  // ...
  // 用 notification 提供 undo 入口（5 分钟内可点击）
  const key = `import-${Date.now()}`
  messageApi.open({
    key,
    type: 'success',
    content: `成功导入 ${res.data.imported} 条辩题`,
    duration: 8,
    btn: (
      <Button
        size="small"
        danger
        onClick={async () => {
          if (res.data.batchId) {
            await window.importAPI.revokeBatch(res.data.batchId)
            messageApi.destroy(key)
            messageApi.success('已撤销本次导入')
            onSuccess?.()
            handleClose()
          }
        }}
      >
        撤销导入
      </Button>
    )
  })
}
```

#### B7. 导入历史面板（在题库管理页）

在 `TopicLibrary.tsx` 工具栏增加「导入历史」按钮，弹出 Modal：

```tsx
// 新增组件 src/renderer/src/components/ImportHistoryModal.tsx
// - 列表显示所有 import_batch 记录
// - 列：文件名、导入时间、导入数/重复数/失败数、当前剩余数、操作
// - 操作：「查看此批次」（设置 filter.batch_id 并关闭弹窗）+「撤销整批」（带确认）
```

---

### 4.3 模块 C：新值映射

#### C1. import-engine.ts 增加 unknownValues 检测

**文件**：`src/main/services/import-engine.ts`（修改）

`ParsedResult` 类型增加 `unknownValues`：

```typescript
export interface ParsedResult {
  topics: TopicCreateInput[]
  mapping: Record<string, string>
  warnings: string[]
  /** 新增：检测到的非系统候选值，按字段分组 */
  unknownValues: Array<{
    field: 'type' | 'domain' | 'difficulty' | 'source'
    values: string[]   // 去重后的新值列表
  }>
}
```

`parseExcelOrCsv` 与 `parseDocx` 末尾追加：

```typescript
const unknownValues = collectUnknownValues(topics)
return { topics, mapping, warnings: [...], unknownValues }
```

新增函数：

```typescript
function collectUnknownValues(
  topics: TopicCreateInput[]
): ParsedResult['unknownValues'] {
  const fields: Array<'type' | 'domain' | 'difficulty' | 'source'> = [
    'type', 'domain', 'difficulty', 'source'
  ]
  const result: ParsedResult['unknownValues'] = []
  for (const field of fields) {
    const seen = new Set<string>()
    const unknown = new Set<string>()
    for (const t of topics) {
      const v = (t as any)[field] as string | null | undefined
      if (!v || seen.has(v)) continue
      seen.add(v)
      if (!SYSTEM_CANDIDATES[field].includes(v)) {
        unknown.add(v)
      }
    }
    if (unknown.size > 0) {
      result.push({ field, values: Array.from(unknown) })
    }
  }
  return result
}
```

**shared/types.ts 中 ParsedResult 同步增加 unknownValues 字段。**

#### C2. ImportTopicsModal.tsx 预览页映射 UI

在 Step 2 当 `parsed.unknownValues.length > 0` 时，渲染映射面板：

```tsx
// 新增组件 src/renderer/src/components/import/ValueMappingPanel.tsx
// Props:
//   unknownValues: ParsedResult['unknownValues']
//   candidateOptions: Record<CandidateField, string[]>  // 当前系统候选
//   onMappingChange: (mapping: ValueMapping) => void
//
// ValueMapping: { [field]: { [originalValue]: { action: 'keep' | 'map' | 'add'; target?: string } } }
//
// 渲染：每个 field 一个 Section，每个原值一行：
//   [原值]  →  [Select: 保留原值 / 映射到... / 加入候选]
//                                选择「映射到...」时显示候选值下拉
```

`ImportTopicsModal` 持有 `valueMapping` state，导入前应用映射：

```typescript
const handleImport = async () => {
  // 应用映射改写 topics
  const finalTopics = parsed.topics.map(t => applyMapping(t, valueMapping))
  // 调用 execute
}

function applyMapping(
  topic: TopicCreateInput,
  mapping: ValueMapping
): TopicCreateInput {
  const result = { ...topic }
  for (const [field, valueMap] of Object.entries(mapping)) {
    const currentValue = (result as any)[field] as string | null
    if (!currentValue) continue
    const rule = valueMap[currentValue]
    if (!rule) continue
    if (rule.action === 'map' && rule.target) {
      (result as any)[field] = rule.target
    }
    // 'keep' 不变，'add' 在主进程导入时自动调用 addCandidateValue
  }
  return result
}
```

#### C3. 主进程导入时持久化「加入候选」

**文件**：`src/main/ipc/import.ipc.ts`

`ImportExecuteRequest` 增加 `valueMapping?: ValueMapping`，主进程在导入循环中：

```typescript
// 收集所有 'add' 动作的新值，统一写入候选
const candidatesToAdd: Record<CandidateField, string[]> = {
  type: [], domain: [], difficulty: [], source: [], source_type: []
}
for (const [field, valueMap] of Object.entries(req.valueMapping ?? {})) {
  for (const [origValue, rule] of Object.entries(valueMap)) {
    if (rule.action === 'add') {
      candidatesToAdd[field as CandidateField].push(origValue)
    }
  }
}
for (const [field, values] of Object.entries(candidatesToAdd)) {
  for (const v of values) addCandidateValue(field as CandidateField, v)
}
```

---

### 4.4 模块 D：分类统计修复

#### D1. topic.repo.ts 新增 countByDimension

```typescript
/**
 * 按指定维度分组统计全库分布。
 * 返回示例：[{ value: '价值辩', count: 234 }, { value: '政策辩', count: 156 }, ...]
 * 仅统计 status='active' 的题（与默认筛选一致）。
 */
function countByDimension(
  dimension: 'type' | 'domain' | 'difficulty' | 'source' | 'source_type' | 'status' | 'batch_id'
): Array<{ value: string; count: number }> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT ${dimension} AS value, COUNT(*) AS count
    FROM topics
    WHERE status = 'active'
    GROUP BY ${dimension}
    ORDER BY count DESC
  `).all() as Array<{ value: string; count: number }>
  return rows.map(r => ({
    value: r.value ?? '(未设置)',
    count: Number(r.count)
  }))
}
```

#### D2. 新增 IPC 通道

```typescript
// shared/types.ts
TOPIC_COUNT_BY_DIMENSION: 'topic:countByDimension',

// topic.ipc.ts
ipcMain.handle(
  IPC_CHANNELS.TOPIC_COUNT_BY_DIMENSION,
  async (_e, dimension: string): Promise<ApiResponse<Array<{ value: string; count: number }>>> => {
    try {
      const data = topicRepo.countByDimension(dimension as any)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)
```

#### D3. TopicLibrary.tsx 分类树用全库统计

替换 `treeData` useMemo 逻辑：

```typescript
const [dimensionCounts, setDimensionCounts] = useState<Array<{ value: string; count: number }>>([])

useEffect(() => {
  // 切换维度时拉取全库分布
  window.topicAPI.countByDimension(dimension).then(res => {
    if (res.success) setDimensionCounts(res.data ?? [])
  })
}, [dimension])

const treeData: DataNode[] = useMemo(() => {
  const dim = DIMENSIONS.find((d) => d.key === dimension)!
  return [
    { key: '__all__', title: '__all__' },
    ...dimensionCounts.map(item => ({
      key: item.value,
      title: item.value,
      count: item.count  // 通过 titleRender 读取
    }))
  ]
}, [dimension, dimensionCounts])
```

`renderTreeNode` 用 dimensionCounts 查找计数，而非从 store.items 过滤。

---

### 4.5 模块 E：分类与列表交互优化

#### E1. 分类树扩展维度

`DIMENSIONS` 增加 4 个维度：

```typescript
const DIMENSIONS = [
  { key: 'type', label: '类型', icon: <TagOutlined />, options: SYSTEM_CANDIDATES.type },
  { key: 'domain', label: '领域', icon: <GlobalOutlined />, options: SYSTEM_CANDIDATES.domain },
  { key: 'difficulty', label: '难度', icon: <FireOutlined />, options: SYSTEM_CANDIDATES.difficulty },
  { key: 'source', label: '来源', icon: <DatabaseOutlined />, options: SYSTEM_CANDIDATES.source },
  // 新增 4 个维度
  { key: 'source_type', label: '来源类型', icon: <SafetyCertificateOutlined />, options: SYSTEM_CANDIDATES.source_type },
  { key: 'status', label: '状态', icon: <CheckCircleOutlined />, options: ['active', 'favorited', 'blacklisted'] },
  { key: 'tags', label: '标签', icon: <TagOutlined />, options: [] /* 动态 */ },
  { key: 'batch_id', label: '导入批次', icon: <UploadOutlined />, options: [] /* 动态从 import_batch 拉 */ }
] as const
```

`batch_id` 维度特殊处理：
- 节点显示 = 文件名主显 + 同名加后缀 (2)、(3)
- 节点 title 为 batch.id，渲染时显示 batch.file_name + remainingCount
- 切换到此维度时调用 `window.importAPI.listBatches()` 拉取批次列表

#### E2. 面包屑导航

在工具栏上方增加面包屑：

```tsx
import { Breadcrumb } from 'antd'

<Breadcrumb
  items={[
    { title: '全部', onClick: () => handleResetFilter() },
    dimension !== '__all__' && {
      title: DIMENSIONS.find(d => d.key === dimension)?.label,
      onClick: () => setDimension('type')  // 回到默认维度
    },
    selectedCategory !== '__all__' && {
      title: selectedCategory
    }
  ].filter(Boolean)}
/>
```

#### E3. 显式重置筛选按钮

工具栏增加「重置筛选」按钮，仅在有筛选条件时显示：

```tsx
const hasActiveFilter = useMemo(() => {
  return Object.values(store.filter).some(v => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
}, [store.filter])

{hasActiveFilter && (
  <Button icon={<CloseCircleOutlined />} onClick={() => store.resetFilter()}>
    重置筛选
  </Button>
)}
```

#### E4. 全选功能（当前页 + 跨页提示）

列表渲染增加表头 checkbox（grid 模式在工具栏旁边）：

```tsx
// store 增加 selectAllInFilter / clearSelection 已有
// 新增 store.selectAllCurrentPage()
// 新增 store.selectAllInFilter() 调用 topic:list 拉取篮选项下全部 id

const [allSelectedInFilter, setAllSelectedInFilter] = useState(false)

// 表头 checkbox indeterminate 状态
const currentPageIds = store.items.map(t => t.id)
const allCurrentSelected = currentPageIds.length > 0 && currentPageIds.every(id => store.selectedIds.includes(id))
const indeterminate = currentPageIds.some(id => store.selectedIds.includes(id)) && !allCurrentSelected

// 列表上方提示条
{allCurrentSelected && store.total > store.items.length && !allSelectedInFilter && (
  <Alert
    message={`已选当前页 ${store.selectedIds.length} 条。还有 ${store.total - store.selectedIds.length} 条未选中（共 ${store.total} 条）`}
    type="info"
    showIcon
    action={
      <Button size="small" type="link" onClick={handleSelectAllInFilter}>
        选中全部 {store.total} 条
      </Button>
    }
    style={{ marginBottom: 8 }}
  />
)}
```

`topicStore` 新增：

```typescript
selectAllInFilter: async () => {
  const res = await window.topicAPI.list({ ...filter, page: 1, pageSize: 100000 })
  if (res.success) {
    set({ selectedIds: res.data.items.map(t => t.id) })
  }
}
```

---

## 5. 数据流与接口契约

### 5.1 导入流程（含批次与映射）

```
用户选文件 → parseFile(path, ext)
  ↓
ParsedResult { topics, mapping, warnings, unknownValues }
  ↓
预览页（如有 unknownValues 显示映射面板）
  ↓
用户配置 valueMapping
  ↓
applyMapping(topics, valueMapping)
  ↓
importAPI.execute({ topics, fileName, valueMapping })
  ↓
主进程：
  1. addCandidateValue 持久化「加入候选」
  2. importBatchRepo.createBatch 占位
  3. 去重检查
  4. topicRepo.createMany(非重复项, batch_id=batch.id)
  5. UPDATE import_batch SET imported_count=...
  6. auditRepo.addLog
  ↓
ImportExecuteResult { imported, duplicates, failed, duplicateGroups, batchId }
  ↓
渲染进程显示 notification（带撤销按钮）
```

### 5.2 撤销流程

```
用户点撤销 → importAPI.revokeBatch(batchId)
  ↓
主进程：
  1. topicRepo.deleteByBatch(batchId)  // 事务包装
  2. importBatchRepo.deleteBatch(batchId)
  3. auditRepo.addLog
  ↓
{ deletedCount }
  ↓
刷新题库列表
```

---

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| createMany 事务失败 | 整批回滚，import_batch 仍记录 imported_count=0，failed_count=待导入数 |
| 撤销时部分题已被单独删除 | deleteByBatch 用 WHERE batch_id=? 删除剩余，不报错 |
| 撤销时外键级联 | team_history / draw_session_items ON DELETE CASCADE 自动清理 |
| 迁移重复执行 | __migrations 表去重 + ALTER TABLE 异常捕获双保险 |
| 批次表无 fileName | 兜底为「未命名文件」 |
| 旧库无 batch_id 字段 | 第一阶段迁移自动添加，旧题 batch_id=NULL |

---

## 7. 测试策略

### 7.1 单元测试（vitest）

**`src/main/services/__tests__/import-batch.repo.test.ts`**（新建）
- createBatch + getBatchById 往返
- listBatches 按时间倒序
- countTopicsByBatch 正确统计
- deleteBatch 后 getBatchById 返回 undefined

**`src/main/services/__tests__/migrations.test.ts`**（新建）
- runMigrations 幂等：连续调用 2 次不报错
- ALTER TABLE ADD COLUMN 重复执行被异常捕获
- __migrations 表正确记录已应用迁移

**`src/main/services/__tests__/topic.repo.test.ts`**（新建或扩展）
- createMany 事务性：构造一条非法数据触发失败，验证全部不入库
- deleteByBatch 仅删除指定批次
- countByDimension 各维度分布正确

**`src/main/services/__tests__/import-engine.test.ts`**（扩展）
- collectUnknownValues 检测 type/domain/difficulty/source 的新值
- 含 unknownValues 字段的 ParsedResult 返回

**`src/main/services/__tests__/candidate-service.test.ts`**（新建）
- getMergedCandidates 合并系统候选 + 用户扩展
- addCandidateValue 去重写入 settings

### 7.2 手动验证

1. **导入撤销**：导入 100 条 → 点撤销 → 验证题库回到导入前状态
2. **批次分类**：导入 2 个不同文件 → 切换到「导入批次」维度 → 看到两个节点 → 点击节点筛选
3. **新值映射**：构造含「1-入门」「老国辩」的 xlsx → 预览页显示映射面板 → 选择映射到「入门级」「新国辩」→ 导入后题库字段值正确
4. **分类统计**：题库 500 条 → 切换维度 → 各分类计数之和 = 总数
5. **跨页全选**：分页 50/页 → 全选当前页 → 提示「还有 450 条未选」→ 点击 → selectedIds.length = 500
6. **面包屑**：选「类型 → 价值辩」→ 面包屑显示「全部 / 类型 / 价值辩」→ 点「全部」回到默认
7. **重置按钮**：设置多个筛选 → 点「重置筛选」→ 全部清空

---

## 8. 假设与决策

| 项目 | 决策 | 理由 |
|---|---|---|
| 撤销范围 | 任意批次可整批移除 | 用户确认；灵活度高，发现错误导入可随时回滚 |
| import_batch 表 | 不存 topicIds | 用 SELECT id FROM topics WHERE batch_id=? 查；省空间、避免不一致 |
| 批次维度节点显示 | 文件名主显 + 同名加后缀 | 用户确认；hover/tooltip 显示时间+数量 |
| 新值映射持久化 | 永久加入候选 | 用户确认；FilterPanel 候选值动态读取 |
| 全选语义 | 篮选项下全部 | 用户确认；与 Gmail/Notion 一致 |
| schema 迁移 | __migrations 表 + ALTER TABLE 异常捕获 | SQLite 不支持 ADD COLUMN IF NOT EXISTS |
| 候选值单一来源 | shared/constants.ts | 解决 FilterPanel 与 SYSTEM_CANDIDATES 不一致 |
| createMany 实现 | 事务包装 | 单条失败整批回滚，避免部分导入 |
| 撤销后外键级联 | 依赖 ON DELETE CASCADE | 现有 schema 已配置，team_history / draw_session_items 自动清理 |

---

## 9. 不在范围内

- 不实现软删除/回收站（用户已选「整批移除」方案）
- 不重构现有 dedup-engine
- 不修改抽签流程
- 不修改官方题库 seed.ts（虽无 batch_id 但不影响功能，旧题 batch_id=NULL）
- 不实现批次「编辑」功能（仅撤销 + 查看）
- 不实现分类树拖拽重排

---

## 10. 实施顺序

1. **阶段 1**：模块 A（数据基础）—— schema 迁移 + 候选值单一来源 + candidate-service
2. **阶段 2**：模块 B（导入批次与撤销）—— import_batch.repo + topic.repo.createMany + import.ipc 改造 + UI
3. **阶段 3**：模块 C（新值映射）—— import-engine.unknownValues + ValueMappingPanel + 主进程持久化
4. **阶段 4**：模块 D + E（分类与列表）—— countByDimension + 分类树扩展 + 面包屑 + 全选 + 重置

每个阶段独立 commit，每阶段完成后跑 `npm run typecheck && npm test`。
