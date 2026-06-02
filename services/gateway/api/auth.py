import uuid
from fastapi import Request, HTTPException, status, Depends, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from shared.database.core import get_db, AsyncSessionLocal
from shared.database.models import User
from core.security import decode_access_token

async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """
    HTTP route dependency ensuring incoming cookie payloads resolve 
    to an active relational User record.
    """
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
    

