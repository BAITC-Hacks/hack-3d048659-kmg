# hack-3d048659-kmg
Hackathon team repository for KMG

## Development skeleton

Use Python 3.11. Create a virtual environment with `python -m venv .venv`,
then install dependencies with `python -m pip install -r requirements.txt`.
Copy `.env.example` to `.env` locally if needed; never commit `.env`.

`src/weather`, `src/features`, `src/model`, and `src/agent` are empty Python
packages. `app` is reserved for the UI, `tests` for checks, `data/raw` for
source data, `data/weather_cache` for archived forecast caches, and
`outputs` for results. No forecasting model is implemented.

The initial inspection in `outputs/data_inspection.md` predates the supplied
`data/raw/turbine_1.csv` and `data/raw/turbine_2.csv`. These raw files are now
tracked; the initial report is a historical snapshot.

`config.yaml` contains the supplied coordinates and numeric turbine IDs 1
and 2, corresponding to the two raw filenames. Both turbines use the shared
`weather_point` at 43.644174, 78.537216. Fetch weather once per run/request
window at this point and reuse it for both turbines. Let Open-Meteo resolve
elevation from its DEM and record the returned elevation in cache metadata.

The planned model is shared across turbines, with `turbine_id` as a
categorical feature and metrics reported separately for each turbine.
Encode NWP wind direction in degrees as `sin(direction * pi / 180)` and
`cos(direction * pi / 180)` in `wind_direction_sin` and
`wind_direction_cos`. Preserve missing directions as missing values. These
features allow direction-dependent bias in complex terrain to be learned.
These are configuration/implementation requirements; weather fetching,
feature computation, training, and evaluation are not implemented yet.

## Forecast output contract

`outputs/forecasts_mock.csv` has 192 rows: two placeholder turbines, two
local origins (2026-01-31 and 2026-02-01 at 00:00 Asia/Almaty), and 48 hourly
targets per origin. All CSV timestamps are ISO 8601 UTC with a `Z` suffix.
`horizon_h` is an integer from 1 through 48; each target is exactly that
many hours after its origin. `predicted_power` contains synthetic normalized
power in [0, 1], not measured power or a validated forecast. Production
power units must be agreed after inspecting actual input data.
`model_version` is `mock-v0`; `fallback_used` is a lowercase Boolean string
and is `false` for these fixtures (no forecasting or fallback ran).

The synthetic `weather_run_utc` is the preceding 12:00 UTC cycle, seven hours
before the 19:00 UTC origin. This satisfies the configured six-hour
availability delay but does not prove the availability of a real archive.
Real backtesting must use archived forecasts whose release/availability is
no later than the origin, and power/features available at that origin only.
Do not substitute realized future weather or reanalysis.

`config.yaml` defines inclusive local backtest origins from 2026-01-31 through
2026-02-28. Local dates/times are scheduling inputs only; convert them to UTC
for internal processing. The mock targets extend outside February at the
first origin; final evaluation should select the requested February targets
once observations and evaluation rules are supplied.

Run the output-contract check with `python -m unittest discover -s tests -v`
or `python -m pytest` after installing dependencies.
