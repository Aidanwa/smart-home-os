# iPhone Shortcuts: "Hey Siri, ask the house"

The hub accepts a personal API token in place of the browser's sign-in cookie, so an iPhone Shortcut can talk to the agent, run routines or switch devices. It works from the phone, the Apple Watch and CarPlay.

The hub is only reachable on the tailnet, so the phone needs Tailscale connected (the always-on VPN setting, or a "Connect Tailscale" action at the start of the Shortcut).

## 1. Make a token

Settings → Connections → API tokens → name it (e.g. "iPhone Shortcuts") → **Create token**, then copy it. It starts with `shos_` and is shown only once; if you lose it, revoke it and make another.

A token acts as you. It can do anything you can in the app except change your account or manage tokens. One token can serve all your Shortcuts. Revoking it stops them all at once.

## 2. "Ask the house" (talk to the agent)

New Shortcut, named **Ask the house** (Siri runs a Shortcut by its name):

1. **Dictate Text** (Stop Listening: After Pause).
2. **Get Contents of URL**
   - URL: `https://<pi-host>.<tailnet>.ts.net:8000/api/agent/chat`
   - Method: POST
   - Headers: `Authorization` = `Bearer shos_…` (your token)
   - Request Body: JSON, with `text` = *Dictated Text* and `voice` = *true* (Boolean)
3. **Get Dictionary Value**: `response` from *Contents of URL*.
4. **Speak Text**: *Dictionary Value*. (Or **Show Result**, which Siri also reads aloud.)

"Hey Siri, ask the house" then asks what you want to say. With `voice: true` the agent answers in one or two plain sentences. Chat history is shared with the app's chat for an hour, so a follow-up ("and the kitchen too") works.

A reply that uses several tools can take several seconds; the hub waits up to 90 s.

## 3. Instant buttons (no agent)

These call the hub's REST API directly: faster, free and predictable. Use them for widgets, the Action Button, Control Center, Back Tap, a Watch complication or an NFC tag. Each is one **Get Contents of URL** action with the same `Authorization` header.

| What | Method and path | JSON body |
|---|---|---|
| Run a routine now | `POST /api/routines/<id>/run` | none |
| Set a device | `POST /api/devices/<ieee or name>/set` | e.g. `{"state": "OFF"}` or `{"state": "ON", "brightness": 120}` |
| Set a group | `POST /api/groups/<name>/set` | same as a device |

Routine ids are in the routine's URL in the app (`#routines/history/<id>`).

## 4. Arrive / leave home (presence)

Your phone tells the hub when you get home and when you leave. Routines can then start on "someone comes home", "everyone has left" or a person arriving, and check "nobody is home". Settings → Presence shows everyone's state and lets you fix it by hand.

Two automations (Shortcuts → Automation → New):

1. **Arrive** → your home location → **Run Immediately**. One action, **Get Contents of URL**:
   - URL: `https://<pi-host>.<tailnet>.ts.net:8000/api/presence/me`
   - Method: POST, header `Authorization` = `Bearer shos_…`
   - Request Body: JSON, `state` = `home`
2. **Leave** → the same, with `state` = `away`.
3. Optional backup: **Wi-Fi** → joins your home network → the same request as Arrive, with `source` = `wifi` added to the body. Only for arriving: phones drop Wi-Fi when they sleep, so "leaves Wi-Fi" isn't a reliable signal for leaving.

Test each by tapping the automation's play button and watching Settings → Presence. Location automations are the ones iOS is most likely to ask about before running; if yours shows a confirmation, check that **Run Immediately** is selected and **Notify When Run** is off.

How it behaves:
- A repeat of the current state is ignored, so the Wi-Fi backup and the location automation can both fire without running anything twice.
- Only people whose phone reports count towards "anyone" and "everyone". Someone who never set this up isn't treated as away.
- The routine editor waits 5 minutes on "leaves" triggers by default, so a phone briefly crossing the edge of the home zone doesn't fire them.
- If a phone dies, its last state stays. Fix it in Settings → Presence; the phone takes over again on its next report.

## 5. Automations

Shortcuts → Automation can run any of the above with no tap, e.g.:

- **Alarm** "When my alarm is stopped" → run the morning routine.
- **Sleep Focus** turns on → run the bedtime routine.
- **CarPlay** connects → "on my way home" lights.
- **NFC** tag by the bed or door → run a routine.

Set each to **Run Immediately** where iOS offers it. Location (Arrive/Leave) automations are the ones most likely to ask for confirmation; test before relying on one.

## Troubleshooting

- **401 "API token not recognised"**: the token was revoked or mistyped. Check there's exactly one space after `Bearer`.
- **The request hangs or can't connect**: Tailscale isn't connected on the phone.
- **"Agent orchestration container unreachable"**: the agent is restarting (normal for ~40 s after a deploy).
