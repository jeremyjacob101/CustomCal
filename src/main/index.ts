import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  nativeImage,
  screen,
  type NativeImage
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { importIcsToCalendar, previewIcsEvents } from './importIcs'

let tray: Tray | null = null
let trayWindow: BrowserWindow | null = null

const TRAY_WINDOW_WIDTH = 400
const TRAY_WINDOW_HEIGHT = 500

function getTrayIcon(): NativeImage {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const image = nativeImage.createFromPath(iconPath)
  return process.platform === 'darwin' ? image.resize({ width: 18, height: 18 }) : image
}

function positionTrayWindow(): void {
  if (!trayWindow || trayWindow.isDestroyed()) return

  const trayBounds = tray && !tray.isDestroyed() ? tray.getBounds() : null
  const anchorPoint = trayBounds
    ? {
        x: Math.round(trayBounds.x + trayBounds.width / 2),
        y: Math.round(trayBounds.y + trayBounds.height / 2)
      }
    : screen.getCursorScreenPoint()

  const display = screen.getDisplayNearestPoint(anchorPoint)
  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = display.workArea

  const desiredX = trayBounds
    ? Math.round(trayBounds.x + trayBounds.width / 2 - TRAY_WINDOW_WIDTH / 2)
    : Math.round(anchorPoint.x - TRAY_WINDOW_WIDTH / 2)
  const desiredY = trayBounds
    ? Math.round(trayBounds.y + trayBounds.height + 8)
    : Math.round(anchorPoint.y + 8)

  const minX = areaX
  const minY = areaY
  const maxX = areaX + areaWidth - TRAY_WINDOW_WIDTH
  const maxY = areaY + areaHeight - TRAY_WINDOW_HEIGHT

  const x = Math.min(Math.max(desiredX, minX), Math.max(minX, maxX))
  const y = Math.min(Math.max(desiredY, minY), Math.max(minY, maxY))

  trayWindow.setBounds(
    {
      x,
      y,
      width: TRAY_WINDOW_WIDTH,
      height: TRAY_WINDOW_HEIGHT
    },
    false
  )
}

function toggleTrayWindow(): void {
  if (!trayWindow || trayWindow.isDestroyed()) return
  if (trayWindow.isVisible()) {
    trayWindow.hide()
    return
  }

  positionTrayWindow()
  trayWindow.show()
  trayWindow.focus()
}

function createTrayWindow(): void {
  trayWindow = new BrowserWindow({
    width: TRAY_WINDOW_WIDTH,
    height: TRAY_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
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
  tray.setToolTip('Custom Calendar')
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

  ipcMain.handle('calendar:previewIcs', async (_event, opts) => {
    return await previewIcsEvents(opts)
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.on('debug:log', (_evt, ...args) => {
    console.log('[renderer]', ...args)
  })

  if (process.platform === 'darwin') {
    app.dock?.hide()
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
