'use strict';
// The loud warning when a process strains the computer: a pulsing red frame around the window, a big alarm card
// with the process and the session that started it, and buttons to stop or ignore it. The map's planet for that
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
    if (h.key !== shownKey) {
      // a new culprit: shake the whole window once
      shownKey = h.key;
      document.body.classList.remove('quake');
      void document.body.offsetWidth;
      document.body.classList.add('quake');
    }
    const secs = Math.round((Date.now() - h.since) / 1000);
    const cpuBar = Math.min(100, h.cpu); // one full core = full bar
    const cores = (h.cpu / 100).toFixed(1);
    const forced = termSent.has(h.key) && Date.now() - termSent.get(h.key) > 4000;
    const stopLabel = forced ? 'Zorla kapat' : armed === h.key ? 'Emin misin? Tekrar bas' : 'İşlemi durdur';
    const others = visible.slice(1);
    box.hidden = false;
    box.innerHTML = `
      <div class="hog-glow"></div>
      <div class="hog-top">
        <div class="hog-flame">${icon('flame')}</div>
        <div>
          <div class="hog-kicker">UYARI · BİLGİSAYARIN ZORLANIYOR</div>
          <div class="hog-name">${esc(h.name)}</div>
          <div class="hog-sub">${h.sessionName ? `<b>${esc(h.sessionName)}</b> oturumundan · ` : ''}${secs} sn'dir · PID ${h.pid}</div>
        </div>
      </div>
      <div class="hog-meters">
        <div class="hog-meter ${h.reason !== 'mem' ? 'hot' : ''}">
          <div class="hm-head"><span>İşlemci</span><b>%${h.cpu}</b></div>
          <div class="hm-bar"><i style="width:${cpuBar}%"></i></div>
          <div class="hm-foot">${cores} çekirdek dolu · makinenin %${h.cpuOfMachine}'i</div>
        </div>
        <div class="hog-meter ${h.reason !== 'cpu' ? 'hot' : ''}">
          <div class="hm-head"><span>Bellek</span><b>${fmtMem(h.mem)}</b></div>
          <div class="hm-bar"><i style="width:${Math.min(100, h.memPct)}%"></i></div>
          <div class="hm-foot">RAM'in %${h.memPct}'i</div>
        </div>
      </div>
      ${h.cmd ? `<div class="hog-cmd" title="${esc(h.cmd)}">${esc(h.cmd)}</div>` : ''}
      <div class="hog-actions">
        <button class="btn danger big" data-act="stop">${icon('power')}<span>${stopLabel}</span></button>
        <button class="btn" data-act="ignore" title="${esc(h.name)} adlı programlar için bir daha uyarma">Bu programı yok say</button>
        <button class="btn ghost" data-act="hide">Şimdilik gizle</button>
      </div>
      ${
        others.length
          ? `<div class="hog-more">${others
              .map((o) => `<span><b>${esc(o.name)}</b> %${o.cpu} · ${fmtMem(o.mem)}</span>`)
              .join('')}</div>`
          : ''
      }`;
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
