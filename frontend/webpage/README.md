# Stack3 Security webpage

The webpage is an interactive demo using illustrative data, not a live security
scanner. Docker packages the existing application without adding frontend
dependencies or changing its routes.

## Run with Docker

Install Docker with Linux containers and Docker Compose. From this directory:

```powershell
docker compose up --build -d --wait
```

Open <http://localhost:3000>. Direct links such as
<http://localhost:3000/dashboard/scanner> also work.

To use a different host port:

```powershell
$env:WEBPAGE_PORT = "8080"
docker compose up --build -d --wait
```

The webpage is exposed only on the host's loopback interface. The container runs
as a non-root user with a read-only filesystem and an HTTP health check.
Only the runtime files are copied into the image; no package installation is
needed. Source edits require rebuilding with the same command.

View status and logs:

```powershell
docker compose ps
docker compose logs -f webpage
```

Stop and remove the container:

```powershell
docker compose down
```

## Run without Docker

With Node.js installed:

```powershell
npm run dev
```

The local server defaults to `127.0.0.1:3000`. `HOST` and `PORT` override the
listening interface and port. The Docker image sets `HOST=0.0.0.0` so Docker's
port forwarding can reach it; Compose still limits host access to loopback.
