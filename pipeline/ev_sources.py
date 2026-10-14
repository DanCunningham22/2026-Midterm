"""Explore official early-vote sources and their archived daily reports (runs in GitHub Actions; the sandbox can't reach them).

    python3 pipeline/ev_sources.py explore OUTDIR

Writes small text files describing what each source offers: Wayback Machine snapshot lists for the Pennsylvania and
Florida daily reports in 2022 and 2024, a sample of each, and the link lists of the Nevada, Colorado, Iowa and
Georgia election-office pages. Standard library plus openpyxl (installed by the workflow).
"""
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

UA = {'User-Agent': 'midterm-map early-vote research (github.com/DanCunningham22/2026-Midterm)'}


def get(url, timeout=120, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else data.decode('utf-8', errors='replace')


def cdx(url, frm, to, limit=400):
    q = ('https://web.archive.org/cdx/search/cdx?url=' + urllib.parse.quote(url, safe='') +
         f'&output=json&fl=timestamp,statuscode,mimetype,length&from={frm}&to={to}&limit={limit}&filter=statuscode:200')
    try:
        rows = json.loads(get(q))
    except Exception as e:
        return [], str(e)
    return rows[1:], ''


def wayback(ts, url, binary=False):
    return get(f'https://web.archive.org/web/{ts}id_/{url}', binary=binary)


def links(html, base):
    out = []
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.I | re.S):
        href, text = m.group(1), re.sub(r'<[^>]+>', '', m.group(2)).strip()
        out.append((urllib.parse.urljoin(base, href), re.sub(r'\s+', ' ', text)[:80]))
    return out


def xlsx_preview(data, rows=25):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        out.append(f'--- sheet {ws.title} (max_row {ws.max_row}, max_col {ws.max_column})')
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i >= rows:
                break
            out.append(' | '.join('' if v is None else str(v) for v in row))
    return '\n'.join(out)


def text_preview(html, n=6000):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.S | re.I)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = re.sub(r'\s+', ' ', t)
    return t[:n]


def explore(outdir):
    os.makedirs(outdir, exist_ok=True)
    log = []

    def save(name, text):
        with open(os.path.join(outdir, name), 'w', encoding='utf-8') as f:
            f.write(text)
        log.append(f'wrote {name} ({len(text)} chars)')

    # Pennsylvania: the daily mail ballot report (xlsx), archived by the Wayback Machine
    for yr in ('2022', '2024', '2026'):
        url = f'https://www.pavoterservices.pa.gov/{yr}%20General%20Daily%20Mail%20Ballot%20Report.xlsx'
        rows, err = cdx(url, f'{yr}0901', f'{yr}1110')
        save(f'pa_{yr}_cdx.txt', (err or '') + '\n' + '\n'.join(' '.join(r) for r in rows))
        pick = rows[len(rows) // 2] if rows else None
        if pick:
            try:
                data = wayback(pick[0], url, binary=True)
                save(f'pa_{yr}_sample_{pick[0]}.txt', xlsx_preview(data))
            except Exception as e:
                save(f'pa_{yr}_sample_error.txt', str(e))
        if yr == '2026':
            try:
                data = get(url, binary=True)
                save('pa_2026_live.txt', xlsx_preview(data))
            except Exception as e:
                save('pa_2026_live_error.txt', str(e))

    # Florida: the Division of Elections' vote-by-mail and early-voting report page (statewide totals by party)
    fl = 'https://dos.fl.gov/elections/data-statistics/elections-data/vote-by-mail-and-early-voting-reports/'
    for yr in ('2022', '2024'):
        rows, err = cdx(fl, f'{yr}1001', f'{yr}1110')
        save(f'fl_{yr}_cdx.txt', (err or '') + '\n' + '\n'.join(' '.join(r) for r in rows))
        if rows:
            pick = rows[len(rows) // 2]
            try:
                html = wayback(pick[0], fl)
                save(f'fl_{yr}_sample_{pick[0]}.txt', text_preview(html, 12000) + '\n\nLINKS\n' + '\n'.join(f'{u} :: {t}' for u, t in links(html, fl)[:150]))
            except Exception as e:
                save(f'fl_{yr}_sample_error.txt', str(e))
    try:
        html = get(fl)
        save('fl_2026_live.txt', text_preview(html, 12000) + '\n\nLINKS\n' + '\n'.join(f'{u} :: {t}' for u, t in links(html, fl)[:150]))
    except Exception as e:
        save('fl_2026_live_error.txt', str(e))

    # Nevada, Colorado, Iowa, Georgia, Arizona: what the election offices link to
    pages = {
        'nv_stats': 'https://www.nvsos.gov/sos/elections/election-information/election-statistics',
        'nv_elections': 'https://www.nvsos.gov/sos/elections',
        'co_returns': 'https://www.sos.state.co.us/pubs/elections/VoteByMail/ballotReturns.html',
        'co_elections': 'https://www.sos.state.co.us/pubs/elections/',
        'ia_absentee': 'https://sos.iowa.gov/elections/electioninfo/absenteestats.html',
        'ia_elections': 'https://sos.iowa.gov/elections/',
        'ga_absentee': 'https://sos.ga.gov/page/voter-absentee-files',
        'ga_elections': 'https://sos.ga.gov/elections-division-georgia-secretary-states-office',
        'az_sos': 'https://azsos.gov/elections',
    }
    for k, u in pages.items():
        try:
            html = get(u)
            ls = [f'{a} :: {t}' for a, t in links(html, u) if re.search(r'turnout|absentee|early|mail|ballot|return|statistic', a + ' ' + t, re.I)]
            save(f'{k}.txt', u + '\n' + text_preview(html, 3000) + '\n\nLINKS\n' + '\n'.join(ls[:200]))
        except Exception as e:
            save(f'{k}_error.txt', u + '\n' + str(e))
    save('_log.txt', '\n'.join(log))


if __name__ == '__main__':
    if sys.argv[1:2] == ['explore']:
        explore(sys.argv[2] if len(sys.argv) > 2 else 'ev_explore')
    else:
        print(__doc__)
