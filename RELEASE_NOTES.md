# 辩盒 v1.2.1 更新内容

## 修复

- **修复抽取页面无赛事时显示多余空状态**：之前在抽取页面下滑会看到「暂无赛事，请先创建」的提示，即使已有赛事也会误显示。现已移除该空状态组件，仅保留引导步骤。
- **修复侧边栏版本号显示错误**：侧边栏底部硬编码显示 `v1.0.0`，现已改为从 `APP_META.version` 动态读取，与当前应用版本一致（v1.2.1）。
- **自动更新完成后清理安装包，避免磁盘残留**：electron-updater 下载的安装包（约 400MB）原存放在 `userData/Caches/<appName>/updater/pending/` 目录，更新完成后不会自动清理。现已在应用启动时自动清理上次更新残留的安装包，避免多次更新后磁盘空间持续累积。
- **新增 `.gitattributes` 强制 LF 行尾，根治跨平台行尾混乱**：之前项目无 `.gitattributes` 文件，Windows 上 git 默认 `core.autocrlf=true` 导致大量文件被误判为"modified"。现新增 `.gitattributes` 强制所有文本文件使用 LF 行尾，并配置二进制文件白名单，确保 Windows/macOS/Linux 协作时行尾符号一致。

## 版本号同步

- `package.json` / `package-lock.json` / `AboutModal.tsx` 版本号统一为 `1.2.1`

---

# 辩盒 v1.2.0 更新内容

## 新功能

### 应用内自动更新
现在可以在应用内直接检查并安装新版本，无需手动访问网页下载。
- 「设置 → 关于」中新增「应用更新」区域，支持手动检查更新
- 支持启动时自动检查更新（可在设置中关闭）
- **Windows**：支持一键下载安装，更新完成后自动重启升级
- **macOS**：检测到新版本后引导跳转浏览器下载 dmg 安装包（因未签名，暂不支持后台自动替换）
- **Linux**：AppImage 支持自动更新，deb 包引导手动下载

## 改进

- 安装包文件名加入平台标识，方便用户区分：
  - Windows：`bianhe-x.x.x-windows-setup.exe`
  - macOS：`bianhe-x.x.x-macos.dmg`
  - Linux：`bianhe-x.x.x-linux.AppImage` / `bianhe-x.x.x-linux.deb`
- Release 页面现在展示完整的版本更新说明

## 修复

- 修复 better-sqlite3 原生模块版本不匹配导致安装后崩溃的问题（v1.1.2）
- 修复 electron-updater ESM 导入错误导致主进程启动崩溃的问题
