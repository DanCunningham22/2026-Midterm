"""Economic series for the backtest and the app's other-signals panel.

FRED's public CSV endpoint (no key) for the US series, and the datasets/s-and-p-500 repository on GitHub for monthly
S&P 500 levels back to 1871 (Robert Shiller's data, kept current by its maintainers). build.py calls refresh() about
twice a day; the files land in pipeline/backtest/data/econ/ and are committed with the data, so the backtest always
has the full history. A failed or implausible download keeps the previous file. Standard library only.

    python3 pipeline/econ.py      # fetch everything now (needs open internet, e.g. GitHub Actions)
"""
import csv
import io
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'backtest', 'data', 'econ')
FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={}'
SERIES = {
    'UMCSENT': 'University of Michigan consumer sentiment, index (1966:Q1 = 100)',
    'UNRATE': 'Unemployment rate, %',
    'CPIAUCSL': 'Consumer price index, all items',
    'CUSR0000SEFV': 'Consumer price index, food away from home (restaurant prices)',
    'CUSR0000SETB01': 'Consumer price index, gasoline (all types)',
    'GASREGW': 'Regular gasoline, US average retail price, $ per gallon (weekly)',
    'A229RX0': 'Real disposable personal income per capita, chained 2017 dollars',
    'GDPC1': 'Real gross domestic product, quarterly',
    'PAYEMS': 'Nonfarm payroll employment, thousands',
    'MICH': 'University of Michigan expected inflation, next 12 months, %',
}
SP500 = 'https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv'
MIN_ROWS = {'GASREGW': 1000, 'GDPC1': 250, 'MICH': 500}


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': 'midterm-map econ fetch'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='replace')


def parse(text):
    """FRED CSV -> [(YYYY-MM-DD, float)], skipping missing values ('.')."""
    rows = list(csv.reader(io.StringIO(text)))
    if not rows or len(rows[0]) < 2:
        raise ValueError('empty or malformed CSV')
    out = []
    for r in rows[1:]:
        if len(r) < 2 or r[1] in ('', '.'):
            continue
        try:
            out.append((r[0][:10], float(r[1])))
        except ValueError:
            continue
    return out


def load(series_id):
    """Read a saved series: [(date, value)] in date order."""
    path = os.path.join(OUT, series_id + '.csv')
    with open(path, encoding='utf-8') as f:
        return [(r['date'], float(r['value'])) for r in csv.DictReader(f)]


def save(series_id, rows):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, series_id + '.csv')
    tmp = path + '.tmp'
    with open(tmp, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['date', 'value'])
        w.writerows(rows)
    os.replace(tmp, path)


def refresh(log=print):
    """Fetch every series; return {id: (ok, detail)}."""
    status = {}
    for sid in SERIES:
        try:
            rows = parse(fetch(FRED.format(sid)))
            old = None
            try:
                old = load(sid)
            except (OSError, KeyError, ValueError):
                pass
            if len(rows) < MIN_ROWS.get(sid, 600):
                raise ValueError(f'only {len(rows)} rows')
            if old and len(rows) < 0.98 * len(old):
                raise ValueError(f'{len(rows)} rows, fewer than the {len(old)} already saved')
            save(sid, rows)
            status[sid] = (True, f'{len(rows)} rows through {rows[-1][0]}')
        except Exception as e:  # keep the previous file
            status[sid] = (False, str(e)[:200])
            log(f'econ {sid}: {e}')
    try:
        text = fetch(SP500)
        rows = []
        for r in csv.DictReader(io.StringIO(text)):
            try:
                rows.append((r['Date'][:10], float(r['SP500'])))
            except (KeyError, ValueError):
                continue
        if len(rows) < 1500:
            raise ValueError(f'only {len(rows)} rows')
        save('SP500_MONTHLY', rows)
        status['SP500_MONTHLY'] = (True, f'{len(rows)} rows through {rows[-1][0]}')
    except Exception as e:
        status['SP500_MONTHLY'] = (False, str(e)[:200])
        log(f'econ SP500_MONTHLY: {e}')
    return status


if __name__ == '__main__':
    st = refresh(log=lambda x: print(x, file=sys.stderr))
    for k, (ok, d) in st.items():
        print(f"{k:16s} {'ok ' if ok else 'ERR'} {d}")
