# Ветропрогноз — frontend

React, TypeScript, Vite, Recharts, and Lucide dashboard connected to the Python
API in [`../backend/`](../backend/README.md). Windmills, forecasts and measurements
come from MongoDB, including the initial bundled archive. The application has no synthetic data
fallback and reports connection failures in the interface.

## Development

Use Node.js 22.12+ (24 recommended). Start the backend in a separate terminal
using the [root setup instructions](../README.md), then run from `frontend/`:

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Routes are `/forecast`,
`/weather`, `/map`, `/turbines`, and `/history`. Turbine, release, and horizon selections are retained
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

`GET /api/workspace` loads `{ turbines, runs, observations, meta }`. Forecast runs include
their origin, weather issue and availability times, model version, fallback
information, and hourly power/weather points. Observation batches contain actual
hourly power by turbine. `/turbines` provides windmill creation, CSV preview and
upload, single-hour corrections, retraining and durable calculation status.
Changes to measurements automatically queue Celery training. Jobs are polled
every three seconds on the management page; workspace data refreshes while a
windmill has queued/running work. The API stores results in MongoDB.

- Initial forecast origins span January 30–February 27, 2026; new models generate
  releases relative to the latest measured hour. Each run has 48 predictions.
- The initial observations cover January; users can add later data. Missing
  actuals remain empty, and unavailable metrics are not zero.
- Weather is only present for original archived weather-based forecasts.
  Newly trained autoregressive models return null weather values.
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

`/map` lazy-loads MapLibre GL JS and Three.js. Procedural wind turbine models
use the dynamic windmill registry's coordinates and names from the API.
Their dimensions and orientation are illustrative; the map does not imply a
surveyed turbine shape, terrain elevation, or live rotor telemetry.

- Click a model or its compact power card to select the turbine. Drag to pan,
  use the map controls to zoom, and right-drag or Ctrl-drag to rotate/tilt.
  “Весь парк” fits all windmills; “К ветряку” focuses the selected one.
- Forecast mode uses the selected archived release and 24/48-hour horizon.
  Cards match the same release origin and exact target hour. Windmills without
  a matching release show missing values rather than borrowing another run.
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
