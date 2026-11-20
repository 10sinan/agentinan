const { app, BrowserWindow, ipcMain, Notification, shell, clipboard, Menu, dialog, Tray, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { Collector } = require('./collector');
const { Terminals } = require('./terminals');
const { Shells } = require('./shells');
const { findLinks } = require('./links');
const { Git } = require('./git');
const { Monitor } = require('./monitor');
const { Limits } = require('./limits');
const { trayIcon } = require('./trayicon');
const { guardIpc } = require('./ipc-guard');
const { isDirectory } = require('./safepath');

app.commandLine.appendSwitch('ozone-platform-hint', 'auto'); // native Wayland when available (Fedora's default session)
// One data folder (~/.config/agentinan) for both `npm start` and the packaged app, whose name is "Agentinan":
// otherwise switching to the package would start with empty settings.
app.setPath('userData', path.join(app.getPath('appData'), 'agentinan'));

const POLL_MS = 1500;
const DEFAULTS = {
  notifyWaiting: true,
  notifyDone: true,
  quality: 'high',
  theme: 'agentinan',
  gitRepos: [],
  // a process "strains the PC" when it uses hogCpu % of a core for hogSecs seconds, or hogMem % of the RAM
  hogAlert: true,
  hogCpu: 90,
  hogSecs: 15,
  hogMem: 30,
  hogIgnore: [],
  notifyLimits: true, // when the 5-hour or weekly limit passes 80% and 95%
  trayKeep: true, // closing the window leaves Agentinan running in the tray
  restoreOwn: true, // resume the sessions Agentinan ran itself when it starts again
  restoreShells: true, // reopen the drawer's terminals (same folders, fresh shells) when it starts again
  keys: { dock: 'Ctrl+`', newSession: 'Ctrl+Shift+N' }, // keyboard shortcuts, changeable in Settings
};

let win = null;
let settings = { ...DEFAULTS };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {}
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#070a14',
    title: 'Agentinan',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // The page never navigates and never opens windows: whatever tries to is refused.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') console.error(`[page] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  // with the tray on, closing the window only hides it: sessions are still watched and notifications still come
  win.on('close', (e) => {
    if (!quitting && tray && settings.trayKeep) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => (win = null));
}

function showWindow(sessionId) {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (sessionId) win.webContents.send('select', sessionId);
}

// ---------- tray: a sun coloured by the sessions' state, with the sessions in its menu ----------
let tray = null;
let quitting = false;
let traySig = '';
const STATE_LABEL = { waiting: 'seni bekliyor', busy: 'çalışıyor', idle: 'boşta' };
const STATE_DOT = { waiting: '●', busy: '◐', idle: '○' };

function trayImage(state) {
  const img = nativeImage.createFromBuffer(trayIcon(state, 32));
  img.addRepresentation({ scaleFactor: 2, buffer: trayIcon(state, 64) });
  return img;
}

function createTray() {
  try {
    tray = new Tray(trayImage('idle'));
  } catch (e) {
    console.error('tray failed', e);
    tray = null;
    return;
  }
  tray.on('click', () => showWindow());
  updateTray(lastSnap, true);
}

function updateTray(snap, force) {
  if (!tray) return;
  const sessions = (snap && snap.sessions) || [];
  const waiting = sessions.filter((s) => s.status === 'waiting');
  const busy = sessions.filter((s) => s.status === 'busy');
  const state = waiting.length ? 'waiting' : busy.length ? 'busy' : 'idle';
  const cost = snap && snap.today ? `$${snap.today.cost.toFixed(2)}` : '';
  const sig = JSON.stringify([state, settings.trayKeep, cost, sessions.map((s) => [s.id, s.name, s.status])]);
  if (sig === traySig && !force) return;
  traySig = sig;
  tray.setImage(trayImage(state));
  const parts = [waiting.length && `${waiting.length} bekliyor`, busy.length && `${busy.length} çalışıyor`].filter(Boolean);
  tray.setToolTip(`Agentinan · ${parts.length ? parts.join(' · ') : 'hepsi boşta'}${cost ? ` · bugün ${cost}` : ''}`);
  // waiting sessions first: they are what the tray is for
  const order = [...waiting, ...busy, ...sessions.filter((s) => s.status !== 'waiting' && s.status !== 'busy')];
  const items = order.map((s) => ({
    label: `${STATE_DOT[s.status] || '○'}  ${s.name} — ${STATE_LABEL[s.status] || s.status}`,
    click: () => showWindow(s.id),
  }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Agentinan${cost ? ` · bugün ${cost}` : ''}`, enabled: false },
      { type: 'separator' },
      ...(items.length ? items : [{ label: 'Açık oturum yok', enabled: false }]),
      { type: 'separator' },
      { label: 'Pencereyi göster', click: () => showWindow() },
      {
        label: 'Kapatınca tepside kalsın',
        type: 'checkbox',
        checked: !!settings.trayKeep,
        click: (mi) => {
          settings.trayKeep = mi.checked;
          saveSettings();
          if (win && !win.isDestroyed()) win.webContents.send('settings-changed');
        },
      },
      {
        label: 'Çıkış',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function notify(title, body, sessionId) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => showWindow(sessionId));
  n.show();
}

const collector = new Collector();
const toWindow = (ch, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
};
const terminals = new Terminals(toWindow);
const shells = new Shells(toWindow); // the plain terminals in the bottom drawer

// Marks the sessions Agentinan can send commands to: background sessions, and the ones it runs itself.
function annotate(snap) {
  const own = terminals.ownPids();
  for (const s of snap.sessions) {
    if (s.kind === 'bg' && s.jobId) s.control = `bg:${s.jobId}`;
    else if (own.has(s.pid)) s.control = own.get(s.pid);
    else s.control = null;
  }
  return snap;
}
// Sessions Agentinan runs itself end with the app; remember them so the next start can resume them.
const ownFile = () => path.join(app.getPath('userData'), 'own-sessions.json');
const shellsFile = () => path.join(app.getPath('userData'), 'shells.json');
let pendingShells = []; // folders of the drawer's terminals from last time; the page asks for them once
function saveOwnSessions() {
  if (!lastSnap) return; // never polled (e.g. a second instance that quit at once): keep the saved list
  try {
    const own = terminals.ownPids();
    const list = (lastSnap?.sessions || []).filter((s) => own.has(s.pid)).map((s) => ({ id: s.id, cwd: s.cwd }));
    fs.writeFileSync(ownFile(), JSON.stringify(list));
  } catch (e) {
    console.error('own sessions not saved', e);
  }
  try {
    fs.writeFileSync(shellsFile(), JSON.stringify(shells.cwds()));
  } catch (e) {
    console.error('terminals not saved', e);
  }
}
function restoreOwnSessions() {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(ownFile(), 'utf8'));
    fs.unlinkSync(ownFile());
  } catch {}
  if (settings.restoreOwn !== false && Array.isArray(list)) for (const s of list.slice(0, 20)) terminals.resume(s?.id, s?.cwd);
  try {
    const cwds = JSON.parse(fs.readFileSync(shellsFile(), 'utf8'));
    fs.unlinkSync(shellsFile());
    if (settings.restoreShells !== false && Array.isArray(cwds)) pendingShells = cwds.filter((c) => typeof c === 'string').slice(0, 10);
  } catch {}
}
let prev = null; // sessionId → status from the last poll
let lastSnap = null;
const gitApi = new Git();
const monitor = new Monitor();
let hogs = [];
let limits = null; // created once the app knows its data folder
const limitNotified = new Map(); // window → { resetsAt, level } already announced

function poll() {
  let snap;
  try {
    snap = annotate(collector.snapshot());
    snap.links = findLinks(snap.sessions);
  } catch (e) {
    console.error('snapshot failed', e);
    return;
  }
  const now = new Map(snap.sessions.map((s) => [s.id, s.status]));
  if (prev) {
    const focused = win && win.isFocused();
    for (const s of snap.sessions) {
      const was = prev.get(s.id);
      if (!was || was === s.status) continue;
      if (s.status === 'waiting' && settings.notifyWaiting) {
        notify(`${s.name} seni bekliyor`, s.waitingFor ? `Bekliyor: ${s.waitingFor}` : 'Onay ya da cevap gerekiyor', s.id);
      } else if (was === 'busy' && s.status === 'idle' && settings.notifyDone && !focused) {
        notify(`${s.name} bitirdi`, s.lastText || 'Sıra sende', s.id);
      }
    }
  }
  prev = now;

  // Processes straining the computer, each tied to the session that started it when there is one.
  try {
    const byPid = new Map(snap.sessions.map((s) => [s.pid, s]));
    hogs = settings.hogAlert
      ? monitor.sample(new Set(byPid.keys()), { cpu: settings.hogCpu, cpuSecs: settings.hogSecs, memPct: settings.hogMem, ignore: settings.hogIgnore })
      : [];
    for (const h of hogs) {
      const s = byPid.get(h.sessionPid);
      h.sessionId = s ? s.id : null;
      h.sessionName = s ? s.name : null;
      if (h.fresh) {
        const what = h.reason === 'mem' ? `belleğin %${h.memPct}'ini kullanıyor` : `işlemciyi %${h.cpu} kullanıyor`;
        if (s) notify(`⚠ ${s.name}: ${h.name} bilgisayarı yoruyor`, what, s.id);
      }
      delete h.fresh;
    }
  } catch (e) {
    console.error('monitor failed', e);
  }
  hogs = hogs.filter((h) => h.sessionId); // only what Claude Code sessions started
  snap.hogs = hogs;

  // plan usage limits (5-hour and weekly window), with a notification at 80% and 95%
  if (limits) {
    snap.limits = limits.read();
    for (const [w, label] of [['fiveHour', '5 saatlik'], ['week', 'Haftalık']]) {
      const l = snap.limits[w];
      if (!l) continue;
      const level = l.pct >= 95 ? 95 : l.pct >= 80 ? 80 : 0;
      const seen = limitNotified.get(w);
      if (seen && seen.resetsAt !== l.resetsAt) limitNotified.delete(w); // a new window began
      const prevLevel = limitNotified.get(w)?.level || 0;
      if (level > prevLevel) {
        limitNotified.set(w, { resetsAt: l.resetsAt, level });
        if (settings.notifyLimits && lastSnap) notify(`${label} limitin %${Math.round(l.pct)} doldu`, level >= 95 ? 'Limit dolmak üzere' : 'Kullanımına dikkat', null);
      }
    }
  }
  lastSnap = snap;
  updateTray(snap);
  if (win && !win.isDestroyed()) win.webContents.send('snapshot', snap);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow()); // also brings back a window hidden in the tray

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    loadSettings();
    limits = new Limits(app.getPath('userData'));
    // every handler registered below (and later) only answers the app's own page
    guardIpc(ipcMain, path.join(__dirname, '..', 'renderer', 'index.html'), (ch, url) => console.error(`ipc '${ch}' refused from ${url}`));
    ipcMain.handle('settings:get', () => settings);
    ipcMain.handle('settings:set', (_e, patch) => {
      settings = { ...settings, ...patch };
      saveSettings();
      updateTray(lastSnap, true);
      return settings;
    });
    ipcMain.handle('open-folder', (_e, dir) => (isDirectory(dir) ? shell.openPath(dir) : 'bad path')); // only a real directory: openPath on a file would run it
    ipcMain.handle('copy', (_e, text) => clipboard.writeText(String(text)));
    ipcMain.handle('refresh', () => poll());
    ipcMain.handle('timeline', () => collector.timeline());
    ipcMain.handle('history', (_e, days) => collector.history(Math.max(1, Math.min(90, days | 0 || 30))));
    ipcMain.handle('pick-folder', async () => {
      const r = await dialog.showOpenDialog(win, { title: 'Claude hangi klasörde çalışsın?', properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle('session:start', async (_e, { cwd, name, prompt }) => {
      try {
        const r = await terminals.start(cwd, name, prompt);
        setTimeout(poll, 800);
        return r;
      } catch (e) {
        return { error: e.message || String(e) };
      }
    });
    // Source Control: every call answers { data } or { error }.
    const wrap = (fn) => async (_e, ...args) => {
      try {
        return { data: await fn(...args) };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    };
    ipcMain.handle('session:stop', (_e, key) => terminals.stop(String(key)));
    const liveSession = (id) => {
      const s = lastSnap && lastSnap.sessions.find((x) => x.id === id);
      if (!s) throw new Error('Oturum bulunamadı');
      return s;
    };
    ipcMain.handle(
      'session:rename',
      wrap((id, title) => {
        const s = liveSession(String(id));
        const name = collector.rename(s.id, s.cwd, title);
        setTimeout(poll, 300);
        return name;
      }),
    );
    // Closes the session (if it is still running) and deletes its conversation for good.
    ipcMain.handle(
      'session:delete',
      wrap(async (id) => {
        const s = liveSession(String(id));
        if (s.control) terminals.stop(s.control);
        else {
          try {
            process.kill(s.pid, 'SIGTERM');
          } catch {}
        }
        const alive = () => {
          try {
            process.kill(s.pid, 0);
            return true;
          } catch {
            return false;
          }
        };
        for (let i = 0; i < 30 && alive(); i++) await new Promise((r) => setTimeout(r, 200)); // it would rewrite the file while it lives
        if (alive()) throw new Error('Oturum kapanmadı; sohbet silinmedi');
        collector.deleteSession(s.id, s.cwd);
        setTimeout(poll, 300);
        return true;
      }),
    );
    ipcMain.handle('term:attach', (_e, key) => {
      try {
        return terminals.attach(String(key));
      } catch (e) {
        return { error: e.message };
      }
    });
    ipcMain.handle(
      'git:repos',
      wrap(() => gitApi.repos([...(lastSnap ? lastSnap.sessions.map((s) => s.cwd) : []), ...settings.gitRepos])),
    );
    ipcMain.handle(
      'git:add-repo',
      wrap(async () => {
        const r = await dialog.showOpenDialog(win, { title: 'Git deposu ekle', properties: ['openDirectory'] });
        if (r.canceled) return null;
        const dir = r.filePaths[0];
        const [repo] = await gitApi.repos([dir], true);
        if (!repo) throw new Error('Bu klasör bir git deposu değil');
        if (!settings.gitRepos.includes(repo.root)) {
          settings.gitRepos = [...settings.gitRepos, repo.root];
          saveSettings();
        }
        return repo.root;
      }),
    );
    ipcMain.handle('limits:enable', wrap(() => limits.enable()));
    ipcMain.handle('limits:disable', wrap(() => limits.disable()));
    ipcMain.handle('git:status', wrap((r) => gitApi.status(r)));
    ipcMain.handle('git:diff', wrap((r, file, kind) => gitApi.diff(r, file, kind)));
    ipcMain.handle('git:stage', wrap((r, files) => gitApi.stage(r, files)));
    ipcMain.handle('git:unstage', wrap((r, files) => gitApi.unstage(r, files)));
    ipcMain.handle('git:commit', wrap((r, msg) => gitApi.commit(r, msg)));
    ipcMain.handle('git:log', wrap((r) => gitApi.log(r)));
    ipcMain.handle('git:show', wrap((r, hash) => gitApi.show(r, hash)));
    ipcMain.handle('git:push', wrap((r) => gitApi.push(r)));
    ipcMain.handle('git:pull', wrap((r) => gitApi.pull(r)));
    ipcMain.handle('git:fetch', wrap((r) => gitApi.fetch(r)));
    ipcMain.handle(
      'proc:kill',
      wrap((pid, key, force) => monitor.kill(Number(pid), String(key), !!force, hogs)),
    );
    ipcMain.handle(
      'proc:ignore',
      wrap((name) => {
        name = String(name).slice(0, 64);
        if (!settings.hogIgnore.includes(name)) settings.hogIgnore = [...settings.hogIgnore, name];
        saveSettings();
        return settings;
      }),
    );
    ipcMain.handle('shell:restore', () => pendingShells.splice(0));
    ipcMain.handle('shell:open', wrap((cwd) => shells.open(cwd)));
    ipcMain.on('shell:input', (_e, { id, data }) => shells.write(String(id), data));
    ipcMain.on('shell:resize', (_e, { id, cols, rows }) => shells.resize(String(id), cols | 0, rows | 0));
    ipcMain.on('shell:close', (_e, id) => shells.close(String(id)));
    ipcMain.on('term:input', (_e, { key, data }) => terminals.write(String(key), data));
    ipcMain.on('term:line', (_e, { key, text }) => terminals.sendLine(String(key), text));
    ipcMain.on('term:resize', (_e, { key, cols, rows }) => terminals.resize(String(key), cols | 0, rows | 0));
    restoreOwnSessions();
    createWindow();
    createTray();
    win.webContents.on('did-finish-load', poll);
    setInterval(poll, POLL_MS);
    // AGENTINAN_SHOT=/path.png: save one screenshot after start-up and quit (for checking the UI). Development only:
    // AGENTINAN_EVAL runs arbitrary script in the page and AGENTINAN_SHOT writes a file, so a packaged app ignores them.
    if (!app.isPackaged && process.env.AGENTINAN_SHOT) {
      setTimeout(async () => {
        if (process.env.AGENTINAN_SELECT) win.webContents.send('select', process.env.AGENTINAN_SELECT);
        // AGENTINAN_EVAL: page script run before the screenshot, to drive the UI in a test.
        if (process.env.AGENTINAN_EVAL) await win.webContents.executeJavaScript(process.env.AGENTINAN_EVAL).catch((e) => console.error(e));
        if (process.env.AGENTINAN_WAIT) await new Promise((r) => setTimeout(r, Number(process.env.AGENTINAN_WAIT)));
        await new Promise((r) => setTimeout(r, 2500));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.AGENTINAN_SHOT, img.toPNG());
        app.quit();
      }, 5000);
    }
  });

  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    saveOwnSessions();
    terminals.disposeAll();
    shells.disposeAll();
  }); // background sessions keep running; we only detach
}
