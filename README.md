# Ветропрогноз

React dashboard connected to a Python forecasting backend for two wind turbines.
The forecast, weather, and history screens use the repository's saved model outputs,
archived ECMWF IFS weather, and measured power. Power is normalized to `[0, 1]`;
it is not MW or MWh. All displayed timestamps are UTC.

## Available data

- 29 forecast origins from `2026-01-30T19:00Z` through `2026-02-27T19:00Z`
  (local midnights January 31 through February 28, UTC+05:00).
- Each origin contains 48 hourly predictions for each turbine. Target hours extend
  into early March at the end of the archive.
- Observations exposed to the dashboard cover January 2026. Source measurements
  stop on January 31 local time; February actuals and February evaluation metrics
  are unavailable. Missing observations remain missing.
- Recalculation runs the existing forecasting pipeline for a selected archived
  origin and both turbines. The API does not forecast for today's date.

## Run locally

Use Python 3.11 and Node.js 22.12 or newer (Node.js 24 is used by the container).
Run the backend in one terminal from the repository root:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m src.api --host 127.0.0.1 --port 8000
```

On Linux/macOS, use `python3.11 -m venv .venv` and `.venv/bin/python` in place
of the Windows commands. The exact versions in `backend/requirements.txt` are
needed to load the saved models.

In another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite forwards `/api` to
the backend on port 8000. Both processes must run. An API failure appears in
the dashboard with a retry action.

For the container setup, run `docker compose up --build -d --wait` from the
repository root and open [http://127.0.0.1:8088](http://127.0.0.1:8088).
See [deployment instructions](DEPLOYMENT.md) for configuration and verification.

## Project structure

| Directory | Contents |
| --- | --- |
| [`frontend/`](frontend/README.md) | React application, API adapter, UI tests, and nginx configuration |
| [`backend/`](backend/README.md) | HTTP API, forecast pipeline, tests, configuration, archived inputs, and models |
| `backend/.runtime/` | Local API recalculations, run logs, and any additional weather cache; ignored by Git |

The API reads committed results from `backend/outputs/`. API recalculations
persist separate runtime overrides without changing those reference results.
Reproducing or training the original pipeline through its command-line tools
is documented in [backend/README.md](backend/README.md).

## API

| Method and route | Behavior |
| --- | --- |
| `GET /api/health` | Returns `{ "status": "ok" }` |
| `GET /api/workspace` | Returns `{ runs, observations, meta }` for the dashboard |
| `POST /api/forecasts` | Accepts `{ "origin": "2026-01-30T19:00:00Z" }`, recalculates both turbines, and returns the updated workspace |

POST requests use `Content-Type: application/json`. Origins must match an
existing archived origin. Errors return `{ "error": { "code", "message" } }`
with an appropriate HTTP status. Browser requests use the frontend's same-origin
proxy; cross-origin writes are rejected.

## Verification

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -p no:cacheprovider
cd ../frontend
npm test
npm run build
```

After starting the container stack, run `npm run docker:check` from `frontend/`
to check the UI, API, forecast data, and static asset delivery.
