# UX review (2026-11-08)

A pass over the whole frontend (`services/gateway/frontend/src`), done by reading the code rather than clicking through the UI, so check each item on a phone before fixing it. Ordered by how much it hurts. Tick items off here as they land.

## Fix first: broken or misleading

- [x] **Realtime sockets never reconnect.** `useDevices` opens `/api/ws` once; after a deploy, Pi restart or phone sleep the dashboard silently shows stale state. The agent chat is the same, and its "Reconnecting..." placeholder is never true. Server side: `/api/ws` only sends on device changes, so a half-open socket looks alive forever; the agent WS proxy in `main.py` uses `gather`, so when the agent restarts the browser side stays open ("Online") with nothing behind it. *(Fixed 2026-11-08: `lib/reconnectingSocket.ts`, server keepalives, proxy teardown, reconnect banner; deployed and tested on the Pi.)*
- [x] **Phone bottom nav hid Settings and wasn't pinned.** Each tab laid icon and label side by side, so Settings was pushed off the right edge (x 385–482 on a 390 px screen). The outer layout only had a min-height, so `main` grew to the full device list, the whole page scrolled, and the nav sat at the end of the page. The draggable "Add Device" button then covered the nav. *(Fixed 2026-11-08: five equal stacked columns, definite `100dvh` layout, button anchored to `main`; checked with headless-Chrome renders at 360/390 px and desktop.)*
- [ ] **Failed commands are silent.** `sendCommand` ignores the response, so `device_control`'s 502/504 vanish. No pending state on toggles; rename and group add/remove give no feedback. Needs a pending state on the card plus an error toast.
- [x] **Settings has no padding and can't scroll.** `App.tsx` renders `<SettingsView />` straight into the `overflow-hidden` `<main>` without the `overflow-y-auto p-6` wrapper other tabs have. Its five sub-tabs also overflow horizontally on phones. *(Fixed 2026-11-08: padded scrolling wrapper; short sub-tab labels that scroll sideways.)*
- [x] **iOS zooms on every text field.** Inputs are `text-sm` (14px); Safari zooms on focus below 16px. Affects `routines/styles.ts` `input`, the chat box, settings, modals. Use `text-base` on mobile. *(Fixed 2026-11-08: one rule in `index.css` raises `text-sm`/`text-xs` fields to 16px on touch screens.)*
- [ ] **Light sliders.** 1px track under an invisible range input; commits only on `mouseup`/`touchend`, so keyboard changes never send (`ColorLightCard.tsx`). Use the shadcn Slider with `onValueCommit`.
- [ ] **Controls that do nothing.** "Power On Behavior" chips (`ColorLightCard.tsx`), firmware "Install" (`DeviceConfigDrawer.tsx`), the "Coming Soon" providers. The Admin tab is a placeholder (planned in todo.md); hide it until it has content.
- [ ] **Add Room width/height clamp on every keystroke** (`AddRoomModal.tsx`). Use `NumberField`.

## Home / devices

- [ ] Only the small power icon toggles; make the whole card the toggle and keep ⋯ for settings.
- [ ] Classification disagrees: `getDeviceCategory` checks lights first, `DeviceRenderer` checks sensors first, so a device with brightness and temperature sits under Lights but renders as a sensor card.
- [ ] Devices without `state` (remotes, motion/contact sensors) fall through to `BasicSwitchCard`, which shows a power button that sends `ON`, and their real readings (occupancy, contact, action) aren't shown.
- [ ] Battery and `last_seen` only appear in the drawer; add a low-battery / offline badge on the card.
- [ ] Home groups by device type although rooms exist. Grouping by room, with per-room and whole-house "All off", matches how it's used.
- [ ] Draggable "Add Device" FAB covers the last row of cards on phones; position isn't saved; the 254 s timeout isn't cleared; no "new device joined" feedback. Move to a header button with a countdown.
- [ ] Sort toggle shows on the Groups view where it does nothing; sort, view and sidebar-collapsed choices aren't persisted.
- [ ] No loading or empty state (blank before the first fetch, nothing for zero devices).
- [ ] Colour temp slider shows "Warmth %" (hard-coded 153–455 mired) while Routines uses Kelvin.

## Groups

- [ ] Manage modal Add/Remove has no pending state and refreshes ~1 s later, so a second tap undoes the first. The device list isn't sorted.
- [ ] No group brightness and no on/off state for the group.
- [ ] Tooltip "Create a new room or group" conflates groups with the Rooms tab.

## Agent chat

- [ ] Replies render as raw text; markdown shows literal `**` and `-`.
- [ ] Clear-history trash button sits next to Send with no label and no confirm.
- [ ] Switching tabs unmounts the chat and kills an in-flight reply; input is disabled while streaming.
- [ ] Voice auto-sends the transcript unreviewed; mic denial and transcription failure only log to the console; recording never stops if no speech is detected; uses `alert()`.
- [ ] Tool chips show raw names ("Spot Ctrl", "Rt Save"), always show a green check even on failure, and `JSON.parse(args)` can throw and crash the view (`ToolCallChip.tsx`).
- [ ] Empty state could offer suggestion chips.
- [ ] The agent's memory facts (`agent_settings.user_memory`) can't be seen or edited anywhere in Settings.

## Rooms

- [ ] The floor plan isn't a control surface: tapping a device only offers "Remove from room". Showing on/off on the icons and toggling with a tap is the main payoff of this tab.
- [ ] Placement needs "select a room, then click a device in the sidebar", otherwise a "Placement Error" modal. Drag from the sidebar or a "which room?" picker is easier.
- [ ] Rename is double-click only (no double-tap), so rooms can't be renamed on a phone. Rooms are always draggable, so panning on a phone moves them. Add a View/Edit toggle.
- [ ] On phones the device panel is a fixed `w-64` stacked under the canvas; use a bottom sheet. *(Partly fixed 2026-11-08: it took the full height and hid the floor plan completely; now a full-width strip of at most 40%. Also, the canvas was never measured because it mounts after the home check, so it stayed 1200×800 on every screen; found by `tests/layout`.)*
- [ ] Copy: "Autosaving soon..." rendered as a button; "F0" / "Floor 0" instead of `formatFloorName`; "Home Context Not Initialized" has no button to Settings → Home.

## Settings, login, shell

- [x] Jargon throughout: "Authenticate Dashboard Context", "Initialize", "Identity modifications pushed correctly", "Save Orchestrator Context", "Checking structural configuration context…". One plain-language pass. *(Done 2026-11-08: login, all Settings tabs, health popover, Rooms, delete/remove dialogs, chat empty state. The empty Admin tab is hidden.)*
- [ ] Registering doesn't sign you in.
- [ ] Spotify OAuth returns to the Home tab; the callback is only processed once Settings is opened (`SettingsView.tsx`), so linking looks like it failed. Disconnect has no confirm; "Connecting…" progress is styled as a green success.
- [ ] Home profile: only 7 US timezones; no feedback on whether the address geocoded (sun triggers depend on it); "Reset Configuration" uses `window.confirm` and doesn't warn that sun routines and Rooms break.
- [ ] The personal API key field is shown (disabled) even when the system key is selected.
- [ ] System health indicator is `hidden md:flex` and hover-only, so phones never see it. Messages are technical.
- [ ] Log out asks for confirmation in a warning-styled modal; unnecessary friction.

## Routines (in good shape)

- [ ] Device/group actions take colour temperature in mired (150–500); the fade action uses Kelvin (`ActionFields.tsx`).
- [ ] Closing the editor sheet discards unsaved edits without asking.
- [ ] Icon buttons and chips are ~28px, below a 44px touch target.

## Cross-cutting

- [ ] `focus:outline-none` everywhere (including nav) hides keyboard focus; use `focus-visible:ring`.
- [ ] Tooltips are hover-only (useless on touch) and icon buttons lack `aria-label`.
- [ ] ~8 hand-rolled modals: none close on Escape, none trap focus. Move to shadcn `Dialog` / `AlertDialog`, which also replaces the `window.confirm` calls.
- [ ] Every view invents its own status message. One toast system (shadcn `sonner`) would also serve the silent-failure item above.
- [ ] Tabs aren't in the URL: refresh always lands on Home, Back leaves the app, no deep links. A `#routines` hash is cheap.
- [ ] No PWA manifest and no `viewport-fit=cover` / safe-area padding, so the bottom nav can sit under the iPhone home indicator.

## Suggested order

1. Reconnection, Settings scroll, iOS zoom, then a toast system plus surfacing command failures.
2. Whole-card toggles and fixing the device-type routing.
3. The Rooms control surface.
