# Deployment

The stack contains the Python API, React/nginx frontend, MongoDB, Redis, a
Celery worker, and one Celery beat scheduler. MongoDB is configured as a
single-member replica set to support transactions. This local setup exposes
only nginx on `127.0.0.1:8088`.

## Start and stop

```bash
docker compose up --build -d --wait
docker compose ps
docker compose logs --tail 100 backend worker scheduler
```

Open [http://127.0.0.1:8088](http://127.0.0.1:8088). The first build downloads
Python and npm dependencies. `mongo-init` initializes `rs0` and exits normally.
The API migrates the bundled archive once. Workers and scheduler start after the
API is healthy. Keep exactly one scheduler running.

Stop with `docker compose down`. Named MongoDB and Redis volumes are preserved.
Do not delete volumes to upgrade an existing installation. Rebuild images and
restart services; the migration marker protects user updates from reseeding.

For another local port in PowerShell:

```powershell
$env:PORT = '8091'
docker compose up --build -d --wait
```

In a shell supporting inline variables, use `PORT=8091 docker compose up --build
-d --wait`. A separate `-p project-name` uses independent containers and volumes.

## Storage and configuration

| Setting | Container default |
| --- | --- |
| `MONGODB_URI` | `mongodb://mongo:27017/?replicaSet=rs0` |
| `MONGODB_DATABASE` | `windfarm` |
| `CELERY_BROKER_URL` | `redis://redis:6379/0` |
| `PORT` | `8088` |
| `BIND_ADDRESS` | `127.0.0.1` |

Set the Python settings in the Compose environment block when connecting to
managed infrastructure. MongoDB must support transactions (replica set/Atlas).
Database credentials belong in deployment secrets, not source files.

- `mongo-data`: authoritative windmills, actuals, import audit trail, calculation
  jobs, model artifacts and predictions. Back up with `mongodump`.
- `redis-data`: persistent queue transport. MongoDB is the durable job ledger;
  Redis outages are recovered by redispatching pending jobs.
- `backend-runtime`: retained for compatibility with the offline archive tools.
  New training results are stored in MongoDB, not this filesystem volume.

The web API has no user authentication and is intended for local/trusted use.
For a shared deployment, add authenticated HTTPS access at a reverse proxy and
secure MongoDB/Redis appropriately. Preserve the browser Host header through
nginx for same-origin validation. Do not publicly expose database or broker
ports. The single MongoDB member is not a high-availability deployment.

## Development

Use the checked-in development override to expose only the API to the host:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d backend worker scheduler
cd frontend
npm ci
npm run dev
```

Vite proxies `/api` to `127.0.0.1:8000`. `API_PORT` can change the published port;
if you change it, adjust the Vite proxy too. Use Linux containers for Celery;
Celery's prefork workers are not supported natively on Windows.

For a completely external service setup, install `backend/requirements.txt`, set
`MONGODB_URI`, `MONGODB_DATABASE`, and `CELERY_BROKER_URL`, then run the API,
`celery -A src.fleet.tasks:app worker --loglevel=info --concurrency=2`, and
`celery -A src.fleet.tasks:app beat --loglevel=info` in separate processes. Python
3.11 is the container/runtime reference version.

## Verification

From `frontend/`, run `npm test`, `npm run build`, and `npm run docker:check`.
For a custom port set `BASE_URL=http://127.0.0.1:8091` before the container check.
The smoke check reads health, data, routes and static assets without modifying
measurements.

Backend tests including the real database integration suite can run in the
existing stack. In PowerShell from the repository root:

```powershell
docker compose run --rm --no-deps -e MONGODB_TEST_URI=mongodb://mongo:27017/?replicaSet=rs0 -v "${PWD}/backend/tests:/app/backend/tests:ro" backend python -m pytest -p no:cacheprovider tests
```

The database tests create uniquely named `windfarm_test_*` databases and remove
only those test databases afterward. Without `MONGODB_TEST_URI` these integration
tests are skipped; the offline/unit tests still run.

For an interactive check, add a test windmill in **Ветряки и данные**, import at
least 120 consecutive hourly samples, and observe `queued → running → succeeded`.
Open the new forecast, correct one input hour, and verify the model revision
advances while the previous forecast remains in history. Test inputs should be
clearly labeled as synthetic and kept separate from actual measurements.

Health `/api/health` checks MongoDB; `/healthz` checks nginx. Job status reports
worker progress independently: a healthy API does not imply a worker is running.
Use `docker compose logs worker scheduler` to diagnose stalled jobs. Interrupted
worker leases are recovered after 20 minutes (up to three attempts). Failed jobs
can be retried from the UI.

See [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) for transaction rules, forecast
semantics, data limits, model features and collection indexes.
