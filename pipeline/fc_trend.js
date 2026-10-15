// Daily record of the forecast: one point per day of what the model said with every setting at its default.
//
//   node pipeline/fc_trend.js site/data.json                   # add/replace today's point in data.json's fc_hist
//   node pipeline/fc_trend.js site/data.json --from old.json --date 2026-10-12   # backfill from an older data file
//
// Runs the app's own model (site/model.js) on the data file, so the numbers match the forecast card: "ours" is the
// backtested forecast (basis "ours"), "polls" the same model on the raw polling average. Each point keeps the national
// vote, the chamber odds and seat means, and every Senate and governor race's Democratic chance, so the app can show
// how the forecast has moved and which races moved it. Backfilled points re-run today's model on that day's inputs.
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const target = args[0];
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const from = opt('--from') || target;
const dateArg = opt('--date');
if (!target) { console.error('usage: node pipeline/fc_trend.js site/data.json [--from file] [--date YYYY-MM-DD]'); process.exit(2); }

const Model = require(path.resolve(__dirname, '..', 'site', 'model.js'));
const data = JSON.parse(fs.readFileSync(target, 'utf8'));
const src = from === target ? data : JSON.parse(fs.readFileSync(from, 'utf8'));

// the date of the point: ET date of the source file's build, unless given
function etDate(iso) {
  const t = iso ? new Date(iso) : new Date();
  const et = new Date(t.getTime() - 4 * 3600 * 1000);   // EDT through Nov 1; EST after (the hour difference never changes the day at build times)
  return et.toISOString().slice(0, 10);
}
const date = dateArg || etDate(src.meta && src.meta.generated);

const m = new Model(JSON.parse(JSON.stringify(src)));
const pc = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;
function run(sc) {
  const r = m.simulate(sc);
  const out = {
    nat: r1(m.target(m.basis(sc)) + m.evShift(sc)),   // national vote the scenario actually used (basis target plus the early-vote shift)
    house: r1(r.house.mean), hp: pc(r.house.control), senate: r1(r.senate.mean), sp: pc(r.senate.control), gov: r1(r.gov.mean), gp: pc(r.gov.maj),
    sen: {}, govp: {},
  };
  src.senate.forEach((s, i) => { out.sen[s.id] = pc(r.senate.p[i]); });
  src.gov.forEach((s, i) => { out.govp[s.id] = pc(r.gov.p[i]); });
  return out;
}
const polls = run(m.clone(m.defaultsPolls));
const ours = m.hasIndep ? run(m.clone(m.defaults)) : null;
const point = {
  date, at: (src.meta && src.meta.generated) || new Date().toISOString(),
  G0: src.G0, nat: src.indep ? src.indep.national : null, sig: src.indep ? src.indep.sig : null,
  ev: src.ev && src.ev.us ? Math.round(src.ev.us.cast) : null,
  ours, polls,
};
const hist = (data.fc_hist || []).filter((h) => h.date !== date);
hist.push(point);
hist.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
data.fc_hist = hist;
fs.writeFileSync(target, JSON.stringify(data));
const o = ours || polls;
console.log(`fc_trend ${date}: ${ours ? 'ours' : 'polls only'} nat ${o.nat} House ${o.house} (${Math.round(o.hp * 100)}%) Senate ${o.senate} (${Math.round(o.sp * 100)}%) Gov ${o.gov} (${Math.round(o.gp * 100)}%); ${hist.length} points`);
