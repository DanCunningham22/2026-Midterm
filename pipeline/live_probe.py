"""Temporary probe (run in GitHub Actions): checks which official election-night result files answer, and prints
their layout, so the live election-night job can parse them. Writes pipeline/scratch/live_probe/_log.txt."""
import io, os, sys, urllib.request, zipfile, collections

OUT = sys.argv[1] if len(sys.argv) > 1 else 'pipeline/scratch/live_probe/_log.txt'
log = []
def p(*a):
    log.append(' '.join(str(x) for x in a))

def get(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (midterm-map election-night probe)'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, dict(r.headers), r.read()

URLS = [
    'https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt',
    'https://flelectionfiles.floridados.gov/enightfilespublic/20260818_ElecResultsFL.txt',
    'https://flelectionfiles.floridados.gov/enightfilespublic/20221108_ElecResultsFL.txt',
    'https://er.ncsbe.gov/enr/20261103/data/results_1.txt',
    'https://er.ncsbe.gov/enr/20261103/data/results_92.txt',
    'https://er.ncsbe.gov/enr/20241105/data/results_92.txt',
    'https://er.ncsbe.gov/enr/20261103/data/county_list.txt',
    'https://er.ncsbe.gov/enr/20261103/data/timestamp.txt',
]
for u in URLS:
    p('=' * 100); p('URL', u)
    try:
        st, h, body = get(u)
    except Exception as e:
        p('  ERROR', repr(e)[:300]); continue
    p('  status', st, 'bytes', len(body), 'type', h.get('Content-Type'), 'last-modified', h.get('Last-Modified'), 'cache', h.get('Cache-Control'))
    if u.endswith('.zip'):
        try:
            z = zipfile.ZipFile(io.BytesIO(body))
        except Exception as e:
            p('  not a zip', repr(e)[:200]); p('  head', body[:300]); continue
        for n in z.namelist():
            raw = z.read(n)
            p('  member', n, len(raw))
            text = raw.decode('utf-8-sig', 'replace')
            lines = text.splitlines()
            for l in lines[:6]:
                p('    |', l[:400])
            if len(lines) > 5:
                hdr = lines[0].split('\t')
                cnt = collections.Counter()
                for l in lines[1:]:
                    f = l.split('\t')
                    if len(f) == len(hdr):
                        row = dict(zip(hdr, f))
                        cn = row.get('Contest Name') or row.get('contest_name') or ''
                        cnt[cn] += 1
                p('  contests (top 40 of', len(cnt), '):')
                for k, v in sorted(cnt.items(), key=lambda kv: -kv[1])[:40]:
                    p('     ', v, k)
                # sample rows for statewide federal contests
                for l in lines[1:]:
                    if 'PRESIDENT' in l.upper() and 'WAKE' in l.upper():
                        p('    PRES WAKE row |', l[:400]); break
                for l in lines[1:]:
                    if 'US SENATE' in l.upper() or 'US HOUSE' in l.upper():
                        p('    US row |', l[:400]); break
    else:
        text = body.decode('utf-8-sig', 'replace')
        lines = text.splitlines()
        p('  lines', len(lines))
        for l in lines[:8]:
            p('    |', l[:400])
        if lines and '\t' in lines[0]:
            hdr = lines[0].split('\t')
            races = collections.Counter()
            for l in lines[1:]:
                f = l.split('\t')
                if len(f) == len(hdr):
                    races[dict(zip(hdr, f)).get('RaceName', '?')] += 1
            p('  races (', len(races), '):', list(races.items())[:40])
            for l in lines[1:]:
                if 'President' in l and 'Alachua' in l:
                    p('    PRES Alachua |', l[:400])
            for l in lines[1:]:
                if 'Representative' in l:
                    p('    REP row |', l[:400]); break
        elif text.strip().startswith('[') or text.strip().startswith('{'):
            p('  json head', text[:1500])
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w').write('\n'.join(log) + '\n')
print('\n'.join(log)[:20000])
