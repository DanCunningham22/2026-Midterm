"""North Carolina early vote at the same point in past elections, from the State Board of Elections' own files.

The board publishes every absentee-by-mail and early in-person ("one-stop") ballot, with the date it was
returned and the voter's party and race, for each general election at
    https://s3.amazonaws.com/dl.ncsbe.gov/ENRS/<YYYY_MM_DD>/absentee_<YYYYMMDD>.zip
so the same days-before-the-election comparison with 2022 and 2024 can be computed here, with no hand work.

    python3 pipeline/nc_absentee.py baseline --out pipeline/static/nc_baseline.json   # once: 2022 and 2024
    (build.py calls current() for 2026 on every run)

Standard library only.
"""
import argparse
import csv
import datetime as dt
import io
import json
import os
import sys
import tempfile
import urllib.request
import zipfile

ELECTIONS = {2022: dt.date(2022, 11, 8), 2024: dt.date(2024, 11, 5), 2026: dt.date(2026, 11, 3)}
URL = 'https://s3.amazonaws.com/dl.ncsbe.gov/ENRS/{d:%Y_%m_%d}/absentee_{d:%Y%m%d}.zip'
FIELDS = ('all', 'DEM', 'REP', 'UNA', 'OTH', 'black', 'mail', 'onestop')
MAX_DAYS = 75


def download(url, path):
    req = urllib.request.Request(url, headers={'User-Agent': 'midterm-map data job (GitHub Actions)'})
    with urllib.request.urlopen(req, timeout=600) as r, open(path, 'wb') as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)


def parse_date(s):
    s = (s or '').strip()[:10]
    for fmt in ('%m/%d/%Y', '%Y-%m-%d', '%m/%d/%y'):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def tally(zip_path, election):
    """Accepted ballots by days before the election, split by party, Black voters, and mail vs one-stop."""
    by_day, types = {}, {}
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if n.lower().endswith(('.csv', '.txt'))]
        if not names:
            raise ValueError(f'no CSV in {zip_path}: {z.namelist()[:5]}')
        with z.open(names[0]) as raw:
            text = io.TextIOWrapper(raw, encoding='utf-8', errors='replace', newline='')
            sample = text.readline()
            delim = '\t' if sample.count('\t') > sample.count(',') else ','
            head = [h.strip().strip('"').lower() for h in next(csv.reader([sample], delimiter=delim))]
            ix = {h: i for i, h in enumerate(head)}
            need = ['ballot_rtn_dt', 'ballot_rtn_status', 'voter_party_code', 'race', 'ballot_req_type']
            missing = [n for n in need if n not in ix]
            if missing:
                raise ValueError(f'absentee file is missing {missing}; columns are {head}')
            i_dt, i_st, i_pty, i_race, i_type = (ix[n] for n in need)
            width = max(i_dt, i_st, i_pty, i_race, i_type)
            rows = 0
            for row in csv.reader(text, delimiter=delim):
                rows += 1
                if len(row) <= width or not row[i_st].strip().upper().startswith('ACCEPTED'):   # incl. "ACCEPTED - CURED"
                    continue
                d = parse_date(row[i_dt])
                if d is None:
                    continue
                k = (election - d).days
                if k < 0 or k > MAX_DAYS:
                    continue
                c = by_day.setdefault(k, dict.fromkeys(FIELDS, 0))
                c['all'] += 1
                p = row[i_pty].strip().upper()
                c[p if p in ('DEM', 'REP', 'UNA') else 'OTH'] += 1
                if row[i_race].strip().upper().startswith('B'):
                    c['black'] += 1
                t = row[i_type].strip().upper()
                types[t] = types.get(t, 0) + 1
                # mail ballots say MAIL; early in-person has been labelled ONE-STOP and other ways over the years
                c['mail' if 'MAIL' in t else 'onestop'] += 1
    print(f'  {zip_path}: {rows:,} rows, {sum(c["all"] for c in by_day.values()):,} accepted ballots; '
          f'ballot types {sorted(types.items(), key=lambda x: -x[1])[:6]}', file=sys.stderr)
    out = {str(k): by_day[k] for k in sorted(by_day)}
    out['_types'] = dict(sorted(types.items(), key=lambda x: -x[1])[:8])
    return out


def cumulative(by_day, days_before):
    """Ballots accepted on or before the given number of days before the election."""
    tot = dict.fromkeys(FIELDS, 0)
    for k, c in by_day.items():
        if k.startswith('_'):
            continue
        if int(k) >= days_before:
            for f in FIELDS:
                tot[f] += c.get(f, 0)
    return tot


def fetch_tally(year):
    d = ELECTIONS[year]
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, f'absentee_{year}.zip')
        download(URL.format(d=d), path)
        return tally(path, d)


def current(baseline, today):
    """2026 so far against 2022 and 2024 at the same number of days before the election."""
    by26 = fetch_tally(2026)
    if not by26:
        raise ValueError('no accepted 2026 ballots in the file yet')
    to_go = (ELECTIONS[2026] - today).days
    days = [int(x) for x in by26 if not x.startswith('_') and int(x) >= to_go]   # ignore stray future dates
    if not days:
        raise ValueError('no accepted 2026 ballots in the file yet')
    k = min(days)                           # latest return date in the file
    if ELECTIONS[2026] - dt.timedelta(days=k) >= today:
        k += 1                              # today's count is partial: compare through yesterday
    k = max(k, (ELECTIONS[2026] - today).days)
    out = dict(days_before=k, asof=(ELECTIONS[2026] - dt.timedelta(days=k)).isoformat(), y26=cumulative(by26, k),
               daily26={x: by26[x]['all'] for x in by26 if not x.startswith('_')}, types26=by26.get('_types'))
    for y in (2022, 2024):
        if str(y) in baseline:
            out[f'y{y % 100}'] = cumulative(baseline[str(y)], k)
            out[f'final{y % 100}'] = cumulative(baseline[str(y)], 0)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['baseline'])
    ap.add_argument('--out', required=True)
    ap.add_argument('--years', nargs='*', type=int, default=[2022, 2024])
    a = ap.parse_args()
    base = {}
    if os.path.exists(a.out):
        base = json.load(open(a.out))
    for y in a.years:
        print(f'{y}: downloading {URL.format(d=ELECTIONS[y])}', file=sys.stderr)
        base[str(y)] = fetch_tally(y)
    base['_note'] = 'Accepted NC absentee and one-stop ballots by days before Election Day, from NCSBE absentee files.'
    json.dump(base, open(a.out, 'w'), separators=(',', ':'))
    print(f'wrote {a.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
