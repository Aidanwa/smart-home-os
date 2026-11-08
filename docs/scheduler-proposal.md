# Routines / scheduler: design and reference

Status: **built 2026-11-08** (slices 0–4, see §13). This started as the proposal answering [scheduler-handoff.md](scheduler-handoff.md) and now describes what exists. Decisions marked **(decided)** were settled with Aidan. Next candidates: ntfy notifications (§10) and templates.

Code: [services/gateway/scheduler/](../services/gateway/scheduler/) (engine), [api/routine_routes.py](../services/gateway/api/routine_routes.py) (API), [frontend/src/components/routines/](../services/gateway/frontend/src/components/routines/) (UI), [agent tools/routines_api.py](../services/agent/tools/routines_api.py) and [agent api/internal_routes.py](../services/agent/api/internal_routes.py) (agent side).

## 1. Findings that shaped the design (verified 2026-11-08)

- **Device control lived inside the route handlers.** It was moved into [core/device_control.py](../services/gateway/core/device_control.py). The routes and the scheduler both call it.
- **State-change triggers need the previous value, and nothing stored it.** Every `device_update` on the bus carries the full Z2M state, and the twin is overwritten before the broadcast. The scheduler keeps its own match state per device trigger, seeded from the twin.
- **Bus subscriber queues are unbounded.** The scheduler's consumer stays non-blocking: it only evaluates triggers and spawns tasks. Each subscriber has its own queue, so the scheduler can't break the MQTT listen loop.
- **The agent's internal endpoints sit outside `/api/agent/*`,** because the gateway proxies that whole prefix to the browser. They live at `/internal/...`, which only containers on `smarthome_net` can reach.
- **Routines store stable IDs and look up names when they run.** That means IEEE addresses and numeric Z2M group IDs, so renaming a device doesn't break a routine.
- **Sun triggers need a location.** `Home.latitude`/`longitude` are nullable. A routine that uses the sun is rejected at save time (HTTP 422) when the home has no location.
- **The group bug is still open:** see KNOWN BUGS in [todo.md](todo.md). The lead: `delete_group` only evicts members that have a `name` key, and only our own `add_group_member` writes that key. Z2M's members carry `ieee_address`/`endpoint`, so real members are skipped.

## 2. Architecture

**The scheduler runs inside the gateway.** A `Scheduler` is created in `lifespan` after `bus.start()`, stopped before `bus.stop()`, and stored at `app.state.scheduler`. The gateway owns the bus, the twin and MQTT publishing, so a separate service would need its own MQTT subscription plus a control channel back into the gateway.

| Module (`services/gateway/scheduler/`) | Role |
|---|---|
| `schema.py` | Pydantic models for triggers, conditions and actions (discriminated unions on `type`, `extra=forbid`). The single source of truth for routine JSON, shared by the API, the engine and, through the gateway, the agent tools. |
| `timing.py` | Next/previous fire times for time and sun triggers in the home timezone. Sunrise/sunset come from `astral` (pure Python, no network). |
| `matching.py` | Value comparisons, the re-arm (hysteresis) rule, and condition checks. |
| `engine.py` | `Scheduler`: the time loop, the device-event loop, `for` timers, overlap handling, catch-up, and the nightly prune. |
| `runner.py` | Runs one routine instance: each action in order, saving progress after each step, including background parts. |
| `actions.py` | What each action does (device, group, delay, fade, Spotify, agent). |
| `agent_client.py` | Gateway → agent internal calls, using a minted 5-minute JWT with `scope: "internal"`. |
| `store.py` | Database access for routines and runs. |

**How it runs**

- **Time loop.** It keeps a dict of the next fire time for each time/sun trigger. It sleeps until the earliest one, waking early when something is reloaded, and never sleeps longer than 60 s, so clock jumps are noticed.
- **Event loop.** It reads one `bus.subscribe()` queue. For each `device_update` it looks the IEEE address up in an index of device triggers, evaluates the matching triggers (§4), and spawns runs or `for` timers.
- **Reloads.** Routes that change a routine call `scheduler.reload(routine_id)`. Home profile create, update and delete call `scheduler.reload_all()`, since the timezone or location may have changed.
- **Startup order.**
  1. Take the Postgres advisory lock. If another process holds it, log an error and don't schedule.
  2. Mark any `running` runs as `interrupted`.
  3. Load the timezone and location, then the routines.
  4. Wait up to 15 s for MQTT.
  5. Seed the device triggers from the twin.
  6. Catch up (§4).
- If startup fails (for example, the tables don't exist yet), the gateway still serves, and the UI shows "scheduler isn't running".

Nothing important lives only in memory. Routines and runs are in Postgres. The in-memory state (next fire times, trigger match state, `for` timers, active runs) is derived from them and rebuilt at startup.

## 3. Data model

Two tables (migration `b3e1d7a9c204`, hand-written and checked with `alembic check`).

**`routines`**: `id`, `name`, `description`, `enabled`, `owner_user_id` (run-as user for Spotify/LLM, `ON DELETE CASCADE`), `mode` (`single`|`restart`), `grace_minutes` (default 5), `triggers`/`conditions`/`actions` (JSONB lists), `schema_version`, `last_run_at`/`last_run_status` (denormalised for the list), `created_at`/`updated_at`.

Routines are **household-wide** (decided): any logged-in user can see and edit any routine. The creator is the run-as owner. Duplicating makes the copier the owner. There's no run-as switch in the UI (declined).

**`routine_runs`**

| Column | Notes |
|---|---|
| `trigger_id`, `trigger_type` | `time` \| `sun` \| `device` \| `manual` |
| `scheduled_for` | Set for time/sun triggers. A partial unique index on `(routine_id, trigger_id, scheduled_for)` means an occurrence can be recorded at most once, which makes catch-up idempotent. |
| `status` | `running` \| `success` \| `partial` \| `failed` \| `skipped` \| `missed` \| `cancelled` \| `interrupted` |
| `late_seconds` | Set when a run started ≥ 5 s late. |
| `trigger_detail` | What fired it (`{device, attribute, value, held_s?, already_true?}`), or why it was skipped or missed (`reason`). |
| `steps` | One per action: `{id, type, status: ok\|partial\|failed\|skipped\|cancelled\|running, started_at, ms, detail, error}` |
| `error` | Summary of failed steps. |

There's also an index on `(routine_id, started_at)`.

### JSON shapes

Triggers and actions have short ids (`"t1"`, `"a3"`). Device references are IEEE addresses and groups are Z2M numeric ids. Days are `["mon", …, "sun"]`, with `null` meaning every day. Times are local `"HH:MM"` in the home timezone. Values are device-native: **temperature is always °C**, and the editor always shows and accepts °F.

**Triggers** (any one starts the routine; no triggers means it only runs with Run now)
```json
{"id":"t1","type":"time","at":"07:00","days":["mon","tue","wed","thu","fri"]}
{"id":"t2","type":"sun","event":"sunset","offset_min":30,"days":null}
{"id":"t3","type":"device","device":"0x…","attribute":"contact","op":"eq","value":false,
 "rearm":null,"for_s":null,"cooldown_s":0,"fire_on_start":false}
{"id":"t4","type":"device","device":"0x…","attribute":"temperature","op":"lt","value":18,"rearm":1.5}
{"id":"t5","type":"device","device":"0x…","attribute":"action","op":"eq","value":"on_press"}
```
- **`op`:** `eq | ne | gt | gte | lt | lte | changes`.
- **`rearm`** (numeric ops only) is a hysteresis margin: `lt 18, rearm 1.5` fires at 17.9 and not again until the reading has risen to 19.5 or above.
- **`action`** (remote buttons) is an event attribute: every matching report fires, because the twin keeps the last value. `changes` on it means "any press". `for_s` and `fire_on_start` aren't allowed on it.
- **`fire_on_start`:** also fire if the reading already matches when the routine is saved or the hub starts.

**Conditions** (the list is AND)
```json
{"type":"time_window","after":"22:00","before":"06:00"}
{"type":"days","days":["sat","sun"]}
{"type":"device","device":"0x…","attribute":"state","op":"eq","value":"ON"}
{"type":"sun","state":"down"}
{"type":"any","conditions":[{"type":"sun","state":"down"},{"type":"days","days":["sat","sun"]}]}
```
- A `time_window` can wrap past midnight.
- `any` is OR, one level deep. The editor shows it as an All/Any toggle, and "Any" is stored as a single `any` group.

**Actions** (in order)
```json
{"id":"a1","type":"device","device":"0x…","set":{"state":"ON","brightness":200,"transition":2}}
{"id":"a2","type":"group","group":3,"set":{"state":"OFF"}}
{"id":"a3","type":"delay","seconds":300}
{"id":"a4","type":"fade","device":"0x…","group":null,"to_brightness":254,"from_brightness":1,
 "to_color_temp":250,"from_color_temp":455,"duration_s":600,"method":"native","wait":false}
{"id":"a5","type":"spotify_play","speaker":"Bedroom Speakers","uri":"spotify:playlist:…","title":"Morning",
 "volume":10,"ramp_to":35,"ramp_s":600,"shuffle":true}
{"id":"a6","type":"spotify_ctrl","cmd":"pause","speaker":null,"volume":null}
{"id":"a7","type":"agent","prompt":"Pick calm music that suits the weather and play it in the bedroom."}
```
- **`stop_on_error`:** every action accepts it, default `false`. A failed step then makes the run `partial` (decided).
- **`set`:** uses `DeviceSetRequest`'s fields (`state`, `brightness` 0–254, `color_temp` in mireds, `transition`).
- **Limits:** `delay` is capped at 12 h. `duration_s` is at most 6000. `ramp_s` is 30–7200. A fade needs exactly one of `device`/`group`.

## 4. Engine behaviour

**Time and sun triggers**
- Fire times are computed in the home timezone (`zoneinfo`).
- **DST:** a time that doesn't exist on the spring-forward day is shifted forward by the gap (02:30 runs at 03:30). A time that occurs twice in autumn runs once.
- **Sun times** are computed per date. A day with no sunrise or sunset, or a home with no location, simply has no fire.

**Grace and catch-up (decided)**
- **Late but within grace:** any time/sun fire up to `max(grace_minutes, 30 s)` late runs, with `late_seconds` recorded.
- **Beyond grace:** the run is recorded as `missed` and doesn't run. Grace 0 therefore still allows 30 s.
- **At startup:** each trigger's most recent occurrence since the routine was last edited is checked against the unique index. If it wasn't recorded, it runs late or is logged `missed`.
- **Clock jumps:** next fire times are computed from "now", so a clock jump (the Pi has no RTC) produces at most one `missed` row, never a burst of runs.

**Device triggers**
- **Edge-triggered:** a trigger fires when its comparison changes from false to true. Repeated identical reports don't re-fire. Reports that don't include the attribute are ignored.
- **First reading:** after startup or an edit, the first reading only sets the state, unless `fire_on_start` is set. Then it fires once, even if the startup seed and a live report both arrive first.
- **`rearm`:** a matched trigger stays matched until the value moves back past the threshold by the margin.
- **`for_s`:** a timer starts when the trigger matches and is cancelled if it stops matching first. A state that's already true at startup starts its timer at boot, so it fires late rather than early.
- **`cooldown_s`:** suppresses re-fires within that window.
- **`changes`:** fires on any change of value.

**Overlap (decided)**
- `single`: a trigger that arrives while a run is still active is logged as `skipped` (except Run now, which gets HTTP 409).
- `restart`: the active run is cancelled (logged `cancelled` with its steps so far) and a new run starts.
- Disabling or deleting a routine cancels its current run. Editing it doesn't.

**Conditions** are checked when a trigger fires (Run now skips them). A failure logs a `skipped` run whose reason names the condition: "Condition 1 not met: BedroomThermometer temperature is 19.5".

## 5. Actions

**Device and group**
- **Device:** goes through `device_control.set_device`. The reply's `state` is checked against an ON/OFF request; on a mismatch the command is re-sent once, and then the step fails.
- **Group:** sets are fire-and-forget. For ON/OFF, the step then watches members' twin state for up to 3 s, returning early once they all follow. If some don't follow, the step is `partial` and lists them; if none do, it fails.

**Fade**
- **Native (default):** one command with `transition = duration_s`, so the bulb does the work. If the light is off, or a `from_` value is set, a start command (`state: ON` at `from_brightness`, else 1) goes first. A fade to 0 is an OFF with a transition. Fades skip the ON/OFF reply check, because a bulb can still report ON mid-fade-out.
- **Stepped:** sends steps every `max(2 s, duration/50)`, interpolating brightness and colour temperature. It stops if someone changes the light:
  - **What counts as a change:** a report outside every level it sent in the last 7 s, ±10. Hue bulbs report in-between levels and the final value arrives about 5 s late.
  - **On the first suspicious report,** the fade holds (sends nothing, so it can't overwrite the change). On the next check it stops if the light is still off course and carries on if it was just lag.
  - **Limit:** a change to a level the fade passed in the last few seconds can't be told apart from lag. Turning the light off always counts.
- **`wait: false`** (default): the fade (stepped) or the bulb's transition (native) runs while later actions go ahead. A stepped fade's step shows `running`, and the run finishes once it's done. Cancelling the run cancels it.

**Spotify (decided: via an internal agent endpoint, no LLM)**
- **How:** `POST /internal/tools/{name}` on the agent, allow-listed to `spot_play`, `spot_ctrl`, `spot_search`, `spot_search_playlist`, `spot_devices` and `spot_player`. It runs as the routine's owner.
- **Order of commands:** volume and shuffle are set before playback so music doesn't start loud. If the idle speaker refuses, they're retried after playback starts. `spot_play` confirms that playback actually started.
- **Volume ramp:** steps every `max(15 s, ramp_s/20)`. It stops if playback stops, moves to another speaker, or the volume is changed by hand (more than 3% off).
- **Agent down:** the step fails with "Agent unreachable…".

**Ask the agent (decided)**
- **How it runs:** `POST /internal/agent/run {prompt, routine}` runs the instruction through the normal LLM loop as the owner, with:
  - no chat history, read or written
  - memory and `rt_*` tools withheld, so a routine can't rewrite itself
  - an "unattended" note in the system prompt
- **What's recorded:** the agent's reply and every tool call with its outcome.
- **When it fails:** a tool fails, the provider errors, or the loop hits its 5-step limit.
- **Cost cap (decided):** at most **2 agent runs per routine per hour** (`AGENT_RUNS_PER_HOUR`, counted from the run log, so it survives restarts). Over the cap, the step is `skipped` and the run `partial`.

## 6. Not built (noted so the shapes don't rule them out)

- **Notifications and a `notify` action (§10):** reminders like "remind me…" are blocked on these, and the agent is told to say so.
- **Templates.**
- **Deeper condition nesting:** one level of `any` exists.
- **Triggers:** stale-sensor and rate-of-change triggers (considered for slice 2, not chosen), and webhook triggers.
- **Scenes, vacation mode, presence.**
- **Colour (`xy`/`hue`) in `set`.**
- **Routines triggering routines.**
- **A run-as switch** (declined).
- **Import/export** (declined).

## 7. Run log and visibility (decided: UI only for now)

- **Retention:** `skipped` runs are kept 2 days, everything else 30. Pruning happens once at startup and then nightly after 04:00 local.
- **Live updates:** `{type: "routine_run", routine_id, run_id, status}` goes over `/api/ws` via `bus.broadcast()`. The frontend re-dispatches it as the `onRoutineRun` event.
- **Failure badge:** a red count on the Routines tab of `failed`/`partial`/`missed`/`interrupted` runs since this user last opened the tab. That time is stored as `ui_settings.routines_seen_at`; if it was never set, the last 7 days count.
- **Gateway log:** one line per run (INFO, or WARNING if it didn't succeed), plus lines for triggers, skips and misses.

## 8. API (`api/routine_routes.py`, `get_current_user` on each route)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/routines` | `{timezone, scheduler_active, routines: [...]}` with `next_fire_at`, `running`, owner |
| POST | `/api/routines` | create (422 on invalid; 422 if it uses the sun and the home has no location) |
| POST | `/api/routines/preview` | validate a draft; next 5 fire times plus warnings (missing devices/groups/attributes, unavailable Spotify speaker, no location) |
| GET | `/api/routines/attributes` | per device: properties with type/unit/allowed values (Z2M exposes, cached in Redis `gateway:device_exposes`) and current values |
| GET | `/api/routines/spotify/devices` | the current user's Spotify speakers |
| GET | `/api/routines/spotify/search?q=` | music picker: the user's playlists first, then the catalogue |
| GET | `/api/routines/alerts` | badge count since `routines_seen_at` |
| POST | `/api/routines/alerts/seen` | mark the badge as seen |
| GET / PUT / DELETE | `/api/routines/{id}` | read / full replace / delete |
| POST | `/api/routines/{id}/enabled` | `{enabled}` |
| POST | `/api/routines/{id}/duplicate` | copy named "X (copy)", disabled, owned by the caller |
| POST | `/api/routines/{id}/run` | run now (conditions skipped; 409 if already running in `single` mode) |
| GET | `/api/routines/{id}/runs?limit=` | run history (default 20, max 100) |

Fixed paths are declared before `/{id}`, so they aren't parsed as routine ids.

## 9. UI (`frontend/src/components/routines/`)

- **List:** one card per routine with a readable summary, enable switch, last-run chip, next run, and buttons for Run now, History, Duplicate and Edit. The Routines tab carries the red failure badge.
- **Editor:** a full-width Sheet with:
  - **When:** time, sunrise/sunset, device or sensor.
  - **Only if:** conditions, with the All/Any toggle.
  - **Do:** device, group, fade, wait, play music, music control, ask the agent.
  - **Advanced:** mode and catch-up window.
  - **Live preview:** next runs and warnings.
- **Pickers:**
  - **Readings:** come from `/attributes` (the right input per type, units, "Now: …", °F for temperatures).
  - **Music:** search box.
  - **Speakers:** from Spotify.
  - **Fades:** colour temperature in Kelvin.
- **Number boxes** use `NumberField`, which leaves your typing alone while focused and clamps when you leave the box. Use it for any new number input.
- **History:** expandable steps, with fade, music and agent details (reply and ✓/✗ tool calls).
- **Mirroring the backend:** `types.ts` mirrors `schema.py`. Keep the two in sync.

## 10. Next: ntfy notifications

[ntfy](https://ntfy.sh) is a simple pub/sub push service. You POST text to `https://<server>/<topic>`, and the ntfy phone app shows it. It can be self-hosted as one small container on the Pi or used via ntfy.sh, and supports priority, tags and action buttons. Planned uses:
1. **Failure alerts:** push `failed`/`missed` runs.
2. **A `notify` action:** "door left open 10 min → notify", "washer power < 5 W for 3 min → laundry done".
3. **Agent reminders:** "remind me at 6 to take the bins out" becomes a routine with a notify action.

On ntfy.sh the topic name is effectively the password, so use a long random topic or self-host with auth, and store it in `user_secrets`.

## 11. Agent integration (built)

- **Tools** ([tools/routines_api.py](../services/agent/tools/routines_api.py)):
  - **`rt_format`:** the routine JSON format, fetched on demand to keep everyday chat cheap (decided).
  - **`rt_list`:** an on-demand tool; routines aren't summarised into every prompt (decided).
  - **`rt_save`:** creates a routine, or applies a partial update merged onto the saved routine.
  - **`rt_enable`, `rt_run`.**
  - **`rt_delete`:** needs `confirmed=true` after the user says yes (decided). Creating and editing happen directly, with a one-sentence read-back.
- **Names, not ids:** the model uses device and group names, and the tools translate both ways. Unknown names come back with the list of real ones.
- **Validation:** the gateway's 422 errors go back to the model so it can fix the JSON and retry.
- **Cost:** the six tool schemas add about 450 tokens to every chat message.

## 12. Migration and dependencies

- **Migration:** `b3e1d7a9c204` (down from `52850728036c`) adds both tables. It was hand-written rather than autogenerated, then verified with `alembic check` inside the new image before the containers were swapped. On the Pi it was applied with `docker compose run --rm -T --no-deps gateway sh -c "cd /app/shared && uv run --no-sync alembic upgrade head"`, after a `pg_dump` backup.
- **Dependency:** `astral` (gateway only). It's pure Python; on Windows it also pulls in `tzdata`.

## 13. What was built, by slice (all 2026-11-08)

- **Slice 0: groundwork.**
  - Built: `device_control`, ON/OFF reply check with one retry, `bus.broadcast`.
  - Skipped: the group-bug warm-up.
- **Slice 1:** tables, time triggers, device/group/delay actions, the time loop (advisory lock, interrupted cleanup, grace, catch-up), the run log, CRUD/enable/run/runs/preview, and the list and editor.
- **Slice 2:** sun triggers, all conditions, device triggers (edge, re-arm margin, cooldown, `for`, button presses), group checks, the failure badge, pruning and the attribute pickers.
- **Afterwards:** All/Any conditions, `NumberField`, and °F only.
- **Slice 3:** the internal agent endpoint, Spotify play/control with volume ramp, and native and stepped fades with colour temperature.
- **Slice 4:** the "Ask the agent" action (capped at 2 per hour), duplicate, the `rt_*` agent tools, and `fire_on_start`.

Each slice was checked with `compileall`, `npx tsc -b`, lint on the new files, local logic checks using fakes, and live checks on the Pi using throwaway `TEST …` routines that were deleted afterwards.

## 14. Resolved questions

1. **Does Run now apply conditions?** No.
2. **Does "Ask the agent" share chat history?** No. It uses no history at all.
3. **What if a routine's device is removed from the network?** The routine stays, the preview warns, and that action fails with "Device not found" when it runs.
4. **Run log retention?** 30 days, and 2 days for `skipped`.
5. **Maximum delay?** 12 h.
6. **Default fade method?** Native, with stepped available.
