# Roadmap and known issues

The one list of open work: features, bugs, and testing gaps. Finished work isn't kept here; git history has it, and the old frontend UX checklist (`docs/ux-review.md`, merged into this file on 2026-11-09) is in `git log -- docs/ux-review.md`.

Items marked **(migration)** need a database schema change, which needs Aidan's OK before it's applied on the Pi.

## Up next

### 1. Routine tags or folders (migration)

User-made labels for grouping routines beyond the built-in "when it runs" and "room" groupings, e.g. "Morning", "Away", "Kids". Needs a new column on `routines`, the list's group-by dropdown gaining "Tag", and a tag field in the editor (and in the agent's `rt_save`).

### 2. Routine starter templates

Starting points in the New routine flow: wake-up (fade lights in), sunset lamp, all off at bedtime.

## Known bugs

- **Group member removal sometimes uses the wrong group id** and the MQTT side logs an error. It works for the user, but it's noisy. Lead: `delete_group` only evicts members that have a `name` key, and only our own `add_group_member` writes one (Z2M's members carry `ieee_address`/`endpoint`).
- `GatewayClient.rename_group` in the agent sends `new_name` as a query parameter where the gateway expects a JSON body. It's unregistered dead code; fix it or delete it.

## Not yet confirmed working

Built, but nobody has seen it work for real yet:

- **The firmware update badge** on device cards ("Update", "Scheduled", "42%"). No device has had an update waiting.
- **Notifications** (built 2026-11-09): turning them on in the iPhone app, a test send, tapping one to open the app at the right page, routine failure/missed/partial alerts, the Notify action, and one-time reminders made by the agent ("remind me at 6 to take the bins out").

## Testing

- **`tests/ui`:** turn the throwaway headless-Chrome driver from 2026-11-09 into a checked-in test that opens each dialog, checks Escape and Cancel, and measures touch targets. It must never tap a device. In Rooms' View mode a tap on a marker switches a real light (and routines can chain off it), so hit-test first: `Konva.stages[0].getIntersection(point).name() === 'room-bg'`.
- **The `tests/layout` overflow blind spot:** any `overflow: auto` box counts as a deliberate sideways scroller, and each tab's main area is one, so a row wider than the screen *inside* a tab passes. That's how the Routines long-name overflow got through. Only exempt boxes that are meant to scroll sideways.

## Later, by area

### Routines

Ideas considered but not built:
- a stale-sensor guard ("no report from X for N hours");
- rate-of-change triggers ("humidity +10 in 10 min");
- webhook triggers;
- colour (`xy`/`hue`) in device actions;
- a run-as switch in the editor.

### Notifications

- A `notify` tool for "Ask the agent" routine runs ("every morning, summarise the weather and notify me").
- Message templates with live values ("Freezer is {temperature}°").
- The app icon badge (`setAppBadge`) for unseen routine problems.

### Assistant (agent)

- More LLM providers: Claude, Gemini, local Ollama (only OpenAI exists; `core/provider_factory.py`).
- A web search tool.
- Tell the agent which room each device is in (the Rooms floor plan already knows).
- Use the user's location, e.g. from their IP.
- Token tracking with cost analytics, and prices shown next to each model in Settings.
- Better prompting in general.

### Voice

- Edge devices around the house: always-listening wake word, with spoken replies (STT and TTS).
- Faster voice input over a WebSocket instead of one upload per recording.

### Devices and Zigbee

- Zigbee binding: pair a remote straight to a bulb so it works even if the hub is down.
- Scenes for groups and rooms.
- Power-on behaviour per bulb (what it does when power comes back). The old chips were removed because they did nothing; this would make them real.
- Automatic or scheduled firmware updates. Manual install from the device drawer already works.

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
