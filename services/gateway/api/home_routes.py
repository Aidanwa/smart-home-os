import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import Optional

from api.auth import get_current_user
from shared.database.core import get_db
from shared.database.models import Home
from .models import HomeUpdate, HomeResponse

router = APIRouter(prefix="/api/home", tags=["Home Configuration"])
logger = logging.getLogger(__name__)

async def resolve_spatial_data(address: Optional[str], lat: Optional[float], lon: Optional[float]) -> tuple[Optional[float], Optional[float], dict, Optional[str]]:
    """Geocodes an address via OpenStreetMap and fetches the NWS Weather Grid.
    Returns (lat, lon, weather_grid, address); address is Nominatim's display_name when geocoded."""
    weather_grid = {}
    # Keep the caller's address unless geocoding succeeds (previously unbound if skipped/failed)
    new_address = address
    
    # Add follow_redirects=True so httpx handles any 301/302 responses automatically
    async with httpx.AsyncClient(follow_redirects=True) as client:
        # 1. Geocode Address if lat/lon are missing
        if address and (not lat or not lon):
            try:
                headers = {"User-Agent": "SmartHomeOS_Aidanwa/1.0 (https://github.com/aidanwa/smart-home-os)"}
                res = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": address, "format": "json", "limit": 1},
                    headers=headers,
                    timeout=5.0
                )
                res.raise_for_status()
                data = res.json()
                if data:
                    lat = float(data[0]["lat"])
                    lon = float(data[0]["lon"])
                    new_address = data[0].get("display_name", address)
            except Exception as e:
                logger.warning(f"Failed to geocode address: {e}")

        # 2. Resolve Weather Grid if we have coordinates
        if lat and lon:
            try:
                # Format to 4 decimal places ({lat:.4f}) to satisfy the NWS API and avoid redirects
                res = await client.get(f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}", timeout=5.0)
                res.raise_for_status()
                props = res.json().get("properties", {})
                weather_grid = {
                    "gridId": props.get("gridId"),
                    "gridX": props.get("gridX"),
                    "gridY": props.get("gridY"),
                    "timezone": props.get("timeZone", "UTC") 
                }
            except Exception as e:
                logger.warning(f"Failed to fetch NWS grid: {e}")

    return lat, lon, weather_grid, new_address

@router.get("", response_model=Optional[HomeResponse])
async def get_home(
    session: AsyncSession = Depends(get_db), 
    user = Depends(get_current_user)
):
    """Fetch the singleton home profile. Returns null if not configured."""
    home = await session.scalar(select(Home).limit(1))
    return home

@router.post("", response_model=HomeResponse)
async def create_home(
    data: HomeUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Initialize the smart home context."""
    existing = await session.scalar(select(Home).limit(1))
    if existing:
        raise HTTPException(status_code=400, detail="Home profile already exists. Use PUT to update.")

    lat, lon, grid, full_address = await resolve_spatial_data(data.address, data.latitude, data.longitude)
    
    new_home = Home(
        nickname=data.nickname,
        address=full_address,
        timezone=grid.get("timezone", data.timezone), # Prioritize NWS timezone if found
        latitude=lat,
        longitude=lon,
        weather_grid=grid,
        bottom_floor=data.bottom_floor,
        top_floor=data.top_floor,
    )
    session.add(new_home)
    await session.commit()
    await session.refresh(new_home)
    await request.app.state.scheduler.reload_all()  # the home timezone may have changed
    return new_home

@router.put("", response_model=HomeResponse)
async def update_home(
    data: HomeUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Update the home profile and recalculate grids if address changes."""
    home = await session.scalar(select(Home).limit(1))
    if not home:
        raise HTTPException(status_code=404, detail="Home profile not found.")

    # Default to the incoming data address in case the if-block is skipped
    full_address = data.address

    # Look the address up again only when it changed, explicit coordinates were sent, or the
    # last lookup failed. (The form never sends coordinates, so comparing them to the stored
    # ones made every save, even a nickname change, hit Nominatim and NWS.)
    coords_given = data.latitude is not None and data.longitude is not None
    lookup_failed = bool(home.address) and (home.latitude is None or not home.weather_grid)
    if data.address != home.address or coords_given or lookup_failed:
        lat, lon, grid, full_address = await resolve_spatial_data(data.address, data.latitude, data.longitude)
        home.latitude = lat
        home.longitude = lon
        home.weather_grid = grid
        if grid and grid.get("timezone"):
            home.timezone = grid["timezone"]

    home.nickname = data.nickname
    home.address = full_address
    home.bottom_floor = data.bottom_floor
    home.top_floor = data.top_floor
    
    # Only override timezone manually if the user explicitly set it and NWS didn't overwrite it
    if data.timezone and not (home.weather_grid and home.weather_grid.get("timezone")):
        home.timezone = data.timezone

    await session.commit()
    await session.refresh(home)
    await request.app.state.scheduler.reload_all()  # the home timezone may have changed
    
    # Return the database object so FastAPI can serialize it into HomeResponse
    return home

@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_home(
    request: Request,
    session: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Delete the singleton home profile."""
    home = await session.scalar(select(Home).limit(1))
    if not home:
        raise HTTPException(status_code=404, detail="Home profile not found.")
    
    await session.delete(home)
    await session.commit()
    await request.app.state.scheduler.reload_all()  # the home timezone may have changed
    return None