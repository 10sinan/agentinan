'use strict';
// Tabs, top bar, the sessions grid, the map's info card and settings.
// The 3D map (orbit3d.js) and the terminal view (console.js) talk to this file through window.dash.

const api = window.agentinan;
const COLORS = { busy: '#f6b860', waiting: '#ff6f86', idle: '#6cc8e6' };
const LABELS = { busy: 'Çalışıyor', waiting: 'Seni bekliyor', idle: 'Boşta' };
const TITLES = { map: 'Harita', sessions: 'Oturumlar', terminal: 'Terminal', git: 'Git', settings: 'Ayarlar' };

let snap = { sessions: [], today: { tokens: 0, cost: 0, byModel: {} } };
let selected = null;
let tab = 'map';
let filter = 'all';
let settings = { notifyWaiting: true, notifyDone: true, quality: 'high' };

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

const fmtCost = (c) => '$' + (c >= 100 ? c.toFixed(0) : c.toFixed(2));

function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + ' sn';
  if (s < 3600) return Math.round(s / 60) + ' dk';
  if (s < 86400) return Math.floor(s / 3600) + ' sa ' + (Math.round(s / 60) % 60) + ' dk';
  return Math.floor(s / 86400) + ' gün';
}

const ctxLimit = (s) => (s.model && /^Haiku 4/.test(s.model) ? 200_000 : 1_000_000);

function toast(text) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 1700);
}

const statusPill = (s) =>
  `<span class="pill ${s.status}"><i class="sdot ${s.status}"></i>${LABELS[s.status] || esc(s.status)}</span>`;

const controlPill = (s) =>
  s.control
    ? `<span class="pill ctl">${icon('terminal')}Komut verilebilir</span>`
    : `<span class="pill" title="Komut vermek için oturumu Agentinan'dan başlat">${icon('eye')}Sadece izleme</span>`;

// ---------- tabs ----------
function setTab(name) {
  if (!TITLES[name]) return;
  tab = name;
  document.body.dataset.tab = name;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === name);
  $('viewTitle').textContent = TITLES[name];
  renderSub();
  try {
    localStorage.setItem('tab', name);
  } catch {}
  window.dispatchEvent(new CustomEvent('dash:tab', { detail: name }));
}
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab));

function renderSub() {
  const n = snap.sessions.length;
  const w = snap.sessions.filter((s) => s.status === 'waiting').length;
  $('viewSub').textContent = n ? `${n} oturum${w ? ` · ${w} seni bekliyor` : ''}` : '';
}

// ---------- top bar ----------
function renderToday() {
  const t = snap.today;
  const models = Object.entries(t.byModel || {})
    .filter(([, v]) => v.tokens > 0)
    .sort((a, b) => b[1].cost - a[1].cost);
  $('today').innerHTML =
    `<span class="stat-chip lead" title="API liste fiyatıyla tahmini; Pro/Max aboneliğinde bu tutarı ödemezsin">Bugün <b>${fmtTok(t.tokens)}</b> token <b class="cost">${fmtCost(t.cost)}</b></span>` +
    models.map(([m, v]) => `<span class="stat-chip">${esc(m)} <b>${fmtTok(v.tokens)}</b> ${fmtCost(v.cost)}</span>`).join('');
}

function renderBadges() {
  const waiting = snap.sessions.filter((s) => s.status === 'waiting');
  const set = (el, n) => {
    el.hidden = !n;
    el.textContent = n;
  };
  set($('badgeSessions'), waiting.length);
  set($('badgeTerminal'), waiting.filter((s) => s.control).length);
}

// ---------- sessions grid ----------
const FILTERS = [
  ['all', 'Tümü', () => true],
  ['busy', 'Çalışan', (s) => s.status === 'busy'],
  ['waiting', 'Bekleyen', (s) => s.status === 'waiting'],
  ['control', 'Komut verilebilir', (s) => !!s.control],
];

function renderFilters() {
  $('filters').innerHTML = FILTERS.map(([key, label, fn]) => {
    const n = snap.sessions.filter(fn).length;
    return `<button class="filter${filter === key ? ' active' : ''}" data-f="${key}">${label}<em>${n}</em></button>`;
  }).join('');
}
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('.filter');
  if (!b) return;
  filter = b.dataset.f;
  renderFilters();
  renderGrid();
});

function card(s) {
  const now = Date.now();
  const tools = s.recentTools
    .slice(-4)
    .reverse()
    .map((t) => `<span class="chip${now - t.ts < 8000 && s.status === 'busy' ? ' live' : ''}"><b>${esc(t.name)}</b>${t.brief ? ' ' + esc(t.brief) : ''}</span>`)
    .join('');
  const agents = s.subagents.filter((a) => a.active).length;
  const pct = Math.min(100, (s.context / ctxLimit(s)) * 100);
  const waiting = s.status === 'waiting' && s.waitingFor ? ` · ${esc(s.waitingFor)}` : '';
  return `
  <div class="card ${s.status}${s.id === selected ? ' sel' : ''}" data-id="${esc(s.id)}">
    <div class="c-top"><span class="c-name">${esc(s.name)}</span>${statusPill(s)}</div>
    <div class="c-meta">${controlPill(s)}<span>${esc(s.project)} · ${esc(s.model || 'model yok')} · ${ago(s.statusSince)}${waiting}</span></div>
    ${s.lastPrompt ? `<div class="c-prompt">${esc(s.lastPrompt)}</div>` : ''}
    ${s.lastText ? `<div class="c-reply">${esc(s.lastText)}</div>` : ''}
    ${tools ? `<div class="c-tools">${tools}</div>` : ''}
    <div class="c-stats">
      <div><span>Token</span><b>${fmtTok(s.tokens.total)}</b></div>
      <div><span>Maliyet*</span><b>${fmtCost(s.cost)}</b></div>
      <div><span>Araç</span><b>${s.toolCount}</b></div>
      <div><span>Alt ajan</span><b>${agents}/${s.subagents.length}</b></div>
    </div>
    <div class="ctx" title="Bağlam: ${s.context.toLocaleString('tr-TR')} / ${fmtTok(ctxLimit(s))} token"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="c-actions">
      <button class="btn sm" data-act="map">${icon('target')}Haritada</button>
      ${s.control ? `<button class="btn sm" data-act="term">${icon('terminal')}Terminal</button>` : ''}
      <button class="btn sm ghost" data-act="open" title="Klasörü aç">${icon('folder')}</button>
      <button class="btn sm ghost" data-act="resume" title="claude --resume komutunu kopyala">${icon('copy')}</button>
    </div>
  </div>`;
}

function renderGrid() {
  const grid = $('grid');
  const fn = FILTERS.find((f) => f[0] === filter)[2];
  const list = snap.sessions.filter(fn);
  const scroll = grid.scrollTop;
  grid.innerHTML = list.length
    ? list.map(card).join('')
    : `<div class="grid-empty">${snap.sessions.length ? 'Bu filtreye uyan oturum yok.' : 'Şu an çalışan Claude Code oturumu yok.'}</div>`;
  grid.scrollTop = scroll;
}

$('grid').addEventListener('click', (e) => {
  const el = e.target.closest('.card');
  if (!el) return;
  const s = snap.sessions.find((x) => x.id === el.dataset.id);
  const act = e.target.closest('button')?.dataset.act;
  if (!s) return;
  if (act === 'open') return void api.openFolder(s.cwd);
  if (act === 'resume') {
    api.copy(`cd ${JSON.stringify(s.cwd)} && claude --resume ${s.id}`);
    return toast('Devam komutu kopyalandı');
  }
  select(s.id);
  if (act === 'map') setTab('map');
  if (act === 'term') setTab('terminal');
});

// ---------- map info card ----------
function renderMapCard() {
  const el = $('mapCard');
  const s = snap.sessions.find((x) => x.id === selected);
  if (!s) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `
    <div class="mc-top"><i class="sdot ${s.status}"></i><span class="mc-name">${esc(s.name)}</span>${statusPill(s)}</div>
    <div class="mc-meta">${esc(s.project)} · ${esc(s.model || 'model yok')} · ${ago(s.statusSince)}${s.waitingFor && s.status === 'waiting' ? ' · ' + esc(s.waitingFor) : ''}</div>
    ${s.lastPrompt ? `<div class="mc-prompt">› ${esc(s.lastPrompt)}</div>` : ''}
    <div class="mc-stats">
      <div><span>Token</span><b>${fmtTok(s.tokens.total)}</b></div>
      <div><span>Maliyet*</span><b>${fmtCost(s.cost)}</b></div>
      <div><span>Araç</span><b>${s.toolCount}</b></div>
    </div>
    <div class="mc-actions">
      ${s.control ? `<button class="btn primary sm" data-act="term">${icon('terminal')}Terminali aç</button>` : `<span class="pill">${icon('eye')}Sadece izleme</span>`}
      <button class="btn sm" data-act="details">Ayrıntılar</button>
      <button class="btn sm ghost" data-act="close" title="Seçimi kaldır">${icon('x')}</button>
    </div>`;
}
$('mapCard').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'term') setTab('terminal');
  if (act === 'details') setTab('sessions');
  if (act === 'close') select(null);
});

// ---------- selection ----------
function select(id, reveal) {
  selected = id;
  renderGrid();
  renderMapCard();
  window.dispatchEvent(new CustomEvent('dash:select', { detail: id }));
  if (id && reveal) $('grid').querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- settings ----------
function applySettings() {
  $('nWaiting').checked = settings.notifyWaiting;
  $('nDone').checked = settings.notifyDone;
  for (const b of document.querySelectorAll('#quality button')) b.classList.toggle('active', b.dataset.q === settings.quality);
  document.body.classList.toggle('low', settings.quality === 'low');
  window.dispatchEvent(new CustomEvent('dash:settings', { detail: settings }));
}
async function saveSettings(patch) {
  settings = await api.setSettings(patch);
  applySettings();
}
$('nWaiting').onchange = () => saveSettings({ notifyWaiting: $('nWaiting').checked });
$('nDone').onchange = () => saveSettings({ notifyDone: $('nDone').checked });
$('quality').addEventListener('click', (e) => {
  const q = e.target.closest('button')?.dataset.q;
  if (q) saveSettings({ quality: q });
});

// ---------- shared with orbit3d.js and console.js ----------
window.dash = {
  COLORS,
  LABELS,
  esc,
  fmtTok,
  fmtCost,
  ago,
  toast,
  snap: () => snap,
  selected: () => selected,
  select,
  tab: () => tab,
  setTab,
  settings: () => settings,
};

// ---------- wiring ----------
api.onSnapshot((s) => {
  snap = s;
  if (selected && !s.sessions.some((x) => x.id === selected)) selected = null;
  renderToday();
  renderSub();
  renderBadges();
  renderFilters();
  renderGrid();
  renderMapCard();
  $('claudeDir').textContent = s.claudeDir || '—';
  window.dispatchEvent(new CustomEvent('dash:snapshot', { detail: s }));
});
api.onSelect((id) => {
  select(id, true);
  const s = snap.sessions.find((x) => x.id === id);
  setTab(s && s.control ? 'terminal' : 'map');
});

(async () => {
  settings = { ...settings, ...(await api.getSettings()) };
  applySettings();
})();

let startTab = 'map';
try {
  startTab = localStorage.getItem('tab') || 'map';
} catch {}
setTab(startTab);
