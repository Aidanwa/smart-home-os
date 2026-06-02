import os
from datetime import datetime, timedelta, timezone
import jwt
from passlib.context import CryptContext

# Fallback contexts for local development. Provide a persistent env override in production.
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "7b9d8df2ac3ce72b8d0093cf1b988fce899ea298b11119fcd5c95279da7311ef")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 Days for low-friction home dashboards

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Hash plain text passwords securely using bcrypt."""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify an unhashed incoming password against its DB representation."""
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(user_id: str) -> str:
    """Generate a signed cryptographic token targeting a user's unique identity."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"sub": user_id, "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str) -> str | None:
    """Decode a signed token string, extracting the subject identity string if valid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
    

    