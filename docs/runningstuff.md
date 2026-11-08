## Normal workflow: Docker (from repo root)

```sh
docker compose up -d --build gateway   # rebuilds backend + React frontend
docker compose up -d --build agent
docker compose logs -f gateway
```

Production runs on the Pi: https://<pi-host>.<tailnet>.ts.net:8000. Deploying and updating are in
[raspberry-pi.md](raspberry-pi.md). The gateway serves HTTPS with the Tailscale cert pair in `certs/`,
chosen by `TLS_HOST` in `.env` (see section 4 of raspberry-pi.md for issuing and renewing it).

Other handy ones: `docker compose up -d gateway` (start without rebuilding), `docker compose logs -f agent`.
Build one service at a time; rebuilding the gateway also restarts the agent.

## Managing production on the Pi from the PC

All of these run in PowerShell on the PC. They go over SSH (Tailscale, key auth) to an alias.

**One-time setup:** add the alias to `~/.ssh/config` (`C:\Users\<user>\.ssh\config`). The backup-pull script uses it too.

```
Host smarthome-pi
  HostName <pi-host>
  User <user>
```

Check it with `ssh smarthome-pi hostname`. Plain `ssh smarthome-pi` opens a shell on the Pi.

**Status and logs**

```powershell
ssh smarthome-pi "cd ~/smart-home-os && docker compose ps"                       # app containers + uptime
ssh smarthome-pi "docker stats --no-stream"                                      # CPU / memory per container
ssh smarthome-pi "cd ~/smart-home-os && docker compose logs --tail 100 gateway"  # or agent / postgres / redis
ssh -t smarthome-pi "cd ~/smart-home-os && docker compose logs -f --tail 50 gateway"   # follow; Ctrl+C to stop
ssh smarthome-pi "docker exec home_gateway sh -c 'cd /app/shared && uv run --no-sync alembic current'"   # DB migration head
ssh smarthome-pi "systemctl is-active mosquitto zigbee2mqtt pihole-FTL tailscaled"     # host services
ssh smarthome-pi "df -h / && free -h"                                            # disk and memory
```

**Restart, stop, start**

```powershell
ssh smarthome-pi "cd ~/smart-home-os && docker compose restart gateway"   # restart one service (also: agent)
ssh smarthome-pi "cd ~/smart-home-os && docker compose restart"           # restart everything
ssh smarthome-pi "cd ~/smart-home-os && docker compose stop"              # bring the app down (containers and data kept)
ssh smarthome-pi "cd ~/smart-home-os && docker compose up -d"             # bring it back up (no rebuild)
ssh smarthome-pi "cd ~/smart-home-os && docker compose down"              # remove containers; data volumes are kept
```

Never run `docker compose down -v`: `-v` deletes the volumes, i.e. the database. Containers you stopped on purpose stay stopped through a reboot (that's what `unless-stopped` means), so run `up -d` again. Routines run inside the gateway, so they're paused while it's down. A time-based run missed during a restart still goes ahead if the gateway is back within the routine's catch-up window; otherwise it's logged as missed.

**Deploy a change** (push from the PC first; build one service at a time)

```powershell
git push
ssh smarthome-pi "cd ~/smart-home-os && git pull && docker compose up -d --build agent"     # only if agent code changed
ssh smarthome-pi "cd ~/smart-home-os && git pull && docker compose up -d --build gateway"   # also restarts the agent (~40 s)
```

If the pull includes a database migration, follow the Migrations steps in [CLAUDE.md](../CLAUDE.md) instead (back up, apply with the new image, then swap containers).

**Host services, Spotify speaker, backups, reboot** (`-t` because `sudo` asks for your password)

```powershell
ssh -t smarthome-pi "sudo systemctl restart zigbee2mqtt"            # or mosquitto
ssh smarthome-pi "cd ~/soloist && docker compose restart"           # the 'Bedroom Speakers' Spotify device
ssh smarthome-pi "ls -lh ~/backups"                                 # nightly bundles (03:00, 14 kept)
ssh -t smarthome-pi "sudo /usr/local/bin/smarthome-backup.sh"       # take a backup now
ssh -t smarthome-pi "sudo reboot"                                   # containers come back by themselves (restart: unless-stopped)
```

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

## Dependencies (uv workspace)

One root `uv.lock` and one root `.venv` cover every service.

```sh
uv add <pkg> --package gateway     # or agent / shared
uv sync                            # at the repo root
```

`shared` (models, DB session, Alembic) is used by both services through `[tool.uv.sources] shared = { workspace = true }`.
Its imports (`from shared.database.models import ...`) resolve as a namespace package because the repo root is
on `sys.path`: the Dockerfiles set `PYTHONPATH=/app/services/<svc>:/app`, and locally you run from the repo root.
