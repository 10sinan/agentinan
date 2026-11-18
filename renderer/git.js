'use strict';
// The Git tab (Source Control): the repositories sessions work in, their changes with stage / unstage and commit,
// a diff viewer and the history graph. Talks to src/git.js through window.agentinan.git.
(() => {
  const G = window.agentinan.git;
  const D = window.dash;
  const $ = (id) => document.getElementById(id);
  const esc = D.esc;

  let repos = [];
  let repo = null; // root path of the chosen repository
  let status = null;
  let mode = 'diff'; // 'diff' | 'history'
  let sel = null; // { path, kind } of the file shown in the diff view
  let commit = null; // hash shown from the history
  let lastBody = '';
  let busy = false;

  const CODE = { M: 'Değişti', A: 'Eklendi', D: 'Silindi', R: 'Taşındı', C: 'Kopyalandı', U: 'Yeni', T: 'Tür değişti' };

  async function call(p, quiet) {
    const r = await p;
    if (r && r.error) {
      if (!quiet) D.toast(r.error.split('\n').pop());
      return null;
    }
    return r ? r.data : null;
  }

  // ---------- repositories ----------
  async function loadRepos() {
    const list = await call(G.repos(), true);
    if (!list) return;
    repos = list;
    if (!repo || !repos.some((r) => r.root === repo)) {
      const s = D.snap().sessions.find((x) => x.id === D.selected());
      const fromSel = s && repos.find((r) => s.cwd === r.root || s.cwd.startsWith(r.root + '/'));
      repo = (fromSel || repos[0] || {}).root || null;
    }
    renderRepos();
  }

  function renderRepos() {
    $('gEmpty').hidden = repos.length > 0;
    for (const el of document.querySelectorAll('.git-panel > .glist, .git-panel > .gchanges, .git-panel > .gview')) el.hidden = !repos.length;
    $('gRepos').innerHTML = repos
      .map(
        (r) => `<div class="titem${r.root === repo ? ' active' : ''}" data-root="${esc(r.root)}" title="${esc(r.root)}">
          ${icon('branch')}
          <div class="tn"><b>${esc(r.name)}</b><span title="${esc(r.branch || '')}">${esc(r.branch || '—')}</span></div>
          ${r.changes ? `<em class="gcount">${r.changes}</em>` : ''}
        </div>`,
      )
      .join('');
  }

  $('gRepos').addEventListener('click', (e) => {
    const it = e.target.closest('.titem');
    if (!it || it.dataset.root === repo) return;
    repo = it.dataset.root;
    sel = null;
    commit = null;
    lastBody = '';
    renderRepos();
    refresh(true);
  });

  const addRepo = async () => {
    const root = await call(G.addRepo());
    if (!root) return;
    await loadRepos();
    repo = root;
    renderRepos();
    refresh(true);
  };
  $('gAddRepo').onclick = addRepo;
  $('gEmptyAdd').onclick = addRepo;

  // ---------- status and file lists ----------
  async function refresh(full) {
    if (!repo) return;
    const st = await call(G.status(repo), true);
    if (!st) return;
    status = st;
    renderHead();
    renderFiles();
    if (mode === 'history' && full) loadHistory();
    else if (mode === 'diff') loadDiff();
  }

  function renderHead() {
    const s = status;
    const sync = s.upstream
      ? `<span class="pill" title="${esc(s.upstream)}">${icon('up')}${s.ahead} ${icon('down')}${s.behind}</span>`
      : `<span class="pill" title="Bu dalın uzak karşılığı yok">uzak dal yok</span>`;
    $('gHead').innerHTML = `
      <span class="pill ctl" title="${esc(s.branch || '(ayrık HEAD)')}">${icon('branch')}${esc(s.branch || '(ayrık HEAD)')}</span>${sync}
      <span class="spacer"></span>
      <button class="btn sm ghost" data-g="fetch" title="Uzak depodaki yenilikleri al (fetch)">${icon('refresh')}</button>
      <button class="btn sm" data-g="pull" title="Uzak değişiklikleri çek (pull, sadece ileri sarma)">${icon('down')}Pull</button>
      <button class="btn sm" data-g="push" title="Commit'leri uzak depoya gönder (push)">${icon('up')}Push${s.ahead ? ` <b>${s.ahead}</b>` : ''}</button>`;
    const staged = s.staged.length;
    const all = staged + s.unstaged.length + s.untracked.length;
    const btn = $('gCommit');
    btn.disabled = busy || !all;
    btn.querySelector('span').textContent = staged ? `Commit (${staged})` : all ? 'Tümünü ekle ve commit' : 'Commit';
  }

  function fileRow(f, kind) {
    const slash = f.path.lastIndexOf('/');
    const name = f.path.slice(slash + 1);
    const dir = slash >= 0 ? f.path.slice(0, slash) : '';
    const active = sel && sel.path === f.path && sel.kind === kind && mode === 'diff' ? ' active' : '';
    const action =
      kind === 'staged'
        ? `<button class="fa" data-a="unstage" title="Hazırlıktan çıkar">${icon('minus')}</button>`
        : kind === 'conflict'
          ? ''
          : `<button class="fa" data-a="stage" title="Commit'e hazırla">${icon('plus')}</button>`;
    return `<div class="frow${active}" data-path="${esc(f.path)}" data-kind="${kind}" title="${esc((f.from ? f.from + ' → ' : '') + f.path)}">
      <span class="fname">${esc(name)}</span><span class="fdir">${esc(dir)}</span>${action}
      <span class="fcode c-${f.code}" title="${CODE[f.code] || f.code}">${kind === 'untracked' ? 'U' : esc(f.code)}</span>
    </div>`;
  }

  function section(title, list, kind, bulk) {
    if (!list.length) return '';
    return `<div class="fsec"><div class="fsec-head"><span>${title}</span><em>${list.length}</em><span class="spacer"></span>${bulk || ''}</div>${list.map((f) => fileRow(f, kind)).join('')}</div>`;
  }

  function renderFiles() {
    const s = status;
    const html =
      section('Çakışmalar', s.conflicts, 'conflict') +
      section('Commit\'e hazır', s.staged, 'staged', `<button class="fa" data-a="unstage-all" title="Hepsini çıkar">${icon('minus')}</button>`) +
      section('Değişiklikler', s.unstaged, 'unstaged', `<button class="fa" data-a="stage-unstaged" title="Bu bölümün hepsini hazırla">${icon('plus')}</button>`) +
      section('Yeni dosyalar', s.untracked, 'untracked', `<button class="fa" data-a="stage-untracked" title="Bu bölümün hepsini hazırla">${icon('plus')}</button>`);
    $('gFiles').innerHTML = html || `<div class="gclean">${icon('check')}<span>Çalışma alanı temiz</span></div>`;
  }

  $('gFiles').addEventListener('click', async (e) => {
    const a = e.target.closest('.fa')?.dataset.a;
    const row = e.target.closest('.frow');
    if (a === 'stage-unstaged') await call(G.stage(repo, status.unstaged.map((f) => f.path)));
    else if (a === 'stage-untracked') await call(G.stage(repo, status.untracked.map((f) => f.path)));
    else if (a === 'unstage-all') await call(G.unstage(repo, 'all'));
    else if (a && row) await call(a === 'stage' ? G.stage(repo, [row.dataset.path]) : G.unstage(repo, [row.dataset.path]));
    else if (row) {
      sel = { path: row.dataset.path, kind: row.dataset.kind };
      setMode('diff');
      return;
    }
    if (a) {
      // a staged file moves lists: keep showing it from its new side
      if (sel && row && sel.path === row.dataset.path) sel.kind = a === 'stage' ? 'staged' : 'unstaged';
      refresh();
      loadRepos();
    }
  });

  $('gHead').addEventListener('click', async (e) => {
    const g = e.target.closest('button')?.dataset.g;
    if (!g || busy) return;
    busy = true;
    const btn = e.target.closest('button');
    btn.disabled = true;
    D.toast(g === 'push' ? 'Gönderiliyor…' : g === 'pull' ? 'Çekiliyor…' : 'Güncelleniyor…');
    const ok = await call(G[g](repo));
    busy = false;
    if (ok !== null) D.toast(g === 'push' ? 'Push tamamlandı' : g === 'pull' ? 'Pull tamamlandı' : 'Güncellendi');
    refresh(true);
  });

  // ---------- commit ----------
  async function doCommit() {
    if (busy) return;
    const msg = $('gMsg').value.trim();
    if (!repo || !status) return;
    if (!msg) {
      $('gMsg').focus();
      return D.toast('Önce bir commit mesajı yaz');
    }
    busy = true;
    $('gCommit').disabled = true;
    if (!status.staged.length) await call(G.stage(repo, 'all'));
    const ok = await call(G.commit(repo, msg));
    busy = false;
    if (ok !== null) {
      $('gMsg').value = '';
      sel = null;
      D.toast('Commit atıldı');
    }
    await refresh(true);
    loadRepos();
    if (mode === 'history') loadHistory();
  }
  $('gCommit').onclick = doCommit;
  $('gMsg').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doCommit();
  });

  // ---------- diff / history viewer ----------
  function setMode(m) {
    mode = m;
    for (const b of document.querySelectorAll('#gMode button')) b.classList.toggle('active', b.dataset.m === m);
    lastBody = '';
    if (status) renderFiles();
    if (m === 'diff') loadDiff();
    else loadHistory();
  }
  $('gMode').addEventListener('click', (e) => {
    const m = e.target.closest('button')?.dataset.m;
    if (m) {
      commit = null;
      setMode(m);
    }
  });

  function setBody(html, title) {
    $('gTitle').innerHTML = title || '';
    if (html === lastBody) return;
    lastBody = html;
    const body = $('gBody');
    const keep = body.scrollTop;
    body.innerHTML = html;
    body.scrollTop = keep;
  }

  async function loadDiff() {
    if (!status) return;
    // nothing chosen: show the first changed file
    const all = [
      ...status.conflicts.map((f) => ({ path: f.path, kind: 'conflict' })),
      ...status.staged.map((f) => ({ path: f.path, kind: 'staged' })),
      ...status.unstaged.map((f) => ({ path: f.path, kind: 'unstaged' })),
      ...status.untracked.map((f) => ({ path: f.path, kind: 'untracked' })),
    ];
    if (sel && !all.some((f) => f.path === sel.path && f.kind === sel.kind)) sel = all.find((f) => f.path === sel.path) || null;
    if (!sel) sel = all[0] || null;
    if (!sel) return setBody(`<div class="gnote">Gösterilecek değişiklik yok.</div>`, '');
    renderFiles();
    const text = await call(G.diff(repo, sel.path, sel.kind), true);
    if (mode !== 'diff') return;
    const label = { staged: 'commit\'e hazır', unstaged: 'değişiklik', untracked: 'yeni dosya', conflict: 'çakışma' }[sel.kind] || '';
    if (sel.kind === 'conflict')
      return setBody(`<pre class="chead">${esc(text || 'Çakışma işaretleri dosyanın içinde (<<<<<<< / >>>>>>>).')}</pre>`, `${icon('file')}<b>${esc(sel.path)}</b><span>${label}</span>`);
    setBody(text ? renderDiff(text) : `<div class="gnote">Bu dosyada gösterilecek metin farkı yok (ikili dosya ya da sadece izin değişikliği olabilir).</div>`, `${icon('file')}<b>${esc(sel.path)}</b><span>${label}</span>`);
  }

  // Unified diff → rows with old/new line numbers.
  function renderDiff(text, head) {
    const out = [];
    let o = 0;
    let n = 0;
    let inHunk = false;
    for (const line of text.split('\n')) {
      if (line.startsWith('diff --git')) {
        inHunk = false;
        const m = line.match(/ b\/(.*)$/);
        out.push(`<div class="dfile">${icon('file')}${esc(m ? m[1] : line)}</div>`);
        continue;
      }
      const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (h) {
        inHunk = true;
        o = Number(h[1]);
        n = Number(h[2]);
        out.push(`<div class="dl hunk"><span class="ln"></span><span class="ln"></span><span class="code">${esc(line)}</span></div>`);
        continue;
      }
      if (!inHunk) continue; // index / --- / +++ / mode lines
      if (line.startsWith('+')) out.push(`<div class="dl add"><span class="ln"></span><span class="ln">${n++}</span><span class="code">${esc(line.slice(1)) || ' '}</span></div>`);
      else if (line.startsWith('-')) out.push(`<div class="dl del"><span class="ln">${o++}</span><span class="ln"></span><span class="code">${esc(line.slice(1)) || ' '}</span></div>`);
      else if (line.startsWith('\\')) out.push(`<div class="dl meta"><span class="ln"></span><span class="ln"></span><span class="code">${esc(line)}</span></div>`);
      else if (line.startsWith(' ')) out.push(`<div class="dl"><span class="ln">${o++}</span><span class="ln">${n++}</span><span class="code">${esc(line.slice(1)) || ' '}</span></div>`);
    }
    return `${head || ''}<div class="diff">${out.join('')}</div>`;
  }

  // lane colours of the history graph come from the theme's terminal palette
  const lanes = () => {
    const t = window.themes.current();
    return [t.accent, t.term.cyan, t.term.yellow, t.term.green, t.term.red, t.term.magenta, t.term.brightYellow];
  };
  window.addEventListener('dash:theme', () => {
    if (mode === 'history' && !commit && D.tab() === 'git') {
      lastBody = '';
      loadHistory();
    }
  });

  function graphHtml(g) {
    let s = '';
    const LANE = lanes();
    for (let i = 0; i < g.length; i++) {
      const ch = g[i];
      const c = LANE[Math.floor(i / 2) % LANE.length];
      if (ch === '*') s += `<i class="gnode" style="--c:${c}"></i>`;
      else if (ch === ' ') s += '<span class="gsp"> </span>';
      else s += `<span class="gln" style="color:${c}">${esc(ch)}</span>`;
    }
    return s;
  }

  function refsHtml(refs) {
    if (!refs) return '';
    return refs
      .split(', ')
      .map((r) => {
        const head = r.startsWith('HEAD -> ');
        const name = head ? r.slice(8) : r;
        const cls = head ? 'head' : name.startsWith('tag: ') ? 'tag' : name.includes('/') ? 'remote' : 'local';
        return `<span class="gref ${cls}">${esc(name.replace(/^tag: /, ''))}</span>`;
      })
      .join('');
  }

  async function loadHistory() {
    if (!repo) return;
    if (commit) return showCommit(commit);
    const rows = await call(G.log(repo), true);
    if (mode !== 'history' || commit) return;
    if (!rows || !rows.length) return setBody(`<div class="gnote">Bu depoda henüz commit yok.</div>`, '');
    // every row's graph gets the same width so the commit subjects line up
    const gw = `style="width:${Math.max(...rows.map((r) => r.graph.trimEnd().length)) * 9 + 6}px"`;
    const html = rows
      .map((r) =>
        r.hash
          ? `<div class="hrow" data-h="${esc(r.hash)}"><span class="hgraph" ${gw}>${graphHtml(r.graph.trimEnd())}</span><span class="hsub">${refsHtml(r.refs)}${esc(r.subject)}</span><span class="hmeta">${esc(r.author)} · ${D.ago(r.time)} önce</span><code>${esc(r.short)}</code></div>`
          : `<div class="hrow gonly"><span class="hgraph" ${gw}>${graphHtml(r.graph.trimEnd())}</span></div>`,
      )
      .join('');
    setBody(`<div class="hist">${html}</div>`, `${icon('history')}<b class="plain">Geçmiş</b><span>${repos.find((r) => r.root === repo)?.name || ''} · tüm dallar</span>`);
  }

  async function showCommit(hash) {
    const text = await call(G.show(repo, hash));
    if (!text || mode !== 'history') return;
    const cut = text.indexOf('\ndiff --git');
    const header = cut >= 0 ? text.slice(0, cut) : text;
    const back = `<button class="btn sm" id="gBack">← Geçmişe dön</button>`;
    setBody(renderDiff(cut >= 0 ? text.slice(cut + 1) : '', `<pre class="chead">${esc(header.trim())}</pre>`), `${back}<b>${esc(hash.slice(0, 7))}</b>`);
  }

  $('gBody').addEventListener('click', (e) => {
    const row = e.target.closest('.hrow[data-h]');
    if (!row) return;
    commit = row.dataset.h;
    lastBody = '';
    showCommit(commit);
  });
  $('gTitle').addEventListener('click', (e) => {
    if (!e.target.closest('#gBack')) return;
    commit = null;
    lastBody = '';
    loadHistory();
  });

  // ---------- polling while the tab is open ----------
  let timer = null;
  let tick = 0;
  async function poll() {
    if (D.tab() !== 'git') return;
    tick++;
    if (tick % 3 === 0) await loadRepos();
    await refresh(false);
  }
  window.addEventListener('dash:tab', async (e) => {
    clearInterval(timer);
    if (e.detail !== 'git') return;
    await loadRepos();
    setMode(mode);
    await refresh(true);
    timer = setInterval(poll, 3000);
  });
  setMode('diff');
  if (D.tab() === 'git') window.dispatchEvent(new CustomEvent('dash:tab', { detail: 'git' }));
})();
