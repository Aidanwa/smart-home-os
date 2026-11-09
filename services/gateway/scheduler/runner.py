"""Executes one run of a routine: each action in order, recording a step per action.

Some actions keep working after they return (a non-waiting stepped fade, a volume ramp). Their
step shows 'running' while later actions go ahead; the run finishes once they're done, and
cancelling the run cancels them too."""
import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone

from core.mqtt_bus import AsyncMqttBus
from scheduler import alerts, store
from scheduler.actions import RunContext, StepFailed, finish_background, perform
from scheduler.schema import RoutineSpec

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def execute(bus: AsyncMqttBus, routine_id: uuid.UUID, name: str, run_id: uuid.UUID,
                  spec: RoutineSpec, owner_id, is_stopping) -> str:
    """Runs every action, persisting progress after each step. Returns the final status."""
    ctx = RunContext(bus=bus, owner_id=str(owner_id), routine_id=routine_id, routine_name=name)
    steps: list[dict] = []
    background: list[tuple[dict, asyncio.Task, float]] = []
    status = "running"
    error = None
    bus.broadcast({"type": "routine_run", "routine_id": str(routine_id), "run_id": str(run_id), "status": status})

    def fail(step: dict, e: Exception):
        step["status"], step["error"] = "failed", str(e)
        if isinstance(e, StepFailed) and e.detail:
            step["detail"] = e.detail

    try:
        stopped_early = False
        for action in spec.actions:
            if stopped_early:
                steps.append({"id": action.id, "type": action.type, "status": "skipped",
                              "detail": {"reason": "an earlier action failed with stop_on_error"}})
                continue

            step = {"id": action.id, "type": action.type, "started_at": _now().isoformat()}
            steps.append(step)
            t0 = time.monotonic()
            try:
                step["status"], step["detail"], rest = await perform(ctx, action)
                if rest is not None:
                    step["status"] = "running"
                    background.append((step, asyncio.create_task(finish_background(rest)), t0))
            except StepFailed as e:
                fail(step, e)
                stopped_early = action.stop_on_error
            except asyncio.CancelledError:
                step["status"] = "cancelled"
                raise
            except Exception as e:  # never let one action's bug take the run down silently
                logger.exception(f"Routine '{name}' action {action.id} crashed")
                fail(step, Exception(f"Internal error: {e}"))
                stopped_early = action.stop_on_error
            finally:
                step["ms"] = int((time.monotonic() - t0) * 1000)
            await store.update_run(run_id, steps=steps)

        for step, task, t0 in background:
            try:
                step["status"], step["detail"] = await task
            except StepFailed as e:
                fail(step, e)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception(f"Routine '{name}' background action {step['id']} crashed")
                fail(step, Exception(f"Internal error: {e}"))
            step["ms"] = int((time.monotonic() - t0) * 1000)
            await store.update_run(run_id, steps=steps)

        failures = sum(1 for s in steps if s["status"] == "failed")
        # an agent step skipped by its hourly cap means the routine didn't do everything asked
        partials = sum(1 for s in steps if s["status"] == "partial" or (s["type"] == "agent" and s["status"] == "skipped"))
        if stopped_early or (failures and failures == len(steps)):
            status = "failed"
        elif failures or partials:
            status = "partial"
        else:
            status = "success"
        if failures:
            error = "; ".join(f"{s['id']}: {s['error']}" for s in steps if s["status"] == "failed")

    except asyncio.CancelledError:
        for step, task, _ in background:
            task.cancel()
            if step.get("status") == "running":
                step["status"] = "cancelled"
        status = "interrupted" if is_stopping() else "cancelled"
        error = "Gateway shutting down" if status == "interrupted" else "Cancelled (restarted, disabled or deleted)"
        raise
    finally:
        finished = _now()
        try:
            await store.update_run(run_id, status=status, finished_at=finished, steps=steps, error=error)
            await store.set_last_run(routine_id, finished, status)
        except Exception:
            logger.exception(f"Failed to record the result of routine '{name}' run {run_id}")
        log = logger.info if status == "success" else logger.warning
        log(f"Routine '{name}' run {run_id} finished: {status}" + (f" ({error})" if error else ""))
        bus.broadcast({"type": "routine_run", "routine_id": str(routine_id), "run_id": str(run_id), "status": status})
        alerts.run_finished(owner_id, routine_id, name, status, error)

    return status
