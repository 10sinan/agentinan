const { app, BrowserWindow, ipcMain, Notification, shell, clipboard, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { Collector } = require('./collector');
const { Terminals } = require('./terminals');

app.commandLine.appendSwitch('ozone-platform-hint', 'auto'); // native Wayland when available (Fedora's default session)

const POLL_MS = 1500;
const DEFAULTS = { notifyWaiting: true, notifyDone: true, quality: 'high' };

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
