"""Official early vote by party registration: daily tracking against the same point in 2022 and 2024.

Two parts.

build-time (standard library; called from build.py every run)
    block(uf_rows, prev, today) -> the 'evreg' section of data.json: for each state whose election office reports
    returned ballots by party registration (Pennsylvania, Florida, Nevada, Colorado, Iowa, Arizona), the daily
    history of 2026 returns, the registered-Democrat-minus-Republican gap, the same gap at the same number of days
    before Election Day in 2022 and 2024, and what the change implies, using a calibration fitted on 2020 -> 2024.
    archive(uf_text, today) saves the raw UF Election Lab file (and the states' own daily files) under
    pipeline/data/earlyvote/2026/ so every number can be re-derived later.

baseline (GitHub Actions, one-off; needs openpyxl and pypdf)
    python3 pipeline/evreg.py baseline  -> pipeline/static/ev_baselines.json
    Downloads what the election offices and UF Election Lab still serve for 2020, 2022 and 2024: Colorado's daily
    ballot-return spreadsheets, Florida's archived daily status counts, Pennsylvania's archived report, UF's final
    2024 file and its 2020 state pages. Hand-entered points from dated news reports and official daily reports
    (Nevada, Iowa, Pennsylvania, Florida) live in pipeline/content/ev_points.json and are merged at build time.

Baseline point format (both files): {"st", "year", "date", "src", "url", "m": "ret"|"voted"|"ip", "all", "d", "r",
"n", "gap"}  - counts of returned ballots (m="ret": mail returned; "voted": mail returned plus in-person early;
"ip": in-person only), "gap" = 100*(d-r)/all, which may be given alone when only a lead was reported.
"""
import csv
import datetime as dt
import io
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ELECTION = {2020: dt.date(2020, 11, 3), 2022: dt.date(2022, 11, 8), 2024: dt.date(2024, 11, 5), 2026: dt.date(2026, 11, 3)}
UA = {'User-Agent': 'midterm-map early-vote tracker (github.com/DanCunningham22/2026-Midterm)'}

# States whose official daily files carry party registration, the measure the comparison uses, and the race each
# comparison is read against. m: 'ret' where early voting is (almost) all mail (the in-person figure is zero or
# tiny), 'voted' (mail plus in-person) elsewhere.
STATES = {
    'PA': dict(name='Pennsylvania', m='ret', race22='SEN', mode='mail',
               src='Pennsylvania Department of State daily mail-ballot report', ip=None),
    'FL': dict(name='Florida', m='voted', race22='GOV', mode='all',
               src='Florida Division of Elections daily vote-by-mail and early-voting statistics', ip={2022: '2022-10-24', 2024: '2024-10-21', 2026: '2026-10-19'}),
    'NV': dict(name='Nevada', m='voted', race22='SEN', mode='all',
               src='Nevada Secretary of State daily turnout reports', ip={2022: '2022-10-22', 2024: '2024-10-19', 2026: '2026-10-17'}),
    'CO': dict(name='Colorado', m='voted', race22='SEN', mode='all',
               src='Colorado Secretary of State daily ballot-return releases', ip={2022: '2022-10-24', 2024: '2024-10-21', 2026: '2026-10-19'}),
    'IA': dict(name='Iowa', m='ret', race22='SEN', mode='mail',
               src='Iowa Secretary of State daily absentee statistics', ip={2022: '2022-10-19', 2024: '2024-10-16', 2026: '2026-10-14'}),
    'AZ': dict(name='Arizona', m='voted', race22='SEN', mode='all',
               src='county early-ballot returns compiled by Stealth Analytics (no official statewide daily file)', ip=None),
}
# 2022 results read against each comparison (margin, D minus R, points) and the national House vote
RESULT22 = {'PA': dict(SEN=4.9, GOV=14.8), 'FL': dict(GOV=-19.4, SEN=-16.4), 'NV': dict(SEN=0.8, GOV=-1.5),
            'CO': dict(SEN=14.5, GOV=19.4), 'IA': dict(SEN=-12.3, GOV=-18.5), 'AZ': dict(SEN=4.9, GOV=0.7)}
RESULT24 = {'PA': dict(PRES=-1.7, SEN=-0.2), 'FL': dict(PRES=-13.1), 'NV': dict(PRES=-3.1, SEN=1.3), 'CO': dict(PRES=11.0),
            'IA': dict(PRES=-13.2), 'AZ': dict(PRES=-5.5, SEN=2.4)}
# Presidential margins (D minus R, points), used to calibrate how a change in the early vote's party gap maps to a
# change in the result. Wikipedia state results tables, rounded to a tenth.
PRES = {
    'PA': (1.2, -1.7), 'FL': (-3.4, -13.1), 'NV': (2.4, -3.1), 'AZ': (0.3, -5.5), 'CO': (13.5, 11.0), 'IA': (-8.2, -13.2),
    'NC': (-1.3, -3.2), 'ME': (9.1, 7.0), 'NM': (10.8, 6.0), 'NJ': (15.9, 5.9), 'MD': (33.2, 29.1), 'KY': (-26.0, -30.5),
    'OK': (-33.1, -34.4), 'KS': (-14.6, -16.2), 'UT': (-20.5, -21.5), 'ID': (-30.8, -36.5), 'SD': (-26.2, -29.0),
    'WY': (-43.4, -45.8), 'CT': (20.0, 14.5), 'DE': (19.0, 14.7), 'RI': (20.8, 13.8), 'OR': (16.1, 14.2),
    'CA': (29.2, 20.2), 'WV': (-38.9, -42.0), 'AR': (-27.6, -30.6), 'LA': (-18.6, -22.3), 'NE': (-19.1, -20.6),
}
MAIL_ONLY = {'PA', 'IA', 'ME', 'NE', 'ID', 'SD', 'WY', 'OR', 'CA', 'UT'}   # 2024 early vote all or nearly all by mail
FALLBACK_B = dict(all=0.5, mail=0.25)


# ---------------------------------------------------------------- helpers
def num(x):
    try:
        if x is None:
            return None
        if isinstance(x, str):
            x = x.replace(',', '').strip()
            if x in ('', 'NA', '-'):
                return None
        return float(x)
    except (TypeError, ValueError):
        return None


def get(url, timeout=90, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else data.decode('utf-8', errors='replace')


def gap_of(p):
    if p.get('gap') is not None:
        return float(p['gap'])
    if p.get('all') and p.get('d') is not None and p.get('r') is not None:
        return 100.0 * (p['d'] - p['r']) / p['all']
    return None


def days_out(year, date):
    return (ELECTION[year] - dt.date.fromisoformat(date)).days


def interp(points, k):
    """Gap (and ballots) at k days out from a year's points, by linear interpolation between the two nearest
    reports. None before the first report."""
    pts = sorted(((p['k'], p['gap'], p.get('all')) for p in points if p.get('gap') is not None), key=lambda t: -t[0])
    if not pts or k > pts[0][0]:
        return None
    for i, (kk, g, a) in enumerate(pts):
        if kk == k:
            return dict(gap=g, all=a, exact=True)
        if kk < k:
            k0, g0, a0 = pts[i - 1]
            w = (k0 - k) / (k0 - kk)
            return dict(gap=g0 + w * (g - g0), all=(a0 + w * (a - a0)) if a0 and a else (a or a0), exact=False)
    return dict(gap=pts[-1][1], all=pts[-1][2], exact=False)


# ---------------------------------------------------------------- build time
def read_uf(rows):
    """UF Election Lab rows -> {st: {asof, req, ret, ip, voted}} with each as [d, r, none, all]."""
    out = {}
    for r in rows:
        st = (r.get('state_abbv') or '').strip()
        if st not in STATES:
            continue
        lu = (r.get('last_update') or '').strip()
        try:
            m, d, y = lu.split('/')
            asof = dt.date(int(y), int(m), int(d)).isoformat()
        except ValueError:
            continue
        def quad(pre):
            v = [num(r.get(f'{pre}_dem')), num(r.get(f'{pre}_rep')), num(r.get(f'{pre}_none')), num(r.get(f'{pre}_all'))]
            return v if v[3] else None
        out[st] = dict(asof=asof, req=quad('request'), ret=quad('accept'), ip=quad('inperson'), voted=quad('voted'))
    return out


def update_history(prev_hist, cur):
    """One entry per state per as-of date; the latest run for a date wins."""
    hist = {}
    for h in prev_hist or []:
        hist[(h['st'], h['date'])] = h
    for st, v in cur.items():
        if not (v.get('ret') or v.get('voted')):
            continue
        hist[(st, v['asof'])] = dict(st=st, date=v['asof'], req=v['req'], ret=v['ret'], ip=v['ip'], voted=v['voted'])
    return sorted(hist.values(), key=lambda h: (h['st'], h['date']))


def load_points(baselines, hand):
    """Merge machine-built and hand-entered baseline points -> {st: {year: {m: [points]}}}."""
    pts = {}
    for p in (baselines or {}).get('points', []) + (hand or {}).get('points', []):
        try:
            k = days_out(int(p['year']), p['date'])
        except (KeyError, ValueError):
            continue
        g = gap_of(p)
        if g is None:
            continue
        q = dict(p)
        q['k'] = k
        q['gap'] = round(g, 2)
        pts.setdefault(p['st'], {}).setdefault(int(p['year']), {}).setdefault(p.get('m', 'voted'), []).append(q)
    return pts


def calibrate(finals):
    """Slope of the change in a state's presidential margin, 2020 -> 2024, on the change in its final early vote's
    D-minus-R gap, fitted through the origin. Returns slopes for mail-only and all-mode states, with errors."""
    rows = []
    for st, (m20, m24) in PRES.items():
        f20 = (finals.get('2020') or {}).get(st)
        f24 = (finals.get('2024') or {}).get(st)
        if not f20 or not f24:
            continue
        g20, g24 = gap_of(f20), gap_of(f24)
        if g20 is None or g24 is None:
            continue
        rows.append(dict(st=st, dgap=round(g24 - g20, 1), dmargin=round(m24 - m20, 1), mail=st in MAIL_ONLY,
                         g20=round(g20, 1), g24=round(g24, 1)))

    def fit(sub):
        if len(sub) < 3:
            return None
        sxy = sum(r['dgap'] * r['dmargin'] for r in sub)
        sxx = sum(r['dgap'] ** 2 for r in sub)
        if sxx <= 0:
            return None
        b = sxy / sxx
        res = [r['dmargin'] - b * r['dgap'] for r in sub]
        s2 = sum(e * e for e in res) / max(1, len(sub) - 1)
        return dict(b=round(b, 3), se=round(math.sqrt(s2 / sxx), 3), resid=round(math.sqrt(s2), 2), n=len(sub))

    out = dict(rows=sorted(rows, key=lambda r: r['st']), all=fit([r for r in rows if not r['mail']]),
               mail=fit([r for r in rows if r['mail']]), pooled=fit(rows), source='2020 -> 2024 change, final early vote vs presidential margin')
    for k in ('all', 'mail'):
        if not out[k]:
            out[k] = dict(b=FALLBACK_B[k], se=0.25, resid=4.0, n=0, assumed=True)
    return out


def compare(hist, points, calib, nat):
    """Latest 2026 figures per state against the same days-out in 2022 and 2024."""
    latest = {}
    for h in hist:
        latest[h['st']] = h
    states = []
    for st, cfg in STATES.items():
        h = latest.get(st)
        if not h:
            continue
        m = cfg['m']
        cur = h.get(m) or h.get('ret')
        if not cur or not cur[3]:
            continue
        k = days_out(2026, h['date'])
        gap = 100.0 * (cur[0] - cur[1]) / cur[3]
        slope = calib['mail'] if cfg['mode'] == 'mail' else calib['all']
        row = dict(st=st, name=cfg['name'], m=m, mode=cfg['mode'], asof=h['date'], k=k, all=round(cur[3]),
                   d=round(100.0 * cur[0] / cur[3], 1), r=round(100.0 * cur[1] / cur[3], 1), gap=round(gap, 1),
                   ret=h.get('ret'), ip=h.get('ip'), req=h.get('req'), b=slope['b'], src=cfg['src'],
                   ip_start=(cfg['ip'] or {}).get(2026), series=[])
        # the state's own 2026 series, for the chart
        for x in hist:
            if x['st'] != st:
                continue
            c = x.get(m) or x.get('ret')
            if c and c[3]:
                row['series'].append([days_out(2026, x['date']), round(100.0 * (c[0] - c[1]) / c[3], 2), round(c[3])])
        for yr in (2022, 2024):
            pts = (points.get(st, {}).get(yr, {}) or {}).get(m) or []
            # mail-only states report the same thing under either name
            if not pts and m == 'voted':
                pts = points.get(st, {}).get(yr, {}).get('ret') or []
            bl = interp(pts, k)
            key = f'y{yr % 100}'
            if not bl:
                first = max((p['k'] for p in pts), default=None)
                row[key] = dict(gap=None, first_k=first, n=len(pts))
                continue
            dg = gap - bl['gap']
            implied = slope['b'] * dg
            se = math.sqrt((slope['se'] * dg) ** 2 + slope['resid'] ** 2)
            res = (RESULT22 if yr == 2022 else RESULT24).get(st, {})
            race = cfg['race22'] if yr == 2022 else 'PRES'
            row[key] = dict(gap=round(bl['gap'], 1), all=round(bl['all']) if bl.get('all') else None, exact=bl['exact'],
                            dgap=round(dg, 1), dmargin=round(implied, 1), se=round(se, 1), n=len(pts),
                            race=race, result=res.get(race), implied_state=round(res[race] + implied, 1) if res.get(race) is not None else None,
                            implied_nat=round(nat[yr] + implied, 1) if nat.get(yr) is not None else None,
                            series=[[p['k'], p['gap'], p.get('all')] for p in sorted(pts, key=lambda p: -p['k'])])
        states.append(row)
    # pooled: inverse-variance mean of the implied change, vs 2022 (the midterm-to-midterm comparison) and vs 2024
    pooled = {}
    for yr, key in ((2022, 'y22'), (2024, 'y24')):
        use = [s for s in states if s.get(key, {}).get('dmargin') is not None and not (yr == 2024 and s['mode'] == 'mail')]
        if not use:
            pooled[key] = None
            continue
        w = [1.0 / s[key]['se'] ** 2 for s in use]
        mean = sum(wi * s[key]['dmargin'] for wi, s in zip(w, use)) / sum(w)
        se = math.sqrt(1.0 / sum(w))
        pooled[key] = dict(dmargin=round(mean, 1), se=round(se, 1), n=len(use), states=[s['st'] for s in use],
                           implied_nat=round(nat[yr] + mean, 1) if nat.get(yr) is not None else None, base=nat.get(yr))
    return states, pooled


def block(uf_rows, prev, today, baselines=None, hand=None, nat=None):
    cur = read_uf(uf_rows)
    hist = update_history((prev or {}).get('hist'), cur)
    points = load_points(baselines, hand)
    calib = calibrate((baselines or {}).get('finals') or {})
    nat = nat or {2022: -2.72, 2024: -2.56}
    states, pooled = compare(hist, points, calib, nat)
    notes = (hand or {}).get('notes') or {}
    return dict(asof=today.isoformat(), hist=hist, states=states, pooled=pooled, calib=calib, nat=nat, notes=notes,
                baseline_built=(baselines or {}).get('built'))


def archive(today, uf_text=None, log=print):
    """Save the day's raw official files under pipeline/data/earlyvote/2026/ (only when they changed)."""
    d = os.path.join(ROOT, 'pipeline', 'data', 'earlyvote', '2026')
    os.makedirs(d, exist_ok=True)
    saved = []

    def put(name, data):
        path = os.path.join(d, name)
        if os.path.exists(path):
            with open(path, 'rb') as f:
                if f.read() == data:
                    return
        with open(path, 'wb') as f:
            f.write(data)
        saved.append(name)

    tag = today.isoformat()
    if uf_text:
        put(f'uf_US_{tag}.csv', uf_text.encode('utf-8'))
    files = {
        f'pa_mail_{tag}.xlsx': 'https://www.pavoterservices.pa.gov/2026%20General%20Daily%20Mail%20Ballot%20Report.xlsx',
        f'fl_vbm_voted_{tag}.txt': 'https://electionfiles.floridados.gov/countyballotreportfiles/Stats_49894_VbmVoted.txt',
        f'fl_vbm_provided_{tag}.txt': 'https://electionfiles.floridados.gov/countyballotreportfiles/Stats_49894_VbmProvided.txt',
        f'fl_ev_voted_{tag}.txt': 'https://electionfiles.floridados.gov/countyballotreportfiles/Stats_49894_EvVoted.txt',
    }
    # Colorado posts a release each weekday from about three weeks out, dated the day after the data
    for back in (0, 1):
        dd = today - dt.timedelta(days=back)
        files[f'co_release_{dd.isoformat()}.html'] = f'https://www.coloradosos.gov/pubs/newsRoom/pressReleases/2026/PR{dd.strftime("%Y%m%d")}BallotReturns.html'
    for name, url in files.items():
        try:
            data = get(url, timeout=45, binary=True)
            if len(data) < 200:
                continue
            put(name, data)
            if name.startswith('co_release'):
                m = re.search(r'href=["\']([^"\']+\.xlsx)["\']', data.decode('utf-8', errors='replace'), re.I)
                if m:
                    xurl = urllib.parse.urljoin(url, m.group(1))
                    put('co_' + os.path.basename(xurl), get(xurl, timeout=60, binary=True))
        except Exception as e:  # a missing file is normal before a state's reports begin
            log(f'evreg archive {name}: {str(e)[:80]}')
    return saved


# ---------------------------------------------------------------- baseline (GitHub Actions)
def _xlsx_rows(data, sheet_match):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    for ws in wb.worksheets:
        if re.search(sheet_match, ws.title, re.I):
            return [list(r) for r in ws.iter_rows(values_only=True)]
    return None


def co_points(year, log):
    """Colorado: statewide returned ballots by party from each release's spreadsheet."""
    pts = []
    el = ELECTION[year]
    d = el - dt.timedelta(days=24)
    while d <= el + dt.timedelta(days=1):
        url = f'https://www.coloradosos.gov/pubs/newsRoom/pressReleases/{year}/PR{d.strftime("%Y%m%d")}BallotReturns.html'
        try:
            html = get(url, timeout=40)
        except Exception:
            d += dt.timedelta(days=1)
            continue
        m = re.search(r'href=["\']([^"\']+\.xlsx)["\']', html, re.I)
        if not m:
            d += dt.timedelta(days=1)
            continue
        xurl = urllib.parse.urljoin(url, m.group(1))
        try:
            rows = _xlsx_rows(get(xurl, timeout=60, binary=True), r'All_Returned_Ballots_By_County|Returned.*County')
            hdr = next(r for r in rows if r and any(str(c).strip().upper() == 'COUNTY' for c in r if c))
            idx = {str(c).strip().upper(): i for i, c in enumerate(hdr) if c}
            tot = next(r for r in rows if r and str(r[0]).strip().lower() == 'grand total')
            dem, rep, allv = num(tot[idx['DEM']]), num(tot[idx['REP']]), num(tot[idx['GRAND TOTAL']])
            # the data is as of 11:59 PM of the date in the spreadsheet's name
            dm = re.search(r'(\d{8})', os.path.basename(xurl))
            asof = dt.datetime.strptime(dm.group(1), '%Y%m%d').date().isoformat() if dm else (d - dt.timedelta(days=1)).isoformat()
            ip = None
            try:
                ga = _xlsx_rows(get(xurl, timeout=60, binary=True), r'GenderAge')
                h2 = next(r for r in ga if r and any(str(c).strip() == 'In Person' for c in r if c))
                h1 = next(r for r in ga if r and any(str(c).strip() == 'DEM' for c in r if c))
                cols = {}
                party = None
                for i, c in enumerate(h1):
                    if c and str(c).strip() in ('DEM', 'REP', 'UAF'):
                        party = str(c).strip()
                    if party and i < len(h2) and h2[i] and str(h2[i]).strip() == 'In Person':
                        cols[party] = i
                tot2 = next(r for r in ga if r and str(r[0]).strip().lower() in ('grand total', 'total'))
                ip = dict(d=num(tot2[cols['DEM']]), r=num(tot2[cols['REP']]))
            except Exception:
                pass
            p = dict(st='CO', year=year, date=asof, m='voted', all=allv, d=dem, r=rep, n=(allv - dem - rep) if allv else None,
                     src='Colorado Secretary of State ballot-return release', url=url)
            if ip and ip['d'] is not None:
                p['ip_d'], p['ip_r'] = ip['d'], ip['r']
            pts.append(p)
            log(f'CO {asof}: {allv:,.0f} D {dem:,.0f} R {rep:,.0f}')
        except Exception as e:
            log(f'CO {d}: {e}')
        d += dt.timedelta(days=1)
    return pts


FL_PDF = {2022: 'https://files.floridados.gov/media/706191/2022-ge-rptstatuscountsarchive-ev-vbm.pdf',
          2024: 'https://files.floridados.gov/media/708648/2024gen_vbm-ev_statuscounts.pdf'}


def fl_points(year, log, scratch=None):
    """Florida: the Division of Elections' archived daily status counts (statewide, by party)."""
    from pypdf import PdfReader
    data = get(FL_PDF[year], timeout=120, binary=True)
    text = '\n'.join((pg.extract_text() or '') for pg in PdfReader(io.BytesIO(data)).pages)
    if scratch:
        with open(os.path.join(scratch, f'fl_{year}_statuscounts.txt'), 'w', encoding='utf-8') as f:
            f.write(text)
    pts = []
    # Expected: per report date, rows for vote-by-mail voted and early voting with Republican, Democrat, Other,
    # No Party Affiliation, Total. The layout is read loosely: a date on a line, then labelled rows of five numbers.
    cur_date = None
    rec = {}
    def flush():
        if cur_date and ('vbm' in rec or 'ev' in rec):
            v, e = rec.get('vbm'), rec.get('ev')
            if v:
                pts.append(dict(st='FL', year=year, date=cur_date, m='ret', all=v[4], d=v[1], r=v[0], n=v[2] + v[3],
                                src='Florida Division of Elections archived status counts', url=FL_PDF[year]))
            if v and e:
                pts.append(dict(st='FL', year=year, date=cur_date, m='voted', all=v[4] + e[4], d=v[1] + e[1], r=v[0] + e[0],
                                n=v[2] + v[3] + e[2] + e[3], src='Florida Division of Elections archived status counts', url=FL_PDF[year]))
            if e:
                pts.append(dict(st='FL', year=year, date=cur_date, m='ip', all=e[4], d=e[1], r=e[0], n=e[2] + e[3],
                                src='Florida Division of Elections archived status counts', url=FL_PDF[year]))
    for line in text.splitlines():
        dm = re.search(r'\b(\d{1,2})/(\d{1,2})/(\d{4})\b', line)
        nums = [num(x) for x in re.findall(r'\d[\d,]*', line.replace('/', ' '))]
        if dm and not re.search(r'voted|early|provided|returned', line, re.I):
            flush()
            cur_date = dt.date(int(dm.group(3)), int(dm.group(1)), int(dm.group(2))).isoformat()
            rec = {}
            continue
        if re.search(r'vote.?by.?mail', line, re.I) and re.search(r'voted|returned', line, re.I) and len(nums) >= 5:
            rec['vbm'] = nums[-5:]
        elif re.search(r'early', line, re.I) and re.search(r'voted|early vot', line, re.I) and not re.search(r'mail', line, re.I) and len(nums) >= 5:
            rec['ev'] = nums[-5:]
    flush()
    log(f'FL {year}: {len(pts)} points parsed from the archive PDF')
    return pts


def uf_finals_2024(log):
    rows = list(csv.DictReader(io.StringIO(get('https://election.lab.ufl.edu/data-downloads/earlyvote/2024/US.csv'))))
    out = {}
    for r in rows:
        st = (r.get('state_abbv') or '').strip()
        d, rp, a = num(r.get('voted_dem')), num(r.get('voted_rep')), num(r.get('voted_all'))
        if st and a and d is not None and rp is not None and d + rp > 0:
            out[st] = dict(all=a, d=d, r=rp, ret=[num(r.get('accept_dem')), num(r.get('accept_rep')), num(r.get('accept_all'))],
                           ip=[num(r.get('inperson_dem')), num(r.get('inperson_rep')), num(r.get('inperson_all'))], asof=r.get('last_update'))
    log(f'UF 2024 finals: {len(out)} states with party')
    return out


def _party_table(text, heading):
    """First 'Party ... Democrat n pct Republican n pct' table after a heading in a UF static page's text."""
    i = text.find(heading)
    if i < 0:
        return None
    seg = text[i:i + 1500]
    dm = re.search(r'Democrat[s]?\s+([\d,]+)', seg)
    rm = re.search(r'Republican[s]?\s+([\d,]+)', seg)
    tm = re.search(r'TOTAL\s+([\d,]+)', seg)
    if dm and rm and tm:
        return dict(d=num(dm.group(1)), r=num(rm.group(1)), all=num(tm.group(1)))
    return None


def uf_finals_2020(log, scratch=None):
    out = {}
    for st in PRES:
        url = f'https://electproject.github.io/Early-Vote-2020G/{st}.html'
        try:
            html = get(url, timeout=60)
        except Exception as e:
            log(f'UF 2020 {st}: {str(e)[:60]}')
            continue
        text = re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.S | re.I))
        text = re.sub(r'\s+', ' ', text)
        if scratch and st in ('PA', 'FL'):
            with open(os.path.join(scratch, f'uf2020_{st}.txt'), 'w', encoding='utf-8') as f:
                f.write(text[:12000])
        t = _party_table(text, 'Total Voted by Party Registration') or _party_table(text, 'Voted by Party Registration')
        if t:
            out[st] = t
            m = _party_table(text, 'Mail Ballots Returned by Party Registration') or _party_table(text, 'Returned Mail Ballots by Party')
            if m:
                out[st]['ret'] = [m['d'], m['r'], m['all']]
    log(f'UF 2020 finals: {len(out)} states with party')
    return out


def rpubs_finals_2022(log, scratch=None):
    """The 2022 tracker's state pages (RPubs): final 2022 early vote by party."""
    out = {}
    try:
        page = get('https://rpubs.com/ElectProject/early_vote_2022', timeout=60)
        fr = re.search(r'<iframe[^>]+src=["\']([^"\']+)["\']', page, re.I)
        inner_url = urllib.parse.urljoin('https://rpubs.com/', fr.group(1))
        inner = get(inner_url, timeout=60)
    except Exception as e:
        log(f'RPubs 2022: {e}')
        return out
    links = dict(re.findall(r'href=["\']([^"\']+)["\'][^>]*>\s*([A-Z]{2})\s*<', inner))
    links = {v: k for k, v in links.items()}
    if scratch:
        with open(os.path.join(scratch, 'rpubs_2022_links.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(f'{k} {v}' for k, v in links.items()))
    for st, href in links.items():
        if st not in PRES:
            continue
        try:
            html = get(urllib.parse.urljoin(inner_url, href), timeout=60)
            fr = re.search(r'<iframe[^>]+src=["\']([^"\']+)["\']', html, re.I)
            if fr:
                html = get(urllib.parse.urljoin('https://rpubs.com/', fr.group(1)), timeout=60)
            text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.S | re.I)))
            t = _party_table(text, 'Total Voted by Party Registration')
            if t:
                out[st] = t
                m = _party_table(text, 'Mail Ballots by Party Registration') or _party_table(text, 'Returned Mail Ballots by Party')
                if m:
                    out[st]['ret'] = [m['d'], m['r'], m['all']]
        except Exception as e:
            log(f'RPubs 2022 {st}: {str(e)[:60]}')
    log(f'RPubs 2022 finals: {len(out)} states')
    return out


def pa_wayback_points(log):
    """Pennsylvania: archived copies of the 2024 daily report (statewide sums over counties)."""
    pts = []
    url = 'https://www.pavoterservices.pa.gov/2024%20General%20Daily%20Mail%20Ballot%20Report.xlsx'
    for ts in ('20240925205010', '20241106025323'):
        try:
            data = wayback_get(f'https://web.archive.org/web/{ts}id_/{url}', binary=True)
            rows = _xlsx_rows(data, r'^Total$|Total')
            head = ' '.join(str(c) for r in rows[:3] for c in (r or []) if c)
            dm = re.search(r'as of (\d{1,2})/(\d{1,2})/(\d{4})', head)
            asof = dt.date(int(dm.group(3)), int(dm.group(1)), int(dm.group(2))).isoformat() if dm else None
            hdr = next(r for r in rows if r and any('CountyName' in str(c) for c in r if c))
            idx = {str(c).strip(): i for i, c in enumerate(hdr) if c}
            col = lambda pat: next(i for k, i in idx.items() if re.search(pat, k, re.I))
            rd, rr, rt = col(r'Dem.*Returned'), col(r'Rep.*Returned'), col(r'Total.*Returned')
            ad, ar, at = col(r'Dem.*Approved'), col(r'Rep.*Approved'), col(r'Total.*Approved')
            body = [r for r in rows[rows.index(hdr) + 1:] if r and r[0] and num(r[rt]) is not None]
            s = lambda i: sum(num(r[i]) or 0 for r in body)
            pts.append(dict(st='PA', year=2024, date=asof, m='ret', all=s(rt), d=s(rd), r=s(rr), n=s(rt) - s(rd) - s(rr),
                            req=[s(ad), s(ar), s(at)], src='Pennsylvania Department of State daily report (Wayback Machine copy)',
                            url=f'https://web.archive.org/web/{ts}/{url}'))
            log(f'PA {asof}: returned {s(rt):,.0f} D {s(rd):,.0f} R {s(rr):,.0f}')
        except Exception as e:
            log(f'PA wayback {ts}: {str(e)[:100]}')
    return pts


def wayback_get(url, timeout=120, tries=4, binary=False):
    import time
    last = None
    for i in range(tries):
        try:
            return get(url, timeout=timeout, binary=binary)
        except Exception as e:
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f'wayback: {last}')


def uf_wayback_2024(log, scratch=None):
    """Archived copies of UF Election Lab's 2024 file, one per day where the Wayback Machine has one: a same-point
    2024 series for every state the file covers."""
    url = 'election.lab.ufl.edu/data-downloads/earlyvote/2024/US.csv'
    q = ('https://web.archive.org/cdx/search/cdx?url=' + urllib.parse.quote(url, safe='') +
         '&output=json&fl=timestamp,statuscode&from=20240920&to=20241106&filter=statuscode:200&collapse=timestamp:8&limit=200')
    rows = json.loads(wayback_get(q))[1:]
    log(f'UF 2024 wayback: {len(rows)} daily snapshots')
    if scratch:
        with open(os.path.join(scratch, 'uf2024_wayback_cdx.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(' '.join(r) for r in rows))
    pts = []
    for ts, _ in rows:
        try:
            text = wayback_get(f'https://web.archive.org/web/{ts}id_/https://{url}')
        except Exception as e:
            log(f'UF 2024 wayback {ts}: {str(e)[:60]}')
            continue
        for r in csv.DictReader(io.StringIO(text)):
            st = (r.get('state_abbv') or '').strip()
            if st not in STATES:
                continue
            lu = (r.get('last_update') or '').strip()
            try:
                m, d, y = lu.split('/')
                asof = dt.date(int(y), int(m), int(d)).isoformat()
            except ValueError:
                continue
            for mkey, pre in (('ret', 'accept'), ('voted', 'voted'), ('ip', 'inperson')):
                a, dd, rr, nn = num(r.get(f'{pre}_all')), num(r.get(f'{pre}_dem')), num(r.get(f'{pre}_rep')), num(r.get(f'{pre}_none'))
                if a and dd is not None and rr is not None and dd + rr > 0:
                    pts.append(dict(st=st, year=2024, date=asof, m=mkey, all=a, d=dd, r=rr, n=nn,
                                    src=f'UF Election Lab 2024 file, Wayback Machine copy of {ts[:8]}',
                                    url=f'https://web.archive.org/web/{ts}/https://{url}'))
    # one point per state, date and measure (the latest snapshot for that as-of date)
    uniq = {}
    for p in pts:
        uniq[(p['st'], p['date'], p['m'])] = p
    out = sorted(uniq.values(), key=lambda p: (p['st'], p['m'], p['date']))
    log(f'UF 2024 wayback: {len(out)} points')
    return out


def baseline(out_path, scratch=None):
    log = lambda *a: print(*a, file=sys.stderr)
    if scratch:
        os.makedirs(scratch, exist_ok=True)
    points, errors = [], []
    for fn, args in ((co_points, (2022, log)), (co_points, (2024, log)), (fl_points, (2022, log, scratch)),
                     (fl_points, (2024, log, scratch)), (pa_wayback_points, (log,)), (uf_wayback_2024, (log, scratch))):
        try:
            points += fn(*args)
        except Exception as e:
            errors.append(f'{fn.__name__}{args[:1]}: {str(e)[:200]}')
            log(errors[-1])
    finals = {}
    for yr, fn in (('2024', lambda: uf_finals_2024(log)), ('2020', lambda: uf_finals_2020(log, scratch)), ('2022', lambda: rpubs_finals_2022(log, scratch))):
        try:
            finals[yr] = fn()
        except Exception as e:
            errors.append(f'finals {yr}: {str(e)[:200]}')
            log(errors[-1])
    out = dict(built=dt.datetime.now(dt.timezone.utc).isoformat(timespec='minutes'), points=points, finals=finals, errors=errors)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)
    log(f'wrote {out_path}: {len(points)} points, finals for {[(k, len(v)) for k, v in finals.items()]}, {len(errors)} errors')


if __name__ == '__main__':
    if sys.argv[1:2] == ['baseline']:
        baseline(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'pipeline', 'static', 'ev_baselines.json'),
                 sys.argv[3] if len(sys.argv) > 3 else None)
    else:
        print(__doc__)
