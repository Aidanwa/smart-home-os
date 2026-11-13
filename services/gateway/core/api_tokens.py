"""Personal API tokens (shared.database.models.ApiToken): long-lived, revocable logins for things
that can't hold the browser's cookie, such as an iPhone Shortcut. Sent as `Authorization: Bearer`.

Tokens are 256 random bits, so a plain SHA-256 is enough to store them (no bcrypt needed)."""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from shared.database.core import AsyncSessionLocal
from shared.database.models import ApiToken

TOKEN_PREFIX = "shos_"
# last_used_at is written at most this often per token, to spare the Pi's SD card.
_TOUCH_EVERY = timedelta(minutes=5)


def new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def bearer_from_header(value: str | None) -> str | None:
    """The token from an `Authorization: Bearer shos_…` header, or None. Other bearer tokens
    (e.g. the gateway's own internal JWTs) aren't personal tokens and are ignored."""
    if not value:
        return None
    scheme, _, token = value.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token.startswith(TOKEN_PREFIX):
        return None
    return token


async def resolve(token: str) -> uuid.UUID | None:
    """The user a token belongs to, or None if it doesn't exist (or was revoked). Uses its own
    session, so the last-used write never commits anything belonging to the caller's request."""
    async with AsyncSessionLocal() as db:
        row = await db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(token)))
        if row is None:
            return None
        now = datetime.now(timezone.utc)
        if row.last_used_at is None or now - row.last_used_at > _TOUCH_EVERY:
            await db.execute(update(ApiToken).where(ApiToken.id == row.id).values(last_used_at=now))
            await db.commit()
        return row.user_id
