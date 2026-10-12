// Scenario model for the 2026 midterm map. Pure functions; the page and the Node tests share this file.
// Margins are Democratic minus Republican, in two-party percentage points.
(function (root) {
  'use strict';

  const DIMS = ['race', 'age', 'gender'];
  const SIG = { nat: 3.9, state: 2.0, house: 5.0, sen: 3.8, gov: 4.5 };
  const NSIM = 4000;
  // Demographic errors: in each simulation every group can land a few points off the scenario (SD, pts of margin),
  // moving each district and state by how far its electorate differs from the nation's. Places with similar voters
  // therefore miss together, as polls did with white non-college voters in 2016 and 2020 and Hispanic voters in 2020 and 2024.
  const DEMO_SD = { race: [4, 4, 5, 7, 6], age: [5, 3, 3, 3] };
  const STATE_SD_DEMO = 1.9;   // state error is trimmed so a typical state's total uncertainty stays the same

  // ---------- random numbers (seeded, so results do not jitter as sliders move)
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }
  function normals(n, rand) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 2) {
      const u = Math.max(rand(), 1e-12), v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      out[i] = r * Math.cos(2 * Math.PI * v);
      if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
    }
    return out;
  }

  function Model(data) {
    this.d = data;
    const D = data;
    this.N24 = D.N24;
    this.base24 = D.base['2024'];
    this.base22 = D.base['2022'];
    this.states = Object.keys(D.statecomp).sort();
    this.stIndex = {};
    this.states.forEach((s, i) => { this.stIndex[s] = i; });
    // Turnout-level interpolation anchors (VEP %)
    this.T22 = D.vep['2022'];
    this.T24 = D.vep['2024'];
    this._draws();
    this.defaults = this.defaultScenario();
    this.defaultDeltas = this.statewideDeltas(this.defaults);
  }

  Model.prototype._draws = function () {
    const rand = rng(20261103);
    const nd = this.d.districts.length, ns = this.states.length;
    const nsen = this.d.senate.length, ngov = this.d.gov.length;
    this.zN = new Float32Array(NSIM);
    // national error: Student t with 5 df, scaled to unit variance (fat tails, as in the Oct 9 Senate model)
    const zz = normals(NSIM * 6, rand);
    for (let k = 0; k < NSIM; k++) {
      let chi = 0;
      for (let j = 1; j <= 5; j++) chi += zz[k * 6 + j] * zz[k * 6 + j];
      this.zN[k] = (zz[k * 6] / Math.sqrt(chi / 5)) * Math.sqrt(3 / 5);
    }
    this.zS = normals(NSIM * ns, rand);
    this.zD = normals(NSIM * nd, rand);
    this.zSen = normals(NSIM * nsen, rand);
    this.zGov = normals(NSIM * ngov, rand);
    this.zDemo = normals(NSIM * 9, rand);   // drawn last so the other streams are unchanged
  };

  // ---------- scenario
  // Default group pattern: halfway from the 2024 validated-voter pattern toward the 2026 poll crosstabs.
  // Asian & other stays at 2024: its poll samples are tiny, and Native American voters are barely measured.
  Model.prototype.blendWeight = function (dim, i) { return dim === 'race' && i === 4 ? 0 : 0.5; };
  Model.prototype.blendDev = function (dim) {
    const D = this.d;
    return this.base24[dim].dev.map((v, i) => v + this.blendWeight(dim, i) * (D.polldev[dim][i].dev - v));
  };
  Model.prototype.defaultScenario = function () {
    const D = this.d;
    const dev = {};
    DIMS.forEach((dim) => { dev[dim] = this.blendDev(dim); });
    const sc = {
      dev,
      mult: { race: [1, 1, 1, 1, 1], age: [1, 1, 1, 1], gender: [1, 1] },
      T: this.T22,
      edge: 0,
      evw: null,           // null = automatic (share of expected vote already cast)
      sigN: SIG.nat,
      cand: true,
      demo: true,          // correlated demographic errors
      C: 0,
    };
    sc.C = this.solveC(sc, D.G0);
    return sc;
  };

  Model.prototype.clone = function (sc) { return JSON.parse(JSON.stringify(sc)); };

  // National electorate shares for a dimension at turnout level T and group multipliers
  Model.prototype.natShares = function (sc, dim) {
    const p24 = this.base24[dim].shares, p22 = this.base22[dim].shares;
    const t = (sc.T - this.T22) / (this.T24 - this.T22);
    const raw = p24.map((v, i) => Math.max(0.003, p22[i] + t * (v - p22[i])) * sc.mult[dim][i]);
    const s = raw.reduce((a, b) => a + b, 0);
    return raw.map((v) => v / s);
  };
  // Multipliers that turn a 2024 composition into the scenario composition
  Model.prototype.phi = function (sc, dim) {
    const p24 = this.base24[dim].shares;
    const ns = this.natShares(sc, dim);
    return ns.map((v, i) => v / p24[i]);
  };

  Model.prototype.groupSum = function (sc) {
    let s = 0;
    DIMS.forEach((dim) => {
      const ns = this.natShares(sc, dim);
      s += ns.reduce((a, v, i) => a + v * sc.dev[dim][i], 0);
    });
    return s;
  };
  Model.prototype.solveC = function (sc, target) { return target - this.groupSum(sc); };
  Model.prototype.national = function (sc) { return sc.C + this.groupSum(sc); };

  // Displayed margin of each group in a dimension
  Model.prototype.groupMargins = function (sc, dim) {
    let other = 0;
    DIMS.forEach((d2) => {
      if (d2 === dim) return;
      const ns = this.natShares(sc, d2);
      other += ns.reduce((a, v, i) => a + v * sc.dev[d2][i], 0);
    });
    return sc.dev[dim].map((v) => sc.C + v + other);
  };
  // Set one group's margin; other dimensions shift through the national total, as they should
  Model.prototype.setGroupMargin = function (sc, dim, i, value) {
    const cur = this.groupMargins(sc, dim)[i];
    sc.dev[dim][i] += value - cur;
  };

  // ---------- early vote
  // Automatic weight: the share of the expected vote that had been cast when the same-point comparisons
  // behind the early-vote projection were measured (they are refreshed by hand, so the weight is tied to them).
  Model.prototype.evAuto = function () {
    const cast = (this.d.evproj && this.d.evproj.cast_at) || this.d.ev.us.cast;
    return Math.min(0.5, cast / this.d.ballots['2022']);
  };
  Model.prototype.evWeight = function (sc) { return sc.evw === null ? this.evAuto() : sc.evw; };
  Model.prototype.evShift = function (sc) {
    return this.evWeight(sc) * (this.d.evproj.median - this.d.G0);
  };

  // Turnout-edge transform: Democratic supporters turn out k (fraction) more than Republican ones
  function edgeShift(m, e) {
    if (!e) return 0;
    const x = m / 100, k = e / 100;
    return 100 * ((x + k) / (1 + x * k) - x);
  }

  // ---------- district / state deltas from the 2024 presidential baseline
  Model.prototype.deltaFor = function (sc, race, age, m24) {
    const b = this.base24;
    const phiR = this._phi.race, phiA = this._phi.age;
    let zr = 0, za = 0;
    for (let i = 0; i < race.length; i++) zr += race[i] * phiR[i];
    for (let i = 0; i < age.length; i++) za += age[i] * phiA[i];
    let dR = 0, dA = 0;
    for (let i = 0; i < race.length; i++) dR += (race[i] * phiR[i] / zr) * sc.dev.race[i] - race[i] * b.race.dev[i];
    for (let i = 0; i < age.length; i++) dA += (age[i] * phiA[i] / za) * sc.dev.age[i] - age[i] * b.age.dev[i];
    const ng = this._natG;
    let dG = 0;
    for (let i = 0; i < ng.length; i++) dG += ng[i] * sc.dev.gender[i] - b.gender.shares[i] * b.gender.dev[i];
    const lin = (sc.C - this.N24) + dR + dA + dG + this._ev;
    return lin + edgeShift(m24 + lin, sc.edge);
  };
  Model.prototype._prep = function (sc) {
    this._phi = { race: this.phi(sc, 'race'), age: this.phi(sc, 'age') };
    this._natG = this.natShares(sc, 'gender');
    this._ev = this.evShift(sc);
  };

  Model.prototype.statewideDeltas = function (sc) {
    this._prep(sc);
    const out = {};
    for (const s of this.states) {
      const c = this.d.statecomp[s];
      out[s] = this.deltaFor(sc, c.race, c.age, c.m24);
    }
    return out;
  };

  Model.prototype.candEffect = function (d) {
    let e = 0.5 * (d.sd + d.sr);
    if (d.inc === 'D' && !d.sd) e += 2;
    if ((d.inc === 'R' || d.inc === 'I') && !d.sr) e -= 2;
    return e;
  };

  // Expected margins for every race under a scenario (no sampling)
  Model.prototype.margins = function (sc) {
    this._prep(sc);
    const house = this.d.districts.map((d) => {
      if (d.unc) return d.unc === 'D' ? 99 : -99;
      return d.m24 + this.deltaFor(sc, d.race, d.age, d.m24) + (sc.cand ? this.candEffect(d) : 0);
    });
    const sd = this.statewideDeltas(sc);
    const senate = this.d.senate.map((r) => r.base + 1.0 * (sd[r.st] - this.defaultDeltas[r.st]));
    const gov = this.d.gov.map((r) => r.base + 0.8 * (sd[r.st] - this.defaultDeltas[r.st]));
    return { house, senate, gov, national: this.national(sc) + this._ev };
  };

  // How far each electorate's mix differs from the nation's, for the demographic errors (race 5 + age 4 groups)
  Model.prototype.demoCoef = function (sc, race, age) {
    const nr = this.natShares(sc, 'race'), na = this.natShares(sc, 'age');
    const pr = this.phi(sc, 'race'), pa = this.phi(sc, 'age');
    const cr = race.map((v, i) => v * pr[i]), ca = age.map((v, i) => v * pa[i]);
    const zr = cr.reduce((a, b) => a + b, 0), za = ca.reduce((a, b) => a + b, 0);
    return cr.map((v, i) => (v / zr - nr[i]) * DEMO_SD.race[i]).concat(ca.map((v, i) => (v / za - na[i]) * DEMO_SD.age[i]));
  };
  Model.prototype.demoSD = function (coef) { return Math.sqrt(coef.reduce((a, c) => a + c * c, 0)); };

  // ---------- simulation
  Model.prototype.simulate = function (sc, nsim) {
    const n = Math.min(nsim || NSIM, NSIM);
    const m = this.margins(sc);
    const D = this.d, ns = this.states.length;
    const nd = D.districts.length, nsen = D.senate.length, ngov = D.gov.length;
    const sN = sc.sigN, demo = sc.demo !== false, sS = demo ? STATE_SD_DEMO : SIG.state;
    // demographic error coefficients (already scaled by each group's SD)
    const dCoef = demo ? D.districts.map((d) => this.demoCoef(sc, d.race, d.age)) : null;
    const stCoef = demo ? this.states.map((s) => this.demoCoef(sc, D.statecomp[s].race, D.statecomp[s].age)) : null;
    const dDemo = new Float64Array(nd), stDemo = new Float64Array(ns);
    const dSt = D.districts.map((d) => this.stIndex[d.st]);
    const senSt = D.senate.map((r) => this.stIndex[r.st]);
    const govSt = D.gov.map((r) => this.stIndex[r.st]);
    const hWin = new Float64Array(nd), sWin = new Float64Array(nsen), gWin = new Float64Array(ngov);
    const hHist = new Int32Array(436), sHist = new Int32Array(101), gHist = new Int32Array(51);
    const hrHist = new Int32Array(436), srHist = new Int32Array(101), grHist = new Int32Array(51);
    let hControl = 0, sControl = 0, sRControl = 0, sOsborn = 0, gMaj = 0, hRControl = 0, gRMaj = 0;
    let hSum = 0, sSum = 0, gSum = 0, hrSum = 0, srSum = 0, grSum = 0;
    // an independent in the Republican slot (Kiley, CA-06) is not a Republican seat
    const rSideIsR = D.districts.map((d) => d.rp !== 'I');
    const osbornIdx = D.senate.findIndex((r) => r.st === 'NE');
    const SEN_FIXED_D = 34, GOV_FIXED_D = 6;
    for (let k = 0; k < n; k++) {
      const eN = this.zN[k] * sN;
      const zS = this.zS.subarray(k * ns, (k + 1) * ns);
      if (demo) {
        const zg = this.zDemo.subarray(k * 9, k * 9 + 9);
        for (let i = 0; i < nd; i++) { const c = dCoef[i]; let v = 0; for (let g = 0; g < 9; g++) v += c[g] * zg[g]; dDemo[i] = v; }
        for (let j = 0; j < ns; j++) { const c = stCoef[j]; let v = 0; for (let g = 0; g < 9; g++) v += c[g] * zg[g]; stDemo[j] = v; }
      }
      let hd = 0, hr = 0;
      const zD = this.zD.subarray(k * nd, (k + 1) * nd);
      for (let i = 0; i < nd; i++) {
        const base = m.house[i];
        let v;
        if (base > 90 || base < -90) v = base;
        else v = base + eN + zS[dSt[i]] * sS + zD[i] * SIG.house + dDemo[i];
        if (v > 0) { hd++; hWin[i]++; } else if (rSideIsR[i]) hr++;
      }
      hHist[hd]++; hSum += hd; if (hd >= 218) hControl++;
      hrHist[hr]++; hrSum += hr; if (hr >= 218) hRControl++;
      let sd = 0, osb = false;
      const zSen = this.zSen.subarray(k * nsen, (k + 1) * nsen);
      for (let i = 0; i < nsen; i++) {
        const v = m.senate[i] + eN + zS[senSt[i]] * sS + zSen[i] * SIG.sen + stDemo[senSt[i]];
        if (v > 0) {
          sWin[i]++;
          if (i === osbornIdx) osb = true; else sd++;
        }
      }
      const dSeats = SEN_FIXED_D + sd;
      const rSeats = 100 - dSeats - (osb ? 1 : 0);
      sHist[dSeats]++; sSum += dSeats;
      srHist[rSeats]++; srSum += rSeats;
      if (dSeats >= 51) sControl++;
      else if (rSeats >= 50) sRControl++;
      else sOsborn++;
      let gd = 0;
      const zG = this.zGov.subarray(k * ngov, (k + 1) * ngov);
      for (let i = 0; i < ngov; i++) {
        const v = m.gov[i] + eN + zS[govSt[i]] * sS + zG[i] * SIG.gov + stDemo[govSt[i]];
        if (v > 0) { gd++; gWin[i]++; }
      }
      const gTot = GOV_FIXED_D + gd;
      gHist[gTot]++; gSum += gTot; if (gTot >= 26) gMaj++;
      const gR = 50 - gTot;
      grHist[gR]++; grSum += gR; if (gR >= 26) gRMaj++;
    }
    const pct = (hist, q) => {
      let c = 0; for (let i = 0; i < hist.length; i++) { c += hist[i]; if (c >= q * n) return i; } return hist.length - 1;
    };
    const side = (hist, sum, ctl) => ({ mean: sum / n, control: ctl / n, hist, lo: pct(hist, 0.1), med: pct(hist, 0.5), hi: pct(hist, 0.9) });
    return {
      n, m,
      house: { p: Array.from(hWin, (x) => x / n), mean: hSum / n, control: hControl / n, hist: hHist,
        lo: pct(hHist, 0.1), med: pct(hHist, 0.5), hi: pct(hHist, 0.9), r: side(hrHist, hrSum, hRControl) },
      senate: { p: Array.from(sWin, (x) => x / n), mean: sSum / n, control: sControl / n, rcontrol: sRControl / n,
        osborn: sOsborn / n, hist: sHist, lo: pct(sHist, 0.1), med: pct(sHist, 0.5), hi: pct(sHist, 0.9), r: side(srHist, srSum, sRControl) },
      gov: { p: Array.from(gWin, (x) => x / n), mean: gSum / n, maj: gMaj / n, hist: gHist,
        lo: pct(gHist, 0.1), med: pct(gHist, 0.5), hi: pct(gHist, 0.9), r: side(grHist, grSum, gRMaj) },
    };
  };

  // Normal CDF (Abramowitz-Stegun 7.1.26)
  function Phi(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t *
      Math.exp(-x * x / 2);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  // Expected House seats and Senate seats at a set of national margins, other settings held fixed
  Model.prototype.curve = function (sc, gs) {
    const cur = this.national(sc);
    const demo = sc.demo !== false, sS = demo ? STATE_SD_DEMO : SIG.state;
    const D = this.d;
    const hSD = D.districts.map((d) => Math.sqrt(SIG.house * SIG.house + sS * sS + (demo ? Math.pow(this.demoSD(this.demoCoef(sc, d.race, d.age)), 2) : 0)));
    const senSD = D.senate.map((r) => { const c = D.statecomp[r.st]; return Math.sqrt(SIG.sen * SIG.sen + sS * sS + (demo ? Math.pow(this.demoSD(this.demoCoef(sc, c.race, c.age)), 2) : 0)); });
    const m = this.margins(sc);
    return gs.map((g) => {
      const shift = g - cur;
      let h = 0, hr = 0;
      m.house.forEach((v, i) => {
        const pd = v > 90 ? 1 : v < -90 ? 0 : Phi((v + shift) / hSD[i]);
        h += pd;
        if (this.d.districts[i].rp !== 'I') hr += 1 - pd;
      });
      let s = 34, sr = 31;
      m.senate.forEach((v, i) => {
        const pd = Phi((v + shift) / senSD[i]);
        if (this.d.senate[i].st !== 'NE') s += pd;
        sr += 1 - pd;
      });
      return { g, house: h, senate: s, houseR: hr, senateR: sr };
    });
  };

  Model.prototype.SIG = SIG;
  Model.prototype.DEMO_SD = DEMO_SD;
  Model.prototype.NSIM = NSIM;
  Model.prototype.Phi = Phi;
  root.MidtermModel = Model;
  if (typeof module !== 'undefined') module.exports = Model;
})(typeof window !== 'undefined' ? window : globalThis);
