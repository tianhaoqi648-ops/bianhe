# 辩盒 Debate Box

辩盒是一款辩论赛题抽取与计时工具，提供题库管理、队伍/赛事管理、辩题抽取、计时器、赛制编辑等全流程能力，面向辩论赛组织者与参赛队伍。

## 功能特性

- **题库管理**：支持辩题的增删改查、批量导入导出、标签分类、难度分级、去重检测
- **赛事管理**：创建赛事、配置队伍/分组/轮次、赛制编辑（支持自定义环节与计时规则）
- **辩题抽取**：智能抽取算法（概率均衡、避免重复）、大屏展示模式、抽取历史回溯
- **计时器**：环节计时、自由辩论计时（单方/双方切换）、快捷键操作、大屏仪式感 UI、铃声提醒
- **赛制编辑**：自定义赛制模板、环节配置、铃声配置（剩余 30 秒/5 秒等时间点）
- **导入导出**：支持 Excel/CSV/Word 导入、字段映射、值映射（智能推荐）、批量操作
- **备份恢复**：全量数据备份与恢复、批次撤销
- **自定义字段**：支持为辩题添加自定义字段
- **主题切换**：亮色/暗色/跟随系统

### 主要功能页面

| 页面 | 功能说明 |
|------|---------|
| 题库管理 | 辩题 CRUD、批量导入导出、标签分类、难度分级、去重检测、自定义字段 |
| 赛事管理 | 创建赛事、配置队伍/分组/轮次 |
| 队伍管理 | 队伍信息维护 |
| 赛制编辑 | 自定义赛制模板、环节配置、铃声配置（剩余 30 秒/5 秒等） |
| 辩题抽取 | 智能抽取算法、大屏展示、抽取历史回溯 |
| 计时器 | 环节计时、自由辩论计时、大屏仪式感 UI、铃声提醒 |
| 历史记录 | 抽取与计时历史回溯 |
| 设置 | 去重配置、外观、数据管理、备份恢复、快捷键自定义、关于 |

## 下载安装

普通用户无需自行编译，直接从 GitHub Releases 下载对应平台的安装包即可：

👉 **[前往下载页面](https://github.com/tianhaoqi648-ops/bianhe/releases)**

### Windows
下载 `bianhe-x.y.z-setup.exe`，双击运行按提示安装。

### macOS
下载 `bianhe-x.y.z.dmg`，打开后将「辩盒」拖入「应用程序」文件夹。
> ⚠️ 首次打开若提示"无法验证开发者"：右键点击应用图标 → 选择「打开」→ 确认即可。

### Linux
- AppImage：下载 `bianhe-x.y.z.AppImage`，`chmod +x` 后直接运行
- deb：下载 `bianhe-x.y.z.deb`，`sudo dpkg -i` 安装

## 快捷键与操作指南

辩盒提供完整的快捷键系统，可在「设置 → 快捷键」中查看与自定义。

### 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+K` | 聚焦搜索框 / 打开命令面板 |
| `Esc` | 退出大屏 / 关闭弹窗 |
| `?` | 显示快捷键帮助 |
| `Ctrl+Z` | 撤销最近一步操作 |

### 题库管理

| 快捷键 | 功能 |
|--------|------|
| `/` | 聚焦搜索框 |
| `Ctrl+A` | 全选当前筛选结果 |
| `Delete` | 删除选中辩题 |
| `Ctrl+B` | 打开批量编辑弹窗 |

### 辩题抽取

| 快捷键 | 功能 |
|--------|------|
| `R` | 重新抽取 |
| `F` | 进入大屏 |
| `→` / `Space` | 下一题（大屏） |
| `←` | 上一题（大屏） |

### 计时器（小屏）

| 快捷键 | 功能 |
|--------|------|
| `Space` | 启动 / 暂停 / 恢复 |
| `P` | 中断（结束当前会话） |
| `←` / `→` | 上一环节 / 下一环节 |
| `Q` | +30 秒 |
| `W` | +5 秒 |
| `E` | 时间到（结束当前环节） |
| `F` | 进入大屏 |
| `S` | 切换发言方（仅自由辩论） |
| `R` | 重置当前环节（二次确认） |
| `Shift+R` | 全重置（清空所有进度，二次确认） |

### 计时器（大屏）

| 快捷键 | 功能 |
|--------|------|
| `Space` | 启动 / 暂停 / 恢复 |
| `P` | 中断（结束当前会话） |
| `←` / `→` | 上一环节 / 下一环节 |
| `Q` | +30 秒 |
| `W` | +5 秒 |
| `E` | 时间到（结束当前环节） |
| `F` | 切换浏览器全屏 |
| `B` | 关闭大屏 |
| `S` | 切换发言方（仅自由辩论） |
| `Esc` | 退出大屏 |

> 💡 大屏与小屏使用独立的快捷键作用域，避免冲突。大屏打开时小屏快捷键自动禁用。

## 数据存储与备份

### 数据存储位置

辩盒使用本地 SQLite 数据库存储所有数据，数据库文件位于 Electron 默认 userData 路径：

| 系统 | 路径 |
|------|------|
| Windows | `C:\Users\<用户名>\AppData\Roaming\辩盒\debate-drawer.db` |
| macOS | `~/Library/Application Support/辩盒/debate-drawer.db` |
| Linux | `~/.config/辩盒/debate-drawer.db` |

### 自动备份

- 应用每 24 小时自动备份一次数据库文件到 `userData/backups/` 目录
- 备份文件名格式：`YYYYMMDD-HHmmss.db`
- 最多保留最近 7 份备份，超出自动清理

### 手动备份与恢复

在「设置 → 备份」中可以：
- **全量导出**：将题库、赛事、队伍、抽取记录等业务数据导出为 JSON 备份文件（路径由用户选择）
- **全量导入**：从 JSON 备份文件恢复数据
- **批次管理**：查看与撤销导入批次

> 💡 JSON 备份文件大小上限 100 MB，适用于跨设备迁移和数据分享。

## 常见问题

### Windows SmartScreen 提示"Windows 已保护你的电脑"

辩盒当前未购买代码签名证书。点击「更多信息」→「仍要运行」即可继续安装。

### macOS 提示"无法验证开发者"或"无法打开"

辩盒当前未进行 Mac 代码签名与公证。右键点击应用图标 → 选择「打开」→ 在弹窗中点击「打开」即可。仅需首次执行一次。

### 安装失败 / 应用无法启动

1. 检查系统版本：Windows 10+ / macOS 11+ / Ubuntu 20.04+
2. 检查磁盘空间：至少 1 GB 可用
3. 检查杀毒软件是否拦截：将辩盒加入白名单
4. 查看日志：`userData/logs/` 目录下的日志文件

### 数据丢失 / 数据库损坏

1. 检查 `userData/backups/` 目录是否有近期备份
2. 在「设置 → 备份」中尝试从 JSON 备份恢复
3. 若仍无法恢复，请通过反馈邮箱联系

## 反馈与支持

| 渠道 | 联系方式 |
|------|---------|
| 反馈邮箱 | muyun648@qq.com |
| GitHub Issues | https://github.com/tianhaoqi648-ops/bianhe/issues |
| GitHub 仓库 | https://github.com/tianhaoqi648-ops/bianhe |

提交 Issue 时请附上：
- 辩盒版本号（在「关于」弹窗中查看）
- 操作系统与版本
- 复现步骤
- 截图或错误日志（如有）

## 安装与运行（开发者）

### 环境要求

- Node.js >= 18
- npm >= 9

### 开发模式

```bash
npm install
npm run dev
```

### 打包

```bash
# Windows（NSIS 安装包）
npm run build:win

# macOS（DMG）
npm run build:mac

# Linux（AppImage + deb）
npm run build:linux
```

### 自动发布到 GitHub Releases

推送 `v*.*.*` 格式的 tag 即可触发 GitHub Actions 自动构建三端并发布：

```bash
git tag v1.2.0
git push origin v1.2.0
```

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Electron 31 |
| 前端 | React 18、TypeScript、Vite 5 |
| UI 库 | Ant Design 5 |
| 状态管理 | Zustand |
| 数据库 | better-sqlite3（本地 SQLite） |
| 构建 | electron-vite、electron-builder |
| 测试 | Vitest |

## 项目结构

```
辩盒/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── db/            # 数据库初始化与 repository 层
│   │   ├── ipc/           # IPC 通信处理器
│   │   ├── services/      # 业务逻辑层（抽取引擎、导入引擎、备份服务等）
│   │   ├── backup/        # 数据库文件级自动备份
│   │   └── index.ts       # 主进程入口
│   ├── preload/           # 预加载脚本
│   ├── renderer/          # 渲染进程（React 前端）
│   │   └── src/
│   │       ├── components/ # 通用组件
│   │       ├── pages/      # 8 个主功能页面
│   │       ├── stores/     # Zustand 状态管理
│   │       ├── hooks/      # 自定义 Hooks（含 useHotkeys）
│   │       ├── utils/      # 工具函数（含 hotkey-manager、hotkey-presets）
│   │       └── styles/     # 样式 tokens 与共享样式
│   └── shared/            # 主进程与渲染进程共享的类型、常量、工具函数
├── data/                  # 初始辩题数据（JSON）
├── build/                 # 打包资源（图标、entitlements）
├── .github/workflows/     # GitHub Actions（release.yml 自动发布）
├── electron-builder.yml   # electron-builder 配置
└── package.json
```

## License

[MIT](./LICENSE)
