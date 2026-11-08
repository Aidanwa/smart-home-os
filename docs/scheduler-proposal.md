# Proposal: routines / scheduler

Status: **design agreed 2026-11-08. Slices 0–4 implemented 2026-11-08. Next candidates: ntfy notifications (§10), templates.** Builds on [scheduler-handoff.md](scheduler-handoff.md). Decisions marked **(decided)** were settled with Aidan; everything else is a default that can be changed during review.

## 1. Corrections to the handoff doc

Verified against the code on 2026-11-08:

- **There's no device-control logic to reuse yet.** The ID translation, publish and wait for `/set` all live inside the route handlers in `api/routes.py`. Slice 0 moves this into `core/device_control.py`; the routes and the scheduler both call it.
- **State-change triggers need the previous value, and nothing stores it.** Each `device_update` on the bus queue carries the full current Z2M state, and the twin is overwritten before the broadcast goes out. The scheduler keeps its own last-seen value for each attribute it watches, seeded from the twin at startup.
- **Bus subscriber queues are unbounded** (`asyncio.Queue()` with no maxsize), so the `QueueFull` guards never fire. The scheduler's consumer must stay non-blocking: it only filters and spawns tasks. It can't kill the listen loop either way, because every subscriber has its own queue.
- **The agent's internal endpoint must sit outside `/api/agent/*`.** The gateway proxies that whole prefix to the browser. Use `/internal/...` instead. The agent publishes no host port, so only containers on `smarthome_net` can reach it.
- **Store stable IDs and resolve names at run time.** Routines store IEEE addresses and numeric Z2M group IDs, and look up the `friendly_name` when they run, so renaming a device doesn't break routines.
- **Sun triggers need a location.** `Home.latitude`/`longitude` are nullable and `timezone` defaults to `UTC`. Sun triggers and conditions are rejected at save time when there's no location.
- **Already verified:** `zoneinfo` works in the gateway image on the Pi (tzdata is present). `astral` is not installed. The gateway runs as a single uvicorn process with no `--workers`.
- **A lead on the group bug (unverified):** `delete_group` evicts only members that have a `name` key. Only our own `add_group_member` writes that key, because Z2M's `bridge/groups` members carry only `ieee_address`/`endpoint`. So real members are skipped, and `group/remove` then runs against a group that still has devices in it.

## 2. Architecture

**The scheduler runs inside the gateway**, as a `Scheduler` object created in `lifespan` after `bus.start()`, stopped before `bus.stop()`, and stored at `app.state.scheduler`. This is the right place because the gateway owns the bus, the twin and MQTT publishing. A separate service would need its own MQTT subscription plus a control channel back into the gateway.

New package `services/gateway/scheduler/`:

| Module | Role |
|---|---|
| `schema.py` | Pydantic models for triggers, conditions and actions (discriminated unions on `type`). Shared by the API, the engine and, later, the agent tools. |
| `store.py` | DB access for routines and runs. |
| `engine.py` | `Scheduler`: the time loop, the event loop, `for` timers, and per-routine run bookkeeping. |
| `runner.py` | Runs one routine instance: evaluates conditions, executes actions, writes the run log. |
| `sun.py` | Sunrise/sunset via `astral` (small, pure Python, no network). |
| `agent_client.py` | Gateway → agent internal calls with a minted 5-minute JWT. |

**How the scheduler runs:**

- **Time loop.** A min-heap of `(fire_at, routine_id, trigger_id)` for time and sun triggers. It sleeps until the earliest entry, capped at 60 s, or until a reload event fires. The cap keeps it honest across clock jumps.
- **Event loop.** One `bus.subscribe()` queue. For each `device_update` it looks up the routines watching that IEEE and attribute in an in-memory index, does edge detection (§4), and spawns runs or `for` timers.
- **Reloads.** CRUD routes call `scheduler.reload(routine_id)` directly (same process). `home_routes` calls `scheduler.reload_all()` when the timezone or location changes.
- **Startup order.**
  1. Take a Postgres advisory lock. If it's already held, log loudly and don't schedule. This guards against an accidental second process double-firing.
  2. Mark any run still `running` as `interrupted`.
  3. Wait (up to 30 s) for the bus to receive `bridge/devices`.
  4. Seed last-seen state from the twin.
  5. Build the heap.
  6. Run catch-up (§4).
- **Nightly housekeeping** at 04:00 local prunes the run log (§7).

Nothing important lives only in memory. Routines and the run log are in Postgres. In-memory state (the heap, last-seen values, `for` timers, active runs) is all derived and gets rebuilt at startup.

## 3. Data model

Two tables in `shared/database/models.py`, plus one Alembic revision.

**`routines`**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String(100) | |
| `description` | String(500) null | |
| `enabled` | bool, default true | |
| `owner_user_id` | FK users, `ON DELETE CASCADE` | Whose Spotify/LLM credentials actions run as **(decided: household-wide routines, each with a run-as owner)** |
| `mode` | String(16): `single` \| `restart` | **(decided)** |
| `grace_minutes` | int, default 5 | **(decided)** catch-up window for time/sun triggers |
| `triggers` | JSONB list | |
| `conditions` | JSONB list | AND-ed |
| `actions` | JSONB list | ordered |
| `schema_version` | int, default 1 | for future JSON migrations |
| `last_run_at`, `last_run_status` | denormalized | for the list view |
| `created_at`, `updated_at` | | |

Triggers, conditions and actions are JSONB because they're polymorphic, always loaded and saved as a whole, and never queried individually. Everything the list view or the engine filters on is a real column.

**`routine_runs`**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `routine_id` | FK, `ON DELETE CASCADE` | |
| `trigger_id` | String(16) null | null for "run now" |
| `trigger_type` | String(16) | `time` \| `sun` \| `device` \| `manual` \| `catchup` |
| `scheduled_for` | timestamptz null | set for time/sun triggers |
| `started_at`, `finished_at` | timestamptz | |
| `status` | String(16) | `running` \| `success` \| `partial` \| `failed` \| `skipped` \| `missed` \| `cancelled` \| `interrupted` |
| `late_seconds` | int null | set when the run was caught up |
| `trigger_detail` | JSONB | e.g. the device state that fired it, or which condition skipped it |
| `steps` | JSONB list | `{i, type, status, started_at, ms, detail, error}` per action |
| `error` | text null | |

Indexes: `(routine_id, started_at DESC)`. There's also a partial unique index on `(routine_id, trigger_id, scheduled_for) WHERE scheduled_for IS NOT NULL`, which makes a missed or caught-up time trigger impossible to run twice.

### JSON shapes

Every trigger and action gets a short `id` (e.g. `"t1"`, `"a3"`) so run logs and catch-up can refer to it. Device references are IEEE addresses, and group references are Z2M numeric IDs. Days are `["mon", …, "sun"]`, and `null` means every day. Times are local `"HH:MM"` in the home timezone.

**Triggers**
```json
{"id":"t1","type":"time","at":"07:00","days":["mon","tue","wed","thu","fri"]}
{"id":"t2","type":"sun","event":"sunset","offset_min":30,"days":null}
{"id":"t3","type":"device","device":"0x00158d0001a2b3c4","attribute":"contact",
 "op":"eq","value":false,"rearm":null,"for_s":null,"cooldown_s":0}
{"id":"t4","type":"device","device":"0x…","attribute":"temperature","op":"lt","value":18,"rearm":1.5}
{"id":"t5","type":"device","device":"0x…","attribute":"action","op":"eq","value":"on_press"}
```
- Device trigger `op` is one of `eq | ne | gt | gte | lt | lte | changes`. Values are device-native (temperature is always °C; the editor converts to °F per user, `ui_settings.temp_unit`).
- `rearm` (numeric ops only) is a hysteresis margin: `lt 18, rearm 1.5` fires at 17.9 and not again until the reading has risen to 19.5 or above. Added 2026-11-08 for noisy sensors and heater-style routines.
- `action` (remote buttons) is an event attribute: every matching report fires, since the twin keeps the last value. `changes` on it means "any press". `for_s` isn't allowed on it.

**Conditions** (all must pass)
```json
{"type":"time_window","after":"22:00","before":"06:00"}
{"type":"days","days":["sat","sun"]}
{"type":"device","device":"0x…","attribute":"state","op":"eq","value":"ON"}
{"type":"sun","state":"down"}
{"type":"any","conditions":[{"type":"sun","state":"down"},{"type":"days","days":["sat","sun"]}]}
```
The top-level list is AND. An `any` group is OR, one level deep (added 2026-11-08). The editor shows it as an All/Any toggle: "Any" is stored as a single `any` group.
A `time_window` may wrap past midnight.

**Actions**
```json
{"id":"a1","type":"device","device":"0x…","set":{"state":"ON","brightness":200,"transition":2}}
{"id":"a2","type":"group","group":3,"set":{"state":"OFF"}}
{"id":"a3","type":"delay","seconds":300}
{"id":"a4","type":"fade","target":{"device":"0x…"},"to_brightness":254,"from_brightness":1,
 "duration_s":600,"method":"native","wait":false}
{"id":"a5","type":"spotify_play","speaker":"Bedroom Speakers","uri":"spotify:playlist:…",
 "volume":35,"shuffle":true}
{"id":"a6","type":"spotify_ctrl","cmd":"pause","speaker":null}
{"id":"a7","type":"agent","prompt":"Pick calm music that suits the weather and play it in the bedroom."}
```
- Every action accepts `"stop_on_error": false`. The default is to continue, and the run is then marked `partial` **(decided)**.
- `set` reuses `DeviceSetRequest`: `state`, `brightness`, `color_temp`, `transition`.
- `delay` is capped at 12 h.

The shapes are deliberately flat and use plain words so the agent can write them later. The agent tool will take the routine as a JSON string and get back the Pydantic validation errors (§9), so the Responses API strict schema never has to model the nested unions.

## 4. Engine behaviour

**Time and sun triggers**
- The next occurrence is computed in the home timezone with `zoneinfo`.
- **DST.** A time that doesn't exist on the spring-forward day is shifted forward by the gap (02:30 runs at 03:30). A time that occurs twice in autumn runs once, at the first occurrence.
- Sun times are recomputed for each date. If the sun doesn't rise or set that day (polar regions), that day is skipped and logged as `missed`.

**Grace and catch-up (decided)**
- Every time/sun fire is compared to `now`, not only at startup. A fire that is ≤ `grace_minutes` late runs, with `late_seconds` recorded. A later one is logged as `missed` and doesn't run.
- At startup, each trigger's most recent occurrence is checked against the unique index. That turns "the gateway was down at 07:00" into a late run or a `missed` row.
- This also covers the **Pi having no RTC.** It boots with the last-shutdown time from fake-hwclock, then NTP jumps the clock forward. The 60 s loop cap plus the grace rule means a jump can never set off a burst of stale routines.

**Device triggers: edge detection is the main debounce**
- A trigger fires only when the predicate goes from false to true for that attribute. Z2M republishing `occupancy: true` every 30 s doesn't re-fire.
- Updates that don't include the attribute are ignored.
- The first value seen after startup only seeds the state and never fires.
- `cooldown_s` (default 0) suppresses re-fires within a window, for noisy threshold sensors.
- `changes` fires on any change of value.

**`for` duration (v1 extra, decided)**
- When the predicate becomes true, a timer task starts. If the predicate goes false before `for_s` elapses, the timer is cancelled. When it elapses, the routine fires.
- On restart the timer can't know how long the state has already held. If the twin shows the predicate true at startup, the timer starts from boot. That's conservative: the trigger fires late, never early.

**Overlap (decided)**
- `single`: a trigger that arrives while a run is active is ignored, without logging a skip row.
- `restart`: the active run is cancelled, logged as `cancelled` with the steps completed so far, and a new run starts. This is what makes "motion → on, wait 5 min, off" extend on each motion.

**Conditions** are evaluated when the trigger fires, against the twin and the home clock. A condition failure logs a `skipped` run naming the failing condition, which answers "why didn't my routine fire?"

## 5. Actions

**Device and group**
- Actions go through `core/device_control.py`.
- **Fix folded in:** the device `/set` result is checked against the requested `state` when it's `ON`/`OFF`. On a mismatch, the command is re-sent once. If the state still doesn't match, the step fails as `unconfirmed`. `TOGGLE`, brightness and colour aren't matched. This lives in the shared function, so the agent's `confirmed_state` benefits too.
- Group sets stay fire-and-forget. Each group step then **verifies after 3 s**: it reads the group's members from `gateway:groups`, compares their twin `state`, and lists any members that didn't follow in the step detail. If some members didn't follow, the step is `partial`.

**Fade**
- `method: native` sends one `set` with `transition = duration_s`. The Zigbee limit is about 6553 s. If the light is off, it first sends `state: ON` at `from_brightness`.
- `method: stepped` is a v1 extra **(decided)**. It sends brightness steps about every `max(duration/50, 2)` s, each with a short transition, for bulbs that mishandle long native transitions. It **aborts if someone changes the light** (the twin shows a brightness or state differing from what was last sent) and records `aborted: manual override` in the step.
- `wait: false` (the default) runs the fade in the background of the run, so "fade the lights up and start music" happens at the same time. Background fades belong to the run and are cancelled with it.

**Spotify (decided: internal agent endpoint)**
- The agent gets `POST /internal/tools/{name}` with body `{"args": {...}}`. It authenticates with a gateway-minted 5-minute JWT carrying `scope: "internal"`.
- It runs an allow-listed tool directly with no LLM: `spot_play`, `spot_ctrl`, `spot_search_playlist`. The existing `spotify_play` already confirms playback via `_await_playing`, and that confirmation becomes the step result.
- There is a single owner of the token code. If the agent is down, the step fails clearly with "agent unreachable".
- The routine editor's playlist picker uses the same endpoint (through a thin gateway route) or reads the agent's Redis cache `user:{id}:spotify_playlists`.

**Ask the agent (decided: later slice of v1)**
- The agent gets `POST /internal/agent/run {prompt}`, which runs `process_intent_stream` for the run-as user.
- The editor labels it clearly ("Uses the LLM. Costs tokens, results can vary").
- The full reply and every tool call/result go into the step detail. The step fails if a tool call errors or the loop hits its iteration limit.
- It uses a separate history key per routine, so it doesn't clutter the user's chat.

## 6. Out of scope for v1

These are noted so the shapes don't rule them out later:
- deeper nesting of condition groups (one level of `any` exists)
- templates
- webhook or manual-button triggers
- scenes
- vacation mode
- colour (`xy`/`hue`) in `set`
- presence and phone location
- notifications (see §10)
- routines triggering other routines
- a "notify" action

## 7. Run log and failure visibility (decided: UI only for now)

- **Retention.** `skipped` rows are kept 2 days, everything else 30 days. The nightly prune at 04:00 deletes the rest. The volume is trivial for Postgres on the SD card.
- **Live updates.** The scheduler pushes `{type:"routine_run", routine_id, status, ...}` through the existing `/api/ws` fan-out, using a new `bus.broadcast(msg)` helper. The route that deletes a device starts using that helper too.
- **Failure badge.** The Routines tab shows a red count of `failed`/`partial`/`missed` runs since the user last opened the tab. The "last opened" time is stored as `routines_seen_at` in `ui_settings`.
- **Logs.** Every run also logs one line in the gateway log at INFO, or at WARNING when it fails.

## 8. API

New `api/routine_routes.py`, prefix `/api/routines`, with `get_current_user` on each route. There's no RBAC, so any logged-in user can manage any routine. The run-as owner defaults to the creator. An editor can set it to themselves but not to another user, because that would spend someone else's tokens.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/routines` | list, with last run and `next_fire_at` |
| POST | `/api/routines` | create (validated) |
| GET / PUT / DELETE | `/api/routines/{id}` | read / full replace / delete |
| POST | `/api/routines/{id}/enabled` | `{enabled}` |
| POST | `/api/routines/{id}/run` | run now. Conditions are bypassed by default; `?check_conditions=true` applies them |
| POST | `/api/routines/{id}/duplicate` | copy, disabled |
| GET | `/api/routines/{id}/runs?limit=` | run history |
| GET | `/api/routines/runs/recent?since=` | for the badge |
| POST | `/api/routines/preview` | validate a draft and return the next 5 fire times, plus warnings such as "device not found" or "no home location" |
| GET | `/api/routines/sun` | today's sunrise/sunset, shown in the editor |

## 9. UI

**List (mobile first)**
- One column of cards. Each shows the name, a readable summary ("Weekdays 07:00 · 3 actions"), an enable switch, a last-run chip, "next: Mon 07:00", and a run-now button.
- A warning icon appears when the routine references a device that no longer exists.

**Editor**
- Full-screen `Sheet` on mobile, side panel on desktop.
- Three sections, **When / Only if / Do**, each a list of typed rows with a "+ add" menu.
- **Pickers.** The device picker comes from `useDevices`. The attribute picker offers the keys that device actually reports in the twin. The group picker comes from `useGroups`. The playlist picker comes from Spotify.
- **Advanced** collapsible: mode, grace minutes, run-as.
- The preview endpoint shows the next fire times live while you edit.

**Run history:** per routine, a drawer with expandable step details.

**Plumbing**
- A shared `summarizeRoutine()` produces the readable text. The agent can reuse the same wording later.
- New shadcn components will probably be needed: switch, select, input, collapsible. They're built at image build time, so the Pi runtime cost is nil.

## 10. Later: ntfy (noted per Aidan, 2026-11-08)

[ntfy](https://ntfy.sh) is a simple pub/sub push service. You POST text to `https://<server>/<topic>`, and the ntfy phone app (Android/iOS) shows a notification. It can be self-hosted as one small container on the Pi or used via ntfy.sh. Notifications support priority, tags and click/action buttons.

Planned uses:
1. **Failure alerts:** a per-user or household setting to push `failed`/`missed` routine runs.
2. **A `notify` action in routines:** "door left open 10 min → notify", "washing machine power < 5 W for 3 min → laundry done".
3. **Agent tool:** "remind me at 6 to take the bins out" becomes a routine with a notify action.

The topic name acts as the password on ntfy.sh, so use a long random topic or self-host with auth. Store it in `user_secrets`.

## 11. Agent integration (later; the design is ready for it)

- **Tools** `routine_list`, `routine_upsert` (the routine as a JSON string, validated by the same Pydantic models, with errors returned to the model) and `routine_enable`.
- They call `/api/routines` with the agent's existing minted JWT, following the existing `GatewayClient` pattern.
- The system prompt gets a one-line summary per routine. The readable summaries make that cheap.

## 12. Migration plan

1. Add the `Routine` and `RoutineRun` models to `shared/database/models.py`.
2. Autogenerate with `down_revision = 52850728036c` (the tunnel procedure is in CLAUDE.md).
3. Review the file and hand-add the partial unique index if autogenerate misses it.
4. Apply on the Pi **only after approval**: `docker exec home_gateway sh -c "cd /app/shared && uv run --no-sync alembic upgrade head"`.
5. Update the head in CLAUDE.md.

New dependency: `astral` (gateway only), in slice 2.

## 13. Implementation order

**Slice 0: groundwork (no user-visible change)**
1. Extract `core/device_control.py` (resolve the device or group, publish, RPC) and make the routes use it.
2. Add `state` matching plus one retry to device `set`.
3. Add the `bus.broadcast()` helper.
4. *(Optional warm-up)* Reproduce and fix the group delete/member-remove bug.

**Slice 1: first usable version**
1. Models, migration and Pydantic schemas.
2. Time triggers with days. Device, group and delay actions.
3. The engine's time loop, with the advisory lock, interrupted-run cleanup, the grace window and startup catch-up.
4. The run log, including `skipped`/`missed`.
5. CRUD, enable, run now, runs and preview endpoints.
6. List UI with enable, run now, last-run chip and next fire. A simple editor for time triggers and device/group actions.

*Usable as:* "every night at 23:30, all off"; "weekdays 07:00 bedroom on".

**Slice 2: triggers and conditions**
1. Sun triggers (`astral`) and the sun condition.
2. Time window, days and device conditions.
3. Device triggers with edge detection, cooldown and `for`.
4. `single`/`restart` modes.
5. Group verify.
6. Live run updates, the failure badge and the run-history drawer.
7. Prune housekeeping.

**Slice 3: music and fades**
1. The agent's `/internal/tools/*` endpoint and the gateway `agent_client`.
2. `spotify_play`/`spotify_ctrl` actions and the playlist picker.
3. Native and stepped fades with `wait` and manual-override abort.

*Usable as:* the full 07:00 wake-up example.

**Slice 4: polish**
1. The "Ask the agent" action.
2. Duplicate.
3. Agent routine tools (§11).

**Later:** ntfy (§10), OR conditions, templates, webhooks, scenes.

Each slice is verified per CLAUDE.md: `compileall`, `npx tsc -b`, a container rebuild, and reading the logs. Each slice also gets a hands-on check with a test routine one or two minutes in the future.

## 14. Smaller open questions (defaults in bold; say if any should change)

1. Does "Run now" apply conditions? **No by default**, with an opt-in flag.
2. Does the "Ask the agent" action share the user's chat history? **No**: each routine gets a separate history key.
3. What happens when a routine's device is removed from the network? **The routine stays**: it shows a warning in the list, and that action fails with "device not found" when it runs.
4. Run log retention: **30 days, `skipped` 2 days**.
5. Maximum delay: **12 h**.
6. Default fade method: **native**, with stepped available.
