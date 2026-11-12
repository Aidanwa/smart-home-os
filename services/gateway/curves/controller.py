"""Keeps the lights that follow a day curve on it.

Runs in the process that holds the scheduler's lock (started after it, `app.state.curves`), and
uses its home timezone and location. Once a minute it works out each following light's target
and sends what changed:

- Warmth goes to lights whether they're on or off: with the bulb's "execute if off" option (set
  when a light starts following) an off bulb stores it and comes on at it.
- Brightness goes only to lights that are on (setting it turns a light on), up or down.
- A plain "on" sent through the hub (app, routine, agent) gets the curve's brightness and warmth
  added (device_control's payload filter), so the light comes on at them. A light switched on
  any other way (wall switch, remote) is corrected as soon as it reports on.
- Lights in a Z2M group that all want the same thing get one group command.
- Commands are published directly, not through device_control, so they never count as someone
  changing the light by hand.

Pausing: warmth or brightness set through the hub (app, routine, agent; device_control's command hook) pauses
that light, and so does a report far from what the curve last sent (a remote, the Hue app). A
paused light is left alone until it reports off, then it follows again. Pauses live in Redis
(gateway:curve_paused) so a restart doesn't undo them.
"""
import asyncio
import json
import logging
import time as monotime
from datetime import datetime, timezone

from sqlalchemy import select

from core import device_control
from core.mqtt_bus import AsyncMqttBus
from curves.compute import FALLBACK_MIRED, brightness_to_254, next_changes, target, warmth_to_mired
from curves.schema import CurvePoint
from shared.database.core import AsyncSessionLocal
from shared.database.models import LightCurve, LightCurveMember

logger = logging.getLogger(__name__)

TICK_S = 60
PAUSED_KEY = "gateway:curve_paused"
MIRED_STEP = 2          # don't resend warmth for a change smaller than this
BRIGHTNESS_STEP = 3     # ... or brightness (of 254)
TRANSITION_S = 10       # soft change while a light is on
EXTERNAL_MIRED = 12     # a report this far from what we sent means someone else changed it
EXTERNAL_BRIGHTNESS = 15
REPORT_GRACE_S = 20     # bulbs report late and in-between values after our own command


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CurveController:
    def __init__(self, bus: AsyncMqttBus, scheduler):
        self.bus = bus
        self.scheduler = scheduler  # for tz / loc, and whether this process holds the lock
        self.active = False
        self.curves: dict[str, dict] = {}       # id -> {name, enabled, points: [CurvePoint]}
        self.members: dict[str, str] = {}       # ieee -> curve id
        self.paused: dict[str, dict] = {}       # ieee -> {since, reason}
        self.last_sent: dict[str, dict] = {}    # ieee -> {color_temp, at (monotonic)}
        self.last_state: dict[str, str] = {}    # ieee -> last reported ON/OFF
        self._loop_task: asyncio.Task | None = None
        self._event_task: asyncio.Task | None = None
        self._tick_lock = asyncio.Lock()

    # ------------------------------------------------------------ lifecycle

    async def start(self):
        """Never raises. Does nothing unless the scheduler is running in this process."""
        if not self.scheduler.active:
            return
        try:
            raw = await self.bus.redis.hgetall(PAUSED_KEY)
            self.paused = {k: json.loads(v) for k, v in raw.items()}
            await self._load()
            device_control.add_command_hook(self._on_command)
            device_control.add_payload_filter(self._on_payload)
            self.active = True
            self._loop_task = asyncio.create_task(self._loop())
            self._event_task = asyncio.create_task(self._events())
            logger.info(f"Day curves started: {len(self.curves)} curve(s), {len(self.members)} light(s)")
        except Exception:
            logger.exception("Day curves failed to start; lights won't follow them until the gateway restarts")

    async def stop(self):
        device_control.remove_command_hook(self._on_command)
        device_control.remove_payload_filter(self._on_payload)
        for t in (self._loop_task, self._event_task):
            if t:
                t.cancel()

    async def reload(self):
        """Call after a curve or membership changes. New followers get execute-if-off and an
        immediate update."""
        if not self.active:
            return
        before = set(self.members)
        await self._load()
        for ieee in set(self.members) - before:
            self.last_sent.pop(ieee, None)
            await self._enable_execute_if_off(ieee)
        for ieee in before - set(self.members):
            await self._unpause(ieee, broadcast=False)
        await self.tick()

    async def _load(self):
        async with AsyncSessionLocal() as s:
            curves = (await s.execute(select(LightCurve))).scalars().all()
            members = (await s.execute(select(LightCurveMember))).scalars().all()
        self.curves = {}
        for c in curves:
            try:
                points = [CurvePoint.model_validate(p) for p in c.points or []]
            except Exception as e:
                logger.error(f"Day curve '{c.name}' is invalid and won't run: {e}")
                continue
            self.curves[str(c.id)] = {"name": c.name, "enabled": c.enabled, "points": points}
        self.members = {m.ieee_address: str(m.curve_id) for m in members}

    # ------------------------------------------------------------ status (API)

    def status(self) -> dict:
        """{ieee: {curve_id, curve_name, paused, target, next}} for every following light."""
        tz, loc, now = self.scheduler.tz, self.scheduler.loc, _now()
        out = {}
        for ieee, cid in self.members.items():
            c = self.curves.get(cid)
            if not c:
                continue
            out[ieee] = {
                "curve_id": cid,
                "curve_name": c["name"],
                "enabled": c["enabled"],
                "paused": self.paused.get(ieee),
                "target": {k: (round(v) if v is not None else None) for k, v in target(c["points"], now, tz, loc).items()},
                "next": next_changes(c["points"], now, tz, loc),
            }
        return out

    async def resume(self, ieee: str):
        await self._unpause(ieee)
        self.last_sent.pop(ieee, None)
        await self.tick()

    # ------------------------------------------------------------ the minute loop

    async def _loop(self):
        while True:
            try:
                await self.tick()
            except Exception:
                logger.exception("Day curve tick failed; trying again next minute")
            await asyncio.sleep(TICK_S)

    async def _context(self) -> tuple[dict, list, dict]:
        """(exposes by ieee, groups, twin by ieee)."""
        exposes = json.loads(await self.bus.redis.get("gateway:device_exposes") or "{}")
        groups = json.loads(await self.bus.redis.get("gateway:groups") or "[]")
        twin = {k: json.loads(v) for k, v in (await self.bus.redis.hgetall("gateway:digital_twin")).items()
                if k in self.members}
        return exposes, groups, twin

    @staticmethod
    def _mired_range(props: list) -> tuple[int, int] | None:
        """This bulb's warmth range, or None if it has no colour temperature."""
        ct = next((p for p in props or [] if p.get("property") == "color_temp"), None)
        if ct is None:
            return None
        lo, hi = ct.get("value_min"), ct.get("value_max")
        return (lo, hi) if isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and hi > lo else FALLBACK_MIRED

    def _goal(self, ieee: str, exposes: dict) -> dict | None:
        """{color_temp?, brightness?} the curve wants for this light now (device units), or None
        if it doesn't follow an enabled curve or is paused."""
        c = self.curves.get(self.members.get(ieee, ""))
        if not c or not c["enabled"] or ieee in self.paused:
            return None
        goal = target(c["points"], _now(), self.scheduler.tz, self.scheduler.loc)
        props = exposes.get(ieee) or []
        rng = self._mired_range(props)
        out = {}
        if goal["warmth"] is not None and rng is not None:
            out["color_temp"] = warmth_to_mired(goal["warmth"], rng)
        if goal["brightness"] is not None and any(p.get("property") == "brightness" for p in props):
            out["brightness"] = brightness_to_254(goal["brightness"])
        return out

    def _wanted(self, ieee: str, exposes: dict, twin: dict, force: bool) -> dict | None:
        """The payload this light needs now (only what moved enough), or None."""
        goal = self._goal(ieee, exposes)
        if not goal:
            return None
        st = twin.get(ieee) or {}
        sent = self.last_sent.get(ieee) or {}
        payload = {}
        for key, step in (("color_temp", MIRED_STEP), ("brightness", BRIGHTNESS_STEP)):
            if key not in goal:
                continue
            if key == "brightness" and str(st.get("state", "")).upper() != "ON":
                continue  # setting brightness would turn it on
            v, last, reported = goal[key], sent.get(key), st.get(key)
            if force or (last is None and reported != v) or (last is not None and abs(v - last) >= step):
                payload[key] = v
        return payload or None

    async def tick(self, only: set[str] | None = None, force: bool = False):
        """Send every following light (or just `only`) what the curve wants now."""
        if not self.active:
            return
        async with self._tick_lock:
            exposes, groups, twin = await self._context()
            wanted = {}
            for ieee in (only or set(self.members)):
                p = self._wanted(ieee, exposes, twin, force)
                if p:
                    wanted[ieee] = p
            if not wanted:
                return
            # One group command where a whole group wants the same thing.
            for g in groups:
                ids = [m.get("ieee_address") for m in (g.get("members") or []) if isinstance(g, dict)]
                if len(ids) < 2 or not all(i in wanted for i in ids):
                    continue
                first = wanted[ids[0]]
                if any(wanted[i] != first for i in ids):
                    continue
                payload = {**first, "transition": TRANSITION_S}
                await self._publish(g.get("friendly_name") or str(g.get("id")), payload)
                for i in ids:
                    self._record(i, first)
                    del wanted[i]
            for ieee, p in wanted.items():
                name = (twin.get(ieee) or {}).get("friendly_name")
                if not name:
                    continue
                on = str((twin.get(ieee) or {}).get("state", "")).upper() == "ON"
                await self._publish(name, {**p, "transition": TRANSITION_S} if on else p)
                self._record(ieee, p)

    async def _publish(self, name: str, payload: dict):
        if not self.bus.client:
            return
        await self.bus.client.publish(f"{self.bus.z2m_base}/{name}/set", json.dumps(payload))
        logger.info(f"Day curve: {name} <- {payload}")

    def _record(self, ieee: str, payload: dict):
        entry = self.last_sent.setdefault(ieee, {})
        entry.update(payload)
        entry["at"] = monotime.monotonic()

    async def _enable_execute_if_off(self, ieee: str):
        """A follower stores warmth while off only with the bulb's execute-if-off option on."""
        exposes, _, twin = await self._context()
        st = twin.get(ieee) or {}
        if self._mired_range(exposes.get(ieee)) is None or (st.get("color_options") or {}).get("execute_if_off") is True:
            return
        if st.get("friendly_name"):
            await self._publish(st["friendly_name"], {"color_options": {"execute_if_off": True}})

    # ------------------------------------------------------------ pausing

    async def _pause(self, ieee: str, reason: str):
        if ieee in self.paused:
            return
        self.paused[ieee] = {"since": _now().isoformat(), "reason": reason}
        await self.bus.redis.hset(PAUSED_KEY, ieee, json.dumps(self.paused[ieee]))
        self.bus.broadcast({"type": "curve_update", "device": ieee})
        logger.info(f"Day curve paused for {ieee}: {reason}")

    async def _unpause(self, ieee: str, broadcast: bool = True):
        if self.paused.pop(ieee, None) is None:
            return
        await self.bus.redis.hdel(PAUSED_KEY, ieee)
        if broadcast:
            self.bus.broadcast({"type": "curve_update", "device": ieee})

    async def _on_command(self, ieees: list[str], payload: dict):
        """device_control hook: warmth or brightness set through the hub pauses those lights."""
        if "color_temp" not in payload and "brightness" not in payload:
            return
        for ieee in ieees:
            if ieee in self.members:
                await self._pause(ieee, "set")

    async def _on_payload(self, ieees: list[str], payload: dict) -> dict:
        """device_control filter: a plain "on" for following lights comes on at the curve. For a
        group, only when every member wants the same values (the rest are fixed on their report)."""
        if (not self.active or str(payload.get("state", "")).upper() != "ON"
                or "brightness" in payload or "color_temp" in payload or not ieees):
            return payload
        exposes = json.loads(await self.bus.redis.get("gateway:device_exposes") or "{}")
        goals = [self._goal(i, exposes) for i in ieees]
        if not goals[0] or any(g != goals[0] for g in goals):
            return payload
        for i in ieees:
            self._record(i, goals[0])
        return {**payload, **goals[0]}

    async def _events(self):
        q = self.bus.subscribe()
        try:
            while True:
                msg = await q.get()
                if msg.get("type") != "device_update" or msg.get("device") not in self.members:
                    continue
                try:
                    await self._on_report(msg["device"], msg.get("state") or {})
                except Exception:
                    logger.exception("Day curve report handling failed; continuing")
        finally:
            self.bus.unsubscribe(q)

    async def _on_report(self, ieee: str, st: dict):
        state = str(st.get("state", "")).upper()
        prev = self.last_state.get(ieee)
        if state:
            self.last_state[ieee] = state
        if state == "OFF":
            if ieee in self.paused:
                # Off ends a pause: store the curve's warmth for the next time it comes on.
                await self._unpause(ieee)
                self.last_sent.pop(ieee, None)
                await self.tick(only={ieee}, force=True)
            return
        if state != "ON" or ieee in self.paused:
            return
        if prev == "OFF":
            # Just switched on (any way, a wall switch included): make sure it's on the curve, in
            # case the bulb didn't store what was sent while it was off.
            await self.tick(only={ieee}, force=True)
            return
        sent = self.last_sent.get(ieee) or {}
        if monotime.monotonic() - sent.get("at", 0) <= REPORT_GRACE_S:
            return
        for key, limit in (("color_temp", EXTERNAL_MIRED), ("brightness", EXTERNAL_BRIGHTNESS)):
            now, last = st.get(key), sent.get(key)
            if isinstance(now, (int, float)) and isinstance(last, (int, float)) and abs(now - last) > limit:
                await self._pause(ieee, "external")
                return
