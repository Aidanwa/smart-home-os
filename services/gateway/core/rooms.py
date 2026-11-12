"""Room occupancy: a room is occupied when any presence or motion sensor placed in it (Rooms floor
plan) says someone's there.

Kept in Redis (`gateway:rooms`, a hash of room id -> JSON) so it survives restarts, and broadcast as
`{type: "room_update", device: "room:<id>", state: {...}}` when a room changes, which the scheduler's
room triggers listen for (they reuse the device-trigger machinery on the pseudo-device "room:<id>").
Rooms without a presence sensor have `occupied: null`.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from core.mqtt_bus import AsyncMqttBus
from shared.database.core import AsyncSessionLocal
from shared.database.models import DevicePlacement, LogicalZone

logger = logging.getLogger(__name__)

ROOMS_KEY = "gateway:rooms"
ROOM_PREFIX = "room:"


def sensor_says_present(state: dict) -> bool | None:
    """True/False for a presence (mmWave) or motion (PIR) sensor, None for anything else.
    `presence` wins over `occupancy`: on sensors with both, the radar is the better answer."""
    if isinstance(state.get("presence"), bool):
        return state["presence"]
    if isinstance(state.get("occupancy"), bool):
        return state["occupancy"]
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def room_state(redis, room_id: str) -> dict | None:
    raw = await redis.hget(ROOMS_KEY, room_id)
    return json.loads(raw) if raw else None


async def all_rooms(redis) -> dict[str, dict]:
    return {k: json.loads(v) for k, v in (await redis.hgetall(ROOMS_KEY)).items()}


class RoomOccupancy:
    def __init__(self, bus: AsyncMqttBus):
        self.bus = bus
        self._rooms: dict[str, dict] = {}           # room id -> {"name", "floor", "devices": [ieee]}
        self._room_of: dict[str, str] = {}          # ieee -> room id
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def start(self):
        """Never raises: occupancy is a nicety, the gateway must still serve without it."""
        try:
            await self.reload()
        except Exception:
            logger.exception("Room occupancy failed to load; rooms will show no occupancy until the next floor-plan change")
        self._task = asyncio.create_task(self._listen())

    async def stop(self):
        if self._task:
            self._task.cancel()

    async def reload(self):
        """Re-read rooms and device placements (call after the floor plan changes) and recompute every room."""
        async with AsyncSessionLocal() as db:
            zones = (await db.execute(select(LogicalZone))).scalars().all()
            placements = (await db.execute(select(DevicePlacement))).scalars().all()
        rooms = {str(z.id): {"name": z.name, "floor": z.floor_level, "devices": []} for z in zones}
        room_of = {}
        for p in placements:
            rid = str(p.zone_id) if p.zone_id else None
            if rid in rooms:
                rooms[rid]["devices"].append(p.ieee_address)
                room_of[p.ieee_address] = rid
        async with self._lock:
            self._rooms, self._room_of = rooms, room_of
            stale = set(await self.bus.redis.hkeys(ROOMS_KEY)) - set(rooms)
            if stale:
                await self.bus.redis.hdel(ROOMS_KEY, *stale)
        for rid in rooms:
            await self._recompute(rid)

    async def _recompute(self, rid: str):
        async with self._lock:
            room = self._rooms.get(rid)
            if room is None:
                return
            sensors, verdicts = [], []
            for ieee in room["devices"]:
                raw = await self.bus.redis.hget("gateway:digital_twin", ieee)
                state = json.loads(raw) if raw else {}
                v = sensor_says_present(state)
                if v is not None:
                    sensors.append(state.get("friendly_name", ieee))
                    verdicts.append(v)
            occupied = any(verdicts) if verdicts else None
            prev = await room_state(self.bus.redis, rid) or {}
            changed = prev.get("occupied") != occupied
            new = {
                "name": room["name"], "floor": room["floor"], "occupied": occupied, "sensors": sensors,
                # When the current occupied/empty state began (kept across restarts and renames).
                "since": _now_iso() if changed or not prev.get("since") else prev["since"],
            }
            if new == prev:
                return
            await self.bus.redis.hset(ROOMS_KEY, rid, json.dumps(new))
        if changed or prev.get("name") != new["name"]:
            logger.info(f"Room '{new['name']}': {'occupied' if occupied else 'empty' if occupied is False else 'no sensor'}")
            self.bus.broadcast({"type": "room_update", "device": ROOM_PREFIX + rid, "room": rid,
                                "state": {"occupied": occupied, "friendly_name": new["name"], "since": new["since"]}})

    async def _listen(self):
        q = self.bus.subscribe()
        try:
            while True:
                msg = await q.get()
                if msg.get("type") != "device_update":
                    continue
                rid = self._room_of.get(msg.get("device"))
                state = msg.get("state") or {}
                if rid and ("presence" in state or "occupancy" in state):
                    try:
                        await self._recompute(rid)
                    except Exception:
                        logger.exception("Room occupancy update failed; continuing")
        finally:
            self.bus.unsubscribe(q)
