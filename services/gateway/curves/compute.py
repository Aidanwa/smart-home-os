"""What a curve asks for at a given moment. Pure functions; times are aware datetimes."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import noon as solar_noon

from curves.schema import CurvePoint
from scheduler.timing import Location, sun_event

FALLBACK_MIRED = (150, 500)  # for a bulb whose exposes don't say (the routine schema's limits)


def point_time(p: CurvePoint, day: date, tz: ZoneInfo, loc: Location) -> datetime | None:
    """When a point falls on a local date, in UTC. None for a sun point without a location."""
    w = p.when
    if w.type == "time":
        h, m = map(int, w.at.split(":"))
        return datetime.combine(day, time(h, m), tzinfo=tz).astimezone(timezone.utc)
    if loc is None:
        return None
    if w.event == "noon":
        t = solar_noon(Observer(latitude=loc[0], longitude=loc[1]), date=day, tzinfo=tz).astimezone(timezone.utc)
    else:
        t = sun_event(w.event, day, tz, loc)
    return t + timedelta(minutes=w.offset_min) if t else None


def _marks(points: list[CurvePoint], channel: str, around: datetime, tz: ZoneInfo, loc: Location):
    """Every (time, value) for one channel from yesterday to tomorrow, sorted, so the curve wraps."""
    today = around.astimezone(tz).date()
    marks = []
    for offset in (-1, 0, 1):
        day = today + timedelta(days=offset)
        for p in points:
            v = getattr(p, channel)
            if v is None:
                continue
            t = point_time(p, day, tz, loc)
            if t is not None:
                marks.append((t, v))
    marks.sort(key=lambda m: m[0])
    return marks


def channel_value(points: list[CurvePoint], channel: str, now: datetime, tz: ZoneInfo, loc: Location) -> float | None:
    """The channel's value at `now` (linear between the points around it), or None if no point sets it."""
    marks = _marks(points, channel, now, tz, loc)
    if not marks:
        return None
    before = [m for m in marks if m[0] <= now]
    after = [m for m in marks if m[0] > now]
    if not before or not after:
        return float((before or after)[-1 if before else 0][1])
    (t0, v0), (t1, v1) = before[-1], after[0]
    span = (t1 - t0).total_seconds()
    frac = (now - t0).total_seconds() / span if span > 0 else 1.0
    return v0 + (v1 - v0) * frac


def target(points: list[CurvePoint], now: datetime, tz: ZoneInfo, loc: Location) -> dict:
    """{"warmth": float|None, "brightness": float|None} (percent) at `now`."""
    return {ch: channel_value(points, ch, now, tz, loc) for ch in ("warmth", "brightness")}


def next_changes(points: list[CurvePoint], now: datetime, tz: ZoneInfo, loc: Location) -> dict:
    """{channel: {"at": iso, "value": pct}}: the next point where each channel heads somewhere new."""
    out = {}
    for ch in ("warmth", "brightness"):
        current = channel_value(points, ch, now, tz, loc)
        for t, v in _marks(points, ch, now, tz, loc):
            if t > now and current is not None and abs(v - current) >= 0.5:
                out[ch] = {"at": t.isoformat(), "value": v}
                break
    return out


def samples(points: list[CurvePoint], day: date, tz: ZoneInfo, loc: Location, step_min: int = 15) -> list[dict]:
    """The curve across one local day, for the editor's chart."""
    start = datetime.combine(day, time(0, 0), tzinfo=tz).astimezone(timezone.utc)
    out = []
    for i in range(0, 24 * 60 + 1, step_min):
        v = target(points, start + timedelta(minutes=i), tz, loc)
        out.append({"minute": i, **{k: (round(x, 1) if x is not None else None) for k, x in v.items()}})
    return out


def sun_times(day: date, tz: ZoneInfo, loc: Location) -> dict:
    """Local sunrise, solar noon and sunset (ISO) for the editor; empty without a location."""
    if loc is None:
        return {}
    out = {}
    for ev in ("sunrise", "noon", "sunset"):
        p = CurvePoint(id="x", when={"type": "sun", "event": ev}, warmth=0)
        t = point_time(p, day, tz, loc)
        if t:
            out[ev] = t.isoformat()
    return out


def warmth_to_mired(pct: float, rng: tuple[int, int]) -> int:
    lo, hi = rng
    return round(lo + max(0.0, min(100.0, pct)) / 100 * (hi - lo))


def brightness_to_254(pct: float) -> int:
    return max(1, min(254, round(pct / 100 * 254)))
