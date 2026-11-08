"""Internal endpoints for the gateway's routine scheduler. Runs allow-listed tools directly, no LLM.

Reachable only on the Docker network: the agent publishes no host port, and the gateway proxies
only /api/agent/*, never /internal/*. Requests must carry a gateway-minted JWT with
scope "internal" (a normal session cookie is not accepted).
"""
import logging

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from api.dependencies import spotify_service
from shared.security import JWT_SECRET_KEY

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal", tags=["Internal"])


def internal_user(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Internal token missing")
    try:
        payload = jwt.decode(auth[7:], JWT_SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Internal token invalid or expired")
    if payload.get("scope") != "internal" or not payload.get("sub"):
        raise HTTPException(status_code=403, detail="Not an internal token")
    return payload["sub"]


async def _devices(user_id: str, **_):
    data = await spotify_service._request(user_id, "GET", "/me/player/devices")
    return {"status": "success", "data": [
        {"name": d.get("name"), "type": d.get("type"), "is_active": d.get("is_active"), "volume": d.get("volume_percent")}
        for d in data.get("devices", []) if d.get("name")
    ]}


async def _player(user_id: str, **_):
    """What's playing where, at what volume (used by the volume ramp to notice manual changes)."""
    st = await spotify_service._request(user_id, "GET", "/me/player") or {}
    dev = st.get("device") or {}
    return {"status": "success", "data": {
        "is_playing": bool(st.get("is_playing")), "device": dev.get("name"), "volume": dev.get("volume_percent"),
    }}


TOOLS = {
    "spot_play": spotify_service.spotify_play,
    "spot_ctrl": spotify_service.spotify_controller,
    "spot_search": spotify_service.spotify_search,
    "spot_search_playlist": spotify_service.spotify_search_playlist,
    "spot_devices": _devices,
    "spot_player": _player,
}


class ToolCall(BaseModel):
    args: dict = Field(default_factory=dict)


@router.post("/tools/{name}")
async def run_tool(name: str, call: ToolCall, user_id: str = Depends(internal_user)):
    tool = TOOLS.get(name)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' isn't available internally")
    args = {k: v for k, v in call.args.items() if k != "user_id"}
    try:
        result = await tool(user_id=user_id, **args)
    except Exception as e:
        # Tools normally return {"status": "error"} themselves; this catches config problems
        # such as Spotify not being linked (raised from the token code).
        logger.warning(f"Internal tool {name} failed: {e}")
        return {"status": "error", "message": str(e)}
    logger.info(f"Internal tool {name} for user {user_id}: {result.get('status')}")
    return result
