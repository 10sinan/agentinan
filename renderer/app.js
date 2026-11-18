'use strict';
// Header, side list and settings. The 3D map lives in orbit3d.js and talks to this file through window.dash.

const api = window.agentinan;
const COLORS = { busy: '#f5a524', waiting: '#ff4d6d', idle: '#4cc9f0' };
const LABELS = { busy: 'Çalışıyor', waiting: 'Seni bekliyor', idle: 'Boşta' };

let snap = { sessions: [], today: { tokens: 0, cost: 0, byModel: {} } };
let selected = null;

// ---------- helpers ----------
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
  t._h = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---------- header ----------
function renderToday() {
  const t = snap.today;
  const models = Object.entries(t.byModel || {}).sort((a, b) => b[1].cost - a[1].cost);
  document.getElementById('today').innerHTML =
    `<span class="chip main" title="API liste fiyatıyla tahmini; Pro/Max aboneliğinde bu tutarı ödemezsin">Bugün <b>${fmtTok(t.tokens)}</b> token · <b>${fmtCost(t.cost)}</b></span>` +
    models.map(([m, v]) => `<span class="chip">${esc(m)} <b>${fmtTok(v.tokens)}</b> · ${fmtCost(v.cost)}</span>`).join('');
}

// ---------- side list ----------
const list = document.getElementById('list');

function card(s) {
  const now = Date.now();
  const tools = s.recentTools
    .slice(-5)
    .reverse()
    .map((t) => `<span class="tool${now - t.ts < 8000 && s.status === 'busy' ? ' live' : ''}"><b>${esc(t.name)}</b>${t.brief ? ' ' + esc(t.brief) : ''}</span>`)
    .join('');
  const activeAgents = s.subagents.filter((a) => a.active);
  const pct = Math.min(100, (s.context / ctxLimit(s)) * 100);
  const waiting = s.status === 'waiting' && s.waitingFor ? ` · ${esc(s.waitingFor)}` : '';
  return `
  <div class="card ${s.status}${s.id === selected ? ' sel' : ''}" data-id="${esc(s.id)}">
    <div class="row"><span class="name">${s.control ? '›_ ' : ''}${esc(s.name)}</span><span class="badge">${LABELS[s.status] || esc(s.status)}</span></div>
    <div class="sub">${esc(s.project)} · ${esc(s.model || 'model yok')} · ${ago(s.statusSince)}${waiting}</div>
    <div class="tags">${
      s.control
        ? '<span class="tag ctl">Komut verilebilir · seçince terminal açılır</span>'
        : `<span class="tag" title="Komut vermek için oturumu Agentinan'dan başlat">Sadece izleme${s.entrypoint.includes('vscode') ? ' · VS Code' : ''}</span>`
    }</div>
    ${s.lastPrompt ? `<div class="prompt">${esc(s.lastPrompt)}</div>` : ''}
    ${tools ? `<div class="tools">${tools}</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="k">Token</div><div class="v">${fmtTok(s.tokens.total)}</div></div>
      <div class="stat"><div class="k">Maliyet*</div><div class="v">${fmtCost(s.cost)}</div></div>
      <div class="stat"><div class="k">Araç</div><div class="v">${s.toolCount}</div></div>
      <div class="stat"><div class="k">Alt ajan</div><div class="v">${activeAgents.length}/${s.subagents.length}</div></div>
    </div>
    <div class="ctx" title="Bağlam: ${s.context.toLocaleString('tr-TR')} / ${fmtTok(ctxLimit(s))} token"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="details">
      ${s.lastText ? `<div class="reply">${esc(s.lastText)}</div>` : ''}
      ${activeAgents.length ? `<div class="agents">Çalışan alt ajanlar: ${activeAgents.map((a) => esc(a.desc || a.type)).join(', ')}</div>` : ''}
      <div class="sub" title="${esc(s.cwd)}">${esc(s.cwd)}</div>
      <div class="sub">Giriş ${fmtTok(s.tokens.input)} · Çıkış ${fmtTok(s.tokens.output)} · Önbellek yazma ${fmtTok(s.tokens.cacheWrite5m + s.tokens.cacheWrite1h)} · okuma ${fmtTok(s.tokens.cacheRead)}</div>
      <div class="sub">PID ${s.pid} · ${esc(s.entrypoint)} · v${esc(s.version)} · ${s.fileCount} dosya</div>
      <div class="actions" style="margin-top:8px">
        <button data-act="open">Klasörü aç</button>
        <button data-act="resume">Devam komutunu kopyala</button>
      </div>
    </div>
  </div>`;
}

function renderList() {
  if (!snap.sessions.length) {
    list.innerHTML = `<div class="empty">Şu an çalışan Claude Code oturumu yok.<br>Bir terminalde <code>claude</code> başlattığında burada belirir.<br><span style="font-size:11px">${esc(snap.claudeDir || '')} izleniyor</span></div>`;
    return;
  }
  const scroll = list.scrollTop;
  list.innerHTML = snap.sessions.map(card).join('') + `<div class="sub" style="text-align:center">* API liste fiyatıyla tahmini</div>`;
  list.scrollTop = scroll;
}

list.addEventListener('click', (e) => {
  const el = e.target.closest('.card');
  if (!el) return;
  const s = snap.sessions.find((x) => x.id === el.dataset.id);
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'open' && s) return void api.openFolder(s.cwd);
  if (act === 'resume' && s) {
    api.copy(`cd ${JSON.stringify(s.cwd)} && claude --resume ${s.id}`);
    return toast('Komut kopyalandı');
  }
  select(selected === el.dataset.id ? null : el.dataset.id);
});

function select(id, scroll) {
  selected = id;
  renderList();
  window.dispatchEvent(new CustomEvent('dash:select', { detail: id }));
  if (id && scroll) list.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- shared with orbit3d.js ----------
window.dash = {
  COLORS,
  LABELS,
  esc,
  fmtTok,
  fmtCost,
  ago,
  snap: () => snap,
  selected: () => selected,
  select,
};

// ---------- wiring ----------
api.onSnapshot((s) => {
  snap = s;
  if (selected && !s.sessions.some((x) => x.id === selected)) selected = null;
  renderToday();
  renderList();
  window.dispatchEvent(new CustomEvent('dash:snapshot', { detail: s }));
});
api.onSelect((id) => select(id, true));

(async () => {
  const st = await api.getSettings();
  const w = document.getElementById('nWaiting');
  const d = document.getElementById('nDone');
  w.checked = st.notifyWaiting;
  d.checked = st.notifyDone;
  w.onchange = () => api.setSettings({ notifyWaiting: w.checked });
  d.onchange = () => api.setSettings({ notifyDone: d.checked });
})();
