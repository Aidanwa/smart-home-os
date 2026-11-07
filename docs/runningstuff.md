## Normal workflow: Docker (from repo root)

```sh
docker compose up -d --build gateway   # rebuilds backend + React frontend
docker compose up -d --build agent
docker compose logs -f gateway
```

App: https://awapc.tail1752d3.ts.net:8000 (gateway serves HTTPS using the Tailscale cert in `certs/`).

## Running the gateway on the host (rarely needed)

Must be run from the **repo root**. `shared` is a namespace package that only imports
when the root is on `sys.path`, so `cd services/gateway && uv run uvicorn main:app` fails
with `ModuleNotFoundError: No module named 'shared'`.

```powershell
uv run --package gateway uvicorn --app-dir services/gateway main:app --reload
```

`--app-dir` adds `services/gateway` to the path so `from core...` / `from api...` work.

Caveats:
- `.env` uses Docker hostnames (`postgres`, `redis`, `gateway`), so env vars like
  `DATABASE_URL` / `REDIS_URL` must be overridden to `localhost` and exported in the shell
  (`shared/database/core.py` reads `os.environ`, it does not load `.env`).
- The gateway proxies `/api/agent/*` to the hard-coded host `agent:8001`, which only
  resolves inside the compose network.

## Frontend dev server

```sh
cd services/gateway/frontend
npm run dev    # port 5173
```

`vite.config.ts` already has a proxy, but it targets `http://localhost:8000`. The Docker
gateway now serves HTTPS, so point the `/api` target at `https://localhost:8000` with
`secure: false` if you want to run Vite against it.
