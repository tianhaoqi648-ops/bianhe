# 抽辩题项目 — 功能验证 / Bug 修复 / UI 美化 实施计划

> 生成时间：2026-07-25
> 范围：基于 Phase 1 探索结果，对项目进行完整验证、修复全部 15 个 bug、执行 80+ 处 UI 美化点
> 目标：项目达到生产级品质，所有功能可用、零已知 bug、UI 视觉层次清晰且风格统一

---

## 一、当前状态分析（Phase 1 探索结论）

### 已完整实现（无需修改）

| 模块 | 数量 | 状态 |
|------|------|------|
| 页面（src/renderer/src/pages/） | 6 个 | DrawPage / TopicLibrary / TeamManage / EventManage / History / Settings 全部完整实现 |
| 组件（src/renderer/src/components/） | 15 个 | 抽取/题库/赛事/导入/去重等业务组件齐全 |
| Stores（src/renderer/src/stores/） | 5 个 | audit / draw / event / settings / topic 全部使用 zustand |
| IPC 模块（src/main/ipc/） | 8 个 | 52 个通道全部注册并被 preload 使用 |
| 服务层（src/main/services/） | 4 个 | draw-engine / dedup-engine / probability / import-engine 完整 |
| Repository（src/main/db/repository/） | 4 个 | topic / event / draw / audit 完整，9 张表 schema 齐全 |
| 官方题库 | 1 份 | data/official-topics.json + seed.ts 逻辑健壮 |

### 需要修复的 Bug 清单（15 项）

#### 高优先级（5 项）
1. **TopicLibrary.tsx:511-513** — `sel ? store.toggleSelect(id) : store.toggleSelect(id)` 两个分支相同，应基于 sel 选择
2. **topic.repo.ts:120-131** — SQL LIKE 模式未转义 `%` 和 `_` 通配符
3. **audit.ipc.ts:84 / export.ipc.ts:151,220,266 / system.ipc.ts:19** — `BrowserWindow.getFocusedWindow()` 返回 null 时用 `win!` 非空断言
4. **shared/types.ts:294** — `EVENT_DELETE: 'event:event_delete'` 命名不规范，应为 `'event:delete'`
5. **system:pickFile** — preload/index.ts:137 与 system.ipc.ts:14 使用字符串字面量，未走 IPC_CHANNELS 常量

#### 中优先级（7 项）
6. **import.ipc.ts:57-95** — 导入去重 O(n²) 性能瓶颈，1000 条题库 + 100 条新题 ≈ 1.2 亿次相似度计算
7. **dedup.ipc.ts:24-46** — 全库去重 O(n²)，题库 >5000 条时主进程阻塞数十秒
8. **import-engine.ts:171** — CSV 固定 `codepage: 65001`，GBK 编码文件中文乱码
9. **preload/index.ts:159-177** — 10 处 `@ts-ignore` 非空断言
10. **preload/index.ts:16,24,26,27,...** — 26 处 `any` 类型参数，丧失类型安全
11. **History.tsx:100-105** — useEffect 空依赖数组但引用外部 store 变量
12. **History.tsx:160-162** — catch 块异常变量 `e` 未使用

#### 低优先级（3 项）
13. **event.repo.ts:56-61** — SessionListFilter 接口未使用，已被 draw.repo.ts 的 SessionFilter 取代
14. **export.ipc.ts:37** — `void wrap` 死代码
15. **dedup-engine.ts:240** — `this.bestReason.get(ri)!` 非空断言，应改用 `?? reason`

### UI 美化空间（80+ 项）

#### P0 最高优先级（7 项，立竿见影）
1. App.tsx:61-68 — 扩展 ConfigProvider 主题 token（colorSuccess/colorWarning/colorError/fontFamily/wireframe）
2. App.tsx:73-86 — Sider Logo 区增加渐变背景圆形图标 + 副标题
3. App.tsx:90-100 — Header 改为面包屑 + 当前页标题 + 右侧快捷操作
4. App.tsx:101 — Content 背景改渐变，padding 改 20-24
5. DrawPage.tsx:198-214 — 空状态改为引导式插画 + 步骤卡片
6. DrawAnimation.tsx:11-37 — 遮罩加粒子背景 + 同心圆波纹 + 进度条
7. BigScreen.tsx — 增加题目索引指示器、过渡动画、键盘提示样式

#### P1 重要（13 项，提升整体质感）
8. 新建 `src/renderer/src/styles/shared.ts` — 抽取共享样式常量，消除 30+ 处重复
9. 新建 `src/renderer/src/styles/tokens.ts` — 建立 design token 文件
10. 新建 `src/renderer/src/styles/theme.ts` — 主题分离，便于后续支持暗色模式
11. TopicLibrary.tsx — Tree 节点加图标 + Badge 计数；分页栏改 sticky + 模糊背景
12. TopicCard.tsx — 选中态加 boxShadow + 顶部蓝条；权重数字用 Tag 包裹
13. EventManage.tsx — 赛事列表改为卡片网格视图；详情头部加 Progress 进度条
14. History.tsx — 顶部加 4 个 Statistic 统计卡；筛选条改为 Card 网格布局
15. Settings.tsx — Statistic 卡片加左侧色块；表单底部加"恢复默认"按钮
16. TeamManage.tsx — 队伍列表改卡片网格视图
17. DrawConfigPanel.tsx — Card title 加蓝色竖条；主按钮加阴影
18. DrawResultList.tsx — 题源比例 Tag 加颜色区分；列表改双列
19. TopicEditModal/EventEditModal 等 — 表单间距优化，按钮统一风格
20. FilterPanel.tsx — 抽屉式面板视觉优化

#### P2 增强（多项，锦上添花）
21. DrawPage/TopicLibrary Sider 加 `breakpoint="lg"` + `collapsedWidth={0}` 响应式
22. ConfigProvider 增加 `algorithm: theme.darkAlgorithm` 切换支持
23. DrawPage 增加快捷键提示（R 重抽 / F 投屏 / Esc 退出）
24. History.tsx Spin 改 Skeleton 骨架屏
25. 替换所有 `<Empty>` 默认图为自绘 SVG
26. 按钮 hover 加 `transform: translateY(-1px)` + `transition: all 0.2s`
27. draw.css `fade-up-delay-*` 改用 CSS 变量
28. draw.css `bigscreen-topic-title` 加 `@media` 响应式字号
29. BigScreen 全屏按钮 + 切换题目过渡动画
30. History operator 列加 Avatar
31. EventManage 赛事状态分布统计
32. 微交互全面覆盖

---

## 二、实施计划（分 6 个阶段）

### 阶段 1：架构准备（共享样式基础设施）

**目标**：建立样式基础设施，为后续美化铺路

**文件创建**：
- `src/renderer/src/styles/tokens.ts` — 定义 design tokens（spacing/radius/shadow/gradient）
- `src/renderer/src/styles/theme.ts` — 抽离 ConfigProvider 主题配置
- `src/renderer/src/styles/shared.ts` — 导出 `cardStyle`、`toolbarStyle`、`pageContainerStyle`、`statCardStyle` 等共享 inline style 常量
- `src/renderer/src/styles/animations.css` — 集中放置共享动画（淡入、脉冲、波纹）

**文件修改**：
- `src/renderer/src/App.tsx` — 引入新 theme.ts，扩展 ConfigProvider token（colorSuccess #52c41a / colorWarning #faad14 / colorError #ff4d4f / colorInfo #1677ff / fontFamily "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif" / wireframe false / componentSize middle）
- `src/renderer/src/main.tsx` — 引入 animations.css

**验收**：typecheck 通过，应用启动无报错

---

### 阶段 2：全局布局美化

**目标**：重做 App.tsx 整体框架，建立品牌识别度

**修改 `src/renderer/src/App.tsx`**：

1. **Sider 改造（73-86 行）**
   - Logo 区：圆形渐变背景（`linear-gradient(135deg, #1677ff 0%, #722ed1 100%)`）+ 白色闪电图标（ThunderboltOutlined）+ 主标题"辩题抽取工具"+ 副标题"v1.0"
   - Sider 加 `boxShadow: '2px 0 8px rgba(0,0,0,0.04)'`
   - Menu 选中态加左侧蓝色竖条指示器

2. **Header 改造（90-100 行）**
   - 左侧：面包屑（基于当前路由动态生成，如"抽取 / 准备就绪"）
   - 右侧：快捷操作组（全屏按钮 FullscreenOutlined、主题切换按钮、关于按钮 InfoCircleOutlined）
   - 高度改 56，背景 `rgba(255,255,255,0.85)` + `backdropFilter: blur(8px)`

3. **Content 改造（101 行）**
   - 背景改 `linear-gradient(180deg, #fafbff 0%, #f0f2f5 100%)`
   - padding 改 20

**验收**：应用启动后整体视觉焕新，Sider/Header/Content 三层分明

---

### 阶段 3：核心页面美化（DrawPage 及相关组件）

**目标**：核心抽取流程视觉冲击力提升

**修改 `src/renderer/src/pages/DrawPage.tsx`**：
1. Sider 加 `breakpoint="lg"` + `collapsedWidth={0}` 响应式
2. Sider 加 boxShadow 区分
3. Content padding 改 16
4. 空状态（198-214 行）改为：大尺寸 SVG 抽签插画 + 三步引导卡片（1.选赛事 2.配条件 3.开始抽取）
5. 抽取完成后底部加快捷键提示（`按 R 重抽 · 按 F 投屏 · 按 Esc 退出`）
6. 添加快捷键监听 useEffect（R/F/Esc）
7. Content 顶部加 Breadcrumb（赛事名 / 轮次 / 难度）

**修改 `src/renderer/src/components/draw/DrawAnimation.tsx`**：
1. 遮罩背景改 `radial-gradient(circle, rgba(22,119,255,0.15) 0%, rgba(0,0,0,0.85) 70%)`
2. 加 SVG 抽签粒子背景（CSS animation 漂浮）
3. 中心闪电改同心圆波纹扩散动画（3 个错相 0.4s 的圆环）
4. 文字"正在抽取辩题..."加省略号动画 `...` 循环
5. 副标题加假进度条（即使假进度也提升体验）

**修改 `src/renderer/src/components/draw/BigScreen.tsx`**：
1. 顶部加题目索引圆点指示器（已揭晓=实心金色，未揭晓=空心灰色）
2. team 卡片加边框 `1px solid rgba(255,255,255,0.2)` + boxShadow
3. "VS" 字加 `textShadow: 0 0 20px rgba(255,214,102,0.6)` + 缩放动画
4. 底部按钮组加 `padding: 16 32` + `background: rgba(0,0,0,0.3)` + `borderRadius: 12` + `backdropFilter: blur(10px)`
5. "下一题"按钮改金色脉冲 + 加大 `height: 64, fontSize: 20`
6. "按 ESC 退出"改 `<kbd>` 键盘按键样式
7. 右上角加全屏按钮（FullscreenOutlined）调用 `document.documentElement.requestFullscreen()`
8. 切换题目时旧卡片向左滑出+淡出，新卡片从右滑入+淡入
9. 进入大屏时先播放"洗牌"动画（题卡快速切换 1.5s）再揭晓

**修改 `src/renderer/src/components/draw/DrawConfigPanel.tsx`**：
1. Card title 加左侧 4px 蓝色竖条 + paddingLeft 8
2. Form size 改 middle
3. Divider 改 `<Divider plain orientation="left">持方配置</Divider>`
4. 主按钮加 `borderRadius: 8, height: 44, fontSize: 16, fontWeight: 600, boxShadow: '0 4px 12px rgba(22,119,255,0.4)'`
5. "请完善配置"提示改 `<Alert type="warning" showIcon banner size="small">`

**修改 `src/renderer/src/components/draw/DrawResultList.tsx`**：
1. 空结果加"重新抽取"按钮 + 失败原因说明
2. 顶部操作栏左侧加 ✓ 圆形图标背景
3. 题源比例 Tag 加颜色区分（官方=blue，自定义=purple）
4. 桌面端列表改 `grid: repeat(2, 1fr)` 双列
5. 错落动画改 `animationDelay: ${idx * 0.08}s` 内联

**修改 `src/renderer/src/styles/draw.css`**：
1. `fade-up` 缓动函数改 `cubic-bezier(0.34, 1.56, 0.64, 1)` 弹性效果
2. `fade-up-delay-*` 改 CSS 变量 `--delay: calc(var(--i) * 0.08s)`
3. `draw-spin` 加缩放呼吸
4. `bigscreen-overlay` 加 SVG 噪点纹理 + 径向光晕 + 慢速漂移动画
5. `bigscreen-topic-title` 加 `@media (max-width: 1200px) { font-size: 40px }` 响应式
6. `bigscreen-versus` gap 改 `clamp(24px, 5vw, 60px)` 响应式
7. `pulse-primary` 改 `currentColor` 或 CSS 变量驱动

**验收**：DrawPage 空态有引导、抽取动画有粒子背景、大屏投影有索引指示和过渡动画

---

### 阶段 4：题库管理页 + 题卡美化

**目标**：题库管理页视觉层次清晰

**修改 `src/renderer/src/pages/TopicLibrary.tsx`**：
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

**修改 `src/renderer/src/components/TopicCard.tsx`**：
1. 选中态加 `boxShadow: 0 4px 12px rgba(22,119,255,0.15)` + 顶部 2px 蓝条
2. 标题 fontSize 改 15、lineHeight 1.6
3. 标签行 gap 改 6；难度标签用语义化色板（入门=绿、进阶=橙、专业=红）的渐变背景
4. 来源+权重区 borderTop 改 `1px solid` + 权重数字用 Tag 包裹
5. 列表行 padding 改 `16px 20px`；hover 态加 `background: token.colorFillQuaternary`
6. 列表分割线 `#f0f0f0` 改 `token.colorSplit`
7. 黑名单颜色 `#999` 改 `token.colorTextDisabled`

**修改 `src/renderer/src/components/FilterPanel.tsx`**：
1. 抽屉式面板视觉优化（背景、间距、按钮风格统一）

**修改 `src/renderer/src/components/ImportTopicsModal.tsx`**：
1. 表单间距优化，按钮统一风格

**修改 `src/renderer/src/components/DedupResultModal.tsx`**：
1. 重复组展示视觉优化（重复组卡片化、相似度可视化条）

**修改 `src/renderer/src/components/TopicEditModal.tsx`**：
1. 表单间距优化，按钮统一风格

**验收**：题库管理页 Tree 有图标和计数、题卡有选中态阴影、分页栏 sticky

---

### 阶段 5：赛事/队伍/历史/设置页美化

**修改 `src/renderer/src/pages/EventManage.tsx`**：
1. 顶部工具栏加赛事总数 `<Tag>` + 状态分布统计（筹备中 3 / 进行中 2 / 已结束 5）
2. 赛事列表改卡片网格视图（每张赛事卡显示名称、状态徽章、轮次数、队伍数、操作按钮）
3. Table pagination 加 `showTotal: (t) => 共 ${t} 场赛事`
4. 赛事详情 Card 加 marginTop 16；详情头部加大色块背景区分
5. Tabs label 中 `<Tag>` 用 `color="blue"` 而非默认色
6. 难度梯度预设 Card hover 时 `transform: translateY(-2px)` + boxShadow；选中态加蓝色边框
7. Alert warning 改 `banner` 模式
8. 赛事操作列加"标记为已结束"下拉项
9. 详情卡片头部加 `Progress` 条显示已完成轮次/总轮次

**修改 `src/renderer/src/pages/TeamManage.tsx`**：
1. 顶部加"按赛事分组"切换按钮
2. 加"历史辩题数 ≥ N"的 InputNumber 筛选
3. 队伍列表改卡片网格（每张队伍卡显示名称、赛事 Tag、历史辩题数、操作）
4. 历史辩题数 `Tag color="orange"` 改：数字 ≥ 5 用红色，1-4 用橙色，0 用灰色
5. 顶部加"添加队伍"主按钮（弹出赛事选择 + 队伍名输入）
6. 加视图切换：列表 / 按赛事分组（Collapse 折叠面板）

**修改 `src/renderer/src/pages/History.tsx`**：
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

**修改 `src/renderer/src/pages/Settings.tsx`**：
1. 去重设置 Tab 改 `<Row justify="center"><Col span={16}>` 响应式
2. Card title 旁加 `<Tag color="blue">必选</Tag>` / `<Tag color="orange">可选</Tag>`
3. 每个 InputNumber 旁加可视化进度条反映阈值大小
4. AI 语义层 Alert 改 `banner` + 图标动画
5. "保存设置"/"立即执行"按钮组主按钮加 `size="large"`，保存加 ✓ 图标，保存成功后短暂显示绿色
6. 4 个 Statistic 卡片加左侧色块背景（题库总数=蓝、官方=绿、版本=紫、已加载=橙）
7. Statistic "已加载" 改 `<Tag color="green">已加载</Tag>` / `<Tag color="orange">未加载</Tag>`
8. Paragraph 灰色文字改 `<Steps>` 当前步骤指示
9. 数据导入导出 Tab 改左右分栏：左数据导出、右数据导入
10. 多个 `Divider orientation="left"` 改 `<Typography.Title level={5}>` + 下方描述
11. `EventPackageExport` 子组件加 `<Alert type="info">` 说明导出包含的数据
12. 各 Tab 底部加"恢复默认设置"次按钮
13. 表单脏时顶部加 `<Alert>未保存的修改</Alert>`

**修改 `src/renderer/src/components/EventEditModal.tsx / RoundEditModal.tsx / TeamEditModal.tsx`**：
1. 表单间距优化，按钮统一风格

**验收**：所有页面 Statistic 卡片有色块、列表卡片化、表单风格统一

---

### 阶段 6：Bug 修复（全量）

#### 6.1 高优先级 Bug 修复

**修改 `src/renderer/src/pages/TopicLibrary.tsx`**（511-513 行）：
```tsx
// 原：sel ? store.toggleSelect(id) : store.toggleSelect(id)
// 改：直接调用 toggleSelect，由 store 内部处理切换
onSelect={(id) => store.toggleSelect(id)}
```
实际查看 TopicCard 的 `onSelect` 语义，如果 `sel` 表示新状态，则改：
```tsx
onSelect={(id, sel) => sel ? store.select(id) : store.deselect(id)
```
（需先检查 topicStore 是否有 select/deselect 方法，若无则添加）

**修改 `src/main/db/repository/topic.repo.ts`**（120-131 行）：
```ts
// 新增 LIKE 转义辅助函数
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}
// tag 查询
const escapedTag = escapeLike(tag)
params.push(`%"${escapedTag}"%`)
// SQL 加 ESCAPE 子句：AND tags LIKE ? ESCAPE '\\'

// keyword 查询
const escapedKeyword = escapeLike(filter.keyword)
params.push(`%${escapedKeyword}%`)
// SQL 加 ESCAPE 子句：AND title LIKE ? ESCAPE '\\'
```

**修改 `src/main/ipc/audit.ipc.ts / export.ipc.ts / system.ipc.ts`**：
```ts
// 原：const win = BrowserWindow.getFocusedWindow()!
// 改：
const win = BrowserWindow.getFocusedWindow()
if (!win) {
  return { success: false, error: '无可用窗口' }
}
```
封装为工具函数 `getActiveWindow()` 放在 `src/main/ipc/utils.ts`

**修改 `src/shared/types.ts`**（294 行）：
```ts
// 原：EVENT_DELETE: 'event:event_delete'
// 改：EVENT_DELETE: 'event:delete'
```
确认 preload/index.ts 和 event.ipc.ts 都使用 IPC_CHANNELS.EVENT_DELETE 常量引用，无需改其他文件

**修改 `src/shared/types.ts`**（新增常量）：
```ts
// 在 IPC_CHANNELS 中添加
SYSTEM_PICK_FILE: 'system:pickFile'
```
**修改 `src/preload/index.ts`**（137 行）：
```ts
pickFile: (filters) => invoke<string | null>(IPC_CHANNELS.SYSTEM_PICK_FILE, filters)
```
**修改 `src/main/ipc/system.ipc.ts`**（14 行）：
```ts
ipcMain.handle(IPC_CHANNELS.SYSTEM_PICK_FILE, ...)
```

#### 6.2 中优先级 Bug 修复

**修改 `src/main/ipc/import.ipc.ts`**（57-95 行）— 优化导入去重性能：
```ts
// 原：每条新题调一次 findDuplicates([newTopic, ...allCandidates])
// 改：一次性对新题集合调 findDuplicates
const allNewTopics = rows.map(...)
const allCandidates = topicRepo.listTopics({ pageSize: 100000 }).items
const allTopics = [...allNewTopics, ...allCandidates]
const dupGroups = await findDuplicates(allTopics, options)
// 仅保留包含新题的组作为 duplicates 返回
```

**修改 `src/main/services/dedup-engine.ts`** — 加倒排索引预筛：
```ts
// 在 findDuplicates 入口加 bigram 倒排索引
function buildBigramIndex(topics: Topic[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>()
  topics.forEach((t, i) => {
    const bigrams = extractBigrams(t.title)
    bigrams.forEach(b => {
      if (!index.has(b)) index.set(b, new Set())
      index.get(b)!.add(i)
    })
  })
  return index
}
// 在文本层两两循环前，先用倒排索引筛出候选对（至少 1 个 bigram 重合的对）
// 复杂度从 O(n²) 降到 O(候选对数)
```

**修改 `src/main/services/import-engine.ts`**（171 行）— CSV 编码自动检测：
```ts
// 引入 iconv-lite（如未安装则 npm install iconv-lite）
import * as iconv from 'iconv-lite'
import * as fs from 'fs'

// 在 readCsv 中：
const buffer = fs.readFileSync(filePath)
// 检测 BOM
let encoding = 'utf-8'
if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
  encoding = 'utf-8' // UTF-8 BOM
} else if (buffer[0] === 0xff && buffer[1] === 0xfe) {
  encoding = 'utf-16le'
} else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
  encoding = 'utf-16be'
} else {
  // 启发式：检测是否包含 GBK 范围字节
  encoding = detectEncoding(buffer) // 简单实现：含 0x80-0xFE 字节且非 UTF-8 有效序列则视为 GBK
}
const text = iconv.decode(buffer, encoding)
const workbook = XLSX.read(text, { type: 'string', codepage: 65001 })
```

**修改 `src/preload/index.ts`** — 消除 10 处 `@ts-ignore`：
```ts
// 方案：在 preload/index.ts 顶部显式导入 d.ts 类型
import type {
  TopicAPI, EventAPI, DrawAPI, AuditAPI, SettingsAPI, ImportAPI, ExportAPI, DedupAPI, FileAPI
} from './index.d.ts'

// 然后将各 API 对象标注类型：
const topicAPI: TopicAPI = { ... }
// ...

// else 分支中：
;(window as any).topicAPI = topicAPI  // 仍需 as any，但避免 @ts-ignore
// 或更优：直接 (window as Window & typeof globalThis).topicAPI = topicAPI
```

**修改 `src/preload/index.ts`** — 替换 26 处 `any` 类型：
```ts
import type {
  TopicFilter, TopicCreateInput, TopicUpdateInput,
  EventFilter, EventCreateInput, ...
} from '../shared/types'

const topicAPI: TopicAPI = {
  list: (filter?: TopicFilter) => invoke(IPC_CHANNELS.TOPIC_LIST, filter),
  create: (data: TopicCreateInput) => invoke(IPC_CHANNELS.TOPIC_CREATE, data),
  // ...
}
```
（需先在 shared/types.ts 中补充各 CreateInput/UpdateInput 类型，可能已存在）

**修改 `src/renderer/src/pages/History.tsx`**（100-105 行）— useEffect 依赖修复：
```tsx
useEffect(() => {
  void eventStore.listEvents()
  if (topicStore.items.length === 0) {
    void topicStore.fetchList({ pageSize: 1000 })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
// 改为：明确依赖 store 稳定引用（zustand store 实例稳定，可不写依赖）
// 或：拆分为两个 effect，每个只引用一个 store
```
（实际：zustand store 实例在组件生命周期内稳定，空依赖是正确写法，但需保留 eslint-disable 注释或重构）

**修改 `src/renderer/src/pages/History.tsx`**（160-162 行）— catch 块使用 e：
```tsx
} catch (e) {
  console.error('加载明细失败', e)
  messageApi.error(e instanceof Error ? e.message : '加载明细失败')
}
```

#### 6.3 低优先级 Bug 修复

**修改 `src/main/db/repository/event.repo.ts`**（56-61 行）— 删除未使用的 SessionListFilter 接口

**修改 `src/main/ipc/export.ipc.ts`**（37 行）— 删除 `void wrap` 死代码

**修改 `src/main/services/dedup-engine.ts`**（240 行）：
```ts
// 原：this.bestReason.set(ri, curSim >= sim ? this.bestReason.get(ri)! : reason)
// 改：this.bestReason.set(ri, curSim >= sim ? (this.bestReason.get(ri) ?? reason) : reason)
```

#### 6.4 类型安全增强（低优先级，但提升长期可维护性）

**修改 `src/main/db/repository/*.repo.ts`** — 定义 Row 接口替代 `as any`：
```ts
// 在 topic.repo.ts 顶部
interface TopicRow {
  id: string; title: string; type: string; domain: string | null;
  difficulty: string; source: string; tags: string | null;
  weight: number; status: string; created_at: string; updated_at: string;
}
// stmt.get() as TopicRow
```
其他 repo 同理

**修改 `src/shared/types.ts`** — 为 DrawSession.settings 和 AuditLog.detail 定义具体接口：
```ts
export interface DrawSessionSettings {
  source_mix_ratio?: number
  difficulty_override?: Record<string, number>
  // ...
}
export interface AuditLogDetail {
  action?: string
  count?: number
  ids?: string[]
  [key: string]: unknown
}
```

**验收**：npm run typecheck 通过，npm test 全部通过，应用启动无报错

---

## 三、最终验证阶段

### 步骤 1：类型检查
```bash
npm run typecheck
```
预期：通过，无错误无警告

### 步骤 2：单元测试
```bash
npm test
```
预期：67 个测试全部通过

### 步骤 3：开发服务器启动
```bash
npm run dev
```
预期：
- Electron 窗口正常打开
- 控制台无错误
- 数据库 9 张表初始化成功
- 官方题库加载成功

### 步骤 4：功能验证清单

#### 抽取页（/draw）
- [ ] 空状态显示三步引导卡片
- [ ] 选择赛事/轮次/题量后点击"开始抽取"正常执行
- [ ] 抽取动画显示粒子背景 + 同心圆波纹
- [ ] 抽取结果显示双列卡片 + 错落动画
- [ ] 点击"大屏模式"进入投影视图
- [ ] 大屏顶部显示题目索引圆点指示器
- [ ] 大屏切换题目有滑入滑出动画
- [ ] 按 R 重抽 / 按 F 投屏 / 按 Esc 退出 快捷键工作
- [ ] 大屏右上角全屏按钮工作

#### 题库管理（/topics）
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

#### 赛事管理（/events）
- [ ] 顶部显示赛事总数 + 状态分布统计
- [ ] 赛事列表显示卡片网格视图
- [ ] 赛事详情头部显示 Progress 进度条
- [ ] 难度梯度预设 Card hover 有上浮效果
- [ ] 点击"跳转抽取"携带 eventId/roundId 到 DrawPage
- [ ] 创建/编辑/删除赛事/轮次/队伍正常

#### 队伍管理（/teams）
- [ ] 顶部显示"按赛事分组"切换按钮
- [ ] 队伍列表显示卡片网格视图
- [ ] 历史辩题数 Tag 颜色按数量变化（0灰/1-4橙/≥5红）
- [ ] "添加队伍"按钮工作
- [ ] 视图切换（列表/分组）工作

#### 历史记录（/history）
- [ ] 顶部显示 4 个 Statistic 统计卡（今日/本周/总数/重抽）
- [ ] Tabs label 显示 Badge 计数
- [ ] 筛选条 Card 网格布局
- [ ] 展开行显示 Skeleton 骨架屏后加载明细
- [ ] 导出按钮工作（xlsx/csv/json）
- [ ] "清空日志"二次确认有 description 说明

#### 设置（/settings）
- [ ] 去重设置 Tab 居中响应式布局
- [ ] Card title 旁显示"必选"/"可选"Tag
- [ ] 阈值 InputNumber 旁显示可视化进度条
- [ ] 4 个 Statistic 卡片显示左侧色块
- [ ] "已加载"显示绿色 Tag
- [ ] 保存按钮加 ✓ 图标，保存成功后短暂显示绿色
- [ ] 各 Tab 底部显示"恢复默认设置"按钮
- [ ] 表单脏时顶部显示"未保存的修改"Alert

#### 全局
- [ ] Sider Logo 显示渐变背景圆形图标 + 副标题"v1.0"
- [ ] Header 显示面包屑 + 右侧快捷操作
- [ ] Content 背景显示渐变
- [ ] 按钮统一样式（hover 有上浮 + 过渡）
- [ ] 切换路由时无闪烁

### 步骤 5：响应式验证
- 调整窗口宽度到 768px、1024px、1280px、1920px
- 各页面布局正确响应
- DrawPage Sider 在小屏自动折叠

### 步骤 6：性能验证
- 题库导入 100 条新题到 1000 条题库应在 3 秒内完成
- 全库去重检查 5000 条题库应在 5 秒内完成
- 抽取动画流畅无卡顿

---

## 四、关键假设与决策

### 假设
1. 用户已安装所有依赖（package.json 中已声明）
2. 数据库已初始化，官方题库已加载
3. 测试 fixtures 文件存在（topics.xlsx/csv/docx）

### 决策
1. **不引入 Tailwind CSS**：保持现有 inline style 风格，仅通过共享样式常量减少重复
2. **不引入 styled-components**：避免运行时开销，保持构建简单
3. **不引入 CSS Module**：仅对 BigScreen 等需要伪类/媒体查询的场景保留 draw.css
4. **iconv-lite**：用于 CSV 编码检测，需要 npm install
5. **暗色模式**：仅预留 theme.ts 抽离，不实际实现暗色模式（避免工作量爆炸）
6. **测试补充**：不补 IPC/Repository/Renderer 层测试（不在本次范围内）
7. **响应式断点**：使用 antd 内置 Grid + Sider breakpoint，不引入额外库

### 风险
1. **iconv-lite 安装失败**：备选方案，仅做 BOM 检测，GBK 文件显示乱码提示用户转码
2. **倒排索引优化改动大**：备选方案，仅做 title 长度预筛 + 分批处理
3. **preload 类型完整化可能引入新错误**：备选方案，保留 `as any` 但加详细注释

---

## 五、文件改动清单汇总

### 新建文件（4 个）
- `src/renderer/src/styles/tokens.ts`
- `src/renderer/src/styles/theme.ts`
- `src/renderer/src/styles/shared.ts`
- `src/renderer/src/styles/animations.css`

### 修改文件（约 25 个）

**主进程**（7 个）：
- `src/shared/types.ts` — EVENT_DELETE 命名、SYSTEM_PICK_FILE 常量、DrawSessionSettings/AuditLogDetail 接口
- `src/main/ipc/system.ipc.ts` — 用 IPC_CHANNELS.SYSTEM_PICK_FILE
- `src/main/ipc/audit.ipc.ts` — getFocusedWindow 空指针保护
- `src/main/ipc/export.ipc.ts` — getFocusedWindow 空指针保护 + 删除 `void wrap`
- `src/main/ipc/import.ipc.ts` — 优化导入去重性能
- `src/main/services/dedup-engine.ts` — 倒排索引优化 + bestReason 非空断言修复
- `src/main/services/import-engine.ts` — CSV 编码自动检测
- `src/main/db/repository/topic.repo.ts` — LIKE 转义 + TopicRow 接口
- `src/main/db/repository/event.repo.ts` — 删除未使用 SessionListFilter + EventRow 接口
- `src/main/db/repository/draw.repo.ts` — DrawRow 接口
- `src/main/db/repository/audit.repo.ts` — AuditLogRow 接口

**Preload**（2 个）：
- `src/preload/index.ts` — 消除 @ts-ignore + 替换 any 类型 + 用 IPC_CHANNELS.SYSTEM_PICK_FILE
- `src/preload/index.d.ts` — 类型完善

**渲染进程**（约 15 个）：
- `src/renderer/src/App.tsx` — 主题扩展 + Sider/Header/Content 改造
- `src/renderer/src/main.tsx` — 引入 animations.css
- `src/renderer/src/styles/draw.css` — 动画优化 + CSS 变量
- `src/renderer/src/pages/DrawPage.tsx` — 空状态 + 快捷键 + Breadcrumb
- `src/renderer/src/pages/TopicLibrary.tsx` — Tree 图标 + 分页 sticky + toggleSelect 修复
- `src/renderer/src/pages/EventManage.tsx` — 卡片网格 + Progress 进度条
- `src/renderer/src/pages/TeamManage.tsx` — 卡片网格 + 分组视图
- `src/renderer/src/pages/History.tsx` — Statistic 卡片 + Skeleton + catch 修复 + Avatar
- `src/renderer/src/pages/Settings.tsx` — Statistic 色块 + 恢复默认 + Alert
- `src/renderer/src/components/draw/DrawAnimation.tsx` — 粒子背景 + 同心圆波纹
- `src/renderer/src/components/draw/BigScreen.tsx` — 索引指示器 + 过渡动画 + 全屏按钮
- `src/renderer/src/components/draw/DrawConfigPanel.tsx` — 蓝色竖条 + 按钮阴影
- `src/renderer/src/components/draw/DrawResultList.tsx` — 双列 + 错落动画
- `src/renderer/src/components/TopicCard.tsx` — 选中态阴影 + Tag 化权重
- `src/renderer/src/components/FilterPanel.tsx` — 视觉优化
- `src/renderer/src/components/ImportTopicsModal.tsx` — 表单优化
- `src/renderer/src/components/DedupResultModal.tsx` — 重复组卡片化
- `src/renderer/src/components/TopicEditModal.tsx` — 表单优化
- `src/renderer/src/components/EventEditModal.tsx` — 表单优化
- `src/renderer/src/components/RoundEditModal.tsx` — 表单优化
- `src/renderer/src/components/TeamEditModal.tsx` — 表单优化

### 新增依赖（1 个）
- `iconv-lite`（用于 CSV 编码检测）

---

## 六、执行顺序与依赖

```
阶段 1（架构准备）
  ├─ tokens.ts / theme.ts / shared.ts / animations.css
  └─ App.tsx 引用 theme.ts
       ↓
阶段 2（全局布局）
  └─ App.tsx Sider/Header/Content 改造
       ↓
阶段 3（核心页面）
  ├─ DrawPage.tsx
  ├─ DrawAnimation.tsx + draw.css
  ├─ BigScreen.tsx
  ├─ DrawConfigPanel.tsx
  └─ DrawResultList.tsx
       ↓
阶段 4（题库管理页）
  ├─ TopicLibrary.tsx
  ├─ TopicCard.tsx
  └─ FilterPanel/ImportTopicsModal/DedupResultModal/TopicEditModal
       ↓
阶段 5（其他页面）
  ├─ EventManage.tsx
  ├─ TeamManage.tsx
  ├─ History.tsx
  ├─ Settings.tsx
  └─ EventEditModal/RoundEditModal/TeamEditModal
       ↓
阶段 6（Bug 修复）
  ├─ 6.1 高优先级（5 项）
  ├─ 6.2 中优先级（7 项）
  ├─ 6.3 低优先级（3 项）
  └─ 6.4 类型安全增强
       ↓
最终验证
  ├─ npm run typecheck
  ├─ npm test
  ├─ npm run dev
  └─ 功能验证清单（30+ 项）
```

---

## 七、备注

1. 本计划基于 Phase 1 完整探索，所有文件路径、行号、问题描述均来自实际代码检查
2. 每个阶段完成后立即运行 `npm run typecheck` 验证，避免错误累积
3. UI 改造保持增量进行，每改一个文件验证一次，避免大爆炸式提交
4. Bug 修复优先于 UI 美化，但共享样式基础设施（阶段 1）必须先做
5. 若中途发现新 bug，记录到对应阶段并按优先级处理
