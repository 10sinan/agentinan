const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentinan', {
  onSnapshot: (fn) => ipcRenderer.on('snapshot', (_e, s) => fn(s)),
  onSelect: (fn) => ipcRenderer.on('select', (_e, id) => fn(id)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openFolder: (dir) => ipcRenderer.invoke('open-folder', dir),
  copy: (text) => ipcRenderer.invoke('copy', text),
  refresh: () => ipcRenderer.invoke('refresh'),
  timeline: () => ipcRenderer.invoke('timeline'),
  history: (days) => ipcRenderer.invoke('history', days),
  onSettingsChanged: (fn) => ipcRenderer.on('settings-changed', () => fn()),

  // sessions Agentinan starts and talks to
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  startSession: (opts) => ipcRenderer.invoke('session:start', opts),
  stopSession: (key) => ipcRenderer.invoke('session:stop', key),
  renameSession: (id, title) => ipcRenderer.invoke('session:rename', id, title), // → { data } or { error }
  deleteSession: (id) => ipcRenderer.invoke('session:delete', id),
  attach: (key) => ipcRenderer.invoke('term:attach', key),
  input: (key, data) => ipcRenderer.send('term:input', { key, data }),
  sendLine: (key, text) => ipcRenderer.send('term:line', { key, text }),
  resize: (key, cols, rows) => ipcRenderer.send('term:resize', { key, cols, rows }),
  // plain shells in the bottom drawer
  shellOpen: (cwd) => ipcRenderer.invoke('shell:open', cwd), // → { data: { id, cwd, name } } or { error }
  shellRestore: () => ipcRenderer.invoke('shell:restore'), // folders of last time's terminals, once per start
  shellInput: (id, data) => ipcRenderer.send('shell:input', { id, data }),
  shellResize: (id, cols, rows) => ipcRenderer.send('shell:resize', { id, cols, rows }),
  shellClose: (id) => ipcRenderer.send('shell:close', id),
  onShellData: (fn) => ipcRenderer.on('shell:data', (_e, m) => fn(m)),
  onShellExit: (fn) => ipcRenderer.on('shell:exit', (_e, m) => fn(m)),
  onTermData: (fn) => ipcRenderer.on('term:data', (_e, m) => fn(m)),
  onTermExit: (fn) => ipcRenderer.on('term:exit', (_e, m) => fn(m)),

  // processes straining the PC; resolve to { data } or { error }
  enableLimits: () => ipcRenderer.invoke('limits:enable'),
  disableLimits: () => ipcRenderer.invoke('limits:disable'),
  killProc: (pid, key, force) => ipcRenderer.invoke('proc:kill', pid, key, force),
  ignoreProc: (name) => ipcRenderer.invoke('proc:ignore', name),

  // Source Control; each call resolves to { data } or { error }
  git: {
    repos: () => ipcRenderer.invoke('git:repos'),
    addRepo: () => ipcRenderer.invoke('git:add-repo'),
    status: (r) => ipcRenderer.invoke('git:status', r),
    diff: (r, file, kind) => ipcRenderer.invoke('git:diff', r, file, kind),
    stage: (r, files) => ipcRenderer.invoke('git:stage', r, files),
    unstage: (r, files) => ipcRenderer.invoke('git:unstage', r, files),
    commit: (r, msg) => ipcRenderer.invoke('git:commit', r, msg),
    log: (r) => ipcRenderer.invoke('git:log', r),
    show: (r, hash) => ipcRenderer.invoke('git:show', r, hash),
    push: (r) => ipcRenderer.invoke('git:push', r),
    pull: (r) => ipcRenderer.invoke('git:pull', r),
    fetch: (r) => ipcRenderer.invoke('git:fetch', r),
    branches: (sessionId) => ipcRenderer.invoke('git:branches', sessionId), // → { data: { root, main, branches } }
    branchCommits: (sessionId, name) => ipcRenderer.invoke('git:branch-commits', sessionId, name), // → { data: { total, commits } }
  },
});
