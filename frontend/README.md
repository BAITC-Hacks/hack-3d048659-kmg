# Ветропрогноз — frontend

React, TypeScript, Vite, Recharts, and Lucide dashboard connected to the Python
API in [`../backend/`](../backend/README.md). Forecasts, weather, and observations
come from the backend's archived data. The application has no synthetic data
fallback and reports connection failures in the interface.

## Development

Use Node.js 22.12+ (24 recommended). Start the backend in a separate terminal
using the [root setup instructions](../README.md), then run from `frontend/`:

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Routes are `/forecast`,
`/weather`, `/map`, and `/history`. Turbine, release, and horizon selections are retained
in the URL. Vite proxies `/api` to `http://127.0.0.1:8000` while preserving the
browser's Host header for same-origin validation.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with live reload and API proxy |
| `npm test` | API mapping and navigation checks |
| `npm run build` | TypeScript check and production output in `dist/` |
| `npm run preview` | Preview the production build, with the local API proxy |
| `npm run docker:check` | Verify the running nginx and backend stack on port 8088 |

Run npm commands from this directory. Application dependencies and the lockfile
belong to this package. Production deployment requires the API proxy configured
in `docker/nginx.conf`; serving the static files alone cannot supply data.
See [DEPLOYMENT.md](../DEPLOYMENT.md).

## API and data rules

`GET /api/workspace` loads `{ runs, observations, meta }`. Forecast runs include
their origin, weather issue and availability times, model version, fallback
information, and hourly power/weather points. Observation batches contain actual
hourly power by turbine. `POST /api/forecasts` accepts a selected archived origin,
recalculates both turbines, and returns the updated workspace. Runtime results
persist on the backend and are available after a page reload.

- Forecast origins span January 30 at 19:00 UTC through February 27 at 19:00 UTC,
  2026. Each run has 48 hourly predictions; the UI can display 24 or 48 hours.
- Observations cover January. The source data ends January 31 local time
  (UTC+05:00). Missing actuals remain empty, and unavailable metrics are not zero.
- Weather is the archived forecast used by each run, not current conditions.
- Power is normalized to `[0, 1]`. All timestamps are displayed in UTC.
- Releases and actuals match by turbine and target timestamp. A failed request
  keeps the last successful workspace accessible.

## Source boundaries

- `src/data/` owns API requests, response validation, and mapping.
- `src/domain/forecast.ts` defines shared data types.
- `src/app/` coordinates loading, selections, navigation, and recalculation.
- `src/pages/` and `src/components/` render the workspace and report user actions.
- `src/lib/` holds formatting and shared helpers.
- `tests/` checks the API adapter and navigation behavior.
- `scripts/check-container.mjs` checks the deployed UI, API, and static files.

Pages and charts receive their data through application state. They do not fetch
weather or derive observations from predicted values.

## 3D turbine map

`/map` lazy-loads MapLibre GL JS and Three.js. Two procedural wind turbine models
use the positions in `backend/config.yaml` (mirrored in `src/domain/map.ts`).
Their dimensions and orientation are illustrative; the map does not imply a
surveyed turbine shape, terrain elevation, or live rotor telemetry.

- Click a model or its compact power card to select the turbine. Drag to pan,
  use the map controls to zoom, and right-drag or Ctrl-drag to rotate/tilt.
  “Весь парк” restores the starting view.
- Forecast mode uses the selected archived release and 24/48-hour horizon.
  Both turbine cards match the same release and exact target hour.
- “Измерения · архив” uses all available observation hours, independently of
  the selected forecast release. Missing power remains “—”; weather is not
  inferred from predictions in this mode. All displayed times are UTC.
- The basemap uses OpenStreetMap raster tiles with visible attribution and
  requires internet access. Tile failures preserve models and data; unavailable
  WebGL shows a retry message while the readings and time controls remain usable.
  For a large production deployment, configure an appropriate tile provider in
  `src/components/map/TurbineMap.tsx` under that provider's usage terms.
- The map and its GPU resources are disposed when leaving the page. Static
  models redraw on interaction rather than continuously animating.
