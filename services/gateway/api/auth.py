import uuid
from fastapi import Request, HTTPException, status, Depends, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from shared.database.core import get_db, AsyncSessionLocal
from shared.database.models import User
from core.security import create_access_token, decode_access_token
from core.api_tokens import bearer_from_header, resolve as resolve_api_token

async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """
    HTTP route dependency ensuring incoming cookie payloads resolve
    to an active relational User record.
    Also accepts a personal API token (`Authorization: Bearer shos_…`, see core/api_tokens.py).
    """
    if not request.cookies.get("access_token"):
        bearer = bearer_from_header(request.headers.get("authorization"))
        if bearer:
            user_uuid = await resolve_api_token(bearer)
            if user_uuid is None:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API token not recognised (revoked?).")
            return await _active_user(db, user_uuid)
    return await get_session_user(request, db)


async def agent_cookie_for(request: Request) -> str | None:
    """For the /api/agent proxy: the Cookie header to forward. The browser's own cookie passes
    through; a personal API token is swapped for a 5-minute session JWT, because the agent only
    reads the cookie (and the token itself never leaves the gateway). None: no usable login."""
    raw_cookie = request.headers.get("cookie")
    if request.cookies.get("access_token"):
        return raw_cookie
    bearer = bearer_from_header(request.headers.get("authorization"))
    if not bearer:
        return raw_cookie
    user_uuid = await resolve_api_token(bearer)
    if user_uuid is None:
        return None
    async with AsyncSessionLocal() as db:
        try:
            await _active_user(db, user_uuid)
        except HTTPException:
            return None
    return f"access_token={create_access_token(str(user_uuid), minutes=5)}"


async def get_session_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """Like get_current_user, but only the browser's session cookie counts, never an API token.
    For account changes and token management, so a leaked token can't mint more tokens, change
    the password or delete the account."""
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session context missing. Authentication required."
        )

    user_id_str = decode_access_token(token)
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has expired or token verification failed."
        )
        
    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed context identification inside token structure."
        )
    return await _active_user(db, user_uuid)


async def _active_user(db: AsyncSession, user_uuid: uuid.UUID) -> User:
    result = await db.execute(select(User).where(User.id == user_uuid, User.is_active == True))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated context matches an inactive or non-existent profile."
        )
    return user

async def get_ws_authenticated_user(websocket: WebSocket) -> User | None:
    """
    WebSocket-compatible context verifier that intercepts parameters 
    during initial connection handshakes.
    """
    token = websocket.cookies.get("access_token")
    if not token:
        return None
    
    user_id_str = decode_access_token(token)
    if not user_id_str:
        return None
        
    try:
        user_uuid = uuid.UUID(user_id_str)
        # WebSockets hold connections outside route lifetimes; execute an isolated session query
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(User).where(User.id == user_uuid, User.is_active == True))
            return result.scalar_one_or_none()
    except Exception:
        return None
    

