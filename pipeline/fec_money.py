"""Campaign money in every House and Senate race, from the Federal Election Commission's bulk files.

Candidates: what each nominee's campaign has raised, spent and has in the bank this cycle, from the FEC's
"House/Senate current campaigns" summary file (webl26.zip: pipe-delimited, no header, one row per candidate,
totals summed over the candidate's authorized committees through the latest report).

Outside spending: independent expenditures (ads, mail, canvassing paid for by super PACs, party committees and
other groups) for or against each nominee, from the FEC's file of 24- and 48-hour reports
(independent_expenditure_2026.csv). That file keeps an original report's rows after it is amended, so an
amended report replaces every earlier version of it, and repeated transactions count once. General-election
spending only (primaries excluded).

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
        return float(str(s).replace(',', '').strip() or 0)
    except ValueError:
        return 0.0


def parse_date(s):
    s = (s or '').strip()
    for fmt in ('%m/%d/%Y', '%Y-%m-%d', '%d-%b-%y', '%d-%b-%Y', '%m%d%Y', '%Y%m%d', '%m/%d/%y'):
        try:
            return dt.datetime.strptime(s[:11].strip(), fmt).date()
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


def name_score(ours, fec_name):
    """2 if the FEC surname ends (or appears in) our name, +1 if the first name agrees too; 0 if no match."""
    ot = tokens(ours)
    last, first = fec_parts(fec_name)
    n = len(last)
    if not ot or not n:
        return 0
    if ot[-n:] == last:
        s = 2
    elif any(ot[i:i + n] == last for i in range(len(ot) - n + 1)):
        s = 2
    elif n > 1 and ot[-1] == last[-1]:        # e.g. FEC 'GARCIA ZAMORA' vs our 'Garcia'
        s = 1
    else:
        return 0
    if first and ot and len(ot) > n and (first[0] == ot[0] or first[0][:3] == ot[0][:3] or ot[0] in first):
        s += 1
    return s


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


def general(ele_type, date):
    e = (ele_type or '').strip().upper()
    if e[:1] in ('G', 'S', 'R'):        # general, special (the OH and FL Senate seats), runoff
        return True
    if e[:1] in ('P', 'C', 'O'):        # primary, convention, other
        return False
    return bool(date and date >= dt.date(CYCLE, 8, 15))


def read_ie(path, wanted):
    """Outside spending for or against the candidates in `wanted`, after amendments and repeats are removed."""
    diag = dict(rows=0, rows_wanted=0, header_found=False, ele=dict(), superseded=0, repeats=0, primary=0)
    parent, rows = {}, []
    with open(path, encoding='latin-1', newline='') as f:
        rd = csv.reader(f)
        first = next(rd)
        ix, has_head = ie_columns(first)
        diag['header_found'] = has_head
        diag['header'] = [x.strip() for x in first][:30] if has_head else []
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
            cid = get(row, 'cand_id').upper()
            if cid not in wanted:
                continue
            diag['rows_wanted'] += 1
            d = parse_date(get(row, 'date')) or parse_date(get(row, 'dissem'))
            e = get(row, 'ele_type')
            diag['ele'][e[:1] or '?'] = diag['ele'].get(e[:1] or '?', 0) + 1
            if not general(e, d):
                diag['primary'] += 1
                continue
            so = get(row, 'sup_opp').upper()[:1]
            if so not in ('S', 'O'):
                continue
            rows.append(dict(cid=cid, so=so, amt=num(get(row, 'amount')), date=d, fn=fn,
                             spe=get(row, 'spe_id').upper(), name=get(row, 'spe_nam'), tran=get(row, 'tran_id')))

    def root(fn):
        seen = set()
        while fn in parent and fn not in seen:
            seen.add(fn)
            fn = parent[fn]
        return fn

    def fnum(x):
        try:
            return int(re.sub(r'\D', '', x) or 0)
        except ValueError:
            return 0
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
    dates = [r['date'] for r in kept if r['date']]
    diag['first'] = min(dates).isoformat() if dates else None
    valid = [d for d in dates if d <= dt.date.today() + dt.timedelta(days=1)]
    diag['last'] = max(valid).isoformat() if valid else None
    return kept, diag


# ---------------------------------------------------------------- races
def match(race, slot, cands, by_st):
    """The FEC record for a race's Democratic ('d') or Republican ('r') slot nominee."""
    name = race.get('dn' if slot == 'd' else 'rn') or ''
    if not tokens(name):
        return None
    party = race.get('dp' if slot == 'd' else 'rp') or ('D' if slot == 'd' else 'R')
    office = 'S' if race['id'].endswith('-SEN') else 'H'
    pool = by_st.get((office, race['st']), [])
    if office == 'H':
        dist = int(race['id'].split('-')[1])
        at_large = race.get('_at_large')
        pool_d = [c for c in pool if c['dist'] == dist or (at_large and c['dist'] in (0, 1))]
    else:
        pool_d = pool

    def score(c):
        s = name_score(name, c['name'])
        if not s:
            return 0
        if party == 'D' and c['party'] in ('DEM', 'DFL'):
            s += 1
        elif party == 'R' and c['party'] == 'REP':
            s += 1
        elif party == 'I' and c['party'] not in ('DEM', 'DFL', 'REP'):
            s += 1
        return s
    best = sorted(((score(c), c['raised'], c) for c in pool_d), key=lambda x: (x[0], x[1]), reverse=True)
    if best and best[0][0] >= 2:
        return best[0][2]
    if office == 'H':   # district renumbered since the candidate filed: same state, first and last name both match
        alt = [(score(c), c['raised'], c) for c in pool]
        alt = sorted([x for x in alt if x[0] >= 3 and name_score(name, x[2]['name']) >= 3], key=lambda x: (x[0], x[1]), reverse=True)
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

        by_st = {}
        for c in cands:
            by_st.setdefault((c['office'], c['st']), []).append(c)
        n_dist = {}
        for r in districts:
            n_dist[r['st']] = n_dist.get(r['st'], 0) + 1
        races, unmatched = {}, []
        for r in list(districts) + list(senate):
            r = dict(r, _at_large=n_dist.get(r['st']) == 1)
            if r.get('unc'):
                continue
            entry = {}
            for slot in ('d', 'r'):
                c = match(r, slot, cands, by_st)
                if c:
                    entry[slot] = dict(id=c['id'], raised=round(c['raised']), spent=round(c['spent']), cash=round(c['cash']),
                                       thru=c['thru'].isoformat() if c['thru'] else None)
                elif tokens(r.get('dn' if slot == 'd' else 'rn')):
                    unmatched.append(f"{r['id']} {slot.upper()} {r.get('dn' if slot == 'd' else 'rn')}")
            races[r['id']] = entry

        wanted = {}
        for rid, e in races.items():
            for slot in ('d', 'r'):
                if slot in e:
                    wanted[e[slot]['id']] = (rid, slot)
        ie_diag = dict(error=None)
        try:
            p = os.path.join(tmp, IE_FILE)
            size = download(BASE + IE_FILE, p)
            kept, ie_diag = read_ie(p, wanted)
            ie_diag['bytes'] = size
            log(f"  FEC {IE_FILE}: {size:,} bytes, {ie_diag['rows']:,} rows, {ie_diag['kept']:,} general-election rows for these nominees")
        except Exception as e:
            kept, ie_diag = [], dict(error=str(e)[:300])
            log(f'  FEC {IE_FILE}: {e}')

    # outside spending by race: [for D, against D, for R, against R], and by spender
    spenders = {}
    for x in kept:
        rid, slot = wanted[x['cid']]
        e = races[rid]
        o = e.setdefault('o', [0, 0, 0, 0])
        o[(0 if x['so'] == 'S' else 1) + (0 if slot == 'd' else 2)] += x['amt']
        helps = 'D' if (slot == 'd') == (x['so'] == 'S') else 'R'
        sp = spenders.setdefault((rid, x['spe']), dict(names={}, D=0.0, R=0.0))
        sp[helps] += x['amt']
        sp['names'][x['name']] = sp['names'].get(x['name'], 0) + 1
    for rid, e in races.items():
        if 'o' in e:
            e['o'] = [round(v) for v in e['o']]
    for (rid, _), sp in spenders.items():
        side = 'D' if sp['D'] >= sp['R'] else 'R'
        amt = max(sp['D'], sp['R'])
        name = max(sp['names'].items(), key=lambda kv: kv[1])[0]
        races[rid].setdefault('_top', []).append([name, round(amt), side])
    for e in races.values():
        top = sorted(e.pop('_top', []), key=lambda x: -x[1])
        if top:
            e['top'] = top[:6]
            e['nsp'] = len(top)

    thru = [e[s]['thru'] for e in races.values() for s in ('d', 'r') if s in e and e[s]['thru']]
    matched = sum(1 for e in races.values() if 'd' in e or 'r' in e)
    if matched < 0.6 * len(races):
        raise ValueError(f'only {matched} of {len(races)} races matched FEC candidates')
    return dict(
        races={k: v for k, v in races.items() if v},
        asof=dict(cand=max(thru) if thru else None, ie=ie_diag.get('last')),
        diag=dict(file=used, candidates=len(cands), races=len(races), matched=matched,
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
