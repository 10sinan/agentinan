'use strict';
// Tabs, top bar, the sessions grid, the map's info card and settings.
// The 3D map (orbit3d.js) and the terminal view (console.js) talk to this file through window.dash.

const api = window.agentinan;
// status colours follow the theme (themes.js)
const statusColors = () => {
  const t = window.themes.current();
  return { busy: t.busy, waiting: t.waiting, idle: t.idle };
};
const LABELS = { busy: 'Çalışıyor', waiting: 'Seni bekliyor', idle: 'Boşta' };
const TITLES = { map: 'Harita', sessions: 'Oturumlar', terminal: 'Terminal', git: 'Git', settings: 'Ayarlar' };

let snap = { sessions: [], today: { tokens: 0, cost: 0, byModel: {} } };
let selected = null;
let tab = 'map';
let filter = 'all';
let settings = { notifyWaiting: true, notifyDone: true, quality: 'high', theme: 'agentinan' };

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

// POSIX shell single quotes: nothing inside is expanded; an embedded ' becomes '\''
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const fmtCost = (c) => '$' + (c >= 100 ? c.toFixed(0) : c.toFixed(2));

function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + ' sn';
  if (s < 3600) return Math.round(s / 60) + ' dk';
  if (s < 86400) return Math.floor(s / 3600) + ' sa ' + (Math.floor(s / 60) % 60) + ' dk';
  return Math.floor(s / 86400) + ' gün';
}

const ctxLimit = (s) => {
  if (s.context > 200_000) return 1_000_000;
  const m = /^(Opus|Sonnet|Haiku|Fable|Mythos) (\d+)\.?(\d*)/.exec(s.model || '');
  if (!m) return 200_000;
  const v = Number(m[2]) + Number(m[3] || 0) / 10;
  if (m[1] === 'Fable' || m[1] === 'Mythos') return 1_000_000;
  if (m[1] === 'Haiku') return v >= 5 ? 1_000_000 : 200_000;
  return v >= 4.6 ? 1_000_000 : 200_000; // Opus / Sonnet 4.6 and later
};

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
    .filter(([, v]) => v.tokens > 0 || v.output > 0)
    .sort((a, b) => b[1].cost - a[1].cost);
  $('today').innerHTML =
    `<span class="stat-chip lead" title="Bugün Claude'un yazdığı (çıkış) token'lar. Önbellekten okunanlarla birlikte toplam: ${fmtTok(t.tokens)}. Maliyet API liste fiyatıyla tahmindir; Pro/Max aboneliğinde bu tutarı ödemezsin.">bugün çıkış <b>${fmtTok(t.output || 0)}</b> <b class="cost">${fmtCost(t.cost)}</b></span>` +
    models.map(([m, v]) => `<span class="stat-chip" title="${esc(m)}: çıkış ${fmtTok(v.output || 0)}, önbellek dahil toplam ${fmtTok(v.tokens)}">${esc(m)} <b>${fmtTok(v.output || 0)}</b> ${fmtCost(v.cost)}</span>`).join('');
}

// ---------- plan usage limits (top bar) ----------
function until(ms) {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (s < 3600) return Math.ceil(s / 60) + ' dk';
  if (s < 86400) return Math.floor(s / 3600) + ' sa ' + (Math.floor(s / 60) % 60) + ' dk';
  return Math.floor(s / 86400) + ' gün ' + (Math.floor(s / 3600) % 24) + ' sa';
}

function limitGauge(label, l) {
  if (!l) return '';
  const pct = Math.max(0, Math.min(100, l.pct));
  const lvl = pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : '';
  const reset = l.resetsAt ? until(l.resetsAt) : '?';
  const when = l.resetsAt ? new Date(l.resetsAt).toLocaleString('tr-TR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return `<span class="lim ${lvl}" title="${label} limit: %${pct.toFixed(1)} kullanıldı · ${when} sıfırlanır (${reset} sonra)">
    <span class="lim-k">${label}</span><i><b style="width:${pct}%"></b></i><span class="lim-v">${Math.round(pct)}%</span><span class="lim-r">${reset}</span>
  </span>`;
}

function renderLimits() {
  const L = snap.limits;
  const el = $('limits');
  if (!L) return void (el.innerHTML = '');
  $('limState').textContent = L.enabled
    ? L.at
      ? `açık · son bilgi ${ago(L.at)} önce`
      : 'açık · henüz bilgi gelmedi (terminalde çalışan bir Claude oturumu istek yapınca gelir)'
    : 'kapalı';
  $('limToggle').textContent = L.enabled ? 'Kaldır' : 'Etkinleştir';
  if (!L.enabled) {
    el.innerHTML = ''; // off: the switch lives in Ayarlar, no placeholder in the top bar
    return;
  }
  if (!L.fiveHour && !L.week) {
    el.innerHTML = `<span class="lim-wait" title="Terminalde çalışan bir Claude Code oturumu bir istek yapınca gelir">limit bilgisi bekleniyor…</span>`;
    return;
  }
  const stale = L.at && Date.now() - L.at > 30 * 60_000 ? `<span class="lim-age" title="Limitler en son ${ago(L.at)} önce güncellendi">${ago(L.at)} önce</span>` : '';
  el.innerHTML = limitGauge('5s', L.fiveHour) + limitGauge('hafta', L.week) + stale;
}

function openLimModal() {
  $('limErr').textContent = '';
  $('limModal').hidden = false;
}
$('limits').addEventListener('click', (e) => {
  if (e.target.closest('#limOpen')) openLimModal();
});
$('limCancel').onclick = () => ($('limModal').hidden = true);
$('limGo').onclick = async () => {
  const r = await api.enableLimits();
  if (r && r.error) return void ($('limErr').textContent = 'Olmadı: ' + r.error);
  $('limModal').hidden = true;
  toast('Limit takibi açıldı');
  api.refresh();
};
$('limToggle').onclick = async () => {
  if (!snap.limits?.enabled) return openLimModal();
  const r = await api.disableLimits();
  toast(r && r.error ? 'Olmadı: ' + r.error : 'Limit takibi kaldırıldı');
  api.refresh();
};
$('nLimits').onchange = () => saveSettings({ notifyLimits: $('nLimits').checked });

function renderBadges() {
  const waiting = snap.sessions.filter((s) => s.status === 'waiting');
  const set = (el, n) => {
    el.hidden = !n;
    el.textContent = n;
  };
  set($('badgeSessions'), waiting.length);
  set($('badgeTerminal'), waiting.filter((s) => s.control).length);
}

// ---------- sessions table ----------
// One row per session (like htop); the selected row opens a detail panel under it.
const FILTERS = [
  ['all', 'tümü', () => true],
  ['busy', 'çalışan', (s) => s.status === 'busy'],
  ['waiting', 'bekleyen', (s) => s.status === 'waiting'],
  ['control', 'komut verilebilir', (s) => !!s.control],
];
const STATUS_WORD = { busy: 'çalışıyor', waiting: 'bekliyor', idle: 'boşta' };

function renderFilters() {
  $('filters').innerHTML = FILTERS.map(([key, label, fn]) => {
    const n = snap.sessions.filter(fn).length;
    return `<button class="filter${filter === key ? ' active' : ''}" data-f="${key}">${label} <em>${n}</em></button>`;
  }).join('');
}
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('.filter');
  if (!b) return;
  filter = b.dataset.f;
  renderFilters();
  renderGrid();
});

function row(s) {
  const pct = Math.min(100, (s.context / ctxLimit(s)) * 100);
  const lt = s.recentTools[s.recentTools.length - 1];
  const hog = (snap.hogs || []).find((x) => x.sessionId === s.id);
  return `
  <div class="srow ${s.status}${s.id === selected ? ' sel' : ''}" data-id="${esc(s.id)}">
    <span class="c-st"><i class="sdot ${s.status}"></i>${STATUS_WORD[s.status] || esc(s.status)}</span>
    <span class="c-nm">${esc(s.name)}${s.control ? ' <em class="tag">ctl</em>' : ''}${hog ? ' <em class="tag hot">yoruyor</em>' : ''}</span>
    <span class="c-pj" title="${esc(s.cwd)}">${esc(s.project)}</span>
    <span class="c-md">${esc(s.model || '—')}</span>
    <span class="c-ctx" title="Bağlam: şu an ${s.context.toLocaleString('tr-TR')} / ${fmtTok(ctxLimit(s))} token dolu"><em>${fmtTok(s.context)}</em><i><b style="width:${pct.toFixed(1)}%"></b></i>${Math.round(pct)}%</span>
    <span class="c-num" title="Claude'un bu oturumda yazdığı token'lar">${fmtTok(s.tokens.output)}</span>
    <span class="c-num">${fmtCost(s.cost)}</span>
    <span class="c-tl">${lt ? `${esc(lt.name)} <small>${esc(lt.brief)}</small>` : '—'}</span>
    <span class="c-num dim">${ago(s.statusSince)}</span>
  </div>
  ${s.id === selected ? detail(s, hog) : ''}`;
}

// share of the prompt served from the cache: high is good (cheaper, faster)
function cacheHit(s) {
  const t = s.tokens;
  const prompt = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  return prompt ? Math.round((t.cacheRead / prompt) * 100) + '%' : '—';
}

function detail(s, hog) {
  const tools = s.recentTools
    .slice(-8)
    .reverse()
    .map((t) => `<div><b>${esc(t.name)}</b> ${esc(t.brief)} <small>${ago(t.ts)}</small></div>`)
    .join('');
  const agents = s.subagents.filter((a) => a.active);
  return `
  <div class="sdetail" data-id="${esc(s.id)}">
    <div class="sd-main">
      ${hog ? `<div class="sd-hog">${esc(hog.name)} bilgisayarı yoruyor · %${hog.cpu} işlemci</div>` : ''}
      ${s.status === 'waiting' && s.waitingFor ? `<div class="sd-wait">bekliyor: ${esc(s.waitingFor)}</div>` : ''}
      <div class="sd-k">son istek</div>
      <div class="sd-v">${esc(s.lastPrompt) || '—'}</div>
      <div class="sd-k">son cevap</div>
      <div class="sd-v dim">${esc(s.lastText) || '—'}</div>
      ${agents.length ? `<div class="sd-k">çalışan alt ajanlar</div><div class="sd-v">${agents.map((a) => esc(a.desc || a.type)).join(', ')}</div>` : ''}
    </div>
    <div class="sd-side">
      <div class="sd-k">son araçlar</div>
      <div class="sd-tools">${tools || '—'}</div>
      <div class="sd-k">token</div>
      <div class="sd-kv">
        <span>bağlam (şu an)</span><b>${fmtTok(s.context)} / ${fmtTok(ctxLimit(s))}</b>
        <span>giriş</span><b>${fmtTok(s.tokens.input)}</b>
        <span>çıkış</span><b>${fmtTok(s.tokens.output)}</b>
        <span>önbellek yazma</span><b>${fmtTok(s.tokens.cacheWrite5m + s.tokens.cacheWrite1h)}</b>
        <span>önbellek okuma</span><b>${fmtTok(s.tokens.cacheRead)}</b>
        <span>önbellek isabeti</span><b>${cacheHit(s)}</b>
        <span>toplam (önbellek dahil)</span><b>${fmtTok(s.tokens.total)}</b>
        <span>araç çağrısı</span><b>${s.toolCount}</b>
        <span>model</span><b class="model-cell">${modelPicker(s)}</b>
        <span>pid</span><b>${s.pid}</b>
      </div>
      <div class="sd-path" title="${esc(s.cwd)}">${esc(s.cwd)}</div>
      <div class="sd-actions">
        <button class="btn sm" data-act="map">haritada</button>
        ${s.control ? `<button class="btn sm" data-act="term">terminal</button>` : ''}
        <button class="btn sm" data-act="open">klasör</button>
        <button class="btn sm" data-act="resume" title="claude --resume komutunu kopyala">--resume</button>
        <button class="btn sm" data-act="rename" title="Sohbetin adını değiştir">${icon('pencil')}ad</button>
        ${delButton(s)}
      </div>
    </div>
  </div>`;
}

function renderGrid() {
  const grid = $('grid');
  if (pickerOpen(grid)) return;
  const fn = FILTERS.find((f) => f[0] === filter)[2];
  const list = snap.sessions.filter(fn);
  const scroll = grid.scrollTop;
  const head = `<div class="srow shead"><span>durum</span><span>oturum</span><span>proje</span><span>model</span><span>bağlam</span><span class="c-num">çıkış</span><span class="c-num">maliyet*</span><span>son araç</span><span class="c-num">süre</span></div>`;
  grid.innerHTML = list.length
    ? head + list.map(row).join('') + `<div class="sfoot">* API liste fiyatıyla tahmin. Satıra tıkla: ayrıntı.</div>`
    : `<div class="grid-empty">${snap.sessions.length ? 'bu filtreye uyan oturum yok' : 'çalışan Claude Code oturumu yok'}</div>`;
  grid.scrollTop = scroll;
}

$('grid').addEventListener('click', (e) => {
  const el = e.target.closest('.srow[data-id], .sdetail');
  if (!el) return;
  const s = snap.sessions.find((x) => x.id === el.dataset.id);
  const act = e.target.closest('button')?.dataset.act;
  if (!s) return;
  if (act === 'rename') return void openRename(s);
  if (act === 'delete') return void askDelete(s);
  if (act === 'open') return void api.openFolder(s.cwd);
  if (act === 'resume') {
    api.copy(`cd ${shq(s.cwd)} && claude --resume ${s.id}`);
    return toast('Devam komutu kopyalandı');
  }
  if (act === 'map') {
    select(s.id);
    return setTab('map');
  }
  if (act === 'term') {
    select(s.id);
    return setTab('terminal');
  }
  if (el.classList.contains('srow')) select(selected === s.id ? null : s.id);
});

// ---------- map info card ----------
function renderMapCard() {
  const el = $('mapCard');
  const s = snap.sessions.find((x) => x.id === selected);
  if (!s) {
    el.hidden = true;
    return;
  }
  if (pickerOpen(el) && el.dataset.id === s.id) return;
  // the card is redrawn on every snapshot: keep what is being typed in the command box
  const box = el.querySelector('.mc-send input');
  const typed = box && el.dataset.id === s.id ? { v: box.value, focus: document.activeElement === box } : null;
  el.dataset.id = s.id;
  el.hidden = false;
  el.innerHTML = `
    <div class="mc-top"><i class="sdot ${s.status}"></i><span class="mc-name" title="${esc(s.name)}">${esc(s.name)}</span><button class="btn sm ghost icon-only" data-act="rename" title="Sohbetin adını değiştir">${icon('pencil')}</button>${statusPill(s)}</div>
    <div class="mc-meta">${esc(s.project)} · ${ago(s.statusSince)}${s.waitingFor && s.status === 'waiting' ? ' · ' + esc(s.waitingFor) : ''}</div>
    ${s.lastPrompt ? `<div class="mc-prompt">› ${esc(s.lastPrompt)}</div>` : ''}
    <div class="mc-stats">
      <div><span>Bağlam</span><b>${fmtTok(s.context)}</b></div>
      <div><span>Çıkış</span><b>${fmtTok(s.tokens.output)}</b></div>
      <div><span>Maliyet*</span><b>${fmtCost(s.cost)}</b></div>
      <div><span>Araç</span><b>${s.toolCount}</b></div>
    </div>
    <div class="mc-model"><span>Model</span>${modelPicker(s)}</div>
    ${
      s.control
        ? `<form class="mc-send"><input maxlength="4000" placeholder="Claude'a komut ver…" autocomplete="off" /><button class="btn primary sm" title="Gönder">${icon('send')}</button></form>`
        : ''
    }
    <div class="mc-actions">
      ${s.control ? `<button class="btn sm" data-act="term">${icon('terminal')}Terminal</button>` : `<span class="pill" title="Agentinan dışında açılan oturumlara komut gönderilemez">${icon('eye')}Sadece izleme</span>`}
      <button class="btn sm" data-act="details">Ayrıntılar</button>
      ${delButton(s)}
      <button class="btn sm ghost" data-act="close" title="Seçimi kaldır">${icon('x')}</button>
    </div>`;
  if (typed) {
    const nb = el.querySelector('.mc-send input');
    if (nb) {
      nb.value = typed.v;
      if (typed.focus) nb.focus();
    }
  }
}

// Model chip: shows the model a session is using; for sessions Agentinan controls it is a menu that sends /model.
const MODELS = [
  ['Opus 5.5', 'claude-opus-5-5'],
  ['Sonnet 5.5', 'claude-sonnet-5-5'],
  ['Haiku 5.5', 'claude-haiku-5-5'],
  ['Fable 5.2', 'claude-fable-5-2'],
];
function modelPicker(s) {
  if (!s.control) return `<span class="pill model-chip" title="Agentinan dışında açılan oturumun modeli buradan değiştirilemez">${esc(s.model || 'model yok')}</span>`;
  const known = MODELS.some(([n]) => n === s.model);
  const opts = (known || !s.model ? '' : `<option value="" selected hidden>${esc(s.model)}</option>`) +
    MODELS.map(([n, id]) => `<option value="${id}"${n === s.model ? ' selected' : ''}>${n}</option>`).join('');
  return `<select class="model-pick" data-sid="${esc(s.id)}" title="Bu oturumun modelini değiştir (/model gönderir)">${opts}</select>`;
}
// a redraw would close an open menu
const pickerOpen = (el) => el && el.contains(document.activeElement) && document.activeElement.matches('.model-pick');
function changeModel(sid, modelId) {
  const s = snap.sessions.find((x) => x.id === sid);
  if (!s || !s.control || !modelId) return;
  api.sendLine(s.control, `/model ${modelId}`);
  toast(s.status === 'busy' ? 'Model değişikliği gönderildi; iş bitince uygulanır' : 'Model değişikliği gönderildi');
  document.activeElement?.blur();
}
document.addEventListener('change', (e) => {
  if (e.target.matches?.('.model-pick')) changeModel(e.target.dataset.sid, e.target.value);
});

// Deleting asks twice: the first press arms the button for a few seconds.
let delArmed = null;
let delTimer = null;
function delButton(s) {
  const on = delArmed === s.id;
  return `<button class="btn sm ${on ? 'danger' : ''}" data-act="delete" title="Oturumu kapatır ve sohbeti kalıcı olarak siler">${icon('trash')}${on ? 'Emin misin? Tekrar bas' : 'sil'}</button>`;
}
async function askDelete(s) {
  if (delArmed !== s.id) {
    delArmed = s.id;
    clearTimeout(delTimer);
    delTimer = setTimeout(() => {
      delArmed = null;
      renderGrid();
      renderMapCard();
    }, 3500);
    renderGrid();
    renderMapCard();
    return;
  }
  clearTimeout(delTimer);
  delArmed = null;
  toast('Oturum kapatılıp sohbet siliniyor…');
  const r = await api.deleteSession(s.id);
  if (r && r.error) toast('Silinemedi: ' + r.error);
  else {
    toast('Sohbet silindi');
    if (selected === s.id) select(null);
  }
  api.refresh();
}

// Rename dialog (window.prompt does not exist in Electron).
const renameModal = $('renameModal');
let renaming = null;
function openRename(s) {
  renaming = s;
  $('renameInput').value = s.name;
  $('renameErr').textContent = '';
  renameModal.hidden = false;
  $('renameInput').focus();
  $('renameInput').select();
}
$('renameCancel').onclick = () => (renameModal.hidden = true);
renameModal.addEventListener('click', (e) => e.target === renameModal && (renameModal.hidden = true));
document.addEventListener('keydown', (e) => e.key === 'Escape' && !renameModal.hidden && (renameModal.hidden = true));
$('renameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!renaming) return;
  const r = await api.renameSession(renaming.id, $('renameInput').value);
  if (r && r.error) return void ($('renameErr').textContent = r.error);
  renameModal.hidden = true;
  toast('Ad değiştirildi');
  api.refresh();
});
$('mapCard').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  const s = snap.sessions.find((x) => x.id === selected);
  if (act === 'term') setTab('terminal');
  if (act === 'details') setTab('sessions');
  if (act === 'close') select(null);
  if (act === 'rename' && s) openRename(s);
  if (act === 'delete' && s) askDelete(s);
});
// a command typed on the planet's card goes straight to that session
$('mapCard').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = snap.sessions.find((x) => x.id === selected);
  const input = e.target.querySelector('input');
  if (!s || !s.control || !input || !input.value.trim()) return;
  api.sendLine(s.control, input.value);
  input.value = '';
  toast('Komut gönderildi');
});

// ---------- selection ----------
function select(id, reveal) {
  selected = id;
  renderGrid();
  renderMapCard();
  window.dispatchEvent(new CustomEvent('dash:select', { detail: id }));
  if (id && reveal) $('grid').querySelector(`.srow[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- settings ----------
function applySettings() {
  $('nWaiting').checked = settings.notifyWaiting;
  $('nDone').checked = settings.notifyDone;
  for (const b of document.querySelectorAll('#quality button')) b.classList.toggle('active', b.dataset.q === settings.quality);
  document.body.classList.toggle('low', settings.quality === 'low');
  if (settings.theme !== window.themes.current().id) window.themes.apply(settings.theme);
  try {
    localStorage.setItem('theme', settings.theme);
  } catch {}
  renderThemes();
  $('hogAlertSw').checked = settings.hogAlert;
  $('nLimits').checked = settings.notifyLimits !== false;
  for (const seg of document.querySelectorAll('.seg[data-setting]'))
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', Number(b.dataset.v) === settings[seg.dataset.setting]);
  const ign = settings.hogIgnore || [];
  $('hogIgnoreList').innerHTML = ign.length
    ? ign.map((n) => `<button class="ign-chip" data-n="${esc(n)}" title="Tekrar uyar">${esc(n)} ${icon('x')}</button>`).join('')
    : 'Yok';
  window.dispatchEvent(new CustomEvent('dash:settings', { detail: settings }));
}
async function saveSettings(patch) {
  settings = await api.setSettings(patch);
  applySettings();
}
$('nWaiting').onchange = () => saveSettings({ notifyWaiting: $('nWaiting').checked });
$('nDone').onchange = () => saveSettings({ notifyDone: $('nDone').checked });
$('hogAlertSw').onchange = () => saveSettings({ hogAlert: $('hogAlertSw').checked });
for (const seg of document.querySelectorAll('.seg[data-setting]'))
  seg.addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) saveSettings({ [seg.dataset.setting]: Number(v) });
  });
$('hogIgnoreList').addEventListener('click', (e) => {
  const n = e.target.closest('.ign-chip')?.dataset.n;
  if (n) saveSettings({ hogIgnore: (settings.hogIgnore || []).filter((x) => x !== n) });
});
window.addEventListener('dash:settings-reload', async () => {
  settings = { ...settings, ...(await api.getSettings()) };
  applySettings();
});
$('quality').addEventListener('click', (e) => {
  const q = e.target.closest('button')?.dataset.q;
  if (q) saveSettings({ quality: q });
});

function renderThemes() {
  $('themeGrid').innerHTML = window.themes.list
    .map((t) => {
      const sw = [t.accent, t.accent2, t.busy, t.waiting, t.idle, t.term.green].map((c) => `<i style="background:${c}"></i>`).join('');
      return `<button class="theme-card${t.id === settings.theme ? ' active' : ''}" data-theme="${t.id}" style="--tb:${t.bg};--ts:${t.surface};--tt:${t.text};--ta:${t.accent}">
        <span class="tc-preview"><span class="tc-bar"></span><span class="tc-line"></span><span class="tc-line short"></span><span class="tc-sun"></span></span>
        <span class="tc-name">${esc(t.name)}</span>
        <span class="tc-sw">${sw}</span>
      </button>`;
    })
    .join('');
}
$('themeGrid').addEventListener('click', (e) => {
  const id = e.target.closest('.theme-card')?.dataset.theme;
  if (id && id !== settings.theme) {
    window.themes.apply(id); // instantly, before the save round-trip
    saveSettings({ theme: id });
  }
});

// ---------- shared with orbit3d.js and console.js ----------
window.dash = {
  get COLORS() {
    return statusColors();
  },
  LABELS,
  esc,
  modelPicker,
  pickerOpen,
  fmtTok,
  fmtCost,
  ago,
  toast,
  snap: () => snap,
  hogs: () => snap.hogs || [],
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
  renderLimits();
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
