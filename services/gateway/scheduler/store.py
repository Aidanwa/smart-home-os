"""Database access for the scheduler. Each call uses its own short session."""
import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from shared.database.core import AsyncSessionLocal
from shared.database.models import Home, Routine, RoutineRun


async def load_timezone() -> str:
    async with AsyncSessionLocal() as s:
        home = await s.scalar(select(Home).limit(1))
        return home.timezone if home and home.timezone else "UTC"


async def load_routines() -> list[Routine]:
    async with AsyncSessionLocal() as s:
        return list((await s.scalars(select(Routine))).all())


async def load_routine(routine_id: uuid.UUID) -> Routine | None:
    async with AsyncSessionLocal() as s:
        return await s.get(Routine, routine_id)


async def mark_interrupted() -> int:
    """Runs still 'running' at startup were cut off by a restart."""
    async with AsyncSessionLocal() as s:
        res = await s.execute(
            update(RoutineRun)
            .where(RoutineRun.status == "running")
            .values(status="interrupted", finished_at=datetime.now().astimezone(), error="Gateway restarted mid-run")
        )
        await s.commit()
        return res.rowcount or 0


async def occurrence_recorded(routine_id: uuid.UUID, trigger_id: str, scheduled_for: datetime) -> bool:
    async with AsyncSessionLocal() as s:
        found = await s.scalar(
            select(RoutineRun.id).where(
                RoutineRun.routine_id == routine_id,
                RoutineRun.trigger_id == trigger_id,
                RoutineRun.scheduled_for == scheduled_for,
            )
        )
        return found is not None


async def create_run(**fields) -> uuid.UUID | None:
    """Insert a run row. Returns None if that scheduled occurrence is already recorded."""
    run = RoutineRun(**fields)
    async with AsyncSessionLocal() as s:
        s.add(run)
        try:
            await s.commit()
        except IntegrityError:
            await s.rollback()
            return None
        return run.id


async def update_run(run_id: uuid.UUID, **fields) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(update(RoutineRun).where(RoutineRun.id == run_id).values(**fields))
        await s.commit()


async def set_last_run(routine_id: uuid.UUID, at: datetime, status: str) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(
            update(Routine).where(Routine.id == routine_id)
            # Pin updated_at: it means "last edited", which catch-up relies on; onupdate would bump it.
            .values(last_run_at=at, last_run_status=status, updated_at=Routine.updated_at)
        )
        await s.commit()
