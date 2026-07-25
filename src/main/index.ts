import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase } from './db'
import { seedOfficialTopics } from './db/seed'
import { auditRepo } from './db/repository/audit.repo'
import { registerAllIpc } from './ipc'

// Redirect userData directory to a local path to avoid sandbox restrictions
// on the default %APPDATA%/<appName> location.
app.setPath('userData', join(app.getAppPath(), '.electron-userdata'))

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    title: '辩题抽取工具',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
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

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 初始化数据库
  try {
    initDatabase()
    console.log('[main] Database initialized')
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
