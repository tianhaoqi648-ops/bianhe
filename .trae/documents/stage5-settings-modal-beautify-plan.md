# 阶段5剩余任务：Settings.tsx 美化 + 三 Modal 美化 + typecheck 修复

## 摘要

完成"抽辩题"项目阶段5的剩余美化工作：
1. **Settings.tsx** 全面美化（响应式布局/Tag/Progress/Alert banner/statCardStyle/左右分栏/Title level5/恢复默认按钮）
2. **三个 Modal 组件**（EventEditModal/RoundEditModal/TeamEditModal）应用 `primaryButtonStyle` 与 spacing tokens 优化
3. **typecheck 验证**：先修复 History.tsx 已存在的 `TodayOutlined` 未导入 Bug，再运行 `npm run typecheck`

## 当前状态分析

### Settings.tsx（src/renderer/src/pages/Settings.tsx）
- 已具备基本 Tab 结构（dedup / library / data 三个 Tab），但所有样式为 antd 默认
- 4 个统计卡片使用 `Card size="small"`，未应用 `statCardStyle`
- `Col span={6}` 固定布局，小屏会挤压
- `InputNumber` 无可视化反馈
- 多处 `Alert` 使用 `showIcon` 模式而非 `banner`
- 保存按钮为默认 size，无 `primaryButtonStyle`
- "已加载"显示文字"是/否"，未用 Tag
- 数据导出 Tab 内三段 `Divider` 分隔，未左右分栏
- 没有"恢复默认设置"按钮

### 三个 Modal 组件
- 均使用 `Form layout="vertical"`（已满足要求）
- Modal 自带 okButton，未应用 `primaryButtonStyle`
- Form.Item 间距为 antd 默认

### History.tsx（已完成的文件，存在一个 Bug）
- 第 570 行使用了 `<TodayOutlined style={{ color: '#1677ff' }} />` 图标
- 但 import 块（28-40 行）未导入 `TodayOutlined`
- typecheck 必然报错，需补充导入

## 提议变更

### 文件 1: `src/renderer/src/pages/Settings.tsx`（全面美化）

**Imports 调整**：
- 新增 `Progress`, `Tag` 从 'antd' 导入
- 新增 `RestoreOutlined` 从 '@ant-design/icons' 导入
- 从 `../styles/shared` 导入 `toolbarStyle`, `cardStyle`, `statCardStyle`, `primaryButtonStyle`, `titleBarStyle`, `pageContainerStyle`
- 从 `../styles/tokens` 导入 `spacing`, `shadow`, `transition`

**renderDedupTab() 改造**：
- 顶部 `Alert` 改为 `banner` 模式（去掉 showIcon，加 `banner` 属性）
- 文本匹配 Card / AI 语义 Card 标题应用 `titleBarStyle`
- 为 `Levenshtein` 距离阈值（1-20）添加 `Progress` 可视化：`percent={(levenshtein/20)*100}` 显示当前阈值位置
- 为 `关键词重合度阈值`（0-1）添加 `Progress` 可视化：`percent={keyword*100}`
- 为 `AI 相似度阈值`（0-1）添加 `Progress` 可视化：`percent={aiThreshold*100}`
- 必选项（启用开关）添加 `<Tag color="red">必选</Tag>`，可选项（阈值项）添加 `<Tag>可选</Tag>`
- AI 语义层 Card 标题添加 `<Tag color="orange">可选</Tag>`
- 底部 `Space` 改为：
  - 保存按钮应用 `primaryButtonStyle` + `size="large"` + `CheckCircleOutlined` 图标
  - 新增"恢复默认"按钮（`RestoreOutlined`），点击后用 Modal.confirm 二次确认，将所有阈值重置为 DEFAULTS

**renderLibraryTab() 改造**：
- 4 个统计 `Card` 应用 `statCardStyle(color)`：
  - 题库总数 → `statCardStyle('#1677ff')`
  - 官方题库 → `statCardStyle('#52c41a')`
  - 内置版本 → `statCardStyle('#722ed1')`
  - 已加载 → `statCardStyle('#faad14')`
- `Row gutter={[spacing.lg, spacing.lg]}`，4 个 `Col` 改为响应式：`xs={12} sm={12} md={6}`
- "已加载"统计 `value` 由文字"是/否"改为 `<Tag color="green">已加载</Tag>` 或 `<Tag color="default">未加载</Tag>`
- 三个 Card 标题（官方题库/题库导入/题库导出）应用 `titleBarStyle`
- 内部段落使用 `Typography.Paragraph` 保持不变

**renderDataTab() 改造**：
- 顶部 `Alert` 改为 `banner` 模式
- 数据导出 Card 内部布局改为**左右分栏**：用 `Row` 包裹
  - 左侧 `Col xs={24} md={12}`：题库导出（三个按钮 Excel/CSV/JSON）
  - 右侧 `Col xs={24} md={12}`：抽取记录导出（三个按钮 Excel/CSV/JSON）
- "赛事数据包（JSON）" 作为下方独立行（保留 `EventPackageExport` 子组件）
- 数据导入 Card 与去重检查 Card 并排左右分栏：`Row gutter={[spacing.lg, spacing.lg]}`
- Card 标题应用 `titleBarStyle`
- 替换 `Divider` 为 `Typography.Title level={5}`（更现代的层级标题）

**顶部 Layout 容器**：
- 顶部工具栏 div 应用 `toolbarStyle` 替代内联样式
- 文字"系统设置"应用 `titleBarStyle`
- "刷新"按钮加 `ReloadOutlined`（已有）
- 用 `Skeleton` 替代 `Spin`（仅在初次加载时显示骨架屏，加载完成后正常显示 Tab）

### 文件 2: `src/renderer/src/components/EventEditModal.tsx`

**Imports 调整**：
- 从 `../styles/shared` 导入 `primaryButtonStyle`
- 从 `../styles/tokens` 导入 `spacing`

**Modal 改造**：
- 添加 `okButtonProps={{ style: primaryButtonStyle }}`
- 添加 `cancelButtonProps={{ style: { borderRadius: 8 } }}`
- Form.Item 之间用 `style={{ marginBottom: spacing.lg }}` 优化间距（仅给非最后一项）
- 状态 Select 选项保留 STATUS_OPTIONS
- 日期 Input 添加 `prefix={<CalendarOutlined />}` 视觉提示（需导入 `CalendarOutlined`）

### 文件 3: `src/renderer/src/components/RoundEditModal.tsx`

**Imports 调整**：
- 从 `../styles/shared` 导入 `primaryButtonStyle`
- 从 `../styles/tokens` 导入 `spacing`
- 从 `@ant-design/icons` 导入 `CalendarOutlined`（如需要）

**Modal 改造**：
- 添加 `okButtonProps={{ style: primaryButtonStyle }}`
- 添加 `cancelButtonProps={{ style: { borderRadius: 8 } }}`
- "轮次名称" Form.Item 加 `tooltip="留空则按轮次序号自动生成"`
- "本轮题量" Form.Item 加 `tooltip="建议 4-8 题"`
- Form.Item 间距优化

### 文件 4: `src/renderer/src/components/TeamEditModal.tsx`

**Imports 调整**：
- 从 `../styles/shared` 导入 `primaryButtonStyle`
- 从 `../styles/tokens` 导入 `spacing`

**Modal 改造**：
- 添加 `okButtonProps={{ style: primaryButtonStyle }}`
- 添加 `cancelButtonProps={{ style: { borderRadius: 8 } }}`
- "队伍名称" Form.Item 加 `tooltip="2-50 字符，避免特殊符号"`
- Form.Item 间距优化

### 文件 5: `src/renderer/src/pages/History.tsx`（Bug 修复）

**第 28-40 行 import 块**：
- 在 `@ant-design/icons` 导入列表中添加 `TodayOutlined`
- 修复第 570 行 `<TodayOutlined style={{ color: '#1677ff' }} />` 引用未定义图标的 TS 错误

## 假设与决策

1. **`primaryButtonStyle` 在 Modal 上的应用方式**：通过 `okButtonProps={{ style: primaryButtonStyle }}` 传递。虽然 `primaryButtonStyle` 的 `height: 44` 可能比 Modal 默认按钮略大，但与项目其他页面（如 EventManage / TeamManage）的按钮风格保持一致，符合"统一视觉"目标。

2. **Settings.tsx 的 Skeleton 替换 Spin**：仅在 settingsStore 首次加载（`settingsStore.settings` 为空对象时）显示 Skeleton 骨架屏；已加载后切换 Tab 不再触发 Skeleton，避免闪烁。

3. **Progress 可视化的范围**：仅对三个数值阈值（Levenshtein 1-20、关键词 0-1、AI 相似度 0-1）添加 Progress，因为它们都有明确上下界。开关类配置不加 Progress。

4. **"恢复默认"按钮的确认弹窗**：使用 `Modal.confirm` 二次确认，避免误操作。重置后立即更新本地 state，但**不自动保存**——用户需再点"保存设置"才写入数据库。这一决策避免破坏现有"显式保存"模式。

5. **History.tsx 的 TodayOutlined 修复**：仅补充导入，不修改其他逻辑。该 Bug 是上一轮 History.tsx 美化时遗漏的导入，属于 typecheck 必须修复项。

6. **不引入新依赖**：所有美化通过现有 antd 5 组件 + 已有 styles/tokens 实现。

7. **保留所有现有功能**：仅做样式与 UI 增强，不修改业务逻辑、API 调用、状态管理。

## 验证步骤

1. **运行 typecheck**：
   ```powershell
   cd "f:\E-drive-25765\python项目\杂项目\抽辩题" ; npm run typecheck
   ```
   预期：main + renderer 两侧均通过，0 error。

2. **如有 typecheck 错误**：立即定位并修复（最可能为 import 缺失、类型不匹配）。

3. **最终汇报**：列出修改的文件、主要美化点、Bug 修复确认、typecheck 通过情况。

## 不在范围内

- 不重写 History.tsx（已完成美化）
- 不修改 EventManage.tsx / TeamManage.tsx（已完成美化）
- 不修改 stores / IPC / services / repository
- 不新增依赖
- 不创建新文件（除本计划文件）
