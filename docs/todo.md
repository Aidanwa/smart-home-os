# Roadmap and known issues

The one list of open work: features, bugs, and testing gaps. Finished work isn't kept here; git history has it

Items marked **(migration)** need a database schema change, which needs Aidan's OK before it's applied on the Pi.

## Up next

### 1. Routine tags or folders (migration)

User-made labels for grouping routines beyond the built-in "when it runs" and "room" groupings, e.g. "Morning", "Away", "Kids". Needs a new column on `routines`, the list's group-by dropdown gaining "Tag", and a tag field in the editor (and in the agent's `rt_save`).

## Not yet confirmed working

Built, but nobody has seen it work for real yet:

- **Notifications, the untested parts.** Confirmed so far: turning them on in the iPhone app, the test send, the Notify action, and Ask the agent replies. Not yet seen: the routine failed/missed/partial alerts, tapping one to open that routine's history, and one-time reminders made by the agent ("remind me at 6 to take the bins out").

## Testing

- **`tests/ui`:** turn the throwaway headless-Chrome driver from 2026-11-09 into a checked-in test that opens each dialog, checks Escape and Cancel, and measures touch targets. It must never tap a device. In Rooms' View mode a tap on a marker switches a real light (and routines can chain off it), so hit-test first: `Konva.stages[0].getIntersection(point).name() === 'room-bg'`.
- **The `tests/layout` overflow blind spot:** any `overflow: auto` box counts as a deliberate sideways scroller, and each tab's main area is one, so a row wider than the screen *inside* a tab passes. That's how the Routines long-name overflow got through. Only exempt boxes that are meant to scroll sideways.

## Later, by area

### Routines

Ideas considered but not built:
- a stale-sensor guard ("no report from X for N hours");
- rate-of-change triggers ("humidity +10 in 10 min");
- webhook triggers (also the way in for home/away, see Presence below);
- colour (`xy`/`hue`) in device actions;
- a run-as switch in the editor;
- a leaving-home / bedtime check: push "3 lights and the space heater are still on";
- vacation mode: lights on and off at randomized times around sunset while away.

### Sensor history (migration)

Today only the latest state is kept (Redis twin), so nothing has history. A readings table, downsampled to one row per sensor every ~5 min to spare the SD card, with pruning. Unlocks charts on device cards (temperature, humidity, CO₂, power), an energy-use view, and the stale-sensor and rate-of-change triggers above. The biggest single unlock on this list.

### Presence (home / away)

- Per-user home/away state set by an iPhone Shortcuts "Arrive"/"Leave" automation calling a webhook (test first that iOS runs it without a confirmation tap).
- An "anyone home" / "nobody home" routine condition and trigger, which the leaving-home check and vacation mode build on.

### Notifications

- Message templates with live values ("Freezer is {temperature}°").
- The app icon badge (`setAppBadge`) for unseen routine problems.
- **Tell me when the system goes down.** The hub can't send a push while it's offline (Pi off, power out, network down), so this has three parts:
  - *Fully down:* an outside "dead man's switch". The Pi pings a service such as healthchecks.io (free tier) every few minutes from cron; if the pings stop, that service alerts by email, ntfy or Pushover. The PC isn't always on, so it can't be the watcher. The ping URL is a secret and stays out of the repo. Worth doing before the first trip away; at home you notice an outage yourself within minutes. About 15 minutes, all outside the repo:
    1. healthchecks.io: one check, 5 min period, 10 min grace. Email alerts are on by default; add ntfy or Pushover for a phone push.
    2. On the Pi, `crontab -e`: `*/5 * * * * curl -fsS -m 10 --retry 3 https://hc-ping.com/<uuid> > /dev/null` (`-m` stops a hung network stacking up curls; `--retry` rides out blips).
    3. Test: comment the line out, wait past the grace period, confirm the alert arrives, restore it.
    - Optional stricter version: a `deploy/pi/heartbeat.sh` that checks `https://localhost:8000/api/system/status` first and pings `<url>/fail` if it's bad, with the URL in `/etc/smarthome-os.conf`. That overlaps with the partly-down push below; prefer the plain ping and leave gateway-level checks to the push.
  - *Partly down* (Zigbee2MQTT or MQTT stopped, agent unreachable, scheduler not running, no device reports for N minutes): the gateway is still up, so it can send a normal web push. `/api/system/status` already checks most of this. Alert after it's been bad for a few minutes, and again when it recovers.
  - *Back up:* on startup, push "Hub was offline from 02:10 to 02:45", using a last-alive timestamp written every minute (Redis or a small file).
- Note: iOS web push has no action buttons, so a tap (deep link) is the only interaction; don't design around buttons.

### Assistant (agent)

- More LLM providers: Claude, Gemini, local Ollama (only OpenAI exists; `core/provider_factory.py`).
- A web search tool.
- Use the user's location, e.g. from their IP.
- Token tracking with cost analytics, and prices shown next to each model in Settings.
- Better prompting in general.

### Voice

- Edge devices around the house: always-listening wake word, with spoken replies (STT and TTS).
- Faster voice input over a WebSocket instead of one upload per recording.
- "Hey Siri, ask the house…": an iPhone Shortcut sends the dictated text to the agent and Siri speaks the reply (phone, watch, CarPlay). Needs a long-lived, revocable personal API token separate from the cookie session.
- Cheapest edge device for the wake-word idea: a Pi Zero 2 W with a mic running openWakeWord, sending audio to the existing Whisper endpoint (ESP32-S3 boards expect Home Assistant's protocol).

### Devices and Zigbee

- Zigbee binding: pair a remote straight to a bulb so it works even if the hub is down.
- Scenes for groups and rooms.
- Power-on behaviour per bulb (what it does when power comes back). The old chips were removed because they did nothing; this would make them real.
- Automatic or scheduled firmware updates. Manual install from the device drawer already works.
- Device options in the drawer: render each device's `definition.options` from `bridge/devices` as inputs (plugs: `power_calibration`, `*_precision`, `state_action`; Hue bulbs: `transition`, `color_sync`; thermometer: `temperature_calibration` (in °F in the UI); Hue dimmer: `simulated_brightness`). Current values are in `bridge/info` → `config.devices[ieee]`; save with `bridge/request/device/options`.
- A collapsed "Zigbee details" section in the drawer, for debugging: network address, endpoints with input/output clusters, bindings, and configured reporting intervals (all in `bridge/devices` → `endpoints`; the gateway drops them today).
- Mesh info: a device's parent router and its neighbours' link LQI, from `bridge/request/networkmap`. It's slow (tens of seconds), so a "Scan network" button, not something that loads with the drawer.

- New device kinds in `getDeviceKind` and the routine editor, for when the hardware arrives: **cover** (blind/curtain motors: open, close, position) and **lock** (state, battery; unlocking from the agent or a routine must ask for confirmation, never happen silently).
- Buying note: IKEA's 2026 range is Matter over Thread, which Zigbee2MQTT can't pair. Check models on zigbee2mqtt.io before buying.

### Connections

- NWS active weather alerts → push to everyone (the home profile already stores the NWS grid).
- Calendar (ICS feed URL or Google Calendar): the agent can answer "what's on today"; a "workday" / "event soon" routine condition.
- Wake-on-LAN: "turn on my PC" from the agent or a routine.
- Pi-hole (already on the Pi): "pause ad blocking for 5 minutes" as an agent tool, plus blocked-query stats.
- TV control over local APIs (Roku ECP, LG, Samsung): pause, input, "movie mode".

### Users and admin

- An admin account type with a Settings → Admin page to manage other users and their permissions. There's no role system (RBAC) yet, and the Admin tab is hidden until this exists.

### Digital wardrobe

- A wardrobe table, filled one item at a time in the UI or in bulk from a CSV import.

## Decided against

Dropped on purpose (2026-11-09), so they don't come back:

- Chat suggestion chips in the empty chat.
- An offline badge on device cards (the low-battery badge stays).
- Placing devices in Rooms by dragging or with a room picker (the select-room-then-tap flow is fine).
- An accessibility pass: focus rings, `aria-label`s, touch tooltips, Rooms toolbar sizes.
- Classifying remotes that have never been pressed.
- Warmth % in the agent's prompt.
- A confirmation on chat's clear-history button.
