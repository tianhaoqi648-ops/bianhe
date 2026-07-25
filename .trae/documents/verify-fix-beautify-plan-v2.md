# 抽辩题项目验证/Bug修复/UI美化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复全部 15 个 bug、执行 80+ 项 UI 美化、通过 typecheck 与 67 个单元测试，使项目达到生产级品质。

**Architecture:** Bug 优先 + UI 全量。阶段 0 修 typecheck 错误 → 阶段 1 修 15 个 bug → 阶段 2 美化题库管理页 → 阶段 3 美化其他页面 → 阶段 4 最终验证。每阶段完成后立即 `npm run typecheck` 验证。

**Tech Stack:** Electron + electron-vite + React 18 + TypeScript + Ant Design 5 + Zustand + better-sqlite3 + Vitest

**Design Doc:** `.trae/documents/verify-fix-beautify-design.md`

---

## 文件结构

### 新建文件（1 个）
- `src/main/ipc/utils.ts` — `getActiveWindow()` 工具函数，封装 `BrowserWindow.getFocusedWindow()` 空指针保护

### 修改文件（约 25 个）

**阶段 0（1 个）**：
- `src/renderer/src/styles/shared.ts` — 修复 `color` 未使用参数

**阶段 1 主进程（10 个）**：
- `src/shared/types.ts` — EVENT_DELETE 命名、SYSTEM_PICK_FILE 常量、DrawSessionSettings/AuditLogDetail 接口
- `src/main/ipc/system.ipc.ts` — 用常量 + getActiveWindow
- `src/main/ipc/audit.ipc.ts` — getActiveWindow 空指针保护
- `src/main/ipc/export.ipc.ts` — getActiveWindow 空指针保护 + 删除死代码
- `src/main/ipc/import.ipc.ts` — 优化导入去重性能
- `src/main/ipc/dedup.ipc.ts` — 全库去重性能优化
- `src/main/services/dedup-engine.ts` — 倒排索引 + bestReason 修复
- `src/main/services/import-engine.ts` — CSV 编码检测
- `src/main/db/repository/topic.repo.ts` — LIKE 转义 + TopicRow
- `src/main/db/repository/event.repo.ts` — 删除未使用接口 + EventRow

**阶段 1 Preload（1 个）**：
- `src/preload/index.ts` — 消除 @ts-ignore + 替换 any + 用常量

**阶段 1 渲染进程（2 个）**：
- `src/renderer/src/pages/TopicLibrary.tsx` — toggleSelect 修复
- `src/renderer/src/pages/History.tsx` — useEffect 注释 + catch e

**阶段 2 题库管理页（6 个）**：
- `src/renderer/src/pages/TopicLibrary.tsx` — Tree 图标 + 分页 sticky
- `src/renderer/src/components/TopicCard.tsx` — 选中态 + Tag 化权重
- `src/renderer/src/components/FilterPanel.tsx` — 视觉优化
- `src/renderer/src/components/ImportTopicsModal.tsx` — 表单优化
- `src/renderer/src/components/DedupResultModal.tsx` — 重复组卡片化
- `src/renderer/src/components/TopicEditModal.tsx` — 表单优化

**阶段 3 其他页面（7 个）**：
- `src/renderer/src/pages/EventManage.tsx` — 卡片网格 + Progress
- `src/renderer/src/pages/TeamManage.tsx` — 卡片网格 + 分组视图
- `src/renderer/src/pages/History.tsx` — Statistic + Skeleton + Avatar
- `src/renderer/src/pages/Settings.tsx` — Statistic 色块 + 恢复默认
- `src/renderer/src/components/EventEditModal.tsx` — 表单优化
- `src/renderer/src/components/RoundEditModal.tsx` — 表单优化
- `src/renderer/src/components/TeamEditModal.tsx` — 表单优化

### 新增依赖（1 个）
- `iconv-lite` — CSV 编码检测

---

## 阶段 0：阻塞解除

### Task 0.1: 修复 shared.ts typecheck 错误

**Files:**
- Modify: `src/renderer/src/styles/shared.ts:39`

- [ ] **Step 1: 读取 shared.ts 确认 statCardStyle 调用点**

Run: `Read src/renderer/src/styles/shared.ts`
Run: `Grep "statCardStyle" src/renderer/src/`

- [ ] **Step 2: 修复未使用 color 参数**

修改 `src/renderer/src/styles/shared.ts:39`：

```typescript
/** 统计卡片样式（带左侧色块） */
export const statCardStyle = (color: string): React.CSSProperties => ({
  borderRadius: radius.lg,
  overflow: 'hidden',
  position: 'relative',
  background: '#fff',
  border: '1px solid #f0f0f0',
  boxShadow: shadow.sm,
  borderLeft: `4px solid ${color}`
})
```

- [ ] **Step 3: 验证 typecheck 通过**

Run: `npm run typecheck`
Expected: 通过，无错误

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles/shared.ts
git commit -m "fix(styles): use color param in statCardStyle to fix unused var error"
```

---

## 阶段 1：Bug 修复

### Task 1.1: 修复 TopicLibrary toggleSelect 逻辑（Bug #1）

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx:510-512`
- Modify: `src/renderer/src/stores/topicStore.ts` (若需补 select/deselect)

- [ ] **Step 1: 读取 TopicCard onSelect 签名**

Run: `Grep "onSelect" src/renderer/src/components/TopicCard.tsx`
确认 `onSelect?: (id: string, selected: boolean) => void` 中 selected 语义

- [ ] **Step 2: 检查 topicStore 是否有 select/deselect 方法**

Run: `Grep "select|deselect|toggleSelect" src/renderer/src/stores/topicStore.ts`

- [ ] **Step 3: 若 store 无 select/deselect，添加方法**

修改 `src/renderer/src/stores/topicStore.ts`，在 set 内添加：

```typescript
select: (id: string) => set((s) => ({
  selectedIds: s.selectedIds.includes(id) ? s.selectedIds : [...s.selectedIds, id]
})),
deselect: (id: string) => set((s) => ({
  selectedIds: s.selectedIds.filter((x) => x !== id)
})),
```

- [ ] **Step 4: 修复 TopicLibrary.tsx:512**

修改 `src/renderer/src/pages/TopicLibrary.tsx:510-514`：

```tsx
onSelect={(id, sel) => sel ? store.select(id) : store.deselect(id)}
```

- [ ] **Step 5: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/TopicLibrary.tsx src/renderer/src/stores/topicStore.ts
git commit -m "fix(topics): correct toggleSelect logic in TopicLibrary list view"
```

---

### Task 1.2: 修复 SQL LIKE 转义（Bug #2）

**Files:**
- Modify: `src/main/db/repository/topic.repo.ts:120-131`

- [ ] **Step 1: 读取 topic.repo.ts 当前 LIKE 查询**

Run: `Read src/main/db/repository/topic.repo.ts:110-140`

- [ ] **Step 2: 添加 escapeLike 辅助函数**

在 `src/main/db/repository/topic.repo.ts` 顶部（import 后）添加：

```typescript
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}
```

- [ ] **Step 3: 修改 tag 和 keyword 查询使用转义**

将 tag 查询改为：
```typescript
const escapedTag = escapeLike(tag)
params.push(`%"${escapedTag}"%`)
// 对应 SQL 改为: AND tags LIKE ? ESCAPE '\\'
```

将 keyword 查询改为：
```typescript
const escapedKeyword = escapeLike(filter.keyword)
params.push(`%${escapedKeyword}%`)
// 对应 SQL 改为: AND title LIKE ? ESCAPE '\\'
```

- [ ] **Step 4: 验证 typecheck + test**

Run: `npm run typecheck && npm test`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add src/main/db/repository/topic.repo.ts
git commit -m "fix(repo): escape LIKE wildcards in topic queries"
```

---

### Task 1.3: 封装 getActiveWindow 工具函数（Bug #3）

**Files:**
- Create: `src/main/ipc/utils.ts`
- Modify: `src/main/ipc/audit.ipc.ts`
- Modify: `src/main/ipc/export.ipc.ts`
- Modify: `src/main/ipc/system.ipc.ts`

- [ ] **Step 1: 创建 utils.ts**

创建 `src/main/ipc/utils.ts`：

```typescript
import { BrowserWindow } from 'electron'

/**
 * 获取当前活动窗口，若不存在返回 null。
 * 用于 IPC handler 中避免 getFocusedWindow()! 非空断言导致的运行时错误。
 */
export function getActiveWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}
```

- [ ] **Step 2: 修改 audit.ipc.ts**

Run: `Grep "getFocusedWindow" src/main/ipc/audit.ipc.ts`

将 `BrowserWindow.getFocusedWindow()!` 替换为：
```typescript
import { getActiveWindow } from './utils'

const win = getActiveWindow()
if (!win) {
  return { success: false, error: '无可用窗口' }
}
```

- [ ] **Step 3: 修改 export.ipc.ts**

将所有 `BrowserWindow.getFocusedWindow()!` 替换为同样的保护逻辑（共 3 处：151, 220, 266 行）。

- [ ] **Step 4: 修改 system.ipc.ts**

将 `BrowserWindow.getFocusedWindow()!` 替换为同样的保护逻辑（19 行）。

- [ ] **Step 5: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/utils.ts src/main/ipc/audit.ipc.ts src/main/ipc/export.ipc.ts src/main/ipc/system.ipc.ts
git commit -m "fix(ipc): add getActiveWindow util to avoid null pointer on getFocusedWindow"
```

---

### Task 1.4: 修复 EVENT_DELETE 命名（Bug #4）

**Files:**
- Modify: `src/shared/types.ts:294`

- [ ] **Step 1: 修改常量值**

修改 `src/shared/types.ts:294`：

```typescript
EVENT_DELETE: 'event:delete',
```

- [ ] **Step 2: 验证引用点**

Run: `Grep "event:event_delete" src/`
Expected: 无匹配（所有引用通过 IPC_CHANNELS.EVENT_DELETE 常量）

- [ ] **Step 3: 验证 typecheck + test**

Run: `npm run typecheck && npm test`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "fix(types): normalize EVENT_DELETE channel name to 'event:delete'"
```

---

### Task 1.5: 修复 SYSTEM_PICK_FILE 走常量（Bug #5）

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/preload/index.ts:137`
- Modify: `src/main/ipc/system.ipc.ts:14`

- [ ] **Step 1: 在 IPC_CHANNELS 添加常量**

在 `src/shared/types.ts` 的 IPC_CHANNELS 对象中添加（位置：SYSTEM 命名空间区域）：

```typescript
SYSTEM_PICK_FILE: 'system:pickFile',
```

- [ ] **Step 2: 修改 preload/index.ts:137**

将 `ipcRenderer.invoke('system:pickFile', filters)` 改为：

```typescript
import { IPC_CHANNELS } from '../shared/types'
// ...
pickFile: (filters) => invoke<string | null>(IPC_CHANNELS.SYSTEM_PICK_FILE, filters)
```

- [ ] **Step 3: 修改 system.ipc.ts:14**

将 `ipcMain.handle('system:pickFile', ...)` 改为：

```typescript
import { IPC_CHANNELS } from '../../shared/types'
// ...
ipcMain.handle(IPC_CHANNELS.SYSTEM_PICK_FILE, ...)
```

- [ ] **Step 4: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts src/main/ipc/system.ipc.ts
git commit -m "fix(ipc): use IPC_CHANNELS.SYSTEM_PICK_FILE constant instead of string literal"
```

---

### Task 1.6: 优化导入去重性能（Bug #6）

**Files:**
- Modify: `src/main/ipc/import.ipc.ts:57-95`

- [ ] **Step 1: 读取当前导入去重逻辑**

Run: `Read src/main/ipc/import.ipc.ts:50-100`

- [ ] **Step 2: 改为批量去重**

修改 `src/main/ipc/import.ipc.ts`，将循环单条去重改为一次性批量：

```typescript
// 原：rows.map(async (row) => { const dups = await findDuplicates([newTopic, ...candidates]); ... })
// 改：
const allNewTopics = rows.map((r) => ({ ...r, source: 'custom' as const }))
const allCandidates = topicRepo.listTopics({ pageSize: 100000 }).items
const allTopics = [...allNewTopics, ...allCandidates]
const dupGroups = await findDuplicates(allTopics, options)
// 仅保留包含新题（前 rows.length 条）的组
const newTopicIds = new Set(allNewTopics.map((t) => t.id))
const duplicates = dupGroups
  .filter((g) => g.members.some((m) => newTopicIds.has(m.topicId)))
  .map((g) => ({ ...g, members: g.members.filter((m) => newTopicIds.has(m.topicId)) }))
```

- [ ] **Step 3: 验证 typecheck + test**

Run: `npm run typecheck && npm test`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/import.ipc.ts
git commit -m "perf(import): batch dedup to avoid O(n²) per-row findDuplicates calls"
```

---

### Task 1.7: 全库去重倒排索引优化（Bug #7）

**Files:**
- Modify: `src/main/services/dedup-engine.ts`

- [ ] **Step 1: 读取 dedup-engine 当前两两循环逻辑**

Run: `Grep "for.*let.*i" src/main/services/dedup-engine.ts`
Run: `Read src/main/services/dedup-engine.ts` (关注 findDuplicates 函数)

- [ ] **Step 2: 添加 bigram 倒排索引**

在 `src/main/services/dedup-engine.ts` 添加：

```typescript
function extractBigrams(text: string): Set<string> {
  const cleaned = text.replace(/\s+/g, '')
  const bigrams = new Set<string>()
  for (let i = 0; i < cleaned.length - 1; i++) {
    bigrams.add(cleaned.slice(i, i + 2))
  }
  return bigrams
}

function buildBigramIndex(topics: Topic[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>()
  topics.forEach((t, i) => {
    const bigrams = extractBigrams(t.title)
    bigrams.forEach((b) => {
      if (!index.has(b)) index.set(b, new Set())
      index.get(b)!.add(i)
    })
  })
  return index
}
```

- [ ] **Step 3: 在 findDuplicates 入口预筛候选对**

在两两循环前加预筛：

```typescript
const index = buildBigramIndex(topics)
const candidatePairs = new Set<string>()
for (let i = 0; i < topics.length; i++) {
  const bigrams = extractBigrams(topics[i].title)
  for (const b of bigrams) {
    const matches = index.get(b)
    if (matches) {
      for (const j of matches) {
        if (j > i) {
          candidatePairs.add(`${i}-${j}`)
        }
      }
    }
  }
}
// 仅对 candidatePairs 中的对计算相似度，而非全 O(n²)
```

- [ ] **Step 4: 验证 test（重点跑 dedup-engine.test.ts）**

Run: `npm test -- dedup-engine`
Expected: 18 个测试通过

- [ ] **Step 5: 验证 typecheck + 完整 test**

Run: `npm run typecheck && npm test`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add src/main/services/dedup-engine.ts
git commit -m "perf(dedup): add bigram inverted index to reduce O(n²) pairs"
```

---

### Task 1.8: CSV 编码自动检测（Bug #8）

**Files:**
- Modify: `src/main/services/import-engine.ts:171`
- Modify: `package.json` (添加依赖)

- [ ] **Step 1: 安装 iconv-lite**

Run: `npm install iconv-lite`
Expected: 安装成功。若失败，降级为仅 BOM 检测。

- [ ] **Step 2: 修改 import-engine.ts CSV 读取**

修改 `src/main/services/import-engine.ts` 的 readCsv 函数：

```typescript
import * as fs from 'fs'
import * as iconv from 'iconv-lite'

function detectEncoding(buffer: Buffer): string {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8'
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le'
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be'
  // 启发式：含 0x80-0xFE 字节且非 UTF-8 有效序列则视为 GBK
  const sample = buffer.slice(0, Math.min(buffer.length, 4096))
  let nonAscii = 0
  let invalidUtf8 = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] > 0x7f) {
      nonAscii++
      // 简单 UTF-8 序列检查
      if ((sample[i] & 0xc0) !== 0xc0 && (sample[i] & 0x80) !== 0x80) {
        invalidUtf8++
      }
    }
  }
  if (nonAscii > 0 && invalidUtf8 / nonAscii > 0.3) return 'gbk'
  return 'utf-8'
}

// readCsv 中：
const buffer = fs.readFileSync(filePath)
const encoding = detectEncoding(buffer)
const text = iconv.decode(buffer, encoding)
const workbook = XLSX.read(text, { type: 'string' })
```

- [ ] **Step 3: 验证 test（重点跑 import-engine.test.ts）**

Run: `npm test -- import-engine`
Expected: 10 个测试通过

- [ ] **Step 4: 验证 typecheck + 完整 test**

Run: `npm run typecheck && npm test`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add src/main/services/import-engine.ts package.json package-lock.json
git commit -m "fix(import): auto-detect CSV encoding (UTF-8/UTF-16/GBK) to avoid garbled Chinese"
```

---

### Task 1.9: 消除 preload @ts-ignore（Bug #9）

**Files:**
- Modify: `src/preload/index.ts:159-177`

- [ ] **Step 1: 读取 preload/index.ts 末尾 contextBridge 暴露逻辑**

Run: `Read src/preload/index.ts:150-180`

- [ ] **Step 2: 替换 @ts-ignore**

将 `// @ts-ignore` 后的 `contextBridge.exposeInMainWorld('topicAPI', topicAPI)` 改为：

```typescript
// 在 else 分支中（非 Electron 环境，主要为浏览器测试）
;(window as Window & typeof globalThis).topicAPI = topicAPI
;(window as Window & typeof globalThis).eventAPI = eventAPI
;(window as Window & typeof globalThis).drawAPI = drawAPI
;(window as Window & typeof globalThis).auditAPI = auditAPI
;(window as Window & typeof globalThis).settingsAPI = settingsAPI
;(window as Window & typeof globalThis).importAPI = importAPI
;(window as Window & typeof globalThis).exportAPI = exportAPI
;(window as Window & typeof globalThis).dedupAPI = dedupAPI
;(window as Window & typeof globalThis).fileAPI = fileAPI
```

- [ ] **Step 3: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过，无 @ts-ignore

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts
git commit -m "fix(preload): replace @ts-ignore with typed window cast"
```

---

### Task 1.10: 替换 preload any 类型（Bug #10）

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: 读取 preload/index.ts 完整内容**

Run: `Read src/preload/index.ts`

- [ ] **Step 2: 检查 shared/types.ts 中可用的输入类型**

Run: `Grep "Input\|Filter\|Params" src/shared/types.ts`

- [ ] **Step 3: 为每个 API 方法参数标注类型**

将 `any` 参数替换为具体类型。例如：

```typescript
// 原：list: (filter?: any) => invoke(...)
// 改：
import type {
  TopicFilter, TopicCreateInput, TopicUpdateInput,
  EventFilter, EventCreateInput, EventUpdateInput,
  DrawParams, SessionFilter, AuditLogFilter,
  Settings, ImportOptions, ExportOptions
} from '../shared/types'

const topicAPI: TopicAPI = {
  list: (filter?: TopicFilter) => invoke(IPC_CHANNELS.TOPIC_LIST, filter),
  create: (data: TopicCreateInput) => invoke(IPC_CHANNELS.TOPIC_CREATE, data),
  // ... 其余方法同理
}
```

若 shared/types.ts 缺少某些 Input 类型，先在 types.ts 补充定义。

- [ ] **Step 4: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过，无 `any` 参数

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/shared/types.ts
git commit -m "fix(preload): replace any params with concrete types from shared/types"
```

---

### Task 1.11: 修复 History useEffect 依赖（Bug #11）

**Files:**
- Modify: `src/renderer/src/pages/History.tsx:100-105`

- [ ] **Step 1: 读取 useEffect 上下文**

Run: `Read src/renderer/src/pages/History.tsx:95-110`

- [ ] **Step 2: 加 eslint-disable 注释**

修改 `src/renderer/src/pages/History.tsx:100`：

```typescript
useEffect(() => {
  void eventStore.listEvents()
  if (topicStore.items.length === 0) {
    void topicStore.fetchList({ pageSize: 1000 })
  }
  // zustand store 实例在组件生命周期内稳定，空依赖是正确写法
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

- [ ] **Step 3: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/History.tsx
git commit -m "fix(history): document stable zustand store dep with eslint-disable comment"
```

---

### Task 1.12: 修复 History catch e 未使用（Bug #12）

**Files:**
- Modify: `src/renderer/src/pages/History.tsx:160-162`

- [ ] **Step 1: 读取 catch 块**

Run: `Read src/renderer/src/pages/History.tsx:155-170`

- [ ] **Step 2: 修改 catch 块使用 e**

```typescript
} catch (e) {
  console.error('加载明细失败', e)
  messageApi.error(e instanceof Error ? e.message : '加载明细失败')
}
```

- [ ] **Step 3: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/History.tsx
git commit -m "fix(history): log and surface catch error to user"
```

---

### Task 1.13: 删除未使用 SessionListFilter（Bug #13）

**Files:**
- Modify: `src/main/db/repository/event.repo.ts:56-61`

- [ ] **Step 1: 确认 SessionListFilter 未被引用**

Run: `Grep "SessionListFilter" src/`
Expected: 仅在 event.repo.ts 中定义，无其他引用

- [ ] **Step 2: 删除接口定义**

删除 `src/main/db/repository/event.repo.ts:56-61` 的 SessionListFilter interface。

- [ ] **Step 3: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/main/db/repository/event.repo.ts
git commit -m "chore(repo): remove unused SessionListFilter interface"
```

---

### Task 1.14: 删除 void wrap 死代码（Bug #14）

**Files:**
- Modify: `src/main/ipc/export.ipc.ts:37`

- [ ] **Step 1: 读取上下文**

Run: `Read src/main/ipc/export.ipc.ts:30-45`

- [ ] **Step 2: 删除 void wrap 行**

删除 `src/main/ipc/export.ipc.ts:37` 的 `void wrap` 行（或包裹的整段死代码）。

- [ ] **Step 3: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/export.ipc.ts
git commit -m "chore(export): remove dead void wrap code"
```

---

### Task 1.15: 修复 dedup-engine bestReason 非空断言（Bug #15）

**Files:**
- Modify: `src/main/services/dedup-engine.ts:240`

- [ ] **Step 1: 读取上下文**

Run: `Read src/main/services/dedup-engine.ts:235-245`

- [ ] **Step 2: 替换非空断言**

修改 `src/main/services/dedup-engine.ts:240`：

```typescript
// 原：this.bestReason.set(ri, curSim >= sim ? this.bestReason.get(ri)! : reason)
// 改：
this.bestReason.set(ri, curSim >= sim ? (this.bestReason.get(ri) ?? reason) : reason)
```

- [ ] **Step 3: 验证 typecheck + test**

Run: `npm run typecheck && npm test -- dedup-engine`
Expected: 通过，18 个测试通过

- [ ] **Step 4: Commit**

```bash
git add src/main/services/dedup-engine.ts
git commit -m "fix(dedup): replace non-null assertion with nullish coalescing"
```

---

### Task 1.16: 类型安全增强（可选）

**Files:**
- Modify: `src/main/db/repository/topic.repo.ts`
- Modify: `src/main/db/repository/event.repo.ts`
- Modify: `src/main/db/repository/draw.repo.ts`
- Modify: `src/main/db/repository/audit.repo.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: 为 topic.repo.ts 定义 TopicRow**

在 `src/main/db/repository/topic.repo.ts` 顶部添加：

```typescript
interface TopicRow {
  id: string
  title: string
  type: string
  domain: string | null
  difficulty: string
  source: string
  tags: string | null
  weight: number
  status: string
  created_at: string
  updated_at: string
}
```

将所有 `stmt.get() as any` 改为 `stmt.get() as TopicRow`。

- [ ] **Step 2: 为其他 repo 同理添加 Row 接口**

event.repo.ts → EventRow
draw.repo.ts → DrawRow
audit.repo.ts → AuditLogRow

- [ ] **Step 3: 在 shared/types.ts 补充接口**

```typescript
export interface DrawSessionSettings {
  source_mix_ratio?: number
  difficulty_override?: Record<string, number>
  include_stance?: boolean
  team_pairs?: Array<{ team_a_id: string; team_b_id: string }>
  filter?: TopicFilter
}

export interface AuditLogDetail {
  action?: string
  count?: number
  ids?: string[]
  reason?: string
  [key: string]: unknown
}
```

将 DrawSession.settings: any 改为 DrawSessionSettings，AuditLog.detail: any 改为 AuditLogDetail。

- [ ] **Step 4: 验证 typecheck + test**

Run: `npm run typecheck && npm test`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add src/main/db/repository/ src/shared/types.ts
git commit -m "refactor(types): add Row interfaces and DrawSessionSettings/AuditLogDetail"
```

---

### Task 1.17: 阶段 1 整体验证

- [ ] **Step 1: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过，无错误无警告

- [ ] **Step 2: 运行全部测试**

Run: `npm test`
Expected: 67 个测试全部通过

- [ ] **Step 3: 启动应用验证**

Run: `npm run dev`（手动启动后关闭）
Expected: Electron 窗口打开，控制台无错误，数据库初始化成功

---

## 阶段 2：UI 美化 — 题库管理页

### Task 2.1: TopicLibrary.tsx 美化

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

- [ ] **Step 1: 读取 TopicLibrary.tsx 完整内容**

Run: `Read src/renderer/src/pages/TopicLibrary.tsx`

- [ ] **Step 2: Segmented 加图标 + 改 middle size**

修改分类维度 Segmented：

```tsx
import { TagOutlined, GlobalOutlined, FireOutlined, DatabaseOutlined } from '@ant-design/icons'

<Segmented
  size="middle"
  options={[
    { label: <span><TagOutlined /> 类型</span>, value: 'type' },
    { label: <span><GlobalOutlined /> 领域</span>, value: 'domain' },
    { label: <span><FireOutlined /> 难度</span>, value: 'difficulty' },
    { label: <span><DatabaseOutlined /> 来源</span>, value: 'source' }
  ]}
  value={category}
  onChange={(v) => setCategory(v as string)}
/>
```

- [ ] **Step 3: Tree 节点加图标 + Badge 计数**

修改 Tree 渲染，每个分类节点加对应图标和 Badge：

```tsx
const titleRender = (node) => (
  <Space>
    {getCategoryIcon(node.key)}
    <span>{node.title}</span>
    <Badge count={node.count} size="small" color="#1677ff" />
  </Space>
)
```

- [ ] **Step 4: 搜索框加宽 + Ctrl+K 提示**

```tsx
<Input.Search
  placeholder="搜索辩题标题或标签 (Ctrl+K)"
  style={{ width: 320 }}
  ...
/>
```

- [ ] **Step 5: 分页栏改 sticky + 模糊背景**

引用 shared.ts 的 paginationStyle：

```tsx
import { paginationStyle } from '../styles/shared'
// 分页栏改为：
<div style={paginationStyle}>
  <Pagination ... />
</div>
```

- [ ] **Step 6: 空状态加双按钮**

```tsx
<Empty
  image={Empty.PRESENTED_IMAGE_SIMPLE}
  description={<>
    <Typography.Text>题库暂无辩题</Typography.Text>
    <br />
    <Space style={{ marginTop: 16 }}>
      <Button type="primary" onClick={() => setImportOpen(true)}>导入官方题库</Button>
      <Button onClick={() => setEditOpen(true)}>新建第一道辩题</Button>
    </Space>
  </>}
/>
```

- [ ] **Step 7: 选中态底部 Affix 浮动操作栏**

```tsx
{hasSelection && (
  <Affix offsetBottom={0}>
    <div style={{ background: '#fff', padding: 12, borderTop: '1px solid #f0f0f0', boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
      <Space>
        <Text>已选 {store.selectedIds.length} 项</Text>
        <Button onClick={handleBatchDelete}>批量删除</Button>
        <Button onClick={handleBatchTag}>批量加标签</Button>
        <Button onClick={store.clearSelection}>取消选择</Button>
      </Space>
    </div>
  </Affix>
)}
```

- [ ] **Step 8: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/pages/TopicLibrary.tsx
git commit -m "feat(topics): beautify TopicLibrary with icons, sticky pagination, affix action bar"
```

---

### Task 2.2: TopicCard.tsx 美化

**Files:**
- Modify: `src/renderer/src/components/TopicCard.tsx`

- [ ] **Step 1: 读取 TopicCard.tsx**

Run: `Read src/renderer/src/components/TopicCard.tsx`

- [ ] **Step 2: 选中态加阴影 + 顶部蓝条**

```tsx
const cardStyle: React.CSSProperties = {
  ...cardStyle,
  ...(selected ? {
    boxShadow: '0 4px 12px rgba(22,119,255,0.15)',
    borderTop: '2px solid #1677ff'
  } : {})
}
```

- [ ] **Step 3: 难度标签用语义化色板**

```tsx
const difficultyColor = {
  '入门': gradient.difficultyEasy,
  '进阶': gradient.difficultyMid,
  '专业': gradient.difficultyHard
}
// 渲染：
<div style={{ background: difficultyColor[difficulty], color: '#fff', padding: '2px 8px', borderRadius: 4 }}>
  {difficulty}
</div>
```

- [ ] **Step 4: 权重数字用 Tag 包裹**

```tsx
<Tag color="blue">权重 {weight}</Tag>
```

- [ ] **Step 5: 验证 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/TopicCard.tsx
git commit -m "feat(topic-card): add selected shadow, difficulty gradient, weight tag"
```

---

### Task 2.3: FilterPanel.tsx 视觉优化

**Files:**
- Modify: `src/renderer/src/components/FilterPanel.tsx`

- [ ] **Step 1: 读取 FilterPanel.tsx**

Run: `Read src/renderer/src/components/FilterPanel.tsx`

- [ ] **Step 2: 优化间距和按钮风格**

应用 shared.ts 的 cardStyle，统一按钮 size="middle"，加 Divider 分组。

- [ ] **Step 3: 验证 typecheck + Commit**

```bash
git add src/renderer/src/components/FilterPanel.tsx
git commit -m "style(filter): unify spacing and button style"
```

---

### Task 2.4: ImportTopicsModal.tsx 表单优化

**Files:**
- Modify: `src/renderer/src/components/ImportTopicsModal.tsx`

- [ ] **Step 1: 读取 ImportTopicsModal.tsx**

- [ ] **Step 2: 优化表单间距，按钮统一风格**

加 `Form layout="vertical"`，按钮 size="middle"，统一 style。

- [ ] **Step 3: 验证 typecheck + Commit**

```bash
git add src/renderer/src/components/ImportTopicsModal.tsx
git commit -m "style(import-modal): unify form spacing and button style"
```

---

### Task 2.5: DedupResultModal.tsx 重复组卡片化

**Files:**
- Modify: `src/renderer/src/components/DedupResultModal.tsx`

- [ ] **Step 1: 读取 DedupResultModal.tsx**

- [ ] **Step 2: 重复组改 Card + 相似度可视化条**

```tsx
<Card size="small" title={`重复组 ${idx + 1} · ${group.members.length} 条`} key={idx}>
  <Progress percent={Math.round(group.similarity * 100)} size="small" />
  {group.members.map((m) => <div key={m.topicId}>{m.title}</div>)}
</Card>
```

- [ ] **Step 3: 验证 typecheck + Commit**

```bash
git add src/renderer/src/components/DedupResultModal.tsx
git commit -m "feat(dedup-modal): card-style groups with similarity progress bar"
```

---

### Task 2.6: TopicEditModal.tsx 表单优化

**Files:**
- Modify: `src/renderer/src/components/TopicEditModal.tsx`

- [ ] **Step 1: 读取 TopicEditModal.tsx**

- [ ] **Step 2: 优化表单间距，按钮统一风格**

- [ ] **Step 3: 验证 typecheck + Commit**

```bash
git add src/renderer/src/components/TopicEditModal.tsx
git commit -m "style(topic-edit-modal): unify form spacing and button style"
```

---

### Task 2.7: 阶段 2 验证

- [ ] **Step 1: typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 2: dev 启动验证**

Run: `npm run dev`
手动检查题库管理页：Tree 图标+计数、分页 sticky、题卡选中态、空状态双按钮、Affix 浮动栏

---

## 阶段 3：UI 美化 — 其他页面

### Task 3.1: EventManage.tsx 美化

**Files:**
- Modify: `src/renderer/src/pages/EventManage.tsx`

- [ ] **Step 1: 读取 EventManage.tsx**

Run: `Read src/renderer/src/pages/EventManage.tsx`

- [ ] **Step 2: 顶部加赛事总数 Tag + 状态分布统计**

```tsx
<Space>
  <Tag color="blue">共 {events.length} 场赛事</Tag>
  <Tag>筹备中 {statusCount.draft}</Tag>
  <Tag color="processing">进行中 {statusCount.active}</Tag>
  <Tag color="default">已结束 {statusCount.ended}</Tag>
</Space>
```

- [ ] **Step 3: 赛事列表改卡片网格视图**

使用 Row/Col + Card：

```tsx
<Row gutter={[16, 16]}>
  {events.map((e) => (
    <Col key={e.id} xs={24} sm={12} md={8} lg={6}>
      <Card hoverable className="btn-lift" actions={[...]}>
        <Card.Meta title={e.name} description={...} />
      </Card>
    </Col>
  ))}
</Row>
```

- [ ] **Step 4: 详情头部加 Progress 进度条**

```tsx
<Progress percent={Math.round(completedRounds / totalRounds * 100)} />
```

- [ ] **Step 5: 难度梯度 Card hover 上浮**

```tsx
<Card hoverable className="btn-lift" style={{ transform: selected ? 'translateY(-2px)' : undefined }}>
```

- [ ] **Step 6: Alert warning 改 banner**

```tsx
<Alert type="warning" banner showIcon message={...} />
```

- [ ] **Step 7: 验证 typecheck + Commit**

```bash
git add src/renderer/src/pages/EventManage.tsx
git commit -m "feat(events): add status tags, card grid, progress bar, banner alert"
```

---

### Task 3.2: TeamManage.tsx 美化

**Files:**
- Modify: `src/renderer/src/pages/TeamManage.tsx`

- [ ] **Step 1: 读取 TeamManage.tsx**

- [ ] **Step 2: 顶部加"按赛事分组"切换按钮**

```tsx
<Segmented
  options={[{ label: '列表', value: 'list' }, { label: '按赛事分组', value: 'grouped' }]}
  value={view}
  onChange={setView}
/>
```

- [ ] **Step 3: 队伍列表改卡片网格**

```tsx
<Row gutter={[16, 16]}>
  {teams.map((t) => (
    <Col key={t.id} xs={24} sm={12} md={8} lg={6}>
      <Card hoverable className="btn-lift">
        <Card.Meta title={t.name} description={...} />
      </Card>
    </Col>
  ))}
</Row>
```

- [ ] **Step 4: 历史辩题数 Tag 颜色按数量变化**

```tsx
const historyColor = count >= 5 ? 'red' : count >= 1 ? 'orange' : 'default'
<Tag color={historyColor}>{count}</Tag>
```

- [ ] **Step 5: 加视图切换（Collapse 折叠面板）**

```tsx
{view === 'grouped' && (
  <Collapse>
    {Object.entries(groupedTeams).map(([eventName, teams]) => (
      <Collapse.Panel key={eventName} header={`${eventName} (${teams.length})`}>
        {/* 队伍列表 */}
      </Collapse.Panel>
    ))}
  </Collapse>
)}
```

- [ ] **Step 6: 验证 typecheck + Commit**

```bash
git add src/renderer/src/pages/TeamManage.tsx
git commit -m "feat(teams): add card grid, grouped view, history count color tags"
```

---

### Task 3.3: History.tsx 美化

**Files:**
- Modify: `src/renderer/src/pages/History.tsx`

- [ ] **Step 1: 读取 History.tsx**

- [ ] **Step 2: 顶部加 4 个 Statistic 卡片**

```tsx
import { Statistic } from 'antd'
import { statCardStyle, statCardDecoration } from '../styles/shared'

<Row gutter={16}>
  <Col span={6}>
    <Card style={statCardStyle('#1677ff')}>
      <div style={statCardDecoration('#1677ff')} />
      <Statistic title="今日抽取" value={todayCount} />
    </Card>
  </Col>
  {/* 本周抽取 / 总抽取 / 重抽次数 */}
</Row>
```

- [ ] **Step 3: Tabs label 改 Badge**

```tsx
<Tabs items={[
  { key: 'sessions', label: <Badge count={sessionTotal} showZero offset={[10, 0]}>抽取记录</Badge>, children: ... },
  { key: 'logs', label: <Badge count={logTotal} showZero offset={[10, 0]}>操作日志</Badge>, children: ... }
]} />
```

- [ ] **Step 4: Spin 改 Skeleton**

```tsx
import { Skeleton } from 'antd'
// 替换 <Spin /> 为 <Skeleton active />
```

- [ ] **Step 5: operator 列加 Avatar**

```tsx
{
  title: '操作人',
  dataIndex: 'operator',
  render: (op: string) => (
    <Space>
      <Avatar size="small" style={{ backgroundColor: '#1677ff' }}>{op[0]}</Avatar>
      {op}
    </Space>
  )
}
```

- [ ] **Step 6: 清空日志加 Popconfirm description**

```tsx
<Popconfirm
  title="清空所有操作日志？"
  description="此操作不可恢复，将删除全部日志记录。"
  onConfirm={handleClearLogs}
  okText="确认清空"
  cancelText="取消"
>
  <Button danger>清空日志</Button>
</Popconfirm>
```

- [ ] **Step 7: 详情列改 Paragraph ellipsis**

```tsx
render: (text) => (
  <Typography.Paragraph ellipsis={{ rows: 2, expandable: true }} style={{ marginBottom: 0 }}>
    {text}
  </Typography.Paragraph>
)
```

- [ ] **Step 8: 验证 typecheck + Commit**

```bash
git add src/renderer/src/pages/History.tsx
git commit -m "feat(history): add statistic cards, badge tabs, skeleton, avatar, popconfirm"
```

---

### Task 3.4: Settings.tsx 美化

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`

- [ ] **Step 1: 读取 Settings.tsx**

- [ ] **Step 2: 去重设置 Tab 改居中响应式**

```tsx
<Row justify="center">
  <Col span={16}>
    {/* 原内容 */}
  </Col>
</Row>
```

- [ ] **Step 3: Card title 旁加必选/可选 Tag**

```tsx
<Card title={<Space>去重设置 <Tag color="blue">必选</Tag></Space>}>
```

- [ ] **Step 4: 阈值 InputNumber 旁加可视化进度条**

```tsx
<Space>
  <InputNumber min={0} max={1} step={0.05} value={threshold} onChange={setThreshold} />
  <Progress type="circle" percent={Math.round(threshold * 100)} size="small" width={32} />
</Space>
```

- [ ] **Step 5: 4 个 Statistic 卡片加左侧色块**

```tsx
<Card style={statCardStyle('#1677ff')}>
  <div style={statCardDecoration('#1677ff')} />
  <Statistic title="题库总数" value={total} />
</Card>
```

- [ ] **Step 6: 保存按钮加 ✓ 图标 + size large**

```tsx
<Button type="primary" size="large" icon={<CheckOutlined />} onClick={handleSave}>
  保存设置
</Button>
```

- [ ] **Step 7: 各 Tab 底部加"恢复默认"按钮**

```tsx
<Button onClick={handleResetDefaults}>恢复默认设置</Button>
```

- [ ] **Step 8: 表单脏时顶部 Alert**

```tsx
{isDirty && (
  <Alert type="warning" banner message="有未保存的修改" />
)}
```

- [ ] **Step 9: 验证 typecheck + Commit**

```bash
git add src/renderer/src/pages/Settings.tsx
git commit -m "feat(settings): add stat color blocks, progress bars, save icon, reset button, dirty alert"
```

---

### Task 3.5: EventEditModal/RoundEditModal/TeamEditModal 表单优化

**Files:**
- Modify: `src/renderer/src/components/EventEditModal.tsx`
- Modify: `src/renderer/src/components/RoundEditModal.tsx`
- Modify: `src/renderer/src/components/TeamEditModal.tsx`

- [ ] **Step 1: 三个 Modal 读取并统一表单风格**

对每个 Modal：
- `Form layout="vertical"`
- 按钮 size="middle"
- 统一 spacing

- [ ] **Step 2: 验证 typecheck + Commit**

```bash
git add src/renderer/src/components/EventEditModal.tsx src/renderer/src/components/RoundEditModal.tsx src/renderer/src/components/TeamEditModal.tsx
git commit -m "style(edit-modals): unify form layout and button style"
```

---

### Task 3.6: 阶段 3 验证

- [ ] **Step 1: typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 2: dev 启动验证**

Run: `npm run dev`
手动检查：EventManage 卡片网格+Progress、TeamManage 分组视图、History Statistic 卡片+Skeleton+Avatar、Settings 色块+恢复默认

---

## 阶段 4：最终验证

### Task 4.1: 静态检查

- [ ] **Step 1: typecheck**

Run: `npm run typecheck`
Expected: 通过，无错误无警告

- [ ] **Step 2: 单元测试**

Run: `npm test`
Expected: 67 个测试全部通过

### Task 4.2: 运行时验证

- [ ] **Step 1: 启动应用**

Run: `npm run dev`
Expected:
- Electron 窗口正常打开
- 控制台无错误
- 数据库 9 张表初始化成功
- 官方题库加载成功

### Task 4.3: 功能验证清单

按设计文档 4.3 节的 30+ 项清单逐项验证：

##### 抽取页（/draw）
- [ ] 空状态显示三步引导卡片
- [ ] 选择赛事/轮次/题量后点击"开始抽取"正常执行
- [ ] 抽取动画显示粒子背景 + 同心圆波纹
- [ ] 抽取结果显示双列卡片 + 错落动画
- [ ] 点击"大屏模式"进入投影视图
- [ ] 大屏顶部显示题目索引圆点指示器
- [ ] 大屏切换题目有滑入滑出动画
- [ ] 按 R 重抽 / 按 F 投屏 / 按 Esc 退出 快捷键工作
- [ ] 大屏右上角全屏按钮工作

##### 题库管理（/topics）
- [ ] 左侧 Tree 每个节点显示图标 + 计数 Badge
- [ ] 搜索框宽度 320，显示 Ctrl+K 提示
- [ ] 网格视图卡片选中态有阴影 + 顶部蓝条
- [ ] 列表视图选中态有左侧竖条
- [ ] 分页栏 sticky 在底部 + 模糊背景
- [ ] 空状态显示 SVG 插画 + 双按钮
- [ ] 多选时底部弹出浮动操作栏
- [ ] 点击"导入"打开 ImportTopicsModal 正常
- [ ] 点击"去重检查"打开 DedupResultModal 正常
- [ ] 创建/编辑/删除辩题正常
- [ ] toggleSelect 单选/多选行为正确（bug #1 验证）

##### 赛事管理（/events）
- [ ] 顶部显示赛事总数 + 状态分布统计
- [ ] 赛事列表显示卡片网格视图
- [ ] 赛事详情头部显示 Progress 进度条
- [ ] 难度梯度预设 Card hover 有上浮效果
- [ ] 点击"跳转抽取"携带 eventId/roundId 到 DrawPage
- [ ] 创建/编辑/删除赛事/轮次/队伍正常

##### 队伍管理（/teams）
- [ ] 顶部显示"按赛事分组"切换按钮
- [ ] 队伍列表显示卡片网格视图
- [ ] 历史辩题数 Tag 颜色按数量变化
- [ ] "添加队伍"按钮工作
- [ ] 视图切换（列表/分组）工作

##### 历史记录（/history）
- [ ] 顶部显示 4 个 Statistic 统计卡
- [ ] Tabs label 显示 Badge 计数
- [ ] 筛选条 Card 网格布局
- [ ] 展开行显示 Skeleton 骨架屏后加载明细
- [ ] 导出按钮工作（xlsx/csv/json）
- [ ] "清空日志"二次确认有 description 说明
- [ ] catch 块异常正确记录（bug #12 验证）

##### 设置（/settings）
- [ ] 去重设置 Tab 居中响应式布局
- [ ] Card title 旁显示"必选"/"可选"Tag
- [ ] 阈值 InputNumber 旁显示可视化进度条
- [ ] 4 个 Statistic 卡片显示左侧色块
- [ ] "已加载"显示绿色 Tag
- [ ] 保存按钮加 ✓ 图标，保存成功后短暂显示绿色
- [ ] 各 Tab 底部显示"恢复默认设置"按钮
- [ ] 表单脏时顶部显示"未保存的修改"Alert

##### 全局
- [ ] Sider Logo 显示渐变背景圆形图标 + 副标题"v1.0"
- [ ] Header 显示面包屑 + 右侧快捷操作
- [ ] Content 背景显示渐变
- [ ] 按钮统一样式（hover 有上浮 + 过渡）
- [ ] 切换路由时无闪烁
- [ ] EVENT_DELETE 命名规范（bug #4 验证）
- [ ] SYSTEM_PICK_FILE 走常量（bug #5 验证）

### Task 4.4: 响应式验证

- [ ] 调整窗口宽度到 768px、1024px、1280px、1920px
- [ ] 各页面布局正确响应
- [ ] DrawPage Sider 在小屏自动折叠

### Task 4.5: 性能验证

- [ ] 题库导入 100 条新题到 1000 条题库应在 3 秒内完成（bug #6 验证）
- [ ] 全库去重检查 5000 条题库应在 5 秒内完成（bug #7 验证）
- [ ] 抽取动画流畅无卡顿

### Task 4.6: 最终 Commit

- [ ] **Step 1: 确认所有改动已提交**

Run: `git status`
Expected: clean working tree

- [ ] **Step 2: 查看 commit 历史**

Run: `git log --oneline -20`
Expected: 看到所有 bug 修复和 UI 美化 commit

---

## 自审清单

**1. Spec coverage（设计文档覆盖）**：
- 阶段 0：✓ Task 0.1
- 阶段 1.1 高优先级 5 项：✓ Task 1.1-1.5
- 阶段 1.2 中优先级 7 项：✓ Task 1.6-1.12
- 阶段 1.3 低优先级 3 项：✓ Task 1.13-1.15
- 阶段 1.4 类型安全：✓ Task 1.16
- 阶段 2 题库页 6 文件：✓ Task 2.1-2.6
- 阶段 3 其他页 7 文件：✓ Task 3.1-3.5
- 阶段 4 验证：✓ Task 4.1-4.6

**2. Placeholder scan**：无 TBD/TODO/"implement later"，所有步骤含具体代码或命令。

**3. Type consistency**：
- `getActiveWindow()` 在 Task 1.3 定义，Task 1.3/audit/export/system 引用一致
- `select/deselect` 在 Task 1.1 Step 3 定义，Task 1.1 Step 4 引用一致
- `statCardStyle(statCardDecoration)` 在 Task 3.3/3.4 引用与 Task 0.1 修复后定义一致
- `escapeLike` 在 Task 1.2 定义并引用

**4. Ambiguity**：Task 1.1 Step 1 要求先确认 TopicCard onSelect 语义再选择修复方式，避免歧义。
