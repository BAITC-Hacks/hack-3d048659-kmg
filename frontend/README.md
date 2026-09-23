# Ветропрогноз — frontend

Standalone React, TypeScript, and Vite application with Recharts and Lucide. All current weather, forecast, and measurement values are demonstration data. There is no backend connection yet.

## Development

Use Node.js 22.12+ (24 recommended) and npm. From this folder:

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Routes are `/forecast`, `/weather`, and `/history`. The turbine, selected release, and horizon are retained in the URL. Demonstration updates and measurements are stored in the current browser tab's session storage.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with live reload |
| `npm test` | Demo-data and state consistency checks |
| `npm run build` | TypeScript check and production output in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run docker:check` | Verify a running container's HTTP service |

Run all npm commands from `frontend/`. Application dependencies and the lockfile belong to this standalone package.

For Docker, run `docker compose up --build -d --wait` from the repository root. The root `docker-compose.yml` builds this folder using `frontend/Dockerfile`. See [DEPLOYMENT.md](../DEPLOYMENT.md) for local and server commands.

## Source structure

```text
src/
  main.tsx                    Browser entry point
  app/
    App.tsx                   Application shell and page composition
    useForecastWorkspace.ts  Shared state, actions, and update workflow
    navigation.ts             Route and URL selection handling
  pages/                      Forecast, weather, and history screens
  components/                 Shared controls, dialogs, and comparisons
    charts/                   Power and weather charts, shared tooltip
    forecast/                 Agent stages, hourly table, release comparison
  domain/forecast.ts          Shared forecast and measurement types
  data/
    demo.ts                   Deterministic synthetic providers
    session.ts                Browser-session persistence
  lib/format.ts               Shared display formatters
  styles/global.css           Theme, layout, and responsive styles
tests/                        Frontend tests
scripts/check-container.mjs   HTTP checks for the running container
public/                       Static images and favicon
docker/nginx.conf             Production web-server configuration
Dockerfile                    Application build and static runtime
```

## Module boundaries

- **Domain** describes the data and contains no React, browser, storage, or network dependencies.
- **Data** supplies domain values and handles persistence. Synthetic generation stays separate from session storage. A future API adapter belongs here, including response validation and mapping to domain types.
- **App** coordinates selections, navigation, loading, and updates. Pages receive the state and actions they need from this layer.
- **Pages and components** render data and report user actions. They should not fetch weather, generate forecasts, or read session storage directly. Reusable elements belong in `components/`; screen-specific layout belongs in its page.
- **Lib** holds small shared helpers such as formatting. Keep domain and data modules independent of UI components.

Dependencies flow from the application and UI toward shared domain types and data providers. Replacing the demo provider should not require moving network logic into the chart or table components. Keep pure data checks in `tests/` and verify changed interactions in the browser.

## Preserved data rules

Use UTC explicitly. Normalized power is not MW or MWh. Compare releases and measurements by turbine and target timestamp. A new run must preserve previous results; failed updates must leave the previous successful forecast accessible. Measurements cannot come from future hours or be generated from forecast values. Missing values stay missing.

Future API integration should replace the demo provider through the `data/` layer once an external service contract is agreed. This repository currently runs as a standalone frontend.
