"""Build the backtest's poll-versus-result tables from FiveThirtyEight's poll archive plus the compiled 2024 file.

FiveThirtyEight's pollster-ratings archive (raw_polls.csv) holds every poll it used to rate pollsters: polls taken in
the final 21 days before each election from 1998 to 2022, each paired with the certified result. 2024 is not in it,
so data/polls_2024.csv and data/results_2024.csv were compiled from Wikipedia, RealClearPolling and the FEC.

    python3 pipeline/backtest/make_tables.py            # writes data/generic_ballot.csv and data/state_races.csv

Each table row is a simple average of the race's polls in the final three weeks, the way the archive is built.
Standard library only.
"""
import csv
import io
import os
import statistics as st
import urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
RAW_URL = 'https://raw.githubusercontent.com/fivethirtyeight/data/master/pollster-ratings/raw_polls.csv'


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def load_raw(path=None):
    if path and os.path.exists(path):
        text = open(path, encoding='utf-8', errors='replace').read()
    else:
        req = urllib.request.Request(RAW_URL, headers={'User-Agent': 'midterm-map backtest'})
        text = urllib.request.urlopen(req, timeout=300).read().decode('utf-8', errors='replace')
    return list(csv.DictReader(io.StringIO(text)))


def main(raw_path=None):
    rows = load_raw(raw_path)
    pres = {}                 # (cycle, state or US) -> presidential margin (D - R)
    gb = defaultdict(list)
    races = defaultdict(list)
    for r in rows:
        t = r['type_simple']
        if t == 'Pres-G':
            pres[(int(r['cycle']), r['location'])] = num(r['margin_actual'])
        if r['cand1_party'] != 'DEM' or r['cand2_party'] != 'REP':
            continue
        if t == 'House-G-US':
            gb[int(r['cycle'])].append(r)
        elif t in ('Sen-G', 'Gov-G') and len(r['location']) == 2:
            races[(int(r['cycle']), t[:3], r['location'])].append(r)

    # 2024, compiled
    p24 = list(csv.DictReader(open(os.path.join(DATA, 'polls_2024.csv'))))
    r24 = {r['race']: r for r in csv.DictReader(open(os.path.join(DATA, 'results_2024.csv')))}
    for k, v in r24.items():
        if k.startswith('Pres-'):
            pres[(2024, k[5:])] = num(v['margin'])
    by24 = defaultdict(list)
    for p in p24:
        d, rp = num(p['dem_pct']), num(p['rep_pct'])
        if d is not None and rp is not None:
            by24[p['race']].append(d - rp)

    with open(os.path.join(DATA, 'generic_ballot.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['cycle', 'n_polls', 'poll_avg', 'actual', 'source'])
        for y in sorted(gb):
            L = gb[y]
            w.writerow([y, len(L), round(st.mean(num(x['margin_poll']) for x in L), 2), round(st.mean(num(x['margin_actual']) for x in L), 2),
                        'FiveThirtyEight pollster-ratings archive (raw_polls.csv), House-G-US, final 21 days'])
        L = by24.get('House-US', [])
        w.writerow([2024, len(L), round(st.mean(L), 2), num(r24['House-US']['margin']),
                    'compiled: RealClearPolling poll list Oct 15-Nov 4, 2024; House vote from Wikipedia national results table'])

    def lean(cy, s):
        for y in range(cy, cy - 8, -1):
            if pres.get((y, s)) is not None and pres.get((y, 'US')) is not None:
                return round(pres[(y, s)] - pres[(y, 'US')], 2)
        return ''

    with open(os.path.join(DATA, 'state_races.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['cycle', 'office', 'state', 'n_polls', 'poll_avg', 'actual', 'lean', 'source'])
        for (cy, typ, s), L in sorted(races.items()):
            if len(L) < 2:
                continue
            w.writerow([cy, typ, s, len(L), round(st.mean(num(x['margin_poll']) for x in L), 2),
                        round(st.mean(num(x['margin_actual']) for x in L), 2), lean(cy, s), '538 archive'])
        for race, L in sorted(by24.items()):
            if race == 'House-US' or race.startswith('SenS') or race not in r24 or len(L) < 2:
                continue
            typ, s = race.split('-')
            if s in ('NE', 'ME'):      # an independent, not a Democrat, faced the Republican
                continue
            w.writerow([2024, typ, s, len(L), round(st.mean(L), 2), num(r24[race]['margin']), lean(2024, s), 'compiled 2024'])
    findings(rows, os.path.join(DATA, 'state_races.csv'))
    print('wrote generic_ballot.csv, state_races.csv and findings.json')


def _corr(a, b):
    ma, mb = st.mean(a), st.mean(b)
    den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** 0.5
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / den if den else 0.0


def findings(rows, races_csv):
    """Two checks of whether accuracy carries over from one election to the next: by state and by pollster."""
    import json
    R = [r for r in csv.DictReader(open(races_csv)) if r['lean'] != '']
    for r in R:
        for k in ('poll_avg', 'actual', 'lean'):
            r[k] = float(r[k])
        r['cycle'] = int(r['cycle'])
        r['err'] = r['poll_avg'] - r['actual']
    cyc = defaultdict(list)
    for r in R:
        cyc[r['cycle']].append(r['err'])
    cbias = {y: st.mean(v) for y, v in cyc.items()}
    LEAN = 0.09     # average within-cycle slope of the miss on state lean (see backtest.py)
    se = defaultdict(list)
    for r in R:
        se[(r['cycle'], r['state'])].append(r['err'] - cbias[r['cycle']] + LEAN * r['lean'])
    se = {k: st.mean(v) for k, v in se.items()}
    pairs = []
    for a, b in [(2006, 2010), (2010, 2014), (2014, 2018), (2018, 2022), (2014, 2016), (2016, 2018), (2016, 2020), (2018, 2020), (2020, 2022), (2020, 2024), (2022, 2024)]:
        common = [s for (y, s) in se if y == a and (b, s) in se]
        if len(common) >= 8:
            pairs.append(dict(a=a, b=b, n=len(common), corr=round(_corr([se[(a, s)] for s in common], [se[(b, s)] for s in common]), 2)))
    # carry forward k x the state's last-midterm miss: does it beat no correction in the next midterm?
    test = []
    for k in (0.0, 0.15, 0.25, 0.35, 0.5):
        errs = []
        for prev, cur in [(2006, 2010), (2010, 2014), (2014, 2018), (2018, 2022)]:
            for r in R:
                if r['cycle'] == cur and abs(r['actual']) < 20:
                    errs.append(r['err'] - k * se.get((prev, r['state']), 0.0))
        test.append(dict(k=k, rmse=round((sum(e * e for e in errs) / len(errs)) ** 0.5, 3), n=len(errs)))
    states = {}
    for s in ['ME', 'NH', 'MI', 'MN', 'GA', 'NC', 'OH', 'IA', 'TX', 'KS', 'AK', 'NE', 'SC', 'FL', 'WI', 'PA', 'AZ', 'NV', 'MT', 'VT', 'OR']:
        states[s] = {y: round(se[(y, s)], 1) for y in range(2014, 2025, 2) if (y, s) in se}
    # pollsters: each poll's absolute error minus the average absolute error of all polls of the same race
    byrace = defaultdict(list)
    for r in rows:
        if r['type_simple'] in ('Sen-G', 'Gov-G', 'House-G', 'Pres-G', 'House-G-US') and r['cand1_party'] == 'DEM' and r['cand2_party'] == 'REP':
            byrace[r['race']].append(r)
    perf = defaultdict(lambda: defaultdict(list))
    for race, L in byrace.items():
        if len(L) < 3:
            continue
        errs = [abs(num(x['margin_poll']) - num(x['margin_actual'])) for x in L]
        avg = st.mean(errs)
        for x, e in zip(L, errs):
            perf[x['pollster']][int(x['cycle'])].append(e - avg)
    def rel(p, years):
        v = [e for y in years for e in perf[p].get(y, [])]
        return (st.mean(v), len(v)) if v else (None, 0)
    pp = []
    for p in perf:
        a, na = rel(p, range(1998, 2017))
        b, nb = rel(p, (2018, 2020, 2022))
        if na >= 20 and nb >= 20:
            pp.append((p, a, b, na, nb))
    mids = []
    for p in perf:
        b, nb = rel(p, (2018, 2022))
        if nb >= 15:
            mids.append(dict(pollster=p, better_by=round(-b, 2), n=nb))
    out = dict(
        state_persistence=pairs, state_carry_forward=test, state_residuals=states,
        pollster_persistence=dict(corr=round(_corr([x[1] for x in pp], [x[2] for x in pp]), 2), n=len(pp),
                                  note='relative absolute error, 1998-2016 vs 2018-2022, pollsters with 20+ polls in each'),
        pollsters_2018_2022=sorted(mids, key=lambda x: -x['better_by']),
    )
    json.dump(out, open(os.path.join(DATA, 'findings.json'), 'w'), indent=1)


if __name__ == '__main__':
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else None)
