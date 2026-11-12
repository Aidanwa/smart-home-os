# smart-home-os — notes for Claude

A self-hosted smart home platform: Zigbee devices (via Zigbee2MQTT) plus an LLM agent that controls them, with a React dashboard. Solo project. Developed on Windows; shells are PowerShell / Git Bash.

## Topology

Host-specific values are placeholders because the repo is public: `<pi-host>`, `<tailnet>` (the `….ts.net` domain), `<pc-host>`, `<user>`, `<mqtt-user>`, `<pc-backup-dir>`. The real values are in `CLAUDE.local.md` (git-ignored, loaded automatically). Never commit real hostnames, usernames, local paths or credentials. Secrets belong in `.env` (git-ignored) or `user_secrets`.

```
Browser ──HTTPS──► gateway :8000 (FastAPI + built React SPA + routine scheduler, TLS via Tailscale cert)
                     │  /api/agent/*  ── reverse-proxied (http/ws) ──► agent :8001 (FastAPI, LLM loop)
                     │  scheduler ── /internal/* (Spotify tools, "ask the agent") ──►│
                     │                                                   │ calls back into gateway REST
                     ├─► postgres :5432 (users, prefs, secrets, rooms, home profile, routines + run log)
                     ├─► redis (digital twin of device state + caches)
                     └─► MQTT broker (:1884, auth) + Zigbee2MQTT as host systemd services, NOT in compose
```

- **Production** runs on the Pi 4 (4 GB, SD card, 64-bit Debian 12) at `<pi-host>.<tailnet>.ts.net`, in `~/smart-home-os` (user `<user>`). It moved there on 2026-11-07. The Pi also runs Mosquitto, Z2M, Pi-hole and Tailscale as host services. It also runs Spotify Soloist, an always-on Connect speaker named "Bedroom Speakers" on the 3.5mm jack, as its own compose project in `~/soloist`. That folder is outside this repo and has its own README. The app sees it only as a Spotify device, which the agent targets by name. librespot/raspotify don't work for this account because Spotify refuses their audio keys. Compose reaches the broker via `MQTT_HOST=host.docker.internal`, port 1884; 1883 is localhost-only. Keep things lightweight: the agent has a 1G memory limit (enforced, since the Pi boots with `cgroup_enable=memory`), Whisper is `tiny.en` int8 on CPU, and the DB pool is small. Don't add heavy dependencies casually. A Pi rebuild takes minutes, not seconds.
- The gateway's cert pair is chosen by `TLS_HOST` in `.env` (required, with no default). Setup, backups and restore are in [docs/raspberry-pi.md](docs/raspberry-pi.md). Root cron scripts on the Pi are copied from [deploy/pi/](deploy/pi/): nightly backup at 03:00 and the monthly cert renewal. Edit the copies there and re-`install` them on the Pi.
- The PC (`<pc-host>`) no longer runs the stack. Its old compose volumes are stale. SSH from the PC: `ssh smarthome-pi` (key auth; an alias in `~/.ssh/config`, see [docs/runningstuff.md](docs/runningstuff.md)).
- Only the gateway is exposed (the agent publishes no host port). The agent is reached through the gateway's proxy at `http://agent:8001` and `ws://agent:8001` (hard-coded in [services/gateway/main.py](services/gateway/main.py)).

## Repo layout

- `pyproject.toml`: the uv workspace root (members `services/*` and `shared`). There's one root `uv.lock` and one root `.venv`. Python 3.12.
- `shared/`: SQLAlchemy models ([shared/database/models.py](shared/database/models.py)), the async engine/session ([shared/database/core.py](shared/database/core.py)), Fernet helpers ([shared/security.py](shared/security.py)), and Alembic.
- `services/gateway/`: the FastAPI API, MQTT bus, and SPA hosting. The frontend lives in `services/gateway/frontend/`.
- `services/agent/`: the LLM orchestrator, providers, and tools.
- `services/database/`: a vestigial workspace member. `init.sql` is empty, and the schema comes **only** from Alembic.
- `docs/`: short human notes. [docs/todo.md](docs/todo.md) is the one list of open work (ranked "Up next", known bugs, unconfirmed features, testing gaps, later ideas by area, and a "Decided against" list). Remove items when they're done, and don't re-propose anything under "Decided against".

## Running (Docker is the dev loop)

Run from the repo root. There's no hot reload, so rebuild after every code change:

```sh
docker compose up -d --build gateway     # also rebuilds the frontend (multi-stage Dockerfile)
docker compose up -d --build agent
docker compose logs -f gateway           # or agent
```

The app is at `https://<pi-host>.<tailnet>.ts.net:8000`. To deploy, push from the PC, then on the Pi run `cd ~/smart-home-os && git pull && docker compose up -d --build gateway` (or `agent`). Build one service at a time: parallel builds have timed out on npm downloads. Rebuilding the gateway also restarts the agent (it `depends_on` the gateway); the agent is unreachable for about 40 s while Whisper loads, so "agent unreachable" proxy errors right after a deploy are expected. If the change includes agent code, deploy the agent first, then the gateway.

`.env` (git-ignored, read by compose `env_file`) uses Docker service hostnames (`postgres`, `redis`, `gateway`, `<pi-host>`). It **won't work for processes on the host** without overrides. [.env.example](.env.example) lists every variable the services read. Note that `CORS_ORIGINS` is currently unused because the origins are hard-coded in `main.py`.

### Import-path rules

`shared` is used as a *namespace package*: `from shared.database.models import ...` resolves only when the **repo root** is on `sys.path`. The Dockerfiles set `PYTHONPATH=/app/services/<svc>:/app`. Inside a service, imports are top-level (`from core.mqtt_bus ...`, `from api.auth ...`). Running uvicorn from inside `services/gateway` fails with `ModuleNotFoundError: shared`. Locally you'd run from the root: `uv run --package gateway uvicorn --app-dir services/gateway main:app`. Exception: Alembic's `env.py` imports `database.core` (with `shared/` as cwd, via `prepend_sys_path = .`).

Both services have a top-level package named `api`. That's fine because they're separate processes, but never import across services.

### Migrations (Alembic in `shared/`)

- Check or apply in the running container (verified working):
  `docker exec home_gateway sh -c "cd /app/shared && uv run --no-sync alembic current"` (use `upgrade head` to apply).
- New migration, the way `b3e1d7a9c204` was done (no tunnel needed): edit `shared/database/models.py`, hand-write the revision in `shared/alembic/versions/`, push, then on the Pi `docker compose build gateway` (the old container keeps serving), back up (`docker exec home_postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > ~/home_os_pre_X.sql.gz`), apply and verify with the new image (`docker compose run --rm -T --no-deps gateway sh -c "cd /app/shared && uv run --no-sync alembic upgrade head && uv run --no-sync alembic check"`), then `docker compose up -d gateway`. `alembic check` saying "No new upgrade operations detected" proves the migration matches the models. Migrations on the Pi need Aidan's OK.
- Or autogenerate from the host. The container has the old model code until it's rebuilt. `env.py` requires `DATABASE_URL` (there's no fallback; never put credentials in the repo, which is public). Postgres publishes 5432 to the Pi's loopback only. To autogenerate from the PC, first tunnel to the Pi's DB with `ssh -N -L 5432:127.0.0.1:5432 smarthome-pi` (the PC's own compose must be down), and set `DATABASE_URL` with the real credentials.
  `cd shared; uv run alembic revision --autogenerate -m "msg"`. Review the generated file before applying.
- The current head is `c4f2a8d61e07` (push_subscriptions, hand-written and checked with `alembic check`).

### Dependencies

`uv add <pkg> --package gateway` (or `agent` / `shared`). Use `uv sync` at the root. Frontend: `npm install` in `services/gateway/frontend`.

## Verifying changes

There are **no tests**. Use these checks:
- Frontend: `npx tsc -b` in `services/gateway/frontend` (passes today). `npm run lint` has about 70 problems that predate this file, so don't treat lint-clean as a gate, just don't add new ones.
- Python: `uv run python -m compileall -q services shared`, then rebuild the container and watch the logs.
- Layout (after deploying a frontend change): `SMARTHOME_HOST=<pi-host>.<tailnet>.ts.net tests/layout/run.sh` renders every tab at phone and desktop sizes in headless Chrome and fails on sideways overflow, an unpinned or clipped nav, etc. See [tests/README.md](tests/README.md).
- The DB can be inspected read-only with `docker exec home_postgres psql -U <user> -d home_os`.
- Live checks against the real stack: write a script locally, `scp` it to the Pi, `docker cp` it into `home_gateway` (or `home_agent`) and run it with `docker exec -w /app/services/gateway home_gateway uv run --no-sync python /tmp/x.py`. Inside the container you can mint a short-lived session JWT from `shared.security.JWT_SECRET_KEY` and call `https://localhost:8000` with `verify=False`. Print only names and states, never secrets, and delete the script afterwards. Name throwaway routines `TEST …` and delete them. Anything that makes noise or visibly changes lights (music, fades) needs Aidan's OK first; prefer re-sending a device's current state. Device changes can fire routines (e.g. Aidan's Bedroom overheads drive the bedside lamp via "Lamp Off"/"Lamp On").
- Headless UI tests: in Rooms' View mode a synthetic tap on a marker switches a real light. Before tapping the canvas, hit-test with `Konva.stages[0].getIntersection(point)` and only tap `room-bg`. Afterwards, grep the gateway log for `POST /api/devices` to confirm nothing was sent.
- PowerShell 5.1 strips nested quotes in `ssh host '...'`, and heredocs containing quotes have broken in the Bash tool. For anything quote-heavy, write the script to a file first. Don't `pkill -f` over SSH (it can match the SSH command itself).

## Gateway internals

- **AsyncMqttBus** ([services/gateway/core/mqtt_bus.py](services/gateway/core/mqtt_bus.py)) subscribes to `zigbee2mqtt/#` and maintains Redis keys:
  - `gateway:digital_twin` is a hash **keyed by IEEE address** (`0x...`). The value is the last Z2M state JSON plus `friendly_name`/`ieee_address`.
  - `gateway:groups`, `gateway:bridge_info`: retained bridge payloads.
  - `gateway:device_exposes`: per-IEEE property metadata (type, unit, enum values) summarised from `bridge/devices`, for the routine editor's pickers.
  - `gateway:device_meta`: per-IEEE identity, firmware and pairing health (vendor/model, role, power source, build, date code, interview state, supported, disabled) from `bridge/devices`, served by `GET /api/devices/{id}/info` for the device drawer's About section and health warnings.
  - Z2M has `advanced.last_seen: ISO_8601` on, so every state carries `last_seen`. The agent's home-state prompt leaves it out (with `linkquality` and `update`) so it doesn't change on every message.
  - `_device_registry` maps friendly_name to IEEE (in memory, rebuilt from `bridge/devices`).
- **IDs**: the frontend and API key devices by IEEE, but Z2M topics use `friendly_name`. Endpoints accept either and translate via `_device_registry` and the twin. Keep that translation when adding device endpoints.
- **RPC** (`bus.rpc`): bridge requests correlate on an injected `transaction` id. Device `/set` correlates on **friendly_name**, meaning it resolves on that device's next state publish, so device RPCs are serialized per device with `_device_rpc_locks`. Timeout is 5s, mapped to HTTP 504. The listen loop catches and logs per-message exceptions. Keep it that way: an uncaught exception there kills the listener and the twin goes stale silently. Group `/set` is fire-and-forget.
- **Realtime**: `/api/ws` pushes `{type: device_update | groups_update | device_delete | routine_run}` via `bus.broadcast()`. The frontend re-dispatches `groups_update` as the `window` CustomEvent `onGroupsUpdate` and `routine_run` as `onRoutineRun`.
  - Both browser sockets (`/api/ws` and the agent chat proxy) send `{"type":"ping"}` after 25 s of quiet (`WS_KEEPALIVE_*` in `api/routes.py`). The frontend's `lib/reconnectingSocket.ts` treats 60 s of silence as dead and reconnects with backoff, and re-checks when the page wakes or comes back online. On a reconnect, `useDevices` re-fetches `/api/devices` and fires `onRealtimeReconnect`, which makes groups and routines refetch.
  - The chat proxy connects to the agent *before* accepting the browser, so while the agent is down the handshake fails and the browser retries. When either side ends, the proxy tears down both. The agent's 1008/1011 closes are passed through; the browser doesn't retry those.
- **Auth**: a JWT in the HttpOnly cookie `access_token` (HS256, `JWT_SECRET_KEY`, 30 days). `get_current_user` lives in [services/gateway/api/auth.py](services/gateway/api/auth.py). The device router applies it router-wide, other routers apply it per route. No RBAC exists yet despite comments.
- **Scheduler**: routines run inside the gateway. See the Routines section below.
- **Routers**: `routes.py` (devices/groups/bridge/ws, and `/api/system/status`: Zigbee health plus whether the agent answers, for the status dot), `auth_routes.py` (`/api/auth`, `/api/platform`), `integration_routes.py` (Spotify OAuth), `home_routes.py` (singleton home profile; geocodes via Nominatim and the NWS grid only when the address changes or the last lookup failed, and an NWS timezone overrides the one sent), `zone_routes.py` (rooms/floor-plan, used by the frontend), `routine_routes.py` (`/api/routines`), `push_routes.py` (`/api/push`: VAPID public key, this user's subscribed devices, a test send). `/api/platform/zones` and `/api/platform/placements/*` are older duplicates of the zone routes.

## Routines (scheduler)

Built 2026-11-08 (design history is in git: the old `docs/scheduler-proposal.md`, removed after commit `ec1ea27`).

- **Where:** [services/gateway/scheduler/](services/gateway/scheduler/), started in `lifespan` as `app.state.scheduler`. If startup fails (e.g. a missing table), the gateway still serves and the UI says the scheduler isn't running. Only the process holding a Postgres advisory lock schedules.
  - `schema.py`: the source of truth for routine JSON (Pydantic, `extra=forbid`). The frontend's `components/routines/types.ts` mirrors it; keep both in sync.
  - `timing.py`: time and sun fire times (`astral`) in the home timezone.
  - `matching.py`: comparisons, the re-arm rule, and conditions.
  - `engine.py`: the time loop, the device-event loop, catch-up and pruning.
  - `runner.py` and `actions.py`: execution.
  - `agent_client.py`: gateway → agent `/internal/*`.
  - `store.py`: database access.
- **State:** everything in memory is derived (next fire per time/sun trigger, device-trigger match state, `for` timers, active runs) and rebuilt from Postgres at startup.
- **Reloads:** routes that change a routine must call `scheduler.reload(id)`. Home profile changes call `reload_all()` (the timezone or location may change).
- **Data:** tables `routines` (household-wide; `owner_user_id` is the run-as user for Spotify/LLM) and `routine_runs`. Every run, skip and miss is a row. A unique index on `(routine, trigger, scheduled_for)` makes catch-up idempotent. Pruned once at startup and then nightly after 04:00 local: `skipped` after 2 days, the rest after 30.
- **Triggers** (any one starts the routine; none means Run now only):
  - **time** (`at`, `days`) and **sun** (sunrise/sunset ± `offset_min`). Sun needs the home location, otherwise saving gets a 422.
  - **device** reading: `op` is `eq|ne|gt|gte|lt|lte|changes`, with optional `rearm` (hysteresis), `for_s`, `cooldown_s` and `fire_on_start`. It's edge-triggered: the first reading after startup or an edit only seeds the state unless `fire_on_start` is set. `action` (remote buttons) is an event attribute that fires on every matching report.
  - **Lateness:** a time/sun fire more than `max(grace_minutes, 30 s)` late is logged `missed` and doesn't run. Missed occurrences are caught up once at startup. DST: a nonexistent 02:30 runs at 03:30; a doubled hour runs once.
- **Conditions:** an AND list, plus one level of `{"type":"any"}` (OR, shown as the All/Any toggle). Types are `time_window`, `days`, `device`, `sun`. They're checked when a trigger fires; Run now skips them. A failure logs a `skipped` run with the reason.
- **Overlap:** `single` logs a new trigger as `skipped` while a run is active (Run now gets 409). `restart` cancels the active run and starts again. Disabling or deleting a routine cancels its active run.
- **Actions** (in order; `stop_on_error` is false by default, and a failed step makes the run `partial`):
  - **device:** via `device_control.set_device`.
  - **group:** fire-and-forget, then a check of up to 3 s that members followed (`partial` if some didn't).
  - **delay:** up to 12 h.
  - **fade:** `native` hands one transition to the bulb; `stepped` sends steps and stops if someone changes the light. Bulbs report in-between levels and the final value arrives about 5 s late, so a "manual change" means outside every level sent in the last 7 s; on suspicion the fade holds a step before deciding. Fades pass `verify_state=False`. `wait=false` lets later actions run alongside, and the run finishes when the fade does.
  - **spotify_play / spotify_ctrl:** go through the agent as the owner. Volume and shuffle are set before playback. The optional volume ramp stops if the volume is changed by hand or playback stops.
  - **routine** ("Run routine", `{routine: <id>, wait, check_conditions}`): starts another routine as its own run (`trigger_type` `routine`, `trigger_detail.called_by`), via `Scheduler.call_routine`. Its conditions are skipped like Run now unless `check_conditions` (then not passing is an `ok` step with a note). A target that's off, or already running in `single` mode, makes the step `skipped` and the run `partial`. With `wait`, the target's outcome becomes the step's, and cancelling the caller cancels it. Loops are refused on save and preview (`_check_calls` in `routine_routes.py`, 422) and again at run time via the call chain carried in `RunContext.chain` (max `MAX_CALL_DEPTH` = 5). The agent's `rt_*` tools translate routine names ↔ ids.
  - **agent** ("Ask the agent"): an LLM run, capped at `AGENT_RUNS_PER_HOUR = 2` per routine (counted from the run log). Over the cap, the step is `skipped` and the run `partial`. With `notify` (`owner`/`everyone`) the reply is pushed to phones and the agent gets `ROUTINE_RUN_NOTIFY_NOTE` (write for a phone) instead of the "nobody is reading" note; an empty reply or failed delivery makes the step `partial`.
- **API:** [api/routine_routes.py](services/gateway/api/routine_routes.py) under `/api/routines`:
  - CRUD, `/{id}/enabled`, `/{id}/run`, `/{id}/runs`, `/{id}/duplicate`.
  - `/preview`: next fire times plus warnings.
  - `/attributes`: picker metadata.
  - `/spotify/devices` and `/spotify/search`.
  - `/alerts` and `/alerts/seen`: the tab's failure badge, using `ui_settings.routines_seen_at`.
  - `/{id}/reviewed` (POST/DELETE): hides a routine from this user's "Needs attention" until its next run (`ui_settings.routines_reviewed` maps id to the reviewed `last_run_at`; the list's `reviewed` flag compares them).
  - `/activity` (all runs, newest first, `before` cursor, `problems` filter) and `/upcoming` (scheduled fires for the next `days`, from `Scheduler.upcoming_all`): the Activity page (`RoutineActivity.tsx`).
  - Fixed paths must be declared before `/{routine_id}`.
- **Units:** values are device-native (temperature is always °C). The UI always shows and accepts °F and converts on the way in and out. Colour temperature is stored and sent in mired everywhere, and shown as **warmth %**: a percentage of that bulb's own range from Z2M's exposes (0% = coolest, 100% = warmest, so it rises with mired and comparisons keep their meaning). Helpers are in the frontend's `lib/colorTemp.ts`; groups use the union of their members' ranges.
- **One-time routines (reminders):** a time trigger with `date` ("YYYY-MM-DD", `days` null) fires once. A routine whose triggers are all dated is `one_time`; `done` once every date/time has passed (the list API reports both). The list shows them in their own "One-time" section below Off; the agent's `rt_list` leaves out done ones. Catch-up ignores a dated occurrence more than a day old (its run row may be pruned).
- **Notify action** (`{type: "notify", title?, message, to: "owner"|"everyone"}`): a web push via `core/push.py`. Fails the step if no recipient has a device.

## Notifications (web push)

- The installed app (iOS 16.4+ home-screen app, or any browser) subscribes in Settings → Notifications (`NotificationSettings.tsx`); the permission prompt must come from a tap. The subscription is saved in `push_subscriptions` (per user; re-subscribing moves a device to whoever is signed in).
- [core/push.py](services/gateway/core/push.py) encrypts (RFC 8291 aes128gcm, `http_ece`) and signs (VAPID ES256 JWT via pyjwt, 1 h expiry since Apple refuses longer) and POSTs with httpx. Devices the push service reports gone (404/410) are deleted. `public/sw.js` shows the push and, on tap, focuses or opens the app at its `url`.
- Config: `VAPID_PRIVATE_KEY` in `.env` (made once by `deploy/pi/make-vapid-key.sh`; changing it breaks every subscription), optional `VAPID_SUBJECT` (defaults to `https://<TLS_HOST>`). Without a key, push is off and `/api/push/key` returns 503.
- Routine alerts ([scheduler/alerts.py](services/gateway/scheduler/alerts.py)) go only to the routine's owner, per outcome toggles in `ui_settings` (`notify_failed`, `notify_missed`, `notify_partial`, all off by default). Alerts for one owner are gathered for 5 s into one notification; the same routine and outcome alerts at most once an hour (in memory).
- Deep links: `#routines/history/<id>` opens that routine's history, `#routines/activity` the Activity page (`RoutinesView.tsx`; `App.tsx` uses only the part before `/` as the tab).

## Agent internals

- Per request or WS connection, `get_orchestrator` ([services/agent/api/dependencies.py](services/agent/api/dependencies.py)) builds a `SmartHomeOrchestrator` with a per-user LLM provider ([core/provider_factory.py](services/agent/core/provider_factory.py)). That file reads the user's `agent_settings` (`provider`, `model`, `use_system_api_key`). Only OpenAI is implemented, via the **Responses API** with `store=False` ([providers/openai.py](services/agent/providers/openai.py)).
- **Auth**: the agent decodes the same cookie JWT itself. To call the gateway it **mints a 5-minute JWT for the user** ([tools/gateway_api.py](services/agent/tools/gateway_api.py)) over `GATEWAY_URL` (https, `verify=False`).
- **Loop**: up to 5 iterations. The system prompt is rebuilt each iteration from home state (`GET /api/devices`), home profile/timezone (DB), weather (NWS, cached for 1h per orchestrator), Spotify context, and the user's memory facts.
- **Memory**: short-term chat history is **in-process** (`MemoryManager._short_term`, a 1-hour sliding window) and is lost on agent restart. Long-term "facts" live in `user_preferences.agent_settings.user_memory` (a list, edited by index with add/update/remove ops).
- **Adding a tool** takes 3 steps. (1) Add the JSON schema in [tools/schema.py](services/agent/tools/schema.py); Spotify tools are gated on `has_spotify`. (2) Register the name in `TOOL_REGISTRY` in `api/dependencies.py`. (3) Make the method signature accept `user_id` as a kwarg plus the schema args; it's called as `tool(user_id=..., **args)`. Tool names are kept short on purpose (`spot_*`, `rt_*`) to save tokens. Every tool schema is sent with every message, so keep descriptions tight and put long reference text behind a tool (as `rt_format` does). The Responses API applies strict mode by default, so the model fills **every** property. For optional args, use `"type": [T, "null"]`, list them in `required`, set `additionalProperties: false`, and ignore `None` in code (see `spot_ctrl` and its `CMD_PARAMS` allow-list). Python parameter names must match the schema keys exactly: a mismatch lands silently in `**kwargs`.
- **Internal endpoint** ([api/internal_routes.py](services/agent/api/internal_routes.py)): `POST /internal/tools/{name}` runs an allow-listed tool with no LLM, for the gateway's routine scheduler (Spotify play/ctrl/search/devices/player). It requires a gateway-minted JWT with `scope: "internal"` (`Authorization: Bearer`); session cookies are refused. It's outside `/api/agent/*`, so the gateway proxy never exposes it. Gateway side: [scheduler/agent_client.py](services/gateway/scheduler/agent_client.py).
- **Routine tools** ([tools/routines_api.py](services/agent/tools/routines_api.py)): `rt_format` (the routine JSON format, fetched on demand), `rt_list`, `rt_save` (create, or partial update merged onto the saved routine), `rt_enable`, `rt_run`, `rt_delete` (needs `confirmed=true` after the user says yes). The model uses device/group names; the tool translates to IEEE addresses / group ids and back. Validation is the gateway's, and its 422 errors go back to the model.
- **Routine runs** (`POST /internal/agent/run`, the "Ask the agent" action): an orchestrator with `ephemeral=True` (no chat history read or written), an "unattended" prompt suffix, and `ROUTINE_RUN_EXCLUDED_TOOLS` (memory and `rt_*`, so a routine can't rewrite itself). The orchestrator yields `tool_result` events for this; the chat WS ignores them. The gateway caps these at 2 runs per routine per hour (`AGENT_RUNS_PER_HOUR`).
- **WS protocol** (`/api/agent/chat/stream`): the server sends raw text chunks, JSON-string tool events `{"type":"tool_call","call_id","name","arguments","status":"pending|completed"}` (completed ones add `ok` and `error`, from `tool_outcome` in `core/orchestrator.py`), then a literal `[DONE]`. Each reply runs as its own task (`_run_request` in `api/routes.py`), so it finishes and lands in the history even if the browser disconnects. The client sends the literal `[STOP]` to cancel it; the server answers `{"type":"stopped"}` then `[DONE]`, and `process_intent_stream` gives any unanswered tool call a "stopped" output and keeps the partial text, so the history stays valid for the Responses API. A connection opened while a reply is still running gets `{"type":"run_active"}` and later `{"type":"run_done"}` (then reload the history); a message sent while busy gets `{"type":"busy"}`. `/chat/history` marks each `function_call` with `ok`/`error`.
- `POST /api/agent/voice` transcribes uploaded audio with faster-whisper and returns the text; the frontend then sends it as chat.
- **Secrets**: `user_secrets.encrypted_credentials` uses Fernet with a key derived from `SHA256(JWT_SECRET_KEY)`. **Rotating `JWT_SECRET_KEY` invalidates every stored secret and every session.** Every service reads it only via `shared.security.JWT_SECRET_KEY`, which raises at import if it is unset. There is no fallback.

## Frontend (`services/gateway/frontend`)

React 19 + Vite 8 + TypeScript 6 + Tailwind v4 + shadcn (`radix-nova`, components in `src/components/ui`) + react-konva for the rooms canvas. The `@/` path alias maps to `src/`.
- There's no router. Tabs are state in [src/App.tsx](services/gateway/frontend/src/App.tsx) (`home | agent | rooms | routines | settings`), mirrored in the URL hash (`#routines`) so refresh and Back work. A `?code=` (Spotify sign-in return) opens Settings. Routines lives in `src/components/routines` (types there mirror `scheduler/schema.py`). The list (`RoutineList.tsx`) groups by first trigger type, room (from action targets via `useRoomIndex`) or nothing, with search, sort, a "Needs attention" section (last run failed/partial/missed/interrupted) and a collapsed "Off" section.
- `AuthContext` monkey-patches `window.fetch` to log out on any 401, so plain `fetch` is fine. `authenticatedFetch` also exists.
- The assistant chat state lives in `AgentChatProvider` (`hooks/useAgentChat.ts`) above the tabs, so replies survive tab switches; it connects the first time the Agent tab opens. Settings → Agent also edits the memory facts (`MemorySettings.tsx`) via `/api/platform/preferences`.
- Data hooks are in `src/hooks` (`useDevices`, `useGroups`, `useAgentChat`, `useVoiceInput`, `useSystemHealth`, and `useRoutines.ts`, which has `useRoutines`, `useDeviceAttributes`, `useSpotifyDevices`, `useRoutineAlerts` and `searchMusic`). The rooms feature is self-contained under `src/components/rooms` (`useRoomLayout` talks to `/api/zones`). Device placement coordinates are percentages (0–100) of the room's size.
- Device cards: `getDeviceKind` in `src/lib/deviceUtils.ts` decides both the Home section and the card (light, plug, switch, presence, sensor, climate, remote, other); change it there, not in the renderer. `presence` is any device reporting `presence` (mmWave, e.g. the Aqara FP300) or `occupancy` (PIR motion): `PresenceCard` shows Occupied/Clear and, in the drawer, the sensor's detection mode, sensitivity and absence delay. The gateway's `DeviceState`/`DeviceSetRequest` models (`api/models.py`) drop unknown fields, so a new device reading or setting must be added there too. `BaseDeviceCard` makes the whole card the on/off button; inner controls need `data-control` (sliders) or `pointer-events-auto` to sit above it.
- Feedback: device/group requests go through `request()` in `src/lib/api.ts`, which shows a `sonner` toast with the hub's error; `withPending`/`usePending` drive the card's busy spinner. Status and errors go to toasts, not inline banners (inline is only for form validation next to a field). `ErrorBoundary` wraps the app, each tab and each device card.
- Dialogs: `components/ui/dialog.tsx` (Radix: Escape, focus trap, stacking). Use `ConfirmDialog` for yes/no questions; never `window.confirm` or a hand-rolled `fixed inset-0` overlay. Its `onConfirm` may be async: throw (after toasting) to keep it open on failure. Button styles are in `ui/dialog-styles.ts`.
- Rooms has View and Edit modes. In View the plan pans and zooms, tapping a room zooms to it ("Whole floor" zooms back, `FloorStage.tsx`), and tapping a light or plug toggles it (`DeviceMarker` in `ResizableRoom.tsx` shows on/off and busy). Markers keep a minimum on-screen size; when they're packed too tightly to tap they ignore taps (so the room zooms instead) and overlapping names hide. In Edit, only the selected room (and its devices) is draggable, so a drag elsewhere pans; on phones the device list is a bottom sheet (`DeviceSheet`).
- Installable app (PWA): `public/manifest.webmanifest`, `index.html`'s `apple-*` tags and `public/sw.js` (registered in `main.tsx`, production only; it also shows push notifications, see Notifications above). The service worker caches nothing but `offline.html` (shown when a page load can't reach the hub), so deploys show up on the next launch with no cache busting. If you ever make it cache more, bump `CACHE`. The icons are PNGs rendered from `public/icon.svg`; re-render them if it changes.
- Hub status: `useSystemHealth` is called once in `App.tsx` and shared by the desktop sidebar (hover) and the phone Home header (`HealthButton`, a tap popover).
- Groups (Home → Groups): cards with on/off derived from members, a power toggle and group brightness; tapping one opens a Sheet (not a Dialog, so a device's drawer can open over it) listing the members' cards.
- Home can group by type, room (`hooks/useRoomIndex.ts`, from the Rooms floor plan) or A–Z. "Lights off" buttons only touch lights, never plugs.
- Firmware: `POST /api/devices/{id}/firmware/update` starts a Z2M OTA in a background task and returns 202; progress comes in the device's `update` state and the outcome as a `{type: "ota_result"}` WS message (a toast).
- Mobile layout is a priority (recent work). Check narrow widths when touching layout.
- Number inputs: use `components/routines/NumberField.tsx`, not a controlled `<input type="number">` that parses and clamps on every keystroke (that mangles typing). It keeps the typed text while focused and clamps when you leave the box.
- `vite.config.ts` proxies `/api` to `http://localhost:8000`, but the gateway now serves HTTPS, so `npm run dev` against the Docker gateway needs that target changed to `https://...` with `secure: false`. Also, the first proxy key `/api` shadows the later `/api/agent*` entries. The normal workflow is Docker anyway.

## Known issues

- Device-RPC replies resolve on the device's *next* state publish from any source (a physical switch press counts too). Per-device locking prevents concurrent sets from clobbering each other. [core/device_control.py](services/gateway/core/device_control.py) (`set_device`) checks the reply's `state` against an ON/OFF request, re-sends once on a mismatch, and then raises (HTTP 502). Brightness, colour and TOGGLE still aren't matched, since they can't be matched reliably. New device/group control code should go through `device_control`, not `bus.rpc` directly.
- `GatewayClient.rename_group` sends `new_name` as a query param, but the gateway expects a JSON body. The method is unregistered dead code.
- Group member removal and MQTT errors: see Known bugs in [docs/todo.md](docs/todo.md). Not reproducible through the API (live test 2026-11-12 was clean). Likely cause: Z2M's `database.db` on the Pi holds ten duplicate Group records for groupID 2. Herdsman keeps only one in memory, so the rest come back after a restart, which is the ghost group "2", and its `DatabaseEntry with ID 'N'` errors quote the record id, not the group id. Cleanup is pending Aidan's OK.
- Stepped fades can't tell a manual change to a level they passed in the last few seconds from bulb reporting lag; turning the light off always counts.
- The six `rt_*` tool schemas add about 450 tokens to every chat message.
