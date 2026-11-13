import os
from datetime import datetime, timedelta, timezone
import jwt
from passlib.context import CryptContext

from shared.security import JWT_SECRET_KEY as SECRET_KEY  # raises at startup if unset
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 Days for low-friction home dashboards

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Hash plain text passwords securely using bcrypt."""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify an unhashed incoming password against its DB representation."""
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(user_id: str, minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES) -> str:
    """Generate a signed cryptographic token targeting a user's unique identity."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    to_encode = {"sub": user_id, "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str) -> str | None:
    """Decode a signed token string, extracting the subject identity string if valid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
    

    