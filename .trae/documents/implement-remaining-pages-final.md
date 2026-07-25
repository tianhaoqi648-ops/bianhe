# 剩余页面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use TodoWrite 跟踪任务进度，按以下任务顺序实现。每完成一个 Task 立即标记 completed。

**Goal:** 实现应用剩余 4 个空壳页面（EventManage / TeamManage / History / Settings），增强 TopicLibrary（导入+去重入口）和 DrawPage（接收跳转上下文），并补充基础设施（export IPC、官方题库种子、audit/settings store）。

**Architecture:**
- **分工互补**：EventManage 管赛事 CRUD + 赛事详情（轮次/难度梯度/跳转抽取），TeamManage 是跨赛事全队伍总览 + 队伍历史辩题录入
- **Store 层**：新增 `auditStore` 和 `settingsStore`，与其他 store 架构一致
- **导出**：新增 `export.ipc.ts` 注册题库/抽取记录/赛事数据包导出通道，复用 `audit.ipc.ts` 的 `dialog.showSaveDialog + writeFileSync` 模式；Excel 用 `xlsx` 库（已在依赖中），CSV 直接拼字符串
- **官方题库**：创建 `data/official-topics.json` 预置 15-20 道覆盖各类型/难度的经典辩题；新建 `src/main/db/seed.ts` 实现"首次启动加载"逻辑（通过 settings 表 `official_seeded` 标记防重）
- **AI 去重**：Settings 页 UI 占位（开关 + API Key 输入框，仅持久化配置不调用）；levenshtein/keyword 阈值滑块可配置并实时生效

**Tech Stack:** React 18 + TypeScript + Ant Design 5 + Zustand + xlsx（已依赖）+ electron dialog

---

## 决策汇总

| 决策项 | 选择 |
|---|---|
| TeamManage / EventManage 分工 | 分工互补（两页职责独立） |
| 官方题库预置 | 结构 + 15-20 道示例 |
| AI 语义去重 | UI 占位 + 阈值可配 |

### 默认决策（计划中执行，不再询问）
1. 新建 `auditStore.ts` 和 `settingsStore.ts`
2. 新建 `export.ipc.ts`，导出通道走 `dialog.showSaveDialog + writeFileSync`
3. 修改 `DrawPage.tsx` 读取 `useLocation().state` 接收 `{ eventId, roundId }` 跳转上下文
4. 难度梯度预设：赛事详情页"一键应用预设"按钮，自动创建"小组赛/复赛/决赛"3 个轮次
5. Settings AI 语义配置仅 UI 占位（提示"未启用，开发中"），levenshtein/keyword 阈值滑块可配置并持久化到 settings 表
6. 官方题库 source_type = '官方'，用户可拉黑（status='blacklist'）但不可编辑/删除
7. 导入功能在 TopicLibrary 工具栏和 Settings 页面都提供入口
8. 去重检查在 TopicLibrary 工具栏和 Settings 页面都提供入口

---

## 文件结构

### 新建文件

**主进程：**
- `src/main/ipc/export.ipc.ts` — 题库/抽取记录/赛事数据包导出 IPC handler
- `src/main/db/seed.ts` — 官方题库种子加载逻辑

**数据：**
- `data/official-topics.json` — 15-20 道经典辩题（覆盖类型/难度/领域）

**渲染进程 - Store：**
- `src/renderer/src/stores/auditStore.ts` — 审计日志 store
- `src/renderer/src/stores/settingsStore.ts` — 系统设置 store

**渲染进程 - 通用组件：**
- `src/renderer/src/components/EventEditModal.tsx` — 赛事新增/编辑弹窗
- `src/renderer/src/components/TeamEditModal.tsx` — 队伍新增/编辑弹窗
- `src/renderer/src/components/RoundEditModal.tsx` — 轮次新增/编辑弹窗
- `src/renderer/src/components/TeamHistoryModal.tsx` — 队伍历史辩题录入弹窗
- `src/renderer/src/components/ImportTopicsModal.tsx` — 导入辩题弹窗（选文件→预览→确认→结果）
- `src/renderer/src/components/DedupResultModal.tsx` — 去重检查结果展示弹窗

### 修改文件
- `src/shared/types.ts` — 新增 ExportRequest/ExportResult 类型 + IPC_CHANNELS 中的 export 通道
- `src/main/ipc/index.ts` — 注册 export.ipc
- `src/main/db/index.ts` — 初始化后调用 seedOfficialTopics()
- `src/preload/index.ts` — 暴露 exportAPI
- `src/renderer/src/pages/EventManage.tsx` — 重写
- `src/renderer/src/pages/TeamManage.tsx` — 重写
- `src/renderer/src/pages/History.tsx` — 重写
- `src/renderer/src/pages/Settings.tsx` — 重写
- `src/renderer/src/pages/TopicLibrary.tsx` — 工具栏添加"导入"和"去重检查"按钮
- `src/renderer/src/pages/DrawPage.tsx` — 接收 location.state 跳转上下文

---

## Task 1: 扩展 shared/types.ts 新增导出相关类型

**Files:**
- Modify: `src/shared/types.ts`

**说明：** 新增导出请求/结果类型，新增 export 相关 IPC 通道常量。复用 audit.ipc.ts 已有的 dialog 模式，但导出内容多样（题库/抽取记录/赛事数据包），需要独立通道。

- [ ] **Step 1: 在 IPC_CHANNELS 中新增 export 通道**

在 `src/shared/types.ts` 的 `IPC_CHANNELS` 对象中，在 `IMPORT_FIND_DUPLICATES` 后追加：

```typescript
  // import
  IMPORT_PARSE_FILE: 'import:parseFile',
  IMPORT_EXECUTE: 'import:execute',
  IMPORT_FIND_DUPLICATES: 'import:findDuplicates',
  // export
  EXPORT_TOPICS: 'export:topics',
  EXPORT_DRAW_SESSIONS: 'export:drawSessions',
  EXPORT_EVENT_PACKAGE: 'export:eventPackage'
} as const
```

- [ ] **Step 2: 在文件末尾追加导出相关类型**

在 `src/shared/types.ts` 末尾追加：

```typescript
// ---------- 导出相关类型 ----------

export type ExportFormat = 'xlsx' | 'csv' | 'json'

export interface ExportTopicsRequest {
  filter?: TopicFilter
  format: ExportFormat
}

export interface ExportDrawSessionsRequest {
  filter?: SessionFilter
  format: ExportFormat
}

export interface ExportEventPackageRequest {
  eventId: string
}

export interface ExportResult {
  filePath: string
  count: number
}
```

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过（仅新增类型，不破坏现有代码）

---

## Task 2: 创建官方题库种子数据

**Files:**
- Create: `data/official-topics.json`

**说明：** 预置 18 道覆盖各类型/难度/领域的经典辩题。每条数据含 title、type、domain、difficulty、source、source_type、tags 字段。source_type 统一为 "官方"。

- [ ] **Step 1: 创建 data 目录与 JSON 文件**

在项目根目录创建 `data/official-topics.json`：

```json
[
  {
    "title": "顺境/逆境更有利于人的成长",
    "type": "价值辩",
    "domain": "人生哲理",
    "difficulty": "入门",
    "source": "经典辩题集",
    "source_type": "官方",
    "tags": ["成长", "环境"]
  },
  {
    "title": "大学生兼职利大于弊/弊大于利",
    "type": "政策辩",
    "domain": "教育",
    "difficulty": "入门",
    "source": "校园辩论赛",
    "source_type": "官方",
    "tags": ["大学生", "兼职"]
  },
  {
    "title": "网络匿名特性有利于/不利于公共讨论",
    "type": "事实辩",
    "domain": "网络社会",
    "difficulty": "中级",
    "source": "互联网辩论赛",
    "source_type": "官方",
    "tags": ["网络", "匿名", "公共讨论"]
  },
  {
    "title": "人工智能是否会威胁人类文明",
    "type": "事实辩",
    "domain": "科技伦理",
    "difficulty": "高级",
    "source": "科技辩论赛",
    "source_type": "官方",
    "tags": ["AI", "科技", "伦理"]
  },
  {
    "title": "当代社会更应该鼓励竞争/合作",
    "type": "价值辩",
    "domain": "社会",
    "difficulty": "中级",
    "source": "经典辩题集",
    "source_type": "官方",
    "tags": ["竞争", "合作", "社会"]
  },
  {
    "title": "短视频的流行是精神丰富/精神贫乏的表现",
    "type": "价值辩",
    "domain": "文化",
    "difficulty": "中级",
    "source": "互联网辩论赛",
    "source_type": "官方",
    "tags": ["短视频", "文化", "精神"]
  },
  {
    "title": "应该/不应该立法禁止人肉搜索",
    "type": "政策辩",
    "domain": "法律",
    "difficulty": "高级",
    "source": "法律辩论赛",
    "source_type": "官方",
    "tags": ["法律", "人肉搜索", "隐私"]
  },
  {
    "title": "情商比智商更重要/智商比情商更重要",
    "type": "价值辩",
    "domain": "人生哲理",
    "difficulty": "入门",
    "source": "经典辩题集",
    "source_type": "官方",
    "tags": ["情商", "智商"]
  },
  {
    "title": "大数据时代，隐私保护应该/不应该让位于便利",
    "type": "政策辩",
    "domain": "科技伦理",
    "difficulty": "高级",
    "source": "科技辩论赛",
    "source_type": "官方",
    "tags": ["大数据", "隐私", "便利"]
  },
  {
    "title": "传统文化应该/不应该创新性发展",
    "type": "价值辩",
    "domain": "文化",
    "difficulty": "中级",
    "source": "文化辩论赛",
    "source_type": "官方",
    "tags": ["传统文化", "创新"]
  },
  {
    "title": "退休年龄应该/不应该推迟",
    "type": "政策辩",
    "domain": "社会",
    "difficulty": "中级",
    "source": "社会辩论赛",
    "source_type": "官方",
    "tags": ["退休", "老龄化"]
  },
  {
    "title": "电子竞技应该/不应该成为奥运比赛项目",
    "type": "政策辩",
    "domain": "体育",
    "difficulty": "中级",
    "source": "体育辩论赛",
    "source_type": "官方",
    "tags": ["电竞", "奥运"]
  },
  {
    "title": "信息碎片化提升/降低了当代人的认知水平",
    "type": "事实辩",
    "domain": "网络社会",
    "difficulty": "高级",
    "source": "互联网辩论赛",
    "source_type": "官方",
    "tags": ["碎片化", "认知", "信息"]
  },
  {
    "title": "青年成才主要靠自身努力/外部机遇",
    "type": "价值辩",
    "domain": "人生哲理",
    "difficulty": "入门",
    "source": "经典辩题集",
    "source_type": "官方",
    "tags": ["成才", "努力", "机遇"]
  },
  {
    "title": "远程办公应该/不应该成为常态",
    "type": "政策辩",
    "domain": "社会",
    "difficulty": "中级",
    "source": "社会辩论赛",
    "source_type": "官方",
    "tags": ["远程办公", "工作"]
  },
  {
    "title": "基因编辑技术应该/不应该被禁止应用于人类胚胎",
    "type": "政策辩",
    "domain": "科技伦理",
    "difficulty": "高级",
    "source": "科技辩论赛",
    "source_type": "官方",
    "tags": ["基因编辑", "伦理", "生物科技"]
  },
  {
    "title": "物质富裕/精神富裕更重要",
    "type": "价值辩",
    "domain": "人生哲理",
    "difficulty": "入门",
    "source": "经典辩题集",
    "source_type": "官方",
    "tags": ["物质", "精神", "富裕"]
  },
  {
    "title": "社交媒体拉近了/疏远了人与人的距离",
    "type": "事实辩",
    "domain": "网络社会",
    "difficulty": "中级",
    "source": "互联网辩论赛",
    "source_type": "官方",
    "tags": ["社交媒体", "人际关系"]
  }
]
```

- [ ] **Step 2: 验证 JSON 合法性**

Run: `node -e "JSON.parse(require('fs').readFileSync('data/official-topics.json','utf-8')); console.log('OK')"`
Expected: 输出 `OK`

---

## Task 3: 创建 seed.ts 官方题库加载逻辑

**Files:**
- Create: `src/main/db/seed.ts`
- Modify: `src/main/db/index.ts`

**说明：** 实现 `seedOfficialTopics()`：通过 settings 表 `official_seeded` 标记防止重复加载。读取 JSON 文件用 `?raw` Vite 内联（与 schema.sql 一致），避免打包后路径错乱。

- [ ] **Step 1: 创建 src/main/db/seed.ts**

```typescript
// ============================================================
// seed.ts — 官方题库种子加载
//
// 首次启动时把 data/official-topics.json 加载到 topics 表。
// 通过 settings 表 'official_seeded' 标记防止重复加载。
// 用户可在设置页手动触发"重新加载"（会清空旧的官方题再重灌）。
// ============================================================

import { getDb } from './index'
import { topicRepo } from './repository/topic.repo'
import { auditRepo } from './repository/audit.repo'
// 使用 ?raw 将 JSON 文件作为字符串内联进打包产物
import officialTopicsJson from '../../../data/official-topics.json?raw'

const SEED_FLAG_KEY = 'official_seeded'

/**
 * 检查是否已加载官方题库。
 */
export function isOfficialSeeded(): boolean {
  return auditRepo.getSetting(SEED_FLAG_KEY) === true
}

/**
 * 加载官方题库到数据库。
 * - 仅在未加载时执行（首次启动）
 * - 用 INSERT OR IGNORE 防止 title 重复时出错
 * - 写入 settings.official_seeded = true
 * - 记录 audit_log
 */
export function seedOfficialTopics(): { loaded: number; skipped: boolean } {
  if (isOfficialSeeded()) {
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
      // 检查是否已存在同标题题（用户可能手动建过）
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

  auditRepo.setSetting(SEED_FLAG_KEY, true)
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
 * 强制重新加载官方题库（设置页"重新加载"按钮调用）。
 * - 删除所有 source_type='官方' 的题
 * - 重置 settings.official_seeded = false
 * - 调用 seedOfficialTopics()
 */
export function forceReseedOfficialTopics(): { loaded: number; deleted: number } {
  const db = getDb()
  const stmt = db.prepare("DELETE FROM topics WHERE source_type = '官方'")
  const result = stmt.run()
  const deleted = result.changes

  auditRepo.setSetting(SEED_FLAG_KEY, false)
  const { loaded } = seedOfficialTopics()
  return { loaded, deleted }
}
```

- [ ] **Step 2: 在 src/main/db/index.ts 末尾导出 seed 函数**

在 `src/main/db/index.ts` 文件末尾追加：

```typescript

// 导出官方题库种子加载函数
export { seedOfficialTopics, isOfficialSeeded, forceReseedOfficialTopics } from './seed'
```

- [ ] **Step 3: 在 src/main/index.ts 初始化后调用 seed**

修改 `src/main/index.ts` 第 5 行 import，添加 seedOfficialTopics：

```typescript
import { initDatabase, closeDatabase, seedOfficialTopics } from './db'
```

在 `initDatabase()` 调用后、`registerAllIpc()` 之前插入：

```typescript
    // 初始化数据库
    initDatabase()
    console.log('[main] Database initialized')

    // 加载官方题库（首次启动）
    try {
      const result = seedOfficialTopics()
      if (!result.skipped) {
        console.log(`[main] Official topics loaded: ${result.loaded}`)
      }
    } catch (e) {
      console.error('[main] Failed to load official topics:', e)
    }
```

- [ ] **Step 4: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过（注意 vite-env.d.ts 需识别 `*.json?raw` 模块声明，见 Step 5）

- [ ] **Step 5: 如 typecheck 报错找不到 ?raw 模块声明，在 src/main/db/seed.ts 顶部添加**

```typescript
// 模块声明：让 TypeScript 识别 ?raw 后缀的 JSON 导入
declare module '*.json?raw' {
  const content: string
  export default content
}
```

---

## Task 4: 创建 export.ipc.ts 导出 IPC handler

**Files:**
- Create: `src/main/ipc/export.ipc.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`

**说明：** 实现题库/抽取记录/赛事数据包导出。复用 audit.ipc.ts 的 dialog+writeFileSync 模式。Excel 用 xlsx 库，CSV 拼字符串，JSON 直接 stringify。

- [ ] **Step 1: 创建 src/main/ipc/export.ipc.ts**

```typescript
// ============================================================
// export.ipc.ts — 数据导出 IPC handler
//
// 注册通道：
//   export:topics        导出题库（按 filter 筛选，xlsx/csv/json）
//   export:drawSessions  导出抽取记录（按 filter 筛选，xlsx/csv/json）
//   export:eventPackage  导出赛事数据包（JSON，含赛事+轮次+队伍+抽取记录）
// ============================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import * as XLSX from 'xlsx'
import { topicRepo } from '../db/repository/topic.repo'
import { eventRepo } from '../db/repository/event.repo'
import { drawRepo } from '../db/repository/draw.repo'
import type { TopicFilter, SessionFilter } from '../../shared/types'
import {
  IPC_CHANNELS,
  type ApiResponse,
  type ExportTopicsRequest,
  type ExportDrawSessionsRequest,
  type ExportEventPackageRequest,
  type ExportResult,
  type ExportFormat
} from '../../shared/types'

function wrap<T>(fn: () => T): ApiResponse<T> {
  try {
    const data = fn()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 选择保存路径的通用工具。
 */
async function pickSavePath(
  title: string,
  defaultName: string,
  format: ExportFormat
): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const filters: Array<{ name: string; extensions: string[] }> = []
  if (format === 'xlsx') filters.push({ name: 'Excel', extensions: ['xlsx'] })
  else if (format === 'csv') filters.push({ name: 'CSV', extensions: ['csv'] })
  else filters.push({ name: 'JSON', extensions: ['json'] })

  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    title,
    defaultPath: defaultName,
    filters
  })
  return canceled || !filePath ? null : filePath
}

/**
 * 把对象数组转为 Excel/CSV/JSON 字符串或 Buffer。
 * - xlsx：用 XLSX.utils.json_to_sheet + XLSX.write 返回 Buffer
 * - csv：手工拼接（含逗号/引号/换行转义）
 * - json：JSON.stringify
 */
function serializeRows(
  rows: Array<Record<string, any>>,
  format: ExportFormat
): Buffer | string {
  if (format === 'json') return JSON.stringify(rows, null, 2)

  if (format === 'xlsx') {
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  }

  // csv
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escapeCell = (v: any): string => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(','))]
  return lines.join('\n') + '\n'
}

function writeContent(filePath: string, content: Buffer | string, format: ExportFormat): void {
  if (format === 'xlsx' && Buffer.isBuffer(content)) {
    writeFileSync(filePath, content)
  } else {
    writeFileSync(filePath, content as string, 'utf-8')
  }
}

export function registerExportIpc(): void {
  // 导出题库
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_TOPICS,
    async (_e, req: ExportTopicsRequest): Promise<ApiResponse<ExportResult>> => {
      try {
        const { filter, format } = req
        // 拉取全部匹配题（pageSize=100000）
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

        const content = serializeRows(rows, format)
        writeContent(filePath, content, format)
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
        // 拉取全部匹配会话（pageSize=100000）
        const { items } = drawRepo.listSessions({ ...filter, page: 1, pageSize: 100000 })

        // 展开每个 session 的 items 为行
        const rows: Array<Record<string, any>> = []
        for (const s of items) {
          const detail = drawRepo.getSessionById(s.id)
          const eventName = eventRepo.getEventById(s.event_id)?.name ?? ''
          const roundName = s.round_id ? eventRepo.getRoundById(s.round_id)?.name ?? '' : ''
          if (!detail || detail.items.length === 0) {
            rows.push({
              session_id: s.id,
              draw_time: s.draw_time,
              operator: s.operator ?? '',
              event_name: eventName,
              round_name: roundName,
              topic_title: '',
              stance_a: '',
              stance_b: '',
              team_a: '',
              team_b: ''
            })
            continue
          }
          for (const item of detail.items) {
            const topic = topicRepo.getTopicById(item.topic_id)
            const teamA = item.team_a_id ? eventRepo.getTeamById(item.team_a_id)?.name ?? '' : ''
            const teamB = item.team_b_id ? eventRepo.getTeamById(item.team_b_id)?.name ?? '' : ''
            rows.push({
              session_id: s.id,
              draw_time: s.draw_time,
              operator: s.operator ?? '',
              event_name: eventName,
              round_name: roundName,
              topic_title: topic?.title ?? '',
              stance_a: item.stance_a ?? '',
              stance_b: item.stance_b ?? '',
              team_a: teamA,
              team_b: teamB
            })
          }
        }

        const defaultName = `draw-sessions-${new Date().toISOString().slice(0, 10)}.${format}`
        const filePath = await pickSavePath('导出抽取记录', defaultName, format)
        if (!filePath) return { success: false, error: '用户取消保存' }

        const content = serializeRows(rows, format)
        writeContent(filePath, content, format)
        return { success: true, data: { filePath, count: rows.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 导出赛事数据包（JSON，含赛事+轮次+队伍+抽取记录+辩题快照）
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_EVENT_PACKAGE,
    async (_e, req: ExportEventPackageRequest): Promise<ApiResponse<ExportResult>> => {
      try {
        const { eventId } = req
        const event = eventRepo.getEventById(eventId)
        if (!event) return { success: false, error: '赛事不存在' }

        const rounds = eventRepo.listRoundsByEvent(eventId)
        const teams = eventRepo.listTeamsByEvent(eventId)
        const teamHistory = eventRepo.listTeamHistoryByEvent(eventId)

        // 抽取记录
        const { items: sessions } = drawRepo.listSessions({
          event_id: eventId,
          page: 1,
          pageSize: 100000
        })
        const sessionDetails = sessions.map((s) => drawRepo.getSessionById(s.id))

        // 收集所有涉及到的 topic_id（去重）
        const topicIds = new Set<string>()
        for (const d of sessionDetails) {
          if (!d) continue
          for (const item of d.items) topicIds.add(item.topic_id)
        }
        for (const h of teamHistory) topicIds.add(h.topic_id)
        const topics = Array.from(topicIds)
          .map((id) => topicRepo.getTopicById(id))
          .filter((t): t is NonNullable<typeof t> => !!t)

        const pkg = {
          exported_at: new Date().toISOString(),
          event,
          rounds,
          teams,
          teamHistory,
          sessions: sessionDetails.filter((s): s is NonNullable<typeof s> => !!s),
          topics
        }

        const defaultName = `event-package-${event.name}-${new Date().toISOString().slice(0, 10)}.json`
        const filePath = await pickSavePath('导出赛事数据包', defaultName, 'json')
        if (!filePath) return { success: false, error: '用户取消保存' }

        writeFileSync(filePath, JSON.stringify(pkg, null, 2), 'utf-8')
        return { success: true, data: { filePath, count: sessions.length } }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
```

- [ ] **Step 2: 在 src/main/ipc/index.ts 注册 export.ipc**

读取当前 `src/main/ipc/index.ts` 内容，添加 `registerExportIpc` import 与调用。预期结构：

```typescript
import { registerTopicIpc } from './topic.ipc'
import { registerEventIpc } from './event.ipc'
import { registerDrawIpc } from './draw.ipc'
import { registerAuditIpc } from './audit.ipc'
import { registerImportIpc } from './import.ipc'
import { registerExportIpc } from './export.ipc'

export function registerAllIpc(): void {
  registerTopicIpc()
  registerEventIpc()
  registerDrawIpc()
  registerAuditIpc()
  registerImportIpc()
  registerExportIpc()
  console.log('[main] All IPC handlers registered')
}
```

- [ ] **Step 3: 在 src/preload/index.ts 暴露 exportAPI**

在 `src/preload/index.ts` 文件中：
1. 在 `importAPI` 定义后追加 `exportAPI`：

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

2. 在 `contextBridge.exposeInMainWorld` 区块和 else 分支中追加：

```typescript
  contextBridge.exposeInMainWorld('exportAPI', exportAPI)
```

和

```typescript
  // @ts-ignore
  window.exportAPI = exportAPI
```

- [ ] **Step 4: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 5: 创建 auditStore 和 settingsStore

**Files:**
- Create: `src/renderer/src/stores/auditStore.ts`
- Create: `src/renderer/src/stores/settingsStore.ts`

**说明：** 与其他 store 架构一致，封装 IPC 调用。

- [ ] **Step 1: 创建 src/renderer/src/stores/auditStore.ts**

```typescript
import { create } from 'zustand';
import type { AuditLog, AuditLogFilter, AuditLogCreateInput, ApiResponse } from '../../../shared/types';

interface AuditListResponse {
  items: AuditLog[];
  total: number;
}

interface AuditState {
  logs: AuditLog[];
  total: number;
  loading: boolean;
  error: string | null;

  listLogs: (filter?: AuditLogFilter) => Promise<void>;
  addLog: (input: AuditLogCreateInput) => Promise<AuditLog | null>;
  deleteLog: (id: string) => Promise<boolean>;
  clearLogs: (beforeDate?: string) => Promise<boolean>;
  exportLogs: (req: any) => Promise<{ filePath: string; count: number } | null>;
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

export const useAuditStore = create<AuditState>((set) => ({
  logs: [],
  total: 0,
  loading: false,
  error: null,

  listLogs: async (filter) => {
    set({ loading: true, error: null });
    try {
      const res = await window.auditAPI.listLogs(filter);
      const data = extractError<AuditListResponse>(res);
      set({ logs: data.items, total: data.total, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  addLog: async (input) => {
    const res = await window.auditAPI.addLog(input);
    return extractError<AuditLog>(res);
  },

  deleteLog: async (id) => {
    const res = await window.auditAPI.deleteLog(id);
    extractError(res);
    return true;
  },

  clearLogs: async (beforeDate) => {
    const res = await window.auditAPI.clearLogs(beforeDate);
    extractError(res);
    return true;
  },

  exportLogs: async (req) => {
    const res = await window.auditAPI.exportLogs(req);
    if (res.success && res.data) return res.data;
    return null;
  }
}));
```

- [ ] **Step 2: 创建 src/renderer/src/stores/settingsStore.ts**

```typescript
import { create } from 'zustand';
import type { ApiResponse } from '../../../shared/types';

interface SettingsState {
  settings: Record<string, any>;
  loading: boolean;
  error: string | null;

  getAll: () => Promise<void>;
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<boolean>;
  delete: (key: string) => Promise<boolean>;
}

function extractError<T>(res: ApiResponse<unknown>): T {
  if (res.success && res.data !== undefined) return res.data as T;
  throw new Error(res.error || '未知错误');
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {},
  loading: false,
  error: null,

  getAll: async () => {
    set({ loading: true, error: null });
    try {
      const res = await window.settingsAPI.getAll();
      const data = extractError<Record<string, any>>(res);
      set({ settings: data, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  get: async (key) => {
    const res = await window.settingsAPI.get(key);
    return extractError<any>(res);
  },

  set: async (key, value) => {
    const res = await window.settingsAPI.set(key, value);
    extractError(res);
    // 更新本地 settings
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
    return true;
  },

  delete: async (key) => {
    const res = await window.settingsAPI.delete(key);
    extractError(res);
    set((s) => {
      const next = { ...s.settings };
      delete next[key];
      return { settings: next };
    });
    return true;
  }
}));
```

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 6: 创建通用弹窗组件（EventEditModal / TeamEditModal / RoundEditModal）

**Files:**
- Create: `src/renderer/src/components/EventEditModal.tsx`
- Create: `src/renderer/src/components/TeamEditModal.tsx`
- Create: `src/renderer/src/components/RoundEditModal.tsx`

**说明：** 三个独立的 Form Modal，分别用于赛事/队伍/轮次的创建与编辑。

- [ ] **Step 1: 创建 src/renderer/src/components/EventEditModal.tsx**

```typescript
import { Modal, Form, Input, DatePicker, Select, message } from 'antd';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import type { Event, EventCreateInput, EventUpdateInput } from '../../shared/types';

const { RangePicker } = DatePicker;
const STATUS_OPTIONS = ['筹备中', '进行中', '已结束'];

export interface EventEditModalProps {
  open: boolean;
  event?: Event | null;
  onOk: (data: EventCreateInput | EventUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
}

export default function EventEditModal({ open, event, onOk, onCancel }: EventEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!event;

  useEffect(() => {
    if (open) {
      if (event) {
        form.setFieldsValue({
          name: event.name,
          dateRange:
            event.start_date && event.end_date
              ? [dayjs(event.start_date), dayjs(event.end_date)]
              : undefined,
          status: event.status ?? '筹备中'
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ status: '筹备中' });
      }
    }
  }, [open, event, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const data: EventCreateInput | EventUpdateInput = {
        name: values.name,
        start_date: values.dateRange?.[0]?.format('YYYY-MM-DD') ?? null,
        end_date: values.dateRange?.[1]?.format('YYYY-MM-DD') ?? null,
        status: values.status
      };
      await onOk(data, isEdit);
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑赛事' : '新建赛事'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="赛事名称"
          rules={[{ required: true, message: '请输入赛事名称' }]}
        >
          <Input placeholder="如：2026 全国大学生辩论赛" />
        </Form.Item>
        <Form.Item name="dateRange" label="赛事日期">
          <RangePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select options={STATUS_OPTIONS.map((v) => ({ label: v, value: v }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: 创建 src/renderer/src/components/TeamEditModal.tsx**

```typescript
import { Modal, Form, Input, message } from 'antd';
import { useEffect } from 'react';
import type { Team, TeamCreateInput, TeamUpdateInput } from '../../shared/types';

export interface TeamEditModalProps {
  open: boolean;
  team?: Team | null;
  eventId: string;
  onOk: (data: TeamCreateInput | TeamUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
}

export default function TeamEditModal({ open, team, eventId, onOk, onCancel }: TeamEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!team;

  useEffect(() => {
    if (open) {
      if (team) {
        form.setFieldsValue({ name: team.name });
      } else {
        form.resetFields();
      }
    }
  }, [open, team, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const data: TeamCreateInput | TeamUpdateInput = isEdit
        ? { name: values.name }
        : { name: values.name, event_id: eventId };
      await onOk(data, isEdit);
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑队伍' : '新建队伍'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="队伍名称"
          rules={[{ required: true, message: '请输入队伍名称' }]}
        >
          <Input placeholder="如：北大辩论队" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 3: 创建 src/renderer/src/components/RoundEditModal.tsx**

```typescript
import { Modal, Form, Input, InputNumber, Select, message } from 'antd';
import { useEffect } from 'react';
import type { Round, RoundCreateInput, RoundUpdateInput } from '../../shared/types';
import { DIFFICULTY_OPTIONS } from './FilterPanel';

export interface RoundEditModalProps {
  open: boolean;
  round?: Round | null;
  eventId: string;
  onOk: (data: RoundCreateInput | RoundUpdateInput, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
}

export default function RoundEditModal({ open, round, eventId, onOk, onCancel }: RoundEditModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!round;

  useEffect(() => {
    if (open) {
      if (round) {
        form.setFieldsValue({
          name: round.name,
          round_number: round.round_number,
          difficulty_override: round.difficulty_override,
          topic_count: round.topic_count
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, round, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const data: RoundCreateInput | RoundUpdateInput = {
        name: values.name,
        round_number: values.round_number,
        difficulty_override: values.difficulty_override,
        topic_count: values.topic_count
      };
      if (!isEdit) (data as RoundCreateInput).event_id = eventId;
      await onOk(data, isEdit);
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑轮次' : '新建轮次'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="轮次名称">
          <Input placeholder="如：小组赛/复赛/决赛" />
        </Form.Item>
        <Form.Item name="round_number" label="轮次序号">
          <InputNumber min={1} style={{ width: '100%' }} placeholder="如：1" />
        </Form.Item>
        <Form.Item name="difficulty_override" label="难度覆盖">
          <Select
            allowClear
            placeholder="不覆盖（使用题库原难度）"
            options={DIFFICULTY_OPTIONS.map((v) => ({ label: v, value: v }))}
          />
        </Form.Item>
        <Form.Item name="topic_count" label="题目数量">
          <InputNumber min={1} max={20} style={{ width: '100%' }} placeholder="如：4" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 4: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 7: 创建 TeamHistoryModal 队伍历史辩题录入弹窗

**Files:**
- Create: `src/renderer/src/components/TeamHistoryModal.tsx`

**说明：** 支持两种录入方式：手动选择辩题（从题库搜索）+ 从历史赛事导入（列出该队参加过的其他赛事的辩题）。

- [ ] **Step 1: 创建 src/renderer/src/components/TeamHistoryModal.tsx**

```typescript
import { Modal, Tabs, Select, Table, Button, Empty, message, Spin } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import type { Team, TeamHistory, Topic } from '../../shared/types';
import { useEventStore } from '../../stores/eventStore';
import { useTopicStore } from '../../stores/topicStore';

export interface TeamHistoryModalProps {
  open: boolean;
  team: Team | null;
  onClose: () => void;
  onRefresh: () => void;
}

export default function TeamHistoryModal({ open, team, onClose, onRefresh }: TeamHistoryModalProps) {
  const eventStore = useEventStore();
  const topicStore = useTopicStore();
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<TeamHistory[]>([]);
  const [topicMap, setTopicMap] = useState<Record<string, Topic>>({});
  // 手动添加：选中的 topicId
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  // 历史赛事候选（除当前赛事外该队参加过的赛事）
  const [importableTopics, setImportableTopics] = useState<Topic[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([]);

  // 拉取该队伍的历史辩题 + 题库候选
  useEffect(() => {
    if (open && team) {
      loadData();
    }
  }, [open, team]);

  const loadData = async () => {
    if (!team) return;
    setLoading(true);
    try {
      const [hist, topics] = await Promise.all([
        window.eventAPI.listTeamHistory(team.id),
        window.topicAPI.list({ page: 1, pageSize: 1000 })
      ]);
      const histData = (hist as any)?.data ?? hist;
      const topicsData = (topics as any)?.data ?? topics;
      const histList: TeamHistory[] = histData.items ?? histData;
      const topicList: Topic[] = topicsData.items ?? topicsData;
      const map: Record<string, Topic> = {};
      topicList.forEach((t) => (map[t.id] = t));
      setHistory(histList);
      setTopicMap(map);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 手动添加一条历史辩题
  const handleAddManual = async () => {
    if (!team || !selectedTopicId) return;
    try {
      await window.eventAPI.addTeamHistory({
        team_id: team.id,
        topic_id: selectedTopicId,
        event_id: team.event_id,
        played_at: new Date().toISOString()
      });
      message.success('已添加');
      setSelectedTopicId(null);
      await loadData();
      onRefresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '添加失败');
    }
  };

  // 删除一条历史辩题
  const handleDelete = async (id: string) => {
    try {
      await window.eventAPI.deleteTeamHistory(id);
      message.success('已删除');
      await loadData();
      onRefresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const columns = [
    {
      title: '辩题',
      dataIndex: 'topic_id',
      render: (id: string) => topicMap[id]?.title ?? id
    },
    {
      title: '录入时间',
      dataIndex: 'played_at',
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '-')
    },
    {
      title: '操作',
      dataIndex: 'id',
      width: 80,
      render: (id: string) => (
        <Button size="small" danger onClick={() => handleDelete(id)}>
          删除
        </Button>
      )
    }
  ];

  return (
    <Modal
      title={team ? `队伍历史辩题 - ${team.name}` : '队伍历史辩题'}
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={720}
      destroyOnClose
    >
      <Spin spinning={loading}>
        <Tabs
          items={[
            {
              key: 'list',
              label: '已录入历史',
              children:
                history.length === 0 ? (
                  <Empty description="暂无历史辩题" />
                ) : (
                  <Table
                    size="small"
                    rowKey="id"
                    columns={columns}
                    dataSource={history}
                    pagination={false}
                  />
                )
            },
            {
              key: 'add',
              label: '手动添加',
              children: (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Select
                    showSearch
                    placeholder="搜索辩题标题"
                    style={{ flex: 1 }}
                    value={selectedTopicId}
                    onChange={setSelectedTopicId}
                    filterOption={false}
                    options={Object.values(topicMap).map((t) => ({
                      label: t.title,
                      value: t.id
                    }))}
                  />
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    disabled={!selectedTopicId}
                    onClick={handleAddManual}
                  >
                    添加
                  </Button>
                </div>
              )
            }
          ]}
        />
      </Spin>
    </Modal>
  );
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 8: 创建 ImportTopicsModal 导入辩题弹窗

**Files:**
- Create: `src/renderer/src/components/ImportTopicsModal.tsx`

**说明：** 实现"选择文件 → 自动解析 → 预览映射 → 确认导入 → 结果报告"五步流程。文件选择用 electron dialog（通过 window.electron?.ipcRenderer 或专门 IPC 通道）。简化实现：通过 `window.electron.ipcRenderer.invoke('dialog:openFile')` 触发主进程弹窗。如果该通道未注册，退化为 `<input type="file">`。

实际为简化集成，使用 `<input type="file">` + `file.path`（Electron 中文件 input 元素自带 path 属性）调用 `importAPI.parseFile`。

- [ ] **Step 1: 创建 src/renderer/src/components/ImportTopicsModal.tsx**

```typescript
import { Modal, Button, Steps, Upload, Table, Alert, message, Result, Spin } from 'antd';
import { useState } from 'react';
import { InboxOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import type { ParsedResult } from '../../shared/types';

const { Dragger } = Upload;

type Step = 0 | 1 | 2 | 3;
type FileType = 'xlsx' | 'csv' | 'docx';

function detectFileType(name: string): FileType | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.docx')) return 'docx';
  return null;
}

export interface ImportTopicsModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

export default function ImportTopicsModal({ open, onClose, onImported }: ImportTopicsModalProps) {
  const [step, setStep] = useState<Step>(0);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    duplicates: number;
    failed: number;
  } | null>(null);

  const reset = () => {
    setStep(0);
    setParsed(null);
    setFilePath(null);
    setImporting(false);
    setImportResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // 处理文件选择
  const handleFile = async (file: File) => {
    const fileType = detectFileType(file.name);
    if (!fileType) {
      message.error('不支持的文件格式，仅支持 .xlsx / .csv / .docx');
      return;
    }

    // Electron 中 input 文件对象的 path 属性是绝对路径
    const absPath = (file as any).path as string | undefined;
    if (!absPath) {
      message.error('无法获取文件路径，请在 Electron 环境中运行');
      return;
    }

    setParsing(true);
    try {
      const res = await window.importAPI.parseFile(absPath, fileType);
      if (res.success && res.data) {
        setParsed(res.data);
        setFilePath(absPath);
        setStep(1);
      } else {
        message.error(res.error || '解析失败');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '解析失败');
    } finally {
      setParsing(false);
    }
  };

  // 执行导入
  const handleImport = async () => {
    if (!parsed || parsed.topics.length === 0) return;
    setImporting(true);
    setStep(2);
    try {
      const res = await window.importAPI.execute({
        topics: parsed.topics,
        checkDuplicates: true
      });
      if (res.success && res.data) {
        setImportResult(res.data);
        setStep(3);
        onImported?.();
      } else {
        message.error(res.error || '导入失败');
        setStep(1);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败');
      setStep(1);
    } finally {
      setImporting(false);
    }
  };

  const previewColumns = [
    { title: '#', width: 50, render: (_: any, __: any, i: number) => i + 1 },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '类型', dataIndex: 'type', width: 100 },
    { title: '领域', dataIndex: 'domain', width: 100 },
    { title: '难度', dataIndex: 'difficulty', width: 80 },
    { title: '来源', dataIndex: 'source', width: 100 }
  ];

  return (
    <Modal
      title="导入辩题"
      open={open}
      onCancel={handleClose}
      width={860}
      footer={null}
      destroyOnClose
    >
      <Steps
        size="small"
        current={step}
        items={[
          { title: '选择文件' },
          { title: '预览映射' },
          { title: '导入中' },
          { title: '完成' }
        ]}
        style={{ marginBottom: 24 }}
      />

      {step === 0 && (
        <Spin spinning={parsing}>
          <Dragger
            accept=".xlsx,.csv,.docx"
            multiple={false}
            showUploadList={false}
            beforeUpload={(file) => {
              handleFile(file);
              return false; // 阻止自动上传
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此处</p>
            <p className="ant-upload-hint">支持 .xlsx / .csv / .docx 格式</p>
          </Dragger>
        </Spin>
      )}

      {step === 1 && parsed && (
        <>
          {parsed.warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message="解析警告"
              description={
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {parsed.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              }
              style={{ marginBottom: 12 }}
            />
          )}
          <Alert
            type="info"
            message={`解析到 ${parsed.topics.length} 条辩题，字段映射：${
              Object.keys(parsed.mapping).length > 0
                ? Object.entries(parsed.mapping)
                    .map(([k, v]) => `${k}→${v}`)
                    .join('，')
                : '默认映射'
            }`}
            style={{ marginBottom: 12 }}
          />
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            columns={previewColumns}
            dataSource={parsed.topics.slice(0, 50)}
            pagination={false}
            scroll={{ y: 320 }}
            style={{ marginBottom: 12 }}
          />
          {parsed.topics.length > 50 && (
            <Alert
              type="info"
              message={`仅预览前 50 条，共 ${parsed.topics.length} 条`}
              style={{ marginBottom: 12 }}
            />
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={reset}>重新选择</Button>
            <Button
              type="primary"
              disabled={parsed.topics.length === 0}
              onClick={handleImport}
            >
              确认导入 {parsed.topics.length} 条
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
          <p style={{ marginTop: 16 }}>正在导入，请稍候...</p>
        </div>
      )}

      {step === 3 && importResult && (
        <Result
          icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
          title="导入完成"
          subTitle={
            <span>
              成功导入 <b style={{ color: '#52c41a' }}>{importResult.imported}</b> 条，
              重复 <b style={{ color: '#faad14' }}>{importResult.duplicates}</b> 条，
              失败 <b style={{ color: '#ff4d4f' }}>{importResult.failed}</b> 条
            </span>
          }
          extra={[
            <Button key="again" onClick={reset}>
              继续导入
            </Button>,
            <Button key="close" type="primary" onClick={handleClose}>
              关闭
            </Button>
          ]
          }
        />
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 9: 创建 DedupResultModal 去重检查结果展示弹窗

**Files:**
- Create: `src/renderer/src/components/DedupResultModal.tsx`

**说明：** 调用 `importAPI.findDuplicates(topics, options)` 对全量辩题做去重检测，分组展示，支持勾选删除。

- [ ] **Step 1: 创建 src/renderer/src/components/DedupResultModal.tsx**

```typescript
import { Modal, Button, Spin, Empty, Tag, Checkbox, Space, message, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { DeleteOutlined } from '@ant-design/icons';
import type { Topic, DuplicateGroup } from '../../shared/types';

const { Text } = Typography;

export interface DedupResultModalProps {
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

const REASON_LABEL: Record<string, string> = {
  exact: '完全相同',
  levenshtein: '高相似',
  keyword: '关键词重合',
  ai: 'AI 语义'
};

const REASON_COLOR: Record<string, string> = {
  exact: 'red',
  levenshtein: 'orange',
  keyword: 'gold',
  ai: 'purple'
};

export default function DedupResultModal({ open, onClose, onDeleted }: DedupResultModalProps) {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  // 待删除的 topic id 集合
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      runDedup();
    }
  }, [open]);

  const runDedup = async () => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      // 拉取全量辩题
      const res = await window.topicAPI.list({ page: 1, pageSize: 100000 });
      if (!res.success || !res.data) {
        message.error(res.error || '拉取题库失败');
        return;
      }
      const topics = (res.data as any).items ?? res.data;
      if (topics.length < 2) {
        setGroups([]);
        return;
      }
      const dupRes = await window.importAPI.findDuplicates(topics, {
        levenshteinThreshold: 5,
        keywordThreshold: 0.8
      });
      if (dupRes.success && dupRes.data) {
        setGroups(dupRes.data);
      } else {
        message.error(dupRes.error || '去重检测失败');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '去重检测失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    Modal.confirm({
      title: `确认删除 ${selectedIds.size} 条重复辩题？`,
      content: '删除后不可恢复',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.topicAPI.batchDelete(Array.from(selectedIds));
          message.success(`已删除 ${selectedIds.size} 条`);
          setSelectedIds(new Set());
          onDeleted?.();
          await runDedup();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
        }
      }
    });
  };

  return (
    <Modal
      title="去重检查结果"
      open={open}
      onCancel={onClose}
      width={860}
      footer={[
        <Button key="refresh" onClick={runDedup} disabled={loading}>
          重新检测
        </Button>,
        <Button
          key="delete"
          type="primary"
          danger
          icon={<DeleteOutlined />}
          disabled={selectedIds.size === 0}
          onClick={handleBatchDelete}
        >
          删除选中 ({selectedIds.size})
        </Button>,
        <Button key="close" onClick={onClose}>
          关闭
        </Button>
      ]}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {groups.length === 0 ? (
          <Empty description={loading ? '检测中...' : '未发现重复辩题'} />
        ) : (
          <>
            <Alert
              type="info"
              message={`共发现 ${groups.length} 组相似辩题`}
              style={{ marginBottom: 12 }}
            />
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {groups.map((g, idx) => (
                <div
                  key={g.id}
                  style={{
                    border: '1px solid #d9d9d9',
                    borderRadius: 6,
                    padding: 12,
                    background: '#fafafa'
                  }}
                >
                  <Space style={{ marginBottom: 8 }}>
                    <Text strong>第 {idx + 1} 组</Text>
                    <Tag color={REASON_COLOR[g.reason]}>{REASON_LABEL[g.reason]}</Tag>
                    <Text type="secondary">相似度：{(g.similarity * 100).toFixed(0)}%</Text>
                  </Space>
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    {g.topics.map((t) => (
                      <div
                        key={t.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      >
                        <Checkbox
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                        />
                        <Text>{t.title}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          ({t.source_type})
                        </Text>
                      </div>
                    ))}
                  </Space>
                </div>
              ))}
            </Space>
          </>
        )}
      </Spin>
    </Modal>
  );
}

// Alert 是 antd 组件，需要在文件顶部 import
import { Alert } from 'antd';
```

注意：上面的 import 语句应该放在文件顶部，这里仅为提示。实际写入时把 `import { Alert } from 'antd';` 加入顶部 import 列表：

```typescript
import { Modal, Button, Spin, Empty, Tag, Checkbox, Space, message, Typography, Alert } from 'antd';
```

并删除文件末尾的 `import { Alert } from 'antd';`。

- [ ] **Step 2: 修正 import（实际写入时执行）**

将顶部 import 改为：

```typescript
import { Modal, Button, Spin, Empty, Tag, Checkbox, Space, message, Typography, Alert } from 'antd';
```

删除文件末尾的 `import { Alert } from 'antd';`。

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 10: 重写 EventManage 页面

**Files:**
- Modify: `src/renderer/src/pages/EventManage.tsx`

**说明：** 实现赛事列表（CRUD）+ 抽屉式赛事详情（含队伍管理、轮次设置、难度梯度预设、跳转抽取按钮）。

- [ ] **Step 1: 重写 src/renderer/src/pages/EventManage.tsx**

```typescript
import { useEffect, useState } from 'react';
import {
  Layout, Table, Button, Space, Tag, Modal, message, Drawer, Tabs, Typography,
  Empty, List, InputNumber, theme, Popconfirm
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  TeamOutlined, TrophyOutlined, ThunderboltOutlined, SettingOutlined,
  CaretRightOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '../stores/eventStore';
import type { Event, Round, Team, EventCreateInput, EventUpdateInput, RoundCreateInput, RoundUpdateInput, TeamCreateInput, TeamUpdateInput } from '../../../shared/types';
import EventEditModal from '../components/EventEditModal';
import TeamEditModal from '../components/TeamEditModal';
import RoundEditModal from '../components/RoundEditModal';
import TeamHistoryModal from '../components/TeamHistoryModal';

const { Content } = Layout;
const { Text, Title } = Typography;

const STATUS_COLOR: Record<string, string> = {
  筹备中: 'default',
  进行中: 'processing',
  已结束: 'success'
};

// 难度梯度预设：分组赛→复赛→决赛
const DIFFICULTY_PRESET = [
  { name: '小组赛', round_number: 1, difficulty_override: '入门', topic_count: 4 },
  { name: '复赛', round_number: 2, difficulty_override: '中级', topic_count: 4 },
  { name: '决赛', round_number: 3, difficulty_override: '高级', topic_count: 4 }
];

export default function EventManage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const eventStore = useEventStore();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<Event | null>(null);

  // 队伍/轮次编辑弹窗
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [roundModalOpen, setRoundModalOpen] = useState(false);
  const [editingRound, setEditingRound] = useState<Round | null>(null);

  // 队伍历史弹窗
  const [historyTeam, setHistoryTeam] = useState<Team | null>(null);

  useEffect(() => {
    eventStore.listEvents();
  }, []);

  // 打开抽屉时拉取轮次和队伍
  useEffect(() => {
    if (currentEvent) {
      eventStore.listRoundsByEvent(currentEvent.id);
      eventStore.listTeamsByEvent(currentEvent.id);
    }
  }, [currentEvent]);

  const handleCreate = () => {
    setEditingEvent(null);
    setEditModalOpen(true);
  };

  const handleEdit = (event: Event) => {
    setEditingEvent(event);
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (data: EventCreateInput | EventUpdateInput, isEdit: boolean) => {
    try {
      if (isEdit && editingEvent) {
        await eventStore.updateEvent(editingEvent.id, data as EventUpdateInput);
        message.success('已更新');
      } else {
        await eventStore.createEvent(data as EventCreateInput);
        message.success('已创建');
      }
      setEditModalOpen(false);
      await eventStore.listEvents();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '失败');
    }
  };

  const handleDelete = (event: Event) => {
    Modal.confirm({
      title: `确认删除赛事"${event.name}"？`,
      content: '关联的轮次、队伍、抽取记录将一并删除',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await eventStore.deleteEvent(event.id);
        message.success('已删除');
        await eventStore.listEvents();
      }
    });
  };

  const handleOpenDrawer = (event: Event) => {
    setCurrentEvent(event);
    setDrawerOpen(true);
  };

  const handleJumpToDraw = (event: Event, round?: Round) => {
    navigate('/draw', {
      state: { eventId: event.id, roundId: round?.id ?? null }
    });
  };

  // 队伍管理
  const handleCreateTeam = () => {
    setEditingTeam(null);
    setTeamModalOpen(true);
  };
  const handleEditTeam = (team: Team) => {
    setEditingTeam(team);
    setTeamModalOpen(true);
  };
  const handleTeamSubmit = async (data: TeamCreateInput | TeamUpdateInput, isEdit: boolean) => {
    if (!currentEvent) return;
    try {
      if (isEdit && editingTeam) {
        await eventStore.updateTeam(editingTeam.id, data as TeamUpdateInput);
        message.success('已更新');
      } else {
        await eventStore.createTeam(data as TeamCreateInput);
        message.success('已创建');
      }
      setTeamModalOpen(false);
      await eventStore.listTeamsByEvent(currentEvent.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '失败');
    }
  };
  const handleDeleteTeam = async (team: Team) => {
    await eventStore.deleteTeam(team.id);
    message.success('已删除');
    if (currentEvent) await eventStore.listTeamsByEvent(currentEvent.id);
  };

  // 轮次管理
  const handleCreateRound = () => {
    setEditingRound(null);
    setRoundModalOpen(true);
  };
  const handleEditRound = (round: Round) => {
    setEditingRound(round);
    setRoundModalOpen(true);
  };
  const handleRoundSubmit = async (data: RoundCreateInput | RoundUpdateInput, isEdit: boolean) => {
    if (!currentEvent) return;
    try {
      if (isEdit && editingRound) {
        await eventStore.updateRound(editingRound.id, data as RoundUpdateInput);
        message.success('已更新');
      } else {
        await eventStore.createRound({ ...(data as RoundCreateInput), event_id: currentEvent.id });
        message.success('已创建');
      }
      setRoundModalOpen(false);
      await eventStore.listRoundsByEvent(currentEvent.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '失败');
    }
  };
  const handleDeleteRound = async (round: Round) => {
    await eventStore.deleteRound(round.id);
    message.success('已删除');
    if (currentEvent) await eventStore.listRoundsByEvent(currentEvent.id);
  };

  // 一键应用难度梯度预设
  const handleApplyPreset = async () => {
    if (!currentEvent) return;
    Modal.confirm({
      title: '应用难度梯度预设？',
      content: '将创建"小组赛/复赛/决赛"3 个轮次，难度依次为入门/中级/高级。如果已有同序号轮次，将跳过。',
      okText: '应用',
      cancelText: '取消',
      onOk: async () => {
        const existing = eventStore.rounds;
        let created = 0;
        for (const p of DIFFICULTY_PRESET) {
          if (existing.some((r) => r.round_number === p.round_number)) continue;
          await eventStore.createRound({
            event_id: currentEvent.id,
            name: p.name,
            round_number: p.round_number,
            difficulty_override: p.difficulty_override,
            topic_count: p.topic_count
          });
          created++;
        }
        message.success(`已创建 ${created} 个轮次`);
        await eventStore.listRoundsByEvent(currentEvent.id);
      }
    });
  };

  // ====== 赛事列表表格 ======
  const eventColumns = [
    { title: '赛事名称', dataIndex: 'name', key: 'name' },
    {
      title: '日期',
      key: 'date',
      render: (_: any, e: Event) =>
        e.start_date && e.end_date ? `${e.start_date} ~ ${e.end_date}` : '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string | null) => (s ? <Tag color={STATUS_COLOR[s]}>{s}</Tag> : '-')
    },
    {
      title: '操作',
      key: 'action',
      width: 320,
      render: (_: any, e: Event) => (
        <Space>
          <Button size="small" icon={<SettingOutlined />} onClick={() => handleOpenDrawer(e)}>
            详情
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => handleJumpToDraw(e)}
          >
            前往抽取
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(e)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(e)} />
        </Space>
      )
    }
  ];

  // ====== 抽屉内容（Tabs）======
  const teamColumns = [
    { title: '队伍名称', dataIndex: 'name', key: 'name' },
    {
      title: '操作',
      key: 'action',
      width: 240,
      render: (_: any, t: Team) => (
        <Space>
          <Button size="small" icon={<TeamOutlined />} onClick={() => setHistoryTeam(t)}>
            历史辩题
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEditTeam(t)} />
          <Popconfirm
            title="删除该队伍？"
            onConfirm={() => handleDeleteTeam(t)}
            okText="删除"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  const roundColumns = [
    { title: '序号', dataIndex: 'round_number', key: 'round_number', width: 60 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '难度覆盖',
      dataIndex: 'difficulty_override',
      key: 'difficulty_override',
      render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : '-')
    },
    { title: '题目数量', dataIndex: 'topic_count', key: 'topic_count', width: 100 },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: any, r: Round) => (
        <Space>
          <Button
            size="small"
            type="primary"
            icon={<CaretRightOutlined />}
            onClick={() => currentEvent && handleJumpToDraw(currentEvent, r)}
          >
            抽取
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEditRound(r)} />
          <Popconfirm
            title="删除该轮次？"
            onConfirm={() => handleDeleteRound(r)}
            okText="删除"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      <Content style={{ padding: 16, background: 'transparent', overflow: 'auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            padding: 12,
            background: token.colorBgContainer,
            borderRadius: 8,
            border: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          <Title level={5} style={{ margin: 0 }}>
            <TrophyOutlined style={{ marginRight: 8 }} />
            赛事管理
          </Title>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => eventStore.listEvents()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新建赛事
            </Button>
          </Space>
        </div>

        <Table
          rowKey="id"
          columns={eventColumns}
          dataSource={eventStore.events}
          loading={eventStore.loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="暂无赛事，请先创建" /> }}
        />
      </Content>

      {/* 赛事新增/编辑弹窗 */}
      <EventEditModal
        open={editModalOpen}
        event={editingEvent}
        onOk={handleEditSubmit}
        onCancel={() => setEditModalOpen(false)}
      />

      {/* 赛事详情抽屉 */}
      <Drawer
        title={currentEvent ? `赛事详情 - ${currentEvent.name}` : '赛事详情'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={720}
      >
        {currentEvent && (
          <Tabs
            items={[
              {
                key: 'rounds',
                label: `轮次 (${eventStore.rounds.length})`,
                children: (
                  <>
                    <Space style={{ marginBottom: 12 }}>
                      <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateRound}>
                        新建轮次
                      </Button>
                      <Button onClick={handleApplyPreset}>一键应用难度梯度预设</Button>
                    </Space>
                    <Table
                      size="small"
                      rowKey="id"
                      columns={roundColumns}
                      dataSource={eventStore.rounds}
                      pagination={false}
                    />
                  </>
                )
              },
              {
                key: 'teams',
                label: `队伍 (${eventStore.teams.length})`,
                children: (
                  <>
                    <Space style={{ marginBottom: 12 }}>
                      <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateTeam}>
                        新建队伍
                      </Button>
                    </Space>
                    <Table
                      size="small"
                      rowKey="id"
                      columns={teamColumns}
                      dataSource={eventStore.teams}
                      pagination={false}
                    />
                  </>
                )
              },
              {
                key: 'info',
                label: '基本信息',
                children: (
                  <List
                    size="small"
                    itemLayout="horizontal"
                    dataSource={[
                      { label: '赛事名称', value: currentEvent.name },
                      { label: '开始日期', value: currentEvent.start_date ?? '-' },
                      { label: '结束日期', value: currentEvent.end_date ?? '-' },
                      { label: '状态', value: currentEvent.status ?? '-' },
                      { label: '创建时间', value: currentEvent.created_at ?? '-' }
                    ]}
                    renderItem={(item) => (
                      <List.Item>
                        <Text type="secondary" style={{ width: 120 }}>
                          {item.label}
                        </Text>
                        <Text strong>{item.value}</Text>
                      </List.Item>
                    )}
                  />
                )
              }
            ]}
          />
        )}
      </Drawer>

      {/* 队伍新增/编辑弹窗 */}
      <TeamEditModal
        open={teamModalOpen}
        team={editingTeam}
        eventId={currentEvent?.id ?? ''}
        onOk={handleTeamSubmit}
        onCancel={() => setTeamModalOpen(false)}
      />

      {/* 轮次新增/编辑弹窗 */}
      <RoundEditModal
        open={roundModalOpen}
        round={editingRound}
        eventId={currentEvent?.id ?? ''}
        onOk={handleRoundSubmit}
        onCancel={() => setRoundModalOpen(false)}
      />

      {/* 队伍历史辩题弹窗 */}
      <TeamHistoryModal
        open={!!historyTeam}
        team={historyTeam}
        onClose={() => setHistoryTeam(null)}
        onRefresh={() => {
          /* 弹窗内部已自刷新 */
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 11: 重写 TeamManage 页面

**Files:**
- Modify: `src/renderer/src/pages/TeamManage.tsx`

**说明：** 跨赛事全队伍总览。左侧赛事选择树，右侧该赛事所有队伍列表 + 队伍历史辩题录入入口。

- [ ] **Step 1: 重写 src/renderer/src/pages/TeamManage.tsx**

```typescript
import { useEffect, useState } from 'react';
import {
  Layout, Tree, Table, Button, Space, Tag, Empty, Typography, Spin, message, theme
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, TeamOutlined, HistoryOutlined, TrophyOutlined
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import { useEventStore } from '../stores/eventStore';
import type { Event, Team, TeamCreateInput } from '../../../shared/types';
import TeamEditModal from '../components/TeamEditModal';
import TeamHistoryModal from '../components/TeamHistoryModal';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function TeamManage() {
  const { token } = theme.useToken();
  const eventStore = useEventStore();

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [historyTeam, setHistoryTeam] = useState<Team | null>(null);

  useEffect(() => {
    eventStore.listEvents();
  }, []);

  // 选中赛事变化时拉取该赛事队伍
  useEffect(() => {
    if (selectedEventId) {
      const ev = eventStore.events.find((e) => e.id === selectedEventId);
      setSelectedEvent(ev ?? null);
      eventStore.listTeamsByEvent(selectedEventId);
    } else {
      setSelectedEvent(null);
    }
  }, [selectedEventId, eventStore.events]);

  const handleCreateTeam = () => {
    if (!selectedEventId) {
      message.warning('请先选择赛事');
      return;
    }
    setTeamModalOpen(true);
  };

  const handleTeamSubmit = async (data: TeamCreateInput | any, isEdit: boolean) => {
    if (!selectedEventId) return;
    try {
      if (isEdit) {
        // 编辑由父组件传 team，这里简化处理
      } else {
        await eventStore.createTeam(data as TeamCreateInput);
        message.success('已创建');
      }
      setTeamModalOpen(false);
      await eventStore.listTeamsByEvent(selectedEventId);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '失败');
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    await eventStore.deleteTeam(team.id);
    message.success('已删除');
    if (selectedEventId) await eventStore.listTeamsByEvent(selectedEventId);
  };

  // 左侧赛事树
  const treeData: DataNode[] = [
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
            <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
              {e.status ?? ''}
            </Text>
          </span>
        )
      }))
    }
  ];

  const columns = [
    {
      title: '队伍名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <Space>
          <TeamOutlined />
          <Text strong>{name}</Text>
        </Space>
      )
    },
    {
      title: '所属赛事',
      key: 'event',
      render: (_: any, t: Team) => {
        const ev = eventStore.events.find((e) => e.id === t.event_id);
        return ev ? <Tag color="blue">{ev.name}</Tag> : '-';
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, t: Team) => (
        <Space>
          <Button
            size="small"
            icon={<HistoryOutlined />}
            onClick={() => setHistoryTeam(t)}
          >
            历史辩题
          </Button>
          <Button
            size="small"
            danger
            onClick={() =>
              message.warning('删除队伍请在所属赛事详情中操作')
            }
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <>
      <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 64px)' }}>
        <Sider
          width={260}
          theme="light"
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            padding: 12,
            overflow: 'auto'
          }}
        >
          <Title level={5} style={{ marginTop: 0 }}>
            <TrophyOutlined /> 赛事列表
          </Title>
          <Spin spinning={eventStore.loading}>
            <Tree
              treeData={treeData}
              defaultExpandAll
              onSelect={(keys) => {
                const k = keys[0] as string | undefined;
                setSelectedEventId(k ?? null);
              }}
              selectedKeys={selectedEventId ? [selectedEventId] : []}
            />
          </Spin>
        </Sider>

        <Content style={{ padding: '0 16px 16px', overflow: 'auto' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              padding: 12,
              background: token.colorBgContainer,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`
            }}
          >
            <Title level={5} style={{ margin: 0 }}>
              <TeamOutlined /> 队伍管理
              {selectedEvent && (
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>
                  - {selectedEvent.name}
                </Text>
              )}
            </Title>
            <Space>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => selectedEventId && eventStore.listTeamsByEvent(selectedEventId)}
                disabled={!selectedEventId}
              >
                刷新
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreateTeam}
                disabled={!selectedEventId}
              >
                新建队伍
              </Button>
            </Space>
          </div>

          {!selectedEventId ? (
            <Empty description="请从左侧选择赛事" style={{ marginTop: 80 }} />
          ) : (
            <Table
              rowKey="id"
              size="middle"
              columns={columns}
              dataSource={eventStore.teams}
              pagination={false}
            />
          )}
        </Content>
      </Layout>

      <TeamEditModal
        open={teamModalOpen}
        team={null}
        eventId={selectedEventId ?? ''}
        onOk={handleTeamSubmit}
        onCancel={() => setTeamModalOpen(false)}
      />

      <TeamHistoryModal
        open={!!historyTeam}
        team={historyTeam}
        onClose={() => setHistoryTeam(null)}
        onRefresh={() => {
          /* 内部已自刷新 */
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 12: 重写 History 页面

**Files:**
- Modify: `src/renderer/src/pages/History.tsx`

**说明：** 双 Tab：抽取记录 + 操作日志。每个 Tab 都有筛选+表格+导出按钮。

- [ ] **Step 1: 重写 src/renderer/src/pages/History.tsx**

```typescript
import { useEffect, useState } from 'react';
import {
  Layout, Tabs, Table, Button, Space, Select, DatePicker, Input, Tag,
  message, Typography, Card, theme, Empty
} from 'antd';
import {
  ReloadOutlined, DownloadOutlined, HistoryOutlined, AuditOutlined,
  SearchOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useDrawStore, useAuditStore, useEventStore } from '../stores/drawStore'; // 修正下面
import type { DrawSession, AuditLog, SessionFilter, AuditLogFilter } from '../../../shared/types';

const { Content } = Layout;
const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

export default function History() {
  const { token } = theme.useToken();
  // 注意：useDrawStore 和 useAuditStore 来自不同文件
  const drawStore = useDrawStoreFromImport();
  const auditStore = useAuditStoreFromImport();
  const eventStore = useEventStoreFromImport();

  // 抽取记录筛选
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>({});
  // 操作日志筛选
  const [auditFilter, setAuditFilter] = useState<AuditLogFilter>({});
  const [activeTab, setActiveTab] = useState<'sessions' | 'logs'>('sessions');

  useEffect(() => {
    eventStore.listEvents();
  }, []);

  useEffect(() => {
    if (activeTab === 'sessions') {
      drawStore.listSessions(sessionFilter);
    } else {
      auditStore.listLogs(auditFilter);
    }
  }, [activeTab, sessionFilter, auditFilter]);

  // 导出
  const handleExportSessions = async (format: 'xlsx' | 'csv' | 'json') => {
    try {
      const res = await window.exportAPI.exportDrawSessions({
        filter: sessionFilter,
        format
      });
      if (res.success && res.data) {
        message.success(`已导出 ${res.data.count} 条到：${res.data.filePath}`);
      } else {
        message.error(res.error || '导出失败');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  const handleExportLogs = async (format: 'csv' | 'json') => {
    try {
      const res = await window.auditAPI.exportLogs({
        filter: auditFilter,
        format
      });
      if (res.success && res.data) {
        message.success(`已导出 ${res.data.count} 条到：${res.data.filePath}`);
      } else {
        message.error(res.error || '导出失败');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  // 抽取记录表格列
  const sessionColumns = [
    {
      title: '抽取时间',
      dataIndex: 'draw_time',
      key: 'draw_time',
      width: 180,
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '-')
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      width: 100
    },
    {
      title: '所属赛事',
      key: 'event',
      render: (_: any, s: DrawSession) => {
        const ev = eventStore.events.find((e) => e.id === s.event_id);
        return ev ? <Tag color="blue">{ev.name}</Tag> : s.event_id;
      }
    },
    {
      title: '轮次',
      key: 'round',
      render: (_: any, s: DrawSession) => (s.round_id ? <Tag>{s.round_id}</Tag> : '-')
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, s: DrawSession) => (
        <Button
          size="small"
          onClick={async () => {
            const detail = await drawStore.getSession(s.id);
            if (detail) {
              Modal.info({
                title: '抽取详情',
                width: 720,
                content: (
                  <div>
                    {detail.items.map((item, i) => (
                      <div key={item.id} style={{ marginBottom: 8 }}>
                        <Text strong>{i + 1}. </Text>
                        <Text>{item.topic_id}</Text>
                        {item.team_a_id && (
                          <Tag style={{ marginLeft: 8 }}>
                            A: {item.team_a_id} ({item.stance_a ?? ''})
                          </Tag>
                        )}
                        {item.team_b_id && (
                          <Tag>
                            B: {item.team_b_id} ({item.stance_b ?? ''})
                          </Tag>
                        )}
                      </div>
                    ))}
                  </div>
                )
              });
            }
          }}
        >
          查看详情
        </Button>
      )
    }
  ];

  // 操作日志表格列
  const logColumns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '-')
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      width: 120,
      render: (a: string | null) => (a ? <Tag color="blue">{a}</Tag> : '-')
    },
    {
      title: '目标类型',
      dataIndex: 'target_type',
      key: 'target_type',
      width: 100
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      width: 100
    },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      ellipsis: true,
      render: (d: any) => (d ? JSON.stringify(d) : '-')
    }
  ];

  return (
    <Content style={{ padding: 16, background: 'transparent', overflow: 'auto' }}>
      <Card style={{ marginBottom: 12 }}>
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'sessions' | 'logs')}
          items={[
            {
              key: 'sessions',
              label: (
                <span>
                  <HistoryOutlined /> 抽取记录
                </span>
              ),
              children: (
                <>
                  <Space style={{ marginBottom: 12 }} wrap>
                    <Select
                      allowClear
                      placeholder="按赛事筛选"
                      style={{ width: 200 }}
                      value={sessionFilter.event_id}
                      onChange={(v) =>
                        setSessionFilter({ ...sessionFilter, event_id: v })
                      }
                      options={eventStore.events.map((e) => ({
                        label: e.name,
                        value: e.id
                      }))}
                    />
                    <RangePicker
                      onChange={(dates) => {
                        if (dates && dates[0] && dates[1]) {
                          setSessionFilter({
                            ...sessionFilter,
                            startTime: dates[0].toISOString(),
                            endTime: dates[1].toISOString()
                          });
                        } else {
                          const { startTime, endTime, ...rest } = sessionFilter;
                          setSessionFilter(rest);
                        }
                      }}
                    />
                    <Button
                      icon={<DownloadOutlined />}
                      onClick={() => handleExportSessions('xlsx')}
                    >
                      导出 Excel
                    </Button>
                    <Button onClick={() => handleExportSessions('csv')}>导出 CSV</Button>
                  </Space>
                  <Table
                    rowKey="id"
                    size="middle"
                    columns={sessionColumns}
                    dataSource={drawStore.sessions}
                    loading={drawStore.loading}
                    pagination={{
                      current: (sessionFilter.page ?? 1),
                      pageSize: (sessionFilter.pageSize ?? 20),
                      total: drawStore.total,
                      onChange: (page, pageSize) =>
                        setSessionFilter({ ...sessionFilter, page, pageSize })
                    }}
                    locale={{ emptyText: <Empty description="暂无抽取记录" /> }}
                  />
                </>
              )
            },
            {
              key: 'logs',
              label: (
                <span>
                  <AuditOutlined /> 操作日志
                </span>
              ),
              children: (
                <>
                  <Space style={{ marginBottom: 12 }} wrap>
                    <Select
                      allowClear
                      placeholder="按操作类型筛选"
                      style={{ width: 160 }}
                      value={auditFilter.action}
                      onChange={(v) => setAuditFilter({ ...auditFilter, action: v })}
                      options={[
                        'system', 'draw', 'redraw', 'create', 'update', 'delete',
                        'import', 'export', 'settings'
                      ].map((v) => ({ label: v, value: v }))}
                    />
                    <Select
                      allowClear
                      placeholder="按目标类型筛选"
                      style={{ width: 160 }}
                      value={auditFilter.target_type}
                      onChange={(v) => setAuditFilter({ ...auditFilter, target_type: v })}
                      options={['topic', 'event', 'round', 'team', 'session', 'system'].map((v) => ({
                        label: v,
                        value: v
                      }))}
                    />
                    <RangePicker
                      onChange={(dates) => {
                        if (dates && dates[0] && dates[1]) {
                          setAuditFilter({
                            ...auditFilter,
                            startTime: dates[0].toISOString(),
                            endTime: dates[1].toISOString()
                          });
                        } else {
                          const { startTime, endTime, ...rest } = auditFilter;
                          setAuditFilter(rest);
                        }
                      }}
                    />
                    <Button
                      icon={<DownloadOutlined />}
                      onClick={() => handleExportLogs('csv')}
                    >
                      导出 CSV
                    </Button>
                    <Button onClick={() => handleExportLogs('json')}>导出 JSON</Button>
                  </Space>
                  <Table
                    rowKey="id"
                    size="middle"
                    columns={logColumns}
                    dataSource={auditStore.logs}
                    loading={auditStore.loading}
                    pagination={{
                      current: (auditFilter.page ?? 1),
                      pageSize: (auditFilter.pageSize ?? 20),
                      total: auditStore.total,
                      onChange: (page, pageSize) =>
                        setAuditFilter({ ...auditFilter, page, pageSize })
                    }}
                  />
                </>
              )
            }
          ]}
        />
      </Card>
    </Content>
  );
}

// 修正导入：实际写入时把下面这些辅助函数去掉，改为正确的 import
// 实际 import 应该是：
// import { useDrawStore } from '../stores/drawStore';
// import { useAuditStore } from '../stores/auditStore';
// import { useEventStore } from '../stores/eventStore';
// import { Modal } from 'antd';
// 然后直接用 useDrawStore()、useAuditStore()、useEventStore()
```

注意：上面的代码中 `useDrawStoreFromImport`、`useAuditStoreFromImport`、`useEventStoreFromImport` 是占位，实际写入时需要：
1. 顶部 import 改为：
   ```typescript
   import { Modal } from 'antd';
   import { useDrawStore } from '../stores/drawStore';
   import { useAuditStore } from '../stores/auditStore';
   import { useEventStore } from '../stores/eventStore';
   ```
2. 删除底部辅助函数
3. 把 `const drawStore = useDrawStoreFromImport();` 改为 `const drawStore = useDrawStore();` 等

- [ ] **Step 2: 实际写入时按上述修正 import**

修正后顶部 import：

```typescript
import { useEffect, useState } from 'react';
import {
  Layout, Tabs, Table, Button, Space, Select, DatePicker, Tag,
  message, Typography, Card, theme, Empty, Modal
} from 'antd';
import {
  HistoryOutlined, AuditOutlined, DownloadOutlined
} from '@ant-design/icons';
import { useDrawStore } from '../stores/drawStore';
import { useAuditStore } from '../stores/auditStore';
import { useEventStore } from '../stores/eventStore';
import type { DrawSession, SessionFilter, AuditLogFilter } from '../../../shared/types';

const { Content } = Layout;
const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
```

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 13: 重写 Settings 页面

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`

**说明：** 五大模块：内置题库信息、去重设置、数据导出、数据导入、去重检查。

- [ ] **Step 1: 重写 src/renderer/src/pages/Settings.tsx**

```typescript
import { useEffect, useState } from 'react';
import {
  Layout, Card, Tabs, Button, Space, Switch, Slider, Input, message,
  Typography, Statistic, Row, Col, Tag, theme
} from 'antd';
import {
  DatabaseOutlined, SettingOutlined, ExportOutlined, ImportOutlined,
  SafetyCertificateOutlined, ReloadOutlined, CheckCircleOutlined,
  SearchOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useTopicStore } from '../stores/topicStore';
import ImportTopicsModal from '../components/ImportTopicsModal';
import DedupResultModal from '../components/DedupResultModal';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

// 默认去重阈值
const DEFAULT_LEVENSHTEIN = 5;
const DEFAULT_KEYWORD = 0.8;

export default function Settings() {
  const { token } = theme.useToken();
  const settingsStore = useSettingsStore();
  const topicStore = useTopicStore();

  const [importOpen, setImportOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);

  // 本地去重配置（受控）
  const [levenshtein, setLevenshtein] = useState<number>(DEFAULT_LEVENSHTEIN);
  const [keyword, setKeyword] = useState<number>(DEFAULT_KEYWORD);
  const [textLayerEnabled, setTextLayerEnabled] = useState<boolean>(true);
  const [aiEnabled, setAiEnabled] = useState<boolean>(false);
  const [aiApiKey, setAiApiKey] = useState<string>('');
  const [aiEndpoint, setAiEndpoint] = useState<string>('');

  // 官方题库统计
  const [officialCount, setOfficialCount] = useState<number>(0);
  const [customCount, setCustomCount] = useState<number>(0);

  useEffect(() => {
    settingsStore.getAll();
    loadStats();
    loadSettings();
  }, []);

  const loadStats = async () => {
    try {
      const officialRes = await window.topicAPI.count({ source_type: '官方' });
      const customRes = await window.topicAPI.count({ source_type: '自定义' });
      if (officialRes.success) setOfficialCount((officialRes.data as any) ?? 0);
      if (customRes.success) setCustomCount((customRes.data as any) ?? 0);
    } catch (e) {
      // ignore
    }
  };

  const loadSettings = async () => {
    const lev = await settingsStore.get('dedup_levenshtein');
    const kw = await settingsStore.get('dedup_keyword');
    const textOn = await settingsStore.get('dedup_text_enabled');
    const aiOn = await settingsStore.get('dedup_ai_enabled');
    const aiKey = await settingsStore.get('dedup_ai_api_key');
    const aiEp = await settingsStore.get('dedup_ai_endpoint');
    setLevenshtein(typeof lev === 'number' ? lev : DEFAULT_LEVENSHTEIN);
    setKeyword(typeof kw === 'number' ? kw : DEFAULT_KEYWORD);
    setTextLayerEnabled(textOn !== false);
    setAiEnabled(aiOn === true);
    setAiApiKey(typeof aiKey === 'string' ? aiKey : '');
    setAiEndpoint(typeof aiEp === 'string' ? aiEp : '');
  };

  const handleSaveDedup = async () => {
    try {
      await settingsStore.set('dedup_levenshtein', levenshtein);
      await settingsStore.set('dedup_keyword', keyword);
      await settingsStore.set('dedup_text_enabled', textLayerEnabled);
      await settingsStore.set('dedup_ai_enabled', aiEnabled);
      await settingsStore.set('dedup_ai_api_key', aiApiKey);
      await settingsStore.set('dedup_ai_endpoint', aiEndpoint);
      message.success('已保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const handleReloadOfficial = async () => {
    message.loading({ content: '正在重新加载官方题库...', key: 'reload', duration: 0 });
    // 通过 settings 标记重置 + 重启时重新加载
    // 简化实现：直接调用 forceReseed IPC（需要新增通道，这里用 settings 标记 + 提示重启）
    try {
      await settingsStore.set('official_seeded', false);
      message.success({
        content: '已重置加载标记，请重启应用以重新加载官方题库',
        key: 'reload',
        duration: 5
      });
    } catch (e) {
      message.error({ content: '失败', key: 'reload' });
    }
  };

  const handleExportTopics = async (format: 'xlsx' | 'csv' | 'json') => {
    try {
      const res = await window.exportAPI.exportTopics({ filter: {}, format });
      if (res.success && res.data) {
        message.success(`已导出 ${res.data.count} 条到：${res.data.filePath}`);
      } else {
        message.error(res.error || '导出失败');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  return (
    <>
      <Content style={{ padding: 16, background: 'transparent', overflow: 'auto' }}>
        <Card>
          <Tabs
            items={[
              {
                key: 'library',
                label: (
                  <span>
                    <DatabaseOutlined /> 内置题库
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={16} style={{ marginBottom: 24 }}>
                      <Col span={8}>
                        <Card>
                          <Statistic
                            title="官方题库"
                            value={officialCount}
                            prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                          />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card>
                          <Statistic
                            title="自定义题库"
                            value={customCount}
                            prefix={<DatabaseOutlined style={{ color: '#1677ff' }} />}
                          />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card>
                          <Statistic
                            title="总计"
                            value={officialCount + customCount}
                            prefix={<ThunderboltOutlined style={{ color: '#722ed1' }} />}
                          />
                        </Card>
                      </Col>
                    </Row>
                    <Space>
                      <Button icon={<ReloadOutlined />} onClick={handleReloadOfficial}>
                        重新加载官方题库
                      </Button>
                      <Text type="secondary">
                        （检查更新功能开发中，当前为离线模式）
                      </Text>
                    </Space>
                  </>
                )
              },
              {
                key: 'dedup',
                label: (
                  <span>
                    <SafetyCertificateOutlined /> 去重设置
                  </span>
                ),
                children: (
                  <>
                    <Card title="文本匹配层" size="small" style={{ marginBottom: 16 }}>
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Space>
                          <Switch
                            checked={textLayerEnabled}
                            onChange={setTextLayerEnabled}
                          />
                          <Text>启用文本匹配层（完全相同 + Levenshtein + 关键词重合）</Text>
                        </Space>
                        <div>
                          <Text>Levenshtein 编辑距离阈值（越小越严格）：</Text>
                          <Slider
                            min={1}
                            max={20}
                            value={levenshtein}
                            onChange={setLevenshtein}
                            style={{ maxWidth: 400 }}
                          />
                          <Tag color="blue">{levenshtein}</Tag>
                        </div>
                        <div>
                          <Text>关键词重合度阈值（0~1，越大越严格）：</Text>
                          <Slider
                            min={0.5}
                            max={1}
                            step={0.05}
                            value={keyword}
                            onChange={setKeyword}
                            style={{ maxWidth: 400 }}
                          />
                          <Tag color="blue">{keyword.toFixed(2)}</Tag>
                        </div>
                      </Space>
                    </Card>

                    <Card title="AI 语义层（开发中）" size="small" style={{ marginBottom: 16 }}>
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Space>
                          <Switch checked={aiEnabled} onChange={setAiEnabled} disabled />
                          <Text>启用 AI 语义相似度检测</Text>
                          <Tag color="orange">开发中</Tag>
                        </Space>
                        <Input.Password
                          placeholder="API Key"
                          value={aiApiKey}
                          onChange={(e) => setAiApiKey(e.target.value)}
                          style={{ maxWidth: 400 }}
                          disabled
                        />
                        <Input
                          placeholder="API Endpoint（如 https://api.openai.com/v1/embeddings）"
                          value={aiEndpoint}
                          onChange={(e) => setAiEndpoint(e.target.value)}
                          style={{ maxWidth: 400 }}
                          disabled
                        />
                        <Text type="secondary">
                          AI 语义层暂未实现，仅做配置占位。当前使用文本匹配层即可满足去重需求。
                        </Text>
                      </Space>
                    </Card>

                    <Space>
                      <Button type="primary" onClick={handleSaveDedup}>
                        保存设置
                      </Button>
                      <Button
                        icon={<SearchOutlined />}
                        onClick={() => setDedupOpen(true)}
                      >
                        立即执行去重检查
                      </Button>
                    </Space>
                  </>
                )
              },
              {
                key: 'export',
                label: (
                  <span>
                    <ExportOutlined /> 数据导出
                  </span>
                ),
                children: (
                  <>
                    <Card title="题库导出" size="small" style={{ marginBottom: 16 }}>
                      <Space>
                        <Button onClick={() => handleExportTopics('xlsx')}>导出 Excel</Button>
                        <Button onClick={() => handleExportTopics('csv')}>导出 CSV</Button>
                        <Button onClick={() => handleExportTopics('json')}>导出 JSON</Button>
                      </Space>
                    </Card>
                    <Card title="抽取记录导出" size="small" style={{ marginBottom: 16 }}>
                      <Space>
                        <Button
                          onClick={async () => {
                            const res = await window.exportAPI.exportDrawSessions({
                              filter: {},
                              format: 'xlsx'
                            });
                            if (res.success && res.data) {
                              message.success(`已导出 ${res.data.count} 条`);
                            } else {
                              message.error(res.error || '导出失败');
                            }
                          }}
                        >
                          导出 Excel
                        </Button>
                        <Button
                          onClick={async () => {
                            const res = await window.exportAPI.exportDrawSessions({
                              filter: {},
                              format: 'csv'
                            });
                            if (res.success && res.data) {
                              message.success(`已导出 ${res.data.count} 条`);
                            }
                          }}
                        >
                          导出 CSV
                        </Button>
                      </Space>
                    </Card>
                    <Card title="审计日志导出" size="small" style={{ marginBottom: 16 }}>
                      <Space>
                        <Button
                          onClick={async () => {
                            const res = await window.auditAPI.exportLogs({
                              filter: {},
                              format: 'csv'
                            });
                            if (res.success && res.data) {
                              message.success(`已导出 ${res.data.count} 条`);
                            }
                          }}
                        >
                          导出 CSV
                        </Button>
                        <Button
                          onClick={async () => {
                            const res = await window.auditAPI.exportLogs({
                              filter: {},
                              format: 'json'
                            });
                            if (res.success && res.data) {
                              message.success(`已导出 ${res.data.count} 条`);
                            }
                          }}
                        >
                          导出 JSON
                        </Button>
                      </Space>
                    </Card>
                    <Card title="赛事数据包导出（JSON）" size="small">
                      <Paragraph type="secondary">
                        选择一个赛事，导出完整数据包（含赛事、轮次、队伍、抽取记录、辩题快照），可用于备份或分享。
                      </Paragraph>
                      <EventPackageExport />
                    </Card>
                  </>
                )
              },
              {
                key: 'import',
                label: (
                  <span>
                    <ImportOutlined /> 数据导入
                  </span>
                ),
                children: (
                  <>
                    <Card title="导入辩题" size="small">
                      <Paragraph>
                        支持 .xlsx / .csv / .docx 格式。导入时自动检测重复辩题并跳过。
                      </Paragraph>
                      <Button
                        type="primary"
                        icon={<ImportOutlined />}
                        onClick={() => setImportOpen(true)}
                      >
                        选择文件并导入
                      </Button>
                    </Card>
                  </>
                )
              }
            ]}
          />
        </Card>
      </Content>

      <ImportTopicsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          loadStats();
          topicStore.fetchList();
        }}
      />

      <DedupResultModal
        open={dedupOpen}
        onClose={() => setDedupOpen(false)}
        onDeleted={() => {
          loadStats();
          topicStore.fetchList();
        }}
      />
    </>
  );
}

// 赛事数据包导出子组件
function EventPackageExport() {
  const eventStore = useEventStoreFromHere();
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    eventStore.listEvents();
  }, []);

  const handleExport = async () => {
    if (!eventId) {
      message.warning('请先选择赛事');
      return;
    }
    const res = await window.exportAPI.exportEventPackage({ eventId });
    if (res.success && res.data) {
      message.success(`已导出 ${res.data.count} 条抽取记录到：${res.data.filePath}`);
    } else {
      message.error(res.error || '导出失败');
    }
  };

  return (
    <Space>
      <Select
        placeholder="选择赛事"
        style={{ width: 240 }}
        value={eventId}
        onChange={setEventId}
        options={eventStore.events.map((e) => ({ label: e.name, value: e.id }))}
      />
      <Button type="primary" onClick={handleExport} disabled={!eventId}>
        导出 JSON
      </Button>
    </Space>
  );
}

// 同样需要修正：实际写入时把 useEventStoreFromHere 替换为 useEventStore，并补 import
// import { useEventStore } from '../stores/eventStore';
// import { Select } from 'antd';
```

- [ ] **Step 2: 实际写入时修正 import**

修正后顶部 import：

```typescript
import { useEffect, useState } from 'react';
import {
  Layout, Card, Tabs, Button, Space, Switch, Slider, Input, Select, message,
  Typography, Statistic, Row, Col, Tag, theme
} from 'antd';
import {
  DatabaseOutlined, ExportOutlined, ImportOutlined,
  SafetyCertificateOutlined, ReloadOutlined, CheckCircleOutlined,
  SearchOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useTopicStore } from '../stores/topicStore';
import { useEventStore } from '../stores/eventStore';
import ImportTopicsModal from '../components/ImportTopicsModal';
import DedupResultModal from '../components/DedupResultModal';
```

把 `useEventStoreFromHere` 替换为 `useEventStore`。

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 14: 增强 TopicLibrary 工具栏

**Files:**
- Modify: `src/renderer/src/pages/TopicLibrary.tsx`

**说明：** 在工具栏添加"导入"和"去重检查"两个按钮，复用 ImportTopicsModal 和 DedupResultModal 组件。

- [ ] **Step 1: 在 TopicLibrary.tsx 添加 import**

在 `src/renderer/src/pages/TopicLibrary.tsx` 顶部 import 区追加：

```typescript
import { ImportOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import ImportTopicsModal from '../components/ImportTopicsModal';
import DedupResultModal from '../components/DedupResultModal';
```

- [ ] **Step 2: 添加 state**

在组件内（约第 73 行 `const [batchTagValue, setBatchTagValue] = useState('');` 之后）添加：

```typescript
const [importOpen, setImportOpen] = useState(false);
const [dedupOpen, setDedupOpen] = useState(false);
```

- [ ] **Step 3: 在工具栏添加按钮**

在 TopicLibrary.tsx 工具栏的"新增辩题"按钮之前（约第 414 行 `<Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>` 之前）添加：

```typescript
<Button icon={<SafetyCertificateOutlined />} onClick={() => setDedupOpen(true)}>
  去重检查
</Button>
<Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
  导入
</Button>
```

- [ ] **Step 4: 在文件末尾 `</>` 之前添加弹窗**

在 `</TopicEditModal>` 之后、`</>` 之前添加：

```typescript
<ImportTopicsModal
  open={importOpen}
  onClose={() => setImportOpen(false)}
  onImported={() => store.fetchList()}
/>
<DedupResultModal
  open={dedupOpen}
  onClose={() => setDedupOpen(false)}
  onDeleted={() => store.fetchList()}
/>
```

- [ ] **Step 5: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 15: DrawPage 接收跳转上下文

**Files:**
- Modify: `src/renderer/src/pages/DrawPage.tsx`

**说明：** 从 `useLocation().state` 读取 `{ eventId, roundId }`，初始化 config 状态。

- [ ] **Step 1: 在 DrawPage.tsx 添加 useLocation import**

在 `src/renderer/src/pages/DrawPage.tsx` 顶部 import 区追加：

```typescript
import { useLocation } from 'react-router-dom';
```

- [ ] **Step 2: 在组件内读取 location.state**

在 `const [config, setConfig] = useState<DrawConfigState>(DEFAULT_CONFIG);` 之前添加：

```typescript
const location = useLocation();
const navState = (location.state as { eventId?: string; roundId?: string | null } | null) ?? null;
```

把 DEFAULT_CONFIG 初始化改为读取 navState：

```typescript
const [config, setConfig] = useState<DrawConfigState>({
  ...DEFAULT_CONFIG,
  eventId: navState?.eventId ?? null,
  roundId: navState?.roundId ?? null
});
```

- [ ] **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

---

## Task 16: 验证（typecheck + 测试 + dev 启动）

**Files:**
- 无需修改

- [ ] **Step 1: 运行 typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 2: 运行单元测试**

Run: `npm test`
Expected: 67 个测试全部通过（不引入新测试，确保无回归）

- [ ] **Step 3: 启动 dev 应用**

Run: `npm run dev`
Expected:
- 应用启动成功
- 控制台看到 `[main] Database initialized`、`[main] Official topics loaded: 18`（首次启动）、`[main] All IPC handlers registered`
- 应用窗口打开后默认进入抽取页

- [ ] **Step 4: 手动验证关键页面**

依次点击左侧菜单：
1. **题库管理**：工具栏出现"去重检查"和"导入"按钮，列表展示 18 道官方题
2. **赛事管理**：列表为空 → "新建赛事"创建一个 → "详情"打开抽屉 → "一键应用难度梯度预设"创建 3 个轮次 → "新建队伍"添加 2 支队伍 → "前往抽取"跳转到抽取页（自动选中该赛事）
3. **队伍管理**：左侧选中刚创建的赛事 → 右侧看到 2 支队伍 → "历史辩题"打开弹窗
4. **历史记录**：
   - 抽取记录 Tab：先在抽取页执行一次抽取，再回到此页面看到记录
   - 操作日志 Tab：看到 system/draw 等操作日志
5. **设置**：
   - 内置题库：看到官方 18、自定义 0、总计 18
   - 去重设置：阈值滑块可调整、保存
   - 数据导出：每个导出按钮可触发文件保存对话框
   - 数据导入：弹出 ImportTopicsModal 可选文件

- [ ] **Step 5: 关闭 dev**

按 Ctrl+C 停止 dev 服务

---

## 总结

本计划实现了以下功能：

1. **基础设施**：扩展 types、新增 export.ipc.ts、官方题库种子加载、audit/settings store
2. **4 个核心页面**：
   - EventManage：赛事 CRUD + 详情抽屉（轮次/队伍/难度预设/跳转抽取）
   - TeamManage：跨赛事队伍总览 + 历史辩题录入
   - History：抽取记录 + 操作日志双 Tab + 多维度导出
   - Settings：题库统计 + 去重配置 + 数据导出/导入
3. **6 个通用组件**：EventEditModal、TeamEditModal、RoundEditModal、TeamHistoryModal、ImportTopicsModal、DedupResultModal
4. **TopicLibrary 增强**：工具栏新增"导入"和"去重检查"按钮
5. **DrawPage 跳转支持**：接收 location.state 携带的 eventId/roundId
6. **官方题库种子**：18 道覆盖类型/难度/领域的经典辩题

所有 16 个任务完成后，应用的功能性页面将全部实现，可投入实际使用。
