"""Push alerts to a routine's owner when a run fails, is missed, or only partly works.

Each outcome has its own toggle in the owner's ui_settings (PREF_KEYS), all off by default.
Alerts for one owner are gathered for a few seconds and sent as one notification, so a burst
(several misses found at startup) is one alert, not a stack. The same routine and outcome alerts
at most once an hour, so a device-triggered routine failing over and over doesn't spam the phone.
Never raises: alerting must not break the scheduler.
"""
import asyncio
import logging
import time
import uuid

from sqlalchemy import select

from shared.database.core import AsyncSessionLocal
from shared.database.models import UserPreference
from core import push

logger = logging.getLogger(__name__)

PREF_KEYS = {"failed": "notify_failed", "missed": "notify_missed", "partial": "notify_partial"}
VERBS = {"failed": "failed", "missed": "didn't run", "partial": "only partly worked"}
THROTTLE_S = 3600
GATHER_S = 5

_last_sent: dict[tuple[str, str], float] = {}
_pending: dict[str, list[tuple[str, str, str, str | None]]] = {}
_tasks: dict[str, asyncio.Task] = {}


def run_finished(owner_id, routine_id, name: str, status: str, error: str | None = None) -> None:
    """Called by the scheduler for every finished (or missed) run; most statuses are ignored."""
    if status not in PREF_KEYS or not push.public_key():
        return
    try:
        owner = str(owner_id)
        _pending.setdefault(owner, []).append((str(routine_id), name, status, error))
        if owner not in _tasks:
            _tasks[owner] = asyncio.create_task(_flush(owner))
    except Exception:
        logger.exception("Couldn't queue a routine alert")


async def _prefs(owner: str) -> dict:
    async with AsyncSessionLocal() as s:
        prefs = await s.scalar(select(UserPreference).where(UserPreference.user_id == uuid.UUID(owner)))
    return (prefs.ui_settings or {}) if prefs else {}


async def _flush(owner: str) -> None:
    try:
        await asyncio.sleep(GATHER_S)
        items = _pending.pop(owner, [])
        _tasks.pop(owner, None)
        settings = await _prefs(owner)
        now = time.monotonic()
        keep = []
        for rid, name, status, error in items:
            if not settings.get(PREF_KEYS[status]):
                continue
            if now - _last_sent.get((rid, status), -THROTTLE_S) < THROTTLE_S:
                continue
            _last_sent[(rid, status)] = now
            keep.append((rid, name, status, error))
        if not keep:
            return

        if len(keep) == 1:
            rid, name, status, error = keep[0]
            title = f"{name} {VERBS[status]}"
            body = {"missed": "The hub couldn't run it on time (it was down or busy)."}.get(status) or error or "Some steps didn't work."
            url, tag = f"/#routines/history/{rid}", f"routine-{rid}"
        else:
            title = f"{len(keep)} routines had problems"
            body = "; ".join(f"{name} {VERBS[status]}" for _, name, status, _ in keep)
            url, tag = "/#routines/activity", None

        result = await push.send([owner], title, body, url=url, tag=tag, urgency="high")
        if result["devices"] and not result["sent"]:
            logger.warning(f"Routine alert '{title}' wasn't delivered to any device")
    except Exception:
        logger.exception("Routine alert failed")
    finally:
        if _tasks.get(owner) is asyncio.current_task():  # not a newer gather that started meanwhile
            del _tasks[owner]
