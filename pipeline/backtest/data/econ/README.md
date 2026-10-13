Economic series used by the backtest and the app's other-signals panel, refreshed about twice a day by
`pipeline/econ.py` (called from `pipeline/build.py` in GitHub Actions). One file per series: `date,value`.

- FRED (Federal Reserve Bank of St. Louis), https://fred.stlouisfed.org/series/<ID>: UMCSENT, UNRATE, CPIAUCSL,
  CUSR0000SEFV, CUSR0000SETB01, GASREGW, A229RX0, GDPC1, PAYEMS, MICH. Original sources: University of Michigan
  Surveys of Consumers, Bureau of Labor Statistics, Bureau of Economic Analysis, Energy Information Administration.
- SP500_MONTHLY: monthly S&P 500 levels from https://github.com/datasets/s-and-p-500 (Robert Shiller's data).
