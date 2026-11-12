"""Device and group control shared by the HTTP routes and (later) the routine scheduler.

Raises plain exceptions; callers map them to HTTP codes or run-log results.
"""
import json
import logging

from core.mqtt_bus import AsyncMqttBus

logger = logging.getLogger(__name__)


class MqttDisconnected(RuntimeError):
    """The bus has no live MQTT client right now."""


class DeviceStateMismatch(RuntimeError):
    """The device replied, but its reported on/off state isn't the one requested."""


async def resolve_friendly_name(bus: AsyncMqttBus, device_id: str) -> str:
    """Accepts an IEEE address or a friendly_name and returns the friendly_name Z2M routes on."""
    target_ieee = bus._device_registry.get(device_id, device_id)
    raw_state_str = await bus.redis.hget("gateway:digital_twin", target_ieee)
    if raw_state_str:
        return json.loads(raw_state_str).get("friendly_name", device_id)
    return device_id


def _state_matches(requested: str | None, reply: dict) -> bool:
    """Only an explicit ON/OFF can be checked. TOGGLE, brightness and colour can't be matched
    reliably, and a reply that doesn't report `state` at all is given the benefit of the doubt."""
    if requested not in ("ON", "OFF"):
        return True
    reported = reply.get("state")
    return reported is None or str(reported).upper() == requested


async def set_device(bus: AsyncMqttBus, device_id: str, payload: dict, verify_state: bool = True) -> dict:
    """Publish a state change and return the device's confirmed state.

    The RPC resolves on the device's state publishes from any source. For an ON/OFF request it
    waits for a report with the requested state and skips the others: stale ones (a bulb's
    late report of the previous change, duplicated frames from the adapter, a wall-switch press)
    otherwise made a quick on-then-off look like a failure. With no matching report in time the
    command is sent once more; if that also times out and the device reports the other state,
    DeviceStateMismatch is raised.
    Raises TimeoutError if the device doesn't answer, MqttDisconnected if MQTT is down.
    verify_state=False skips the ON/OFF check (a long fade-to-off can still report ON mid-transition).
    """
    if not bus.client:
        raise MqttDisconnected("MQTT Bus is disconnected")

    friendly_name = await resolve_friendly_name(bus, device_id)
    topic = f"{bus.z2m_base}/{friendly_name}/set"
    requested = payload.get("state") if verify_state else None
    if requested not in ("ON", "OFF"):
        return await bus.rpc(topic, dict(payload))

    accept = lambda reply: _state_matches(requested, reply)  # noqa: E731
    try:
        return await bus.rpc(topic, dict(payload), accept=accept)
    except TimeoutError:
        logger.warning(f"'{friendly_name}' didn't report {requested} in time; sending once more")
    try:
        return await bus.rpc(topic, dict(payload), accept=accept)
    except TimeoutError:
        raw = await bus.redis.hget("gateway:digital_twin", bus._device_registry.get(friendly_name, friendly_name))
        reported = (json.loads(raw) if raw else {}).get("state")
        if reported is not None and str(reported).upper() != requested:
            raise DeviceStateMismatch(
                f"Device '{friendly_name}' reports state {reported} after being asked for {requested}."
            )
        raise


async def send_device(bus: AsyncMqttBus, device_id: str, payload: dict) -> None:
    """Fire-and-forget device command, for write-only settings the device never reports back."""
    if not bus.client:
        raise MqttDisconnected("MQTT Bus is disconnected")
    friendly_name = await resolve_friendly_name(bus, device_id)
    await bus.client.publish(f"{bus.z2m_base}/{friendly_name}/set", json.dumps(payload))


async def send_device_get(bus: AsyncMqttBus, device_id: str, payload: dict) -> None:
    """Ask a device to report these properties (Z2M /get); the answers arrive as state updates."""
    if not bus.client:
        raise MqttDisconnected("MQTT Bus is disconnected")
    friendly_name = await resolve_friendly_name(bus, device_id)
    await bus.client.publish(f"{bus.z2m_base}/{friendly_name}/get", json.dumps(payload))


async def set_group(bus: AsyncMqttBus, group_name: str, payload: dict) -> None:
    """Fire-and-forget group command; member updates trickle into the twin."""
    if not bus.client:
        raise MqttDisconnected("MQTT Bus is disconnected")
    await bus.client.publish(f"{bus.z2m_base}/{group_name}/set", json.dumps(payload))
