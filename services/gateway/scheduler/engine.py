"""The routine scheduler: one asyncio task inside the gateway (started in main.py's lifespan).

Everything here is derived state, rebuilt from Postgres at startup: the next fire time of each
time trigger, and the currently running run per routine. See docs/scheduler-proposal.md §2 and §4.
"""
import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import text

from core.mqtt_bus import AsyncMqttBus
from shared.database.core import engine as db_engine
from shared.database.models import Routine
from scheduler import runner, store
from scheduler.schema import RoutineSpec, TimeTrigger
from scheduler.timing import next_fire, prev_fire

logger = logging.getLogger(__name__)

# Arbitrary but fixed: only the process holding this Postgres advisory lock schedules routines.
ADVISORY_LOCK_KEY = 7_142_813_001
MAX_SLEEP = 60          # re-check at least this often, so clock jumps (no RTC on the Pi) are noticed
MIN_LATE_SLACK = 30     # seconds of lateness always tolerated, even with grace_minutes = 0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def spec_from_row(row: Routine) -> RoutineSpec:
    return RoutineSpec.model_validate({
        "name": row.name, "description": row.description, "enabled": row.enabled,
        "mode": row.mode, "grace_minutes": row.grace_minutes,
        "triggers": row.triggers, "conditions": row.conditions, "actions": row.actions,
    })


@dataclass
class LoadedRoutine:
    id: uuid.UUID
    updated_at: datetime
    spec: RoutineSpec

    @property
    def name(self) -> str:
        return self.spec.name

    def trigger(self, trigger_id: str) -> TimeTrigger | None:
        return next((t for t in self.spec.triggers if t.id == trigger_id), None)


class Scheduler:
    def __init__(self, bus: AsyncMqttBus):
        self.bus = bus
        self.tz = ZoneInfo("UTC")
        self.active = False
        self._routines: dict[uuid.UUID, LoadedRoutine] = {}
        self._next: dict[tuple[uuid.UUID, str], datetime] = {}
        self._runs: dict[uuid.UUID, asyncio.Task] = {}
        self._wake = asyncio.Event()
        self._loop_task: asyncio.Task | None = None
        self._lock_conn = None
        self._stopping = False

    # ------------------------------------------------------------ lifecycle

    async def start(self):
        """Never raises: a scheduler problem must not stop the gateway from serving."""
        try:
            if not await self._acquire_lock():
                return
            interrupted = await store.mark_interrupted()
            if interrupted:
                logger.warning(f"Marked {interrupted} run(s) as interrupted by the last restart")
            await self._load_timezone()
            for row in await store.load_routines():
                self._ingest(row)
            self.active = True
            self._loop_task = asyncio.create_task(self._time_loop())
            logger.info(f"Scheduler started: {len(self._routines)} routine(s), timezone {self.tz.key}")
        except Exception:
            logger.exception("Scheduler failed to start; routines will not run until the gateway restarts")

    async def stop(self):
        self._stopping = True
        if self._loop_task:
            self._loop_task.cancel()
        runs = [t for t in self._runs.values() if not t.done()]
        for t in runs:
            t.cancel()
        if runs:
            await asyncio.wait(runs, timeout=5)  # let them record 'interrupted'
        if self._lock_conn is not None:
            # Unlock explicitly: close() only returns the connection to the pool, lock still held.
            try:
                await self._lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADVISORY_LOCK_KEY})
                await self._lock_conn.commit()
            finally:
                await self._lock_conn.close()

    async def _acquire_lock(self) -> bool:
        conn = await db_engine.connect()
        got = (await conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": ADVISORY_LOCK_KEY})).scalar()
        await conn.commit()  # session-level lock survives the commit; don't sit idle in a transaction
        if not got:
            await conn.close()
            logger.error("Another process holds the scheduler lock; this gateway will NOT run routines")
            return False
        self._lock_conn = conn
        return True

    async def _load_timezone(self):
        name = await store.load_timezone()
        try:
            self.tz = ZoneInfo(name)
        except Exception:
            logger.error(f"Invalid home timezone '{name}', scheduling in UTC")
            self.tz = ZoneInfo("UTC")

    # ------------------------------------------------------------ routine bookkeeping

    def _ingest(self, row: Routine):
        try:
            spec = spec_from_row(row)
        except ValidationError as e:
            logger.error(f"Routine '{row.name}' ({row.id}) is invalid and won't run: {e}")
            self._forget(row.id)
            return
        self._routines[row.id] = LoadedRoutine(id=row.id, updated_at=row.updated_at, spec=spec)
        self._schedule(self._routines[row.id], _utcnow())

    def _schedule(self, r: LoadedRoutine, now: datetime):
        for key in [k for k in self._next if k[0] == r.id]:
            del self._next[key]
        if not r.spec.enabled:
            return
        for trig in r.spec.triggers:
            t = next_fire(trig, now, self.tz)
            if t:
                self._next[(r.id, trig.id)] = t

    def _forget(self, routine_id: uuid.UUID):
        self._routines.pop(routine_id, None)
        for key in [k for k in self._next if k[0] == routine_id]:
            del self._next[key]

    def _cancel_run(self, routine_id: uuid.UUID):
        task = self._runs.get(routine_id)
        if task and not task.done():
            task.cancel()

    async def reload(self, routine_id: uuid.UUID):
        """Call after a routine is created, edited, enabled/disabled or deleted."""
        if not self.active:
            return
        row = await store.load_routine(routine_id)
        was = self._routines.get(routine_id)
        # Deleting, or switching an enabled routine off, stops its current run. Editing doesn't
        # (a manual run of an already-disabled routine survives edits).
        if row is None or (not row.enabled and was is not None and was.spec.enabled):
            self._cancel_run(routine_id)
        if row is None:
            self._forget(routine_id)
        else:
            self._ingest(row)
        self._wake.set()

    async def reload_all(self):
        """Call after the home timezone may have changed."""
        if not self.active:
            return
        await self._load_timezone()
        self._routines.clear()
        self._next.clear()
        for row in await store.load_routines():
            self._ingest(row)
        self._wake.set()

    # ------------------------------------------------------------ queries for the API

    def next_fire_at(self, routine_id: uuid.UUID) -> datetime | None:
        times = [t for (rid, _), t in self._next.items() if rid == routine_id]
        return min(times) if times else None

    def is_running(self, routine_id: uuid.UUID) -> bool:
        task = self._runs.get(routine_id)
        return bool(task and not task.done())

    async def run_now(self, routine_id: uuid.UUID) -> uuid.UUID | None:
        """Start a manual run (works for disabled routines too). None if blocked by mode=single."""
        if not self.active:
            raise RuntimeError("The scheduler isn't running (see gateway logs)")
        r = self._routines.get(routine_id)
        if r is None:
            await self.reload(routine_id)
            r = self._routines.get(routine_id)
        if r is None:
            raise LookupError("Routine not found or invalid")
        return await self._start_run(r, trigger_type="manual")

    # ------------------------------------------------------------ firing

    async def _start_run(self, r: LoadedRoutine, trigger_type: str, trigger_id: str | None = None,
                         scheduled_for: datetime | None = None, late_seconds: int | None = None) -> uuid.UUID | None:
        now = _utcnow()
        current = self._runs.get(r.id)
        if current and not current.done():
            if r.spec.mode == "single":
                if scheduled_for:  # record it, so the occurrence isn't caught up later either
                    await store.create_run(
                        routine_id=r.id, trigger_id=trigger_id, trigger_type=trigger_type,
                        scheduled_for=scheduled_for, started_at=now, finished_at=now, status="skipped",
                        trigger_detail={"reason": "previous run still in progress (mode: single)"},
                    )
                return None
            current.cancel()  # mode == restart
            await asyncio.wait([current], timeout=5)

        run_id = await store.create_run(
            routine_id=r.id, trigger_id=trigger_id, trigger_type=trigger_type, scheduled_for=scheduled_for,
            started_at=now, status="running", late_seconds=late_seconds,
        )
        if run_id is None:
            return None  # this occurrence was already recorded

        task = asyncio.create_task(runner.execute(self.bus, r.id, r.name, run_id, r.spec, lambda: self._stopping))
        self._runs[r.id] = task
        task.add_done_callback(lambda t, rid=r.id: self._run_done(rid, t))
        return run_id

    def _run_done(self, routine_id: uuid.UUID, task: asyncio.Task):
        if self._runs.get(routine_id) is task:
            del self._runs[routine_id]
        if not task.cancelled() and task.exception():
            logger.error(f"Routine run task crashed: {task.exception()!r}")

    async def _fire_scheduled(self, r: LoadedRoutine, trig: TimeTrigger, scheduled_for: datetime, now: datetime):
        late = (now - scheduled_for).total_seconds()
        if late > max(r.spec.grace_minutes * 60, MIN_LATE_SLACK):
            logger.warning(f"Routine '{r.name}' missed its {trig.at} run ({int(late)}s late, grace {r.spec.grace_minutes} min)")
            run_id = await store.create_run(
                routine_id=r.id, trigger_id=trig.id, trigger_type="time", scheduled_for=scheduled_for,
                started_at=now, finished_at=now, status="missed", late_seconds=int(late),
                trigger_detail={"reason": f"{int(late)}s late, beyond the {r.spec.grace_minutes} min grace window"},
            )
            if run_id:
                await store.set_last_run(r.id, now, "missed")
                self.bus.broadcast({"type": "routine_run", "routine_id": str(r.id), "run_id": str(run_id), "status": "missed"})
            return
        await self._start_run(r, "time", trig.id, scheduled_for, int(late) if late >= 5 else None)

    async def _catch_up(self):
        """At startup: an occurrence missed while we were down runs late (within grace) or is logged missed."""
        now = _utcnow()
        for r in list(self._routines.values()):
            if not r.spec.enabled:
                continue
            for trig in r.spec.triggers:
                prev = prev_fire(trig, now, self.tz)
                if not prev or prev < r.updated_at:  # didn't exist (in this form) back then
                    continue
                if await store.occurrence_recorded(r.id, trig.id, prev):
                    continue
                await self._fire_scheduled(r, trig, prev, now)

    async def _wait_for_mqtt(self, timeout: float = 15):
        waited = 0.0
        while not self.bus.client and waited < timeout:
            await asyncio.sleep(0.5)
            waited += 0.5

    async def _time_loop(self):
        await self._wait_for_mqtt()
        try:
            await self._catch_up()
        except Exception:
            logger.exception("Scheduler catch-up failed")

        while True:
            try:
                self._wake.clear()
                now = _utcnow()
                for (rid, tid), t in sorted(self._next.items(), key=lambda kv: kv[1]):
                    if t > now:
                        break
                    r = self._routines.get(rid)
                    trig = r.trigger(tid) if r else None
                    if trig is None:
                        self._next.pop((rid, tid), None)
                        continue
                    nxt = next_fire(trig, now, self.tz)  # schedule from now: a clock jump yields one 'missed', not a burst
                    if nxt:
                        self._next[(rid, tid)] = nxt
                    else:
                        self._next.pop((rid, tid), None)
                    await self._fire_scheduled(r, trig, t, now)

                soonest = min(self._next.values(), default=None)
                timeout = MAX_SLEEP if soonest is None else min(MAX_SLEEP, max(0.0, (soonest - _utcnow()).total_seconds()))
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=timeout)
                except asyncio.TimeoutError:
                    pass
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Scheduler loop error; continuing")
                await asyncio.sleep(5)
