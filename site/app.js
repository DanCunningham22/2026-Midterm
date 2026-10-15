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
  const SCREENS = ['map', 'outlook', 'races', 'adjust', 'early', 'watch'];
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
  // The first ovals are the two starting points: our forecast (the backtested blend, data.indep) and the polls alone.
  // Every setting at its default for that basis; the early vote is included in both.
  const HAS_OURS = M.hasIndep;
  const natAt = (s) => M.national(s) + M.evShift(s);
  const FORECAST_NAT = natAt(M.defaults);
  const POLLS_NAT = natAt(M.defaultsPolls);
  const PRESETS = [
    { k: 'forecast', label: (HAS_OURS ? 'Our forecast ' : 'Forecast ') + fm(FORECAST_NAT), v: null },
  ].concat(HAS_OURS ? [{ k: 'polls', label: 'Polls only ' + fm(POLLS_NAT), v: null }] : []).concat([
    { k: 'd4', label: 'D+4', v: 4 },
    { k: 'd9', label: 'D+9', v: 9 },
    { k: 'specials', label: 'Specials pace D+11', v: 11 },
    { k: 'even', label: 'Even', v: 0 },
    { k: 'r22', label: '2022 rerun R+2.8', v: -2.8 },
  ]);
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

  // ---------------------------------------------------------------- the forecast (default settings)
  let R0 = null, R0p = null;   // the forecast's simulation (and the polls-only one), kept to show next to any scenario
  function atDefaults(d) {
    if (M.basis(sc) !== M.basis(d)) return false;
    if (Math.abs(M.national(sc) - M.national(d)) > 0.05) return false;
    if (sc.T !== d.T || sc.edge !== d.edge || sc.evw !== d.evw || sc.sigN !== d.sigN || sc.cand !== d.cand || (sc.demo !== false) !== (d.demo !== false)) return false;
    return ['race', 'age', 'gender'].every((dim) => d.dev[dim].every((v, i) => Math.abs(sc.dev[dim][i] - v) < 0.05 && Math.abs(sc.mult[dim][i] - d.mult[dim][i]) < 0.001));
  }
  const atForecast = () => atDefaults(M.defaults);
  const atPolls = () => HAS_OURS && atDefaults(M.defaultsPolls);
  const titlePrefix = () => (atForecast() ? '' : atPolls() ? 'Polls only: ' : 'Your scenario: ');
  function resetToForecast() { sc = M.clone(M.defaults); ui.pattern = 'blend'; buildXtabs(); update(); }
  function showPollsOnly() { sc = M.clone(M.defaultsPolls); ui.pattern = 'blend'; buildXtabs(); update(); }
  function renderForecastCard() {
    if (!R0) R0 = M.simulate(M.clone(M.defaults));
    if (HAS_OURS && !R0p) R0p = M.simulate(M.clone(M.defaultsPolls));
    const rv = rView(), P = rv ? 'R' : 'D', cls = rv ? 'r' : 'd';
    const pick = (X) => ({
      hc: rv ? X.house.r.control : X.house.control, sc: rv ? X.senate.rcontrol : X.senate.control, gc: rv ? X.gov.r.control : X.gov.maj,
      h: rv ? X.house.r.mean : X.house.mean, s: rv ? X.senate.r.mean : X.senate.mean, g: rv ? X.gov.r.mean : X.gov.mean,
    });
    const o = pick(R0), q = R0p ? pick(R0p) : null;
    const item = (lab, p, sub, pp, psub) => '<div class="fc-item"><span class="fc-lab">' + lab + '</span><span class="fc-v ' + cls + '">' + P + ' ' + fp(p) + '</span><span class="fc-sub">' + sub + '</span>' +
      (pp != null ? '<span class="fc-polls">Polls alone: ' + P + ' ' + fp(pp) + ', ' + psub + '</span>' : '') + '</div>';
    const on = atForecast(), onP = atPolls();
    const stamp = D.meta && D.meta.generated ? ' · updated ' + fmtStamp(D.meta.generated) : '';
    const head = HAS_OURS
      ? '<span class="fc-k">Our forecast</span><span class="fc-s">national House vote ' + fm(FORECAST_NAT) + ' (±' + D.indep.sig.toFixed(1) + '); the polls alone say ' + fm(POLLS_NAT) + stamp + '</span>'
      : '<span class="fc-k">Today\'s forecast</span><span class="fc-s">polls plus early vote, national vote ' + fm(FORECAST_NAT) + stamp + '</span>';
    const back = '<button class="fc-back" id="fcBack">Back to ' + (HAS_OURS ? 'our forecast' : 'the forecast') + '</button>';
    const note = on
      ? (HAS_OURS ? 'The polls, corrected by how they\'ve done in past midterms and weighed against special elections, approval and last year\'s governor races. <a href="#backtest">How it\'s built, and how it would have done since 1998</a>. Change anything and the map and charts show your own scenario.'
        : 'You\'re looking at the forecast: the model with every setting at its default. Change anything and the map and charts show your own scenario.')
      : onP ? 'The map and charts below show <b>the polls alone</b>, without our corrections. ' + back
        : 'The map and charts below show <b>your scenario</b>, not ' + (HAS_OURS ? 'our' : 'the') + ' forecast. ' + back;
    $('fcCard').innerHTML = '<div class="fc-head">' + head + '</div>' +
      '<div class="fc-grid">' + item('House majority', o.hc, Math.round(o.h) + ' seats on average', q && q.hc, q && Math.round(q.h) + ' seats') +
      item('Senate control', o.sc, o.s.toFixed(1) + ' seats on average', q && q.sc, q && q.s.toFixed(1)) +
      item('26+ governors', o.gc, o.g.toFixed(1) + ' governors on average', q && q.gc, q && q.g.toFixed(1)) + '</div>' +
      '<p class="fc-note">' + note + '</p>';
    const b = $('fcBack'); if (b) b.addEventListener('click', resetToForecast);
  }

  // ---------------------------------------------------------------- how the forecast has moved (daily record from pipeline/fc_trend.js)
  function renderTrend() {
    const box = $('fcTrend');
    const H = (D.fc_hist || []).filter((h) => h.polls);
    if (!box) return;
    if (H.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    const last = H[H.length - 1], prev = H[H.length - 2];
    const firstOurs = H.find((h) => h.ours) || null;
    const pick = (h) => h.ours || h.polls;
    const W = Math.round(Math.max(290, Math.min(560, (box.clientWidth || 900) / 2 - 20))), HT = 150, L = 40, R = 14, T = 12, B = 24;
    const x = (i) => L + (H.length === 1 ? 0 : i / (H.length - 1)) * (W - L - R);
    const axisDates = (yy) => {
      let t = '';
      const step = Math.max(1, Math.ceil(H.length / 6));
      H.forEach((h, i) => { if (i % step === 0 || i === H.length - 1) t += '<text class="axis" x="' + x(i).toFixed(1) + '" y="' + (yy + 16) + '" text-anchor="' + (i === 0 ? 'start' : i === H.length - 1 ? 'end' : 'middle') + '">' + fmtDay(h.date) + '</text>'; });
      return '<g class="axis">' + t + '</g>';
    };
    const line = (vals, col, w, dash) => {
      const pts = vals.map((v, i) => (v == null ? null : [x(i), v])).filter(Boolean);
      return pts.length ? '<polyline fill="none" stroke="' + col + '" stroke-width="' + w + '"' + (dash ? ' stroke-dasharray="4 3"' : '') + ' stroke-linejoin="round" points="' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>' : '';
    };
    // national vote: ours and the polls
    const natO = H.map((h) => (h.nat != null ? h.nat : null)), natP = H.map((h) => h.G0);
    const allN = natO.concat(natP).filter((v) => v != null);
    let nmin = Math.floor(Math.min(...allN) - 1.5), nmax = Math.ceil(Math.max(...allN) + 1.5);
    const yN = (v) => T + (nmax - v) / (nmax - nmin) * (HT - T - B);
    let s1 = '<g class="axis">';
    for (let g = nmin; g <= nmax; g += (nmax - nmin > 8 ? 2 : 1)) s1 += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + yN(g).toFixed(1) + '" y2="' + yN(g).toFixed(1) + '"/><text x="' + (L - 5) + '" y="' + (yN(g) + 4).toFixed(1) + '" text-anchor="end">' + (g === 0 ? 'Even' : (g > 0 ? 'D+' : 'R+') + Math.abs(g)) + '</text>';
    s1 += '</g>' + axisDates(HT - B);
    s1 += line(natP.map((v) => (v == null ? null : yN(v))), 'var(--ink-3)', 1.6, true) + line(natO.map((v) => (v == null ? null : yN(v))), 'var(--mark)', 2.5, false);
    H.forEach((h, i) => {
      if (h.G0 != null) s1 += '<circle cx="' + x(i).toFixed(1) + '" cy="' + yN(h.G0).toFixed(1) + '" r="2.6" fill="var(--ink-3)"><title>' + fmtDay(h.date) + ' polls: ' + fm(h.G0) + '</title></circle>';
      if (h.nat != null) s1 += '<circle cx="' + x(i).toFixed(1) + '" cy="' + yN(h.nat).toFixed(1) + '" r="3.4" fill="var(--mark)"><title>' + fmtDay(h.date) + ' our forecast: ' + fm(h.nat) + '</title></circle>';
    });
    const lab = (vals, col, text) => { const i = vals.length - 1; return vals[i] == null ? '' : '<text class="ev-val" x="' + (x(i) - 4).toFixed(1) + '" y="' + (yN(vals[i]) - 7).toFixed(1) + '" text-anchor="end" style="fill:' + col + ';font-weight:700">' + text + ' ' + fm(vals[i]) + '</text>'; };
    s1 += lab(natP, 'var(--ink-3)', 'Polls') + lab(natO, 'var(--mark)', 'Ours');
    // odds
    const series = [['House', (h) => pick(h).hp, 'var(--mark)'], ['Senate', (h) => pick(h).sp, 'var(--ink)'], ['Governors 26+', (h) => pick(h).gp, 'var(--ink-3)']];
    const yP = (p) => T + (1 - p) * (HT - T - B);
    let s2 = '<g class="axis">';
    [0, 0.25, 0.5, 0.75, 1].forEach((g) => { s2 += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + yP(g).toFixed(1) + '" y2="' + yP(g).toFixed(1) + '"/><text x="' + (L - 5) + '" y="' + (yP(g) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(g * 100) + '%</text>'; });
    s2 += '</g>' + axisDates(HT - B);
    series.forEach(([name, f, col]) => {
      const vals = H.map((h) => f(h));
      s2 += line(vals.map(yP), col, name === 'House' ? 2.5 : 1.8, false);
      vals.forEach((v, i) => { s2 += '<circle cx="' + x(i).toFixed(1) + '" cy="' + yP(v).toFixed(1) + '" r="2.8" fill="' + col + '"><title>' + fmtDay(H[i].date) + ' ' + name + ': ' + Math.round(v * 100) + '% D' + (H[i].ours ? '' : ' (polls only)') + '</title></circle>'; });
      const li = vals.length - 1;
      s2 += '<text class="ev-val" x="' + (x(li) - 4).toFixed(1) + '" y="' + (yP(vals[li]) + (name === 'House' ? -7 : name === 'Senate' ? 13 : -7)).toFixed(1) + '" text-anchor="end" style="fill:' + col + ';font-weight:700">' + name + ' ' + Math.round(vals[li] * 100) + '%</text>';
    });
    // changes table
    const chg = (a, b, digits, pct) => {
      if (a == null || b == null) return '<span class="muted">—</span>';
      const d = pct ? (a - b) * 100 : a - b;
      if (Math.abs(d) < (pct ? 0.5 : 0.05)) return '<span class="muted">no change</span>';
      return '<span class="tr-chg ' + (d > 0 ? 'up' : 'dn') + '">' + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(digits) + (pct ? ' pts' : '') + '</span>';
    };
    const o = pick(last), op = pick(prev), of = firstOurs ? firstOurs.ours : null;
    const sinceLab = firstOurs && firstOurs !== last ? 'since ' + fmtDay(firstOurs.date) : null;
    const rows = [
      '<tr><td>Our forecast, national vote</td><td class="n">' + (last.nat != null ? fm(last.nat) : '—') + '</td><td class="n">' + chg(last.nat, prev.nat, 1) + '</td>' + (sinceLab ? '<td class="n colfirst">' + chg(last.nat, firstOurs.nat, 1) + '</td>' : '') + '</tr>',
      '<tr><td>Polls, national vote</td><td class="n">' + fm(last.G0) + '</td><td class="n">' + chg(last.G0, prev.G0, 1) + '</td>' + (sinceLab ? '<td class="n colfirst">' + chg(last.G0, firstOurs.G0, 1) + '</td>' : '') + '</tr>',
      '<tr><td>House: D seats · majority</td><td class="n">' + o.house.toFixed(0) + ' · ' + Math.round(o.hp * 100) + '%</td><td class="n">' + chg(o.house, op.house, 1) + ' · ' + chg(o.hp, op.hp, 0, true) + '</td>' + (sinceLab ? '<td class="n colfirst">' + chg(o.house, of.house, 1) + ' · ' + chg(o.hp, of.hp, 0, true) + '</td>' : '') + '</tr>',
      '<tr><td>Senate: D seats · control</td><td class="n">' + o.senate.toFixed(1) + ' · ' + Math.round(o.sp * 100) + '%</td><td class="n">' + chg(o.senate, op.senate, 1) + ' · ' + chg(o.sp, op.sp, 0, true) + '</td>' + (sinceLab ? '<td class="n colfirst">' + chg(o.senate, of.senate, 1) + ' · ' + chg(o.sp, of.sp, 0, true) + '</td>' : '') + '</tr>',
      '<tr><td>Governors: D · 26+</td><td class="n">' + o.gov.toFixed(1) + ' · ' + Math.round(o.gp * 100) + '%</td><td class="n">' + chg(o.gov, op.gov, 1) + ' · ' + chg(o.gp, op.gp, 0, true) + '</td>' + (sinceLab ? '<td class="n colfirst">' + chg(o.gov, of.gov, 1) + ' · ' + chg(o.gp, of.gp, 0, true) + '</td>' : '') + '</tr>',
      '<tr><td>Ballots counted (UF)</td><td class="n">' + (last.ev ? (last.ev / 1e6).toFixed(2) + 'M' : '—') + '</td><td class="n">' + (last.ev && prev.ev ? '+' + ((last.ev - prev.ev) / 1e6).toFixed(2) + 'M' : '—') + '</td>' + (sinceLab ? '<td class="n colfirst">' + (last.ev && firstOurs.ev ? '+' + ((last.ev - firstOurs.ev) / 1e6).toFixed(2) + 'M' : '—') + '</td>' : '') + '</tr>',
    ].join('');
    // race movers: Democratic chance, our forecast
    const names = {}; (D.senate || []).forEach((r) => { names[r.id] = r; }); (D.gov || []).forEach((r) => { names[r.id] = r; });
    const movers = (a, b) => {
      if (!a || !b) return [];
      const out = [];
      ['sen', 'govp'].forEach((k) => Object.keys(a[k] || {}).forEach((id) => { if (b[k] && b[k][id] != null) out.push({ id, now: a[k][id], was: b[k][id], d: a[k][id] - b[k][id] }); }));
      return out.filter((m) => Math.abs(m.d) >= 0.02).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 5);
    };
    const mv = (list) => list.length ? list.map((m) => { const r = names[m.id] || {}; return '<b>' + m.id + '</b> ' + (r.dn ? esc(lastName(r.dn)) + ' vs. ' + esc(lastName(r.rn)) + ': ' : '') + Math.round(m.was * 100) + '% → ' + Math.round(m.now * 100) + '% D'; }).join('; ') : 'no race moved 2 points or more';
    const mvDay = movers(last.ours, prev.ours), mvAll = of && firstOurs !== last ? movers(last.ours, of) : [];
    box.innerHTML = '<h3>How the forecast has moved <span class="auto-tag">one point a day</span></h3>' +
      '<div class="tr-grid"><div><div class="chart" id="trNat"><svg viewBox="0 0 ' + W + ' ' + HT + '" role="img" aria-label="National House vote by day: our forecast and the polls">' + s1 + '</svg></div><p class="chart-cap">National House vote by day: our forecast (gold) and the polling average (gray, dashed).</p></div>' +
      '<div><div class="chart" id="trOdds"><svg viewBox="0 0 ' + W + ' ' + HT + '" role="img" aria-label="Chance of a Democratic House majority, Senate control and 26 or more governors, by day">' + s2 + '</svg></div><p class="chart-cap">Democratic chances by day, our forecast' + (H.some((h) => !h.ours) ? ' (polls only before Oct 13, when our forecast started)' : '') + '.</p></div></div>' +
      '<div class="table-scroll"><table class="nc-table"><thead><tr><th>' + fmtDay(last.date) + '</th><th class="n">Now</th><th class="n">Since ' + fmtDay(prev.date) + '</th>' + (sinceLab ? '<th class="n colfirst">' + sinceLab.charAt(0).toUpperCase() + sinceLab.slice(1) + '</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="small" style="margin:8px 0 0"><b>Races that moved since ' + fmtDay(prev.date) + ':</b> ' + mv(mvDay) + '.' + (mvAll.length ? ' <b>Since ' + fmtDay(firstOurs.date) + ':</b> ' + mv(mvAll) + '.' : '') + '</p>' +
      '<p class="chart-cap">Recorded by the update job after each day\'s last run, with every setting at its default; earlier days re-run today\'s model on that day\'s inputs. Odds move with the polls and the early vote, not with anything you change on this page.</p>';
  }

  // ---------------------------------------------------------------- scenario bar
  function buildPresets() {
    const box = $('presets');
    box.innerHTML = PRESETS.map((p) => '<button class="oval" role="radio" aria-checked="false" data-k="' + p.k + '">' + esc(p.label) + '</button>').join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.oval'); if (!b) return;
      const p = PRESETS.find((x) => x.k === b.dataset.k);
      if (p.k === 'forecast') { resetToForecast(); return; }
      if (p.k === 'polls') { showPollsOnly(); return; }
      sc.C = M.solveC(sc, p.v);
      update();
    });
  }
  function renderBar() {
    const nat = M.national(sc);
    const eff = R.m.national;
    // left is Democratic, right is Republican: the slider holds the negated margin
    $('env').value = (-nat).toFixed(1);
    $('env').setAttribute('aria-valuetext', fm(nat));
    $('envOut').textContent = fm(eff);
    $('envOut').className = 'env-value num ' + (eff > 0.05 ? 'd' : eff < -0.05 ? 'r' : '');
    document.querySelectorAll('#presets .oval').forEach((b) => {
      const p = PRESETS.find((x) => x.k === b.dataset.k);
      b.setAttribute('aria-checked', (p.k === 'forecast' ? atForecast() : p.k === 'polls' ? atPolls() : Math.abs(nat - p.v) < 0.05) ? 'true' : 'false');
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
    // Democrats fill from the left and Republicans from the right in both views; the line marks what the viewed side needs
    const segs = [['dfix', fixedD], ['sd', counts.sd], ['ld', counts.ld], ['nd', counts.nd], ['tu', counts.tu], ['nr', counts.nr], ['lr', counts.lr], ['sr', counts.sr], ['rfix', fixedR]];
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
    const at = rv ? total - need : need;   // the Republican threshold is counted from the right end
    const mx = at / total * W;
    h += '<line x1="' + mx.toFixed(1) + '" x2="' + mx.toFixed(1) + '" y1="0" y2="24" class="maj-line"/>';
    $('seatbar').innerHTML = '<svg viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">' + h + '</svg>' +
      '<div class="seat-need" style="left:' + (at / total * 100).toFixed(2) + '%">' + needLab + '</div>';
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
  // Senate and governor races: our forecast's starting margin next to the polls' (data.indep)
  function oursInfo(t, r) {
    if (!HAS_OURS || t === 'house') return null;
    const I = D.indep, v = I[t === 'senate' ? 'senate' : 'gov'][r.id];
    const kept = (I.kept || []).find((k) => k.id === r.id);
    return { kept: kept ? kept.why : null, ours: v == null ? r.base : v, polls: r.base, a: t === 'senate' ? I.a_sen : I.a_gov, fund: r.src === 'fundamentals' };
  }
  function oursText(t, r) {
    const x = oursInfo(t, r);
    if (!x) return '';
    if (x.kept) return 'Our forecast keeps the polls here: ' + esc(x.kept) + '.';
    if (x.fund) return 'Our forecast moves it with our national vote, to ' + fm(x.ours) + '.';
    return 'Our forecast blends this with the state\'s lean plus our national vote (' + Math.round(x.a * 100) + '/' + Math.round((1 - x.a) * 100) +
      ', the mix that best predicted past ' + (t === 'senate' ? 'Senate' : 'governor') + ' races; <a href="#backtest">backtest</a>), which ' +
      (Math.abs(x.ours - x.polls) < 0.05 ? 'leaves it at ' : 'moves it to ') + fm(x.ours) + '.';
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
      const mw = sc.demo !== false ? movesWith(i) : [];
      if (mw.length) parts.push('Moves most with: ' + mw.map((x) => '<a href="#" data-sel="' + x.j + '">' + x.id + '</a>').join(', ') + ' (shared state and voter mix).');
      extra = '<p class="note">' + parts.join(' ') + '</p><div><span class="tally-k">Estimated electorate (race and education)</span>' + compBar(r.race) + '</div>' + moneyHtml(r);
    } else {
      facts += '<div><dt>2024 president</dt><dd>' + fm(r.m24) + '</dd></div>';
      const ox = oursInfo(t, r);
      if (ox && !ox.kept && !ox.fund) {
        facts += M.basis(sc) === 'ours' ? '<div><dt>Polls alone</dt><dd>' + fm(ox.polls) + '</dd></div>' : '<div><dt>Our forecast</dt><dd>' + fm(ox.ours) + '</dd></div>';
      }
      const parts = [];
      if (t === 'senate') {
        if (r.src === 'oct9') parts.push('Starts from the Oct 9 Senate model\'s corrected polling average, ' + fm(r.base - (r.drift || 0)) + ' (model chance then ' + r.p9 + '%)' +
          (Math.abs(r.drift || 0) >= 0.05 ? ', moved ' + (r.drift > 0 ? '+' : '−') + Math.abs(r.drift).toFixed(1) + ' by polls released since then, to ' + fm(r.base) + '.' : '. New polls since then haven\'t moved it.'));
        else if (r.src === 'polls-3way') parts.push('Starts from its three-way polls, ' + fm(r.base) + '.');
        else parts.push('Not in the Oct 9 Senate model\'s competitive set; starts from fundamentals, ' + fm(r.base) + '.');
        if (r.recent && r.recent.length) parts.push('Polls since Oct 9 (some may already be in the Oct 9 average): ' + r.recent.map((x) => esc(x[0]) + ', ' + x[1] + ': ' + esc(x[2])).join('; ') + '.');
      } else {
        if (r.src === 'polls') parts.push('Starts from a weighted average of ' + r.npolls + ' public poll' + (r.npolls === 1 ? '' : 's') + ' since late July, ' + fm(r.base) + '. Latest: ' + r.latest.slice(0, 3).map((x) => esc(x.p) + ' ' + x.d + '–' + x.r + ' (' + x.end.slice(5) + (x.lean ? ', ' + x.lean + '-leaning' : '') + ')').join('; ') + '.');
        else parts.push('No recent public polls; starts from fundamentals, ' + fm(r.base) + '.');
      }
      const ot = oursText(t, r);
      if (ot) parts.push(ot);
      if (r.note) parts.push(esc(r.note));
      extra = '<p class="note">' + parts.join(' ') + '</p>' + (t === 'senate' ? moneyHtml(r) : '');
    }
    box.innerHTML = '<div class="detail-top"><span class="detail-title">' + esc(r.id) + ' · ' + esc(raceName(t, r)) + '</span><span class="pill ' + rt.k + '">' + rt.t + '</span></div>' +
      '<div class="matchup">' + matchup(t, r, true) + '</div><dl class="facts">' + facts + '</dl>' + extra;
    box.querySelectorAll('a[data-sel]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); select(+a.dataset.sel); if (isTabbed()) centerOn(+a.dataset.sel); }));
  }
  // Contested districts whose simulated results correlate most with district i: national error is shared by all,
  // so the ranking comes from sharing a state and from similar electorates (the demographic errors).
  function movesWith(i) {
    const d = D.districts[i];
    if (d.unc) return [];
    const S = M.SIG, demo = sc.demo !== false, sS = demo ? 1.9 : S.state, sN2 = sc.sigN * sc.sigN;
    const coef = (x) => demo ? M.demoCoef(sc, x.race, x.age) : null;
    const ci = coef(d);
    const vi = sN2 + sS * sS + S.house * S.house + (ci ? M.demoSD(ci) ** 2 : 0);
    const out = [];
    D.districts.forEach((x, j) => {
      if (j === i || x.unc || Math.abs(R.m.house[j]) > 12) return;
      const cj = coef(x);
      let cov = sN2 + (x.st === d.st ? sS * sS : 0);
      if (ci) for (let g = 0; g < 9; g++) cov += ci[g] * cj[g];
      const vj = sN2 + sS * sS + S.house * S.house + (cj ? M.demoSD(cj) ** 2 : 0);
      out.push({ j, id: x.id, c: cov / Math.sqrt(vi * vj) });
    });
    return out.sort((a, b) => b.c - a.c).slice(0, 5);
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
      $('resTitle').textContent = titlePrefix() + 'House outlook';
      head = 'Republicans win <b class="r">' + Math.round(h.mean) + '</b> seats on average (80% of simulations: ' + h.lo + '–' + h.hi + '). ' +
        'Chance of a Republican majority: <b>' + fp(h.control) + '</b>. ' + tipTextR(tipH, 'House');
      drawHist(h.hist, 135, 260, 218, 'Republican seats', 'R');
      $('histCap').textContent = R.n.toLocaleString() + ' simulations. Red bars are Republican majorities.';
    } else if (t === 'senate') {
      const s = R.senate;
      $('resTitle').textContent = titlePrefix() + 'Senate outlook';
      head = 'Republicans hold <b class="r">' + s.r.mean.toFixed(1) + '</b> seats on average, including 31 not up (80%: ' + s.r.lo + '–' + s.r.hi + '). ' +
        'Republican control <b>' + fp(s.rcontrol) + '</b>, Democratic control <b>' + fp(s.control) + '</b>, Osborn decides <b>' + fp(s.osborn) + '</b>. ' + tipTextR(tipS, 'Senate');
      drawHist(s.r.hist, 40, 58, 50, 'Republican seats', 'R');
      $('histCap').textContent = 'Republicans need 50 seats, since VP Vance breaks ties. Osborn (NE) counts for neither party. Red bars are Republican control.';
    } else {
      const g = R.gov.r;
      $('resTitle').textContent = titlePrefix() + 'Governors outlook';
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
      $('resTitle').textContent = titlePrefix() + 'House outlook';
      head = 'Democrats win <b class="d">' + Math.round(h.mean) + '</b> seats on average (80% of simulations: ' + h.lo + '–' + h.hi + '). ' +
        'Chance of a Democratic majority: <b>' + fp(h.control) + '</b>. ' +
        (tipH !== null ? 'With these settings Democrats are favored for the House at <b>' + fm(tipH) + '</b> or better nationally.' : '');
      drawHist(R.house.hist, 175, 300, 218, 'Democratic seats');
      $('histCap').textContent = R.n.toLocaleString() + ' simulations. Blue bars are Democratic majorities.';
    } else if (t === 'senate') {
      const s = R.senate;
      $('resTitle').textContent = titlePrefix() + 'Senate outlook';
      head = 'Democrats hold <b class="d">' + s.mean.toFixed(1) + '</b> seats on average, including 34 not up (80%: ' + s.lo + '–' + s.hi + '). ' +
        'Democratic control <b>' + fp(s.control) + '</b>, Republican control <b>' + fp(s.rcontrol) + '</b>, Osborn decides <b>' + fp(s.osborn) + '</b>. ' +
        (tipS !== null ? 'Control tips at about <b>' + fm(tipS) + '</b> nationally.' : '');
      drawHist(R.senate.hist, 42, 60, 51, 'Democratic-caucus seats');
      $('histCap').textContent = 'Democratic caucus includes King and Sanders; Osborn (NE) is counted separately. Blue bars are Democratic control.';
    } else {
      const g = R.gov;
      $('resTitle').textContent = titlePrefix() + 'Governors outlook';
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
      // Democratic environments on the left, Republican on the right, like the sliders
      const gx = (g) => L + (gridG[gridG.length - 1] - g) / (gridG[gridG.length - 1] - gridG[0]) * (W - L - Rr);
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
    const mcol = t !== 'gov' && D.money && D.money.races;
    const ocol = HAS_OURS && t !== 'house', oursBasis = M.basis(sc) === 'ours';
    const ocell = (r) => { const x = oursInfo(t, r); return fm(oursBasis ? x.polls : x.ours); };
    $('raceTable').querySelector('thead').innerHTML = '<tr><th>Race</th><th>Matchup</th><th class="n col24">2024 pres.</th><th class="n">Projected</th><th class="n">Chance</th><th class="n colflip">Flips at</th>' +
      (ocol ? '<th class="n colpolls" title="' + (oursBasis ? 'Where the polls alone start the race, before our corrections' : 'Where our forecast starts the race') + '">' + (oursBasis ? 'Polls alone' : 'Our forecast') + '</th>' : '') +
      (mcol ? '<th class="n colmoney" title="Outside spending (independent expenditures) in the general election, FEC">Outside $</th>' : '') + '</tr>';
    const rows = idx.slice(0, limit).map((i) => {
      const r = list[i], m = raceMargin(t, i), p = raceP(t, i), f = flipPoint(t, i), rt = rating(p);
      return '<tr data-i="' + i + '"' + (ui.sel === i ? ' class="sel"' : '') + '><td class="code">' + esc(r.id) + '</td><td><span class="full">' + matchup(t, r, true) + '</span><span class="short">' + shortMatchup(t, r) + '</span></td><td class="n col24">' + fm(r.m24) +
        '</td><td class="n ' + (m > 0 ? 'd' : 'r') + '">' + fm(m) + '</td><td class="n"><span class="pill ' + rt.k + '">' + chanceText(p, r) + '</span></td><td class="n colflip">' + (f === null ? '—' : fm(f)) + '</td>' +
        (ocol ? '<td class="n colpolls muted">' + ocell(r) + '</td>' : '') + (mcol ? '<td class="n colmoney">' + moneyCell(r) + '</td>' : '') + '</tr>';
    });
    $('raceTable').querySelector('tbody').innerHTML = rows.join('') || '<tr><td colspan="8" class="muted">No races match.</td></tr>';
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
        '<div class="xtab-line"><span class="lab">Margin</span><div class="slider-wrap" id="xmw' + i + '"><input type="range" id="xm-' + dim + '-' + i + '" data-i="' + i + '" class="xm" min="' + (-rg[1]) + '" max="' + (-rg[0]) + '" step="0.5" aria-label="' + l + ' margin"></div><output id="xmo' + i + '"></output></div>' +
        '<div class="xtab-line"><span class="lab">Turnout</span><div class="slider-wrap"><input type="range" id="xt-' + dim + '-' + i + '" data-i="' + i + '" class="xt" min="0.6" max="1.5" step="0.01" aria-label="' + l + ' turnout"></div><output id="xto' + i + '"></output></div></div>';
    }).join('');
    box.querySelectorAll('.xm').forEach((inp) => inp.addEventListener('input', () => {
      M.setGroupMargin(sc, ui.dim, +inp.dataset.i, -inp.value);   // negated: left is Democratic
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
  // ---------------------------------------------------------------- pollster picker
  // Each pollster's group margins are stored as gaps from its own topline; groups it doesn't publish keep the default.
  function buildPollsters() {
    const list = D.pollsters || [];
    if (!list.length) { $('pollPick').hidden = true; return; }
    $('pollsterChips').innerHTML = list.map((p) => '<button class="chip pchip" data-k="' + esc(p.k) + '" aria-pressed="false" title="' +
      esc(p.name + ', ' + p.pop + ', n=' + p.n.toLocaleString() + ', fieldwork ended ' + fmtDay(p.end) + '. Their national margin: ' + fm(p.top)) + '"><b>' + esc(p.short) + '</b> ' + esc(p.pop) +
      ' <span class="pmeta">' + (p.rating != null ? p.rating.toFixed(1) + '/3 · ' : '') + fmtDay(p.end) + '</span></button>').join('');
    $('pollsterChips').addEventListener('click', (e) => { const b = e.target.closest('.pchip'); if (b) applyPollster(b.dataset.k); });
    $('pollTop').addEventListener('change', () => {
      if (ui.pattern.indexOf('poll:') !== 0) return;
      const p = (D.pollsters || []).find((x) => 'poll:' + x.k === ui.pattern);
      sc.C = M.solveC(sc, $('pollTop').checked ? p.top : (ui.natBefore != null ? ui.natBefore : M.national(sc)));
      update();
    });
  }
  function applyPollster(k) {
    const p = (D.pollsters || []).find((x) => x.k === k); if (!p) return;
    const nat = M.national(sc);
    if (ui.pattern.indexOf('poll:') !== 0) ui.natBefore = nat;
    ['race', 'age', 'gender'].forEach((dim) => {
      const def = M.blendDev(dim);
      sc.dev[dim] = def.map((v, i) => (p.dev[dim][i] === null || p.dev[dim][i] === undefined) ? v : p.dev[dim][i]);
    });
    sc.C = M.solveC(sc, $('pollTop').checked ? p.top : nat);
    ui.pattern = 'poll:' + k;
    update();
  }
  function pollNoteText() {
    const p = (D.pollsters || []).find((x) => 'poll:' + x.k === ui.pattern);
    if (!p) return 'Each pollster\'s latest national poll: its group margins, measured against its own topline. Ratings are ElectIndex\'s pollster ratings (higher is better, out of 3); D/R-leaning pollsters aren\'t listed.';
    const miss = [];
    ['race', 'age', 'gender'].forEach((dim) => p.dev[dim].forEach((v, i) => { if ((v === null || v === undefined) && !(dim === 'race' && i === 4)) miss.push(GROUP_LABELS[dim][i]); }));
    let t = 'Loaded ' + esc(p.name) + ' (' + p.pop + ', n=' + p.n.toLocaleString() + ', ended ' + fmtDay(p.end) + '; their national margin ' + fm(p.top) + ').';
    if (miss.length) t += ' Not published, kept at the default: ' + miss.join(', ') + '.';
    if (p.approx.indexOf('WC') >= 0) t += ' They report white voters as one group, so the college/non-college gap stays at its 2024 size.';
    if (p.approx.some((a) => /\d/.test(a))) t += ' Their ten-year age groups stand in for ours (30–39 for 30–44, 50–59 for 45–64, 70+ for 65+).';
    t += ' Asian & other stays at 2024 for every pollster: the samples are too small.';
    t += ' The sliders keep their gaps between groups but use this model\'s electorate, so they can sit a few points from the poll\'s printed numbers (gold ticks).';
    return t + ' <a href="' + esc(p.url) + '" target="_blank" rel="noopener">Source</a>';
  }

  function renderControls() {
    const dim = ui.dim;
    const gm = M.groupMargins(sc, dim);
    const ns = M.natShares(sc, dim);
    const nat = M.national(sc);
    const pl = (D.pollsters || []).find((x) => 'poll:' + x.k === ui.pattern);
    $('pollKey').textContent = pl ? pl.short + '\'s own numbers' : '2026 polls';
    gm.forEach((v, i) => {
      const inp = $('xm-' + dim + '-' + i); if (!inp) return;
      if (document.activeElement !== inp) inp.value = (-v).toFixed(1);
      inp.setAttribute('aria-valuetext', fm(v));
      $('xmo' + i).textContent = fm(v);
      $('xmo' + i).className = v > 0 ? 'd' : 'r';
      $('xs' + i).textContent = Math.round(ns[i] * 100) + '% of voters';
      const t = $('xt-' + dim + '-' + i);
      if (document.activeElement !== t) t.value = sc.mult[dim][i];
      const mu = sc.mult[dim][i];
      $('xto' + i).textContent = Math.abs(mu - 1) < 0.005 ? 'Default' : (mu > 1 ? '+' : '−') + Math.round(Math.abs(mu - 1) * 100) + '%';
      const t24 = nat + D.base['2024'][dim].dev[i];
      let ticks = [[t24, '', '2024 pattern at this national margin'], [nat + D.polldev[dim][i].dev, 'poll', '2026 polls at this national margin']];
      if (pl) {   // the pollster's printed number for this group, where it published one
        const v = pl.dev[dim][i], key = D.groups[dim][i];
        ticks = ticks.slice(0, 1);
        if (v !== null && v !== undefined && pl.approx.indexOf(key) < 0) ticks.push([pl.top + v, 'poll', pl.short + '\'s own number: ' + fm(pl.top + v)]);
      }
      sliderTicks($('xmw' + i), inp, ticks.map(([tv, c, ti]) => [-tv, c, ti]));
    });
    document.querySelectorAll('#patternChips .chip').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === ui.pattern ? 'true' : 'false'));
    document.querySelectorAll('#pollsterChips .pchip').forEach((b) => b.setAttribute('aria-pressed', 'poll:' + b.dataset.k === ui.pattern ? 'true' : 'false'));
    if ($('pollNote').dataset.p !== ui.pattern) { $('pollNote').innerHTML = pollNoteText(); $('pollNote').dataset.p = ui.pattern; }
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
    const ours = M.basis(sc) === 'ours';
    $('evwHint').textContent = 'The early vote implies about ' + fm(D.evproj.median) + ' (see below), vs. ' + fm(M.target(M.basis(sc))) + (ours ? ' in our forecast' : ' in the polls') + '. At this weight it moves the national vote ' + (shift >= 0 ? '+' : '−') + Math.abs(shift).toFixed(2) + ' pts.';
    sliderTicks($('evwWrap'), $('evw'), [[M.evAuto() * 100, 'auto', 'Auto: share of expected vote already cast']]);
    $('evAuto').setAttribute('aria-pressed', sc.evw === null ? 'true' : 'false');
    $('evFace').setAttribute('aria-pressed', sc.evw === 1 ? 'true' : 'false');
    $('evOff').setAttribute('aria-pressed', sc.evw === 0 ? 'true' : 'false');
    // uncertainty
    if (document.activeElement !== $('sig')) $('sig').value = sc.sigN;
    $('sigOut').textContent = sc.sigN < 0.05 ? 'None (exact)' : '±' + sc.sigN.toFixed(1) + ' pts';
    sliderTicks($('sigWrap'), $('sig'), [[3.9, '', 'Polls only (as in the Oct 9 Senate model)']].concat(HAS_OURS ? [[D.indep.sig, '', 'Our forecast: the backtested blend misses less']] : []));
    $('cand').checked = sc.cand;
    $('demo').checked = sc.demo !== false;
  }
  function setTab(t) {
    if (ui.tab === t) return;
    ui.tab = t; ui.sel = null; ui.showAll = false; saveUi(); tip.hidden = true;
    document.querySelectorAll('.tabs[role="tablist"] button[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
    render();
  }
  function wireControls() {
    $('env').addEventListener('input', () => { sc.C = M.solveC(sc, -$('env').value); update(true); });
    $('turnout').addEventListener('input', () => { sc.T = +$('turnout').value; update(true); });
    $('edge').addEventListener('input', () => { sc.edge = +$('edge').value; update(true); });
    $('evw').addEventListener('input', () => { sc.evw = +$('evw').value / 100; update(true); });
    $('evAuto').addEventListener('click', () => { sc.evw = null; update(); });
    $('evFace').addEventListener('click', () => { sc.evw = 1; update(); });
    $('evOff').addEventListener('click', () => { sc.evw = 0; update(); });
    $('sig').addEventListener('input', () => { sc.sigN = +$('sig').value; update(true); });
    $('cand').addEventListener('change', () => { sc.cand = $('cand').checked; update(); });
    $('demo').addEventListener('change', () => { sc.demo = $('demo').checked; update(); });
    $('resetBtn').addEventListener('click', resetToForecast);
    document.querySelectorAll('#dimTabs button').forEach((b) => b.addEventListener('click', () => { ui.dim = b.dataset.dim; saveUi(); buildXtabs(); renderControls(); }));
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      setTab(b.dataset.tab);
      if (!b.classList.contains('tally-item')) return;
      if (isTabbed()) { if (ui.screen === 'adjust' || ui.screen === 'early' || ui.screen === 'watch') showScreen('map', true); }
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
      '<div class="callout"><h3>How the map uses it</h3><p class="small" style="margin:0">The comparisons below were measured when about ' + (auto * 100).toFixed(1) + '% of the expected vote was in, so the default gives them that much weight. They imply about ' + fm(D.evproj.median) + ', vs. ' + (HAS_OURS ? fm(M.target('ours')) + ' in our forecast (' + fm(D.G0) + ' in the polls)' : fm(D.G0) + ' in the polls') + ', which moves the national vote by ' + (M.evShift(M.defaults)).toFixed(2) + ' pts. Raise the weight in the controls to take them at face value. Ballot counts and the North Carolina comparison refresh every three hours; the other comparisons, the signals and the story are refreshed daily (last on ' + sinceStory + ').</p></div></div>' +
      '<div class="stats">' +
      '<div class="stat"><div class="stat-v num">' + (us.cast / 1e6).toFixed(2) + 'M</div><div class="stat-k">ballots counted in ' + us.reporting + ' states (UF Election Lab' + (us.asof_min ? ', state data as of ' + fmtDay(us.asof_min) + (us.asof_max !== us.asof_min ? '–' + fmtDay(us.asof_max) : '') : '') + ')</div></div>' +
      '<div class="stat"><div class="stat-v num">' + (pct2022 * 100).toFixed(1) + '%</div><div class="stat-k">of 2022\'s 112.0M total ballots</div></div>' +
      '<div class="stat"><div class="stat-v num">45.9M</div><div class="stat-k">people voted before Election Day in 2022, 41% of all ballots</div></div>' +
      '</div>' + signalsHtml() +
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
      ((ncPanel() || dailyPanel()) ? '<div class="ev-grid">' + ncPanel() + dailyPanel() + '</div>' : '') +
      evregPanel() +
      '<h3 style="margin-top:18px">Party registration of ballots so far</h3>' +
      '<div class="table-scroll"><table><thead><tr><th>State</th><th class="n">Ballots</th><th class="n">% of 2022</th><th>D / R / other</th><th class="n">Share D / R / other</th><th class="n">2022 final early vote D / R</th><th class="n">In-person starts</th></tr></thead><tbody>' + trows + '</tbody></table></div>' +
      '<p class="chart-cap">Registered party of voters whose ballots were accepted (UF Election Lab). The 2022 column is the final early vote, not the same point, so it is context only: early returns run more Democratic than the final early vote. Party registration is not vote choice.</p>' +
      '<h3 style="margin-top:14px">When in-person early voting opens</h3><div class="cal">' + (st.calendar || []).map((c) => '<span><b>' + c[0] + '</b> ' + c[1] + '</span>').join('') + '</div>' +
      '<p class="chart-cap">' + esc(st.calendar_note || '') + '</p>';
    drawEvCharts();
    drawEvregChart();
    const chips = $('evregChips');
    if (chips) chips.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-st]'); if (!b) return;
      ui.evregState = b.dataset.st;
      chips.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      drawEvregChart();
    });
  }

  // ---- official early vote by party registration: PA, FL, NV, CO, IA, AZ vs the same point in 2022 and 2024
  const gapTxt = (g, digits) => g == null ? '—' : '<span class="' + (g >= 0 ? 'd' : 'r') + '">' + (g >= 0 ? 'D+' : 'R+') + Math.abs(g).toFixed(digits == null ? 1 : digits) + '</span>';
  const signed = (v, digits) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(digits == null ? 1 : digits);
  const kTxt = (k) => k === 0 ? 'Election Day' : k === 1 ? '1 day out' : k + ' days out';
  function evregMeasure(st, long) {
    const m = st.m === 'ret' ? (st.st === 'IA' ? 'absentee ballots received' : 'mail ballots returned') : 'mail and in-person ballots';
    return long ? m : (st.m === 'ret' ? 'Mail' : 'Mail + in person');
  }
  function evregSignals() {
    const E = D.evreg;
    if (!E || !E.states) return [];
    const out = [];
    E.states.forEach((s) => {
      const c = s.y22;
      if (!c || c.gap == null) return;
      const big = s.all >= 300000;
      out.push({ dir: c.dgap >= 0 ? 'D' : 'R', st: s.st + ' · automatic', strength: big ? 3 : 2,
        title: s.name + '\'s ' + evregMeasure(s, true) + ' vs. the same point in 2022',
        value: 'Registered Democrats minus Republicans: ' + (s.gap >= 0 ? 'D+' : 'R+') + Math.abs(s.gap).toFixed(1) + ' now (' + s.all.toLocaleString() + ' ballots, ' + kTxt(s.k) + '), vs. ' +
          (c.gap >= 0 ? 'D+' : 'R+') + Math.abs(c.gap).toFixed(1) + ' at this point in 2022' + (s.y24 && s.y24.gap != null ? ' and ' + (s.y24.gap >= 0 ? 'D+' : 'R+') + Math.abs(s.y24.gap).toFixed(1) + ' in 2024' : '') +
          '. On the calibration that is ' + signed(c.dmargin) + ' ± ' + c.se.toFixed(1) + ' points on 2022\'s result.',
        catch: (E.notes || {})[s.st] || 'Party registration is not vote choice.',
        src: s.src + ', via UF Election Lab, as of ' + fmtDay(s.asof), url: 'https://election.lab.ufl.edu/early-vote/2026-early-voting/', aff: 'Official data, computed here' });
    });
    return out;
  }
  function evregPanel() {
    const E = D.evreg;
    if (!E || !E.states || !E.states.length) return '';
    const nat22 = E.nat && E.nat['2022'] != null ? E.nat['2022'] : -2.72, nat24 = E.nat && E.nat['2024'] != null ? E.nat['2024'] : -2.56;
    const cal = E.calib || {};
    const p22 = (E.pooled || {}).y22, p24 = (E.pooled || {}).y24;
    const withBase = E.states.filter((s) => s.y22 && s.y22.gap != null);
    let verdict;
    if (p22) verdict = '<b>Against the same point in 2022, the official files run ' + (p22.dmargin >= 0 ? 'more Democratic' : 'more Republican') + ' in ' + p22.states.join(', ') + '.</b> Pooled, the change in the gap between registered Democrats and Republicans implies a national vote about ' + Math.abs(p22.dmargin).toFixed(1) + ' points ' + (p22.dmargin >= 0 ? 'to the left of' : 'to the right of') + ' 2022\'s ' + fm(nat22) + ', about ' + fm(p22.implied_nat) + ' ± ' + p22.se.toFixed(1) + (p24 ? '; against 2024 (' + p24.states.join(', ') + ') about ' + fm(p24.implied_nat) + ' ± ' + p24.se.toFixed(1) : '') + '. The polls say ' + fm(D.G0) + '.';
    else {
      const soon = E.states.filter((s) => s.y22 && s.y22.first_k != null).map((s) => s.st + ' from ' + kTxt(s.y22.first_k)).join(', ');
      verdict = '<b>The 2026 count is still ahead of every 2022 baseline point.</b> Comparisons switch on as the calendar reaches each state\'s first archived report' + (soon ? ' (' + soon + ')' : '') + '; until then the table shows where each state stands.';
    }
    const rows = E.states.map((s) => {
      const c22 = s.y22 || {}, c24 = s.y24 || {};
      const base = (c) => c.gap == null ? '<span class="muted">' + (c.near ? 'reports at ' + c.near[0] + ' and ' + c.near[1] + ' days out only' : c.first_k != null ? 'from ' + kTxt(c.first_k) : 'none') + '</span>' : gapTxt(c.gap) + (c.all ? '<br><span class="muted small">' + Math.round(c.all).toLocaleString() + (c.exact ? '' : ' (interpolated)') + '</span>' : '');
      const imp = c22.dmargin == null ? '—' : '<b>' + signed(c22.dmargin) + '</b> ± ' + c22.se.toFixed(1) + (c22.implied_state != null ? '<br><span class="muted small">' + c22.race + ': ' + fm(c22.result) + ' → ' + fm(c22.implied_state) + '</span>' : '');
      return '<tr><td><b>' + esc(s.name) + '</b><br><span class="muted small">' + evregMeasure(s) + (s.ip_start ? ' · in person from ' + s.ip_start.slice(5).replace('-', '/') : s.st === 'PA' ? ' · no in-person early vote' : '') + '</span></td>' +
        '<td class="n">' + s.all.toLocaleString() + '<br><span class="muted small">' + fmtDay(s.asof) + ', ' + kTxt(s.k) + '</span></td>' +
        '<td class="n colpct"><span class="d">' + s.d.toFixed(1) + '</span> / <span class="r">' + s.r.toFixed(1) + '</span></td>' +
        '<td class="n">' + gapTxt(s.gap) + '</td><td class="n">' + base(c22) + '</td><td class="n">' + base(c24) + '</td>' +
        '<td class="n">' + (c22.dgap == null ? '—' : signed(c22.dgap)) + '</td><td class="n">' + imp + '</td></tr>';
    }).join('');
    const chips = E.states.map((s, i) => '<button class="chip" data-st="' + s.st + '" aria-pressed="' + String((ui.evregState || E.states[0].st) === s.st) + '">' + s.st + '</button>').join('');
    const slopeTxt = (c, lab) => c ? c.b.toFixed(2) + ' (± ' + c.se.toFixed(2) + ', scatter ' + c.resid + ' pts, ' + c.n + ' ' + lab + ')' : '';
    const calTxt = cal.all ? ('Slopes fitted on how each state\'s final early-vote gap and presidential margin moved from 2020 to 2024: ' +
      (cal.use_early && cal.early ? slopeTxt(cal.early, 'states where early ballots were most of the 2024 vote, used for Florida, Nevada, Colorado and Arizona') + '; ' : '') +
      (cal.all.assumed ? 'assumed 0.5 for other states with in-person early voting' : slopeTxt(cal.all, 'states with in-person early voting' + (cal.use_early ? ', for reference' : ''))) + '; ' +
      (cal.mail.assumed ? 'assumed 0.25 for mail-only states (too few 2020 finals to fit)' : slopeTxt(cal.mail, 'mail-only states')) + '. The ± on each row is the fit\'s scatter. Those were presidential years with a pandemic-era mail surge unwinding, which is part of why the slopes are small; read them as a floor on how much a gap change means.') : '';
    return '<div class="ev-vs"><h3>Official early vote by party registration vs. the same point in 2022 and 2024 <span class="auto-tag">updates itself</span></h3>' +
      '<p class="ev-verdict">' + verdict + '</p>' +
      '<div class="table-scroll"><table class="nc-table evreg"><thead><tr><th>State</th><th class="n">Ballots</th><th class="n colpct">D / R %</th><th class="n">D − R</th><th class="n">2022, same point</th><th class="n">2024, same point</th><th class="n">vs 2022</th><th class="n">Implied, vs 2022</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="ev-grid"><div><div class="chips" id="evregChips" style="margin:10px 0 6px">' + chips + '</div><div class="chart" id="evregChart"></div><p class="chart-cap" id="evregCap"></p></div>' +
      '<div><p class="small" style="margin-top:12px"><b>How to read it.</b> Each row is the registered-party gap among ballots the election office has accepted, measured the same number of days before Election Day as in 2022 (a midterm, so the main comparison) and 2024. "Implied" turns the change since 2022 into points of margin with a slope calibrated on history: a mail-only electorate barely moves with the national mood, so its slope is small. ' + calTxt + ' The pooled figure weights states by that uncertainty and leaves mail-only states out of the 2024 comparison, where Republicans\' 2024 shift into mail voting makes it a measure of habit rather than direction.</p>' +
      '<p class="small"><b>Sources.</b> ' + E.states.map((s) => esc(s.name) + ': ' + esc(s.src)).join('; ') + '. 2026 figures from <a href="https://election.lab.ufl.edu/early-vote/2026-early-voting/">UF Election Lab</a>\'s daily file, which compiles the official reports; the raw files are saved in the repository every run. Baselines: ' + (E.baseline_built ? 'Colorado\'s and Florida\'s archived daily reports and UF\'s archived 2024 file (built ' + fmtDay(E.baseline_built.slice(0, 10)) + '), plus ' : '') + 'dated official reports as quoted by the Nevada Independent, Bleeding Heartland (Iowa), the Philadelphia Inquirer, WVIA, PhillyVoice, Patch, Floridian Press and Florida Politics.</p></div></div></div>';
  }
  function drawEvregChart() {
    const E = D.evreg, box = $('evregChart');
    if (!E || !box || !E.states.length) return;
    const st = E.states.find((s) => s.st === (ui.evregState || E.states[0].st)) || E.states[0];
    const W = Math.round(Math.max(290, Math.min(560, box.clientWidth || 460))), H = 190, L = 36, R = 40, T = 10, B = 26;
    const lines = [['2026', st.series || [], 'var(--mark)', 2.5], ['2022', (st.y22 || {}).series || [], 'var(--ink)', 1.6], ['2024', (st.y24 || {}).series || [], 'var(--ink-3)', 1.6]]
      .map(([lab, ser, col, w]) => [lab, ser.filter((p) => p[1] != null && p[0] <= 45), col, w]).filter((l) => l[1].length);
    const all = lines.flatMap((l) => l[1]);
    if (!all.length) { box.innerHTML = ''; $('evregCap').textContent = 'No series yet for ' + st.name + '.'; return; }
    const kmax = Math.max(45, ...all.map((p) => p[0]));
    let gmin = Math.min(...all.map((p) => p[1])), gmax = Math.max(...all.map((p) => p[1]));
    const pad = Math.max(2, (gmax - gmin) * 0.15); gmin = Math.floor((gmin - pad) / 5) * 5; gmax = Math.ceil((gmax + pad) / 5) * 5;
    const x = (k) => L + (kmax - k) / kmax * (W - L - R), y = (g) => T + (gmax - g) / (gmax - gmin) * (H - T - B);
    let svg = '<g class="axis">';
    for (let g = gmin; g <= gmax; g += (gmax - gmin > 30 ? 10 : 5)) svg += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '"/><text x="' + (L - 4) + '" y="' + (y(g) + 4).toFixed(1) + '" text-anchor="end">' + (g === 0 ? 'Even' : (g > 0 ? 'D+' : 'R+') + Math.abs(g)) + '</text>';
    [40, 30, 20, 10, 0].forEach((k) => { if (k <= kmax) svg += '<text x="' + x(k).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (k === 0 ? 'end' : 'middle') + '">' + (k === 0 ? 'Election Day' : k + ' days out') + '</text>'; });
    svg += '</g>';
    if (gmin < 0 && gmax > 0) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" class="maj-line"/>';
    lines.forEach(([lab, ser, col, w]) => {
      const pts = ser.slice().sort((a, b) => b[0] - a[0]);
      svg += '<polyline fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linejoin="round" points="' + pts.map((p) => x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1)).join(' ') + '"/>';
      pts.forEach((p) => { svg += '<circle cx="' + x(p[0]).toFixed(1) + '" cy="' + y(p[1]).toFixed(1) + '" r="' + (lab === '2026' ? 3.2 : 2.2) + '" fill="' + col + '"><title>' + lab + ', ' + kTxt(p[0]) + ': ' + (p[1] >= 0 ? 'D+' : 'R+') + Math.abs(p[1]).toFixed(1) + (p[2] ? ' (' + Math.round(p[2]).toLocaleString() + ' ballots)' : '') + '</title></circle>'; });
      const last = pts[pts.length - 1];
      svg += '<text class="ev-val" x="' + (x(last[0]) + 5).toFixed(1) + '" y="' + (y(last[1]) + 4).toFixed(1) + '" style="fill:' + col + ';font-weight:700">' + lab + '</text>';
    });
    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(st.name) + ': registered Democrats minus Republicans among ballots, by days before Election Day, 2026 vs 2022 and 2024">' + svg + '</svg>';
    $('evregCap').textContent = st.name + ': registered Democrats minus Republicans among ' + evregMeasure(st, true) + ', by days before Election Day. Gold: 2026. Black: 2022. Gray: 2024.' + ((E.notes || {})[st.st] ? ' ' + E.notes[st.st] : '');
  }

  // ---- North Carolina, computed every run from the State Board of Elections' files
  const pctOf = (c, f) => (c && c.all ? c[f] / c.all * 100 : null);
  const gapOf = (c) => (c && c.all ? (c.DEM - c.REP) / c.all * 100 : null);
  function ncSignals() {
    const nc = D.nc;
    if (!nc || !nc.y26 || !nc.y26.all) return [];
    const g26 = gapOf(nc.y26), inPerson = pctOf(nc.y26, 'onestop');
    const strong = nc.y26.all >= 250000;
    const out = [];
    [['y22', '2022'], ['y24', '2024']].forEach(([k, yr]) => {
      const c = nc[k]; if (!c || !c.all) return;
      const g = gapOf(c), dlt = g26 - g;
      out.push({ dir: dlt >= 0 ? 'D' : 'R', st: 'NC · automatic', strength: strong ? 3 : 2,
        title: 'North Carolina\'s ballots vs. the same point in ' + yr,
        value: 'Registered Democrats minus Republicans among accepted ballots: ' + (g26 >= 0 ? 'D+' : 'R+') + Math.abs(g26).toFixed(1) + ' now, vs. ' + (g >= 0 ? 'D+' : 'R+') + Math.abs(g).toFixed(1) + ' in ' + yr + ' (' + Math.round(nc.y26.all).toLocaleString() + ' ballots vs. ' + Math.round(c.all).toLocaleString() + ').',
        catch: inPerson < 10 ? 'Mail ballots only so far, and Democrats have moved from mail to in person; in-person voting from Oct 15 will reshape this.'
          : 'Party registration isn\'t vote choice, and unaffiliated voters (' + pctOf(nc.y26, 'UNA').toFixed(0) + '% of ballots) decide North Carolina.',
        src: 'NC State Board of Elections files, through ' + fmtDay(nc.asof), url: 'https://www.ncsbe.gov/results-data/absentee-data', aff: 'Official data, computed here' });
    });
    return out;
  }
  function ncPanel() {
    const nc = D.nc;
    if (!nc || !nc.y26 || !nc.y26.all) return '';
    const cols = [['2026', nc.y26], ['2022', nc.y22], ['2024', nc.y24]].filter((c) => c[1] && c[1].all);
    const pc = (c, f) => pctOf(c, f).toFixed(1) + '%';
    const gap = (c) => { const g = gapOf(c); return '<span class="' + (g >= 0 ? 'd' : 'r') + '">' + (g >= 0 ? 'D+' : 'R+') + Math.abs(g).toFixed(1) + '</span>'; };
    const row = (lab, fn) => '<tr><td>' + lab + '</td>' + cols.map((c) => '<td class="n">' + fn(c[1]) + '</td>').join('') + '</tr>';
    return '<div><h3>North Carolina vs. the same point <span class="auto-tag">updates itself</span></h3>' +
      '<div class="table-scroll"><table class="nc-table"><thead><tr><th>' + nc.days_before + ' days out</th>' + cols.map((c) => '<th class="n">' + c[0] + '</th>').join('') + '</tr></thead><tbody>' +
      row('Ballots accepted', (c) => Math.round(c.all).toLocaleString()) + row('Registered Democrats', (c) => pc(c, 'DEM')) + row('Registered Republicans', (c) => pc(c, 'REP')) +
      row('Unaffiliated', (c) => pc(c, 'UNA')) + row('D minus R', gap) + row('Black voters', (c) => pc(c, 'black')) + row('Voted in person', (c) => pc(c, 'onestop')) +
      '</tbody></table></div><p class="chart-cap">Accepted mail and early in-person ballots through ' + fmtDay(nc.asof) + ', against the same number of days before Election Day in 2022 and 2024, from the State Board of Elections\' own files. Recomputed every three hours.</p></div>';
  }
  // ---- daily record kept by the update job
  function dailyPanel() {
    const h = D.ev_hist || [];
    if (!h.length) return '';
    const last = h[h.length - 1], prev = h.length > 1 ? h[h.length - 2] : null;
    let txt;
    if (!prev) txt = 'The daily record started ' + fmtDay(last.date) + '. From tomorrow this shows what changed since the day before: ballots added and how each state\'s party mix moved.';
    else {
      const add = last.us - prev.us;
      const movers = Object.keys(last.st).filter((k) => prev.st[k] && last.st[k][1] != null && prev.st[k][1] != null)
        .map((k) => ({ k, add: last.st[k][0] - prev.st[k][0], dd: (last.st[k][1] - last.st[k][2]) - (prev.st[k][1] - prev.st[k][2]) }))
        .filter((x) => x.add > 0).sort((a, b) => b.add - a.add).slice(0, 6);
      txt = (add >= 0 ? '+' : '−') + Math.abs(add).toLocaleString() + ' ballots since ' + fmtDay(prev.date) + '. ' +
        (movers.length ? 'Biggest gains: ' + movers.map((x) => x.k + ' +' + x.add.toLocaleString() + ' (D−R gap ' + (x.dd >= 0 ? '+' : '−') + Math.abs(x.dd).toFixed(1) + ')').join(', ') + '.' : '');
    }
    const W = 300, H = 70, n = h.length;
    let svg = '';
    if (n > 1) {
      const max = Math.max(...h.map((x) => x.us));
      const bw = W / n;
      h.forEach((x, i) => { const bh = x.us / max * (H - 14); svg += '<rect class="ev-bar-d" x="' + (i * bw + 1).toFixed(1) + '" y="' + (H - bh).toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + bh.toFixed(1) + '"><title>' + fmtDay(x.date) + ': ' + x.us.toLocaleString() + '</title></rect>'; });
      svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="display:block;width:100%;max-width:420px;height:auto" role="img" aria-label="Ballots counted by day">' + svg + '</svg>';
    }
    return '<div><h3>Day by day <span class="auto-tag">updates itself</span></h3>' + svg + '<p class="small" style="margin:6px 0 0">' + txt + '</p><p class="chart-cap">Saved by the update job every day from UF Election Lab\'s counts.</p></div>';
  }

  // early vote vs. the polls: each sourced signal, which way it points, how much weight it deserves, and its catch
  function signalsHtml() {
    const st = D.story || {}, sig = (st.signals || []).concat(ncSignals(), evregSignals());
    if (!sig.length) return '';
    const gap = D.evproj.median - D.G0;
    const verdict = Math.abs(gap) < 1.5 ? 'The early vote and the polls agree.'
      : 'The early vote runs ' + Math.abs(gap).toFixed(1) + ' points ' + (gap > 0 ? 'more Democratic' : 'more Republican') + ' than the polls.';
    const tot = { D: 0, R: 0 };
    sig.forEach((x) => { tot[x.dir] = (tot[x.dir] || 0) + (x.strength || 1); });
    const all = (tot.D + tot.R) || 1;
    const dots = (n) => '<span class="sig-dots" aria-label="strength ' + n + ' of 3">' + '●●●'.slice(0, n) + '<span class="off">' + '●●●'.slice(0, 3 - n) + '</span></span>';
    const card = (x) => '<div class="sig sig-' + x.dir.toLowerCase() + '"><div class="sig-top"><span class="sig-st">' + esc(x.st) + '</span>' + dots(Math.max(1, Math.min(3, x.strength || 1))) + '</div>' +
      '<b class="sig-title">' + esc(x.title) + '</b><p class="sig-val">' + esc(x.value) + '</p>' +
      '<p class="sig-catch"><span>The catch:</span> ' + esc(x.catch) + '</p>' +
      '<p class="sig-src">' + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.src) + '</a>' : esc(x.src)) + ' <span class="aff' + (/democratic-aligned/i.test(x.aff) ? ' dem' : /republican|conservative/i.test(x.aff) ? ' rep' : '') + '">' + esc(x.aff) + '</span></p></div>';
    const col = (dir, lab) => '<div class="sig-col"><h4 class="mini-h ' + dir.toLowerCase() + '">' + lab + '</h4>' + sig.filter((x) => x.dir === dir).sort((a, b) => (b.strength || 1) - (a.strength || 1)).map(card).join('') + '</div>';
    return '<div class="ev-vs"><h3>Early vote vs. the polls</h3>' +
      '<p class="ev-verdict"><b>' + verdict + '</b> The same-point comparisons imply about ' + fm(D.evproj.median) + '; the polls say ' + fm(D.G0) + '. ' + esc(st.signals_verdict || '') + '</p>' +
      '<div class="sig-balance" role="img" aria-label="Signals: ' + tot.D + ' points toward Democrats, ' + tot.R + ' toward Republicans"><span class="bd" style="width:' + (tot.D / all * 100).toFixed(1) + '%">Toward D · ' + tot.D + '</span><span class="br" style="width:' + (tot.R / all * 100).toFixed(1) + '%">' + tot.R + ' · Toward R</span></div>' +
      '<div class="sig-grid">' + col('D', 'Points toward Democrats') + col('R', 'Points toward Republicans') + '</div>' +
      '<p class="chart-cap">Bar: signals weighted by strength. ●●● official same-point data at scale; ●● a credible same-point comparison; ● indirect, small or vendor data. Signals as of ' + (st.signals_asof ? fmtDay(st.signals_asof) : '—') + '; party registration is not vote choice.</p></div>';
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

  // fingerprints of a separate, privately kept forecast: proof of what it said and when, without revealing it
  function sealedHtml() {
    const v = ((D.sealed || {}).versions || []).slice().reverse();
    if (!v.length) return '';
    return '<p><b>Sealed forecasts.</b> A separate judgment call, beyond this model, is kept privately and updated as the data moves. Each version is sealed with a SHA-256 fingerprint of its full text, listed here when it is made, so the text can be checked after Election Day: ' +
      v.map((x) => 'version ' + x.v + ', ' + esc(x.label) + ': <code class="hash">' + esc(x.sha256) + '</code>').join('; ') + '.</p>';
  }

  // ---------------------------------------------------------------- method section
  function buildMethod() {
    const pu = D.polls_used.map((p) => p.pollster + ' (' + p.end.slice(5).replace('-', '/') + ', ' + p.pop + ')').join('; ');
    const I = D.indep;
    $('method').innerHTML = '<h2>How it works</h2><div class="method-grid"><div>' +
      (I ? '<p><b>Our forecast.</b> The map starts from our forecast, not the raw polls. The national House vote (' + fm(I.national) + ' now, vs. ' + fm(I.polls) + ' in the polls) blends four signals, each weighted by how well it predicted past midterms: the generic-ballot polls corrected for their record (they ran too Democratic in ' + I.backtest.polls.n_over + ' of the last ' + I.backtest.polls.n + ' elections), special elections, presidential approval, and the 2025 Virginia and New Jersey governor races. Senate and governor polls are blended with each state\'s lean plus that national vote, ' + Math.round(I.a_sen * 100) + '/' + Math.round((1 - I.a_sen) * 100) + ' for the Senate and ' + Math.round(I.a_gov * 100) + '/' + Math.round((1 - I.a_gov) * 100) + ' for governors. <a href="#backtest">The backtest</a> shows how it would have done in every midterm since 1998. "Polls only" in the scenario bar shows the map without these corrections.</p>' : '') +
      '<p><b>House.</b> Each district starts from its 2024 presidential margin on the lines in force for 2026, including the Texas, California, North Carolina, Ohio, Utah, Florida, Tennessee, Louisiana and Alabama redraws. It then moves with the national House vote, measured against 2024\'s R+1.5. A district moves more or less than the nation depending on who lives there: each group\'s swing and turnout change apply in proportion to that group\'s share of the district\'s voters. Candidate effects add 2 points for an incumbent and half of each candidate\'s past over- or under-performance of the presidential vote. At D+6 with only uniform swing, the lines give 223 Democratic seats; Decision Desk HQ reported 222 on the same test.</p>' +
      '<p><b>Groups.</b> The electorate is split three independent ways: race and education, age, and gender. Each split covers every voter, and a change in one shows up in the others (Hispanic voters are in every age group). The 2024 baseline is Pew Research Center\'s validated voters. Lowering turnout toward a midterm moves the electorate toward Pew\'s 2022 validated-voter mix: older, whiter and more college-educated. The default 2026 pattern sits halfway between 2024 and the average crosstabs of recent national polls (' + esc(pu) + '). Polls and validated-voter studies measure groups differently, which is why the default only goes halfway. The pollster picker loads one top-rated pollster\'s latest crosstabs instead: its gaps between groups, and optionally its national margin. Asian and other voters stay at their 2024 pattern, because their poll samples are tiny and Native American voters, who matter in several districts, are barely measured.</p>' +
      '<p><b>District electorates are estimates.</b> They come from each district\'s voting-age population by race, age and education, weighted by turnout factors fitted so the national total matches Pew\'s 2024 voters. The white college share is approximated from the district\'s overall college rate, and gender is assumed to be the same everywhere.</p>' +
      '</div><div>' +
      '<p><b>Senate.</b> The 14 competitive races start from the corrected polling averages of a companion Senate model run on Oct 9, which used every public poll since Aug 1 (from RealClearPolling, 270toWin, Wikipedia and pollsters\' releases, excluding campaign internals) and adjusted each pollster for its lean and likely-voter screen. The other 21 start from 2024 presidential lean plus the national environment and 3 points for an incumbent; Montana uses its three-way polls (Alme vs. Bodnar). Every control then moves each state by how its electorate responds, relative to the default. With the polls-only settings the Senate reproduces that model: 67% Democratic control vs. 65%.</p>' +
      '<p><b>Governors.</b> A recency- and quality-weighted average of public polls since late July, with R- or D-leaning pollsters at half weight; fundamentals where there are no polls (CO, HI, OK, SD, WY). They move 0.8 points per point of national change.</p>' +
      '<p><b>Uncertainty.</b> ' + M.NSIM.toLocaleString() + ' simulations with the same random draws each time, so results don\'t flicker as you drag. Each draws a shared national error (Student t with 5 degrees of freedom, SD from the slider), a state error (SD 1.9) shared by every race in the state, a race error (House 5, Senate 3.8, governors 4.5), and a demographic error: each group can land off the scenario (SD in points of margin: white college 4, white non-college 4, Black 5, Hispanic 7, Asian &amp; other 6, ages 18–29 5, older groups 3), moving each district and state by how far its electorate differs from the nation\'s. That makes places with similar voters miss together, the way polls missed white non-college voters in 2016 and 2020 and Hispanic voters in 2020 and 2024. It barely changes the chamber odds, because the misses cancel across the country, but it makes heavily Hispanic districts like TX-28 and FL-27 less certain and ties them together.</p>' +
      '<p><b>Updates.</b> Every three hours the app rebuilds itself from fresh data: candidates and race polls from ElectIndex\'s public feed, ballot counts from UF Election Lab, and a new national polling average. The polling average (' + fm(D.G0) + ' now) is a weighted average of public generic-ballot polls from the last four weeks: one poll per pollster (' + (D.G0_polls || '30') + ' pollsters), weighted by recency, sample size and pollster rating, with partisan-leaning pollsters at half weight.' + (I ? ' Our forecast is recomputed from it on every run; its approval and special-election inputs are checked daily.' : '') + ' The competitive Senate races start from the Oct 9 corrected averages and move by the change in a simple poll average since then. The early-vote signals, story and same-point comparisons are refreshed daily from published analyses; the 2026 crosstab polls are added as pollsters release them. The Watch tab\'s dates, developments and Trump and Vance stops are refreshed daily, each linked to the page that confirms it. If a source fails, the app keeps its last good numbers and says so at the top.</p>' +
      '<p><b>Money.</b> From the Federal Election Commission\'s bulk files, refreshed a few times a day: each nominee\'s campaign totals for 2025–26 (raised, spent, cash on hand, through their latest report) and outside spending, the independent expenditures super PACs, party committees and other groups report on 24- and 48-hour reports for or against each nominee (amended reports replace earlier versions; general election only, so primary and runoff spending is left out). Not covered: ads run before those reporting windows, party spending coordinated with campaigns, and governor races, which are state elections. Money is shown, not used in the forecast: it mostly follows how close a race already looks, an extra dollar in a saturated race moves few votes, and candidate quality, which fundraising partly reflects, is already in the model. Where it helps is as a cross-check: the Watch tab flags races where the money and the forecast disagree.</p>' +
      '<p><b>What it doesn\'t know.</b> District polls (shown, not used), expert ratings, money (shown, not used) and late scandals such as NV-2\'s.</p>' +
      sealedHtml() +
      '</div></div>' +
      '<h3 style="margin-top:12px">Sources</h3><ul class="sources">' +
      '<li><a href="https://github.com/ElectIndex/26_us_forecast_data">ElectIndex 2026 forecast data</a>: 2020 and 2024 presidential results on the 2026 district lines, district voting-age population, candidates and incumbency, and raw race polls (repository as of Oct 12, 11:40 ET).</li>' +
      '<li>Pew Research Center validated voters: <a href="https://www.pewresearch.org/politics/2025/06/26/voting-patterns-in-the-2024-election/">2024</a>, 2022 and 2018 (<a href="https://docs.google.com/spreadsheets/d/1JczVvbrlxkLiYYiNPSv0TRlWsbvYEihkZrnH1kQXIH8/edit?usp=sharing">detailed tables</a>).</li>' +
      '<li>2026 poll crosstabs: <a href="https://www.pewresearch.org/politics/2026/10/08/midterm-vote-preferences-by-race-and-ethnicity-age-and-other-demographics/">Pew (Oct 8)</a>, <a href="https://assets1.cbsnewsstatic.com/hub/cms/prod_cms_alt/file/2026/10/04/0957ee32-a848-4872-b659-14303d3d3734/cbsnews_20261004_sun.pdf">CBS News/YouGov</a>, <a href="https://d3nkl3psvxxpe9.cloudfront.net/documents/econTabReport_703uvs1.pdf">Economist/YouGov</a>, <a href="https://maristpoll.marist.edu/wp-content/uploads/2026/09/NPR_PBS-News_Marist-Poll_USA-NOS-and-Tables_202609171435.pdf">NPR/PBS/Marist</a>, <a href="https://static.foxnews.com/foxnews.com/content/uploads/2026/09/fox_september-11-14-2026_national_cross-tabs_september-16-release.pdf">Fox News</a>, <a href="https://law.marquette.edu/assets/community/poll/MLSPSC35/MLSPSC35CrosstabsRV.html">Marquette</a>, <a href="https://emersoncollegepolling.com/september-2026-national-poll-democrats/">Emerson</a> (pollster picker only). Pollster ratings: ElectIndex.</li>' +
      '<li>Generic-ballot polls: ElectIndex\'s poll file (compiled from public polls). For comparison: <a href="https://www.natesilver.net/p/generic-ballot-average-2026-nate-silver-bulletin-congress-polls">Silver Bulletin</a>, <a href="https://www.realclearpolling.com/polls/state-of-the-union/generic-congressional-vote">RealClearPolling</a>, <a href="https://fiftyplusone.news/polls/generic-ballot/generic-ballot">FiftyPlusOne</a>.</li>' +
      (I ? '<li>Backtest: <a href="https://github.com/fivethirtyeight/data/tree/master/pollster-ratings">FiveThirtyEight\'s pollster-ratings archive</a> (every poll in the final three weeks, 1998–2022, with results); 2024 polls from <a href="https://www.realclearpolling.com/polls/state-of-the-union/2024/generic-congressional-vote">RealClearPolling</a> and pollster releases; House popular vote, 1946–2024, from each election\'s national results table on Wikipedia, checked against Brookings\' Vital Statistics on Congress; presidential approval from <a href="https://news.gallup.com/poll/203198/presidential-approval-ratings-donald-trump.aspx">Gallup</a> (earlier presidents via the <a href="https://www.presidency.ucsb.edu/statistics/data/george-w-bush-public-approval">American Presidency Project</a>\'s Gallup tables); special elections from <a href="https://www.the-downballot.com/p/100-specials-since-trumps-return">The Downballot</a>, <a href="https://amp.cnn.com/cnn/2018/02/22/politics/special-elections-good-for-democrats">CNN</a> and the <a href="https://www.nbcdfw.com/news/politics/do-special-election-results-spell-doom-for-republicans-in-2026/3983422/?amp=1">AP</a>.</li>' : '') +
      '<li>Turnout and early vote: <a href="https://election.lab.ufl.edu/early-vote/2026-early-voting/">UF Election Lab</a> (2026 early vote; 2018, 2022, 2024 turnout); <a href="https://www.cnn.com/2026/10/01/politics/cnn-early-voting-takeaways-democratic-advantage">CNN/Catalist</a>; <a href="https://www.nbcnews.com/politics/2026-election/early-vote-analysis-mail-ballot-concerns-are-changing-democrats-vote-rcna602489">NBC News/UPenn</a>; state election offices.</li>' +
      '</ul>';
  }

  // ---------------------------------------------------------------- other signals: the economy, markets, raters, retirements
  function otherSignalsHtml(I) {
    const B = I.backtest, tested = B.signals || [], now = (I.signals_now && I.signals_now.items) || [];
    if (!tested.length && !now.length) return '';
    const ext = (u, t) => '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>';
    const nowRows = now.map((x) => '<tr><td><b>' + esc(x.label) + '</b><span class="lens-sub">' + esc(x.say || '') + '</span></td><td>' + esc(x.value_label) + '<span class="lens-sub">' + esc(x.compare || '') + '</span></td><td class="bt-col">' + (x.url ? ext(x.url, x.src || 'Source') : esc(x.src || '')) + '</td></tr>').join('');
    const vcls = { 'helps a little': 'ok', 'no help': '', hurts: 'bad', 'no data': '' };
    const vtxt = { 'helps a little': 'Helps a little', 'no help': 'No help', hurts: 'Hurts', 'no data': 'Too little data' };
    const fmtNow = (x) => (x.now == null ? '—' : (x.unit === '%' || x.unit === 'pts' ? (x.now > 0 ? '+' : '') + x.now.toFixed(1) + (x.unit === '%' ? '%' : ' pts') : x.unit === 'members' ? (x.now > 0 ? '+' : '') + x.now : x.now.toFixed(1)));
    const testRows = tested.map((x) => '<tr><td>' + esc(x.label) + (x.note ? '<span class="lens-sub">' + esc(x.note) + '</span>' : '') + '</td><td class="n">' + fmtNow(x) + '</td>' +
      '<td class="n bt-col">' + (x.gain == null ? '—' : (x.gain > 0 ? '+' : '') + x.gain.toFixed(0) + '%') + '</td><td><span class="sig-v ' + (vcls[x.verdict] || '') + '">' + (vtxt[x.verdict] || esc(x.verdict)) + '</span>' + (x.n ? '<span class="lens-sub">' + x.n + ' midterms since ' + x.first + '</span>' : '') + '</td></tr>').join('');
    const helps = tested.filter((x) => x.verdict === 'helps a little').map((x) => x.label.toLowerCase());
    return '<div class="bt-grid"><div>' +
      '<h3>Other signals: what they say now</h3>' +
      '<p class="sub">Readings people watch that aren\'t polls. Shown for context; none is in the forecast (see the test on the right).</p>' +
      '<div class="table-scroll"><table class="bt-table"><thead><tr><th>Signal</th><th>Now</th><th class="bt-col">Source</th></tr></thead><tbody>' + nowRows + '</tbody></table></div>' +
      '</div><div>' +
      '<h3>Do they predict midterms?</h3>' +
      '<p class="sub">Each signal added to approval and exposure, tested on midterms since 1950 (leave one out). "Gain" is how much it cut the typical miss; negative means it made the prediction worse.</p>' +
      '<div class="table-scroll"><table class="bt-table"><thead><tr><th>Signal</th><th class="n">2026</th><th class="n bt-col">Gain</th><th>Verdict</th></tr></thead><tbody>' + testRows + '</tbody></table></div>' +
      '<p class="chart-cap">' + (helps.length ? 'Only ' + helps.join(' and ') + ' helped at all, and ' + (helps.length > 1 ? 'they' : 'it') + ' would barely move 2026, so it stays out. ' : '') +
      'Approval already absorbs the economy: a president presiding over high prices or rising unemployment is already unpopular. Markets and raters are informed judgments rather than independent data, so they are shown here rather than blended in.</p>' +
      '</div></div>';
  }

  // ---------------------------------------------------------------- our forecast: how it's built, and how it would have done
  function renderBacktest() {
    const box = $('backtest');
    if (!box) return;
    const I = D.indep;
    if (!I || !I.backtest) { box.hidden = true; return; }
    const B = I.backtest, met = B.metrics, S = B.state, inp = I.inputs || {};
    const one = (v) => (+v).toFixed(1);
    const pct = (w) => Math.round(w * 100) + '%';
    const ext = (u, t) => '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>';
    const raceOf = (id) => D.senate.find((r) => r.id === id) || D.gov.find((r) => r.id === id);
    // 1. the national vote: four signals
    const comps = I.comps.map((c) => '<tr><td><b>' + esc(c.label) + '</b><span class="lens-sub">' + esc(c.note) + '</span></td>' +
      '<td class="n ' + (c.est > 0 ? 'd' : 'r') + '">' + fm(c.est) + '</td><td class="n bt-col">±' + one(c.sigma) + '</td><td class="n">' + pct(c.weight) + '</td></tr>').join('');
    // 2. each midterm since 1998, predicted without its own result
    const mids = B.national.filter((r) => r.midterm && r.blend != null);
    const miss = (v, a) => Math.abs(v - a);
    const top = Math.max.apply(null, mids.map((r) => Math.max(miss(r.polls, r.actual), miss(r.blend, r.actual)))) || 1;
    const bar = (e, cls) => '<span class="bt-m"><span class="bt-bar ' + cls + '" style="width:' + (e / top * 72).toFixed(1) + '%"></span><i>' + one(e) + '</i></span>';
    const score = mids.map((r) => {
      const ep = miss(r.polls, r.actual), eo = miss(r.blend, r.actual);
      return '<tr' + (eo > ep ? ' class="bt-worse"' : '') + '><td>' + r.year + '</td><td class="n">' + fm(r.polls) + '</td><td class="n"><b>' + fm(r.blend) + '</b></td><td class="n">' + fm(r.actual) + '</td>' +
        '<td class="bt-misses">' + bar(ep, 'p') + bar(eo, 'o') + '</td></tr>';
    }).join('');
    const mm = met.midterms_1998_2022, tm = met.trump_midterms;
    const worse = mids.filter((r) => miss(r.blend, r.actual) > miss(r.polls, r.actual));
    const nBetter = mids.length - worse.length;
    // 3. Senate and governor races
    const SS = S.Sen, GG = S.Gov;
    const srow = (lab, a, b, n) => '<tr><td>' + lab + '</td><td class="n">' + one(a) + '</td><td class="n"><b>' + one(b) + '</b></td><td class="n">' + n + '</td></tr>';
    const keptInc = (I.kept || []).filter((k) => /incumbent/.test(k.why)).map((k) => {
      const r = raceOf(k.id), who = r && r.inc ? lastName(r.inc === 'D' ? r.dn : r.rn) : '';
      return esc(k.id) + (who ? ' ' + esc(who) : '');
    });
    const keptOther = (I.kept || []).filter((k) => !/incumbent/.test(k.why)).map((k) => esc(k.id) + ' (' + esc(k.why.replace(/;.*$/, '')) + ')');
    // 4. what didn't hold up
    const mb = S.midterm_bias || {};
    const mbTxt = Object.keys(mb).sort().map((y) => y + ': ' + one(Math.abs(mb[y])) + (mb[y] > 0 ? ' too D' : ' too R')).join(', ');
    const tr = B.state_track || [];
    const pair = (a, b) => tr.find((x) => x.prev === a && x.cur === b);
    const pTxt = (x) => (x ? x.prev + '→' + x.cur + ': ' + x.none.toFixed(2) + ' → ' + x.k25.toFixed(2) : '');
    const midPairs = [pair(2014, 2018), pair(2018, 2022)].filter(Boolean), presPairs = [pair(2016, 2020), pair(2022, 2024)].filter(Boolean);
    // 5. sensitivity and inputs
    const sens = (I.sens || []).map((x) => '<li>' + esc(x.label) + ': <b>' + fm(x.est) + (x.est2 != null ? ' / ' + fm(x.est2) : '') + '</b></li>').join('');
    const ap = inp.approval || {}, spc = inp.specials || {}, off = inp.offyear || {};
    const apSrc = (ap.sources || []).map((x) => ext(x[1], x[0])).join('; ');
    box.innerHTML = '<h2>How our forecast is built, and how it would have done</h2>' +
      '<p class="sub bt-lede">The polls have missed before, so our forecast doesn\'t just read them. It weighs four signals by how well each predicted the House vote in past midterms, and every piece is tested on elections it wasn\'t fitted to. Recent elections count more (an election ' + B.weights.half_life + ' years back counts half), and presidential years count half as much as midterms.</p>' +
      '<div class="bt-big"><span><span class="bt-k d">' + fm(I.national) + '</span> our forecast of the House vote (±' + one(I.sig) + ')</span><span><span class="bt-k muted">' + fm(I.polls) + '</span> the polls alone</span></div>' +
      '<div class="bt-grid"><div>' +
      '<h3>The national vote: four signals</h3>' +
      '<div class="table-scroll"><table class="bt-table"><thead><tr><th>Signal</th><th class="n">Says</th><th class="n bt-col" title="Typical miss in past midterms">Typical miss</th><th class="n">Weight</th></tr></thead><tbody>' + comps + '</tbody></table></div>' +
      '<p class="chart-cap">Weights are inverse to each signal\'s typical miss in the backtest. The signals partly share errors (they all read the same electorate), so the blend is less certain than the weights alone suggest. The model adds 1.5 points for how the national vote turns into seats, for ±' + one(I.sig) + ' in all, vs. ±3.9 for the polls alone.</p>' +
      '</div><div>' +
      '<h3>Every midterm since 1998</h3>' +
      '<p class="sub">House vote three weeks out, each year predicted without its own result.</p>' +
      '<div class="table-scroll"><table class="bt-table"><thead><tr><th>Year</th><th class="n">Polls</th><th class="n">Ours</th><th class="n">Result</th><th>Miss <span class="bt-key"><span class="bt-bar p"></span>polls <span class="bt-bar o"></span>ours</span></th></tr></thead><tbody>' + score + '</tbody></table></div>' +
      '<p class="chart-cap">Average miss (root mean square): polls ' + one(mm.polls) + ' points, ours ' + one(mm.blend) + '; in the two Trump midterms, ' + one(tm.polls) + ' vs. ' + one(tm.blend) + '. Ours was closer in ' + nBetter + ' of ' + mids.length + (worse.length ? '. The exception' + (worse.length > 1 ? 's were ' : ' was ') + worse.map((r) => r.year).join(', ') + (worse.length === 1 && worse[0].year === 2018 ? ', the year most like this one: the polls underestimated Democrats, and our correction would have made the miss bigger.' : '.') : '.') + ' Special-election data exists for 2006, 2018 and 2022 and the governor signal from 2006; other years use the signals they had.</p>' +
      '</div></div>' +
      '<div class="bt-grid"><div>' +
      '<h3>Senate and governor races</h3>' +
      '<p class="sub">Red-state polls have overstated Democrats relative to blue-state polls (about ' + one(Math.abs(S.lean_slope) * 10) + ' points for every 10 points of state lean). Blending each race\'s polls with the state\'s lean plus the national vote, ' + Math.round(I.a_sen * 100) + '/' + Math.round((1 - I.a_sen) * 100) + ' for the Senate and ' + Math.round(I.a_gov * 100) + '/' + Math.round((1 - I.a_gov) * 100) + ' for governors, cut the miss:</p>' +
      '<div class="table-scroll"><table class="bt-table"><thead><tr><th>Average miss, pts</th><th class="n">Polls</th><th class="n">Blend</th><th class="n">Races</th></tr></thead><tbody>' +
      srow('Senate, 2000–2024', SS.rmse_polls, SS.rmse_blend, SS.n) + srow('Senate, 2018 and 2022', SS.rmse_polls_trump_mid, SS.rmse_blend_trump_mid, SS.n_trump_mid) +
      srow('Governors, 2000–2024', GG.rmse_polls, GG.rmse_blend, GG.n) + srow('Governors, 2018 and 2022', GG.rmse_polls_trump_mid, GG.rmse_blend_trump_mid, GG.n_trump_mid) + '</tbody></table></div>' +
      '<p class="chart-cap">Races decided by less than 20 points, final-three-week poll averages. Each year is scored with the blend chosen from the other years. The blend was closer in ' + SS.n_better + ' of ' + SS.n + ' Senate races and ' + GG.n_better + ' of ' + GG.n + ' governor races. ' +
      (keptInc.length ? 'Kept at their polls: incumbents running against their state\'s lean, which a state\'s lean can\'t account for (' + keptInc.join(', ') + ')' + (keptOther.length ? ', and ' + keptOther.join(', ') : '') + '.' : keptOther.length ? 'Kept at their polls: ' + keptOther.join(', ') + '.' : '') + '</p>' +
      '</div><div>' +
      '<h3>What didn\'t hold up</h3><ul class="bt-list">' +
      '<li><b>A blanket correction to state polls.</b> Their average miss in midterms flips direction: ' + mbTxt + '.</li>' +
      '<li><b>Trusting the pollsters that were right last time.</b> Among the ' + B.pollsters.n + ' pollsters with 20 or more final-three-week polls in both 1998–2016 and 2018–2022, accuracy in the first period didn\'t predict the second (correlation ' + B.pollsters.corr.toFixed(2).replace('-', '−') + ').</li>' +
      (midPairs.length ? '<li><b>Carrying a state\'s last miss forward.</b> Correcting each state by a quarter of its last miss helped a little from one Trump-era midterm to the next (' + midPairs.map(pTxt).join('; ') + ') but hurt when carried into a presidential year (' + presPairs.map(pTxt).join('; ') + '). Too unstable to use.</li>' : '') +
      '</ul>' +
      '<h3>How much the choices matter</h3><ul class="bt-list">' + sens + '</ul>' +
      '</div></div>' +
      otherSignalsHtml(I) +
      '<h3>Inputs, checked daily</h3><ul class="bt-list bt-inputs">' +
      (ap.net != null ? '<li><b>Trump\'s net approval: ' + (ap.net > 0 ? '+' : '−') + Math.abs(ap.net).toFixed(0) + '</b>' + (apSrc ? ' (' + apSrc + ')' : '') + '. Midterms since ' + B.fund.first + ' are fitted on Gallup\'s final reading before each election.</li>' : '') +
      (spc.value != null ? '<li><b>Special elections: Democrats ' + (spc.value > 0 ? '+' : '−') + Math.abs(spc.value).toFixed(1) + ' vs. 2024</b> across ' + spc.n + ' races' + (spc.recent != null ? ' (' + (spc.recent > 0 ? '+' : '−') + Math.abs(spc.recent).toFixed(1) + ' in ' + esc(spc.recent_label || 'this year') + ')' : '') + (spc.source ? ', ' + ext(spc.source[1], spc.source[0]) : '') + '. In 2006, 2018 and 2022 specials overstated the final swing by ' + Object.keys(B.specials.over).map((y) => one(B.specials.over[y])).join(', ') + ' points.</li>' : '') +
      (off.VA != null ? '<li><b>2025 governors:</b> Virginia ' + (off.VA > 0 ? '+' : '−') + Math.abs(off.VA).toFixed(1) + ' and New Jersey ' + (off.NJ > 0 ? '+' : '−') + Math.abs(off.NJ).toFixed(1) + ' points more Democratic than in 2024 (' + (off.sources || []).map((x) => ext(x[1], x[0].replace(/ gubernatorial election$/, ''))).join(', ') + ').</li>' : '') +
      '</ul>' +
      '<p class="chart-cap bt-caveat"><b>Caveats.</b> Seven midterms is a small sample, and only three have comparable special-election data. House seats are not backtested district by district; they come from the national vote through the same model as everything else. Money and crosstab accuracy are not in the forecast.</p>';
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
    renderForecastCard();
    renderTrend();
    renderResults();
    renderLens();
    renderTable();
    renderControls();
  }

  // ---------------------------------------------------------------- pollster lens: the forecast with each pollster's crosstabs
  // Same national vote, each source's gaps between groups. Computed once, lazily, a simulation per tick.
  let LENS = null, lensBusy = false;
  function lensScenario(kind, p) {
    const s = M.clone(M.defaults);
    ['race', 'age', 'gender'].forEach((dim) => {
      const def = M.blendDev(dim);
      s.dev[dim] = def.map((v, i) => {
        if (kind === 'poll') return p.dev[dim][i] == null ? v : p.dev[dim][i];
        if (kind === 'polls') return D.polldev[dim][i].dev;
        if (kind === '2024') return D.base['2024'][dim].dev[i];
        return v;
      });
    });
    s.C = M.solveC(s, M.national(M.defaults));
    return s;
  }
  function lensRows() {
    return [
      { k: 'forecast', name: HAS_OURS ? 'Our forecast' : 'The forecast', sub: 'halfway between 2024 and the 2026 polls' },
      { k: '2024', name: '2024 pattern', sub: 'how each group voted in 2024' },
      { k: 'polls', name: '2026 poll average', sub: 'all the 2026 crosstabs, averaged' },
    ].concat((D.pollsters || []).map((p) => ({ k: 'poll:' + p.k, p, name: p.short + ' ' + p.pop, sub: fmtDay(p.end) + ' · their national number ' + fm(p.top) })));
  }
  function computeLens() {
    if (LENS || lensBusy) return;
    lensBusy = true;
    const rows = lensRows(), out = [];
    let j = 0;
    const step = () => {
      const r = rows[j++];
      const res = r.k === 'forecast' ? (R0 || (R0 = M.simulate(M.clone(M.defaults)))) : M.simulate(lensScenario(r.p ? 'poll' : r.k, r.p));
      out.push(Object.assign({ v: { h: res.house.control, hr: res.house.r.control, s: res.senate.control, sr: res.senate.rcontrol, g: res.gov.maj, gr: res.gov.r.control } }, r));
      if (j < rows.length) { setTimeout(step, 0); return; }
      LENS = out; lensBusy = false; renderLens();
    };
    setTimeout(step, 0);
  }
  function renderLens() {
    const box = $('lens'); if (!box) return;
    if (!(D.pollsters || []).length) { box.hidden = true; return; }
    const rv = rView(), P = rv ? 'R' : 'D';
    const head = '<h3>Same national vote, different crosstabs</h3>';
    // until the simulations finish, draw the same table with placeholders, so nothing below it jumps when they land
    const L = LENS || lensRows();
    const val = (x, k) => (rv ? x.v[k + 'r'] : x.v[k]);
    const cell = (x, k) => (x.v ? '<td class="n"><span class="pill ' + rating(x.v[k]).k + '">' + P + ' ' + fp(val(x, k)) + '</span></td>' : '<td class="n"><span class="pill">…</span></td>');
    const act = (x) => (x.k === 'forecast'
      ? (atForecast() ? '<span class="muted small">Showing</span>' : '<button class="lens-go" data-k="forecast">Show</button>')
      : '<button class="lens-go" data-k="' + esc(x.k) + '">Load</button>');
    const row = (x, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td><b>' + esc(x.name) + '</b><span class="lens-sub">' + esc(x.sub) + '</span></td>' +
      cell(x, 'h') + cell(x, 's') + cell(x, 'g') + '<td class="n lens-act">' + act(x) + '</td></tr>';
    const base = L.slice(0, 3), polls = LENS ? L.slice(3).sort((a, b) => val(b, 's') - val(a, 's')) : L.slice(3);
    const ends = (k) => { if (!LENS) return ['…', '…']; const a = LENS.map((x) => val(x, k)); return [fp(Math.min.apply(null, a)), fp(Math.max.apply(null, a))]; };
    const hE = ends('h'), sE = ends('s');
    box.innerHTML = head +
      '<p class="sub">' + (HAS_OURS ? 'Our forecast' : 'The forecast') + ' at the same national vote (' + fm(FORECAST_NAT) + ') with each source\'s gaps between groups. Chances are for ' + (rv ? 'Republicans' : 'Democrats') + '.</p>' +
      '<div class="table-scroll"><table><thead><tr><th>Crosstabs from</th><th class="n">House</th><th class="n">Senate</th><th class="n">Govs 26+</th><th class="lens-act"></th></tr></thead><tbody>' +
      row(base[0], 'lens-base') + row(base[1]) + row(base[2], 'lens-sep') + polls.map((x) => row(x)).join('') + '</tbody></table></div>' +
      '<p class="chart-cap">The House stays between ' + hE[0] + ' and ' + hE[1] + '; the Senate runs from ' + sE[0] + ' to ' + sE[1] + '. Most Senate battlegrounds (Maine, Iowa, Ohio, Kansas, Nebraska, Alaska, Michigan, Minnesota, New Hampshire) are whiter than the country, so which groups are moving matters more for the Senate than for the House. ' +
      'A single poll\'s subgroups are small: a 150-person group\'s margin carries about ±15 points of sampling error, so the forecast follows the average rather than any one pollster. Load applies a row to the map as your scenario.</p>';
    box.querySelectorAll('.lens-go').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === 'forecast') resetToForecast();
      else if (k.indexOf('poll:') === 0) applyPollster(k.slice(5));
      else applyPattern(k);
    }));
  }
  function initLens() {
    const box = $('lens'); if (!box || !(D.pollsters || []).length) return;
    if (!('IntersectionObserver' in window)) { setTimeout(computeLens, 2500); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); computeLens(); } }, { rootMargin: '300px' });
    io.observe(box);
  }

  // ---------------------------------------------------------------- campaign money (FEC): shown, not used in the forecast
  const mraces = () => (D.money && D.money.races) || {};
  function usd(v) {
    const a = Math.abs(v || 0);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e8) return '$' + Math.round(v / 1e6) + 'M';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v || 0);
  }
  // o = [for D, against D, for R, against R]; spending against one side helps the other
  function helped(mo) { const o = (mo && mo.o) || [0, 0, 0, 0]; return { D: o[0] + o[3], R: o[2] + o[1], all: o[0] + o[1] + o[2] + o[3] }; }
  const ACRO = new Set(['PAC', 'DCCC', 'DSCC', 'NRCC', 'NRSC', 'RNC', 'DNC', 'AFP', 'SBA', 'NRA', 'SEIU', 'CLF', 'HMP', 'SMP', 'SLF', 'USA', 'AFL', 'CIO', 'AFSCME', 'LCV', 'NEA', 'AFT', 'UAW', 'MAGA', 'GOP', 'II', 'III', 'IV', 'AB', 'US', 'NC', 'PA', 'GA', 'MI', 'OH', 'TX', 'FL', 'IA', 'KS', 'NE', 'AK', 'MN', 'NH', 'SC', 'NY', 'AZ', 'NV', 'WI', 'VA', 'CA', 'CO', 'ME', 'MT']);
  const SMALLW = new Set(['of', 'to', 'in', 'on', 'at', 'by', 'for', 'and', 'the', 'a', 'an', 'or', 'with']);
  // FEC committee names arrive in capitals; mixed-case names are kept as filed
  function titleName(s) {
    s = String(s || '').trim();
    if (s.split(/\s+/).length > 2) s = s.replace(/,?\s+(INC|LLC)\.?$/i, '');
    if (s !== s.toUpperCase()) return s;
    return s.split(/\s+/).map((w, k) => {
      const core = w.replace(/[^A-Za-z]/g, '').toUpperCase();
      if (ACRO.has(core) || (core.length > 1 && core.length <= 4 && !/[AEIOUY]/.test(core))) return w;
      const lw = w.toLowerCase();
      if (k > 0 && SMALLW.has(lw)) return lw;
      if (lw === 'inc.' || lw === 'inc') return 'Inc.';
      return lw.replace(/(^|[-(\/])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/^([a-z])/, (c) => c.toUpperCase()).replace(/^(O'|Mc)([a-z])/, (m, p, c) => p + c.toUpperCase());
    }).join(' ');
  }
  function splitBar(dv, rv, labelD, labelR) {
    const t = dv + rv; if (!t) return '';
    const pd = dv / t * 100;
    return '<div class="msplit" role="img" aria-label="Outside spending: ' + usd(dv) + ' helping ' + esc(labelD) + ', ' + usd(rv) + ' helping ' + esc(labelR) + '"><span class="bd" style="width:' + pd.toFixed(1) + '%"></span><span class="br" style="width:' + (100 - pd).toFixed(1) + '%"></span></div>';
  }
  const sideName = (r, side) => esc(lastName(side === 'D' ? r.dn : r.rn) || (side === 'D' ? 'Democrat' : 'Republican'));
  const sideTag = (r, side) => side === 'D' ? (r.dp === 'I' ? 'I' : 'D') : (r.rp === 'I' ? 'I' : 'R');
  function moneyCell(r) {
    const h = helped(mraces()[r.id]);
    if (!h.all) return '<span class="muted">—</span>';
    return '<span title="Helping ' + sideName(r, 'D') + ' ' + usd(h.D) + '; helping ' + sideName(r, 'R') + ' ' + usd(h.R) + '">' + usd(h.all) + '</span>' +
      '<span class="mini" aria-hidden="true"><span class="bd" style="width:' + (h.D / h.all * 100).toFixed(0) + '%"></span><span class="br" style="width:' + (h.R / h.all * 100).toFixed(0) + '%"></span></span>';
  }
  function moneyHtml(r) {
    const mo = mraces()[r.id];
    if (!D.money || !mo) return '';
    const h = helped(mo), A = D.money.asof || {};
    const dn = sideName(r, 'D'), rn = sideName(r, 'R');
    const cell = (x, k) => (x ? usd(x[k]) : '<span class="muted">—</span>');
    const thru = (x) => (x && x.thru ? fmtDay(x.thru) : '<span class="muted">no report yet</span>');
    let html = '<div class="money"><span class="tally-k">Money (FEC)</span><table class="mtab"><thead><tr><th></th><th class="n d">' + dn + ' (' + sideTag(r, 'D') + ')</th><th class="n r">' + rn + ' (' + sideTag(r, 'R') + ')</th></tr></thead><tbody>' +
      '<tr><td>Campaign raised</td><td class="n">' + cell(mo.d, 'raised') + '</td><td class="n">' + cell(mo.r, 'raised') + '</td></tr>' +
      '<tr><td>Cash on hand</td><td class="n">' + cell(mo.d, 'cash') + '</td><td class="n">' + cell(mo.r, 'cash') + '</td></tr>' +
      '<tr class="mtab-sub"><td>Reports through</td><td class="n">' + thru(mo.d) + '</td><td class="n">' + thru(mo.r) + '</td></tr>' +
      '<tr><td>Outside groups helping</td><td class="n">' + usd(h.D) + '</td><td class="n">' + usd(h.R) + '</td></tr></tbody></table>';
    if (h.all > 0) html += splitBar(h.D, h.R, lastName(r.dn), lastName(r.rn));
    if (mo.top && mo.top.length) html += '<p class="note">Biggest outside spenders: ' + mo.top.slice(0, 4).map((x) => esc(titleName(x[0])) + ' ' + usd(x[1]) + ' <span class="' + (x[2] === 'D' ? 'd' : 'r') + '">(for ' + (x[2] === 'D' ? dn : rn) + ')</span>').join(' · ') + (mo.nsp > 4 ? ' · ' + (mo.nsp - 4) + ' more' : '') + '.</p>';
    const fecLink = (x, nm) => (x && x.id ? '<a href="https://www.fec.gov/data/candidate/' + encodeURIComponent(x.id) + '/" target="_blank" rel="noopener">' + nm + '</a>' : '');
    const links = [fecLink(mo.d, dn), fecLink(mo.r, rn)].filter(Boolean);
    html += '<p class="chart-cap">Outside spending is general-election independent expenditures on 24- and 48-hour reports through ' + (A.ie ? fmtDay(A.ie) : '—') + '; spending against one candidate counts as helping the other. Shown, not used in the forecast.' + (links.length ? ' FEC filings: ' + links.join(' · ') + '.' : '') + '</p></div>';
    return html;
  }
  function candReportNote() {
    const n = {};
    Object.values(mraces()).forEach((e) => ['d', 'r'].forEach((k) => { if (e[k] && e[k].thru) n[e[k].thru] = (n[e[k].thru] || 0) + 1; }));
    const mode = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
    const today = todayISO();
    return 'Campaign totals run through each candidate\'s latest report' + (mode ? ' (most often ' + fmtDay(mode) + ')' : '') +
      (today < '2026-10-15' ? '; reports through Sep 30 are due Oct 15' : today < '2026-10-22' ? '; pre-election reports through Oct 14 are due Oct 22' : '') + '.';
  }
  // Watch: where the money is going, and where it disagrees with the forecast
  const MONEY_HEAVY = { senate: 15e6, house: 3e6 }, MONEY_LIGHT = { senate: 3e6, house: 5e5 };
  function moneyFlags(res) {
    const out = [];
    ['senate', 'house'].forEach((t) => races(t).forEach((r, i) => {
      const mo = mraces()[r.id]; if (!mo) return;
      const h = helped(mo), p = res[t].p[i];
      if (h.all >= MONEY_HEAVY[t] && (p >= 0.9 || p <= 0.1)) out.push({ k: 'heavy', t, r, i, h, p });
      else if (p >= 0.35 && p <= 0.65 && h.all < MONEY_LIGHT[t]) out.push({ k: 'light', t, r, i, h, p });
    }));
    return out.sort((a, b) => (a.k === b.k ? b.h.all - a.h.all : a.k === 'heavy' ? -1 : 1));
  }
  function watchMoney() {
    const MO = D.money; if (!MO || !MO.races) return '';
    const tab = wui.mtab || 'senate', res = R0 || R, A = MO.asof || {};
    const tot = (t) => races(t).reduce((acc, r) => { const h = helped(mraces()[r.id]); acc.D += h.D; acc.R += h.R; return acc; }, { D: 0, R: 0 });
    const ts = tot('senate'), th = tot('house');
    const all = ['senate', 'house'].flatMap((t) => races(t).map((r) => ({ r, h: helped(mraces()[r.id]) })));
    const top1 = all.reduce((a, x) => (x.h.all > a.h.all ? x : a), all[0]);
    const pctR = (x) => Math.round(x.R / Math.max(1, x.D + x.R) * 100);
    let h = '<h3>Follow the money</h3><p class="sub">Outside spending by super PACs, party committees and other groups in the general election, through ' + (A.ie ? fmtDay(A.ie) : '—') + ', and the candidates\' own money, from FEC reports. ' + candReportNote() + ' Shown, not used in the forecast.</p>';
    h += '<div class="stats trail-stats">' +
      '<div class="stat"><div class="stat-v num">' + usd(ts.D + ts.R) + '</div><div class="stat-k">outside spending in Senate races, ' + pctR(ts) + '% of it helping Republicans</div></div>' +
      '<div class="stat"><div class="stat-v num">' + usd(th.D + th.R) + '</div><div class="stat-k">in House races, ' + pctR(th) + '% helping Republicans</div></div>' +
      (top1 && top1.h.all ? '<div class="stat"><div class="stat-v num">' + usd(top1.h.all) + '</div><div class="stat-k">in the most expensive race, ' + esc(top1.r.id) + '</div></div>' : '') + '</div>';
    const flags = moneyFlags(res);
    const heavy = flags.filter((x) => x.k === 'heavy'), light = flags.filter((x) => x.k === 'light');
    if (heavy.length) {
      const favD = heavy.filter((x) => x.p >= 0.5).length;
      h += '<div class="mflags"><p class="w-day">Big money, lopsided forecast</p><p class="mf-intro">' + heavy.length + ' race' + (heavy.length === 1 ? '' : 's') + ' where outside groups have spent at least ' + usd(MONEY_HEAVY.senate) + ' (Senate) or ' + usd(MONEY_HEAVY.house) + ' (House) though the forecast gives one side 90% or more' +
        (favD === heavy.length ? '. The forecast favors the Democrat in every one: the people spending the money are treating these as closer than the forecast does.' : favD === 0 ? '. The forecast favors the Republican in every one: the people spending the money are treating these as closer than the forecast does.' : '.') + (heavy.length > 8 ? ' Showing the 8 with the most outside money.' : '') + '</p><ul class="mf-list">' +
        heavy.slice(0, 8).map((x) => '<li>' + raceChip(x.r.id) + '<span class="mf-t">' + usd(x.h.all) + ' outside, ' + Math.round(Math.max(x.h.D, x.h.R) / x.h.all * 100) + '% helping ' + (x.h.D >= x.h.R ? sideName(x.r, 'D') : sideName(x.r, 'R')) + '</span></li>').join('') + '</ul></div>';
    }
    if (light.length) {
      h += '<div class="mflags"><p class="w-day">Close forecast, little money</p><p class="mf-intro">Races the forecast puts between 35% and 65% where outside groups have spent under ' + usd(MONEY_LIGHT.senate) + ' (Senate) or ' + usd(MONEY_LIGHT.house) + ' (House): neither side\'s groups are treating them as top targets.</p><ul class="mf-list">' +
        light.slice(0, 8).map((x) => '<li>' + raceChip(x.r.id) + '<span class="mf-t">' + usd(x.h.all) + ' outside</span></li>').join('') + '</ul></div>';
    }
    const list = races(tab).map((r, i) => ({ r, i, mo: mraces()[r.id], h: helped(mraces()[r.id]) })).filter((x) => x.h.all > 0).sort((a, b) => b.h.all - a.h.all);
    const shown = wui.mall ? list : list.slice(0, 8);
    h += '<div class="w-mtabs" role="group" aria-label="Chamber"><button class="chip mtab-btn" data-m="senate" aria-pressed="' + (tab === 'senate') + '">Senate</button><button class="chip mtab-btn" data-m="house" aria-pressed="' + (tab === 'house') + '">House</button></div>';
    h += '<ol class="mn-list">' + shown.map((x) => {
      const mo = x.mo, r = x.r, dn = sideName(r, 'D'), rn = sideName(r, 'R');
      const cand = (mo.d || mo.r) ? '<p class="mn-line">Campaigns raised: <span class="d">' + dn + ' ' + (mo.d ? usd(mo.d.raised) : '—') + '</span> · <span class="r">' + rn + ' ' + (mo.r ? usd(mo.r.raised) : '—') + '</span>; cash on hand ' + (mo.d ? usd(mo.d.cash) : '—') + ' · ' + (mo.r ? usd(mo.r.cash) : '—') + '</p>' : '';
      const topSp = mo.top && mo.top.length ? '<p class="mn-line muted">Top: ' + mo.top.slice(0, 2).map((s) => esc(titleName(s[0])) + ' ' + usd(s[1]) + ' (' + (s[2] === 'D' ? dn : rn) + ')').join(' · ') + '</p>' : '';
      return '<li class="mn-item"><div class="mn-top">' + raceChip(r.id) + '<span class="mn-total num">' + usd(x.h.all) + '</span><span class="mn-k">outside</span></div>' +
        splitBar(x.h.D, x.h.R, lastName(r.dn), lastName(r.rn)) +
        '<div class="mn-sides"><span class="d">' + dn + ' ' + usd(x.h.D) + '</span><span class="r">' + usd(x.h.R) + ' ' + rn + '</span></div>' + cand + topSp + '</li>';
    }).join('') + '</ol>';
    if (list.length > 8) h += '<button class="more w-more" data-k="mall">' + (wui.mall ? 'Show fewer' : 'Show all ' + list.length) + '</button>';
    h += '<p class="chart-cap">Independent expenditures on 24- and 48-hour reports, general election only; spending against one candidate counts as helping the other. Independents running in a Democrat\'s place (Osborn in Nebraska, Bodnar in Montana) count on that side. Not covered: ads run before the reporting windows, party spending coordinated with campaigns, and governor races. Source: Federal Election Commission bulk data.</p>';
    return h;
  }

  // ---------------------------------------------------------------- Watch: dates ahead, what's happened, the campaign trail
  const wui = { up: false, hap: false, log: false };
  const KIND = { rally: 'Rally', stop: 'Campaign stop', fundraiser: 'Fundraiser', 'tele-rally': 'Tele-rally', official: 'Official visit' };
  const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function dayLabel(iso, today) {
    const [y, m, d] = iso.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number);
    const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
    const wd = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    return (diff === 0 ? 'Today · ' : diff === 1 ? 'Tomorrow · ' : '') + wd + ' ' + fmtDay(iso);
  }
  function raceRef(code) {
    const c = String(code || '').toUpperCase().replace(/-AL$/, '-01');
    const t = /-SEN$/.test(c) ? 'senate' : /-GOV$/.test(c) ? 'gov' : /^[A-Z]{2}-\d{2}$/.test(c) ? 'house' : null;
    if (!t) return null;
    const i = races(t).findIndex((r) => r.id === c);
    return i < 0 ? null : { t, i, r: races(t)[i], id: c };
  }
  // a race with today's forecast chance; tapping it opens the race on the map
  function raceChip(code) {
    const ref = raceRef(code); if (!ref) return '';
    const res = R0 || R, p = res[ref.t === 'gov' ? 'gov' : ref.t].p[ref.i];
    return '<button class="rchip" data-race="' + ref.id + '" title="Open ' + ref.id + ' on the map">' + ref.id + ' <span class="pill ' + rating(p).k + '">' + chanceText(p, ref.r) + '</span></button>';
  }
  const chipsFor = (list) => (list || []).map(raceChip).join('');
  const srcLink = (x) => (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.src || 'Source') + '</a>' + (x.aff ? ' (' + esc(x.aff) + ')' : '') : '');
  function goRace(code) {
    const ref = raceRef(code); if (!ref) return;
    setTab(ref.t);
    openRace(ref.i, true);
  }
  function watchUpcoming(W, today) {
    const all = (W.upcoming || []).filter((x) => x.date >= today && x.group !== 'election-night');
    const night = (W.upcoming || []).filter((x) => x.group === 'election-night');
    const shown = wui.up ? all : all.slice(0, 8);
    let h = '<h3>Coming up</h3>', last = null;
    if (!all.length) h += '<p class="sub">Nothing scheduled in the list right now.</p>';
    h += '<ul class="w-list">';
    shown.forEach((x) => {
      if (x.date !== last) { h += '</ul><p class="w-day">' + dayLabel(x.date, today) + '</p><ul class="w-list">'; last = x.date; }
      h += '<li class="w-item"><div class="w-top"><span class="w-when">' + (x.time ? esc(x.time) + ' ET' : '') + '</span><p class="w-title">' + esc(x.title) + '</p></div>' +
        (x.what ? '<p class="w-what">' + esc(x.what) + '</p>' : '') + (x.why ? '<p class="w-why">' + esc(x.why) + '</p>' : '') +
        '<div class="w-meta">' + chipsFor(x.races) + '<span>' + srcLink(x) + '</span></div></li>';
    });
    h += '</ul>';
    if (all.length > 8) h += '<button class="more w-more" data-k="up">' + (wui.up ? 'Show fewer' : 'Show all ' + all.length) + '</button>';
    if (night.length) {
      h += '<details class="w-night"><summary>Election night: when polls close (ET)</summary><ul class="w-list">' + night.map((x) =>
        '<li class="w-item"><div class="w-top"><span class="w-when">' + esc(x.time || '') + '</span><p class="w-title">' + esc(x.title) + '</p></div>' +
        (x.what ? '<p class="w-what">' + esc(x.what) + '</p>' : '') + '<div class="w-meta">' + chipsFor(x.races) + '<span>' + srcLink(x) + '</span></div></li>').join('') + '</ul></details>';
    }
    return h;
  }
  function watchHappened(W) {
    const all = (W.happened || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    const shown = wui.hap ? all : all.slice(0, 6);
    let h = '<h3>What\'s happened</h3><p class="sub" style="margin-bottom:0">Developments that matter for control, newest first.</p><ul class="w-list">';
    shown.forEach((x) => {
      h += '<li class="w-item"><div class="w-top"><span class="w-when">' + fmtDay(x.date) + '</span><p class="w-title">' + esc(x.title) + '</p></div>' +
        '<p class="w-what">' + esc(x.what) + '</p>' + (x.why ? '<p class="w-why">' + esc(x.why) + '</p>' : '') +
        '<div class="w-meta">' + chipsFor(x.races) + '<span>' + srcLink(x) + '</span></div></li>';
    });
    h += '</ul>';
    if (all.length > 6) h += '<button class="more w-more" data-k="hap">' + (wui.hap ? 'Show fewer' : 'Show all ' + all.length) + '</button>';
    return h;
  }
  function trailMap(byState) {
    const W = 11 * TW + TW / 2 + 8, H = 7 * 1.5 * TR + 2 * TR + 8;
    let h = '<svg class="tmap" viewBox="0 0 ' + W.toFixed(1) + ' ' + H.toFixed(1) + '" role="img" aria-label="Campaign stops by state, colored by the 2024 presidential result">';
    Object.keys(TILE).forEach((s) => {
      const [x, y] = tileXY(s), v = byState[s], c = D.statecomp[s];
      const n = v ? v.T + v.V : 0;
      const tip24 = c ? ' (2024: ' + (c.m24 > 0 ? 'Harris' : 'Trump') + ' +' + Math.abs(c.m24).toFixed(1) + ')' : '';
      h += '<path class="ttile ' + (n ? 'f-' + marginBin(c ? c.m24 : 0) : 'f-none') + '" d="' + hexPath(x, y, TR - 1) + '"><title>' + (STATE_NAMES[s] || s) +
        (n ? ': Trump ' + v.T + ', Vance ' + v.V : ': no stops') + tip24 + '</title></path>';
      h += '<text class="tilelab ' + (n ? 'on' : 'off') + '" x="' + x.toFixed(1) + '" y="' + (y - (n ? 6 : 0)).toFixed(1) + '">' + s + '</text>';
      if (n) h += '<text class="tilep" x="' + x.toFixed(1) + '" y="' + (y + 10).toFixed(1) + '">' + [v.T ? 'T' + v.T : '', v.V ? 'V' + v.V : ''].filter(Boolean).join(' ') + '</text>';
    });
    return h + '</svg>';
  }
  function watchTrail(W, today) {
    const T = (W.trail || []).filter((x) => x.status !== 'canceled' && x.status !== 'postponed');
    const isAhead = (x) => x.date > today || (x.date === today && x.status !== 'held');
    const inPerson = T.filter((x) => x.kind !== 'tele-rally' && TILE[x.st]);
    const byState = {};
    inPerson.forEach((x) => { const b = byState[x.st] || (byState[x.st] = { T: 0, V: 0 }); b[x.who === 'Trump' ? 'T' : 'V']++; });
    const done = inPerson.filter((x) => !isAhead(x)), ahead = inPerson.filter(isAhead);
    const cnt = (list, who) => list.filter((x) => x.who === who).length;
    const red = done.filter((x) => D.statecomp[x.st] && D.statecomp[x.st].m24 <= -10).length;
    const tele = T.filter((x) => x.kind === 'tele-rally');
    // states with a close Senate or governor race (20-80% in today's forecast) that neither has visited or scheduled
    const res = R0 || R, gap = {};
    ['senate', 'gov'].forEach((t) => races(t).forEach((r, i) => { const p = res[t].p[i]; if (p > 0.2 && p < 0.8 && !byState[r.st]) gap[r.st] = 1; }));
    const gapNames = Object.keys(gap).sort().map((s) => STATE_NAMES[s] || s);
    let h = '<h3>On the trail: Trump and Vance</h3><p class="sub">' + esc(W.trail_note || 'Rallies and campaign stops, and the ones announced.') + '</p>';
    h += '<div class="stats trail-stats">' +
      '<div class="stat"><div class="stat-v num">' + cnt(done, 'Trump') + '</div><div class="stat-k">Trump events in person' + (cnt(ahead, 'Trump') ? ', ' + cnt(ahead, 'Trump') + ' more announced' : '') + (tele.length ? '; plus tele-rallies' : '') + '</div></div>' +
      '<div class="stat"><div class="stat-v num">' + cnt(done, 'Vance') + '</div><div class="stat-k">Vance events in person' + (cnt(ahead, 'Vance') ? ', ' + cnt(ahead, 'Vance') + ' more announced' : '') + '</div></div>' +
      '<div class="stat"><div class="stat-v num">' + red + ' of ' + done.length + '</div><div class="stat-k">in states Trump carried by 10+ points in 2024</div></div></div>';
    if (gapNames.length) h += '<p class="trail-gap">No stops yet in states with a close Senate or governor race in today\'s forecast: ' + gapNames.join(', ') + '.</p>';
    const order = T.filter(isAhead).sort((a, b) => a.date.localeCompare(b.date)).concat(T.filter((x) => !isAhead(x)).sort((a, b) => b.date.localeCompare(a.date)));
    const shown = wui.log ? order : order.slice(0, 10);
    const log = '<ol class="trail-log">' + shown.map((x) => {
      const up = isAhead(x);
      return '<li class="tl-item"><div class="tl-top"><span class="tl-date">' + fmtDay(x.date) + '</span><span class="who ' + (x.who === 'Trump' ? 'trump' : 'vance') + '">' + esc(x.who) + '</span>' +
        '<span class="tl-where">' + esc(x.city) + ', ' + esc(x.st) + '</span><span class="tl-kind">' + esc(KIND[x.kind] || x.kind || '') + '</span>' + (up ? '<span class="tag-up">' + (x.date === today ? 'Today' : 'Announced') + '</span>' : '') + '</div>' +
        (x.note ? '<p class="tl-note">' + esc(x.note) + '</p>' : '') +
        '<div class="w-meta">' + chipsFor((x.boosting || []).map((b) => b.race)) + '<span>' + srcLink(x) + '</span></div></li>';
    }).join('') + '</ol>' + (order.length > 10 ? '<button class="more w-more" data-k="log">' + (wui.log ? 'Show fewer' : 'Show all ' + order.length) + '</button>' : '');
    h += '<div class="trail-grid"><div>' + trailMap(byState) + '<p class="tmap-key">Stops by state (T = Trump, V = Vance), including announced ones. States with stops are shaded by the 2024 presidential result; gray means no stops.</p></div><div>' + log + '</div></div>';
    return h;
  }
  function renderWatch() {
    const W = D.watch || {};
    const box = $('watch'); if (!box) return;
    if (!W.upcoming && !W.happened && !W.trail) { box.innerHTML = '<h2>What to watch</h2><p class="sub">Not available right now.</p>'; return; }
    const today = todayISO();
    box.innerHTML = '<h2>What to watch</h2><p class="sub">Dates ahead, recent developments that matter for control, and where Trump and Vance are campaigning. Updated daily' + (W.asof ? ', last on ' + fmtDay(W.asof) : '') +
      '. Each chance is today\'s forecast; tap one to open the race on the map.</p>' +
      '<div class="w-grid"><div class="w-up">' + watchUpcoming(W, today) + '</div>' + (D.money && D.money.races ? '<div class="w-money">' + watchMoney() + '</div>' : '') + '<div class="w-trail">' + watchTrail(W, today) + '</div><div class="w-hap">' + watchHappened(W) + '</div></div>';
  }
  function wireWatch() {
    const box = $('watch'); if (!box) return;
    box.addEventListener('click', (e) => {
      const chip = e.target.closest('.rchip');
      if (chip) { goRace(chip.dataset.race); return; }
      const more = e.target.closest('.w-more');
      if (more) { wui[more.dataset.k] = !wui[more.dataset.k]; renderWatch(); return; }
      const mt = e.target.closest('.mtab-btn');
      if (mt) { wui.mtab = mt.dataset.m; wui.mall = false; renderWatch(); }
    });
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
    // in-page links to a section open that section's screen on phones (delegated: some links are drawn later)
    const JUMP = { 'early-vote': 'early', watch: 'watch', method: 'adjust', backtest: 'outlook' };
    document.addEventListener('click', (e) => {
      const a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      const id = a.getAttribute('href').slice(1), s = JUMP[id];
      if (!s || !isTabbed()) return;
      e.preventDefault();
      if (ui.screen !== s) showScreen(s, true);
      if (id === 'backtest') { const el = $(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
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
  buildPollsters();
  buildXtabs();
  wireControls();
  wireMap();
  wireScreens();
  buildMethod();
  renderBacktest();
  R = M.simulate(sc);
  buildEarlyVote();
  applyLayout();
  render();
  renderWatch();
  wireWatch();
  initLens();
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
    const labels = { early_vote: 'Early-vote counts', electindex: 'Polls and candidates', generic_ballot: 'National polling average', nc_sbe: 'North Carolina early-vote comparison', fec: 'Campaign money (FEC)', backtest: 'Our forecast' };
    const stale = Object.keys(meta.sources || {}).filter((k) => !meta.sources[k].ok);
    const ageH = meta.generated ? (Date.now() - new Date(meta.generated).getTime()) / 3600000 : 0;
    if (ageH > 36) { chip.textContent = 'Not updated since ' + fmtStamp(meta.generated); chip.hidden = false; }
    else if (stale.length) {
      const k = stale[0], lo = meta.sources[k].last_ok;
      chip.textContent = (labels[k] || k) + ' didn\'t refresh' + (lo ? '; last good ' + fmtStamp(lo) : '');
      chip.title = stale.map((x) => (labels[x] || x) + ': ' + meta.sources[x].detail).join('\n');
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
