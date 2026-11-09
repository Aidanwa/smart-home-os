# UX review (2026-11-08, updated 2026-11-09)

A pass over the whole frontend (`services/gateway/frontend/src`), started by reading the code and since checked live in headless Chrome at phone and desktop sizes. Ordered by how much it hurts. Tick items off here as they land: `[x]` done, `[ ]` open, `[~]` won't do. **The open queue, ranked, is at the bottom ("What's next").**

## Fix first: broken or misleading

- [x] **Realtime sockets never reconnect.** `useDevices` opens `/api/ws` once; after a deploy, Pi restart or phone sleep the dashboard silently shows stale state. The agent chat is the same, and its "Reconnecting..." placeholder is never true. Server side: `/api/ws` only sends on device changes, so a half-open socket looks alive forever; the agent WS proxy in `main.py` uses `gather`, so when the agent restarts the browser side stays open ("Online") with nothing behind it. *(Fixed 2026-11-08: `lib/reconnectingSocket.ts`, server keepalives, proxy teardown, reconnect banner; deployed and tested on the Pi.)*
- [x] **Phone bottom nav hid Settings and wasn't pinned.** Each tab laid icon and label side by side, so Settings was pushed off the right edge (x 385–482 on a 390 px screen). The outer layout only had a min-height, so `main` grew to the full device list, the whole page scrolled, and the nav sat at the end of the page. The draggable "Add Device" button then covered the nav. *(Fixed 2026-11-08: five equal stacked columns, definite `100dvh` layout, button anchored to `main`; checked with headless-Chrome renders at 360/390 px and desktop.)*
- [x] **Failed commands are silent.** `sendCommand` ignores the response, so `device_control`'s 502/504 vanish. No pending state on toggles; rename and group add/remove give no feedback. Needs a pending state on the card plus an error toast. *(Fixed 2026-11-08: `lib/api.ts` `request()` toasts the hub's error via `sonner`; cards show a spinner and ignore taps while a command is in flight; rename, remove, pairing and every group action report failures.)*
- [x] **Settings has no padding and can't scroll.** `App.tsx` renders `<SettingsView />` straight into the `overflow-hidden` `<main>` without the `overflow-y-auto p-6` wrapper other tabs have. Its five sub-tabs also overflow horizontally on phones. *(Fixed 2026-11-08: padded scrolling wrapper; short sub-tab labels that scroll sideways.)*
- [x] **iOS zooms on every text field.** Inputs are `text-sm` (14px); Safari zooms on focus below 16px. Affects `routines/styles.ts` `input`, the chat box, settings, modals. Use `text-base` on mobile. *(Fixed 2026-11-08: one rule in `index.css` raises `text-sm`/`text-xs` fields to 16px on touch screens.)*
- [x] **Light sliders.** 1px track under an invisible range input; commits only on `mouseup`/`touchend`, so keyboard changes never send (`ColorLightCard.tsx`). Use the shadcn Slider with `onValueCommit`. *(Fixed 2026-11-08: Radix slider, 32px touch row, sends on release or key press, value shown beside it.)*
- [x] **Controls that do nothing.** "Power On Behavior" chips (`ColorLightCard.tsx`), firmware "Install" (`DeviceConfigDrawer.tsx`), the "Coming Soon" providers. The Admin tab is a placeholder (planned in todo.md); hide it until it has content. *(Fixed 2026-11-08: chips and Coming Soon options removed; Install became "Install from Zigbee2MQTT"; Admin hidden. 2026-11-09: Install now works from the device drawer, with a confirm, a progress bar and a toast when it finishes.)*
- [x] **Add Room width/height clamp on every keystroke** (`AddRoomModal.tsx`). Use `NumberField`. *(Done 2026-11-08.)*

## Home / devices

- [x] Only the small power icon toggles; make the whole card the toggle and keep ⋯ for settings. *(Done 2026-11-08.)*
- [x] Classification disagrees: `getDeviceCategory` checks lights first, `DeviceRenderer` checks sensors first, so a device with brightness and temperature sits under Lights but renders as a sensor card. *(Fixed 2026-11-08: one `getDeviceKind` in `lib/deviceUtils.ts` drives both.)*
- [x] Devices without `state` (remotes, motion/contact sensors) fall through to `BasicSwitchCard`, which shows a power button that sends `ON`, and their real readings (occupancy, contact, action) aren't shown. *(Fixed 2026-11-08: `SensorCard` (open/closed, motion, leak, temperature, tamper) and `RemoteCard` (last press); unknown devices get no power button.)*
- [ ] Battery and `last_seen` only appear in the drawer; add a low-battery / offline badge on the card. *(Low-battery badge done 2026-11-08; offline still open, Z2M doesn't publish `last_seen` here.)*
- [x] Home groups by device type although rooms exist. Grouping by room, with per-room and whole-house "All off", matches how it's used. *(Done 2026-11-09: a "By type / By room / A–Z" dropdown replaces the toggle; "Lights off" per section (no whole-house button, by choice), lights only (plugs may run a fridge or the router), with Undo.)*
- [x] Draggable "Add Device" FAB covers the last row of cards on phones; position isn't saved; the 254 s timeout isn't cleared; no "new device joined" feedback. Move to a header button with a countdown. *(Done 2026-11-08: `PairingButton` in the Home header, countdown from Z2M's `permit_join_end`, a toast per joined device.)*
- [x] Sort toggle shows on the Groups view where it does nothing; sort, view and sidebar-collapsed choices aren't persisted. *(Fixed 2026-11-08: hidden on Groups; sort and view remembered; A-Z now sorts by name, not IEEE address.)*
- [x] No loading or empty state (blank before the first fetch, nothing for zero devices). *(Done 2026-11-09: placeholder cards while loading, a retry if the hub doesn't answer, and a "No devices yet" card.)*
- [x] Colour temp slider shows "Warmth %" (hard-coded 153–455 mired) while Routines uses Kelvin. *(2026-11-09: everything is warmth % of each bulb's own range; the card shows just the number, e.g. "94%".)*
- [x] Waiting firmware updates are only visible inside each device's settings drawer. Add a small badge on the device card when `update.state` is `available` (and a progress hint while `updating`), so updates can be spotted without opening every device. (Logged 2026-11-09.) *(Done 2026-11-09: an "Update" / "Scheduled" / "42%" badge in the card's top row that opens the drawer. Not seen live yet: no device had an update waiting.)*

## Groups

- [x] Manage modal Add/Remove has no pending state and refreshes ~1 s later, so a second tap undoes the first. The device list isn't sorted. *(Fixed 2026-11-08: buttons say Adding…/Removing… until the list refreshes; sorted by name.)*
- [ ] No group brightness and no on/off state for the group.
- [x] Tooltip "Create a new room or group" conflates groups with the Rooms tab.

## Agent chat

- [x] Replies render as raw text; markdown shows literal `**` and `-`. *(Done 2026-11-09: `react-markdown` + `remark-gfm`, raw HTML ignored.)*
- [~] Clear-history trash button sits next to Send with no label and no confirm. *(Won't do, 2026-11-09: Aidan is happy with it as it is. It did get a screen-reader label.)*
- [x] Switching tabs unmounts the chat and kills an in-flight reply; input is disabled while streaming. *(Done 2026-11-09: the chat lives above the tabs, with a dot on Agent for a reply that arrived elsewhere; the agent finishes a reply even if the browser goes away and a reconnect picks it up; you can type while it answers, and Send becomes Stop.)*
- [ ] Voice auto-sends the transcript unreviewed; mic denial and transcription failure only log to the console; recording never stops if no speech is detected; uses `alert()`.
- [x] Tool chips show raw names ("Spot Ctrl", "Rt Save"), always show a green check even on failure, and `JSON.parse(args)` can throw and crash the view (`ToolCallChip.tsx`). *(Done 2026-11-09: plain-language labels, a red ✕ with the reason when a tool failed, also in reloaded history; bad arguments no longer crash it.)*
- [ ] Empty state could offer suggestion chips.
- [x] The agent's memory facts (`agent_settings.user_memory`) can't be seen or edited anywhere in Settings. *(Done 2026-11-09: Settings → Agent → "What the assistant remembers": edit, forget (with Undo), add; a save is refused if the agent changed the list meanwhile.)*

## Rooms

- [x] The floor plan isn't a control surface: tapping a device only offers "Remove from room". Showing on/off on the icons and toggling with a tap is the main payoff of this tab. *(Done 2026-11-09: in View mode a tap switches lights and plugs; icons glow when on and show a dashed ring while a command is in flight. Edit mode keeps "Remove from room".)*
- [ ] Placement needs "select a room, then tap a device in the list" (the error modal became a hint on 2026-11-08). Dragging onto the plan or a "which room?" picker would be easier. On phones the Devices sheet covers the plan, so picking a room means closing it first.
- [x] On a phone the plan is zoomed out, so device icons are small and names overlap where devices sit close together (Aidan's Bedroom). Bigger markers, or zoom to a room on tap. Rooms now reopens on the last floor viewed. *(Done 2026-11-09: in View mode a tap on a room zooms to it and "Whole floor" zooms back; markers keep at least 75% of their full size on screen; names that would overlap are hidden until you zoom in; markers packed too tightly to tap ignore taps, so the tap zooms the room instead of switching whatever light is under your finger.)*
- [x] Rename is double-click only (no double-tap), so rooms can't be renamed on a phone. Rooms are always draggable, so panning on a phone moves them. Add a View/Edit toggle. *(Done 2026-11-08: View/Edit toggle; only the selected room drags; double-tap renames.)*
- [x] On phones the device panel is a fixed `w-64` stacked under the canvas; use a bottom sheet. *(Done 2026-11-08: a "Devices" bottom sheet in Edit mode; the "pick a room first" error modal became a hint in the list. Along the way: the canvas was never measured because it mounts after the home check, so it stayed 1200×800 on every screen; found by `tests/layout`.)*
- [x] Copy: "Autosaving soon..." rendered as a button; "F0" / "Floor 0" instead of `formatFloorName`; "Home Context Not Initialized" has no button to Settings → Home.

## Settings, login, shell

- [x] Jargon throughout: "Authenticate Dashboard Context", "Initialize", "Identity modifications pushed correctly", "Save Orchestrator Context", "Checking structural configuration context…". One plain-language pass. *(Done 2026-11-08: login, all Settings tabs, health popover, Rooms, delete/remove dialogs, chat empty state. The empty Admin tab is hidden.)*
- [x] Registering doesn't sign you in. *(Fixed 2026-11-08.)*
- [x] ~~Spotify OAuth returns to the Home tab; the callback is only processed once Settings is opened (`SettingsView.tsx`), so linking looks like it failed.~~ (fixed with the URL tabs) Disconnect has no confirm; "Connecting…" progress is styled as a green success. *(Done 2026-11-09: Disconnect asks first and says what stops working; linking shows a spinner and a loading toast, then a success or error toast.)*
- [x] Home profile: only 7 US timezones; no feedback on whether the address geocoded (sun triggers depend on it); "Reset Configuration" uses `window.confirm` and doesn't warn that sun routines and Rooms break. *(Done 2026-11-09: every IANA timezone, shown read-only with "Set from your address" when the weather service supplied it; a line under the address says whether it was found and whether weather works (US only); a toast warns if a save couldn't find it; the reset dialog lists what stops working. The gateway used to re-geocode on every save, even a nickname change; now only when the address changes or the last lookup failed.)*
- [x] The personal API key field is shown (disabled) even when the system key is selected. *(Done 2026-11-09: it only appears when "Use the hub's API key" is off.)*
- [ ] System health indicator is `hidden md:flex` and hover-only, so phones never see it. Messages are technical.
- [x] Log out asks for confirmation in a warning-styled modal; unnecessary friction. *(Removed 2026-11-08.)*

## Routines

- [x] **Priority: organise the list.** All routines show in one unsorted, ungrouped list, which gets hard to scan past a handful. Ideas: group by room or by trigger type (time, sun, device), or user-made folders/tags; sort by name, next run or last run; a search box; collapse disabled routines into their own section; show the next run time on each row. (Logged 2026-11-09.) *(Done 2026-11-09: compact rows, search, group by when it runs / room / none, sort by next run / name / last run, "Needs attention" and a collapsed "Off" section, a "Next up" line; choices remembered per device. User-made tags/folders deferred: they need a schema change.)*
- [x] Device/group actions take colour temperature in mired (150–500); the fade action uses Kelvin (`ActionFields.tsx`). *(Fixed 2026-11-08: everything is mired underneath and shown as warmth %, scaled to each bulb's range, on cards, actions, fades, triggers and conditions.)*
- [x] Closing the editor sheet discards unsaved edits without asking. *(Fixed 2026-11-08: swipe/outside/Escape asks; Cancel still closes directly.)*
- [x] Icon buttons and chips are ~28px, below a 44px touch target. *(List rows fixed 2026-11-09: 44px switch, Run and ⋯ targets. Editor done the same day: chips, day buttons, move/remove icons, add buttons and the bottom row are 44px, checkbox rows 40px, and the shared Sheet ✕ is 40px.)*
- [ ] User-made tags or folders for routines. Deferred 2026-11-09: needs a new column and a migration (Aidan's OK).

## Cross-cutting

- [ ] `focus:outline-none` everywhere (including nav) hides keyboard focus; use `focus-visible:ring`.
- [ ] Tooltips are hover-only (useless on touch) and icon buttons lack `aria-label`.
- [x] ~8 hand-rolled modals: none close on Escape, none trap focus. Move to shadcn `Dialog` / `AlertDialog`, which also replaces the `window.confirm` calls. *(Done 2026-11-09: `components/ui/dialog.tsx` (Radix) with a `ConfirmDialog`; every modal and `window.confirm` uses it. Escape closes only the top one, so a confirm over the device drawer leaves the drawer open. Rooms' inline rename popover stays a popover; it already handled Escape.)*
- [x] Every view invents its own status message. One toast system (shadcn `sonner`) would also serve the silent-failure item above. *(`sonner` added 2026-11-08: device, group, pairing, firmware, Lights off, memory editor, and Routines' Run now / Duplicate use it. Still their own: the Settings forms' inline banners, Rooms' save state, and the routine editor's save errors.)* *(Done 2026-11-09: those are toasts now too. Rooms' saves used to fail silently (no status check; the error was never shown); a failure now toasts and the plan stays "Unsaved changes", so autosave retries. Form validation in the Add room dialog stays inline, beside the field.)*
- [x] Tabs aren't in the URL: refresh always lands on Home, Back leaves the app, no deep links. A `#routines` hash is cheap. *(Done 2026-11-08; the Spotify sign-in return now lands on Settings, so the callback runs.)*
- [ ] No PWA manifest and no `viewport-fit=cover` / safe-area padding, so the bottom nav can sit under the iPhone home indicator. *(Safe-area padding done 2026-11-08; manifest still open.)*

## Testing gaps

- [ ] `tests/layout` treats any `overflow: auto` box as a deliberate sideways scroller, and each tab's main area is one, so a row wider than the screen inside it passes. That's how the Routines long-name overflow (fixed 2026-11-09) got through. The check should only exempt boxes that are meant to scroll sideways.
- [ ] There's no checked-in interaction test. The 2026-11-09 batch was checked with a throwaway headless-Chrome driver (open each dialog, Escape/Cancel, measure touch targets, zoom a room) that's worth turning into `tests/ui`. **Careful in Rooms:** in View mode a synthetic tap that lands on a marker switches a real light, and routines can chain off it (it happened once: Lamp Off/Lamp On, restored at once). Hit-test first: `Konva.stages[0].getIntersection(point).name() === 'room-bg'`.
- [ ] Not seen live yet: the firmware badge (no device had an update waiting) and the Spotify Unlink confirm (the test user has no Spotify link).
- [ ] Chat's red ✕ for a failed tool call hasn't been seen live (the test prompts didn't make a tool fail). The logic is `tool_outcome` in `services/agent/core/orchestrator.py`, shared with routine runs.

## What's next (ranked, 2026-11-09, after the dialogs/toasts/Rooms batch)

1. Offline badge on cards: turn on `last_seen` in Z2M first (Home section).
2. Hub status on phones (Settings, login, shell).
3. Voice input fixes (Agent chat).
4. Groups: on/off state and brightness.
5. Rooms device placement by drag or picker.
6. Accessibility: focus rings, `aria-label`s, touch-friendly tooltips. Rooms' toolbar buttons are also still 28–32px.
7. PWA manifest.
8. Chat suggestion chips.
9. A never-pressed remote is classified as Other (`getDeviceKind` needs an `action` key, which Z2M only sends after a press; the exposes could tell instead).
10. Whether the agent should talk about colour temperature as warmth % (adds prompt tokens; Aidan's call).
11. Routine tags/folders (needs a migration).
12. Turn the throwaway interaction driver into `tests/ui` (Testing gaps).
