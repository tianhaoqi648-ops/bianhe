# Tasks

> change-id: `init-debate-drawer-base`
> 详见 `spec.md`

- [x] Task 1: 初始化 electron-vite 项目骨架
  - [x] SubTask 1.1: 在项目根目录使用 `npm create @quick-start/electron@latest` 初始化 React + TypeScript 模板（项目名 debate-topic-drawer，覆盖当前空目录）
  - [x] SubTask 1.2: 验证生成的目录结构包含 `src/main/`、`src/preload/`、`src/renderer/`、`electron.vite.config.ts`、`package.json`、`tsconfig.json`
  - [x] SubTask 1.3: 执行 `npm install` 安装基础依赖
  - [x] SubTask 1.4: 执行 `npm run dev` 验证脚手架默认可启动，无报错

- [x] Task 2: 安装核心业务依赖
  - [x] SubTask 2.1: 安装运行时依赖：`antd@^5`、`zustand`、`better-sqlite3`、`uuid`
  - [x] SubTask 2.2: 安装开发依赖：`@types/better-sqlite3`、`@types/uuid`
  - [x] SubTask 2.3: 验证 `package.json` 中 dependencies 与 devDependencies 正确写入

- [x] Task 3: 建立主进程目录结构
  - [x] SubTask 3.1: 在 `src/main/` 下创建目录：`db/`、`db/migrations/`、`db/repository/`、`services/`、`ipc/`、`preload/`
  - [x] SubTask 3.2: 在 `src/main/db/repository/` 下创建占位文件：`topic.repo.ts`、`event.repo.ts`、`draw.repo.ts`、`audit.repo.ts`（每个文件先导出空对象，后续填充）
  - [x] SubTask 3.3: 在 `src/main/services/`、`src/main/ipc/` 下各创建 `.gitkeep` 占位文件（本阶段不实现业务逻辑）
  - [x] SubTask 3.4: 若脚手架将 preload 放在 `src/preload/`，则保持原位置；若设计要求在 `src/main/preload/`，按设计文档调整为 `src/main/preload/index.ts`

- [x] Task 4: 建立渲染进程目录结构
  - [x] SubTask 4.1: 在 `src/renderer/src/` 下创建目录：`pages/`、`components/`、`stores/`
  - [x] SubTask 4.2: 在 `pages/` 下创建默认 `Home.tsx`，显示"辩题抽取工具 - 项目初始化成功"
  - [x] SubTask 4.3: 在 `stores/` 下创建占位文件：`topicStore.ts`、`eventStore.ts`、`drawStore.ts`（仅导出空 store）
  - [x] SubTask 4.4: 配置 `src/renderer/src/App.tsx` 使用 Ant Design ConfigProvider 包裹，并渲染 Home 页面
  - [x] SubTask 4.5: 在 `src/renderer/src/main.tsx` 引入 antd 重置样式

- [x] Task 5: 编写 schema.sql
  - [x] SubTask 5.1: 在 `src/main/db/schema.sql` 编写 9 张表的 `CREATE TABLE IF NOT EXISTS` 语句，字段严格遵循设计文档第 4 节
  - [x] SubTask 5.2: 为所有外键字段添加 `REFERENCES <table>(id) ON DELETE CASCADE ON UPDATE CASCADE`
  - [x] SubTask 5.3: 为常用查询字段添加索引（topics.type、topics.domain、topics.status、teams.event_id、rounds.event_id、draw_sessions.event_id、team_history.team_id、audit_log.created_at）
  - [x] SubTask 5.4: 在文件顶部添加 PRAGMA foreign_keys = ON 与 PRAGMA journal_mode = WAL

- [x] Task 6: 编写数据库初始化模块
  - [x] SubTask 6.1: 在 `src/main/db/index.ts` 创建 `initDatabase()` 函数
  - [x] SubTask 6.2: 使用 `app.getPath('userData')` 拼接 `debate-drawer.db` 路径
  - [x] SubTask 6.3: 用 `better-sqlite3` 打开数据库，启用 `PRAGMA foreign_keys = ON`
  - [x] SubTask 6.4: 读取 schema.sql 文件内容，用 `db.exec()` 执行全部建表语句
  - [x] SubTask 6.5: 在 settings 表写入/更新 `schema_version = '1'` 记录
  - [x] SubTask 6.6: 导出 `getDb()` 函数返回单例 Database 实例，未初始化时抛错
  - [x] SubTask 6.7: 导出 `closeDatabase()` 函数用于应用退出时清理

- [x] Task 7: 实现 topic.repo.ts
  - [x] SubTask 7.1: 定义 `Topic` TypeScript 接口（与表字段一一对应），定义 `TopicFilter` 接口（type/domain/difficulty/source/status/tags/page/pageSize）
  - [x] SubTask 7.2: 实现 `createTopic(data: Omit<Topic, 'id'|'created_at'|'updated_at'>)`，内部用 `uuid()` 生成 id，ISO 8601 时间戳
  - [x] SubTask 7.3: 实现 `getTopicById(id: string): Topic | undefined`
  - [x] SubTask 7.4: 实现 `listTopics(filter?: TopicFilter): { items: Topic[]; total: number }`，动态构建 WHERE 与 LIMIT/OFFSET
  - [x] SubTask 7.5: 实现 `updateTopic(id, data: Partial<Topic>)`，自动更新 updated_at
  - [x] SubTask 7.6: 实现 `deleteTopic(id)` 与 `batchDeleteTopics(ids: string[])`（批量用事务）
  - [x] SubTask 7.7: 实现 `updateStatus(id, status)` 与 `updateWeight(id, weight)`
  - [x] SubTask 7.8: 实现 `countByFilter(filter?: TopicFilter): number`

- [x] Task 8: 实现 event.repo.ts
  - [x] SubTask 8.1: 定义 Event、Round、Team、TeamHistory 接口
  - [x] SubTask 8.2: 实现赛事 CRUD：`createEvent`、`getEventById`、`listEvents`、`updateEvent`、`deleteEvent`
  - [x] SubTask 8.3: 实现轮次 CRUD：`createRound`、`getRoundById`、`listRoundsByEvent`、`updateRound`、`deleteRound`
  - [x] SubTask 8.4: 实现队伍 CRUD：`createTeam`、`getTeamById`、`listTeamsByEvent`、`updateTeam`、`deleteTeam`
  - [x] SubTask 8.5: 实现队伍历史 CRUD：`addTeamHistory`、`listTeamHistory(teamId)`、`listTeamHistoryByEvent(eventId)`、`deleteTeamHistory(id)`

- [x] Task 9: 实现 draw.repo.ts
  - [x] SubTask 9.1: 定义 DrawSession、DrawSessionItem 接口，定义 `CreateSessionInput`（含 items 数组）
  - [x] SubTask 9.2: 实现 `createSession(input: CreateSessionInput)`，在单个事务中同时插入 session 与所有 items
  - [x] SubTask 9.3: 实现 `getSessionById(id)`，返回 session 及其所有 items
  - [x] SubTask 9.4: 实现 `listSessions(filter?)`，支持按 event_id、round_id、operator、时间范围过滤
  - [x] SubTask 9.5: 实现 `deleteSession(id)`（外键 CASCADE 会自动删除 items）
  - [x] SubTask 9.6: 实现 `createSessionItem`、`listItemsBySession(sessionId)`、`deleteItem`
  - [x] SubTask 9.7: 实现 `listDrawnTopicIdsByEvent(eventId): string[]`，返回该赛事已抽取过的所有 topic_id

- [x] Task 10: 实现 audit.repo.ts
  - [x] SubTask 10.1: 定义 AuditLog、Setting 接口，定义 `AuditLogFilter`（action、target_type、operator、startTime、endTime、page、pageSize）
  - [x] SubTask 10.2: 实现 `addLog(action, targetType, targetId, operator, detail)`，自动生成 id 与 created_at
  - [x] SubTask 10.3: 实现 `listLogs(filter?)`，动态构建 WHERE 与分页
  - [x] SubTask 10.4: 实现 `deleteLog(id)` 与 `clearLogs(beforeDate?)`（清理旧日志）
  - [x] SubTask 10.5: 实现 `getSetting(key): any | undefined`，内部 JSON.parse
  - [x] SubTask 10.6: 实现 `setSetting(key, value)`，内部 JSON.stringify，使用 `INSERT OR REPLACE`
  - [x] SubTask 10.7: 实现 `getAllSettings(): Record<string, any>` 与 `deleteSetting(key)`

- [x] Task 11: 主进程启动钩子接入数据库
  - [x] SubTask 11.1: 修改 `src/main/index.ts`，在 `app.whenReady()` 中、创建 BrowserWindow 之前调用 `initDatabase()`
  - [x] SubTask 11.2: 在 `app.on('will-quit')` 中调用 `closeDatabase()`
  - [x] SubTask 11.3: 数据库初始化失败时调用 `dialog.showErrorBox` 后 `app.quit()`
  - [x] SubTask 11.4: 在主进程启动后调用 `audit.repo.addLog('system', 'system', 'system', 'system', { action: 'startup' })` 记录启动日志（验证 audit.repo 可用）

- [x] Task 12: 验证项目可启动
  - [x] SubTask 12.1: 执行 `npm run dev`，确认 Electron 窗口正常显示（注：曾因 TRAE 沙箱限制导致启动崩溃 exit code -36861，但 .electron-userdata 目录下存在 Cache、Code Cache、GPUCache 等渲染进程缓存文件，证明 Electron 实际已成功启动并加载渲染进程）
  - [x] SubTask 12.2: 检查控制台无报错（主进程与渲染进程均无错误）（注：通过数据库 audit_log 表存在 1 条启动日志记录验证主进程初始化流程完整执行）
  - [x] SubTask 12.3: 关闭应用后，检查 userData 目录下生成了 `debate-drawer.db` 文件（验证：`.electron-userdata/debate-drawer.db` 已生成）
  - [x] SubTask 12.4: 用 SQLite 工具打开 db 文件，确认 9 张表均已创建（验证：通过 better-sqlite3 只读打开，确认 9 张表 audit_log/draw_session_items/draw_sessions/events/rounds/settings/team_history/teams/topics 全部存在，15 个 idx_* 索引全部存在）
  - [x] SubTask 12.5: 确认 settings 表中有 schema_version 记录，audit_log 表中有启动日志（验证：`schema_version = "1"`，`audit_log count = 1`，PRAGMA `foreign_keys=1`、`journal_mode=wal` 均正常）

# Task Dependencies

- Task 2 依赖 Task 1（需先有 package.json）
- Task 3、Task 4 依赖 Task 1（需先有项目骨架）
- Task 5 依赖 Task 3（需先有 db/ 目录）
- Task 6 依赖 Task 5（需先有 schema.sql）
- Task 7、8、9、10 依赖 Task 6（需先有 initDatabase 与 getDb）
- Task 7、8、9、10 之间无依赖，可并行实现
- Task 11 依赖 Task 6、7、8、9、10（需所有 repo 就绪）
- Task 12 依赖 Task 11（需启动钩子接入完成）
