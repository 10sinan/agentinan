'use strict';
// The Terminal tab: a list of the sessions Agentinan can drive (s.control set), the chosen one's terminal
// (xterm.js) and a box to type to Claude; plus the "new session" dialog.
(() => {
  const api = window.agentinan;
  const D = window.dash;
  const $ = (id) => document.getElementById(id);
  const termHost = document.querySelector('.term');
  const text = $('conText');

  const terms = new Map(); // control key → { term, fit, el, ready, dead }
  let current = null;
  let pendingKey = null; // a session we just started that isn't in the snapshot yet


  // retry: the user chose this session (select / tab), so a closed attach may be opened again;
  // snapshot updates never re-attach, or a stopping session would get a new `claude attach` every poll
  function ensure(key, retry) {
    let t = terms.get(key);
    if (t && !t.dead) return t;
    if (t && (!retry || Date.now() - t.deadAt < 10_000)) return t;
    if (t) {
      t.term.dispose();
      t.el.remove();
    }
    const el = document.createElement('div');
    el.className = 'term-inst';
    termHost.appendChild(el);
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: true,
      theme: window.themes.xterm(),
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.onData((d) => api.input(key, d));
    t = { term, fit, el, ready: false, dead: false };
    terms.set(key, t);
    api.attach(key).then((r) => {
      if (!r || r.error) {
        term.write(`\r\n\x1b[31mBağlanılamadı${r && r.error ? ': ' + window.plainText(r.error) : ''}\x1b[0m\r\n`); // a message, not terminal output: no escape sequences from it
        t.dead = true;
        t.deadAt = Date.now();
        return;
      }
      // The buffer already holds everything sent before this reply, so nothing that arrived meanwhile is lost.
      term.write(r.buffer);
      t.ready = true;
      fitNow();
    });
    return t;
  }

  window.addEventListener('dash:theme', () => {
    const theme = window.themes.xterm();
    for (const t of terms.values()) t.term.options.theme = theme;
  });

  api.onTermData(({ key, data }) => {
    const t = terms.get(key);
    if (t && t.ready) t.term.write(data);
  });
  api.onTermExit(({ key }) => {
    const t = terms.get(key);
    if (!t) return;
    t.dead = true;
    t.deadAt = Date.now();
    t.term.write('\r\n\x1b[90m— bağlantı kapandı —\x1b[0m\r\n');
  });

  function fitNow() {
    const t = current && terms.get(current);
    if (!t || D.tab() !== 'terminal') return;
    try {
      t.fit.fit();
    } catch {}
    api.resize(current, t.term.cols, t.term.rows);
  }
  new ResizeObserver(() => requestAnimationFrame(fitNow)).observe(termHost);

  const controllable = () => D.snap().sessions.filter((s) => s.control);

  // Which terminal to show: the selected session if it's controllable, else the one already shown, else the first.
  function pick() {
    const list = controllable();
    const sel = list.find((s) => s.id === D.selected());
    if (sel) return sel.control;
    if (current && (list.some((s) => s.control === current) || current === pendingKey)) return current;
    return list[0]?.control || pendingKey || null;
  }

  function renderList(list) {
    const items = list
      .map(
        (s) => `<div class="titem${s.control === current ? ' active' : ''}" data-id="${D.esc(s.id)}">
          <i class="sdot ${D.esc(s.status)}"></i>
          <div class="tn"><b>${D.esc(s.name)}</b><span>${D.LABELS[s.status] || D.esc(s.status)} · ${D.esc(s.project)}</span></div>
        </div>`,
      )
      .join('');
    const pending =
      pendingKey && !list.some((s) => s.control === pendingKey)
        ? `<div class="titem${current === pendingKey ? ' active' : ''}"><i class="sdot busy"></i><div class="tn"><b>Yeni oturum</b><span>Başlıyor…</span></div></div>`
        : '';
    $('tlist').innerHTML = `<h4>Komut verilebilen</h4>${items}${pending}<button class="btn sm" id="tlistNew">${icon('plus')}Yeni oturum</button>`;
  }

  function update(retry) {
    const snap = D.snap();
    if (pendingKey) {
      const s = snap.sessions.find((x) => x.control === pendingKey);
      if (s) {
        pendingKey = null;
        D.select(s.id); // fires dash:select → update
        return;
      }
    }
    const list = controllable();
    const key = pick();
    const changed = key !== current;
    current = key;
    renderList(list);
    $('tempty').hidden = !!key;
    $('tmain').hidden = !key;
    if (!key) return;

    const t = ensure(key, retry === true);
    for (const x of terms.values()) x.el.style.display = x === t ? 'block' : 'none';
    const s = list.find((x) => x.control === key);
    if (D.pickerOpen($('conTitle'))) return; // an open model menu would close on redraw
    $('conTitle').innerHTML = s
      ? `<i class="sdot ${D.esc(s.status)}"></i><b>${D.esc(s.name)}</b><span class="pill ${D.esc(s.status)}">${D.LABELS[s.status] || D.esc(s.status)}${
          s.status === 'waiting' && s.waitingFor ? ' · ' + D.esc(s.waitingFor) : ''
        }</span>${D.modelPicker(s)}`
      : `<i class="sdot busy"></i><b>Yeni oturum</b><span class="pill busy">Başlıyor…</span>`;
    $('conNote').textContent = key.startsWith('own:')
      ? 'Bu klasör ilk kez açılıyor: Claude\'un güven sorusunu terminalde cevapla. Agentinan kapanınca bu oturum da kapanır.'
      : `${s ? s.cwd + ' · ' : ''}Agentinan'ı kapatsan da arka planda çalışmaya devam eder.`;
    if (changed) {
      requestAnimationFrame(fitNow);
      if (D.tab() === 'terminal') text.focus();
    }
  }

  window.addEventListener('dash:select', () => update(true));
  window.addEventListener('dash:snapshot', () => update(false));
  window.addEventListener('dash:tab', (e) => {
    if (e.detail !== 'terminal') return;
    update(true);
    requestAnimationFrame(() => {
      fitNow();
      if (current) text.focus();
    });
  });

  $('tlist').addEventListener('click', (e) => {
    if (e.target.closest('#tlistNew')) return openModal();
    const it = e.target.closest('.titem[data-id]');
    if (it) D.select(it.dataset.id);
  });

  // ---------- command box and buttons ----------
  $('conForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = text.value;
    if (!current || !v.trim()) return;
    api.sendLine(current, v);
    text.value = '';
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) api.input(current, '\x1b');
  });
  $('conApprove').onclick = () => current && api.input(current, '\r');
  $('conReject').onclick = () => current && api.input(current, '\x1b');

  const stopBtn = $('conStop');
  const stopLabel = stopBtn.querySelector('span');
  let armed = null;
  stopBtn.onclick = () => {
    if (!current) return;
    if (!armed) {
      stopLabel.textContent = 'Emin misin? Tekrar bas';
      armed = setTimeout(() => {
        armed = null;
        stopLabel.textContent = 'Oturumu kapat';
      }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    stopLabel.textContent = 'Oturumu kapat';
    api.stopSession(current);
    D.toast('Oturum kapatılıyor');
  };

  // ---------- new session dialog ----------
  const modal = $('newModal');
  const cwd = $('newCwd');
  const name = $('newName');
  const prompt = $('newPrompt');
  const err = $('newErr');
  const go = $('newGo');

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
    (cwd.value ? prompt : $('newPick')).focus();
  }
  const closeModal = () => (modal.hidden = true);
  window.openNewSession = openModal;

  $('newBtn').onclick = openModal;
  $('temptyNew').onclick = openModal;
  $('newCancel').onclick = closeModal;
  modal.addEventListener('click', (e) => e.target === modal && closeModal());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !modal.hidden && closeModal());
  $('newPick').onclick = async () => {
    const dir = await api.pickFolder();
    if (dir) cwd.value = dir;
  };
  prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('newForm').requestSubmit();
  });

  $('newForm').addEventListener('submit', async (e) => {
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
    current = r.key;
    D.select(null);
    D.setTab('terminal');
  });
})();
