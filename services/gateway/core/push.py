"""Web push: notifications on the installed app (iOS 16.4+ home-screen app, or any browser).

Each phone that turns notifications on gives us a subscription (a push-service URL plus keys,
stored in push_subscriptions). To notify, the message is encrypted for that phone (RFC 8291,
aes128gcm, via http_ece) and POSTed to the URL, signed with our VAPID key (RFC 8292, an ES256
JWT). The push service (Apple, Google, Mozilla) can't read it; the app's service worker (sw.js)
shows it.

Config (.env): VAPID_PRIVATE_KEY is the base64url raw 32-byte P-256 private key (see
docs/runningstuff.md for the one-liner that makes it). VAPID_SUBJECT defaults to
https://<TLS_HOST>. Without a key, push is off and the API says so.
"""
import asyncio
import base64
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import urlsplit

import http_ece
import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from sqlalchemy import delete, select, update

from shared.database.core import AsyncSessionLocal
from shared.database.models import PushSubscription

logger = logging.getLogger(__name__)

TTL_S = 24 * 3600  # how long the push service keeps trying a phone that's off
TIMEOUT_S = 10


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


@lru_cache(maxsize=1)
def _vapid() -> tuple[ec.EllipticCurvePrivateKey, str] | None:
    raw = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    if not raw:
        return None
    try:
        key = ec.derive_private_key(int.from_bytes(_b64d(raw), "big"), ec.SECP256R1())
    except Exception:
        logger.error("VAPID_PRIVATE_KEY is set but isn't a valid base64url P-256 key; push is off")
        return None
    public = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return key, _b64e(public)


def public_key() -> str | None:
    """The applicationServerKey the browser subscribes with, or None if push isn't configured."""
    v = _vapid()
    return v[1] if v else None


def _subject() -> str:
    s = os.environ.get("VAPID_SUBJECT", "").strip()
    if s:
        return s
    host = os.environ.get("TLS_HOST", "").strip()
    return f"https://{host}" if host else "mailto:admin@localhost"


def _auth_header(endpoint: str) -> str:
    key, public = _vapid()
    parts = urlsplit(endpoint)
    # Apple refuses tokens valid for more than an hour.
    token = jwt.encode({"aud": f"{parts.scheme}://{parts.netloc}", "exp": int(time.time()) + 3600,
                        "sub": _subject()}, key, algorithm="ES256")
    return f"vapid t={token}, k={public}"


def _encrypt(sub: PushSubscription, payload: bytes) -> bytes:
    return http_ece.encrypt(
        payload,
        salt=os.urandom(16),
        private_key=ec.generate_private_key(ec.SECP256R1()),  # fresh per message
        dh=_b64d(sub.p256dh),
        auth_secret=_b64d(sub.auth),
        version="aes128gcm",
    )


async def _send_one(client: httpx.AsyncClient, sub: PushSubscription, payload: bytes, urgency: str) -> str:
    """'ok', 'gone' (the phone unsubscribed or the app was removed) or 'error'."""
    try:
        res = await client.post(sub.endpoint, content=_encrypt(sub, payload), headers={
            "Authorization": _auth_header(sub.endpoint),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(TTL_S),
            "Urgency": urgency,
        })
    except httpx.HTTPError as e:
        logger.warning(f"Push to {urlsplit(sub.endpoint).netloc} failed: {e!r}")
        return "error"
    if res.status_code in (200, 201, 202):
        return "ok"
    if res.status_code in (404, 410):
        return "gone"
    logger.warning(f"Push to {urlsplit(sub.endpoint).netloc} refused: {res.status_code} {res.text[:200]}")
    return "error"


async def send(user_ids: list, title: str, body: str, url: str = "/", tag: str | None = None,
               urgency: str = "normal") -> dict:
    """Notify every subscribed device of these users. Returns {devices, sent, failed}.
    `tag` replaces an earlier notification with the same tag instead of stacking a new one."""
    if not _vapid() or not user_ids:
        return {"devices": 0, "sent": 0, "failed": 0}
    async with AsyncSessionLocal() as s:
        subs = list((await s.scalars(select(PushSubscription).where(
            PushSubscription.user_id.in_([uuid.UUID(str(u)) for u in user_ids])))).all())
    if not subs:
        return {"devices": 0, "sent": 0, "failed": 0}

    msg = {"title": title[:120], "body": body[:500], "url": url}
    if tag:
        msg["tag"] = tag
    payload = json.dumps(msg).encode()
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
        results = await asyncio.gather(*(_send_one(client, sub, payload, urgency) for sub in subs))

    ok = [sub.id for sub, r in zip(subs, results) if r == "ok"]
    gone = [sub.id for sub, r in zip(subs, results) if r == "gone"]
    async with AsyncSessionLocal() as s:
        if ok:
            await s.execute(update(PushSubscription).where(PushSubscription.id.in_(ok))
                            .values(last_ok_at=datetime.now(timezone.utc)))
        if gone:
            await s.execute(delete(PushSubscription).where(PushSubscription.id.in_(gone)))
            logger.info(f"Removed {len(gone)} push subscription(s) the push service says are gone")
        await s.commit()
    return {"devices": len(subs), "sent": len(ok), "failed": len(subs) - len(ok)}


async def users_with_devices() -> list[uuid.UUID]:
    async with AsyncSessionLocal() as s:
        return list((await s.scalars(select(PushSubscription.user_id).distinct())).all())
