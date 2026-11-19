'use strict';
// The warning when a process a Claude Code session started strains the computer: red light pulsing around the
// whole window, and a small card in the corner with the process and buttons to stop or ignore it. The map's planet for that
// session overheats (orbit3d.js reads D.hogs()).
(() => {
  const api = window.agentinan;
  const D = window.dash;
  const $ = (id) => document.getElementById(id);
  const esc = D.esc;

  let hogs = [];
  const hidden = new Set(); // hog keys the user closed for now
  const termSent = new Map(); // hog key → time SIGTERM was sent
  let armed = null; // key of the hog whose stop button waits for a second press
  let shownKey = null;

  const fmtMem = (b) => (b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + ' GB' : Math.round(b / (1 << 20)) + ' MB');

  function render() {
    const visible = hogs.filter((h) => !hidden.has(h.key));
    document.body.classList.toggle('overheat', visible.length > 0);
    $('heat').hidden = !visible.length;
    const box = $('hogAlert');
    if (!visible.length) {
      box.hidden = true;
      shownKey = null;
      return;
    }
    const h = visible[0];
    const secs = Math.round((Date.now() - h.since) / 1000);
    const forced = termSent.has(h.key) && Date.now() - termSent.get(h.key) > 4000;
    const stopLabel = forced ? 'zorla kapat' : armed === h.key ? 'emin misin?' : 'durdur';
    const what = h.reason === 'mem' ? `RAM %${h.memPct} · ${fmtMem(h.mem)}` : `işlemci %${h.cpu}${h.reason === 'both' ? ` · RAM ${fmtMem(h.mem)}` : ''}`;
    const more = visible.length > 1 ? `<div class="hm-more">+${visible.length - 1} işlem daha: ${visible.slice(1).map((o) => esc(o.name)).join(', ')}</div>` : '';
    box.hidden = false;
    box.innerHTML = `
      <div class="hm-top">${icon('flame')}<b>${esc(h.sessionName || 'oturum')}</b><span>bilgisayarı yoruyor</span><button class="hm-x" data-act="hide" title="Şimdilik gizle">${icon('x')}</button></div>
      <div class="hm-line"><code>${esc(h.name)}</code> ${what} · ${secs} sn</div>
      ${h.cmd ? `<div class="hm-cmd" title="${esc(h.cmd)}">${esc(h.cmd)}</div>` : ''}
      <div class="hm-actions">
        <button class="btn sm danger" data-act="stop">${icon('power')}<span>${stopLabel}</span></button>
        <button class="btn sm" data-act="ignore" title="${esc(h.name)} adlı programlar için bir daha uyarma">yok say</button>
      </div>
      ${more}`;
    box.dataset.key = h.key;
    box.dataset.pid = h.pid;
    box.dataset.name = h.name;
  }

  $('hogAlert').addEventListener('click', async (e) => {
    const act = e.target.closest('button')?.dataset.act;
    const box = $('hogAlert');
    const key = box.dataset.key;
    const pid = Number(box.dataset.pid);
    if (act === 'hide') hidden.add(key);
    if (act === 'ignore') {
      await api.ignoreProc(box.dataset.name);
      hidden.add(key);
      D.toast(`${box.dataset.name} artık uyarı vermeyecek (Ayarlar'dan geri alabilirsin)`);
      window.dispatchEvent(new CustomEvent('dash:settings-reload'));
    }
    if (act === 'stop') {
      const forced = termSent.has(key) && Date.now() - termSent.get(key) > 4000;
      if (!forced && armed !== key) {
        armed = key;
        setTimeout(() => {
          if (armed === key) {
            armed = null;
            render();
          }
        }, 3000);
        return render();
      }
      armed = null;
      const r = await api.killProc(pid, key, forced);
      if (r && r.error) D.toast(r.error);
      else {
        termSent.set(key, Date.now());
        D.toast(forced ? 'İşlem zorla kapatıldı' : 'İşleme durma sinyali gönderildi');
      }
    }
    render();
  });

  window.addEventListener('dash:snapshot', (e) => {
    hogs = e.detail.hogs || [];
    const live = new Set(hogs.map((h) => h.key));
    for (const k of hidden) if (!live.has(k)) hidden.delete(k);
    for (const k of termSent.keys()) if (!live.has(k)) termSent.delete(k);
    render();
  });
})();
