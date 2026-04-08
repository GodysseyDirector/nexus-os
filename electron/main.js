'use strict'
/**
 * NEXUS OS — Electron Main Process
 * Boot sequence: Ollama → Backend → Python Services → Window
 */
const { app, Menu } = require('electron')
const { bootAll, shutdownAll } = require('./systemLauncher')
const { createMainWindow, focusOrCreate } = require('./windowManager')
const path = require('path')

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
    await bootAll()
    createMainWindow()
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
  shutdownAll()
})

// Crash recovery
process.on('uncaughtException', err => console.error('[Electron] Uncaught:', err))
