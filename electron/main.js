'use strict'
/**
 * NEXUS OS — Electron Main Process
 * Boot sequence: Ollama → Backend → Python Services → Window
 */
const { app, Menu } = require('electron')
const supervisor = require('./supervisor')
const { createMainWindow, focusOrCreate } = require('./windowManager')
const path = require('path')

// ── Auto-updater (GitHub Releases) ───────────────────────────────────────────
let autoUpdater = null
try {
  autoUpdater = require('electron-updater').autoUpdater
  autoUpdater.autoDownload         = false   // ask user before downloading
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease      = false   // stable channel only

  autoUpdater.on('update-available', (info) => {
    console.log('[NEXUS] Update available:', info.version)
    const { dialog } = require('electron')
    dialog.showMessageBox({
      type:    'info',
      title:   'NEXUS Update Available',
      message: `Version ${info.version} is available. Download now?`,
      buttons: ['Download', 'Later'],
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate()
    })
  })

  autoUpdater.on('update-downloaded', () => {
    const { dialog } = require('electron')
    dialog.showMessageBox({
      type:    'info',
      title:   'NEXUS Update Ready',
      message: 'Update downloaded. NEXUS will restart to install.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })

  autoUpdater.on('error', (err) => {
    console.warn('[NEXUS] Auto-updater error:', err?.message)
  })
} catch {
  console.log('[NEXUS] electron-updater not available — running without auto-update')
}

// Keep single instance
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// Remove default menu (the dashboard is the UI)
Menu.setApplicationMenu(null)

// ── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  console.log('[NEXUS] Electron ready — booting system...')

  try {
    await supervisor.startAll()
    createMainWindow()

    // Check for updates 10s after boot (only in packaged app)
    if (app.isPackaged && autoUpdater) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000)
    }
  } catch (err) {
    console.error('[NEXUS] Boot failed:', err.message)
    const { dialog } = require('electron')
    dialog.showErrorBox('NEXUS Boot Error', `Failed to start: ${err.message}\n\nMake sure Node.js and Ollama are installed.`)
    app.quit()
  }

  // macOS: re-create window if dock icon clicked
  app.on('activate', focusOrCreate)
})

app.on('second-instance', focusOrCreate)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  supervisor.stopAll()
})

// Crash recovery
process.on('uncaughtException', err => console.error('[Electron] Uncaught:', err))
