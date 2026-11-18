const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentinan', {
  onSnapshot: (fn) => ipcRenderer.on('snapshot', (_e, s) => fn(s)),
  onSelect: (fn) => ipcRenderer.on('select', (_e, id) => fn(id)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openFolder: (dir) => ipcRenderer.invoke('open-folder', dir),
  copy: (text) => ipcRenderer.invoke('copy', text),
  refresh: () => ipcRenderer.invoke('refresh'),

  // sessions Agentinan starts and talks to
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  startSession: (opts) => ipcRenderer.invoke('session:start', opts),
  stopSession: (key) => ipcRenderer.invoke('session:stop', key),
  attach: (key) => ipcRenderer.invoke('term:attach', key),
  input: (key, data) => ipcRenderer.send('term:input', { key, data }),
  sendLine: (key, text) => ipcRenderer.send('term:line', { key, text }),
  resize: (key, cols, rows) => ipcRenderer.send('term:resize', { key, cols, rows }),
  onTermData: (fn) => ipcRenderer.on('term:data', (_e, m) => fn(m)),
  onTermExit: (fn) => ipcRenderer.on('term:exit', (_e, m) => fn(m)),
});
