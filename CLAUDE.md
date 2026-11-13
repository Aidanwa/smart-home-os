# smart-home-os — notes for Claude

Self-hosted smart home: Zigbee devices via Zigbee2MQTT, an LLM agent that controls them, a React dashboard. Solo project, developed on Windows (PowerShell / Git Bash).

## Topology

The repo is public. Host-specific values are placeholders (`<pi-host>`, `<tailnet>`, `<pc-host>`, `<user>`, `<mqtt-user>`, `<pc-backup-dir>`); real values are in git-ignored `CLAUDE.local.md`. Never commit hostnames, usernames, local paths or credentials. Secrets go in `.env` or `user_secrets`.

```
Browser ──HTTPS──► gateway :8000 (FastAPI + React SPA + routine scheduler + day curves)
                     │  /api/agent/* ── proxied (http/ws) ──► agent :8001 (LLM loop; calls back into gateway REST)
                     │  scheduler ── /internal/* (Spotify tools, "ask the agent") ──► agent
                     ├─► postgres (users, prefs, secrets, rooms, home profile, routines, curves)
                     ├─► redis (digital twin of device state + caches)
                     └─► Mosquitto (:1884, auth) + Zigbee2MQTT: host systemd services, not in compose
```

- **Production** is a Pi 4 (4 GB, SD card, Debian 12) at `<pi-host>.<tailnet>.ts.net`, repo in `~/smart-home-os`. The PC no longer runs the stack. SSH: `ssh smarthome-pi`. The Pi also runs Pi-hole, Tailscale, and Spotify Soloist ("Bedroom Speakers", its own project in `~/soloist`, seen by the app only as a Spotify device).
- Keep it lightweight: the agent has an enforced 1G memory limit, Whisper is `tiny.en` int8 on CPU, the DB pool is small. No heavy dependencies without reason.
- Compose reaches the broker at `host.docker.internal:1884`. Only the gateway publishes a port. `TLS_HOST` in `.env` picks the cert. Backups, restore and cron scripts: [docs/raspberry-pi.md](docs/raspberry-pi.md), [deploy/pi/](deploy/pi/) (edit there, re-`install` on the Pi).

## Repo layout

- uv workspace (Python 3.12): root `pyproject.toml`/`uv.lock`, members `services/gateway`, `services/agent`, `shared` (SQLAlchemy models, async session, Fernet helpers, Alembic). `services/database` is vestigial; the schema comes only from Alembic.
- Frontend: `services/gateway/frontend`.
- [docs/todo.md](docs/todo.md) is the one list of open work. Remove items when done; never re-propose anything under "Decided against".

## Running and deploying

No hot reload; Docker is the loop. Deploy: push from the PC, then on the Pi `cd ~/smart-home-os && git pull && docker compose up -d --build gateway` (or `agent`).
- Build one service at a time (parallel builds time out). Agent changes: deploy the agent first, then the gateway.
- Rebuilding the gateway restarts the agent; "agent unreachable" for ~40 s afterwards is normal.
- An SSH drop mid-`compose up` can leave a half-renamed container that blocks the next start. Run long deploys detached on the Pi (`nohup … > /tmp/x.log 2>&1 &`).
- `.env` uses Docker hostnames, so it doesn't work for host processes. [.env.example](.env.example) lists every variable.

**Imports:** `shared` is a namespace package, so the repo root must be on `sys.path` (Dockerfiles set `PYTHONPATH=/app/services/<svc>:/app`). Inside a service, imports are top-level (`from core.mqtt_bus …`). Both services have a package named `api`: never import across services.

**Migrations** (Alembic in `shared/`; Pi migrations need Aidan's OK). Hand-write the revision in `shared/alembic/versions/` after editing `shared/database/models.py`, push, then on the Pi:
1. `docker compose build gateway` (the old container keeps serving).
2. Back up: `docker exec home_postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > ~/home_os_pre_X.sql.gz`.
3. `docker compose run --rm -T --no-deps gateway sh -c "cd /app/shared && uv run --no-sync alembic upgrade head && uv run --no-sync alembic check"`. "No new upgrade operations detected" means the migration matches the models.
4. `docker compose up -d gateway`.

The current head is `d7a3c9e15b42`. `env.py` requires `DATABASE_URL`; Postgres listens only on the Pi's loopback.

**Dependencies:** `uv add <pkg> --package gateway|agent|shared`; `npm install` in the frontend.

## Verifying changes

There are no tests.
- Frontend: `npx tsc -b` must pass. `npm run lint` has old errors, so just don't add new ones.
- Python: `uv run python -m compileall -q services shared`, then rebuild and watch the logs.
- Layout, after deploying frontend changes: `SMARTHOME_HOST=<pi-host>.<tailnet>.ts.net tests/layout/run.sh` (headless Chrome at phone and desktop sizes; fails on sideways overflow). See [tests/README.md](tests/README.md).
- Live checks: `scp` a script to the Pi, `docker cp` it into `home_gateway`, run it with `docker exec -w /app/services/gateway home_gateway uv run --no-sync python /tmp/x.py`. Mint a short-lived JWT from `shared.security.JWT_SECRET_KEY` and call `https://localhost:8000` with `verify=False`.
  - Print only names and states, never secrets. Delete the script afterwards.
  - Name throwaway routines `TEST …` and delete them.
  - Anything noisy or that visibly changes lights needs Aidan's OK; prefer re-sending a device's current state. Device changes can fire routines (the bedroom overheads drive the bedside lamp).
- Headless UI: in Rooms View mode a tap on a marker switches a real light. Hit-test with `Konva.stages[0].getIntersection(point)` and only tap `room-bg`, then grep the gateway log for `POST /api/devices`.
- Quoting: PowerShell strips nested quotes in `ssh host '...'`, and quote-heavy heredocs break in the Bash tool. Write scripts to a file first. Don't `pkill -f` over SSH.

## Gateway

- **MQTT bus** ([core/mqtt_bus.py](services/gateway/core/mqtt_bus.py)) keeps Redis:
  - `gateway:digital_twin`: a hash **keyed by IEEE**, the last Z2M state plus `friendly_name`/`ieee_address`.
  - `gateway:device_exposes`: property metadata for routine pickers. Z2M's `category` puts settings and diagnostics in their own groups.
  - `gateway:device_settings`: [core/device_settings.py](services/gateway/core/device_settings.py), for the drawer's generic "All settings" and "Details".
  - `gateway:device_meta`: identity and pairing health.
  - `gateway:rooms`: occupancy from [core/rooms.py](services/gateway/core/rooms.py). A room is occupied while any presence/motion sensor placed in it says so; `null` means no sensor.
  - It also adds `presence_changed_at` when presence/occupancy flips.
  - The listen loop must catch per-message exceptions: an uncaught one kills the listener and the twin goes silently stale.
- **IDs:** the API and frontend use IEEE; Z2M topics use `friendly_name`. Endpoints accept either and translate via `bus._device_registry` and the twin.
- **Device control** ([core/device_control.py](services/gateway/core/device_control.py)): all device/group commands go through it, not `bus.rpc` directly.
  - A device `/set` RPC resolves on that device's next state publish (any source), serialized per device. Timeout 5 s → 504.
  - ON/OFF waits for a report with the requested state (`accept=` skips stale or duplicate reports), resends once, then 502 on mismatch. Brightness, colour and TOGGLE can't be matched.
  - Group `/set` is fire-and-forget.
  - It has a command hook and a payload filter (used by day curves).
- **Models:** `DeviceState`/`DeviceSetRequest` in `api/models.py` drop unknown fields. A new reading or setting the hand-built UI uses must be added there (the generic settings endpoint doesn't need it). `WRITE_ONLY_FIELDS` are sent without waiting.
- **Realtime:** `/api/ws` pushes `device_update | groups_update | device_delete | routine_run | room_update | curve_update | ota_result`. The frontend re-dispatches some as window events (`onGroupsUpdate`, `onRoutineRun`, `onCurveUpdate`, `onRealtimeReconnect`). Both sockets ping after 25 s of quiet; the client reconnects after 60 s of silence.
- **Auth:** HS256 JWT in the HttpOnly cookie `access_token` (30 days); `get_current_user` in `api/auth.py`. No RBAC. **Rotating `JWT_SECRET_KEY` invalidates every session and every stored secret** (Fernet key = SHA256 of it).
- Fixed API paths must be declared before `/{id}` routes.

## Routines (`services/gateway/scheduler/`)

- `schema.py` is the source of truth for routine JSON (`extra=forbid`). The frontend's `components/routines/types.ts` mirrors it; keep both in sync.
- In-memory state is derived and rebuilt from Postgres at startup. Only the process holding a Postgres advisory lock schedules. If startup fails, the gateway still serves.
- Routes that change a routine call `scheduler.reload(id)`; home profile changes call `reload_all()`.
- **Triggers:** time (optionally a one-time `date`), sun (needs the home location), device (edge-triggered; the first reading only seeds unless `fire_on_start`; `for_s`, `cooldown_s`, `rearm`), and room (a device trigger on the pseudo-device `room:<id>`).
- **Conditions:** AND, plus one level of `any`. Checked when a trigger fires; Run now skips them.
- **Late fires:** a time/sun fire later than `max(grace, 30 s)` is logged `missed`; missed ones are caught up once at startup.
- **Actions:** device, group, delay, fade (native or stepped), Spotify (via the agent's internal endpoint), run routine (loops refused, max depth 5), ask the agent (max 2 per routine per hour), notify (web push).
- **Units:** values are device-native: °C, and mired for colour temperature. The UI shows °F, and warmth % of each bulb's own range (`lib/colorTemp.ts`).

## Day curves (`services/gateway/curves/`)

- Lights follow warmth/brightness points (clock time or sunrise/solar noon/sunset ± minutes), linear in between, wrapping at midnight. Warmth is a % of each bulb's range.
- `schema.py` is mirrored by `components/routines/curves/types.ts`.
- Tables `light_curves` and `light_curve_members` (IEEE primary key: one curve per light, lights only).
- The controller (`app.state.curves`) runs only where the scheduler holds its lock. Every minute:
  - warmth goes to followers, on or off (it sets execute-if-off when a light joins);
  - brightness goes only to lights that are on;
  - a group gets one command when all its members want the same values;
  - its own commands are published directly, so they never count as manual changes.
- `device_control`'s payload filter adds the curve's values to a plain `{"state":"ON"}`. A light that reports off → on gets them resent.
- **Pausing:** warmth or brightness set through the hub (command hook), or a report far from what the curve sent (a remote), pauses that light until it reports off. Pauses are in Redis `gateway:curve_paused`.

## Agent (`services/agent`)

- A per-request `SmartHomeOrchestrator` with a per-user provider. Only OpenAI is implemented (Responses API, `store=False`).
- To call the gateway it mints a 5-minute user JWT. The loop runs up to 5 iterations; the system prompt is rebuilt each time from devices (`_HIDDEN_ATTRIBUTES` keeps settings out), rooms, day-curve status, home profile, weather, Spotify and memory facts.
- Chat history is in-process (1 h) and lost on restart. Long-term facts are in `user_preferences.agent_settings.user_memory`.
- **Adding a tool:**
  1. Add its schema in `tools/schema.py`.
  2. Register it in `TOOL_REGISTRY` (`api/dependencies.py`).
  3. Write the method as `fn(user_id=..., **args)`.

  Every schema is sent with every message, so keep names (`spot_*`, `rt_*`) and descriptions short and put long text behind a tool (`rt_format`). Strict mode means the model fills every property: optional args are `[T, "null"]`, listed in `required`, with `additionalProperties: false`, and `None` is ignored in code. Python parameter names must match schema keys exactly (a mismatch lands silently in `**kwargs`).
- `/internal/tools/{name}` and `/internal/agent/run` are for the scheduler only: they need a gateway-minted JWT with `scope: "internal"` and are never proxied. Routine runs are ephemeral and can't use memory or `rt_*` tools.
- Chat WS: text chunks, JSON `tool_call` events, then a literal `[DONE]`. The client sends `[STOP]` to cancel. Each reply runs as its own task, so it lands in history even if the browser leaves.

## Frontend

React 19, Vite, TypeScript, Tailwind v4, shadcn (`src/components/ui`), react-konva for Rooms. `@/` maps to `src/`.
- No router: the tab lives in the URL hash (`#routines`; `App.tsx` reads the part before `/`). Deep links: `#routines/activity`, `#routines/curves`, `#routines/history/<id>`.
- `getDeviceKind` in `lib/deviceUtils.ts` decides both a device's Home section and its card; change it there.
- `BaseDeviceCard` makes the whole card the on/off button. Inner controls need `data-control` or `pointer-events-auto`. Cards list the settings they show themselves in `handledSettings`, so "All settings" skips them.
- Requests go through `request()` in `lib/api.ts`, which toasts the hub's error. Status and errors are toasts, not inline banners (inline only for field validation). `AuthContext` patches `fetch` to log out on a 401.
- Dialogs: use `components/ui/dialog.tsx`, and `ConfirmDialog` for yes/no. Never `window.confirm` or a hand-rolled overlay. Number inputs: `components/routines/NumberField.tsx`, never a controlled `type="number"`.
- Mobile layout is a priority: check narrow widths.
- The service worker caches only `offline.html`, so deploys need no cache busting. If it ever caches more, bump `CACHE`.
- `npm run dev`'s proxy points at http; the Docker gateway is https. Use Docker.

## Known issues

- Z2M's `database.db` has duplicate Group records for groupID 2 (the ghost group "2"). The cleanup needs Aidan's OK. See Known bugs in docs/todo.md.
- Bulbs ignore warmth while off unless "execute if off" is set (`color_options.execute_if_off`, the drawer's "Remember warmth while off"). Both Hue overheads have it. Brightness can't be stored while off: setting it turns the light on.
- Stepped fades can't tell a manual change to a recently passed level from bulb reporting lag.
- The `rt_*` tool schemas cost about 450 tokens per chat message.
