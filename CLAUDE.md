# smart-home-os — notes for Claude

A self-hosted smart home platform: Zigbee devices (via Zigbee2MQTT) plus an LLM agent that controls them, with a React dashboard. Solo project. Developed on Windows; shells are PowerShell / Git Bash.

## Topology

```
Browser ──HTTPS──► gateway :8000 (FastAPI + built React SPA, TLS via Tailscale cert)
                     │  /api/agent/*  ── reverse-proxied (http/ws) ──► agent :8001 (FastAPI, LLM loop)
                     │                                                   │ calls back into gateway REST
                     ├─► postgres :5432 (users, prefs, secrets, rooms, home profile)
                     ├─► redis (digital twin of device state + caches)
                     └─► MQTT broker (:1884, auth) + Zigbee2MQTT as host systemd services, NOT in compose
```

- **Production** runs on the Pi 4 (4 GB, SD card, 64-bit Debian 12) at `zigbee-hub.tail1752d3.ts.net`, in `~/smart-home-os` (user `adams`). It moved there on 2026-11-07. The Pi also runs Mosquitto, Z2M, Pi-hole and Tailscale as host services. Compose reaches the broker via `MQTT_HOST=host.docker.internal`, port 1884; 1883 is localhost-only. Keep things lightweight: the agent has a 1G memory limit (enforced, since the Pi boots with `cgroup_enable=memory`), Whisper is `tiny.en` int8 on CPU, and the DB pool is small. Don't add heavy dependencies casually. A Pi rebuild takes minutes, not seconds.
- The gateway's cert pair is chosen by `TLS_HOST` in `.env` (it defaults to `awapc.tail1752d3.ts.net` for the PC). Setup, backups and restore are in [docs/raspberry-pi.md](docs/raspberry-pi.md). Root cron scripts on the Pi are copied from [deploy/pi/](deploy/pi/): nightly backup at 03:00 and the monthly cert renewal. Edit the copies there and re-`install` them on the Pi.
- The PC (`awapc`) no longer runs the stack. Its old compose volumes are stale. SSH from the PC: `ssh adams@zigbee-hub` (key auth).
- Only the gateway is exposed (the agent publishes no host port). The agent is reached through the gateway's proxy at `http://agent:8001` and `ws://agent:8001` (hard-coded in [services/gateway/main.py](services/gateway/main.py)).

## Repo layout

- `pyproject.toml`: the uv workspace root (members `services/*` and `shared`). There's one root `uv.lock` and one root `.venv`. Python 3.12.
- `shared/`: SQLAlchemy models ([shared/database/models.py](shared/database/models.py)), the async engine/session ([shared/database/core.py](shared/database/core.py)), Fernet helpers ([shared/security.py](shared/security.py)), and Alembic.
- `services/gateway/`: the FastAPI API, MQTT bus, and SPA hosting. The frontend lives in `services/gateway/frontend/`.
- `services/agent/`: the LLM orchestrator, providers, and tools.
- `services/database/`: a vestigial workspace member. `init.sql` is empty, and the schema comes **only** from Alembic.
- `docs/`: short human notes. [docs/todo.md](docs/todo.md) is the roadmap and known-bugs list.

## Running (Docker is the dev loop)

Run from the repo root. There's no hot reload, so rebuild after every code change:

```sh
docker compose up -d --build gateway     # also rebuilds the frontend (multi-stage Dockerfile)
docker compose up -d --build agent
docker compose logs -f gateway           # or agent
```

The app is at `https://zigbee-hub.tail1752d3.ts.net:8000`. To deploy, push from the PC, then on the Pi run `cd ~/smart-home-os && git pull && docker compose up -d --build gateway` (or `agent`). Build one service at a time: parallel builds have timed out on npm downloads.

`.env` (git-ignored, read by compose `env_file`) uses Docker service hostnames (`postgres`, `redis`, `gateway`, `zigbee-hub`). It **won't work for processes on the host** without overrides. [.env.example](.env.example) lists every variable the services read. Note that `CORS_ORIGINS` is currently unused because the origins are hard-coded in `main.py`.

### Import-path rules

`shared` is used as a *namespace package*: `from shared.database.models import ...` resolves only when the **repo root** is on `sys.path`. The Dockerfiles set `PYTHONPATH=/app/services/<svc>:/app`. Inside a service, imports are top-level (`from core.mqtt_bus ...`, `from api.auth ...`). Running uvicorn from inside `services/gateway` fails with `ModuleNotFoundError: shared`. Locally you'd run from the root: `uv run --package gateway uvicorn --app-dir services/gateway main:app`. Exception: Alembic's `env.py` imports `database.core` (with `shared/` as cwd, via `prepend_sys_path = .`).

Both services have a top-level package named `api`. That's fine because they're separate processes, but never import across services.

### Migrations (Alembic in `shared/`)

- Check or apply in the running container (verified working):
  `docker exec home_gateway sh -c "cd /app/shared && uv run --no-sync alembic current"` (use `upgrade head` to apply).
- New migration: edit `shared/database/models.py`, then autogenerate from the host. The container has the old model code until it's rebuilt. `env.py` reads `DATABASE_URL` and falls back to `postgresql+asyncpg://admin:password@localhost:5432/home_os`. Postgres publishes 5432 to the Pi's loopback only. To autogenerate from the PC, first tunnel to the Pi's DB with `ssh -N -L 5432:127.0.0.1:5432 adams@zigbee-hub` (the PC's own compose must be down), and set `DATABASE_URL` with the real credentials.
  `cd shared; uv run alembic revision --autogenerate -m "msg"`. Review the generated file before applying.
- The current head is `52850728036c`.

### Dependencies

`uv add <pkg> --package gateway` (or `agent` / `shared`). Use `uv sync` at the root. Frontend: `npm install` in `services/gateway/frontend`.

## Verifying changes

There are **no tests**. Use these checks:
- Frontend: `npx tsc -b` in `services/gateway/frontend` (passes today). `npm run lint` has about 70 problems that predate this file, so don't treat lint-clean as a gate, just don't add new ones.
- Python: `uv run python -m compileall -q services shared`, then rebuild the container and watch the logs.
- The DB can be inspected read-only with `docker exec home_postgres psql -U <user> -d home_os`.

## Gateway internals

- **AsyncMqttBus** ([services/gateway/core/mqtt_bus.py](services/gateway/core/mqtt_bus.py)) subscribes to `zigbee2mqtt/#` and maintains Redis keys:
  - `gateway:digital_twin` is a hash **keyed by IEEE address** (`0x...`). The value is the last Z2M state JSON plus `friendly_name`/`ieee_address`.
  - `gateway:groups`, `gateway:bridge_info`: retained bridge payloads.
  - `_device_registry` maps friendly_name to IEEE (in memory, rebuilt from `bridge/devices`).
- **IDs**: the frontend and API key devices by IEEE, but Z2M topics use `friendly_name`. Endpoints accept either and translate via `_device_registry` and the twin. Keep that translation when adding device endpoints.
- **RPC** (`bus.rpc`): bridge requests correlate on an injected `transaction` id. Device `/set` correlates on **friendly_name**, meaning it resolves on that device's next state publish, so device RPCs are serialized per device with `_device_rpc_locks`. Timeout is 5s, mapped to HTTP 504. The listen loop catches and logs per-message exceptions. Keep it that way: an uncaught exception there kills the listener and the twin goes stale silently. Group `/set` is fire-and-forget.
- **Realtime**: `/api/ws` pushes `{type: device_update | groups_update | device_delete}`. The frontend re-dispatches `groups_update` as a `window` CustomEvent named `onGroupsUpdate`.
- **Auth**: a JWT in the HttpOnly cookie `access_token` (HS256, `JWT_SECRET_KEY`, 30 days). `get_current_user` lives in [services/gateway/api/auth.py](services/gateway/api/auth.py). The device router applies it router-wide, other routers apply it per route. No RBAC exists yet despite comments.
- **Routers**: `routes.py` (devices/groups/bridge/ws), `auth_routes.py` (`/api/auth`, `/api/platform`), `integration_routes.py` (Spotify OAuth), `home_routes.py` (singleton home profile, geocodes via Nominatim and NWS grid), `zone_routes.py` (rooms/floor-plan, used by the frontend). `/api/platform/zones` and `/api/platform/placements/*` are older duplicates of the zone routes.

## Agent internals

- Per request or WS connection, `get_orchestrator` ([services/agent/api/dependencies.py](services/agent/api/dependencies.py)) builds a `SmartHomeOrchestrator` with a per-user LLM provider ([core/provider_factory.py](services/agent/core/provider_factory.py)). That file reads the user's `agent_settings` (`provider`, `model`, `use_system_api_key`). Only OpenAI is implemented, via the **Responses API** with `store=False` ([providers/openai.py](services/agent/providers/openai.py)).
- **Auth**: the agent decodes the same cookie JWT itself. To call the gateway it **mints a 5-minute JWT for the user** ([tools/gateway_api.py](services/agent/tools/gateway_api.py)) over `GATEWAY_URL` (https, `verify=False`).
- **Loop**: up to 5 iterations. The system prompt is rebuilt each iteration from home state (`GET /api/devices`), home profile/timezone (DB), weather (NWS, cached for 1h per orchestrator), Spotify context, and the user's memory facts.
- **Memory**: short-term chat history is **in-process** (`MemoryManager._short_term`, a 1-hour sliding window) and is lost on agent restart. Long-term "facts" live in `user_preferences.agent_settings.user_memory` (a list, edited by index with add/update/remove ops).
- **Adding a tool** takes 3 steps. (1) Add the JSON schema in [tools/schema.py](services/agent/tools/schema.py); Spotify tools are gated on `has_spotify`. (2) Register the name in `TOOL_REGISTRY` in `api/dependencies.py`. (3) Make the method signature accept `user_id` as a kwarg plus the schema args; it's called as `tool(user_id=..., **args)`. Tool names are kept short on purpose (`spot_*`) to save tokens.
- **WS protocol** (`/api/agent/chat/stream`): the server sends raw text chunks, JSON-string tool events `{"type":"tool_call","name","arguments","status":"pending|completed"}`, then a literal `[DONE]`.
- `POST /api/agent/voice` transcribes uploaded audio with faster-whisper and returns the text; the frontend then sends it as chat.
- **Secrets**: `user_secrets.encrypted_credentials` uses Fernet with a key derived from `SHA256(JWT_SECRET_KEY)`. **Rotating `JWT_SECRET_KEY` invalidates every stored secret and every session.** Every service reads it only via `shared.security.JWT_SECRET_KEY`, which raises at import if it is unset. There is no fallback.

## Frontend (`services/gateway/frontend`)

React 19 + Vite 8 + TypeScript 6 + Tailwind v4 + shadcn (`radix-nova`, components in `src/components/ui`) + react-konva for the rooms canvas. The `@/` path alias maps to `src/`.
- There's no router. Tabs are state in [src/App.tsx](services/gateway/frontend/src/App.tsx) (`home | agent | rooms | routines | settings`). Routines is a placeholder.
- `AuthContext` monkey-patches `window.fetch` to log out on any 401, so plain `fetch` is fine. `authenticatedFetch` also exists.
- Data hooks are in `src/hooks` (`useDevices`, `useGroups`, `useAgentChat`, `useVoiceInput`, `useSystemHealth`). The rooms feature is self-contained under `src/components/rooms` (`useRoomLayout` talks to `/api/zones`). Device placement coordinates are percentages (0–100) of the room's size.
- Mobile layout is a priority (recent work). Check narrow widths when touching layout.
- `vite.config.ts` proxies `/api` to `http://localhost:8000`, but the gateway now serves HTTPS, so `npm run dev` against the Docker gateway needs that target changed to `https://...` with `secure: false`. Also, the first proxy key `/api` shadows the later `/api/agent*` entries. The normal workflow is Docker anyway.

## Known issues (found 2026-11-07 while writing this; not yet fixed)

- Some `user_secrets` rows predate encryption (plaintext Spotify rows found 2026-11-07). `decrypt_secret` raises on them, so those users must re-link Spotify. (`/api/platform/secrets` was fixed to encrypt on 2026-11-07.)
- Device-RPC replies resolve on the device's *next* state publish from any source (a physical switch press counts too). Per-device locking now prevents concurrent sets from clobbering each other, but the reply isn't matched against the requested values. **Low impact:** the UI ignores the `/set` response and renders only twin updates from `/api/ws`, so it self-corrects. Only the agent reads `confirmed_state`, so this matters only for screenless voice use (the planned edge node). There, a lost command could be reported as "done". If that becomes relevant, match on `state` only (brightness and colour can't be matched reliably).
- `GatewayClient.rename_group` sends `new_name` as a query param, but the gateway expects a JSON body. The method is unregistered dead code.
- Group member removal and MQTT errors: see KNOWN BUGS in [docs/todo.md](docs/todo.md).
