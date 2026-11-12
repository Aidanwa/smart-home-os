"""The routine scheduler: one asyncio task inside the gateway (started in main.py's lifespan).

Everything here is derived state, rebuilt from Postgres at startup: the next fire time of each
time/sun trigger, the match state of each device trigger, and the active run per routine.
See the Routines section of CLAUDE.md.
"""
import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import text

from core.mqtt_bus import AsyncMqttBus
from shared.database.core import engine as db_engine
from shared.database.models import Routine
from scheduler import alerts, runner, store
from scheduler.actions import CallResult
from scheduler.matching import compare, device_reading, failing_condition, released
from core.rooms import ROOM_PREFIX
from scheduler.schema import EVENT_ATTRIBUTES, DeviceTrigger, RoomTrigger, RoutineSpec, SunTrigger, TimeTrigger
from scheduler.timing import Location, is_scheduled, next_fire, prev_fire

logger = logging.getLogger(__name__)

# Arbitrary but fixed: only the process holding this Postgres advisory lock schedules routines.
ADVISORY_LOCK_KEY = 7_142_813_001
MAX_SLEEP = 60          # re-check at least this often, so clock jumps (no RTC on the Pi) are noticed
MIN_LATE_SLACK = 30     # seconds of lateness always tolerated, even with grace_minutes = 0
PRUNE_HOUR = 4          # local hour for the nightly run-log prune

_UNSET = object()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def spec_from_row(row: Routine) -> RoutineSpec:
    return RoutineSpec.model_validate({
        "name": row.name, "description": row.description, "enabled": row.enabled,
        "mode": row.mode, "grace_minutes": row.grace_minutes,
        "triggers": row.triggers, "conditions": row.conditions, "actions": row.actions,
    })


def describe_trigger(trig) -> str:
    if isinstance(trig, TimeTrigger):
        return f"{trig.date} {trig.at}" if trig.date else trig.at
    if isinstance(trig, SunTrigger):
        return trig.event + (f" {trig.offset_min:+d} min" if trig.offset_min else "")
    if isinstance(trig, RoomTrigger):
        return f"room {trig.room} {trig.state}"
    return f"{trig.attribute} {trig.op} {trig.value}"


def watch_trigger(trig) -> DeviceTrigger | None:
    """The device trigger the engine evaluates for a trigger: device triggers as they are; a room
    trigger as one on the pseudo-device "room:<id>" reading `occupied` (fed by core/rooms.py)."""
    if isinstance(trig, DeviceTrigger):
        return trig
    if isinstance(trig, RoomTrigger):
        return DeviceTrigger(id=trig.id, type="device", device=f"{ROOM_PREFIX}{trig.room}", attribute="occupied",
                             op="eq", value=trig.state == "occupied", for_s=trig.for_s,
                             cooldown_s=trig.cooldown_s, fire_on_start=trig.fire_on_start)
    return None


@dataclass
class LoadedRoutine:
    id: uuid.UUID
    updated_at: datetime
    spec: RoutineSpec
    owner_id: uuid.UUID | None = None  # run-as user (Spotify account)
    watch: dict = field(default_factory=dict)  # trigger id -> DeviceTrigger evaluated for it (watch_trigger)

    @property
    def name(self) -> str:
        return self.spec.name

    def trigger(self, trigger_id: str):
        return next((t for t in self.spec.triggers if t.id == trigger_id), None)


@dataclass
class DeviceTriggerState:
    """Match state of one device trigger. `active` is the hysteretic 'currently matching' flag
    (None until the first reading); `last` is the previous value, for 'changes'."""
    active: bool | None = None
    last: object = _UNSET
    timer: asyncio.Task | None = None   # pending 'for' duration
    last_fired: float = field(default=float("-inf"))  # monotonic, for cooldown


class Scheduler:
    def __init__(self, bus: AsyncMqttBus):
        self.bus = bus
        self.tz = ZoneInfo("UTC")
        self.loc: Location = None
        self.active = False
        self._routines: dict[uuid.UUID, LoadedRoutine] = {}
        self._next: dict[tuple[uuid.UUID, str], datetime] = {}
        self._dev_index: dict[str, list[tuple[uuid.UUID, str]]] = {}   # ieee -> device trigger keys
        self._dev_state: dict[tuple[uuid.UUID, str], DeviceTriggerState] = {}
        self._runs: dict[uuid.UUID, asyncio.Task] = {}
        self._bg: set[asyncio.Task] = set()
        self._wake = asyncio.Event()
        self._loop_task: asyncio.Task | None = None
        self._event_task: asyncio.Task | None = None
        self._lock_conn = None
        self._stopping = False
        self._last_prune_date = None

    # ------------------------------------------------------------ lifecycle

    async def start(self):
        """Never raises: a scheduler problem must not stop the gateway from serving."""
        try:
            if not await self._acquire_lock():
                return
            interrupted = await store.mark_interrupted()
            if interrupted:
                logger.warning(f"Marked {interrupted} run(s) as interrupted by the last restart")
            await self._load_home()
            for row in await store.load_routines():
                self._ingest(row)
            self.active = True
            self._loop_task = asyncio.create_task(self._time_loop())
            self._event_task = asyncio.create_task(self._event_loop())
            logger.info(f"Scheduler started: {len(self._routines)} routine(s), timezone {self.tz.key}, "
                        f"location {'set' if self.loc else 'missing (no sun triggers)'}")
        except Exception:
            logger.exception("Scheduler failed to start; routines will not run until the gateway restarts")

    async def stop(self):
        self._stopping = True
        for t in (self._loop_task, self._event_task):
            if t:
                t.cancel()
        for t in list(self._bg):  # 'for' timers and runs still being started
            t.cancel()
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

    async def _load_home(self):
        name, self.loc = await store.load_home()
        try:
            self.tz = ZoneInfo(name)
        except Exception:
            logger.error(f"Invalid home timezone '{name}', scheduling in UTC")
            self.tz = ZoneInfo("UTC")

    # ------------------------------------------------------------ routine bookkeeping

    def _ingest(self, row: Routine):
        """Load (or replace) a routine: parse it, schedule its time/sun triggers, index its device
        triggers. Device trigger state starts empty and is seeded by the first reading."""
        self._forget(row.id)
        try:
            spec = spec_from_row(row)
        except ValidationError as e:
            logger.error(f"Routine '{row.name}' ({row.id}) is invalid and won't run: {e}")
            return
        r = LoadedRoutine(id=row.id, updated_at=row.updated_at, spec=spec, owner_id=row.owner_user_id)
        self._routines[row.id] = r
        if not spec.enabled:
            return
        now = _utcnow()
        for trig in spec.triggers:
            key = (r.id, trig.id)
            if is_scheduled(trig):
                t = next_fire(trig, now, self.tz, self.loc)
                if t:
                    self._next[key] = t
            elif (watched := watch_trigger(trig)) is not None:
                r.watch[trig.id] = watched
                self._dev_index.setdefault(watched.device, []).append(key)
                self._dev_state[key] = DeviceTriggerState()

    def _forget(self, routine_id: uuid.UUID):
        self._routines.pop(routine_id, None)
        for key in [k for k in self._next if k[0] == routine_id]:
            del self._next[key]
        for key in [k for k in self._dev_state if k[0] == routine_id]:
            st = self._dev_state.pop(key)
            if st.timer:
                st.timer.cancel()
        for ieee in list(self._dev_index):
            self._dev_index[ieee] = [k for k in self._dev_index[ieee] if k[0] != routine_id]
            if not self._dev_index[ieee]:
                del self._dev_index[ieee]

    async def _seed(self, routine_id: uuid.UUID):
        """Feed each device trigger the device's current reading, without firing."""
        r = self._routines.get(routine_id)
        if not r or not r.spec.enabled:
            return
        for trig in r.watch.values():  # device triggers, and room triggers as "room:<id>"
            state = await device_reading(self.bus, trig.device)
            if state and trig.attribute in state:
                self._evaluate(r, trig, state[trig.attribute], state.get("friendly_name", trig.device), seed=True)

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
            await self._seed(routine_id)
        self._wake.set()

    async def reload_all(self):
        """Call after the home timezone or location may have changed."""
        if not self.active:
            return
        await self._load_home()
        for rid in list(self._routines):
            self._forget(rid)
        for row in await store.load_routines():
            self._ingest(row)
        for rid in list(self._routines):
            await self._seed(rid)
        self._wake.set()

    # ------------------------------------------------------------ queries for the API

    def next_fire_at(self, routine_id: uuid.UUID) -> datetime | None:
        times = [t for (rid, _), t in self._next.items() if rid == routine_id]
        return min(times) if times else None

    def upcoming_all(self, until: datetime, limit: int = 300) -> list[dict]:
        """Every time/sun fire between now and `until` for enabled routines, soonest first.
        Conditions are checked only when a trigger fires, so some of these may end up skipped."""
        now = _utcnow()
        out = []
        for r in self._routines.values():
            if not r.spec.enabled:
                continue
            for trig in r.spec.triggers:
                if not is_scheduled(trig):
                    continue
                t = now
                for _ in range(100):
                    t = next_fire(trig, t, self.tz, self.loc)
                    if t is None or t > until:
                        break
                    out.append({"routine_id": str(r.id), "name": r.spec.name, "at": t,
                                "trigger": trig.model_dump(mode="json"),
                                "has_conditions": bool(r.spec.conditions)})
        out.sort(key=lambda x: x["at"])
        return out[:limit]

    def is_running(self, routine_id: uuid.UUID) -> bool:
        task = self._runs.get(routine_id)
        return bool(task and not task.done())

    async def run_now(self, routine_id: uuid.UUID) -> uuid.UUID | None:
        """Start a manual run (works for disabled routines too; conditions are not checked).
        None if blocked by mode=single."""
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

    async def call_routine(self, target_id: uuid.UUID, chain: tuple, caller_name: str,
                           check_conditions: bool) -> CallResult:
        """A routine action starting another routine (the action checks for loops first)."""
        r = self._routines.get(target_id)
        if r is None:
            raise LookupError("The routine to run no longer exists (or is invalid; see the gateway logs)")
        if not r.spec.enabled:
            return CallResult(r.name, reason=f"{r.name} is turned off")
        detail = {"called_by": caller_name, "caller_id": str(chain[-1]) if chain else None}
        return await self._try_start(r, "routine", detail=detail, check_conditions=check_conditions, chain=chain)

    async def _start_run(self, r: LoadedRoutine, trigger_type: str, trigger_id: str | None = None,
                         scheduled_for: datetime | None = None, late_seconds: int | None = None,
                         detail: dict | None = None) -> uuid.UUID | None:
        return (await self._try_start(r, trigger_type, trigger_id, scheduled_for, late_seconds, detail)).run_id

    async def _try_start(self, r: LoadedRoutine, trigger_type: str, trigger_id: str | None = None,
                         scheduled_for: datetime | None = None, late_seconds: int | None = None,
                         detail: dict | None = None, check_conditions: bool | None = None,
                         chain: tuple = ()) -> CallResult:
        """Starts a run, or says why it didn't. Conditions are checked for everything but Run now,
        unless check_conditions says otherwise."""
        now = _utcnow()
        detail = detail or {}
        if check_conditions is None:
            check_conditions = trigger_type != "manual"

        def skipped(reason: str):
            return store.create_run(
                routine_id=r.id, trigger_id=trigger_id, trigger_type=trigger_type, scheduled_for=scheduled_for,
                started_at=now, finished_at=now, status="skipped", trigger_detail={**detail, "reason": reason},
            )

        if check_conditions and r.spec.conditions:
            reason = await failing_condition(r.spec.conditions, self.bus, now, self.tz, self.loc)
            if reason:
                logger.info(f"Routine '{r.name}' skipped: {reason}")
                await skipped(reason)
                return CallResult(r.name, reason=f"its conditions weren't met ({reason})", expected=True)

        current = self._runs.get(r.id)
        if current and not current.done():
            if r.spec.mode == "single":
                if trigger_type != "manual":
                    await skipped("previous run still in progress (mode: single)")
                return CallResult(r.name, reason=f"{r.name} was already running (mode: single)")
            current.cancel()  # mode == restart
            await asyncio.wait([current], timeout=5)

        run_id = await store.create_run(
            routine_id=r.id, trigger_id=trigger_id, trigger_type=trigger_type, scheduled_for=scheduled_for,
            started_at=now, status="running", late_seconds=late_seconds, trigger_detail=detail,
        )
        if run_id is None:
            return CallResult(r.name, reason="this occurrence was already recorded")

        task = asyncio.create_task(runner.execute(self.bus, r.id, r.name, run_id, r.spec, r.owner_id,
                                                  lambda: self._stopping, chain=chain, call_routine=self.call_routine))
        self._runs[r.id] = task
        task.add_done_callback(lambda t, rid=r.id: self._run_done(rid, t))
        return CallResult(r.name, run_id=run_id, task=task)

    def _run_done(self, routine_id: uuid.UUID, task: asyncio.Task):
        if self._runs.get(routine_id) is task:
            del self._runs[routine_id]
        if not task.cancelled() and task.exception():
            logger.error(f"Routine run task crashed: {task.exception()!r}")

    def _spawn(self, coro):
        """Fire-and-forget from sync code, keeping a reference so the task isn't GC'd mid-flight."""
        task = asyncio.create_task(coro)
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)
        return task

    async def _fire_scheduled(self, r: LoadedRoutine, trig, scheduled_for: datetime, now: datetime):
        late = (now - scheduled_for).total_seconds()
        if late > max(r.spec.grace_minutes * 60, MIN_LATE_SLACK):
            logger.warning(f"Routine '{r.name}' missed its {describe_trigger(trig)} run "
                           f"({int(late)}s late, grace {r.spec.grace_minutes} min)")
            run_id = await store.create_run(
                routine_id=r.id, trigger_id=trig.id, trigger_type=trig.type, scheduled_for=scheduled_for,
                started_at=now, finished_at=now, status="missed", late_seconds=int(late),
                trigger_detail={"reason": f"{int(late)}s late, beyond the {r.spec.grace_minutes} min grace window"},
            )
            if run_id:
                await store.set_last_run(r.id, now, "missed")
                self.bus.broadcast({"type": "routine_run", "routine_id": str(r.id), "run_id": str(run_id), "status": "missed"})
                alerts.run_finished(r.owner_id, r.id, r.name, "missed")
            return
        await self._start_run(r, trig.type, trig.id, scheduled_for, int(late) if late >= 5 else None)

    # ------------------------------------------------------------ device triggers

    def _evaluate(self, r: LoadedRoutine, trig: DeviceTrigger, value, name: str, seed: bool):
        """Update one device trigger with a new reading and fire if it starts matching."""
        st = self._dev_state.get((r.id, trig.id))
        if st is None:
            return

        if trig.attribute in EVENT_ATTRIBUTES:  # button presses: every matching report counts
            if seed:
                return
            hit = value not in (None, "") if trig.op == "changes" else compare(trig.op, value, trig.value)
            if hit:
                self._fire_device(r, trig, st, value, name)
            return

        if trig.op == "changes":
            prev, st.last = st.last, value
            if not seed and prev is not _UNSET and prev != value:
                self._fire_device(r, trig, st, value, name, previous=prev)
            return

        matches = compare(trig.op, value, trig.value)
        if st.active is None or seed:
            # First reading: learn the state without firing. A state that already holds at
            # startup starts its 'for' clock now (conservative: fires late, never early).
            # fire_on_start opts in to firing on an already-true first reading (saved / restart).
            first = st.active is None  # the startup seed and a live report can both arrive first; fire once
            st.active = matches
            if matches and trig.for_s:
                self._start_for_timer(r, trig, st, value, name)
            elif matches and first and trig.fire_on_start:
                self._fire_device(r, trig, st, value, name, already_true=True)
            return
        if not st.active and matches:
            st.active = True
            if trig.for_s:
                self._start_for_timer(r, trig, st, value, name)
            else:
                self._fire_device(r, trig, st, value, name)
        elif st.active and released(trig.op, value, trig.value, trig.rearm):
            st.active = False
            if st.timer:
                st.timer.cancel()
                st.timer = None

    def _start_for_timer(self, r: LoadedRoutine, trig: DeviceTrigger, st: DeviceTriggerState, value, name: str):
        if st.timer and not st.timer.done():
            return

        async def wait_then_fire():
            await asyncio.sleep(trig.for_s)
            st.timer = None
            current = self._routines.get(r.id)
            if current is not None and st.active:
                self._fire_device(current, trig, st, value, name, held_s=trig.for_s)

        st.timer = self._spawn(wait_then_fire())

    def _fire_device(self, r: LoadedRoutine, trig: DeviceTrigger, st: DeviceTriggerState, value, name: str, **extra):
        now_m = time.monotonic()
        if now_m - st.last_fired < trig.cooldown_s:
            logger.debug(f"Routine '{r.name}' trigger {trig.id} in cooldown")
            return
        st.last_fired = now_m
        if trig.device.startswith(ROOM_PREFIX):
            detail = {"room": name, "occupied": value, **extra}
            logger.info(f"Routine '{r.name}' triggered by {name} {'occupied' if value else 'empty'}")
            self._spawn(self._start_run(r, "room", trig.id, detail=detail))
            return
        detail = {"device": name, "attribute": trig.attribute, "value": value, **extra}
        logger.info(f"Routine '{r.name}' triggered by {name} {trig.attribute}={value}")
        self._spawn(self._start_run(r, "device", trig.id, detail=detail))

    async def _event_loop(self):
        q = self.bus.subscribe()
        try:
            while True:
                msg = await q.get()
                if msg.get("type") not in ("device_update", "room_update"):
                    continue
                keys = self._dev_index.get(msg.get("device"))
                if not keys:
                    continue
                payload = msg.get("state") or {}
                try:
                    for rid, tid in list(keys):
                        r = self._routines.get(rid)
                        trig = r.watch.get(tid) if r else None
                        if trig is not None and trig.attribute in payload:
                            self._evaluate(r, trig, payload[trig.attribute], payload.get("friendly_name", trig.device), seed=False)
                except Exception:
                    logger.exception("Device trigger evaluation failed; continuing")
        finally:
            self.bus.unsubscribe(q)

    # ------------------------------------------------------------ time loop

    async def _catch_up(self):
        """At startup: an occurrence missed while we were down runs late (within grace) or is logged missed."""
        now = _utcnow()
        for r in list(self._routines.values()):
            if not r.spec.enabled:
                continue
            for trig in r.spec.triggers:
                if not is_scheduled(trig):
                    continue
                prev = prev_fire(trig, now, self.tz, self.loc)
                if not prev or prev < r.updated_at:  # didn't exist (in this form) back then
                    continue
                # A one-time trigger's date can be long past; its run row may be pruned by now.
                if getattr(trig, "date", None) is not None and now - prev > timedelta(days=1):
                    continue
                if await store.occurrence_recorded(r.id, trig.id, prev):
                    continue
                await self._fire_scheduled(r, trig, prev, now)

    async def _wait_for_mqtt(self, timeout: float = 15):
        waited = 0.0
        while not self.bus.client and waited < timeout:
            await asyncio.sleep(0.5)
            waited += 0.5

    async def _maybe_prune(self, now: datetime):
        local = now.astimezone(self.tz)
        if self._last_prune_date is not None and (local.date() == self._last_prune_date or local.hour < PRUNE_HOUR):
            return
        self._last_prune_date = local.date()
        removed = await store.prune_runs(now)
        if removed:
            logger.info(f"Pruned {removed} old routine run(s)")

    async def _time_loop(self):
        await self._wait_for_mqtt()
        try:
            for rid in list(self._routines):
                await self._seed(rid)
            await self._catch_up()
        except Exception:
            logger.exception("Scheduler startup catch-up failed")

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
                    nxt = next_fire(trig, now, self.tz, self.loc)  # from now: a clock jump yields one 'missed', not a burst
                    if nxt:
                        self._next[(rid, tid)] = nxt
                    else:
                        self._next.pop((rid, tid), None)
                    await self._fire_scheduled(r, trig, t, now)

                await self._maybe_prune(now)

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
