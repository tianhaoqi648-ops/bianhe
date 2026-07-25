# 实现 IPC 通信层

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 TodoWrite 跟踪任务进度，按以下任务顺序实现。

**Goal:** 在主进程注册 IPC handlers，通过 preload contextBridge 暴露安全 API，使渲染进程能调用 repository 与 services 层功能。

**Architecture:** 主进程 `ipcMain.handle` 注册 handlers → preload `contextBridge.exposeInMainWorld` 暴露 API 对象 → 渲染进程 `window.topicAPI.xxx()` 调用。所有调用走 `ipcRenderer.invoke` 返回 Promise。统一返回 `{ success: true, data } | { success: false, error }` 格式。

**Tech Stack:** Electron 31 (ipcMain/ipcRenderer/contextBridge), TypeScript, better-sqlite3 (通过 repository 间接调用)

---

## Current State Analysis

### 已有基础设施
- **Repository 层**：`src/main/db/repository/{topic,event,draw,audit}.repo.ts` 提供完整 CRUD
- **Services 层**：`src/main/services/{draw-engine,dedup-engine,import-engine,probability}.ts` 提供抽取/去重/导入业务逻辑
- **主进程入口**：`src/main/index.ts` 已完成数据库初始化（`initDatabase()`）和启动日志记录
- **Preload 占位**：`src/preload/index.ts` 当前仅暴露空 `api` 对象；`src/preload/index.d.ts` 声明 `api: unknown`
- **IPC 目录**：`src/main/ipc/` 仅有 `.gitkeep`
- **构建配置**：`electron.vite.config.ts` 中 preload 入口为 `src/preload/index.ts`（注意不是 `src/main/preload/`）
- **TypeScript 配置**：
  - `tsconfig.node.json` include: `src/main/**/*`, `src/preload/**/*`
  - `tsconfig.web.json` include: `src/renderer/src/**/*`, `src/preload/*.d.ts`

### 待解决问题
1. 渲染进程无法访问数据库与业务逻辑（无 IPC 通道）
2. 类型定义分散在各 repository 中，主进程与渲染进程未共享
3. 现有 `window.api` 为 `unknown`，无类型提示

---

## Proposed Changes

### 决策与假设
- **`shared/types.ts` 位置**：放在 `src/shared/types.ts`（而非项目根 `shared/`）。理由：与现有 `src/main`、`src/preload`、`src/renderer` 结构一致；通过更新两个 tsconfig 的 include 即可被主进程与渲染进程同时引用。
- **preload 文件**：修改 `src/preload/index.ts`（electron-vite 实际入口，见 `electron.vite.config.ts`）。`src/main/preload/index.ts` 保持占位不动。
- **错误处理**：统一返回 `{ success: true, data: T } | { success: false, error: string }`。handler 内部 try/catch 捕获所有异常，避免未处理异常导致渲染进程 Promise 永久 pending。
- **文件保存类操作（如导出日志）**：主进程使用 `dialog.showSaveDialog` + `fs.writeFileSync`，返回 `{ success: true, data: { filePath } }`。
- **重抽（redraw）**：不新增独立 service 函数，由 IPC 层组合 `drawRepo.deleteSession` + `drawTopics` 实现，并在 audit_log 中标记 `action='redraw'`。
- **导入执行**：`importTopics` 先调用 `findDuplicates` 与现有库比对，重复项标记跳过，非重复项调用 `topicRepo.createTopic` 批量插入。

---

### 文件结构

```
src/
├── shared/                          ← 新增
│   └── types.ts                     ← IPC 通道名、请求/响应类型
├── main/
│   ├── ipc/                         ← 新增 6 个文件
│   │   ├── index.ts                 ← registerAllIpc 聚合
│   │   ├── topic.ipc.ts
│   │   ├── event.ipc.ts
│   │   ├── draw.ipc.ts
│   │   ├── audit.ipc.ts
│   │   └── import.ipc.ts
│   └── index.ts                     ← 修改：调用 registerAllIpc
├── preload/
│   ├── index.ts                     ← 修改：暴露 6 个 API 对象
│   └── index.d.ts                   ← 修改：声明 window.topicAPI 等
└── ...

tsconfig.node.json                   ← 修改：include 增加 src/shared/**
tsconfig.web.json                    ← 修改：include 增加 src/shared/**
```

---

### Task 1: 创建 `src/shared/types.ts`

**Files:**
- Create: `src/shared/types.ts`

定义所有 IPC 通道名常量与请求/响应类型。从各 repository 与 services 中 re-export 业务类型，避免重复定义。

```typescript
// src/shared/types.ts
// ============================================================
// IPC 共享类型定义
//
// 主进程与渲染进程共用此文件，确保类型一致。
// 通道名常量避免主进程与 preload 字符串不一致。
// ============================================================

// ---------- 复用 repository / services 的业务类型 ----------
export type {
  Topic,
  TopicFilter,
  TopicCreateInput,
  TopicUpdateInput
} from '../main/db/repository/topic.repo'

export type {
  Event,
  Round,
  Team,
  TeamHistory,
  EventFilter,
  EventCreateInput,
  EventUpdateInput,
  RoundCreateInput,
  RoundUpdateInput,
  TeamCreateInput,
  TeamUpdateInput,
  TeamHistoryCreateInput
} from '../main/db/repository/event.repo'

export type {
  DrawSession,
  DrawSessionItem,
  DrawSessionDetail,
  SessionFilter,
  CreateSessionInput
} from '../main/db/repository/draw.repo'

export type {
  AuditLog,
  AuditLogFilter,
  AuditLogCreateInput,
  Setting
} from '../main/db/repository/audit.repo'

export type {
  DrawParams,
  DrawResult,
  SourceMixRatio
} from '../main/services/draw-engine'

export type {
  DuplicateGroup,
  DedupOptions,
  DuplicateReason
} from '../main/services/dedup-engine'

export type {
  ParsedResult,
  FileType
} from '../main/services/import-engine'

// ---------- 统一响应封装 ----------
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export type ApiResult<T = unknown> = ApiResponse<T>

// ---------- 通道名常量 ----------
// 命名规范：'<domain>:<action>'，例 'topic:list'、'draw:execute'
export const IPC_CHANNELS = {
  // topic
  TOPIC_LIST: 'topic:list',
  TOPIC_GET: 'topic:get',
  TOPIC_CREATE: 'topic:create',
  TOPIC_UPDATE: 'topic:update',
  TOPIC_DELETE: 'topic:delete',
  TOPIC_BATCH_DELETE: 'topic:batchDelete',
  TOPIC_UPDATE_STATUS: 'topic:updateStatus',
  TOPIC_UPDATE_WEIGHT: 'topic:updateWeight',
  TOPIC_COUNT: 'topic:count',
  // event
  EVENT_LIST: 'event:list',
  EVENT_GET: 'event:get',
  EVENT_CREATE: 'event:create',
  EVENT_UPDATE: 'event:update',
  EVENT_DELETE: 'event:event_delete',
  // round
  ROUND_LIST_BY_EVENT: 'round:listByEvent',
  ROUND_GET: 'round:get',
  ROUND_CREATE: 'round:create',
  ROUND_UPDATE: 'round:update',
  ROUND_DELETE: 'round:delete',
  // team
  TEAM_LIST_BY_EVENT: 'team:listByEvent',
  TEAM_GET: 'team:get',
  TEAM_CREATE: 'team:create',
  TEAM_UPDATE: 'team:update',
  TEAM_DELETE: 'team:delete',
  // team_history
  TEAM_HISTORY_LIST: 'teamHistory:list',
  TEAM_HISTORY_LIST_BY_EVENT: 'teamHistory:listByEvent',
  TEAM_HISTORY_ADD: 'teamHistory:add',
  TEAM_HISTORY_DELETE: 'teamHistory:delete',
  // draw
  DRAW_EXECUTE: 'draw:execute',
  DRAW_LIST_SESSIONS: 'draw:listSessions',
  DRAW_GET_SESSION: 'draw:getSession',
  DRAW_DELETE_SESSION: 'draw:deleteSession',
  DRAW_LIST_DRAWN_TOPIC_IDS: 'draw:listDrawnTopicIds',
  DRAW_REDO: 'draw:redo',
  // audit
  AUDIT_LIST_LOGS: 'audit:listLogs',
  AUDIT_ADD_LOG: 'audit:addLog',
  AUDIT_DELETE_LOG: 'audit:deleteLog',
  AUDIT_CLEAR_LOGS: 'audit:clearLogs',
  AUDIT_EXPORT_LOGS: 'audit:exportLogs',
  // settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_DELETE: 'settings:delete',
  // import
  IMPORT_PARSE_FILE: 'import:parseFile',
  IMPORT_EXECUTE: 'import:execute',
  IMPORT_FIND_DUPLICATES: 'import:findDuplicates'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]

// ---------- 请求参数类型（多参数场景） ----------
export interface ImportExecuteRequest {
  topics: Array<{
    title: string
    type?: string | null
    domain?: string | null
    difficulty?: string | null
    source?: string | null
    source_type?: string | null
    tags?: string[] | null
  }>
  /** 是否在导入前对库内已有辩题做去重检查（默认 true） */
  checkDuplicates?: boolean
}

export interface ImportExecuteResult {
  imported: number
  duplicates: number
  failed: number
  duplicateGroups: Array<{
    title: string
    existingIds: string[]
  }>
}

export interface ExportLogsRequest {
  filter?: AuditLogFilter
  format: 'csv' | 'json'
}

export interface ExportLogsResult {
  filePath: string
  count: number
}
```

---

### Task 2: 创建 `src/main/ipc/topic.ipc.ts`

**Files:**
- Create: `src/main/ipc/topic.ipc.ts`

注册题库相关 handler，对应 `topicRepo` 的 9 个方法。每个 handler 用 `wrap()` 包装统一错误处理。

```typescript
// src/main/ipc/topic.ipc.ts
import { ipcMain } from 'electron'
import { topicRepo, type Topic, type TopicFilter, type TopicCreateInput, type TopicUpdateInput } from '../db/repository/topic.repo'
import { IPC_CHANNELS, type ApiResponse } from '../../shared/types'

/**
 * 统一包装：捕获异常，返回 ApiResponse。
 */
function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerTopicIpc(): void {
  ipcMain.handle(IPC_CHANNELS.TOPIC_LIST, (_e, filter?: TopicFilter) =>
    wrap(() => topicRepo.listTopics(filter))
  )
  ipcMain.handle(IPC_CHANNELS.TOPIC_GET, (_e, id: string) =>
    wrap(() => topicRepo.getTopicById(id))
  )
  ipcMain.handle(IPC_CHANNELS.TOPIC_CREATE, (_e, data: TopicCreateInput) =>
    wrap(() => topicRepo.createTopic(data))
  )
  ipcMain.handle(IPC_CHANNELS.TOPIC_UPDATE, (_e, id: string, data: TopicUpdateInput) =>
    wrap(() => topicRepo.updateTopic(id, data))
  )
  ipcMain.handle(IPC_CHANNELS.TOPIC_DELETE, (_e, id: string) =>
    wrap(() => topicRepo.deleteTopic(id))
  )
  ipcMain.handle(IPC_CHANNELS.TOPIC_BATCH_DELETE, (_e, ids: string[]) =>
    wrap(() => topicRepo.batchDeleteTopics(ids))
  )
  ipcMain.handle(IPC_CHANNELS.TOPIC_UPDATE_STATUS, (_e, id: string, status: string) =>
    wrap(() => topicRepo.updateStatus(id, status))
  )
  ipcMain.handle(IPC_CHANNELS.TOPIC_UPDATE_WEIGHT, (_e, id: string, weight: number) =>
    wrap(() => topicRepo.updateWeight(id, weight))
  )
  ipcMain.handle(IPC_CHANNELS.TOPIC_COUNT, (_e, filter?: TopicFilter) =>
    wrap(() => topicRepo.countByFilter(filter))
  )
}
```

---

### Task 3: 创建 `src/main/ipc/event.ipc.ts`

**Files:**
- Create: `src/main/ipc/event.ipc.ts`

注册赛事/轮次/队伍/队伍历史相关 handler，对应 `eventRepo` 全部方法。

```typescript
// src/main/ipc/event.ipc.ts
import { ipcMain } from 'electron'
import { eventRepo } from '../db/repository/event.repo'
import type {
  EventFilter,
  EventCreateInput,
  EventUpdateInput,
  RoundCreateInput,
  RoundUpdateInput,
  TeamCreateInput,
  TeamUpdateInput,
  TeamHistoryCreateInput
} from '../db/repository/event.repo'
import { IPC_CHANNELS, type ApiResponse } from '../../shared/types'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerEventIpc(): void {
  // event
  ipcMain.handle(IPC_CHANNELS.EVENT_LIST, (_e, filter?: EventFilter) =>
    wrap(() => eventRepo.listEvents(filter))
  )
  ipcMain.handle(IPC_CHANNELS.EVENT_GET, (_e, id: string) =>
    wrap(() => eventRepo.getEventById(id))
  )
  ipcMain.handle(IPC_CHANNELS.EVENT_CREATE, (_e, data: EventCreateInput) =>
    wrap(() => eventRepo.createEvent(data))
  )
  ipcMain.handle(IPC_CHANNELS.EVENT_UPDATE, (_e, id: string, data: EventUpdateInput) =>
    wrap(() => eventRepo.updateEvent(id, data))
  )
  ipcMain.handle(IPC_CHANNELS.EVENT_DELETE, (_e, id: string) =>
    wrap(() => eventRepo.deleteEvent(id))
  )
  // round
  ipcMain.handle(IPC_CHANNELS.ROUND_LIST_BY_EVENT, (_e, eventId: string) =>
    wrap(() => eventRepo.listRoundsByEvent(eventId))
  )
  ipcMain.handle(IPC_CHANNELS.ROUND_GET, (_e, id: string) =>
    wrap(() => eventRepo.getRoundById(id))
  )
  ipcMain.handle(IPC_CHANNELS.ROUND_CREATE, (_e, data: RoundCreateInput) =>
    wrap(() => eventRepo.createRound(data))
  )
  ipcMain.handle(IPC_CHANNELS.ROUND_UPDATE, (_e, id: string, data: RoundUpdateInput) =>
    wrap(() => eventRepo.updateRound(id, data))
  )
  ipcMain.handle(IPC_CHANNELS.ROUND_DELETE, (_e, id: string) =>
    wrap(() => eventRepo.deleteRound(id))
  )
  // team
  ipcMain.handle(IPC_CHANNELS.TEAM_LIST_BY_EVENT, (_e, eventId: string) =>
    wrap(() => eventRepo.listTeamsByEvent(eventId))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_GET, (_e, id: string) =>
    wrap(() => eventRepo.getTeamById(id))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_CREATE, (_e, data: TeamCreateInput) =>
    wrap(() => eventRepo.createTeam(data))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_UPDATE, (_e, id: string, data: TeamUpdateInput) =>
    wrap(() => eventRepo.updateTeam(id, data))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_DELETE, (_e, id: string) =>
    wrap(() => eventRepo.deleteTeam(id))
  )
  // team history
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_LIST, (_e, teamId: string) =>
    wrap(() => eventRepo.listTeamHistory(teamId))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_LIST_BY_EVENT, (_e, eventId: string) =>
    wrap(() => eventRepo.listTeamHistoryByEvent(eventId))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_ADD, (_e, data: TeamHistoryCreateInput) =>
    wrap(() => eventRepo.addTeamHistory(data))
  )
  ipcMain.handle(IPC_CHANNELS.TEAM_HISTORY_DELETE, (_e, id: string) =>
    wrap(() => eventRepo.deleteTeamHistory(id))
  )
}
```

---

### Task 4: 创建 `src/main/ipc/draw.ipc.ts`

**Files:**
- Create: `src/main/ipc/draw.ipc.ts`

注册抽取相关 handler：执行抽取（`drawTopics`）、获取历史、重抽（删除旧会话+重新抽取）。

```typescript
// src/main/ipc/draw.ipc.ts
import { ipcMain } from 'electron'
import { drawRepo } from '../db/repository/draw.repo'
import type { SessionFilter } from '../db/repository/draw.repo'
import { auditRepo } from '../db/repository/audit.repo'
import { drawTopics, type DrawParams } from '../services/draw-engine'
import { IPC_CHANNELS, type ApiResponse } from '../../shared/types'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerDrawIpc(): void {
  // 执行抽取
  ipcMain.handle(IPC_CHANNELS.DRAW_EXECUTE, (_e, params: DrawParams) =>
    wrap(() => drawTopics(params))
  )
  // 列出抽取会话
  ipcMain.handle(IPC_CHANNELS.DRAW_LIST_SESSIONS, (_e, filter?: SessionFilter) =>
    wrap(() => drawRepo.listSessions(filter))
  )
  // 获取会话详情
  ipcMain.handle(IPC_CHANNELS.DRAW_GET_SESSION, (_e, id: string) =>
    wrap(() => drawRepo.getSessionById(id))
  )
  // 删除会话
  ipcMain.handle(IPC_CHANNELS.DRAW_DELETE_SESSION, (_e, id: string) =>
    wrap(() => drawRepo.deleteSession(id))
  )
  // 已抽取辩题 ID 列表
  ipcMain.handle(IPC_CHANNELS.DRAW_LIST_DRAWN_TOPIC_IDS, (_e, eventId: string) =>
    wrap(() => drawRepo.listDrawnTopicIdsByEvent(eventId))
  )
  // 重抽：删除旧会话 + 用相同参数重新抽取
  // 复用 draw-engine.drawTopics，但在 audit_log 中标记 action='redraw'
  ipcMain.handle(
    IPC_CHANNELS.DRAW_REDO,
    (_e, oldSessionId: string, params: DrawParams) =>
      wrap(() => {
        // 1. 查旧会话拿 settings（可选，便于审计）
        const oldSession = drawRepo.getSessionById(oldSessionId)
        // 2. 删除旧会话
        drawRepo.deleteSession(oldSessionId)
        // 3. 重新抽取
        const result = drawTopics(params)
        // 4. 额外审计：redraw 动作
        auditRepo.addLog({
          action: 'redraw',
          target_type: 'session',
          target_id: result.session.id,
          operator: params.operator ?? 'unknown',
          detail: {
            old_session_id: oldSessionId,
            old_session_settings: oldSession?.settings ?? null,
            new_session_id: result.session.id
          }
        })
        return result
      })
  )
}
```

---

### Task 5: 创建 `src/main/ipc/audit.ipc.ts`

**Files:**
- Create: `src/main/ipc/audit.ipc.ts`

注册审计日志查询/删除/导出 + 系统设置（settings）handler。导出日志使用 `dialog.showSaveDialog` 让用户选择保存位置。

```typescript
// src/main/ipc/audit.ipc.ts
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { auditRepo } from '../db/repository/audit.repo'
import type { AuditLogFilter, AuditLogCreateInput } from '../db/repository/audit.repo'
import { IPC_CHANNELS, type ApiResponse, type ExportLogsRequest, type ExportLogsResult } from '../../shared/types'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 把 audit_log 记录数组转 CSV 字符串（含表头）。
 */
function logsToCsv(logs: any[]): string {
  if (logs.length === 0) return 'id,action,target_type,target_id,operator,detail,created_at\n'
  const headers = ['id', 'action', 'target_type', 'target_id', 'operator', 'detail', 'created_at']
  const rows = logs.map((l) =>
    headers
      .map((h) => {
        const v = l[h]
        const s = h === 'detail' && v ? JSON.stringify(v) : v == null ? '' : String(v)
        // CSV 转义：含逗号/引号/换行则用双引号包裹，内部双引号变两个
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
        return s
      })
      .join(',')
  )
  return [headers.join(','), ...rows].join('\n') + '\n'
}

export function registerAuditIpc(): void {
  // audit_log
  ipcMain.handle(IPC_CHANNELS.AUDIT_LIST_LOGS, (_e, filter?: AuditLogFilter) =>
    wrap(() => auditRepo.listLogs(filter))
  )
  ipcMain.handle(IPC_CHANNELS.AUDIT_ADD_LOG, (_e, input: AuditLogCreateInput) =>
    wrap(() => auditRepo.addLog(input))
  )
  ipcMain.handle(IPC_CHANNELS.AUDIT_DELETE_LOG, (_e, id: string) =>
    wrap(() => auditRepo.deleteLog(id))
  )
  ipcMain.handle(IPC_CHANNELS.AUDIT_CLEAR_LOGS, (_e, beforeDate?: string) =>
    wrap(() => auditRepo.clearLogs(beforeDate))
  )

  // 导出日志（大 pageSize 一次拉取，主进程写文件）
  ipcMain.handle(
    IPC_CHANNELS.AUDIT_EXPORT_LOGS,
    async (_e, req: ExportLogsRequest): Promise<ApiResponse<ExportLogsResult>> => {
      try {
        // 拉取全部匹配日志（pageSize=100000 避免分页）
        const { items } = auditRepo.listLogs({ ...req.filter, page: 1, pageSize: 100000 })
        const win = BrowserWindow.getFocusedWindow()
        const defaultName = `audit-logs-${new Date().toISOString().slice(0, 10)}.${req.format}`
        const { canceled, filePath } = await dialog.showSaveDialog(win!, {
          title: '导出审计日志',
          defaultPath: defaultName,
          filters: req.format === 'csv'
            ? [{ name: 'CSV', extensions: ['csv'] }]
            : [{ name: 'JSON', extensions: ['json'] }]
        })
        if (canceled || !filePath) {
          return { success: false, error: '用户取消保存' }
        }
        const content = req.format === 'csv'
          ? logsToCsv(items)
          : JSON.stringify(items, null, 2)
        writeFileSync(filePath, content, 'utf-8')
        return { success: true, data: { filePath, count: items.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_e, key: string) =>
    wrap(() => auditRepo.getSetting(key))
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_e, key: string, value: any) =>
    wrap(() => {
      auditRepo.setSetting(key, value)
      return true
    })
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () =>
    wrap(() => auditRepo.getAllSettings())
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_DELETE, (_e, key: string) =>
    wrap(() => auditRepo.deleteSetting(key))
  )
}
```

---

### Task 6: 创建 `src/main/ipc/import.ipc.ts`

**Files:**
- Create: `src/main/ipc/import.ipc.ts`

注册导入相关 handler：解析文件、执行导入（含库内去重检查）、对给定列表做去重检测。

```typescript
// src/main/ipc/import.ipc.ts
import { ipcMain } from 'electron'
import { parseFile, type FileType, type ParsedResult } from '../services/import-engine'
import { findDuplicates, type DedupOptions, type DuplicateGroup } from '../services/dedup-engine'
import { topicRepo } from '../db/repository/topic.repo'
import type { Topic } from '../db/repository/topic.repo'
import { auditRepo } from '../db/repository/audit.repo'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ImportExecuteRequest,
  type ImportExecuteResult
} from '../../shared/types'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerImportIpc(): void {
  // 解析文件
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PARSE_FILE,
    (_e, filePath: string, fileType: FileType): Promise<ApiResponse<ParsedResult>> =>
      wrap(() => parseFile(filePath, fileType)) as Promise<ApiResponse<ParsedResult>>
  )
  // 注：parseFile 是 async，wrap 同步函数会拿到 Promise，需要再 await 一次。
  // 改为显式 async handler：
  ipcMain.removeHandler(IPC_CHANNELS.IMPORT_PARSE_FILE)
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PARSE_FILE,
    async (_e, filePath: string, fileType: FileType): Promise<ApiResponse<ParsedResult>> => {
      try {
        const data = await parseFile(filePath, fileType)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 执行导入：检查库内重复 → 插入非重复项
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_EXECUTE,
    async (_e, req: ImportExecuteRequest): Promise<ApiResponse<ImportExecuteResult>> => {
      try {
        const { topics, checkDuplicates = true } = req
        const duplicateGroups: ImportExecuteResult['duplicateGroups'] = []
        let imported = 0
        let duplicates = 0
        let failed = 0

        // 拉取全量已有辩题用于去重比对（pageSize=100000）
        const { items: existing } = topicRepo.listTopics({ page: 1, pageSize: 100000 })

        for (const t of topics) {
          try {
            // 库内查重
            if (checkDuplicates) {
              const candidates: Topic[] = [
                ...existing,
                // 已导入但未入 existing 数组的，临时构造 Topic 对象参与下次比对
                ...topics.slice(0, imported).map((x) => ({
                  id: '__temp__',
                  title: x.title,
                  type: x.type ?? null,
                  domain: x.domain ?? null,
                  difficulty: x.difficulty ?? null,
                  source: x.source ?? null,
                  source_type: x.source_type ?? null,
                  tags: x.tags ?? null,
                  weight: 1.0,
                  status: 'active',
                  created_at: '',
                  updated_at: ''
                }))
              ]
              const groups = await findDuplicates([
                {
                  id: '__new__',
                  title: t.title,
                  type: t.type ?? null,
                  domain: t.domain ?? null,
                  difficulty: t.difficulty ?? null,
                  source: t.source ?? null,
                  source_type: t.source_type ?? null,
                  tags: t.tags ?? null,
                  weight: 1.0,
                  status: 'active',
                  created_at: '',
                  updated_at: ''
                },
                ...candidates
              ])
              // 若新题与任一已有题被归组，记为重复
              const hit = groups.find((g) =>
                g.topics.some((p) => p.id === '__new__')
              )
              if (hit) {
                duplicates++
                duplicateGroups.push({
                  title: t.title,
                  existingIds: hit.topics
                    .filter((p) => p.id !== '__new__' && p.id !== '__temp__')
                    .map((p) => p.id)
                })
                continue
              }
            }
            topicRepo.createTopic({
              title: t.title,
              type: t.type ?? null,
              domain: t.domain ?? null,
              difficulty: t.difficulty ?? null,
              source: t.source ?? null,
              source_type: t.source_type ?? '自定义',
              tags: t.tags ?? null
            })
            imported++
          } catch (e) {
            failed++
            // 单条失败不影响整体
          }
        }

        auditRepo.addLog({
          action: 'import',
          target_type: 'topic',
          target_id: 'bulk',
          operator: 'renderer',
          detail: { imported, duplicates, failed, total: topics.length }
        })

        return {
          success: true,
          data: { imported, duplicates, failed, duplicateGroups }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 对给定辩题列表做去重检测（不写库）
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_FIND_DUPLICATES,
    async (_e, topics: Topic[], options?: DedupOptions): Promise<ApiResponse<DuplicateGroup[]>> => {
      try {
        const data = await findDuplicates(topics, options)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
```

> **说明**：上面 `IMPORT_PARSE_FILE` 的第一段 `wrap` 写法是错误示范，已立刻 `removeHandler` 并用 async 版本替换。最终交付应只保留 async 版本，删除错误示范部分。实现时直接写 async 版本即可。

---

### Task 7: 创建 `src/main/ipc/index.ts`（聚合注册）

**Files:**
- Create: `src/main/ipc/index.ts`

```typescript
// src/main/ipc/index.ts
// ============================================================
// IPC 注册聚合入口
//
// 在主进程 app.whenReady 之后调用 registerAllIpc() 即可。
// ============================================================

import { registerTopicIpc } from './topic.ipc'
import { registerEventIpc } from './event.ipc'
import { registerDrawIpc } from './draw.ipc'
import { registerAuditIpc } from './audit.ipc'
import { registerImportIpc } from './import.ipc'

export function registerAllIpc(): void {
  registerTopicIpc()
  registerEventIpc()
  registerDrawIpc()
  registerAuditIpc()
  registerImportIpc()
  console.log('[main] All IPC handlers registered')
}
```

---

### Task 8: 修改 `src/main/index.ts` 调用 registerAllIpc

**Files:**
- Modify: `src/main/index.ts:54-79`（在 `initDatabase()` 成功块内追加注册调用）

在 `initDatabase()` 成功后、`createWindow()` 之前插入：

```typescript
// src/main/index.ts（在 initDatabase 成功块末尾追加）
import { registerAllIpc } from './ipc'

// ... existing code ...
try {
  initDatabase()
  console.log('[main] Database initialized')

  // 注册 IPC handlers
  registerAllIpc()

  // ... existing startup log ...
} catch (err) {
  // ... existing error handling ...
}
```

具体修改：在 `src/main/index.ts` 顶部 import 区添加 `import { registerAllIpc } from './ipc'`，并在 `console.log('[main] Database initialized')` 后插入 `registerAllIpc()` 调用。

---

### Task 9: 修改 `src/preload/index.ts` 暴露 6 个 API 对象

**Files:**
- Modify: `src/preload/index.ts`

通过 `contextBridge.exposeInMainWorld` 暴露 `topicAPI`、`eventAPI`、`drawAPI`、`auditAPI`、`settingsAPI`、`importAPI`。每个方法调用 `ipcRenderer.invoke(channel, ...args)` 并返回 Promise。

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '../shared/types'

// ============================================================
// 通用 invoke 封装：自动展开参数
// ============================================================
function invoke<T>(channel: string, ...args: any[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args)
}

// ============================================================
// 题库 API
// ============================================================
const topicAPI = {
  list: (filter?: any) => invoke(IPC_CHANNELS.TOPIC_LIST, filter),
  get: (id: string) => invoke(IPC_CHANNELS.TOPIC_GET, id),
  create: (data: any) => invoke(IPC_CHANNELS.TOPIC_CREATE, data),
  update: (id: string, data: any) => invoke(IPC_CHANNELS.TOPIC_UPDATE, id, data),
  delete: (id: string) => invoke(IPC_CHANNELS.TOPIC_DELETE, id),
  batchDelete: (ids: string[]) => invoke(IPC_CHANNELS.TOPIC_BATCH_DELETE, ids),
  updateStatus: (id: string, status: string) =>
    invoke(IPC_CHANNELS.TOPIC_UPDATE_STATUS, id, status),
  updateWeight: (id: string, weight: number) =>
    invoke(IPC_CHANNELS.TOPIC_UPDATE_WEIGHT, id, weight),
  count: (filter?: any) => invoke(IPC_CHANNELS.TOPIC_COUNT, filter)
}

// ============================================================
// 赛事 API（含轮次、队伍、队伍历史）
// ============================================================
const eventAPI = {
  // event
  listEvents: (filter?: any) => invoke(IPC_CHANNELS.EVENT_LIST, filter),
  getEvent: (id: string) => invoke(IPC_CHANNELS.EVENT_GET, id),
  createEvent: (data: any) => invoke(IPC_CHANNELS.EVENT_CREATE, data),
  updateEvent: (id: string, data: any) => invoke(IPC_CHANNELS.EVENT_UPDATE, id, data),
  deleteEvent: (id: string) => invoke(IPC_CHANNELS.EVENT_DELETE, id),
  // round
  listRoundsByEvent: (eventId: string) => invoke(IPC_CHANNELS.ROUND_LIST_BY_EVENT, eventId),
  getRound: (id: string) => invoke(IPC_CHANNELS.ROUND_GET, id),
  createRound: (data: any) => invoke(IPC_CHANNELS.ROUND_CREATE, data),
  updateRound: (id: string, data: any) => invoke(IPC_CHANNELS.ROUND_UPDATE, id, data),
  deleteRound: (id: string) => invoke(IPC_CHANNELS.ROUND_DELETE, id),
  // team
  listTeamsByEvent: (eventId: string) => invoke(IPC_CHANNELS.TEAM_LIST_BY_EVENT, eventId),
  getTeam: (id: string) => invoke(IPC_CHANNELS.TEAM_GET, id),
  createTeam: (data: any) => invoke(IPC_CHANNELS.TEAM_CREATE, data),
  updateTeam: (id: string, data: any) => invoke(IPC_CHANNELS.TEAM_UPDATE, id, data),
  deleteTeam: (id: string) => invoke(IPC_CHANNELS.TEAM_DELETE, id),
  // team history
  listTeamHistory: (teamId: string) => invoke(IPC_CHANNELS.TEAM_HISTORY_LIST, teamId),
  listTeamHistoryByEvent: (eventId: string) =>
    invoke(IPC_CHANNELS.TEAM_HISTORY_LIST_BY_EVENT, eventId),
  addTeamHistory: (data: any) => invoke(IPC_CHANNELS.TEAM_HISTORY_ADD, data),
  deleteTeamHistory: (id: string) => invoke(IPC_CHANNELS.TEAM_HISTORY_DELETE, id)
}

// ============================================================
// 抽取 API
// ============================================================
const drawAPI = {
  execute: (params: any) => invoke(IPC_CHANNELS.DRAW_EXECUTE, params),
  listSessions: (filter?: any) => invoke(IPC_CHANNELS.DRAW_LIST_SESSIONS, filter),
  getSession: (id: string) => invoke(IPC_CHANNELS.DRAW_GET_SESSION, id),
  deleteSession: (id: string) => invoke(IPC_CHANNELS.DRAW_DELETE_SESSION, id),
  listDrawnTopicIds: (eventId: string) =>
    invoke(IPC_CHANNELS.DRAW_LIST_DRAWN_TOPIC_IDS, eventId),
  redo: (oldSessionId: string, params: any) =>
    invoke(IPC_CHANNELS.DRAW_REDO, oldSessionId, params)
}

// ============================================================
// 审计 API
// ============================================================
const auditAPI = {
  listLogs: (filter?: any) => invoke(IPC_CHANNELS.AUDIT_LIST_LOGS, filter),
  addLog: (input: any) => invoke(IPC_CHANNELS.AUDIT_ADD_LOG, input),
  deleteLog: (id: string) => invoke(IPC_CHANNELS.AUDIT_DELETE_LOG, id),
  clearLogs: (beforeDate?: string) => invoke(IPC_CHANNELS.AUDIT_CLEAR_LOGS, beforeDate),
  exportLogs: (req: any) => invoke(IPC_CHANNELS.AUDIT_EXPORT_LOGS, req)
}

// ============================================================
// 系统设置 API
// ============================================================
const settingsAPI = {
  get: (key: string) => invoke(IPC_CHANNELS.SETTINGS_GET, key),
  set: (key: string, value: any) => invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  getAll: () => invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
  delete: (key: string) => invoke(IPC_CHANNELS.SETTINGS_DELETE, key)
}

// ============================================================
// 导入 API
// ============================================================
const importAPI = {
  parseFile: (filePath: string, fileType: 'xlsx' | 'csv' | 'docx') =>
    invoke(IPC_CHANNELS.IMPORT_PARSE_FILE, filePath, fileType),
  execute: (req: any) => invoke(IPC_CHANNELS.IMPORT_EXECUTE, req),
  findDuplicates: (topics: any[], options?: any) =>
    invoke(IPC_CHANNELS.IMPORT_FIND_DUPLICATES, topics, options)
}

// ============================================================
// 暴露到渲染进程
// ============================================================
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('topicAPI', topicAPI)
    contextBridge.exposeInMainWorld('eventAPI', eventAPI)
    contextBridge.exposeInMainWorld('drawAPI', drawAPI)
    contextBridge.exposeInMainWorld('auditAPI', auditAPI)
    contextBridge.exposeInMainWorld('settingsAPI', settingsAPI)
    contextBridge.exposeInMainWorld('importAPI', importAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.topicAPI = topicAPI
  // @ts-ignore
  window.eventAPI = eventAPI
  // @ts-ignore
  window.drawAPI = drawAPI
  // @ts-ignore
  window.auditAPI = auditAPI
  // @ts-ignore
  window.settingsAPI = settingsAPI
  // @ts-ignore
  window.importAPI = importAPI
}
```

> **移除旧的 `window.api`**：原 `index.ts` 暴露的 `api: {}` 空对象不再需要，删除 `const api = {}` 与对应 `exposeInMainWorld('api', api)`。同步更新 `index.d.ts`。

---

### Task 10: 修改 `src/preload/index.d.ts` 声明全局类型

**Files:**
- Modify: `src/preload/index.d.ts`

```typescript
// src/preload/index.d.ts
import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  ApiResponse,
  ImportExecuteRequest,
  ImportExecuteResult,
  ExportLogsRequest,
  ExportLogsResult
} from '../shared/types'

export interface TopicAPI {
  list: (filter?: any) => Promise<ApiResponse>
  get: (id: string) => Promise<ApiResponse>
  create: (data: any) => Promise<ApiResponse>
  update: (id: string, data: any) => Promise<ApiResponse>
  delete: (id: string) => Promise<ApiResponse>
  batchDelete: (ids: string[]) => Promise<ApiResponse>
  updateStatus: (id: string, status: string) => Promise<ApiResponse>
  updateWeight: (id: string, weight: number) => Promise<ApiResponse>
  count: (filter?: any) => Promise<ApiResponse>
}

export interface EventAPI {
  listEvents: (filter?: any) => Promise<ApiResponse>
  getEvent: (id: string) => Promise<ApiResponse>
  createEvent: (data: any) => Promise<ApiResponse>
  updateEvent: (id: string, data: any) => Promise<ApiResponse>
  deleteEvent: (id: string) => Promise<ApiResponse>
  listRoundsByEvent: (eventId: string) => Promise<ApiResponse>
  getRound: (id: string) => Promise<ApiResponse>
  createRound: (data: any) => Promise<ApiResponse>
  updateRound: (id: string, data: any) => Promise<ApiResponse>
  deleteRound: (id: string) => Promise<ApiResponse>
  listTeamsByEvent: (eventId: string) => Promise<ApiResponse>
  getTeam: (id: string) => Promise<ApiResponse>
  createTeam: (data: any) => Promise<ApiResponse>
  updateTeam: (id: string, data: any) => Promise<ApiResponse>
  deleteTeam: (id: string) => Promise<ApiResponse>
  listTeamHistory: (teamId: string) => Promise<ApiResponse>
  listTeamHistoryByEvent: (eventId: string) => Promise<ApiResponse>
  addTeamHistory: (data: any) => Promise<ApiResponse>
  deleteTeamHistory: (id: string) => Promise<ApiResponse>
}

export interface DrawAPI {
  execute: (params: any) => Promise<ApiResponse>
  listSessions: (filter?: any) => Promise<ApiResponse>
  getSession: (id: string) => Promise<ApiResponse>
  deleteSession: (id: string) => Promise<ApiResponse>
  listDrawnTopicIds: (eventId: string) => Promise<ApiResponse>
  redo: (oldSessionId: string, params: any) => Promise<ApiResponse>
}

export interface AuditAPI {
  listLogs: (filter?: any) => Promise<ApiResponse>
  addLog: (input: any) => Promise<ApiResponse>
  deleteLog: (id: string) => Promise<ApiResponse>
  clearLogs: (beforeDate?: string) => Promise<ApiResponse>
  exportLogs: (req: ExportLogsRequest) => Promise<ApiResponse<ExportLogsResult>>
}

export interface SettingsAPI {
  get: (key: string) => Promise<ApiResponse>
  set: (key: string, value: any) => Promise<ApiResponse>
  getAll: () => Promise<ApiResponse>
  delete: (key: string) => Promise<ApiResponse>
}

export interface ImportAPI {
  parseFile: (filePath: string, fileType: 'xlsx' | 'csv' | 'docx') => Promise<ApiResponse>
  execute: (req: ImportExecuteRequest) => Promise<ApiResponse<ImportExecuteResult>>
  findDuplicates: (topics: any[], options?: any) => Promise<ApiResponse>
}

declare global {
  interface Window {
    electron: ElectronAPI
    topicAPI: TopicAPI
    eventAPI: EventAPI
    drawAPI: DrawAPI
    auditAPI: AuditAPI
    settingsAPI: SettingsAPI
    importAPI: ImportAPI
  }
}

export {}
```

---

### Task 11: 更新 tsconfig 让 shared/ 类型可被两侧引用

**Files:**
- Modify: `tsconfig.node.json`
- Modify: `tsconfig.web.json`

`tsconfig.node.json` 的 `include` 数组添加 `"src/shared/**/*"`：

```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": [
    "electron.vite.config.*",
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*"
  ],
  "compilerOptions": {
    "composite": true,
    "types": ["electron-vite/node"],
    "paths": {
      "@main/*": ["src/main/*"],
      "@preload/*": ["src/preload/*"],
      "@shared/*": ["src/shared/*"]
    }
  }
}
```

`tsconfig.web.json` 的 `include` 数组添加 `"src/shared/**/*"`：

```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.web.json",
  "include": [
    "src/renderer/src/env.d.ts",
    "src/renderer/src/**/*",
    "src/renderer/src/**/*.tsx",
    "src/preload/*.d.ts",
    "src/shared/**/*"
  ],
  "compilerOptions": {
    "composite": true,
    "baseUrl": ".",
    "paths": {
      "@renderer/*": ["src/renderer/src/*"],
      "@shared/*": ["src/shared/*"]
    }
  }
}
```

> **注意**：`tsconfig.web.json` 中 renderer 引用 `shared/types.ts` 会通过 `../shared/types` 相对路径，而 `shared/types.ts` 内部 `export from '../main/db/repository/...'` 指向 main 目录。这会导致 web 侧编译时把 main 代码拉进来。**解决方案**：见 Task 12 —— shared/types.ts 中不直接 re-export repository 类型，而是定义独立类型别名（结构等价），主进程与渲染进程各自保证类型兼容。

---

### Task 12: 调整 `src/shared/types.ts` 避免跨 main/renderer 边界

**Files:**
- Modify: `src/shared/types.ts`

**问题**：原 Task 1 设计中 `shared/types.ts` 通过 `export type { Topic } from '../main/db/repository/topic.repo'` 引入类型，这会让 renderer 构建时把 main 代码（依赖 electron、better-sqlite3）拉入，编译失败。

**调整方案**：`shared/types.ts` 仅包含纯类型定义（不引用 main/renderer 任何模块）。所有业务实体类型在此文件中独立声明为 interface/type，与 repository 中类型保持结构兼容（主进程内部仍用 repository 类型，IPC 边界处 TypeScript 自动做结构化类型检查）。

```typescript
// src/shared/types.ts
// ============================================================
// IPC 共享类型定义
//
// 此文件不依赖 main 或 renderer 任何模块，确保两侧都能安全引用。
// 业务实体类型在此独立声明，与 repository 中类型保持结构兼容。
// ============================================================

// ---------- 业务实体（结构等价于 repository 中的类型） ----------
export interface Topic {
  id: string
  title: string
  type: string | null
  domain: string | null
  difficulty: string | null
  source: string | null
  source_type: string | null
  tags: string[] | null
  weight: number
  status: string
  created_at: string
  updated_at: string
}

export interface TopicFilter {
  type?: string
  domain?: string
  difficulty?: string
  source?: string
  source_type?: string
  status?: string
  tags?: string[]
  keyword?: string
  page?: number
  pageSize?: number
}

export interface TopicCreateInput {
  title: string
  type?: string | null
  domain?: string | null
  difficulty?: string | null
  source?: string | null
  source_type?: string | null
  tags?: string[] | null
  weight?: number
  status?: string
}

export interface TopicUpdateInput {
  title?: string
  type?: string | null
  domain?: string | null
  difficulty?: string | null
  source?: string | null
  source_type?: string | null
  tags?: string[] | null
  weight?: number
  status?: string
}

export interface Event {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  status: string | null
  created_at: string | null
}
export interface EventFilter { status?: string; page?: number; pageSize?: number }
export interface EventCreateInput { name: string; start_date?: string | null; end_date?: string | null; status?: string | null }
export interface EventUpdateInput { name?: string; start_date?: string | null; end_date?: string | null; status?: string | null }

export interface Round {
  id: string
  event_id: string
  name: string | null
  round_number: number | null
  difficulty_override: string | null
  topic_count: number | null
}
export interface RoundCreateInput { event_id: string; name?: string | null; round_number?: number | null; difficulty_override?: string | null; topic_count?: number | null }
export interface RoundUpdateInput { name?: string | null; round_number?: number | null; difficulty_override?: string | null; topic_count?: number | null }

export interface Team { id: string; name: string; event_id: string }
export interface TeamCreateInput { name: string; event_id: string }
export interface TeamUpdateInput { name?: string }

export interface TeamHistory { id: string; team_id: string; topic_id: string; event_id: string; played_at: string | null }
export interface TeamHistoryCreateInput { team_id: string; topic_id: string; event_id: string; played_at?: string | null }

export interface DrawSession {
  id: string
  event_id: string
  round_id: string | null
  draw_time: string | null
  operator: string | null
  settings: Record<string, any> | null
}
export interface DrawSessionItem {
  id: string
  session_id: string
  topic_id: string
  team_a_id: string | null
  team_b_id: string | null
  stance_a: string | null
  stance_b: string | null
}
export interface DrawSessionDetail extends DrawSession { items: DrawSessionItem[] }
export interface SessionFilter {
  event_id?: string
  round_id?: string
  operator?: string
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}

export interface AuditLog {
  id: string
  action: string | null
  target_type: string | null
  target_id: string | null
  operator: string | null
  detail: Record<string, any> | null
  created_at: string | null
}
export interface AuditLogFilter {
  action?: string
  target_type?: string
  operator?: string
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}
export interface AuditLogCreateInput {
  action: string
  target_type: string
  target_id: string
  operator: string
  detail?: Record<string, any>
}

export interface SourceMixRatio { official: number; custom: number }
export interface DrawParams {
  event_id: string
  round_id?: string | null
  topic_count: number
  include_stance: boolean
  teams?: Team[]
  filters?: TopicFilter
  source_mix_ratio?: SourceMixRatio
  operator?: string
}
export interface DrawResult {
  session: DrawSessionDetail
  topics: Topic[]
  actual_ratio?: { official: number; custom: number }
}

export type DuplicateReason = 'exact' | 'levenshtein' | 'keyword' | 'ai'
export interface DuplicateGroup {
  id: string
  topics: Topic[]
  similarity: number
  reason: DuplicateReason
}
export interface DedupOptions {
  levenshteinThreshold?: number
  keywordThreshold?: number
  aiThreshold?: number
  similarityFn?: (a: Topic, b: Topic) => Promise<number>
}

export type FileType = 'xlsx' | 'csv' | 'docx'
export interface ParsedResult {
  topics: TopicCreateInput[]
  mapping: Record<string, string>
  warnings: string[]
}

// ---------- 统一响应封装 ----------
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ---------- 通道名常量 ----------
export const IPC_CHANNELS = {
  TOPIC_LIST: 'topic:list',
  TOPIC_GET: 'topic:get',
  TOPIC_CREATE: 'topic:create',
  TOPIC_UPDATE: 'topic:update',
  TOPIC_DELETE: 'topic:delete',
  TOPIC_BATCH_DELETE: 'topic:batchDelete',
  TOPIC_UPDATE_STATUS: 'topic:updateStatus',
  TOPIC_UPDATE_WEIGHT: 'topic:updateWeight',
  TOPIC_COUNT: 'topic:count',
  EVENT_LIST: 'event:list',
  EVENT_GET: 'event:get',
  EVENT_CREATE: 'event:create',
  EVENT_UPDATE: 'event:update',
  EVENT_DELETE: 'event:event_delete',
  ROUND_LIST_BY_EVENT: 'round:listByEvent',
  ROUND_GET: 'round:get',
  ROUND_CREATE: 'round:create',
  ROUND_UPDATE: 'round:update',
  ROUND_DELETE: 'round:delete',
  TEAM_LIST_BY_EVENT: 'team:listByEvent',
  TEAM_GET: 'team:get',
  TEAM_CREATE: 'team:create',
  TEAM_UPDATE: 'team:update',
  TEAM_DELETE: 'team:delete',
  TEAM_HISTORY_LIST: 'teamHistory:list',
  TEAM_HISTORY_LIST_BY_EVENT: 'teamHistory:listByEvent',
  TEAM_HISTORY_ADD: 'teamHistory:add',
  TEAM_HISTORY_DELETE: 'teamHistory:delete',
  DRAW_EXECUTE: 'draw:execute',
  DRAW_LIST_SESSIONS: 'draw:listSessions',
  DRAW_GET_SESSION: 'draw:getSession',
  DRAW_DELETE_SESSION: 'draw:deleteSession',
  DRAW_LIST_DRAWN_TOPIC_IDS: 'draw:listDrawnTopicIds',
  DRAW_REDO: 'draw:redo',
  AUDIT_LIST_LOGS: 'audit:listLogs',
  AUDIT_ADD_LOG: 'audit:addLog',
  AUDIT_DELETE_LOG: 'audit:deleteLog',
  AUDIT_CLEAR_LOGS: 'audit:clearLogs',
  AUDIT_EXPORT_LOGS: 'audit:exportLogs',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_DELETE: 'settings:delete',
  IMPORT_PARSE_FILE: 'import:parseFile',
  IMPORT_EXECUTE: 'import:execute',
  IMPORT_FIND_DUPLICATES: 'import:findDuplicates'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

// ---------- 请求参数类型 ----------
export interface ImportExecuteRequest {
  topics: TopicCreateInput[]
  checkDuplicates?: boolean
}

export interface ImportExecuteResult {
  imported: number
  duplicates: number
  failed: number
  duplicateGroups: Array<{ title: string; existingIds: string[] }>
}

export interface ExportLogsRequest {
  filter?: AuditLogFilter
  format: 'csv' | 'json'
}

export interface ExportLogsResult {
  filePath: string
  count: number
}
```

---

### Task 13: 验证 — 类型检查 + 启动测试

**Files:** 无修改，仅执行命令验证。

- [ ] **Step 1: TypeScript 类型检查**

Run: `npm run typecheck`
Expected: 无错误，无警告（特别关注 shared/types.ts 在两侧都能正确解析）。

- [ ] **Step 2: 单元测试不回归**

Run: `npm test`
Expected: 67 个测试全部通过（IPC 层未引入新测试，但需确保 services 层测试未被破坏）。

- [ ] **Step 3: 启动应用验证 IPC 注册**

Run: `npm run dev`
Expected:
- 控制台输出 `[main] All IPC handlers registered`
- 应用窗口正常打开
- 在 DevTools Console 中执行 `await window.topicAPI.list()` 返回 `{ success: true, data: { items: [], total: 0 } }`
- 执行 `await window.settingsAPI.set('test_key', { a: 1 })` 后再 `await window.settingsAPI.get('test_key')` 返回 `{ success: true, data: { a: 1 } }`

- [ ] **Step 4: 错误处理验证**

在 DevTools Console 中执行 `await window.topicAPI.get('non-existent-id')`，确认返回 `{ success: true, data: undefined }`（repository 行为）。
执行 `await window.topicAPI.delete('non-existent-id')`，确认返回 `{ success: true, data: false }`。
执行 `await window.drawAPI.execute({ event_id: 'non-existent', topic_count: 1, include_stance: false })`，确认返回 `{ success: false, error: '...' }`（外键约束失败被捕获）。

---

## Assumptions & Decisions

1. **shared/ 位置**：放 `src/shared/` 而非项目根 `shared/`，与现有 `src/main`、`src/preload`、`src/renderer` 平级，最易纳入现有 tsconfig 体系。
2. **shared/types.ts 不引用 main 模块**：避免 renderer 构建时拉入 electron/better-sqlite3 依赖。类型在 shared 中独立定义，与 repository 类型结构等价（TypeScript 结构化类型系统天然兼容）。
3. **preload 文件**：修改 `src/preload/index.ts`（electron-vite 实际入口），不动 `src/main/preload/index.ts` 占位文件。
4. **重抽（redo）**：组合 `deleteSession` + `drawTopics`，并写一条 `action='redraw'` 的审计日志。不修改 services 层。
5. **导入执行**：IPC 层实现 `importTopics` 逻辑（库内去重 + 批量插入 + 审计），不新增 services 函数。
6. **导出日志**：主进程用 `dialog.showSaveDialog` 让用户选保存位置，主进程写文件，返回文件路径。
7. **错误处理**：每个 handler 用 `wrap()` 包装同步函数，async handler 单独 try/catch。统一返回 `ApiResponse`。
8. **类型安全**：preload 中 API 方法参数暂用 `any`（业务类型在 shared/types.ts 已定义，渲染进程调用时可显式标注），平衡类型严格性与实现成本。
9. **不修改 repository 与 services**：IPC 层仅作为薄封装调用现有层。
10. **不写 IPC 单元测试**：IPC handler 依赖 Electron 运行时（ipcMain/dialog/BrowserWindow），单元测试需要 mock 整个 electron 模块，成本高收益低。验证依赖 Task 13 的端到端启动测试。

---

## Verification Steps

完成全部 13 个 Task 后，按以下顺序验证：

1. `npm run typecheck` —— 类型检查通过
2. `npm test` —— 67 个 services 测试不回归
3. `npm run dev` —— 应用启动，控制台输出 `[main] All IPC handlers registered`
4. DevTools 验证：
   - `window.topicAPI` / `eventAPI` / `drawAPI` / `auditAPI` / `settingsAPI` / `importAPI` 均存在
   - `await window.topicAPI.list()` 返回 `{ success: true, data: { items: [], total: 0 } }`
   - `await window.settingsAPI.set('k', 'v')` + `await window.settingsAPI.get('k')` 往返正确
   - `await window.topicAPI.get('non-existent')` 返回 `{ success: true, data: undefined }`
   - `await window.drawAPI.execute({...无效参数...})` 返回 `{ success: false, error: '...' }`
5. 无残留临时文件，无 console error
