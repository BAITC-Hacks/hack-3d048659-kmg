# Running Ветропрогноз with Docker

This frontend-only repository builds the React application in `frontend/` and serves its production files with Nginx. The container includes the three application pages, local fonts, images, and demonstration data. It does not provide a real forecasting model or backend API.

## Requirements and layout

Use Docker Engine with Docker Compose v2.20 or newer, or a recent Docker Desktop using Linux containers. Start the Docker engine first. Node.js and npm are not needed on the host to build or run the container; the image installs the locked dependencies with `npm ci`. The first build requires access to Docker Hub and the npm registry.

Run all `docker compose` commands below from the repository root:

- `docker-compose.yml` coordinates the service, ports, and restart policy.
- `frontend/Dockerfile` builds the frontend and configures its runtime.
- `frontend/docker/nginx.conf` configures the production web server.
- `frontend/package.json` and `frontend/package-lock.json` define application dependencies.

Compose uses `frontend/` as the build context. Frontend npm commands run inside that folder.

## Start locally

```bash
docker compose up --build -d --wait
```

Open [http://127.0.0.1:8088](http://127.0.0.1:8088). Direct links to `/forecast`, `/weather`, and `/history` also work, including browser refreshes.

The command builds the image, starts the container in the background, and waits for its health check. The default bind address is `127.0.0.1`. The container does not replace the Vite development preview on port 5173.

## Start on a server

Clone the repository onto a server with Docker, keeping `frontend/` and the root `docker-compose.yml` together. To accept connections on the server's network interfaces, run this from the repository root in Linux/macOS:

```bash
BIND_ADDRESS=0.0.0.0 docker compose up --build -d --wait
```

PowerShell equivalent:

```powershell
$env:BIND_ADDRESS = "0.0.0.0"
docker compose up --build -d --wait
```

Open `http://YOUR_SERVER_IP:8088` and configure the server's network/firewall rules to allow the intended access to that port. No domain name is required for an initial HTTP preview.

For a domain with HTTPS, place the container behind your existing reverse proxy and TLS termination. When that proxy runs on the host, retain the default local bind address and proxy to `http://127.0.0.1:8088`. HTTPS and certificate management are not configured by this repository.

The restart policy is `unless-stopped`: Docker starts the service again after engine/server restarts unless it was explicitly stopped. Enable Docker startup on the server as appropriate for its operating system.

## Commands

| Action | Command from repository root |
| --- | --- |
| Build and start | `docker compose up --build -d --wait` |
| Stop and remove this project's container/network | `docker compose down` |
| Build without starting | `docker compose build` |
| Follow the latest logs | `docker compose logs --follow --tail=100 web` |
| Show status and published port | `docker compose ps` |

To verify the running HTTP service, use Node.js 22.12+ and npm, then run:

```bash
cd frontend
npm run docker:check
```

This check does not start or stop containers. It verifies health, all three page routes, JavaScript/CSS and image delivery, cache headers, and 404 responses for missing assets and unimplemented API routes.

## Custom address and port

From the repository root in Linux/macOS:

```bash
PORT=9000 docker compose up --build -d --wait
```

To expose that port on all server interfaces:

```bash
BIND_ADDRESS=0.0.0.0 PORT=9000 docker compose up --build -d --wait
```

PowerShell equivalent:

```powershell
$env:BIND_ADDRESS = "0.0.0.0"
$env:PORT = "9000"
docker compose up --build -d --wait
```

`BIND_ADDRESS` chooses the host interface; `PORT` chooses the host port. The container always listens on 8080. Docker Compose also reads these variables from a local root `.env` file; explicit process environment values take precedence. PowerShell environment variables remain set for that shell session; set `BIND_ADDRESS` to `127.0.0.1` and `PORT` to `8088` to restore the local defaults.

For HTTP checks against a custom address or port, set `BASE_URL` while working inside `frontend/`:

```bash
BASE_URL=http://127.0.0.1:9000 npm run docker:check
```

PowerShell equivalent:

```powershell
$env:BASE_URL = "http://127.0.0.1:9000"
npm run docker:check
```

## Updating and stopping

After updating the source, rerun the same local/server start command with the same bind address and port settings. Compose rebuilds the image and replaces the container when needed. Source files are not mounted into the running container; editing them requires a rebuild. For editing with live reload outside Docker, run `npm ci` and `npm run dev` inside `frontend/`.

`docker compose down` removes this project's service container and network. It does not delete source files or Docker images. This frontend has no server-side database or persistent volume; demonstration runs are stored only in the browser tab's session storage.

The build uses image tags `node:24-alpine` and `nginx:stable-alpine`. Refresh the base images intentionally with `docker compose build --pull`, then rerun the relevant start command.

## Container behavior

- A separate Node build stage compiles the application; only the built static files and Nginx configuration enter the runtime stage.
- Nginx runs as its unprivileged `nginx` user on port 8080.
- `/healthz` returns plain text `ok`. Compose startup waits for this health check.
- Client-side routes fall back to `index.html`. Unimplemented `/api` requests return 404 instead of application HTML.
- Fingerprinted `/assets/` files have long immutable caching; HTML is revalidated so deployments can update the application shell.
- The build context is limited to `frontend/`, keeping Git history and root documentation outside the image build. `frontend/.dockerignore` also excludes installed dependencies, generated build output, and local `.env` files from that context.
- Runtime environment variables do not automatically configure a compiled Vite application. A future API integration will need an explicit build-time or runtime configuration contract. No API URL or backend is fabricated here.

## Troubleshooting

- **Cannot connect to Docker:** start Docker Desktop/the Docker engine and ensure this user can access it.
- **Port already allocated:** choose another `PORT`, then rerun the start command.
- **Build fails:** use `docker compose build` to see the build error; confirm that all frontend source/build files are in this checkout and registries are reachable.
- **Unhealthy container:** inspect `docker compose logs --tail=100 web` and `docker compose ps`.
- **Different UI than expected:** Docker builds the source in the current Git checkout. Verify the selected branch and rebuild after changing it.

References: [Docker Compose service configuration](https://docs.docker.com/reference/compose-file/services/), [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/), and [Nginx routing directives](https://nginx.org/en/docs/http/ngx_http_core_module.html).
