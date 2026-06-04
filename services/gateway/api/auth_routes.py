from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel, Field
import uuid
from typing import Dict, Any
import logging

from shared.database.core import get_db
from shared.database.models import User, UserPreference, UserSecret, LogicalZone, DevicePlacement
from api.auth import get_current_user
from core.security import hash_password, verify_password, create_access_token

logger = logging.getLogger(__name__)

auth_router = APIRouter(prefix="/api/auth", tags=["Identity"])
platform_router = APIRouter(prefix="/api/platform", tags=["Platform Config"])

# --- Schemas ---
class UserAuthRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8)

class PreferenceUpdateRequest(BaseModel):
    ui_settings: dict | None = None
    agent_settings: dict | None = None

class SecretSaveRequest(BaseModel):
    provider: str = Field(..., min_length=2, max_length=50)
    credentials: str

class ZoneCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    zone_type: str = "room"
    display_order: int = 0

class PlacementUpdateRequest(BaseModel):
    zone_id: uuid.UUID | None = None
    pos_x: float = 0.0
    pos_y: float = 0.0
    pos_z: float = 0.0

# ====================================================================================
# Identity Routes
# ====================================================================================

@auth_router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_user(request: UserAuthRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == request.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="The chosen identity is already registered.")
        
    new_user = User(username=request.username, hashed_password=hash_password(request.password))
    db.add(new_user)
    await db.flush()  # Extract the newly generated UUID safely before committing
    
    # Guarantee that unstructured document bags are cleanly prepared
    default_prefs = UserPreference(user_id=new_user.id, ui_settings={}, agent_settings={})
    db.add(default_prefs)
    
    await db.commit()
    logger.info(f"New user registered with username: {request.username} and ID: {new_user.id}")
    return {"status": "success", "message": f"Identity '{request.username}' initialized successfully."}

@auth_router.post("/login")
async def login_user(request: UserAuthRequest, response: Response, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == request.username))
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credential combination.")
        
    if not user.is_active:
        raise HTTPException(status_code=401, detail="This account profile is currently disabled.")
        
    token = create_access_token(str(user.id))
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="strict",
        secure=False,  # Set to True in production environment with managed SSL/TLS termination
        max_age=60 * 24 * 30 * 60,  # 30-day duration matching access token expiry configurations
        path="/",
    )
    logger.info(f"User '{user.username}' authenticated successfully. Access token issued.")
    return {"status": "success", "username": user.username}

@auth_router.post("/logout")
async def logout_user(response: Response):
    response.delete_cookie(key="access_token", samesite="strict", httponly=True, path="/")
    logger.info(f"User logged out successfully.")

    return {"status": "success", "message": "Active session cleared successfully."}

@auth_router.get("/me")
async def get_current_identity(current_user: User = Depends(get_current_user)):
    """
    HTTP route dependency ensuring incoming cookie payloads resolve 
    to an active relational User record.
    """
    return {
        "status": "success",
        "user": {
            "id": str(current_user.id),
            "username": current_user.username
        }
    }

# ====================================================================================
# User Preferences & Cryptographic Vault Management
# ====================================================================================

@platform_router.get("/preferences")
async def get_preferences(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserPreference).where(UserPreference.user_id == current_user.id))
    prefs = result.scalar_one_or_none()
    return prefs or {"ui_settings": {}, "agent_settings": {}}

@platform_router.put("/preferences")
async def update_preferences(request: PreferenceUpdateRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserPreference).where(UserPreference.user_id == current_user.id))
    prefs = result.scalar_one()
    
    if request.ui_settings is not None:
        prefs.ui_settings = {**prefs.ui_settings, **request.ui_settings}
    if request.agent_settings is not None:
        prefs.agent_settings = {**prefs.agent_settings, **request.agent_settings}
        
    await db.commit()
    return {"status": "success", "message": "User options saved to document bag."}

@platform_router.post("/secrets")
async def save_integration_secret(request: SecretSaveRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Look for existing provider row to execute clean overwrites
    result = await db.execute(select(UserSecret).where(UserSecret.user_id == current_user.id, UserSecret.provider == request.provider))
    existing_secret = result.scalar_one_or_none()
    
    # NOTE: Add your symmetric fernet or AES application encryption logic on credentials here before DB save
    encrypted_payload = request.credentials 

    if existing_secret:
        existing_secret.encrypted_credentials = encrypted_payload
    else:
        new_secret = UserSecret(user_id=current_user.id, provider=request.provider, encrypted_credentials=encrypted_payload)
        db.add(new_secret)
        
    await db.commit()
    logger.info(f"User '{current_user.username}' updated credentials for integration provider: '{request.provider}'")

    return {"status": "success", "message": f"Credentials for integration '{request.provider}' updated."}

# ====================================================================================
# Topology & Layout Engine Nodes
# ====================================================================================

@platform_router.post("/zones")
async def create_zone(request: ZoneCreateRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    new_zone = LogicalZone(name=request.name, zone_type=request.zone_type, display_order=request.display_order)
    db.add(new_zone)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Zone name naming constraint error or collision.")
    return new_zone

@platform_router.put("/placements/{ieee_address}")
async def update_device_placement(ieee_address: str, request: PlacementUpdateRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DevicePlacement).where(DevicePlacement.ieee_address == ieee_address))
    placement = result.scalar_one_or_none()
    
    if not placement:
        placement = DevicePlacement(ieee_address=ieee_address)
        db.add(placement)
        
    placement.zone_id = request.zone_id
    placement.pos_x = request.pos_x
    placement.pos_y = request.pos_y
    placement.pos_z = request.pos_z
    
    await db.commit()
    return {"status": "success", "message": f"Topology coordinates updated for standard ID: {ieee_address}"}


