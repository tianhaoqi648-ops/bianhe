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

## 下载安装

普通用户无需自行编译，直接从 GitHub Releases 下载对应平台的安装包即可：

👉 **[前往下载页面](https://github.com/tianhaoqi648-ops/bianhe/releases)**

### Windows
下载 `辩盒-x.y.z-setup.exe`，双击运行按提示安装。

### macOS
下载 `辩盒-x.y.z.dmg`，打开后将「辩盒」拖入「应用程序」文件夹。
> ⚠️ 首次打开若提示"无法验证开发者"：右键点击应用图标 → 选择「打开」→ 确认即可。

### Linux
- AppImage：下载 `辩盒-x.y.z.AppImage`，`chmod +x` 后直接运行
- deb：下载 `辩盒-x.y.z.deb`，`sudo dpkg -i` 安装

## 安装与运行

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
│   │   └── services/      # 业务逻辑层（抽取引擎、导入引擎等）
│   ├── preload/           # 预加载脚本
│   ├── renderer/          # 渲染进程（React 前端）
│   │   └── src/
│   │       ├── components/ # 通用组件
│   │       ├── pages/      # 页面组件
│   │       ├── stores/     # Zustand 状态管理
│   │       └── styles/     # 样式 tokens 与共享样式
│   └── shared/            # 主进程与渲染进程共享的类型、常量、工具函数
├── data/                  # 初始辩题数据（JSON）
├── build/                 # 打包资源（图标、entitlements）
├── electron-builder.yml   # electron-builder 配置
└── package.json
```

## License

[MIT](./LICENSE)
