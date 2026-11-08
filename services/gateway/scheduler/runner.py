"""Executes one run of a routine: each action in order, recording a step per action."""
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone

from core import device_control
from core.mqtt_bus import AsyncMqttBus
from scheduler import store
from scheduler.schema import DelayAction, DeviceAction, GroupAction, RoutineSpec

logger = logging.getLogger(__name__)


class StepFailed(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _device_name(bus: AsyncMqttBus, ieee: str) -> str:
    raw = await bus.redis.hget("gateway:digital_twin", ieee)
    if not raw:
        raise StepFailed("Device not found (was it removed from the network?)")
    return json.loads(raw).get("friendly_name", ieee)


async def _group_name(bus: AsyncMqttBus, group_id: int) -> str:
    raw = await bus.redis.get("gateway:groups")
    for g in json.loads(raw) if raw else []:
        if isinstance(g, dict) and g.get("id") == group_id:
            return g["friendly_name"]
    raise StepFailed(f"Group {group_id} not found (was it deleted?)")


async def _run_action(bus: AsyncMqttBus, action) -> dict:
    """Performs one action and returns its detail dict. Raises StepFailed with a readable message."""
    if isinstance(action, DelayAction):
        await asyncio.sleep(action.seconds)
        return {"seconds": action.seconds}

    payload = action.set.to_mqtt()
    try:
        if isinstance(action, DeviceAction):
            name = await _device_name(bus, action.device)
            result = await device_control.set_device(bus, action.device, payload)
            return {"device": name, "sent": payload, "confirmed_state": result.get("state")}
        if isinstance(action, GroupAction):
            name = await _group_name(bus, action.group)
            await device_control.set_group(bus, name, payload)
            return {"group": name, "sent": payload}
    except TimeoutError:
        raise StepFailed("Device did not confirm in time (offline or unresponsive?)")
    except (device_control.DeviceStateMismatch, device_control.MqttDisconnected) as e:
        raise StepFailed(str(e))
    raise StepFailed(f"Unknown action type {action.type}")


async def execute(bus: AsyncMqttBus, routine_id: uuid.UUID, name: str, run_id: uuid.UUID,
                  spec: RoutineSpec, is_stopping) -> str:
    """Runs every action, persisting progress after each step. Returns the final status."""
    steps: list[dict] = []
    status = "running"
    error = None
    bus.broadcast({"type": "routine_run", "routine_id": str(routine_id), "run_id": str(run_id), "status": status})

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
                step["detail"] = await _run_action(bus, action)
                step["status"] = "ok"
            except StepFailed as e:
                step["status"], step["error"] = "failed", str(e)
                stopped_early = action.stop_on_error
            except asyncio.CancelledError:
                step["status"] = "cancelled"
                raise
            except Exception as e:  # never let one action's bug take the run down silently
                logger.exception(f"Routine '{name}' action {action.id} crashed")
                step["status"], step["error"] = "failed", f"Internal error: {e}"
                stopped_early = action.stop_on_error
            finally:
                step["ms"] = int((time.monotonic() - t0) * 1000)
            await store.update_run(run_id, steps=steps)

        failures = sum(1 for s in steps if s["status"] == "failed")
        if stopped_early or (failures and failures == len(steps)):
            status = "failed"
        elif failures:
            status = "partial"
        else:
            status = "success"
        if failures:
            error = "; ".join(f"{s['id']}: {s['error']}" for s in steps if s["status"] == "failed")

    except asyncio.CancelledError:
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

    return status
