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
