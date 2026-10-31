"""Election night: read the official results files and turn them into evidence for the live forecast.

    python3 pipeline/live.py fetch --data site/data.json --out live_feeds.json [--test] [--progress 0.4]

Sources (both checked from GitHub Actions on Oct 31; the 2026 general files were already posted, with zero votes):
  North Carolina  er.ncsbe.gov/enr/20261103/data/results_{0..100}.txt   JSON per contest: votes by candidate and party,
                  precincts reporting (prt) and total (ptl); 0 = statewide, 1-100 = counties in alphabetical order.
  Florida         flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt   tab-separated, one row
                  per county x race x candidate, with Precincts and PrecinctsReporting.
The 2024 files at the same addresses give each county's 2024 presidential vote, the baseline for the swing.

What comes out (live_feeds.json):
  races[id]  counted votes for every US Senate, governor and US House race in these files (D, R, other, precincts
             reporting), keyed like the app's races ('NC-SEN', 'FL-GOV', 'FL-07').
  obs        projected final margins the live forecast conditions on:
             - a statewide race: from counties that have finished counting, the swing from the 2024 presidential
               margin in those counties (weighted by their votes) applied to the state's 2024 margin. Its SD shrinks
               as more of the state is in: 1 + 6 x sqrt(1 - share of the 2024 vote in finished counties); used once
               15% is in. At 98%+ of precincts the count itself is used (SD 1 + 20 x share outstanding).
             - a House district: only once 95% of its precincts are in (SD 1 + 20 x share outstanding), because
               partial counts swing with the order ballots are counted (mail first, Election Day later, or the reverse).
--test replays 2024 (Florida's 2024 Senate race stands in for FL-SEN, North Carolina's 2024 governor race for NC-SEN)
with only a share of counties (--progress) treated as finished, to exercise the whole chain before Election Day.
"""
import argparse, concurrent.futures as cf, datetime as dt, hashlib, json, math, re, sys, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (midterm-map election-night reader; +https://github.com)'}
NC_URL = 'https://er.ncsbe.gov/enr/{date}/data/results_{cid}.txt'
FL_URL = 'https://flelectionfiles.floridados.gov/enightfilespublic/{date}_ElecResultsFL.txt'
DATE26, DATE24 = '20261103', '20241105'


def get(url, timeout=40, tries=3):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url + ('&' if '?' in url else '?') + 't=' + str(int(dt.datetime.now().timestamp())), headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode('utf-8-sig', 'replace')
        except Exception as e:  # network or HTTP error
            last = e
    raise last


def two_party(d, r):
    return 100.0 * (d - r) / (d + r) if d + r > 0 else None


def done_by_hash(key, progress):
    """Test mode: a stable pseudo-random subset of counties counts as finished."""
    h = int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xffffffff
    return h < progress


# ----------------------------------------------------------------------------- North Carolina
def nc_contest_id(name):
    n = re.sub(r'\s*\(VOTE FOR \d+\)', '', name).strip().upper()
    if n == 'US SENATE':
        return 'NC-SEN'
    m = re.match(r'US HOUSE OF REPRESENTATIVES DISTRICT (\d+)$', n)
    if m:
        return 'NC-%02d' % int(m.group(1))
    if n == 'NC GOVERNOR':
        return 'NC-GOV'
    if n == 'US PRESIDENT':
        return 'PRES'
    return None


def nc_rows(date, cid):
    return json.loads(get(NC_URL.format(date=date, cid=cid)))


def nc_tally(rows, test=False):
    """{race id: {d, r, o, prt, ptl, dn, rn}} from one NC results file."""
    out = {}
    for x in rows:
        rid = nc_contest_id(x.get('cnm', ''))
        if test and rid == 'NC-GOV':
            rid = 'NC-SEN'          # 2024 governor race stands in for the 2026 Senate race
        elif test and rid == 'NC-SEN':
            continue
        if not rid:
            continue
        t = out.setdefault(rid, dict(d=0, r=0, o=0, prt=0, ptl=0, dn='', rn=''))
        v = int(float(x.get('vct') or 0))
        party = (x.get('pty') or '').upper()
        if party == 'DEM':
            t['d'] += v; t['dn'] = x.get('bnm', '')
        elif party == 'REP':
            t['r'] += v; t['rn'] = x.get('bnm', '')
        else:
            t['o'] += v
        t['prt'] = max(t['prt'], int(float(x.get('prt') or 0)))
        t['ptl'] = max(t['ptl'], int(float(x.get('ptl') or 0)))
    return out


def fetch_nc(test, progress):
    date = DATE24 if test else DATE26
    state = nc_tally(nc_rows(date, 0), test)
    with cf.ThreadPoolExecutor(12) as ex:
        counties = dict(zip(range(1, 101), ex.map(lambda c: nc_tally(nc_rows(date, c), test), range(1, 101))))
        base = dict(zip(range(1, 101), ex.map(lambda c: nc_tally(nc_rows(DATE24, c)), range(1, 101))))
    if test:   # pretend only part of the state has finished: unfinished counties report a fraction of their votes
        for c, races in counties.items():
            if not done_by_hash('NC%d' % c, progress):
                for t in races.values():
                    t['d'] = int(t['d'] * 0.45); t['r'] = int(t['r'] * 0.55); t['o'] = int(t['o'] * 0.5); t['prt'] = int(t['ptl'] * 0.4)
        state = {}
        for races in counties.values():
            for rid, t in races.items():
                s = state.setdefault(rid, dict(d=0, r=0, o=0, prt=0, ptl=0, dn=t['dn'], rn=t['rn']))
                for k in ('d', 'r', 'o', 'prt', 'ptl'):
                    s[k] += t[k]
    cty = {}
    for c in range(1, 101):
        p24 = base[c].get('PRES')
        if not p24:
            continue
        cty[c] = dict(p24d=p24['d'], p24r=p24['r'], races=counties.get(c, {}))
    return 'NC', state, cty


# ----------------------------------------------------------------------------- Florida
def fl_race_id(name):
    n = name.strip()
    if n == 'United States Senator':
        return 'FL-SEN'
    if n.startswith('Governor'):
        return 'FL-GOV'
    m = re.match(r'Representative in Congress, District (\d+)$', n)
    if m:
        return 'FL-%02d' % int(m.group(1))
    if n.startswith('President'):
        return 'PRES'
    return None


def fl_parse(text, test=False):
    """({race: tally} statewide, {county: {race: tally}})"""
    lines = text.splitlines()
    hdr = lines[0].split('\t')
    by_cty = {}
    for l in lines[1:]:
        f = l.split('\t')
        if len(f) != len(hdr):
            continue
        x = dict(zip(hdr, f))
        rid = fl_race_id(x['RaceName'])
        if not rid:
            continue
        c = x['CountyCode'].strip()
        t = by_cty.setdefault(c, {}).setdefault(rid, dict(d=0, r=0, o=0, prt=0, ptl=0, dn='', rn=''))
        v = int(float(x['CanVotes'] or 0))
        party = x['PartyCode'].strip().upper()
        name = (x['CanNameFirst'].strip() + ' ' + x['CanNameLast'].strip()).strip()
        if party == 'DEM':
            t['d'] += v; t['dn'] = name
        elif party == 'REP':
            t['r'] += v; t['rn'] = name
        else:
            t['o'] += v
        # the same precinct counts repeat on every candidate row of a county x race
        t['prt'] = int(float(x['PrecinctsReporting'] or 0)); t['ptl'] = int(float(x['Precincts'] or 0))
    return by_cty


def fetch_fl(test, progress):
    cur = fl_parse(get(FL_URL.format(date=DATE24 if test else DATE26)))
    base = fl_parse(get(FL_URL.format(date=DATE24)))
    if test:   # FL 2024's Senate race (Scott vs. Mucarsel-Powell) stands in for FL-SEN; unfinished counties partly in
        for c, races in cur.items():
            if not done_by_hash('FL' + c, progress):
                for t in races.values():
                    t['d'] = int(t['d'] * 0.6); t['r'] = int(t['r'] * 0.5); t['o'] = int(t['o'] * 0.5); t['prt'] = int(t['ptl'] * 0.3)
    state = {}
    for races in cur.values():
        for rid, t in races.items():
            s = state.setdefault(rid, dict(d=0, r=0, o=0, prt=0, ptl=0, dn=t['dn'], rn=t['rn']))
            for k in ('d', 'r', 'o', 'prt', 'ptl'):
                s[k] += t[k]
    cty = {}
    for c, races in base.items():
        p24 = races.get('PRES')
        if p24:
            cty[c] = dict(p24d=p24['d'], p24r=p24['r'], races=cur.get(c, {}))
    return 'FL', state, cty


# ----------------------------------------------------------------------------- projections
STATEWIDE = {'NC-SEN', 'FL-SEN', 'FL-GOV'}


def project(st, rid, state_t, cty):
    """Projected final margin of a statewide race from finished counties' swing vs. 2024."""
    p24d = sum(c['p24d'] for c in cty.values()); p24r = sum(c['p24r'] for c in cty.values())
    P24 = two_party(p24d, p24r)
    frac = state_t['prt'] / state_t['ptl'] if state_t['ptl'] else 0
    if state_t['d'] + state_t['r'] > 0 and frac >= 0.98:
        return dict(margin=round(two_party(state_t['d'], state_t['r']), 2), sd=round(1 + 20 * (1 - frac), 2), method='count', cov=round(frac, 3))
    num = den = cov = 0.0
    n = 0
    for c in cty.values():
        t = c['races'].get(rid)
        if not t or not t['ptl'] or t['prt'] < t['ptl'] or t['d'] + t['r'] == 0:
            continue
        m26 = two_party(t['d'], t['r']); m24 = two_party(c['p24d'], c['p24r'])
        if m24 is None:
            continue
        w = t['d'] + t['r']
        num += w * (m26 - m24); den += w; cov += c['p24d'] + c['p24r']; n += 1
    share = cov / (p24d + p24r) if p24d + p24r else 0
    if den == 0 or share < 0.15:
        return dict(margin=None, sd=None, method='county swing', cov=round(share, 3), counties=n, p24=round(P24, 2) if P24 is not None else None)
    S = num / den
    return dict(margin=round(P24 + S, 2), sd=round(1 + 6 * math.sqrt(max(0.0, 1 - share)), 2), method='county swing',
                cov=round(share, 3), counties=n, swing=round(S, 2), p24=round(P24, 2))


def fetch(args):
    out = dict(fetched_at=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), test=bool(args.test), sources={}, races={}, obs=[])
    if args.test:
        out['progress'] = args.progress
    for name, fn in (('nc', fetch_nc), ('fl', fetch_fl)):
        try:
            st, state, cty = fn(args.test, args.progress)
        except Exception as e:
            out['sources'][name] = dict(ok=False, detail=repr(e)[:300])
            continue
        n_in = 0
        for rid, t in state.items():
            if rid in ('PRES', 'NC-GOV'):
                continue
            frac = t['prt'] / t['ptl'] if t['ptl'] else 0
            tot = t['d'] + t['r'] + t['o']
            n_in += tot > 0
            r = dict(st=st, dn=t['dn'], rn=t['rn'], d=t['d'], r=t['r'], o=t['o'], prt=t['prt'], ptl=t['ptl'], frac=round(frac, 3),
                     margin=round(two_party(t['d'], t['r']), 2) if t['d'] + t['r'] else None)
            if rid in STATEWIDE:
                pr = project(st, rid, t, cty)
                r['proj'] = pr
                if pr.get('margin') is not None:
                    out['obs'].append(dict(id=rid, margin=pr['margin'], sd=pr['sd'], why=pr['method']))
            elif tot and frac >= 0.95 and t['d'] + t['r'] and t['d'] and t['r']:
                out['obs'].append(dict(id=rid, margin=r['margin'], sd=round(1 + 20 * (1 - frac), 2), why='count'))
            out['races'][rid] = r
        out['sources'][name] = dict(ok=True, detail='%d races, %d with votes' % (len(state) - ('PRES' in state), n_in))
    json.dump(out, open(args.out, 'w'), indent=1)
    print(json.dumps(dict(sources=out['sources'], obs=out['obs'])))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['fetch'])
    ap.add_argument('--data', default='site/data.json')
    ap.add_argument('--out', default='live_feeds.json')
    ap.add_argument('--test', action='store_true')
    ap.add_argument('--progress', type=float, default=0.4)
    a = ap.parse_args()
    fetch(a)
