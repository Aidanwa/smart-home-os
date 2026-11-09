"""Notifications: each user's subscribed phones/browsers, and a test send.

Which alerts a user gets is in their ui_settings (notify_failed / notify_missed / notify_partial,
all off by default), saved through /api/platform/preferences like other settings.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database.core import get_db
from shared.database.models import PushSubscription, User
from api.auth import get_current_user
from core import push

router = APIRouter(prefix="/api/push", tags=["Notifications"])


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class SubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000, pattern=r"^https://")
    keys: SubscriptionKeys
    label: str | None = Field(None, max_length=100)


def _out(s: PushSubscription) -> dict:
    return {
        "id": str(s.id), "endpoint": s.endpoint, "label": s.label,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "last_ok_at": s.last_ok_at.isoformat() if s.last_ok_at else None,
    }


@router.get("/key")
async def get_key(current_user: User = Depends(get_current_user)):
    key = push.public_key()
    if not key:
        raise HTTPException(503, "Notifications aren't set up on the hub (no VAPID key).")
    return {"public_key": key}


@router.get("/subscriptions")
async def list_subscriptions(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    subs = (await db.scalars(select(PushSubscription).where(PushSubscription.user_id == current_user.id)
                             .order_by(PushSubscription.created_at))).all()
    return [_out(s) for s in subs]


@router.post("/subscriptions")
async def subscribe(req: SubscribeRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Saves this device's subscription. Re-subscribing the same device updates it (and moves it to
    whoever is signed in now, so a shared phone notifies only its current user)."""
    sub = await db.scalar(select(PushSubscription).where(PushSubscription.endpoint == req.endpoint))
    if sub is None:
        sub = PushSubscription(endpoint=req.endpoint)
        db.add(sub)
    sub.user_id = current_user.id
    sub.p256dh, sub.auth = req.keys.p256dh, req.keys.auth
    if req.label:
        sub.label = req.label
    await db.commit()
    await db.refresh(sub)
    return _out(sub)


@router.delete("/subscriptions/{sub_id}", status_code=204)
async def unsubscribe(sub_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(delete(PushSubscription).where(
        PushSubscription.id == sub_id, PushSubscription.user_id == current_user.id))
    await db.commit()
    if not res.rowcount:
        raise HTTPException(404, "No such device")


@router.post("/test")
async def send_test(current_user: User = Depends(get_current_user)):
    if not push.public_key():
        raise HTTPException(503, "Notifications aren't set up on the hub (no VAPID key).")
    result = await push.send([current_user.id], "Test notification",
                             "Notifications from your home hub are working.", url="/#settings", tag="test")
    if result["devices"] == 0:
        raise HTTPException(409, "No device has notifications turned on for your account.")
    if result["sent"] == 0:
        raise HTTPException(502, "The push service didn't accept the notification. Try turning notifications off and on again on that device.")
    return result
