# 实现剩余页面 - 实施计划

> **Goal:** 在现有 Electron + React + TypeScript 辩题抽取工具基础上，实现 4 个占位页面（赛事管理 / 队伍管理 / 历史记录 / 设置）、6 个通用弹窗组件、2 个缺失 store、导出 IPC、官方题库种子数据，并增强 TopicLibrary 和 DrawPage 以集成导入/去重/上下文跳转能力。

**Architecture:** 沿用现有 IPC + Zustand + Ant Design 5 三层架构。主进程新增 `export.ipc.ts` 和 `db/seed.ts`，扩展 `shared/types.ts` 添加导出类型与 IPC 通道；渲染进程新增 `auditStore`、`settingsStore`、6 个 Modal 组件，重写 4 个占位页面，并增强 `TopicLibrary` 和 `DrawPage`。所有 IPC 通道遵循 `ApiResponse<T>` 协议，所有 store 沿用 `extractError<T>` 模式。

**Tech Stack:** Electron 31 / React 18 / TypeScript 5.5 / Ant Design 5 / Zustand 5 / better-sqlite3 / xlsx / mammoth / electron-vite / vitest

---

## 当前状态分析

### 已完成
- **数据库层**：`schema.sql`（9 张表）、`db/index.ts`、4 个 repository（topic/event/draw/audit）
- **服务层**：`draw-engine`、`dedup-engine`、`import-engine`、`probability`（67 个单测通过）
- **IPC 层**：5 个模块（topic/event/draw/audit/import），共 46 个通道
- **Preload**：6 个 API 对象（topicAPI/eventAPI/drawAPI/auditAPI/settingsAPI/importAPI）
- **Store**：3 个（topicStore/eventStore/drawStore）
- **页面**：`DrawPage`（211 行，已实现）、`TopicLibrary`（578 行，已实现）
- **组件**：`FilterPanel`、`TopicCard`、`TopicEditModal`、`draw/*`（6 个）
- **路由**：`App.tsx` 已配置 6 条路由（HashRouter）

### 缺失项（本计划要实现的）
1. **种子数据**：无 `data/official-topics.json`、无 `src/main/db/seed.ts`、`src/main/index.ts` 未调用 seed
2. **导出 IPC**：无 `src/main/ipc/export.ipc.ts`、未注册、未暴露 `exportAPI`、`shared/types.ts` 无导出类型
3. **Store**：缺 `auditStore`、`settingsStore`
4. **组件**：缺 `ImportTopicsModal`、`DedupResultModal`、`EventEditModal`、`TeamEditModal`、`RoundEditModal`、`TeamHistoryModal`
5. **页面**：`EventManage`、`TeamManage`、`History`、`Settings` 均为 12 行占位
6. **集成**：`TopicLibrary` 无导入/去重入口、`DrawPage` 不接收 nav state

### 关键设计决策（已与用户确认）
- **EventManage / TeamManage 分工**：分工互补。EventManage 负责赛事 CRUD + 赛事详情（轮次/队伍/难度梯度/跳转抽取）；TeamManage 负责跨赛事队伍总览 + 历史辩题录入（左侧赛事选择树，右侧队伍列表）
- **官方题库**：预置 ≥100 道经典辩题，覆盖各类型/难度/领域，首次启动通过 `settings` 表标记防止重复加载
- **AI 语义去重**：UI 占位 + 阈值可配（文本匹配层：Levenshtein + 关键词重合；AI 语义层仅 UI 配置项）

---

## 文件结构总览

### 新建文件
| 路径 | 职责 |
|---|---|
| `data/official-topics.json` | 内置官方题库数据（≥100 道） |
| `src/main/db/seed.ts` | 官方题库种子加载逻辑 |
| `src/main/ipc/export.ipc.ts` | 题库/抽取记录/赛事数据包导出 IPC |
| `src/renderer/src/stores/auditStore.ts` | 审计日志状态管理 |
| `src/renderer/src/stores/settingsStore.ts` | 系统设置状态管理 |
| `src/renderer/src/components/EventEditModal.tsx` | 赛事新增/编辑弹窗 |
| `src/renderer/src/components/TeamEditModal.tsx` | 队伍新增/编辑弹窗 |
| `src/renderer/src/components/RoundEditModal.tsx` | 轮次新增/编辑弹窗 |
| `src/renderer/src/components/TeamHistoryModal.tsx` | 队伍历史辩题录入弹窗 |
| `src/renderer/src/components/ImportTopicsModal.tsx` | 辩题导入弹窗（Excel/CSV/Word） |
| `src/renderer/src/components/DedupResultModal.tsx` | 去重检查结果弹窗 |

### 修改文件
| 路径 | 修改内容 |
|---|---|
| `src/shared/types.ts` | 新增导出相关类型 + IPC_CHANNELS 通道 |
| `src/main/ipc/index.ts` | 注册 `registerExportIpc` |
| `src/preload/index.ts` | 暴露 `exportAPI` |
| `src/main/index.ts` | `initDatabase` 后调用 `seedOfficialTopics` |
| `src/renderer/src/pages/EventManage.tsx` | 重写：赛事列表 + 抽屉式详情 |
| `src/renderer/src/pages/TeamManage.tsx` | 重写：跨赛事队伍总览 + 历史辩题录入 |
| `src/renderer/src/pages/History.tsx` | 重写：抽取记录 + 操作日志双 Tab |
| `src/renderer/src/pages/Settings.tsx` | 重写：题库信息/去重/导出/导入/去重检查 |
| `src/renderer/src/pages/TopicLibrary.tsx` | 工具栏添加"导入"和"去重检查"按钮 |
| `src/renderer/src/pages/DrawPage.tsx` | 接收 `useLocation().state` 中的 eventId/roundId |
| `src/preload/index.d.ts` | 添加 `exportAPI` 类型声明（如需） |

---

## 假设与约定

1. **沿用 `ApiResponse<T>` 协议**：所有新 IPC handler 成功返回 `{ success: true, data }`，失败返回 `{ success: false, error }`
2. **沿用 `extractError<T>` 模式**：所有新 store 复用此模式从 ApiResponse 提取数据
3. **沿用 `IPC_CHANNELS` 常量**：新通道必须加入 `src/shared/types.ts` 的 `IPC_CHANNELS` 对象
4. **不修改 schema.sql**：现有 9 张表足以支撑所有功能
5. **不修改 services 层**：dedup-engine 和 import-engine 接口已足够
6. **路径分隔符**：跨平台使用 `path.join`
7. **官方题库标记**：通过 `settings` 表 key=`official_seeded` 防止重复加载
8. **Audit 日志**：所有写操作（创建/更新/删除/导入/导出）调用 `auditRepo.addLog`
9. **导出文件路径**：使用 `dialog.showSaveDialog` 让用户选择保存位置
10. **C 盘约束**：所有运行期数据写入 `<项目根>/.electron-userdata/`（已由 `app.setPath` 重定向），不污染 C 盘

---

## 实施任务

### Phase A：基础设施（种子数据 + 导出 IPC + 类型扩展）

#### Task 1：创建官方题库数据文件

**Files:**
- Create: `data/official-topics.json`

**要求：**
- 预置 ≥100 道经典辩题
- 字段：`title`（必填）、`type`、`domain`、`difficulty`、`source`、`source_type`（固定为 "官方"）、`tags`（数组）
- 覆盖类型：价值辩、政策辩、事实辩、哲理辩、伦理辩、社会辩、教育辩、科技辩（参考 `FilterPanel.tsx` 中的 `TYPE_OPTIONS`）
- 覆盖难度：入门、初级、中级、高级、专家（参考 `DIFFICULTY_OPTIONS`）
- 覆盖领域：人生哲理、社会现象、教育文化、科技伦理、政治法律、经济商业、情感伦理、国际关系（参考 `DOMAIN_OPTIONS`）

**实现步骤：**

1. 创建 `data/` 目录
2. 创建 `data/official-topics.json`，内容为 JSON 数组，每项格式：
   ```json
   {
     "title": "顺境/逆境更有利于人的成长",
     "type": "价值辩",
     "domain": "人生哲理",
     "difficulty": "入门",
     "source": "经典辩题集",
     "source_type": "官方",
     "tags": ["成长", "环境"]
   }
   ```
3. 按以下分布生成至少 100 道题：
   - 价值辩 ~30 道（覆盖人生哲理、情感伦理）
   - 政策辩 ~25 道（覆盖社会现象、政治法律、经济商业）
   - 事实辩 ~15 道（覆盖科技伦理、国际关系）
   - 哲理辩 ~10 道（覆盖人生哲理）
   - 伦理辩 ~10 道（覆盖教育文化、情感伦理）
   - 教育辩 ~5 道
   - 科技辩 ~5 道
   - 难度分布：入门 20%、初级 30%、中级 30%、高级 15%、专家 5%
4. 验证 JSON 格式合法（用 `JSON.parse` 测试）

**Notes:**
- 题目内容须为真实经典辩题，不可编造无意义标题
- `source` 字段统一填 "经典辩题集"
- `source_type` 固定为 "官方"

---

#### Task 2：创建种子加载模块

**Files:**
- Create: `src/main/db/seed.ts`

**实现：**

```typescript
// src/main/db/seed.ts
declare module '*.json?raw' {
  const content: string
  export default content
}

import officialTopicsJson from '../../../data/official-topics.json?raw'
import { topicRepo } from './repository/topic.repo'
import { auditRepo } from './repository/audit.repo'

const SEED_FLAG_KEY = 'official_seeded'

/**
 * 检查官方题库是否已加载。
 * 通过 settings 表的 official_seeded 标记判断。
 */
function isOfficialSeeded(): boolean {
  return auditRepo.getSetting(SEED_FLAG_KEY) === true
}

/**
 * 加载官方题库到数据库。
 * - 已加载：返回 { loaded: 0, skipped: true }
 * - 未加载：逐条插入（跳过同标题），写 settings 标记，写审计日志
 */
export function seedOfficialTopics(): { loaded: number; skipped: boolean } {
  if (isOfficialSeeded()) {
    console.log('[seed] Official topics already seeded, skipping')
    return { loaded: 0, skipped: true }
  }

  const topics: Array<{
    title: string
    type: string
    domain: string
    difficulty: string
    source: string
    source_type: string
    tags: string[]
  }> = JSON.parse(officialTopicsJson)

  let loaded = 0
  for (const t of topics) {
    try {
      // 检查是否已存在同标题题（防止重复加载）
      const existing = topicRepo.listTopics({
        keyword: t.title,
        page: 1,
        pageSize: 1
      })
      if (existing.items.some((x) => x.title === t.title)) {
        continue
      }
      topicRepo.createTopic({
        title: t.title,
        type: t.type,
        domain: t.domain,
        difficulty: t.difficulty,
        source: t.source,
        source_type: t.source_type,
        tags: t.tags
      })
      loaded++
    } catch (e) {
      console.error('[seed] Failed to load topic:', t.title, e)
    }
  }

  // 标记已加载
  auditRepo.setSetting(SEED_FLAG_KEY, true)
  // 写审计日志
  auditRepo.addLog({
    action: 'system',
    target_type: 'topic',
    target_id: 'official_seed',
    operator: 'system',
    detail: { loaded, total: topics.length }
  })

  console.log(`[seed] Official topics loaded: ${loaded}/${topics.length}`)
  return { loaded, skipped: false }
}

/**
 * 强制重新加载官方题库（用于"检查更新"功能）。
 * 重置标记后调用 seedOfficialTopics。
 */
export function forceReseedOfficialTopics(): { loaded: number; skipped: boolean } {
  auditRepo.setSetting(SEED_FLAG_KEY, false)
  return seedOfficialTopics()
}
```

**验证：**
- typecheck 通过
- 注意 `?raw` 后缀的模块声明（参考 `src/main/db/index.ts` 中 `schema.sql?raw` 的用法）

---

#### Task 3：修改主进程入口调用 seed

**Files:**
- Modify: `src/main/index.ts`

**修改：**

在第 4 行 import 区添加：
```typescript
import { seedOfficialTopics } from './db/seed'
```

在 `initDatabase()` 调用后（第 58 行 `console.log('[main] Database initialized')` 之后）、`auditRepo.addLog` 启动日志之前，插入：
```typescript
    // 加载官方题库种子数据
    try {
      const result = seedOfficialTopics()
      if (!result.skipped) {
        console.log(`[main] Official topics seeded: ${result.loaded}`)
      }
    } catch (e) {
      console.error('[main] Failed to seed official topics:', e)
    }
```

---

#### Task 4：扩展共享类型定义

**Files:**
- Modify: `src/shared/types.ts`

**修改：**

1. 在 `IPC_CHANNELS` 对象中（第 334 行 `IMPORT_FIND_DUPLICATES` 之后，闭合 `}` 之前）添加导出通道：
```typescript
  // export
  EXPORT_TOPICS: 'export:topics',
  EXPORT_DRAW_SESSIONS: 'export:drawSessions',
  EXPORT_EVENT_PACKAGE: 'export:eventPackage'
```

2. 在文件末尾（第 364 行 `ExportLogsResult` 之后）添加导出相关类型：
```typescript

// ---------- 导出相关类型 ----------

export interface ExportTopicsRequest {
  /** 题库筛选条件，传 undefined 表示导出全部 */
  filter?: TopicFilter
  /** 导出格式 */
  format: 'xlsx' | 'csv' | 'json'
}

export interface ExportDrawSessionsRequest {
  /** 抽取记录筛选条件 */
  filter?: SessionFilter
  /** 导出格式 */
  format: 'xlsx' | 'csv' | 'json'
}

export interface ExportEventPackageRequest {
  /** 赛事 ID */
  eventId: string
  /** 是否包含题库 */
  includeTopics?: boolean
  /** 是否包含抽取记录 */
  includeSessions?: boolean
}

export interface ExportResult {
  filePath: string
  count: number
}
```

---

#### Task 5：创建导出 IPC handler

**Files:**
- Create: `src/main/ipc/export.ipc.ts`

**实现：**

```typescript
// src/main/ipc/export.ipc.ts
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { topicRepo } from '../db/repository/topic.repo'
import { drawRepo } from '../db/repository/draw.repo'
import { eventRepo } from '../db/repository/event.repo'
import { auditRepo } from '../db/repository/audit.repo'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ExportTopicsRequest,
  type ExportDrawSessionsRequest,
  type ExportEventPackageRequest,
  type ExportResult
} from '../../shared/types'

/**
 * 弹出保存对话框让用户选择保存位置。
 */
async function pickSavePath(
  title: string,
  defaultName: string,
  format: 'xlsx' | 'csv' | 'json'
): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const filters =
    format === 'xlsx'
      ? [{ name: 'Excel', extensions: ['xlsx'] }]
      : format === 'csv'
        ? [{ name: 'CSV', extensions: ['csv'] }]
        : [{ name: 'JSON', extensions: ['json'] }]
  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    title,
    defaultPath: defaultName,
    filters
  })
  return canceled || !filePath ? null : filePath
}

/**
 * 把行数组序列化为 CSV 字符串（含表头）。
 */
function toCsv(rows: Array<Record<string, any>>): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const row of rows) {
    const vals = headers.map((h) => {
      const v = row[h]
      const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    })
    lines.push(vals.join(','))
  }
  return lines.join('\n') + '\n'
}

/**
 * 生成简单 xlsx 文件内容（使用 xlsx 库）。
 */
function toXlsx(rows: Array<Record<string, any>>, sheetName = 'Sheet1'): Buffer {
  // 动态导入避免在 typecheck 阶段引入
  const XLSX = require('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

function writeContent(
  filePath: string,
  rows: Array<Record<string, any>>,
  format: 'xlsx' | 'csv' | 'json'
): void {
  if (format === 'xlsx') {
    writeFileSync(filePath, toXlsx(rows))
  } else if (format === 'csv') {
    writeFileSync(filePath, toCsv(rows), 'utf-8')
  } else {
    writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf-8')
  }
}

export function registerExportIpc(): void {
  // 导出题库
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_TOPICS,
    async (_e, req: ExportTopicsRequest): Promise<ApiResponse<ExportResult>> => {
      try {
        const { filter, format } = req
        const { items } = topicRepo.listTopics({ ...filter, page: 1, pageSize: 100000 })
        const rows = items.map((t) => ({
          id: t.id,
          title: t.title,
          type: t.type ?? '',
          domain: t.domain ?? '',
          difficulty: t.difficulty ?? '',
          source: t.source ?? '',
          source_type: t.source_type ?? '',
          tags: t.tags ? t.tags.join('|') : '',
          weight: t.weight,
          status: t.status,
          created_at: t.created_at,
          updated_at: t.updated_at
        }))

        const defaultName = `topics-${new Date().toISOString().slice(0, 10)}.${format}`
        const filePath = await pickSavePath('导出题库', defaultName, format)
        if (!filePath) return { success: false, error: '用户取消保存' }

        writeContent(filePath, rows, format)
        auditRepo.addLog({
          action: 'export',
          target_type: 'topic',
          target_id: 'bulk',
          operator: 'renderer',
          detail: { format, count: rows.length }
        })
        return { success: true, data: { filePath, count: rows.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 导出抽取记录
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_DRAW_SESSIONS,
    async (_e, req: ExportDrawSessionsRequest): Promise<ApiResponse<ExportResult>> => {
      try {
        const { filter, format } = req
        const { items } = drawRepo.listSessions({ ...filter, page: 1, pageSize: 100000 })
        const rows = items.map((s) => ({
          id: s.id,
          event_id: s.event_id,
          round_id: s.round_id ?? '',
          draw_time: s.draw_time ?? '',
          operator: s.operator ?? '',
          settings: s.settings ? JSON.stringify(s.settings) : ''
        }))

        const defaultName = `draw-sessions-${new Date().toISOString().slice(0, 10)}.${format}`
        const filePath = await pickSavePath('导出抽取记录', defaultName, format)
        if (!filePath) return { success: false, error: '用户取消保存' }

        writeContent(filePath, rows, format)
        auditRepo.addLog({
          action: 'export',
          target_type: 'draw_session',
          target_id: 'bulk',
          operator: 'renderer',
          detail: { format, count: rows.length }
        })
        return { success: true, data: { filePath, count: rows.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 导出赛事数据包（JSON）
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_EVENT_PACKAGE,
    async (_e, req: ExportEventPackageRequest): Promise<ApiResponse<ExportResult>> => {
      try {
        const { eventId, includeTopics = true, includeSessions = true } = req
        const event = eventRepo.getEventById(eventId)
        if (!event) return { success: false, error: '赛事不存在' }

        const rounds = eventRepo.listRoundsByEvent(eventId)
        const teams = eventRepo.listTeamsByEvent(eventId)
        const teamHistory = eventRepo.listTeamHistoryByEvent(eventId)

        const pkg: Record<string, any> = {
          event,
          rounds,
          teams,
          team_history: teamHistory,
          exported_at: new Date().toISOString()
        }

        if (includeSessions) {
          const { items: sessions } = drawRepo.listSessions({
            event_id: eventId,
            page: 1,
            pageSize: 100000
          })
          pkg.draw_sessions = sessions
        }

        if (includeTopics) {
          // 拉取该赛事抽取过的所有辩题（去重）
          const drawnTopicIds = drawRepo.listDrawnTopicIds(eventId)
          const topics: any[] = []
          for (const id of drawnTopicIds) {
            const t = topicRepo.getTopicById(id)
            if (t) topics.push(t)
          }
          pkg.topics = topics
        }

        const defaultName = `event-${event.name}-${new Date().toISOString().slice(0, 10)}.json`
        const filePath = await pickSavePath('导出赛事数据包', defaultName, 'json')
        if (!filePath) return { success: false, error: '用户取消保存' }

        writeFileSync(filePath, JSON.stringify(pkg, null, 2), 'utf-8')
        auditRepo.addLog({
          action: 'export',
          target_type: 'event',
          target_id: eventId,
          operator: 'renderer',
          detail: { includeTopics, includeSessions }
        })
        return { success: true, data: { filePath, count: 1 } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
```

**验证：**
- typecheck:node 通过
- 注意 `drawRepo.listDrawnTopicIds` 是否存在（参考 `src/main/db/repository/draw.repo.ts`，若方法名不同需调整）

---

#### Task 6：注册导出 IPC

**Files:**
- Modify: `src/main/ipc/index.ts`

**修改：**

1. 在 import 区添加：
```typescript
import { registerExportIpc } from './export.ipc'
```

2. 在 `registerAllIpc` 函数体末尾（`registerImportIpc()` 之后）添加：
```typescript
  registerExportIpc()
```

---

#### Task 7：暴露 exportAPI 到渲染进程

**Files:**
- Modify: `src/preload/index.ts`

**修改：**

1. 在 `importAPI` 定义之后（第 111 行之后）添加 `exportAPI` 对象：
```typescript

// ============================================================
// 导出 API
// ============================================================
const exportAPI = {
  exportTopics: (req: any) => invoke(IPC_CHANNELS.EXPORT_TOPICS, req),
  exportDrawSessions: (req: any) => invoke(IPC_CHANNELS.EXPORT_DRAW_SESSIONS, req),
  exportEventPackage: (req: any) => invoke(IPC_CHANNELS.EXPORT_EVENT_PACKAGE, req)
}
```

2. 在 `contextBridge.exposeInMainWorld` 块（第 116-127 行）中添加：
```typescript
    contextBridge.exposeInMainWorld('exportAPI', exportAPI)
```

3. 在 `else` 分支（第 128-143 行）中添加：
```typescript
  // @ts-ignore
  window.exportAPI = exportAPI
```

---

### Phase B：状态管理（2 个 Store）

#### Task 8：创建 auditStore

**Files:**
- Create: `src/renderer/src/stores/auditStore.ts`

**实现：**

```typescript
// src/renderer/src/stores/auditStore.ts
import { create } from 'zustand'
import type {
  AuditLog,
  AuditLogFilter,
  ApiResponse
} from '../../../shared/types'

interface AuditListResponse {
  items: AuditLog[]
  total: number
}

interface AuditState {
  logs: AuditLog[]
  total: number
  loading: boolean
  error: string | null

  listLogs: (filter?: AuditLogFilter) => Promise<void>
  clearLogs: (beforeDate?: string) => Promise<boolean>
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T
  throw new Error(res.error || '未知错误')
}

export const useAuditStore = create<AuditState>((set) => ({
  logs: [],
  total: 0,
  loading: false,
  error: null,

  listLogs: async (filter) => {
    set({ loading: true, error: null })
    try {
      const res = await window.auditAPI.listLogs(filter)
      const data = extractError<AuditListResponse>(res)
      set({ logs: data.items, total: data.total, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  clearLogs: async (beforeDate) => {
    const res = await window.auditAPI.clearLogs(beforeDate)
    extractError(res)
    return true
  }
}))
```

---

#### Task 9：创建 settingsStore

**Files:**
- Create: `src/renderer/src/stores/settingsStore.ts`

**实现：**

```typescript
// src/renderer/src/stores/settingsStore.ts
import { create } from 'zustand'
import type { ApiResponse } from '../../../shared/types'

interface SettingsState {
  settings: Record<string, any>
  loading: boolean
  error: string | null

  getAll: () => Promise<void>
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<boolean>
  remove: (key: string) => Promise<boolean>
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T
  throw new Error(res.error || '未知错误')
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {},
  loading: false,
  error: null,

  getAll: async () => {
    set({ loading: true, error: null })
    try {
      const res = await window.settingsAPI.getAll()
      const data = extractError<Record<string, any>>(res)
      set({ settings: data, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  get: async (key) => {
    const res = await window.settingsAPI.get(key)
    return extractError<any>(res)
  },

  set: async (key, value) => {
    const res = await window.settingsAPI.set(key, value)
    extractError(res)
    // 同步更新本地 settings
    set((s) => ({ settings: { ...s.settings, [key]: value } }))
    return true
  },

  remove: async (key) => {
    const res = await window.settingsAPI.delete(key)
    extractError(res)
    set((s) => {
      const next = { ...s.settings }
      delete next[key]
      return { settings: next }
    })
    return true
  }
}))
```

---

### Phase C：通用弹窗组件（6 个 Modal）

#### Task 10：创建 EventEditModal

**Files:**
- Create: `src/renderer/src/components/EventEditModal.tsx`

**实现：** 仿照 `TopicEditModal.tsx` 的结构，使用 `Modal + Form + useEffect` 模式。

```typescript
// src/renderer/src/components/EventEditModal.tsx
import { Modal, Form, Input, DatePicker, Select, message } from 'antd'
import { useEffect } from 'react'
import type { Event, EventCreateInput, EventUpdateInput } from '../../../shared/types'
import dayjs from 'dayjs'

// 注：项目未装 dayjs，但 antd DatePicker 内置 dayjs。如类型缺失需 npm i dayjs
// 实际开发时若 dayjs 未安装，可改用 Input type="date" 替代 DatePicker

export interface EventEditModalProps {
  open: boolean
  event?: Event | null
  onOk: (data: EventCreateInput | EventUpdateInput, isEdit: boolean) => Promise<void>
  onCancel: () => void
}

const STATUS_OPTIONS = ['筹备中', '进行中', '已结束']

export default function EventEditModal({ open, event, onOk, onCancel }: EventEditModalProps) {
  const [form] = Form.useForm()
  const isEdit = !!event
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    if (open) {
      if (event) {
        form.setFieldsValue({
          name: event.name,
          status: event.status ?? undefined,
          dateRange:
            event.start_date && event.end_date ? [event.start_date, event.end_date] : undefined
        })
      } else {
        form.resetFields()
        form.setFieldsValue({ status: '筹备中' })
      }
    }
  }, [open, event, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const payload: any = {
        name: values.name,
        status: values.status
      }
      if (values.dateRange) {
        payload.start_date = values.dateRange[0].toISOString()
        payload.end_date = values.dateRange[1].toISOString()
      }
      await onOk(payload, isEdit)
    } catch (e: any) {
      if (e?.errorFields) {
        messageApi.error('请完善必填字段')
      } else {
        messageApi.error(e instanceof Error ? e.message : '保存失败')
      }
    }
  }

  return (
    <>
      {contextHolder}
      <Modal
        title={isEdit ? '编辑赛事' : '创建赛事'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="赛事名称"
            rules={[{ required: true, message: '请输入赛事名称' }]}
          >
            <Input maxLength={100} placeholder="例如：2026 校园辩论赛" />
          </Form.Item>
          <Form.Item name="dateRange" label="赛事日期范围">
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="赛事状态">
            <Select options={STATUS_OPTIONS.map((v) => ({ label: v, value: v }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
```

**Notes:**
- antd 5 的 DatePicker 默认使用 dayjs；若 `dayjs` 类型未安装，运行 `npm install dayjs`
- 实际开发时检查 package.json 是否已有 dayjs（antd 5 间接依赖通常会装上）

---

#### Task 11：创建 TeamEditModal

**Files:**
- Create: `src/renderer/src/components/TeamEditModal.tsx`

**实现：**

```typescript
// src/renderer/src/components/TeamEditModal.tsx
import { Modal, Form, Input, message } from 'antd'
import { useEffect } from 'react'
import type { Team, TeamCreateInput, TeamUpdateInput } from '../../../shared/types'

export interface TeamEditModalProps {
  open: boolean
  team?: Team | null
  eventId: string
  onOk: (data: TeamCreateInput | TeamUpdateInput, isEdit: boolean) => Promise<void>
  onCancel: () => void
}

export default function TeamEditModal({ open, team, eventId, onOk, onCancel }: TeamEditModalProps) {
  const [form] = Form.useForm()
  const isEdit = !!team
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    if (open) {
      if (team) {
        form.setFieldsValue({ name: team.name })
      } else {
        form.resetFields()
      }
    }
  }, [open, team, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const payload: any = isEdit ? { name: values.name } : { name: values.name, event_id: eventId }
      await onOk(payload, isEdit)
    } catch (e: any) {
      if (e?.errorFields) {
        messageApi.error('请输入队伍名称')
      } else {
        messageApi.error(e instanceof Error ? e.message : '保存失败')
      }
    }
  }

  return (
    <>
      {contextHolder}
      <Modal
        title={isEdit ? '编辑队伍' : '添加队伍'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText="保存"
        cancelText="取消"
        width={440}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="队伍名称"
            rules={[{ required: true, message: '请输入队伍名称' }]}
          >
            <Input maxLength={50} placeholder="例如：正方一队" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
```

---

#### Task 12：创建 RoundEditModal

**Files:**
- Create: `src/renderer/src/components/RoundEditModal.tsx`

**实现：**

```typescript
// src/renderer/src/components/RoundEditModal.tsx
import { Modal, Form, Input, InputNumber, Select, message } from 'antd'
import { useEffect } from 'react'
import type { Round, RoundCreateInput, RoundUpdateInput } from '../../../shared/types'
import { DIFFICULTY_OPTIONS } from './FilterPanel'

export interface RoundEditModalProps {
  open: boolean
  round?: Round | null
  eventId: string
  onOk: (data: RoundCreateInput | RoundUpdateInput, isEdit: boolean) => Promise<void>
  onCancel: () => void
}

export default function RoundEditModal({ open, round, eventId, onOk, onCancel }: RoundEditModalProps) {
  const [form] = Form.useForm()
  const isEdit = !!round
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    if (open) {
      if (round) {
        form.setFieldsValue({
          name: round.name ?? undefined,
          round_number: round.round_number ?? undefined,
          difficulty_override: round.difficulty_override ?? undefined,
          topic_count: round.topic_count ?? undefined
        })
      } else {
        form.resetFields()
      }
    }
  }, [open, round, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const payload: any = {
        name: values.name,
        round_number: values.round_number,
        difficulty_override: values.difficulty_override,
        topic_count: values.topic_count
      }
      if (!isEdit) payload.event_id = eventId
      await onOk(payload, isEdit)
    } catch (e: any) {
      if (e?.errorFields) {
        messageApi.error('请完善必填字段')
      } else {
        messageApi.error(e instanceof Error ? e.message : '保存失败')
      }
    }
  }

  return (
    <>
      {contextHolder}
      <Modal
        title={isEdit ? '编辑轮次' : '创建轮次'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="轮次名称"
            rules={[{ required: true, message: '请输入轮次名称' }]}
          >
            <Input maxLength={50} placeholder="例如：小组赛 / 复赛 / 决赛" />
          </Form.Item>
          <Form.Item name="round_number" label="轮次序号" rules={[{ required: true }]}>
            <InputNumber min={1} max={20} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="difficulty_override" label="难度限制">
            <Select
              allowClear
              placeholder="不限制则使用题库默认难度"
              options={DIFFICULTY_OPTIONS.map((v) => ({ label: v, value: v }))}
            />
          </Form.Item>
          <Form.Item name="topic_count" label="题目数量">
            <InputNumber min={1} max={50} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
```

---

#### Task 13：创建 TeamHistoryModal

**Files:**
- Create: `src/renderer/src/components/TeamHistoryModal.tsx`

**实现要求：**
- 显示某队伍已录入的历史辩题列表（含辩题标题、赛事名、对局时间）
- 提供"手动添加历史辩题"按钮：选择辩题（从题库搜索）+ 选择赛事 + 录入对局时间
- 提供"从历史赛事导入"按钮：选择其他赛事 → 拉取该赛事中此队伍的抽题记录（draw_sessions）→ 批量导入到 team_history
- 支持删除单条历史记录

```typescript
// src/renderer/src/components/TeamHistoryModal.tsx
import { Modal, Table, Button, Space, message, Popconfirm, Select, DatePicker, Input, Empty } from 'antd'
import { useState, useEffect } from 'react'
import { PlusOutlined, ImportOutlined, DeleteOutlined } from '@ant-design/icons'
import type { Team, TeamHistory, Topic, Event } from '../../../shared/types'

export interface TeamHistoryModalProps {
  open: boolean
  team: Team | null
  events: Event[]
  onAdd: (data: { team_id: string; topic_id: string; event_id: string; played_at?: string | null }) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  onCancel: () => void
}

interface HistoryWithDetail extends TeamHistory {
  topic_title?: string
  event_name?: string
}

export default function TeamHistoryModal({ team, events, onAdd, onDelete, onCancel, open }: TeamHistoryModalProps) {
  const [history, setHistory] = useState<HistoryWithDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [topicOptions, setTopicOptions] = useState<Topic[]>([])
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [playedAt, setPlayedAt] = useState<string | null>(null)
  const [importEventId, setImportEventId] = useState<string | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  const loadHistory = async () => {
    if (!team) return
    setLoading(true)
    try {
      const res = await window.eventAPI.listTeamHistory(team.id)
      if (res.success && res.data) {
        const items = res.data as TeamHistory[]
        // 拉取每条记录的辩题标题和赛事名
        const detailed: HistoryWithDetail[] = []
        for (const h of items) {
          const topicRes = await window.topicAPI.get(h.topic_id)
          const event = events.find((e) => e.id === h.event_id)
          detailed.push({
            ...h,
            topic_title: topicRes.success ? (topicRes.data as Topic).title : '(已删除)',
            event_name: event?.name ?? '(未知赛事)'
          })
        }
        setHistory(detailed)
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && team) loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, team])

  const searchTopics = async (keyword: string) => {
    const res = await window.topicAPI.list({ keyword, page: 1, pageSize: 20 })
    if (res.success && res.data) {
      setTopicOptions((res.data as any).items ?? res.data)
    }
  }

  const handleAdd = async () => {
    if (!team || !selectedTopicId || !selectedEventId) {
      messageApi.warning('请选择辩题和赛事')
      return
    }
    const ok = await onAdd({
      team_id: team.id,
      topic_id: selectedTopicId,
      event_id: selectedEventId,
      played_at: playedAt
    })
    if (ok) {
      messageApi.success('已添加')
      setAddOpen(false)
      setSelectedTopicId(null)
      setSelectedEventId(null)
      setPlayedAt(null)
      loadHistory()
    }
  }

  const handleImport = async () => {
    if (!team || !importEventId) {
      messageApi.warning('请选择源赛事')
      return
    }
    // 拉取源赛事的所有抽取记录
    const res = await window.drawAPI.listSessions({ event_id: importEventId, page: 1, pageSize: 100000 })
    if (!res.success || !res.data) {
      messageApi.error('拉取抽取记录失败')
      return
    }
    const sessions = (res.data as any).items ?? res.data
    let imported = 0
    for (const s of sessions) {
      const detail = await window.drawAPI.getSession(s.id)
      if (!detail.success || !detail.data) continue
      const items = (detail.data as any).items ?? []
      for (const item of items) {
        // 该队伍作为 team_a 或 team_b 参与的辩题
        if (item.team_a_id === team.id || item.team_b_id === team.id) {
          try {
            await onAdd({
              team_id: team.id,
              topic_id: item.topic_id,
              event_id: importEventId,
              played_at: s.draw_time
            })
            imported++
          } catch {
            // 跳过重复
          }
        }
      }
    }
    messageApi.success(`已导入 ${imported} 条历史辩题`)
    setImportOpen(false)
    setImportEventId(null)
    loadHistory()
  }

  const columns = [
    { title: '辩题', dataIndex: 'topic_title', key: 'topic_title' },
    { title: '赛事', dataIndex: 'event_name', key: 'event_name' },
    { title: '对局时间', dataIndex: 'played_at', key: 'played_at', render: (v: string) => v ?? '-' },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, record: HistoryWithDetail) => (
        <Popconfirm
          title="确认删除该历史记录？"
          onConfirm={async () => {
            const ok = await onDelete(record.id)
            if (ok) {
              messageApi.success('已删除')
              loadHistory()
            }
          }}
        >
          <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      )
    }
  ]

  return (
    <>
      {contextHolder}
      <Modal
        title={team ? `队伍历史辩题：${team.name}` : '队伍历史辩题'}
        open={open}
        onCancel={onCancel}
        footer={null}
        width={720}
      >
        <Space style={{ marginBottom: 12 }}>
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>手动添加</Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>从历史赛事导入</Button>
          <Button onClick={loadHistory}>刷新</Button>
        </Space>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={history}
          loading={loading}
          size="small"
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="暂无历史辩题" /> }}
        />

        {/* 手动添加弹窗 */}
        <Modal
          title="添加历史辩题"
          open={addOpen}
          onOk={handleAdd}
          onCancel={() => setAddOpen(false)}
          okText="添加"
          cancelText="取消"
        >
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Select
              showSearch
              placeholder="搜索辩题标题"
              style={{ width: '100%' }}
              filterOption={false}
              onSearch={searchTopics}
              onChange={setSelectedTopicId}
              notFoundContent={null}
              options={topicOptions.map((t) => ({ label: t.title, value: t.id }))}
            />
            <Select
              placeholder="选择赛事"
              style={{ width: '100%' }}
              onChange={setSelectedEventId}
              options={events.map((e) => ({ label: e.name, value: e.id }))}
            />
            <DatePicker
              showTime
              placeholder="对局时间（可选）"
              onChange={(_, ts: string) => setPlayedAt(ts)}
              style={{ width: '100%' }}
            />
          </Space>
        </Modal>

        {/* 从历史赛事导入弹窗 */}
        <Modal
          title="从历史赛事导入"
          open={importOpen}
          onOk={handleImport}
          onCancel={() => setImportOpen(false)}
          okText="导入"
          cancelText="取消"
        >
          <Select
            placeholder="选择源赛事"
            style={{ width: '100%' }}
            onChange={setImportEventId}
            options={events.map((e) => ({ label: e.name, value: e.id }))}
          />
          <p style={{ color: '#888', marginTop: 12, fontSize: 12 }}>
            将拉取该赛事中此队伍参与的所有抽取记录，自动导入为历史辩题。
          </p>
        </Modal>
      </Modal>
    </>
  )
}
```

---

#### Task 14：创建 ImportTopicsModal

**Files:**
- Create: `src/renderer/src/components/ImportTopicsModal.tsx`

**实现要求：**
- 流程：选择文件 → 自动解析 → 预览映射 → 确认导入 → 结果报告
- 支持格式：.xlsx / .csv / .docx
- 调用 `window.importAPI.parseFile(filePath, fileType)` 解析
- 调用 `window.importAPI.execute({ topics, checkDuplicates: true })` 导入
- 使用 `Upload` 组件获取文件，从 `file.path` 取绝对路径

```typescript
// src/renderer/src/components/ImportTopicsModal.tsx
import { Modal, Upload, Table, Alert, message, Steps, Button, Space, Typography } from 'antd'
import { InboxOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { useState } from 'react'
import type { TopicCreateInput, ImportExecuteResult } from '../../../shared/types'

const { Dragger } = Upload
const { Text } = Typography

export interface ImportTopicsModalProps {
  open: boolean
  onDone: () => void
  onCancel: () => void
}

type FileType = 'xlsx' | 'csv' | 'docx'

function detectFileType(name: string): FileType | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx'
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.docx')) return 'docx'
  return null
}

export default function ImportTopicsModal({ open, onDone, onCancel }: ImportTopicsModalProps) {
  const [step, setStep] = useState(0) // 0:选择文件 1:预览 2:结果
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [parsed, setParsed] = useState<{ topics: TopicCreateInput[]; warnings: string[] } | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [result, setResult] = useState<ImportExecuteResult | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  const reset = () => {
    setStep(0)
    setParsed(null)
    setFilePath(null)
    setResult(null)
    setParsing(false)
    setImporting(false)
  }

  const handleFile = async (file: File) => {
    const fileType = detectFileType(file.name)
    if (!fileType) {
      messageApi.error('不支持的文件格式，仅支持 .xlsx / .csv / .docx')
      return false
    }

    // Electron 环境下 file.path 是绝对路径
    const absPath = (file as any).path as string | undefined
    if (!absPath) {
      messageApi.error('无法获取文件路径，请在 Electron 环境中运行')
      return false
    }

    setParsing(true)
    try {
      const res = await window.importAPI.parseFile(absPath, fileType)
      if (res.success && res.data) {
        setParsed({
          topics: (res.data as any).topics ?? [],
          warnings: (res.data as any).warnings ?? []
        })
        setFilePath(absPath)
        setStep(1)
      } else {
        messageApi.error(res.error || '解析失败')
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '解析失败')
    } finally {
      setParsing(false)
    }
    return false // 阻止 antd 自动上传
  }

  const handleImport = async () => {
    if (!parsed || parsed.topics.length === 0) return
    setImporting(true)
    try {
      const res = await window.importAPI.execute({
        topics: parsed.topics,
        checkDuplicates: true
      })
      if (res.success && res.data) {
        setResult(res.data as ImportExecuteResult)
        setStep(2)
      } else {
        messageApi.error(res.error || '导入失败')
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const handleClose = () => {
    if (step === 2) {
      onDone()
    } else {
      onCancel()
    }
    reset()
  }

  const columns = [
    { title: '辩题标题', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: '类型', dataIndex: 'type', key: 'type', width: 100 },
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 80 },
    { title: '领域', dataIndex: 'domain', key: 'domain', width: 120 }
  ]

  return (
    <>
      {contextHolder}
      <Modal
        title="导入辩题"
        open={open}
        onCancel={handleClose}
        width={720}
        footer={
          step === 1 ? (
            <Space>
              <Button onClick={handleClose}>取消</Button>
              <Button type="primary" loading={importing} onClick={handleImport}>
                确认导入 {parsed?.topics.length ?? 0} 道
              </Button>
            </Space>
          ) : step === 2 ? (
            <Button type="primary" onClick={handleClose}>完成</Button>
          ) : (
            <Button onClick={handleClose}>取消</Button>
          )
        }
      >
        <Steps current={step} size="small" style={{ marginBottom: 20 }} items={[
          { title: '选择文件' },
          { title: '预览映射' },
          { title: '导入结果' }
        ]} />

        {step === 0 && (
          <Dragger
            accept=".xlsx,.xls,.csv,.docx"
            multiple={false}
            showUploadList={false}
            beforeUpload={handleFile}
            disabled={parsing}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">{parsing ? '解析中...' : '点击或拖拽文件到此区域'}</p>
            <p className="ant-upload-hint">支持 .xlsx / .csv / .docx 格式</p>
          </Dragger>
        )}

        {step === 1 && parsed && (
          <>
            {parsed.warnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                icon={<WarningOutlined />}
                style={{ marginBottom: 12 }}
                message={`解析到 ${parsed.warnings.length} 条警告`}
                description={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {parsed.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                }
              />
            )}
            <Text type="secondary">已解析 {parsed.topics.length} 道辩题，预览前 20 条：</Text>
            <Table
              rowKey={(_, i) => String(i)}
              columns={columns}
              dataSource={parsed.topics.slice(0, 20)}
              size="small"
              pagination={false}
              style={{ marginTop: 8 }}
            />
          </>
        )}

        {step === 2 && result && (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message="导入完成"
            description={
              <Space direction="vertical" size={4}>
                <Text>成功导入：<Text strong>{result.imported}</Text> 道</Text>
                <Text>跳过重复：<Text strong>{result.duplicates}</Text> 道</Text>
                {result.failed > 0 && <Text type="danger">失败：{result.failed} 道</Text>}
              </Space>
            }
          />
        )}
      </Modal>
    </>
  )
}
```

---

#### Task 15：创建 DedupResultModal

**Files:**
- Create: `src/renderer/src/components/DedupResultModal.tsx`

**实现要求：**
- 点击"运行去重检查"后拉取全量题库，调用 `window.importAPI.findDuplicates(topics, options)`
- 分组展示相似辩题（每个 DuplicateGroup 一个 Collapse panel）
- 支持勾选要删除的辩题，一键批量删除
- 显示相似度分数和触发原因

```typescript
// src/renderer/src/components/DedupResultModal.tsx
import { Modal, Button, Collapse, Checkbox, Empty, Spin, Alert, Space, Typography, Tag, message } from 'antd'
import { useState } from 'react'
import type { Topic, DuplicateGroup } from '../../../shared/types'

const { Text } = Typography

const REASON_LABEL: Record<string, string> = {
  exact: '完全相同',
  levenshtein: '编辑距离',
  keyword: '关键词重合',
  ai: 'AI 语义'
}

const REASON_COLOR: Record<string, string> = {
  exact: 'red',
  levenshtein: 'orange',
  keyword: 'gold',
  ai: 'purple'
}

export interface DedupResultModalProps {
  open: boolean
  onCancel: () => void
  onDeleted: () => void
}

export default function DedupResultModal({ open, onCancel, onDeleted }: DedupResultModalProps) {
  const [loading, setLoading] = useState(false)
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  const runDedup = async () => {
    setLoading(true)
    setSelectedIds(new Set())
    try {
      // 拉取全量题库
      const res = await window.topicAPI.list({ page: 1, pageSize: 100000 })
      if (!res.success || !res.data) {
        messageApi.error(res.error || '拉取题库失败')
        return
      }
      const topics = (res.data as any).items ?? res.data
      if (topics.length < 2) {
        setGroups([])
        return
      }
      // 调用去重检测
      const dupRes = await window.importAPI.findDuplicates(topics, {
        levenshteinThreshold: 5,
        keywordThreshold: 0.8
      })
      if (dupRes.success && dupRes.data) {
        setGroups(dupRes.data as DuplicateGroup[])
      } else {
        messageApi.error(dupRes.error || '去重检测失败')
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '去重检测失败')
    } finally {
      setLoading(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    setDeleting(true)
    try {
      const ids = Array.from(selectedIds)
      const res = await window.topicAPI.batchDelete(ids)
      if (res.success) {
        messageApi.success(`已删除 ${ids.length} 道重复辩题`)
        setSelectedIds(new Set())
        await runDedup() // 重新检测
        onDeleted()
      } else {
        messageApi.error(res.error || '删除失败')
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  // 首次打开自动运行
  if (open && !loading && groups.length === 0 && selectedIds.size === 0) {
    // 仅触发一次
    setTimeout(() => runDedup(), 0)
  }

  return (
    <>
      {contextHolder}
      <Modal
        title="去重检查"
        open={open}
        onCancel={onCancel}
        width={800}
        footer={
          <Space>
            <Button onClick={onCancel}>关闭</Button>
            <Button onClick={runDedup} loading={loading}>重新检测</Button>
            <Button
              type="primary"
              danger
              disabled={selectedIds.size === 0}
              loading={deleting}
              onClick={handleBatchDelete}
            >
              删除选中（{selectedIds.size}）
            </Button>
          </Space>
        }
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin tip="正在检测重复辩题..." />
          </div>
        ) : groups.length === 0 ? (
          <Empty description="未检测到重复辩题" />
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`共检测到 ${groups.length} 组相似辩题`}
              description="勾选要删除的辩题（建议每组保留 1 道），点击"删除选中"批量删除。"
            />
            <Collapse
              items={groups.map((g, idx) => ({
                key: g.id || idx,
                label: (
                  <Space>
                    <Text>第 {idx + 1} 组（{g.topics.length} 道）</Text>
                    <Tag color={REASON_COLOR[g.reason]}>{REASON_LABEL[g.reason]}</Tag>
                    <Text type="secondary">相似度 {(g.similarity * 100).toFixed(1)}%</Text>
                  </Space>
                ),
                children: (
                  <div>
                    {g.topics.map((t) => (
                      <div key={t.id} style={{ padding: '6px 0', borderBottom: '1px dashed #eee' }}>
                        <Checkbox
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                        >
                          <Text>{t.title}</Text>
                          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                            [{t.type ?? '-'} / {t.difficulty ?? '-'} / {t.source_type ?? '-'}]
                          </Text>
                        </Checkbox>
                      </div>
                    ))}
                  </div>
                )
              }))}
            />
          </>
        )}
      </Modal>
    </>
  )
}
```

---

### Phase D：核心页面（4 个）

#### Task 16：实现 EventManage 页面

**Files:**
- Modify: `src/renderer/src/pages/EventManage.tsx`（重写）

**实现要求：**

参考设计文档 5.8 节，实现：
1. **赛事列表**：表格展示（名称、日期、状态、操作），支持创建/编辑/删除
2. **赛事详情（抽屉式）**：点击赛事行打开 Drawer，包含 4 个子区块：
   a. 队伍管理：列表 + 添加/删除队伍 + "录入历史辩题"按钮（打开 TeamHistoryModal）
   b. 轮次设置：列表 + 创建/编辑/删除轮次
   c. 难度梯度预设：一键创建"小组赛→复赛→决赛"3 个轮次
   d. "前往抽取"按钮：跳转 `/draw` 并通过 `useNavigate` state 传递 `{ eventId, roundId }`
3. 使用 `useEventStore` 和 `EventEditModal`、`TeamEditModal`、`RoundEditModal`、`TeamHistoryModal` 组件

**关键代码结构：**

```typescript
// src/renderer/src/pages/EventManage.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout, Table, Button, Space, Modal, message, Drawer, Tag, Card, Divider, Empty, Typography, theme } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, TeamOutlined, TrophyOutlined, ThunderboltOutlined, SettingOutlined } from '@ant-design/icons'
import { useEventStore } from '../stores/eventStore'
import EventEditModal from '../components/EventEditModal'
import TeamEditModal from '../components/TeamEditModal'
import RoundEditModal from '../components/RoundEditModal'
import TeamHistoryModal from '../components/TeamHistoryModal'
import type { Event, Round, Team } from '../../../shared/types'

const { Text, Title } = Typography

const STATUS_COLOR: Record<string, string> = {
  '筹备中': 'default',
  '进行中': 'processing',
  '已结束': 'success'
}

// 难度梯度预设
const DIFFICULTY_PRESET = [
  { round_number: 1, name: '小组赛', difficulty_override: '入门', topic_count: 4 },
  { round_number: 2, name: '复赛', difficulty_override: '中级', topic_count: 4 },
  { round_number: 3, name: '决赛', difficulty_override: '高级', topic_count: 6 }
]

export default function EventManage() {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const eventStore = useEventStore()

  const [editOpen, setEditOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [currentEvent, setCurrentEvent] = useState<Event | null>(null)
  const [teamEditOpen, setTeamEditOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [roundEditOpen, setRoundEditOpen] = useState(false)
  const [editingRound, setEditingRound] = useState<Round | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyTeam, setHistoryTeam] = useState<Team | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    eventStore.listEvents()
  }, [])

  // ... 实现赛事 CRUD、抽屉详情、队伍/轮次管理、难度梯度预设、跳转抽取等逻辑
  // 详见 brainstorming 决策：EventManage 负责赛事 CRUD + 详情

  const handleApplyPreset = async () => {
    if (!currentEvent) return
    Modal.confirm({
      title: '应用难度梯度预设？',
      content: '将创建"小组赛/复赛/决赛"3 个轮次。如果已有同序号轮次，将跳过。',
      okText: '应用',
      cancelText: '取消',
      onOk: async () => {
        const existing = eventStore.rounds
        let created = 0
        for (const p of DIFFICULTY_PRESET) {
          if (existing.some((r) => r.round_number === p.round_number)) continue
          await eventStore.createRound({
            event_id: currentEvent.id,
            name: p.name,
            round_number: p.round_number,
            difficulty_override: p.difficulty_override,
            topic_count: p.topic_count
          })
          created++
        }
        messageApi.success(`已创建 ${created} 个轮次`)
        await eventStore.listRoundsByEvent(currentEvent.id)
      }
    })
  }

  const handleGotoDraw = (round?: Round) => {
    if (!currentEvent) return
    navigate('/draw', { state: { eventId: currentEvent.id, roundId: round?.id ?? null } })
  }

  // 完整实现包含：
  // - Table 列定义（名称、日期、状态、操作：详情/编辑/删除）
  // - Drawer 内 4 个 Section（队伍管理/轮次设置/难度梯度预设/前往抽取）
  // - 各 Modal 的打开/关闭/提交逻辑
  // 代码量较大，实际实现时按上述结构组织
}
```

**实现要点：**
- 赛事列表 Table 列：名称、日期范围、状态、操作（详情/编辑/删除）
- 删除赛事用 `Modal.confirm` 二次确认，提示会级联删除轮次/队伍/历史
- Drawer 详情布局：上方赛事信息卡片，下方 4 个 Card（队伍/轮次/预设/跳转）
- 队伍列表支持"录入历史辩题"按钮（每行）和"添加队伍"按钮
- 轮次列表支持创建/编辑/删除
- "前往抽取"按钮带下拉选择目标轮次

---

#### Task 17：实现 TeamManage 页面

**Files:**
- Modify: `src/renderer/src/pages/TeamManage.tsx`（重写）

**实现要求：**

参考 brainstorming 决策（分工互补），TeamManage 实现：
1. **跨赛事队伍总览**：左侧赛事选择树（"全部赛事" + 各赛事节点），右侧队伍列表
2. **队伍列表**：选中赛事后显示该赛事所有队伍
3. **历史辩题录入**：每行队伍有"查看/录入历史辩题"按钮，打开 TeamHistoryModal
4. **添加/编辑/删除队伍**：使用 TeamEditModal
5. **查看某队伍打过的所有辩题**：TeamHistoryModal 内已实现

**关键代码结构：**

```typescript
// src/renderer/src/pages/TeamManage.tsx
import { useEffect, useState, useMemo } from 'react'
import { Layout, Tree, Table, Button, Space, Empty, Typography, message, theme } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, HistoryOutlined, TrophyOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import { useEventStore } from '../stores/eventStore'
import TeamEditModal from '../components/TeamEditModal'
import TeamHistoryModal from '../components/TeamHistoryModal'
import type { Team, Event } from '../../../shared/types'

const { Sider, Content } = Layout
const { Text } = Typography

export default function TeamManage() {
  const { token } = theme.useToken()
  const eventStore = useEventStore()

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyTeam, setHistoryTeam] = useState<Team | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    eventStore.listEvents()
  }, [])

  // 选中赛事时拉取队伍
  useEffect(() => {
    if (selectedEventId) {
      eventStore.listTeamsByEvent(selectedEventId)
    }
  }, [selectedEventId])

  const treeData: DataNode[] = useMemo(() => [
    {
      key: '__all__',
      title: (
        <span>
          <TrophyOutlined /> <span style={{ fontWeight: 500 }}>全部赛事</span>
        </span>
      ),
      selectable: false,
      children: eventStore.events.map((e) => ({
        key: e.id,
        title: (
          <span>
            {e.name}
            <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{e.status ?? ''}</Text>
          </span>
        )
      }))
    }
  ], [eventStore.events])

  // ... 实现：
  // - Tree onSelect 切换 selectedEventId
  // - 右侧 Table 显示该赛事队伍
  // - 添加/编辑/删除队伍按钮
  // - 每行"历史辩题"按钮 → 打开 TeamHistoryModal
  // - "全部赛事"节点不可选，必须选择具体赛事
}
```

**实现要点：**
- 左侧 Tree 默认展开"全部赛事"节点，赛事节点按 `created_at DESC` 排序
- 右侧 Table 列：队伍名称、操作（编辑/删除/历史辩题）
- 选中赛事为空时显示 Empty 提示"请从左侧选择赛事"
- 删除队伍用 `Modal.confirm` 二次确认

---

#### Task 18：实现 History 页面

**Files:**
- Modify: `src/renderer/src/pages/History.tsx`（重写）

**实现要求：**

参考设计文档 5.9 节，实现双 Tab 布局：

**Tab 1：抽取记录**
- 多维度查询面板：按赛事（Select）、日期范围（RangePicker）、队伍（Select，可选）、辩题关键词（Input）
- 抽取记录表格：时间、操作人、辩题（多条）、持方、对阵双方、轮次
- 导出功能：Excel / CSV / JSON 三个按钮，调用 `window.exportAPI.exportDrawSessions`
- 点击某条记录可展开详情（显示 settings 快照）

**Tab 2：操作日志**
- 按类型筛选（action：抽取/重抽/导入/导出/创建/更新/删除/系统）
- 按时间范围筛选
- 表格展示：时间、操作类型、目标类型、操作人、详情
- 导出 CSV / JSON，调用 `window.auditAPI.exportLogs`

```typescript
// src/renderer/src/pages/History.tsx
import { useEffect, useState } from 'react'
import { Tabs, Table, Select, DatePicker, Input, Button, Space, Card, message, Typography, Tag } from 'antd'
import { ExportOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuditStore } from '../stores/auditStore'
import { useEventStore } from '../stores/eventStore'
import type { DrawSession, DrawSessionDetail, AuditLog } from '../../../shared/types'

const { RangePicker } = DatePicker
const { Text } = Typography

const ACTION_LABEL: Record<string, string> = {
  system: '系统',
  draw: '抽取',
  redraw: '重抽',
  import: '导入',
  export: '导出',
  create: '创建',
  update: '更新',
  delete: '删除'
}

export default function History() {
  const auditStore = useAuditStore()
  const eventStore = useEventStore()

  // 抽取记录 Tab 状态
  const [sessionFilter, setSessionFilter] = useState<{ event_id?: string; startTime?: string; endTime?: string; page?: number; pageSize?: number }>({})
  const [sessions, setSessions] = useState<DrawSession[]>([])
  const [sessionTotal, setSessionTotal] = useState(0)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([])
  const [sessionDetails, setSessionDetails] = useState<Record<string, DrawSessionDetail>>({})

  // 操作日志 Tab 状态
  const [logFilter, setLogFilter] = useState<{ action?: string; startTime?: string; endTime?: string; page?: number; pageSize?: number }>({ page: 1, pageSize: 20 })

  useEffect(() => {
    eventStore.listEvents()
  }, [])

  useEffect(() => {
    auditStore.listLogs(logFilter)
  }, [logFilter])

  const loadSessions = async () => {
    setSessionLoading(true)
    try {
      const res = await window.drawAPI.listSessions({ ...sessionFilter, page: 1, pageSize: 50 })
      if (res.success && res.data) {
        const data = res.data as any
        setSessions(data.items ?? [])
        setSessionTotal(data.total ?? 0)
      }
    } finally {
      setSessionLoading(false)
    }
  }

  useEffect(() => {
    loadSessions()
  }, [sessionFilter])

  const handleExpandSession = async (expanded: boolean, record: DrawSession) => {
    if (expanded) {
      setExpandedRowKeys([...expandedRowKeys, record.id])
      if (!sessionDetails[record.id]) {
        const res = await window.drawAPI.getSession(record.id)
        if (res.success && res.data) {
          setSessionDetails({ ...sessionDetails, [record.id]: res.data as DrawSessionDetail })
        }
      }
    } else {
      setExpandedRowKeys(expandedRowKeys.filter((k) => k !== record.id))
    }
  }

  const handleExportSessions = async (format: 'xlsx' | 'csv' | 'json') => {
    try {
      const res = await window.exportAPI.exportDrawSessions({ filter: sessionFilter, format })
      if (res.success && res.data) {
        message.success(`已导出 ${(res.data as any).count} 条到：${(res.data as any).filePath}`)
      } else {
        message.error(res.error || '导出失败')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败')
    }
  }

  const handleExportLogs = async (format: 'csv' | 'json') => {
    try {
      const res = await window.auditAPI.exportLogs({ filter: logFilter, format })
      if (res.success && res.data) {
        message.success(`已导出 ${(res.data as any).count} 条到：${(res.data as any).filePath}`)
      } else {
        message.error(res.error || '导出失败')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败')
    }
  }

  // 实现：
  // - Tabs 两个 TabPane
  // - Tab 1: 抽取记录查询面板 + 表格 + 展开行 + 导出按钮
  // - Tab 2: 操作日志筛选 + 表格 + 导出按钮
  // - 抽取记录表格列：时间、操作人、赛事、轮次、辩题数量、操作（展开详情）
  // - 展开行显示：辩题列表（含持方、对阵双方）+ settings 快照
  // - 操作日志表格列：时间、类型（Tag）、目标类型、操作人、详情（pre-wrap）
}
```

**实现要点：**
- 抽取记录展开行需调用 `getSession` 拉取详情，缓存在 state 避免重复请求
- 持方和对阵双方从 `DrawSessionItem` 的 `team_a_id` / `team_b_id` / `stance_a` / `stance_b` 字段取
- 队伍名需从 `eventStore.teams` 中查找（但 teams 是当前赛事的；若跨赛事需调用 `eventAPI.getTeam`）
- 操作日志详情列用 `pre-wrap` 样式展示 JSON
- 导出按钮使用 Dropdown 或 Space + 多个 Button

---

#### Task 19：实现 Settings 页面

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`（重写）

**实现要求：**

实现 5 大模块（Card 布局，垂直排列）：

1. **内置题库管理**
   - 显示官方题库数量（调用 `topicAPI.count({ source_type: '官方' })`）
   - "检查更新"按钮：调用 `forceReseedOfficialTopics`（通过新 IPC 或直接调用现有 IPC）
   - 说明文字：官方题库不可修改标题，但可拉黑或收藏

2. **去重设置**
   - 文本匹配层开关（Switch）
   - Levenshtein 距离阈值（InputNumber，1-20）
   - 关键词重合度阈值（InputNumber，0-1，step 0.05）
   - AI 语义层开关（Switch）
   - AI API Key 输入框（Password）
   - AI Endpoint 输入框（默认空，说明可选）
   - "保存"按钮

3. **数据导出**
   - 题库导出：3 个按钮（Excel / CSV / JSON），调用 `exportAPI.exportTopics`
   - 赛事数据包导出：选择赛事 → 导出 JSON，调用 `exportAPI.exportEventPackage`

4. **数据导入**
   - "导入辩题"按钮，打开 ImportTopicsModal
   - 说明文字：支持 .xlsx / .csv / .docx 格式

5. **去重检查**
   - "运行去重检查"按钮，打开 DedupResultModal
   - 说明文字：检测题库中的相似辩题，支持一键删除

```typescript
// src/renderer/src/pages/Settings.tsx
import { useEffect, useState } from 'react'
import { Card, Button, Switch, InputNumber, Input, Space, Typography, Modal, Select, message, Divider, Statistic, Row, Col } from 'antd'
import { ReloadOutlined, DownloadOutlined, ImportOutlined, SafetyCertificateOutlined, DatabaseOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../stores/settingsStore'
import { useEventStore } from '../stores/eventStore'
import ImportTopicsModal from '../components/ImportTopicsModal'
import DedupResultModal from '../components/DedupResultModal'

const { Text, Paragraph } = Typography

export default function Settings() {
  const settingsStore = useSettingsStore()
  const eventStore = useEventStore()

  const [officialCount, setOfficialCount] = useState(0)
  const [textLayerEnabled, setTextLayerEnabled] = useState(true)
  const [levenshtein, setLevenshtein] = useState(5)
  const [keyword, setKeyword] = useState(0.8)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiEndpoint, setAiEndpoint] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [dedupOpen, setDedupOpen] = useState(false)
  const [exportEventId, setExportEventId] = useState<string | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    settingsStore.getAll().then(() => {
      const s = settingsStore.settings
      if (s.dedup_text_enabled !== undefined) setTextLayerEnabled(s.dedup_text_enabled)
      if (s.dedup_levenshtein !== undefined) setLevenshtein(s.dedup_levenshtein)
      if (s.dedup_keyword !== undefined) setKeyword(s.dedup_keyword)
      if (s.dedup_ai_enabled !== undefined) setAiEnabled(s.dedup_ai_enabled)
      if (s.dedup_ai_api_key !== undefined) setAiApiKey(s.dedup_ai_api_key)
      if (s.dedup_ai_endpoint !== undefined) setAiEndpoint(s.dedup_ai_endpoint)
    })
    window.topicAPI.count({ source_type: '官方' }).then((res: any) => {
      if (res.success) setOfficialCount(res.data as number)
    })
    eventStore.listEvents()
  }, [])

  const handleSaveDedup = async () => {
    try {
      await settingsStore.set('dedup_text_enabled', textLayerEnabled)
      await settingsStore.set('dedup_levenshtein', levenshtein)
      await settingsStore.set('dedup_keyword', keyword)
      await settingsStore.set('dedup_ai_enabled', aiEnabled)
      await settingsStore.set('dedup_ai_api_key', aiApiKey)
      await settingsStore.set('dedup_ai_endpoint', aiEndpoint)
      messageApi.success('已保存')
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  const handleExportTopics = async (format: 'xlsx' | 'csv' | 'json') => {
    try {
      const res = await window.exportAPI.exportTopics({ format })
      if (res.success && res.data) {
        messageApi.success(`已导出 ${(res.data as any).count} 道辩题到：${(res.data as any).filePath}`)
      } else {
        messageApi.error(res.error || '导出失败')
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '导出失败')
    }
  }

  const handleExportEventPackage = async () => {
    if (!exportEventId) {
      messageApi.warning('请选择赛事')
      return
    }
    try {
      const res = await window.exportAPI.exportEventPackage({ eventId: exportEventId })
      if (res.success && res.data) {
        messageApi.success(`已导出赛事数据包到：${(res.data as any).filePath}`)
      } else {
        messageApi.error(res.error || '导出失败')
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '导出失败')
    }
  }

  // 完整实现 5 个 Card：
  // 1. 内置题库管理（统计 + 检查更新按钮）
  // 2. 去重设置（4 个表单项 + 保存按钮）
  // 3. 数据导出（题库导出 3 按钮 + 赛事数据包导出）
  // 4. 数据导入（导入按钮 → ImportTopicsModal）
  // 5. 去重检查（运行按钮 → DedupResultModal）
}
```

**实现要点：**
- "检查更新"按钮的实现：由于 `forceReseedOfficialTopics` 是主进程内部函数，可通过新增一个 IPC 通道（如 `system:reseedOfficial`）或复用现有 settings API 间接调用。**简化方案**：本计划暂不实现远程检查更新，仅提供"重新加载内置题库"按钮，通过新增 IPC 通道实现。如不想新增 IPC，可在设置页仅显示统计信息，跳过该功能。
- 去重设置的 6 个字段存入 settings 表，dedup-engine 当前不读这些设置（仅 UI 占位 + 阈值可配），后续可在 `findDuplicates` 调用时传入 options
- 赛事数据包导出需先选择赛事，再点击导出

---

### Phase E：集成增强

#### Task 20：增强 TopicLibrary 页面

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

**修改：**

1. 在 import 区添加：
```typescript
import { ImportOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import ImportTopicsModal from '../components/ImportTopicsModal'
import DedupResultModal from '../components/DedupResultModal'
```

2. 在组件内添加状态：
```typescript
const [importOpen, setImportOpen] = useState(false)
const [dedupOpen, setDedupOpen] = useState(false)
```

3. 在工具栏（搜索框附近，参考现有布局）添加两个按钮：
```tsx
<Button icon={<SafetyCertificateOutlined />} onClick={() => setDedupOpen(true)}>
  去重检查
</Button>
<Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
  导入
</Button>
```

4. 在组件 JSX 末尾（关闭标签前）添加 Modal：
```tsx
<ImportTopicsModal
  open={importOpen}
  onDone={() => {
    setImportOpen(false)
    store.fetchList()
  }}
  onCancel={() => setImportOpen(false)}
/>
<DedupResultModal
  open={dedupOpen}
  onCancel={() => setDedupOpen(false)}
  onDeleted={() => store.fetchList()}
/>
```

---

#### Task 21：增强 DrawPage 接收 nav state

**Files:**
- Modify: `src/renderer/src/pages/DrawPage.tsx`

**修改：**

1. 在 import 区添加：
```typescript
import { useLocation } from 'react-router-dom'
```

2. 在 `DrawPage` 函数顶部（第 28 行附近）添加：
```typescript
const location = useLocation()
const navState = (location.state as { eventId?: string; roundId?: string | null } | null) ?? null
```

3. 修改 `DEFAULT_CONFIG` 常量初始化逻辑（改为函数或直接在 useState 初始值中读取 navState）：
```typescript
const [config, setConfig] = useState<DrawConfigState>(() => ({
  ...DEFAULT_CONFIG,
  eventId: navState?.eventId ?? null,
  roundId: navState?.roundId ?? null
}))
```

4. （可选）添加 useEffect 在 navState 变化时更新 config：
```typescript
useEffect(() => {
  if (navState?.eventId) {
    setConfig((c) => ({ ...c, eventId: navState.eventId!, roundId: navState.roundId ?? null }))
  }
}, [navState?.eventId, navState?.roundId])
```

---

### Phase F：验证

#### Task 22：验证（typecheck + 测试 + 启动）

**验证步骤：**

1. **TypeScript 类型检查**：
   ```bash
   npm run typecheck
   ```
   预期：node 和 web 端均无错误

2. **单元测试**：
   ```bash
   npm test
   ```
   预期：67 个测试全部通过，无回归

3. **启动应用验证**：
   ```bash
   npm run dev
   ```
   验证点：
   - 应用正常启动，控制台显示 `[seed] Official topics loaded: 100/100`
   - 数据库初始化成功
   - 进入 `/topics` 页面，看到官方题库已加载（≥100 道）
   - 点击"导入"按钮，ImportTopicsModal 弹出
   - 点击"去重检查"按钮，DedupResultModal 弹出
   - 进入 `/events` 页面，看到赛事列表（空），可创建赛事
   - 创建赛事后点击"详情"，Drawer 抽屉打开
   - 在抽屉中添加队伍、创建轮次、应用难度梯度预设
   - 点击"前往抽取"按钮，跳转到 `/draw` 并预选赛事和轮次
   - 进入 `/teams` 页面，左侧选择赛事，右侧显示队伍
   - 点击队伍"历史辩题"按钮，TeamHistoryModal 弹出
   - 进入 `/history` 页面，切换 Tab 查看抽取记录和操作日志
   - 测试导出功能（题库导出 Excel / 抽取记录导出 CSV / 审计日志导出 CSV）
   - 进入 `/settings` 页面，看到 5 个 Card
   - 修改去重设置并保存，刷新后值保持
   - 点击"运行去重检查"，DedupResultModal 弹出并显示结果

4. **修复发现的问题**：根据验证结果修复 bug

---

## Self-Review Checklist

完成所有任务后，检查：

- [ ] **Spec 覆盖**：用户原始需求 6 大项是否全部实现
  - 1. 赛事管理页面 ✓（Task 16）
  - 2. 队伍管理页面 ✓（Task 17）
  - 3. 历史记录页面 ✓（Task 18）
  - 4. 设置页面 ✓（Task 19）
  - 5. 导入功能集成 ✓（Task 14 + Task 20 + Task 19）
  - 6. 内置官方题库数据 ✓（Task 1 + Task 2 + Task 3）
- [ ] **无占位符**：所有任务代码完整，无 TBD/TODO
- [ ] **类型一致**：IPC 通道名、类型名在主进程和渲染进程一致
- [ ] **沿用现有模式**：所有新代码遵循 ApiResponse 协议、extractError 模式、IPC_CHANNELS 常量
- [ ] **C 盘约束**：所有运行期数据写入 `<项目根>/.electron-userdata/`，未污染 C 盘

---

## 关键风险与缓解

1. **better-sqlite3 ABI 兼容**：现有 smoke.test.ts 已用 vi.mock 处理，本计划不引入新的 native 依赖
2. **xlsx 库动态导入**：export.ipc.ts 中使用 `require('xlsx')`，确保在主进程运行时可加载（package.json 已声明依赖）
3. **dayjs 依赖**：antd 5 间接依赖 dayjs，但若 typecheck 报错需 `npm install dayjs`
4. **drawRepo.listDrawnTopicIds 方法名**：实际实现时需检查 `src/main/db/repository/draw.repo.ts` 中的导出方法名，可能需要调整
5. **forceReseedOfficialTopics 跨进程调用**：Settings 页的"检查更新"功能需要新增 IPC 通道（如 `system:reseedOfficial`）。**简化方案**：若不希望新增 IPC，可在 Settings 页仅显示统计信息，跳过"重新加载"功能。本计划默认采用简化方案（仅显示统计 + 不实现远程更新）
6. **跨赛事队伍名查找**：History 页展开抽取记录详情时，队伍可能属于不同赛事，需调用 `eventAPI.getTeam(id)` 而非依赖 `eventStore.teams`

---

## 执行顺序建议

按 Phase A → B → C → D → E → F 顺序执行。Phase C（组件）和 Phase B（store）可在 Phase D（页面）之前完成，因为页面依赖组件和 store。Phase E（集成）依赖 Phase C 的 ImportTopicsModal 和 DedupResultModal。

每个 Task 完成后运行 `npm run typecheck` 确保无类型错误，Phase F 完成后运行完整验证。
