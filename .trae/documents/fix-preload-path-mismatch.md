# 修复 preload 路径不匹配导致 IPC 全部失效

> 生成时间：2026-07-25
> 范围：单个文件单行修复
> 目标：让 preload 脚本正确加载，恢复所有 `window.xxxAPI` 可用

---

## 一、根因分析

### 现象
- 队伍管理页报错：`Cannot read properties of undefined (reading 'listEvents')`
- 导入辩题弹窗报错：`Cannot read properties of undefined (reading 'pickFile')`

### 根因
1. `package.json` 设置 `"type": "module"`，项目为 ESM 模块系统
2. `electron-vite` 在 ESM 项目中默认将 preload 构建为 `.mjs` 文件
   - 实际产物：`out/preload/index.mjs`（已通过 Glob 确认）
3. `src/main/index.ts:22` 中 preload 加载路径写死为 `.js`：
   ```ts
   preload: join(__dirname, '../preload/index.js')
   ```
4. Electron 找不到 `out/preload/index.js`，preload 脚本未加载
5. 渲染进程中 `window.eventAPI`、`window.fileAPI` 等全部为 `undefined`
6. 任何 IPC 调用都抛出 "Cannot read properties of undefined (reading 'xxx')"

### 为什么 typecheck/test 通过
- TypeScript 类型检查不验证运行时文件路径
- 单元测试 mock 了 better-sqlite3 和 IPC，不实际加载 preload
- dev 启动时主进程日志正常（数据库、IPC handler 注册都在主进程内），preload 加载失败不会导致主进程崩溃

### 为什么之前的会话报告"应用启动成功"
- 之前的验证只检查了主进程日志（`[main] Database initialized` / `[main] All IPC handlers registered`）
- 没有实际点击页面按钮触发 IPC 调用
- UI 渲染不依赖 preload，只有调用 IPC 时才报错

---

## 二、修复方案

### 修改文件
**`src/main/index.ts`** 第 22 行

#### 修改前
```ts
preload: join(__dirname, '../preload/index.js'),
```

#### 修改后
```ts
preload: join(__dirname, '../preload/index.mjs'),
```

### 为什么直接用 `.mjs` 而不是动态判断

1. **项目已锁定 ESM**：`package.json` 的 `"type": "module"` 是项目级配置，不会按环境切换
2. **electron-vite 行为一致**：dev 和 build 模式下 preload 都输出 `.mjs`
3. **YAGNI**：不引入不必要的动态判断逻辑，保持简单
4. **符合 electron-vite 官方推荐**：ESM 项目中 preload 用 `.mjs` 扩展名

### 不修改的内容
- `electron.vite.config.ts` — 配置正确，无需修改
- `src/preload/index.ts` — 代码正确，无需修改
- `src/preload/index.d.ts` — 类型声明正确
- 所有渲染进程页面/组件 — 错误根因不在它们

---

## 三、验证步骤

### 步骤 1：修改后运行 typecheck
```bash
npm run typecheck
```
预期：通过（路径字符串字面量不影响类型检查）

### 步骤 2：启动 dev 服务器
```bash
npm run dev
```
预期：
- Electron 窗口正常打开
- 主进程日志显示数据库初始化、IPC 注册成功
- 控制台不再出现 preload 加载失败警告

### 步骤 3：功能验证

#### 队伍管理页（/teams）
- [ ] 页面加载不报错
- [ ] 队伍列表正常显示
- [ ] 历史辩题数 Tag 颜色正确（0灰/1-4橙/≥5红）
- [ ] 添加/编辑/删除队伍正常

#### 导入辩题功能
- [ ] 题库管理页点击"导入"按钮，ImportTopicsModal 正常打开
- [ ] 点击"选择文件"按钮，调用 `window.fileAPI.pickFile` 不报错
- [ ] 文件选择对话框弹出
- [ ] 选择 .xlsx/.csv/.docx 文件后解析正常

#### 其他页面回归验证
- [ ] 抽取页（/draw）能选择赛事、轮次，点击抽取正常
- [ ] 题库管理（/topics）列表正常加载
- [ ] 赛事管理（/events）赛事列表正常
- [ ] 历史记录（/history）记录列表正常
- [ ] 设置（/settings）设置项加载正常

### 步骤 4：单元测试
```bash
npm test -- --run
```
预期：67 个测试全部通过

---

## 四、假设与决策

### 假设
1. `electron-vite` 在 `"type": "module"` 项目中 dev 和 build 都输出 `.mjs`（已通过 dev 日志确认 dev 模式输出 `.mjs`）
2. 修复后所有 `window.xxxAPI` 都会被正确暴露

### 决策
1. **直接改 `.mjs` 而非动态判断**：项目 ESM 配置稳定，不需要按环境切换
2. **不修改其他文件**：根因是单行路径错误，其他代码都正确
3. **不添加 fallback 逻辑**：YAGNI，避免引入不必要的复杂度

### 风险
1. **生产构建输出 `.js`**：极低概率，electron-vite 在 ESM 项目中默认统一输出 `.mjs`。若发生，可在 build 后验证 `out/preload/` 目录
2. **其他隐藏 bug**：preload 修复后可能暴露其他被掩盖的问题（如 IPC handler 实现 bug），需要按步骤 3 全量回归验证

---

## 五、实施清单

- [ ] 修改 `src/main/index.ts:22`：`'../preload/index.js'` → `'../preload/index.mjs'`
- [ ] 运行 `npm run typecheck` 验证
- [ ] 运行 `npm test -- --run` 验证
- [ ] 运行 `npm run dev` 启动应用
- [ ] 验证队伍管理页正常加载
- [ ] 验证导入辩题功能文件选择正常
- [ ] 回归验证其他页面 IPC 调用正常
