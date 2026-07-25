# 导入可撤销与题库分类优化 — 实施计划

> **配套 Spec**：[import-undo-and-category-optimization-design.md](./import-undo-and-category-optimization-design.md)
> **创建日期**：2026-07-26
> **状态**：阶段 1 已完成；阶段 2 完成 ~55%；阶段 3、4 已细化待用户审阅

---

## 0. 总览

按 4 阶段实施，每阶段独立 commit，每阶段完成后跑 `npm run typecheck && npm test`。

| 阶段 | 模块 | 关键产出 | 状态 |
|---|---|---|---|
| 1 | A 数据基础 | migrations 机制 + shared/constants.ts + candidate-service | ✅ 已完成 |
| 2 | B 导入批次与撤销 | import_batch.repo + topic.repo.createMany/deleteByBatch + import.ipc 改造 + UI | ⏳ 进行中 ~55% |
| 3 | C 新值映射 | import-engine.unknownValues + ValueMappingPanel + 主进程持久化 | ⏳ 待审阅 |
| 4 | D + E 分类与列表 | countByDimension + 分类树扩展 + 面包屑 + 全选 + 重置 | ⏳ 待审阅 |

---

## 1. 现状基线（Phase 1 探索结论）

| 项 | 现状 | 影响 |
|---|---|---|
| 数据库初始化 | `src/main/db/index.ts` `initDatabase()` 仅 `db.exec(schemaSql)`，无迁移机制 | 必须新增 migrations |
| 主进程入口 | `src/main/index.ts:57-68` 在 `app.whenReady` 中调用 `initDatabase()` → `seedOfficialTopics()` → `registerAllIpc()` | 迁移在 initDatabase 内部完成即可 |
| settings 存储 | **无独立 settings.repo**，`audit.repo.ts:214-258` 提供 `getSetting/setSetting/getAllSettings/deleteSetting` | Spec 中 `settingsRepo.getJSON/setJSON` → 实际用 `auditRepo.getSetting/setSetting` |
| import.ipc.ts | 逐条 `topicRepo.createTopic`，无事务、无 batch_id、无 fileName | 需完全重写 IMPORT_EXECUTE handler |
| topic.repo.ts | 仅 `createTopic` 单条插入 | 新增 `createMany` + `deleteByBatch` + `countByDimension` |
| schema.sql | topics 表无 batch_id 字段 | 通过 migrations 添加 |
| TopicLibrary.tsx | `treeData` 用 `store.items` 统计（仅当前页，注释明确写「粗略指示」） | 改用 countByDimension 全库统计 |
| DIMENSIONS | 仅 type/domain/difficulty/source 4 维 | 扩展至 8 维 |
| topicStore.ts | 已有 `selectedIds`、`clearSelection`，无全选 | 新增 `selectAllInFilter` |
| preload/index.ts | `importAPI` 仅 `parseFile/execute/findDuplicates` | 新增 `revokeBatch/listBatches` |
| FilterPanel.tsx | 本地常量 TYPE_OPTIONS 等，与 import-engine SYSTEM_CANDIDATES 不一致 | 改用 SYSTEM_CANDIDATES 单一来源 |

---

## 2. 阶段 1：模块 A — 数据基础

### 2.1 新建 `src/shared/constants.ts`

```typescript
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

**注意**：以 FilterPanel.tsx 现有 5/7/3/5/2 项为准（不是 import-engine 中的 4/7/5/6 项），因为 FilterPanel 是用户实际看到的候选。

### 2.2 新建 `src/main/db/migrations/index.ts`

```typescript
import type { Database } from 'better-sqlite3'

interface Migration { id: string; up: (db: Database) => void }

const MIGRATIONS: Migration[] = [
  {
    id: '20260726_add_batch_id_to_topics',
    up: (db) => {
      try { db.exec('ALTER TABLE topics ADD COLUMN batch_id TEXT') } catch { /* 已存在 */ }
      try { db.exec('CREATE INDEX IF NOT EXISTS idx_topics_batch_id ON topics(batch_id)') } catch { /* 已存在 */ }
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

export function ensureMigrationTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

export function runMigrations(db: Database): void {
  ensureMigrationTable(db)
  const applied = new Set(
    db.prepare('SELECT id FROM __migrations').all().map((r: any) => r.id)
  )
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    m.up(db)
    db.prepare('INSERT INTO __migrations (id, applied_at) VALUES (?, ?)').run(
      m.id, new Date().toISOString()
    )
  }
}
```

### 2.3 修改 `src/main/db/index.ts`

在 `initDatabase()` 中 `db.exec(schemaSql)` 之后、`schema_version` 写入之前追加：

```typescript
import { runMigrations } from './migrations'
// ...
db.exec(schemaSql)
runMigrations(db)  // 新增
```

### 2.4 新建 `src/main/services/candidate-service.ts`

**修正**：直接使用 `auditRepo.getSetting/setSetting`，不引入新的 settingsRepo。

```typescript
import { SYSTEM_CANDIDATES, type CandidateField } from '../../shared/constants'
import { auditRepo } from '../db/repository/audit.repo'

const SETTING_KEY = 'system.candidates'

export function getMergedCandidates(): Record<CandidateField, string[]> {
  const userExtra = auditRepo.getSetting(SETTING_KEY) as Record<CandidateField, string[]> | undefined
  const merged: Record<CandidateField, string[]> = {} as any
  for (const field of Object.keys(SYSTEM_CANDIDATES) as CandidateField[]) {
    const base = [...SYSTEM_CANDIDATES[field]]
    const extra = userExtra?.[field] ?? []
    for (const v of extra) if (!base.includes(v)) base.push(v)
    merged[field] = base
  }
  return merged
}

export function addCandidateValue(field: CandidateField, value: string): void {
  const current = getMergedCandidates()
  if (current[field].includes(value)) return
  const userExtra = auditRepo.getSetting(SETTING_KEY) as Record<CandidateField, string[]> | undefined
    ?? { type: [], domain: [], difficulty: [], source: [], source_type: [] }
  userExtra[field] = [...(userExtra[field] ?? []), value]
  auditRepo.setSetting(SETTING_KEY, userExtra)
}
```

### 2.5 替换 FilterPanel 与 import-engine 中的本地常量

- `src/renderer/src/components/FilterPanel.tsx:10-22`：删除 `TYPE_OPTIONS/DOMAIN_OPTIONS/DIFFICULTY_OPTIONS/SOURCE_OPTIONS/SOURCE_TYPE_OPTIONS`，改为 `import { SYSTEM_CANDIDATES } from '../../../shared/constants'` 并用 `SYSTEM_CANDIDATES.type` 等访问
  - 保留 `STATUS_OPTIONS`（不属于 SYSTEM_CANDIDATES）
  - 保持现有导出名 `TYPE_OPTIONS` 等以减少 TopicLibrary.tsx 改动：`export const TYPE_OPTIONS = SYSTEM_CANDIDATES.type`
- `src/main/services/import-engine.ts:54-74`：删除 `SYSTEM_CANDIDATES`，改为 `import { SYSTEM_CANDIDATES } from '../../shared/constants'`
  - 注意 `FIELD_LABEL` 不变

### 2.6 阶段 1 验证

```bash
npm run typecheck
npm test
npm run dev  # 启动后检查 .electron-userdata/debate-drawer.db 是否有 batch_id 列与 import_batch 表
```

**Commit**：`feat(db): add migrations mechanism and unified system candidates`

---

## 3. 阶段 2：模块 B — 导入批次与撤销

### 3.1 修改 `src/shared/types.ts`

1. `Topic` 接口增加 `batch_id: string | null`
2. `TopicCreateInput` 增加 `batch_id?: string | null`
3. `TopicFilter` 增加 `batch_id?: string`
4. `ImportExecuteRequest` 增加 `fileName?: string` 和 `valueMapping?: ValueMapping`（valueMapping 类型在阶段 3 用，先占位）
5. `ImportExecuteResult` 增加 `batchId?: string`
6. 新增 `ImportBatch` 接口
7. `IPC_CHANNELS` 增加：
   - `IMPORT_REVOKE_BATCH: 'import:revokeBatch'`
   - `IMPORT_LIST_BATCHES: 'import:listBatches'`
   - `TOPIC_COUNT_BY_DIMENSION: 'topic:countByDimension'`（阶段 4 用，先加）

### 3.2 修改 `src/main/db/repository/topic.repo.ts`

1. `Topic` / `TopicRow` 接口增加 `batch_id: string | null`
2. `rowToTopic` 增加 `batch_id: row.batch_id ?? null`
3. `buildWhereClause` 的 scalarFields 增加 `{ key: 'batch_id', column: 'batch_id' }`
4. `createTopic` 的 INSERT 增加 batch_id 字段
5. 新增 `createMany(items: TopicCreateInput[]): Topic[]` —— 事务包装批量插入
6. 新增 `deleteByBatch(batchId: string): number` —— 事务包装批量删除
7. 导出新增方法

### 3.3 新建 `src/main/db/repository/import-batch.repo.ts`

按 Spec 4.2 B1 实现 `createBatch/getBatchById/listBatches/deleteBatch/countTopicsByBatch`，导出 `importBatchRepo` 对象。

### 3.4 修改 `src/main/ipc/import.ipc.ts`

**重写 IMPORT_EXECUTE handler**：

```
1. 从 req 取 topics, checkDuplicates, fileName, valueMapping
2. 应用 valueMapping（阶段 3 完整实现，本阶段先空实现）
3. importBatchRepo.createBatch 占位（imported_count=0）
4. 拉取 existing 全量
5. 构造 newTopics 占位 Topic 对象
6. findDuplicates 批量去重（保留现有逻辑）
7. 遍历 topics，跳过重复项，非重复项构造 topicsToImport 并设置 batch_id=batch.id
8. topicRepo.createMany(topicsToImport) 事务插入
9. UPDATE import_batch SET imported_count=?, duplicates_count=?, failed_count=?
10. auditRepo.addLog target_id=batch.id, detail 含 batchId/fileName
11. 返回 { imported, duplicates, failed, duplicateGroups, batchId }
```

**新增 IMPORT_REVOKE_BATCH handler**：
```
1. importBatchRepo.getBatchById(batchId) → 不存在返回 {success:false, error:'批次不存在'}
2. topicRepo.deleteByBatch(batchId)
3. importBatchRepo.deleteBatch(batchId)
4. auditRepo.addLog action='import_revoke'
5. 返回 { deletedCount }
```

**新增 IMPORT_LIST_BATCHES handler**：
```
1. importBatchRepo.listBatches()
2. 对每条 b 追加 remainingCount: importBatchRepo.countTopicsByBatch(b.id)
3. 返回带 remainingCount 的列表
```

### 3.5 修改 `src/preload/index.ts`

`importAPI` 新增：
```typescript
revokeBatch: (batchId: string) => invoke(IPC_CHANNELS.IMPORT_REVOKE_BATCH, batchId),
listBatches: () => invoke(IPC_CHANNELS.IMPORT_LIST_BATCHES)
```

更新 `src/renderer/src/index.d.ts` 中 `importAPI` 类型声明。

### 3.6 修改 `src/renderer/src/components/ImportTopicsModal.tsx`

1. `handlePickFile` 时记录 `fileName`（从 `filePath` 提取 basename）
2. `handleImport` 调用 `execute` 时传入 `fileName`
3. 导入成功后用 `messageApi.open` 显示带「撤销导入」按钮的 notification（duration=8 秒）
4. Step 3 完成页增加「撤销本次导入」按钮（次级入口）

### 3.7 新建 `src/renderer/src/components/ImportHistoryModal.tsx`

- Modal 列表展示所有批次：列 = 文件名、导入时间、导入/重复/失败数、当前剩余、操作
- 操作 1：「查看此批次」→ `store.setFilter({ batch_id: b.id })` + 关闭弹窗
- 操作 2：「撤销整批」→ Modal.confirm 二次确认 → `importAPI.revokeBatch(b.id)` → 刷新列表 + onSuccess

### 3.8 修改 `src/renderer/src/pages/TopicLibrary.tsx`

工具栏增加「导入历史」按钮，点击打开 `ImportHistoryModal`。

### 3.9 阶段 2 验证

```bash
npm run typecheck
npm test
npm run dev
# 手动：导入 100 条 → notification 出现撤销按钮 → 点撤销 → 题库回到导入前
# 手动：打开导入历史 → 看到批次记录 → 点查看此批次 → 列表筛选到该批次的题
```

**Commit**：`feat(import): support batch undo and import history`

---

## 4. 阶段 3：模块 C — 新值映射

### 4.0 关键决策（用户确认）

| 项 | 决策 |
|---|---|
| unknownValues 检测范围 | **5 字段**：type / domain / difficulty / source / source_type |
| 默认 action | **keep**（保留原值），用户主动改 map/add |
| 同一原值多行出现 | **去重只列一次**，附带出现次数显示 |
| add 语义 | 本次导入保留原值 + 持久化到 settings 表 system.candidates |
| map 语义 | 改写 topics 中该字段为目标候选值，不持久化 |
| keep 语义 | 不改写、不持久化，原值入库（后续在筛选面板可能选不到） |
| null/空值处理 | 跳过，不算"新值" |

### 4.1 修改 `src/main/services/import-engine.ts`

1. `ParsedResult` 接口增加 `unknownValues: Array<{ field: CandidateField; values: Array<{ value: string; count: number }> }>`
2. 新增 `collectUnknownValues(topics: TopicCreateInput[])` 函数：
   - 遍历 5 字段，对每个非 null/非空字符串值检测是否在 SYSTEM_CANDIDATES[field] 内
   - 不在则计入，同值去重并累加 count
   - 返回按 field 分组的结构
3. `parseExcelOrCsv` 与 `parseDocx` 末尾调用 `collectUnknownValues` 并写入返回结果
4. import-engine 内的 `SYSTEM_CANDIDATES` 别名扩展为 5 字段（增加 source_type）

### 4.2 同步 `src/shared/types.ts` 中 ParsedResult

**采用选 B**（保持 import-engine 内部定义，preload 类型声明用 `unknown` 兜底）：

- `shared/types.ts` 的 `ParsedResult` 新增 `unknownValues?: Array<{ field: string; values: Array<{ value: string; count: number }> }>`
- preload `parseFile` 返回类型保留 `ParsedResult`，渲染进程通过 `as` 断言到具体类型
- 不引入 shared → services 的依赖耦合

### 4.3 定义 ValueMapping 类型（在 `src/shared/types.ts`）

```typescript
import type { CandidateField } from './constants'

export type ValueMappingAction = 'keep' | 'map' | 'add'
export interface ValueMappingRule {
  action: ValueMappingAction
  target?: string  // action='map' 时必填，目标候选值
}
/** 结构：{ type: { '老国辩': { action: 'map', target: '新国辩' }, ... } } */
export type ValueMapping = Partial<Record<CandidateField, Record<string, ValueMappingRule>>>
```

### 4.4 扩展 `ImportExecuteRequest`

`src/shared/types.ts` 中 `ImportExecuteRequest` 增加 `valueMapping?: ValueMapping`。

### 4.5 新建 `src/renderer/src/components/import/ValueMappingPanel.tsx`

Props:
```typescript
interface Props {
  unknownValues: Array<{ field: CandidateField; values: Array<{ value: string; count: number }> }>
  candidateOptions: Record<CandidateField, string[]>  // 从主进程拉取的合并候选
  onMappingChange: (mapping: ValueMapping) => void
}
```

渲染规则：
- 仅当 `unknownValues.length > 0` 时由父组件渲染
- 每个 field 一个 Section（5 个字段中只有出现新值的才渲染）
- 每个原值一行：
  - 左侧：原值 Tag + 出现次数（如「老国辩 ×3」）
  - 中间：箭头 `→`
  - 右侧：Select 三个选项「保留原值 / 映射到... / 加入候选」
    - 默认选中「保留原值」
    - 选「映射到...」时下方显示候选值下拉，必选目标值
    - 选「加入候选」时无需额外输入
- 顶部显示总览：「检测到 N 个新值，分布在 M 个字段」
- 底部显示批量操作：「全部保留 / 全部加入候选」（不做「全部映射」，目标值不一）

类型约束：
- 用 `Record<CandidateField, ...>` 保证字段名安全
- 未知字段（不在 5 字段内）不显示

### 4.6 修改 `src/renderer/src/components/ImportTopicsModal.tsx`

1. 新增 state `valueMapping: ValueMapping` (默认 `{}`)
2. 新增 state `mergedCandidates: Record<CandidateField, string[]>`，在 modal 打开时通过 `window.settingsAPI.getCandidates()` 拉取一次
3. Step 2 当 `parsed?.unknownValues?.length > 0` 时，在预览表格上方渲染 `<ValueMappingPanel>`
4. `handleImport` 前调用 `applyMapping(topics, valueMapping)` 改写 topics 字段值：
   - `keep`：不改写
   - `map`：将该字段值改为 `rule.target`
   - `add`：不改写（保留原值），由主进程持久化到候选
5. 调用 `execute` 时传入 `valueMapping`
6. `applyMapping` 工具函数放在 `src/renderer/src/utils/valueMapping.ts`

### 4.7 新增 IPC：`getCandidates`

`src/shared/types.ts` IPC_CHANNELS 增加 `GET_CANDIDATES: 'system:getCandidates'`

在 `src/main/ipc/audit.ipc.ts` 或新建 `src/main/ipc/system.ipc.ts` 注册 handler：
```typescript
ipcMain.handle(IPC_CHANNELS.GET_CANDIDATES, () =>
  wrap(() => getMergedCandidates())
)
```

preload `settingsAPI` 新增 `getCandidates: () => invoke(IPC_CHANNELS.GET_CANDIDATES)`，并在 `preload/index.d.ts` 类型声明中补上。

### 4.8 修改 `src/main/ipc/import.ipc.ts` IMPORT_EXECUTE

在导入循环前（创建 batch 之后），统一处理 `req.valueMapping`：

```typescript
// 1. 收集所有 action='add' 的新值，按 field 分组
const adds: Partial<Record<CandidateField, string[]>> = {}
for (const [field, rules] of Object.entries(req.valueMapping ?? {})) {
  for (const [origin, rule] of Object.entries(rules)) {
    if (rule.action === 'add') {
      (adds[field] ??= []).push(origin)
    }
  }
}
// 2. 持久化到 settings 表 system.candidates
for (const [field, values] of Object.entries(adds)) {
  for (const v of values) {
    addCandidateValue(field as CandidateField, v)
  }
}
```

注意：
- 持久化在批次创建后、createMany 之前执行，即使 createMany 失败回滚，新候选值也已落库（可下次导入复用）
- 渲染进程已 applyMapping 改写过 topics 中 map 的字段，主进程不需要重复处理

### 4.9 阶段 3 验证

```bash
npm run typecheck
npm test
npm run dev
# 手动 1：构造含「1-入门」「老国辩」「自定义来源」的 xlsx
#   → 预览页 Step 2 显示 ValueMappingPanel，列出 3 个新值
#   → 默认全部「保留原值」
#   → 将「1-入门」改为「映射到 入门级」、「老国辩」改为「加入候选」、「自定义来源」保留
#   → 确认导入 → 入库后「1-入门」改为「入门级」，其余原值入库
#   → 重启应用 → 重新导入同文件 → 「老国辩」不再出现在 unknownValues（已加入候选）
# 手动 2：ValueMappingPanel 选「映射到...」但未选目标值 → 确认导入按钮禁用 + 提示
```

---

## 5. 阶段 4：模块 D + E — 分类与列表优化

### 5.0 关键决策（用户确认）

| 项 | 决策 |
|---|---|
| tags 维度候选值来源 | **全库拉取**，新增 `topic:listAllTags` IPC |
| 「(未设置)」节点筛选 | **翻译为 IS NULL**，TopicFilter 用 `'__unset__'` 语义，repo 层转换 |
| 计数与 FilterPanel 联动 | **不联动**，分类树始终反映全库分布 |
| status 维度节点 | **中文显示 + 英文 value**（如「正常」对应 `'active'`） |
| 面包屑范围 | **只反映分类树**（全部 / 维度名 / 选中值），不包含 FilterPanel 筛选 |
| 跨页全选实现 | **标志位 + 黑名单**：`allSelectedInFilter: boolean` + `exceptIds: Set<string>` |

### 5.1 修改 `src/main/db/repository/topic.repo.ts`

#### 5.1.1 新增 `listAllTags(): Array<{ value: string; count: number }>`

```typescript
/**
 * 全库聚合所有 tags，返回每个 tag 的出现次数。
 * 用于分类树 tags 维度的全库候选值。
 *
 * 实现：拉取 status='active' 的所有 topics.tags JSON 字段，
 * 在 JS 层聚合（SQLite 不便对 JSON 数组字段做 GROUP BY）。
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

#### 5.1.2 `buildWhereClause` 增加 `'__unset__'` 语义

在 `scalarFields` 循环中处理：
```typescript
for (const { key, column } of scalarFields) {
  // ...既有逻辑...
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

#### 5.1.3 `countByDimension` 不变

`countByDimension` 已在阶段 1 实现，返回 `[{ value: string | null; count: number }]`，调用方将 null 映射为 `'(未设置)'`，value 为 null 的节点点击时传 `'__unset__'`。

### 5.2 修改 `src/main/ipc/topic.ipc.ts`

新增 2 个 handler：

```typescript
// 全库按维度分组统计（已在阶段 1 添加 IPC_CHANNELS.TOPIC_COUNT_BY_DIMENSION）
ipcMain.handle(
  IPC_CHANNELS.TOPIC_COUNT_BY_DIMENSION,
  (_e, dimension: CountableDimension) =>
    wrap(() => topicRepo.countByDimension(dimension))
)

// 全库聚合所有 tags（带计数）
ipcMain.handle(IPC_CHANNELS.TOPIC_LIST_ALL_TAGS, () =>
  wrap(() => topicRepo.listAllTags())
)
```

`shared/types.ts` IPC_CHANNELS 增加 `TOPIC_LIST_ALL_TAGS: 'topic:listAllTags'`。

### 5.3 修改 `src/renderer/src/pages/TopicLibrary.tsx`

#### 5.3.1 DIMENSIONS 扩展至 8 维

```typescript
import { SYSTEM_CANDIDATES } from '../../../shared/constants'
import type { CandidateField } from '../../../shared/constants'

interface DimensionMeta {
  key: 'type' | 'domain' | 'difficulty' | 'source' | 'source_type' | 'status' | 'tags' | 'batch_id'
  label: string
  icon: React.ReactNode
  /** 候选值来源：'system' 从 SYSTEM_CANDIDATES 取；'ipc' 调用 IPC；'static' 用静态数组 */
  source: 'system' | 'ipc' | 'static'
  /** source='static' 时的静态候选（如 status） */
  staticOptions?: Array<{ label: string; value: string }>
  /** source='ipc' 时调用的 IPC method 名 */
  ipcMethod?: 'countByDimension' | 'listAllTags' | 'listBatches'
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
  { key: 'tags', label: '标签', icon: <TagsOutlined />, source: 'ipc', ipcMethod: 'listAllTags' },
  { key: 'batch_id', label: '导入批次', icon: <UploadOutlined />, source: 'ipc', ipcMethod: 'listBatches' }
]
```

#### 5.3.2 分类树用全库统计（按 dimension.source 分支拉取）

新增 state：
```typescript
const [dimensionData, setDimensionData] = useState<
  Array<{ value: string; count: number; label?: string; title?: string }>
>([])
const [dimensionLoading, setDimensionLoading] = useState(false)

useEffect(() => {
  setDimensionLoading(true)
  const meta = DIMENSIONS.find(d => d.key === dimension)!
  // 按 source 分支拉取
  if (meta.source === 'system') {
    // type/domain/difficulty/source/source_type：调用 countByDimension
    window.topicAPI.countByDimension(dimension).then(res => {
      if (res.success && res.data) {
        setDimensionData(res.data.map(r => ({ value: r.value, count: r.count })))
      }
      setDimensionLoading(false)
    })
  } else if (meta.source === 'static') {
    // status：前端用静态候选 + countByDimension 拉计数
    window.topicAPI.countByDimension(dimension).then(res => {
      if (res.success && res.data) {
        const valueToLabel = Object.fromEntries(
          (meta.staticOptions ?? []).map(o => [o.value, o.label])
        )
        setDimensionData(res.data.map(r => ({
          value: r.value,
          count: r.count,
          label: valueToLabel[r.value] ?? r.value
        })))
      }
      setDimensionLoading(false)
    })
  } else if (meta.ipcMethod === 'listAllTags') {
    // tags：全库聚合
    window.topicAPI.listAllTags().then(res => {
      if (res.success && res.data) {
        setDimensionData(res.data.map(r => ({ value: r.value, count: r.count })))
      }
      setDimensionLoading(false)
    })
  } else if (meta.ipcMethod === 'listBatches') {
    // batch_id：拉取导入批次列表
    window.importAPI.listBatches().then(res => {
      if (res.success && res.data) {
        // 同名批次累加序号 (2)、(3)
        const nameCount = new Map<string, number>()
        setDimensionData(res.data.map(b => {
          const baseName = b.file_name
          const seen = nameCount.get(baseName) ?? 0
          nameCount.set(baseName, seen + 1)
          return {
            value: b.id,  // 筛选用 batch_id
            count: b.remainingCount ?? 0,
            label: seen > 0 ? `${baseName} (${seen + 1})` : baseName,
            title: `${baseName}\n导入时间: ${b.imported_at}\n剩余: ${b.remainingCount ?? 0}`
          }
        }))
      }
      setDimensionLoading(false)
    })
  }
}, [dimension])
```

`treeData` useMemo 依赖改为 `[dimension, dimensionData, selectedCategory]`，渲染时：
- 每个节点 `value` 作为筛选值（`'__unset__'` 或具体值）
- `label` 用 dimensionData[i].label ?? dimensionData[i].value
- `title` 显示「{label} ({count})」
- 顶部追加「全部 ({totalCount})」节点，value 为 `'__all__'`

#### 5.3.3 节点点击 → setFilter

```typescript
const handleCategorySelect = (value: string) => {
  setSelectedCategory(value)
  if (value === '__all__') {
    // 清除该维度筛选
    store.setFilter({ [dimension]: undefined })
  } else {
    // value 可能是 '__unset__' 或具体值
    store.setFilter({ [dimension]: value })
  }
}
```

`store.setFilter` 调用 `topicRepo.listTopics`，repo 层 `buildWhereClause` 把 `'__unset__'` 翻译为 `IS NULL`。

#### 5.3.4 面包屑（只反映分类树）

工具栏上方新增 `<Breadcrumb>`，items：
- `{ title: '全部', onClick: () => { setSelectedCategory('__all__'); store.setFilter({ [dimension]: undefined }) } }`
- `selectedCategory !== '__all__'` 时：`{ title: DIMENSIONS.find(d=>d.key===dimension)?.label + ' / ' + (dimensionData.find(d => d.value === selectedCategory)?.label ?? selectedCategory) }`

#### 5.3.5 显式重置筛选按钮

```typescript
const hasFilterPanelActive = useMemo(() => {
  // 仅检查 FilterPanel 设置的条件（types/domains/difficulties/source/source_type/status/tags/keyword）
  // 不检查 dimension 自身的筛选（那个由面包屑管理）
  return Object.entries(store.filter).some(([k, v]) => {
    if (['page', 'pageSize', dimension].includes(k)) return false
    if (v === undefined || v === '') return false
    if (Array.isArray(v) && v.length === 0) return false
    return true
  })
}, [store.filter, dimension])
```

工具栏条件渲染：`hasFilterPanelActive && <Button onClick={() => store.resetFilter()}>重置筛选</Button>`

注意：`store.resetFilter()` 只重置 FilterPanel 设置的字段，不影响 dimension 与 selectedCategory。

#### 5.3.6 全选功能（标志位 + 黑名单）

修改 `src/renderer/src/stores/topicStore.ts`：

```typescript
interface TopicStoreState {
  // ...既有字段
  /** 跨页全选标志位：true 表示当前 filter 下的所有题都被选中（除 exceptIds 外） */
  allSelectedInFilter: boolean
  /** 跨页全选时的例外黑名单（用户手动取消的 id） */
  exceptIds: Set<string>
  // ...既有方法
  /** 当前页全选/取消全选 */
  selectPage: (pageItems: Topic[]) => void
  /** 跨页全选：设置 allSelectedInFilter=true，清空 exceptIds */
  selectAllInFilter: () => void
  /** 跨页全选模式下取消某条 */
  unselectInAllMode: (id: string) => void
  /** 退出跨页全选模式（清空所有选择） */
  clearSelection: () => void
  /** 判断某条是否被选中（兼顾跨页全选模式） */
  isSelected: (id: string) => boolean
}
```

实现要点：
- `selectPage(pageItems)`：若 `allSelectedInFilter=true`，调用 `unselectInAllMode` 退出全选模式后回退到 ids 模式；否则按 ids 设置 selectedIds
- `selectAllInFilter()`：`set({ allSelectedInFilter: true, exceptIds: new Set(), selectedIds: [] })`
- `unselectInAllMode(id)`：`set(s => ({ exceptIds: new Set(s.exceptIds).add(id) }))`
- `isSelected(id)`：`allSelectedInFilter ? !exceptIds.has(id) : selectedIds.includes(id)`
- `clearSelection()`：`set({ allSelectedInFilter: false, exceptIds: new Set(), selectedIds: [] })`

UI 渲染：
- 工具栏 Checkbox（当前页全选）：
  - `checked = allSelectedInFilter || pageItems.every(t => selectedIds.includes(t.id))`
  - `indeterminate = !checked && pageItems.some(t => selectedIds.includes(t.id))`
  - `onChange` → 调用 `store.selectPage(pageItems)`
- 跨页 Alert（条件：当前页全部选中 + 总数 > 当前页数 + 未跨页全选）：
  - 显示「已选当前页 X 条，共 Y 条」
  - 按钮「选中全部 Y 条」→ `store.selectAllInFilter()`
- 跨页全选模式下显示 Alert：
  - 显示「已选中全部 Y 条」+ 例外数「已取消 Z 条」
  - 按钮「清除选择」→ `store.clearSelection()`

TopicCard 选中状态判断改为 `store.isSelected(t.id)`（替代 `selectedIds.includes(t.id)`）。

批量操作（删除、加标签等）调用时：
- 若 `allSelectedInFilter=true`：传 `{ mode: 'all_with_except', filter, exceptIds }`
- 否则：传 `{ mode: 'ids', ids: selectedIds }`

但本期简化：跨页全选后批量删除的实现，用拉取所有 id 列表的方式（filter + exceptIds 反推），不修改 IPC 签名。

### 5.4 阶段 4 验证

```bash
npm run typecheck
npm test
npm run dev
# 手动 1：题库 500 条 → 切换各维度 → 各分类计数之和 = 总数（含「(未设置)」节点）
# 手动 2：切到「导入批次」维度 → 看到批次节点（文件名+计数）→ 点击 → 筛选到该批次
# 手动 3：选「类型 → 价值辩」→ 面包屑显示「全部 / 类型 / 价值辩」→ 点「全部」回到默认
# 手动 4：FilterPanel 设难度=进阶级 + 关键词"AI" → 点「重置筛选」→ FilterPanel 字段清空，但分类树维度与选中保留
# 手动 5：分页 20/页 → 全选当前页 → 提示「还有 480 条未选」→ 点「选中全部 500 条」→ allSelectedInFilter=true
# 手动 6：跨页全选模式下取消 1 条 → exceptIds.size=1 → 切换分页保持状态 → 点「清除选择」退出
# 手动 7：切到「状态」维度 → 节点显示「正常 / 收藏 / 黑名单」→ 点击「正常」→ 筛选 status='active'
# 手动 8：切到「类型」维度 → 点击「(未设置)」节点 → 筛选 type IS NULL 的题
# 手动 9：在 FilterPanel 设难度=进阶级 → 切到「类型」维度 → 分类树计数仍是全库分布（不联动）
```

**Commit**：`feat(library): optimize category tree, breadcrumb, and bulk select`

---

## 6. 测试计划

### 6.1 新增单元测试文件

| 文件 | 覆盖范围 |
|---|---|
| `src/main/db/__tests__/migrations.test.ts` | runMigrations 幂等性、ALTER TABLE 异常捕获、__migrations 记录 |
| `src/main/db/__tests__/import-batch.repo.test.ts` | createBatch/getBatchById/listBatches/deleteBatch/countTopicsByBatch |
| `src/main/db/__tests__/topic.repo.test.ts`（扩展） | createMany 事务回滚、deleteByBatch、countByDimension、listAllTags、`'__unset__'` 翻译为 IS NULL |
| `src/main/services/__tests__/candidate-service.test.ts` | getMergedCandidates 合并、addCandidateValue 去重持久化 |
| `src/main/services/__tests__/import-engine.test.ts`（扩展） | collectUnknownValues 检测 5 字段新值、去重与计数 |
| `src/renderer/src/utils/__tests__/valueMapping.test.ts` | applyMapping 三种 action 行为（keep/map/add） |
| `src/renderer/src/stores/__tests__/topicStore.test.ts`（扩展） | selectAllInFilter / unselectInAllMode / isSelected 跨页全选逻辑 |

### 6.2 验证命令

每阶段 commit 前必须通过：

```bash
npm run typecheck
npm test
```

最终阶段额外跑 `npm run dev` 做端到端手动验证（见各阶段验证清单）。

---

## 7. 假设与决策（补充 Spec）

| 项 | 决策 | 理由 |
|---|---|---|
| settings 存储 | 复用 `auditRepo.getSetting/setSetting` | 现状无独立 settingsRepo，避免引入冗余抽象 |
| SYSTEM_CANDIDATES 项数 | 以 FilterPanel 为准（5/7/3/5/2） | 用户实际看到的候选，import-engine 的 4/7/5/6 项是历史不一致 |
| ParsedResult 类型位置 | 保留在 import-engine 内部 | 减少 shared 模块对 services 的耦合 |
| unknownValues 检测字段 | 5 字段：type/domain/difficulty/source/source_type | 覆盖所有 SYSTEM_CANDIDATES 字段，source_type 也纳入 |
| ValueMapping 默认 action | keep（保留原值） | 保守，用户主动改 map/add，避免误操作规整数据 |
| add 持久化时机 | 主进程 IMPORT_EXECUTE 入口（batch 创建后、createMany 前） | 即使 createMany 失败回滚，新候选值已落库可下次复用 |
| tags 维度统计 | **全库拉取**（新 IPC `topic:listAllTags`） | 全库精确，替代原 plan 的"当前页近似"方案 |
| 同名批次节点 | 渲染时累加序号 (2)、(3) | 不持久化，纯展示 |
| 「(未设置)」节点筛选 | TopicFilter 用 `'__unset__'`，repo 层翻译为 IS NULL | 让用户能筛出某维度为 null 的题 |
| 计数与 FilterPanel 联动 | 不联动，分类树始终反映全库分布 | 实现简单，语义明确，避免计数与筛选条件互相影响 |
| status 维度节点 | 中文显示 + 英文 value | 与 FilterPanel 现有行为一致 |
| 面包屑范围 | 只反映分类树（全部/维度/选中值） | 不包含 FilterPanel 筛选，避免与重置按钮职责重叠 |
| 跨页全选实现 | 标志位 `allSelectedInFilter` + 黑名单 `exceptIds: Set<string>` | 避免 100000 条 .includes 性能问题；TopicCard 用 `isSelected(id)` 判断 |
| 跨页全选批量操作 | 本期简化：用 filter + exceptIds 反推 id 列表后调用现有 IPC | 不修改 batchDelete 等 IPC 签名，保持兼容 |
| valueMapping 持久化时机 | 主进程 IMPORT_EXECUTE 入口统一处理 | 渲染进程不直接写 settings |

---

## 8. 不在范围内（重申）

- 软删除/回收站
- dedup-engine 重构
- 抽签流程改动
- seed.ts 官方题库补 batch_id
- 批次「编辑」功能
- 分类树拖拽重排
- 「未设置 tags」筛选（tags 是数组字段，本期不支持 IS NULL 语义）
- 跨页全选时 IPC 签名改造（保留 batchDelete(ids) 现有签名）
- 分类树计数与 FilterPanel 筛选条件联动

---

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 迁移失败导致应用无法启动 | runMigrations 在 initDatabase 内部，外层 try/catch 已有 dialog.showErrorBox |
| createMany 事务失败导致整批未入库 | import_batch 仍记录 imported_count=0，用户可重试 |
| 撤销时外键级联清理 team_history | schema.sql 已配置 ON DELETE CASCADE，无需额外处理 |
| SYSTEM_CANDIDATES 项数变化导致旧数据筛不到 | FilterPanel 用 select 模式，旧值仍可在数据库中存在；筛选只是候选项变化 |
| 跨页全选 + exceptIds 在大批量下的内存 | Set<string> 内存占用极小，100000 条 id 约 4MB，可接受 |
| `'__unset__'` 与用户真实值冲突 | 极低概率，且 '__unset__' 是约定保留字，建议用户避免使用 |
| listAllTags 全库聚合性能 | 拉取所有 tags JSON 字段在 JS 层聚合，<5000 条 <50ms；超过 5000 条可后续优化 |
| valueMapping 持久化失败但不影响导入 | addCandidateValue 失败时仅 log，不阻断导入流程 |

---

## 10. 实施顺序总览

```
阶段 1 ✅ → 阶段 2 ⏳ → 阶段 3 ⏳ → 阶段 4 ⏳
              ↓             ↓             ↓
              commit        commit        commit
              typecheck     typecheck     typecheck
              test          test          test
```

每阶段完成后，向用户报告进度并询问是否继续下一阶段。

**阶段 2 剩余工作（待执行）**：
1. `src/preload/index.ts` importAPI 新增 `revokeBatch/listBatches`
2. `src/preload/index.d.ts` ImportAPI 类型补 `revokeBatch/listBatches`
3. `ImportTopicsModal.tsx` 传 fileName + 导入成功 notification 带「撤销导入」按钮 + Step 3 完成页加「撤销本次导入」次级入口
4. 新建 `ImportHistoryModal.tsx`（列表展示 + 「查看此批次」+「撤销整批」）
5. `TopicLibrary.tsx` 工具栏加「导入历史」按钮
6. `npm run typecheck && npm test` 验证
