
# HIGH PRIORITY:

## Notifications (ntfy)

Routines are built (2026-11-08; see the Routines section of CLAUDE.md). The next step is push notifications via [ntfy](https://ntfy.sh): POST text to `https://<server>/<topic>` and the ntfy phone app shows it. It can be self-hosted as one small container on the Pi or used via ntfy.sh, and supports priority, tags and action buttons. On ntfy.sh the topic name is effectively the password, so use a long random topic or self-host with auth, and store it in `user_secrets`.

- Failure alerts: push `failed`/`missed` routine runs (today they only show as the red badge on the Routines tab).
- A `notify` routine action: "door left open 10 min → notify", "washer power < 5 W for 3 min → laundry done".
- Agent reminders: "remind me at 6 to take the bins out" becomes a routine with a notify action. The agent's routine tools currently say reminders aren't supported.

## Routines: smaller follow-ups

- Starter templates (wake-up, sunset lamp, all off).
- Ideas considered but not built: stale-sensor guard ("no report from X for N hours"), rate-of-change triggers ("humidity +10 in 10 min"), webhook triggers, colour (`xy`/`hue`) in device actions, a run-as switch in the editor.

## Admin controls (Settings > Admin page)

add admin account type with admin settings page that can edit all other users and permissions (no RBAC exists yet).

## Mobile UI and general UI bugs

Chat doesn't expand to full screen, margin at bottom.

Bottom bar doesn't show on mobile, need to scroll to see it.

Rooms canvas is unusable on mobile.

General UI bug sweep.

# BIG FEATURES:

## Adding agent logic

add more providers i.e. ollama, gemini, claude

improve prompting?

token tracking table and cost analytics - not that important right now

add pricing display for each model when selecting models.

Resolve user IP address and provide current user location to model.

Web search tool

## Voice input

Need to create edge node containers for wakeword listening and tts stt responses.

improve ui voice input to websocket instead of rest for faster processing.

## rooms

add sorting by room to devices page.

inform agent of device state by room organization

## Digital Wardrobe Management

create wardrobe table.

add option to import csv with wardrobe to mass add rows to table, or add individually in UI.

# SMALLER FEATURES:

Add zigbee binding devices options

add scene integration options to groups/rooms

add power on behavior adjustment

automatic hardware updates for devices, like actually a version updates for the lightbulbs or whatever

# KNOWN BUGS:

there is some issue with the group endpoints, it tries to remove the wrong group id, instead of using the actual id?
I tried to fix this but now it's sometimes crashing mqtt. Not really sure. it works well enough though to be a real issue, and can be addressed later. the functionality works for the user and my application handles the logic fine. it's just the mqtt that throws some error.