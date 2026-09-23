# Deployment

The application consists of a Python 3.11 API and a React build served by nginx.
Nginx forwards `/api` to the backend over the private Compose network. Only the
frontend port is published. Both containers run as nonroot users.

## Local containers

Install Docker with Compose support. From the repository root:

```bash
docker compose up --build -d --wait
docker compose ps
```

Open [http://127.0.0.1:8088](http://127.0.0.1:8088). The first build requires
network access to install the exact Python dependencies and the npm lockfile.
The images include saved models, source measurements, forecasts, and weather
caches. Recalculation supports the 29 archived origins shipped in the repository.
It does not fetch a forecast for today's date.

The frontend has `/healthz` for static-serving health. The backend health route
is `/api/health`; `/api/workspace` verifies that archived application data can be
loaded. Compose starts nginx after the backend passes its health check.

Check the integrated stack from `frontend/` after `npm ci`:

```bash
npm run docker:check
```

The check verifies both health routes, forecast data for both turbines, client
routes, JavaScript/CSS/image delivery, cache headers, and API errors. It does not
create a new forecast. To verify recalculation, open the forecast page and
recalculate a selected archived release; the returned data should remain
available after a page reload.

For another published port, set `PORT` before starting Compose. In PowerShell:

```powershell
$env:PORT = "8090"
docker compose up --build -d --wait
cd frontend
$env:BASE_URL = "http://127.0.0.1:8090"
npm run docker:check
```

On Linux/macOS use `PORT=8090 docker compose up --build -d --wait` and
`BASE_URL=http://127.0.0.1:8090 npm run docker:check`.

## Stored results

Committed inputs and `backend/outputs/` stay read-only in the API container.
The `backend-runtime` named volume is mounted at `/app/backend/.runtime` and
holds recalculated forecast overrides, logs, and any additional weather cache.
The image creates that directory with the API user's ownership so a new volume
is writable without running the service as root. Container restarts and rebuilds
preserve this volume. `docker compose down` keeps it as well.

Run `docker compose logs --tail 100 backend frontend` to inspect errors, or
`docker compose down` to stop the stack. Deleting the runtime volume removes
recalculations and restores the dashboard to committed archive results on its
next start; normal deployment does not require deleting it.

## Hosting

The default bind address is `127.0.0.1`, suitable for a local machine or an
existing reverse proxy on the host. To publish the port on a server's network
interfaces, set `BIND_ADDRESS=0.0.0.0` and `PORT` as needed. For a shared service,
put authentication and HTTPS at your reverse proxy before exposing it: the API
does not implement accounts or access control. Preserve the original HTTP Host
header through the proxy so same-origin recalculation requests are accepted.
Do not publish the backend port directly.

A custom nginx deployment must forward `/api` to the API service and preserve
the incoming Host header, as shown in `frontend/docker/nginx.conf`. A 120-second
upstream timeout allows time for archived model inference. Fingerprinted assets
are cached, HTML is revalidated, and API responses use `no-store`.

## Development without Docker

Follow [README.md](README.md) to run the API on port 8000 and Vite on port 5173.
For a production-build preview, use `npm run build` followed by `npm run preview`
from `frontend/` while the API is running. The preview server proxies `/api` to
the same local backend. It is a local verification tool, not the container web
server.

The dashboard displays historical data: January actuals and 48-hour archived
forecasts covering late January through early March 2026. February actuals and
metrics cannot be supplied by the bundled source measurements.
