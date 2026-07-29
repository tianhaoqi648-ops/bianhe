import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase, currentDbMode } from './db'
import { seedOfficialTopics } from './db/seed'
import { auditRepo } from './db/repository/audit.repo'
import { clearUndoLogOnStartup } from './services/undo-service'
import { ensureBackgroundsDir } from './services/background-storage'
import { registerAllIpc } from './ipc'
import { writeErrorLog } from './logs'
import { runBackupIfNeeded } from './backup'

// 使用 Electron 默认 userData 路径（%APPDATA%/辩盒/），
// 而非 app.getAppPath() + '.electron-userdata'，因为：
// 1. NSIS 安装后 app.getAppPath() 指向 Program Files，无写权限
// 2. 默认 userData 路径由 Electron 自动管理，确保可写
// 3. 用户数据与程序文件分离，便于升级和数据备份

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    title: '辩盒',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // 窗口准备好之后再次广播当前 db 模式，确保渲染进程拿到初始状态
    mainWindow.webContents.send('db:status', currentDbMode)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.bianhe.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 注册 logs IPC（不依赖数据库，可独立工作）
  ipcMain.handle('logs:write', (_e, error) => writeErrorLog(error))
  // 注册 db:get-mode IPC（同步查询当前 db 模式，用于渲染进程初始 mount 时拉取）
  ipcMain.handle('db:get-mode', () => currentDbMode)

  // 初始化数据库（带降级）
  try {
    await initDatabase()
    console.log('[main] Database initialized, mode =', currentDbMode)

    // 启动时清空 undo_log 表，避免跨重启一致性问题
    try {
      clearUndoLogOnStartup()
      console.log('[main] Undo log cleared on startup')
    } catch (e) {
      console.error('[main] Failed to clear undo log on startup:', e)
    }

    // 确保自定义背景图片目录存在（userData/backgrounds/）
    try {
      ensureBackgroundsDir()
      console.log('[main] Backgrounds directory ensured')
    } catch (e) {
      console.error('[main] Failed to ensure backgrounds directory:', e)
    }

    // 首次启动加载官方题库
    try {
      const seededCount = seedOfficialTopics()
      if (seededCount > 0) {
        console.log(`[main] Official topics seeded: ${seededCount}`)
      }
    } catch (e) {
      console.error('[main] Failed to seed official topics:', e)
    }
    // 记录启动日志（验证 audit.repo 可用）
    try {
      auditRepo.addLog({
        action: 'system',
        target_type: 'system',
        target_id: 'system',
        operator: 'system',
        detail: { action: 'startup', timestamp: new Date().toISOString() }
      })
      console.log('[main] Startup log recorded')
    } catch (e) {
      console.error('[main] Failed to record startup log:', e)
    }

    // 注册 IPC handlers（必须在 createWindow 之前完成）
    registerAllIpc()

    // 启动时检查并执行数据自动备份（距上次 >24h 触发）
    // 备份在后台进行，失败不影响启动
    try {
      await runBackupIfNeeded()
      console.log('[main] Backup check completed')
    } catch (e) {
      console.error('[main] Backup check failed:', e)
    }
  } catch (err) {
    console.error('[main] Database initialization failed:', err)
    dialog.showErrorBox(
      '数据库初始化失败',
      `应用无法启动：${err instanceof Error ? err.message : String(err)}\n\n请确保 better-sqlite3 已正确编译。`
    )
    app.quit()
    return
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 关闭数据库连接，释放资源
app.on('will-quit', () => {
  try {
    closeDatabase()
  } catch (e) {
    console.error('[main] Failed to close database:', e)
  }
})
