"""Personal API tokens (Settings → API tokens): create, list, revoke.

Managing tokens needs the browser session (get_session_user), never a token itself."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database.core import get_db
from shared.database.models import ApiToken, User
from api.auth import get_session_user
from core.api_tokens import hash_token, new_token

router = APIRouter(prefix="/api/tokens", tags=["API tokens"])

MAX_TOKENS_PER_USER = 20


class CreateTokenRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


def _out(t: ApiToken) -> dict:
    return {
        "id": str(t.id), "name": t.name, "prefix": t.prefix,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
    }


@router.get("")
async def list_tokens(current_user: User = Depends(get_session_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(ApiToken).where(ApiToken.user_id == current_user.id)
                             .order_by(ApiToken.created_at))).all()
    return [_out(t) for t in rows]


@router.post("")
async def create_token(req: CreateTokenRequest, current_user: User = Depends(get_session_user), db: AsyncSession = Depends(get_db)):
    """Returns the token itself once ("token"); only its hash is kept."""
    count = await db.scalar(select(func.count()).select_from(ApiToken).where(ApiToken.user_id == current_user.id))
    if count >= MAX_TOKENS_PER_USER:
        raise HTTPException(400, f"You already have {MAX_TOKENS_PER_USER} tokens; revoke one first.")
    token = new_token()
    row = ApiToken(user_id=current_user.id, name=req.name.strip(), token_hash=hash_token(token), prefix=token[:9])
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {**_out(row), "token": token}


@router.delete("/{token_id}")
async def revoke_token(token_id: uuid.UUID, current_user: User = Depends(get_session_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(delete(ApiToken).where(ApiToken.id == token_id, ApiToken.user_id == current_user.id))
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(404, "Token not found.")
    return {"status": "success"}
