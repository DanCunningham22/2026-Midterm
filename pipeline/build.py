#!/usr/bin/env python3
"""Build site/data.json for the 2026 Midterm Scenario Map.

Runs on a schedule in GitHub Actions (see .github/workflows/update.yml). Standard library only.

Inputs
  pipeline/static/base.json      frozen inputs: district baselines on the 2026 lines, electorate
                                 estimates, hex layout, Pew validated-voter baselines, early-vote benchmarks
  pipeline/static/polls_2026.csv national generic-ballot crosstabs (hand-maintained)
  pipeline/content/*.json        hand-maintained content: Senate averages from the Oct 9 model, the
                                 early-vote story and same-point comparisons, the Watch tab (watch.json)
  live feeds (fetched each run)  ElectIndex forecast data (candidates, race polls, generic-ballot polls)
                                 and the UF Election Lab early-vote file

If a feed fails or returns something implausible, the matching section of the previous data.json is
kept and flagged as stale, so the site never publishes half-broken numbers.
"""
import argparse
import csv
import datetime as dt
import io
import json
import math
import os
import re
import sys
import urllib.request

import fec_money

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEED_URL = 'https://raw.githubusercontent.com/ElectIndex/26_us_forecast_data/main/'
FEED_FILES = ['races.csv', 'candidates.csv', 'race_polls.csv', 'pollster_ratings.csv', 'gcb_polls.csv']
UF_URL = 'https://election.lab.ufl.edu/data-downloads/earlyvote/2026/US.csv'
OCT9 = dt.date(2026, 10, 9)
AK_TRANSFER = dict(to_d=0.123, to_r=0.635)  # second-choice transfers in AK-GOV, from poll round data (ElectIndex)
NO_CAND = ('(no', '(No')


# ---------------------------------------------------------------- helpers
def two_party(d, r):
    d, r = float(d), float(r)
    return 100.0 * (d - r) / (d + r) if d + r > 0 else 0.0


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def fetch(url, timeout=60, tries=3):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'midterm-scenario-map/1.0 (+github pages)'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode('utf-8-sig')
        except Exception as e:  # network errors, HTTP errors
            last = e
    raise RuntimeError(f'{url}: {last}')


def rows(text):
    return list(csv.DictReader(io.StringIO(text)))


def load_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def clean_watch(w):
    """The Watch tab's content (pipeline/content/watch.json, kept up by the daily task). Malformed entries are
    dropped rather than allowed to break the app; every kept entry links to the page that confirms it."""
    if not isinstance(w, dict):
        return {}

    def ok(x, need):
        return (isinstance(x, dict) and all(isinstance(x.get(k), str) and x.get(k).strip() for k in need)
                and re.match(r'^\d{4}-\d{2}-\d{2}$', x['date']) is not None
                and str(x.get('url', '')).startswith('https://'))

    def races(x):
        x['races'] = [r for r in x.get('races', []) if isinstance(r, str)]
        return x

    out = {k: str(w.get(k, '')) for k in ('asof', 'note', 'trail_note')}
    out['happened'] = [races(x) for x in w.get('happened', []) if ok(x, ('date', 'title', 'what'))]
    out['upcoming'] = [races(x) for x in w.get('upcoming', []) if ok(x, ('date', 'title'))]
    out['trail'] = [x for x in w.get('trail', []) if ok(x, ('date', 'who', 'city', 'st')) and x['who'] in ('Trump', 'Vance')]
    for x in out['trail']:
        x['boosting'] = [b for b in x.get('boosting', []) if isinstance(b, dict) and isinstance(b.get('race'), str)]
    return out


# ---------------------------------------------------------------- polls
def poll_average(by_race, ratings, code, asof, since_days=75):
    """Recency-, size- and quality-weighted average of D-minus-R margins as of a date."""
    pts = []
    for r in by_race.get(code, {}).values():
        try:
            end = dt.date.fromisoformat(r['end_date'])
        except ValueError:
            continue
        age = (asof - end).days
        if age < 0 or age > since_days:
            continue
        if ratings.get(r['pollster'], {}).get('banned') == '1':
            continue
        n = num(r['n']) or 600
        q = max(0.5, num(r['rating']) or 1.0) / 2.0
        w = 0.5 ** (age / 14) * math.sqrt(min(n, 1500) / 600) * q * (0.5 if r['lean'] else 1.0)
        d, rr = num(r['dem']) or 0.0, num(r['rep']) or 0.0
        if code == 'AK-GOV':
            r2 = num(r['rep2']) or 0.0
            m = (d + AK_TRANSFER['to_d'] * r2) - (rr + AK_TRANSFER['to_r'] * r2)
        else:
            m = d - rr
        pts.append((m, w, r))
    if not pts:
        return None
    W = sum(p[1] for p in pts)
    pts.sort(key=lambda p: p[2]['end_date'], reverse=True)
    return dict(avg=sum(p[0] * p[1] for p in pts) / W, weight=W, n=len(pts),
                latest=[dict(p=p[2]['pollster'], end=p[2]['end_date'], d=num(p[2]['dem']), r=num(p[2]['rep']),
                             lean=p[2]['lean']) for p in pts[:4]])


def generic_ballot(gcb, ratings, today, window=28):
    """National default: one poll per pollster (its latest) from the last four weeks, weighted by recency,
    sample size and pollster rating; partisan-leaning pollsters at half weight; banned pollsters dropped."""
    best = {}
    for r in gcb:
        try:
            end = dt.date.fromisoformat(r['end_date'])
        except ValueError:
            continue
        age = (today - end).days
        if age < 0 or age > window or ratings.get(r['pollster'], {}).get('banned') == '1':
            continue
        d, rp = num(r['dem']), num(r['rep'])
        if d is None or rp is None:
            continue
        n = num(r['n']) or 800
        q = min(1.5, max(0.5, (num(r['rating']) or 1.0) / 2.0))
        w = 0.5 ** (age / 14) * math.sqrt(min(n, 3000) / 1000) * q * (0.5 if r['lean'] else 1.0)
        if r['pollster'] not in best or end > best[r['pollster']][0]:
            best[r['pollster']] = (end, d - rp, w)
    if len(best) < 8:
        raise ValueError(f'only {len(best)} generic-ballot pollsters in window')
    W = sum(v[2] for v in best.values())
    return sum(v[1] * v[2] for v in best.values()) / W, len(best)


# ---------------------------------------------------------------- crosstab deviations (2026 polls)
GROUP_MAP = {
    ('race_edu', 'White college grad'): ('race', 'WC'), ('race_edu', 'White non-college'): ('race', 'WN'),
    ('race', 'Black'): ('race', 'B'), ('race', 'Hispanic'): ('race', 'H'), ('race', 'Asian'): ('race', 'AO'),
    ('race', 'Other'): ('race', 'AO'),
    ('age', '18-29'): ('age', '18-29'), ('age', '30-44'): ('age', '30-44'), ('age', '45-64'): ('age', '45-64'),
    ('age', '65+'): ('age', '65+'), ('age', '30-49'): ('age', '30-44'), ('age', '50-64'): ('age', '45-64'),
    ('age', '45-59'): ('age', '45-64'), ('age', '60+'): ('age', '65+'),
    ('gender', 'Men'): ('gender', 'M'), ('gender', 'Women'): ('gender', 'F'),
}
KEYS = {'race': ['WC', 'WN', 'B', 'H', 'AO'], 'age': ['18-29', '30-44', '45-64', '65+'], 'gender': ['M', 'F']}
# Emerson publishes ten-year age groups and no race-by-education split, so it feeds the pollster picker
# (with the approximations listed below) but not the default crosstab average.
DEFAULT_EXCLUDE = {'Emerson College'}
XTAB_EXTRA = {
    ('gender', 'Male'): ('gender', 'M'), ('gender', 'Female'): ('gender', 'F'),
    ('race', 'Black or African American'): ('race', 'B'), ('race', 'Hispanic or Latino of any race'): ('race', 'H'),
    ('age', '18-29 years'): ('age', '18-29'), ('age', '30-39 years'): ('age', '30-44'),
    ('age', '50-59 years'): ('age', '45-64'), ('age', '70 or more years'): ('age', '65+'),
}
WHITE_LABELS = {('race', 'White'), ('race', 'White or Caucasian')}
RATING_ALIAS = {'CBS News/YouGov': 'YouGov', 'Economist/YouGov': 'YouGov', 'NPR/PBS News/Marist': 'Marist',
                'Fox News (Beacon Research/Shaw & Co.)': 'Beacon Research/Shaw & Company Research'}
SHORT_NAME = {'Pew Research Center': 'Pew', 'CBS News/YouGov': 'CBS/YouGov', 'Economist/YouGov': 'Economist/YouGov',
              'NPR/PBS News/Marist': 'Marist', 'Fox News (Beacon Research/Shaw & Co.)': 'Fox News',
              'Marquette Law School': 'Marquette', 'Emerson College': 'Emerson',
              'New York Times/Siena': 'NYT/Siena', 'Quinnipiac University': 'Quinnipiac'}


def poll_deviations(path, base24):
    polls = list(csv.DictReader(open(path, encoding='utf-8')))
    by_poll = {}
    for r in polls:
        by_poll.setdefault((r['pollster'], r['end_date'], r['population'], r['n']), []).append(r)
    best = {}
    for key, rs in by_poll.items():
        if key[0] in DEFAULT_EXCLUDE:
            continue
        if not key[3] or not any(GROUP_MAP.get((r['group_dim'], r['group'])) for r in rs):
            continue
        if key[0] not in best or float(key[3]) > float(best[key[0]][3]):
            best[key[0]] = key
    acc, used = {}, []
    for key in best.values():
        rs = by_poll[key]
        top = [r for r in rs if r['group_dim'] == 'total']
        if not top or top[0]['dem_pct'] in ('', '-'):
            continue
        topm = two_party(top[0]['dem_pct'], top[0]['rep_pct'])
        n = float(key[3])
        for r in rs:
            g = GROUP_MAP.get((r['group_dim'], r['group']))
            if not g or r['dem_pct'] in ('', '-') or r['rep_pct'] in ('', '-'):
                continue
            acc.setdefault(g, []).append((two_party(r['dem_pct'], r['rep_pct']) - topm, math.sqrt(n), key[0]))
        used.append(dict(pollster=key[0], end=key[1], pop=key[2], n=int(n), top=round(topm, 1)))
    out = {}
    for dim, keys in KEYS.items():
        out[dim] = []
        for i, k in enumerate(keys):
            v = acc.get((dim, k), [])
            if v:
                w = sum(x[1] for x in v)
                out[dim].append(dict(dev=round(sum(x[0] * x[1] for x in v) / w, 2), n=len(v), who=sorted({x[2] for x in v})))
            else:
                out[dim].append(dict(dev=base24[dim]['dev'][i], n=0, who=[]))
    return out, used


def pollster_xtabs(path, base24, ratings):
    """Each pollster's latest crosstabs as deviations from its own two-party topline, for the one-tap picker.
    Groups a pollster doesn't publish are None (the app keeps the default there). When only all white voters
    are published, the 2024 education split among white voters is kept and shifted to match."""
    polls = list(csv.DictReader(open(path, encoding='utf-8')))
    by_poll = {}
    for r in polls:
        by_poll.setdefault((r['pollster'], r['end_date'], r['population'], r['n']), []).append(r)
    sh, d24 = base24['race']['shares'], base24['race']['dev']
    white24 = (sh[0] * d24[0] + sh[1] * d24[1]) / (sh[0] + sh[1])
    found = {}
    for (pollster, end, pop, n), rs in by_poll.items():
        if not n:
            continue
        top = [r for r in rs if r['group_dim'] == 'total' and r['dem_pct'] not in ('', '-')]
        if not top:
            continue
        topm = two_party(top[0]['dem_pct'], top[0]['rep_pct'])
        dev = {dim: [None] * len(k) for dim, k in KEYS.items()}
        approx, white = [], None
        for r in rs:
            if r['dem_pct'] in ('', '-') or r['rep_pct'] in ('', '-'):
                continue
            k = (r['group_dim'], r['group'])
            m = two_party(r['dem_pct'], r['rep_pct']) - topm
            if k in WHITE_LABELS:
                white = m
                continue
            g = GROUP_MAP.get(k) or XTAB_EXTRA.get(k)
            if not g or g == ('race', 'AO'):      # Asian & other stays at 2024: samples are tiny
                continue
            i = KEYS[g[0]].index(g[1])
            if dev[g[0]][i] is None:
                dev[g[0]][i] = round(m, 2)
                if k in XTAB_EXTRA and g[0] == 'age' and k[1] != '18-29 years':
                    approx.append(g[1])
        if white is not None and dev['race'][0] is None and dev['race'][1] is None:
            shift = white - white24
            dev['race'][0], dev['race'][1] = round(d24[0] + shift, 2), round(d24[1] + shift, 2)
            approx += ['WC', 'WN']
        if sum(v is not None for vs in dev.values() for v in vs) < 4:
            continue
        rt = num(ratings.get(RATING_ALIAS.get(pollster, pollster), {}).get('rating'))
        key = (pollster, pop)
        entry = dict(k=(SHORT_NAME.get(pollster, pollster) + '-' + pop).lower().replace('/', '-').replace(' ', '-'),
                     name=pollster, short=SHORT_NAME.get(pollster, pollster), pop=pop, end=end, n=int(float(n)),
                     top=round(topm, 1), rating=rt, dev=dev, approx=approx, url=rs[0]['source_url'])
        if key not in found or end > found[key]['end']:
            found[key] = entry
    return sorted(found.values(), key=lambda x: (-(x['rating'] or 0), x['short'], x['pop'] != 'LV'))


# ---------------------------------------------------------------- races
def build_races(feed, base, G0, today, senate_cfg):
    races = {r['race_code']: r for r in feed['races.csv']}
    cands = {r['cand_id']: r for r in feed['candidates.csv']}
    ratings = {r['pollster']: r for r in feed['pollster_ratings.csv']}
    by_race = {}
    for r in feed['race_polls.csv']:
        by_race.setdefault(r['race_code'], {}).setdefault(r['poll_id'], r)
    N24 = base['N24']

    def strength(cid):
        return num(cands.get(cid, {}).get('strength')) or 0.0

    districts = []
    for d in base['districts']:
        r = races.get(d['id'])
        if r is None:
            raise ValueError(f'race {d["id"]} missing from feed')
        dn, rn = r['dem_name'], r['rep_name']
        unc = ''
        if r['same_party'] == 'DEM' or (rn.startswith(NO_CAND) and not dn.startswith(NO_CAND)):
            unc = 'D'
        if r['same_party'] == 'REP' or (dn.startswith(NO_CAND) and not rn.startswith(NO_CAND) and not r['ind_name']):
            unc = 'R'
        dside, dparty = dn, 'D'
        if dn.startswith(NO_CAND) and r['ind_name']:
            dside, dparty = r['ind_name'] + ' (I)', 'I'
        rside, rparty = rn, ('I' if r['rep_party'] == 'IND' else 'R')
        if r['same_party'] == 'DEM':
            dside = f"{dn} vs. {r['cand2_name']} (both D)"
        if r['same_party'] == 'REP':
            rside = f"{rn} vs. {r['cand2_name']} (both R)"
        x = dict(d)
        x.update(dn='' if dside.startswith(NO_CAND) else dside, rn='' if rside.startswith(NO_CAND) else rside,
                 rp=rparty, dp=dparty, inc={'DEM': 'D', 'REP': 'R', 'IND': 'I'}.get(r['incumbent_party'], ''),
                 unc=unc, hold={'DEM': 'D', 'REP': 'R', 'IND': 'I'}.get(r['seat_holder'], ''),
                 sd=round(strength(r['dem_id']) if dparty == 'D' else 0.0, 2), sr=round(strength(r['rep_id']), 2))
        districts.append(x)

    # Senate: the Oct 9 corrected averages, moved by the change in a simple poll average since Oct 9
    senate = []
    oct9 = senate_cfg['averages']
    for code, r in races.items():
        if r['race_type'] != 'senate':
            continue
        s = r['state']
        sc = base['statecomp'][s]
        inc = {'DEM': 'D', 'REP': 'R'}.get(r['incumbent_party'], '')
        dside, dparty = r['dem_name'], 'D'
        if dside.startswith(NO_CAND) and r['ind_name']:
            dside, dparty = r['ind_name'], 'I'
        if s == 'MT':
            dside, dparty = r['ind_name'], 'I'
        drift = 0.0
        if s in oct9:
            a_now = poll_average(by_race, ratings, code, today)
            a_then = poll_average(by_race, ratings, code, OCT9)
            if a_now and a_then:
                drift = max(-3.0, min(3.0, a_now['avg'] - a_then['avg']))
            b, src = oct9[s] + drift, 'oct9'
        elif s == 'MT':
            vals = [num(x['oth']) - num(x['rep']) for x in by_race.get('MT-SEN', {}).values()
                    if x['end_date'] >= '2026-08-01' and (num(x['oth']) or 0) > 0]
            b, src = (sum(vals) / len(vals) if vals else (sc['m24'] - N24) + G0), 'polls-3way'
        else:
            b, src = (sc['m24'] - N24) + G0 + (3 if inc == 'D' else -3 if inc == 'R' else 0), 'fundamentals'
        recent = [list(x) for x in senate_cfg['recent_research'].get(s, [])]
        seen = {x[0].split()[0].lower() + x[1] for x in recent}
        for p in sorted(by_race.get(code, {}).values(), key=lambda p: p['end_date'], reverse=True):
            if p['end_date'] <= '2026-10-09':
                break
            when = dt.date.fromisoformat(p['end_date']).strftime('%b %-d')
            key = p['pollster'].split()[0].lower() + when
            if key in seen:
                continue
            seen.add(key)
            dname = (p['dem_name'] or 'D').split()[-1]
            rname = (p['rep_name'] or 'R').split()[-1]
            if num(p['dem']) is None or num(p['rep']) is None:
                continue
            recent.append([p['pollster'] + (f' ({p["lean"]}-leaning)' if p['lean'] else ''), when,
                           f"{dname} {num(p['dem']):g}, {rname} {num(p['rep']):g}"])
        senate.append(dict(id=code, st=s, dn=dside, dp=dparty, rn=r['rep_name'], inc=inc,
                           hold={'DEM': 'D', 'REP': 'R'}.get(r['seat_holder'], ''), base=round(b, 2), src=src,
                           drift=round(drift, 2), p9=senate_cfg['p_oct9'].get(s), recent=recent[:6],
                           note=senate_cfg['notes'].get(s, ''), m24=sc['m24']))
    senate.sort(key=lambda x: x['st'])
    if len(senate) != 35:
        raise ValueError(f'expected 35 Senate races, got {len(senate)}')

    gov_notes = {
        'AK': 'Ranked-choice race. The margin applies second-choice transfers from the other Republicans (63.5% to Wilson, 12.3% to Kreiss-Tomkins, rest exhausted), estimated from poll round data compiled by ElectIndex.',
        'VT': 'Phil Scott (R) has won by wide margins in a state Harris carried by 32; polls show a closer race this year.',
        'RI': 'Ken Block (I) polls in the low-to-mid 20s.',
        'ME': 'Rick Bennett (I) is also on the ballot.',
    }
    gov = []
    for code, r in races.items():
        if r['race_type'] != 'governor':
            continue
        s = r['state']
        sc = base['statecomp'][s]
        inc = {'DEM': 'D', 'REP': 'R'}.get(r['incumbent_party'], '')
        fund = (sc['m24'] - N24) + G0 + (5 if inc == 'D' else -5 if inc == 'R' else 0)
        pa = poll_average(by_race, ratings, code, today)
        if pa:
            prior = 0.3 if pa['n'] < 2 else 0.0
            b, src = (pa['avg'] * pa['weight'] + fund * prior) / (pa['weight'] + prior), 'polls'
        else:
            b, src = fund, 'fundamentals'
        gov.append(dict(id=code, st=s, dn=r['dem_name'], rn=r['rep_name'], inc=inc,
                        hold={'DEM': 'D', 'REP': 'R'}.get(r['seat_holder'], ''), base=round(b, 2), src=src,
                        npolls=pa['n'] if pa else 0, latest=pa['latest'] if pa else [], fund=round(fund, 1),
                        note=gov_notes.get(s, ''), m24=sc['m24']))
    gov.sort(key=lambda x: x['st'])
    if len(gov) != 36:
        raise ValueError(f'expected 36 governor races, got {len(gov)}')

    housepolls = {}
    for d in districts:
        pa = poll_average(by_race, ratings, d['id'], today, 90)
        if pa:
            housepolls[d['id']] = dict(avg=round(pa['avg'], 1), n=pa['n'], latest=pa['latest'][:2])
    return districts, senate, gov, housepolls


# ---------------------------------------------------------------- early vote
def build_early_vote(uf, bench):
    states = []
    tot = dict(cast=0.0, ret=0.0, ip=0.0)
    dates = []
    for r in uf:
        st = (r.get('state_abbv') or '').strip()
        if not st or st == 'US':
            continue
        cast = num(r.get('voted_all')) or 0.0
        b = bench['states'].get(st, {})
        row = dict(st=st, cast=cast or None, req=num(r.get('request_all')), ret=num(r.get('accept_all')),
                   ip=num(r.get('inperson_all')), t22=num(r.get('turn_2022')) or b.get('t22'),
                   ev22=b.get('ev22'), ev22d=b.get('ev22d'), ev22r=b.get('ev22r'), ev24=b.get('ev24'), start=b.get('start'))
        dem, rep, none = (num(r.get('voted_dem')) or 0.0), (num(r.get('voted_rep')) or 0.0), (num(r.get('voted_none')) or 0.0)
        if cast and dem + rep > 0:
            row.update(d=round(100 * dem / cast, 2), r=round(100 * rep / cast, 2), n=round(100 * none / cast, 2))
        ages = [num(r.get(f'voted_age_{k}')) or 0.0 for k in (1, 2, 3, 4)]
        if cast and sum(ages) > 0:
            row['age'] = [round(100 * a / cast, 1) for a in ages]
        lu = (r.get('last_update') or '').strip()
        try:
            m, dd, y = lu.split('/')
            row['asof'] = f'{int(y):04d}-{int(m):02d}-{int(dd):02d}'
            if cast:
                dates.append(row['asof'])
        except ValueError:
            row['asof'] = None
        states.append(row)
        if cast:
            tot['cast'] += cast
            tot['ret'] += num(r.get('accept_all')) or 0.0
            tot['ip'] += num(r.get('inperson_all')) or 0.0
    reporting = sum(1 for s in states if s['cast'])
    if reporting < 10 or tot['cast'] <= 0:
        raise ValueError(f'early-vote file looks empty ({reporting} states reporting)')
    us = dict(cast=tot['cast'], ret=tot['ret'], ip=tot['ip'], reporting=reporting,
              asof_min=min(dates) if dates else None, asof_max=max(dates) if dates else None, **bench['us'])
    return dict(states=sorted(states, key=lambda s: s['st']), us=us)


def nc_measure(nc):
    """North Carolina's registered D-minus-R gap among accepted ballots, 2026 vs the same point in 2024,
    computed from the State Board of Elections' files (replaces the hand-entered NC measure when available)."""
    if not nc or not (nc.get('y26') or {}).get('all') or not (nc.get('y24') or {}).get('all'):
        return None
    # While only mail ballots are in, the comparison mostly measures who switched away from mail (vs 2022 it points
    # strongly Republican, vs 2024 strongly Democratic), so it joins the projection once most ballots are in person.
    if nc['y26'].get('onestop', 0) < 0.5 * nc['y26']['all']:
        return None
    g = lambda c: 100.0 * (c['DEM'] - c['REP']) / c['all']
    return dict(st='NC', label='North Carolina: registered Democrats minus Republicans among ballots cast, vs the same point in 2024 (automatic)',
                v26=round(g(nc['y26']), 1), v24=round(g(nc['y24']), 1), kind='margin', auto=True,
                src=f"NC State Board of Elections files, through {nc['asof']}", url='https://www.ncsbe.gov/results-data/absentee-data',
                aff='Official data, computed by the update job')


def ev_projection(story, N24, nc=None):
    LOYAL = 0.85
    ms = []
    auto = nc_measure(nc)
    src = [m for m in story['measures'] if not (auto and m['st'] == 'NC')] + ([auto] if auto else [])
    for m in src:
        m = dict(m)
        gap = 2 * (m['v26'] - m['v24']) if m['kind'] == 'share' else (m['v26'] - m['v24']) if m['kind'] == 'margin' else m['shift']
        m['gap'] = gap
        m['implied'] = round(N24 + LOYAL * gap, 2)
        ms.append(m)
    imp = sorted(m['implied'] for m in ms)
    k = len(imp) // 2
    med = (imp[k - 1] + imp[k]) / 2 if len(imp) % 2 == 0 else imp[k]
    return dict(measures=ms, loyalty=LOYAL, median=round(med, 2), cast_at=story.get('cast_at'), asof=story.get('asof'))


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'site', 'data.json'))
    ap.add_argument('--feed-dir', help='read the ElectIndex files from this directory instead of fetching')
    ap.add_argument('--no-nc', action='store_true', help='skip the North Carolina file download (local runs)')
    ap.add_argument('--no-fec', action='store_true', help='skip the FEC campaign-money downloads (local runs)')
    ap.add_argument('--uf-csv', help='read the UF early-vote file from this path instead of fetching')
    ap.add_argument('--today', help='override the build date (YYYY-MM-DD)')
    a = ap.parse_args()

    now = dt.datetime.now(dt.timezone.utc)
    today = dt.date.fromisoformat(a.today) if a.today else (now - dt.timedelta(hours=4)).date()
    base = load_json(os.path.join(ROOT, 'pipeline', 'static', 'base.json'))
    senate_cfg = load_json(os.path.join(ROOT, 'pipeline', 'content', 'senate_oct9.json'))
    story = load_json(os.path.join(ROOT, 'pipeline', 'content', 'story.json'))
    prev = load_json(a.out, {}) or {}
    pmeta = prev.get('meta', {}).get('sources', {})
    status = {}

    def ok(name, detail=''):
        status[name] = dict(ok=True, last_ok=now.isoformat(timespec='minutes'), detail=detail)

    def stale(name, err):
        status[name] = dict(ok=False, last_ok=pmeta.get(name, {}).get('last_ok'), detail=str(err)[:300])
        print(f'WARNING {name}: {err}', file=sys.stderr)

    out = {k: base[k] for k in ('N24', 'hexR', 'statecomp', 'base', 'nat', 'vep', 'ballots')}
    dev, used = poll_deviations(os.path.join(ROOT, 'pipeline', 'static', 'polls_2026.csv'), base['base']['2024'])
    out['polldev'], out['polls_used'] = dev, used
    out['groups'] = KEYS

    # live feed: candidates, race polls, generic ballot
    feed = None
    try:
        feed = {}
        for f in FEED_FILES:
            text = open(os.path.join(a.feed_dir, f), encoding='utf-8').read() if a.feed_dir else fetch(FEED_URL + f)
            feed[f] = rows(text)
        if len(feed['races.csv']) < 400:
            raise ValueError('races.csv looks truncated')
    except Exception as e:
        stale('electindex', e)
        feed = None

    try:
        rmap = {r['pollster']: r for r in feed['pollster_ratings.csv']} if feed else {}
        out['pollsters'] = pollster_xtabs(os.path.join(ROOT, 'pipeline', 'static', 'polls_2026.csv'), base['base']['2024'], rmap)
        if not rmap and prev.get('pollsters'):
            # keep last known ratings when the feed is down
            old = {p['k']: p.get('rating') for p in prev['pollsters']}
            for p in out['pollsters']:
                p['rating'] = old.get(p['k'])
    except Exception as e:
        print(f'WARNING pollster picker: {e}', file=sys.stderr)
        out['pollsters'] = prev.get('pollsters', [])

    G0 = prev.get('G0')
    if feed:
        try:
            ratings = {r['pollster']: r for r in feed['pollster_ratings.csv']}
            g, npoll = generic_ballot(feed['gcb_polls.csv'], ratings, today)
            if not -15 <= g <= 25:
                raise ValueError(f'generic ballot {g:.1f} out of range')
            if G0 is not None and abs(g - G0) > 5:
                raise ValueError(f'generic ballot jumped from {G0:.1f} to {g:.1f}; keeping the old value')
            G0 = round(g, 2)
            out['G0_polls'] = npoll
            ok('generic_ballot', f'{npoll} pollsters, last 28 days')
        except Exception as e:
            stale('generic_ballot', e)
            out['G0_polls'] = prev.get('G0_polls')
    if G0 is None:
        raise SystemExit('no generic-ballot value and no previous data to fall back on')
    out['G0'] = G0

    if feed:
        try:
            out['districts'], out['senate'], out['gov'], out['housepolls'] = build_races(feed, base, G0, today, senate_cfg)
            ok('electindex', 'candidates, incumbency, race polls')
        except Exception as e:
            stale('electindex', e)
            feed = None
    if not feed:
        if not prev.get('districts'):
            raise SystemExit('race data unavailable and no previous data to fall back on')
        for k in ('districts', 'senate', 'gov', 'housepolls'):
            out[k] = prev[k]

    # early vote
    try:
        text = open(a.uf_csv, encoding='utf-8-sig').read() if a.uf_csv else fetch(UF_URL)
        ev = build_early_vote(rows(text), base['ev_bench'])
        pc = (prev.get('ev') or {}).get('us', {}).get('cast')
        if pc and ev['us']['cast'] < 0.85 * pc:
            raise ValueError(f"ballot total fell from {pc:,.0f} to {ev['us']['cast']:,.0f}; keeping the old file")
        out['ev'] = ev
        ok('early_vote', f"{ev['us']['reporting']} states reporting")
        # daily record, carried forward in data.json: one snapshot per day (the day's last run wins)
        hist = [h for h in (prev.get('ev_hist') or []) if h.get('date') != today.isoformat()]
        hist.append(dict(date=today.isoformat(), us=round(ev['us']['cast']),
                         st={x['st']: [round(x['cast']), x.get('d'), x.get('r'), x.get('asof')]
                             for x in ev['states'] if x.get('cast')}))
        out['ev_hist'] = hist[-45:]
    except Exception as e:
        stale('early_vote', e)
        if not prev.get('ev'):
            raise SystemExit('early-vote data unavailable and no previous data to fall back on')
        out['ev'] = prev['ev']
        out['ev_hist'] = prev.get('ev_hist', [])

    # North Carolina: same-point comparison with 2022 and 2024 from the State Board of Elections' files
    bl_path = os.path.join(ROOT, 'pipeline', 'static', 'nc_baseline.json')
    if os.path.exists(bl_path) and not a.no_nc:
        try:
            import nc_absentee
            nc = nc_absentee.current(load_json(bl_path), today)
            old = (prev.get('nc') or {}).get('y26', {}).get('all')
            if old and nc['y26']['all'] < 0.85 * old:
                raise ValueError(f"NC ballots fell from {old:,} to {nc['y26']['all']:,}; keeping the old numbers")
            out['nc'] = nc
            ok('nc_sbe', f"{nc['y26']['all']:,} accepted ballots through {nc['asof']}")
        except Exception as e:
            stale('nc_sbe', e)
            out['nc'] = prev.get('nc')
    else:
        out['nc'] = prev.get('nc')

    out['evproj'] = ev_projection(story, base['N24'], out.get('nc'))
    out['story'] = story
    out['sealed'] = load_json(os.path.join(ROOT, 'pipeline', 'content', 'sealed.json'), {'versions': []})
    out['watch'] = clean_watch(load_json(os.path.join(ROOT, 'pipeline', 'content', 'watch.json'), {}))

    # campaign money from the FEC (House and Senate; governors are state races). The files change about daily,
    # so they are fetched at most every ~6 hours; a failed fetch keeps the last good figures.
    pm = prev.get('money') or None
    try:
        age = now - dt.datetime.fromisoformat(pm['fetched']) if pm and pm.get('fetched') else None
    except ValueError:
        age = None
    if a.no_fec:
        out['money'] = pm
    elif (age is not None and age < dt.timedelta(hours=5, minutes=30) and pmeta.get('fec', {}).get('ok')
          and pm.get('v') == fec_money.VERSION):
        out['money'] = pm
        status['fec'] = pmeta['fec']
    else:
        try:
            m = fec_money.build(out['districts'], out['senate'], log=lambda x: print(x, file=sys.stderr))
            m['fetched'] = now.isoformat(timespec='minutes')
            ie_err = m['diag']['ie'].get('error') or not m['diag']['ie'].get('kept')
            if ie_err and pm and pm.get('races'):
                # only the outside-spending file failed: keep its last figures next to the new candidate totals
                for rid, e in pm['races'].items():
                    if rid in m['races']:
                        for k in ('o', 'top', 'nsp'):
                            if k in e:
                                m['races'][rid][k] = e[k]
                m['asof']['ie'] = (pm.get('asof') or {}).get('ie')
            out['money'] = m
            if ie_err:
                stale('fec', f"outside-spending file: {m['diag']['ie'].get('error') or 'no rows kept'}")
            else:
                ok('fec', f"{m['diag']['matched']} races matched; candidate reports through {m['asof']['cand']}, "
                          f"outside spending through {m['asof']['ie']}")
        except Exception as e:
            stale('fec', e)
            out['money'] = pm
    out['meta'] = dict(generated=now.isoformat(timespec='minutes'), build_date=today.isoformat(), sources=status,
                       senate_asof=senate_cfg['asof'])

    # final sanity checks before anything is written
    assert len(out['districts']) == 435 and len(out['senate']) == 35 and len(out['gov']) == 36
    assert all(math.isfinite(x['base']) for x in out['senate'] + out['gov'])
    tmp = a.out + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
    os.replace(tmp, a.out)
    print(f"wrote {a.out}: G0 {out['G0']:+.2f}, early vote {out['ev']['us']['cast']:,.0f} ballots, "
          f"sources {', '.join(k + ('=ok' if v['ok'] else '=STALE') for k, v in status.items())}")


if __name__ == '__main__':
    main()
