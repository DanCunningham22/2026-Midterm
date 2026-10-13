# 2026 Midterm Scenario Map

An installable web app for gaming out the 2026 midterms: set the national House vote, each group's margin
and turnout, and the House (all 435 districts on the 2026 lines), Senate and governor maps redraw. It also
tracks what the early vote says.

**App:** this repository's GitHub Pages site. On a phone, open it in Safari (iPhone) or Chrome (Android) and
choose **Add to Home Screen**.

## How it stays current

A GitHub Actions job (`.github/workflows/update.yml`) runs every three hours. It runs
`pipeline/build.py`, which pulls:

| What | Source | Refresh |
|---|---|---|
| Candidates, incumbency, race polls, generic-ballot polls | [ElectIndex forecast data](https://github.com/ElectIndex/26_us_forecast_data) | automatic |
| Early-vote ballot counts and party splits | [UF Election Lab](https://election.lab.ufl.edu/early-vote/2026-early-voting/) | automatic |
| National default (generic-ballot average) | computed from the poll list | automatic |
| Senate: competitive races | Oct 9 corrected averages + change in a simple poll average since | automatic drift; base by hand |
| Early-vote signals, story and same-point comparisons | `pipeline/content/story.json` | daily scheduled refresh |
| 2026 national crosstab polls (and the pollster picker) | `pipeline/static/polls_2026.csv` | as pollsters release them |

If a feed fails or returns something implausible, the build keeps the previous numbers for that section and
the app shows which source didn't refresh. The app loads the newest `site/data.json` every time it opens
and keeps the last copy for offline use.

To refresh on demand: **Actions → Update data and publish → Run workflow**.

## Model in brief

- **House:** each district's 2024 presidential margin on its 2026 lines, moved by the national House vote
  (vs. 2024's R+1.5), adjusted for the district's estimated electorate (group swings and turnout apply in
  proportion to each group's share), plus incumbency and candidate track records.
- **Groups:** race × education, age and gender as three independent splits. Baselines from Pew Research
  Center validated voters (2024, 2022, 2018). Default 2026 pattern halfway between 2024 and 2026 poll crosstabs.
- **Uncertainty:** 4,000 simulations with a shared national error (t, 5 df), state errors and race errors.

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
