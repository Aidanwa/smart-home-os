"""When does a time trigger fire? All inputs/outputs are aware UTC datetimes; wall-clock times are
interpreted in the home timezone.

DST: a wall time that doesn't exist (spring forward, e.g. 02:30) is shifted forward by the gap
(runs at 03:30). A wall time that happens twice (fall back) runs once, at the first occurrence.
Both fall out of building the local datetime with fold=0 and converting to UTC.
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from scheduler.schema import DAYS, TimeTrigger


def _fire_on(trig: TimeTrigger, day: date, tz: ZoneInfo) -> datetime | None:
    if trig.days is not None and DAYS[day.weekday()] not in trig.days:
        return None
    hh, mm = map(int, trig.at.split(":"))
    return datetime.combine(day, time(hh, mm), tzinfo=tz).astimezone(timezone.utc)


def next_fire(trig: TimeTrigger, after: datetime, tz: ZoneInfo) -> datetime | None:
    """First fire time strictly after `after`."""
    start = after.astimezone(tz).date()
    for offset in range(9):
        t = _fire_on(trig, start + timedelta(days=offset), tz)
        if t and t > after:
            return t
    return None


def prev_fire(trig: TimeTrigger, at_or_before: datetime, tz: ZoneInfo) -> datetime | None:
    """Most recent fire time at or before `at_or_before`."""
    start = at_or_before.astimezone(tz).date()
    for offset in range(9):
        t = _fire_on(trig, start - timedelta(days=offset), tz)
        if t and t <= at_or_before:
            return t
    return None


def upcoming(triggers: list[TimeTrigger], after: datetime, tz: ZoneInfo, count: int = 5) -> list[datetime]:
    """The next `count` fire times across all triggers, merged and de-duplicated."""
    out: set[datetime] = set()
    for trig in triggers:
        t = after
        for _ in range(count):
            t = next_fire(trig, t, tz)
            if t is None:
                break
            out.add(t)
    return sorted(out)[:count]
