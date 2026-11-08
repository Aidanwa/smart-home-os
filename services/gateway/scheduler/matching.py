"""Value comparisons, the re-arm (hysteresis) rule, and condition checks."""
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from core.mqtt_bus import AsyncMqttBus
from scheduler.schema import DAYS, AnyCondition, DaysCondition, DeviceCondition, SunCondition, TimeWindowCondition
from scheduler.timing import Location, local_hhmm, sun_is_up


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def compare(op: str, actual, expected) -> bool:
    if op in ("eq", "ne"):
        if _is_number(actual) and _is_number(expected):
            same = float(actual) == float(expected)
        elif isinstance(actual, str) and isinstance(expected, str):
            same = actual.lower() == expected.lower()
        else:
            same = actual == expected
        return same if op == "eq" else not same
    if not (_is_number(actual) and _is_number(expected)):
        return False
    return {"gt": actual > expected, "gte": actual >= expected,
            "lt": actual < expected, "lte": actual <= expected}[op]


def released(op: str, actual, threshold, rearm: float | None) -> bool:
    """Has the value moved back far enough for a matched trigger to re-arm?
    'gt 65, rearm 3' releases at 62 or below; with no margin, as soon as it stops matching."""
    m = rearm or 0
    if op in ("gt", "gte"):
        return not compare(op, actual, threshold - m)
    if op in ("lt", "lte"):
        return not compare(op, actual, threshold + m)
    return not compare(op, actual, threshold)


async def device_reading(bus: AsyncMqttBus, ieee: str) -> dict | None:
    raw = await bus.redis.hget("gateway:digital_twin", ieee)
    return json.loads(raw) if raw else None


async def failing_condition(conditions: list, bus: AsyncMqttBus, now: datetime, tz: ZoneInfo, loc: Location) -> str | None:
    """None if every condition passes, else a readable reason for the first one that doesn't."""
    for i, c in enumerate(conditions, 1):
        reason = await _check(c, bus, now, tz, loc)
        if reason:
            return f"Condition {i} not met: {reason}"
    return None


async def _check(c, bus, now, tz, loc) -> str | None:
    if isinstance(c, AnyCondition):
        reasons = []
        for sub in c.conditions:
            reason = await _check(sub, bus, now, tz, loc)
            if reason is None:
                return None
            reasons.append(reason)
        return "none of these were true: " + "; ".join(reasons)
    if isinstance(c, TimeWindowCondition):
        t = local_hhmm(now, tz)
        inside = c.after <= t < c.before if c.after < c.before else (t >= c.after or t < c.before)
        return None if inside else f"it's {t}, outside {c.after}–{c.before}"
    if isinstance(c, DaysCondition):
        today = DAYS[now.astimezone(tz).weekday()]
        return None if today in c.days else f"today is {today}"
    if isinstance(c, SunCondition):
        up = sun_is_up(now, tz, loc)
        if up is None:
            return "no sun times (is the home location set?)"
        return None if (up == (c.state == "up")) else f"the sun is {'up' if up else 'down'}"
    if isinstance(c, DeviceCondition):
        state = await device_reading(bus, c.device)
        if state is None:
            return f"device {c.device} isn't on the network"
        name = state.get("friendly_name", c.device)
        if c.attribute not in state:
            return f"{name} hasn't reported {c.attribute}"
        actual = state[c.attribute]
        return None if compare(c.op, actual, c.value) else f"{name} {c.attribute} is {actual}"
    return f"unknown condition type {getattr(c, 'type', '?')}"
