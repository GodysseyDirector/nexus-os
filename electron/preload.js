'use strict'
const { contextBridge, ipcRenderer } = require('electron')

// Expose minimal, safe API surface to the renderer
contextBridge.exposeInMainWorld('__nexus', {
  platform:  process.platform,
  version:   process.versions.electron,
  // Allow renderer to signal app-level actions
  quit:      () => ipcRenderer.send('app:quit'),
  minimize:  () => ipcRenderer.send('app:minimize'),
  maximize:  () => ipcRenderer.send('app:maximize'),
})
