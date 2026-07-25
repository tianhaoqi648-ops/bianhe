# 辩题抽取工具 - 项目初始化与数据库层 Spec

> 关联设计文档：`2026-07-25-debate-topic-drawer-design.md`
> 阶段：第一阶段（项目骨架 + 数据库层）
> change-id: `init-debate-drawer-base`

## Why

辩题抽取工具需要从零开始搭建 Electron 桌面应用骨架，并完成数据持久层（SQLite + Repository）以支撑后续业务逻辑（抽取引擎、去重引擎、导入引擎、IPC 通信、UI 页面）。本阶段是所有后续功能的基础，必须先建立可运行的项目结构和完整可用的数据库访问层。

## What Changes

- 新增：基于 `electron-vite` 脚手架初始化 Electron + React 18 + TypeScript 项目
- 新增：安装并配置 Ant Design 5、Zustand、better-sqlite3 等核心依赖
- 新增：按设计文档第 3 节严格建立主进程与渲染进程目录结构
  - 主进程：`db/`（含 `schema.sql`、`migrations/`、`repository/`）、`services/`、`ipc/`、`preload/`
  - 渲染进程：`pages/`、`components/`、`stores/`
- 新增：`schema.sql`，定义全部 9 张表（topics、events、rounds、teams、team_history、draw_sessions、draw_session_items、audit_log、settings），字段类型与约束严格遵循设计文档第 4 节
- 新增：数据库初始化模块，应用启动时自动建表、记录迁移版本
- 新增：Repository 层 4 个文件，封装所有 CRUD 操作
  - `topic.repo.ts`：辩题表增删改查
  - `event.repo.ts`：赛事 / 轮次 / 队伍 / 队伍历史 增删改查
  - `draw.repo.ts`：抽取会话 / 会话明细 增删改查
  - `audit.repo.ts`：操作日志 / 系统设置 增删改查
- 新增：主进程启动钩子，在 `app.whenReady()` 中初始化数据库
- 验证：`npm run dev` 可正常启动应用，无报错

## Impact

- 受影响的代码：无（全新项目）
- 后续阶段依赖：services 层、ipc 层、渲染进程页面均依赖本阶段的 Repository 与 schema
- 数据库文件位置：用户目录下 `app.getPath('userData')/debate-drawer.db`（遵循"非必要不占 C 盘"原则，但数据库属必要文件，放 userData 符合 Electron 规范）

## ADDED Requirements

### Requirement: 项目脚手架与依赖

系统 SHALL 使用 `electron-vite` 官方脚手架初始化项目，集成 React 18 + TypeScript 模板，并安装 Ant Design 5、Zustand、better-sqlite3 及其 TypeScript 类型定义。

#### Scenario: 项目可启动
- **WHEN** 开发者执行 `npm run dev`
- **THEN** Electron 主进程与 Vite 渲染进程均正常启动
- **AND** 控制台无报错
- **AND** 应用窗口正常显示默认页面

### Requirement: 目录结构

项目目录 SHALL 严格遵循设计文档第 3 节定义的分层架构。

#### Scenario: 主进程目录
- **GIVEN** 项目根目录 `src/main/`
- **THEN** 包含 `db/`、`db/schema.sql`、`db/migrations/`、`db/repository/`、`services/`、`ipc/`、`preload/` 子目录
- **AND** `db/repository/` 下包含 `topic.repo.ts`、`event.repo.ts`、`draw.repo.ts`、`audit.repo.ts`

#### Scenario: 渲染进程目录
- **GIVEN** 项目根目录 `src/renderer/src/`
- **THEN** 包含 `pages/`、`components/`、`stores/` 子目录

### Requirement: 数据库 Schema

系统 SHALL 在 `src/main/db/schema.sql` 中定义 9 张表，字段名、类型、约束严格遵循设计文档第 4 节。

#### Scenario: 表结构完整
- **GIVEN** schema.sql 文件
- **THEN** 包含以下 9 张表的 `CREATE TABLE IF NOT EXISTS` 语句：
  1. `topics` - 12 个字段，id 主键，weight 默认 1.0，status 默认 'active'
  2. `events` - 5 个字段，id 主键
  3. `rounds` - 6 个字段，id 主键，event_id 外键
  4. `teams` - 3 个字段，id 主键，event_id 外键
  5. `team_history` - 5 个字段，id 主键，三个外键
  6. `draw_sessions` - 6 个字段，id 主键，两个外键
  7. `draw_session_items` - 7 个字段，id 主键，四个外键
  8. `audit_log` - 7 个字段，id 主键
  9. `settings` - 2 个字段，key 主键
- **AND** 所有外键定义 `ON DELETE CASCADE`
- **AND** 所有外键定义 `ON UPDATE CASCADE`

### Requirement: 数据库初始化模块

系统 SHALL 提供数据库初始化模块，在应用启动时自动执行建表与迁移。

#### Scenario: 首次启动建表
- **GIVEN** 数据库文件不存在
- **WHEN** 应用启动并调用 `initDatabase()`
- **THEN** 在 `app.getPath('userData')` 下创建 `debate-drawer.db` 文件
- **AND** 执行 schema.sql 创建所有 9 张表
- **AND** 在 `settings` 表写入 schema_version 记录

#### Scenario: 后续启动跳过建表
- **GIVEN** 数据库已存在且 schema_version 匹配
- **WHEN** 应用启动并调用 `initDatabase()`
- **THEN** 不重复执行建表语句
- **AND** 返回已就绪的 Database 实例

#### Scenario: 启用外键约束
- **WHEN** 数据库初始化完成
- **THEN** 执行 `PRAGMA foreign_keys = ON`

### Requirement: Repository 层 - topic.repo.ts

`topic.repo.ts` SHALL 封装 topics 表的所有 CRUD 操作。

#### Scenario: 完整 CRUD
- **THEN** 提供以下方法：
  - `createTopic(data)` - 新增辩题，自动生成 UUID 与时间戳
  - `getTopicById(id)` - 按 ID 查询
  - `listTopics(filter?)` - 列表查询，支持按 type/domain/difficulty/source/status/tags 过滤，支持分页
  - `updateTopic(id, data)` - 更新辩题，自动更新 updated_at
  - `deleteTopic(id)` - 物理删除
  - `batchDeleteTopics(ids)` - 批量删除
  - `updateStatus(id, status)` - 更新状态（active/blacklisted/favorited）
  - `updateWeight(id, weight)` - 更新权重
  - `countByFilter(filter?)` - 按条件计数

### Requirement: Repository 层 - event.repo.ts

`event.repo.ts` SHALL 封装 events、rounds、teams、team_history 四张表的 CRUD 操作。

#### Scenario: 赛事 CRUD
- **THEN** 提供 `createEvent`、`getEventById`、`listEvents`、`updateEvent`、`deleteEvent` 方法

#### Scenario: 轮次 CRUD
- **THEN** 提供 `createRound`、`getRoundById`、`listRoundsByEvent`、`updateRound`、`deleteRound` 方法

#### Scenario: 队伍 CRUD
- **THEN** 提供 `createTeam`、`getTeamById`、`listTeamsByEvent`、`updateTeam`、`deleteTeam` 方法

#### Scenario: 队伍历史 CRUD
- **THEN** 提供 `addTeamHistory`、`listTeamHistory(teamId)`、`listTeamHistoryByEvent(eventId)`、`deleteTeamHistory(id)` 方法
- **AND** `listTeamHistory(teamId)` 跨赛事累积返回该队伍所有历史辩题

### Requirement: Repository 层 - draw.repo.ts

`draw.repo.ts` SHALL 封装 draw_sessions、draw_session_items 两张表的 CRUD 操作。

#### Scenario: 抽取会话 CRUD
- **THEN** 提供 `createSession`、`getSessionById`、`listSessions(filter?)`、`deleteSession` 方法
- **AND** `createSession` 在事务中同时创建 session 与其 items

#### Scenario: 抽取明细 CRUD
- **THEN** 提供 `createSessionItem`、`listItemsBySession(sessionId)`、`deleteItem` 方法

#### Scenario: 已抽取辩题查询
- **THEN** 提供 `listDrawnTopicIdsByEvent(eventId)` 方法，返回该赛事已抽取过的所有 topic_id（用于轮次不重复排除）

### Requirement: Repository 层 - audit.repo.ts

`audit.repo.ts` SHALL 封装 audit_log、settings 两张表的 CRUD 操作。

#### Scenario: 操作日志 CRUD
- **THEN** 提供 `addLog(action, targetType, targetId, operator, detail)`、`listLogs(filter?)`、`deleteLog(id)` 方法
- **AND** `listLogs` 支持按 action、target_type、operator、时间范围过滤

#### Scenario: 系统设置 CRUD
- **THEN** 提供 `getSetting(key)`、`setSetting(key, value)`、`getAllSettings()`、`deleteSetting(key)` 方法
- **AND** value 字段以 JSON 字符串存储

### Requirement: 主进程启动钩子

主进程 SHALL 在 `app.whenReady()` 中调用数据库初始化，并将 Database 实例注入到 Repository 单例中。

#### Scenario: 启动顺序
- **WHEN** Electron 主进程启动
- **THEN** 依次执行：创建 BrowserWindow 之前 → `initDatabase()` → 初始化各 Repository 单例 → 注册 IPC
- **AND** 数据库初始化失败时，向用户显示错误对话框并退出应用

## 非目标（Out of Scope）

本阶段不实现以下内容（留待后续阶段）：
- services 层业务逻辑（draw-engine、dedup-engine、import-engine、probability）
- IPC 通信注册（仅创建 ipc/ 目录占位，不实现具体 ipc handler）
- 渲染进程具体页面与组件（仅创建目录占位与默认首页）
- 内置官方题库数据导入
- 文件解析（mammoth.js、xlsx）
- 大屏展示模式
- 数据导出功能
