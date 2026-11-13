"""Home / away per person, set by an iPhone Shortcuts automation (Arrive / Leave home) calling
POST /api/presence/me with a personal API token, or by hand in Settings → Presence.

State lives in Redis:
- `gateway:presence`: hash user id -> {"home": bool, "since": iso, "source": "shortcut" | "app" | ...}
- `gateway:presence_household`: {"anyone_home", "everyone_home", "anyone_since", "everyone_since"}

Only people who have reported at least once count towards the household summary, so someone who
never set up the Shortcut isn't "away" forever. With nobody reporting, the summary is unknown (null).

Routines see two kinds of pseudo-device, on the device-trigger machinery (like rooms' "room:<id>"):
- `presence:<user id>` reading {"home"}
- `presence:household` reading {"anyone_home", "everyone_home"}
Changes are broadcast as {type: "presence_update", device, state}.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from core.mqtt_bus import AsyncMqttBus
from shared.database.core import AsyncSessionLocal
from shared.database.models import User

logger = logging.getLogger(__name__)

PRESENCE_KEY = "gateway:presence"
HOUSEHOLD_KEY = "gateway:presence_household"
PRESENCE_PREFIX = "presence:"
HOUSEHOLD_DEVICE = "presence:household"
HOUSEHOLD_NAME = "Household"

_lock = asyncio.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def _active_users() -> dict[str, str]:
    """user id -> username, active users only."""
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(User.id, User.username).where(User.is_active == True))).all()
    return {str(uid): name for uid, name in rows}


async def person_state(redis, user_id: str) -> dict | None:
    raw = await redis.hget(PRESENCE_KEY, user_id)
    return json.loads(raw) if raw else None


async def household_state(redis) -> dict | None:
    raw = await redis.get(HOUSEHOLD_KEY)
    return json.loads(raw) if raw else None


async def snapshot(redis) -> dict:
    """Everyone (active users, reported or not) plus the household summary, for GET /api/presence."""
    users = await _active_users()
    states = {k: json.loads(v) for k, v in (await redis.hgetall(PRESENCE_KEY)).items()}
    people = [
        {"user_id": uid, "username": name, "home": states.get(uid, {}).get("home"),
         "since": states.get(uid, {}).get("since"), "source": states.get(uid, {}).get("source")}
        for uid, name in sorted(users.items(), key=lambda kv: kv[1].lower())
    ]
    return {"people": people, "household": await household_state(redis)}


def _person_event(user_id: str, name: str, state: dict) -> dict:
    return {"type": "presence_update", "device": PRESENCE_PREFIX + user_id, "user_id": user_id,
            "state": {"home": state["home"], "friendly_name": name, "since": state["since"]}}


async def _recompute_household(bus: AsyncMqttBus, users: dict[str, str]):
    """Caller holds _lock."""
    states = {k: json.loads(v) for k, v in (await bus.redis.hgetall(PRESENCE_KEY)).items() if k in users}
    prev = await household_state(bus.redis) or {}
    if states:
        anyone = any(s["home"] for s in states.values())
        everyone = all(s["home"] for s in states.values())
    else:
        anyone = everyone = None
    now = _now_iso()
    new = {
        "anyone_home": anyone, "everyone_home": everyone,
        "anyone_since": now if prev.get("anyone_home") != anyone or not prev.get("anyone_since") else prev["anyone_since"],
        "everyone_since": now if prev.get("everyone_home") != everyone or not prev.get("everyone_since") else prev["everyone_since"],
        "tracked": len(states),
    }
    if new == prev:
        return
    await bus.redis.set(HOUSEHOLD_KEY, json.dumps(new))
    if (prev.get("anyone_home"), prev.get("everyone_home")) != (anyone, everyone):
        logger.info(f"Household presence: anyone home={anyone}, everyone home={everyone}")
        bus.broadcast({"type": "presence_update", "device": HOUSEHOLD_DEVICE,
                       "state": {"anyone_home": anyone, "everyone_home": everyone, "friendly_name": HOUSEHOLD_NAME,
                                 "anyone_since": new["anyone_since"], "everyone_since": new["everyone_since"]}})


async def set_presence(bus: AsyncMqttBus, user_id: uuid.UUID | str, home: bool, source: str) -> dict:
    """Record a report. A repeat of the current state changes nothing (keeps `since`, fires nothing)."""
    uid = str(user_id)
    users = await _active_users()
    if uid not in users:
        raise KeyError(uid)
    async with _lock:
        prev = await person_state(bus.redis, uid)
        if prev and prev.get("home") == home:
            return prev
        state = {"home": home, "since": _now_iso(), "source": source}
        await bus.redis.hset(PRESENCE_KEY, uid, json.dumps(state))
        logger.info(f"Presence: {users[uid]} is {'home' if home else 'away'} ({source})")
        bus.broadcast(_person_event(uid, users[uid], state))
        await _recompute_household(bus, users)
        return state


async def forget(bus: AsyncMqttBus, user_id: uuid.UUID | str):
    """Stop tracking someone: they no longer count towards the household summary."""
    uid = str(user_id)
    async with _lock:
        await bus.redis.hdel(PRESENCE_KEY, uid)
        await _recompute_household(bus, await _active_users())


def target(who, state: str) -> tuple[str, str, bool, str]:
    """What a presence trigger/condition watches: (pseudo-device, attribute, wanted value, its
    "since" field). "Everyone away" means nobody home."""
    home = state == "home"
    if who == "anyone":
        return HOUSEHOLD_DEVICE, "anyone_home", home, "anyone_since"
    if who == "everyone":
        return (HOUSEHOLD_DEVICE, "everyone_home", True, "everyone_since") if home \
            else (HOUSEHOLD_DEVICE, "anyone_home", False, "anyone_since")
    return PRESENCE_PREFIX + str(who), "home", home, "since"


def describe(who, state: str) -> str:
    """Plain words for logs and run history ("nobody home", "person arrives")."""
    if who == "anyone":
        return "someone home" if state == "home" else "nobody home"
    if who == "everyone":
        return "everyone home" if state == "home" else "nobody home"
    return f"user {who} {state}"


def event_text(name: str, attribute: str, value: bool) -> str:
    """What happened, for run history: "Aidan came home", "Everyone left"."""
    if attribute == "anyone_home":
        return "Someone came home" if value else "Everyone left"
    if attribute == "everyone_home":
        return "Everyone is home" if value else "Someone left"
    return f"{name} came home" if value else f"{name} left"


async def reading(redis, device: str) -> dict | None:
    """The pseudo-device reading routines evaluate (scheduler/matching.device_reading)."""
    if device == HOUSEHOLD_DEVICE:
        h = await household_state(redis)
        if not h or h.get("anyone_home") is None:
            return None
        return {"anyone_home": h["anyone_home"], "everyone_home": h["everyone_home"], "friendly_name": HOUSEHOLD_NAME,
                "anyone_since": h.get("anyone_since"), "everyone_since": h.get("everyone_since")}
    uid = device[len(PRESENCE_PREFIX):]
    s = await person_state(redis, uid)
    if s is None:
        return None
    users = await _active_users()
    return {"home": s["home"], "friendly_name": users.get(uid, "someone"), "since": s.get("since")}
