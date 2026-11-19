const { app, BrowserWindow, ipcMain, Notification, shell, clipboard, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { Collector } = require('./collector');
const { Terminals } = require('./terminals');
const { Git } = require('./git');
const { Monitor } = require('./monitor');
const { Limits } = require('./limits');

app.commandLine.appendSwitch('ozone-platform-hint', 'auto'); // native Wayland when available (Fedora's default session)

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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[page] ${message} (${source}:${line})`);
  });
  win.on('closed', () => (win = null));
}

function notify(title, body, sessionId) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => {
    if (!win) createWindow();
    win.show();
    win.focus();
    win.webContents.send('select', sessionId);
  });
  n.show();
}

const collector = new Collector();
const terminals = new Terminals((ch, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
});

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
  if (win && !win.isDestroyed()) win.webContents.send('snapshot', snap);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    loadSettings();
    limits = new Limits(app.getPath('userData'));
    ipcMain.handle('settings:get', () => settings);
    ipcMain.handle('settings:set', (_e, patch) => {
      settings = { ...settings, ...patch };
      saveSettings();
      return settings;
    });
    ipcMain.handle('open-folder', (_e, dir) => (typeof dir === 'string' && path.isAbsolute(dir) ? shell.openPath(dir) : 'bad path'));
    ipcMain.handle('copy', (_e, text) => clipboard.writeText(String(text)));
    ipcMain.handle('refresh', () => poll());
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
    ipcMain.handle('session:stop', (_e, key) => terminals.stop(String(key)));
    ipcMain.handle('term:attach', (_e, key) => {
      try {
        return terminals.attach(String(key));
      } catch (e) {
        return { error: e.message };
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
    ipcMain.on('term:input', (_e, { key, data }) => terminals.write(String(key), data));
    ipcMain.on('term:line', (_e, { key, text }) => terminals.sendLine(String(key), text));
    ipcMain.on('term:resize', (_e, { key, cols, rows }) => terminals.resize(String(key), cols | 0, rows | 0));
    createWindow();
    win.webContents.on('did-finish-load', poll);
    setInterval(poll, POLL_MS);
    // AGENTINAN_SHOT=/path.png: save one screenshot after start-up and quit (for checking the UI).
    if (process.env.AGENTINAN_SHOT) {
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

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => terminals.disposeAll()); // background sessions keep running; we only detach
}
