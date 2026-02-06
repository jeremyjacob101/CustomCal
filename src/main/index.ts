import { app, shell, BrowserWindow, ipcMain, Tray, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { importIcsToCalendar } from './importIcs'

let tray: Tray | null = null
let trayWindow: BrowserWindow | null = null

function getTrayIcon() {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const image = nativeImage.createFromPath(iconPath)
  return process.platform === 'darwin' ? image.resize({ width: 18, height: 18 }) : image
}

function toggleTrayWindow(): void {
  if (!trayWindow || trayWindow.isDestroyed()) return
  if (tray && !tray.isDestroyed()) {
    const trayBounds = tray.getBounds()
    const windowBounds = trayWindow.getBounds()
    const padding = 8
    const x = Math.round(
      trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2
    )
    const y = Math.round(trayBounds.y + trayBounds.height + padding)
    trayWindow.setPosition(x, y, false)
  }
  if (trayWindow.isVisible()) {
    trayWindow.hide()
    return
  }

  trayWindow.show()
  trayWindow.focus()
}

function createTrayWindow(): void {
  trayWindow = new BrowserWindow({
    width: 420,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  trayWindow.on('blur', () => {
    trayWindow?.hide()
  })

  trayWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    trayWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    trayWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  tray = new Tray(getTrayIcon())
  tray.setToolTip('Calendar Cloner')
  tray.on('click', toggleTrayWindow)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  ipcMain.handle('calendar:importIcs', async (_event, opts) => {
    return await importIcsToCalendar(opts)
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.on("debug:log", (_evt, ...args) => {
  console.log("[renderer]", ...args);
});

  if (process.platform === 'darwin') {
    app.dock.hide()
  }
  createTrayWindow()
  createTray()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createTrayWindow()
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
