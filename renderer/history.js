'use strict';
// Spending history: opened from the "bugün" chip in the top bar. The last 30 days as stacked bars (one colour per
// model, fixed order), the projects ranked by cost, and a table view of the same numbers.
(() => {
  const api = window.agentinan;
  const D = window.dash;
  const $ = (id) => document.getElementById(id);
  const esc = D.esc;
  const money = (v) => (v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);

  // categorical slots 1–4 of the reference palette, dark steps (validated against the panel surface);
  // a fifth model and beyond fold into "Diğer", drawn neutral
  const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500'];
  const OTHER = '#6b7287';
  const BAR = '#3987e5';

  let data = null;
  let asTable = false;

  const dayLabel = (ms, long) => new Date(ms).toLocaleDateString('tr-TR', long ? { day: 'numeric', month: 'long', weekday: 'long' } : { day: 'numeric', month: 'short' });

  async function open() {
    $('histModal').hidden = false;
    $('histBody').innerHTML = `<div class="hist-wait">Hesaplanıyor…</div>`;
    try {
      data = await api.history(30);
    } catch {
      data = null;
    }
    render();
  }
  const close = () => {
    $('histModal').hidden = true;
    $('histTip').hidden = true;
  };

  // models ranked by their 30-day cost keep their colour slot; the rest become "Diğer"
  function seriesOf(days) {
    const tot = {};
    for (const d of days) for (const [m, c] of Object.entries(d.byModel)) tot[m] = (tot[m] || 0) + c;
    const ranked = Object.entries(tot)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
    const named = ranked.length > SERIES.length ? ranked.slice(0, SERIES.length - 1) : ranked;
    const list = named.map((m, i) => ({ key: m, name: m, color: SERIES[i] }));
    if (ranked.length > named.length) list.push({ key: '*', name: 'Diğer', color: OTHER, members: new Set(ranked.slice(named.length)) });
    return list;
  }
  const valueOf = (d, s) => (s.members ? [...s.members].reduce((v, m) => v + (d.byModel[m] || 0), 0) : d.byModel[s.key] || 0);

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function chart(days, series) {
    const W = 760;
    const H = 230;
    const L = 46;
    const B = 24;
    const T = 8;
    const max = niceMax(Math.max(...days.map((d) => d.cost)));
    const step = (W - L) / days.length;
    const bw = Math.max(4, step * 0.62);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    let svg = '';
    // recessive grid: 4 lines with dollar labels
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      svg += `<line class="hg" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="hax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${money(v)}</text>`;
    }
    days.forEach((d, i) => {
      const x = L + i * step + (step - bw) / 2;
      // stack from the baseline; 2px surface gap between segments, 4px rounding only on the top end
      let base = 0;
      const segs = series.map((s) => ({ s, v: valueOf(d, s) })).filter((g) => g.v > 0);
      segs.forEach((g, k) => {
        const y0 = y(base);
        const y1 = y(base + g.v);
        base += g.v;
        const h = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0));
        if (h < 0.5) return;
        const top = k === segs.length - 1;
        const r = top ? Math.min(4, h, bw / 2) : 0;
        const yy = y0 - (k > 0 ? 2 : 0) - h;
        svg += top
          ? `<path fill="${g.s.color}" d="M${x},${yy + h}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${yy + h}Z"/>`
          : `<rect fill="${g.s.color}" x="${x}" y="${yy}" width="${bw}" height="${h}"/>`;
      });
      // x labels: every 5th day and the last one (today)
      const last = i === days.length - 1;
      if ((i % 5 === 0 && i < days.length - 3) || last) svg += `<text class="hax" x="${last ? x + bw : x + bw / 2}" y="${H - 6}" text-anchor="${last ? 'end' : 'middle'}">${last ? 'bugün' : dayLabel(d.date)}</text>`;
      // the hit target is the whole column, taller and wider than the bar
      svg += `<rect class="hhit" data-i="${i}" x="${L + i * step}" y="${T}" width="${step}" height="${H - T - B}"/>`;
    });
    svg += `<line class="hbase" x1="${L}" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>`;
    return `<svg class="hchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Son 30 günün günlük tahmini maliyeti, modele göre">${svg}</svg>`;
  }

  function render() {
    const body = $('histBody');
    if (!data) {
      body.innerHTML = `<div class="hist-wait">Geçmiş okunamadı.</div>`;
      return;
    }
    const days = data.days;
    const series = seriesOf(days);
    const active = days.filter((d) => d.cost > 0);
    const peak = days.reduce((a, d) => (d.cost > a.cost ? d : a), days[0]);
    const tiles = `<div class="hist-tiles">
      <div class="htile"><span>Son 30 gün</span><b>${money(data.total)}</b></div>
      <div class="htile"><span>Çalışılan günlerde ortalama</span><b>${money(active.length ? data.total / active.length : 0)}</b><em>${active.length} gün</em></div>
      <div class="htile"><span>En yoğun gün</span><b>${peak.cost > 0 ? money(peak.cost) : '—'}</b><em>${peak.cost > 0 ? dayLabel(peak.date, true) : ''}</em></div>
    </div>`;
    const legend = series.length > 1 ? `<div class="hist-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    const daily = asTable
      ? `<div class="hist-table-wrap"><table class="hist-table"><thead><tr><th>Gün</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}<th>Toplam</th></tr></thead><tbody>${[...days]
          .reverse()
          .filter((d) => d.cost > 0)
          .map((d) => `<tr><td>${dayLabel(d.date, true)}</td>${series.map((s) => `<td>${money(valueOf(d, s))}</td>`).join('')}<td><b>${money(d.cost)}</b></td></tr>`)
          .join('')}</tbody></table></div>`
      : chart(days, series);
    const maxP = data.projects[0]?.cost || 1;
    const projects = data.projects.length
      ? `<div class="hist-projects">${data.projects
          .slice(0, 8)
          .map(
            (p) => `<div class="hp-row"><span class="hp-name" title="${esc(p.name)}">${esc(p.name)}</span>
            <span class="hp-bar"><i style="width:${((p.cost / maxP) * 100).toFixed(1)}%;background:${BAR}"></i></span>
            <b>${money(p.cost)}</b><em>%${Math.round((p.cost / (data.total || 1)) * 100)}</em></div>`,
          )
          .join('')}</div>`
      : '';
    body.innerHTML =
      tiles +
      `<div class="hist-sec-head"><h3>Günlük</h3><span class="spacer"></span>${legend}<button class="btn sm ghost" id="histToggle">${asTable ? 'Grafik' : 'Tablo'}</button></div>` +
      daily +
      (projects ? `<div class="hist-sec-head"><h3>Projeler</h3></div>${projects}` : '') +
      `<p class="modal-sub">Maliyet API liste fiyatıyla tahmindir; Pro/Max aboneliğinde bu tutarı ödemezsin. Kapanmış oturumlar da dahil.</p>`;
    $('histToggle').onclick = () => {
      asTable = !asTable;
      render();
    };
  }

  // hover: one tooltip per day column
  $('histBody').addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.hhit');
    const tip = $('histTip');
    if (!hit || !data) {
      tip.hidden = true;
      return;
    }
    const d = data.days[Number(hit.dataset.i)];
    const series = seriesOf(data.days);
    const rows = series
      .map((s) => ({ s, v: valueOf(d, s) }))
      .filter((g) => g.v > 0)
      .map((g) => `<div class="tt-row"><i style="background:${g.s.color}"></i><span>${esc(g.s.name)}</span><b>${money(g.v)}</b></div>`)
      .join('');
    tip.innerHTML = `<div class="tt-head">${dayLabel(d.date, true)}</div>${rows || '<div class="tt-row"><span>Harcama yok</span></div>'}${rows ? `<div class="tt-row tt-total"><span>Toplam</span><b>${money(d.cost)}</b></div>` : ''}`;
    tip.hidden = false;
    const box = $('histModal').querySelector('.modal-box').getBoundingClientRect();
    const x = Math.min(e.clientX - box.left + 14, box.width - 200);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY - box.top + 14}px`;
  });
  $('histBody').addEventListener('mouseleave', () => ($('histTip').hidden = true));

  $('today').addEventListener('click', open);
  $('histClose').onclick = close;
  $('histModal').addEventListener('click', (e) => e.target === $('histModal') && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('histModal').hidden && close());
})();
