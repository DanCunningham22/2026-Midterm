"""Campaign money in every House and Senate race, from the Federal Election Commission's bulk files.

Candidates: what each nominee's campaign has raised, spent and has in the bank this cycle, from the FEC's
"House/Senate current campaigns" summary file (webl26.zip: pipe-delimited, no header, one row per candidate,
totals summed over the candidate's authorized committees through the latest report).

Outside spending: independent expenditures (ads, mail, canvassing paid for by super PACs, party committees and
other groups) for or against each nominee, from the FEC's file of 24- and 48-hour reports
(independent_expenditure_2026.csv). That file keeps an original report's rows after it is amended, so an
amended report replaces every earlier version of it, and repeated transactions count once. General-election
spending only: primaries and primary runoffs are excluded (the Texas Senate runoff alone drew tens of millions).

Governor races are state elections and are not reported to the FEC.

    python3 pipeline/fec_money.py probe --out /tmp/money.json   # standalone run, with diagnostics

Standard library only.
"""
import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile

CYCLE = 2026
BASE = f'https://www.fec.gov/files/bulk-downloads/{CYCLE}/'
CAND_FILES = [f'webl{CYCLE % 100}.zip', f'weball{CYCLE % 100}.zip']
IE_FILE = f'independent_expenditure_{CYCLE}.csv'
UA = {'User-Agent': 'midterm-map data job (GitHub Actions)'}
# Senate seats filled by special election on Nov 3, and the day after each state's primary: special-election
# spending after that date is general-election spending
SPECIAL_SEN = {'OH': dt.date(2026, 5, 6), 'FL': dt.date(2026, 8, 19)}
WEBL_COLS = ['CAND_ID', 'CAND_NAME', 'CAND_ICI', 'PTY_CD', 'CAND_PTY_AFFILIATION', 'TTL_RECEIPTS', 'TRANS_FROM_AUTH',
             'TTL_DISB', 'TRANS_TO_AUTH', 'COH_BOP', 'COH_COP', 'CAND_CONTRIB', 'CAND_LOANS', 'OTHER_LOANS',
             'CAND_LOAN_REPAY', 'OTHER_LOAN_REPAY', 'DEBTS_OWED_BY', 'TTL_INDIV_CONTRIB', 'CAND_OFFICE_ST',
             'CAND_OFFICE_DISTRICT', 'SPEC_ELECTION', 'PRIM_ELECTION', 'RUN_ELECTION', 'GEN_ELECTION',
             'GEN_ELECTION_PRECENT', 'OTHER_POL_CMTE_CONTRIB', 'POL_PTY_CONTRIB', 'CVG_END_DT', 'INDIV_REFUNDS',
             'CMTE_REFUNDS']
# independent-expenditure columns: accepted header spellings, and the documented order as a fallback
IE_COLS = [
    ('cand_id', ('cand_id', 'can_id')), ('cand_name', ('cand_name', 'can_nam', 'can_name')),
    ('spe_id', ('spe_id',)), ('spe_nam', ('spe_nam', 'spe_name')), ('ele_type', ('ele_type', 'ele_typ')),
    ('st', ('can_office_state', 'can_off_sta', 'cand_office_st', 'can_office_sta')),
    ('dist', ('can_office_dis', 'can_off_dis', 'cand_office_district', 'can_office_district')),
    ('office', ('can_office', 'can_off', 'cand_office')), ('party', ('cand_pty_aff', 'can_par_aff', 'cand_party_aff')),
    ('amount', ('exp_amo', 'exp_amount')), ('date', ('exp_date', 'exp_dat')), ('agg', ('agg_amo',)),
    ('sup_opp', ('sup_opp',)), ('pur', ('pur', 'purpose')), ('pay', ('pay', 'payee')), ('file_num', ('file_num',)),
    ('amend', ('amndt_ind', 'amn_ind', 'amend_ind')), ('tran_id', ('tran_id', 'tra_id')),
    ('image', ('image_num', 'ima_num')), ('received', ('receipt_dat', 'rec_dt', 'receipt_date')),
    ('year', ('fec_election_yr',)), ('prev', ('prev_file_num',)), ('dissem', ('dissem_dt',)),
]
SUFFIX = {'JR', 'SR', 'II', 'III', 'IV', 'V', 'MD', 'PHD', 'DR', 'MR', 'MRS', 'MS', 'HON', 'ESQ'}
NICK = {'BILL': 'WILLIAM', 'WILL': 'WILLIAM', 'MIKE': 'MICHAEL', 'BOB': 'ROBERT', 'ROB': 'ROBERT', 'BETO': 'ROBERT',
        'JIM': 'JAMES', 'JIMMY': 'JAMES', 'TOM': 'THOMAS', 'TOMMY': 'THOMAS', 'DAN': 'DANIEL', 'DANNY': 'DANIEL',
        'DAVE': 'DAVID', 'JOE': 'JOSEPH', 'CHRIS': 'CHRISTOPHER', 'NICK': 'NICHOLAS', 'TONY': 'ANTHONY',
        'ANDY': 'ANDREW', 'DREW': 'ANDREW', 'BEN': 'BENJAMIN', 'SAM': 'SAMUEL', 'PAT': 'PATRICK', 'RICK': 'RICHARD',
        'RICH': 'RICHARD', 'DICK': 'RICHARD', 'TED': 'EDWARD', 'ED': 'EDWARD', 'ZACH': 'ZACHARY', 'MATT': 'MATTHEW',
        'STEVE': 'STEVEN', 'KATE': 'KATHERINE', 'KATIE': 'KATHERINE', 'LIZ': 'ELIZABETH', 'BETH': 'ELIZABETH',
        'JEN': 'JENNIFER', 'SUE': 'SUSAN', 'SUZIE': 'SUSAN', 'PETE': 'PETER', 'GREG': 'GREGORY', 'JEFF': 'JEFFREY',
        'JOHNNY': 'JOHN', 'JACK': 'JOHN', 'CHUCK': 'CHARLES', 'CHARLIE': 'CHARLES', 'HANK': 'HENRY',
        'LARRY': 'LAWRENCE', 'TIM': 'TIMOTHY', 'KEN': 'KENNETH', 'RON': 'RONALD', 'DON': 'DONALD', 'DOUG': 'DOUGLAS',
        'JOSH': 'JOSHUA', 'ALEX': 'ALEXANDER', 'GABE': 'GABRIEL', 'NATE': 'NATHAN', 'JON': 'JONATHAN'}


def download(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as r, open(path, 'wb') as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return os.path.getsize(path)


def num(s):
    try:
        return float(str(s).replace(',', '').replace('$', '').strip() or 0)
    except ValueError:
        return 0.0


def parse_date(s):
    s = (s or '').strip()
    for fmt in ('%m/%d/%Y', '%Y-%m-%d', '%d-%b-%y', '%d-%b-%Y', '%m%d%Y', '%Y%m%d', '%m/%d/%y', '%Y-%m-%d %H:%M:%S'):
        try:
            return dt.datetime.strptime(s[:19].strip() if '%H' in fmt else s[:11].strip(), fmt).date()
        except ValueError:
            pass
    return None


# ---------------------------------------------------------------- names
def tokens(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode()
    s = re.sub(r'\(.*?\)', ' ', s)
    s = re.sub(r'"[^"]*"', ' ', s)
    s = s.replace("'", '').replace('.', ' ')
    s = re.sub(r'[^A-Za-z ]', ' ', s)
    return [t for t in s.upper().split() if t not in SUFFIX]


def fec_parts(name):
    """FEC names read 'LAST, FIRST MIDDLE'."""
    if ',' in name:
        last, first = name.split(',', 1)
        return tokens(last), tokens(first)
    t = tokens(name)
    return t[-1:], t[:-1]


def same_first(a, b):
    a, b = NICK.get(a, a), NICK.get(b, b)
    return a == b or a[:3] == b[:3]


def name_score(ours, fec_name):
    """2 if the surnames match, 3 if the first names agree as well; 1 for a weak surname match; 0 for none."""
    ot = tokens(ours)
    last, first = fec_parts(fec_name)
    n = len(last)
    if not ot or not n:
        return 0
    first_ok = bool(first) and len(ot) > 1 and (same_first(first[0], ot[0]) or ot[0] in first)
    if ot[-n:] == last or any(ot[i:i + n] == last for i in range(len(ot) - n + 1)):
        s = 2
    elif first_ok and (ot[-1] in last or ot[-1] in first[1:]):   # compound, married or maiden surnames
        s = 2
    elif n > 1 and ot[-1] == last[-1]:
        s = 1
    else:
        return 0
    return s + (1 if first_ok else 0)


# ---------------------------------------------------------------- FEC files
def read_candidates(path):
    out = []
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.lower().endswith('.txt')] or z.namelist()
        with z.open(names[0]) as raw:
            for line in io.TextIOWrapper(raw, encoding='latin-1', newline=''):
                f = line.rstrip('\r\n').split('|')
                if len(f) < 28 or f[0].strip() in ('', 'CAND_ID'):
                    continue
                r = dict(zip(WEBL_COLS, f))
                cid = r['CAND_ID'].strip()
                if cid[:1] not in ('H', 'S'):
                    continue
                t_in, t_out = num(r['TRANS_FROM_AUTH']), num(r['TRANS_TO_AUTH'])
                internal = min(t_in, t_out)      # transfers between the candidate's own committees appear on both sides
                d = (r['CAND_OFFICE_DISTRICT'] or '').strip()
                out.append(dict(
                    id=cid, office=cid[0], name=r['CAND_NAME'].strip(), party=r['CAND_PTY_AFFILIATION'].strip().upper(),
                    ici=r['CAND_ICI'].strip(), st=r['CAND_OFFICE_ST'].strip().upper(), dist=int(d) if d.isdigit() else None,
                    raised=num(r['TTL_RECEIPTS']) - internal, spent=num(r['TTL_DISB']) - internal, cash=num(r['COH_COP']),
                    indiv=num(r['TTL_INDIV_CONTRIB']), thru=parse_date(r['CVG_END_DT'])))
    return out


def ie_columns(head):
    h = [x.strip().strip('"').lower() for x in head]
    ix = {}
    for key, names in IE_COLS:
        for n in names:
            if n in h:
                ix[key] = h.index(n)
                break
    need = ('cand_id', 'spe_id', 'amount', 'sup_opp', 'file_num')
    if all(k in ix for k in need):
        return ix, True
    # no recognizable header: the documented column order
    return {key: i for i, (key, _) in enumerate(IE_COLS)}, False


def general(ele_type, date, office, st):
    """Is this general-election spending for Nov 3, 2026?"""
    e = (ele_type or '').strip().upper()
    kind, yr = e[:1], e[1:5]
    if yr.isdigit() and int(yr) != CYCLE:
        return False
    if date and date < dt.date(CYCLE - 1, 1, 1):
        return False
    if kind == 'G':
        return True
    if kind == 'S':        # special elections: only the OH and FL Senate seats, after their primaries
        return office == 'S' and st in SPECIAL_SEN and bool(date) and date >= SPECIAL_SEN[st]
    if kind == '':
        return bool(date and date >= dt.date(CYCLE, 8, 15))
    return False           # primary, runoff (so far only primary runoffs), convention, other


def read_ie(path):
    """General-election independent expenditures for every candidate, after amendments and repeats are removed.
    Returns (rows, diag, candidates seen in the file)."""
    diag = dict(rows=0, header_found=False, kinds={}, superseded=0, repeats=0, excluded=0, sample=[])
    parent, rows, cands = {}, [], {}
    with open(path, encoding='latin-1', newline='') as f:
        rd = csv.reader(f)
        first = next(rd)
        ix, has_head = ie_columns(first)
        diag['header_found'] = has_head
        if not has_head:
            f.seek(0)
            rd = csv.reader(f)
        width = max(ix.values())
        get = lambda row, k: row[ix[k]].strip() if k in ix and ix[k] < len(row) else ''
        for row in rd:
            if len(row) <= min(width, ix['file_num']):
                continue
            diag['rows'] += 1
            fn, pv = get(row, 'file_num'), get(row, 'prev')
            if fn and pv and pv != fn:
                parent[fn] = pv
            st = get(row, 'st').upper()
            cid = get(row, 'cand_id').upper()
            office = cid[:1] if cid[:1] in ('H', 'S', 'P') else get(row, 'office').upper()[:1]
            dist = get(row, 'dist')
            dist = int(dist) if dist.isdigit() else None
            cname = get(row, 'cand_name')
            if not cid:
                cid = f"~{office}{st}{dist}:{'_'.join(tokens(cname))}"
            if office not in ('H', 'S'):
                continue
            if cid not in cands:
                cands[cid] = dict(name=cname, st=st, office=office, dist=dist)
            d = parse_date(get(row, 'date')) or parse_date(get(row, 'dissem'))
            e = get(row, 'ele_type').upper()
            diag['kinds'][e[:5] or '?'] = diag['kinds'].get(e[:5] or '?', 0) + 1
            if len(diag['sample']) < 3:
                diag['sample'].append({k: get(row, k) for k in ('ele_type', 'date', 'dissem', 'received', 'amount', 'sup_opp', 'file_num', 'prev', 'amend', 'tran_id')})
            if not general(e, d, office, st):
                diag['excluded'] += 1
                continue
            so = get(row, 'sup_opp').upper()[:1]
            if so not in ('S', 'O'):
                continue
            rows.append(dict(cid=cid, so=so, amt=num(get(row, 'amount')), date=d, fn=fn, rec=parse_date(get(row, 'received')),
                             spe=get(row, 'spe_id').upper(), name=get(row, 'spe_nam'), tran=get(row, 'tran_id')))

    def root(fn):
        seen = set()
        while fn in parent and fn not in seen:
            seen.add(fn)
            fn = parent[fn]
        return fn

    def fnum(x):
        return int(re.sub(r'\D', '', x) or 0)
    latest = {}
    for fn in {r['fn'] for r in rows} | set(parent) | set(parent.values()):
        rt = root(fn)
        if fnum(fn) > fnum(latest.get(rt, '0')):
            latest[rt] = fn
    kept, seen = [], set()
    for r in rows:
        if r['fn'] and latest.get(root(r['fn']), r['fn']) != r['fn']:
            diag['superseded'] += 1
            continue
        key = (r['spe'], r['tran'], r['cid'], r['so'], round(r['amt'], 2), r['date'])
        if r['tran'] and key in seen:
            diag['repeats'] += 1
            continue
        seen.add(key)
        kept.append(r)
    diag['kept'] = len(kept)
    today = dt.date.today()
    rec = [r['rec'] for r in kept if r['rec'] and r['rec'] <= today]
    dates = [r['date'] for r in kept if r['date'] and r['date'] <= today]
    diag['first'] = min(dates).isoformat() if dates else None
    diag['last'] = (max(rec) if rec else max(dates)).isoformat() if (rec or dates) else None
    return kept, diag, cands


# ---------------------------------------------------------------- races
def race_where(race, at_large):
    office = 'S' if race['id'].endswith('-SEN') else 'H'
    dist = None if office == 'S' else int(race['id'].split('-')[1])
    return office, dist, (lambda d: office == 'S' or d == dist or (at_large and d in (0, 1)))


def party_fit(slot_party, fec_party):
    p = (fec_party or '').upper()
    if slot_party == 'D':
        return p in ('DEM', 'DFL')
    if slot_party == 'R':
        return p == 'REP'
    return p not in ('DEM', 'DFL', 'REP')


def match(race, slot, by_st, at_large):
    """The FEC summary record for a race's Democratic ('d') or Republican ('r') slot nominee."""
    name = race.get('dn' if slot == 'd' else 'rn') or ''
    if not tokens(name):
        return None
    party = race.get('dp' if slot == 'd' else 'rp') or ('D' if slot == 'd' else 'R')
    office, dist, here = race_where(race, at_large)
    pool = by_st.get((office, race['st']), [])

    def score(c):
        s = name_score(name, c['name'])
        return s + 1 if s and party_fit(party, c['party']) else s
    best = sorted(((score(c), c['raised'], c) for c in pool if here(c['dist'])), key=lambda x: (x[0], x[1]), reverse=True)
    if best and best[0][0] >= 2:
        return best[0][2]
    if office == 'H':   # district renumbered since the candidate filed: same state, first and last names both match
        alt = sorted(((score(c), c['raised'], c) for c in pool if name_score(name, c['name']) >= 3), key=lambda x: (x[0], x[1]), reverse=True)
        if alt:
            return alt[0][2]
    return None


def build(districts, senate, log=print):
    """Money for every contested House and Senate race: {'races': {id: {...}}, 'asof': ..., 'diag': ...}."""
    with tempfile.TemporaryDirectory() as tmp:
        cands, used = None, None
        for fname in CAND_FILES:
            try:
                p = os.path.join(tmp, fname)
                size = download(BASE + fname, p)
                cands, used = read_candidates(p), fname
                log(f'  FEC {fname}: {size:,} bytes, {len(cands):,} House/Senate candidates')
                if len(cands) > 500:
                    break
            except Exception as e:     # try the next file
                log(f'  FEC {fname}: {e}')
        if not cands or len(cands) < 500:
            raise ValueError('FEC candidate file missing or too small')
        ie_rows, ie_cands, ie_diag = [], {}, dict(error=None)
        try:
            p = os.path.join(tmp, IE_FILE)
            size = download(BASE + IE_FILE, p)
            ie_rows, ie_diag, ie_cands = read_ie(p)
            ie_diag['bytes'] = size
            log(f"  FEC {IE_FILE}: {size:,} bytes, {ie_diag['rows']:,} rows, {ie_diag['kept']:,} general-election rows kept")
        except Exception as e:
            ie_diag = dict(error=str(e)[:300])
            log(f'  FEC {IE_FILE}: {e}')

    by_st = {}
    for c in cands:
        by_st.setdefault((c['office'], c['st']), []).append(c)
    ie_by_st = {}
    for cid, c in ie_cands.items():
        ie_by_st.setdefault((c['office'], c['st']), []).append((cid, c))
    n_dist = {}
    for r in districts:
        n_dist[r['st']] = n_dist.get(r['st'], 0) + 1

    races, wanted, unmatched, no_summary, aliases = {}, {}, [], [], 0
    for r in list(districts) + list(senate):
        if r.get('unc'):
            continue
        at_large = n_dist.get(r['st']) == 1
        office, dist, here = race_where(r, at_large)
        entry = {}
        for slot in ('d', 'r'):
            name = r.get('dn' if slot == 'd' else 'rn') or ''
            if not tokens(name):
                continue
            c = match(r, slot, by_st, at_large)
            if c:
                entry[slot] = dict(id=c['id'], raised=round(c['raised']), spent=round(c['spent']), cash=round(c['cash']),
                                   thru=c['thru'].isoformat() if c['thru'] else None)
                wanted[c['id']] = (r['id'], slot)
            # the IDs outside groups used for this nominee: the summary ID, plus the same person under another ID
            # (or with no summary record yet, e.g. a nominee chosen late) in the same race
            party = r.get('dp' if slot == 'd' else 'rp') or ('D' if slot == 'd' else 'R')
            found = bool(c)
            for cid, ic in ie_by_st.get((office, r['st']), []):
                if cid in wanted or not here(ic['dist']):
                    continue
                s = name_score(name, ic['name'])
                if s >= 3 or (s >= 2 and not c):
                    wanted[cid] = (r['id'], slot)
                    aliases += 1
                    found = True
            if not c:
                (no_summary if found else unmatched).append(f"{r['id']} {slot.upper()} {name}")
        races[r['id']] = entry

    # outside spending by race: [for D, against D, for R, against R], and by spender
    spenders = {}
    for x in ie_rows:
        w = wanted.get(x['cid'])
        if not w:
            continue
        rid, slot = w
        e = races[rid]
        o = e.setdefault('o', [0.0, 0.0, 0.0, 0.0])
        o[(0 if x['so'] == 'S' else 1) + (0 if slot == 'd' else 2)] += x['amt']
        helps = 'D' if (slot == 'd') == (x['so'] == 'S') else 'R'
        sp = spenders.setdefault((rid, x['spe'] or x['name']), dict(names={}, D=0.0, R=0.0))
        sp[helps] += x['amt']
        sp['names'][x['name']] = sp['names'].get(x['name'], 0) + 1
    for e in races.values():
        if 'o' in e:
            e['o'] = [round(v) for v in e['o']]
    for (rid, _), sp in spenders.items():
        side = 'D' if sp['D'] >= sp['R'] else 'R'
        races[rid].setdefault('_top', []).append([max(sp['names'].items(), key=lambda kv: kv[1])[0], round(max(sp['D'], sp['R'])), side])
    for e in races.values():
        top = sorted(e.pop('_top', []), key=lambda x: -x[1])
        if top:
            e['top'] = top[:6]
            e['nsp'] = len(top)

    thru = [e[s]['thru'] for e in races.values() for s in ('d', 'r') if s in e and e[s]['thru']]
    matched = sum(1 for e in races.values() if 'd' in e or 'r' in e)
    if matched < 0.6 * len(races):
        raise ValueError(f'only {matched} of {len(races)} races matched FEC candidates')
    ie_diag['aliases'] = aliases
    return dict(
        races={k: v for k, v in races.items() if v},
        asof=dict(cand=max(thru) if thru else None, ie=ie_diag.get('last')),
        diag=dict(file=used, candidates=len(cands), races=len(races), matched=matched, no_summary=no_summary[:40],
                  unmatched=unmatched[:60], n_unmatched=len(unmatched), ie=ie_diag),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['probe'])
    ap.add_argument('--data', default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'site', 'data.json'))
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    d = json.load(open(a.data))
    m = build(d['districts'], d['senate'], log=lambda s: print(s, file=sys.stderr))
    json.dump(m, open(a.out, 'w'), indent=1)
    print(f"wrote {a.out}: {len(m['races'])} races; diag {json.dumps(m['diag'])[:800]}", file=sys.stderr)


if __name__ == '__main__':
    main()
