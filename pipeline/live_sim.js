// Election night: the forecast conditioned on race calls and counted votes, written to live.json for the app.
//
//   node pipeline/live_sim.js site/data.json calls.json live_feeds.json live.json
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
  races,
};
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`live ${stamp}${test ? ' TEST' : ''}: House ${Math.round(now.h * 100)}% (pre ${Math.round(pre.h * 100)}), Senate ${Math.round(now.s * 100)}% (pre ${Math.round(pre.s * 100)}), Gov ${Math.round(now.g * 100)}%; nat ${now.nat}±${now.natsd}; calls ${now.calls}, obs ${now.obs}, ess ${now.ess}, tau ${now.tau}; ${races.length} races listed`);
