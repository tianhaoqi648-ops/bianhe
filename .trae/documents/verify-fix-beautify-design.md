# 抽辩题项目 — 验证 / Bug 修复 / UI 美化 设计文档

> 生成时间：2026-07-25
> 类型：设计文档（spec）
> 范围：基于已有项目（6 页面 + 15 组件 + 5 stores + 8 IPC 模块 + 4 services + 4 repository），完成功能验证、修复全部 15 个 bug、执行 80+ 项 UI 美化
> 目标：项目达到生产级品质——所有功能可用、零已知 bug、UI 视觉层次清晰且风格统一、typecheck 与 67 个单元测试全部通过

---

## 一、当前状态（Phase 1 验证结论）

### 已实现且可用

| 模块 | 数量 | 状态 |
|------|------|------|
| 页面（src/renderer/src/pages/） | 6 | DrawPage / TopicLibrary / TeamManage / EventManage / History / Settings 全部完整 |
| 组件（src/renderer/src/components/） | 15 | 抽取/题库/赛事/导入/去重等业务组件齐全 |
| Stores（src/renderer/src/stores/） | 5 | audit / draw / event / settings / topic 全部使用 zustand |
| IPC 模块（src/main/ipc/） | 8 | 52 个通道全部注册并被 preload 使用 |
| 服务层（src/main/services/） | 4 | draw-engine / dedup-engine / probability / import-engine 完整 |
| Repository（src/main/db/repository/） | 4 | topic / event / draw / audit 完整，9 张表 schema 齐全 |
| 官方题库 | 1 份 | data/official-topics.json + seed.ts 逻辑健壮 |
| 共享样式基础设施 | 4 文件 | tokens.ts / theme.ts / shared.ts / animations.css 已创建 |
| 单元测试 | 67 | 全部通过 |
| 已美化页面 | 3 | DrawPage / DrawAnimation / BigScreen 已完成视觉增强 |

### 已知阻塞

1. **typecheck 错误（1 处）**：`src/renderer/src/styles/shared.ts:39` — `statCardStyle` 函数声明 `color` 参数但未使用，违反 `noUnusedParameters`
2. **15 个 bug 全部未修复**（详见阶段 1）
3. **UI 美化阶段 4-5 未开始**（TopicLibrary / EventManage / TeamManage / History / Settings 及对应 Modal）

---

## 二、设计决策

### 核心策略：Bug 优先 + UI 全量

用户明确选择：
- **执行顺序**：Bug 优先——先修复全部 15 个 bug，再做 UI 美化
- **UI 范围**：全量执行——执行原计划全部 80+ 项美化点

### 方案选型

经过三种方案对比（线性 Bug 优先 / Bug + UI 按文件分组 / 并行 Bug + UI），选择**方案 A：线性 Bug 优先 + UI 全量**：

- 阶段 0：修 typecheck 错误解除阻塞
- 阶段 1：修全部 15 个 bug（高→中→低优先级 + 类型安全增强）
- 阶段 2：UI 阶段 4 — 题库管理页
- 阶段 3：UI 阶段 5 — 其他页面
- 阶段 4：最终验证

**选择理由**：
1. 符合"bug 优先"原则，确保功能正确性早于视觉改造
2. 每阶段可独立验证，避免错误累积
3. TopicLibrary.tsx 等文件的 bug 修复（1 行改动）与后续 UI 美化改动点不重叠，不会冲突

### 关键约束

1. **不引入新依赖**（除 iconv-lite 用于 CSV 编码检测）
2. **不引入新框架**（不加 Tailwind / styled-components / CSS Module）
3. **不补测试**（保持 67 个测试通过即可，不新增 IPC/Repo/Renderer 测试）
4. **不改架构**（保持现有目录结构与 IPC 约定）
5. **暗色模式仅预留**（theme.ts 已抽离，不实际实现）
6. **C 盘约束**：所有产物放在 F 盘项目目录，禁止往 C 盘写文件（系统级 node_modules 等除外）

### 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| iconv-lite 安装失败 | 降级为仅 BOM 检测，GBK 文件显示乱码提示用户转码 |
| 倒排索引优化改动大 | 备选：仅做 title 长度预筛 + 分批处理 |
| preload 类型完整化引入新错误 | 备选：保留 `as any` 但加详细注释 |
| 渲染层 bug 修复与 UI 改动同文件 | 阶段 1 只改 bug 行，阶段 2/3 改其他位置，验证 typecheck 不冲突 |

---

## 三、阶段设计

### 阶段 0：阻塞解除

**目标**：修复 typecheck 错误，恢复绿色构建

**修改**：
- `src/renderer/src/styles/shared.ts:39` — `statCardStyle` 函数中 `color` 参数未使用，改为在样式对象中引用 `color` 作为左侧色块边框，或前缀下划线 `_color` 明确表示弃用，或直接删除参数（需检查调用点）

**验收**：`npm run typecheck` 通过

---

### 阶段 1：Bug 修复（15 项 + 类型安全增强）

#### 1.1 高优先级 Bug（5 项）

| # | 文件 | 问题 | 修复方案 |
|---|------|------|----------|
| 1 | TopicLibrary.tsx:510-512 | `sel ? store.toggleSelect(id) : store.toggleSelect(id)` 两分支相同 | 检查 TopicCard `onSelect` 语义：若 `sel` 表示新选中状态，改为 `sel ? store.select(id) : store.deselect(id)`（需在 topicStore 补 select/deselect 方法）；若 `sel` 仅表示点击事件，直接调用 `store.toggleSelect(id)` |
| 2 | topic.repo.ts:120-131 | SQL LIKE 模式未转义 `%` 和 `_` | 新增 `escapeLike()` 辅助函数，SQL 加 `ESCAPE '\\'` 子句 |
| 3 | audit.ipc.ts:84 / export.ipc.ts:151,220,266 / system.ipc.ts:19 | `BrowserWindow.getFocusedWindow()!` 非空断言 | 封装 `getActiveWindow()` 工具函数到 `src/main/ipc/utils.ts`，null 时返回 `{ success: false, error: '无可用窗口' }` |
| 4 | shared/types.ts:294 | `EVENT_DELETE: 'event:event_delete'` 命名不规范 | 改为 `'event:delete'`，确认 preload 和 event.ipc 都通过 IPC_CHANNELS 常量引用 |
| 5 | preload/index.ts:137 + system.ipc.ts:14 | 使用字符串字面量 `'system:pickFile'` | 在 IPC_CHANNELS 新增 `SYSTEM_PICK_FILE: 'system:pickFile'` 常量，两端引用常量 |

#### 1.2 中优先级 Bug（7 项）

| # | 文件 | 问题 | 修复方案 |
|---|------|------|----------|
| 6 | import.ipc.ts:57-95 | 导入去重 O(n²)，1000+100 条 ≈ 1.2 亿次计算 | 改为一次性对新题集合调 `findDuplicates`，仅返回包含新题的组 |
| 7 | dedup.ipc.ts:24-46 | 全库去重 O(n²)，>5000 条阻塞数十秒 | 在 dedup-engine 加 bigram 倒排索引预筛，仅对至少 1 个 bigram 重合的对计算相似度 |
| 8 | import-engine.ts:171 | CSV 固定 `codepage: 65001`，GBK 乱码 | 引入 iconv-lite，按 BOM 检测 UTF-8/UTF-16LE/UTF-16BE，否则启发式判断 GBK |
| 9 | preload/index.ts:159-177 | 10 处 `@ts-ignore` | 显式导入 d.ts 类型，标注 API 对象类型，`else` 分支用 `(window as Window & typeof globalThis)` |
| 10 | preload/index.ts:16,24,26,27,... | 26 处 `any` 类型参数 | 从 shared/types.ts 导入具体类型，标注每个 API 方法参数 |
| 11 | History.tsx:100-105 | useEffect 空依赖但引用外部 store 变量 | zustand store 实例稳定，空依赖正确，加 `// eslint-disable-next-line react-hooks/exhaustive-deps` 注释 |
| 12 | History.tsx:160-162 | catch 块异常变量 `e` 未使用 | 改为 `console.error('加载明细失败', e)` + `messageApi.error(e instanceof Error ? e.message : '加载明细失败')` |

#### 1.3 低优先级 Bug（3 项）

| # | 文件 | 问题 | 修复方案 |
|---|------|------|----------|
| 13 | event.repo.ts:56-61 | SessionListFilter 接口未使用 | 直接删除 |
| 14 | export.ipc.ts:37 | `void wrap` 死代码 | 直接删除 |
| 15 | dedup-engine.ts:240 | `this.bestReason.get(ri)!` 非空断言 | 改为 `this.bestReason.get(ri) ?? reason` |

#### 1.4 类型安全增强（可选但推荐）

- `src/main/db/repository/*.repo.ts` — 定义 `TopicRow` / `EventRow` / `DrawRow` / `AuditLogRow` 接口替代 `as any`
- `src/shared/types.ts` — 为 `DrawSession.settings` 和 `AuditLog.detail` 定义 `DrawSessionSettings` / `AuditLogDetail` 接口

**阶段 1 验收**：
- `npm run typecheck` 通过，无错误无警告
- `npm test` 67 个测试全部通过
- 应用启动无报错，原功能不受影响

---

### 阶段 2：UI 美化 — 题库管理页（阶段 4）

**目标**：题库管理页视觉层次清晰，题卡美观

#### 2.1 TopicLibrary.tsx

1. Sider 顶部加"分类维度"标题区
2. Segmented size 改 middle，选项前加图标（类型-标签、领域-地球、难度-火焰、来源-数据库）
3. Tree 每个分类节点加对应图标 + Badge 计数
4. 顶部工具栏搜索框 width 改 320，加快捷键提示 `Ctrl+K`
5. Segmented 视图切换选中态加背景色 `token.colorPrimaryBg`
6. 网格视图 gap 改 16，移动端 minmax 改 240
7. 列表视图选中态加左侧 3px 蓝色竖条 + hover 态 `background: colorFillTertiary`
8. 分页栏改 `position: sticky; bottom: 0` + `backdropFilter: blur(8px)`
9. 空状态加 SVG 插画 + "导入官方题库"/"新建第一道辩题"双按钮
10. 选中态时底部弹出 `Affix` 浮动操作栏

#### 2.2 TopicCard.tsx

1. 选中态加 `boxShadow: 0 4px 12px rgba(22,119,255,0.15)` + 顶部 2px 蓝条
2. 标题 fontSize 改 15、lineHeight 1.6
3. 标签行 gap 改 6；难度标签用语义化色板（入门=绿、进阶=橙、专业=红）的渐变背景
4. 来源+权重区 borderTop 改 `1px solid` + 权重数字用 Tag 包裹
5. 列表行 padding 改 `16px 20px`；hover 态加 `background: token.colorFillQuaternary`
6. 列表分割线 `#f0f0f0` 改 `token.colorSplit`
7. 黑名单颜色 `#999` 改 `token.colorTextDisabled`

#### 2.3 FilterPanel.tsx

1. 抽屉式面板视觉优化（背景、间距、按钮风格统一）

#### 2.4 ImportTopicsModal.tsx

1. 表单间距优化，按钮统一风格

#### 2.5 DedupResultModal.tsx

1. 重复组展示视觉优化（重复组卡片化、相似度可视化条）

#### 2.6 TopicEditModal.tsx

1. 表单间距优化，按钮统一风格

**阶段 2 验收**：题库管理页 Tree 有图标和计数、题卡有选中态阴影、分页栏 sticky

---

### 阶段 3：UI 美化 — 其他页面（阶段 5）

#### 3.1 EventManage.tsx

1. 顶部工具栏加赛事总数 `<Tag>` + 状态分布统计
2. 赛事列表改卡片网格视图
3. Table pagination 加 `showTotal`
4. 赛事详情 Card 加 marginTop 16；详情头部加大色块背景区分
5. Tabs label 中 `<Tag>` 用 `color="blue"`
6. 难度梯度预设 Card hover 时 `transform: translateY(-2px)` + boxShadow；选中态加蓝色边框
7. Alert warning 改 `banner` 模式
8. 赛事操作列加"标记为已结束"下拉项
9. 详情卡片头部加 `Progress` 条显示已完成轮次/总轮次

#### 3.2 TeamManage.tsx

1. 顶部加"按赛事分组"切换按钮
2. 加"历史辩题数 ≥ N"的 InputNumber 筛选
3. 队伍列表改卡片网格
4. 历史辩题数 Tag 颜色按数量变化（≥5 红、1-4 橙、0 灰）
5. 顶部加"添加队伍"主按钮
6. 加视图切换：列表 / 按赛事分组（Collapse 折叠面板）

#### 3.3 History.tsx

1. 顶部加 4 个 Statistic 卡片：今日抽取/本周抽取/总抽取/重抽次数
2. Card title 加时间范围筛选 `<Segmented>`（今日/本周/本月/全部）
3. Tabs label 改用 `<Badge count={total} showZero>`
4. 筛选条 `Space wrap` 改 `<Card size="small">` 内网格布局
5. RangePicker 加 `style={{ width: 380 }}`
6. 导出格式 `Select` 改为先选格式再点"导出"按钮
7. Table 列：抽取时间列加日历图标；赛事列 Tag 颜色按赛事状态变化
8. expandable 加 `expandIcon` 自定义箭头 + 展开时背景 `token.colorFillQuaternary`
9. Spin 改 Skeleton 骨架屏
10. "详情"列改 `<Typography.Paragraph ellipsis={{ rows: 2, expandable: true }}>`
11. "清空日志"按钮加 Popconfirm 的 `description` 说明影响
12. operator 列前加 `<Avatar size="small">{operator[0]}</Avatar>`

#### 3.4 Settings.tsx

1. 去重设置 Tab 改 `<Row justify="center"><Col span={16}>` 响应式
2. Card title 旁加 `<Tag color="blue">必选</Tag>` / `<Tag color="orange">可选</Tag>`
3. 每个 InputNumber 旁加可视化进度条反映阈值大小
4. AI 语义层 Alert 改 `banner` + 图标动画
5. "保存设置"/"立即执行"按钮组主按钮加 `size="large"`，保存加 ✓ 图标，保存成功后短暂显示绿色
6. 4 个 Statistic 卡片加左侧色块背景
7. Statistic "已加载" 改 `<Tag color="green">已加载</Tag>` / `<Tag color="orange">未加载</Tag>`
8. Paragraph 灰色文字改 `<Steps>` 当前步骤指示
9. 数据导入导出 Tab 改左右分栏：左数据导出、右数据导入
10. 多个 `Divider orientation="left"` 改 `<Typography.Title level={5}>` + 下方描述
11. `EventPackageExport` 子组件加 `<Alert type="info">` 说明导出包含的数据
12. 各 Tab 底部加"恢复默认设置"次按钮
13. 表单脏时顶部加 `<Alert>未保存的修改</Alert>`

#### 3.5 EventEditModal.tsx / RoundEditModal.tsx / TeamEditModal.tsx

1. 表单间距优化，按钮统一风格

**阶段 3 验收**：所有页面 Statistic 卡片有色块、列表卡片化、表单风格统一

---

### 阶段 4：最终验证

#### 4.1 静态检查
```bash
npm run typecheck   # 预期：通过，无错误无警告
npm test            # 预期：67 个测试全部通过
```

#### 4.2 运行时验证
```bash
npm run dev
```
预期：
- Electron 窗口正常打开
- 控制台无错误
- 数据库 9 张表初始化成功
- 官方题库加载成功

#### 4.3 功能验证清单（30+ 项）

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

#### 4.4 响应式验证
- 调整窗口宽度到 768px、1024px、1280px、1920px
- 各页面布局正确响应
- DrawPage Sider 在小屏自动折叠

#### 4.5 性能验证
- 题库导入 100 条新题到 1000 条题库应在 3 秒内完成（bug #6 验证）
- 全库去重检查 5000 条题库应在 5 秒内完成（bug #7 验证）
- 抽取动画流畅无卡顿

---

## 四、文件改动清单

### 修改文件（约 25 个）

**阶段 0（1 个）**：
- `src/renderer/src/styles/shared.ts` — 修复 `color` 未使用参数

**阶段 1 - 主进程（9 个）**：
- `src/shared/types.ts` — EVENT_DELETE 命名、SYSTEM_PICK_FILE 常量、DrawSessionSettings/AuditLogDetail 接口
- `src/main/ipc/utils.ts` — **新建** `getActiveWindow()` 工具函数
- `src/main/ipc/system.ipc.ts` — 用 IPC_CHANNELS.SYSTEM_PICK_FILE + getActiveWindow
- `src/main/ipc/audit.ipc.ts` — getActiveWindow 空指针保护
- `src/main/ipc/export.ipc.ts` — getActiveWindow 空指针保护 + 删除 `void wrap`
- `src/main/ipc/import.ipc.ts` — 优化导入去重性能
- `src/main/ipc/dedup.ipc.ts` — 全库去重性能优化
- `src/main/services/dedup-engine.ts` — 倒排索引优化 + bestReason 非空断言修复
- `src/main/services/import-engine.ts` — CSV 编码自动检测
- `src/main/db/repository/topic.repo.ts` — LIKE 转义 + TopicRow 接口
- `src/main/db/repository/event.repo.ts` — 删除未使用 SessionListFilter + EventRow 接口
- `src/main/db/repository/draw.repo.ts` — DrawRow 接口
- `src/main/db/repository/audit.repo.ts` — AuditLogRow 接口

**阶段 1 - Preload（2 个）**：
- `src/preload/index.ts` — 消除 @ts-ignore + 替换 any 类型 + 用 IPC_CHANNELS.SYSTEM_PICK_FILE
- `src/preload/index.d.ts` — 类型完善（如存在）

**阶段 1 - 渲染进程（2 个）**：
- `src/renderer/src/pages/TopicLibrary.tsx` — toggleSelect 修复（仅 1 行）
- `src/renderer/src/pages/History.tsx` — useEffect 注释 + catch e 修复

**阶段 2 - 题库管理页（6 个）**：
- `src/renderer/src/pages/TopicLibrary.tsx` — Tree 图标 + 分页 sticky
- `src/renderer/src/components/TopicCard.tsx` — 选中态阴影 + Tag 化权重
- `src/renderer/src/components/FilterPanel.tsx` — 视觉优化
- `src/renderer/src/components/ImportTopicsModal.tsx` — 表单优化
- `src/renderer/src/components/DedupResultModal.tsx` — 重复组卡片化
- `src/renderer/src/components/TopicEditModal.tsx` — 表单优化

**阶段 3 - 其他页面（7 个）**：
- `src/renderer/src/pages/EventManage.tsx` — 卡片网格 + Progress 进度条
- `src/renderer/src/pages/TeamManage.tsx` — 卡片网格 + 分组视图
- `src/renderer/src/pages/History.tsx` — Statistic 卡片 + Skeleton + Avatar
- `src/renderer/src/pages/Settings.tsx` — Statistic 色块 + 恢复默认 + Alert
- `src/renderer/src/components/EventEditModal.tsx` — 表单优化
- `src/renderer/src/components/RoundEditModal.tsx` — 表单优化
- `src/renderer/src/components/TeamEditModal.tsx` — 表单优化

### 新建文件（1 个）
- `src/main/ipc/utils.ts` — `getActiveWindow()` 工具函数

### 新增依赖（1 个）
- `iconv-lite`（用于 CSV 编码检测）

---

## 五、执行顺序与依赖

```
阶段 0（阻塞解除）
  └─ 修 shared.ts:39
       ↓ 验证 typecheck
阶段 1（bug 修复）
  ├─ 1.1 高优先级（5 项）
  ├─ 1.2 中优先级（7 项）
  ├─ 1.3 低优先级（3 项）
  └─ 1.4 类型安全增强
       ↓ 验证 typecheck + test
阶段 2（UI 题库管理页）
  ├─ TopicLibrary.tsx
  ├─ TopicCard.tsx
  ├─ FilterPanel.tsx
  ├─ ImportTopicsModal.tsx
  ├─ DedupResultModal.tsx
  └─ TopicEditModal.tsx
       ↓ 验证 typecheck
阶段 3（UI 其他页面）
  ├─ EventManage.tsx + EventEditModal
  ├─ TeamManage.tsx + TeamEditModal + RoundEditModal
  ├─ History.tsx
  └─ Settings.tsx
       ↓ 验证 typecheck
阶段 4（最终验证）
  ├─ npm run typecheck
  ├─ npm test
  ├─ npm run dev
  ├─ 功能验证清单（30+ 项）
  ├─ 响应式验证
  └─ 性能验证
```

---

## 六、备注

1. 本设计基于实际代码验证：67/67 测试通过，typecheck 有 1 处错误，15 个 bug 全部未修复
2. 每阶段完成后立即运行 `npm run typecheck` 验证，避免错误累积
3. UI 改造保持增量进行，每改一个文件验证一次
4. 阶段 1 优先于 UI 美化，但共享样式基础设施（已完成）无需重做
5. 若中途发现新 bug，记录到阶段 1 并按优先级处理
6. 所有产物放 F 盘项目目录，禁止往 C 盘写文件（系统级 node_modules 除外）
