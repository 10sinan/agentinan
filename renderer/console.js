'use strict';
// The command panel under the map: the selected session's terminal (xterm.js) and a box to type to Claude,
// plus the "new session" dialog. Only sessions Agentinan started (s.control set) get a panel.
(() => {
  const api = window.agentinan;
  const D = window.dash;
  const box = document.getElementById('console');
  const termHost = box.querySelector('.term');
  const title = document.getElementById('conTitle');
  const note = document.getElementById('conNote');
  const text = document.getElementById('conText');

  const terms = new Map(); // control key → { term, fit, el, ready, dead }
  let current = null;
  let pendingKey = null; // a session we just started that isn't in the snapshot yet
  let hidden = false;

  const THEME = {
    background: '#0a0f1e',
    foreground: '#e6ebf7',
    cursor: '#f5a524',
    selectionBackground: '#3b4a7a',
    black: '#1b2236',
    brightBlack: '#5d6888',
    red: '#ff4d6d',
    brightRed: '#ff7a93',
    green: '#4ade80',
    brightGreen: '#86efac',
    yellow: '#f5a524',
    brightYellow: '#fcd34d',
    blue: '#60a5fa',
    brightBlue: '#93c5fd',
    magenta: '#a78bfa',
    brightMagenta: '#c4b5fd',
    cyan: '#4cc9f0',
    brightCyan: '#a5f3fc',
    white: '#d9def0',
    brightWhite: '#ffffff',
  };

  function ensure(key) {
    let t = terms.get(key);
    if (t && !t.dead) return t;
    if (t) {
      t.term.dispose();
      t.el.remove();
    }
    const el = document.createElement('div');
    el.className = 'term-inst';
    termHost.appendChild(el);
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: THEME,
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.onData((d) => api.input(key, d));
    t = { term, fit, el, ready: false, dead: false };
    terms.set(key, t);
    api.attach(key).then((r) => {
      if (!r || r.error) {
        term.write(`\r\n\x1b[31mBağlanılamadı${r && r.error ? ': ' + r.error : ''}\x1b[0m\r\n`);
        t.dead = true;
        return;
      }
      // The buffer already holds everything sent before this reply, so anything queued meanwhile is dropped.
      term.write(r.buffer);
      t.ready = true;
      fitNow();
    });
    return t;
  }

  api.onTermData(({ key, data }) => {
    const t = terms.get(key);
    if (t && t.ready) t.term.write(data);
  });

  api.onTermExit(({ key }) => {
    const t = terms.get(key);
    if (!t) return;
    t.dead = true;
    t.term.write('\r\n\x1b[90m— bağlantı kapandı —\x1b[0m\r\n');
  });

  function fitNow() {
    const t = current && terms.get(current);
    if (!t || box.hidden) return;
    try {
      t.fit.fit();
    } catch {}
    api.resize(current, t.term.cols, t.term.rows);
  }
  new ResizeObserver(() => requestAnimationFrame(fitNow)).observe(termHost);

  function show(key, s) {
    if (!key || hidden) {
      box.hidden = true;
      current = key;
      return;
    }
    const changed = key !== current;
    current = key;
    box.hidden = false;
    const t = ensure(key);
    for (const x of terms.values()) x.el.style.display = x === t ? 'block' : 'none';
    const status = s ? D.LABELS[s.status] || s.status : 'Başlıyor…';
    title.innerHTML = `›_ <b>${D.esc(s ? s.name : 'Yeni oturum')}</b> <span class="st ${s ? s.status : ''}">${D.esc(status)}</span>`;
    note.textContent = key.startsWith('own:')
      ? 'Bu klasör ilk kez açılıyor: güven sorusunu terminalde cevapla. Agentinan kapanınca bu oturum da kapanır.'
      : 'Agentinan kapansa da arka planda çalışmaya devam eder.';
    if (changed) {
      requestAnimationFrame(fitNow);
      text.focus();
    }
  }

  function update() {
    const snap = D.snap();
    if (pendingKey) {
      const s = snap.sessions.find((x) => x.control === pendingKey);
      if (s) {
        pendingKey = null;
        hidden = false;
        D.select(s.id, true);
        return; // select() calls update again
      }
    }
    const s = snap.sessions.find((x) => x.id === D.selected());
    show((s && s.control) || pendingKey, s);
  }

  window.addEventListener('dash:select', () => {
    hidden = false;
    update();
  });
  window.addEventListener('dash:snapshot', update);

  // ---------- command box and buttons ----------
  document.getElementById('conForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = text.value;
    if (!current || !v.trim()) return;
    api.sendLine(current, v);
    text.value = '';
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) api.input(current, '\x1b');
  });
  document.getElementById('conApprove').onclick = () => current && api.input(current, '\r');
  document.getElementById('conReject').onclick = () => current && api.input(current, '\x1b');
  document.getElementById('conHide').onclick = () => {
    hidden = true;
    box.hidden = true;
  };

  const stopBtn = document.getElementById('conStop');
  let armed = null;
  stopBtn.onclick = () => {
    if (!current) return;
    if (!armed) {
      stopBtn.textContent = 'Emin misin? Tekrar bas';
      armed = setTimeout(() => {
        armed = null;
        stopBtn.textContent = 'Oturumu kapat';
      }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    stopBtn.textContent = 'Oturumu kapat';
    api.stopSession(current);
  };

  // ---------- new session dialog ----------
  const modal = document.getElementById('newModal');
  const cwd = document.getElementById('newCwd');
  const name = document.getElementById('newName');
  const prompt = document.getElementById('newPrompt');
  const err = document.getElementById('newErr');
  const go = document.getElementById('newGo');

  function openModal() {
    try {
      cwd.value = localStorage.getItem('lastCwd') || '';
    } catch {}
    name.value = '';
    prompt.value = '';
    err.textContent = '';
    go.disabled = false;
    go.textContent = 'Başlat';
    modal.hidden = false;
    (cwd.value ? prompt : document.getElementById('newPick')).focus();
  }
  const closeModal = () => (modal.hidden = true);

  document.getElementById('newBtn').onclick = openModal;
  document.getElementById('newCancel').onclick = closeModal;
  modal.addEventListener('click', (e) => e.target === modal && closeModal());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !modal.hidden && closeModal());
  document.getElementById('newPick').onclick = async () => {
    const dir = await api.pickFolder();
    if (dir) cwd.value = dir;
  };
  prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('newForm').requestSubmit();
  });

  document.getElementById('newForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!cwd.value) {
      err.textContent = 'Önce bir klasör seç.';
      return;
    }
    go.disabled = true;
    go.textContent = 'Başlatılıyor…';
    err.textContent = '';
    const r = await api.startSession({ cwd: cwd.value, name: name.value.trim(), prompt: prompt.value.trim() });
    if (!r || r.error) {
      err.textContent = 'Başlatılamadı: ' + ((r && r.error) || 'bilinmeyen hata');
      go.disabled = false;
      go.textContent = 'Başlat';
      return;
    }
    try {
      localStorage.setItem('lastCwd', cwd.value);
    } catch {}
    closeModal();
    pendingKey = r.key;
    hidden = false;
    D.select(null);
    show(r.key, null);
  });
})();
