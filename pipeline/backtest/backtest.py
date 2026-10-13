"""The backtest, and the independent forecast it supports.

Everything here is scored against real results: how the polls three weeks out, presidential approval, special
elections and the off-year governor races did at predicting each midterm's actual House vote, and how Senate and
governor polls did against each race's result. Weights favor midterms over presidential years (1 vs 0.5) and recent
cycles over old ones (half-life 12 years).

    python3 pipeline/backtest/backtest.py     # prints the backtest and the 2026 call

build.py calls live() on every run, with the current polling average and the inputs in pipeline/content/fundamentals.json.
Standard library only.
"""
import csv
import json
import math
import os
import statistics as st
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
YEAR = 2026
HALF_LIFE = 12.0     # an election 12 years back counts half as much as this year
PRES_W = 0.5         # a presidential year counts half as much as a midterm
RHO = 0.4            # assumed correlation between the national signals' errors (they all read the same electorate)
SEAT_EXTRA = 1.5     # extra national uncertainty for how the national vote turns into seats (pts)
SPECIALS_FLOOR = 3.0  # specials have only three past midterms to learn from; don't trust them more than this


def w(year):
    return (1.0 if year % 4 == 2 else PRES_W) * 0.5 ** ((YEAR - year) / HALF_LIFE)


def reweighted(fn, half_life=None, pres_w=None):
    """Run fn() with other weighting choices, for the sensitivity checks."""
    global HALF_LIFE, PRES_W
    old = (HALF_LIFE, PRES_W)
    HALF_LIFE = half_life if half_life is not None else HALF_LIFE
    PRES_W = pres_w if pres_w is not None else PRES_W
    try:
        return fn()
    finally:
        HALF_LIFE, PRES_W = old


def wmean(vals, ws):
    return sum(v * x for v, x in zip(vals, ws)) / sum(ws)


def wrmse(errs, ws):
    return math.sqrt(sum(x * e * e for e, x in zip(errs, ws)) / sum(ws))


def rows(name):
    return list(csv.DictReader(open(os.path.join(DATA, name), encoding='utf-8')))


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def load():
    house = {int(r['year']): float(r['margin']) for r in rows('house_vote.csv')}
    appr = {int(r['year']): dict(party=r['party'], net=float(r['approve']) - float(r['disapprove'])) for r in rows('approval.csv')}
    pres = {int(r['year']): float(r['margin']) for r in rows('pres_national.csv')}
    gb = {int(r['cycle']): (float(r['poll_avg']), float(r['actual'])) for r in rows('generic_ballot.csv')}
    off = defaultdict(dict)
    for r in rows('offyear_gov.csv'):
        off[int(r['year']) + 1][r['state']] = float(r['swing'])
    specials = {int(r['cycle']): float(r['specials_swing']) for r in rows('specials_track.csv')}
    races = []
    for r in rows('state_races.csv'):
        if r['lean'] == '':
            continue
        races.append(dict(cycle=int(r['cycle']), office=r['office'], state=r['state'], avg=float(r['poll_avg']),
                          act=float(r['actual']), lean=float(r['lean'])))
    return dict(house=house, appr=appr, pres=pres, gb=gb, off=off, specials=specials, races=races)


def linfit(xs, ys, ws=None):
    ws = ws or [1.0] * len(xs)
    mx, my = wmean(xs, ws), wmean(ys, ws)
    b = sum(x_ * (a - mx) * (c - my) for a, c, x_ in zip(xs, ys, ws)) / sum(x_ * (a - mx) ** 2 for a, x_ in zip(xs, ws))
    return my - b * mx, b


def ols(X, Y):
    k = len(X[0])
    A = [[sum(x[i] * x[j] for x in X) for j in range(k)] + [sum(x[i] * y for x, y in zip(X, Y))] for i in range(k)]
    for i in range(k):
        p = max(range(i, k), key=lambda r: abs(A[r][i]))
        A[i], A[p] = A[p], A[i]
        for r in range(k):
            if r != i:
                f = A[r][i] / A[i][i]
                A[r] = [a - f * c for a, c in zip(A[r], A[i])]
    return [A[i][k] / A[i][i] for i in range(k)]


# ---------------------------------------------------------------- national signals
def calibrate(d):
    gb, house, appr, pres = d['gb'], d['house'], d['appr'], d['pres']
    out = {}
    # 1. polls: how far the generic ballot in the final three weeks missed the House vote
    err = {y: p - a for y, (p, a) in gb.items()}
    ys = sorted(err)
    bias = wmean([err[y] for y in ys], [w(y) for y in ys])
    loo = {}
    for y in ys:
        o = [k for k in ys if k != y]
        loo[y] = err[y] - wmean([err[k] for k in o], [w(k) for k in o])
    out['polls'] = dict(bias=bias, errors=err, loo=loo,
                        rmse=wrmse([loo[y] for y in ys], [w(y) for y in ys]),
                        mid_mean=st.mean(err[y] for y in ys if y % 4 == 2), all_mean=st.mean(err.values()),
                        n_over=sum(1 for v in err.values() if v > 0), n=len(err))
    # 2. fundamentals: the president's party's swing in midterms since 1950 vs. net approval and its previous House margin
    F = []
    for y in range(1950, YEAR, 4):
        if y in appr and y - 2 in house and y in house:
            s = 1 if appr[y]['party'] == 'D' else -1
            prev = s * house[y - 2]
            F.append(dict(y=y, s=s, net=appr[y]['net'], prev=prev, chg=s * house[y] - prev))
    X = [[1, r['net'], r['prev']] for r in F]
    Y = [r['chg'] for r in F]
    beta = ols(X, Y)
    floo = {}
    for i, r in enumerate(F):
        bi = ols(X[:i] + X[i + 1:], Y[:i] + Y[i + 1:])
        floo[r['y']] = sum(a * c for a, c in zip(bi, X[i])) - r['chg']     # in the president's party's terms
    out['fund'] = dict(beta=beta, loo=floo, rows=F, rmse=wrmse([floo[r['y']] for r in F], [w(r['y']) for r in F]))
    # 3. special elections: the cycle's average swing vs. the actual House swing (both against the last presidential margin)
    actual_swing = {y: house[y] - pres[y - 2] for y in house if y - 2 in pres}
    over = {y: v - actual_swing[y] for y, v in d['specials'].items()}
    sloo = {y: d['specials'][y] - st.mean(over[k] for k in over if k != y) - actual_swing[y] for y in over}
    out['specials'] = dict(over=over, offset=st.mean(over.values()), loo=sloo,
                           rmse=max(SPECIALS_FLOOR, math.sqrt(st.mean(v * v for v in sloo.values()))), actual_swing=actual_swing)
    # 4. Virginia and New Jersey governors the year before (NJ 2013 left out: Christie's re-election landslide)
    ox = {}
    for y, sts in d['off'].items():
        if y >= YEAR:
            continue
        v = [sts[s] for s in sts if not (s == 'New Jersey' and y == 2014)]
        if v and y in actual_swing:
            ox[y] = st.mean(v)
    oy = sorted(ox)
    a, b = linfit([ox[y] for y in oy], [actual_swing[y] for y in oy])
    oloo = {}
    for y in oy:
        o = [k for k in oy if k != y]
        ai, bi = linfit([ox[k] for k in o], [actual_swing[k] for k in o])
        oloo[y] = ai + bi * ox[y] - actual_swing[y]
    out['offyear'] = dict(a=a, b=b, x=ox, loo=oloo, rmse=math.sqrt(st.mean(v * v for v in oloo.values())))
    return out


def fm(m):
    return 'Even' if abs(m) < 0.05 else ('D+' if m > 0 else 'R+') + f'{abs(m):.1f}'


def signed(v, digits=1):
    return ('+' if v >= 0 else '\u2212') + f'{abs(v):.{digits}f}'


def national(cal, d, g0, approval_net, specials_now, offyear_now, president='R', prev_house=None):
    """The 2026 national House vote from each signal, and the backtest-weighted blend."""
    prev_house = d['house'][YEAR - 2] if prev_house is None else prev_house
    pres_prev = d['pres'][YEAR - 2]
    s = 1 if president == 'D' else -1
    comps = []
    comps.append(dict(k='polls', label='Polls, corrected for their record', est=g0 - cal['polls']['bias'],
                      sigma=math.sqrt(cal['polls']['rmse'] ** 2 + 1.0),
                      note=f"The generic ballot is {fm(g0)}. Three weeks out it has overstated Democrats by {cal['polls']['bias']:.1f} points on average (weighted to midterms and recent years); it ran too Democratic in {cal['polls']['n_over']} of {cal['polls']['n']} elections since 1998."))
    beta = cal['fund']['beta']
    chg = beta[0] + beta[1] * approval_net + beta[2] * (s * prev_house)
    comps.append(dict(k='fund', label='Approval and the midterm swing', est=s * (s * prev_house + chg),
                      sigma=cal['fund']['rmse'],
                      note=f"Midterms since 1950: the president's party loses ground, more when the president is unpopular. Trump's net approval is {signed(approval_net, 0)}."))
    if specials_now is not None:
        comps.append(dict(k='specials', label='Special elections', est=pres_prev + specials_now - cal['specials']['offset'],
                          sigma=cal['specials']['rmse'],
                          note=f"Democrats have beaten the 2024 presidential margin by {specials_now:.1f} points in this cycle's special elections. In 2006, 2018 and 2022 specials overstated the eventual swing by {cal['specials']['offset']:.1f} points on average, so that much is taken off."))
    if offyear_now is not None:
        o = cal['offyear']
        comps.append(dict(k='offyear', label='2025 Virginia and New Jersey governors', est=pres_prev + o['a'] + o['b'] * offyear_now,
                          sigma=o['rmse'],
                          note=f"Both states moved {abs(offyear_now):.1f} points toward {'Democrats' if offyear_now > 0 else 'Republicans'} from 2024. The off-year governor races have pointed the right way before every midterm since 2006, with large misses in size."))
    inv = [1 / c['sigma'] ** 2 for c in comps]
    tot = sum(inv)
    for c, v in zip(comps, inv):
        c['weight'] = v / tot
    blend = sum(c['weight'] * c['est'] for c in comps)
    var = sum(c['weight'] ** 2 * c['sigma'] ** 2 for c in comps)
    for i, a in enumerate(comps):
        for j, b in enumerate(comps):
            if i < j:
                var += 2 * RHO * a['weight'] * b['weight'] * a['sigma'] * b['sigma']
    sd = math.sqrt(var)
    return dict(est=blend, sd=sd, sig_model=round(math.sqrt(sd ** 2 + SEAT_EXTRA ** 2), 1), comps=comps)


def scorecard(cal, d):
    """Each past midterm as the method would have seen it three weeks out (every signal estimated without that year)."""
    house, pres, gb = d['house'], d['pres'], d['gb']
    rows_ = []
    for y in sorted(gb):
        poll, act = gb[y]
        r = dict(year=y, midterm=y % 4 == 2, polls=poll, polls_fixed=None, fund=None, specials=None, offyear=None, blend=None, actual=act)
        r['polls_fixed'] = act + cal['polls']['loo'][y]
        comps = [('polls', r['polls_fixed'], math.sqrt(cal['polls']['rmse'] ** 2 + 1.0))]
        if y % 4 == 2:
            F = {x['y']: x for x in cal['fund']['rows']}
            if y in F:
                x = F[y]
                pred_chg = x['chg'] + cal['fund']['loo'][y]
                r['fund'] = x['s'] * (x['prev'] + pred_chg)
                comps.append(('fund', r['fund'], cal['fund']['rmse']))
            if y in cal['specials']['loo'] and y - 2 in pres:
                r['specials'] = act + cal['specials']['loo'][y]
                comps.append(('specials', r['specials'], cal['specials']['rmse']))
            if y in cal['offyear']['loo'] and y - 2 in pres:
                r['offyear'] = act + cal['offyear']['loo'][y]
                comps.append(('offyear', r['offyear'], cal['offyear']['rmse']))
            inv = [1 / c[2] ** 2 for c in comps]
            r['blend'] = sum(c[1] * v for c, v in zip(comps, inv)) / sum(inv)
        rows_.append(r)
    def rm(key, sel):
        e = [r[key] - r['actual'] for r in rows_ if sel(r) and r[key] is not None]
        return round(math.sqrt(st.mean(x * x for x in e)), 2) if e else None
    full = lambda r: r['midterm'] and r['year'] >= 2006
    mids = lambda r: r['midterm']
    trump = lambda r: r['year'] in (2018, 2022)
    better = [r['year'] for r in rows_ if r['blend'] is not None and abs(r['blend'] - r['actual']) < abs(r['polls'] - r['actual'])]
    metrics = dict(midterms_2006_2022=dict(polls=rm('polls', full), polls_fixed=rm('polls_fixed', full), blend=rm('blend', full)),
                   midterms_1998_2022=dict(polls=rm('polls', mids), polls_fixed=rm('polls_fixed', mids), blend=rm('blend', mids)),
                   trump_midterms=dict(polls=rm('polls', trump), polls_fixed=rm('polls_fixed', trump), blend=rm('blend', trump)),
                   all_1998_2024=dict(polls=rm('polls', lambda r: True), polls_fixed=rm('polls_fixed', lambda r: True)),
                   blend_beat_polls=better, n_midterms=sum(1 for r in rows_ if r['blend'] is not None))
    return rows_, metrics


# ---------------------------------------------------------------- Senate and governor races
def state_calibration(d):
    R = d['races']
    cyc = defaultdict(list)
    for r in R:
        cyc[(r['cycle'])].append(r['avg'] - r['act'])
    bias = {y: st.mean(v) for y, v in cyc.items()}
    # within-cycle slope of the miss on state lean
    num_ = den_ = 0.0
    by = defaultdict(list)
    for r in R:
        by[(r['cycle'], r['office'])].append(r)
    for (y, _), L in by.items():
        if len(L) < 3:
            continue
        mx = st.mean(r['lean'] for r in L)
        my = st.mean(r['avg'] - r['act'] for r in L)
        for r in L:
            num_ += w(y) * (r['lean'] - mx) * (r['avg'] - r['act'] - my)
            den_ += w(y) * (r['lean'] - mx) ** 2
    slope = num_ / den_
    # national environment each year as the method would have had it: generic ballot minus its average miss in the
    # other years (that year's own miss is unknown at the time)
    gerr = {y: p - a for y, (p, a) in d['gb'].items()}
    pb = {y: st.mean(v for k, v in gerr.items() if k != y) for y in gerr}
    def fund(r):
        return r['lean'] + d['gb'][r['cycle']][0] - pb[r['cycle']]
    out = dict(lean_slope=slope, cycle_bias={y: round(v, 2) for y, v in sorted(bias.items())})
    for office in ('Sen', 'Gov'):
        C = [r for r in R if r['office'] == office and abs(r['act']) < 20 and r['cycle'] in d['gb']]
        def score(a, sel=lambda r: True):
            L = [r for r in C if sel(r)]
            return wrmse([a * r['avg'] + (1 - a) * fund(r) - r['act'] for r in L], [w(r['cycle']) for r in L])
        def best_a(sel=lambda r: True):
            return min((score(a / 20, sel), a / 20) for a in range(0, 21))[1]
        a = best_a()
        # out of sample: each cycle scored with the weight chosen from the other cycles only
        cv = {}
        for y in sorted({r['cycle'] for r in C}):
            cv[y] = best_a(lambda r, y=y: r['cycle'] != y)
        def score_cv(sel=lambda r: True):
            L = [r for r in C if sel(r)]
            return wrmse([cv[r['cycle']] * r['avg'] + (1 - cv[r['cycle']]) * fund(r) - r['act'] for r in L], [w(r['cycle']) for r in L])
        mid = lambda r: r['cycle'] % 4 == 2
        trump_mid = lambda r: r['cycle'] in (2018, 2022)
        better = sum(1 for r in C if abs(cv[r['cycle']] * r['avg'] + (1 - cv[r['cycle']]) * fund(r) - r['act']) < abs(r['avg'] - r['act']))
        out[office] = dict(n=len(C), best_a=a, a_by_cycle={str(k): v for k, v in cv.items()},
                           rmse_polls=round(score(1.0), 2), rmse_blend=round(score_cv(), 2),
                           rmse_polls_mid=round(score(1.0, mid), 2), rmse_blend_mid=round(score_cv(mid), 2),
                           rmse_polls_trump_mid=round(score(1.0, trump_mid), 2), rmse_blend_trump_mid=round(score_cv(trump_mid), 2),
                           n_trump_mid=sum(1 for r in C if trump_mid(r)), n_better=better)
    mids = {y: v for y, v in bias.items() if y % 4 == 2}
    out['midterm_bias_mean'] = round(st.mean(mids.values()), 2)
    out['midterm_bias_sd'] = round(st.pstdev(mids.values()), 2)
    return out


POLLED = ('polls', 'oct9')      # sources that are a two-way polling average (oct9: the Oct 9 Senate model's average, carried forward)


def adjust_races(senate, gov, statecomp, n24, nat, g0, scal):
    """Blend each race's polling average with its state's partisanship plus the national environment, using the
    backtested weights. Incumbents running against their state's lean (Collins, Scott, Ayotte, Hobbs) keep their
    polls: the fundamentals know the state, not the candidate. Three-way races and races with an independent
    (Osborn) keep their polls too, since the backtest only covers Democrat-vs-Republican races. Races with no polls
    follow the national environment, as they do in the app when the national slider moves."""
    out = dict(senate={}, gov={}, kept=[])
    for key, lst, a, slope in (('senate', senate, scal['Sen']['best_a'], 1.0), ('gov', gov, scal['Gov']['best_a'], 0.8)):
        for r in lst:
            src = r.get('src') or ''
            if src == 'fundamentals':
                out[key][r['id']] = round(r['base'] + slope * (nat - g0), 2)
                continue
            if src not in POLLED:
                out['kept'].append(dict(id=r['id'], why='three-way race' if '3way' in src else 'not a two-way polling average'))
                continue
            if r.get('dp') == 'I' or r.get('rp') == 'I':
                out['kept'].append(dict(id=r['id'], why='an independent on the ballot; the backtest covers Democrat-vs-Republican races'))
                continue
            lean = statecomp[r['st']]['m24'] - n24
            inc = r.get('inc') or ''
            if (inc == 'R' and lean > 2) or (inc == 'D' and lean < -2):
                out['kept'].append(dict(id=r['id'], why='incumbent running against the state\'s lean'))
                continue
            out[key][r['id']] = round(a * r['base'] + (1 - a) * (lean + nat), 2)
    return out


def state_track(d):
    """Does a state's polling miss carry over to its next election? Each state's miss net of its cycle's average
    miss and the lean pattern, carried forward at weight k, scored on the next election's races."""
    R = d['races']
    cyc = defaultdict(list)
    for r in R:
        cyc[r['cycle']].append(r['avg'] - r['act'])
    cb = {y: st.mean(v) for y, v in cyc.items()}
    se = defaultdict(list)
    for r in R:
        se[(r['cycle'], r['state'])].append(r['avg'] - r['act'] - cb[r['cycle']] + 0.09 * r['lean'])
    se = {k: st.mean(v) for k, v in se.items()}
    out = []
    for prev, cur in [(2006, 2010), (2010, 2014), (2014, 2018), (2018, 2022), (2016, 2020), (2020, 2024), (2022, 2024)]:
        L = [r for r in R if r['cycle'] == cur and abs(r['act']) < 20]
        def rm(k):
            e = [r['avg'] - r['act'] - k * se.get((prev, r['state']), 0.0) for r in L]
            return math.sqrt(st.mean(x * x for x in e))
        out.append(dict(prev=prev, cur=cur, n=len(L), none=round(rm(0.0), 2), k25=round(rm(0.25), 2)))
    return out


# ---------------------------------------------------------------- other signals (tested, shown, not in the blend)
ECON = os.path.join(DATA, 'econ')
SIGNALS = [
    # key, label, series, how, unit, note
    ('sent', 'Consumer sentiment (Michigan)', 'UMCSENT', 'level', 'index', 'Latest reading by September'),
    ('sent_chg', 'Consumer sentiment, change from a year ago', 'UMCSENT', 'diff12', 'pts', ''),
    ('unemp', 'Unemployment rate', 'UNRATE', 'level', '%', 'September'),
    ('unemp_chg', 'Unemployment, change from a year ago', 'UNRATE', 'diff12', 'pts', ''),
    ('infl', 'Inflation (CPI, year over year)', 'CPIAUCSL', 'yoy', '%', 'August'),
    ('food_away', 'Restaurant prices (CPI food away from home, year over year)', 'CUSR0000SEFV', 'yoy', '%', 'The Chipotle-bowl index'),
    ('gas', 'Gasoline prices (CPI, year over year)', 'CUSR0000SETB01', 'yoy', '%', 'August'),
    ('rdi', 'Real disposable income per person (year over year)', 'A229RX0', 'yoy', '%', 'August'),
    ('gdp', 'Real GDP (year over year)', 'GDPC1', 'yoy', '%', 'Second quarter'),
    ('jobs', 'Payroll jobs (year over year)', 'PAYEMS', 'yoy', '%', 'September'),
    ('sp500', 'S&P 500 (year over year)', 'SP500_MONTHLY', 'yoy', '%', 'September average'),
    ('retire', 'House retirements, president\'s party minus the other party', None, 'retire', 'members', 'Members not seeking re-election'),
]


def _series(sid):
    out = {}
    try:
        for r in csv.DictReader(open(os.path.join(ECON, sid + '.csv'), encoding='utf-8')):
            out[r['date'][:7]] = float(r['value'])
    except OSError:
        pass
    return out


def _at(d, y, m, back):
    for k in range(back + 1):
        mm, yy = m - k, y
        while mm <= 0:
            mm += 12
            yy -= 1
        v = d.get(f'{yy}-{mm:02d}')
        if v is not None:
            return v
    return None


def _feature(how, d, y, m, back=0):
    if how == 'level':
        return _at(d, y, m, back)
    a, b = _at(d, y, m, back), _at(d, y - 1, m, back)
    if a is None or b is None:
        return None
    return a - b if how == 'diff12' else 100 * (a / b - 1)


MONTH = {'UMCSENT': (9, 4), 'UNRATE': (9, 0), 'CPIAUCSL': (8, 0), 'CUSR0000SEFV': (8, 0), 'CUSR0000SETB01': (8, 0),
         'A229RX0': (8, 0), 'GDPC1': (4, 0), 'PAYEMS': (9, 0), 'SP500_MONTHLY': (9, 0)}


def _retire(y, pres_party):
    try:
        for r in csv.DictReader(open(os.path.join(DATA, 'retirements.csv'), encoding='utf-8')):
            if int(r['year']) == y and 'not used' not in r['note']:
                d, rp = int(r['dem']), int(r['rep'])
                return (rp - d) if pres_party == 'R' else (d - rp)
    except OSError:
        pass
    return None


def other_signals(cal, president='R'):
    """Does each signal predict the president's party's midterm swing beyond approval and exposure? Leave-one-out,
    midterms since 1950 where the series exists. Returns each signal's current reading and its verdict."""
    F = cal['fund']['rows']
    series = {sid: _series(sid) for sid in MONTH}
    out = []
    for key, label, sid, how, unit, note in SIGNALS:
        vals = {}
        for r in F:
            if sid:
                m, back = MONTH[sid]
                vals[r['y']] = _feature(how, series[sid], r['y'], m, back)
            else:
                vals[r['y']] = _retire(r['y'], 'D' if r['s'] == 1 else 'R')
        if sid:
            m, back = MONTH[sid]
            now = _feature(how, series[sid], YEAR, m, back)
        else:
            now = _retire(YEAR, president)
        rows_ = [r for r in F if vals.get(r['y']) is not None]
        if len(rows_) < 6 or now is None:
            out.append(dict(key=key, label=label, unit=unit, note=note, now=now, n=len(rows_), verdict='no data'))
            continue
        X0 = [[1, r['net'], r['prev']] for r in rows_]
        X1 = [[1, r['net'], r['prev'], vals[r['y']]] for r in rows_]
        Y = [r['chg'] for r in rows_]
        def loo(X):
            e = []
            for i in range(len(X)):
                b = ols(X[:i] + X[i + 1:], Y[:i] + Y[i + 1:])
                e.append(sum(a * c for a, c in zip(b, X[i])) - Y[i])
            return math.sqrt(st.mean(v * v for v in e))
        r0, r1 = loo(X0), loo(X1)
        beta = ols(X1, Y)
        gain = 100 * (1 - r1 / r0)
        verdict = 'helps a little' if gain >= 5 else ('no help' if gain > -5 else 'hurts')
        # direction of the fitted effect, in the president's party's terms
        out.append(dict(key=key, label=label, unit=unit, note=note, now=round(now, 2), n=len(rows_), first=min(r['y'] for r in rows_),
                        gain=round(gain, 1), coef=round(beta[-1], 3), rmse_base=round(r0, 2), rmse_with=round(r1, 2), verdict=verdict,
                        hist={str(r['y']): round(vals[r['y']], 2) for r in rows_}))
    return out


def live(g0, senate, gov, statecomp, n24, content):
    """Called by build.py on every run. Returns what the app shows as "Our forecast" and its backtest."""
    d = load()
    cal = calibrate(d)
    ap = (content.get('approval') or {}).get('net')
    ap = ap if ap is not None else d['appr'][YEAR - 4]['net']
    spc = content.get('specials') or {}
    sp = spc.get('value')
    off = content.get('offyear') or {}
    offv = st.mean([off[k] for k in ('VA', 'NJ') if k in off]) if off else None
    nat = national(cal, d, g0, ap, sp, offv)
    scal = state_calibration(d)
    adj = adjust_races(senate, gov, statecomp, n24, nat['est'], g0, scal)
    rows_, metrics = scorecard(cal, d)
    r1 = lambda x: None if x is None else round(x, 2)
    sens = []
    if spc.get('recent') is not None:
        sens.append(dict(label=f"Only this year's special elections ({signed(spc['recent'])} vs. 2024)", est=national(cal, d, g0, ap, spc['recent'], offv)['est']))
    sens.append(dict(label='Without special elections', est=national(cal, d, g0, ap, None, offv)['est']))
    sens.append(dict(label=f"Approval 4 points better or worse (net {signed(ap + 4, 0)} / {signed(ap - 4, 0)})",
                     est=national(cal, d, g0, ap + 4, sp, offv)['est'], est2=national(cal, d, g0, ap - 4, sp, offv)['est']))
    alt = lambda **kw: reweighted(lambda: national(calibrate(d), d, g0, ap, sp, offv)['est'], **kw)
    sens.append(dict(label='Older elections fade faster or slower (half-life 6 or 24 years, vs 12)', est=alt(half_life=6.0), est2=alt(half_life=24.0)))
    sens.append(dict(label='Presidential years count a quarter or fully (vs half a midterm)', est=alt(pres_w=0.25), est2=alt(pres_w=1.0)))
    keep_state = ('n', 'best_a', 'rmse_polls', 'rmse_blend', 'rmse_polls_mid', 'rmse_blend_mid', 'rmse_polls_trump_mid',
                  'rmse_blend_trump_mid', 'n_trump_mid', 'n_better')
    F = json.load(open(os.path.join(DATA, 'findings.json')))
    return dict(
        national=round(nat['est'], 2), sd=round(nat['sd'], 2), sig=nat['sig_model'], polls=round(g0, 2),
        comps=[dict(k=c['k'], label=c['label'], est=round(c['est'], 2), sigma=round(c['sigma'], 2), weight=round(c['weight'], 3), note=c['note']) for c in nat['comps']],
        senate=adj['senate'], gov=adj['gov'], kept=adj['kept'],
        a_sen=scal['Sen']['best_a'], a_gov=scal['Gov']['best_a'],
        sens=[{k: (round(v, 2) if isinstance(v, float) else v) for k, v in x.items()} for x in sens],
        backtest=dict(
            national=[{k: (r1(v) if isinstance(v, float) else v) for k, v in r.items()} for r in rows_],
            metrics=metrics,
            polls=dict(bias=round(cal['polls']['bias'], 2), mid_mean=round(cal['polls']['mid_mean'], 2),
                       n_over=cal['polls']['n_over'], n=cal['polls']['n'], rmse=round(cal['polls']['rmse'], 2)),
            fund=dict(n=len(cal['fund']['rows']), first=min(r['y'] for r in cal['fund']['rows']), rmse=round(cal['fund']['rmse'], 2)),
            specials=dict(offset=round(cal['specials']['offset'], 2), over={str(k): round(v, 1) for k, v in cal['specials']['over'].items()}),
            offyear=dict(rmse=round(cal['offyear']['rmse'], 2), n=len(cal['offyear']['x'])),
            state=dict(lean_slope=round(scal['lean_slope'], 3),
                       midterm_bias={str(y): v for y, v in scal['cycle_bias'].items() if y % 4 == 2},
                       Sen={k: scal['Sen'][k] for k in keep_state}, Gov={k: scal['Gov'][k] for k in keep_state},
                       n_races=len(d['races'])),
            state_track=state_track(d),
            pollsters=F['pollster_persistence'],
            signals=other_signals(cal),
            weights=dict(midterm=1.0, presidential=PRES_W, half_life=HALF_LIFE, rho=RHO, seat_extra=SEAT_EXTRA),
        ),
    )


if __name__ == '__main__':
    ROOT = os.path.dirname(os.path.dirname(HERE))
    D = json.load(open(os.path.join(ROOT, 'site', 'data.json')))
    content = json.load(open(os.path.join(ROOT, 'pipeline', 'content', 'fundamentals.json')))
    out = live(D['G0'], D['senate'], D['gov'], D['statecomp'], D['N24'], content)
    print(f"Polls D{out['polls']:+.2f} -> our forecast D{out['national']:+.2f} (sd {out['sd']:.2f}; model sigma {out['sig']})")
    for c in out['comps']:
        print(f"  {c['label']:42s} {c['est']:+6.2f}  sigma {c['sigma']:.2f}  weight {c['weight']:.2f}")
    for x in out['sens']:
        print('  sensitivity:', x)
    bt = out['backtest']
    print('scorecard:')
    for r in bt['national']:
        print('  ', r)
    print('metrics', json.dumps(bt['metrics']))
    print('state', json.dumps(bt['state']))
    print('state track', bt['state_track'])
    print('kept', out['kept'])
    sen = {r['id']: r for r in D['senate']}
    print('senate polls -> ours:', {k: (sen[k]['base'], v) for k, v in out['senate'].items() if abs(sen[k]['base']) < 15})
    gov = {r['id']: r for r in D['gov']}
    print('gov polls -> ours:', {k: (gov[k]['base'], v) for k, v in out['gov'].items() if abs(gov[k]['base']) < 15})
