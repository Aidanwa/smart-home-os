"""When do time and sun triggers fire? All inputs/outputs are aware UTC datetimes; wall-clock
times are interpreted in the home timezone. Sun times come from astral (local maths, no network).

DST: a wall time that doesn't exist (spring forward, e.g. 02:30) is shifted forward by the gap
(runs at 03:30). A wall time that happens twice (fall back) runs once, at the first occurrence.
Both fall out of building the local datetime with fold=0 and converting to UTC.
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import sunrise, sunset

from scheduler.schema import DAYS, SunTrigger, TimeTrigger

Location = tuple[float, float] | None  # (latitude, longitude)


def sun_event(event: str, day: date, tz: ZoneInfo, loc: Location) -> datetime | None:
    """Sunrise/sunset on a local date, in UTC. None without a location, or if the sun doesn't
    rise/set that day (polar day/night)."""
    if loc is None:
        return None
    fn = sunrise if event == "sunrise" else sunset
    try:
        return fn(Observer(latitude=loc[0], longitude=loc[1]), date=day, tzinfo=tz).astimezone(timezone.utc)
    except ValueError:
        return None


def _fire_on(trig, day: date, tz: ZoneInfo, loc: Location) -> datetime | None:
    if trig.days is not None and DAYS[day.weekday()] not in trig.days:
        return None
    if isinstance(trig, TimeTrigger):
        hh, mm = map(int, trig.at.split(":"))
        return datetime.combine(day, time(hh, mm), tzinfo=tz).astimezone(timezone.utc)
    if isinstance(trig, SunTrigger):
        t = sun_event(trig.event, day, tz, loc)
        return t + timedelta(minutes=trig.offset_min) if t else None
    return None  # device triggers aren't scheduled


def is_scheduled(trig) -> bool:
    return isinstance(trig, (TimeTrigger, SunTrigger))


def next_fire(trig, after: datetime, tz: ZoneInfo, loc: Location = None) -> datetime | None:
    """First fire time strictly after `after`. Fire times only grow from one day to the next, so
    the first match is the earliest. (Starts a day early: a negative sun offset can cross midnight.)"""
    start = after.astimezone(tz).date()
    for offset in range(-1, 9):
        t = _fire_on(trig, start + timedelta(days=offset), tz, loc)
        if t and t > after:
            return t
    return None


def prev_fire(trig, at_or_before: datetime, tz: ZoneInfo, loc: Location = None) -> datetime | None:
    """Most recent fire time at or before `at_or_before`."""
    start = at_or_before.astimezone(tz).date()
    for offset in range(1, -9, -1):
        t = _fire_on(trig, start + timedelta(days=offset), tz, loc)
        if t and t <= at_or_before:
            return t
    return None


def upcoming(triggers: list, after: datetime, tz: ZoneInfo, loc: Location = None, count: int = 5) -> list[datetime]:
    """The next `count` fire times across all scheduled triggers, merged and de-duplicated."""
    out: set[datetime] = set()
    for trig in triggers:
        if not is_scheduled(trig):
            continue
        t = after
        for _ in range(count):
            t = next_fire(trig, t, tz, loc)
            if t is None:
                break
            out.add(t)
    return sorted(out)[:count]


def sun_is_up(now: datetime, tz: ZoneInfo, loc: Location) -> bool | None:
    today = now.astimezone(tz).date()
    rise, set_ = sun_event("sunrise", today, tz, loc), sun_event("sunset", today, tz, loc)
    if rise is None or set_ is None:
        return None
    return rise <= now < set_


def local_hhmm(now: datetime, tz: ZoneInfo) -> str:
    return now.astimezone(tz).strftime("%H:%M")
