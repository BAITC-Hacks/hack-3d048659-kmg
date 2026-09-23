# Data inspection

The repository at baseline commit `29a91e6` contains only `README.md`.
No turbine history, weather archives, or February 2026 backtest observations
were present during inspection. `origin/main` was fetched before inspection.

| Requested property | turbine_1 | turbine_2 |
| --- | --- | --- |
| Columns and dtypes | Unavailable: no data | Unavailable: no data |
| Time step | Unknown | Unknown |
| Source timezone guess | Cannot infer | Cannot infer |
| Observed date range | Unknown | Unknown |
| Missing-value counts | Cannot compute | Cannot compute |
| Minimum / maximum power | Cannot compute | Cannot compute |

Turbine identifiers are placeholders, not identifiers discovered in data.
March 2023 through January 31, 2026 is the requested history range; it has
not been verified. February 2026 is the requested evaluation period.
Asia/Almaty (+05:00) is the configured timezone, not an inference about data.
Coordinates, power units, and rated turbine capacities remain unknown.

Place supplied source files in `data/raw/` before actual profiling.
`forecasts_mock.csv` is synthetic output-contract data and is not evidence
about source data, forecasting accuracy, or actual weather availability.
