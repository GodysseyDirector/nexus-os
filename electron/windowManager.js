'use strict'
const { BrowserWindow, shell, screen } = require('electron')
const path = require('path')

const PORT = parseInt(process.env.PORT || '18790', 10)
let mainWin = null

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  mainWin = new BrowserWindow({
    width:  Math.min(1600, width),
    height: Math.min(960, height),
    minWidth:  1024,
    minHeight: 640,
    title:  'NEXUS OS',
    backgroundColor: '#0a0a0f',
    titleBarStyle:   'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    show: false, // show after ready-to-show
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // keep running when backgrounded
    },
  })

  mainWin.once('ready-to-show', () => {
    mainWin.show()
    mainWin.focus()
  })

  mainWin.loadURL(`http://127.0.0.1:${PORT}`)

  // Open external links in browser, not inside app
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1`) && !url.startsWith(`http://localhost`)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  mainWin.on('closed', () => { mainWin = null })

  return mainWin
}

function getMainWindow() { return mainWin }

function focusOrCreate() {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.focus()
  } else {
    createMainWindow()
  }
}

module.exports = { createMainWindow, getMainWindow, focusOrCreate }
