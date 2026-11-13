"""Home / away (core/presence.py).

POST /api/presence/me is what the iPhone Shortcuts automations call (Bearer API token).
The others are for Settings → Presence: everyone's state, a manual override, stop tracking."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from shared.database.models import User
from api.auth import get_current_user
from core import presence

router = APIRouter(prefix="/api/presence", tags=["Presence"])


class PresenceRequest(BaseModel):
    state: Literal["home", "away"]
    # Where the report came from, shown in Settings ("shortcut", "wifi", "app").
    source: str = "shortcut"


async def _set(request: Request, user_id, req: PresenceRequest) -> dict:
    try:
        state = await presence.set_presence(request.app.state.bus, user_id, req.state == "home", req.source[:20] or "shortcut")
    except KeyError:
        raise HTTPException(404, "No such user.")
    return {"status": "success", **state}


@router.get("")
async def get_presence(request: Request, current_user: User = Depends(get_current_user)):
    return await presence.snapshot(request.app.state.bus.redis)


# Fixed path before /{user_id}.
@router.post("/me")
async def set_my_presence(req: PresenceRequest, request: Request, current_user: User = Depends(get_current_user)):
    return await _set(request, current_user.id, req)


@router.post("/{user_id}")
async def set_presence_for(user_id: uuid.UUID, req: PresenceRequest, request: Request, current_user: User = Depends(get_current_user)):
    """Manual override (a phone died, someone forgot it). No roles yet, so anyone signed in can."""
    return await _set(request, user_id, req)


@router.delete("/{user_id}")
async def stop_tracking(user_id: uuid.UUID, request: Request, current_user: User = Depends(get_current_user)):
    await presence.forget(request.app.state.bus, user_id)
    return {"status": "success"}
