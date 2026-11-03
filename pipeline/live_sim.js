// Election night: the forecast conditioned on race calls and counted votes, written to live.json for the app.
//
//   node pipeline/live_sim.js site/data.json calls.json live_feeds.json live.json [eday.json]
//
// calls.json   pipeline/content/calls.json from main: races called by the AP (or, where the AP could not be read, by
//              at least two major news desks), with tallies of called seats. Maintained hourly on election night.
// live_feeds   pipeline/live.py's reading of the official North Carolina and Florida results files.
// live.json    read (for the night's timeline) and rewritten. Its "pre" block is the forecast with no evidence, from the
//              same draws, so "before tonight" and "now" differ only by what has been learned.
'use strict';
const fs = require('fs');
const path = require('path');

const [dataPath, callsPath, feedsPath, outPath] = process.argv.slice(2);
if (!outPath) { console.error('usage: node pipeline/live_sim.js data.json calls.json live_feeds.json live.json'); process.exit(2); }
const Model = require(path.resolve(__dirname, '..', 'site', 'model.js'));
const readJSON = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } };

const data = readJSON(dataPath);
const callsFile = readJSON(callsPath, {}) || {};
const feeds = readJSON(feedsPath, {}) || {};
const prev = readJSON(outPath, {}) || {};
const test = !!feeds.test || !!callsFile.test;

const m = new Model(JSON.parse(JSON.stringify(data)));
const sc = m.clone(m.defaults);

// calls: {id: {winner: 'D'|'R'|'I', ...}} or {id: 'D'}
const calls = {};
Object.entries(callsFile.races || {}).forEach(([id, v]) => {
  const w = typeof v === 'string' ? v : v && v.winner;
  if (w) calls[id] = String(w).toUpperCase();
});
const obs = (feeds.obs || []).filter((o) => !calls[o.id]);   // a called race needs no projection

// Election Day turnout (pipeline/content/eday.json, kept hourly on Nov 3): light evidence until counts arrive.
// For a state with Election Day check-ins by party registration, the gap among today's voters (D minus R, % of all)
// is compared with Election Day in a baseline year (2022 preferred, then 2018, then 2024, a presidential year). The
// difference, times today's expected share of the state's ballots and the registration-to-margin slope from the
// 2020->2024 early-vote calibration (0.84), shifts the state's statewide race from the forecast's expected margin.
// SD 10 points (2022 base), 11 (2018), 12 (2024), x1.3 under 200,000 check-ins: weak next to a count, and dropped
// once the official count for that race is in (it then has its own projection in feeds.obs) or the race is called.
const edayPath = process.argv[6];
const eday = edayPath ? readJSON(edayPath, null) : null;
const edayEv = [];
if (eday && Array.isArray(eday.states)) {
  const mm = m.margins(sc);
  const raceMargin = {};
  data.senate.forEach((x, i) => { raceMargin[x.id] = mm.senate[i]; });
  data.gov.forEach((x, i) => { raceMargin[x.id] = mm.gov[i]; });
  const gapOf = (x) => { const t = (+x.r || 0) + (+x.d || 0) + (+x.o || 0); return t > 0 ? 100 * ((+x.d || 0) - (+x.r || 0)) / t : null; };
  eday.states.forEach((st) => {
    if (st.kind !== 'party' || !Array.isArray(st.eday) || !st.eday.length || st.use === false) return;
    const snap = st.eday[st.eday.length - 1];
    const g26 = isFinite(+snap.gap) && snap.r == null ? +snap.gap : gapOf(snap);
    const n = (+snap.r || 0) + (+snap.d || 0) + (+snap.o || 0);
    let base = null, yr = null;
    // a same-time-of-day comparison beats a full-day one; among full days, a midterm beats a presidential year
    const bases = st.base || {};
    const ok = (y) => bases[y] && bases[y].eday_gap != null && isFinite(+bases[y].eday_gap);
    const order = ['2022', '2018', '2024'];
    const pick = order.find((y) => ok(y) && bases[y].same_time) || order.find(ok);
    if (pick) { base = +bases[pick].eday_gap; yr = pick; }
    const sameTime = !!(pick && bases[pick].same_time);
    const races = (st.races || [st.race]).filter((id) => id && raceMargin[id] != null);
    if (g26 == null || base == null || !races.length) return;
    const share = isFinite(+st.eday_share) ? +st.eday_share : 0.3;
    const shift = 0.84 * share * (g26 - base);
    // turnout says who showed up, not how they voted: as a reading of the final margin it is worth about a quarter of
    // the forecast's own uncertainty (race SD ~5-6 points against these 10-13), so it nudges rather than decides
    const sd = (yr === '2022' ? 10 : yr === '2018' ? 11 : 12) * (n > 0 && n >= 200000 ? 1 : 1.3);
    races.forEach((id) => {
      const used = !calls[id] && !obs.some((o) => o.id === id);
      if (used) obs.push({ id, margin: Math.round((raceMargin[id] + shift) * 100) / 100, sd, why: 'election day turnout' });
      edayEv.push({ st: st.st, id, gap: Math.round(g26 * 10) / 10, base, base_year: yr, same_time: sameTime, share, shift: Math.round(shift * 100) / 100, sd, n, t: snap.t, used,
        expected: Math.round(raceMargin[id] * 10) / 10 });
    });
  });
}

const NSIM = 20000;
const pc = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;
const pack = (r) => ({
  h: pc(r.house.control), hs: r1(r.house.mean), hlo: r.house.lo, hhi: r.house.hi,
  s: pc(r.senate.control), ss: r1(r.senate.mean), slo: r.senate.lo, shi: r.senate.hi, so: pc(r.senate.osborn),
  g: pc(r.gov.maj), gs: r1(r.gov.mean),
  nat: r1(r.national.mean), natsd: r1(r.national.sd),
});
// the no-evidence forecast is recomputed only when the data file changes
let pre = prev.pre && prev.test === test && prev.pre_from === (data.meta && data.meta.generated) ? prev.pre : null;   // same snapshot all night
let preRace = prev.pre_race && pre ? prev.pre_race : null;
if (!pre) {
  const r0 = m.simulateLive(sc, {}, { n: NSIM });
  pre = pack(r0);
  preRace = {};
  data.districts.forEach((d, i) => { preRace[d.id] = pc(r0.house.p[i]); });
  data.senate.forEach((x, i) => { preRace[x.id] = pc(r0.senate.p[i]); });
  data.gov.forEach((x, i) => { preRace[x.id] = pc(r0.gov.p[i]); });
}
const r = m.simulateLive(sc, { calls, obs }, { n: NSIM });
const now = Object.assign(pack(r), { ess: r.ess, tau: r.tau, calls: r.nCalls, obs: r.nObs });

// races to show: every Senate and governor race that was not a lock, the House races that were closest, and any race
// with a call or counted votes
const races = [];
const add = (kind, x, i, pNow) => {
  const p0 = preRace[x.id];
  const f = (feeds.races || {})[x.id];
  const call = calls[x.id] || null;
  const close = p0 > 0.03 && p0 < 0.97;
  if (!close && !call && !(f && f.d + f.r > 0)) return;
  races.push({
    id: x.id, kind, st: x.st,
    dn: kind === 'house' ? x.dn : x.dn, rn: x.rn, dp: x.dp || 'D',
    pre: p0, now: pc(pNow), call,
    count: f && f.d + f.r > 0 ? { d: f.d, r: f.r, o: f.o, frac: f.frac, margin: f.margin, proj: f.proj && f.proj.margin != null ? { margin: f.proj.margin, sd: f.proj.sd, cov: f.proj.cov, method: f.proj.method } : null } : null,
  });
};
data.senate.forEach((x, i) => add('senate', x, i, r.senate.p[i]));
data.gov.forEach((x, i) => add('gov', x, i, r.gov.p[i]));
const houseCand = data.districts.map((d, i) => ({ d, i, p0: preRace[d.id] }))
  .filter((o) => (o.p0 > 0.1 && o.p0 < 0.9) || calls[o.d.id] && o.p0 > 0.03 && o.p0 < 0.97 || ((feeds.races || {})[o.d.id] && o.p0 > 0.03 && o.p0 < 0.97))
  .sort((a, b) => Math.abs(a.p0 - 0.5) - Math.abs(b.p0 - 0.5)).slice(0, 60);
houseCand.forEach((o) => add('house', o.d, o.i, r.house.p[o.i]));

// timeline: a point when anything moved half a point, or every 10 minutes
const stamp = new Date().toISOString().slice(0, 19) + 'Z';
const tl = Array.isArray(prev.timeline) && prev.test === test ? prev.timeline.slice() : [];
const last = tl[tl.length - 1];
const moved = !last || ['h', 's', 'g'].some((k) => Math.abs(last[k] - now[k]) >= 0.005) || (Date.parse(stamp) - Date.parse(last.t)) >= 10 * 60000;
if (moved) tl.push({ t: stamp, h: now.h, s: now.s, g: now.g, nat: now.nat, calls: now.calls, obs: now.obs });

const out = {
  updated: stamp, test,
  data_from: data.meta && data.meta.generated,
  pre_from: data.meta && data.meta.generated, pre, pre_race: preRace,
  now, timeline: tl,
  calls: { asof: callsFile.asof || null, src: callsFile.src || null, n: Object.keys(calls).length, tally: callsFile.tally || null, control: callsFile.control || null, notes: callsFile.notes || null },
  feeds: { fetched_at: feeds.fetched_at || null, sources: feeds.sources || {}, obs: feeds.obs || [], progress: feeds.progress },
  eday: eday ? Object.assign({}, eday, { evidence: edayEv }) : null,
  races,
};
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`live ${stamp}${test ? ' TEST' : ''}: House ${Math.round(now.h * 100)}% (pre ${Math.round(pre.h * 100)}), Senate ${Math.round(now.s * 100)}% (pre ${Math.round(pre.s * 100)}), Gov ${Math.round(now.g * 100)}%; nat ${now.nat}±${now.natsd}; calls ${now.calls}, obs ${now.obs}, ess ${now.ess}, tau ${now.tau}; ${races.length} races listed`);
