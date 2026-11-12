"""The device drawer's "All settings": every setting a device exposes, generically.

GET lists them with their current values; POST sets one and waits for the device to report it;
POST .../read asks the device to report values the hub hasn't seen yet. The list comes from
Z2M's exposes (core/device_settings.py), so any property Z2M doesn't mark as a setting is refused.
"""
import json
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from api.auth import get_current_user
from api.dependencies import get_mqtt_bus
from core import device_control
from core.device_settings import SETTING_TIMEOUT_S, check_value, same_value
from core.mqtt_bus import AsyncMqttBus

router = APIRouter(prefix="/api/devices", tags=["Device settings"], dependencies=[Depends(get_current_user)])


class SettingWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    property: str = Field(min_length=1, max_length=100)
    value: Any


class SettingRead(BaseModel):
    model_config = ConfigDict(extra="forbid")
    properties: List[str] = Field(min_length=1, max_length=50)


async def _load(bus: AsyncMqttBus, device_id: str) -> tuple[str, list, dict, dict]:
    """(ieee, items, raw twin state, meta) or 404/503."""
    raw = await bus.redis.get("gateway:device_settings")
    if raw is None:
        raise HTTPException(status_code=503, detail="Device settings are still syncing from the hub.")
    ieee = bus._device_registry.get(device_id, device_id)
    twin = await bus.redis.hget("gateway:digital_twin", ieee)
    if twin is None:
        raise HTTPException(status_code=404, detail=f"Device '{device_id}' not found.")
    meta_raw = await bus.redis.get("gateway:device_meta")
    meta = (json.loads(meta_raw) if meta_raw else {}).get(ieee) or {}
    return ieee, json.loads(raw).get(ieee, []), json.loads(twin), meta


def _asleep_hint(meta: dict) -> str:
    if (meta.get("power_source") or "").lower().startswith("battery"):
        return " It runs on battery and is probably asleep: press its button to wake it, then try again."
    return " It might be offline."


@router.get("/{device_id}/settings")
async def list_settings(device_id: str, bus: AsyncMqttBus = Depends(get_mqtt_bus)):
    _, items, state, meta = await _load(bus, device_id)
    with_values = [{**i, "value": state.get(i["property"])} for i in items]
    return {
        "battery_powered": (meta.get("power_source") or "").lower().startswith("battery"),
        "settings": [i for i in with_values if i["kind"] == "setting"],
        "details": [i for i in with_values if i["kind"] == "detail"],
    }


@router.post("/{device_id}/settings")
async def write_setting(device_id: str, body: SettingWrite, bus: AsyncMqttBus = Depends(get_mqtt_bus)):
    ieee, items, _, meta = await _load(bus, device_id)
    item = next((i for i in items if i["property"] == body.property and i["kind"] == "setting"), None)
    if item is None:
        raise HTTPException(status_code=422, detail=f"'{body.property}' isn't a setting of this device.")
    try:
        value = check_value(item, body.value)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"{item.get('label') or body.property} {e}.")
    if not bus.client:
        raise HTTPException(status_code=503, detail="MQTT Bus is disconnected")

    prop = body.property
    name = await device_control.resolve_friendly_name(bus, ieee)
    try:
        reply = await bus.rpc(f"{bus.z2m_base}/{name}/set", {prop: value}, timeout=SETTING_TIMEOUT_S,
                              accept=lambda r: prop in r and same_value(item, r[prop], value))
        return {"status": "success", "value": reply.get(prop)}
    except TimeoutError:
        # Some converters don't publish after a write; a later report may still carry the value.
        twin = await bus.redis.hget("gateway:digital_twin", ieee)
        now = (json.loads(twin) if twin else {}).get(prop)
        if same_value(item, now, value):
            return {"status": "success", "value": now}
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                            detail=f"{name} didn't confirm the change." + _asleep_hint(meta))


@router.post("/{device_id}/settings/read")
async def read_settings(device_id: str, body: SettingRead, bus: AsyncMqttBus = Depends(get_mqtt_bus)):
    """Ask the device to report these values (Z2M /get). The answers arrive as normal state updates."""
    ieee, items, _, _ = await _load(bus, device_id)
    readable = {i["property"] for i in items if i.get("access", 0) & 4}
    props = [p for p in body.properties if p in readable]
    if not props:
        raise HTTPException(status_code=422, detail="None of those values can be read from this device.")
    await device_control.send_device_get(bus, ieee, {p: "" for p in props})
    return {"status": "sent", "properties": props}
