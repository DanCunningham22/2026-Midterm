# 2026 Midterm Scenario Map

An installable web app for gaming out the 2026 midterms: set the national House vote, each group's margin
and turnout, and the House (all 435 districts on the 2026 lines), Senate and governor maps redraw. It opens
on our forecast (below), with the polls-only version a tap away, tracks what the early vote says, and has a Watch tab with
dates ahead, recent developments, where the money is going in each House and Senate race, and a log of
Trump's and Vance's campaign stops. Sliders run Democratic on
the left, Republican on the right.

**App:** this repository's GitHub Pages site. On a phone, open it in Safari (iPhone) or Chrome (Android) and
choose **Add to Home Screen**.

## How it stays current

A GitHub Actions job (`.github/workflows/update.yml`) runs every three hours. It runs
`pipeline/build.py`, which pulls:

| What | Source | Refresh |
|---|---|---|
| Candidates, incumbency, race polls, generic-ballot polls | [ElectIndex forecast data](https://github.com/ElectIndex/26_us_forecast_data) | automatic |
| Race polls the feed doesn't have yet (from the pollsters' own releases) | `pipeline/content/extra_polls.csv` | daily scheduled refresh; a row drops out once the feed has the poll |
| Early-vote ballot counts and party splits | [UF Election Lab](https://election.lab.ufl.edu/early-vote/2026-early-voting/) | automatic |
| National polling average (generic ballot) | computed from the poll list | automatic |
| Our forecast: national vote and Senate/governor adjustments | `pipeline/backtest/backtest.py`, inputs in `pipeline/content/fundamentals.json` | automatic; approval and special-election inputs checked daily |
| Economic series for the backtest and the other-signals panel | [FRED](https://fred.stlouisfed.org/) and [datasets/s-and-p-500](https://github.com/datasets/s-and-p-500) via `pipeline/econ.py` | automatic, about twice a day |
| Other signals' current readings (sentiment, gas, markets, raters, retirements) | `pipeline/content/signals.json` | daily scheduled refresh |
| Senate: competitive races | Oct 9 corrected averages + change in a simple poll average since | automatic drift; base by hand |
| Early-vote signals, story and same-point comparisons | `pipeline/content/story.json` | daily scheduled refresh |
| 2026 national crosstab polls (and the pollster picker) | `pipeline/static/polls_2026.csv` | as pollsters release them |
| Watch tab: dates ahead, developments, Trump and Vance stops | `pipeline/content/watch.json` | daily scheduled refresh |
| Campaign money: nominees' fundraising and cash, outside spending for and against them | [FEC bulk data](https://www.fec.gov/data/browse-data/?tab=bulk-data) via `pipeline/fec_money.py` | automatic, every ~6 hours |

If a feed fails or returns something implausible, the build keeps the previous numbers for that section and
the app shows which source didn't refresh. The app loads the newest `site/data.json` every time it opens
and keeps the last copy for offline use.

To refresh on demand: **Actions → Update data and publish → Run workflow**.

## Our forecast, and its backtest

The polls have missed before, so the app's headline doesn't just read them. `pipeline/backtest/backtest.py`
blends four signals for the national House vote, each weighted by how well it predicted past midterms
(midterms count twice as much as presidential years; an election 12 years back counts half):

- **Generic-ballot polls, corrected for their record.** In the final three weeks they ran too Democratic in
  11 of the 14 elections from 1998 to 2024 (FiveThirtyEight's pollster-ratings archive, plus 2024 compiled
  from RealClearPolling and pollster releases).
- **Special elections**, less the amount they overstated the final swing in 2006, 2018 and 2022.
- **Presidential approval** and the midterm penalty (midterms since 1950, Gallup).
- **The Virginia and New Jersey governor races** the year before.

Senate and governor polls are blended with each state's lean plus that national vote (80/20 for the Senate,
90/10 for governors), the mix that best predicted 2000–2024 races out of sample. Incumbents running against
their state's lean, races with an independent and three-way races keep their polls. Every piece is scored on
elections it wasn't fitted to; the app's backtest section shows the results, what didn't hold up (pollster and
state track records), and how much the choices matter.

Other signals are tested the same way and shown, not used: consumer sentiment, unemployment, inflation,
restaurant and gasoline prices, real income, GDP, jobs, the S&P 500 (FRED and Shiller series fetched by
`pipeline/econ.py` into `pipeline/backtest/data/econ/`) and House retirements by party. Added to approval and
exposure, none improves the midterm prediction out of sample. Current readings (sentiment, gas, a Chipotle
bowl, prediction markets, Cook's ratings, retirements) live in `pipeline/content/signals.json`.

```
python3 pipeline/backtest/make_tables.py   # rebuilds the poll-vs-result tables from the 538 archive (needs internet)
python3 pipeline/backtest/backtest.py      # prints the backtest and today's call
```

## Model in brief

- **House:** each district's 2024 presidential margin on its 2026 lines, moved by the national House vote
  (vs. 2024's R+1.5), adjusted for the district's estimated electorate (group swings and turnout apply in
  proportion to each group's share), plus incumbency and candidate track records.
- **Groups:** race × education, age and gender as three independent splits. Baselines from Pew Research
  Center validated voters (2024, 2022, 2018). Default 2026 pattern halfway between 2024 and 2026 poll crosstabs.
- **Uncertainty:** 4,000 simulations with a shared national error (t, 5 df; SD from the backtest for our
  forecast, 3.9 for the polls alone), state errors, race errors and correlated demographic errors.

## Run locally

```
python3 pipeline/build.py --out site/data.json   # needs internet
python3 -m http.server -d site 8000              # then open http://localhost:8000
```

## Sealed forecasts

Besides this scenario model, a separate judgment-based forecast is kept privately and updated as the data
moves. Each version is sealed: the SHA-256 fingerprint of its full text is added to
`pipeline/content/sealed.json` and shown in the app's How it works section. After Election Day the texts can
be published; anyone can check one with `sha256sum` (the text ends with a single line break) and compare it with
the fingerprint and the commit date here.

## Credits and data terms

District results and demographics on the 2026 lines are derived from ElectIndex's public data, which does
not state a license; ask them before any commercial or wider use. Group baselines: Pew Research Center.
Early vote: University of Florida Election Lab. Scenario tool, not a forecast of record.
