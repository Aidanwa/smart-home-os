import os
import httpx
import uuid
import json
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database.models import UserSecret
from shared.database.core import get_db
from api.auth import get_current_user, User

SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
SPOTIFY_REDIRECT_URI = os.getenv("SPOTIFY_REDIRECT_URI") # e.g. http://localhost:5173/settings

integrations_router = APIRouter(prefix="/api/integrations", tags=["Integrations"])

@integrations_router.get("/spotify/auth-url")
async def get_spotify_auth_url(user = Depends(get_current_user)):
    """Generates the secure Spotify OAuth URL for the frontend to redirect to."""
    if not SPOTIFY_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Spotify Client ID not configured on server.")
        
    state = uuid.uuid4().hex
    # Optional: You could save this `state` in Redis keyed to the user_id for strict CSRF validation later.
    
    scopes = "user-read-playback-state user-modify-playback-state user-read-currently-playing"
    
    auth_url = (
        f"https://accounts.spotify.com/authorize?response_type=code"
        f"&client_id={SPOTIFY_CLIENT_ID}"
        f"&scope={scopes.replace(' ', '%20')}"
        f"&redirect_uri={SPOTIFY_REDIRECT_URI}"
        f"&state={state}"
    )
    return {"auth_url": auth_url, "state": state}

@integrations_router.post("/spotify/callback")
async def spotify_auth_callback(
    payload: dict, # Expects {"code": "...", "state": "..."}
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Exchanges the auth code for a refresh token and saves it to the Vault."""
    code = payload.get("code")
    
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code missing.")
        
    # 1. Exchange Code for Tokens
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://accounts.spotify.com/api/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": SPOTIFY_REDIRECT_URI,
            },
            auth=(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)
        )
        
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange token with Spotify.")
        
    token_data = response.json()
    refresh_token = token_data.get("refresh_token")
    
    if not refresh_token:
        raise HTTPException(status_code=400, detail="No refresh token returned by Spotify. You may need to deauthorize the app and try again.")

    # 2. Package credentials exactly how the Agent expects them
    vault_payload = {
        "client_id": SPOTIFY_CLIENT_ID,
        "client_secret": SPOTIFY_CLIENT_SECRET,
        "refresh_token": refresh_token
    }
    encrypted_payload = json.dumps(vault_payload) # Note: Add your encryption layer here if applicable

    # 3. Upsert into Postgres Vault
    result = await db.execute(
        select(UserSecret).where(UserSecret.user_id == user.id, UserSecret.provider == "spotify")
    )
    secret_record = result.scalar_one_or_none()
    
    if secret_record:
        secret_record.encrypted_credentials = encrypted_payload
    else:
        new_secret = UserSecret(user_id=user.id, provider="spotify", encrypted_credentials=encrypted_payload)
        db.add(new_secret)
        
    await db.commit()
    
    return {"status": "success", "message": "Spotify successfully linked!"}

@integrations_router.get("/status")
async def get_integration_status(
    user = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    """Returns a map of which external providers the user has linked."""
    result = await db.execute(
        select(UserSecret.provider).where(UserSecret.user_id == user.id)
    )
    providers = result.scalars().all()
    
    return {
        "spotify": "spotify" in providers,
        "openai": "openai" in providers
    }

@integrations_router.delete("/{provider}")
async def disconnect_integration(
    provider: str, 
    user = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    """Deletes a provider's credentials from the vault."""
    result = await db.execute(
        select(UserSecret).where(
            UserSecret.user_id == user.id, 
            UserSecret.provider == provider
        )
    )
    secret_record = result.scalar_one_or_none()
    
    if secret_record:
        await db.delete(secret_record)
        await db.commit()
        
    return {"status": "success", "message": f"Successfully disconnected {provider}."}