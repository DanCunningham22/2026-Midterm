(function () {
  'use strict';
  function startApp(D) {
  const M = new window.MidtermModel(D);
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- state
  let sc = M.clone(M.defaults);
  let R = null;              // last simulation
  const ui = { tab: 'house', cmode: 'chance', sel: null, dim: 'race', query: '', showAll: false, pattern: 'blend', side: 'D', screen: 'map' };
  const SCREENS = ['map', 'outlook', 'races', 'adjust', 'early'];
  try {
    const saved = JSON.parse(localStorage.getItem('msm-ui') || 'null');
    if (saved && saved.tab) { ui.tab = saved.tab; ui.cmode = saved.cmode || 'chance'; ui.dim = saved.dim || 'race'; ui.side = saved.side === 'R' ? 'R' : 'D'; if (SCREENS.indexOf(saved.screen) >= 0) ui.screen = saved.screen; }
  } catch (e) { /* storage unavailable */ }
  function saveUi() { try { localStorage.setItem('msm-ui', JSON.stringify({ tab: ui.tab, cmode: ui.cmode, dim: ui.dim, side: ui.side, screen: ui.screen })); } catch (e) { /* ignore */ } }
  // Seat counts can be read from either side: 'D' counts Democratic seats, 'R' Republican ones.
  // Independents (Osborn in Nebraska, Kiley in CA-06) count for neither.
  const rView = () => ui.side === 'R';

  // ---------------------------------------------------------------- labels
  const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  const GROUP_LABELS = {
    race: ['White, college degree', 'White, no degree', 'Black', 'Hispanic', 'Asian & other'],
    age: ['18–29', '30–44', '45–64', '65 and older'],
    gender: ['Men', 'Women'],
  };
  const GROUP_RANGE = {
    race: [[-25, 55], [-55, 20], [35, 100], [-25, 65], [-25, 70]],
    age: [[-5, 75], [-25, 55], [-40, 35], [-35, 45]],
    gender: [[-40, 35], [-15, 50]],
  };
  const PRESETS = [
    { k: 'polls', label: 'Polling avg ' + fm(D.G0), v: D.G0 },
    { k: 'd4', label: 'D+4', v: 4 },
    { k: 'd9', label: 'D+9', v: 9 },
    { k: 'specials', label: 'Specials pace D+11', v: 11 },
    { k: 'miss', label: '2024-size poll miss D+5.4', v: 5.4 },
    { k: 'even', label: 'Even', v: 0 },
    { k: 'r22', label: '2022 rerun R+2.8', v: -2.8 },
  ];
  const ORDINAL = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  // ---------------------------------------------------------------- formatting
  function fm(m, digits) {
    const d = digits == null ? 1 : digits;
    if (m > 90) return 'Uncontested D';
    if (m < -90) return 'Uncontested R';
    const a = Math.abs(m);
    if (a < 0.05) return 'Even';
    return (m > 0 ? 'D+' : 'R+') + a.toFixed(d);
  }
  function fp(p) {
    if (p >= 0.995) return '>99%';
    if (p <= 0.005) return '<1%';
    return Math.round(p * 100) + '%';
  }
  // chance of the leading side; independents running in the Democratic slot (Osborn, Hill) or the Republican slot (Kiley) show as I
  function chanceText(p, r) {
    if (p >= 0.5) return fp(p) + (r && r.dp === 'I' ? ' I' : ' D');
    return fp(1 - p) + (r && r.rp === 'I' ? ' I' : ' R');
  }
  function rating(p) {
    if (p >= 0.95) return { k: 'sd', t: 'Solid D' };
    if (p >= 0.80) return { k: 'ld', t: 'Likely D' };
    if (p >= 0.60) return { k: 'nd', t: 'Lean D' };
    if (p > 0.40) return { k: 'tu', t: 'Toss-up' };
    if (p > 0.20) return { k: 'nr', t: 'Lean R' };
    if (p > 0.05) return { k: 'lr', t: 'Likely R' };
    return { k: 'sr', t: 'Solid R' };
  }
  function marginBin(m) {
    if (m >= 15) return 'sd'; if (m >= 8) return 'ld'; if (m >= 3) return 'nd';
    if (m > -3) return 'tu'; if (m > -8) return 'nr'; if (m > -15) return 'lr'; return 'sr';
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
  const lastName = (n) => {
    const raw = String(n || '').replace(/\(.*?\)/g, '').replace(/"[^"]*"/g, '').replace(/\s+vs\..*$/, '').trim();
    const t = raw.split(/\s+/).filter((x) => x && !SUFFIX.test(x.replace(/,$/, '')));
    const rest = t.slice(1).filter((x) => !/^[A-Z]\.$/.test(x));
    return rest.length ? rest.join(' ') : (t[0] || '');
  };

  // ---------------------------------------------------------------- race accessors
  function races(tab) {
    if (tab === 'house') return D.districts;
    if (tab === 'senate') return D.senate;
    return D.gov;
  }
  function raceMargin(tab, i) { return R.m[tab][i]; }
  function raceP(tab, i) { return R[tab === 'gov' ? 'gov' : tab].p[i]; }
  function slope(tab) { return tab === 'gov' ? 0.8 : 1.0; }
  function flipPoint(tab, i) {
    const m = raceMargin(tab, i);
    if (Math.abs(m) > 90) return null;
    return R.m.national - m / slope(tab);
  }
  function raceName(tab, r) {
    if (tab === 'house') {
      const n = parseInt(r.id.slice(3), 10);
      const single = D.districts.filter((x) => x.st === r.st).length === 1;
      return single ? STATE_NAMES[r.st] + ' at-large' : STATE_NAMES[r.st] + ' ' + ORDINAL(n);
    }
    return STATE_NAMES[r.st] + (tab === 'senate' ? ' Senate' : ' governor') + (r.id === 'FL-SEN' || r.id === 'OH-SEN' ? ' (special)' : '');
  }
  function matchup(tab, r, html) {
    const incD = r.inc === 'D', incR = r.inc === 'R' || r.inc === 'I';
    const star = html ? ' <span class="inc-mark">INC</span>' : '*';
    if (tab === 'house' && r.unc) {
      if (r.unc === 'D') return (html ? esc(r.dn || 'Democrat') : r.dn) + (r.rn ? '' : (html ? ' <span class="muted">(no Republican)</span>' : ''));
      return html ? esc(r.rn) : r.rn;
    }
    const dlab = tab === 'house' ? (r.dn || 'Democrat') + (r.dn && r.dn.indexOf('(I)') < 0 ? ' (D)' : '') : r.dn + (r.dp === 'I' ? ' (I)' : ' (D)');
    const rlab = (r.rn || 'Republican') + (r.rp === 'I' ? ' (I)' : ' (R)');
    if (!html) return dlab + (incD ? '*' : '') + ' vs. ' + rlab + (incR ? '*' : '');
    return '<span class="d">' + esc(dlab) + '</span>' + (incD ? star : '') + ' vs. <span class="r">' + esc(rlab) + '</span>' + (incR ? star : '');
  }

  function shortMatchup(tab, r) {
    if (tab === 'house' && r.unc) return r.unc === 'D' ? '<span class="d">' + esc(lastName(r.dn) || 'D') + '</span> unopposed by R' : '<span class="r">' + esc(lastName(r.rn)) + '</span> (R vs. R)';
    const incD = r.inc === 'D', incR = r.inc === 'R' || r.inc === 'I';
    return '<span class="d">' + esc(lastName(r.dn) || 'D') + (incD ? '*' : '') + '</span> v. <span class="r">' + esc(lastName(r.rn) || 'R') + (incR ? '*' : '') + '</span>';
  }

  // ---------------------------------------------------------------- computation
  // While a slider moves, run a lighter simulation; settle on the full run once input pauses.
  let pending = false, fastNext = false, settleTimer = null;
  function update(fast) {
    fastNext = fastNext || !!fast;
    if (fast) { clearTimeout(settleTimer); settleTimer = setTimeout(() => update(false), 260); }
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      R = M.simulate(sc, fastNext ? 1500 : M.NSIM);
      fastNext = false;
      render();
    });
  }

  // ---------------------------------------------------------------- scenario bar
  function buildPresets() {
    const box = $('presets');
    box.innerHTML = PRESETS.map((p) => '<button class="oval" role="radio" aria-checked="false" data-k="' + p.k + '">' + esc(p.label) + '</button>').join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.oval'); if (!b) return;
      const p = PRESETS.find((x) => x.k === b.dataset.k);
      sc.C = M.solveC(sc, p.v);
      update();
    });
  }
  function renderBar() {
    const nat = M.national(sc);
    const eff = R.m.national;
    $('env').value = nat.toFixed(1);
    $('envOut').textContent = fm(eff);
    $('envOut').className = 'env-value num ' + (eff > 0.05 ? 'd' : eff < -0.05 ? 'r' : '');
    document.querySelectorAll('#presets .oval').forEach((b) => {
      const p = PRESETS.find((x) => x.k === b.dataset.k);
      b.setAttribute('aria-checked', Math.abs(nat - p.v) < 0.05 ? 'true' : 'false');
    });
    const h = R.house, s = R.senate, g = R.gov;
    const rv = rView(), P = rv ? 'R' : 'D', cls = rv ? 'r' : 'd';
    const tv = (v, of) => '<span class="' + cls + '">' + Math.round(v) + '</span><span class="muted" style="font-size:.6em"> /' + of + '</span>';
    $('tHouseV').innerHTML = tv(rv ? h.r.mean : h.mean, 435);
    $('tHouseS').textContent = P + ' majority ' + fp(rv ? h.r.control : h.control);
    $('tSenateV').innerHTML = tv(rv ? s.r.mean : s.mean, 100);
    $('tSenateS').textContent = P + ' control ' + fp(rv ? s.rcontrol : s.control);
    $('tGovV').innerHTML = tv(rv ? g.r.mean : g.mean, 50);
    $('tGovS').textContent = P + ' 26+ ' + fp(rv ? g.r.control : g.maj);
    $('sideD').setAttribute('aria-pressed', rv ? 'false' : 'true');
    $('sideR').setAttribute('aria-pressed', rv ? 'true' : 'false');
    ['house', 'senate', 'gov'].forEach((t) => {
      $('t' + (t === 'house' ? 'House' : t === 'senate' ? 'Senate' : 'Gov')).setAttribute('aria-pressed', ui.tab === t ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------- house hex map
  const HR = D.hexR;
  const SQ3 = Math.sqrt(3);
  let hexEls = [], houseGeom = null;
  function hexPath(x, y, r) {
    let p = '';
    for (let j = 0; j < 6; j++) {
      const a = Math.PI / 180 * (60 * j - 30);
      p += (j ? 'L' : 'M') + (x + r * Math.cos(a)).toFixed(1) + ' ' + (y + r * Math.sin(a)).toFixed(1);
    }
    return p + 'Z';
  }
  function buildHouseGeom() {
    const xs = D.districts.map((d) => d.x), ys = D.districts.map((d) => d.y);
    const pad = HR * 1.6;
    const minx = Math.min(...xs) - pad, maxx = Math.max(...xs) + pad, miny = Math.min(...ys) - pad, maxy = Math.max(...ys) + pad;
    const key = (x, y) => Math.round(x / 2) + ',' + Math.round(y / 2);
    const at = new Map();
    D.districts.forEach((d, i) => at.set(key(d.x, d.y), i));
    // state outlines: hex edges whose neighbour is another state or empty
    const lines = {};
    D.districts.forEach((d) => {
      for (let j = 0; j < 6; j++) {
        const a = Math.PI / 180 * (60 * j);
        const nx = d.x + SQ3 * HR * Math.cos(a), ny = d.y + SQ3 * HR * Math.sin(a);
        const ni = at.get(key(nx, ny));
        if (ni !== undefined && D.districts[ni].st === d.st) continue;
        const a1 = Math.PI / 180 * (60 * j - 30), a2 = Math.PI / 180 * (60 * j + 30);
        (lines[d.st] = lines[d.st] || []).push('M' + (d.x + HR * Math.cos(a1)).toFixed(1) + ' ' + (d.y + HR * Math.sin(a1)).toFixed(1) +
          'L' + (d.x + HR * Math.cos(a2)).toFixed(1) + ' ' + (d.y + HR * Math.sin(a2)).toFixed(1));
      }
    });
    const cent = {};
    D.districts.forEach((d) => { const c = cent[d.st] = cent[d.st] || [0, 0, 0]; c[0] += d.x; c[1] += d.y; c[2]++; });
    houseGeom = { minx, miny, w: maxx - minx, h: maxy - miny, lines, cent };
  }
  function drawHouse(svg) {
    if (!houseGeom) buildHouseGeom();
    const g = houseGeom;
    svg.setAttribute('viewBox', [g.minx, g.miny, g.w, g.h].map((v) => v.toFixed(1)).join(' '));
    svg.classList.add('house');
    let html = '<g id="hexes">';
    D.districts.forEach((d, i) => { html += '<path class="hex" data-i="' + i + '" d="' + hexPath(d.x, d.y, HR) + '"/>'; });
    html += '</g><g>';
    Object.keys(g.lines).forEach((s) => { html += '<path class="stline" d="' + g.lines[s].join('') + '"/>'; });
    html += '</g><g>';
    Object.keys(g.cent).forEach((s) => {
      const c = g.cent[s];
      html += '<text class="stlab' + (c[2] < 3 ? ' sm' : '') + '" x="' + (c[0] / c[2]).toFixed(1) + '" y="' + (c[1] / c[2]).toFixed(1) + '">' + s + '</text>';
    });
    html += '</g>';
    svg.innerHTML = html;
    hexEls = Array.from(svg.querySelectorAll('.hex'));
    resetZoom();
  }

  // ---------------------------------------------------------------- state tile map
  const TILE = {
    AK: [0, 0], ME: [0, 10], WI: [1, 5], VT: [1, 8], NH: [1, 9],
    WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], IL: [2, 5], MI: [2, 6], NY: [2, 8], MA: [2, 9], RI: [2, 10],
    OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IN: [3, 5], OH: [3, 6], PA: [3, 7], NJ: [3, 8], CT: [3, 9],
    CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5], WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
    AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6], SC: [5, 7],
    OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
    HI: [7, 0], TX: [7, 3], FL: [7, 7],
  };
  const TR = 30, TW = SQ3 * TR;
  let tileEls = {};
  function tileXY(s) { const [r, c] = TILE[s]; return [c * TW + (r % 2 ? TW / 2 : 0) + TW / 2 + 4, r * 1.5 * TR + TR + 4]; }
  function drawTiles(svg, tab) {
    const W = 11 * TW + TW / 2 + 8, H = 7 * 1.5 * TR + 2 * TR + 8;
    svg.setAttribute('viewBox', '0 0 ' + W.toFixed(1) + ' ' + H.toFixed(1));
    svg.classList.remove('house', 'zoomed-in');
    svg.style.removeProperty('--lz');
    const list = races(tab);
    const idx = {}; list.forEach((r, i) => { idx[r.st] = i; });
    let html = '';
    Object.keys(TILE).forEach((s) => {
      const [x, y] = tileXY(s);
      const on = idx[s] !== undefined;
      html += '<path class="tile' + (on ? '' : ' off') + '" data-st="' + s + '"' + (on ? ' data-i="' + idx[s] + '"' : '') + ' d="' + hexPath(x, y, TR - 1) + '"/>';
      html += '<text class="tilelab ' + (on ? 'on' : 'off') + '" x="' + x.toFixed(1) + '" y="' + (y - (on ? 6 : 0)).toFixed(1) + '">' + s + '</text>';
      if (on) html += '<text class="tilep" data-p="' + idx[s] + '" x="' + x.toFixed(1) + '" y="' + (y + 10).toFixed(1) + '"></text>';
    });
    svg.innerHTML = html;
    tileEls = {};
    svg.querySelectorAll('.tile[data-i]').forEach((el) => { tileEls[el.dataset.i] = el; });
  }

  let drawnTab = null;
  function renderMap() {
    const svg = $('map');
    if (drawnTab !== ui.tab) {
      if (ui.tab === 'house') drawHouse(svg); else drawTiles(svg, ui.tab);
      drawnTab = ui.tab;
      svg.setAttribute('aria-label', ui.tab === 'house' ? 'Hex map of all 435 House districts' : 'Tile map of ' + (ui.tab === 'senate' ? 'Senate' : 'governor') + ' races');
    }
    const q = ui.query.trim().toLowerCase();
    const match = (r) => !q || r.id.toLowerCase().indexOf(q) >= 0 || (STATE_NAMES[r.st] || '').toLowerCase().indexOf(q) >= 0 ||
      (r.dn || '').toLowerCase().indexOf(q) >= 0 || (r.rn || '').toLowerCase().indexOf(q) >= 0;
    const list = races(ui.tab);
    if (ui.tab === 'house') {
      hexEls.forEach((el, i) => {
        const k = ui.cmode === 'chance' ? rating(R.house.p[i]).k : marginBin(R.m.house[i]);
        el.setAttribute('class', 'hex f-' + k + (ui.sel === i ? ' sel' : '') + (q && !match(list[i]) ? ' dim' : ''));
      });
      if (ui.sel !== null && hexEls[ui.sel]) hexEls[ui.sel].parentNode.appendChild(hexEls[ui.sel]);
    } else {
      list.forEach((r, i) => {
        const el = tileEls[i]; if (!el) return;
        const p = raceP(ui.tab, i);
        const k = ui.cmode === 'chance' ? rating(p).k : marginBin(R.m[ui.tab][i]);
        el.setAttribute('class', 'tile f-' + k + (ui.sel === i ? ' sel' : '') + (q && !match(r) ? ' dim' : ''));
        const t = $('map').querySelector('.tilep[data-p="' + i + '"]');
        if (t) t.textContent = ui.cmode === 'chance' ? (p >= 0.5 ? (r.dp === 'I' ? 'I ' : 'D ') + fp(p) : 'R ' + fp(1 - p)) : fm(R.m[ui.tab][i], 0);
      });
    }
    renderLegend();
  }
  function renderLegend() {
    const keys = ['sd', 'ld', 'nd', 'tu', 'nr', 'lr', 'sr'];
    const labs = ui.cmode === 'chance'
      ? ['Solid D (95%+)', 'Likely D', 'Lean D', 'Toss-up (40–60%)', 'Lean R', 'Likely R', 'Solid R']
      : ['D+15 or more', 'D+8 to 15', 'D+3 to 8', 'Within 3', 'R+3 to 8', 'R+8 to 15', 'R+15 or more'];
    let h = keys.map((k, i) => '<span><i class="f-' + k + '"></i>' + labs[i] + '</span>').join('');
    if (ui.tab !== 'house') h += '<span><i class="f-none"></i>No race</span>';
    if (ui.tab === 'house') h += '<span class="muted">Hex positions are approximate; each hex is one district on its 2026 lines.</span>';
    $('legend').innerHTML = h;
  }

  // seat bar above the map
  function renderSeatbar() {
    const t = ui.tab;
    const list = races(t);
    const counts = { sd: 0, ld: 0, nd: 0, tu: 0, nr: 0, lr: 0, sr: 0 };
    list.forEach((r, i) => { counts[rating(raceP(t, i)).k]++; });
    const rv = rView();
    let fixedD = 0, fixedR = 0, total = 435, need = 218, needLab = '218 for a majority';
    if (t === 'senate') {
      fixedD = 34; fixedR = 31; total = 100;
      need = rv ? 50 : 51; needLab = rv ? '50 for control, with VP Vance' : '51 for control';
    }
    if (t === 'gov') { fixedD = 6; fixedR = 8; total = 50; need = 26; needLab = '26 for a majority'; }
    const W = 1000, H = 34;
    // in the Republican view the bar fills from the Republican end, so the line still marks what that side needs
    const segs = [['dfix', fixedD], ['sd', counts.sd], ['ld', counts.ld], ['nd', counts.nd], ['tu', counts.tu], ['nr', counts.nr], ['lr', counts.lr], ['sr', counts.sr], ['rfix', fixedR]];
    if (rv) segs.reverse();
    let x = 0, h = '';
    segs.forEach(([k, n]) => {
      if (!n) return;
      const w = n / total * W;
      const cls = k === 'dfix' ? 'f-sd' : k === 'rfix' ? 'f-sr' : 'f-' + k;
      const op = (k === 'dfix' || k === 'rfix') ? ' style="opacity:.55"' : '';
      h += '<rect class="' + cls + '"' + op + ' x="' + x.toFixed(1) + '" y="5" width="' + Math.max(0, w - 1).toFixed(1) + '" height="14"><title>' +
        (k === 'dfix' ? fixedD + ' Democratic seats not up' : k === 'rfix' ? fixedR + ' Republican seats not up' : n + ' ' + rating(k === 'sd' ? 1 : k === 'ld' ? 0.9 : k === 'nd' ? 0.7 : k === 'tu' ? 0.5 : k === 'nr' ? 0.3 : k === 'lr' ? 0.1 : 0).t) + '</title></rect>';
      x += w;
    });
    const mx = need / total * W;
    h += '<line x1="' + mx.toFixed(1) + '" x2="' + mx.toFixed(1) + '" y1="0" y2="24" class="maj-line"/>';
    $('seatbar').innerHTML = '<svg viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">' + h + '</svg>' +
      '<div class="seat-need" style="left:' + (need / total * 100).toFixed(2) + '%">' + needLab + '</div>';
  }

  // ---------------------------------------------------------------- detail panel
  function compBar(race) {
    const lab = ['White college', 'White non-college', 'Black', 'Hispanic', 'Asian & other'];
    const cls = ['c1', 'c2', 'c3', 'c4', 'c5'];
    const ph = M.phi(sc, 'race');
    const raw = race.map((v, i) => v * ph[i]); const z = raw.reduce((a, b) => a + b, 0);
    const s = raw.map((v) => v / z);
    return '<div class="comp" aria-hidden="true">' + s.map((v, i) => '<span class="' + cls[i] + '" style="width:' + (v * 100).toFixed(1) + '%"></span>').join('') + '</div>' +
      '<div class="comp-key">' + s.map((v, i) => '<span><span class="' + cls[i] + '" style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px"></span>' + lab[i] + ' ' + Math.round(v * 100) + '%</span>').join('') + '</div>';
  }
  function renderDetail() {
    const box = $('detail');
    const t = ui.tab;
    if (ui.sel === null) {
      const hint = t === 'house' ? 'Tap or hover a district to see its numbers.' : 'Tap a state to see the race.';
      const tp = tippingSeat();
      box.innerHTML = '<p class="note">' + hint + (tp ? ' The tipping-point seat right now is <a href="#" data-sel="' + tp.i + '">' + tp.r.id + '</a>, ' + matchup(t, tp.r, true) + '.' : '') + '</p>';
      const a = box.querySelector('a[data-sel]');
      if (a) a.addEventListener('click', (e) => { e.preventDefault(); select(+a.dataset.sel); });
      return;
    }
    const i = ui.sel, r = races(t)[i];
    const m = raceMargin(t, i), p = raceP(t, i), rt = rating(p), fpnt = flipPoint(t, i);
    let facts = '<div><dt>Projected</dt><dd class="' + (m > 0 ? 'd' : 'r') + '">' + fm(m) + '</dd></div>' +
      '<div><dt>Chance</dt><dd>' + chanceText(p, r) + '</dd></div>' +
      '<div><dt>Flips at</dt><dd>' + (fpnt === null ? '—' : fm(fpnt)) + '</dd></div>';
    let extra = '';
    if (t === 'house') {
      facts += '<div><dt>2024 president</dt><dd>' + fm(r.m24) + '</dd></div><div><dt>2020 president</dt><dd>' + fm(r.m20) + '</dd></div>';
      const ce = sc.cand ? M.candEffect(r) : 0;
      const parts = [];
      if (!r.unc) {
        const uni = r.m24 + (R.m.national - D.N24);
        parts.push('Uniform swing from 2024 alone gives ' + fm(uni) + '.');
        const demo = m - uni - ce;
        if (Math.abs(demo) >= 0.3) parts.push('This electorate moves it ' + (demo > 0 ? 'toward Democrats' : 'toward Republicans') + ' by ' + Math.abs(demo).toFixed(1) + ' more.');
        if (Math.abs(ce) >= 0.3) parts.push('Candidate effects: ' + (ce > 0 ? '+' : '−') + Math.abs(ce).toFixed(1) + ' toward ' + (ce > 0 ? 'Democrats' : 'Republicans') + (r.inc ? ' (incumbent running)' : '') + '.');
        if (!r.inc) parts.push('Open seat.');
      } else {
        parts.push(r.unc === 'D' ? 'No Republican on the November ballot.' : 'No Democrat on the November ballot.');
      }
      const hp = D.housepolls[r.id];
      if (hp) parts.push('Public district polls (shown, not used): ' + hp.latest.map((x) => esc(x.p) + ' ' + x.d + '–' + x.r + ' (' + x.end.slice(5) + (x.lean ? ', ' + x.lean + '-leaning' : '') + ')').join('; ') + '.');
      if (r.id === 'CA-06') parts.push('Kevin Kiley is running as an independent after Prop 50 redrew his seat.');
      extra = '<p class="note">' + parts.join(' ') + '</p><div><span class="tally-k">Estimated electorate (race and education)</span>' + compBar(r.race) + '</div>';
    } else {
      facts += '<div><dt>2024 president</dt><dd>' + fm(r.m24) + '</dd></div>';
      const parts = [];
      if (t === 'senate') {
        if (r.src === 'oct9') parts.push('Starts from your Oct 9 corrected polling average, ' + fm(r.base - (r.drift || 0)) + ' (model chance then ' + r.p9 + '%)' +
          (Math.abs(r.drift || 0) >= 0.05 ? ', moved ' + (r.drift > 0 ? '+' : '−') + Math.abs(r.drift).toFixed(1) + ' by polls released since then, to ' + fm(r.base) + '.' : '. New polls since then haven\'t moved it.'));
        else if (r.src === 'polls-3way') parts.push('Starts from its three-way polls, ' + fm(r.base) + '.');
        else parts.push('No competitive polling in your Oct 9 model; starts from fundamentals, ' + fm(r.base) + '.');
        if (r.recent && r.recent.length) parts.push('Polls since Oct 9 (some may already be in the Oct 9 average): ' + r.recent.map((x) => esc(x[0]) + ', ' + x[1] + ': ' + esc(x[2])).join('; ') + '.');
      } else {
        if (r.src === 'polls') parts.push('Starts from a weighted average of ' + r.npolls + ' public poll' + (r.npolls === 1 ? '' : 's') + ' since late July, ' + fm(r.base) + '. Latest: ' + r.latest.slice(0, 3).map((x) => esc(x.p) + ' ' + x.d + '–' + x.r + ' (' + x.end.slice(5) + (x.lean ? ', ' + x.lean + '-leaning' : '') + ')').join('; ') + '.');
        else parts.push('No recent public polls; starts from fundamentals, ' + fm(r.base) + '.');
      }
      if (r.note) parts.push(esc(r.note));
      extra = '<p class="note">' + parts.join(' ') + '</p>';
    }
    box.innerHTML = '<div class="detail-top"><span class="detail-title">' + esc(r.id) + ' · ' + esc(raceName(t, r)) + '</span><span class="pill ' + rt.k + '">' + rt.t + '</span></div>' +
      '<div class="matchup">' + matchup(t, r, true) + '</div><dl class="facts">' + facts + '</dl>' + extra;
  }
  function tippingSeat() {
    const t = ui.tab;
    const list = races(t);
    let k;
    if (rView()) {
      // the seat that gives Republicans their 218th House seat, 50th senator or 26th governor
      const order = list.map((r, i) => i).filter((i) => list[i].rp !== 'I').sort((a, b) => raceMargin(t, a) - raceMargin(t, b));
      if (t === 'house') k = 217;
      else if (t === 'senate') k = 50 - 31 - 1;
      else k = 26 - 8 - 1;
      const i = order[k];
      return i === undefined ? null : { i, r: list[i] };
    }
    const order = list.map((r, i) => i).sort((a, b) => raceMargin(t, b) - raceMargin(t, a));
    if (t === 'house') k = 217;
    else if (t === 'senate') k = 51 - 34 - 1;
    else k = 26 - 6 - 1;
    const i = order[k];
    return i === undefined ? null : { i, r: list[i] };
  }
  function select(i) {
    ui.sel = i;
    renderMap(); renderDetail(); renderTable();
  }
  // select a race from a list and bring the map to it
  function openRace(i, scroll) {
    if (isTabbed()) {
      if (ui.screen !== 'map') showScreen('map', true);
      select(i);
      if (ui.tab === 'house') {
        // zoom to the district so it's easy to see and its neighbours are tappable
        if (zoom.on) centerOn(i);
        else { const b = baseView(), d = D.districts[i]; setView({ x: d.x - b.w / 6, y: d.y - b.h / 6, w: b.w / 3, h: b.h / 3 }); }
      }
      $('seatbar').scrollIntoView({ block: 'start' });
      return;
    }
    select(i);
    if (scroll) $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------------------------------------------------------------- tooltip + pointer
  const tip = $('tip');
  function svgPoint(svg, evt) {
    const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function nearestIndex(evt) {
    const svg = $('map');
    if (ui.tab === 'house') {
      const p = svgPoint(svg, evt);
      let best = -1, bd = Infinity;
      D.districts.forEach((d, i) => { const dd = (d.x - p.x) ** 2 + (d.y - p.y) ** 2; if (dd < bd) { bd = dd; best = i; } });
      return bd <= (HR * 1.8) ** 2 ? best : -1;
    }
    const el = evt.target.closest('.tile[data-i]');
    return el ? +el.dataset.i : -1;
  }
  function showTip(evt, i) {
    const t = ui.tab, r = races(t)[i];
    const m = raceMargin(t, i), p = raceP(t, i), f = flipPoint(t, i);
    tip.innerHTML = '<b>' + esc(r.id) + '</b> · ' + rating(p).t + ' · ' + chanceText(p, r) + '<br>' + esc(matchup(t, r, false)) + '<br>Projected ' + fm(m) + (f === null ? '' : ' · flips at ' + fm(f));
    tip.hidden = false;
    const x = Math.min(window.innerWidth - 270, evt.clientX + 14), y = evt.clientY + 16;
    tip.style.left = x + 'px'; tip.style.top = (y + 90 > window.innerHeight ? evt.clientY - 96 : y) + 'px';
  }
  function wireMap() {
    const svg = $('map');
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const i = nearestIndex(e);
      if (i < 0) { tip.hidden = true; return; }
      showTip(e, i);
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    svg.addEventListener('click', (e) => {
      if (gesture.suppressClick) { gesture.suppressClick = false; return; }
      const i = nearestIndex(e);
      if (i >= 0) select(i);
    });
    $('zoomBtn').addEventListener('click', () => {
      if (zoom.on) { resetZoom(); return; }
      const b = baseView();
      const d = ui.sel !== null ? D.districts[ui.sel] : null;
      const cx = d ? d.x : b.x + b.w / 2, cy = d ? d.y : b.y + b.h / 2;
      const w = b.w / 3, h = b.h / 3;
      setView({ x: cx - w / 2, y: cy - h / 2, w, h });
    });
    wireGestures();
  }

  // ---------------------------------------------------------------- zoom (House map on phones)
  // The map zooms by narrowing its viewBox, so taps keep working through getScreenCTM.
  const zoom = { on: false, v: null };
  const gesture = { suppressClick: false };
  function baseView() { if (!houseGeom) buildHouseGeom(); const g = houseGeom; return { x: g.minx, y: g.miny, w: g.w, h: g.h }; }
  function setView(v) {
    const b = baseView();
    const w = Math.max(b.w / 8, Math.min(b.w, v.w)), h = w * b.h / b.w;
    const x = Math.max(b.x, Math.min(b.x + b.w - w, v.x)), y = Math.max(b.y, Math.min(b.y + b.h - h, v.y));
    const z = b.w / w;
    zoom.on = z > 1.02;
    zoom.v = zoom.on ? { x, y, w, h } : null;
    const svg = $('map');
    svg.setAttribute('viewBox', [x, y, w, h].map((n) => n.toFixed(2)).join(' '));
    svg.style.setProperty('--lz', (1 / Math.sqrt(z)).toFixed(4));   // labels and outlines grow more slowly than the hexes
    svg.classList.toggle('zoomed-in', zoom.on);
    $('zoomBtn').textContent = zoom.on ? 'Fit map' : 'Zoom in';
    $('zoomBtn').setAttribute('aria-pressed', zoom.on ? 'true' : 'false');
    $('mapHint').textContent = zoom.on ? 'Drag to move around. Fit map shows everything again.' : 'Pinch or double-tap the map to zoom.';
  }
  function resetZoom() { if (ui.tab === 'house' && houseGeom) setView(baseView()); else { zoom.on = false; zoom.v = null; } }
  function zoomAt(cx, cy, factor) {   // keep the svg point (cx, cy) fixed on screen
    const v = zoom.v || baseView();
    setView({ x: cx - (cx - v.x) / factor, y: cy - (cy - v.y) / factor, w: v.w / factor, h: v.h / factor });
  }
  function centerOn(i) {
    if (!zoom.on || ui.tab !== 'house') return;
    const d = D.districts[i], v = zoom.v;
    setView({ x: d.x - v.w / 2, y: d.y - v.h / 2, w: v.w, h: v.h });
  }
  function wireGestures() {
    const svg = $('map');
    const pts = new Map();
    let g0 = null, moved = false, lastTap = null;
    const toSvg = (cx, cy, v) => { const r = svg.getBoundingClientRect(); return { x: v.x + (cx - r.left) / r.width * v.w, y: v.y + (cy - r.top) / r.height * v.h }; };
    const begin = () => {
      const v = zoom.v || baseView();
      const a = Array.from(pts.values());
      if (a.length >= 2) {
        g0 = { pinch: true, v, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, m: toSvg((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2, v) };
      } else if (a.length === 1) g0 = { pinch: false, v, x: a[0].x, y: a[0].y };
      else g0 = null;
    };
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || ui.tab !== 'house' || !isTabbed()) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      if (pts.size === 1) moved = false;
      if (pts.size === 2) moved = true;
      begin();
    });
    svg.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p || !g0) return;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) moved = true;
      const r = svg.getBoundingClientRect();
      if (g0.pinch && pts.size >= 2) {
        const a = Array.from(pts.values());
        const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
        const w = g0.v.w * g0.d / d, h = w * g0.v.h / g0.v.w;
        const mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
        setView({ x: g0.m.x - (mx - r.left) / r.width * w, y: g0.m.y - (my - r.top) / r.height * h, w, h });
      } else if (!g0.pinch && zoom.on && moved) {
        const v = g0.v;
        setView({ x: v.x - (p.x - g0.x) / r.width * v.w, y: v.y - (p.y - g0.y) / r.height * v.h, w: v.w, h: v.h });
      }
    });
    const end = (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      pts.delete(e.pointerId);
      if (moved) gesture.suppressClick = true;
      if (!moved && e.type === 'pointerup' && pts.size === 0) {
        const now = Date.now();
        if (lastTap && now - lastTap.t < 330 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
          const v = zoom.v || baseView();
          const c = toSvg(p.x, p.y, v);
          if (baseView().w / v.w >= 5) resetZoom(); else zoomAt(c.x, c.y, 2.5);
          lastTap = null;
        } else lastTap = { t: now, x: p.x, y: p.y };
      }
      if (pts.size === 0) setTimeout(() => { gesture.suppressClick = false; }, 400);
      begin();   // a remaining finger carries on as a drag
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- results panel
  // where a side becomes favored, phrased from that side
  function tipTextR(tip, what) {
    if (tip === null) return '';
    return 'With these settings Republicans are favored to keep the ' + what + ' if the national vote is better for them than <b>' + fm(tip) + '</b>.';
  }
  function renderResultsR(curve) {
    const t = ui.tab;
    let head = '';
    const tipH = crossing(curve, 'houseR', 217.5), tipS = crossing(curve, 'senateR', 49.5);
    if (t === 'house') {
      const h = R.house.r;
      $('resTitle').textContent = 'House outlook';
      head = 'Republicans win <b class="r">' + Math.round(h.mean) + '</b> seats on average (80% of simulations: ' + h.lo + '–' + h.hi + '). ' +
        'Chance of a Republican majority: <b>' + fp(h.control) + '</b>. ' + tipTextR(tipH, 'House');
      drawHist(h.hist, 135, 260, 218, 'Republican seats', 'R');
      $('histCap').textContent = R.n.toLocaleString() + ' simulations. Red bars are Republican majorities.';
    } else if (t === 'senate') {
      const s = R.senate;
      $('resTitle').textContent = 'Senate outlook';
      head = 'Republicans hold <b class="r">' + s.r.mean.toFixed(1) + '</b> seats on average, including 31 not up (80%: ' + s.r.lo + '–' + s.r.hi + '). ' +
        'Republican control <b>' + fp(s.rcontrol) + '</b>, Democratic control <b>' + fp(s.control) + '</b>, Osborn decides <b>' + fp(s.osborn) + '</b>. ' + tipTextR(tipS, 'Senate');
      drawHist(s.r.hist, 40, 58, 50, 'Republican seats', 'R');
      $('histCap').textContent = 'Republicans need 50 seats, since VP Vance breaks ties. Osborn (NE) counts for neither party. Red bars are Republican control.';
    } else {
      const g = R.gov.r;
      $('resTitle').textContent = 'Governors outlook';
      head = 'Republicans hold <b class="r">' + g.mean.toFixed(1) + '</b> governorships on average after Nov 3, including 8 not up (80%: ' + g.lo + '–' + g.hi + '). ' +
        'Chance of 26 or more: <b>' + fp(g.control) + '</b>.';
      drawHist(g.hist, 14, 34, 26, 'Republican governors', 'R');
      $('histCap').textContent = 'Governor races move 0.8 points for every point of national change, since state candidates matter more.';
    }
    $('resHeadline').innerHTML = head;
    $('histTitle').textContent = 'Simulated outcomes';
    drawCurves(curve, tipH, tipS);
  }
  function renderResults() {
    const t = ui.tab;
    let head = '';
    const curve = M.curve(sc, gridG);
    if (rView()) { renderResultsR(curve); return; }
    const tipH = crossing(curve, 'house', 217.5), tipS = crossing(curve, 'senate', 50.5);
    if (t === 'house') {
      const h = R.house;
      $('resTitle').textContent = 'House outlook';
      head = 'Democrats win <b class="d">' + Math.round(h.mean) + '</b> seats on average (80% of simulations: ' + h.lo + '–' + h.hi + '). ' +
        'Chance of a Democratic majority: <b>' + fp(h.control) + '</b>. ' +
        (tipH !== null ? 'With these settings Democrats are favored for the House at <b>' + fm(tipH) + '</b> or better nationally.' : '');
      drawHist(R.house.hist, 175, 300, 218, 'Democratic seats');
      $('histCap').textContent = R.n.toLocaleString() + ' simulations. Blue bars are Democratic majorities.';
    } else if (t === 'senate') {
      const s = R.senate;
      $('resTitle').textContent = 'Senate outlook';
      head = 'Democrats hold <b class="d">' + s.mean.toFixed(1) + '</b> seats on average, including 34 not up (80%: ' + s.lo + '–' + s.hi + '). ' +
        'Democratic control <b>' + fp(s.control) + '</b>, Republican control <b>' + fp(s.rcontrol) + '</b>, Osborn decides <b>' + fp(s.osborn) + '</b>. ' +
        (tipS !== null ? 'Control tips at about <b>' + fm(tipS) + '</b> nationally.' : '');
      drawHist(R.senate.hist, 42, 60, 51, 'Democratic-caucus seats');
      $('histCap').textContent = 'Democratic caucus includes King and Sanders; Osborn (NE) is counted separately. Blue bars are Democratic control.';
    } else {
      const g = R.gov;
      $('resTitle').textContent = 'Governors outlook';
      head = 'Democrats hold <b class="d">' + g.mean.toFixed(1) + '</b> governorships on average after Nov 3, including 6 not up (80%: ' + g.lo + '–' + g.hi + '). ' +
        'Chance of 26 or more: <b>' + fp(g.maj) + '</b>.';
      drawHist(R.gov.hist, 16, 36, 26, 'Democratic governors');
      $('histCap').textContent = 'Governor races move 0.8 points for every point of national change, since state candidates matter more.';
    }
    $('resHeadline').innerHTML = head;
    $('histTitle').textContent = 'Simulated outcomes';
    drawCurves(curve, tipH, tipS);
  }
  const gridG = []; for (let g = -8; g <= 18.001; g += 0.25) gridG.push(+g.toFixed(2));
  function crossing(curve, key, level) {
    for (let k = 1; k < curve.length; k++) {
      const a = curve[k - 1], b = curve[k];
      if ((a[key] - level) * (b[key] - level) <= 0 && a[key] !== b[key]) return a.g + (level - a[key]) / (b[key] - a[key]) * (b.g - a.g);
    }
    return null;
  }
  const chartW = (id, lo, hi) => Math.round(Math.max(lo || 300, Math.min(hi || 560, $(id).parentNode.clientWidth || 520)));
  function drawHist(hist, lo, hi, need, label, side) {
    const win = side === 'R' ? 'bar-r' : 'bar-d', lose = side === 'R' ? 'bar-d' : 'bar-r';
    const W = chartW('hist'), H = 170, L = 34, B = 26, T = 10;
    $('hist').setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    let max = 0; for (let k = lo; k <= hi; k++) max = Math.max(max, hist[k] || 0);
    const bw = (W - L - 6) / (hi - lo + 1);
    let h = '';
    for (let k = lo; k <= hi; k++) {
      const v = hist[k] || 0; if (!v) continue;
      const bh = v / max * (H - B - T);
      h += '<rect class="' + (k >= need ? win : lose) + '" x="' + (L + (k - lo) * bw + 0.5).toFixed(1) + '" y="' + (H - B - bh).toFixed(1) + '" width="' + Math.max(0.5, bw - 1).toFixed(1) + '" height="' + bh.toFixed(1) + '"/>';
    }
    const mx = L + (need - lo) * bw;
    h += '<line class="maj-line" x1="' + mx.toFixed(1) + '" x2="' + mx.toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>';
    h += '<text class="maj-text" x="' + (mx + 4).toFixed(1) + '" y="' + (T + 10) + '">' + need + '</text>';
    const step = hi - lo > 60 ? 20 : hi - lo > 25 ? 5 : 2;
    h += '<g class="axis"><line x1="' + L + '" x2="' + (W - 6) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
    for (let k = Math.ceil(lo / step) * step; k <= hi; k += step) {
      const x = L + (k - lo + 0.5) * bw;
      h += '<text x="' + x.toFixed(1) + '" y="' + (H - B + 15) + '" text-anchor="middle">' + k + '</text>';
    }
    h += '<text x="' + L + '" y="' + (H - 1) + '">' + label + '</text></g>';
    $('hist').innerHTML = h;
  }
  function drawCurves(curve, tipH, tipS) {
    const nat = R.m.national;
    const mk = (id, key, ylo, yhi, need, ylab, H, tipv, needLab) => {
      const W = chartW(id, 300, 520), L = 40, Rr = 10, T = 14, B = 28;
      $(id).setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      const gx = (g) => L + (g - gridG[0]) / (gridG[gridG.length - 1] - gridG[0]) * (W - L - Rr);
      const gy = (v) => T + (1 - (v - ylo) / (yhi - ylo)) * (H - T - B);
      let h = '<g class="axis">';
      const ystep = (yhi - ylo) > 60 ? 40 : 4;
      for (let v = Math.ceil(ylo / ystep) * ystep; v <= yhi; v += ystep) {
        h += '<line class="grid-line" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + gy(v).toFixed(1) + '" y2="' + gy(v).toFixed(1) + '"/><text x="' + (L - 6) + '" y="' + (gy(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>';
      }
      [-5, 0, 5, 10, 15].forEach((g) => {
        h += '<text x="' + gx(g).toFixed(1) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + (g === 0 ? 'Even' : (g > 0 ? 'D+' : 'R+') + Math.abs(g)) + '</text>';
      });
      h += '<text x="' + L + '" y="' + (T - 2) + '" style="font-weight:700;fill:var(--ink)">' + ylab + '</text></g>';
      h += '<line class="maj-line" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + gy(need).toFixed(1) + '" y2="' + gy(need).toFixed(1) + '"/>';
      h += '<text class="maj-text" x="' + (W - Rr) + '" y="' + (gy(need) - 4).toFixed(1) + '" text-anchor="end">' + needLab + '</text>';
      let d = '';
      curve.forEach((c, k) => { const v = Math.max(ylo, Math.min(yhi, c[key])); d += (k ? 'L' : 'M') + gx(c.g).toFixed(1) + ' ' + gy(v).toFixed(1); });
      h += '<path class="curve-line" d="' + d + '"/>';
      if (tipv !== null && tipv > gridG[0] && tipv < gridG[gridG.length - 1]) {
        h += '<circle cx="' + gx(tipv).toFixed(1) + '" cy="' + gy(need).toFixed(1) + '" r="3.5" style="fill:var(--card);stroke:var(--ink);stroke-width:1.5"/>';
      }
      // current scenario marker
      const cur = curve.reduce((a, c) => (Math.abs(c.g - nat) < Math.abs(a.g - nat) ? c : a), curve[0]);
      const cx = gx(Math.max(gridG[0], Math.min(gridG[gridG.length - 1], nat)));
      const cy = gy(Math.max(ylo, Math.min(yhi, cur[key])));
      h += '<line class="cur-line" x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>';
      h += '<circle class="cur-dot" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="5"/>';
      const lbl = (key.indexOf('house') === 0 ? Math.round(cur[key]) : cur[key].toFixed(1)) + ' at ' + fm(nat);
      const anchorEnd = cx > W * 0.62;
      // label above the dot unless that would sit on the majority line or the top edge
      let ly = cy - 8;
      if (ly < T + 16 || Math.abs(ly - 4 - gy(need)) < 11) ly = cy + 17;
      h += '<text class="cur-text" x="' + (cx + (anchorEnd ? -8 : 8)).toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + (anchorEnd ? 'end' : 'start') + '">' + lbl + '</text>';
      $(id).innerHTML = h;
    };
    if (rView()) {
      mk('curveH', 'houseR', 115, 275, 218, 'Expected House seats (R)', 190, tipH, '218 majority');
      mk('curveS', 'senateR', 40, 60, 50, 'Expected Senate seats (R)', 150, tipS, '50 control (with VP)');
    } else {
      mk('curveH', 'house', 160, 320, 218, 'Expected House seats (D)', 190, tipH, '218 majority');
      mk('curveS', 'senate', 40, 60, 51, 'Expected Senate seats (D caucus)', 150, tipS, '51 control');
    }
  }

  // ---------------------------------------------------------------- race table
  function renderTable() {
    const t = ui.tab;
    const list = races(t);
    const q = ui.query.trim().toLowerCase();
    let idx = list.map((r, i) => i);
    if (q) idx = idx.filter((i) => { const r = list[i]; return r.id.toLowerCase().indexOf(q) >= 0 || (STATE_NAMES[r.st] || '').toLowerCase().indexOf(q) >= 0 || (r.dn || '').toLowerCase().indexOf(q) >= 0 || (r.rn || '').toLowerCase().indexOf(q) >= 0; });
    idx.sort((a, b) => Math.abs(raceMargin(t, a)) - Math.abs(raceMargin(t, b)));
    const limit = ui.showAll || q ? idx.length : (t === 'house' ? 30 : 15);
    $('raceTitle').textContent = q ? 'Matching races' : t === 'house' ? 'Closest House races' : t === 'senate' ? 'Senate races' : 'Governor races';
    $('raceSub').textContent = 'Sorted by projected margin. Select a row to see it on the map. * = incumbent running.';
    $('raceTable').querySelector('thead').innerHTML = '<tr><th>Race</th><th>Matchup</th><th class="n col24">2024 pres.</th><th class="n">Projected</th><th class="n">Chance</th><th class="n colflip">Flips at</th></tr>';
    const rows = idx.slice(0, limit).map((i) => {
      const r = list[i], m = raceMargin(t, i), p = raceP(t, i), f = flipPoint(t, i), rt = rating(p);
      return '<tr data-i="' + i + '"' + (ui.sel === i ? ' class="sel"' : '') + '><td class="code">' + esc(r.id) + '</td><td><span class="full">' + matchup(t, r, true) + '</span><span class="short">' + shortMatchup(t, r) + '</span></td><td class="n col24">' + fm(r.m24) +
        '</td><td class="n ' + (m > 0 ? 'd' : 'r') + '">' + fm(m) + '</td><td class="n"><span class="pill ' + rt.k + '">' + chanceText(p, r) + '</span></td><td class="n colflip">' + (f === null ? '—' : fm(f)) + '</td></tr>';
    });
    $('raceTable').querySelector('tbody').innerHTML = rows.join('') || '<tr><td colspan="6" class="muted">No races match.</td></tr>';
    $('moreBtn').hidden = !!q || idx.length <= limit && !ui.showAll;
    $('moreBtn').textContent = ui.showAll ? 'Show fewer' : 'Show all ' + idx.length;
  }

  // ---------------------------------------------------------------- controls
  function sliderTicks(wrap, input, ticks) {
    wrap.querySelectorAll('.tick').forEach((t) => t.remove());
    const min = +input.min, max = +input.max;
    ticks.forEach(([v, cls, title]) => {
      if (v < min || v > max) return;
      const f = (v - min) / (max - min);
      const s = document.createElement('span');
      s.className = 'tick ' + (cls || '');
      s.style.left = 'calc(' + (f * 100).toFixed(2) + '% + ' + (9 - 18 * f).toFixed(1) + 'px)';
      if (title) s.title = title;
      wrap.appendChild(s);
    });
  }
  function buildXtabs() {
    const dim = ui.dim;
    const box = $('xtabs');
    const labs = GROUP_LABELS[dim];
    box.innerHTML = labs.map((l, i) => {
      const rg = GROUP_RANGE[dim][i];
      return '<div class="xtab-row"><span class="xtab-name">' + l + '</span><span class="xtab-share num" id="xs' + i + '"></span>' +
        '<div class="xtab-line"><span class="lab">Margin</span><div class="slider-wrap" id="xmw' + i + '"><input type="range" id="xm-' + dim + '-' + i + '" data-i="' + i + '" class="xm" min="' + rg[0] + '" max="' + rg[1] + '" step="0.5" aria-label="' + l + ' margin"></div><output id="xmo' + i + '"></output></div>' +
        '<div class="xtab-line"><span class="lab">Turnout</span><div class="slider-wrap"><input type="range" id="xt-' + dim + '-' + i + '" data-i="' + i + '" class="xt" min="0.6" max="1.5" step="0.01" aria-label="' + l + ' turnout"></div><output id="xto' + i + '"></output></div></div>';
    }).join('');
    box.querySelectorAll('.xm').forEach((inp) => inp.addEventListener('input', () => {
      M.setGroupMargin(sc, ui.dim, +inp.dataset.i, +inp.value);
      ui.pattern = 'custom';
      update(true);
    }));
    box.querySelectorAll('.xt').forEach((inp) => inp.addEventListener('input', () => {
      sc.mult[ui.dim][+inp.dataset.i] = +inp.value;
      update(true);
    }));
    document.querySelectorAll('#dimTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.dim === dim ? 'true' : 'false'));
  }
  const PATTERNS = [
    { k: 'blend', label: 'Default: halfway to 2026 polls' },
    { k: 'polls', label: '2026 poll crosstabs' },
    { k: '2024', label: '2024 pattern' },
    { k: '2022', label: '2022 pattern' },
    { k: '2018', label: '2018 pattern' },
  ];
  function applyPattern(k) {
    const nat = M.national(sc);
    ['race', 'age', 'gender'].forEach((dim) => {
      const b24 = D.base['2024'][dim].dev;
      sc.dev[dim] = b24.map((v, i) => {
        if (k === 'blend') return M.blendDev(dim)[i];
        if (k === 'polls') return D.polldev[dim][i].dev;
        if (k === '2024') return v;
        return D.base[k][dim].dev[i];
      });
    });
    sc.C = M.solveC(sc, nat);
    ui.pattern = k;
    update();
  }
  function buildPatterns() {
    const box = $('patternChips');
    box.innerHTML = PATTERNS.map((p) => '<button class="chip" data-k="' + p.k + '" aria-pressed="false">' + p.label + '</button>').join('');
    box.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) applyPattern(b.dataset.k); });
  }
  function renderControls() {
    const dim = ui.dim;
    const gm = M.groupMargins(sc, dim);
    const ns = M.natShares(sc, dim);
    const nat = M.national(sc);
    gm.forEach((v, i) => {
      const inp = $('xm-' + dim + '-' + i); if (!inp) return;
      if (document.activeElement !== inp) inp.value = v.toFixed(1);
      $('xmo' + i).textContent = fm(v);
      $('xmo' + i).className = v > 0 ? 'd' : 'r';
      $('xs' + i).textContent = Math.round(ns[i] * 100) + '% of voters';
      const t = $('xt-' + dim + '-' + i);
      if (document.activeElement !== t) t.value = sc.mult[dim][i];
      const mu = sc.mult[dim][i];
      $('xto' + i).textContent = Math.abs(mu - 1) < 0.005 ? 'Default' : (mu > 1 ? '+' : '−') + Math.round(Math.abs(mu - 1) * 100) + '%';
      const t24 = nat + D.base['2024'][dim].dev[i];
      const tp = nat + D.polldev[dim][i].dev;
      sliderTicks($('xmw' + i), inp, [[t24, '', '2024 pattern at this national margin'], [tp, 'poll', '2026 polls at this national margin']]);
    });
    document.querySelectorAll('#patternChips .chip').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === ui.pattern ? 'true' : 'false'));
    // turnout
    if (document.activeElement !== $('turnout')) $('turnout').value = sc.T;
    const ballots = sc.T / 100 * 244.7e6;
    $('turnoutOut').textContent = sc.T.toFixed(1) + '% · ≈' + (ballots / 1e6).toFixed(0) + 'M ballots';
    sliderTicks($('turnoutWrap'), $('turnout'), [[D.vep['2022'], '', '2022'], [D.vep['2018'], '', '2018'], [D.vep['2024'], '', '2024']]);
    if (document.activeElement !== $('edge')) $('edge').value = sc.edge;
    $('edgeOut').textContent = Math.abs(sc.edge) < 0.05 ? 'None' : (sc.edge > 0 ? 'D +' : 'R +') + Math.abs(sc.edge).toFixed(1);
    $('edgeOut').className = 'num ' + (sc.edge > 0.05 ? 'd' : sc.edge < -0.05 ? 'r' : '');
    // early vote
    const w = M.evWeight(sc);
    if (document.activeElement !== $('evw')) $('evw').value = Math.round(w * 100);
    $('evwOut').textContent = (w * 100).toFixed(w < 0.1 && w > 0 ? 1 : 0) + '%';
    const shift = M.evShift(sc);
    $('evwHint').textContent = 'The early vote implies about ' + fm(D.evproj.median) + ' (see below), vs. ' + fm(D.G0) + ' in the polls. At this weight it moves the national vote ' + (shift >= 0 ? '+' : '−') + Math.abs(shift).toFixed(2) + ' pts.';
    sliderTicks($('evwWrap'), $('evw'), [[M.evAuto() * 100, 'auto', 'Auto: share of expected vote already cast']]);
    $('evAuto').setAttribute('aria-pressed', sc.evw === null ? 'true' : 'false');
    $('evFace').setAttribute('aria-pressed', sc.evw === 1 ? 'true' : 'false');
    $('evOff').setAttribute('aria-pressed', sc.evw === 0 ? 'true' : 'false');
    // uncertainty
    if (document.activeElement !== $('sig')) $('sig').value = sc.sigN;
    $('sigOut').textContent = sc.sigN < 0.05 ? 'None (exact)' : '±' + sc.sigN.toFixed(1) + ' pts';
    sliderTicks($('sigWrap'), $('sig'), [[3.9, '', 'Your Oct 9 Senate model']]);
    $('cand').checked = sc.cand;
  }
  function wireControls() {
    $('env').addEventListener('input', () => { sc.C = M.solveC(sc, +$('env').value); update(true); });
    $('turnout').addEventListener('input', () => { sc.T = +$('turnout').value; update(true); });
    $('edge').addEventListener('input', () => { sc.edge = +$('edge').value; update(true); });
    $('evw').addEventListener('input', () => { sc.evw = +$('evw').value / 100; update(true); });
    $('evAuto').addEventListener('click', () => { sc.evw = null; update(); });
    $('evFace').addEventListener('click', () => { sc.evw = 1; update(); });
    $('evOff').addEventListener('click', () => { sc.evw = 0; update(); });
    $('sig').addEventListener('input', () => { sc.sigN = +$('sig').value; update(true); });
    $('cand').addEventListener('change', () => { sc.cand = $('cand').checked; update(); });
    $('resetBtn').addEventListener('click', () => { sc = M.clone(M.defaults); ui.pattern = 'blend'; buildXtabs(); update(); });
    document.querySelectorAll('#dimTabs button').forEach((b) => b.addEventListener('click', () => { ui.dim = b.dataset.dim; saveUi(); buildXtabs(); renderControls(); }));
    const setTab = (t) => {
      if (ui.tab === t) return;
      ui.tab = t; ui.sel = null; ui.showAll = false; saveUi(); tip.hidden = true;
      document.querySelectorAll('.tabs[role="tablist"] button[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
      render();
    };
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      setTab(b.dataset.tab);
      if (!b.classList.contains('tally-item')) return;
      if (isTabbed()) { if (ui.screen === 'adjust' || ui.screen === 'early') showScreen('map', true); }
      else $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    $('cmChance').addEventListener('click', () => { ui.cmode = 'chance'; saveUi(); render(); });
    const setSide = (sd) => { if (ui.side === sd) return; ui.side = sd; saveUi(); render(); };
    $('sideD').addEventListener('click', () => setSide('D'));
    $('sideR').addEventListener('click', () => setSide('R'));
    $('cmMargin').addEventListener('click', () => { ui.cmode = 'margin'; saveUi(); render(); });
    // two search boxes (map card, and the races screen on phones) share one query
    const onSearch = (el) => {
      ui.query = el.value;
      ['search', 'search2'].forEach((id) => { if ($(id) !== el) $(id).value = el.value; });
      renderMap(); renderTable();
    };
    ['search', 'search2'].forEach((id) => {
      $(id).addEventListener('input', () => onSearch($(id)));
      $(id).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const first = $('raceTable').querySelector('tbody tr[data-i]');
        if (!first) return;
        $(id).blur();
        openRace(+first.dataset.i);
      });
    });
    $('raceTable').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      openRace(+tr.dataset.i, true);
    });
    $('moreBtn').addEventListener('click', () => { ui.showAll = !ui.showAll; renderTable(); });
  }

  // ---------------------------------------------------------------- early vote section
  function buildEarlyVote() {
    const ev = D.ev, us = ev.us;
    const pct2022 = us.cast / us.t22;
    const byState = {}; ev.states.forEach((s) => { byState[s.st] = s; });
    const measSorted = D.evproj.measures.slice().sort((a, b) => a.implied - b.implied);
    // party-registration table
    const partyStates = ['NC', 'PA', 'AZ', 'NV', 'ME', 'IA', 'FL', 'NE', 'NJ', 'CA', 'CO', 'MD'];
    const trows = partyStates.map((k) => byState[k]).filter((s) => s && s.cast).map((s) => {
      const bar = '<svg viewBox="0 0 100 10" width="100" height="10" style="display:block" aria-hidden="true"><rect class="ev-bar-d" x="0" y="0" width="' + (s.d || 0) + '" height="10"/><rect class="ev-bar-r" x="' + (s.d || 0) + '" y="0" width="' + (s.r || 0) + '" height="10"/><rect class="ev-bar-o" x="' + ((s.d || 0) + (s.r || 0)) + '" y="0" width="' + Math.max(0, 100 - (s.d || 0) - (s.r || 0)) + '" height="10"/></svg>';
      return '<tr><td class="code">' + s.st + '</td><td class="n">' + Math.round(s.cast).toLocaleString() + '</td><td class="n">' + (s.cast / s.t22 * 100).toFixed(1) + '%</td><td>' + bar + '</td><td class="n"><span class="d">' + (s.d || 0).toFixed(0) + '</span> / <span class="r">' + (s.r || 0).toFixed(0) + '</span> / ' + Math.max(0, 100 - (s.d || 0) - (s.r || 0)).toFixed(0) + '</td><td class="n muted">' + (s.ev22d ? '<span class="d">' + s.ev22d.toFixed(0) + '</span> / <span class="r">' + s.ev22r.toFixed(0) + '</span>' : '—') + '</td><td class="n">' + (s.start && s.start !== 'none' ? s.start.slice(5).replace('-', '/') : s.start === 'none' ? 'No early in-person' : '—') + '</td></tr>';
    }).join('');
    const auto = M.evAuto();
    const st = D.story || {};
    const sinceStory = st.asof ? fmtDay(st.asof) : 'Oct 12';
    const keyMissing = ['TX', 'NY', 'SC', 'AK', 'KS', 'NC', 'GA', 'AZ', 'NV', 'WI'].filter((k) => !(byState[k] && byState[k].cast));
    const storyHtml = (st.bullets || []).map((b) => {
      const src = (b.sources || []).map((x) => x[1] ? '<a href="' + esc(x[1]) + '">' + esc(x[0]) + '</a>' : esc(x[0])).join(', ');
      const affCls = /dem/i.test(b.aff) ? ' dem' : /gop|rep/i.test(b.aff) ? ' rep' : '';
      return '<li><b>' + esc(b.title) + '</b> ' + b.html + ' <span class="src">' + src + '</span><span class="aff' + affCls + '">' + esc(b.aff) + '</span></li>';
    }).join('');
    $('early-vote').innerHTML =
      '<div class="ev-head"><div><h2>What the early vote says so far</h2>' +
      '<p class="sub">About ' + (us.cast / 1e6).toFixed(1) + ' million ballots are in, roughly ' + Math.round(pct2022 * 100) + '% of what a 2022-sized midterm would bring. ' + esc(st.headline || '') + '</p></div>' +
      '<div class="callout"><h3>How the map uses it</h3><p class="small" style="margin:0">The comparisons below were measured when about ' + (auto * 100).toFixed(1) + '% of the expected vote was in, so the default gives them that much weight. They imply about ' + fm(D.evproj.median) + ', vs. ' + fm(D.G0) + ' in the polls, which moves the national vote by ' + (M.evShift(M.defaults)).toFixed(2) + ' pts. Raise the weight in the controls to take them at face value. Ballot counts below refresh twice a day; the comparisons and the story are updated by hand (last on ' + sinceStory + ').</p></div></div>' +
      '<div class="stats">' +
      '<div class="stat"><div class="stat-v num">' + (us.cast / 1e6).toFixed(2) + 'M</div><div class="stat-k">ballots counted in ' + us.reporting + ' states (UF Election Lab' + (us.asof_min ? ', state data as of ' + fmtDay(us.asof_min) + (us.asof_max !== us.asof_min ? '–' + fmtDay(us.asof_max) : '') : '') + ')</div></div>' +
      '<div class="stat"><div class="stat-v num">' + (pct2022 * 100).toFixed(1) + '%</div><div class="stat-k">of 2022\'s 112.0M total ballots</div></div>' +
      '<div class="stat"><div class="stat-v num">45.9M</div><div class="stat-k">people voted before Election Day in 2022, 41% of all ballots</div></div>' +
      '</div>' +
      '<div class="ev-grid">' +
      '<div><h3>How much of the vote is in</h3><div class="chart" id="evVol"></div><p class="chart-cap">Ballots counted so far as a share of each state\'s 2022 total (UF Election Lab).' + (keyMissing.length ? ' No 2026 data yet for ' + keyMissing.join(', ') + '.' : '') + '</p></div>' +
      '<div><h3>Against the same point in 2024</h3><div class="chart" id="evCmp"></div><p class="chart-cap">' + esc(st.compare_note || '') + '</p></div>' +
      '</div>' +
      '<div class="ev-grid">' +
      '<div><h3>The story so far <span class="muted small" style="text-transform:none;letter-spacing:0">(as of ' + sinceStory + ')</span></h3><ul class="story">' + storyHtml + '</ul></div>' +
      '<div><h3>What it projects</h3><div class="chart" id="evProj"></div>' +
      '<p class="chart-cap">Each dot turns one same-point comparison with 2024 into a national margin. Gold line: median, ' + fm(D.evproj.median) + '. Dashed line: polling average, ' + fm(D.G0) + '.</p>' +
      '<p class="small">The math starts from 2024\'s R+1.5 and adds the shift in the gap between Democratic and Republican early voters times 0.85, about how loyal partisans are. A 1-point rise in the Democratic share of requests counts as a 2-point rise in the gap. The measures range from ' + fm(measSorted[0].implied) + ' to ' + fm(measSorted[measSorted.length - 1].implied) + '.</p>' +
      '<p class="small"><b>Read it as an illustration.</b> It assumes the early vote\'s tilt carries to the whole electorate and that nobody changes sides. Iowa and Ohio look extreme because both were very Republican early electorates in 2024. And the comparison with 2022 points the other way.</p></div>' +
      '</div>' +
      '<h3 style="margin-top:18px">Party registration of ballots so far</h3>' +
      '<div class="table-scroll"><table><thead><tr><th>State</th><th class="n">Ballots</th><th class="n">% of 2022</th><th>D / R / other</th><th class="n">Share D / R / other</th><th class="n">2022 final early vote D / R</th><th class="n">In-person starts</th></tr></thead><tbody>' + trows + '</tbody></table></div>' +
      '<p class="chart-cap">Registered party of voters whose ballots were accepted (UF Election Lab). The 2022 column is the final early vote, not the same point, so it is context only: early returns run more Democratic than the final early vote. Party registration is not vote choice.</p>' +
      '<h3 style="margin-top:14px">When in-person early voting opens</h3><div class="cal">' + (st.calendar || []).map((c) => '<span><b>' + c[0] + '</b> ' + c[1] + '</span>').join('') + '</div>' +
      '<p class="chart-cap">' + esc(st.calendar_note || '') + '</p>';
    drawEvCharts();
  }

  function drawEvCharts() {
    const ev = D.ev;
    const width = (id) => Math.round(Math.max(290, Math.min(560, $(id).clientWidth || 460)));
    // how much is in: share of 2022 total turnout
    const vol = ev.states.filter((s) => s.cast && s.t22).map((s) => ({ st: s.st, v: s.cast / s.t22, cast: s.cast })).sort((a, b) => b.v - a.v);
    const volRows = vol.slice(0, 13);
    ['NC', 'GA', 'AZ', 'NV', 'IA'].forEach((k) => { if (!volRows.find((x) => x.st === k)) { const f = vol.find((x) => x.st === k); if (f) volRows.push(f); } });
    let W = width('evVol');
    const vmax = Math.max(...volRows.map((x) => x.v)), rowH = 19, L = 30, labW = 104;
    let vh = '';
    volRows.forEach((r, k) => {
      const y = k * rowH + 4, w = r.v / vmax * (W - L - labW);
      vh += '<text class="ev-label" x="0" y="' + (y + 12) + '">' + r.st + '</text><rect class="ev-bar-d" x="' + L + '" y="' + (y + 3) + '" width="' + Math.max(1, w).toFixed(1) + '" height="12" rx="2"/>' +
        '<text class="ev-val" x="' + (L + w + 6).toFixed(1) + '" y="' + (y + 13) + '">' + (r.v * 100).toFixed(1) + '% · ' + (r.cast >= 1e6 ? (r.cast / 1e6).toFixed(2) + 'M' : Math.round(r.cast / 1000) + 'k') + '</text>';
    });
    $('evVol').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + (volRows.length * rowH + 8) + '" role="img" aria-label="Ballots counted as a share of 2022 turnout by state">' + vh + '</svg>';
    // dumbbell: Democratic share of mail requests, 2024 vs 2026 at the same point
    const share = D.evproj.measures.filter((m) => m.kind === 'share');
    W = width('evCmp');
    const x0 = 34, x1 = W - 120;
    const sx = (v) => x0 + (v - 30) / (75 - 30) * (x1 - x0);
    let ch = '<g class="axis">';
    [30, 40, 50, 60, 70].forEach((v) => { ch += '<line class="grid-line" x1="' + sx(v) + '" x2="' + sx(v) + '" y1="4" y2="' + (share.length * 26 + 4) + '"/><text x="' + sx(v) + '" y="' + (share.length * 26 + 18) + '" text-anchor="middle">' + v + '%</text>'; });
    ch += '</g>';
    share.forEach((m, k) => {
      const y = k * 26 + 16;
      ch += '<text class="ev-label" x="0" y="' + (y + 4) + '">' + m.st + '</text><line x1="' + sx(m.v24) + '" x2="' + sx(m.v26) + '" y1="' + y + '" y2="' + y + '" style="stroke:var(--ink-3);stroke-width:2"/>' +
        '<circle class="dot-n" cx="' + sx(m.v24) + '" cy="' + y + '" r="5"/><circle class="dot-d" cx="' + sx(m.v26) + '" cy="' + y + '" r="6"/>' +
        '<text class="ev-val" x="' + (sx(m.v26) + 10) + '" y="' + (y + 4) + '">' + m.v26 + '% (2024: ' + m.v24 + '%)</text>';
    });
    $('evCmp').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + (share.length * 26 + 26) + '" role="img" aria-label="Democratic share of mail-ballot requests, 2024 vs 2026">' + ch + '</svg>';
    // projection: implied national environment per measure
    const meas = D.evproj.measures.slice().sort((a, b) => a.implied - b.implied);
    W = width('evProj');
    const p0 = 34, p1 = W - 10;
    const px = (v) => p0 + (v + 5) / 30 * (p1 - p0);
    let ph = '<g class="axis">';
    [-5, 0, 5, 10, 15, 20, 25].forEach((v) => { ph += '<line class="grid-line" x1="' + px(v) + '" x2="' + px(v) + '" y1="4" y2="' + (meas.length * 22 + 6) + '"/><text x="' + px(v) + '" y="' + (meas.length * 22 + 20) + '" text-anchor="middle">' + (v === 0 ? 'Even' : (v > 0 ? 'D+' : 'R+') + Math.abs(v)) + '</text>'; });
    ph += '</g>';
    ph += '<line x1="' + px(D.G0) + '" x2="' + px(D.G0) + '" y1="0" y2="' + (meas.length * 22 + 6) + '" class="maj-line"/><line x1="' + px(D.evproj.median) + '" x2="' + px(D.evproj.median) + '" y1="0" y2="' + (meas.length * 22 + 6) + '" class="cur-line" style="stroke-width:2.5"/>';
    meas.forEach((m, k) => {
      const y = k * 22 + 14;
      const left = m.implied > 18 || m.implied < D.evproj.median;
      ph += '<text class="ev-label" x="0" y="' + (y + 4) + '">' + m.st + '</text><circle class="dot-d" cx="' + px(m.implied) + '" cy="' + y + '" r="5.5"/><text class="ev-val" x="' + (px(m.implied) + (left ? -10 : 10)) + '" y="' + (y + 4) + '" text-anchor="' + (left ? 'end' : 'start') + '">' + fm(m.implied) + '</text>';
    });
    $('evProj').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + (meas.length * 22 + 26) + '" role="img" aria-label="National environment implied by each early-vote measure">' + ph + '</svg>';
  }

  // ---------------------------------------------------------------- method section
  function buildMethod() {
    const pu = D.polls_used.map((p) => p.pollster + ' (' + p.end.slice(5).replace('-', '/') + ', ' + p.pop + ')').join('; ');
    $('method').innerHTML = '<h2>How it works</h2><div class="method-grid"><div>' +
      '<p><b>House.</b> Each district starts from its 2024 presidential margin on the lines in force for 2026, including the Texas, California, North Carolina, Ohio, Utah, Florida, Tennessee, Louisiana and Alabama redraws. It then moves with the national House vote, measured against 2024\'s R+1.5. A district moves more or less than the nation depending on who lives there: each group\'s swing and turnout change apply in proportion to that group\'s share of the district\'s voters. Candidate effects add 2 points for an incumbent and half of each candidate\'s past over- or under-performance of the presidential vote. At D+6 with only uniform swing, the lines give 223 Democratic seats; Decision Desk HQ reported 222 on the same test.</p>' +
      '<p><b>Groups.</b> The electorate is split three independent ways: race and education, age, and gender. Each split covers every voter, and a change in one shows up in the others (Hispanic voters are in every age group). The 2024 baseline is Pew Research Center\'s validated voters. Lowering turnout toward a midterm moves the electorate toward Pew\'s 2022 validated-voter mix: older, whiter and more college-educated. The default 2026 pattern sits halfway between 2024 and the average crosstabs of recent national polls (' + esc(pu) + '). Polls and validated-voter studies measure groups differently, which is why the default only goes halfway. Asian and other voters stay at their 2024 pattern, because their poll samples are tiny and Native American voters, who matter in several districts, are barely measured.</p>' +
      '<p><b>District electorates are estimates.</b> They come from each district\'s voting-age population by race, age and education, weighted by turnout factors fitted so the national total matches Pew\'s 2024 voters. The white college share is approximated from the district\'s overall college rate, and gender is assumed to be the same everywhere.</p>' +
      '</div><div>' +
      '<p><b>Senate.</b> The 14 competitive races start from your Oct 9 corrected polling averages. The other 21 start from 2024 presidential lean plus the national environment and 3 points for an incumbent; Montana uses its three-way polls (Alme vs. Bodnar). Every control then moves each state by how its electorate responds, relative to the default. With the defaults the Senate reproduces your Oct 9 model: 67% Democratic control vs. 65%.</p>' +
      '<p><b>Governors.</b> A recency- and quality-weighted average of public polls since late July, with R- or D-leaning pollsters at half weight; fundamentals where there are no polls (CO, HI, OK, SD, WY). They move 0.8 points per point of national change.</p>' +
      '<p><b>Uncertainty.</b> ' + M.NSIM.toLocaleString() + ' simulations with the same random draws each time, so results don\'t flicker as you drag. Each draws a shared national error (Student t with 5 degrees of freedom, SD from the slider), a state error (SD 2) shared by every race in the state, and a race error (House 5, Senate 3.8, governors 4.5).</p>' +
      '<p><b>Updates.</b> Twice a day the app rebuilds itself from fresh data: candidates and race polls from ElectIndex\'s public feed, ballot counts from UF Election Lab, and a new national default. The national default (' + fm(D.G0) + ' now) is a weighted average of public generic-ballot polls from the last four weeks: one poll per pollster (' + (D.G0_polls || '30') + ' pollsters), weighted by recency, sample size and pollster rating, with partisan-leaning pollsters at half weight. The competitive Senate races start from your Oct 9 corrected averages and move by the change in a simple poll average since then. The early-vote story, its same-point comparisons and the 2026 crosstab polls are updated by hand. If a source fails, the app keeps its last good numbers and says so at the top.</p>' +
      '<p><b>What it doesn\'t know.</b> District polls (shown, not used), expert ratings, money and late scandals such as NV-2\'s.</p>' +
      '</div></div>' +
      '<h3 style="margin-top:12px">Sources</h3><ul class="sources">' +
      '<li><a href="https://github.com/ElectIndex/26_us_forecast_data">ElectIndex 2026 forecast data</a>: 2020 and 2024 presidential results on the 2026 district lines, district voting-age population, candidates and incumbency, and raw race polls (repository as of Oct 12, 11:40 ET).</li>' +
      '<li>Pew Research Center validated voters: <a href="https://www.pewresearch.org/politics/2025/06/26/voting-patterns-in-the-2024-election/">2024</a>, 2022 and 2018 (<a href="https://docs.google.com/spreadsheets/d/1JczVvbrlxkLiYYiNPSv0TRlWsbvYEihkZrnH1kQXIH8/edit?usp=sharing">detailed tables</a>).</li>' +
      '<li>2026 poll crosstabs: <a href="https://www.pewresearch.org/politics/2026/10/08/midterm-vote-preferences-by-race-and-ethnicity-age-and-other-demographics/">Pew (Oct 8)</a>, <a href="https://assets1.cbsnewsstatic.com/hub/cms/prod_cms_alt/file/2026/10/04/0957ee32-a848-4872-b659-14303d3d3734/cbsnews_20261004_sun.pdf">CBS News/YouGov</a>, <a href="https://d3nkl3psvxxpe9.cloudfront.net/documents/econTabReport_703uvs1.pdf">Economist/YouGov</a>, <a href="https://maristpoll.marist.edu/wp-content/uploads/2026/09/NPR_PBS-News_Marist-Poll_USA-NOS-and-Tables_202609171435.pdf">NPR/PBS/Marist</a>, <a href="https://static.foxnews.com/foxnews.com/content/uploads/2026/09/fox_september-11-14-2026_national_cross-tabs_september-16-release.pdf">Fox News</a>, <a href="https://law.marquette.edu/assets/community/poll/MLSPSC35/MLSPSC35CrosstabsRV.html">Marquette</a>.</li>' +
      '<li>Generic-ballot polls: ElectIndex\'s poll file (compiled from public polls). For comparison: <a href="https://www.natesilver.net/p/generic-ballot-average-2026-nate-silver-bulletin-congress-polls">Silver Bulletin</a>, <a href="https://www.realclearpolling.com/polls/state-of-the-union/generic-congressional-vote">RealClearPolling</a>, <a href="https://fiftyplusone.news/polls/generic-ballot/generic-ballot">FiftyPlusOne</a>.</li>' +
      '<li>Turnout and early vote: <a href="https://election.lab.ufl.edu/early-vote/2026-early-voting/">UF Election Lab</a> (2026 early vote; 2018, 2022, 2024 turnout); <a href="https://www.cnn.com/2026/10/01/politics/cnn-early-voting-takeaways-democratic-advantage">CNN/Catalist</a>; <a href="https://www.nbcnews.com/politics/2026-election/early-vote-analysis-mail-ballot-concerns-are-changing-democrats-vote-rcna602489">NBC News/UPenn</a>; state election offices.</li>' +
      '<li>The <a href="https://claude.ai/artifact/Ufk6JJSqNJdLXQPaBJQeXu">Oct 9 Senate polling model</a> (private link).</li>' +
      '</ul>';
  }

  // ---------------------------------------------------------------- render all
  function render() {
    document.querySelectorAll('.tabs[role="tablist"] button[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === ui.tab ? 'true' : 'false'));
    $('cmChance').setAttribute('aria-pressed', ui.cmode === 'chance' ? 'true' : 'false');
    $('cmMargin').setAttribute('aria-pressed', ui.cmode === 'margin' ? 'true' : 'false');
    $('search').placeholder = ui.tab === 'house' ? 'Find a district or candidate' : 'Find a state or candidate';
    $('zoomBtn').hidden = ui.tab !== 'house';
    $('mapHint').classList.toggle('show', ui.tab === 'house');
    renderBar();
    renderSeatbar();
    renderMap();
    renderDetail();
    renderResults();
    renderTable();
    renderControls();
  }

  // ---------------------------------------------------------------- phone layout: one screen at a time, bottom tab bar
  const phoneMQ = window.matchMedia('(max-width: 760px)');
  const isTabbed = () => document.body.classList.contains('tabbed');
  const scrollPos = {};
  const envEl = document.querySelector('.env'), barInner = document.querySelector('.bar-inner');
  function showScreen(s, push) {
    if (SCREENS.indexOf(s) < 0) s = 'map';
    const tabbed = isTabbed(), changed = ui.screen !== s;
    if (tabbed && changed) scrollPos[ui.screen] = window.scrollY;
    ui.screen = s; saveUi();
    document.querySelectorAll('[data-screen]').forEach((el) => el.classList.toggle('on', el.dataset.screen === s));
    document.querySelectorAll('[data-go]').forEach((b) => { if (b.dataset.go === s) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (!tabbed) return;
    if (push && changed) { try { history.pushState({ screen: s }, '', '#/' + s); } catch (e) { /* ignore */ } }
    tip.hidden = true;
    window.scrollTo(0, scrollPos[s] || 0);
    // charts size themselves to their container, which has no width while its screen is hidden
    if (s === 'outlook' && R) renderResults();
    if (s === 'early') drawEvCharts();
  }
  function applyLayout() {
    const tabbed = phoneMQ.matches;
    document.body.classList.toggle('tabbed', tabbed);
    if (tabbed) { if (envEl.parentNode !== $('dockEnv')) $('dockEnv').appendChild(envEl); }
    else if (envEl.parentNode !== barInner) barInner.insertBefore(envEl, barInner.firstChild);
    if (tabbed) showScreen(ui.screen, false); else resetZoom();
    setBarH();
    if (R) { renderResults(); drawEvCharts(); }
  }
  function wireScreens() {
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      if (ui.screen === b.dataset.go) window.scrollTo({ top: 0, behavior: 'smooth' });
      else showScreen(b.dataset.go, true);
    }));
    window.addEventListener('popstate', () => {
      if (!isTabbed()) return;
      const h = location.hash.replace(/^#\/?/, '');
      showScreen(SCREENS.indexOf(h) >= 0 ? h : 'map', false);
    });
    const evLink = document.querySelector('a[href="#early-vote"]');
    if (evLink) evLink.addEventListener('click', (e) => { if (isTabbed()) { e.preventDefault(); showScreen('early', true); } });
    // hide the dock while the on-screen keyboard is up
    document.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('input[type="search"]')) document.body.classList.add('kbd'); });
    document.addEventListener('focusout', () => document.body.classList.remove('kbd'));
    const dock = $('dock');
    const setDockH = () => document.documentElement.style.setProperty('--dock-h', Math.round(dock.getBoundingClientRect().height) + 'px');
    if (window.ResizeObserver) new ResizeObserver(setDockH).observe(dock);
    setDockH();
    if (phoneMQ.addEventListener) phoneMQ.addEventListener('change', applyLayout); else if (phoneMQ.addListener) phoneMQ.addListener(applyLayout);
    const h0 = location.hash.replace(/^#\/?/, '');
    if (SCREENS.indexOf(h0) >= 0) ui.screen = h0;
  }

  // ---------------------------------------------------------------- boot
  const bar = document.querySelector('.bar');
  const setBarH = () => document.documentElement.style.setProperty('--bar-h', Math.round(bar.getBoundingClientRect().height) + 'px');
  if (window.ResizeObserver) new ResizeObserver(setBarH).observe(bar);
  setBarH();
  let rsz = null;
  window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { drawEvCharts(); if (R) renderResults(); }, 150); });
  buildPresets();
  buildPatterns();
  buildXtabs();
  wireControls();
  wireMap();
  wireScreens();
  buildMethod();
  R = M.simulate(sc);
  buildEarlyVote();
  applyLayout();
  render();
  showFreshness(D);
  }

  // ---------------------------------------------------------------- dates and freshness (outside startApp)
  const ET = 'America/New_York';
  function fmtDay(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function fmtStamp(iso) {
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ET }) + ' ET';
  }
  function daysToElection() {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [y, m, d] = p.split('-').map(Number);
    return Math.round((Date.UTC(2026, 10, 3) - Date.UTC(y, m - 1, d)) / 86400000);
  }
  function showFreshness(D) {
    const meta = D.meta || {};
    const days = daysToElection();
    const dayText = days > 1 ? days + ' days to Election Day' : days === 1 ? 'Election Day is tomorrow' : days === 0 ? 'Election Day' : 'after Election Day';
    const shortDays = days > 1 ? days + ' days to go' : dayText;
    const shortStamp = meta.generated ? new Date(meta.generated).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: ET }) + ' ET' : 'recently';
    document.getElementById('eyebrow').innerHTML = '<span class="xl">2026 midterms · </span>updated <span class="xl">' + (meta.generated ? fmtStamp(meta.generated) : 'recently') + '</span><span class="xs">' + shortStamp + '</span> · <span class="xl">' + dayText + '</span><span class="xs">' + shortDays + '</span>';
    const chip = document.getElementById('staleChip');
    const labels = { early_vote: 'Early-vote counts', electindex: 'Polls and candidates', generic_ballot: 'National polling average' };
    const stale = Object.keys(meta.sources || {}).filter((k) => !meta.sources[k].ok);
    const ageH = meta.generated ? (Date.now() - new Date(meta.generated).getTime()) / 3600000 : 0;
    if (ageH > 36) { chip.textContent = 'Not updated since ' + fmtStamp(meta.generated); chip.hidden = false; }
    else if (stale.length) {
      const k = stale[0], lo = meta.sources[k].last_ok;
      chip.textContent = labels[k] + ' didn\'t refresh' + (lo ? '; last good ' + fmtStamp(lo) : '');
      chip.title = stale.map((x) => labels[x] + ': ' + meta.sources[x].detail).join('\n');
      chip.hidden = false;
    }
  }
  // check for newer numbers when the app comes back to the foreground, and every 30 minutes while open
  function watchForUpdates(current) {
    let lastCheck = Date.now();
    const check = () => {
      lastCheck = Date.now();
      fetch('data.json?check=' + Date.now(), { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((d) => {
        if (!d || !d.meta || !current.meta || d.meta.generated === current.meta.generated) return;
        document.getElementById('bannerText').textContent = 'New numbers are in (updated ' + fmtStamp(d.meta.generated) + ').';
        document.getElementById('banner').hidden = false;
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > 10 * 60000) check(); });
    setInterval(check, 30 * 60000);
    document.getElementById('bannerBtn').addEventListener('click', () => location.reload());
  }

  fetch('data.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((data) => {
      document.getElementById('loading').remove();
      startApp(data);
      watchForUpdates(data);
    })
    .catch(() => {
      const el = document.getElementById('loading');
      el.innerHTML = '<b>Couldn\'t load the numbers</b>Check your connection and reload. Once the app has loaded once, it also works offline.';
    });
})();
