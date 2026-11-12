"""What each routine action does. perform() returns (status, detail, background) where background
is an optional coroutine the runner lets finish alongside later actions (a non-waiting stepped fade,
a volume ramp). Failures raise StepFailed with a readable message."""
import asyncio
import json
import math
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from core import device_control, push
from core.mqtt_bus import AsyncMqttBus
from scheduler import agent_client, store
from scheduler.schema import (AGENT_RUNS_PER_HOUR, MAX_CALL_DEPTH, AgentAction, DelayAction, DeviceAction, FadeAction,
                              GroupAction, NotifyAction, RoutineAction, SpotifyCtrlAction, SpotifyPlayAction)

GROUP_VERIFY_SECONDS = 3.0
# Manual-change detection for stepped fades. Bulbs report their in-between level during a
# transition and the final value arrives seconds late (Hue: ~5 s), so a report is only "someone
# changed it" if it's outside every level we sent in the last REPORT_LAG_S, by OVERRIDE_TOLERANCE.
# On a suspicious report the fade holds (sends nothing, so it can't overwrite a person's change)
# and checks again a step later; still off course -> it stops. A change to a level the fade has
# just passed through can't be told apart from lag, so that one isn't detected.
OVERRIDE_TOLERANCE = 10
REPORT_LAG_S = 7.0
MIN_STEP_SECONDS = 2.0
MIN_RAMP_STEP_SECONDS = 15.0  # be gentle with the Spotify API


class StepFailed(Exception):
    def __init__(self, message: str, detail: dict | None = None):
        super().__init__(message)
        self.detail = detail


@dataclass
class CallResult:
    """What Scheduler.call_routine did. run_id/task are set when a run started; otherwise `reason`
    says why not, and `expected` is true when that's a normal outcome (its conditions didn't pass)."""
    name: str
    run_id: uuid.UUID | None = None
    task: asyncio.Task | None = None
    reason: str | None = None
    expected: bool = False


@dataclass
class RunContext:
    bus: AsyncMqttBus
    owner_id: str  # whose Spotify account / LLM settings the routine uses
    routine_id: uuid.UUID | None = None
    routine_name: str = ""
    # Routines that led to this run, oldest first, ending with this one (routine actions).
    chain: tuple[uuid.UUID, ...] = ()
    # Scheduler.call_routine(target, chain, caller_name, check_conditions) -> CallResult
    call_routine: Callable[..., Awaitable[CallResult]] | None = None


# ------------------------------------------------------------------ helpers

async def _twin(bus: AsyncMqttBus, ieee: str) -> dict | None:
    raw = await bus.redis.hget("gateway:digital_twin", ieee)
    return json.loads(raw) if raw else None


async def _device_name(bus: AsyncMqttBus, ieee: str) -> str:
    st = await _twin(bus, ieee)
    if not st:
        raise StepFailed("Device not found (was it removed from the network?)")
    return st.get("friendly_name", ieee)


async def _group(bus: AsyncMqttBus, group_id: int) -> tuple[str, list[str]]:
    """The group's friendly_name and its members' IEEE addresses."""
    raw = await bus.redis.get("gateway:groups")
    for g in json.loads(raw) if raw else []:
        if isinstance(g, dict) and g.get("id") == group_id:
            members = [m["ieee_address"] for m in g.get("members", []) if m.get("ieee_address")]
            return g["friendly_name"], list(dict.fromkeys(members))
    raise StepFailed(f"Group {group_id} not found (was it deleted?)")


async def _members_not_following(bus: AsyncMqttBus, members: list[str], want: str) -> list[str]:
    """Group sets are fire-and-forget, so watch the twin briefly. Returns the names of members
    that still don't report `want` after GROUP_VERIFY_SECONDS (returns early once all do).
    Members that never report a state can't be checked and are left out."""
    deadline = time.monotonic() + GROUP_VERIFY_SECONDS
    while True:
        lagging = []
        for ieee in members:
            st = await _twin(bus, ieee) or {}
            if "state" in st and str(st["state"]).upper() != want:
                lagging.append(st.get("friendly_name", ieee))
        if not lagging or time.monotonic() >= deadline:
            return lagging
        await asyncio.sleep(0.5)


# ------------------------------------------------------------------ dispatch

async def perform(ctx: RunContext, action) -> tuple[str, dict, object]:
    try:
        if isinstance(action, DelayAction):
            await asyncio.sleep(action.seconds)
            return "ok", {"seconds": action.seconds}, None
        if isinstance(action, DeviceAction):
            return (*await _device(ctx, action), None)
        if isinstance(action, GroupAction):
            return (*await _group_set(ctx, action), None)
        if isinstance(action, FadeAction):
            return await _fade(ctx, action)
        if isinstance(action, SpotifyPlayAction):
            return await _spotify_play(ctx, action)
        if isinstance(action, SpotifyCtrlAction):
            return (*await _spotify_ctrl(ctx, action), None)
        if isinstance(action, AgentAction):
            return (*await _agent(ctx, action), None)
        if isinstance(action, NotifyAction):
            return (*await _notify(ctx, action), None)
        if isinstance(action, RoutineAction):
            return (*await _call_routine(ctx, action), None)
    except TimeoutError:
        raise StepFailed("Device did not confirm in time (offline or unresponsive?)")
    except (device_control.DeviceStateMismatch, device_control.MqttDisconnected, agent_client.AgentError) as e:
        raise StepFailed(str(e))
    raise StepFailed(f"Unknown action type {action.type}")


async def finish_background(coro) -> tuple[str, dict]:
    """Await a background part of an action, with the same error translation as perform()."""
    try:
        return await coro
    except TimeoutError:
        raise StepFailed("Device did not confirm in time (offline or unresponsive?)")
    except (device_control.DeviceStateMismatch, device_control.MqttDisconnected, agent_client.AgentError) as e:
        raise StepFailed(str(e))


# ------------------------------------------------------------------ device / group

async def _device(ctx: RunContext, a: DeviceAction):
    name = await _device_name(ctx.bus, a.device)
    payload = a.set.to_mqtt()
    result = await device_control.set_device(ctx.bus, a.device, payload)
    return "ok", {"device": name, "sent": payload, "confirmed_state": result.get("state")}


async def _group_set(ctx: RunContext, a: GroupAction):
    name, members = await _group(ctx.bus, a.group)
    payload = a.set.to_mqtt()
    await device_control.set_group(ctx.bus, name, payload)
    detail = {"group": name, "sent": payload}
    want = payload.get("state")
    if want not in ("ON", "OFF") or not members:
        return "ok", detail
    lagging = await _members_not_following(ctx.bus, members, want)
    if not lagging:
        return "ok", detail
    detail["did_not_follow"] = lagging
    if len(lagging) == len(members):
        raise StepFailed(f"No member of {name} reported {want}", detail)
    return "partial", detail


# ------------------------------------------------------------------ fade

@dataclass
class _FadeTarget:
    name: str
    send: object        # async (payload) -> None
    is_on: bool | None  # None = unknown (group with no reporting members)
    brightness: int | None
    color_temp: int | None
    overridden: object  # async (lo, hi) -> bool: is the reported level outside the plausible range?


async def _fade_target(ctx: RunContext, a: FadeAction) -> _FadeTarget:
    bus = ctx.bus
    if a.device is not None:
        st = await _twin(bus, a.device)
        if not st:
            raise StepFailed("Device not found (was it removed from the network?)")

        async def send(p):
            await device_control.set_device(bus, a.device, p, verify_state=False)

        async def overridden(lo, hi):
            now = await _twin(bus, a.device) or {}
            if str(now.get("state", "ON")).upper() == "OFF":
                return True
            b = now.get("brightness")
            return isinstance(b, (int, float)) and not (lo <= b <= hi)

        on = str(st.get("state", "")).upper() == "ON"
        return _FadeTarget(st.get("friendly_name", a.device), send, on,
                           st.get("brightness") if on else None, st.get("color_temp"), overridden)

    name, members = await _group(bus, a.group)
    states = [s for s in [await _twin(bus, m) for m in members] if s and "state" in s]
    lit = [s for s in states if str(s["state"]).upper() == "ON"]

    async def send(p):
        await device_control.set_group(bus, name, p)

    async def overridden(_lo, _hi):  # someone switched the whole group off
        now = [s for s in [await _twin(bus, m) for m in members] if s and "state" in s]
        return bool(now) and all(str(s["state"]).upper() == "OFF" for s in now)

    bright = [s["brightness"] for s in lit if isinstance(s.get("brightness"), (int, float))]
    temps = [s["color_temp"] for s in lit if isinstance(s.get("color_temp"), (int, float))]
    return _FadeTarget(name, send, (bool(lit) if states else None),
                       round(sum(bright) / len(bright)) if bright else None,
                       round(sum(temps) / len(temps)) if temps else None, overridden)


async def _fade(ctx: RunContext, a: FadeAction):
    t = await _fade_target(ctx, a)
    detail = {"target": t.name, "to_brightness": a.to_brightness, "duration_s": a.duration_s, "method": a.method}
    if a.to_color_temp:
        detail["to_color_temp"] = a.to_color_temp

    # Where it starts: an explicit 'from', else the current level, else 1 (it was off).
    b0 = a.from_brightness or t.brightness or 1
    ct0 = a.from_color_temp or t.color_temp or a.to_color_temp
    if a.from_brightness is not None or a.from_color_temp is not None or t.is_on is False:
        start = {"state": "ON", "brightness": b0}
        if a.from_color_temp:
            start["color_temp"] = a.from_color_temp
        await t.send(start)
        await asyncio.sleep(1.0)  # let the bulb settle before the transition begins

    if a.method == "native":
        final: dict = {"transition": a.duration_s}
        if a.to_brightness == 0:
            final["state"] = "OFF"
        else:
            final.update(state="ON", brightness=a.to_brightness)
            if a.to_color_temp:
                final["color_temp"] = a.to_color_temp
        await t.send(final)
        if a.wait:
            await asyncio.sleep(a.duration_s)
        return "ok", detail, None

    async def stepped():
        interval = max(MIN_STEP_SECONDS, a.duration_s / 50)
        n = max(1, round(a.duration_s / interval))
        last = b0
        sent = [(time.monotonic(), b0)]
        suspicious = False
        i = 1
        while i <= n:
            if i > 1:
                now = time.monotonic()
                window = [b for ts, b in sent if now - ts <= REPORT_LAG_S]
                window += [b for ts, b in sent if now - ts > REPORT_LAG_S][-1:]  # the transition still finishing
                lo, hi = min(window) - OVERRIDE_TOLERANCE, max(window) + OVERRIDE_TOLERANCE
                if await t.overridden(lo, hi):
                    if suspicious:
                        return "ok", {**detail, "stopped_early": f"someone changed the light (step {i - 1} of {n})"}
                    suspicious = True
                    await asyncio.sleep(interval)  # hold, don't overwrite it; look again next step
                    continue
                suspicious = False
            frac = i / n
            if i == n and a.to_brightness == 0:
                p = {"state": "OFF", "transition": interval}
            else:
                last = max(1, round(b0 + (a.to_brightness - b0) * frac))
                p = {"brightness": last, "transition": interval}
                if a.to_color_temp and ct0:
                    p["color_temp"] = round(ct0 + (a.to_color_temp - ct0) * frac)
            await t.send(p)
            sent.append((time.monotonic(), last))
            await asyncio.sleep(interval)
            i += 1
        return "ok", {**detail, "steps": n}

    if a.wait:
        status, d = await stepped()
        return status, d, None
    return "ok", {**detail, "background": True}, stepped()


# ------------------------------------------------------------------ Spotify (via the agent, as the owner)

async def _spotify_play(ctx: RunContext, a: SpotifyPlayAction):
    owner = ctx.owner_id

    async def ctrl(cmd, **kw):
        return await agent_client.call_tool(owner, "spot_ctrl", cmd=cmd, dev=a.speaker, **kw)

    async def attempt(cmd, **kw) -> bool:
        try:
            await ctrl(cmd, **kw)
            return True
        except agent_client.AgentError:
            return False

    # Set volume/shuffle first so the music doesn't start loud; an idle speaker may refuse
    # until it's playing, so those are retried after playback starts.
    vol_set = a.volume is not None and await attempt("volume", vol=a.volume)
    shuf_set = a.shuffle is not None and await attempt("shuffle", shuf=a.shuffle)

    kind = a.uri.split(":")[1]
    play_args = {"dev": a.speaker, "uris": [a.uri]} if kind in ("track", "episode") else {"dev": a.speaker, "ctx": a.uri}
    res = await agent_client.call_tool(owner, "spot_play", **play_args)

    detail = {"speaker": a.speaker, "playing": a.title or a.uri, "message": res.get("message")}
    if a.volume is not None and not vol_set:
        if not await attempt("volume", vol=a.volume):
            detail["note"] = "couldn't set the volume"
    if a.shuffle is not None and not shuf_set:
        await attempt("shuffle", shuf=a.shuffle)

    if a.ramp_to is None:
        return "ok", detail, None

    async def ramp():
        interval = max(MIN_RAMP_STEP_SECONDS, a.ramp_s / 20)
        n = max(1, round(a.ramp_s / interval))
        last = a.volume
        for i in range(1, n + 1):
            await asyncio.sleep(interval)
            player = (await agent_client.call_tool(owner, "spot_player")).get("data") or {}
            if not player.get("is_playing") or a.speaker.lower() not in (player.get("device") or "").lower():
                return "ok", {**detail, "ramp_stopped": "playback stopped or moved to another speaker", "volume": last}
            if isinstance(player.get("volume"), int) and abs(player["volume"] - last) > 3:
                return "ok", {**detail, "ramp_stopped": "volume was changed by hand", "volume": player["volume"]}
            last = round(a.volume + (a.ramp_to - a.volume) * i / n)
            await ctrl("volume", vol=last)
        return "ok", {**detail, "volume": last}

    return "ok", {**detail, "ramp": f"{a.volume}% → {a.ramp_to}% over {math.ceil(a.ramp_s / 60)} min"}, ramp()


async def _spotify_ctrl(ctx: RunContext, a: SpotifyCtrlAction):
    args = {"cmd": a.cmd, "dev": a.speaker}
    if a.volume is not None:
        args["vol"] = a.volume
    res = await agent_client.call_tool(ctx.owner_id, "spot_ctrl", **args)
    return "ok", {"speaker": a.speaker or "current device", "cmd": a.cmd, "message": res.get("message")}


# ------------------------------------------------------------------ ask the agent (LLM)

async def _agent(ctx: RunContext, a: AgentAction):
    if ctx.routine_id is not None:
        used = await store.count_agent_steps(ctx.routine_id, datetime.now(timezone.utc) - timedelta(hours=1))
        if used >= AGENT_RUNS_PER_HOUR:
            return "skipped", {"reason": f"limit reached: the agent runs at most {AGENT_RUNS_PER_HOUR}x per hour per routine"}
    res = await agent_client.run_agent(ctx.owner_id, a.prompt, ctx.routine_name, notify=a.notify is not None)
    detail = {"prompt": a.prompt, "reply": res.get("reply", ""), "tool_calls": res.get("tool_calls", [])}
    if res.get("status") != "success":
        raise StepFailed(res.get("message") or "The agent didn't finish", detail)
    if a.notify is None:
        return "ok", detail
    # The agent did its job; a delivery problem makes the step partial, not failed.
    reply = detail["reply"].strip()
    if not reply:
        detail["notify_error"] = "The agent's reply was empty, so nothing was sent"
        return "partial", detail
    users = [ctx.owner_id] if a.notify == "owner" else await push.users_with_devices()
    url = f"/#routines/history/{ctx.routine_id}" if ctx.routine_id else "/"
    sent = await push.send(users, ctx.routine_name or "Home", reply, url=url, urgency="high")
    detail["notified"] = {"to": a.notify, **sent}
    if sent["sent"] == 0:
        detail["notify_error"] = ("No device has notifications turned on" if sent["devices"] == 0
                                  else "The push service didn't accept the notification")
        return "partial", detail
    return "ok", detail


# ------------------------------------------------------------------ notifications

async def _notify(ctx: RunContext, a: NotifyAction):
    if not push.public_key():
        raise StepFailed("Notifications aren't set up on the hub (no VAPID key)")
    users = [ctx.owner_id] if a.to == "owner" else await push.users_with_devices()
    title = a.title or ctx.routine_name or "Home"
    result = await push.send(users, title, a.message, url="/", urgency="high")
    detail = {"to": a.to, "title": title, "message": a.message, **result}
    if result["devices"] == 0:
        who = "the routine's owner" if a.to == "owner" else "anyone"
        raise StepFailed(f"No device has notifications turned on for {who}", detail)
    if result["sent"] == 0:
        raise StepFailed("The push service didn't accept the notification", detail)
    return ("ok" if result["failed"] == 0 else "partial"), detail


# ------------------------------------------------------------------ run another routine

async def _call_routine(ctx: RunContext, a: RoutineAction):
    if ctx.call_routine is None:
        raise StepFailed("Routines can't be started from here")
    if a.routine in ctx.chain:
        raise StepFailed("This would loop: that routine is already running earlier in this chain of calls")
    if len(ctx.chain) >= MAX_CALL_DEPTH:
        raise StepFailed(f"Too many routines calling each other (at most {MAX_CALL_DEPTH} in a chain)")
    try:
        res = await ctx.call_routine(a.routine, ctx.chain, ctx.routine_name, a.check_conditions)
    except LookupError as e:
        raise StepFailed(str(e))
    detail = {"routine": res.name, "routine_id": str(a.routine), "wait": a.wait}
    if res.run_id is None:
        if res.expected:  # its conditions said no: that's the routine working as designed
            return "ok", {**detail, "note": f"Didn't run: {res.reason}"}
        return "skipped", {**detail, "reason": res.reason}
    detail["run_id"] = str(res.run_id)
    if not a.wait:
        return "ok", detail

    task = res.task
    try:
        await asyncio.wait([task])  # unlike `await task`, doesn't raise if that run is cancelled
    except asyncio.CancelledError:
        task.cancel()  # this run is being stopped: the run it's waiting on is part of it
        raise
    if task.cancelled():
        outcome = "cancelled"
    elif task.exception() is not None:
        outcome = "failed"
    else:
        outcome = task.result()
    detail["outcome"] = outcome
    if outcome == "success":
        return "ok", detail
    if outcome == "partial":
        return "partial", detail
    if outcome == "cancelled":
        raise StepFailed(f"{res.name} was cancelled before it finished (restarted, turned off or deleted)", detail)
    raise StepFailed(f"{res.name} {outcome}", detail)
