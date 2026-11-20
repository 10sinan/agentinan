'use strict';
// The terminal drawer at the bottom of the window: ordinary shells (not Claude sessions) for running a project.
// Ctrl+` (or the button in the top bar) opens and closes it; the shells keep running while it is closed.
(() => {
  const api = window.agentinan;
  const D = window.dash;
  const $ = (id) => document.getElementById(id);
  const dock = $('dock');
  const host = $('dockTerms');

  const shells = new Map(); // id → { term, fit, el, name, dead }
  let current = null;
  let open = false;
  let height = 280;
  try {
    height = Math.max(120, Math.min(900, Number(localStorage.getItem('dockHeight')) || height));
  } catch {}

  const save = () => {
    try {
      localStorage.setItem('dockHeight', String(height));
    } catch {}
  };

  function fitNow() {
    const s = current && shells.get(current);
    if (!s || !open) return;
    try {
      s.fit.fit();
    } catch {}
    api.shellResize(current, s.term.cols, s.term.rows);
  }
  new ResizeObserver(() => requestAnimationFrame(fitNow)).observe(host);

  function renderTabs() {
    const tabs = [...shells.entries()]
      .map(
        ([id, s]) =>
          `<div class="dtab${id === current ? ' active' : ''}${s.dead ? ' dead' : ''}" data-id="${D.esc(id)}" title="${D.esc(s.cwd)}"><span>${D.esc(s.name)}</span><button data-close="${D.esc(id)}" title="Kapat">${icon('x')}</button></div>`,
      )
      .join('');
    $('dockTabs').innerHTML = tabs + `<button class="dnew" id="dockNew" title="Yeni terminal (seçili oturumun klasöründe)">${icon('plus')}</button>`;
  }

  function show(id) {
    current = id;
    for (const [k, s] of shells) s.el.style.display = k === id ? 'block' : 'none';
    renderTabs();
    requestAnimationFrame(() => {
      fitNow();
      shells.get(id)?.term.focus();
    });
  }

  // The current project's folder, so "npm start" runs in the right place: the selected session's, else the one
  // whose terminal is on screen, else the busiest / first session, else the folder of the last shell.
  let lastCwd = null;
  function projectCwd() {
    const ss = D.snap().sessions;
    const pick = ss.find((s) => s.id === D.selected()) || ss.find((s) => s.status === 'busy') || ss.find((s) => s.status === 'waiting') || ss[0];
    return pick ? pick.cwd : lastCwd;
  }

  const early = new Map(); // output that arrives before the terminal exists on this side

  async function newShell() {
    const res = await api.shellOpen(projectCwd());
    if (!res || res.error) return void D.toast('Terminal açılamadı' + (res && res.error ? ': ' + res.error : ''));
    const r = res.data;
    lastCwd = r.cwd;
    const el = document.createElement('div');
    el.className = 'term-inst';
    host.appendChild(el);
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
    term.onData((d) => api.shellInput(r.id, d));
    shells.set(r.id, { term, fit, el, name: r.name, cwd: r.cwd, dead: false });
    if (early.has(r.id)) term.write(early.get(r.id).join('')), early.delete(r.id);
    show(r.id);
  }

  function closeShell(id) {
    const s = shells.get(id);
    if (!s) return;
    api.shellClose(id);
    s.term.dispose();
    s.el.remove();
    shells.delete(id);
    if (current === id) current = [...shells.keys()].pop() || null;
    if (current) show(current);
    else {
      renderTabs();
      setOpen(false);
    }
  }

  function setOpen(v) {
    open = v;
    dock.hidden = !v;
    dock.style.height = height + 'px';
    document.body.classList.toggle('dock-open', v);
    $('dockBtn').classList.toggle('on', v);
    if (v && !shells.size) newShell();
    else if (v) show(current || [...shells.keys()][0]);
  }
  const toggle = () => setOpen(!open);

  $('dockBtn').onclick = toggle;
  $('dockHide').onclick = () => setOpen(false);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault();
      e.stopPropagation(); // the terminal itself would otherwise take the key
      toggle();
    }
  }, true);

  $('dockTabs').addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) return closeShell(close.dataset.close);
    if (e.target.closest('#dockNew')) return newShell();
    const tab = e.target.closest('.dtab[data-id]');
    if (tab) show(tab.dataset.id);
  });

  // drag the top edge to resize
  $('dockGrip').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (m) => {
      height = Math.max(120, Math.min(window.innerHeight - 160, startH + (startY - m.clientY)));
      dock.style.height = height + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  api.onShellData(({ id, data }) => {
    const s = shells.get(id);
    if (s) s.term.write(data);
    else (early.get(id) || early.set(id, []).get(id)).push(data);
  });
  api.onShellExit(({ id }) => {
    const s = shells.get(id);
    if (!s) return;
    s.dead = true;
    s.term.write('\r\n\x1b[90m— terminal kapandı (sekmeyi kapatabilirsin) —\x1b[0m\r\n');
    renderTabs();
  });
  window.addEventListener('dash:theme', () => {
    const theme = window.themes.xterm();
    for (const s of shells.values()) s.term.options.theme = theme;
  });

  renderTabs();
})();
