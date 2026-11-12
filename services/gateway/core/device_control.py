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

    The RPC resolves on the device's next state publish from any source, so a stale or
    unrelated publish can arrive first. If an ON/OFF request comes back with the wrong state,
    the command is sent once more; a second mismatch raises DeviceStateMismatch.
    Raises TimeoutError if the device doesn't answer, MqttDisconnected if MQTT is down.
    verify_state=False skips the ON/OFF check (a long fade-to-off can still report ON mid-transition).
    """
    if not bus.client:
        raise MqttDisconnected("MQTT Bus is disconnected")

    friendly_name = await resolve_friendly_name(bus, device_id)
    topic = f"{bus.z2m_base}/{friendly_name}/set"
    requested = payload.get("state") if verify_state else None

    result = await bus.rpc(topic, dict(payload))
    if _state_matches(requested, result):
        return result

    logger.warning(
        f"'{friendly_name}' replied state={result.get('state')} after a {requested} request; retrying once"
    )
    result = await bus.rpc(topic, dict(payload))
    if _state_matches(requested, result):
        return result

    raise DeviceStateMismatch(
        f"Device '{friendly_name}' reports state {result.get('state')} after being asked for {requested}."
    )


async def send_device(bus: AsyncMqttBus, device_id: str, payload: dict) -> None:
    """Fire-and-forget device command, for write-only settings the device never reports back."""
    if not bus.client:
        raise MqttDisconnected("MQTT Bus is disconnected")
    friendly_name = await resolve_friendly_name(bus, device_id)
    await bus.client.publish(f"{bus.z2m_base}/{friendly_name}/set", json.dumps(payload))


async def set_group(bus: AsyncMqttBus, group_name: str, payload: dict) -> None:
    """Fire-and-forget group command; member updates trickle into the twin."""
    if not bus.client:
        raise MqttDisconnected("MQTT Bus is disconnected")
    await bus.client.publish(f"{bus.z2m_base}/{group_name}/set", json.dumps(payload))
